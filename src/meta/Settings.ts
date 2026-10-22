/** Player settings (persisted; every access try/catch guarded via platform/Storage). */

import { readJson, writeJson } from '../platform/Storage.js';
import { VISUALIZER_PRESETS, type VisualizerPreset } from '../render/visualizerPresets.js';

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
  /** Per-colour symbols on the blocks (off by default) */
  symbols: boolean;
  /** Brighter, more saturated blocks with stronger colour edges (and bolder symbols) */
  colourAssist: boolean;
  /** Tempo scale (1 = written BPM). Scores are normalised by it. */
  bpmScale: number;
  /** Audio offset nudge in ms (+ = visuals later) */
  offsetMs: number;
  hudHidden: boolean;
  /** Music visualizer behind the menus (and Zen, when zenVisualizer is on) */
  visualizer: 'off' | VisualizerPreset;
  zenVisualizer: boolean;
  /** Tap-to-sync done (or dismissed) */
  calibrated: boolean;
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
  symbols: false,
  colourAssist: false,
  bpmScale: 1,
  offsetMs: 0,
  hudHidden: false,
  visualizer: 'horizon',
  zenVisualizer: false,
  calibrated: false
};

export function loadSettings(): Settings {
  const raw = readJson<Partial<Omit<Settings, 'symbols'>> & { symbols?: unknown }>(KEY, {});
  const s = { ...DEFAULT_SETTINGS, ...raw } as Settings;
  // Older saves: symbols was 'off' | 'on' | 'bold' ("bold" meant Colour assist), and before that
  // symbols were always on with Colour assist as a separate toggle
  if (raw.symbols === undefined) s.symbols = !!raw.colourAssist;
  else if (typeof raw.symbols === 'string') {
    s.symbols = raw.symbols !== 'off';
    s.colourAssist = raw.symbols === 'bold' || !!raw.colourAssist;
  }
  s.symbols = !!s.symbols;
  s.colourAssist = !!s.colourAssist;
  if (s.visualizer !== 'off' && !VISUALIZER_PRESETS.some(p => p[0] === s.visualizer)) s.visualizer = DEFAULT_SETTINGS.visualizer;
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
