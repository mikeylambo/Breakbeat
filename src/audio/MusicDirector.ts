/**
 * MusicDirector — turns engine state into music: chain rank -> stem layers, held groups ->
 * extra layer on the pass they detonate, danger -> music-bus low-pass, All Clear -> duck + sting,
 * and on-grid SFX via the Scheduler's predictor.
 */

import { computeChainRank, TUNING } from '../tuning.js';
import type { BeatClock } from '../pulse/BeatClock.js';
import type { PulseEngine } from '../pulse/PulseEngine.js';
import type { PulseEvent } from '../pulse/types.js';
import type { AudioEngine } from './AudioEngine.js';
import type { Scheduler } from './Scheduler.js';
import type { StemPlayer } from './StemPlayer.js';

export class MusicDirector {
  engine: PulseEngine | null = null;
  /** Overture: stems unlocked by lessons (1 = kick only). null = chain rank drives layers. */
  layerOverride: number | null = null;
  private layersPlannedForBar = -1;

  constructor(
    private readonly audio: AudioEngine,
    private readonly stems: StemPlayer,
    private readonly scheduler: Scheduler,
    private readonly clock: BeatClock
  ) {
    scheduler.setPredictor((from, to) => this.predict(from, to));
  }

  attach(engine: PulseEngine): void {
    this.engine = engine;
    this.layersPlannedForBar = -1;
    this.scheduler.resetHorizon();
  }

  /** Predicts detonations on the 16th grid in [fromSec, toSec) so they sound exactly on their step. */
  private predict(fromSec: number, toSec: number): void {
    const engine = this.engine;
    if (!engine || engine.gameOver || !this.clock.isRunning) return;
    const stepSec = this.clock.sixteenthDurationSec;
    const first = Math.max(engine.currentStep + 1, Math.ceil((fromSec - this.clock.stepToAudioSec(0)) / stepSec - 1e-6));
    for (let s = first; ; s++) {
      const t = this.clock.stepToAudioSec(s);
      if (t >= toSec) break;
      if (t < fromSec) continue;
      const sixteenth = s % TUNING.SIXTEENTHS_PER_BAR;
      const bar = Math.floor(s / TUNING.SIXTEENTHS_PER_BAR) + 1;
      let n = 0;
      for (const g of engine.groups.values()) {
        if (g.targetBar > bar || g.state === 'held' || g.anchorCol !== sixteenth) continue;
        if (this.scheduler.isTagged(g.id)) continue;
        const over = g.state === 'overcharged';
        this.scheduler.queue(over ? 'over' : 'detonate', t, Math.min(1, 0.7 + n * 0.08), false, g.id);
        n++;
      }
    }
  }

  /** Once per frame with the current beat state. */
  update(): void {
    const engine = this.engine;
    if (!engine || !this.clock.isRunning) return;
    const step = Math.max(0, engine.currentStep);
    const sixteenth = step % TUNING.SIXTEENTHS_PER_BAR;
    const nextBar = Math.floor(step / TUNING.SIXTEENTHS_PER_BAR) + 2;
    // Plan the next bar's layers during the last beat so the one-beat ramp lands on the downbeat.
    if (sixteenth >= 12 && this.layersPlannedForBar !== nextBar) {
      this.layersPlannedForBar = nextBar;
      let layers: number;
      if (this.layerOverride !== null) {
        layers = this.layerOverride;
      } else {
        let heldDue = 0;
        for (const g of engine.groups.values()) if (g.state === 'overcharged' && g.targetBar <= nextBar) heldDue++;
        layers = computeChainRank(engine.projectedComboPasses) + 2 + heldDue;
      }
      const downbeat = this.clock.stepToAudioSec((nextBar - 1) * TUNING.SIXTEENTHS_PER_BAR);
      this.stems.setLayers(layers, downbeat, this.clock.beatDurationSec);
    }
  }

  /** Immediate layer change (Overture lesson unlocks): lands on the next downbeat. */
  forceLayers(layers: number): void {
    this.layerOverride = layers;
    const engine = this.engine;
    const step = Math.max(0, engine?.currentStep ?? 0);
    const nextBarStep = (Math.floor(step / TUNING.SIXTEENTHS_PER_BAR) + 1) * TUNING.SIXTEENTHS_PER_BAR;
    const downbeat = this.clock.stepToAudioSec(nextBarStep);
    const beat = this.clock.beatDurationSec;
    this.stems.setLayers(layers, Math.max(downbeat, this.audio.now + 0.05), Math.min(beat, Math.max(0.05, downbeat - this.audio.now)));
  }

  private nextBeatSec(): number {
    const beatSteps = 4;
    const { step } = this.clock.nextStepAudioSec(this.audio.now);
    const s = Math.ceil(step / beatSteps) * beatSteps;
    return this.clock.stepToAudioSec(s);
  }

  /** React to engine events as they are drained each frame. */
  onEvent(ev: PulseEvent): void {
    const now = this.audio.now;
    const next16 = this.clock.nextStepAudioSec(now).sec;
    const beat = this.clock.beatDurationSec;
    switch (ev.type) {
      case 'prime':
        this.scheduler.queue(`prime-${ev.kind % 4}`, next16, ev.airPrimed ? 0.95 : 0.8, true);
        break;
      case 'hold':
        this.scheduler.cancelTag(ev.groupId);
        this.scheduler.queue('hold', next16, 0.8);
        break;
      case 'detonate':
        if (this.scheduler.isTagged(ev.groupId)) this.scheduler.settleTag(ev.groupId);
        else this.scheduler.queue(ev.overcharged ? 'over' : 'detonate', Math.max(now, this.clock.stepToAudioSec(ev.step)), 0.8);
        break;
      case 'pressure':
        this.scheduler.queue('slide', Math.max(now, this.clock.stepToAudioSec(ev.step)), 0.6);
        break;
      case 'allclear': {
        const b = this.nextBeatSec();
        this.stems.duckDrums(b, beat);
        this.scheduler.queue('allclear', b + beat, 1);
        break;
      }
      case 'onecolour':
        this.scheduler.queue('hold', next16, 0.6);
        break;
      case 'danger':
        this.audio.setDanger(ev.level, this.nextBeatSec() + beat, beat);
        break;
      default:
        break;
    }
  }
}
