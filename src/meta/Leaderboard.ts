/**
 * Leaderboard — the verified Daily board. The only module allowed to reach the network (the NETWORK
 * gate allows this file and this host), and only after the player opts in with a name.
 * - submit: posts the run's replay; the server re-simulates it and keeps its own score
 * - top: the day's leaders (name, score, bars), read-only
 * A submit that cannot reach the server is kept (today's best only) and retried next time.
 * Identity is an anonymous id made on this device; it is never shown or readable on the board.
 */

import type { Replay } from '../pulse/Replay.js';
import { readJson, writeJson } from '../platform/Storage.js';
import { cleanName } from './text.js';

export const BOARD_HOST = 'https://iysvarvkltihgosbhtaa.supabase.co';
/** Publishable key: identifies the project to its gateway; grants read-only access to the board. */
const KEY = 'sb_publishable_7Kxs-F6HGMgZmb86V1b9_A_qtyUerCh';
const PREFS = 'breakbeat-board';
const PENDING = 'breakbeat-board-pending';
const TIMEOUT_MS = 8000;

export interface BoardPrefs {
  /** Opted in to posting Daily runs */
  on: boolean;
  name: string;
  player: string;
}

export interface BoardResult {
  score: number;
  best: number;
  rank: number;
  total: number;
}

export interface BoardRow {
  name: string;
  score: number;
  bars: number;
}

export function prefs(): BoardPrefs {
  const p = readJson<Partial<BoardPrefs>>(PREFS, {});
  return { on: !!p.on, name: cleanName(p.name ?? '', '').slice(0, 16), player: p.player || newId() };
}

export function savePrefs(p: BoardPrefs): void {
  writeJson(PREFS, { ...p, name: cleanName(p.name, 'Player').slice(0, 16) });
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const h = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BOARD_HOST}${path}`, { ...init, signal: ctl.signal, headers: { apikey: KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

/** Posts a Daily replay. Throws 'offline' (kept for retry) or the server's reason. */
export async function submit(day: string, replay: Replay): Promise<BoardResult> {
  const p = prefs();
  savePrefs(p);
  let res: Response;
  try {
    res = await request('/functions/v1/breakbeat-submit', { method: 'POST', body: JSON.stringify({ day, player: p.player, name: p.name || 'Player', replay }) });
  } catch {
    keepPending(day, replay);
    throw new Error('offline');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<BoardResult> & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `status ${res.status}`);
  clearPending(day);
  return body as BoardResult;
}

export async function top(day: string, limit = 5): Promise<BoardRow[]> {
  const res = await request(`/rest/v1/breakbeat_daily?select=name,score,bars&day=eq.${day}&order=score.desc&limit=${limit}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  return ((await res.json()) as BoardRow[]).map(r => ({ ...r, name: cleanName(r.name, 'Player').slice(0, 16) }));
}

function keepPending(day: string, replay: Replay): void {
  const cur = readJson<{ day: string; replay: Replay } | null>(PENDING, null);
  if (!cur || cur.day !== day || cur.replay.end.score < replay.end.score) writeJson(PENDING, { day, replay });
}

function clearPending(day: string): void {
  const cur = readJson<{ day: string } | null>(PENDING, null);
  if (cur?.day === day) writeJson(PENDING, null);
}

/** Retries a kept submission for `today` (older days have closed); drops stale ones. */
export async function flush(today: string): Promise<BoardResult | null> {
  const cur = readJson<{ day: string; replay: Replay } | null>(PENDING, null);
  if (!cur) return null;
  if (cur.day !== today || !prefs().on) {
    writeJson(PENDING, null);
    return null;
  }
  try {
    return await submit(cur.day, cur.replay);
  } catch {
    return null;
  }
}
