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

export type StemSet = Record<StemName, AudioBuffer>;

/** Flat mix level for player-made tracks (band splits of one master: equal levels keep it whole). */
const FLAT = 0.85;

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
  /** Decoded stems of `track` */
  private current: StemSet | null = null;
  /** Playback rate (BPM scaling accessibility option). */
  rate = 1;
  /** Current section index (A = 0) of the playing deck */
  section = 0;

  constructor(private readonly audio: AudioEngine) {}

  /**
   * Hands over stems built elsewhere (Upload Your Own Beat). Only the latest player track stays
   * cached, so a shelf of songs never piles up in memory.
   */
  register(track: TrackDef, set: StemSet): void {
    for (const id of [...this.cache.keys()]) if (id.startsWith('beat-') && id !== track.id && this.track?.id !== id) this.cache.delete(id);
    this.cache.set(track.id, Promise.resolve(set));
  }

  private mix(name: StemName, track = this.track): number {
    return track?.flatMix ? FLAT : MIX[name];
  }

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
  /** Starts `track` at `section` (A = 0); a section keeps looping until setSection moves on. */
  async start(track: TrackDef, atSec: number, layers: number, section = 0): Promise<void> {
    const set = await this.load(track);
    this.stopAll(atSec);
    this.track = track;
    this.current = set;
    this.deck = 0;
    this.layers = layers;
    this.section = section;
    this.launch(0, set, track, atSec, section);
    this.applyLayers(atSec, atSec + 0.01);
  }

  private launch(deck: number, set: StemSet, track: TrackDef, atSec: number, section = 0): void {
    const ctx = this.audio.ctx;
    STEM_NAMES.forEach((name, i) => {
      const src = ctx.createBufferSource();
      src.buffer = set[name];
      src.loop = true;
      src.playbackRate.value = this.rate;
      const [loStart, loEnd] = sectionRange(track, section, set[name].duration);
      src.loopStart = loStart;
      src.loopEnd = loEnd;
      src.connect(this.audio.stemGains[deck]![i]!);
      src.start(Math.max(ctx.currentTime, atSec), (loStart + track.offsetMs / 1000) % set[name].duration);
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
      rampParam(this.audio.stemGains[this.deck]![i]!.gain, ducked ? 0 : levels[i]! * this.mix(name), startSec, endSec);
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
      rampParam(g, levels[i]! * this.mix(name), atSec + beatSec - 0.03, atSec + beatSec);
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
      rampParam(g, levels[i]! * this.mix(name, track), atSec, atSec + barSec);
    });
    this.stopDeck(from, atSec + barSec + 0.05);
    this.deck = to;
    this.track = track;
    this.current = set;
    this.section = 0;
  }

  /**
   * Steps the music forward to section `index` (never back). The playhead finishes the current
   * section and flows straight into the next, so the change always lands on a section boundary.
   */
  setSection(index: number): void {
    const track = this.track;
    if (!track || index <= this.section || index >= track.sections.length) return;
    this.section = index;
    for (const src of this.sources[this.deck]!) {
      if (!src?.buffer) continue;
      const [lo, hi] = sectionRange(track, index, src.buffer.duration);
      src.loopEnd = hi;
      src.loopStart = lo;
    }
  }

  /**
   * Cuts the playing deck to section `index` (back or forward) at `atSec`, a downbeat: the stems
   * restart sample-aligned at the section's first bar and loop it. Listen mode's section scrub.
   */
  jumpSection(index: number, atSec: number): void {
    const track = this.track;
    const set = this.current;
    if (!track || !set || index < 0 || index >= track.sections.length) return;
    this.stopDeck(this.deck, atSec);
    this.launch(this.deck, set, track, atSec, index);
    this.section = index;
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

/** [start, end) seconds of section `index` inside a stem buffer of `duration`. */
function sectionRange(track: TrackDef, index: number, duration: number): [number, number] {
  const total = track.sections.reduce((a, s) => a + s.bars, 0) || 1;
  let before = 0;
  for (let i = 0; i < index; i++) before += track.sections[i]!.bars;
  const bars = track.sections[index]?.bars ?? total;
  return [(duration * before) / total, (duration * (before + bars)) / total];
}
