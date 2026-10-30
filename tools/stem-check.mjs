/**
 * Stem checks: pure analysis on decoded PCM, shared by the CLI (tools/validate-stems.mjs) and the
 * STEMS gate. Every check returns plain findings; nothing here reads files or decodes audio,
 * except the WAV / OGG header parsers.
 *
 * Targets (AUDIO_STEMS.md):
 *   rate      48 kHz
 *   length    every stem exactly loopBars at the track BPM (1 ms tolerance)
 *   grid      the mix's onsets sit on the 16th grid (bar-aligned, right tempo)
 *   loops     each section wraps onto its own start with no click
 *   loudness  full mix -14 LUFS integrated (±1.5 LU); the album within 2 LU
 *   peaks     no sample at full scale; sample peak at or under -1 dBFS
 */

export const TARGET = {
  rate: 48000,
  lengthTolMs: 1,
  lufs: -14,
  lufsTol: 1.5,
  albumSpread: 2,
  peakDb: -1,
  clip: 0.999,
  gridTolMs: 15,
  gridShiftMs: 10,
  gridOnFraction: 0.6,
  leadSilenceMs: 10,
  sfxMaxSec: 4
};

const db = x => 20 * Math.log10(Math.max(x, 1e-12));

// ---------------------------------------------------------------- headers

/** { rate, channels, bits, float, data: Float32Array[] } from a PCM or float WAV. */
export function parseWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = o => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let fmt = null;
  while (o + 8 <= buf.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe) format = v.getUint16(body + 24, true);
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt');
      const { channels, bits, format } = fmt;
      const bytes = bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - body) / (bytes * channels));
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytes;
          let x;
          if (format === 3 && bits === 32) x = v.getFloat32(p, true);
          else if (bits === 16) x = v.getInt16(p, true) / 32768;
          else if (bits === 24) x = (((buf[p + 2] << 24) | (buf[p + 1] << 16) | (buf[p] << 8)) >> 8) / 8388608;
          else if (bits === 32) x = v.getInt32(p, true) / 2147483648;
          else throw new Error(`unsupported WAV: ${bits}-bit format ${format}`);
          data[c][i] = x;
        }
      return { rate: fmt.rate, channels, bits, float: format === 3, data };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

/** Sample rate and channel count from an Ogg Vorbis identification header. */
export function oggHeader(buf) {
  for (let p = 0; p < Math.min(buf.length - 16, 4096); p++) {
    if (buf[p] === 1 && String.fromCharCode(...buf.subarray(p + 1, p + 7)) === 'vorbis') {
      const v = new DataView(buf.buffer, buf.byteOffset + p, 16);
      return { channels: buf[p + 11], rate: v.getUint32(12, true) };
    }
  }
  throw new Error('not an Ogg Vorbis file');
}

// ---------------------------------------------------------------- loudness (ITU-R BS.1770-4)

function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function kWeight(x, fs) {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  const Q1 = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q1 + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0);
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0);
}

/** Integrated loudness in LUFS. Mono is counted on both speakers, as the game plays it. */
export function lufs(channels, fs) {
  const chans = channels.length === 1 ? [channels[0], channels[0]] : channels;
  const w = chans.map(c => kWeight(c, fs));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const z = [];
  for (let s = 0; s + block <= w[0].length; s += hop) {
    let sum = 0;
    for (const c of w) {
      let e = 0;
      for (let i = s; i < s + block; i++) e += c[i] * c[i];
      sum += e / block;
    }
    z.push(sum);
  }
  const L = e => -0.691 + 10 * Math.log10(Math.max(e, 1e-20));
  const abs = z.filter(e => L(e) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter(e => L(e) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// ---------------------------------------------------------------- helpers

export function mixdown(stems) {
  const n = Math.max(...stems.map(s => s.data[0].length));
  const ch = Math.max(...stems.map(s => s.data.length));
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (const s of stems)
    for (let c = 0; c < ch; c++) {
      const src = s.data[Math.min(c, s.data.length - 1)];
      for (let i = 0; i < src.length; i++) out[c][i] += src[i];
    }
  return out;
}

function peak(channels) {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

function clipped(channels) {
  let n = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= TARGET.clip) n++;
  return n;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/**
 * Onset times (s) of a mono signal. Every 2.5 ms, the energy of the next 20 ms is compared with the
 * previous 20 ms; onsets are the peaks of that rise. 20 ms is longer than a 55 Hz kick's period, so
 * low notes don't ripple into false onsets, and the rise peaks exactly where the hit starts.
 */
export function onsets(x, fs) {
  const hop = Math.round(0.0025 * fs);
  const win = Math.round(0.02 * fs);
  const e = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - (x[i - 1] ?? 0);
    e[i + 1] = e[i] + d * d + x[i] * x[i] * 0.05;
  }
  const rise = [];
  for (let s = 0; s < x.length; s += hop) {
    const before = (e[s] - e[Math.max(0, s - win)]) / win;
    const after = (e[Math.min(x.length, s + win)] - e[s]) / win;
    rise.push(Math.max(0, Math.sqrt(after) - Math.sqrt(before)));
  }
  const thr = Math.max(median(rise.filter(f => f > 0)) * 4, Math.max(...rise) * 0.15);
  const out = [];
  for (let i = 1; i < rise.length - 1; i++)
    if (rise[i] > thr && rise[i] >= rise[i - 1] && rise[i] > rise[i + 1] && (!out.length || (i * hop) / fs - out[out.length - 1] > 0.05)) out.push(refine(e, i * hop, fs) / fs);
  return out;
}

/** The sample near `at` (±20 ms) where a 3 ms energy window rises most sharply: the hit's true start. */
function refine(e, at, fs) {
  const w = Math.round(0.003 * fs);
  const reach = Math.round(0.02 * fs);
  const n = e.length - 1;
  let best = at, bestRise = -Infinity;
  for (let s = Math.max(w, at - reach); s <= Math.min(n - w, at + reach); s += 8) {
    const r = Math.sqrt((e[s + w] - e[s]) / w) - Math.sqrt((e[s] - e[s - w]) / w);
    if (r > bestRise) {
      bestRise = r;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the checks

/**
 * Checks one movement. `stems` maps kick/bass/keys/lead/top to { rate, data: Float32Array[] };
 * `sfx` maps one-shot names to the same. Returns { errors, warnings, metrics }.
 */
export function checkTrack(track, stems, sfx = {}) {
  const errors = [];
  const warnings = [];
  const metrics = {};
  const names = ['kick', 'bass', 'keys', 'lead', 'top'];
  const missing = names.filter(n => !stems[n]);
  if (missing.length) errors.push(`missing stems: ${missing.join(', ')}`);
  const have = names.filter(n => stems[n]).map(n => [n, stems[n]]);
  if (!have.length) return { errors, warnings, metrics };

  for (const [n, s] of have) if (s.rate !== TARGET.rate) errors.push(`${n}: ${s.rate} Hz (needs ${TARGET.rate})`);
  const fs = have[0][1].rate;
  const expected = Math.round((track.loopBars * 240 * fs) / track.bpm);
  const tol = Math.round((TARGET.lengthTolMs / 1000) * fs);
  for (const [n, s] of have) {
    const len = s.data[0].length;
    if (Math.abs(len - expected) > tol) errors.push(`${n}: ${(len / fs).toFixed(3)} s long (needs ${(expected / fs).toFixed(3)} s: ${track.loopBars} bars at ${track.bpm} BPM)`);
  }
  const lens = have.map(([, s]) => s.data[0].length);
  if (Math.max(...lens) - Math.min(...lens) > tol) errors.push(`stems differ in length by ${(((Math.max(...lens) - Math.min(...lens)) / fs) * 1000).toFixed(1)} ms`);

  for (const [n, s] of have) {
    const c = clipped(s.data);
    if (c) errors.push(`${n}: ${c} clipped sample${c === 1 ? '' : 's'}`);
  }

  const mix = mixdown(have.map(([, s]) => s));
  const mono = new Float32Array(mix[0].length);
  for (const c of mix) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / mix.length;
  const pk = db(peak(mix));
  metrics.peakDb = +pk.toFixed(2);
  if (clipped(mix)) errors.push(`full mix clips (${clipped(mix)} samples at full scale): lower the stems`);
  else if (pk > TARGET.peakDb) warnings.push(`full mix peaks at ${pk.toFixed(2)} dBFS (aim for ${TARGET.peakDb} or lower)`);
  const L = lufs(mix, fs);
  metrics.lufs = +L.toFixed(2);
  if (!(Math.abs(L - TARGET.lufs) <= TARGET.lufsTol)) errors.push(`full mix is ${L.toFixed(1)} LUFS (target ${TARGET.lufs} ±${TARGET.lufsTol})`);

  // Bar alignment and tempo: onsets of the mix against the 16th grid
  const lead = mono.findIndex(v => Math.abs(v) > 0.003);
  metrics.leadSilenceMs = +((Math.max(0, lead) / fs) * 1000).toFixed(1);
  if (lead < 0) errors.push('the mix is silent');
  else if (metrics.leadSilenceMs > TARGET.leadSilenceMs) warnings.push(`${metrics.leadSilenceMs} ms of silence before the first sound (files must start on bar 1, beat 1)`);
  const sixteenth = 15 / track.bpm;
  const on = onsets(mono, fs);
  const offs = on.map(t => {
    const k = Math.round(t / sixteenth);
    return (t - k * sixteenth) * 1000;
  });
  const near = offs.filter(o => Math.abs(o) <= TARGET.gridTolMs);
  metrics.onsets = on.length;
  metrics.onGrid = on.length ? +(near.length / on.length).toFixed(2) : 0;
  metrics.gridShiftMs = +median(near).toFixed(1);
  if (on.length >= 8) {
    if (metrics.onGrid < TARGET.gridOnFraction) errors.push(`only ${Math.round(metrics.onGrid * 100)}% of hits land on the ${track.bpm} BPM grid: wrong tempo, or not bar-aligned`);
    else if (Math.abs(metrics.gridShiftMs) > TARGET.gridShiftMs) errors.push(`hits sit ${metrics.gridShiftMs} ms off the grid on average: trim or pad the start so bar 1 begins at 0`);
  } else warnings.push(`only ${on.length} clear hits found: grid check skipped`);

  // Seamless loops: each section wraps from its last sample onto its first
  let bar = 0;
  const barLen = (240 * fs) / track.bpm;
  for (const sec of track.sections) {
    const a = Math.round(bar * barLen);
    const b = Math.round((bar + sec.bars) * barLen);
    bar += sec.bars;
    if (b > mix[0].length) continue;
    for (const [n, s] of have) {
      const seam = seamClick(s.data, a, b, fs);
      if (seam.click) errors.push(`${n}: click where section ${sec.name} loops (jump ${seam.jump.toFixed(3)}, ${seam.ratio.toFixed(0)}× the local motion)`);
    }
  }

  // One-shots
  for (const [n, s] of Object.entries(sfx)) {
    if (!s) {
      errors.push(`missing one-shot: ${n}`);
      continue;
    }
    if (s.rate !== TARGET.rate) errors.push(`${n}: ${s.rate} Hz (needs ${TARGET.rate})`);
    if (clipped(s.data)) errors.push(`${n}: clipped`);
    if (peak(s.data) < 0.01) errors.push(`${n}: silent`);
    if (s.data[0].length / s.rate > TARGET.sfxMaxSec) warnings.push(`${n}: ${(s.data[0].length / s.rate).toFixed(1)} s long (one-shots should be short)`);
  }
  return { errors, warnings, metrics };
}

/** The wrap from sample b-1 onto sample a, against the motion either side of it. */
export function seamClick(data, a, b, fs) {
  const w = Math.max(8, Math.round(0.002 * fs));
  let jump = 0;
  let local = 0;
  for (const c of data) {
    jump = Math.max(jump, Math.abs(c[a] - c[b - 1]));
    const d = [];
    for (let i = b - w; i < b - 1; i++) d.push(Math.abs(c[i + 1] - c[i]));
    for (let i = a; i < a + w; i++) d.push(Math.abs(c[i + 1] - c[i]));
    local = Math.max(local, Math.max(...d));
  }
  const ratio = jump / Math.max(local, 1e-4);
  return { jump, ratio, click: jump > 0.02 && ratio > 4 };
}

/** Album evenness: tracks more than albumSpread/2 LU from the median. */
export function albumCheck(results) {
  const ls = results.filter(r => Number.isFinite(r.metrics.lufs)).map(r => r.metrics.lufs);
  if (ls.length < 2) return [];
  const m = median(ls);
  return results.filter(r => Math.abs(r.metrics.lufs - m) > TARGET.albumSpread / 2).map(r => `${r.id}: ${r.metrics.lufs} LUFS, ${(r.metrics.lufs - m).toFixed(1)} LU from the album median (${m.toFixed(1)})`);
}
