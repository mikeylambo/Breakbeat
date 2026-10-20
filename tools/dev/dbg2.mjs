import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', cwd: '/home/user/Breakbeat' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('console', m => console.log('console:', m.text()));
await page.addInitScript(() => localStorage.setItem('breakbeat-save-v1', JSON.stringify({ v: 1, overtureDone: true, cleared: ['ignition'], best: { ignition: 30000 }, daily: { date: '', best: 0 }, runs: 3 })));
await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(1000);
await page.evaluate(() => { const a = window.__bb; const o = a.startRun.bind(a); a.startRun = c => { console.log('startRun ' + JSON.stringify(c) + ' ' + new Error().stack.split('\n')[2]); return o(c); }; const oe = a.endRun?.bind(a); });
await page.click('.btn-continue');
await page.waitForTimeout(800);
for (let i = 0; i < 30; i++) { await page.mouse.click(167 + 15 + ((i * 7) % 16) * 32, 34 + 15 + (9 - (i % 4)) * 32); await page.waitForTimeout(120); if (i % 5 === 0) console.log(i, await page.evaluate(() => JSON.stringify({ go: window.__bb.engine?.gameOver, bar: window.__bb.engine?.currentBar, res: document.querySelector('.results').className, score: window.__bb.engine?.telemetry.score }))); }
await browser.close(); server.kill();
