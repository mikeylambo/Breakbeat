/**
 * StemPlayer — five phase-locked stems per movement, started on one AudioContext time and
 * looping sample-accurately. Chain rank sets the active layers; gain moves ramp over one beat
 * and land on the downbeat. Movements morph by crossfading decks over one bar.
 */

import { rampParam, type AudioEngine } from './AudioEngine.js';
import { renderStem } from './placeholder/Synth.js';
import { STEM_NAMES, type StemName, type TrackDef } from './tracks.js';

/** Per-stem mix level. */
const MIX: Record<StemName, number> = { kick: 0.95, bass: 0.72, keys: 0.5, lead: 0.42, top: 0.5 };

/** Layer levels per active-layer count (1..6). 6 = "full": every stem at full level. */
const LAYERS: number[][] = [
  [1, 0, 0, 0, 0],
  [1, 1, 0, 0, 0], // rank 0: kick + bass
  [1, 1, 1, 0, 0], // rank 1: + keys
  [1, 1, 1, 1, 0], // rank 2: + lead
  [0.92, 0.92, 0.88, 0.88, 0.8], // rank 3: + top
  [1, 1, 1, 1, 1] // rank 4: full
];

type StemSet = Record<StemName, AudioBuffer>;

export class StemPlayer {
  private readonly cache = new Map<string, Promise<StemSet>>();
  private sources: (AudioBufferSourceNode | null)[][] = [
    [null, null, null, null, null],
    [null, null, null, null, null]
  ];
  private deck = 0;
  private layers = 2;
  private duckUntil = 0;
  track: TrackDef | null = null;
  /** Playback rate (BPM scaling accessibility option). */
  rate = 1;

  constructor(private readonly audio: AudioEngine) {}

  /** Decodes (or renders placeholders for) a movement's stems once. */
  load(track: TrackDef): Promise<StemSet> {
    let p = this.cache.get(track.id);
    if (!p) {
      p = this.loadSet(track);
      this.cache.set(track.id, p);
    }
    return p;
  }

  private async loadSet(track: TrackDef): Promise<StemSet> {
    const out = {} as StemSet;
    if (track.stemsReady) {
      try {
        await Promise.all(
          STEM_NAMES.map(async name => {
            // Same-origin bundled asset; decoded before the transport starts.
            const res = await fetch(`./${track.stems[name]}`);
            out[name] = await this.audio.ctx.decodeAudioData(await res.arrayBuffer());
          })
        );
        return out;
      } catch {
        // fall through to the placeholder arrangement
      }
    }
    const rendered = await Promise.all(STEM_NAMES.map(name => renderStem(track, name)));
    STEM_NAMES.forEach((name, i) => (out[name] = rendered[i]!));
    return out;
  }

  /** Starts `track` so its bar 1 lands exactly on `atSec` (the clock's step 0). */
  async start(track: TrackDef, atSec: number, layers: number): Promise<void> {
    const set = await this.load(track);
    this.stopAll(atSec);
    this.track = track;
    this.deck = 0;
    this.layers = layers;
    this.launch(0, set, track, atSec);
    this.applyLayers(atSec, atSec + 0.01);
  }

  private launch(deck: number, set: StemSet, track: TrackDef, atSec: number): void {
    const ctx = this.audio.ctx;
    STEM_NAMES.forEach((name, i) => {
      const src = ctx.createBufferSource();
      src.buffer = set[name];
      src.loop = true;
      src.playbackRate.value = this.rate;
      src.loopStart = 0;
      src.loopEnd = set[name].duration;
      src.connect(this.audio.stemGains[deck]![i]!);
      src.start(Math.max(ctx.currentTime, atSec), (track.offsetMs / 1000) % set[name].duration);
      src.onended = null;
      this.sources[deck]![i] = src;
    });
  }

  /** Active layer count 1..6 (rank + 2, or the Overture's unlocked stems). Ramps over a beat to `downbeatSec`. */
  setLayers(layers: number, downbeatSec: number, beatSec: number): void {
    const clamped = Math.max(1, Math.min(6, layers));
    if (clamped === this.layers) return;
    this.layers = clamped;
    this.applyLayers(downbeatSec - beatSec, downbeatSec);
  }

  get activeLayers(): number {
    return this.layers;
  }

  private applyLayers(startSec: number, endSec: number): void {
    const levels = LAYERS[this.layers - 1]!;
    STEM_NAMES.forEach((name, i) => {
      const ducked = (name === 'kick' || name === 'top') && this.duckUntil > startSec;
      rampParam(this.audio.stemGains[this.deck]![i]!.gain, ducked ? 0 : levels[i]! * MIX[name], startSec, endSec);
    });
  }

  /** All Clear: duck drums and top for one beat starting at `atSec`. */
  duckDrums(atSec: number, beatSec: number): void {
    this.duckUntil = atSec + beatSec;
    const levels = LAYERS[this.layers - 1]!;
    for (const name of ['kick', 'top'] as const) {
      const i = STEM_NAMES.indexOf(name);
      const g = this.audio.stemGains[this.deck]![i]!.gain;
      rampParam(g, 0, atSec, atSec + 0.03);
      rampParam(g, levels[i]! * MIX[name], atSec + beatSec - 0.03, atSec + beatSec);
    }
  }

  /** Movement morph: the next movement starts at `atSec` (a downbeat) and crossfades over one bar. */
  async morph(track: TrackDef, atSec: number, barSec: number): Promise<void> {
    const set = await this.load(track);
    const from = this.deck;
    const to = 1 - from;
    this.stopDeck(to, atSec);
    this.launch(to, set, track, atSec);
    const levels = LAYERS[this.layers - 1]!;
    STEM_NAMES.forEach((name, i) => {
      rampParam(this.audio.stemGains[from]![i]!.gain, 0, atSec, atSec + barSec);
      const g = this.audio.stemGains[to]![i]!.gain;
      rampParam(g, 0, atSec - 0.01, atSec);
      rampParam(g, levels[i]! * MIX[name], atSec, atSec + barSec);
    });
    this.stopDeck(from, atSec + barSec + 0.05);
    this.deck = to;
    this.track = track;
  }

  private stopDeck(deck: number, atSec: number): void {
    const list = this.sources[deck]!;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s) {
        try {
          s.stop(Math.max(this.audio.ctx.currentTime, atSec));
        } catch {
          // already stopped
        }
        list[i] = null;
      }
    }
  }

  stopAll(atSec = this.audio.ctx.currentTime): void {
    this.stopDeck(0, atSec);
    this.stopDeck(1, atSec);
    for (const deck of this.audio.stemGains) for (const g of deck) rampParam(g.gain, 0, atSec, atSec + 0.05);
  }
}
