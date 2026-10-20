/** BREAKBEAT v0.6 boot (step 3: audio + clock harness; the Pixi stage arrives in step 4). */

import { TUNING } from './tuning.js';
import { BeatClock, createBeatQuery } from './pulse/BeatClock.js';
import { PulseEngine } from './pulse/PulseEngine.js';
import { GemRules } from './content/gems/GemRules.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { StemPlayer } from './audio/StemPlayer.js';
import { SfxPlayer } from './audio/SfxPlayer.js';
import { Scheduler } from './audio/Scheduler.js';
import { MusicDirector } from './audio/MusicDirector.js';
import { MOVEMENTS } from './audio/tracks.js';

const track = MOVEMENTS[0]!;
const audio = new AudioEngine();
const stems = new StemPlayer(audio);
const sfx = new SfxPlayer(audio);
const scheduler = new Scheduler(sfx, () => audio.now);
const clock = new BeatClock(track.bpm);
const director = new MusicDirector(audio, stems, scheduler, clock);
const engine = new PulseEngine({ seed: 'harness', mode: 'zen', bpm: track.bpm }, new GemRules('brick'));
const beat = createBeatQuery();

async function boot(): Promise<void> {
  await audio.unlock();
  await Promise.all([stems.load(track), sfx.load()]);
  sfx.setTrack(track);
  clock.outputLatencySec = audio.outputLatencySec;
  const t0 = audio.now + 0.1;
  clock.start(t0);
  director.attach(engine);
  await stems.start(track, t0, 2);
  scheduler.start();
  const frame = (): void => {
    clock.query(audio.now, beat);
    engine.advanceToStep(beat.visualStep);
    for (const ev of engine.drainEvents()) director.onEvent(ev);
    director.update();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

window.addEventListener('pointerdown', () => void boot(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    void audio.suspend();
    clock.pause(audio.now);
  } else {
    void audio.resume().then(() => clock.resume(audio.now));
  }
});
void TUNING;
