/**
 * Playtest — a local log of recent runs for playtest review: what was played, how it went, how
 * the device performed, and the full replay. Kept on this device (last 30 runs) and exported
 * only when the player taps Export in Profile. Nothing is sent anywhere.
 */

import type { Replay } from '../pulse/Replay.js';
import type { RunTelemetry } from '../pulse/PulseEngine.js';
import { readJson, writeJson } from '../platform/Storage.js';

const KEY = 'breakbeat-playtest';
const MAX_RUNS = 30;

export interface FrameStats {
  frames: number;
  /** Frames over 17 ms (a missed 60 Hz frame) and over 34 ms (a visible hitch) */
  over17: number;
  over34: number;
  maxMs: number;
}

export interface PlaytestRun {
  at: string;
  mode: string;
  track: string;
  score: number;
  bars: number;
  seconds: number;
  ended: 'topped-out' | 'quit';
  telemetry: RunTelemetry;
  frames: FrameStats;
  device: Record<string, string | number | boolean>;
  settings: Record<string, unknown>;
  replay: Replay | null;
}

export function newFrameStats(): FrameStats {
  return { frames: 0, over17: 0, over34: 0, maxMs: 0 };
}

export function addFrame(f: FrameStats, ms: number): void {
  f.frames++;
  if (ms > 17) f.over17++;
  if (ms > 34) f.over34++;
  if (ms > f.maxMs) f.maxMs = Math.round(ms * 10) / 10;
}

export function runs(): PlaytestRun[] {
  return readJson<PlaytestRun[]>(KEY, []);
}

export function record(r: PlaytestRun): void {
  const list = runs();
  list.push(r);
  // Keep the newest; if storage is full, drop replays from the oldest first
  let keep = list.slice(-MAX_RUNS);
  for (let i = 0; i < keep.length; i++) {
    if (writeJson(KEY, keep)) return;
    keep = keep.map((x, k) => (k <= i ? { ...x, replay: null } : x));
  }
}

export function clear(): void {
  writeJson(KEY, []);
}

/** Downloads the log as JSON. */
export function exportFile(extra: Record<string, unknown>): number {
  const list = runs();
  const blob = new Blob([JSON.stringify({ game: 'BREAKBEAT', exported: new Date().toISOString(), ...extra, runs: list }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `breakbeat-playtest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return list.length;
}
