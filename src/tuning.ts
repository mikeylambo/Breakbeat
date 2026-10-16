/** BREAKBEAT tuning dials. No magic balance numbers in the engine. */
export const T = {
  BOARD_COLS: 10, BOARD_ROWS: 14, MIN_GROUP: 2, GEM_COLORS: 4,
  SWEEP_BARS: 1, RISE_BARS: 2, HOLD_MS: 300, PRESSURE_FROM: 'bottom',
  GEM_BASE: 10, SIZE_EXP: 1.35, COMBO_STEP: 0.1, COMBO_CAP: 3,
  AIR_MULT: 1.25, OVERCHARGE_MULT: 2, OVERCHARGE_RADIUS: 1,
  FALL_SPEED_SCALE: 0.85, FALL_DURATION: 0.54, AIR_FAIR_MS: 280, AIR_CONTACT_FROM: 0.55, SIXTEENTHS: 16,
  INIT_MIN_ROWS: 6, INIT_MAX_ROWS: 8, ZEN_REPLENISH_ROWS: 4,
} as const;
export type Mode = 'odyssey' | 'endless' | 'zen' | 'daily';
export function resonance(n: number): number {
  return n <= 0 ? 1 : [1, 1.25, 1.5, 2, 2.5, 3][Math.min(n, 6) - 1]! + (n > 6 ? Math.min(n - 6, 4) * .5 : 0);
}
