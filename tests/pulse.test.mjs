import test from 'node:test';
import assert from 'node:assert/strict';

import { TUNING, computeChainRank, computeResonanceMultiplier } from '../build/src/tuning.js';
import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { SKINS } from '../build/src/content/gems/Skins.js';

const R = TUNING.BOARD_ROWS;
const C = TUNING.BOARD_COLS;

function empty(engine) {
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) engine.board[r][c] = null;
}
let nextId = 10000;
function put(engine, col, row, kind) {
  engine.board[row][col] = { id: nextId++, col, row, kind, special: 'none' };
}

test('16x10 wall dimensions and initial deal', () => {
  const engine = new PulseEngine({ seed: 'init-test', mode: 'odyssey', bpm: 104 }, new GemRules('brick'));
  assert.equal(engine.board.length, 10);
  assert.equal(engine.board[0].length, 16);
  assert.equal(TUNING.BOARD_COLS, TUNING.SIXTEENTHS_PER_BAR);
  for (let r = 0; r < 5; r++) assert.equal(engine.board[r].every(t => t === null), true);
  for (let r = 5; r < 10; r++) assert.equal(engine.board[r].every(t => t !== null), true);
});

test('Tap to prime locks 2+ connected same-colour cluster and rejects singletons', () => {
  const engine = new PulseEngine({ seed: 'prime-test', mode: 'zen', bpm: 110 }, new GemRules('brick'));
  empty(engine);
  put(engine, 0, 9, 1);
  put(engine, 3, 9, 2);
  put(engine, 4, 9, 2);
  put(engine, 4, 8, 2);
  assert.equal(engine.primeAt(0, 9), null, 'Singleton must not prime');
  const group = engine.primeAt(3, 9);
  assert.ok(group);
  assert.equal(group.tileIds.length, 3);
  assert.equal(engine.primeAt(4, 9), null, 'Already locked group cannot be re-primed');
});

test('Collapse drops blocks and slides empty columns inward', () => {
  const rules = new GemRules('glass');
  const engine = new PulseEngine({ seed: 'collapse-test', mode: 'zen', bpm: 120 }, rules);
  empty(engine);
  put(engine, 1, 5, 0);
  const id = engine.board[5][1].id;
  const res = rules.collapse(engine.board, new Set());
  assert.equal(res.movedTileIds.includes(id), true);
  const centerLeft = Math.floor((C - 1) / 2);
  assert.equal(engine.board[R - 1][centerLeft]?.id, id);
});

test('Overcharge hold skips one pass and blasts 8-way neighbours on the next', () => {
  const engine = new PulseEngine({ seed: 'oc', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('obsidian'));
  empty(engine);
  put(engine, 4, 8, 0);
  put(engine, 4, 9, 0);
  put(engine, 5, 7, 3);
  put(engine, 6, 9, 1); // keep the wall non-empty after the blast
  engine.advanceToStep(0);
  assert.ok(engine.primeAt(4, 8));
  engine.holdAt(4, 8);
  engine.advanceToStep(15);
  assert.notEqual(engine.board[7][5], null);
  engine.advanceToStep(31);
  assert.equal(engine.telemetry.overchargesLanded, 1);
});

test('Ahead/behind: blade left of the group fires this pass; over/past queues for next pass', () => {
  for (let col = 0; col < C - 1; col++) {
    for (const blade of [col - 1, col, col + 1]) {
      if (blade < 0 || blade >= C) continue;
      const engine = new PulseEngine({ seed: 'ab', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
      empty(engine);
      put(engine, col, 9, 2);
      put(engine, col + 1, 9, 2);
      put(engine, 15, 8, 1); // sentinel tile so the wall never empties (no All Clear refill)
      engine.advanceToStep(blade);
      const g = engine.primeAt(col, 9);
      assert.ok(g);
      engine.drainEvents();
      engine.advanceToStep(15);
      const fired = engine.drainEvents().some(e => e.type === 'detonate');
      assert.equal(fired, blade < col, `col ${col} blade ${blade}`);
      if (!fired) {
        engine.advanceToStep(31);
        const ev = engine.drainEvents().find(e => e.type === 'detonate');
        assert.ok(ev, 'queued group fires next pass');
        assert.equal(ev.sixteenth, col, 'fires exactly as the blade reaches its leftmost column');
      }
    }
  }
});

test('Hold while queued behind the blade: Overcharged exactly 2 passes after priming', () => {
  const engine = new PulseEngine({ seed: 'hb', mode: 'zen', bpm: 120 }, new GemRules('brick'));
  empty(engine);
  put(engine, 3, 9, 2);
  put(engine, 4, 9, 2);
  put(engine, 12, 9, 1);
  engine.advanceToStep(8); // bar 1, blade past col 3
  const g = engine.primeAt(3, 9);
  assert.equal(g.state, 'queued');
  engine.holdAt(3, 9);
  engine.drainEvents();
  engine.advanceToStep(31); // bar 2: the pass it would have fired on is skipped
  assert.equal(engine.drainEvents().some(e => e.type === 'detonate'), false);
  engine.advanceToStep(47); // bar 3
  const ev = engine.drainEvents().find(e => e.type === 'detonate');
  assert.ok(ev && ev.overcharged);
  assert.equal(ev.bar, 3);
});

test('All Clear awards bonus x combo once and refills 3 rows on the next downbeat', () => {
  const engine = new PulseEngine({ seed: 'ac', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
  empty(engine);
  put(engine, 6, 9, 3);
  put(engine, 7, 9, 3);
  engine.primeAt(6, 9);
  engine.advanceToStep(15);
  const evs = engine.drainEvents().filter(e => e.type === 'allclear');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].points, TUNING.ALL_CLEAR_BONUS);
  assert.equal(engine.countBoardTiles(), 0);
  engine.advanceToStep(16);
  assert.equal(engine.countBoardTiles(), TUNING.ALL_CLEAR_REFILL_ROWS * C);
});

test('One Colour Left fires once per wall state, re-arms on a new colour, never on empty', () => {
  const engine = new PulseEngine({ seed: 'oc1', mode: 'endless', bpm: 120, riseBars: 1 }, new GemRules('brick'));
  empty(engine);
  put(engine, 2, 9, 0);
  put(engine, 3, 9, 0);
  put(engine, 9, 9, 1);
  put(engine, 10, 9, 1);
  put(engine, 12, 9, 1);
  engine.primeAt(2, 9);
  engine.advanceToStep(15);
  assert.equal(engine.drainEvents().filter(e => e.type === 'onecolour').length, 1);
  assert.equal(engine.telemetry.oneColourBonuses, 1);
  engine.advanceToStep(16); // pressure row brings colours back in, re-arms
  engine.drainEvents();
  assert.equal(engine.telemetry.oneColourBonuses, 1);
});

test('Danger level counts occupied rows among the top DANGER_ROWS rows', () => {
  const engine = new PulseEngine({ seed: 'dg', mode: 'endless', bpm: 120, riseBars: 1 }, new GemRules('brick'));
  empty(engine);
  put(engine, 0, 1, 0);
  put(engine, 0, 9, 1);
  engine.advanceToStep(0);
  assert.equal(engine.dangerLevel, 1);
  const ev = engine.drainEvents().find(e => e.type === 'danger');
  assert.equal(ev.level, 1);
});

test('Telemetry tracks passes with detonation and groups per pass', () => {
  const engine = new PulseEngine({ seed: 'tl', mode: 'zen', bpm: 120 }, new GemRules('brick'));
  empty(engine);
  put(engine, 2, 9, 0); put(engine, 3, 9, 0);
  put(engine, 6, 9, 1); put(engine, 7, 9, 1);
  put(engine, 14, 0, 2);
  engine.primeAt(2, 9);
  engine.primeAt(6, 9);
  engine.advanceToStep(16);
  assert.equal(engine.telemetry.passesWithDetonation, 1);
  assert.equal(engine.telemetry.groupsPerPassAvg, 2);
});

test('Skins, resonance and chain rank tables', () => {
  assert.equal(SKINS.length, 7);
  assert.equal(computeResonanceMultiplier(10), 5.0);
  assert.equal(computeChainRank(8), 4);
});
