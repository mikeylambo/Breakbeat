import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { TUNING } from '../build/src/tuning.js';
import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { replayOf } from '../build/src/pulse/Replay.js';
import { verifyDaily, dailyStart } from '../build/src/meta/DailyVerify.js';

const MOVEMENTS = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks.filter(t => t.id !== 'overture');
const TRACKS = MOVEMENTS.map(t => ({ bpm: t.bpm, colors: t.colors, rise: t.riseBars, quota: t.quota }));
const DAY = '2026-10-23';
const rules = () => new GemRules('brick');

/** An honest Daily the way App plays it: quota reached -> next movement on the next downbeat. */
function daily(seed = 1, steps = 2600) {
  let mv = dailyStart(DAY, TRACKS.length);
  const t = TRACKS[mv];
  const e = new PulseEngine({ seed: `daily-${DAY}`, mode: 'daily', bpm: t.bpm, colorCount: t.colors, riseBars: t.rise }, rules());
  let r = seed * 2654435761 >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  let start = 0;
  let morphAt = -1;
  for (let step = 0; step < steps && !e.gameOver; step++) {
    if (morphAt >= 0 && step >= morphAt) {
      mv = (mv + 1) % TRACKS.length;
      const n = TRACKS[mv];
      e.reconfigure(n.bpm, n.colors, n.rise);
      start = e.telemetry.score;
      morphAt = -1;
    }
    e.advanceToStep(step);
    e.events.length = 0;
    // A decent player: tries several cells a step
    for (let k = 0; k < 4; k++) {
      const c = Math.floor(rnd() * TUNING.BOARD_COLS);
      const row = 3 + Math.floor(rnd() * (TUNING.BOARD_ROWS - 3));
      e.primeAt(c, row, (step + rnd()) * e.sixteenthSec);
    }
    if (morphAt < 0 && e.telemetry.score - start >= TRACKS[mv].quota) morphAt = (Math.floor(step / 16) + 2) * 16;
  }
  return e;
}

test('an honest Daily verifies to its exact score, movement changes included', () => {
  const e = daily(3);
  const rp = replayOf(e);
  assert.ok(rp.events.some(x => x.k === 'm'), 'the run changed movement');
  const v = verifyDaily(JSON.parse(JSON.stringify(rp)), DAY, TRACKS, rules());
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.score, Math.round(e.telemetry.score));
  assert.equal(v.bars, e.currentBar);
});

test('the claimed score is ignored: the server keeps its own', () => {
  const rp = replayOf(daily(4));
  const v = verifyDaily({ ...rp, end: { ...rp.end, score: 9_999_999 } }, DAY, TRACKS, rules());
  assert.equal(v.ok, true);
  assert.ok(v.score < 9_999_999);
});

test('forgeries are refused', () => {
  const rp = replayOf(daily(5));
  const cases = {
    'another day': { ...rp, seed: 'daily-2026-10-22' },
    'slower tempo': { ...rp, bpm: rp.bpm - 10 },
    'fewer colours': { ...rp, colors: 3 },
    'no rising wall': { ...rp, events: [{ k: 'x', s: 0, on: false }, ...rp.events] },
    'early movement change': { ...rp, events: [{ k: 'm', s: 0, ...pick(rp) }, ...rp.events] },
    'too many skips': { ...rp, events: [0, 1, 2, 3].map(i => ({ k: 'j', s: i * 100, to: i * 100 + 40 })) },
    'off the wall': { ...rp, events: [{ k: 'p', s: 1, c: 17, r: 2 }] },
    'out of order': { ...rp, events: [{ k: 'p', s: 9, c: 1, r: 9 }, { k: 'p', s: 3, c: 1, r: 9 }] },
    'too long': { ...rp, end: { s: 999999, score: 0 } }
  };
  for (const [name, forged] of Object.entries(cases)) {
    const v = verifyDaily(forged, DAY, TRACKS, rules());
    assert.equal(v.ok, false, name);
  }
});

function pick(rp) {
  const m = rp.events.find(x => x.k === 'm');
  return { bpm: m.bpm, colors: m.colors, rise: m.rise };
}
