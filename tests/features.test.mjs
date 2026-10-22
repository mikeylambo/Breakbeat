import test from 'node:test';
import assert from 'node:assert/strict';

import { rms, follow, StemTracker, bandRanges, bandsFrom } from '../build/src/audio/featureMath.js';

const SR = 48000;
const FRAME = 1 / 60;

/** RMS of a 1024-sample block of a kick-like burst: loud for `onMs`, then silent. */
function kickBlock(t, beatSec, onMs = 60) {
  return (t % beatSec) * 1000 < onMs ? 0.35 : 0;
}

test('rms of a full-scale sine is 1/sqrt(2); silence is 0', () => {
  const b = new Float32Array(1024);
  for (let i = 0; i < b.length; i++) b[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
  assert.ok(Math.abs(rms(b) - Math.SQRT1_2) < 0.01);
  assert.equal(rms(new Float32Array(256)), 0);
});

test('follow: instant with zero tau, otherwise converges monotonically', () => {
  assert.equal(follow(0, 1, FRAME, 0, 0), 1);
  let v = 0;
  for (let i = 0; i < 60; i++) {
    const n = follow(v, 1, FRAME, 0.05, 0.5);
    assert.ok(n >= v && n <= 1);
    v = n;
  }
  assert.ok(v > 0.99);
});

test('StemTracker: one onset per kick at 120 BPM, envelope pumps, level normalises', () => {
  const tr = new StemTracker();
  const beatSec = 0.5;
  let onsets = 0;
  let prev = 0;
  let maxEnv = 0;
  let minEnvLate = 1;
  for (let f = 0; f < 60 * 8; f++) {
    const t = f * FRAME;
    tr.step(kickBlock(t, beatSec), FRAME);
    if (tr.onset > 0.39 && tr.onset > prev) onsets++;
    prev = tr.onset;
    if (t > 2) {
      maxEnv = Math.max(maxEnv, tr.env);
      minEnvLate = Math.min(minEnvLate, tr.env);
    }
  }
  assert.ok(onsets >= 15 && onsets <= 16, `16 kicks in 8 s, detected ${onsets}`);
  assert.ok(maxEnv > 0.8, `envelope peaks near 1 (${maxEnv.toFixed(2)})`);
  assert.ok(minEnvLate < 0.1, `envelope falls between kicks (${minEnvLate.toFixed(2)})`);
});

test('StemTracker: a quiet stem still reads full scale; noise below the floor reads 0', () => {
  const quiet = new StemTracker();
  for (let f = 0; f < 120; f++) quiet.step(0.06, FRAME);
  assert.ok(quiet.level > 0.95, `quiet stem normalised (${quiet.level})`);
  const hiss = new StemTracker();
  for (let f = 0; f < 120; f++) hiss.step(0.004, FRAME);
  assert.equal(hiss.level, 0);
  assert.equal(hiss.onset, 0);
});

test('StemTracker: a sustained pad never fires onsets after it settles', () => {
  const tr = new StemTracker();
  let late = 0;
  for (let f = 0; f < 300; f++) {
    tr.step(0.2, FRAME);
    if (f > 30 && tr.onset > 0.39) late++;
  }
  assert.equal(late, 0);
});

test('bandRanges: 16 contiguous, non-empty, increasing log bands', () => {
  const r = bandRanges(16, 1024, SR);
  assert.equal(r.length, 32);
  for (let b = 0; b < 16; b++) {
    assert.ok(r[b * 2 + 1] > r[b * 2], `band ${b} non-empty`);
    if (b > 0) assert.ok(r[b * 2] >= r[b * 2 - 2], `band ${b} ascending`);
  }
  // Low bands are narrow, high bands wide
  assert.ok(r[31] - r[30] > r[1] - r[0]);
  assert.ok(r[31] <= 1024);
});

test('bandsFrom: a single bin lights exactly its band', () => {
  const r = bandRanges(16, 1024, SR);
  const bytes = new Uint8Array(1024);
  const bin = r[10 * 2];
  bytes[bin] = 255;
  const out = new Float32Array(16);
  bandsFrom(bytes, r, out);
  for (let b = 0; b < 16; b++) {
    if (b === 10) assert.ok(out[b] > 0);
    else assert.equal(out[b], 0, `band ${b} dark`);
  }
});
