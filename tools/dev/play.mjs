import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', cwd: '/home/user/Breakbeat' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || m.type()==='warning') errors.push(m.type()+': '+m.text()); });
await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(1500);
await page.mouse.click(422, 195);
await page.waitForTimeout(2500);
// tap a few cells
for (let i = 0; i < 12; i++) { await page.mouse.click(167 + 15 + (i*5%16)*32, 34 + 15 + (9 - (i%4))*32); await page.waitForTimeout(150); }
await page.mouse.move(167+15+32*12, 34+15+32*8); await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: process.argv[2] || '/home/user/Breakbeat/artifacts/s7.png' });
const st = await page.evaluate(() => { const a = window.__bb; return { score: a.engine?.telemetry.score, bar: a.engine?.currentBar, ctx: a.audio.ctx.state, groups: a.engine?.groups.size, lat: a.audio.outputLatencySec }; });
console.log(JSON.stringify(st));
console.log(errors.join('\n') || 'no errors');
await browser.close(); server.kill();
