import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ACHIEVEMENTS, evaluate, noteDaily } from '../build/src/meta/Achievements.js';

const movements = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks.filter(t => t.id !== 'overture').map(t => ({ id: t.id, act: t.act }));
const stats = { playSec: 0, groups: 0, tiles: 0, allClears: 0, overcharges: 0, airPrimes: 0, bestChain: 0, bestPass: 0 };
const save = () => ({ v: 1, overtureDone: false, cleared: [], best: {}, daily: { date: '', best: 0 }, runs: 0, stars: {}, stats: { ...stats }, equipped: { blade: 'auto', shard: 'auto' }, etudes: [], achievements: [], counters: {} });
const ctx = (s, extra = {}) => ({ save: s, movements, rankOf: x => (x >= 80000 ? 'RESONANT' : x >= 30000 ? 'GOLD' : 'BRONZE'), ...extra });
const tele = (o = {}) => ({ score: 0, bestPassScore: 0, bestPassGroups: 0, longestCombo: 0, groupsCleared: 0, blocksCleared: 0, overchargesLanded: 0, airPrimesLanded: 0, barsSurvived: 0, pressurePushes: 0, passesWithDetonation: 0, groupsPerPassAvg: 0, allClears: 0, oneColourBonuses: 0, ...o });

test('41 achievements, unique ids, every progress readout works on an empty save', () => {
  assert.equal(ACHIEVEMENTS.length, 41);
  assert.equal(new Set(ACHIEVEMENTS.map(a => a.id)).size, 41);
  const s = save();
  for (const a of ACHIEVEMENTS) if (a.progress) assert.ok(Array.isArray(a.progress(ctx(s))), a.id);
  assert.deepEqual(evaluate(ctx(s)), []);
});

test('a run unlocks what it earned, once', () => {
  const s = save();
  s.stats.groups = 12;
  const run = { mode: 'endless', score: 52000, bars: 50, seconds: 300, t: tele({ bestPassGroups: 4, longestCombo: 6 }), myBeat: false };
  const got = evaluate(ctx(s, { run })).map(a => a.id).sort();
  assert.deepEqual(got, ['bars-48', 'chain-6', 'first-break', 'resonance-4', 'score-50k']);
  assert.deepEqual(evaluate(ctx(s, { run })), [], 'never twice');
});

test('save-based, counters and moments', () => {
  const s = save();
  s.cleared = movements.filter(m => m.act === 'I').map(m => m.id);
  s.best.ignition = 31000;
  for (const d of ['2026-10-01', '2026-10-01', '2026-10-02']) noteDaily(s, d);
  assert.equal(s.counters.dailyDays, 2, 'one count per day');
  const got = evaluate(ctx(s, { moment: 'board' })).map(a => a.id).sort();
  assert.deepEqual(got, ['act-1', 'board', 'daily', 'gold']);
});
