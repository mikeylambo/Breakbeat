/**
 * Placeholder synth: renders stems and one-shots once into AudioBuffers via OfflineAudioContext,
 * so the game sounds complete before real stems land. Oscillators and filters live only here and
 * in AudioEngine setup (AUDIO_SCHED gate).
 */

import type { StemName, TrackDef } from '../tracks.js';
import { keySemitone } from '../tracks.js';

const SR = 44100;

type Ctx = OfflineAudioContext;

function noiseBuffer(ctx: Ctx, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2f6b1a3d;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function env(g: AudioParam, t: number, a: number, peak: number, d: number, sustain = 0.0001): void {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + a);
  g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
}

function tone(ctx: Ctx, out: AudioNode, type: OscillatorType, hz: number, t: number, dur: number, peak: number, cutoff = 0, attack = 0.005): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  const g = ctx.createGain();
  env(g.gain, t, attack, peak, dur);
  if (cutoff > 0) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.Q.value = 0.8;
    o.connect(f).connect(g);
  } else {
    o.connect(g);
  }
  g.connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function kick(ctx: Ctx, out: AudioNode, t: number, peak = 0.95): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = ctx.createGain();
  env(g.gain, t, 0.002, peak, 0.32);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
}

function hat(ctx: Ctx, out: AudioNode, noise: AudioBuffer, t: number, peak: number, dur: number, hp = 7000): void {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  env(g.gain, t, 0.001, peak, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, (t * 7.31) % 1);
  s.stop(t + dur + 0.02);
}

function clap(ctx: Ctx, out: AudioNode, noise: AudioBuffer, t: number, peak: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1500;
  f.Q.value = 0.9;
  const g = ctx.createGain();
  env(g.gain, t, 0.002, peak, 0.18);
  s.connect(f).connect(g).connect(out);
  s.start(t, (t * 3.17) % 1);
  s.stop(t + 0.25);
}

/** Minor-ish progressions in scale degrees (semitones from the key root). */
const PROGRESSIONS: number[][][] = [
  [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]], // i VI III VII
  [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], // i iv VII III
  [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]] // I vi IV V (Overture, brighter)
];

const ARP: number[][] = [
  [0, 2, 1, 2, 0, 2, 1, 3],
  [0, 1, 2, 1, 2, 0, 2, 1],
  [2, 1, 0, 1, 2, 3, 2, 1]
];

/** Deterministic per-track variation from the id. */
function trackSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function renderStem(track: TrackDef, stem: StemName): Promise<AudioBuffer> {
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const length = Math.ceil(track.loopBars * bar * SR);
  const ctx = new OfflineAudioContext(1, length, SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1.2);
  const seed = trackSeed(track.id);
  const root = 48 + keySemitone(track.key); // C3 + key
  const overture = track.id === 'overture';
  const prog = PROGRESSIONS[overture ? 2 : seed % 2]!;
  const arp = ARP[seed % 3]!;
  const s16 = beat / 4;
  const tail = 0.08; // keep notes inside the loop so the wrap is seamless

  for (let b = 0; b < track.loopBars; b++) {
    const t0 = b * bar;
    const chord = prog[b % prog.length]!;
    switch (stem) {
      case 'kick':
        for (let q = 0; q < 4; q++) kick(ctx, out, t0 + q * beat, overture ? 0.8 : 0.95);
        if (!overture && (seed >> 3) % 2 === 1 && b % 2 === 1) kick(ctx, out, t0 + 3.5 * beat, 0.55);
        break;
      case 'bass': {
        const pattern = (seed >> 5) % 2 === 0 ? [0, 0, 7, 0, 0, 12, 7, 0] : [0, 12, 0, 7, 0, 12, 10, 7];
        for (let e = 0; e < 8; e++) {
          if (overture && e % 2 === 1) continue;
          const m = root - 12 + chord[0]! + pattern[e]!;
          tone(ctx, out, 'sawtooth', midiHz(m), t0 + e * beat * 0.5, beat * 0.42, 0.34, 520);
        }
        break;
      }
      case 'keys':
        for (const hit of overture ? [0] : [0, 1.5, 2.5]) {
          for (const n of chord) tone(ctx, out, 'triangle', midiHz(root + 12 + n), t0 + hit * beat, overture ? bar - tail : beat * 0.8, 0.12, 2400, 0.01);
        }
        break;
      case 'lead':
        for (let i = 0; i < 16; i++) {
          if (overture ? i % 4 !== 0 : i % 2 === 1 && (seed >> (i % 7)) % 3 === 0) continue;
          const n = chord[arp[i % 8]! % 3]! + (arp[i % 8]! === 3 ? 12 : 0);
          tone(ctx, out, 'square', midiHz(root + 24 + n), t0 + i * s16, s16 * 0.9, 0.06, 3200);
        }
        break;
      case 'top':
        for (let i = 0; i < 16; i++) {
          hat(ctx, out, noise, t0 + i * s16, i % 4 === 2 ? 0.16 : 0.07, i % 4 === 2 ? 0.09 : 0.03);
        }
        if (!overture) {
          clap(ctx, out, noise, t0 + beat, 0.4);
          clap(ctx, out, noise, t0 + 3 * beat, 0.4);
        }
        break;
    }
  }
  return ctx.startRendering();
}

/** One-shots, rendered in C; prime tones are pitched to the track key with playbackRate. */
export async function renderSfx(name: string): Promise<AudioBuffer> {
  const dur = name === 'allclear' ? 2.2 : name === 'over' ? 1.1 : 0.7;
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const noise = noiseBuffer(ctx, 1.2);
  const C5 = 72;
  if (name.startsWith('prime-')) {
    // Per-colour pentatonic degrees: Amber root, Magenta 3rd, Azure 5th, Jade 7th-ish
    const deg = [0, 3, 7, 10][Number(name.slice(6))] ?? 0;
    tone(ctx, out, 'triangle', midiHz(C5 + deg), 0, 0.28, 0.5, 5000, 0.003);
    tone(ctx, out, 'sine', midiHz(C5 + deg + 12), 0, 0.18, 0.18, 0, 0.003);
  } else if (name === 'detonate') {
    kick(ctx, out, 0, 0.6);
    hat(ctx, out, noise, 0, 0.5, 0.22, 900);
    tone(ctx, out, 'square', midiHz(C5 - 12), 0, 0.14, 0.12, 2000);
  } else if (name === 'hold') {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midiHz(C5 - 12), 0);
    o.frequency.exponentialRampToValueAtTime(midiHz(C5 + 7), 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(600, 0);
    f.frequency.exponentialRampToValueAtTime(5000, 0.45);
    const g = ctx.createGain();
    env(g.gain, 0, 0.05, 0.22, 0.55);
    o.connect(f).connect(g).connect(out);
    o.start(0);
    o.stop(0.65);
  } else if (name === 'over') {
    kick(ctx, out, 0, 1);
    hat(ctx, out, noise, 0, 0.7, 0.6, 400);
    for (const n of [0, 7, 12]) tone(ctx, out, 'sawtooth', midiHz(C5 - 24 + n), 0, 0.8, 0.12, 1800);
  } else if (name === 'allclear') {
    for (const [i, n] of [0, 4, 7, 12, 16].entries()) tone(ctx, out, 'triangle', midiHz(C5 + n), i * 0.06, 1.6, 0.16, 6000, 0.01);
    hat(ctx, out, noise, 0, 0.3, 1.2, 6000);
  } else if (name === 'slide') {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(200, 0);
    f.frequency.exponentialRampToValueAtTime(1600, 0.16);
    const g = ctx.createGain();
    env(g.gain, 0, 0.04, 0.25, 0.2);
    s.connect(f).connect(g).connect(out);
    s.start(0);
    s.stop(0.3);
  }
  return ctx.startRendering();
}
