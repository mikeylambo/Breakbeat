/**
 * beatDetect — offline analysis of a player's song, pure math on mono PCM (Node-testable):
 *  onsets    two-band log-energy flux (lows for kicks, the rest for snares, hats and chords)
 *  tempo     onset autocorrelation for a candidate, then a fine comb search over the whole song,
 *            so drift over minutes pins the BPM to a few hundredths
 *  grid      fold the tempo into the game's range (one column per 16th), pick the game-beat phase
 *            and the downbeat (the beat in four where the lows hit hardest)
 *  key       Goertzel chroma over the song against major / minor key profiles
 *  sections  three 8-bar windows (A quiet, B middle, C peak) on phrase boundaries
 */

export const HOP = 512;
export const SECTION_BARS = 8;
export const BPM_MIN = 88;
export const BPM_MAX = 150;
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export interface Onsets {
  /** Frames per second */
  fps: number;
  /** Combined onset strength per frame (mean-removed, half-wave rectified) */
  all: Float32Array;
  /** Low-band (kick) onset strength per frame */
  low: Float32Array;
  /** Full-band RMS per frame (for bar energies) */
  rms: Float32Array;
}

export interface BeatGrid {
  /** Game BPM (folded into range) */
  bpm: number;
  /** The song's own tempo before folding */
  rawBpm: number;
  /** First downbeat at or after 0 s */
  downbeatSec: number;
  /** 0..1: how much stronger the chosen tempo is than its neighbours */
  confidence: number;
}

export interface Sections {
  /** Bar index (from the first downbeat) where A, B and C start */
  starts: [number, number, number];
  bars: number;
}

/** Onset envelopes at HOP resolution. */
export function onsets(pcm: Float32Array, sampleRate: number): Onsets {
  const frames = Math.max(1, Math.floor(pcm.length / HOP));
  const fps = sampleRate / HOP;
  const lowE = new Float32Array(frames);
  const highE = new Float32Array(frames);
  const rms = new Float32Array(frames);
  // One-pole low-pass at ~150 Hz splits the lows from the rest
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let le = 0;
    let he = 0;
    let te = 0;
    const base = f * HOP;
    for (let i = 0; i < HOP; i++) {
      const x = pcm[base + i]!;
      lp += a * (x - lp);
      const h = x - lp;
      le += lp * lp;
      he += h * h;
      te += x * x;
    }
    lowE[f] = Math.log1p(1000 * le / HOP);
    highE[f] = Math.log1p(1000 * he / HOP);
    rms[f] = Math.sqrt(te / HOP);
  }
  const low = flux(lowE, fps);
  const high = flux(highE, fps);
  const all = new Float32Array(frames);
  const ml = mean(low) || 1;
  const mh = mean(high) || 1;
  for (let f = 0; f < frames; f++) all[f] = low[f]! / ml + high[f]! / mh;
  return { fps, all, low, rms };
}

/** Rectified first difference, minus a local mean (~0.4 s), rectified again. */
function flux(e: Float32Array, fps: number): Float32Array {
  const n = e.length;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = Math.max(0, e[i]! - e[i - 1]!);
  const w = Math.max(1, Math.round(fps * 0.2));
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < Math.min(n, w); i++) sum += d[i]!;
  for (let i = 0; i < n; i++) {
    if (i + w < n) sum += d[i + w]!;
    if (i - w - 1 >= 0) sum -= d[i - w - 1]!;
    const cnt = Math.min(n - 1, i + w) - Math.max(0, i - w) + 1;
    out[i] = Math.max(0, d[i]! - sum / cnt);
  }
  return out;
}

function mean(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return a.length ? s / a.length : 0;
}

/** Linear-interpolated read. */
function at(a: Float32Array, x: number): number {
  if (x < 0) return 0;
  const i = Math.floor(x);
  if (i + 1 >= a.length) return i < a.length ? a[i]! : 0;
  const t = x - i;
  return a[i]! * (1 - t) + a[i + 1]! * t;
}

/** Sum of `env` along a grid with `period` frames starting at `phase`. */
function comb(env: Float32Array, period: number, phase: number): number {
  let s = 0;
  for (let x = phase; x < env.length; x += period) s += at(env, x);
  return s;
}

/** Song tempo: autocorrelation candidate (60–200 BPM), then a whole-song comb refine. */
export function estimateTempo(o: Onsets): { bpm: number; phaseFrames: number; confidence: number } {
  const env = o.all;
  const n = env.length;
  const fps = o.fps;
  const minLag = Math.floor((60 * fps) / 200);
  const maxLag = Math.min(n - 1, Math.ceil((60 * fps) / 60));
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i]! * env[i + lag]!;
    ac[lag] = s / (n - lag);
  }
  // Score with half-lag support and a broad prior around 120 BPM
  let best = minLag;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.1) ** 2);
    const half = lag * 2 <= maxLag ? ac[lag * 2]! : 0;
    const score = (ac[lag]! + 0.5 * half) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic peak
  const y0 = ac[best - 1] ?? 0;
  const y1 = ac[best]!;
  const y2 = ac[best + 1] ?? 0;
  const den = y0 - 2 * y1 + y2;
  const lag = best + (den !== 0 ? (0.5 * (y0 - y2)) / den : 0);
  let bpm = (60 * fps) / lag;

  // Comb refine: ±3% in 0.02 BPM steps, best phase each
  let top = -1;
  let second = -1;
  let phaseBest = 0;
  const lo = bpm * 0.97;
  const hi = bpm * 1.03;
  for (let b = lo; b <= hi; b += 0.02) {
    const period = (60 * fps) / b;
    let bs = -1;
    let bp = 0;
    for (let ph = 0; ph < period; ph += 0.5) {
      const s = comb(env, period, ph);
      if (s > bs) {
        bs = s;
        bp = ph;
      }
    }
    if (bs > top) {
      second = Math.max(second, top);
      top = bs;
      bpm = b;
      phaseBest = bp;
    } else if (bs > second && Math.abs(b - bpm) > 0.5) second = bs;
  }
  const confidence = top > 0 ? Math.max(0, Math.min(1, 1 - second / top)) : 0;
  return { bpm, phaseFrames: phaseBest, confidence };
}

/** Folds a tempo into the game range by octaves; below range it stays slow rather than overshoot. */
export function foldBpm(bpm: number): number {
  let b = bpm;
  while (b > BPM_MAX) b /= 2;
  while (b < BPM_MIN && b * 2 <= BPM_MAX) b *= 2;
  return b;
}

/** Full analysis: tempo, folded game grid and the first downbeat. */
export function beatGrid(o: Onsets): BeatGrid {
  const t = estimateTempo(o);
  const bpm = foldBpm(t.bpm);
  const fps = o.fps;
  const songPeriod = (60 * fps) / t.bpm;
  const period = (60 * fps) / bpm;
  // Game-beat phase: when slowing by 2^k, try each song beat inside one game beat
  const ratio = Math.max(1, Math.round(period / songPeriod));
  let phase = t.phaseFrames % period;
  let bestS = -1;
  for (let k = 0; k < ratio; k++) {
    const ph = (t.phaseFrames + k * songPeriod) % period;
    const s = comb(o.low, period, ph) + 0.25 * comb(o.all, period, ph);
    if (s > bestS) {
      bestS = s;
      phase = ph;
    }
  }
  // Downbeat: the beat in four with the strongest lows (kick and bass land on the one)
  const bar = period * 4;
  let down = phase;
  let bestD = -1;
  for (let j = 0; j < 4; j++) {
    const ph = (phase + j * period) % bar;
    const s = comb(o.low, bar, ph) + 0.15 * comb(o.all, bar, ph);
    if (s > bestD) {
      bestD = s;
      down = ph;
    }
  }
  return { bpm, rawBpm: t.bpm, downbeatSec: down / fps, confidence: t.confidence };
}

/** Mean RMS per bar from `downbeatSec`. */
export function barEnergies(o: Onsets, bpm: number, downbeatSec: number): Float32Array {
  const barFrames = ((60 * o.fps) / bpm) * 4;
  const start = downbeatSec * o.fps;
  const count = Math.max(0, Math.floor((o.rms.length - start) / barFrames));
  const out = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    const s = Math.floor(start + b * barFrames);
    const e = Math.floor(start + (b + 1) * barFrames);
    let sum = 0;
    for (let f = s; f < e; f++) sum += o.rms[f]!;
    out[b] = sum / Math.max(1, e - s);
  }
  return out;
}

/**
 * A, B, C: 8-bar windows on 4-bar phrase starts. C is the loudest window; A the quietest that
 * still carries the groove (at least 40% of C, so a silent intro is skipped; earlier wins near
 * ties); B the one nearest halfway between them. Windows avoid
 * overlapping when the song is long enough. Returns null under 8 bars.
 */
export function pickSections(energy: Float32Array): Sections | null {
  const n = energy.length;
  if (n < SECTION_BARS) return null;
  const starts: number[] = [];
  for (let s = 0; s + SECTION_BARS <= n; s += 4) starts.push(s);
  const win = (s: number): number => {
    let sum = 0;
    for (let b = s; b < s + SECTION_BARS; b++) sum += energy[b]!;
    return sum / SECTION_BARS;
  };
  const e = starts.map(win);
  const free = (s: number, used: number[]): boolean => used.every(u => Math.abs(u - s) >= SECTION_BARS);
  let c = starts[0]!;
  let ce = -1;
  starts.forEach((s, i) => {
    if (e[i]! > ce) {
      ce = e[i]!;
      c = s;
    }
  });
  let floor = Infinity;
  starts.forEach((s, i) => {
    if (e[i]! >= ce * 0.4 && free(s, [c])) floor = Math.min(floor, e[i]!);
  });
  if (!Number.isFinite(floor)) floor = ce * 0.4;
  const pick = (target: number, used: number[]): number => {
    let best = -1;
    let bd = Infinity;
    for (const strict of [true, false]) {
      starts.forEach((s, i) => {
        if (strict && !free(s, used)) return;
        if (!strict && used.includes(s) && starts.length > used.length) return;
        const d = Math.abs(e[i]! - target);
        if (d < bd - 1e-9) {
          bd = d;
          best = s;
        }
      });
      if (best >= 0) return best;
    }
    return used[0]!;
  };
  const aStart = pick(floor * 1.02, [c]);
  const ae = win(aStart);
  const bStart = pick((ae + ce) / 2, [c, aStart]);
  return { starts: [aStart, bStart, c], bars: SECTION_BARS };
}

// ---------------------------------------------------------------- key

/** Krumhansl–Kessler key profiles. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Pitch-class energy (C = 0) from Goertzel filters on MIDI 36..83 over ~40 windows. */
export function chroma(pcm: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(12);
  const N = Math.min(8192, pcm.length);
  if (N < 1024) return out;
  const windows = Math.min(40, Math.max(1, Math.floor(pcm.length / N)));
  const stride = Math.floor((pcm.length - N) / Math.max(1, windows - 1));
  const coeff: number[] = [];
  for (let m = 36; m <= 83; m++) coeff.push(2 * Math.cos((2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12)) / sampleRate));
  // Hann window keeps neighbouring semitones from leaking in
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  for (let w = 0; w < windows; w++) {
    const off = w * stride;
    for (let k = 0; k < coeff.length; k++) {
      const c = coeff[k]!;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < N; i++) {
        const x = pcm[off + i]! * hann[i]!;
        const s0 = x + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const p = s1 * s1 + s2 * s2 - c * s1 * s2;
      out[(k + 36) % 12] = out[(k + 36) % 12]! + Math.log1p(Math.max(0, p));
    }
  }
  return out;
}

/** Best of the 24 keys by profile correlation. */
export function detectKey(ch: Float32Array): { tonic: number; minor: boolean; name: string } {
  let best = { tonic: 0, minor: false, r: -Infinity };
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const prof = minor ? MINOR : MAJOR;
      const r = corr(ch, i => prof[(i - t + 12) % 12]!);
      if (r > best.r) best = { tonic: t, minor, r };
    }
  }
  return { tonic: best.tonic, minor: best.minor, name: KEY_NAMES[best.tonic]! };
}

function corr(a: Float32Array, b: (i: number) => number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i]!;
    mb += b(i);
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i]! - ma;
    const y = b(i) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Tap tempo: BPM from tap times (seconds), using the median interval of the last 8 taps. */
export function tapTempo(taps: readonly number[]): number | null {
  const t = taps.slice(-9);
  if (t.length < 4) return null;
  const d: number[] = [];
  for (let i = 1; i < t.length; i++) d.push(t[i]! - t[i - 1]!);
  d.sort((x, y) => x - y);
  const med = d[Math.floor(d.length / 2)]!;
  return med > 0.2 && med < 2 ? 60 / med : null;
}
