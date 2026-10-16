import { readFile, stat, readdir } from 'node:fs/promises';
import { dirname, extname, resolve, relative, sep } from 'node:path';

// Fail the deployment if Vercel would publish missing HTML assets or unresolved JS modules.
const root = resolve('public');
const visited = new Set();
const checkAsset = async (reference, parent) => {
  if (/^(?:https?:|data:|#)/.test(reference)) return;
  const normalized = reference.split(/[?#]/)[0];
  const path = normalized.startsWith('/')
    ? resolve(root, '.' + normalized)
    : resolve(dirname(parent), normalized);
  if (path !== root && !path.startsWith(root + sep)) throw Error(`Asset escapes public/: ${reference}`);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw Error(`Missing deployed asset: ${relative(root, path)} (from ${relative(root, parent)})`);
  if (extname(path) === '.js' && !visited.has(path)) {
    visited.add(path);
    const code = await readFile(path, 'utf8');
    for (const m of code.matchAll(/\b(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) await checkAsset(m[1], path);
    }
  }
};
const htmlFile = resolve(root, 'index.html');
const html = await readFile(htmlFile, 'utf8');
const assets = [...html.matchAll(/\b(?:src|href)=["]([^"]+)["]/g)].map(m => m[1]);
for (const a of assets) await checkAsset(a, htmlFile);
const manifestFile = resolve(root, 'manifest.webmanifest');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
for (const i of manifest.icons ?? []) await checkAsset(i.src, resolve(root, 'index.html'));
const requiredIds=['menuSettingsBtn','tutorialBtn','journeyOverview','personaRow','lessonAction','assistBtn','bpmScale','autoPrime','highContrast','resultAccolade','replayCanvas','replayPanel','unlockPanel','nextMovementBtn','selectedCell','challengeSelect','challengeList','challengeDescription','challengeHud','challengeHudLabel','challengeHudProgress','challengeResult','pressureForecast','pressureRows','pressureFill','rowPreview'];
for(const id of requiredIds){
  const occurrence=html.split(`id="${id}"`).length-1;
  if(occurrence!==1)throw Error(`Required 0.4 UI control ${id} has ${occurrence} elements`);
}
const files = await readdir(root);
if (!files.includes('index.html') || !files.includes('style.css')) throw Error('Missing static entrypoints');
console.log(`PASS VERCEL_OUTPUT — ${assets.length} HTML references, ${visited.size} JS modules, ${manifest.icons?.length ?? 0} PWA icons resolved inside public/`);
