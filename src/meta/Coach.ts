/**
 * Coach — "Practise next". Keeps a capped run history and picks the metric this run fell
 * furthest below the player's own recent median, with a concrete target.
 */

import { readJson, writeJson } from '../platform/Storage.js';

export const HISTORY_KEY = 'breakbeat-history-v1';
export const HISTORY_CAP = 50;

export type CoachMetric = 'airPrimesLanded' | 'overchargesLanded' | 'groupsPerPassAvg' | 'longestCombo';
export const COACH_METRICS: readonly CoachMetric[] = ['airPrimesLanded', 'overchargesLanded', 'groupsPerPassAvg', 'longestCombo'];

export type RunMetrics = Record<CoachMetric, number>;

export interface CoachAdvice {
  metric: CoachMetric;
  current: number;
  target: number;
  text: string;
}

function show(metric: CoachMetric, v: number): string {
  return metric === 'groupsPerPassAvg' ? v.toFixed(1) : String(Math.round(v));
}

/** Fixed copy table. */
export function adviceText(metric: CoachMetric, current: number, target: number): string {
  const c = show(metric, current);
  switch (metric) {
    case 'airPrimesLanded':
      return `Air-primes: ${c} this run. Aim for ${target} — tap falling tiles before they land.`;
    case 'overchargesLanded':
      return `Overcharges: ${c} this run. Aim for ${target} — hold a group to blast everything around it.`;
    case 'groupsPerPassAvg':
      return `Groups per pass: ${c} this run. Aim for ${target} — prime more groups ahead of the blade.`;
    case 'longestCombo':
      return `Longest chain: ${c} passes this run. Aim for ${target} — set something off every pass.`;
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Picks the practise-next metric for `run` against `history` (oldest first, NOT including `run`).
 * With fewer than 3 runs of history, practises the weaker Overture-taught verb instead
 * (Many = groups per pass, Hold = overcharges).
 */
export function pickAdvice(run: RunMetrics, history: readonly RunMetrics[]): CoachAdvice {
  if (history.length < 3) {
    const many = run.groupsPerPassAvg / 2;
    const hold = run.overchargesLanded / 2;
    const metric: CoachMetric = hold <= many ? 'overchargesLanded' : 'groupsPerPassAvg';
    const current = run[metric];
    const target = Math.max(metric === 'overchargesLanded' ? 2 : 2, Math.floor(current) + 1);
    return { metric, current, target, text: adviceText(metric, current, target) };
  }
  const recent = history.slice(-10);
  let best: CoachMetric = 'groupsPerPassAvg';
  let bestDeficit = -Infinity;
  let bestMedian = 0;
  for (const m of COACH_METRICS) {
    const med = median(recent.map(r => r[m] ?? 0));
    // Relative shortfall against the player's own median; a zero median is measured against 1
    const deficit = (med - run[m]) / Math.max(1, med);
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = m;
      bestMedian = med;
    }
  }
  const current = run[best];
  const target = Math.max(Math.ceil(bestMedian * 1.25), Math.floor(current) + 1);
  return { metric: best, current, target, text: adviceText(best, current, target) };
}

export function loadHistory(): RunMetrics[] {
  const h = readJson<RunMetrics[]>(HISTORY_KEY, []);
  return Array.isArray(h) ? h : [];
}

/** Appends a run (capped at HISTORY_CAP) and returns the advice computed against prior history. */
export function recordRun(run: RunMetrics): CoachAdvice {
  const history = loadHistory();
  const advice = pickAdvice(run, history);
  history.push(run);
  while (history.length > HISTORY_CAP) history.shift();
  writeJson(HISTORY_KEY, history);
  return advice;
}
