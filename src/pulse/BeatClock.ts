/**
 * Pulse BeatClock — The conductor clock is the single source of truth (GDD Page 2-3).
 * - Sweep position is derived from the audio clock, never the other way round.
 * - Measures audio output latency once and offsets visuals to match sound.
 * - Pausing/hiding the tab pauses the track and the sweep together with zero catch-up freeze.
 */

import { TUNING } from '../tuning.js';

export interface BeatQuery {
  elapsedSec: number;
  visualElapsedSec: number;
  bar: number;
  beat: number;
  sixteenth: number;
  absoluteStep: number;
  barProgress: number;
  beatProgress: number;
  sweepColFloat: number;
}

export class BeatClock {
  bpm: number;
  outputLatencySec = 0;

  private running = false;
  private startAudioSec = 0;
  private pausedElapsedSec = 0;
  private lastRawSec = 0;

  constructor(bpm: number, outputLatencySec = 0) {
    this.bpm = bpm;
    this.outputLatencySec = outputLatencySec;
  }

  get beatDurationSec(): number {
    return 60 / this.bpm;
  }

  get sixteenthDurationSec(): number {
    return 60 / this.bpm / 4;
  }

  get barDurationSec(): number {
    return (60 / this.bpm) * TUNING.BEATS_PER_BAR * TUNING.SWEEP_BARS;
  }

  start(nowSec: number): void {
    this.startAudioSec = nowSec - this.pausedElapsedSec;
    this.lastRawSec = nowSec;
    this.running = true;
  }

  pause(nowSec: number): void {
    if (!this.running) return;
    this.pausedElapsedSec = Math.max(0, nowSec - this.startAudioSec);
    this.running = false;
  }

  resume(nowSec: number): void {
    if (this.running) return;
    this.startAudioSec = nowSec - this.pausedElapsedSec;
    this.lastRawSec = nowSec;
    this.running = true;
  }

  reset(nowSec = 0): void {
    this.startAudioSec = nowSec;
    this.pausedElapsedSec = 0;
    this.lastRawSec = nowSec;
  }

  setBpm(newBpm: number, nowSec: number): void {
    if (this.running) {
      this.pausedElapsedSec = Math.max(0, nowSec - this.startAudioSec);
      this.startAudioSec = nowSec - this.pausedElapsedSec;
    }
    this.bpm = newBpm;
  }

  /**
   * Queries exact bar/beat/16th and continuous sweep position at `nowSec`.
   * Automatically clamps sudden clock jumps (> 0.5s when backgrounded) so the main thread never freezes.
   */
  query(nowSec: number): BeatQuery {
    let elapsedSec: number;
    if (!this.running) {
      elapsedSec = this.pausedElapsedSec;
    } else {
      const delta = nowSec - this.lastRawSec;
      if (delta > 0.5) {
        // Tab was backgrounded or suspended; advance smoothly by 1 frame instead of jumping
        this.startAudioSec += delta - 0.016;
      }
      this.lastRawSec = nowSec;
      elapsedSec = Math.max(0, nowSec - this.startAudioSec);
      this.pausedElapsedSec = elapsedSec;
    }

    const visualElapsedSec = Math.max(0, elapsedSec - this.outputLatencySec);
    const stepSec = this.sixteenthDurationSec;
    const barSec = this.barDurationSec;
    const beatSec = this.beatDurationSec;

    const absoluteStep = Math.floor(elapsedSec / stepSec + 1e-9);
    const bar = Math.floor(absoluteStep / TUNING.SIXTEENTHS_PER_BAR) + 1;
    const sixteenth = absoluteStep % TUNING.SIXTEENTHS_PER_BAR;
    const beat = Math.floor(sixteenth / 4);

    const barProgress = (visualElapsedSec % barSec) / barSec;
    const beatProgress = (visualElapsedSec % beatSec) / beatSec;
    const sweepColFloat = barProgress * TUNING.BOARD_COLS;

    return {
      elapsedSec,
      visualElapsedSec,
      bar,
      beat,
      sixteenth,
      absoluteStep,
      barProgress,
      beatProgress,
      sweepColFloat
    };
  }

  /** Converts an absolute 16th step index into exact audio clock seconds. */
  stepToAudioSec(step: number): number {
    return this.startAudioSec + step * this.sixteenthDurationSec;
  }
}
