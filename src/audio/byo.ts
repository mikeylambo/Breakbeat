/**
 * byo — Upload Your Own Beat, browser side. Everything happens on the device: nothing is uploaded.
 * - analyse: decode, downmix, then beatDetect (tempo, downbeat, key, sections) in yielded stages
 * - buildStems: the three 8-bar sections are cut on the bar grid and laid back to back, each with
 *   its loop point crossfaded into the audio just before it so it loops seamlessly; then five
 *   pseudo-stems are rendered with Linkwitz–Riley crossovers (kick < 110 Hz < bass < 320 Hz < keys
 *   < 2.2 kHz < lead < 6.5 kHz < top), so chain rank opens the song up from the low end
 * - trackFor: a TrackDef the game plays like any movement (world and tuning borrowed from the
 *   movement nearest in tempo)
 */

import { barEnergies, beatGrid, chroma, detectKey, onsets, pickSections, SECTION_BARS } from './beatDetect.js';
import type { StemSet } from './StemPlayer.js';
import { cleanName } from '../meta/text.js';
import { MOVEMENTS, STEM_NAMES, type StemName, type TrackDef } from './tracks.js';

export { cleanName };

export interface BeatMeta {
  id: string;
  name: string;
  addedAt: number;
  durationSec: number;
  bpm: number;
  rawBpm: number;
  downbeatSec: number;
  key: string;
  minor: boolean;
  confidence: number;
  /** Bar indices (from the downbeat) of A, B and C */
  sections: [number, number, number];
  /** Bars available from the downbeat (for the section nudges) */
  bars: number;
}

export type Stage = 'decode' | 'tempo' | 'key' | 'sections' | 'stems';

const yieldTask = (): Promise<void> => new Promise(r => setTimeout(r, 0));

/** Content id: SHA-256 of the file (FNV-1a when SubtleCrypto is unavailable). */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(d).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    const v = new Uint8Array(bytes);
    let h = 0x811c9dc5;
    for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v[i]!, 0x01000193);
    return `f${(h >>> 0).toString(16)}${v.length.toString(16)}`;
  }
}

export function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return ctx.decodeAudioData(bytes.slice(0));
}

export function mono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] = out[i]! + d[i]! / buf.numberOfChannels;
  }
  return out;
}

/** "02 - Some Song (Extended).mp3" -> "Some Song (Extended)" */
export function songName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ');
  return cleanName(base.replace(/^\s*\d{1,3}\s*[-.)]\s*/, ''));
}

/** Full analysis of a decoded song. Throws with a player-facing message when it cannot be used. */
export async function analyse(buf: AudioBuffer, id: string, name: string, onStage?: (s: Stage) => void): Promise<BeatMeta> {
  const pcm = mono(buf);
  onStage?.('tempo');
  await yieldTask();
  const o = onsets(pcm, buf.sampleRate);
  await yieldTask();
  const g = beatGrid(o);
  onStage?.('key');
  await yieldTask();
  const k = detectKey(chroma(pcm, buf.sampleRate));
  onStage?.('sections');
  await yieldTask();
  const energy = barEnergies(o, g.bpm, g.downbeatSec);
  const s = pickSections(energy);
  if (!s) throw new Error('That song is too short: it needs at least 8 bars of music.');
  return {
    id,
    name,
    addedAt: Date.now(),
    durationSec: buf.duration,
    bpm: Math.round(g.bpm * 100) / 100,
    rawBpm: Math.round(g.rawBpm * 100) / 100,
    downbeatSec: g.downbeatSec,
    key: k.name,
    minor: k.minor,
    confidence: g.confidence,
    sections: s.starts,
    bars: energy.length
  };
}

/** Sample index of bar `bar` from the downbeat. */
function barSample(meta: BeatMeta, bar: number, sr: number): number {
  return Math.round((meta.downbeatSec + (bar * 240) / meta.bpm) * sr);
}

/**
 * The three sections back to back (A, B, C), loudness matched, each loop point crossfaded
 * (equal power, 24 ms) into the audio just before the section so the loop has no seam.
 */
export function assembleSections(buf: AudioBuffer, meta: BeatMeta): AudioBuffer {
  const sr = buf.sampleRate;
  const L = Math.round(((SECTION_BARS * 240) / meta.bpm) * sr);
  const X = Math.min(Math.round(0.024 * sr), L >> 2);
  const ch = Math.min(2, buf.numberOfChannels);
  const out = new AudioBuffer({ numberOfChannels: ch, length: L * 3, sampleRate: sr });
  let peak = 0;
  let sq = 0;
  for (let c = 0; c < ch; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let k = 0; k < 3; k++) {
      const s0 = barSample(meta, meta.sections[k]!, sr);
      const o = k * L;
      for (let n = 0; n < L; n++) dst[o + n] = src[s0 + n] ?? 0;
      for (let m = 0; m < X; m++) {
        const g = m / X;
        const pre = src[s0 - X + m] ?? 0;
        const i = o + L - X + m;
        dst[i] = dst[i]! * Math.cos((g * Math.PI) / 2) + pre * Math.sin((g * Math.PI) / 2);
      }
    }
    for (let i = 0; i < dst.length; i++) {
      const v = Math.abs(dst[i]!);
      if (v > peak) peak = v;
      sq += v * v;
    }
  }
  // Mastered songs run hot: bring the RMS near the movements' level without clipping
  const rmsV = Math.sqrt(sq / (out.length * ch)) || 1;
  const gain = Math.min(0.17 / rmsV, 0.95 / (peak || 1));
  for (let c = 0; c < ch; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = d[i]! * gain;
  }
  return out;
}

const BANDS: Record<StemName, [number, number]> = {
  kick: [0, 110],
  bass: [110, 320],
  keys: [320, 2200],
  lead: [2200, 6500],
  top: [6500, 0]
};

/** Renders one crossover band (two cascaded Butterworth biquads per edge = Linkwitz–Riley 4th order). */
async function band(src: AudioBuffer, lo: number, hi: number, channels: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, src.length, src.sampleRate);
  const node = new AudioBufferSourceNode(ctx, { buffer: src });
  let tail: AudioNode = node;
  const stage = (type: BiquadFilterType, f: number): void => {
    for (let i = 0; i < 2; i++) {
      const b = new BiquadFilterNode(ctx, { type, frequency: f, Q: Math.SQRT1_2 });
      tail.connect(b);
      tail = b;
    }
  };
  if (lo > 0) stage('highpass', lo);
  if (hi > 0) stage('lowpass', hi);
  tail.connect(ctx.destination);
  node.start(0);
  return ctx.startRendering();
}

/** Five pseudo-stems from the assembled sections; the two lowest bands are mono. */
export async function buildStems(buf: AudioBuffer, meta: BeatMeta, onStage?: (s: Stage) => void): Promise<StemSet> {
  onStage?.('stems');
  await yieldTask();
  const sections = assembleSections(buf, meta);
  const rendered = await Promise.all(STEM_NAMES.map(n => band(sections, BANDS[n][0], BANDS[n][1], n === 'kick' || n === 'bass' ? 1 : sections.numberOfChannels)));
  const set = {} as StemSet;
  STEM_NAMES.forEach((n, i) => (set[n] = rendered[i]!));
  return set;
}

/** A playable TrackDef: the song's tempo, key and sections; world and tuning from the nearest movement. */
export function trackFor(meta: BeatMeta): TrackDef {
  const near = (pool: readonly TrackDef[]): TrackDef => pool.reduce((a, b) => (Math.abs(b.bpm - meta.bpm) < Math.abs(a.bpm - meta.bpm) ? b : a));
  const look = near(MOVEMENTS);
  const tune = near(MOVEMENTS.filter(m => m.act === 'I'));
  return {
    ...tune,
    id: `beat-${meta.id}`,
    number: 'MY',
    name: cleanName(meta.name),
    act: 'Mine',
    style: look.style,
    tint: look.tint,
    sections: [
      { name: 'A', bars: SECTION_BARS },
      { name: 'B', bars: SECTION_BARS },
      { name: 'C', bars: SECTION_BARS }
    ],
    bpm: meta.bpm,
    key: meta.key,
    offsetMs: 0,
    sleeve: undefined,
    stemsReady: false,
    flatMix: true
  };
}
