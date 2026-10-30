/**
 * Mixtape — a playlist of movements back to back. Each track plays MIXTAPE_BARS (its A, B and C
 * sections), then crossfades into the next on a downbeat while the wall carries on; the score is
 * cumulative and the run ends with the tape (or when the wall wins). Each tape keeps its own best
 * and ghost, keyed by its track list.
 */

/** What the helpers need of a movement (MOVEMENTS is passed in, so this module loads headless). */
type Movement = { id: string; bpm: number };

export const MIXTAPE_BARS = 24;
export const MIXTAPE_MIN = 2;
export const MIXTAPE_MAX = 8;

/** Best / ghost key of a tape (movement indices in play order). */
export const tapeKey = (list: readonly number[], movements: readonly Movement[]): string => `tape-${list.map(i => movements[i]?.id ?? i).join('+')}`;

/** Running time of a tape in seconds at `scale` of each movement's tempo. */
export const tapeSeconds = (list: readonly number[], movements: readonly Movement[], scale = 1): number =>
  list.reduce((s, i) => s + (MIXTAPE_BARS * 240) / ((movements[i]?.bpm ?? 120) * scale), 0);
