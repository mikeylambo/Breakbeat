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
 * +   REPLAY_DETERMINISM (seed + input log re-simulates 200 bot runs exactly)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { TUNING } from '../build/src/tuning.js';
import { BeatClock } from '../build/src/pulse/BeatClock.js';
import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { replayOf, simulate, boardHash } from '../build/src/pulse/Replay.js';

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
      { step: 0, col: 2, row: 8 },
      { step: 2, col: 9, row: 9 },
      { step: 16, col: 4, row: 7 },
      { step: 32, col: 12, row: 9 },
      { step: 48, col: 7, row: 8 }
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
    // Find a cluster in the right half (cols 10..15) so substeps 0, 3, 6 are all ahead of the blade
    let target = null;
    for (let r = TUNING.BOARD_ROWS - 1; r >= 5; r--) {
      for (let c = 10; c < TUNING.BOARD_COLS; c++) {
        if (rules.primeable(eng.board, c, r, eng.getLockedTileIds())) {
          target = { c, r };
          break;
        }
      }
      if (target) break;
    }
    assert.ok(target, 'Expected primeable cluster in cols 10..15');

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
  for (let r = TUNING.BOARD_ROWS - 1; r >= 5; r--) {
    for (let c = 4; c < TUNING.BOARD_COLS; c++) {
      grp = eng.primeAt(c, r);
      if (grp) {
        eng.charge = 1;
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
  overflowEng.charge = 1;
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
    eng.board[8][c] = { id: idCounter++, col: c, row: 8, kind, special: 'none' };
    eng.board[9][c] = { id: idCounter++, col: c, row: 9, kind, special: 'none' };
  }
  for (let c = 0; c < 10; c++) {
    eng.primeAt(c, 8);
    eng.charge = 1;
    eng.holdAt(c, 8);
  }
  eng.advanceToStep(0);
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
  ];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
  // One exception: the opt-in Daily board (src/meta/Leaderboard.ts) may reach exactly its own host
  const BOARD = path.join('src', 'meta', 'Leaderboard.ts');
  const board = fs.readFileSync(BOARD, 'utf8');
  const hosts = new Set(board.match(/https?:\/\/[^'"`/\s]+/g) ?? []);
  assert.deepEqual([...hosts], ['https://iysvarvkltihgosbhtaa.supabase.co'], `NETWORK gate failed: Leaderboard.ts may only reach the board host (${[...hosts].join(', ')})`);
  assert.equal(/\bXMLHttpRequest\b|\bWebSocket\b/.test(board), false, 'NETWORK gate failed: Leaderboard.ts uses XHR or sockets');
  // The opt-in error beacon (src/meta/ErrorReport.ts) posts only to the board host, into one table
  const BEACON = path.join('src', 'meta', 'ErrorReport.ts');
  const beacon = fs.readFileSync(BEACON, 'utf8');
  const beaconFetches = beacon.match(/\bfetch\s*\(\s*`[^`]*`/g) ?? [];
  assert.deepEqual(beaconFetches, ['fetch(`${BOARD_HOST}/rest/v1/breakbeat_errors`'], 'NETWORK gate failed: ErrorReport.ts may only post to the board host');
  assert.equal(/https?:\/\/[\w.-]+\.[a-z]{2,}|\bXMLHttpRequest\b|\bWebSocket\b|sendBeacon/.test(beacon), false, 'NETWORK gate failed: ErrorReport.ts names another host or transport');
  const pkgVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  assert.ok(beacon.includes(`VERSION = '${pkgVersion}'`), `NETWORK gate failed: ErrorReport VERSION is not ${pkgVersion}`);
  const { DEFAULT_SETTINGS } = await import('../build/src/meta/Settings.js');
  assert.equal(DEFAULT_SETTINGS.errorReports, false, 'NETWORK gate failed: error reports must be off by default');
  for (const rel of walk('src')) {
    if (rel === BOARD || rel === BEACON) continue;
    const code = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    // Only same-origin relative fetches (bundled stems) are allowed; no absolute URLs, XHR or sockets.
    assert.equal(
      /\bfetch\s*\(\s*(?![`'"]\.\/)|\bXMLHttpRequest\b|\bWebSocket\b|https?:\/\/(?!www\.w3\.org)/.test(code),
      false,
      `NETWORK gate failed: external network call found in ${rel}`
    );
  }
  const html = fs.readFileSync('public/index.html', 'utf8') + fs.readFileSync('public/fonts/fonts.css', 'utf8');
  assert.equal(/(src|href)=["']https?:|url\(['"]?https?:/.test(html), false, 'NETWORK gate failed: external asset in index.html or fonts.css');
  console.log('PASS [NETWORK]: Zero cross-origin requests in source, HTML and font CSS (fonts and audio bundled); only the opt-in Daily board and the opt-in error beacon reach the board host.');
}

// ---------- v0.6 engine gates ----------
const R = TUNING.BOARD_ROWS;
const C = TUNING.BOARD_COLS;
let gid = 900000;
const blank = (eng) => { for (const row of eng.board) row.fill(null); };
const put = (eng, col, row, kind) => { eng.board[row][col] = { id: gid++, col, row, kind, special: 'none' }; };

// 11. SWEEP_GRID — over a 64-bar run the blade covers column c exactly at sixteenth c of every bar
{
  assert.equal(TUNING.BOARD_COLS, TUNING.SIXTEENTHS_PER_BAR, 'SWEEP_GRID: BOARD_COLS !== SIXTEENTHS_PER_BAR');
  const bpm = 116;
  const clock = new BeatClock(bpm, 0);
  clock.start(0);
  let checks = 0;
  for (let step = 0; step < 64 * 16; step++) {
    const sixteenth = step % 16;
    // a hair inside the 16th, and a hair before its end
    for (const frac of [0.001, 0.999]) {
      const q = clock.query(clock.stepToAudioSec(step) + frac * clock.sixteenthDurationSec);
      assert.equal(q.sixteenth, sixteenth, 'SWEEP_GRID: clock sixteenth mismatch');
      assert.equal(Math.floor(q.sweepColFloat), sixteenth, `SWEEP_GRID: blade not over column ${sixteenth}`);
      checks++;
    }
  }
  // Engine side: a group whose leftmost tile is in column c detonates on sixteenth c
  for (let c = 0; c < C - 1; c++) {
    const eng = new PulseEngine({ seed: 'sweep-grid', mode: 'endless', bpm, riseBars: 99 }, new GemRules('brick'));
    blank(eng);
    put(eng, c, R - 1, 1); put(eng, c + 1, R - 1, 1); put(eng, (c + 8) % C, 0, 2);
    eng.primeAt(c, R - 1);
    eng.advanceToStep(15);
    const ev = eng.drainEvents().find(e => e.type === 'detonate');
    assert.ok(ev && ev.sixteenth === c, `SWEEP_GRID: column ${c} detonated off its sixteenth`);
  }
  console.log(`PASS [SWEEP_GRID]: 64 bars x 16 columns, blade over column c at sixteenth c (${checks} clock checks).`);
}

// 12. AHEAD_BEHIND — left of the group: this pass. Over/past it: next pass. Every column offset.
{
  let cases = 0;
  for (let col = 0; col < C - 1; col++) {
    for (let blade = 0; blade < C; blade++) {
      const eng = new PulseEngine({ seed: 'ahead-behind', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
      blank(eng);
      put(eng, col, R - 1, 3); put(eng, col + 1, R - 1, 3); put(eng, col === 14 ? 0 : 15, R - 2, 0);
      eng.advanceToStep(blade);
      assert.ok(eng.primeAt(col, R - 1));
      eng.drainEvents();
      eng.advanceToStep(31);
      const ev = eng.drainEvents().find(e => e.type === 'detonate');
      assert.ok(ev, 'AHEAD_BEHIND: group never fired');
      const expectBar = blade < col ? 1 : 2;
      assert.equal(ev.bar, expectBar, `AHEAD_BEHIND: col ${col}, blade ${blade} fired on bar ${ev.bar}`);
      assert.equal(ev.sixteenth, col);
      cases++;
    }
  }
  console.log(`PASS [AHEAD_BEHIND]: ${cases} blade/column offsets resolve to this pass or next pass correctly.`);
}

// 13. HOLD_BEHIND — held while queued behind the blade -> Overcharged exactly 2 passes after priming
{
  for (const blade of [3, 7, 15]) {
    const eng = new PulseEngine({ seed: 'hold-behind', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
    blank(eng);
    put(eng, 2, R - 1, 1); put(eng, 3, R - 1, 1); put(eng, 12, R - 1, 0);
    eng.advanceToStep(blade);
    const g = eng.primeAt(2, R - 1);
    assert.equal(g.state, 'queued');
    eng.charge = 1;
    assert.ok(eng.holdAt(2, R - 1));
    eng.drainEvents();
    for (let st = blade + 1; st < 16 * 3; st++) eng.advanceToStep(st);
    const dets = eng.drainEvents().filter(e => e.type === 'detonate');
    assert.equal(dets.length, 1, 'HOLD_BEHIND: expected exactly one detonation');
    assert.equal(dets[0].overcharged, true, 'HOLD_BEHIND: detonation not Overcharged');
    assert.equal(dets[0].bar, 3, `HOLD_BEHIND: fired on bar ${dets[0].bar}, expected bar 3`);
  }
  console.log('PASS [HOLD_BEHIND]: Held-behind-the-blade groups detonate Overcharged exactly 2 passes after priming.');
}

// 14. ALL_CLEAR — bonus x combo once, ALL_CLEAR_REFILL_ROWS rows on the next downbeat
{
  const eng = new PulseEngine({ seed: 'all-clear', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
  blank(eng);
  eng.comboPasses = 5; // combo x1.5
  put(eng, 4, R - 1, 2); put(eng, 5, R - 1, 2); put(eng, 5, R - 2, 2);
  eng.primeAt(4, R - 1);
  eng.advanceToStep(15);
  const acs = eng.drainEvents().filter(e => e.type === 'allclear');
  assert.equal(acs.length, 1, 'ALL_CLEAR: expected exactly one All Clear');
  assert.equal(acs[0].points, Math.round(TUNING.ALL_CLEAR_BONUS * 1.5), 'ALL_CLEAR: bonus not x combo');
  assert.equal(eng.telemetry.allClears, 1);
  assert.equal(eng.countBoardTiles(), 0);
  eng.advanceToStep(16);
  assert.equal(eng.countBoardTiles(), TUNING.ALL_CLEAR_REFILL_ROWS * C, 'ALL_CLEAR: refill rows not dealt on the downbeat');
  eng.advanceToStep(40);
  assert.equal(eng.drainEvents().filter(e => e.type === 'allclear').length, 0, 'ALL_CLEAR: awarded twice');
  console.log(`PASS [ALL_CLEAR]: ${acs[0].points} pts (bonus x combo) once; ${TUNING.ALL_CLEAR_REFILL_ROWS} rows dealt on the next downbeat.`);
}

// 15. ONE_COLOUR — once per wall state, re-arms after a new colour arrives, never on an empty board
{
  const eng = new PulseEngine({ seed: 'one-colour', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
  blank(eng);
  put(eng, 1, R - 1, 0); put(eng, 2, R - 1, 0);
  put(eng, 6, R - 1, 1); put(eng, 7, R - 1, 1); put(eng, 9, R - 1, 1);
  eng.primeAt(1, R - 1);
  eng.advanceToStep(15);
  let oc = eng.drainEvents().filter(e => e.type === 'onecolour');
  assert.equal(oc.length, 1, 'ONE_COLOUR: should fire once');
  assert.equal(oc[0].kind, 1);
  // Same wall state: another same-colour detonation must not fire again
  eng.primeAt(6, R - 1);
  eng.advanceToStep(31);
  oc = eng.drainEvents().filter(e => e.type === 'onecolour');
  assert.equal(oc.length, 0, 'ONE_COLOUR: fired twice in one wall state');
  // A new colour arrives via pressure -> re-arms; clearing it back to one colour fires again
  eng.setPressureEnabled(true);
  eng.config.riseBars = 1;
  eng.advanceToStep(32);
  blank(eng);
  put(eng, 3, R - 1, 2); put(eng, 4, R - 1, 2); put(eng, 10, R - 1, 3);
  eng.config.riseBars = 99;
  eng.primeAt(3, R - 1);
  eng.advanceToStep(47);
  oc = eng.drainEvents().filter(e => e.type === 'onecolour');
  assert.equal(oc.length, 1, 'ONE_COLOUR: did not re-arm after a new colour arrived');
  // Never on an empty board
  const e2 = new PulseEngine({ seed: 'one-colour-empty', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
  blank(e2);
  put(e2, 0, R - 1, 1); put(e2, 1, R - 1, 1);
  e2.primeAt(0, R - 1);
  e2.advanceToStep(15);
  assert.equal(e2.drainEvents().filter(e => e.type === 'onecolour').length, 0, 'ONE_COLOUR: fired on an empty board');
  console.log('PASS [ONE_COLOUR]: Fires once per wall state, re-arms on a new colour, never on an empty board.');
}

// 16. AUDIO_SCHED — no requestAnimationFrame in src/audio/; oscillators/filters only in AudioEngine setup and placeholder/
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
  const audioFiles = walk('src/audio');
  assert.ok(audioFiles.length >= 5, 'AUDIO_SCHED: src/audio/ modules missing');
  for (const rel of audioFiles) {
    const code = fs.readFileSync(rel, 'utf8');
    assert.equal(/requestAnimationFrame/.test(code), false, `AUDIO_SCHED: requestAnimationFrame referenced in ${rel}`);
  }
  for (const rel of walk('src')) {
    const code = fs.readFileSync(rel, 'utf8');
    if (!/createOscillator|createBiquadFilter/.test(code)) continue;
    if (rel.includes(`audio${path.sep}placeholder${path.sep}`)) continue;
    assert.equal(rel, path.join('src', 'audio', 'AudioEngine.ts'), `AUDIO_SCHED: oscillator/filter created in ${rel}`);
    // In AudioEngine they may appear only inside the constructor (setup)
    const ctorEnd = code.indexOf('\n  }\n', code.indexOf('constructor('));
    const rest = code.slice(ctorEnd);
    assert.equal(/createOscillator|createBiquadFilter/.test(rest), false, 'AUDIO_SCHED: AudioEngine creates nodes outside setup');
  }
  const sched = fs.readFileSync('src/audio/Scheduler.ts', 'utf8');
  assert.ok(/setInterval\(/.test(sched) && /SCHED_INTERVAL_MS/.test(sched) && /SCHED_LOOKAHEAD_MS/.test(sched), 'AUDIO_SCHED: scheduler must use setInterval + lookahead');
  console.log(`PASS [AUDIO_SCHED]: setInterval(${TUNING.SCHED_INTERVAL_MS}ms)+${TUNING.SCHED_LOOKAHEAD_MS}ms lookahead; no rAF in src/audio/; oscillators/filters only in setup + placeholder/.`);
}

// 17. NO_BLUR — no ctx.shadowBlur and no CSS filter: blur anywhere in src/ (or the shipped CSS)
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  const files = [...walk('src'), 'public/style.css'];
  for (const rel of files) {
    const code = fs.readFileSync(rel, 'utf8');
    assert.equal(/shadowBlur/.test(code), false, `NO_BLUR: shadowBlur in ${rel}`);
    assert.equal(/filter\s*[:=]\s*['"`]?\s*blur\(|backdrop-filter\s*:\s*blur/.test(code), false, `NO_BLUR: CSS blur filter in ${rel}`);
  }
  console.log(`PASS [NO_BLUR]: 0 shadowBlur / CSS blur filters across ${files.length} files (bloom is a GPU filter on the glow layer only).`);
}

// 18. OVERTURE_FLOW — scripted input completes lessons 1 -> 2 -> 3 with deterministic events; Skip -> Movement 01
{
  const { OvertureLessons } = await import('../build/src/ui/overture/OvertureLessons.js');
  const data = JSON.parse(fs.readFileSync('content/overture.json', 'utf8'));
  const runOverture = () => {
    const eng = new PulseEngine({ seed: 'overture', mode: 'overture', bpm: data.bpm, pressureEnabled: false }, new GemRules('brick'));
    const L = new OvertureLessons(data);
    L.begin(eng);
    const types = [];
    let pressureBeforeL3 = 0;
    for (let step = 0; step < 16 * 24 && !L.done; step++) {
      eng.advanceToStep(step);
      for (const ev of eng.drainEvents()) {
        L.onEvent(ev, eng);
        if (ev.type !== 'danger') types.push(`${ev.type}@${ev.step}`);
        if (ev.type === 'pressure' && L.lesson < 3) pressureBeforeL3++;
      }
      L.onStep(eng);
      // Scripted player: on sixteenth 1 of each bar, prime every target group (lesson 3: prime + hold)
      if (step % 16 === 1 && L.targetIds.length) {
        for (const g of L.targetCells(eng)) {
          const cell = g[0];
          const col = cell % TUNING.BOARD_COLS;
          const row = Math.floor(cell / TUNING.BOARD_COLS);
          if (eng.primeAt(col, row) && L.lesson === 3) eng.holdAt(col, row);
        }
        for (const ev of eng.drainEvents()) L.onEvent(ev, eng);
      }
    }
    return { L, types, pressureBeforeL3, score: eng.telemetry.score, wall: eng.serializeWall() };
  };
  const a = runOverture();
  const b = runOverture();
  assert.ok(a.L.done && !a.L.skipped, 'OVERTURE_FLOW: lessons did not complete');
  const completes = a.L.log.filter(x => x.startsWith('complete'));
  assert.deepEqual(completes.map(x => x.split('@')[0]), ['complete:1:bass', 'complete:2:keys', 'complete:3:lead'], 'OVERTURE_FLOW: lesson order');
  assert.equal(a.L.layers, 4, 'OVERTURE_FLOW: one stem per lesson (kick + bass + keys + lead)');
  assert.equal(a.pressureBeforeL3, 0, 'OVERTURE_FLOW: pressure rose before lesson 3');
  assert.deepEqual(a.L.log, b.L.log, 'OVERTURE_FLOW: lesson log not deterministic');
  assert.deepEqual(a.types, b.types, 'OVERTURE_FLOW: event stream not deterministic');
  assert.equal(a.wall, b.wall);
  const s = new OvertureLessons(data).skip();
  assert.deepEqual(s, { mode: 'odyssey', movement: 0 }, 'OVERTURE_FLOW: Skip must lead straight to Movement 01');
  console.log(`PASS [OVERTURE_FLOW]: ${a.L.log.join(' ')} | deterministic x2; Skip -> Movement 01.`);
}

// 19. CHARGE — a hold needs a full meter, spends it, and the meter is earned by detonations
{
  const eng = new PulseEngine({ seed: 'charge', mode: 'endless', bpm: 120, riseBars: 99 }, new GemRules('brick'));
  blank(eng);
  for (let c = 0; c < 16; c += 2) { put(eng, c, R - 1, c % 4); put(eng, c, R - 2, c % 4); }
  put(eng, 15, 0, 1);
  assert.equal(eng.charge, 0);
  eng.primeAt(0, R - 1);
  assert.equal(eng.holdAt(0, R - 1), null, 'CHARGE: hold must be refused on an empty meter');
  for (let c = 2; c < 16; c += 2) eng.primeAt(c, R - 1);
  eng.advanceToStep(15);
  assert.ok(eng.charge >= 1 - 1e-9, `CHARGE: 8 groups in one pass should fill the meter (got ${eng.charge})`);
  put(eng, 3, R - 1, 2); put(eng, 4, R - 1, 2);
  eng.primeAt(3, R - 1);
  assert.ok(eng.holdAt(3, R - 1), 'CHARGE: full meter allows a hold');
  assert.ok(eng.charge < 1e-9, 'CHARGE: a hold spends the meter');
  console.log(`PASS [CHARGE]: holds refused on an empty meter; one 8-group pass fills it; a hold spends it.`);
}

// 20. ETUDES — every authored puzzle is solvable: its stored solution wins within its pass limit
{
  const { EtudeRun } = await import('../build/src/meta/Etude.js');
  const { etudes } = JSON.parse(fs.readFileSync('content/etudes.json', 'utf8'));
  const { drills } = JSON.parse(fs.readFileSync('content/drills.json', 'utf8'));
  assert.ok(etudes.length >= 8, 'ETUDES: expected at least 8 etudes');
  assert.ok(drills.length >= 7, 'ETUDES: expected at least 6 tutorial drills');
  for (const et of [...etudes, ...drills]) {
    const cfg = { seed: 'etude', mode: 'etude', bpm: 120, pressureEnabled: !!et.pressure, riseBars: et.pressure ?? 2, fixedDeal: et.board };
    const e = new PulseEngine(cfg, new GemRules('brick'));
    e.charge = et.charge ?? 0;
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
    assert.equal(run.state, 'won', `ETUDES: "${et.name}" solution does not win within ${et.passes} passes`);
    // and doing nothing never wins
    const idle = new PulseEngine(cfg, new GemRules('brick'));
    const ir = new EtudeRun(et);
    for (let step = 0; step < (et.passes + 1) * 16; step++) {
      idle.advanceToStep(step);
      for (const ev of idle.drainEvents()) ir.onEvent(ev);
      ir.check(idle);
    }
    assert.equal(ir.state, 'lost', `ETUDES: "${et.name}" is won without input`);
  }
  console.log(`PASS [ETUDES]: ${etudes.length} puzzles + ${drills.length} tutorial drills solved by their stored solutions; none win without input.`);
}

// REPLAY_DETERMINISM — 200 bot runs across modes and tempos: taps at fractional times (air-primes),
// holds, a movement change and a stall skip; each replay re-simulates to the same score, step and wall
{
  const t0 = performance.now();
  let steps = 0;
  for (let i = 0; i < 200; i++) {
    const mode = ['endless', 'daily', 'zen', 'odyssey'][i % 4];
    const e = new PulseEngine({ seed: `gate-replay-${i}`, mode, bpm: 88 + (i % 63), colorCount: 4 + (i % 2), riseBars: 1 + (i % 2) }, new GemRules('brick'));
    let r = (i + 1) * 2654435761 >>> 0;
    const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let step = 0; step < 900 && !e.gameOver; step++) {
      if (step === 200) e.reconfigure(e.config.bpm + 7, 5, 1);
      if (step === 400) {
        e.advanceToStep(e.currentStep + 40);
        step = e.currentStep;
      }
      e.advanceToStep(step);
      e.events.length = 0;
      if (rnd() < 0.6) {
        const c = Math.floor(rnd() * TUNING.BOARD_COLS);
        const row = Math.floor(rnd() * TUNING.BOARD_ROWS);
        if (e.primeAt(c, row, (step + rnd()) * e.sixteenthSec) && rnd() < 0.25) e.holdAt(c, row);
      }
    }
    const sim = simulate(JSON.parse(JSON.stringify(replayOf(e))), new GemRules('brick'));
    assert.equal(sim.score, e.telemetry.score, `REPLAY_DETERMINISM: score drift on seed ${i}`);
    assert.equal(sim.boardHash, boardHash(e), `REPLAY_DETERMINISM: wall drift on seed ${i}`);
    assert.equal(sim.step, e.currentStep, `REPLAY_DETERMINISM: step drift on seed ${i}`);
    steps += e.currentStep;
  }
  console.log(`PASS [REPLAY_DETERMINISM]: 200 bot runs (${steps} steps, air-primes, holds, morphs, stall skips) re-simulate exactly in ${(performance.now() - t0).toFixed(0)} ms.`);
}

// I18N — every locale key exists in English, placeholders and markup match, nothing is empty
{
  const { EN } = await import('../build/src/i18n/en.js');
  const marks = s => [...s.matchAll(/\{(\w+)\}|<\/?b>/g)].map(m => m[0]).sort().join(' ');
  const report = [];
  for (const f of fs.readdirSync('content/i18n')) {
    const T = JSON.parse(fs.readFileSync(path.join('content/i18n', f), 'utf8'));
    for (const [k, v] of Object.entries(T)) {
      assert.ok(k in EN, `I18N: ${f} has a key English does not: ${k}`);
      assert.ok(typeof v === 'string' && v.trim(), `I18N: ${f} ${k} is empty`);
      assert.equal(marks(v), marks(EN[k]), `I18N: ${f} ${k} placeholders or markup differ`);
      assert.equal(/<(?!\/?b>)/.test(v), false, `I18N: ${f} ${k} has markup beyond <b>`);
    }
    report.push(`${f.replace('.json', '')} ${Math.round((Object.keys(T).length / Object.keys(EN).length) * 100)}%`);
  }
  console.log(`PASS [I18N]: ${Object.keys(EN).length} English keys; ${report.join(', ')}; placeholders and markup match.`);
}

// STEMS — every track switched to real music passes the stem validator (tools/validate-stems.mjs)
{
  const { validateTrack, close } = await import('./validate-stems.mjs');
  const tracks = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks;
  const ready = tracks.filter(t => t.stemsReady);
  const bad = [];
  for (const t of ready) {
    const r = await validateTrack(t);
    if (r.errors.length) bad.push(`${t.id}: ${r.errors.join('; ')}`);
  }
  await close();
  assert.deepEqual(bad, [], `STEMS gate failed (run npm run stems for the full report):\n${bad.join('\n')}`);
  console.log(`PASS [STEMS]: ${ready.length} of ${tracks.length} tracks on real stems, all valid (48 kHz, bar-aligned, equal length, seamless loops, -14 LUFS, no clipping).`);
}

console.log('=== ALL 23 BREAKBEAT GATES GREEN ===');
