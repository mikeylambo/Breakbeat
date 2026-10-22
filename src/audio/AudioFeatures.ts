/**
 * AudioFeatures — one shared frame of what the music is doing, read by every view.
 * - Per stem (kick, bass, keys, lead, top): normalised level, envelope and onset pulse, tapped
 *   post-gain, so a muted or not-yet-entered layer reads 0. What you see is what you hear.
 * - The mix: 16 log-spaced spectrum bands (40 Hz..16 kHz) after the danger low-pass, plus
 *   low / mid / high, overall energy and a 96-point waveform (-1..1) for scopes.
 * - Beat and bar phase from the BeatClock query, so views have one place to read the groove.
 * Analysers report what is being rendered now, which reaches the ears `outputLatency` later. Raw
 * readings go through a short ring and are read back delayed by that latency, the same rule the
 * BeatClock uses for visuals. `update` runs once per frame; nothing is allocated per frame.
 */

import type { BeatQuery } from '../pulse/BeatClock.js';
import type { AudioEngine } from './AudioEngine.js';
import { bandRanges, bandsFrom, follow, rms, StemTracker } from './featureMath.js';
import { STEM_NAMES, type StemName } from './tracks.js';

export const BAND_COUNT = 16;
export const WAVE_POINTS = 96;
const STEMS = STEM_NAMES.length;
const WAVE_AT = STEMS + BAND_COUNT;
const RAW = WAVE_AT + WAVE_POINTS;
const RING = 64;
const COST_FRAMES = 240;

export class AudioFeatures {
  /** Per stem, in STEM_NAMES order. 0..1. */
  readonly level = new Float32Array(STEMS);
  readonly env = new Float32Array(STEMS);
  readonly onset = new Float32Array(STEMS);
  /** Mix spectrum, low to high. 0..1, smoothed. */
  readonly bands = new Float32Array(BAND_COUNT);
  /** Mix waveform, one block decimated to WAVE_POINTS samples. -1..1. */
  readonly wave = new Float32Array(WAVE_POINTS);
  low = 0;
  mid = 0;
  high = 0;
  /** Overall loudness of the mix, 0..1. */
  energy = 0;
  beatPhase = 0;
  barPhase = 0;
  /**
   * True while a track is sounding. A rest or breakdown stays live (the visuals should go quiet with
   * the music); only two seconds of silence, like the menus with no music, falls back to the clock.
   */
  live = false;
  /** Main-thread cost of the last `COST_FRAMES` updates (ms), for the ANALYSER gate. */
  readonly costMs = new Float32Array(COST_FRAMES);
  private costIdx = 0;

  private readonly trackers = STEM_NAMES.map(() => new StemTracker());
  private readonly timeBuf: Float32Array<ArrayBuffer>;
  private readonly freqBuf: Uint8Array<ArrayBuffer>;
  private readonly mixTime: Float32Array<ArrayBuffer>;
  private readonly ranges: Int32Array;
  private readonly rawBands = new Float32Array(BAND_COUNT);
  private readonly ring = new Float32Array(RING * RAW);
  private readonly ringT = new Float64Array(RING).fill(-1);
  private ringHead = 0;
  private lastSec = -1;
  private quietSec = 0;

  constructor(private readonly audio: AudioEngine) {
    this.timeBuf = new Float32Array(audio.stemAnalysers[0]!.fftSize);
    this.freqBuf = new Uint8Array(audio.mixAnalyser.frequencyBinCount);
    this.mixTime = new Float32Array(audio.mixAnalyser.fftSize);
    this.ranges = bandRanges(BAND_COUNT, audio.mixAnalyser.frequencyBinCount, audio.ctx.sampleRate);
  }

  /** Index of `name` into the per-stem arrays. */
  static stem(name: StemName): number {
    return STEM_NAMES.indexOf(name);
  }

  get kick(): number {
    return this.env[0]!;
  }

  update(beat: BeatQuery | null): void {
    const t0 = performance.now();
    const a = this.audio;
    const now = a.now;
    const dt = this.lastSec < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, now - this.lastSec));
    this.lastSec = now;
    this.beatPhase = beat ? beat.beatProgress : 0;
    this.barPhase = beat ? beat.barProgress : 0;

    if (!a.running || dt === 0) {
      // Suspended: time stopped, so the frame holds (the pause sheet keeps its last look)
      this.record(t0);
      return;
    }

    // Capture this render quantum's raw readings into the ring
    const base = this.ringHead * RAW;
    for (let i = 0; i < STEMS; i++) {
      a.stemAnalysers[i]!.getFloatTimeDomainData(this.timeBuf);
      this.ring[base + i] = rms(this.timeBuf);
    }
    a.mixAnalyser.getByteFrequencyData(this.freqBuf);
    bandsFrom(this.freqBuf, this.ranges, this.rawBands);
    this.ring.set(this.rawBands, base + STEMS);
    // Waveform: start on a rising zero crossing so the scope stands still on steady tones
    a.mixAnalyser.getFloatTimeDomainData(this.mixTime);
    const span = this.mixTime.length >> 1;
    let z = 0;
    while (z < span && !(this.mixTime[z]! <= 0 && this.mixTime[z + 1]! > 0)) z++;
    if (z >= span) z = 0;
    const stride = span / WAVE_POINTS;
    for (let w = 0; w < WAVE_POINTS; w++) this.ring[base + WAVE_AT + w] = this.mixTime[z + Math.floor(w * stride)]!;
    this.ringT[this.ringHead] = now;
    this.ringHead = (this.ringHead + 1) % RING;

    // Read back the newest reading the listener has actually heard by now
    const heard = now - a.outputLatencySec;
    let pick = (this.ringHead + RING - 1) % RING;
    for (let k = 1; k <= RING; k++) {
      const j = (this.ringHead + RING - k) % RING;
      const tj = this.ringT[j]!;
      if (tj < 0) break;
      pick = j;
      if (tj <= heard) break;
    }
    const src = pick * RAW;

    let sum = 0;
    for (let i = 0; i < STEMS; i++) {
      const tr = this.trackers[i]!;
      tr.step(this.ring[src + i]!, dt);
      this.level[i] = tr.level;
      this.env[i] = tr.env;
      this.onset[i] = tr.onset;
      sum += this.ring[src + i]!;
    }
    let lo = 0;
    let mi = 0;
    let hi = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      const v = this.ring[src + STEMS + b]!;
      this.bands[b] = follow(this.bands[b]!, v, dt, 0.015, 0.16);
      if (b < 4) lo += this.bands[b]!;
      else if (b < 11) mi += this.bands[b]!;
      else hi += this.bands[b]!;
    }
    for (let w = 0; w < WAVE_POINTS; w++) this.wave[w] = this.ring[src + WAVE_AT + w]!;
    this.low = lo / 4;
    this.mid = mi / 7;
    this.high = hi / 5;
    this.energy = follow(this.energy, Math.min(1, sum * 2.2), dt, 0.02, 0.3);
    this.quietSec = sum < StemTracker.FLOOR ? this.quietSec + dt : 0;
    this.live = this.quietSec < 2;
    this.record(t0);
  }

  private record(t0: number): void {
    this.costMs[this.costIdx] = performance.now() - t0;
    this.costIdx = (this.costIdx + 1) % COST_FRAMES;
  }
}
