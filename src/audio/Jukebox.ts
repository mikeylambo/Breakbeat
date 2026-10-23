/**
 * Jukebox — Listen mode's transport. Plays the unlocked soundtrack as full mixes:
 * - Play-through: each section (A, B, C) plays PASSES times, flowing into the next on its loop
 *   boundary, then the next unlocked track blends in on the downbeat where C ends. Repeat One holds
 *   the current section instead.
 * - Section scrub jumps to any section (back too) on the next bar at least half a bar away.
 * - Stem mixer: mute / solo per stem on the stem buses (the visualizers read post-mixer).
 * - Sleep timer: the music fades over the last 8 seconds, then holds.
 * All timing is in clock steps (16 per bar), so tempo changes between tracks never drift it. The
 * host owns the audio; this class only decides when, so it runs in Node tests with a fake host.
 */

import type { TrackDef } from './tracks.js';

/** kick, bass, keys, lead, top (STEM_NAMES order; tracks.js is not imported so Node tests can run this). */
const STEMS = [0, 1, 2, 3, 4] as const;

export const PASSES = 2;
export const SLEEP_MINUTES = [0, 15, 30, 60] as const;
const BAR = 16;
const SLEEP_FADE_SEC = 8;

export interface JukeboxHost {
  /** Current audio step (not latency compensated: scheduling follows what is rendered). */
  step(): number;
  /** Audio-clock seconds (stop while the music is held). */
  now(): number;
  /** Blend `track` in on `atStep` (else the next downbeat); resolves to its bar-1 step. */
  blendTo(track: TrackDef, atStep?: number): Promise<number | null>;
  preload(track: TrackDef): void;
  /** Let the playhead flow into section `index` at the end of the current loop pass. */
  flowToSection(index: number): void;
  /** Cut to section `index` on `atStep` (a downbeat). */
  jumpSection(index: number, atStep: number): void;
  setMix(levels: readonly number[], rampSec: number): void;
  hold(on: boolean): void;
}

export type Repeat = 'all' | 'one';

export class Jukebox {
  track: TrackDef | null = null;
  section = 0;
  /** Step where the current section's first pass began */
  sectionStartStep = 0;
  /** Step where the current track's bar 1 landed */
  trackStartStep = 0;
  repeat: Repeat = 'all';
  paused = false;
  readonly mute = STEMS.map(() => false);
  readonly solo = STEMS.map(() => false);
  sleepMinutes: (typeof SLEEP_MINUTES)[number] = 0;
  /** Set when the sleep timer ended playback (the screen says goodnight) */
  slept = false;
  /** The current track arrived by playing through the previous one (not picked) */
  autoAdvanced = false;
  /** The track queued to blend in (null step until its load resolves) */
  pendingTrack: { track: TrackDef; step: number | null } | null = null;
  /** The section the playhead moves to, and the step it lands on */
  pendingSection: { index: number; step: number } | null = null;

  private sleepEnd = 0;
  private fading = false;
  private token = 0;

  constructor(
    private readonly host: JukeboxHost,
    /** Unlocked tracks in album order (re-read every time, so new unlocks join the queue) */
    private readonly queue: () => readonly TrackDef[]
  ) {}

  /** Plays `track` from bar 1 (blends in on the next downbeat if music is running). */
  play(track: TrackDef): void {
    this.autoAdvanced = false;
    if (this.paused) this.resume();
    this.slept = false;
    this.schedule(track);
  }

  next(): void {
    const t = this.neighbour(1);
    if (t) this.play(t);
  }

  prev(): void {
    const t = this.neighbour(-1);
    if (t) this.play(t);
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else {
      this.paused = true;
      this.host.hold(true);
    }
  }

  /** Jumps to section `index` on the next bar at least half a bar away. */
  jump(index: number): void {
    const t = this.track;
    if (!t || index < 0 || index >= t.sections.length || this.pendingTrack) return;
    const at = Math.ceil((this.host.step() + BAR / 2) / BAR) * BAR;
    this.host.jumpSection(index, at);
    this.pendingSection = { index, step: at };
  }

  cycleRepeat(): void {
    this.repeat = this.repeat === 'all' ? 'one' : 'all';
  }

  cycleSleep(): void {
    const i = SLEEP_MINUTES.indexOf(this.sleepMinutes);
    this.sleepMinutes = SLEEP_MINUTES[(i + 1) % SLEEP_MINUTES.length]!;
    this.sleepEnd = this.sleepMinutes ? this.host.now() + this.sleepMinutes * 60 : 0;
    if (this.fading) {
      this.fading = false;
      this.applyMix(0.3);
    }
  }

  /** Seconds until the sleep timer ends playback (0 when off). */
  get sleepLeft(): number {
    return this.sleepEnd ? Math.max(0, this.sleepEnd - this.host.now()) : 0;
  }

  toggleMute(i: number): void {
    this.mute[i] = !this.mute[i];
    this.applyMix();
  }

  toggleSolo(i: number): void {
    this.solo[i] = !this.solo[i];
    this.applyMix();
  }

  /** Per-stem bus levels: any solo wins; otherwise mutes. */
  get levels(): number[] {
    const anySolo = this.solo.some(Boolean);
    return STEMS.map((_, i) => (anySolo ? (this.solo[i] ? 1 : 0) : this.mute[i] ? 0 : 1));
  }

  /** Pass (1-based) of the current section, and progress through that pass 0..1. */
  passInfo(step = this.host.step()): { pass: number; progress: number } {
    const t = this.track;
    if (!t) return { pass: 1, progress: 0 };
    const len = t.sections[this.section]!.bars * BAR;
    const into = Math.max(0, step - this.sectionStartStep);
    return { pass: Math.min(PASSES, Math.floor(into / len) + 1), progress: (into % len) / len };
  }

  /** Track length in a play-through, in steps. */
  static lengthSteps(t: TrackDef): number {
    return t.sections.reduce((a, s) => a + s.bars, 0) * BAR * PASSES;
  }

  /** Releases everything Listen mode changed (unity mix, music running, timers off). */
  stop(): void {
    this.token++;
    this.mute.fill(false);
    this.solo.fill(false);
    this.sleepMinutes = 0;
    this.sleepEnd = 0;
    this.fading = false;
    this.slept = false;
    this.pendingTrack = null;
    this.pendingSection = null;
    this.track = null;
    this.host.setMix(this.levels, 0.05);
    if (this.paused) {
      this.paused = false;
      this.host.hold(false);
    }
  }

  /** Once per frame. */
  update(): void {
    if (this.paused) return;
    const step = this.host.step();

    // Sleep: fade the last seconds, then hold
    if (this.sleepEnd) {
      const left = this.sleepEnd - this.host.now();
      if (left <= SLEEP_FADE_SEC && !this.fading) {
        this.fading = true;
        this.host.setMix(STEMS.map(() => 0), Math.max(0.05, left));
      }
      if (left <= 0) {
        this.sleepEnd = 0;
        this.sleepMinutes = 0;
        this.slept = true;
        this.paused = true;
        this.host.hold(true);
        return;
      }
    }

    const pt = this.pendingTrack;
    if (pt && pt.step !== null && step >= pt.step) {
      this.track = pt.track;
      this.trackStartStep = pt.step;
      this.section = 0;
      this.sectionStartStep = pt.step;
      this.pendingTrack = null;
      this.pendingSection = null;
    }
    const ps = this.pendingSection;
    if (ps && step >= ps.step) {
      if (ps.index === 0) this.trackStartStep = ps.step;
      this.section = ps.index;
      this.sectionStartStep = ps.step;
      this.pendingSection = null;
    }

    const t = this.track;
    if (!t || this.repeat === 'one' || this.pendingTrack || this.pendingSection) return;
    const len = t.sections[this.section]!.bars * BAR;
    const end = this.sectionStartStep + len * PASSES;
    if (step < end - len) return;
    const last = this.section === t.sections.length - 1;
    if (!last) {
      // Final pass: move the loop points so the playhead flows on at the pass boundary
      this.host.flowToSection(this.section + 1);
      this.pendingSection = { index: this.section + 1, step: end };
      return;
    }
    const nxt = this.neighbour(1);
    if (!nxt) return;
    this.host.preload(nxt);
    // Blend in the final bar (at least half a bar ahead), on the downbeat where C ends. A frame
    // that misses the window (a stall) takes the next downbeat instead, so the album never stops.
    if (step < end - BAR) return;
    const at = step <= end - BAR / 2 ? end : Math.ceil((step + BAR / 2) / BAR) * BAR;
    if (nxt === t) {
      this.host.jumpSection(0, at);
      this.pendingSection = { index: 0, step: at };
      return;
    }
    this.autoAdvanced = true;
    this.schedule(nxt, at);
  }

  private schedule(track: TrackDef, atStep?: number): void {
    const token = ++this.token;
    this.pendingSection = null;
    const pending = { track, step: null as number | null };
    this.pendingTrack = pending;
    void this.host.blendTo(track, atStep).then(step => {
      if (token !== this.token) return;
      if (step === null) this.pendingTrack = null;
      else pending.step = step;
    });
  }

  private resume(): void {
    this.paused = false;
    this.slept = false;
    if (this.fading) {
      this.fading = false;
      this.applyMix(0.3);
    }
    this.host.hold(false);
  }

  private applyMix(rampSec = 0.03): void {
    if (!this.fading) this.host.setMix(this.levels, rampSec);
  }

  private neighbour(dir: 1 | -1): TrackDef | null {
    const q = this.queue();
    if (!q.length) return null;
    const cur = this.pendingTrack?.track ?? this.track;
    const i = cur ? q.indexOf(cur) : -1;
    if (i < 0) return q[dir === 1 ? 0 : q.length - 1]!;
    return q[(i + dir + q.length) % q.length]!;
  }
}
