/**
 * BREAKBEAT — Canonical GDD Tuning Table
 * Every gameplay constant lives in this file (GDD Page 8).
 */
export const TUNING = {
    /** 10 columns x 14 rows in portrait (~36 px blocks at 390 wide) */
    BOARD_COLS: 10,
    BOARD_ROWS: 14,
    INITIAL_ROWS: 6,
    /** Sweepline crosses the wall once per measure (4 beats = 16 sixteenths) */
    SWEEP_BARS: 1,
    SIXTEENTHS_PER_BAR: 16,
    BEATS_PER_BAR: 4,
    /** Pressure rows push in on the downbeat every RISE_BARS (2 -> tightening to 1) */
    RISE_BARS: 2,
    RISE_TIGHTEN_BAR: 24,
    PRESSURE_FROM: 'bottom',
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
    RESONANCE_TABLE: [1, 1, 1.25, 1.5, 2.0, 2.5, 3.0],
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
    CAMERA_BREATH_MAX: 0.02
};
/** Stepped Resonance multiplier for `groupsThisPass` groups detonated in a single pass. */
export function computeResonanceMultiplier(groupsThisPass) {
    if (groupsThisPass <= 1)
        return 1.0;
    if (groupsThisPass < TUNING.RESONANCE_TABLE.length) {
        return TUNING.RESONANCE_TABLE[groupsThisPass];
    }
    const extra = (groupsThisPass - 6) * TUNING.RESONANCE_EXTRA_STEP;
    return Math.min(TUNING.RESONANCE_CAP, 3.0 + extra);
}
/** Combo multiplier for `consecutivePasses` consecutive passes with at least 1 detonation. */
export function computeComboMultiplier(consecutivePasses) {
    if (consecutivePasses <= 0)
        return 1.0;
    return Math.min(TUNING.COMBO_CAP, Number((1.0 + consecutivePasses * TUNING.COMBO_STEP).toFixed(2)));
}
/** Chain rank (0..4) derived from current combo to unmute track stems one layer at a time. */
export function computeChainRank(comboPasses) {
    if (comboPasses >= 8)
        return 4;
    if (comboPasses >= 5)
        return 3;
    if (comboPasses >= 3)
        return 2;
    if (comboPasses >= 1)
        return 1;
    return 0;
}
export function computeMasteryRank(score) {
    if (score >= 28000)
        return 'RESONANT';
    if (score >= 16000)
        return 'OBSIDIAN';
    if (score >= 9000)
        return 'GOLD';
    if (score >= 4000)
        return 'SILVER';
    return 'BRONZE';
}
