/**
 * Placeholder synth as pure PCM math (no Web Audio graph), so it can run in a Worker and never
 * touch the main thread. Same arrangement as before: kick, bass, keys, lead, top per movement,
 * plus one-shots. Mono Float32 at SR.
 */

export const SR = 44100;

export interface PcmTrack {
  id: string;
  bpm: number;
  key: string;
  loopBars: number;
}

const KEY_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

const PROGRESSIONS: number[][][] = [
  [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]],
  [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]],
  [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]]
];
const ARP: number[][] = [
  [0, 2, 1, 2, 0, 2, 1, 3],
  [0, 1, 2, 1, 2, 0, 2, 1],
  [2, 1, 0, 1, 2, 3, 2, 1]
];

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function trackSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Wave = 'sine' | 'saw' | 'tri' | 'square';

/** Envelope: linear attack to `peak`, then exponential decay to -80 dB over `decay` seconds. */
function envAt(t: number, attack: number, decay: number, peak: number): number {
  if (t < 0) return 0;
  if (t < attack) return (peak * t) / attack;
  const d = t - attack;
  if (d >= decay) return 0;
  return peak * Math.exp((Math.log(0.0001 / Math.max(0.0001, peak)) * d) / decay);
}

/** Adds a pitched note, with an optional one-pole low-pass, wrapping around the loop end. */
function note(out: Float32Array, wave: Wave, hz: number, t0: number, dur: number, peak: number, cutoff = 0, attack = 0.005): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor((attack + dur) * SR);
  const a = cutoff > 0 ? 1 - Math.exp((-2 * Math.PI * cutoff) / SR) : 1;
  let lp = 0;
  let phase = 0;
  const inc = hz / SR;
  for (let i = 0; i < len; i++) {
    phase += inc;
    if (phase >= 1) phase -= 1;
    let v: number;
    switch (wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'tri':
        v = 1 - 4 * Math.abs(phase - 0.5);
        break;
      default:
        v = phase < 0.5 ? 1 : -1;
    }
    lp += a * (v - lp);
    const idx = (start + i) % out.length;
    out[idx] = out[idx]! + lp * envAt(i / SR, attack, dur, peak);
  }
}

function kick(out: Float32Array, t0: number, peak: number): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor(0.36 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = t < 0.12 ? 150 * Math.pow(42 / 150, t / 0.12) : 42;
    phase += f / SR;
    const idx = (start + i) % out.length;
    out[idx] = out[idx]! + Math.sin(2 * Math.PI * phase) * envAt(t, 0.002, 0.32, peak);
  }
}

let noiseState = 0x2f6b1a3d;
function noise(): number {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 4294967296) * 2 - 1;
}

/** Filtered noise burst: 'hp' high-pass or 'bp' band-pass around `hz`. */
function burst(out: Float32Array, t0: number, peak: number, dur: number, mode: 'hp' | 'bp', hz: number): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor((dur + 0.002) * SR);
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < len; i++) {
    const n = noise();
    lp1 += a * (n - lp1);
    let v: number;
    if (mode === 'hp') v = n - lp1;
    else {
      lp2 += a * (lp1 - lp2);
      v = (lp1 - lp2) * 2.2;
    }
    const idx = (start + i) % out.length;
    out[idx] = out[idx]! + v * envAt(i / SR, 0.001, dur, peak);
  }
}

export type StemName = 'kick' | 'bass' | 'keys' | 'lead' | 'top';

export function renderStemPCM(track: PcmTrack, stem: StemName): Float32Array {
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const out = new Float32Array(Math.ceil(track.loopBars * bar * SR));
  const seed = trackSeed(track.id);
  const root = 48 + (KEY_SEMITONES[track.key] ?? 0);
  const overture = track.id === 'overture';
  const prog = PROGRESSIONS[overture ? 2 : seed % 2]!;
  const arp = ARP[seed % 3]!;
  const s16 = beat / 4;
  noiseState = 0x2f6b1a3d ^ seed;

  for (let b = 0; b < track.loopBars; b++) {
    const t0 = b * bar;
    const chord = prog[b % prog.length]!;
    switch (stem) {
      case 'kick':
        for (let q = 0; q < 4; q++) kick(out, t0 + q * beat, overture ? 0.8 : 0.95);
        if (!overture && (seed >> 3) % 2 === 1 && b % 2 === 1) kick(out, t0 + 3.5 * beat, 0.55);
        break;
      case 'bass': {
        const pattern = (seed >> 5) % 2 === 0 ? [0, 0, 7, 0, 0, 12, 7, 0] : [0, 12, 0, 7, 0, 12, 10, 7];
        for (let e = 0; e < 8; e++) {
          if (overture && e % 2 === 1) continue;
          note(out, 'saw', midiHz(root - 12 + chord[0]! + pattern[e]!), t0 + e * beat * 0.5, beat * 0.42, 0.34, 520);
        }
        break;
      }
      case 'keys':
        for (const hit of overture ? [0] : [0, 1.5, 2.5]) {
          for (const n of chord) note(out, 'tri', midiHz(root + 12 + n), t0 + hit * beat, overture ? bar - 0.08 : beat * 0.8, 0.12, 2400, 0.01);
        }
        break;
      case 'lead':
        for (let i = 0; i < 16; i++) {
          if (overture ? i % 4 !== 0 : i % 2 === 1 && (seed >> (i % 7)) % 3 === 0) continue;
          const n = chord[arp[i % 8]! % 3]! + (arp[i % 8]! === 3 ? 12 : 0);
          note(out, 'square', midiHz(root + 24 + n), t0 + i * s16, s16 * 0.9, 0.06, 3200);
        }
        break;
      case 'top':
        for (let i = 0; i < 16; i++) burst(out, t0 + i * s16, i % 4 === 2 ? 0.16 : 0.07, i % 4 === 2 ? 0.09 : 0.03, 'hp', 7000);
        if (!overture) {
          burst(out, t0 + beat, 0.4, 0.18, 'bp', 1500);
          burst(out, t0 + 3 * beat, 0.4, 0.18, 'bp', 1500);
        }
        break;
    }
  }
  return out;
}

/** One-shots in C; prime tones are pitched to the movement key with playbackRate. */
export function renderSfxPCM(name: string): Float32Array {
  const dur = name === 'allclear' ? 2.2 : name === 'over' ? 1.1 : 0.7;
  // One-shots must not wrap: render into a longer buffer, then trim
  const pad = new Float32Array(Math.ceil((dur + 1) * SR));
  const C5 = 72;
  noiseState = 0x51f15e;
  if (name.startsWith('prime-')) {
    const deg = [0, 3, 7, 10][Number(name.slice(6))] ?? 0;
    note(pad, 'tri', midiHz(C5 + deg), 0, 0.28, 0.5, 5000, 0.003);
    note(pad, 'sine', midiHz(C5 + deg + 12), 0, 0.18, 0.18, 0, 0.003);
  } else if (name === 'detonate') {
    kick(pad, 0, 0.6);
    burst(pad, 0, 0.5, 0.22, 'bp', 900);
    note(pad, 'square', midiHz(C5 - 12), 0, 0.14, 0.12, 2000);
  } else if (name === 'hold') {
    // Rising sweep
    const len = Math.floor(0.6 * SR);
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = midiHz(C5 - 12) * Math.pow(midiHz(C5 + 7) / midiHz(C5 - 12), Math.min(1, t / 0.45));
      phase = (phase + f / SR) % 1;
      const cut = 600 * Math.pow(5000 / 600, Math.min(1, t / 0.45));
      lp += (1 - Math.exp((-2 * Math.PI * cut) / SR)) * (2 * phase - 1 - lp);
      pad[i] = pad[i]! + lp * envAt(t, 0.05, 0.55, 0.22);
    }
  } else if (name === 'over') {
    kick(pad, 0, 1);
    burst(pad, 0, 0.7, 0.6, 'bp', 400);
    for (const n of [0, 7, 12]) note(pad, 'saw', midiHz(C5 - 24 + n), 0, 0.8, 0.12, 1800);
  } else if (name === 'allclear') {
    [0, 4, 7, 12, 16].forEach((n, i) => note(pad, 'tri', midiHz(C5 + n), i * 0.06, 1.6, 0.16, 6000, 0.01));
    burst(pad, 0, 0.3, 1.2, 'hp', 6000);
  } else if (name === 'slide') {
    burst(pad, 0, 0.25, 0.24, 'bp', 700);
  }
  return pad.slice(0, Math.ceil(dur * SR));
}
