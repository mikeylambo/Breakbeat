/** Progress save: Overture, cleared movements, bests per movement/mode, daily. */

import { readJson, writeJson } from '../platform/Storage.js';
import { MOVEMENTS } from '../audio/tracks.js';
import { MASTERY_FLOORS, computeMasteryRank, type MasteryRank } from '../tuning.js';

export interface SaveData {
  v: 1;
  overtureDone: boolean;
  /** Movement ids whose quota has been reached at least once */
  cleared: string[];
  /** Best run score keyed by movement id (runs started there) or mode ('endless' | 'zen') */
  best: Record<string, number>;
  daily: { date: string; best: number };
  runs: number;
  /** Earned challenge stars per movement id: bitmask of its 3 challenges */
  stars: Record<string, number>;
  stats: LifetimeStats;
  /** Equipped cosmetics ('auto' = the movement's own world) */
  equipped: { blade: string; shard: string };
  /** Solved etude ids */
  etudes: string[];
  /** Unlocked achievement ids */
  achievements: string[];
  /** Achievement counters that no other save field keeps (e.g. distinct Daily days) */
  counters: Record<string, number>;
}

export interface LifetimeStats {
  playSec: number;
  groups: number;
  tiles: number;
  allClears: number;
  overcharges: number;
  airPrimes: number;
  bestChain: number;
  bestPass: number;
  bestPassGroups: number;
  movementsCleared: number;
}

export const EMPTY_STATS: LifetimeStats = { playSec: 0, groups: 0, tiles: 0, allClears: 0, overcharges: 0, airPrimes: 0, bestChain: 0, bestPass: 0, bestPassGroups: 0, movementsCleared: 0 };

const KEY = 'breakbeat-save-v1';

export function loadSave(): SaveData {
  const d = readJson<Partial<SaveData>>(KEY, {});
  return {
    v: 1,
    overtureDone: !!d.overtureDone,
    cleared: Array.isArray(d.cleared) ? d.cleared : [],
    best: d.best && typeof d.best === 'object' ? d.best : {},
    daily: d.daily && typeof d.daily.date === 'string' ? d.daily : { date: '', best: 0 },
    runs: d.runs ?? 0,
    stars: d.stars && typeof d.stars === 'object' ? d.stars : {},
    stats: { ...EMPTY_STATS, ...(d.stats ?? {}) },
    equipped: { blade: d.equipped?.blade ?? 'auto', shard: d.equipped?.shard ?? 'auto' },
    etudes: Array.isArray(d.etudes) ? d.etudes : [],
    achievements: Array.isArray(d.achievements) ? d.achievements : [],
    counters: d.counters && typeof d.counters === 'object' ? d.counters : {}
  };
}

export function writeSave(s: SaveData): void {
  writeJson(KEY, s);
}

/** Index of the next unfinished movement (last one if all cleared). */
export function nextMovementIndex(s: SaveData): number {
  for (let i = 0; i < MOVEMENTS.length; i++) if (!s.cleared.includes(MOVEMENTS[i]!.id)) return i;
  return MOVEMENTS.length - 1;
}

export function isUnlocked(s: SaveData, index: number): boolean {
  return index <= nextMovementIndex(s);
}

export const RANKS: readonly MasteryRank[] = ['BRONZE', 'SILVER', 'GOLD', 'OBSIDIAN', 'RESONANT'];
export const RANK_FLOOR: Record<MasteryRank, number> = MASTERY_FLOORS;

export function mastery(score: number): { rank: MasteryRank; next: MasteryRank | null; progress: number; toNext: number } {
  const rank = computeMasteryRank(score);
  const i = RANKS.indexOf(rank);
  const next = RANKS[i + 1] ?? null;
  if (!next) return { rank, next, progress: 1, toNext: 0 };
  const lo = RANK_FLOOR[rank];
  const hi = RANK_FLOOR[next];
  return { rank, next, progress: (score - lo) / (hi - lo), toNext: hi - score };
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
