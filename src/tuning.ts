/**
 * BREAKBEAT — Canonical GDD Tuning Table
 * Every gameplay constant lives in this file (GDD Page 8).
 */

export type GameMode = 'odyssey' | 'endless' | 'zen' | 'daily' | 'remix' | 'overture';
export type PressureDirection = 'bottom' | 'top';

export const TUNING = {
  /** 16 columns x 10 rows in landscape: one column per 16th note */
  BOARD_COLS: 16,
  BOARD_ROWS: 10,
  INITIAL_ROWS: 5,

  /** Sweepline crosses the wall once per measure (4 beats = 16 sixteenths) */
  SWEEP_BARS: 1,
  SIXTEENTHS_PER_BAR: 16,
  BEATS_PER_BAR: 4,

  /** Pressure rows push in on the downbeat every RISE_BARS (2 -> tightening to 1) */
  RISE_BARS: 2,
  RISE_TIGHTEN_BAR: 24,
  PRESSURE_FROM: 'bottom' as PressureDirection,

  /** Long-press a primed group (HOLD_MS 300) to hold it through one pass into Overcharge */
  HOLD_MS: 300,

  /** Minimum orthogonally connected same-color blocks to prime */
  MIN_GROUP: 2,

  /** 4 colors to start, a 5th on later skins */
  GEM_COLORS_START: 4,
  GEM_COLORS_LATE: 5,

  /** Scoring formula: GEM_BASE * size^SIZE_EXP * resonance * combo * air * overcharge */
  GEM_BASE: 10,
  SIZE_EXP: 1.35,

  /** Stepped resonance curve: 1, 1.25, 1.5, 2, 2.5, 3, then +0.5 per group, cap 5 at 10 groups */
  RESONANCE_TABLE: [1, 1, 1.25, 1.5, 2.0, 2.5, 3.0] as const,
  RESONANCE_EXTRA_STEP: 0.5,
  RESONANCE_CAP: 5.0,

  /** Combo: +0.1 per consecutive pass with a detonation, cap 3.0 */
  COMBO_STEP: 0.1,
  COMBO_CAP: 3.0,

  /** Air-priming multiplier for groups primed while at least one member is mid-fall */
  AIR_MULT: 1.25,

  /** Overcharge: held through 1 full sweep pass -> radius 1 in all 8 directions, x2 score */
  OVERCHARGE_MULT: 2.0,
  OVERCHARGE_RADIUS: 1,

  /** Cascades fall at 0.85 of real speed so falls stay readable and air-priming stays fair (>= 250ms) */
  FALL_SPEED_SCALE: 0.85,
  FALL_DURATION_SEC: 0.42,
  AIR_FAIR_MIN_MS: 250,

  /** Presentation & game-feel non-negotiables (GDD Page 6) */
  ANTICIPATION_SQUASH_COLS: 0.65,
  HITSTOP_CHAIN_THRESHOLD: 4,
  HITSTOP_MS: 60,
  CAMERA_BREATH_MAX: 0.02,

  /** v0.6 wall-state bonuses (x current combo multiplier) */
  ALL_CLEAR_BONUS: 10000,
  ALL_CLEAR_REFILL_ROWS: 3,
  ONE_COLOUR_BONUS: 3000,

  /** Danger = occupied rows among the top DANGER_ROWS rows; music bus low-pass per level */
  DANGER_ROWS: 2,
  DANGER_LPF_HZ: 2400,
  DANGER_LPF_HZ_2: 900,

  /** Input */
  TAP_SLOP_PX: 12,

  /** Pools and audio scheduling */
  FX_SHARD_POOL: 400,
  SFX_VOICE_CAP: 24,
  SCHED_INTERVAL_MS: 25,
  SCHED_LOOKAHEAD_MS: 120,

  OVERTURE_BPM: 96,

  /** Logical landscape stage and wall geometry */
  STAGE_W: 844,
  STAGE_H: 390,
  TILE_PX: 30,
  TILE_GAP_PX: 2,
  WALL_X: 167,
  WALL_Y: 34,
  PREVIEW_Y: 358
} as const;

if (TUNING.BOARD_COLS !== TUNING.SIXTEENTHS_PER_BAR) {
  throw new Error('BOARD_COLS must equal SIXTEENTHS_PER_BAR: the blade crosses one column per 16th.');
}

/** Stepped Resonance multiplier for `groupsThisPass` groups detonated in a single pass. */
export function computeResonanceMultiplier(groupsThisPass: number): number {
  if (groupsThisPass <= 1) return 1.0;
  if (groupsThisPass < TUNING.RESONANCE_TABLE.length) {
    return TUNING.RESONANCE_TABLE[groupsThisPass]!;
  }
  const extra = (groupsThisPass - 6) * TUNING.RESONANCE_EXTRA_STEP;
  return Math.min(TUNING.RESONANCE_CAP, 3.0 + extra);
}

/** Combo multiplier for `consecutivePasses` consecutive passes with at least 1 detonation. */
export function computeComboMultiplier(consecutivePasses: number): number {
  if (consecutivePasses <= 0) return 1.0;
  return Math.min(TUNING.COMBO_CAP, Number((1.0 + consecutivePasses * TUNING.COMBO_STEP).toFixed(2)));
}

/** Chain rank (0..4) derived from current combo to unmute track stems one layer at a time. */
export function computeChainRank(comboPasses: number): number {
  if (comboPasses >= 8) return 4;
  if (comboPasses >= 5) return 3;
  if (comboPasses >= 3) return 2;
  if (comboPasses >= 1) return 1;
  return 0;
}

/** Per-skin mastery rank based on score. */
export type MasteryRank = 'BRONZE' | 'SILVER' | 'GOLD' | 'OBSIDIAN' | 'RESONANT';

export function computeMasteryRank(score: number): MasteryRank {
  if (score >= 28000) return 'RESONANT';
  if (score >= 16000) return 'OBSIDIAN';
  if (score >= 9000) return 'GOLD';
  if (score >= 4000) return 'SILVER';
  return 'BRONZE';
}
