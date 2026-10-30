/**
 * Remix — each movement's B-side: the same music under a new ruleset, for New Game+ (B-sides open once
 * the Odyssey is complete). Each B-side gets one twist, rotating through those that change its movement:
 *   flip    the wall hangs from the ceiling: rows push down, blocks fall up (any movement)
 *   five    five colours from bar one (movements on four colours: Act I)
 *   double  pressure at double time (movements that rise every 2 bars: Acts I and II)
 * Act III and the Coda already play five colours rising every bar, so their B-sides flip.
 * A B-side keeps its own best and ghost (key `<id>-b`) and a cleared mark; it has no challenge stars.
 */

import type { TrackDef } from '../audio/tracks.js';

export type RemixTwist = 'flip' | 'five' | 'double';
export const TWISTS: readonly RemixTwist[] = ['flip', 'five', 'double'];

/** Twists that change this movement (a twist that would do nothing is never offered). */
function applicable(track: Pick<TrackDef, 'colors' | 'riseBars'>): RemixTwist[] {
  return TWISTS.filter(t => (t === 'five' ? track.colors < 5 : t === 'double' ? track.riseBars > 1 : true));
}

/** The twist of movement `index` (0-based album order). */
export function twistFor(track: Pick<TrackDef, 'colors' | 'riseBars'>, index: number): RemixTwist {
  const a = applicable(track);
  return a[index % a.length]!;
}

/** Engine settings a B-side changes, from the A-side's. */
export function remixRules(track: Pick<TrackDef, 'colors' | 'riseBars'>, index: number): { twist: RemixTwist; colors: number; riseBars: number; flip: boolean } {
  const twist = twistFor(track, index);
  return {
    twist,
    colors: twist === 'five' ? 5 : track.colors,
    riseBars: twist === 'double' ? Math.max(1, Math.floor(track.riseBars / 2)) : track.riseBars,
    flip: twist === 'flip'
  };
}

/** Best / ghost key of a movement's B-side. */
export const bsideKey = (id: string): string => `${id}-b`;
