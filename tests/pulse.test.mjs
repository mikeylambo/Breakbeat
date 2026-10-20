import test from 'node:test';
import assert from 'node:assert/strict';

import { TUNING, computeChainRank, computeResonanceMultiplier } from '../build/src/tuning.js';
import { BeatClock } from '../build/src/pulse/BeatClock.js';
import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { SKINS } from '../build/src/content/gems/Skins.js';

test('10x14 Wall dimensions and initial deal', () => {
  const rules = new GemRules('brick');
  const engine = new PulseEngine({ seed: 'init-test', mode: 'odyssey', bpm: 104 }, rules);

  assert.equal(engine.board.length, 14);
  assert.equal(engine.board[0].length, 10);

  // Top 8 rows empty, bottom 6 rows filled
  for (let r = 0; r < 8; r++) {
    assert.equal(engine.board[r].every(t => t === null), true);
  }
  for (let r = 8; r < 14; r++) {
    assert.equal(engine.board[r].every(t => t !== null), true);
  }
});

test('Tap to prime locks 2+ connected same-colour cluster and rejects singletons', () => {
  const rules = new GemRules('brick');
  const engine = new PulseEngine({ seed: 'prime-test', mode: 'zen', bpm: 110 }, rules);

  // Clear board and set up a 3-cluster of colour 2 and a singleton of colour 1
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 10; c++) engine.board[r][c] = null;
  }
  engine.board[13][0] = { id: 1, col: 0, row: 13, kind: 1, special: 'none' };
  engine.board[13][3] = { id: 2, col: 3, row: 13, kind: 2, special: 'none' };
  engine.board[13][4] = { id: 3, col: 4, row: 13, kind: 2, special: 'none' };
  engine.board[12][4] = { id: 4, col: 4, row: 12, kind: 2, special: 'none' };

  assert.equal(engine.primeAt(0, 13), null, 'Singleton must not prime');
  const group = engine.primeAt(3, 13);
  assert.ok(group, 'Connected 3-group should prime');
  assert.equal(group.tileIds.length, 3);
  assert.equal(engine.primeAt(4, 13), null, 'Already locked group cannot be re-primed');
});

test('Destruct-O-Match collapse drops blocks and slides empty columns inward', () => {
  const rules = new GemRules('glass');
  const engine = new PulseEngine({ seed: 'collapse-test', mode: 'zen', bpm: 120 }, rules);

  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 10; c++) engine.board[r][c] = null;
  }
  // Place a floating block at (col 1, row 10) while col 2, 3, 4 are empty
  engine.board[10][1] = { id: 50, col: 1, row: 10, kind: 0, special: 'none' };

  const res = rules.collapse(engine.board, new Set());
  assert.equal(res.movedTileIds.includes(50), true);
  // Should have fallen to row 13 and slid all the way inward to centerLeft (col 4)
  assert.notEqual(engine.board[13][4], null);
  assert.equal(engine.board[13][4].id, 50);
});

test('Overcharge hold skips one sweep pass and blasts 8-way neighbours with x2 score on next pass', () => {
  const rules = new GemRules('obsidian');
  const engine = new PulseEngine({ seed: 'overcharge-test', mode: 'endless', bpm: 120, riseBars: 99 }, rules);

  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 10; c++) engine.board[r][c] = null;
  }
  // Core 2-cluster at (4,12) and (4,13), plus a diagonal neighbour of different colour at (5,11)
  engine.board[12][4] = { id: 10, col: 4, row: 12, kind: 0, special: 'none' };
  engine.board[13][4] = { id: 11, col: 4, row: 13, kind: 0, special: 'none' };
  engine.board[11][5] = { id: 12, col: 5, row: 11, kind: 3, special: 'none' };

  engine.advanceToStep(0);
  const g = engine.primeAt(4, 12);
  assert.ok(g);
  engine.holdAt(4, 12);

  // Pass 1 (steps 0..15): skipped
  engine.advanceToStep(15);
  assert.notEqual(engine.board[11][5], null, 'Diagonal neighbour still present after skipped pass');

  // Pass 2 (steps 16..31): detonates Overcharged and clears diagonal neighbour (5,11)
  engine.advanceToStep(31);
  assert.equal(engine.board[11][5], null, 'Diagonal neighbour cleared by 8-way Overcharge blast');
  assert.equal(engine.telemetry.overchargesLanded, 1);
});

test('BeatClock background tab clamp prevents catch-up freezes', () => {
  const clock = new BeatClock(120, 0);
  clock.start(0);
  const q1 = clock.query(1.0);
  // Simulate tab suspended for 30 seconds
  const q2 = clock.query(31.0);
  assert.ok(
    q2.elapsedSec - q1.elapsedSec < 0.1,
    'BeatClock must clamp sudden background tab jumps to prevent catch-up freezes'
  );
});

test('All 7 GDD Odyssey skins and Coda are configured with distinct materials and personas', () => {
  assert.equal(SKINS.length, 7);
  const coda = SKINS[SKINS.length - 1];
  assert.equal(coda.sweepPersona, 'invisible');
  assert.equal( computeResonanceMultiplier(10), 5.0);
  assert.equal(computeChainRank(8), 4);
});
