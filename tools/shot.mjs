// Dev helper: screenshot the running build. Usage: node tools/shot.mjs out.png [waitMs] [url]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const out = process.argv[2] ?? 'artifacts/shot.png';
const wait = Number(process.argv[3] ?? 1500);
const url = process.argv[4] ?? 'http://127.0.0.1:4173/';
const server = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 400));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
server.kill();
