// Renders the app icons (run once: node tools/make-icons.mjs). Four tiles from the palette and the blade.
import { chromium } from 'playwright';
const html = (size, pad) => `<html><body style="margin:0;background:#05060A;width:${size}px;height:${size}px;display:grid;place-items:center">
<div style="position:relative;width:${size - pad * 2}px;height:${size - pad * 2}px;display:grid;grid-template-columns:1fr 1fr;gap:${size * 0.035}px">
${[['#FFD58A', '#F2A93B', '#7E4210'], ['#FF8DBB', '#E0367E', '#540D30'], ['#9EDCFF', '#2E9EE8', '#0A325A'], ['#A6F7D6', '#2CC994', '#094634']]
  .map(([c, b, d]) => `<div style="border-radius:${size * 0.05}px;background:radial-gradient(circle at 50% 38%,${c},${b} 50%,${d})"></div>`).join('')}
<div style="position:absolute;left:58%;top:-4%;width:${Math.max(2, size * 0.022)}px;height:108%;background:#F2FAFF;box-shadow:0 0 ${size * 0.05}px ${size * 0.02}px rgba(190,230,255,.85)"></div>
</div></body></html>`;
const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-192.png', 192, 26], ['icon-512.png', 512, 70], ['maskable-512.png', 512, 120], ['apple-touch-icon.png', 180, 24]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size, pad));
  await page.screenshot({ path: `public/icons/${name}` });
  await page.close();
}
await browser.close();
console.log('icons written');
