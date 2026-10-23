import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { EtudeRun } from '../build/src/meta/Etude.js';
import { encodeEtude, decodeEtude, verify, solutionOf, etudeEngine } from '../build/src/meta/EtudeCode.js';

const rules = () => new GemRules('brick');
const { etudes } = JSON.parse(fs.readFileSync('content/etudes.json', 'utf8'));
const { drills } = JSON.parse(fs.readFileSync('content/drills.json', 'utf8'));

/** Solves an authored puzzle the way the ETUDES gate does, on the shared-etude engine, logging. */
function solve(et, bpm) {
  const e = etudeEngine(et, bpm, rules());
  const run = new EtudeRun(et);
  const act = p => {
    for (const a of et.solution.filter(x => x.pass === p)) {
      e.primeAt(a.col, a.row);
      if (a.hold) e.holdAt(a.col, a.row);
    }
  };
  act(1);
  for (let step = 0; step < (et.passes + 1) * 16 && run.state === 'playing'; step++) {
    e.advanceToStep(step);
    for (const ev of e.drainEvents()) run.onEvent(ev);
    run.check(e);
    if (step % 16 === 15) act(Math.floor(step / 16) + 2);
    for (const a of et.solution.filter(x => x.step === step)) e.primeAt(a.col, a.row);
  }
  assert.equal(run.state, 'won', `${et.name} solves`);
  return e;
}

test('every authored etude and drill survives encode -> decode -> verify', () => {
  for (const et of [...etudes, ...drills]) {
    const bpm = 116;
    const e = solve(et, bpm);
    const code = encodeEtude({ def: et, bpm, solution: solutionOf(e) });
    assert.ok(code.length < 700, `${et.name}: code ${code.length} chars`);
    assert.match(code, /^[A-Za-z0-9_-]+$/, 'URL safe');
    const back = decodeEtude(code);
    assert.equal(back.def.passes, et.passes);
    assert.deepEqual(back.def.goal.type, et.goal.type);
    assert.equal(back.def.pressure ?? 0, et.pressure ?? 0);
    assert.equal(back.def.charge ?? 0, et.charge ?? 0);
    assert.ok(verify(back, rules()), `${et.name}: the shared solution verifies`);
  }
});

test('a solution with a move removed no longer verifies (all-clear puzzles)', () => {
  let caught = 0;
  let tried = 0;
  for (const et of etudes.filter(x => x.goal.type === 'allclear')) {
    const e = solve(et, 120);
    const sol = solutionOf(e);
    if (sol.length < 2) continue;
    tried++;
    if (!verify({ def: et, bpm: 120, solution: sol.slice(0, -1) }, rules())) caught++;
  }
  assert.ok(tried >= 2 && caught === tried, `${caught}/${tried}`);
});

test('damaged, truncated and foreign codes are refused', () => {
  const et = etudes[0];
  const code = encodeEtude({ def: et, bpm: 120, solution: solutionOf(solve(et, 120)) });
  const flip = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.throws(() => decodeEtude(flip), /damaged/);
  assert.throws(() => decodeEtude(code.slice(0, 8)), /incomplete|damaged/);
  assert.throws(() => decodeEtude('not*a*code'), /bad char/);
});

test('names and hints are cleaned of markup', () => {
  const et = { ...etudes[0], name: '<img src=x onerror=alert(1)>Boss', hint: 'go "here" & there' };
  const back = decodeEtude(encodeEtude({ def: et, bpm: 120, solution: solutionOf(solve(etudes[0], 120)) }));
  assert.doesNotMatch(back.def.name + back.def.hint, /[<>"&]/);
  assert.ok(back.def.name.length <= 24 && back.def.name.startsWith('img src'), back.def.name);
});

test('an empty-handed share does not verify', () => {
  assert.equal(verify({ def: etudes[0], bpm: 120, solution: [] }, rules()), false);
});
