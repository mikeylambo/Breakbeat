/**
 * Practice — one movement, one looping section, a chosen tempo and wall. Practice runs keep no bests,
 * stars, ghosts or replays; they still feed lifetime stats and the coach.
 */


export type PracticeWall = 'still' | 'rising' | 'fast' | 'pressure';
export const PRACTICE_WALLS: readonly PracticeWall[] = ['still', 'rising', 'fast', 'pressure'];
export const PRACTICE_TEMPOS: readonly number[] = [0.7, 0.8, 0.9, 1];

export interface PracticeSetup {
  /** Section index (A = 0) that loops for the whole run */
  section: number;
  /** 0.7 to 1 of the movement's tempo */
  tempo: number;
  /** still: no rising rows · rising: the movement's own cadence · fast: a row every bar ·
   *  pressure: starts one push from the danger line, rising every 2 bars */
  wall: PracticeWall;
}
