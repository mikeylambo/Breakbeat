import test from 'node:test';
import assert from 'node:assert/strict';

import { checkTrack, lufs, parseWav } from '../tools/stem-check.mjs';
import { wav } from '../tools/make-song.mjs';

const FS = 48000;
const TRACK = { id: 'test', bpm: 120, loopBars: 24, sections: [{ name: 'A', bars: 8 }, { name: 'B', bars: 8 }, { name: 'C', bars: 8 }] };

/** A clean five-stem movement: every hit decays inside its slot and the drone fits whole cycles in a bar (so it loops). */
function movement({ bpm = 120, rate = FS, shiftMs = 0, bars = 24 } = {}) {
  const n = Math.round((bars * 240 * rate) / bpm);
  const beat = (60 * rate) / bpm;
  const shift = Math.round((shiftMs / 1000) * rate);
  const mk = fill => {
    const x = new Float32Array(n);
    fill(x);
    return { rate, data: [x, x.slice()] };
  };
  const hit = (x, at, f, amp, decay) => {
    for (let i = 0; i < beat / 2 && at + i < n; i++) if (at + i >= 0) x[at + i] += amp * Math.sin((2 * Math.PI * f * i) / rate) * Math.exp(-i / rate / decay) * Math.min(1, (beat / 2 - i) / 200);
  };
  return {
    kick: mk(x => { for (let k = 0; k * beat < n; k++) hit(x, Math.round(k * beat) + shift, 55, 0.3, 0.06); }),
    bass: mk(x => { for (let k = 0; k * beat < n; k++) hit(x, Math.round(k * beat + beat / 2) + shift, 110, 0.25, 0.08); }),
    keys: mk(x => { const f = Math.round((220 * 240) / bpm) / (240 / bpm); for (let i = Math.max(0, shift); i < n; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / rate) * Math.min(1, i / 48); }),
    lead: mk(x => { for (let k = 0; k * beat < n; k += 2) hit(x, Math.round(k * beat) + shift, 880, 0.08, 0.05); }),
    top: mk(x => { let r = 3; for (let k = 0; k * beat / 4 < n; k++) { const at = Math.round((k * beat) / 4) + shift; for (let i = 0; i < 600 && at + i < n; i++) if (at + i >= 0) x[at + i] += 0.08 * (((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1) * Math.exp(-i / 120); } })
  };
}

/** Scales every stem so the mix lands on `target` LUFS. */
function level(stems, target = -14) {
  const mix = [0, 1].map(c => { const m = new Float32Array(stems.kick.data[0].length); for (const s of Object.values(stems)) s.data[c].forEach((v, i) => (m[i] += v)); return m; });
  const g = Math.pow(10, (target - lufs(mix, FS)) / 20);
  for (const s of Object.values(stems)) for (const ch of s.data) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return stems;
}

test('BS.1770 reference: a full-scale 1 kHz sine on both channels reads 0 LUFS (EBU Tech 3341)', () => {
  const x = new Float32Array(FS * 5).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS));
  assert.ok(Math.abs(lufs([x, x], FS)) < 0.05, String(lufs([x, x], FS)));
});

test('a clean movement passes with no errors', () => {
  const r = checkTrack(TRACK, level(movement()));
  assert.deepEqual(r.errors, []);
  assert.ok(Math.abs(r.metrics.lufs + 14) < 0.1);
  assert.ok(r.metrics.onGrid > 0.9, JSON.stringify(r.metrics));
});

test('wrong sample rate is an error', () => {
  const r = checkTrack(TRACK, level(movement({ rate: 44100 })));
  assert.ok(r.errors.some(e => e.includes('44100 Hz')), r.errors.join('\n'));
});

test('a stem of the wrong length is an error', () => {
  const s = level(movement());
  s.lead.data = s.lead.data.map(c => c.slice(0, c.length - 4800));
  const r = checkTrack(TRACK, s);
  assert.ok(r.errors.some(e => e.startsWith('lead:') && e.includes('long')), r.errors.join('\n'));
  assert.ok(r.errors.some(e => e.includes('differ in length')));
});

test('the wrong tempo is caught by the grid check', () => {
  const r = checkTrack({ ...TRACK, bpm: 127 }, level(movement({ bpm: 120, bars: 24 * 127 / 120 })));
  assert.ok(r.errors.some(e => e.includes('grid')), r.errors.join('\n'));
});

test('stems that start late are caught (not bar-aligned)', () => {
  const r = checkTrack(TRACK, level(movement({ shiftMs: 40 })));
  assert.ok(r.errors.some(e => e.includes('off the grid') || e.includes('grid')), r.errors.join('\n') + JSON.stringify(r.metrics));
  assert.ok(r.warnings.some(w => w.includes('silence')));
});

test('a click at a section loop is caught', () => {
  const s = level(movement());
  // A drone that does not complete whole cycles in a section: the wrap jumps
  for (const ch of s.keys.data) for (let i = 0; i < ch.length; i++) ch[i] = 0.2 * Math.sin((2 * Math.PI * 61.7 * i) / FS);
  const r = checkTrack(TRACK, s);
  assert.ok(r.errors.some(e => e.startsWith('keys: click')), r.errors.join('\n'));
});

test('clipping and loudness are errors', () => {
  const hot = level(movement(), -4);
  const r = checkTrack(TRACK, hot);
  assert.ok(r.errors.some(e => e.includes('clip')), r.errors.join('\n'));
  const quiet = checkTrack(TRACK, level(movement(), -23));
  assert.ok(quiet.errors.some(e => e.includes('LUFS')), quiet.errors.join('\n'));
});

test('WAV round trip: 16-bit PCM parses back at its rate and length', () => {
  const x = new Float32Array(4800).map((_, i) => 0.5 * Math.sin(i / 10));
  const p = parseWav(new Uint8Array(wav(x, FS)));
  assert.equal(p.rate, FS);
  assert.equal(p.data.length, 2);
  assert.equal(p.data[0].length, 4800);
  // make-song writes at 0.8 gain
  assert.ok(Math.abs(p.data[1][100] - x[100] * 0.8) < 1e-4);
});
