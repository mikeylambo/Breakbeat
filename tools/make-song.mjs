/**
 * Writes a synthetic test song as a 16-bit stereo WAV: kick on every beat (harder on the one with
 * a bass note), snare on 2 and 4, hats on 8ths and an A minor pad, with a quiet intro, a build and
 * a drop. Used by the BYO browser gate (no audio fixtures are committed).
 *   node tools/make-song.mjs out.wav [bpm] [seconds] [offsetSec]
 */

import fs from 'node:fs';

export function songPcm({ bpm = 124, seconds = 60, offset = 0.5, sr = 44100 } = {}) {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  let r = 7;
  const noise = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const beat = 60 / bpm;
  const level = bar => (bar < 8 ? 0.25 : bar < 16 ? 0.6 : 1.4);
  const tone = (t0, dur, f, amp, decay) => {
    const s0 = Math.floor(t0 * sr);
    for (let i = 0; i < dur * sr && s0 + i < n; i++) if (s0 + i >= 0) out[s0 + i] += amp * Math.sin((2 * Math.PI * f * i) / sr) * Math.exp(-i / sr / decay);
  };
  const hiss = (t0, dur, amp, hp) => {
    const s0 = Math.floor(t0 * sr);
    let p = 0;
    for (let i = 0; i < dur * sr && s0 + i < n; i++) {
      const x = noise();
      if (s0 + i >= 0) out[s0 + i] += amp * (hp ? x - p : x) * Math.exp(-i / sr / (dur / 3));
      p = x;
    }
  };
  for (let k = 0; offset + k * beat < seconds; k++) {
    const t = offset + k * beat;
    const lv = level(Math.floor(k / 4));
    tone(t, 0.18, k % 4 === 0 ? 55 : 62, k % 4 === 0 ? 0.8 : 0.4, 0.05);
    if (k % 4 === 0) tone(t, beat * 1.5, 41.2, 0.3, 0.4);
    if (k % 4 === 1 || k % 4 === 3) hiss(t, 0.12, 0.25, false);
    hiss(t, 0.04, 0.1 * lv, true);
    hiss(t + beat / 2, 0.04, 0.08 * lv, true);
  }
  for (const m of [57, 60, 64]) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    for (let i = 0; i < n; i++) out[i] += 0.04 * level(Math.max(0, Math.floor((i / sr - offset) / beat / 4))) * Math.sin((2 * Math.PI * f * i) / sr);
  }
  return { pcm: out, sr };
}

export function wav(pcm, sr) {
  const n = pcm.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] * 0.8)) * 32767;
    b.writeInt16LE(v | 0, 44 + i * 4);
    b.writeInt16LE(v | 0, 46 + i * 4);
  }
  return b;
}

if (process.argv[1]?.endsWith('make-song.mjs')) {
  const [, , file = 'song.wav', bpm = '124', seconds = '60', offset = '0.5'] = process.argv;
  const { pcm, sr } = songPcm({ bpm: +bpm, seconds: +seconds, offset: +offset });
  fs.writeFileSync(file, wav(pcm, sr));
  console.log(`${file}: ${bpm} BPM, ${seconds} s`);
}
