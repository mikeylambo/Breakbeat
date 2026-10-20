/** BREAKBEAT v0.6 boot (step 5 harness: wall + blade + fx). */

import { BeatClock, createBeatQuery } from './pulse/BeatClock.js';
import { PulseEngine } from './pulse/PulseEngine.js';
import { GemRules } from './content/gems/GemRules.js';
import { Stage } from './render/Stage.js';
import { TileAtlas } from './render/TileAtlas.js';
import { WallView } from './render/WallView.js';
import { BladeView } from './render/BladeView.js';
import { FxView } from './render/FxView.js';
import { MOVEMENTS } from './audio/tracks.js';

async function boot(): Promise<void> {
  await document.fonts.load('700 17px Unbounded');
  await document.fonts.load('500 9px "IBM Plex Mono"');
  const track = MOVEMENTS[0]!;
  const stage = new Stage();
  await stage.init(document.getElementById('game')!);
  const atlas = new TileAtlas(stage.resolution);
  const wall = new WallView(stage, atlas);
  const blade = new BladeView(stage, atlas);
  const fx = new FxView(stage, atlas);
  stage.onLayout(l => fx.setTextResolution(stage.resolution * l.scale));
  const engine = new PulseEngine({ seed: 'harness', mode: 'zen', bpm: track.bpm }, new GemRules('brick'));
  const clock = new BeatClock(track.bpm);
  const beat = createBeatQuery();
  const t0 = performance.now() / 1000;
  clock.start(t0);
  let last = t0;
  let lastBar = 0;
  const frame = (): void => {
    const now = performance.now() / 1000;
    clock.query(now, beat);
    engine.advanceToStep(beat.visualStep);
    if (engine.currentBar !== lastBar) {
      lastBar = engine.currentBar;
      for (let r = 9; r >= 5; r--) for (let c = 15; c >= 0; c -= 2) if (Math.random() < 0.3) { const g = engine.primeAt(c, r); if (g && Math.random() < 0.3) engine.holdAt(c, r); }
    }
    for (const ev of engine.drainEvents()) {
      if (ev.type !== 'danger') wall.markDirty();
      if (ev.type === 'pressure') wall.startPush(beat.visualElapsedSec);
      fx.onEvent(ev, wall);
    }
    const dt = Math.min(0.05, now - last);
    last = now;
    if (!fx.frozen) {
      wall.update(engine, beat, dt);
      blade.update(beat);
      fx.update(now, dt, wall, clock.barDurationSec, beat.beatProgress);
      stage.setZoom(fx.zoom);
    }
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
void boot();
