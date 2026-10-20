/**
 * App — owns the stage, audio, clock and the current run, and routes between screens.
 * One frame loop: query the audio clock once, hand the result to engine, renderer and HUD.
 */

import { TUNING, computeComboMultiplier, type GameMode } from '../tuning.js';
import { BeatClock, createBeatQuery } from '../pulse/BeatClock.js';
import { PulseEngine } from '../pulse/PulseEngine.js';
import type { PulseEvent } from '../pulse/types.js';
import { GemRules } from '../content/gems/GemRules.js';
import { Stage } from '../render/Stage.js';
import { TileAtlas } from '../render/TileAtlas.js';
import { WallView } from '../render/WallView.js';
import { BladeView } from '../render/BladeView.js';
import { FxView } from '../render/FxView.js';
import { TitleBackdrop } from '../render/TitleBackdrop.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { StemPlayer } from '../audio/StemPlayer.js';
import { SfxPlayer } from '../audio/SfxPlayer.js';
import { Scheduler } from '../audio/Scheduler.js';
import { MusicDirector } from '../audio/MusicDirector.js';
import { MOVEMENTS, OVERTURE, type TrackDef } from '../audio/tracks.js';
import { installBrowserLifecycle } from '../platform/Lifecycle.js';
import { loadSave, todayUtc, writeSave, type SaveData } from '../meta/Save.js';
import { loadSettings, saveSettings, type Settings } from '../meta/Settings.js';
import { InputController } from './input.js';
import { haptics } from './haptics.js';
import { RunHud } from './RunHud.js';
import { PauseSheet } from './PauseSheet.js';
import { RotateCard } from './RotateCard.js';
import { announce } from './dom.js';

/** Per-movement light behind the wall (crossfaded on movement morphs). */
export const MOVEMENT_TINT: Record<string, number> = {
  overture: 0x1b1f33,
  ignition: 0x1a2a4a,
  glasswork: 0x123a3e,
  lattice: 0x2a1d4a,
  phosphor: 0x16382a,
  magma: 0x3a2214,
  'still-water': 0x173445
};

export interface RunConfig {
  mode: GameMode;
  /** Movement index into MOVEMENTS (ignored for the Overture) */
  movement: number;
  seed?: string;
}

export interface InputLogEntry {
  step: number;
  type: 'p' | 'h';
  col: number;
  row: number;
}

export interface RunState {
  cfg: RunConfig;
  mode: GameMode;
  startMovement: number;
  movement: number;
  track: TrackDef;
  movementStartScore: number;
  seed: string;
  ended: boolean;
  morph: { step: number; index: number; atSec: number } | null;
  inputLog: InputLogEntry[];
  bpmScale: number;
  movementsCleared: number;
}

export interface RunResult {
  run: RunState;
  engine: PulseEngine;
  score: number;
  previousBest: number;
  key: string;
}

/** Screens plug in through this surface (title, results, settings, overture). */
export interface ScreenHooks {
  onRunEnd?(result: RunResult): void;
  onEvent?(ev: PulseEvent): void;
  onFrame?(): void;
}

export class App {
  readonly stage = new Stage();
  atlas!: TileAtlas;
  wall!: WallView;
  blade!: BladeView;
  fx!: FxView;
  backdrop!: TitleBackdrop;
  readonly audio = new AudioEngine();
  readonly stems = new StemPlayer(this.audio);
  readonly sfx = new SfxPlayer(this.audio);
  readonly scheduler = new Scheduler(this.sfx, () => this.audio.now);
  readonly clock = new BeatClock(MOVEMENTS[0]!.bpm);
  readonly director = new MusicDirector(this.audio, this.stems, this.scheduler, this.clock);
  readonly beat = createBeatQuery();
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly hud: RunHud;
  readonly pause: PauseSheet;
  readonly rotate = new RotateCard();
  input!: InputController;

  settings: Settings = loadSettings();
  save: SaveData = loadSave();
  engine: PulseEngine | null = null;
  run: RunState | null = null;
  hooks: ScreenHooks = {};
  paused = false;
  private blocked = false;
  private lastFrameSec = 0;
  private lastHapticStep = -1;
  private lastTickBeat = -1;
  private readonly cellPt = { x: 0, y: 0 };
  /** Opens the settings sheet (set by SettingsSheet in step 11). */
  openSettings: () => void = () => {};
  /** Returns to the title (set by TitleScreen). */
  showTitle: () => void = () => {};

  constructor() {
    this.hud = new RunHud(() => this.setPaused(true));
    this.pause = new PauseSheet({
      resume: () => this.setPaused(false),
      restart: () => {
        const cfg = this.run?.cfg;
        this.pause.show(false);
        if (cfg) void this.startRun(cfg);
      },
      settings: () => this.openSettings(),
      quit: () => {
        this.pause.show(false);
        this.abandonRun();
        this.showTitle();
      }
    });
  }

  async init(): Promise<void> {
    await Promise.all([
      document.fonts.load('700 17px Unbounded'),
      document.fonts.load('500 9px "IBM Plex Mono"'),
      document.fonts.load('600 12px Manrope')
    ]).catch(() => undefined);
    await this.stage.init(document.getElementById('game')!);
    this.atlas = new TileAtlas(this.stage.resolution, this.settings.colourAssist);
    this.wall = new WallView(this.stage, this.atlas);
    this.blade = new BladeView(this.stage, this.atlas);
    this.fx = new FxView(this.stage, this.atlas);
    this.backdrop = new TitleBackdrop(this.stage, this.atlas);
    this.applySettings();

    this.hud.show(false);
    this.ui.append(this.hud.root, this.pause.root);
    this.stage.onLayout(l => {
      this.ui.style.transform = `translate(${l.x}px, ${l.y}px) scale(${l.scale})`;
      this.fx.setTextResolution(this.stage.resolution * Math.max(1, l.scale));
    });

    this.input = new InputController(document.getElementById('game')!, {
      enabled: () => !!this.run && !this.run.ended && !this.paused && !this.blocked,
      cellAt: (x, y) => this.wall.cellAt(x, y),
      toLogical: (cx, cy, out) => this.stage.toLogical(cx, cy, out),
      cellCentre: (cell, out) => WallView.cellCentre(cell % TUNING.BOARD_COLS, (cell / TUNING.BOARD_COLS) | 0, out),
      holdRing: (x, y, p) => this.fx.setHoldRing(x, y, p),
      groupAt: cell => this.groupAt(cell),
      canHold: id => {
        const g = this.engine?.groups.get(id);
        return !!g && !g.held;
      },
      prime: cell => this.prime(cell),
      hold: cell => this.hold(cell)
    });

    installBrowserLifecycle(
      {
        onBackground: () => this.onHidden(),
        onForeground: () => this.onVisible()
      },
      this.stage.app.canvas as HTMLCanvasElement
    );
    const checkOrientation = (): void => this.setBlocked(RotateCard.isPortrait());
    window.addEventListener('resize', checkOrientation);
    checkOrientation();

    window.addEventListener('keydown', e => {
      if (e.key === 'v' || e.key === 'V') {
        this.settings.hudHidden = !this.settings.hudHidden;
        saveSettings(this.settings);
        this.hud.setHidden(this.settings.hudHidden);
      } else if (e.key === 'Escape' && this.run && !this.run.ended) {
        this.setPaused(!this.paused);
      }
    });

    // Render placeholder audio in the background; no user gesture needed for offline rendering.
    void this.sfx.load();
    void this.stems.load(this.save.overtureDone ? MOVEMENTS[0]! : OVERTURE).then(() => this.stems.load(MOVEMENTS[0]!));

    this.scheduler.start();
    requestAnimationFrame(this.frame);
  }

  applySettings(): void {
    const s = this.settings;
    this.audio.setVolumes(s.volume, s.music, s.sfx);
    this.atlas.setAssist(s.colourAssist);
    this.wall.setAtlas(this.atlas);
    this.fx.setAtlas(this.atlas);
    this.backdrop?.setAtlas(this.atlas);
    this.wall.reducedMotion = s.reducedMotion;
    this.wall.flashScale = s.flash;
    this.fx.settings.reducedMotion = s.reducedMotion;
    this.fx.settings.flash = s.flash;
    this.fx.settings.strobeFree = s.strobeFree;
    this.stage.setBloomStrength(0.4 + 0.6 * s.flash);
    haptics.setEnabled(s.haptics);
    this.hud.setHidden(s.hudHidden);
    this.clock.outputLatencySec = this.audio.outputLatencySec + s.offsetMs / 1000;
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion);
  }

  persistSettings(): void {
    saveSettings(this.settings);
    this.applySettings();
  }

  persistSave(): void {
    writeSave(this.save);
  }

  // ---------------------------------------------------------------- runs

  async startRun(cfg: RunConfig): Promise<void> {
    this.abandonRun();
    await this.audio.unlock();
    const overture = cfg.mode === 'overture';
    const index = overture ? 0 : Math.max(0, Math.min(MOVEMENTS.length - 1, cfg.movement));
    const dayIndex = Math.floor(Date.parse(todayUtc()) / 86400000) % MOVEMENTS.length;
    const trackIndex = cfg.mode === 'zen' ? 5 : cfg.mode === 'daily' ? dayIndex : index;
    const track = overture ? OVERTURE : MOVEMENTS[trackIndex]!;
    const bpmScale = cfg.mode === 'daily' || overture ? 1 : this.settings.bpmScale;
    const bpm = track.bpm * bpmScale;
    const seed = cfg.seed ?? (cfg.mode === 'daily' ? `daily-${todayUtc()}` : `${cfg.mode}-${Date.now().toString(36)}`);
    await Promise.all([this.stems.load(track), this.sfx.load()]);

    const engine = new PulseEngine(
      {
        seed,
        mode: cfg.mode,
        bpm,
        colorCount: track.colors,
        riseBars: track.riseBars,
        pressureEnabled: !overture
      },
      new GemRules('brick')
    );
    this.engine = engine;
    this.run = {
      cfg,
      mode: cfg.mode,
      startMovement: index,
      movement: overture ? 0 : trackIndex,
      track,
      movementStartScore: 0,
      seed,
      ended: false,
      morph: null,
      inputLog: [],
      bpmScale,
      movementsCleared: 0
    };
    this.paused = false;
    this.pause.show(false);
    this.sfx.setTrack(track);
    this.stems.rate = bpmScale;
    this.clock.bpm = bpm;
    this.clock.outputLatencySec = this.audio.outputLatencySec + this.settings.offsetMs / 1000;
    const t0 = this.audio.now + 0.12;
    this.clock.start(t0);
    this.director.layerOverride = overture ? 1 : null;
    this.director.attach(engine);
    await this.stems.start(track, t0, overture ? 1 : 2);
    this.audio.setDanger(0, this.audio.now + 0.05, 0.05);
    this.wall.markDirty();
    this.wall.dangerLevel = 0;
    this.wall.setPoolTint(MOVEMENT_TINT[track.id] ?? 0x1a2340, performance.now() / 1000, 0);
    this.fx.markGroupsDirty();
    this.lastHapticStep = -1;
    this.hud.show(true);
    this.save.runs++;
    this.persistSave();
    if (!overture) announce(`Movement ${track.number}, ${track.name}. ${Math.round(bpm)} BPM.`);
  }

  /** Ends the current run silently (quit / restart). */
  abandonRun(): void {
    if (!this.run) return;
    this.run.ended = true;
    this.stems.stopAll();
    this.input?.cancelAll();
    this.run = null;
    this.engine = null;
    this.director.engine = null;
    this.hud.show(false);
  }

  private groupAt(cell: number): number {
    const e = this.engine;
    if (!e) return -1;
    const t = e.board[(cell / TUNING.BOARD_COLS) | 0]?.[cell % TUNING.BOARD_COLS];
    if (!t) return -1;
    return e.getGroupForTile(t.id)?.id ?? -1;
  }

  /** Overture focus: lessons restrict which cells can be touched. */
  canTouch: (cell: number) => boolean = () => true;

  private prime(cell: number): number {
    const e = this.engine;
    if (!e || !this.canTouch(cell)) return -1;
    const col = cell % TUNING.BOARD_COLS;
    const row = (cell / TUNING.BOARD_COLS) | 0;
    const g = e.primeAt(col, row, this.beat.visualElapsedSec);
    if (!g) return -1;
    this.run?.inputLog.push({ step: e.currentStep, type: 'p', col, row });
    this.wall.markDirty();
    this.fx.markGroupsDirty();
    haptics.pulse('prime');
    // Drain now so the prime tone is scheduled on the very next 16th
    this.drain();
    return g.id;
  }

  private hold(cell: number): void {
    const e = this.engine;
    if (!e) return;
    const col = cell % TUNING.BOARD_COLS;
    const row = (cell / TUNING.BOARD_COLS) | 0;
    if (e.holdAt(col, row)) {
      this.run?.inputLog.push({ step: e.currentStep, type: 'h', col, row });
      this.wall.markDirty();
      this.fx.markGroupsDirty();
      this.drain();
    }
  }

  private drain(): void {
    const e = this.engine;
    if (!e) return;
    for (const ev of e.drainEvents()) this.onEvent(ev);
  }

  private onEvent(ev: PulseEvent): void {
    this.director.onEvent(ev);
    this.fx.onEvent(ev, this.wall);
    switch (ev.type) {
      case 'danger':
        this.wall.dangerLevel = ev.level;
        break;
      case 'pressure':
        this.wall.startPush(this.beat.visualElapsedSec);
        this.wall.markDirty();
        break;
      case 'detonate':
        this.wall.markDirty();
        if (ev.step !== this.lastHapticStep) {
          this.lastHapticStep = ev.step;
          haptics.pulse(ev.overcharged ? 'overcharge' : 'detonate');
        }
        break;
      case 'allclear':
        haptics.pulse('allclear');
        announce(`All Clear. Plus ${ev.points}.`);
        break;
      case 'gameover':
        this.endRun();
        break;
      default:
        this.wall.markDirty();
        break;
    }
    this.hooks.onEvent?.(ev);
  }

  private endRun(): void {
    const run = this.run;
    const engine = this.engine;
    if (!run || !engine || run.ended) return;
    run.ended = true;
    this.input.cancelAll();
    const now = this.audio.now;
    this.stems.stopAll(now + this.clock.barDurationSec);
    this.scheduler.queue('over', now + 0.02, 0.9);
    const score = Math.round(engine.telemetry.score * run.bpmScale);
    const key = run.mode === 'odyssey' ? MOVEMENTS[run.startMovement]!.id : run.mode;
    let previousBest = 0;
    if (run.mode === 'daily') {
      const today = todayUtc();
      previousBest = this.save.daily.date === today ? this.save.daily.best : 0;
      if (score > previousBest) this.save.daily = { date: today, best: score };
    } else if (run.mode !== 'overture') {
      previousBest = this.save.best[key] ?? 0;
      if (score > previousBest) this.save.best[key] = score;
    }
    this.persistSave();
    setTimeout(() => {
      this.hud.show(false);
      this.hooks.onRunEnd?.({ run, engine, score, previousBest, key });
    }, 1400);
  }

  /** Odyssey: quota reached -> morph to the next movement on a downbeat. */
  private checkQuota(): void {
    const run = this.run;
    const e = this.engine;
    if (!run || !e || run.ended || run.morph) return;
    if (run.mode !== 'odyssey' && run.mode !== 'endless' && run.mode !== 'daily') return;
    const earned = e.telemetry.score - run.movementStartScore;
    if (earned < run.track.quota) return;
    if (run.mode === 'odyssey') {
      const id = run.track.id;
      if (!this.save.cleared.includes(id)) {
        this.save.cleared.push(id);
        this.persistSave();
      }
      run.movementsCleared++;
      // The last movement plays on until the wall wins
      if (run.movement >= MOVEMENTS.length - 1) {
        run.movementStartScore = Number.POSITIVE_INFINITY;
        return;
      }
    }
    // Next downbeat at least half a bar away so the stems can be scheduled sample-accurately
    const bar = Math.max(1, e.currentBar);
    const sixteenth = Math.max(0, e.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    const step = (bar + (sixteenth >= 8 ? 1 : 0)) * TUNING.SIXTEENTHS_PER_BAR;
    const next = (run.movement + 1) % MOVEMENTS.length;
    const atSec = this.clock.stepToAudioSec(step);
    run.morph = { step, index: next, atSec };
    const track = MOVEMENTS[next]!;
    const newBar = (60 / (track.bpm * run.bpmScale)) * 4;
    void this.stems.morph(track, atSec, newBar);
  }

  private applyMorph(): void {
    const run = this.run;
    const e = this.engine;
    if (!run?.morph || !e) return;
    if (this.beat.absoluteStep < run.morph.step) return;
    const { step, index } = run.morph;
    const track = MOVEMENTS[index]!;
    const bpm = track.bpm * run.bpmScale;
    this.clock.setBpmAtStep(bpm, step);
    const cfg = e.config as { bpm: number; colorCount: number; riseBars: number };
    cfg.bpm = bpm;
    cfg.colorCount = track.colors;
    cfg.riseBars = track.riseBars;
    run.morph = null;
    run.movement = index;
    run.track = track;
    run.movementStartScore = e.telemetry.score;
    this.sfx.setTrack(track);
    this.scheduler.resetHorizon();
    this.wall.setPoolTint(MOVEMENT_TINT[track.id] ?? 0x1a2340, performance.now() / 1000, this.clock.barDurationSec);
    announce(`Movement ${track.number}, ${track.name}.`);
  }

  /** Overture -> Movement 01 on a downbeat, keeping the board. */
  morphOvertureToMovement(): void {
    const run = this.run;
    const e = this.engine;
    if (!run || !e) return;
    run.mode = 'odyssey';
    run.cfg = { mode: 'odyssey', movement: 0 };
    run.startMovement = 0;
    run.movement = -1;
    (e.config as { mode: GameMode }).mode = 'odyssey';
    e.setPressureEnabled(true);
    this.director.layerOverride = null;
    const bar = Math.max(1, e.currentBar);
    const sixteenth = Math.max(0, e.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    const step = (bar + (sixteenth >= 8 ? 1 : 0)) * TUNING.SIXTEENTHS_PER_BAR;
    const atSec = this.clock.stepToAudioSec(step);
    run.morph = { step, index: 0, atSec };
    const track = MOVEMENTS[0]!;
    void this.stems.morph(track, atSec, (60 / track.bpm) * 4);
  }

  // ---------------------------------------------------------------- pause / visibility

  setPaused(on: boolean): void {
    if (!this.run || this.run.ended) {
      this.pause.show(false);
      this.paused = false;
      return;
    }
    if (on === this.paused) {
      this.pause.show(on);
      return;
    }
    this.paused = on;
    this.pause.show(on);
    if (on) {
      this.input.cancelAll();
      this.clock.pause(this.audio.now);
      void this.audio.suspend();
    } else if (!this.blocked) {
      void this.audio.resume().then(() => {
        this.clock.resume(this.audio.now);
        this.scheduler.resetHorizon();
      });
    }
  }

  private onHidden(): void {
    this.clock.pause(this.audio.now);
    void this.audio.suspend();
  }

  private onVisible(): void {
    if (this.run && !this.run.ended) {
      // Back mid-run: land on the pause sheet so nothing happens before the player is ready
      this.paused = true;
      this.pause.show(true);
      return;
    }
    if (!this.blocked) void this.audio.resume().then(() => this.clock.resume(this.audio.now));
  }

  private setBlocked(on: boolean): void {
    if (on === this.blocked) return;
    this.blocked = on;
    this.rotate.show(on);
    if (on) {
      if (this.run && !this.run.ended) {
        this.paused = true;
        this.pause.show(true);
      }
      this.clock.pause(this.audio.now);
      void this.audio.suspend();
    } else if (!this.paused) {
      void this.audio.resume().then(() => this.clock.resume(this.audio.now));
    }
  }

  // ---------------------------------------------------------------- frame

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const wallSec = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, wallSec - this.lastFrameSec));
    this.lastFrameSec = wallSec;
    const beat = this.clock.query(this.audio.now, this.beat);
    const e = this.engine;
    const run = this.run;

    if (e && run && !this.paused && !this.blocked && this.clock.isRunning) {
      this.applyMorph();
      if (beat.elapsedSec >= this.clock.outputLatencySec && !run.ended) {
        e.advanceToStep(beat.visualStep);
        this.drain();
        this.checkQuota();
      }
      this.input.update(performance.now());
      this.director.update();
      // Haptic metronome: one tick per beat
      if (this.settings.hapticMetronome) {
        const b = Math.floor(beat.visualStep / 4);
        if (b !== this.lastTickBeat) {
          this.lastTickBeat = b;
          haptics.pulse('tick');
        }
      }
    }

    this.hooks.onFrame?.();
    this.backdrop.update(wallSec);

    if (e && !this.fx.frozen) {
      this.wall.update(e, beat, dt);
      this.blade.update(beat);
      this.fx.update(wallSec, dt, this.wall, this.clock.barDurationSec, beat.beatProgress);
      this.stage.setZoom(this.fx.zoom);
    }
    if (e && run && !run.ended) {
      this.hud.update({
        score: Math.round(e.telemetry.score * run.bpmScale),
        chainRank: e.chainRank,
        combo: computeComboMultiplier(e.comboPasses),
        layers: this.stems.activeLayers,
        movement: run.mode === 'overture' ? 'OVERTURE' : run.mode === 'odyssey' ? `${run.track.number} · ${run.track.name.toUpperCase()}` : `${run.mode.toUpperCase()} · ${run.track.name.toUpperCase()}`,
        bpm: this.clock.bpm,
        bar: e.currentBar,
        risesIn: e.barsUntilNextPush
      });
    }
    if (!this.fx.frozen) this.stage.render();
  };

  /** Shows or hides the in-run Pixi layers (title/results draw their own). */
  setWallVisible(on: boolean): void {
    this.stage.wall.visible = on;
    this.stage.glow.visible = on;
    this.stage.outlines.visible = on;
    this.stage.fx.visible = on;
    this.stage.blade.visible = on;
    this.stage.background.visible = on;
  }

  get cellPoint(): { x: number; y: number } {
    return this.cellPt;
  }
}
