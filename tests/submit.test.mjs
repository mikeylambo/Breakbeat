import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PulseEngine } from '../build/src/pulse/PulseEngine.js';
import { GemRules } from '../build/src/content/gems/GemRules.js';
import { replayOf } from '../build/src/pulse/Replay.js';
import { dailyStart } from '../build/src/meta/DailyVerify.js';

/**
 * The deployed edge-function bundle (build/server/breakbeat-submit.js), run against an in-memory
 * PostgREST: store, keep-best, rank and refusals, exactly as the server runs it.
 */
const rows = [];
globalThis.Deno = { env: { get: k => (k === 'SUPABASE_URL' ? 'https://db.test' : 'service-key') }, serve: h => (globalThis.__handler = h) };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams);
  const eq = k => q[k]?.replace(/^eq\./, '');
  if ((init.method ?? 'GET') === 'POST') {
    const body = JSON.parse(init.body);
    const i = rows.findIndex(r => r.day === body.day && r.player === body.player);
    if (i >= 0) rows[i] = body;
    else rows.push(body);
    return new Response(null, { status: 201 });
  }
  let list = rows.filter(r => r.day === eq('day'));
  if (q.player) list = list.filter(r => r.player === eq('player'));
  if (q.score) list = list.filter(r => r.score > Number(q.score.replace('gt.', '')));
  return new Response(JSON.stringify(list.map(r => ({ score: r.score }))), { headers: { 'content-range': `0-0/${list.length}` } });
};
await import('../build/server/breakbeat-submit.js');
const call = async body => {
  const res = await globalThis.__handler(new Request('https://fn.test', { method: 'POST', body: JSON.stringify(body) }));
  return [res.status, await res.json()];
};

const T = JSON.parse(fs.readFileSync('content/tracks.json', 'utf8')).tracks.filter(t => t.id !== 'overture');
const day = new Date().toISOString().slice(0, 10);
function run(seed, steps) {
  const t = T[dailyStart(day, T.length)];
  const e = new PulseEngine({ seed: `daily-${day}`, mode: 'daily', bpm: t.bpm, colorCount: t.colors, riseBars: t.riseBars }, new GemRules('brick'));
  let r = seed;
  const rnd = () => ((r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let s = 0; s < steps && !e.gameOver; s++) {
    e.advanceToStep(s);
    e.events.length = 0;
    for (let k = 0; k < 3; k++) e.primeAt(Math.floor(rnd() * 16), 4 + Math.floor(rnd() * 6), (s + rnd()) * e.sixteenthSec);
  }
  return e;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('honest run is stored with the server score; a worse one keeps the best; ranks follow', async () => {
  const good = run(3, 700);
  const [s1, r1] = await call({ day, player: A, name: '<b>Ace</b>', replay: replayOf(good) });
  assert.equal(s1, 200, JSON.stringify(r1));
  assert.equal(r1.score, Math.round(good.telemetry.score));
  assert.deepEqual([r1.rank, r1.total], [1, 1]);
  assert.equal(rows[0].name, 'bAce/b', 'name cleaned');
  const worse = run(3, 120);
  const [, r2] = await call({ day, player: A, name: 'Ace', replay: replayOf(worse) });
  assert.equal(r2.best, r1.score, 'best kept');
  assert.equal(rows.length, 1);
  const [, r3] = await call({ day, player: B, name: 'www.spam.com', replay: replayOf(run(9, 300)) });
  assert.equal(r3.total, 2);
  assert.equal(rows[1].name, 'Player', 'links refused as names');
});

test('refusals: forged rules, another day, bad player id, junk', async () => {
  const rp = replayOf(run(4, 200));
  assert.equal((await call({ day, player: A, replay: { ...rp, colors: 3 } }))[0], 422);
  assert.equal((await call({ day: '2020-01-01', player: A, replay: rp }))[0], 422);
  assert.equal((await call({ day, player: 'me', replay: rp }))[0], 422);
  const res = await globalThis.__handler(new Request('https://fn.test', { method: 'POST', body: '{nope' }));
  assert.equal(res.status, 400);
});
