import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'public/index.html',
  'public/style.css',
  'public/manifest.webmanifest',
  'public/src/main.js',
  'public/src/tuning.js',
  'public/src/pulse/PulseEngine.js',
  'public/src/pulse/BeatClock.js',
  'public/src/content/gems/GemRules.js',
  'public/src/content/gems/Skins.js',
  'public/src/audio/StemConductor.js',
  'public/src/render/WallRenderer.js'
];

for (const rel of requiredFiles) {
  const full = path.resolve(process.cwd(), rel);
  assert.equal(fs.existsSync(full), true, `Missing build artifact: ${rel}`);
}

console.log(`PASS [VERIFY_DEPLOY]: All ${requiredFiles.length} production assets verified in public/.`);
