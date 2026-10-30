import test from 'node:test';
import assert from 'node:assert/strict';

import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { TUNING } from '../build/src/tuning.js';

/** Advances bar by bar (a jump over 32 steps counts as a stall and is skipped). */
const run = (e, bars) => { for (let s = 16; s <= bars * 16; s += 16) e.advanceToStep(s); };
const make = cfg => new PulseEngine({ seed: 'practice-test', mode: 'practice', bpm: 120, colorCount: 4, ...cfg }, new GemRules('brick'));
const filledRows = e => e.board.filter(r => r.some(Boolean)).length;

test('the default deal is the rules\' initial rows', () => {
  assert.equal(filledRows(make({})), TUNING.INITIAL_ROWS);
});

test('Under pressure deals one push from the danger line', () => {
  const rows = TUNING.BOARD_ROWS - TUNING.DANGER_ROWS - 1;
  assert.equal(filledRows(make({ initialRows: rows })), rows);
  // Never into the danger rows, whatever is asked
  assert.equal(filledRows(make({ initialRows: 99 })), TUNING.BOARD_ROWS - TUNING.DANGER_ROWS);
});

test('a steady rise keeps its cadence past the tighten bar', () => {
  const steady = make({ riseBars: 2, steadyRise: true, pressureEnabled: false });
  const normal = make({ riseBars: 2, pressureEnabled: false });
  run(steady, TUNING.RISE_TIGHTEN_BAR + 4);
  run(normal, TUNING.RISE_TIGHTEN_BAR + 4);
  assert.equal(steady.effectiveRiseBars, 2);
  assert.equal(normal.effectiveRiseBars, 1);
});

test('a still wall never rises', () => {
  const e = make({ pressureEnabled: false, initialRows: 3 });
  run(e, 20);
  assert.ok(e.currentBar >= 20);
  assert.equal(e.gameOver, false);
  assert.equal(filledRows(e), 3);
  assert.equal(e.barsUntilNextPush, null);
});
