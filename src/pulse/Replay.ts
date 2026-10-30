/**
 * Replay — a whole run as data: the starting config, the seed and the engine's input log. Because
 * the sim is deterministic, `simulate` reproduces the run exactly, so a replay can drive a ghost
 * and a server can verify a score without trusting the client.
 * Pure TypeScript with no DOM or content imports (rules are passed in), so it runs in Node, in
 * the browser and in an edge function alike.
 */

import { PulseEngine } from './PulseEngine.js';
import type { ContentRules, PulseConfig, ReplayEvent } from './types.js';

export const REPLAY_VERSION = 1;
/** Catch-up skips only happen past 32 steps; plain advances stay under it. */
const CHUNK = 32;

export interface Replay {
  v: number;
  seed: string;
  mode: PulseConfig['mode'];
  bpm: number;
  colors: number;
  rise: number;
  pressure: boolean;
  /** Pressure from the top (B-side Flip); absent in older replays, which all rise from the bottom */
  flip?: boolean;
  events: ReplayEvent[];
  /** Engine step where the run ended, and its raw score (before the tempo-scale normalisation) */
  end: { s: number; score: number };
}

export interface SimResult {
  score: number;
  step: number;
  gameOver: boolean;
  groupsCleared: number;
  /** FNV-1a of the final wall, to compare boards as well as scores */
  boardHash: string;
}

/** Captures a finished (or running) engine as a replay. */
export function replayOf(engine: PulseEngine): Replay {
  const c = engine.initial;
  return {
    v: REPLAY_VERSION,
    seed: c.seed,
    mode: c.mode,
    bpm: c.bpm,
    colors: c.colorCount ?? engine.config.colorCount,
    rise: c.riseBars ?? engine.config.riseBars,
    pressure: c.pressureEnabled ?? true,
    ...(c.pressureFrom === 'top' ? { flip: true } : {}),
    events: engine.log.map(e => ({ ...e })),
    end: { s: engine.currentStep, score: engine.telemetry.score }
  };
}

/** Advances without triggering a catch-up skip the original never had. */
function advance(e: PulseEngine, target: number): void {
  while (target - e.currentStep > CHUNK && !e.gameOver) e.advanceToStep(e.currentStep + CHUNK);
  e.advanceToStep(target);
  e.events.length = 0;
}

/** A fresh engine for `r`, before any event. */
export function engineFor(r: Replay, rules: ContentRules): PulseEngine {
  return new PulseEngine({ seed: r.seed, mode: r.mode, bpm: r.bpm, colorCount: r.colors, riseBars: r.rise, pressureEnabled: r.pressure, pressureFrom: r.flip ? 'top' : 'bottom' }, rules);
}

/**
 * Applies the events of `r` with index >= `from` up to (and including) engine step `upTo`, after
 * advancing `e` to each event's step. Returns the index of the next unapplied event. Ghosts call
 * this every frame; `simulate` calls it once for the whole run.
 */
export function applyUntil(e: PulseEngine, r: Replay, from: number, upTo: number): number {
  let i = from;
  for (; i < r.events.length; i++) {
    const ev = r.events[i]!;
    if (ev.s > upTo || e.gameOver) break;
    advance(e, ev.s);
    switch (ev.k) {
      case 'p':
        e.primeAt(ev.c, ev.r, ev.t);
        break;
      case 'h':
        e.holdAt(ev.c, ev.r);
        break;
      case 'j':
        e.advanceToStep(ev.to);
        e.events.length = 0;
        break;
      case 'm':
        e.reconfigure(ev.bpm, ev.colors, ev.rise);
        break;
      case 'x':
        e.setPressureEnabled(ev.on);
        break;
    }
  }
  if (!e.gameOver && upTo > e.currentStep) advance(e, upTo);
  return i;
}

export function simulate(r: Replay, rules: ContentRules): SimResult {
  if (r.v !== REPLAY_VERSION) throw new Error(`replay version ${r.v} is not ${REPLAY_VERSION}`);
  const e = engineFor(r, rules);
  applyUntil(e, r, 0, r.end.s);
  return { score: e.telemetry.score, step: e.currentStep, gameOver: e.gameOver, groupsCleared: e.telemetry.groupsCleared, boardHash: boardHash(e) };
}

export function boardHash(e: PulseEngine): string {
  let h = 0x811c9dc5;
  for (const row of e.board) for (const t of row) h = Math.imul(h ^ (t ? t.kind + 1 : 0), 0x01000193);
  return (h >>> 0).toString(16);
}
