import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'public/index.html',
  'public/style.css',
  'public/manifest.webmanifest',
  'public/app.js',
  'public/synth-worker.js',
  'public/fonts/fonts.css',
  'public/fonts/manrope-latin-600-normal.woff2',
];

for (const rel of requiredFiles) {
  const full = path.resolve(process.cwd(), rel);
  assert.equal(fs.existsSync(full), true, `Missing build artifact: ${rel}`);
}

console.log(`PASS [VERIFY_DEPLOY]: All ${requiredFiles.length} production assets verified in public/.`);
