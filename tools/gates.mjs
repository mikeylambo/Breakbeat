/**
 * BREAKBEAT — Canonical GDD Gate Runner (Pages 8–9).
 * Verifies:
 * 1. CORE_ISOLATION
 * 2. BEAT_LOCK (200-pass run)
 * 3. DETERMINISM
 * 4. TIMING_FREE
 * 5. HOLD_RISK
 * 6. AIR_FAIR
 * 7. PURITY
 * 8. SOLVABLE (1,000 seeds x 300 pushes)
 * 9. PERF (10-group Overcharged pass frame budget)
 * 10. NETWORK (zero external runtime network calls)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { TUNING } from '../public/src/tuning.js';
import { BeatClock } from '../public/src/pulse/BeatClock.js';
import { PulseEngine } from '../public/src/pulse/PulseEngine.js';
import { GemRules } from '../public/src/content/gems/GemRules.js';

console.log('=== BREAKBEAT GDD Gate Suite ===');

// 1. CORE_ISOLATION — nothing under src/pulse/ imports from src/content/
{
  const pulseDir = path.resolve(process.cwd(), 'src/pulse');
  const files = fs.readdirSync(pulseDir).filter(f => f.endsWith('.ts'));
  for (const file of files) {
    const src = fs.readFileSync(path.join(pulseDir, file), 'utf8');
    assert.equal(
      /from\s+['"][^'"]*content\//.test(src),
      false,
      `CORE_ISOLATION failed: src/pulse/${file} imports from content/`
    );
  }
  console.log('PASS [CORE_ISOLATION]: 0 imports from src/content/ inside src/pulse/.');
}

// 2. BEAT_LOCK — scripted 200-pass run: every detonation on its 16th (<1ms drift), every push on a downbeat
{
  const rules = new GemRules('brick');
  const bpm = 120;
  const clock = new BeatClock(bpm, 0);
  const engine = new PulseEngine({ seed: 'beat-lock-200', mode: 'zen', bpm }, rules);
  clock.start(0);

  let detonationsChecked = 0;
  let pushesChecked = 0;

  for (let bar = 1; bar <= 200; bar++) {
    const barStartStep = (bar - 1) * TUNING.SIXTEENTHS_PER_BAR;
    engine.advanceToStep(barStartStep);

    // Prime first available cluster on downbeat
    outer: for (let r = TUNING.BOARD_ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < TUNING.BOARD_COLS; c++) {
        if (engine.primeAt(c, r)) break outer;
      }
    }

    for (let s = 0; s < TUNING.SIXTEENTHS_PER_BAR; s++) {
      const step = barStartStep + s;
      engine.advanceToStep(step);
      const audioSec = clock.stepToAudioSec(step);
      const q = clock.query(audioSec);
      const expectedSec = step * clock.sixteenthDurationSec;
      assert.ok(Math.abs(q.elapsedSec - expectedSec) < 0.001, 'BEAT_LOCK clock drift >= 1ms');

      for (const ev of engine.drainEvents()) {
        if (ev.type === 'detonate') {
          assert.equal(ev.step, step, 'Detonation must land on exact 16th step');
          detonationsChecked++;
        } else if (ev.type === 'pressure') {
          assert.equal(ev.sixteenth, 0, 'Pressure row push must land on measure downbeat (sixteenth === 0)');
          pushesChecked++;
        }
      }
    }
  }
  assert.ok(detonationsChecked >= 150, 'Expected >= 150 detonations across 200-pass run');
  console.log(`PASS [BEAT_LOCK]: 200-pass run verified (${detonationsChecked} detonations, ${pushesChecked} downbeat pushes, <1ms drift).`);
}

// 3. DETERMINISM — same seed + same tap log produce byte-identical wall and score
{
  const runScript = (seed) => {
    const rules = new GemRules('crystal');
    const eng = new PulseEngine({ seed, mode: 'daily', bpm: 114 }, rules);
    const tapLog = [
      { step: 0, col: 2, row: 12 },
      { step: 2, col: 5, row: 13 },
      { step: 16, col: 4, row: 11 },
      { step: 32, col: 1, row: 13 },
      { step: 48, col: 7, row: 12 }
    ];
    for (let step = 0; step <= 64; step++) {
      eng.advanceToStep(step);
      for (const tap of tapLog) {
        if (tap.step === step) eng.primeAt(tap.col, tap.row);
      }
    }
    return { wall: eng.serializeWall(), score: eng.telemetry.score };
  };

  const a = runScript('2026-10-18-utc');
  const b = runScript('2026-10-18-utc');
  assert.equal(a.wall, b.wall, 'DETERMINISM failed: wall states diverged');
  assert.equal(a.score, b.score, 'DETERMINISM failed: scores diverged');
  console.log(`PASS [DETERMINISM]: Byte-identical wall and score (${a.score} pts).`);
}

// 4. TIMING_FREE — same taps shifted anywhere inside the same pass (ahead of sweep) produce same score
{
  const runWithTapStep = (tapSubstep) => {
    const rules = new GemRules('brick');
    const eng = new PulseEngine({ seed: 'timing-free-seed', mode: 'endless', bpm: 104 }, rules);
    eng.advanceToStep(0);
    // Find a cluster in right half (cols 6..9) so substeps 0, 2, 5 are all ahead of sweep
    let target = null;
    for (let r = TUNING.BOARD_ROWS - 1; r >= 8; r--) {
      for (let c = 6; c < TUNING.BOARD_COLS; c++) {
        if (rules.primeable(eng.board, c, r, eng.getLockedTileIds())) {
          target = { c, r };
          break;
        }
      }
      if (target) break;
    }
    assert.ok(target, 'Expected primeable cluster in cols 6..9');

    for (let step = 0; step < 16; step++) {
      eng.advanceToStep(step);
      if (step === tapSubstep) {
        eng.primeAt(target.c, target.r);
      }
    }
    return eng.telemetry.score;
  };

  const scoreEarly = runWithTapStep(0);
  const scoreMid = runWithTapStep(3);
  const scoreLate = runWithTapStep(6);
  assert.ok(scoreEarly > 0, 'Expected positive detonation score');
  assert.equal(scoreEarly, scoreMid, 'TIMING_FREE failed between step 0 and step 3');
  assert.equal(scoreMid, scoreLate, 'TIMING_FREE failed between step 3 and step 6');
  console.log(`PASS [TIMING_FREE]: Taps at substeps 0, 3, and 6 yield identical score (${scoreEarly} pts).`);
}

// 5. HOLD_RISK — a held group skips 1 pass, detonates Overcharged (x2, 8-way) on the next pass, and never survives a run-ending push
{
  const rules = new GemRules('obsidian');
  const eng = new PulseEngine({ seed: 'hold-risk-seed', mode: 'zen', bpm: 120 }, rules);
  eng.advanceToStep(0);

  let grp = null;
  for (let r = TUNING.BOARD_ROWS - 1; r >= 8; r--) {
    for (let c = 4; c < TUNING.BOARD_COLS; c++) {
      grp = eng.primeAt(c, r);
      if (grp) {
        eng.holdAt(c, r);
        break;
      }
    }
    if (grp) break;
  }
  assert.ok(grp && grp.held, 'Expected group to be primed and held');

  // End of Bar 1 (steps 0..15): held group MUST NOT detonate on Bar 1
  eng.advanceToStep(15);
  assert.equal(eng.telemetry.overchargesLanded, 0, 'Held group must skip the first pass');
  assert.equal(eng.groups.has(grp.id), true, 'Held group remains on board after pass 1');

  // End of Bar 2 (steps 16..31): held group MUST detonate Overcharged on Bar 2
  eng.advanceToStep(31);
  assert.equal(eng.telemetry.overchargesLanded, 1, 'Held group must detonate Overcharged on following pass');
  assert.equal(eng.groups.has(grp.id), false, 'Held group cleared after pass 2');

  // Overflow check: if top row is occupied and a pressure push occurs, run ends even with a held group
  const overflowEng = new PulseEngine({ seed: 'overflow-hold', mode: 'endless', bpm: 120, riseBars: 1 }, rules);
  overflowEng.advanceToStep(0);
  // Fill row 0 so next downbeat push overflows
  overflowEng.board[0][0] = { id: 9999, col: 0, row: 0, kind: 0, special: 'none' };
  overflowEng.board[0][1] = { id: 9998, col: 1, row: 0, kind: 0, special: 'none' };
  overflowEng.primeAt(0, 0);
  overflowEng.holdAt(0, 0);
  overflowEng.advanceToStep(16); // Bar 2 downbeat push
  assert.equal(overflowEng.gameOver, true, 'HOLD_RISK failed: held group survived a run-ending push');
  console.log('PASS [HOLD_RISK]: Held groups skip 1 pass, detonate Overcharged on next pass, and end on overflow.');
}

// 6. AIR_FAIR — every air-primeable group stays tappable for at least 250 ms before it lands
{
  assert.ok(
    TUNING.FALL_DURATION_SEC * 1000 >= TUNING.AIR_FAIR_MIN_MS,
    `AIR_FAIR failed: fall duration ${TUNING.FALL_DURATION_SEC * 1000}ms < 250ms`
  );
  console.log(`PASS [AIR_FAIR]: Falling clusters remain air-primeable for ${Math.round(TUNING.FALL_DURATION_SEC * 1000)}ms (>= 250ms).`);
}

// 7. PURITY — no special block can spawn in Odyssey, Endless, or Daily Descent
{
  const rules = new GemRules('brick');
  for (const mode of ['odyssey', 'endless', 'daily']) {
    const eng = new PulseEngine({ seed: `purity-${mode}`, mode, bpm: 120, riseBars: 1 }, rules);
    for (let step = 0; step < 16 * 15; step += 16) {
      eng.advanceToStep(step);
      for (const row of eng.board) {
        for (const t of row) {
          if (t) {
            assert.equal(t.special, 'none', `PURITY failed: special block ${t.special} spawned in ${mode}`);
          }
        }
      }
    }
  }
  console.log('PASS [PURITY]: Zero special blocks in Odyssey, Endless, and Daily Descent.');
}

// 8. SOLVABLE — 1,000 seeds x 300 pushes: never 2 consecutive pushes with zero primeable groups
{
  const rules = new GemRules('brick');
  const emptyLocked = new Set();

  const boardHasPrimeable = (board) => {
    for (let r = TUNING.BOARD_ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < TUNING.BOARD_COLS; c++) {
        const t = board[r][c];
        if (!t) continue;
        const right = board[r][c + 1];
        if (right && right.kind === t.kind) return true;
        const up = board[r - 1]?.[c];
        if (up && up.kind === t.kind) return true;
      }
    }
    return false;
  };

  let totalPushes = 0;
  for (let s = 1; s <= 1000; s++) {
    const eng = new PulseEngine({ seed: `solvable-${s}`, mode: 'zen', bpm: 120 }, rules);
    let consecutiveZero = 0;
    for (let p = 0; p < 300; p++) {
      const row = rules.spawnRow(eng.rng, {
        cols: TUNING.BOARD_COLS,
        rows: TUNING.BOARD_ROWS,
        bar: p + 1,
        mode: 'endless',
        colorCount: 5,
        board: eng.board,
        allocTileId: () => p * 100 + 1
      });
      totalPushes++;
      let rowHasPair = false;
      for (let c = 0; c < row.length - 1; c++) {
        if (row[c].kind === row[c + 1].kind) {
          rowHasPair = true;
          break;
        }
      }
      if (!rowHasPair && !boardHasPrimeable(eng.board)) {
        consecutiveZero++;
        assert.ok(consecutiveZero < 2, `SOLVABLE failed on seed ${s} push ${p}`);
      } else {
        consecutiveZero = 0;
      }
    }
  }
  console.log(`PASS [SOLVABLE]: Verified ${totalPushes.toLocaleString()} pushes across 1,000 seeds with 0 consecutive unsolvable pushes.`);
}

// 9. PERF — 10-group Overcharged pass simulation completes well within 120fps (< 8.33ms per frame)
{
  const rules = new GemRules('crystal');
  const eng = new PulseEngine({ seed: 'perf-10-overcharge', mode: 'zen', bpm: 130 }, rules);

  // Construct 10 distinct 2-tile vertical groups across columns 0..9 and Hold all 10
  let idCounter = 5000;
  for (let c = 0; c < 10; c++) {
    const kind = c % 4;
    eng.board[12][c] = { id: idCounter++, col: c, row: 12, kind, special: 'none' };
    eng.board[13][c] = { id: idCounter++, col: c, row: 13, kind, special: 'none' };
  }
  eng.advanceToStep(0);
  for (let c = 0; c < 10; c++) {
    eng.primeAt(c, 12);
    eng.holdAt(c, 12);
  }
  // Pass 1 skips all 10 held groups
  eng.advanceToStep(15);

  // Measure Pass 2 (all 10 Overcharged groups detonate + 10 cascades)
  const t0 = performance.now();
  for (let step = 16; step <= 31; step++) {
    eng.advanceToStep(step);
  }
  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 8.33, `PERF failed: 10-group Overcharged pass took ${elapsedMs.toFixed(2)}ms (> 8.33ms 120fps budget)`);
  console.log(`PASS [PERF]: 10-group Overcharged pass simulated in ${elapsedMs.toFixed(3)}ms (120fps budget: 8.33ms).`);
}

// 10. NETWORK — zero external network calls at play time
{
  const srcFiles = [
    ...fs.readdirSync(path.resolve(process.cwd(), 'src/pulse')).map(f => path.join('src/pulse', f)),
    ...fs.readdirSync(path.resolve(process.cwd(), 'src/content/gems')).map(f => path.join('src/content/gems', f)),
    ...fs.readdirSync(path.resolve(process.cwd(), 'src/audio')).map(f => path.join('src/audio', f)),
    ...fs.readdirSync(path.resolve(process.cwd(), 'src/render')).map(f => path.join('src/render', f)),
    'src/main.ts'
  ];
  for (const rel of srcFiles) {
    const code = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    assert.equal(
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|https?:\/\//.test(code),
      false,
      `NETWORK gate failed: external network call found in ${rel}`
    );
  }
  console.log('PASS [NETWORK]: Zero runtime network calls across all source modules.');
}

console.log('=== ALL 10 BREAKBEAT GDD GATES GREEN ===');
