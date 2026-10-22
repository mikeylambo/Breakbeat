import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '4185' } });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.addInitScript(() => {
  localStorage.setItem('breakbeat-save-v1', JSON.stringify({ v: 1, overtureDone: true, cleared: [], best: {}, daily: { date: '', best: 0 }, runs: 1 }));
  window.__lt = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration), window.__tag || '']); }).observe({ entryTypes: ['longtask'] });
});
await page.goto('http://127.0.0.1:4185/');
await page.waitForFunction(() => document.getElementById('game')?.dataset.ready === '1');
await page.evaluate(() => (window.__tag = 'title'));
await page.waitForTimeout(3000);
await page.evaluate(() => (window.__tag = 'start'));
await page.keyboard.press('Enter');
await page.waitForSelector('.title-screen:not(.hidden)');
await page.click('.btn-continue');
await page.waitForFunction(() => window.__bb.engine?.currentBar >= 2);
await page.evaluate(() => (window.__tag = 'play'));
let s = 3; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 24; i++) { await page.mouse.click(182 + Math.floor(rnd() * 16) * 32, 49 + (4 + Math.floor(rnd() * 6)) * 32); await page.waitForTimeout(250); }
await page.evaluate(() => { window.__tag = 'morph'; window.__bb.run.movementStartScore = -1e9; });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => window.__lt)));
await browser.close(); server.kill();
