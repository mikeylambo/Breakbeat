/** Visualizer preset ids and labels (no renderer imports, so settings and tests can use them). */

export type VisualizerPreset = 'horizon' | 'rings' | 'scope' | 'shatter';
export const VISUALIZER_PRESETS: readonly (readonly [VisualizerPreset, string])[] = [
  ['horizon', 'Horizon'],
  ['rings', 'Rings'],
  ['scope', 'Scope'],
  ['shatter', 'Shatter']
];
