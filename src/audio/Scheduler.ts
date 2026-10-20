/**
 * Scheduler — a setInterval clock (never the frame loop) with lookahead. Each tick it asks
 * the predictor for sounds due on the 16th grid within the lookahead window, so detonations play
 * exactly on their step; anything the predictor could not foresee is played on the next 16th.
 */

import { TUNING } from '../tuning.js';
import type { SfxPlayer } from './SfxPlayer.js';

export interface ScheduledSfx {
  name: string;
  atSec: number;
  gain: number;
  pitched: boolean;
  /** Group id (detonations) so a late hold can cancel a predicted sound; -1 = none. */
  tag: number;
}

/** Called each tick with the audio-time window [fromSec, toSec). Push due sounds via `queue`. */
export type Predictor = (fromSec: number, toSec: number) => void;

const POOL = 64;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private predictor: Predictor | null = null;
  private horizonSec = 0;
  private readonly pending: ScheduledSfx[] = [];
  private pendingCount = 0;
  /** tag -> voice index for dispatched, cancellable sounds */
  private readonly tagged = new Map<number, number>();

  constructor(
    private readonly sfx: SfxPlayer,
    private readonly now: () => number
  ) {
    for (let i = 0; i < POOL; i++) this.pending.push({ name: '', atSec: 0, gain: 1, pitched: false, tag: -1 });
  }

  setPredictor(p: Predictor | null): void {
    this.predictor = p;
  }

  start(): void {
    if (this.timer) return;
    this.horizonSec = this.now();
    this.timer = setInterval(() => this.tick(), TUNING.SCHED_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pendingCount = 0;
  }

  /** Predicted-window horizon: sounds before this time have already been considered. */
  get horizon(): number {
    return this.horizonSec;
  }

  queue(name: string, atSec: number, gain = 1, pitched = false, tag = -1): void {
    if (this.pendingCount >= POOL) return;
    const e = this.pending[this.pendingCount++]!;
    e.name = name;
    e.atSec = atSec;
    e.gain = gain;
    e.pitched = pitched;
    e.tag = tag;
    this.flush();
  }

  isTagged(tag: number): boolean {
    return this.tagged.has(tag);
  }

  cancelTag(tag: number): void {
    for (let i = 0; i < this.pendingCount; i++) {
      if (this.pending[i]!.tag === tag) this.removeAt(i--);
    }
    const voice = this.tagged.get(tag);
    if (voice !== undefined) this.sfx.cancel(voice);
    this.tagged.delete(tag);
  }

  /** Forget a tag once its event has really happened. */
  settleTag(tag: number): void {
    this.tagged.delete(tag);
  }

  tick(): void {
    const now = this.now();
    const to = now + TUNING.SCHED_LOOKAHEAD_MS / 1000;
    if (this.predictor && to > this.horizonSec) {
      this.predictor(Math.max(this.horizonSec, now), to);
      this.horizonSec = to;
    }
    this.flush();
  }

  /** Resets the prediction window (after pause, restart or a tempo morph). */
  resetHorizon(): void {
    this.horizonSec = this.now();
  }

  private flush(): void {
    const to = this.now() + TUNING.SCHED_LOOKAHEAD_MS / 1000;
    for (let i = 0; i < this.pendingCount; i++) {
      const e = this.pending[i]!;
      if (e.atSec < to) {
        const voice = this.sfx.play(e.name, e.atSec, e.gain, e.pitched);
        if (e.tag >= 0 && voice >= 0) this.tagged.set(e.tag, voice);
        this.removeAt(i--);
      }
    }
  }

  private removeAt(i: number): void {
    const last = --this.pendingCount;
    if (i !== last) {
      const tmp = this.pending[i]!;
      this.pending[i] = this.pending[last]!;
      this.pending[last] = tmp;
    }
  }
}
