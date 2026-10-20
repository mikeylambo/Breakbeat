import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', cwd: '/home/user/Breakbeat' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('breakbeat-save-v1', JSON.stringify({ v: 1, overtureDone: true, cleared: ['ignition'], best: { ignition: 30000 }, daily: { date: '', best: 0 }, runs: 3 })));
await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'artifacts/r0-title.png' });
await page.click('.btn-continue');
await page.waitForTimeout(800);
// play: random primes for a few seconds
for (let i = 0; i < 30; i++) { await page.mouse.click(167 + 15 + ((i * 7) % 16) * 32, 34 + 15 + (9 - (i % 4)) * 32); await page.waitForTimeout(120); }
await page.evaluate(() => { const a = window.__bb; const orig = a.startRun.bind(a); a.startRun = (c) => { console.error('startRun ' + JSON.stringify(c) + new Error().stack.split('\n').slice(1,4).join('|')); return orig(c); }; const e = window.__bb.engine; e.config.riseBars = 1; for (let c = 0; c < 16; c++) e.board[0][c] = { id: 99000 + c, col: c, row: 0, kind: c % 4, special: 'none' }; });
for (let i = 0; i < 7; i++) { await page.waitForTimeout(700); console.log(i, await page.evaluate(() => { const a = window.__bb; return JSON.stringify({ wall: a.stage.wall.visible, run: !!a.run, ended: a.run?.ended, mode: a.run?.mode, res: document.querySelector('.results').className }); })); }
await page.screenshot({ path: 'artifacts/r1-results.png' });
console.log(await page.evaluate(() => { const a = window.__bb; return JSON.stringify({ wall: a.stage.wall.visible, cam: a.stage.camera.children.map(c => c.visible), run: !!a.run, res: document.querySelector('.results').className }); }));
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.click('.results-actions .btn:last-child');
const d = await dl;
console.log('download', d ? d.suggestedFilename() : 'none');
if (d) await d.saveAs('artifacts/share-' + d.suggestedFilename());
console.log(errors.join('\n') || 'no errors');
await browser.close(); server.kill();
