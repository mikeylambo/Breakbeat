/**
 * Pulse BeatClock — the audio clock is the only clock.
 * - Time comes from AudioContext.currentTime (passed in as `nowSec`); visuals subtract the
 *   output latency measured once at start, so what you see lines up with what you hear.
 * - Backgrounding suspends the AudioContext (time stops) and pauses the clock; there is no
 *   catch-up shift, so visuals can never desync from audio.
 * - `query()` is a pure read: no mutation of clock state. Call it once per frame and hand the
 *   result to the engine, renderer and HUD.
 */

import { TUNING } from '../tuning.js';

export interface BeatQuery {
  elapsedSec: number;
  visualElapsedSec: number;
  bar: number;
  beat: number;
  sixteenth: number;
  absoluteStep: number;
  /** Step index of the visual clock (what is on screen now). */
  visualStep: number;
  barProgress: number;
  beatProgress: number;
  /** Continuous blade position in columns [0, BOARD_COLS). Column c is covered during sixteenth c. */
  sweepColFloat: number;
}

export function createBeatQuery(): BeatQuery {
  return {
    elapsedSec: 0,
    visualElapsedSec: 0,
    bar: 1,
    beat: 0,
    sixteenth: 0,
    absoluteStep: 0,
    visualStep: 0,
    barProgress: 0,
    beatProgress: 0,
    sweepColFloat: 0
  };
}

export class BeatClock {
  bpm: number;
  outputLatencySec = 0;

  private running = false;
  /** Audio-clock time of step 0. Rebased on tempo morphs so step numbering stays continuous. */
  private originSec = 0;
  private pausedElapsedSec = 0;

  constructor(bpm: number, outputLatencySec = 0) {
    this.bpm = bpm;
    this.outputLatencySec = outputLatencySec;
  }

  get isRunning(): boolean {
    return this.running;
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

  /** Starts (or restarts) the transport so that step 0 lands exactly on `atSec`. */
  start(atSec: number): void {
    this.originSec = atSec;
    this.pausedElapsedSec = 0;
    this.running = true;
  }

  pause(nowSec: number): void {
    if (!this.running) return;
    this.pausedElapsedSec = Math.max(0, nowSec - this.originSec);
    this.running = false;
  }

  resume(nowSec: number): void {
    if (this.running) return;
    this.originSec = nowSec - this.pausedElapsedSec;
    this.running = true;
  }

  /**
   * Tempo morph at an exact step boundary: step numbering continues, and from `atStep` on
   * each 16th lasts 60/newBpm/4 s. `atStep` should be a downbeat (movement transitions).
   */
  setBpmAtStep(newBpm: number, atStep: number): void {
    const atSec = this.stepToAudioSec(atStep);
    this.bpm = newBpm;
    this.originSec = atSec - atStep * this.sixteenthDurationSec;
  }

  /** Pure read of bar/beat/16th and the blade position at audio time `nowSec`. Writes into `out`. */
  query(nowSec: number, out: BeatQuery = createBeatQuery()): BeatQuery {
    const elapsedSec = this.running ? Math.max(0, nowSec - this.originSec) : this.pausedElapsedSec;
    const visualElapsedSec = Math.max(0, elapsedSec - this.outputLatencySec);
    const stepSec = this.sixteenthDurationSec;
    const barSec = this.barDurationSec;
    const beatSec = this.beatDurationSec;

    const absoluteStep = Math.floor(elapsedSec / stepSec + 1e-9);
    const sixteenth = absoluteStep % TUNING.SIXTEENTHS_PER_BAR;
    const barProgress = (visualElapsedSec % barSec) / barSec;

    out.elapsedSec = elapsedSec;
    out.visualElapsedSec = visualElapsedSec;
    out.absoluteStep = absoluteStep;
    out.visualStep = Math.floor(visualElapsedSec / stepSec + 1e-9);
    out.bar = Math.floor(absoluteStep / TUNING.SIXTEENTHS_PER_BAR) + 1;
    out.sixteenth = sixteenth;
    out.beat = Math.floor(sixteenth / 4);
    out.barProgress = barProgress;
    out.beatProgress = (visualElapsedSec % beatSec) / beatSec;
    out.sweepColFloat = barProgress * TUNING.BOARD_COLS;
    return out;
  }

  /** Converts an absolute 16th step index into exact audio clock seconds. */
  stepToAudioSec(step: number): number {
    return this.originSec + step * this.sixteenthDurationSec;
  }

  /** Audio time of the first step boundary strictly after `nowSec`. */
  nextStepAudioSec(nowSec: number): { step: number; sec: number } {
    const elapsed = Math.max(0, nowSec - this.originSec);
    const step = Math.floor(elapsed / this.sixteenthDurationSec + 1e-9) + 1;
    return { step, sec: this.stepToAudioSec(step) };
  }
}
