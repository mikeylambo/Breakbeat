/**
 * Progress — per-movement challenges (3 stars each), lifetime stats and cosmetic unlocks.
 * Cosmetics only change how the blade and debris look; they never change scoring.
 */

import type { TrackDef } from '../audio/tracks.js';
import type { RunTelemetry } from '../pulse/PulseEngine.js';
import type { SaveData } from './Save.js';

export interface ChallengeResult {
  /** Telemetry of the whole run started at this movement */
  t: RunTelemetry;
  score: number;
  /** The movement's quota was reached during this run */
  cleared: boolean;
}

export interface Challenge {
  label: string;
  test: (r: ChallengeResult) => boolean;
}

/** Rotating middle challenge so every movement asks for something a little different. */
const VERBS: ((t: TrackDef) => Challenge)[] = [
  () => ({ label: 'Land an All Clear', test: r => r.t.allClears >= 1 }),
  () => ({ label: 'Overcharge 2 groups', test: r => r.t.overchargesLanded >= 2 }),
  () => ({ label: 'Air-prime 3 groups', test: r => r.t.airPrimesLanded >= 3 }),
  () => ({ label: 'Set off 5 groups in one pass', test: r => r.t.bestPassGroups >= 5 }),
  () => ({ label: 'Chain 8 passes in a row', test: r => r.t.longestCombo >= 8 }),
  () => ({ label: 'Clear it without a hold', test: r => r.cleared && r.t.overchargesLanded === 0 })
];

export function challengesFor(track: TrackDef, index: number): Challenge[] {
  const scoreGoal = Math.round((track.quota * 1.6) / 1000) * 1000;
  return [
    { label: 'Clear the movement', test: r => r.cleared },
    VERBS[index % VERBS.length]!(track),
    { label: `Score ${scoreGoal.toLocaleString('en-US')} in one run`, test: r => r.score >= scoreGoal }
  ];
}

export function starCount(mask: number | undefined): number {
  const m = mask ?? 0;
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
}

export function totalStars(save: SaveData): number {
  let n = 0;
  for (const k in save.stars) n += starCount(save.stars[k]);
  return n;
}

/** Awards newly met challenges; returns the labels of the new stars. */
export function awardChallenges(save: SaveData, track: TrackDef, index: number, r: ChallengeResult): string[] {
  const list = challengesFor(track, index);
  const before = save.stars[track.id] ?? 0;
  let mask = before;
  const fresh: string[] = [];
  list.forEach((c, i) => {
    if (!(mask & (1 << i)) && c.test(r)) {
      mask |= 1 << i;
      fresh.push(c.label);
    }
  });
  save.stars[track.id] = mask;
  return fresh;
}

export function recordStats(save: SaveData, t: RunTelemetry, seconds: number, movementsCleared: number): void {
  const s = save.stats;
  s.playSec += seconds;
  s.groups += t.groupsCleared;
  s.tiles += t.blocksCleared;
  s.allClears += t.allClears;
  s.overcharges += t.overchargesLanded;
  s.airPrimes += t.airPrimesLanded;
  s.bestChain = Math.max(s.bestChain, t.longestCombo);
  s.bestPass = Math.max(s.bestPass, t.bestPassScore);
  s.bestPassGroups = Math.max(s.bestPassGroups, t.bestPassGroups);
  s.movementsCleared += movementsCleared;
}

export interface Unlock {
  kind: 'blade' | 'shard';
  id: string;
  name: string;
  stars: number;
}

/** Earned with challenge stars (57 available across the Odyssey). */
export const UNLOCKS: readonly Unlock[] = [
  { kind: 'blade', id: 'beam', name: 'Beam', stars: 0 },
  { kind: 'shard', id: 'shard', name: 'Shards', stars: 0 },
  { kind: 'blade', id: 'laser', name: 'Laser', stars: 3 },
  { kind: 'shard', id: 'pixel', name: 'Pixels', stars: 6 },
  { kind: 'blade', id: 'scan', name: 'Scanline', stars: 10 },
  { kind: 'shard', id: 'glass', name: 'Glass', stars: 15 },
  { kind: 'blade', id: 'brush', name: 'Brush', stars: 20 },
  { kind: 'shard', id: 'ember', name: 'Embers', stars: 26 },
  { kind: 'blade', id: 'ghost', name: 'Ghost', stars: 33 },
  { kind: 'shard', id: 'petal', name: 'Petals', stars: 40 }
];

export function isUnlocked(save: SaveData, u: Unlock): boolean {
  return totalStars(save) >= u.stars;
}
