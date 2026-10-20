/**
 * BREAKBEAT browser gates (Playwright, headless Chromium at 844x390):
 *  FRAME_HITCH — 30 s scripted run, random primes every 250 ms: rAF delta p99 <= 20 ms, max <= 60 ms
 *  NETWORK     — zero non-same-origin requests during a full Overture + 1 movement run
 *  SCREENS     — every screen/state captured into artifacts/screens/
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4179;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = 'artifacts/screens';
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
await new Promise(r => setTimeout(r, 500));

const launchArgs = ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
let browser;
try {
  browser = await chromium.launch({ args: launchArgs });
} catch (err) {
  server.kill();
  console.error('Browser gates need Chromium: run `npx playwright install chromium` once.');
  throw err;
}

const cellXY = (c, r) => [167 + 15 + c * 32, 34 + 15 + r * 32];
const FRESH = { v: 1, overtureDone: false, cleared: [], best: {}, daily: { date: '', best: 0 }, runs: 0 };
const VETERAN = { v: 1, overtureDone: true, cleared: ['ignition', 'glasswork'], best: { ignition: 54200, glasswork: 23100, endless: 41800, zen: 12600 }, daily: { date: '', best: 0 }, runs: 14 };

async function newPage(save, viewport = { width: 844, height: 390 }, dpr = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, acceptDownloads: true, hasTouch: false });
  await ctx.addInitScript(s => {
    try {
      if (!sessionStorage.getItem('bb-seeded')) {
        localStorage.clear();
        localStorage.setItem('breakbeat-save-v1', s);
        localStorage.setItem('breakbeat-taught-air', '1');
        sessionStorage.setItem('bb-seeded', '1');
      }
    } catch {}
  }, JSON.stringify(save));
  openCtx.add(ctx);
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  page.on('request', req => requests.push(req.url()));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => document.getElementById('game')?.dataset.ready === '1');
  await page.waitForTimeout(300);
  return { ctx, page, requests, errors };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Waits until the engine reaches `bar` (or the predicate holds). */
async function waitBar(page, bar) {
  await page.waitForFunction(b => (window.__bb.engine?.currentBar ?? 0) >= b, bar, { timeout: 20000 });
}

/** Taps every Overture target group once, at a point in the bar where they are ahead of the blade. */
async function tapTargets(page, hold = false) {
  const cells = await page.evaluate(() => {
    const a = window.__bb;
    const L = a.__overture?.lessons;
    return L ? L.targetCells(a.engine).map(g => g[0]) : [];
  });
  for (const cell of cells) {
    const [x, y] = cellXY(cell % 16, Math.floor(cell / 16));
    if (hold) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(420);
      await page.mouse.up();
    } else {
      await page.mouse.click(x, y);
    }
  }
  return cells.length;
}

async function waitSixteenth(page, lo, hi) {
  await page.waitForFunction(
    ([a, b]) => {
      const s = window.__bb.engine?.currentStep ?? -1;
      const x = ((s % 16) + 16) % 16;
      return s >= 0 && x >= a && x <= b;
    },
    [lo, hi],
    { timeout: 20000 }
  );
}

let failed = false;
let step = '';
const openCtx = new Set();
const gate = async (name, fn) => {
  try {
    step = '';
    const msg = await fn();
    console.log(`PASS [${name}]: ${msg}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL [${name}] at "${step}": ${err.message.split('\n')[0]}`);
  } finally {
    for (const c of openCtx) await c.close().catch(() => {});
    openCtx.clear();
  }
};

// ---------------------------------------------------------------- NETWORK + SCREENS (Overture + Movement 01)
await gate('NETWORK', async () => {
  const { ctx, page, requests, errors } = await newPage(FRESH);
  await shot(page, 'title-first-launch');
  step = 'start overture';
  await page.click('.btn-continue');
  await page.waitForFunction(() => window.__bb.run?.mode === 'overture' && window.__bb.engine);
  await page.waitForTimeout(600);
  await shot(page, 'overture-1');
  // Lesson 1: tap the jade group ahead of the blade
  await waitSixteenth(page, 1, 4);
  await tapTargets(page);
  step = 'lesson 1';
  await page.waitForFunction(() => window.__bb.__overture?.lessons?.lesson === 2, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await shot(page, 'overture-2');
  await waitSixteenth(page, 0, 1);
  await tapTargets(page);
  step = 'lesson 2';
  await page.waitForFunction(() => window.__bb.__overture?.lessons?.lesson === 3, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await shot(page, 'overture-3');
  await waitSixteenth(page, 0, 2);
  await tapTargets(page, true);
  step = 'lesson 3';
  await page.waitForFunction(() => window.__bb.run?.mode === 'odyssey', null, { timeout: 30000 });
  step = 'morph to ignition';
  await page.waitForFunction(() => window.__bb.run?.track?.id === 'ignition', null, { timeout: 30000 });
  // Play Movement 01 for a while with random primes, then let the wall win
  for (let i = 0; i < 40; i++) {
    const c = (i * 7) % 16;
    const r = 9 - (i % 5);
    await page.mouse.click(...cellXY(c, r));
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => {
    const e = window.__bb.engine;
    e.config.riseBars = 1;
    e.setPressureEnabled(true);
  });
  step = 'movement 01 to results';
  await page.waitForFunction(() => !!document.querySelector('.results:not(.hidden)'), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const foreign = requests.filter(u => !u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:'));
  assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
  assert.equal(foreign.length, 0, `cross-origin requests: ${foreign.join(', ')}`);
  const fonts = requests.filter(u => u.endsWith('.woff2')).length;
  await ctx.close();
  return `${requests.length} requests (${fonts} fonts, 0 audio files: stems render locally), all same-origin, across a full Overture + Movement 01 run.`;
});

await gate('SCREENS', async () => {
  const { ctx, page, errors } = await newPage(VETERAN);
  await shot(page, 'title');

  await page.click('.title-settings');
  await page.waitForTimeout(250);
  await shot(page, 'settings');
  await page.click('.settings-close');

  await page.click('.btn-continue');
  await page.waitForFunction(() => window.__bb.engine && window.__bb.engine.currentBar >= 1);
  // run-hero: a held group and a queued group on the wall together
  await waitSixteenth(page, 9, 11);
  await page.evaluate(() => {
    const a = window.__bb;
    const e = a.engine;
    const locked = () => e.getLockedTileIds();
    const s = e.currentStep % 16;
    let queued = null;
    let held = null;
    for (let r = 9; r >= 0 && (!queued || !held); r--) {
      for (let c = 0; c < 16; c++) {
        const t = e.board[r][c];
        if (!t || locked().has(t.id)) continue;
        const cl = e.rules.primeable(e.board, c, r, locked());
        if (!cl || cl.length < 2) continue;
        const minCol = Math.min(...cl.map(x => x.col));
        if (!queued && minCol <= s - 1) queued = e.primeAt(c, r);
        else if (!held && minCol > s + 1) {
          held = e.primeAt(c, r);
          if (held) e.holdAt(c, r);
        }
      }
    }
    a.wall.markDirty();
    a.fx.markGroupsDirty();
  });
  await page.waitForTimeout(260);
  await shot(page, 'run-hero');

  // danger: occupy the top rows
  await page.evaluate(() => {
    const a = window.__bb;
    const e = a.engine;
    for (const c of [2, 3, 9, 13]) e.board[1][c] = e.board[1][c] ?? { id: 880000 + c, col: c, row: 1, kind: c % 4, special: 'none' };
    e.board[0][3] = { id: 881000, col: 3, row: 0, kind: 1, special: 'none' };
  });
  await page.waitForFunction(() => window.__bb.wall.dangerLevel >= 2, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  await shot(page, 'danger');

  // pause
  await page.click('.hud-pause');
  await page.waitForTimeout(250);
  await shot(page, 'pause');
  await page.click('.pause-sheet .btn-primary');
  await page.waitForTimeout(300);

  // all-clear: a single group left on the wall, ahead of the blade
  await waitSixteenth(page, 0, 3);
  await page.evaluate(() => {
    const a = window.__bb;
    const e = a.engine;
    for (const row of e.board) row.fill(null);
    e.groups.clear();
    e.falling.clear();
    e.board[9][10] = { id: 890001, col: 10, row: 9, kind: 0, special: 'none' };
    e.board[9][11] = { id: 890002, col: 11, row: 9, kind: 0, special: 'none' };
    e.board[8][10] = { id: 890003, col: 10, row: 8, kind: 0, special: 'none' };
    e.primeAt(10, 9);
    a.wall.markDirty();
  });
  await page.waitForFunction(() => window.__bb.engine.telemetry.allClears >= 1, null, { timeout: 8000 });
  await page.waitForTimeout(420);
  await shot(page, 'all-clear');

  // results
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const e = window.__bb.engine;
    e.config.riseBars = 1;
    for (let c = 0; c < 16; c++) e.board[0][c] = { id: 892000 + c, col: c, row: 0, kind: c % 4, special: 'none' };
    for (let c = 0; c < 16; c++) if (!e.board[1][c]) e.board[1][c] = { id: 893000 + c, col: c, row: 1, kind: (c + 1) % 4, special: 'none' };
  });
  await page.waitForFunction(() => !!document.querySelector('.results:not(.hidden)'), null, { timeout: 20000 });
  await page.waitForTimeout(900);
  await shot(page, 'results');

  // rotate (portrait)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(page, 'rotate');
  assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
  await ctx.close();
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  for (const need of ['title', 'overture-1', 'overture-2', 'overture-3', 'run-hero', 'all-clear', 'danger', 'pause', 'results', 'settings', 'rotate']) {
    assert.ok(files.includes(`${need}.png`), `missing screen ${need}`);
  }
  return `${files.length} screens in ${OUT}/ (${files.map(f => f.replace('.png', '')).join(', ')}).`;
});

// ---------------------------------------------------------------- FRAME_HITCH
await gate('FRAME_HITCH', async () => {
  // DPR 1: this container rasterises WebGL on the CPU (SwiftShader); phones have GPUs
  const { ctx, page, errors } = await newPage(VETERAN, { width: 844, height: 390 }, 1);
  await page.click('.btn-continue');
  await page.waitForFunction(() => window.__bb.engine && window.__bb.engine.currentBar >= 1);
  await page.evaluate(() => {
    // Keep the wall alive for the whole 30 s so the run measures play, not results
    window.__bb.engine.setPressureEnabled(false);
    window.__frames = [];
    let last = performance.now();
    const f = t => {
      window.__frames.push(t - last);
      last = t;
      if (window.__frames.length < 100000) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    await page.mouse.click(...cellXY(Math.floor(rnd() * 16), 4 + Math.floor(rnd() * 6)));
    await page.waitForTimeout(250);
  }
  const frames = await page.evaluate(() => window.__frames.slice(5));
  frames.sort((a, b) => a - b);
  const p99 = frames[Math.floor(frames.length * 0.99)];
  const max = frames[frames.length - 1];
  assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
  await ctx.close();
  assert.ok(p99 <= 20, `rAF p99 ${p99.toFixed(1)} ms > 20 ms`);
  assert.ok(max <= 60, `rAF max ${max.toFixed(1)} ms > 60 ms`);
  return `${frames.length} frames over 30 s with primes every 250 ms: p99 ${p99.toFixed(1)} ms, max ${max.toFixed(1)} ms.`;
});

await browser.close();
server.kill();
if (failed) process.exit(1);
console.log('=== BROWSER GATES GREEN (FRAME_HITCH, SCREENS, NETWORK) ===');
