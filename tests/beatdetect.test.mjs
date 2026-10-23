import test from 'node:test';
import assert from 'node:assert/strict';

import { onsets, beatGrid, barEnergies, pickSections, chroma, detectKey, foldBpm, tapTempo } from '../build/src/audio/beatDetect.js';

const SR = 22050;

/**
 * A synthetic song: kick every beat (harder on the one, with a bass note), snare on 2 and 4, hats
 * on 8ths, and a sustained chord. `level(bar)` scales the chord and hats for section energy.
 */
function song({ bpm, seconds = 75, offset = 0.37, chord = [57, 60, 64], level = () => 1, seed = 1 }) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  let r = seed;
  const noise = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const beat = 60 / bpm;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const addTone = (t0, dur, f, amp, decay) => {
    const s0 = Math.floor(t0 * SR);
    const len = Math.floor(dur * SR);
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const t = i / SR;
      out[s0 + i] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / decay);
    }
  };
  const addNoise = (t0, dur, amp, hp) => {
    const s0 = Math.floor(t0 * SR);
    const len = Math.floor(dur * SR);
    let prev = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      if (s0 + i < 0) continue;
      const x = noise();
      const v = hp ? x - prev : x;
      prev = x;
      out[s0 + i] += amp * v * Math.exp(-(i / SR) / (dur / 3));
    }
  };
  for (let k = 0, t = offset; t < seconds; k++, t = offset + k * beat) {
    const inBar = k % 4;
    const bar = Math.floor(k / 4);
    const lv = level(bar);
    addTone(t, 0.18, inBar === 0 ? 55 : 62, inBar === 0 ? 0.9 : 0.45, 0.05);
    if (inBar === 0) addTone(t, beat * 1.5, 41.2, 0.35, 0.4);
    if (inBar === 1 || inBar === 3) addNoise(t, 0.12, 0.3, false);
    addNoise(t, 0.04, 0.12 * lv, true);
    addNoise(t + beat / 2, 0.04, 0.1 * lv, true);
  }
  // Chord pad
  for (const m of chord) {
    const f = hz(m);
    for (let i = 0; i < n; i++) {
      const bar = Math.floor(((i / SR - offset) / beat) / 4);
      out[i] += 0.05 * level(Math.max(0, bar)) * Math.sin((2 * Math.PI * f * i) / SR);
    }
  }
  return out;
}

function firstDownbeat(offset, bpm) {
  const bar = (60 / bpm) * 4;
  let d = offset % bar;
  return d;
}

for (const [bpm, offset] of [
  [92, 0.37],
  [117.5, 1.21],
  [128, 0.05],
  [140, 0.62]
]) {
  test(`tempo ${bpm} BPM lands within ±0.2 and on the downbeat`, () => {
    const pcm = song({ bpm, offset });
    const g = beatGrid(onsets(pcm, SR));
    assert.ok(Math.abs(g.bpm - bpm) <= 0.2, `bpm ${g.bpm.toFixed(2)} vs ${bpm}`);
    const want = firstDownbeat(offset, bpm);
    assert.ok(Math.abs(g.downbeatSec - want) < 0.035, `downbeat ${g.downbeatSec.toFixed(3)} s vs ${want.toFixed(3)} s`);
  });
}

test('drum and bass at 174 folds to half time (87) with the downbeat kept', () => {
  const pcm = song({ bpm: 174, offset: 0.2, seconds: 60 });
  const g = beatGrid(onsets(pcm, SR));
  assert.ok(Math.abs(g.rawBpm - 174) <= 0.4, `raw ${g.rawBpm.toFixed(2)}`);
  assert.ok(Math.abs(g.bpm - 87) <= 0.2, `folded ${g.bpm.toFixed(2)}`);
  // A half-time bar spans two of the song's bars: either song downbeat is a valid game downbeat
  const songBar = (60 / 174) * 4;
  const off = (g.downbeatSec - 0.2) / songBar;
  assert.ok(Math.abs(off - Math.round(off)) < 0.05, `on a song downbeat (${off.toFixed(3)} bars)`);
});

test('foldBpm keeps the game range; slow stays slow rather than overshoot', () => {
  assert.equal(foldBpm(120), 120);
  assert.equal(foldBpm(174), 87);
  assert.equal(foldBpm(240), 120);
  assert.equal(foldBpm(70), 140);
  assert.equal(foldBpm(80), 80, '160 would be over the top, so 80 stays');
});

test('sections: C is the drop, A a quiet stretch, B in between, none overlapping', () => {
  // 16 intro (quiet), 16 build, 16 drop, 8 break (quiet), 16 drop
  const shape = b => (b < 16 ? 0.2 : b < 32 ? 0.6 : b < 48 ? 1.6 : b < 56 ? 0.25 : 1.6);
  const bpm = 124;
  const pcm = song({ bpm, offset: 0, seconds: (72 * 4 * 60) / bpm, level: shape });
  const o = onsets(pcm, SR);
  const g = beatGrid(o);
  const s = pickSections(barEnergies(o, g.bpm, g.downbeatSec));
  assert.ok(s);
  const [a, b, c] = s.starts;
  assert.ok((c >= 32 && c + 8 <= 48) || c >= 56, `C in a drop (bar ${c})`);
  assert.ok(a + 8 <= 16 || (a >= 48 && a + 8 <= 60), `A quiet (bar ${a})`);
  for (const [x, y] of [[a, b], [a, c], [b, c]]) assert.ok(Math.abs(x - y) >= 8, `no overlap ${x}/${y}`);
  assert.ok(a % 4 === 0 && b % 4 === 0 && c % 4 === 0, 'phrase aligned');
});

test('sections: under 8 bars is refused', () => {
  assert.equal(pickSections(new Float32Array(7).fill(1)), null);
});

test('key: an A minor song reads A minor; a D major song reads D major', () => {
  const am = detectKey(chroma(song({ bpm: 120, chord: [57, 60, 64, 69, 72], seconds: 30 }), SR));
  assert.deepEqual([am.name, am.minor], ['A', true]);
  const dm = detectKey(chroma(song({ bpm: 120, chord: [62, 66, 69, 74, 78], seconds: 30 }), SR));
  assert.deepEqual([dm.name, dm.minor], ['D', false]);
});

test('tap tempo: median of recent intervals, needs 4 taps', () => {
  assert.equal(tapTempo([0, 0.5, 1]), null);
  const t = tapTempo([0, 0.5, 1.0, 1.52, 2.0, 2.49, 3.0]);
  assert.ok(Math.abs(t - 120) < 1.5, String(t));
});
