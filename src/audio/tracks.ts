/** Track manifest (content/tracks.json), bundled at build time: no network at play time. */

import manifest from '../../content/tracks.json';

export const STEM_NAMES = ['kick', 'bass', 'keys', 'lead', 'top'] as const;
export type StemName = (typeof STEM_NAMES)[number];
export const SFX_NAMES = ['detonate', 'hold', 'over', 'allclear', 'slide'] as const;
export type SfxName = (typeof SFX_NAMES)[number] | 'prime-0' | 'prime-1' | 'prime-2' | 'prime-3';

export interface TrackDef {
  id: string;
  number: string;
  name: string;
  /** '0' (Overture), 'I', 'II', 'III' or 'Coda' */
  act: string;
  /** Genre palette (drives the placeholder arrangement and the brief for real stems) */
  style: string;
  /** Light behind the wall, '#RRGGBB' */
  tint: string;
  /** A/B/C sections, back to back in every stem file; the music steps forward through them */
  sections: { name: string; bars: number }[];
  bpm: number;
  key: string;
  offsetMs: number;
  loopBars: number;
  quota: number;
  colors: number;
  riseBars: number;
  /** Commissioned sleeve art under public/ (else a generated stand-in, see render/SleeveArt.ts) */
  sleeve?: string;
  /** False until Michael's stems land; the placeholder synth renders the stems instead. */
  stemsReady: boolean;
  stems: Record<StemName, string>;
  sfx: { prime: string[]; detonate: string; hold: string; over: string; allclear: string; slide: string };
}

export const TRACKS: readonly TrackDef[] = (manifest as { tracks: TrackDef[] }).tracks;
export const OVERTURE: TrackDef = TRACKS.find(t => t.id === 'overture')!;
/** The six Odyssey movements, in order. */
export const MOVEMENTS: readonly TrackDef[] = TRACKS.filter(t => t.id !== 'overture');

/** Zen plays the ambient movement. */
export const ZEN_INDEX = Math.max(0, MOVEMENTS.findIndex(t => t.style === 'ambient'));
export const ACTS = ['I', 'II', 'III', 'Coda'] as const;

export function trackTint(t: TrackDef): number {
  return parseInt(t.tint.slice(1), 16);
}

const KEY_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

/** Semitones of the track key above C (0..11). */
export function keySemitone(key: string): number {
  return KEY_SEMITONES[key] ?? 0;
}
