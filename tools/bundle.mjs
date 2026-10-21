/** Bundles the browser game into public/app.js (pixi.js, fonts CSS and content JSON included; no CDN). */
import { build } from 'esbuild';
import fs from 'node:fs';

// index.html: inline the two fonts the boot title needs so it paints with the first frame
const face = (family, weight, file) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(`public/fonts/${file}`).toString('base64')}) format('woff2')}`;
const bootFonts = `<style>${face('Unbounded', 700, 'unbounded-latin-700-normal.woff2')}${face('IBM Plex Mono', 500, 'ibm-plex-mono-latin-500-normal.woff2')}</style>`;
fs.writeFileSync('public/index.html', fs.readFileSync('src/index.html', 'utf8').replace('<!--BOOT_FONTS-->', bootFonts));

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari15'],
  outfile: 'public/app.js',
  minify: process.env.BB_DEV !== '1',
  sourcemap: true,
  legalComments: 'none',
  loader: { '.json': 'json' },
  logLevel: 'warning'
});
await build({
  entryPoints: ['src/audio/placeholder/synth.worker.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2022', 'safari15'],
  outfile: 'public/synth-worker.js',
  minify: process.env.BB_DEV !== '1',
  logLevel: 'warning'
});
console.log('Bundled public/app.js + public/synth-worker.js');
