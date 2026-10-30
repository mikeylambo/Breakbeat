import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { TUNING } from '../build/src/tuning.js';
import { engineFor, replayOf, simulate } from '../build/src/pulse/Replay.js';
import { remixRules, twistFor } from '../build/src/meta/Remix.js';

const ROWS = TUNING.BOARD_ROWS;
const make = cfg => new PulseEngine({ seed: 'remix-test', mode: 'remix', bpm: 120, colorCount: 4, ...cfg }, new GemRules('brick'));
const run = (e, bars) => { for (let s = 16; s <= bars * 16; s += 16) e.advanceToStep(s); };
const rowsUsed = e => e.board.map((r, i) => (r.some(Boolean) ? i : -1)).filter(i => i >= 0);

test('a flipped wall is dealt from the ceiling', () => {
  const e = make({ pressureFrom: 'top' });
  assert.deepEqual(rowsUsed(e), [0, 1, 2, 3, 4]);
});

test('a flipped wall pushes new rows down from the top', () => {
  const e = make({ pressureFrom: 'top', riseBars: 1 });
  run(e, 3);
  assert.ok(e.telemetry.pressurePushes >= 1);
  assert.equal(rowsUsed(e)[0], 0);
  assert.ok(rowsUsed(e).length > 5);
});

test('blocks fall up: a gap closes toward the ceiling', () => {
  const e = make({ pressureFrom: 'top', pressureEnabled: false });
  for (const row of e.board) row.fill(null);
  const put = (id, c, r, kind) => (e.board[r][c] = { id, col: c, row: r, kind, special: 'none' });
  put(9001, 0, 0, 0); // anchor on the ceiling
  put(9002, 0, 1, 1); // a magenta pair, about to go
  put(9003, 1, 1, 1);
  put(9004, 0, 2, 2); // hangs under the pair
  put(9005, 1, 0, 3);
  e.primeAt(0, 1);
  run(e, 3);
  assert.equal(e.findTileById(9002), null);
  assert.equal(e.findTileById(9001)?.row, 0);
  // Under downward gravity it would stay at row 2; flipped, it rises into the gap
  assert.equal(e.findTileById(9004)?.row, 1);
});

test('a flipped wall tops out at the floor, and danger is counted at the bottom', () => {
  const e = make({ pressureFrom: 'top', riseBars: 1, initialRows: ROWS - TUNING.DANGER_ROWS });
  run(e, 6);
  assert.ok(e.dangerLevel > 0 || e.gameOver);
  run(e, 40);
  assert.equal(e.gameOver, true);
  assert.equal(e.gameOverReason, 'overflow');
});

test('a flipped run replays exactly (ghosts), and older replays still mean a bottom wall', () => {
  const e = make({ pressureFrom: 'top', riseBars: 2 });
  for (let bar = 1; bar <= 16 && !e.gameOver; bar++) {
    e.advanceToStep(bar * 16 + 3);
    const r = e.board.findIndex(row => row.some(Boolean));
    if (r >= 0) e.primeAt(e.board[r].findIndex(Boolean), r);
  }
  const rep = replayOf(e);
  assert.equal(rep.flip, true);
  const sim = simulate(rep, new GemRules('brick'));
  assert.equal(sim.score, e.telemetry.score);
  const legacy = { ...rep };
  delete legacy.flip;
  assert.equal(engineFor(legacy, new GemRules('brick')).config.pressureFrom, 'bottom');
});

test('every B-side twist changes its movement', () => {
  const tracks = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks.filter(t => t.id !== 'overture');
  const seen = new Set();
  tracks.forEach((t, i) => {
    const r = remixRules(t, i);
    seen.add(r.twist);
    assert.ok(r.flip || r.colors !== t.colors || r.riseBars !== t.riseBars, `${t.id}: ${r.twist} changes nothing`);
    assert.equal(twistFor(t, i), r.twist);
  });
  assert.deepEqual([...seen].sort(), ['double', 'five', 'flip']);
});
