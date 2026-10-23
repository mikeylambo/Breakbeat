/**
 * AudioEngine — one AudioContext, its buses and master compressor, and visibility handling.
 * The AudioContext clock is the game's only clock (BeatClock reads `now`).
 *
 * Graph:  stems (2 decks x 5 gains) -> stemBus[5] -> musicBus -> musicFilter (danger LPF) -> master
 *         stemBus[i] -> stemAnalyser[i];  musicFilter -> mixAnalyser   (AudioFeatures taps)
 *         sfx one-shots -> sfxBus -> master;  master -> compressor -> out -> destination
 *                                                                        \-> record tap (share clips)
 * All long-lived nodes, including the only oscillator/filter outside placeholder/, are built in
 * setup. At runtime only AudioBufferSourceNode one-shots are created.
 */

import { TUNING } from '../tuning.js';
import { STEM_NAMES } from './tracks.js';

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly musicBus: GainNode;
  readonly musicFilter: BiquadFilterNode;
  readonly sfxBus: GainNode;
  readonly out: GainNode;
  /** [deck][stem] gain nodes. Two decks so movements can crossfade. */
  readonly stemGains: GainNode[][];
  /** One bus per stem, summing both decks, so a stem reads as one signal through a crossfade. */
  readonly stemBuses: GainNode[];
  /** Post-gain taps per stem and on the mix (after the danger low-pass). Read by AudioFeatures. */
  readonly stemAnalysers: AnalyserNode[];
  readonly mixAnalyser: AnalyserNode;
  outputLatencySec = 0;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private suspendedByApp = false;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    this.out = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.8;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.7;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.85;

    this.musicBus.connect(this.musicFilter).connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(compressor).connect(this.out).connect(ctx.destination);

    this.stemAnalysers = STEM_NAMES.map(() => {
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      return an;
    });
    this.stemBuses = STEM_NAMES.map((_, i) => {
      const bus = ctx.createGain();
      bus.connect(this.musicBus);
      bus.connect(this.stemAnalysers[i]!);
      return bus;
    });
    this.mixAnalyser = ctx.createAnalyser();
    this.mixAnalyser.fftSize = 2048;
    this.mixAnalyser.smoothingTimeConstant = 0.5;
    this.mixAnalyser.minDecibels = -90;
    this.mixAnalyser.maxDecibels = -18;
    this.musicFilter.connect(this.mixAnalyser);

    this.stemGains = [0, 1].map(() =>
      STEM_NAMES.map((_, i) => {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(this.stemBuses[i]!);
        return g;
      })
    );
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /** Call from a user gesture. Resolves once the context runs; measures output latency once. */
  async unlock(): Promise<void> {
    if (this.ctx.state !== 'running' && !this.suspendedByApp) {
      try {
        await this.ctx.resume();
      } catch {
        // stays suspended until the next gesture
      }
    }
    if (this.outputLatencySec === 0 && this.ctx.state === 'running') {
      const ctx = this.ctx as AudioContext & { outputLatency?: number };
      this.outputLatencySec = Math.min(0.25, Math.max(0, (ctx.outputLatency || 0) + (ctx.baseLatency || 0)));
    }
  }

  /** Visibility hidden / pause sheet: time stops for audio, clock and sim alike. */
  async suspend(): Promise<void> {
    this.suspendedByApp = true;
    try {
      await this.ctx.suspend();
    } catch {
      // ignore
    }
  }

  async resume(): Promise<void> {
    this.suspendedByApp = false;
    try {
      await this.ctx.resume();
    } catch {
      // ignore
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master * 0.9, t, 0.02);
    this.musicBus.gain.setTargetAtTime(music * 0.8, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(sfx * 0.85, t, 0.02);
  }

  /**
   * Stem mixer (Listen mode): per-stem bus levels in STEM_NAMES order, ramped over `rampSec`.
   * 1 everywhere is unity, which every other mode expects.
   */
  setStemMix(levels: readonly number[], rampSec = 0.03): void {
    const t = this.ctx.currentTime;
    this.stemBuses.forEach((b, i) => rampParam(b.gain, levels[i] ?? 1, t, t + rampSec));
  }

  /** Danger low-pass on the music bus, ramped over one beat ending at `endSec`. */
  setDanger(level: number, endSec: number, beatSec: number): void {
    const hz = level >= 2 ? TUNING.DANGER_LPF_HZ_2 : level === 1 ? TUNING.DANGER_LPF_HZ : 20000;
    rampParam(this.musicFilter.frequency, hz, endSec - beatSec, endSec, true);
  }

  /** A MediaStream of the full mix, for share-pass recording. */
  recordStream(): MediaStream | null {
    if (typeof this.ctx.createMediaStreamDestination !== 'function') return null;
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.out.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }
}

/** Ramp `param` to `target` between `startSec` and `endSec` (exponential for frequencies). */
export function rampParam(param: AudioParam, target: number, startSec: number, endSec: number, exponential = false): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  const start = Math.max(0, startSec);
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(start);
  } else {
    param.cancelScheduledValues(start);
    param.setValueAtTime(param.value, start);
  }
  if (exponential) param.exponentialRampToValueAtTime(Math.max(1, target), Math.max(start + 0.001, endSec));
  else param.linearRampToValueAtTime(target, Math.max(start + 0.001, endSec));
}
