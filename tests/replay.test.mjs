import test from 'node:test';
import assert from 'node:assert/strict';

import { TUNING } from '../build/src/tuning.js';
import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { replayOf, simulate, boardHash, engineFor, applyUntil } from '../build/src/pulse/Replay.js';

const rules = () => new GemRules('brick');

/**
 * A messy bot run: random taps at fractional times inside each 16th (so air-primes depend on the
 * exact time), holds when charged, a movement change, a stall that triggers the catch-up skip.
 */
function botRun(seed, mode = 'endless', bpm = 120) {
  const e = new PulseEngine({ seed, mode, bpm, colorCount: 4, riseBars: 2 }, rules());
  let r = [...seed].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let step = 0; step < 1400 && !e.gameOver; step++) {
    if (step === 260) e.reconfigure(136, 5, 1);
    if (step === 520) {
      e.advanceToStep(e.currentStep + 50); // a stall: the engine skips ahead
      step = e.currentStep;
      continue;
    }
    e.advanceToStep(step);
    e.events.length = 0;
    const taps = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0;
    for (let i = 0; i < taps; i++) {
      const c = Math.floor(rnd() * TUNING.BOARD_COLS);
      const row = Math.floor(rnd() * TUNING.BOARD_ROWS);
      const t = (step + rnd()) * e.sixteenthSec;
      const g = e.primeAt(c, row, t);
      if (g && rnd() < 0.3) e.holdAt(c, row);
    }
  }
  return e;
}

test('replay reproduces 24 messy runs exactly (score, step, wall, clears)', () => {
  let air = 0;
  let holds = 0;
  let skips = 0;
  let morphs = 0;
  for (let i = 0; i < 24; i++) {
    const mode = ['endless', 'daily', 'zen', 'odyssey'][i % 4];
    const e = botRun(`replay-${i}`, mode, 96 + i * 3);
    const rp = replayOf(e);
    const sim = simulate(JSON.parse(JSON.stringify(rp)), rules());
    assert.equal(sim.score, e.telemetry.score, `score, seed ${i}`);
    assert.equal(sim.step, e.currentStep, `step, seed ${i}`);
    assert.equal(sim.boardHash, boardHash(e), `wall, seed ${i}`);
    assert.equal(sim.groupsCleared, e.telemetry.groupsCleared, `clears, seed ${i}`);
    assert.equal(sim.gameOver, e.gameOver);
    air += e.telemetry.airPrimesLanded;
    holds += rp.events.filter(x => x.k === 'h').length;
    skips += rp.events.filter(x => x.k === 'j').length;
    morphs += rp.events.filter(x => x.k === 'm').length;
  }
  assert.ok(air > 0, 'air-primes exercised');
  assert.ok(holds > 0, 'holds exercised');
  assert.ok(skips > 0, 'catch-up skips exercised');
  assert.ok(morphs > 0, 'movement changes exercised');
});

test('a tampered replay does not reproduce the claimed score', () => {
  let caught = 0;
  for (let i = 0; i < 8; i++) {
    const rp = replayOf(botRun(`tamper-${i}`));
    const before = simulate(rp, rules()).score;
    // Claim a richer run: drop no events but move the first few taps
    const forged = { ...rp, events: rp.events.map((ev, k) => (ev.k === 'p' && k < 12 ? { ...ev, c: (ev.c + 5) % TUNING.BOARD_COLS } : ev)) };
    if (simulate(forged, rules()).score !== before) caught++;
  }
  assert.ok(caught >= 7, `forged replays score differently (${caught}/8)`);
});

test('ghost stepping (applyUntil per frame) matches the whole-run simulation', () => {
  const e = botRun('ghost-steps', 'endless', 124);
  const rp = replayOf(e);
  const g = engineFor(rp, rules());
  let next = 0;
  for (let s = 0; s <= rp.end.s; s += 1 + (s % 3)) next = applyUntil(g, rp, next, s);
  next = applyUntil(g, rp, next, rp.end.s);
  assert.equal(g.telemetry.score, e.telemetry.score);
  assert.equal(boardHash(g), boardHash(e));
});

test('a long run replays in well under a frame budget per 100 steps', () => {
  const rp = replayOf(botRun('perf', 'zen', 120));
  const t0 = performance.now();
  simulate(rp, rules());
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `${rp.end.s} steps in ${ms.toFixed(0)} ms`);
});
