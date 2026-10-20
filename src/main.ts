/** BREAKBEAT v0.6 boot (step 4 harness: Pixi stage + wall; blade/FX in step 5). */

import { BeatClock, createBeatQuery } from './pulse/BeatClock.js';
import { PulseEngine } from './pulse/PulseEngine.js';
import { GemRules } from './content/gems/GemRules.js';
import { Stage } from './render/Stage.js';
import { TileAtlas } from './render/TileAtlas.js';
import { WallView } from './render/WallView.js';
import { MOVEMENTS } from './audio/tracks.js';

async function boot(): Promise<void> {
  const track = MOVEMENTS[0]!;
  const stage = new Stage();
  await stage.init(document.getElementById('game')!);
  const atlas = new TileAtlas(stage.resolution);
  const wall = new WallView(stage, atlas);
  const engine = new PulseEngine({ seed: 'harness', mode: 'zen', bpm: track.bpm }, new GemRules('brick'));
  const clock = new BeatClock(track.bpm);
  const beat = createBeatQuery();
  const t0 = performance.now() / 1000;
  clock.start(t0);
  // Demo: prime + hold a few groups so every state is visible
  for (let c = 0; c < 16; c += 3) engine.primeAt(c, 9);
  engine.holdAt(9, 9);
  let last = t0;
  const frame = (): void => {
    const now = performance.now() / 1000;
    clock.query(now, beat);
    engine.advanceToStep(beat.visualStep);
    for (const ev of engine.drainEvents()) {
      if (ev.type !== 'danger') wall.markDirty();
      if (ev.type === 'pressure') wall.startPush(beat.visualElapsedSec);
    }
    wall.update(engine, beat, now - last);
    last = now;
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
void boot();
