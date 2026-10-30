/**
 * Stem validator: checks delivered music against AUDIO_STEMS.md before it is switched on.
 *   node tools/validate-stems.mjs                 every track with "stemsReady": true
 *   node tools/validate-stems.mjs ignition magma  these tracks, ready or not (files must exist)
 *   node tools/validate-stems.mjs --all           every track that has any files on disk
 *   --json                                        machine-readable report
 * WAV is read directly; OGG is decoded by Chromium, the decoder the game itself uses.
 * Exit code 1 when any error is found (warnings alone pass).
 */

import fs from 'node:fs';
import path from 'node:path';
import { albumCheck, checkTrack, oggHeader, parseWav, TARGET } from './stem-check.mjs';

const PUBLIC = 'public';
const STEMS = ['kick', 'bass', 'keys', 'lead', 'top'];

let browser = null;
let page = null;

async function decodeOgg(bytes) {
  if (!page) {
    const { chromium } = await import('playwright');
    const exe = ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));
    browser = await chromium.launch(exe ? { executablePath: exe } : {});
    page = await browser.newPage();
  }
  const b64 = Buffer.from(bytes).toString('base64');
  const out = await page.evaluate(async ({ b64, rate }) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ctx = new OfflineAudioContext(2, 1, rate);
    const buf = await ctx.decodeAudioData(bin.buffer);
    const enc = a => {
      const u = new Uint8Array(a.buffer);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return Array.from({ length: buf.numberOfChannels }, (_, c) => enc(buf.getChannelData(c)));
  }, { b64, rate: TARGET.rate });
  return out.map(s => {
    const b = Buffer.from(s, 'base64');
    return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  });
}

/** { rate, data } for a file, or null when it does not exist. */
export async function load(rel) {
  const file = path.join(PUBLIC, rel);
  const alt = file.replace(/\.ogg$/, '.wav');
  const use = fs.existsSync(file) ? file : fs.existsSync(alt) ? alt : null;
  if (!use) return null;
  const bytes = fs.readFileSync(use);
  if (use.endsWith('.wav')) return parseWav(bytes);
  const h = oggHeader(bytes);
  // Decoding resamples to 48 kHz; the header keeps the file's real rate for the rate check
  return { rate: h.rate, data: await decodeOgg(bytes) };
}

export async function validateTrack(t) {
  const stems = {};
  for (const n of STEMS) stems[n] = await load(t.stems[n]);
  const sfx = {};
  if (t.sfx) {
    t.sfx.prime.forEach((p, i) => (sfx[`prime-${i}`] = p));
    for (const k of ['detonate', 'hold', 'over', 'allclear', 'slide']) if (t.sfx[k]) sfx[k] = t.sfx[k];
  }
  const loadedSfx = {};
  for (const [k, p] of Object.entries(sfx)) loadedSfx[k] = await load(p);
  // A track whose one-shots are all absent falls back to the shared synth set: not an error
  const anySfx = Object.values(loadedSfx).some(Boolean);
  return { id: t.id, ...checkTrack(t, stems, anySfx ? loadedSfx : {}) };
}

export async function close() {
  await browser?.close();
  browser = page = null;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const all = args.includes('--all');
  const ids = args.filter(a => !a.startsWith('--'));
  const tracks = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks;
  const pick = ids.length
    ? ids.map(id => tracks.find(t => t.id === id) ?? (console.error(`unknown track: ${id}`), process.exit(2)))
    : all
      ? tracks.filter(t => STEMS.some(n => fs.existsSync(path.join(PUBLIC, t.stems[n])) || fs.existsSync(path.join(PUBLIC, t.stems[n].replace(/\.ogg$/, '.wav')))))
      : tracks.filter(t => t.stemsReady);
  const results = [];
  for (const t of pick) results.push(await validateTrack(t));
  await close();
  const album = albumCheck(results);
  if (json) console.log(JSON.stringify({ results, album }, null, 2));
  else {
    if (!pick.length) console.log('No tracks to check (none has "stemsReady": true). Name tracks or pass --all.');
    for (const r of results) {
      const m = r.metrics;
      console.log(`\n${r.errors.length ? '✗' : '✓'} ${r.id}  ${Number.isFinite(m.lufs) ? `${m.lufs} LUFS · peak ${m.peakDb} dBFS · ${Math.round((m.onGrid ?? 0) * 100)}% on grid` : ''}`);
      for (const e of r.errors) console.log(`  error  ${e}`);
      for (const w of r.warnings) console.log(`  warn   ${w}`);
    }
    for (const a of album) console.log(`\nwarn   album loudness: ${a}`);
  }
  process.exit(results.some(r => r.errors.length) ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
