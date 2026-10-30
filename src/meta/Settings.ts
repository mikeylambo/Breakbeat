/** Player settings (persisted; every access try/catch guarded via platform/Storage). */

import type { Lang } from '../i18n/i18n.js';
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
  /** Race a pace ghost of your best run for the same movement, mode or day */
  ghost: boolean;
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
  /** Interface language; absent = follow the device */
  lang?: Lang;
  /** Listen mode's visualizer (always on there; V cycles it) */
  listenVisualizer: VisualizerPreset;
  /** Tap-to-sync done (or dismissed) */
  calibrated: boolean;
  /** Opt-in: send uncaught errors (scrubbed, anonymous) to the developer */
  errorReports: boolean;
  /** Chroma-key green background and a big score overlay, for streaming and capture */
  streamer: boolean;
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
  ghost: true,
  symbols: false,
  colourAssist: false,
  bpmScale: 1,
  offsetMs: 0,
  hudHidden: false,
  visualizer: 'horizon',
  zenVisualizer: false,
  listenVisualizer: 'rings',
  calibrated: false,
  errorReports: false,
  streamer: false
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
  if (!VISUALIZER_PRESETS.some(p => p[0] === s.listenVisualizer)) s.listenVisualizer = DEFAULT_SETTINGS.listenVisualizer;
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
