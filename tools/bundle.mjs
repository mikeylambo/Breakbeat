/** Bundles the browser game into public/app.js (pixi.js, fonts CSS and content JSON included; no CDN). */
import { build } from 'esbuild';

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
