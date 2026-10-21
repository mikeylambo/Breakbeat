/**
 * Placeholder synth as pure PCM math (no Web Audio graph), run in a Worker so it never touches the
 * main thread. Each movement has a genre style (drum grid, swing, harmony, timbres) and three
 * 8-bar sections A/B/C that build in intensity. Mono Float32 at SR.
 */

export const SR = 44100;

export interface PcmTrack {
  id: string;
  bpm: number;
  key: string;
  style: string;
  /** Bars per section, in order (A, B, C) */
  sections: number[];
}

const KEY_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

type Wave = 'sine' | 'saw' | 'tri' | 'square';

interface Style {
  /** 16-step grids: 0 = rest, else velocity */
  kick: number[];
  snare: number[];
  hat: number[];
  open?: number[];
  swing: number;
  prog: number[][];
  bass: number[];
  bassWave: Wave;
  bassCut: number;
  keysWave: Wave;
  /** Keys hits in beats within a bar; long = sustained pad */
  keysHits: number[];
  keysLong?: boolean;
  leadWave: Wave;
  leadCut: number;
  /** Lead density 0..1 */
  lead: number;
  /** Soft-clip drive on the kick (industrial) */
  drive?: number;
}

const g = (s: string): number[] => s.split('').map(ch => (ch === 'x' ? 1 : ch === 'o' ? 0.55 : ch === '.' ? 0 : 0.3));

const MINOR = [[0, 3, 7], [-4, 0, 3], [-9, -5, -2], [-2, 2, 5]];
const MINOR2 = [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]];
const MAJOR = [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]];
const DORIAN = [[0, 3, 7, 10], [5, 9, 12], [0, 3, 7, 10], [-2, 2, 5, 9]];
const JAZZ = [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [0, 4, 7, 11]];

const STYLES: Record<string, Style> = {
  overture: { kick: g('x...x...x...x...'), snare: g('................'), hat: g('..o...o...o...o.'), swing: 0, prog: MAJOR, bass: [0, 0, 7, 0, 0, 12, 7, 0], bassWave: 'saw', bassCut: 480, keysWave: 'tri', keysHits: [0], keysLong: true, leadWave: 'tri', leadCut: 3000, lead: 0.25 },
  house: { kick: g('x...x...x...x...'), snare: g('....x.......x...'), hat: g('..x...x...x...x.'), open: g('..o...o...o...o.'), swing: 0.12, prog: DORIAN, bass: [0, 0, 12, 0, 7, 0, 10, 0], bassWave: 'saw', bassCut: 560, keysWave: 'tri', keysHits: [0, 1.5, 2.5], leadWave: 'square', leadCut: 3200, lead: 0.5 },
  techno: { kick: g('x...x...x...x...'), snare: g('............x...'), hat: g('o.x.o.x.o.x.o.x.'), swing: 0, prog: MINOR2, bass: [0, 0, 0, 0, 0, 0, 0, 0], bassWave: 'saw', bassCut: 380, keysWave: 'square', keysHits: [0.5, 2.5], leadWave: 'saw', leadCut: 2200, lead: 0.4 },
  garage: { kick: g('x......x..x.....'), snare: g('....x.......x...'), hat: g('o.x.o.xoo.x.o.xo'), swing: 0.26, prog: MINOR, bass: [0, 0, 10, 0, 12, 0, 7, 5], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0.75, 2.25, 3.5], leadWave: 'tri', leadCut: 3600, lead: 0.45 },
  synthwave: { kick: g('x.......x.......'), snare: g('....x.......x...'), hat: g('x.x.x.x.x.x.x.x.'), swing: 0, prog: MINOR, bass: [0, 12, 0, 12, 0, 12, 0, 12], bassWave: 'saw', bassCut: 900, keysWave: 'saw', keysHits: [0], keysLong: true, leadWave: 'saw', leadCut: 2600, lead: 0.7 },
  afro: { kick: g('x.....x.x.....x.'), snare: g('....x.......x...'), hat: g('xoxoxoxoxoxoxoxo'), swing: 0.16, prog: MAJOR, bass: [0, 0, 7, 0, 5, 0, 7, 9], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0.5, 1.5, 3], leadWave: 'tri', leadCut: 4000, lead: 0.55 },
  electro: { kick: g('x.....x...x.....'), snare: g('....x.......x...'), hat: g('x.x.x.x.x.x.x.x.'), swing: 0, prog: MINOR2, bass: [0, 0, 12, 0, 0, 10, 12, 0], bassWave: 'square', bassCut: 700, keysWave: 'square', keysHits: [0, 2], leadWave: 'square', leadCut: 3000, lead: 0.6 },
  lofi: { kick: g('x......x..x.....'), snare: g('....x.......x...'), hat: g('x.x.x.x.x.x.x.x.'), swing: 0.32, prog: JAZZ, bass: [0, 0, 7, 0, 5, 0, 3, 0], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0, 1.75, 3], leadWave: 'sine', leadCut: 2000, lead: 0.3 },
  jazz: { kick: g('x.........x.....'), snare: g('....o.......x..o'), hat: g('x..xx..xx..xx..x'), swing: 0.34, prog: JAZZ, bass: [0, 4, 7, 9, 12, 9, 7, 4], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0.5, 2.25], leadWave: 'tri', leadCut: 3000, lead: 0.5 },
  breaks: { kick: g('x.........x.....'), snare: g('....x..o....x..o'), hat: g('x.x.x.x.x.x.x.x.'), swing: 0.08, prog: MINOR, bass: [0, 0, 12, 0, 10, 0, 7, 0], bassWave: 'saw', bassCut: 600, keysWave: 'tri', keysHits: [0, 2.5], leadWave: 'square', leadCut: 3000, lead: 0.45 },
  halftime: { kick: g('x......x........'), snare: g('........x.......'), hat: g('x.x.x.x.x.x.x.x.'), swing: 0.05, prog: MINOR2, bass: [0, 0, 0, 0, -2, -2, 3, 3], bassWave: 'saw', bassCut: 300, keysWave: 'tri', keysHits: [0], keysLong: true, leadWave: 'saw', leadCut: 1800, lead: 0.35 },
  ambient: { kick: g('x...............'), snare: g('................'), hat: g('........o.......'), swing: 0, prog: MAJOR, bass: [0, 0, 0, 0, 7, 7, 7, 7], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0], keysLong: true, leadWave: 'sine', leadCut: 2400, lead: 0.2 },
  disco: { kick: g('x...x...x...x...'), snare: g('....x.......x...'), hat: g('x.x.x.x.x.x.x.x.'), open: g('..x...x...x...x.'), swing: 0.06, prog: DORIAN, bass: [0, 12, 0, 12, 0, 12, 0, 12], bassWave: 'saw', bassCut: 1100, keysWave: 'square', keysHits: [0.5, 1.5, 2.5, 3.5], leadWave: 'tri', leadCut: 4000, lead: 0.5 },
  industrial: { kick: g('x...x...x...x.x.'), snare: g('....x.......x...'), hat: g('xxxxxxxxxxxxxxxx'), swing: 0, prog: MINOR2, bass: [0, 0, 1, 0, 0, 0, -1, 0], bassWave: 'square', bassCut: 500, keysWave: 'saw', keysHits: [0, 3], leadWave: 'saw', leadCut: 1500, lead: 0.3, drive: 3 },
  footwork: { kick: g('x..x..x...x..x..'), snare: g('....x.......x...'), hat: g('..x...x...x...x.'), swing: 0, prog: MINOR, bass: [0, 0, 0, 12, 0, 0, 7, 0], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0, 0.75, 1.5], leadWave: 'square', leadCut: 2800, lead: 0.35 },
  trap: { kick: g('x.....x....x....'), snare: g('........x.......'), hat: g('x.x.x.x.xxx.x.xx'), swing: 0, prog: MINOR2, bass: [0, 0, 0, 0, -2, 0, 0, 0], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0], keysLong: true, leadWave: 'square', leadCut: 2400, lead: 0.4 },
  hyperpop: { kick: g('x...x...x...x...'), snare: g('....x.......x..x'), hat: g('xxxxxxxxxxxxxxxx'), swing: 0, prog: MAJOR, bass: [0, 12, 0, 12, 7, 19, 7, 19], bassWave: 'square', bassCut: 1600, keysWave: 'square', keysHits: [0, 0.5, 1.5, 2, 3], leadWave: 'square', leadCut: 6000, lead: 0.9 },
  jungle: { kick: g('x.........x.....'), snare: g('....x..o.o..x..o'), hat: g('xoxoxoxoxoxoxoxo'), swing: 0.04, prog: MINOR, bass: [0, 0, 0, 0, 0, 0, -2, -2], bassWave: 'sine', bassCut: 0, keysWave: 'tri', keysHits: [0], keysLong: true, leadWave: 'tri', leadCut: 3000, lead: 0.35 },
  coda: { kick: g('x...x...x...x...'), snare: g('....x.......x...'), hat: g('o.x.o.x.o.x.o.x.'), swing: 0.08, prog: MAJOR, bass: [0, 0, 12, 0, 7, 0, 12, 0], bassWave: 'saw', bassCut: 800, keysWave: 'tri', keysHits: [0, 1.5, 2.5], leadWave: 'tri', leadCut: 4200, lead: 0.7 }
};

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function trackSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Linear attack to `peak`, then exponential decay to -80 dB over `decay` seconds. */
function envAt(t: number, attack: number, decay: number, peak: number): number {
  if (t < 0) return 0;
  if (t < attack) return (peak * t) / attack;
  const d = t - attack;
  if (d >= decay) return 0;
  return peak * Math.exp((Math.log(0.0001 / Math.max(0.0001, peak)) * d) / decay);
}

/** Adds a note with an optional one-pole low-pass. Writes wrap inside [lo, hi) so section loops stay seamless. */
function note(out: Float32Array, lo: number, hi: number, wave: Wave, hz: number, t0: number, dur: number, peak: number, cutoff = 0, attack = 0.005): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor((attack + dur) * SR);
  const a = cutoff > 0 ? 1 - Math.exp((-2 * Math.PI * cutoff) / SR) : 1;
  let lp = 0;
  let phase = 0;
  const inc = hz / SR;
  const span = hi - lo;
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
    const idx = lo + ((start - lo + i) % span);
    out[idx] = out[idx]! + lp * envAt(i / SR, attack, dur, peak);
  }
}

function kick(out: Float32Array, lo: number, hi: number, t0: number, peak: number, drive = 0): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor(0.36 * SR);
  let phase = 0;
  const span = hi - lo;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = t < 0.12 ? 150 * Math.pow(42 / 150, t / 0.12) : 42;
    phase += f / SR;
    let v = Math.sin(2 * Math.PI * phase) * envAt(t, 0.002, 0.32, peak);
    if (drive > 0) v = Math.tanh(v * drive) * 0.8;
    const idx = lo + ((start - lo + i) % span);
    out[idx] = out[idx]! + v;
  }
}

let noiseState = 0x2f6b1a3d;
function noise(): number {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 4294967296) * 2 - 1;
}

function burst(out: Float32Array, lo: number, hi: number, t0: number, peak: number, dur: number, mode: 'hp' | 'bp', hz: number): void {
  const start = Math.floor(t0 * SR);
  const len = Math.floor((dur + 0.002) * SR);
  const a = 1 - Math.exp((-2 * Math.PI * hz) / SR);
  let lp1 = 0;
  let lp2 = 0;
  const span = hi - lo;
  for (let i = 0; i < len; i++) {
    const n = noise();
    lp1 += a * (n - lp1);
    let v: number;
    if (mode === 'hp') v = n - lp1;
    else {
      lp2 += a * (lp1 - lp2);
      v = (lp1 - lp2) * 2.2;
    }
    const idx = lo + ((start - lo + i) % span);
    out[idx] = out[idx]! + v * envAt(i / SR, 0.001, dur, peak);
  }
}

export type StemName = 'kick' | 'bass' | 'keys' | 'lead' | 'top';

/**
 * Renders one stem across all sections back to back. Section k (0 = A) has intensity k: A is
 * sparse, B is the full groove, C adds fills, octave lifts and denser leads.
 */
export function renderStemPCM(track: PcmTrack, stem: StemName): Float32Array {
  const st = STYLES[track.style] ?? STYLES.house!;
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const s16 = beat / 4;
  const totalBars = track.sections.reduce((a, b) => a + b, 0);
  const out = new Float32Array(Math.round(totalBars * bar * SR));
  const seed = trackSeed(track.id);
  const root = 48 + (KEY_SEMITONES[track.key] ?? 0);
  noiseState = 0x2f6b1a3d ^ seed;
  const sw = (i: number): number => (i % 2 === 1 ? st.swing * s16 : 0);

  let barIndex = 0;
  track.sections.forEach((bars, section) => {
    const lo = Math.round(barIndex * bar * SR);
    const hi = Math.round((barIndex + bars) * bar * SR);
    const intensity = track.sections.length === 1 ? 1 : section;
    for (let b = 0; b < bars; b++) {
      const t0 = (barIndex + b) * bar;
      const chord = st.prog[b % st.prog.length]!;
      const fillBar = b === bars - 1 && intensity >= 1;
      switch (stem) {
        case 'kick':
          for (let i = 0; i < 16; i++) {
            const v = st.kick[i]!;
            if (v > 0 && !(intensity === 0 && v < 1 && i % 4 !== 0)) kick(out, lo, hi, t0 + i * s16 + sw(i), 0.95 * v, st.drive);
          }
          if (intensity === 2 && b % 2 === 1) kick(out, lo, hi, t0 + 15 * s16, 0.5, st.drive);
          break;
        case 'bass': {
          for (let e = 0; e < 8; e++) {
            if (intensity === 0 && e % 2 === 1) continue;
            const lift = intensity === 2 && e >= 6 ? 12 : 0;
            note(out, lo, hi, st.bassWave, midiHz(root - 12 + chord[0]! + st.bass[e]! + lift), t0 + e * beat * 0.5 + sw(e * 2), beat * 0.42, st.bassWave === 'sine' ? 0.5 : 0.34, st.bassCut);
          }
          break;
        }
        case 'keys': {
          const hits = intensity === 0 ? st.keysHits.slice(0, 1) : st.keysHits;
          for (const hit of hits) {
            const len = st.keysLong ? bar - 0.06 : beat * 0.7;
            for (const n of chord) note(out, lo, hi, st.keysWave, midiHz(root + 12 + n), t0 + hit * beat, len, st.keysWave === 'square' ? 0.05 : 0.11, 2600, st.keysLong ? 0.08 : 0.01);
          }
          break;
        }
        case 'lead': {
          const density = Math.min(1, st.lead * (0.5 + 0.5 * intensity));
          for (let i = 0; i < 16; i++) {
            const r = ((seed >>> (i % 13)) ^ (b * 7 + i * 3)) % 100;
            if (r / 100 > density) continue;
            const deg = (i + b + (seed % 5)) % chord.length;
            const n = chord[deg]! + (intensity === 2 ? 12 : 0);
            note(out, lo, hi, st.leadWave, midiHz(root + 24 + n), t0 + i * s16 + sw(i), s16 * 0.9, st.leadWave === 'sine' ? 0.12 : 0.055, st.leadCut);
          }
          break;
        }
        case 'top':
          for (let i = 0; i < 16; i++) {
            const h = st.hat[i]!;
            if (h > 0 && !(intensity === 0 && i % 2 === 1)) burst(out, lo, hi, t0 + i * s16 + sw(i), 0.1 * h, 0.03, 'hp', 7000);
            const o = st.open?.[i] ?? 0;
            if (o > 0 && intensity > 0) burst(out, lo, hi, t0 + i * s16 + sw(i), 0.09, 0.14, 'hp', 6000);
            const sn = st.snare[i]!;
            if (sn > 0 && intensity > 0) burst(out, lo, hi, t0 + i * s16 + sw(i), 0.42 * sn, 0.18, 'bp', 1500);
          }
          if (fillBar) for (let i = 12; i < 16; i++) burst(out, lo, hi, t0 + i * s16, 0.22, 0.08, 'bp', 1800);
          break;
      }
    }
    barIndex += bars;
  });
  return out;
}

/** One-shots in C; prime tones are pitched to the movement key with playbackRate. */
export function renderSfxPCM(name: string): Float32Array {
  const dur = name === 'allclear' ? 2.2 : name === 'over' ? 1.1 : 0.7;
  const pad = new Float32Array(Math.ceil((dur + 1) * SR));
  const lo = 0;
  const hi = pad.length;
  const C5 = 72;
  noiseState = 0x51f15e;
  if (name.startsWith('prime-')) {
    const deg = [0, 3, 7, 10][Number(name.slice(6))] ?? 0;
    note(pad, lo, hi, 'tri', midiHz(C5 + deg), 0, 0.28, 0.5, 5000, 0.003);
    note(pad, lo, hi, 'sine', midiHz(C5 + deg + 12), 0, 0.18, 0.18, 0, 0.003);
  } else if (name === 'detonate') {
    kick(pad, lo, hi, 0, 0.6);
    burst(pad, lo, hi, 0, 0.5, 0.22, 'bp', 900);
    note(pad, lo, hi, 'square', midiHz(C5 - 12), 0, 0.14, 0.12, 2000);
  } else if (name === 'hold') {
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
    kick(pad, lo, hi, 0, 1);
    burst(pad, lo, hi, 0, 0.7, 0.6, 'bp', 400);
    for (const n of [0, 7, 12]) note(pad, lo, hi, 'saw', midiHz(C5 - 24 + n), 0, 0.8, 0.12, 1800);
  } else if (name === 'allclear') {
    [0, 4, 7, 12, 16].forEach((n, i) => note(pad, lo, hi, 'tri', midiHz(C5 + n), i * 0.06, 1.6, 0.16, 6000, 0.01));
    burst(pad, lo, hi, 0, 0.3, 1.2, 'hp', 6000);
  } else if (name === 'slide') {
    burst(pad, lo, hi, 0, 0.25, 0.24, 'bp', 700);
  }
  return pad.slice(0, Math.ceil(dur * SR));
}
