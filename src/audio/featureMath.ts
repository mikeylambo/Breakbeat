/**
 * featureMath — the pure signal math behind AudioFeatures: RMS, envelope followers, adaptive peak
 * normalisation, onset detection and log-spaced spectrum bands. No Web Audio here, so it is unit
 * tested in Node against synthetic signals.
 */

/** Root mean square of a time-domain block. */
export function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return buf.length ? Math.sqrt(s / buf.length) : 0;
}

/** One-pole follower: rises with time constant `attackSec`, falls with `releaseSec`. */
export function follow(cur: number, target: number, dt: number, attackSec: number, releaseSec: number): number {
  const tau = target > cur ? attackSec : releaseSec;
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/**
 * Per-stem tracker. `level` is the raw block RMS normalised against a slowly decaying peak, so a
 * quiet stem still fills 0..1. `env` is a smoothed envelope (fast attack, short release) and
 * `onset` is a pulse that jumps to 1 on a transient and decays.
 */
export class StemTracker {
  level = 0;
  env = 0;
  onset = 0;
  private peak = 0;
  private slow = 0;
  private sinceOnset = 1;

  /** Peak memory: how fast the normaliser forgets a loud passage. */
  static readonly PEAK_RELEASE_SEC = 6;
  /** Below this RMS a stem counts as silent and never normalises noise up to full scale. */
  static readonly FLOOR = 0.012;

  step(raw: number, dt: number): void {
    this.peak = Math.max(raw, this.peak * Math.exp(-dt / StemTracker.PEAK_RELEASE_SEC), StemTracker.FLOOR * 4);
    const norm = raw < StemTracker.FLOOR ? 0 : Math.min(1, raw / this.peak);
    this.level = norm;
    this.env = follow(this.env, norm, dt, 0.008, 0.11);
    // Transient: the level clears its slow average by a margin, at most every 90 ms
    this.sinceOnset += dt;
    const hit = norm > this.slow * 1.35 + 0.12 && this.sinceOnset > 0.09;
    this.slow = follow(this.slow, norm, dt, 0.25, 0.25);
    if (hit) {
      this.onset = Math.min(1, 0.4 + (norm - this.slow));
      this.sinceOnset = 0;
    } else {
      this.onset *= Math.exp(-dt / 0.12);
    }
  }

  reset(): void {
    this.level = this.env = this.onset = this.peak = this.slow = 0;
    this.sinceOnset = 1;
  }
}

/**
 * Bin ranges [start, end) for `count` log-spaced bands between `loHz` and `hiHz`, for an analyser
 * with `binCount` bins at `sampleRate`. Every band holds at least one bin.
 */
export function bandRanges(count: number, binCount: number, sampleRate: number, loHz = 40, hiHz = 16000): Int32Array {
  const out = new Int32Array(count * 2);
  const hzPerBin = sampleRate / 2 / binCount;
  let prevEnd = Math.max(0, Math.floor(loHz / hzPerBin));
  for (let b = 0; b < count; b++) {
    const hz = loHz * Math.pow(hiHz / loHz, (b + 1) / count);
    const end = Math.min(binCount, Math.max(prevEnd + 1, Math.round(hz / hzPerBin)));
    out[b * 2] = Math.min(prevEnd, binCount - 1);
    out[b * 2 + 1] = Math.max(end, Math.min(prevEnd, binCount - 1) + 1);
    prevEnd = end;
  }
  return out;
}

/** Averages byte magnitudes (0..255) into `out` (0..1) using `ranges` from bandRanges. */
export function bandsFrom(bytes: Uint8Array, ranges: Int32Array, out: Float32Array): void {
  for (let b = 0; b < out.length; b++) {
    const s = ranges[b * 2]!;
    const e = ranges[b * 2 + 1]!;
    let sum = 0;
    for (let i = s; i < e; i++) sum += bytes[i]!;
    out[b] = e > s ? sum / ((e - s) * 255) : 0;
  }
}
