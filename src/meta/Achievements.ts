/**
 * Achievements — 41, all derived from what the game already records: the run's telemetry, the
 * save (clears, stars, bests, etudes), and a few moments the app reports (posting to the Daily
 * board, sharing an etude, a full Listen track, passing your ghost). Ids are stable so a Steam build
 * can map them one to one. DOM-free and content-free (movements are passed in), so Node tests run it.
 */

import type { RunTelemetry } from '../pulse/PulseEngine.js';
import type { SaveData } from './Save.js';

export interface AchRun {
  mode: string;
  score: number;
  bars: number;
  seconds: number;
  t: RunTelemetry;
  /** A player's own song */
  myBeat: boolean;
}

export interface AchContext {
  save: SaveData;
  /** Movements in order, with their act */
  movements: readonly { id: string; act: string }[];
  /** Mastery rank of each best score (by key) */
  rankOf(score: number): string;
  run?: AchRun;
  /** One-off moments reported by the app */
  moment?: 'board' | 'etude-shared' | 'listen-full' | 'ghost-passed' | 'my-beat-added';
}

export interface AchDef {
  id: string;
  name: string;
  desc: string;
  /** Hidden until earned */
  secret?: boolean;
  test(c: AchContext): boolean;
  /** For the Profile list: [have, need] */
  progress?(c: AchContext): [number, number];
}

const r = (c: AchContext): AchRun | null => c.run ?? null;
const cleared = (c: AchContext, act: string): [number, number] => {
  const ms = c.movements.filter(m => m.act === act);
  return [ms.filter(m => c.save.cleared.includes(m.id)).length, ms.length];
};
const stars = (c: AchContext): number => Object.values(c.save.stars).reduce((a, m) => a + ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1)), 0);
const life = (c: AchContext): SaveData['stats'] => c.save.stats;
const done = (p: [number, number]): boolean => p[0] >= p[1];

export const ACHIEVEMENTS: readonly AchDef[] = [
  // Firsts
  { id: 'first-break', name: 'First Break', desc: 'Clear your first group.', test: c => life(c).groups >= 1 },
  { id: 'overture', name: 'Curtain Up', desc: 'Finish the Overture.', test: c => c.save.overtureDone },
  { id: 'overcharged', name: 'Overcharged', desc: 'Land an Overcharge.', test: c => life(c).overcharges >= 1 },
  { id: 'airborne', name: 'Airborne', desc: 'Air-prime a falling group.', test: c => life(c).airPrimes >= 1 },
  { id: 'all-clear', name: 'Clean Slate', desc: 'Clear the whole wall.', test: c => life(c).allClears >= 1 },
  { id: 'one-colour', name: 'Monochrome', desc: 'Leave a single colour standing.', test: c => (r(c)?.t.oneColourBonuses ?? 0) >= 1 },
  // A single pass
  { id: 'resonance-4', name: 'Resonance', desc: '4 groups go off in one pass.', test: c => (r(c)?.t.bestPassGroups ?? 0) >= 4 },
  { id: 'resonance-7', name: 'Full Resonance', desc: '7 groups go off in one pass.', test: c => (r(c)?.t.bestPassGroups ?? 0) >= 7 },
  { id: 'pass-3k', name: 'Big Pass', desc: '3,000 points in one pass.', test: c => (r(c)?.t.bestPassScore ?? 0) >= 3000 },
  { id: 'pass-12k', name: 'Avalanche', desc: '12,000 points in one pass.', test: c => (r(c)?.t.bestPassScore ?? 0) >= 12000 },
  // A run
  { id: 'chain-6', name: 'In the Pocket', desc: 'Keep a chain going for 6 passes.', test: c => (r(c)?.t.longestCombo ?? 0) >= 6 },
  { id: 'chain-16', name: 'Locked In', desc: 'Keep a chain going for 16 passes.', test: c => (r(c)?.t.longestCombo ?? 0) >= 16 },
  { id: 'over-5', name: 'Charge Hungry', desc: '5 Overcharges in one run.', test: c => (r(c)?.t.overchargesLanded ?? 0) >= 5 },
  { id: 'air-10', name: 'Sky Catcher', desc: '10 air-primes in one run.', test: c => (r(c)?.t.airPrimesLanded ?? 0) >= 10 },
  { id: 'clear-3', name: 'Spotless', desc: '3 All Clears in one run.', test: c => (r(c)?.t.allClears ?? 0) >= 3 },
  { id: 'bars-48', name: 'Holding Ground', desc: 'Survive 48 bars in one run.', test: c => (r(c)?.bars ?? 0) >= 48 },
  { id: 'bars-128', name: 'Marathon', desc: 'Survive 128 bars in one run.', test: c => (r(c)?.bars ?? 0) >= 128 },
  { id: 'score-50k', name: 'Fifty', desc: 'Score 50,000 in one run.', test: c => (r(c)?.score ?? 0) >= 50000 },
  { id: 'score-150k', name: 'Headliner', desc: 'Score 150,000 in one run.', test: c => (r(c)?.score ?? 0) >= 150000 },
  // The Odyssey
  { id: 'act-1', name: 'Ignition', desc: 'Clear every movement in Act I.', test: c => done(cleared(c, 'I')), progress: c => cleared(c, 'I') },
  { id: 'act-2', name: 'Drift', desc: 'Clear every movement in Act II.', test: c => done(cleared(c, 'II')), progress: c => cleared(c, 'II') },
  { id: 'act-3', name: 'Fracture', desc: 'Clear every movement in Act III.', test: c => done(cleared(c, 'III')), progress: c => cleared(c, 'III') },
  { id: 'coda', name: 'Coda', desc: 'Clear the final movement.', test: c => done(cleared(c, 'Coda')), progress: c => cleared(c, 'Coda') },
  { id: 'stars-12', name: 'Starlit', desc: 'Earn 12 challenge stars.', test: c => stars(c) >= 12, progress: c => [stars(c), 12] },
  { id: 'stars-36', name: 'Constellation', desc: 'Earn 36 challenge stars.', test: c => stars(c) >= 36, progress: c => [stars(c), 36] },
  { id: 'stars-all', name: 'Every Star', desc: 'Earn every challenge star.', test: c => stars(c) >= c.movements.length * 3, progress: c => [stars(c), c.movements.length * 3] },
  { id: 'gold', name: 'Gold Record', desc: 'Reach Gold on any movement.', test: c => c.movements.some(m => ['GOLD', 'OBSIDIAN', 'RESONANT'].includes(c.rankOf(c.save.best[m.id] ?? 0))) },
  { id: 'resonant', name: 'Resonant', desc: 'Reach the top rank on any movement.', test: c => c.movements.some(m => c.rankOf(c.save.best[m.id] ?? 0) === 'RESONANT') },
  // Modes
  { id: 'daily', name: 'Daily Grind', desc: 'Play a Daily.', test: c => (c.save.counters.dailyDays ?? 0) >= 1 },
  { id: 'daily-7', name: 'Regular', desc: 'Play the Daily on 7 different days.', test: c => (c.save.counters.dailyDays ?? 0) >= 7, progress: c => [c.save.counters.dailyDays ?? 0, 7] },
  { id: 'endless-40k', name: 'No End in Sight', desc: 'Score 40,000 in Endless.', test: c => (c.save.best.endless ?? 0) >= 40000 },
  { id: 'zen-10', name: 'Still', desc: 'Spend 10 minutes in one Zen run.', test: c => r(c)?.mode === 'zen' && (r(c)?.seconds ?? 0) >= 600 },
  { id: 'etudes', name: 'Études Complete', desc: 'Solve all 8 etudes.', test: c => c.save.etudes.length >= 8, progress: c => [c.save.etudes.length, 8] },
  { id: 'my-beat', name: 'Your Song', desc: 'Play the wall to your own song.', test: c => !!r(c)?.myBeat },
  { id: 'my-beat-25k', name: 'Your Stage', desc: 'Score 25,000 on your own song.', test: c => !!r(c)?.myBeat && (r(c)?.score ?? 0) >= 25000 },
  { id: 'runs-100', name: 'Hundred', desc: 'Play 100 runs.', test: c => c.save.runs >= 100, progress: c => [c.save.runs, 100] },
  { id: 'groups-10k', name: 'Demolition', desc: 'Clear 10,000 groups in total.', test: c => life(c).groups >= 10000, progress: c => [life(c).groups, 10000] },
  // Moments
  { id: 'ghost-passed', name: 'Better Than Before', desc: 'Pass your best run’s ghost.', test: c => c.moment === 'ghost-passed' },
  { id: 'board', name: 'On the Board', desc: 'Post a Daily to the board.', test: c => c.moment === 'board' },
  { id: 'etude-shared', name: 'Composer', desc: 'Share an etude you made.', secret: true, test: c => c.moment === 'etude-shared' },
  { id: 'listen-full', name: 'Liner Notes', desc: 'Listen to a whole track in Listen.', test: c => c.moment === 'listen-full' }
];

/** Newly earned achievements for this context (marks them in the save). */
export function evaluate(c: AchContext): AchDef[] {
  const got = new Set(c.save.achievements);
  const out: AchDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (got.has(a.id)) continue;
    let ok = false;
    try {
      ok = a.test(c);
    } catch {
      ok = false;
    }
    if (ok) {
      c.save.achievements.push(a.id);
      out.push(a);
    }
  }
  return out;
}

/** Counts a Daily played today (once per UTC day). */
export function noteDaily(save: SaveData, day: string): void {
  const n = Number(day.replace(/-/g, ''));
  if (save.counters.lastDaily === n) return;
  save.counters.lastDaily = n;
  save.counters.dailyDays = (save.counters.dailyDays ?? 0) + 1;
}
