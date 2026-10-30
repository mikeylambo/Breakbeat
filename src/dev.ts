/**
 * Playtest shortcuts, compiled into local and preview builds only (tools/bundle.mjs defines
 * __DEV_TOOLS__ false for production, so this is stripped there).
 *   ?unlock=all    Overture done and all 19 movements cleared: B-sides, Mixtape and every act open
 *   ?unlock=fresh  a brand-new save (first launch, Overture first)
 * The query is removed after use, so a reload keeps the result without applying it twice.
 */

import { MOVEMENTS } from './audio/tracks.js';
import type { SaveData } from './meta/Save.js';

declare const __DEV_TOOLS__: boolean;

/** Applies `?unlock=` to `save`; returns what it did, or null. `persist` writes the save. */
export function applyDevUnlock(save: SaveData, persist: () => void): string | null {
  if (typeof __DEV_TOOLS__ === 'undefined' || !__DEV_TOOLS__) return null;
  const mode = new URLSearchParams(location.search).get('unlock');
  if (!mode) return null;
  if (mode === 'all') {
    save.overtureDone = true;
    for (const m of MOVEMENTS) if (!save.cleared.includes(m.id)) save.cleared.push(m.id);
  } else if (mode === 'fresh') {
    Object.assign(save, { overtureDone: false, cleared: [], best: {}, daily: { date: '', best: 0 }, runs: 0, stars: {}, etudes: [], achievements: [], counters: {}, bsides: [] });
  } else return null;
  persist();
  const url = new URL(location.href);
  url.searchParams.delete('unlock');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return mode;
}
