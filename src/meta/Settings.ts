/** Player settings (persisted; every access try/catch guarded via platform/Storage). */

import { readJson, writeJson } from '../platform/Storage.js';

export interface Settings {
  volume: number;
  music: number;
  sfx: number;
  /** 0..1 scales every flash, glow pulse and the All Clear flash */
  flash: number;
  strobeFree: boolean;
  reducedMotion: boolean;
  haptics: boolean;
  hapticMetronome: boolean;
  /** Per-colour symbols on the blocks: an accessibility aid, off by default */
  symbols: SymbolMode;
  /** Tempo scale (1 = written BPM). Scores are normalised by it. */
  bpmScale: number;
  /** Audio offset nudge in ms (+ = visuals later) */
  offsetMs: number;
  hudHidden: boolean;
  /** Tap-to-sync done (or dismissed) */
  calibrated: boolean;
}

export type SymbolMode = 'off' | 'on' | 'bold';

const KEY = 'breakbeat-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.9,
  music: 0.85,
  sfx: 0.9,
  flash: 1,
  strobeFree: false,
  reducedMotion: false,
  haptics: true,
  hapticMetronome: false,
  symbols: 'off',
  bpmScale: 1,
  offsetMs: 0,
  hudHidden: false,
  calibrated: false
};

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings> & { colourAssist?: boolean }>(KEY, {});
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // v0.10: "Colour assist" (stronger glyphs) became Block symbols: Bold
  if (raw.symbols === undefined && raw.colourAssist) s.symbols = 'bold';
  if (!['off', 'on', 'bold'].includes(s.symbols)) s.symbols = 'off';
  delete (s as { colourAssist?: boolean }).colourAssist;
  try {
    if (!localStorageHas(KEY) && matchMedia('(prefers-reduced-motion: reduce)').matches) s.reducedMotion = true;
  } catch {
    // ignore
  }
  return s;
}

function localStorageHas(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function saveSettings(s: Settings): void {
  writeJson(KEY, s);
}
