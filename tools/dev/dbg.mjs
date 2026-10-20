import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', cwd: '/home/user/Breakbeat' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('console', m => console.log('console:', m.text()));
page.on('pageerror', e => console.log('pageerror', String(e)));
await page.addInitScript(() => localStorage.setItem('breakbeat-save-v1', JSON.stringify({ v: 1, overtureDone: true, cleared: [], best: {}, daily: { date: '', best: 0 }, runs: 3 })));
await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(1000);
await page.click('.btn-continue');
await page.waitForTimeout(1500);
await page.evaluate(() => { const e = window.__bb.engine; e.config.riseBars = 1; for (let c = 0; c < 16; c++) e.board[0][c] = { id: 99000 + c, col: c, row: 0, kind: c % 4, special: 'none' }; });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(700);
  console.log(i, await page.evaluate(() => { const a = window.__bb; return JSON.stringify({ wall: a.stage.wall.visible, run: !!a.run, ended: a.run?.ended, go: a.engine?.gameOver, bar: a.engine?.currentBar, res: document.querySelector('.results').className, ctx: a.audio.ctx.state }); }));
}
await page.screenshot({ path: 'artifacts/r2.png' });
await browser.close(); server.kill();
