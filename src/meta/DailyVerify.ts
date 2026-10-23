/**
 * DailyVerify — the server's check of a submitted Daily run (also run in Node tests). The client
 * sends only its replay; this re-simulates it and returns the server's own score, so a forged
 * score is impossible and a forged replay has to be a real run.
 * Beyond re-simulation it pins what a player does not control:
 *  - seed, mode and the starting movement's tempo, colours and rise are the day's
 *  - each movement change is the next movement in order, made only after its quota was earned
 *  - no pressure switches; at most 3 stall skips (they skip pressure rows, so they are capped)
 *  - bounded size, so a submission cannot burn the function's CPU
 * DOM-free and content-free: the track rules and gem rules are passed in.
 */

import { PulseEngine } from '../pulse/PulseEngine.js';
import { REPLAY_VERSION, type Replay } from '../pulse/Replay.js';
import type { ContentRules } from '../pulse/types.js';

export interface TrackRule {
  bpm: number;
  colors: number;
  rise: number;
  quota: number;
}

export type DailyCheck = { ok: true; score: number; bars: number; gameOver: boolean } | { ok: false; reason: string };

export const MAX_EVENTS = 20000;
export const MAX_STEPS = 40000;
const MAX_SKIPS = 3;
const CHUNK = 32;

/** Index of the movement a Daily starts on (matches App.trackIndex). */
export function dailyStart(day: string, count: number): number {
  return Math.floor(Date.parse(day) / 86400000) % count;
}

export function verifyDaily(r: Replay, day: string, tracks: readonly TrackRule[], rules: ContentRules): DailyCheck {
  const bad = (reason: string): DailyCheck => ({ ok: false, reason });
  if (!r || typeof r !== 'object' || r.v !== REPLAY_VERSION) return bad('version');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('day');
  if (r.seed !== `daily-${day}` || r.mode !== 'daily') return bad('not this Daily');
  let mv = dailyStart(day, tracks.length);
  const t0 = tracks[mv]!;
  if (r.bpm !== t0.bpm || r.colors !== t0.colors || r.rise !== t0.rise || r.pressure !== true) return bad('rules');
  if (!Array.isArray(r.events) || r.events.length > MAX_EVENTS) return bad('size');
  if (!r.end || !Number.isInteger(r.end.s) || r.end.s < 0 || r.end.s > MAX_STEPS) return bad('length');

  const e = new PulseEngine({ seed: r.seed, mode: 'daily', bpm: r.bpm, colorCount: r.colors, riseBars: r.rise, pressureEnabled: true }, rules);
  const advance = (target: number): void => {
    while (target - e.currentStep > CHUNK && !e.gameOver) e.advanceToStep(e.currentStep + CHUNK);
    e.advanceToStep(target);
    e.events.length = 0;
  };
  let lastS = -1;
  let skips = 0;
  let movementStart = 0;
  for (const ev of r.events) {
    if (!ev || typeof ev !== 'object' || !Number.isInteger(ev.s) || ev.s < lastS || ev.s > r.end.s) return bad('order');
    lastS = ev.s;
    if (e.gameOver) break;
    advance(ev.s);
    switch (ev.k) {
      case 'p':
        if (!cell(ev.c, ev.r) || (ev.t !== undefined && (typeof ev.t !== 'number' || !Number.isFinite(ev.t)))) return bad('prime');
        e.primeAt(ev.c, ev.r, ev.t);
        break;
      case 'h':
        if (!cell(ev.c, ev.r)) return bad('hold');
        e.holdAt(ev.c, ev.r);
        break;
      case 'j':
        if (++skips > MAX_SKIPS || !Number.isInteger(ev.to) || ev.to - ev.s <= CHUNK || ev.to - ev.s > 4 * CHUNK) return bad('skips');
        e.advanceToStep(ev.to);
        e.events.length = 0;
        break;
      case 'm': {
        const next = tracks[(mv + 1) % tracks.length]!;
        if (e.telemetry.score - movementStart < tracks[mv]!.quota) return bad('early movement change');
        if (ev.bpm !== next.bpm || ev.colors !== next.colors || ev.rise !== next.rise) return bad('movement rules');
        e.reconfigure(ev.bpm, ev.colors, ev.rise);
        mv = (mv + 1) % tracks.length;
        movementStart = e.telemetry.score;
        break;
      }
      default:
        return bad('event');
    }
  }
  if (!e.gameOver) advance(r.end.s);
  return { ok: true, score: Math.round(e.telemetry.score), bars: e.currentBar, gameOver: e.gameOver };
}

function cell(c: unknown, r: unknown): boolean {
  return Number.isInteger(c) && Number.isInteger(r) && (c as number) >= 0 && (c as number) < 16 && (r as number) >= 0 && (r as number) < 10;
}
