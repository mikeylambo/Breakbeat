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
  colourAssist: boolean;
  /** Tempo scale (1 = written BPM). Scores are normalised by it. */
  bpmScale: number;
  /** Audio offset nudge in ms (+ = visuals later) */
  offsetMs: number;
  hudHidden: boolean;
}

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
  colourAssist: false,
  bpmScale: 1,
  offsetMs: 0,
  hudHidden: false
};

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEY, {}) };
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
