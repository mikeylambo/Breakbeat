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
import { WorldView } from '../render/WorldView.js';
import { applyUiTransform } from '../render/layout.js';
import { worldFor } from '../render/worlds.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { StemPlayer } from '../audio/StemPlayer.js';
import { SfxPlayer } from '../audio/SfxPlayer.js';
import { Scheduler } from '../audio/Scheduler.js';
import { MusicDirector } from '../audio/MusicDirector.js';
import { MOVEMENTS, OVERTURE, ZEN_INDEX, trackTint, type TrackDef } from '../audio/tracks.js';
import { installBrowserLifecycle } from '../platform/Lifecycle.js';
import { loadSave, todayUtc, writeSave, type SaveData } from '../meta/Save.js';
import { awardChallenges, recordStats } from '../meta/Progress.js';
import type { EtudeDef } from '../meta/Etude.js';
import { loadSettings, saveSettings, type Settings } from '../meta/Settings.js';
import { InputController } from './input.js';
import { haptics } from './haptics.js';
import { RunHud } from './RunHud.js';
import { PauseSheet } from './PauseSheet.js';
import { RotateCard } from './RotateCard.js';
import { announce } from './dom.js';
import { SettingsSheet } from './SettingsSheet.js';
import { CalibrationSheet } from './CalibrationSheet.js';


export interface RunConfig {
  mode: GameMode;
  /** Movement index into MOVEMENTS (ignored for the Overture) */
  movement: number;
  seed?: string;
  /** Etude puzzle (fixed board, no pressure) */
  etude?: EtudeDef;
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
  movementStartBar?: number;
  seed: string;
  ended: boolean;
  morph: { step: number; index: number; atSec: number } | null;
  inputLog: InputLogEntry[];
  bpmScale: number;
  movementsCleared: number;
  startedMs: number;
}

export interface RunResult {
  /** Challenge stars earned by this run */
  newStars: string[];
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
  world!: WorldView;
  private readonly card = document.createElement('div');
  private cardTimer: ReturnType<typeof setTimeout> | null = null;
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
  readonly settingsSheet: SettingsSheet;
  readonly calibration: CalibrationSheet;
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
  /** Adaptive quality: recent frame deltas (ms) while playing */
  private readonly frameMs = new Float32Array(120);
  private frameIdx = 0;
  private readonly cellPt = { x: 0, y: 0 };
  /** Opens the settings sheet. */
  openSettings: () => void;
  /** Returns to the title (set by TitleScreen). */
  showTitle: () => void = () => {};
  /** Starts the Overture again (Settings). */
  replayOverture: () => void = () => {};
  /** Closes any open sheet (settings/pause). */
  closeSheets: () => void = () => {
    this.pause.show(false);
    this.paused = false;
    if (this.settingsSheet.open) this.settingsSheet.show(false);
  };

  constructor() {
    this.settingsSheet = new SettingsSheet({
      settings: this.settings,
      hapticsSupported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
      apply: () => this.persistSettings(),
      replayOverture: () => this.replayOverture(),
      calibrate: () => this.calibration.show(true),
      onClose: () => undefined
    });
    this.openSettings = () => this.settingsSheet.show(true);
    this.calibration = new CalibrationSheet(this);
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
    // Boot in slices with a frame between each, so no single main-thread task blocks the title
    const yieldFrame = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()));
    await this.stage.init(document.getElementById('game')!);
    await yieldFrame();
    this.atlas = new TileAtlas(this.stage.resolution, this.settings.colourAssist);
    await yieldFrame();
    this.wall = new WallView(this.stage, this.atlas);
    this.blade = new BladeView(this.stage, this.atlas);
    await yieldFrame();
    this.fx = new FxView(this.stage, this.atlas);
    this.backdrop = new TitleBackdrop(this.stage, this.atlas);
    this.world = new WorldView(this.atlas);
    this.stage.background.addChildAt(this.world.root, 0);
    this.card.className = 'movement-card';
    this.card.setAttribute('aria-hidden', 'true');
    this.applySettings();

    this.hud.show(false);
    this.ui.append(this.card, this.hud.root, this.pause.root, this.settingsSheet.root, this.calibration.root);
    this.stage.onLayout(l => {
      applyUiTransform(this.ui, l);
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
        return !!g && !g.held && !!this.engine?.canHold;
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
      } else if (e.key === 'Escape' && this.run && !this.run.ended && !this.settingsSheet.open) {
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
    if (this.world) {
      this.world.reducedMotion = s.reducedMotion;
      this.world.intensity = 0.4 + 0.6 * s.flash;
    }
    this.wall.flashScale = s.flash;
    this.fx.settings.reducedMotion = s.reducedMotion;
    this.fx.settings.flash = s.flash;
    this.fx.settings.strobeFree = s.strobeFree;
    this.stage.setBloomStrength(0.4 + 0.6 * s.flash);
    // Flash intensity also scales the soft glow sprites when bloom is off
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
    // Restart / replay from the pause sheet arrives with the context suspended by the app
    await this.audio.resume();
    await this.audio.unlock();
    const overture = cfg.mode === 'overture';
    const index = overture ? 0 : Math.max(0, Math.min(MOVEMENTS.length - 1, cfg.movement));
    const dayIndex = Math.floor(Date.parse(todayUtc()) / 86400000) % MOVEMENTS.length;
    const trackIndex = cfg.mode === 'etude' ? cfg.movement % 6 : cfg.mode === 'zen' ? ZEN_INDEX : cfg.mode === 'daily' ? dayIndex : index;
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
        pressureEnabled: !overture && !cfg.etude,
        fixedDeal: cfg.etude?.board
      },
      new GemRules('brick')
    );
    this.engine = engine;
    if (cfg.etude) engine.charge = cfg.etude.charge ?? 0;
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
      movementsCleared: 0,
      startedMs: performance.now()
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
    this.wall.setPoolTint(trackTint(track), performance.now() / 1000, 0);
    this.applyWorld(track, !overture && !cfg.etude);
    this.wall.dealIn(performance.now() / 1000);
    this.blade.fadeIn();
    this.lastRank = 0;
    this.fx.markGroupsDirty();
    this.lastHapticStep = -1;
    this.hud.show(true);
    this.save.runs++;
    this.persistSave();
    if (cfg.etude) announce(`Etude: ${cfg.etude.name}.`);
    else if (!overture) announce(`Movement ${track.number}, ${track.name}. ${Math.round(bpm)} BPM.`);
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
    this.wall.collapse(performance.now() / 1000);
    this.blade.fadeOut();
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
    let newStars: string[] = [];
    if (run.mode !== 'overture') {
      recordStats(this.save, engine.telemetry, (performance.now() - run.startedMs) / 1000, run.movementsCleared);
      if (run.mode === 'odyssey') {
        const track = MOVEMENTS[run.startMovement]!;
        newStars = awardChallenges(this.save, track, run.startMovement, { t: engine.telemetry, score, cleared: run.movementsCleared > 0 });
      }
    }
    this.persistSave();
    setTimeout(() => {
      this.hud.show(false);
      this.hooks.onRunEnd?.({ run, engine, score, previousBest, key, newStars });
    }, 1700);
  }

  /** Movement world (motif, blade, shards) and its title card, held for one bar. */
  applyWorld(track: TrackDef, card: boolean): void {
    const w = worldFor(track.style);
    const c = this.cosmetics?.(w) ?? w;
    this.world.setWorld(c);
    this.blade.setStyle(c.blade, c.accent);
    this.fx.setShardMaterial(c.shard);
    if (!card) return;
    this.card.innerHTML = `<div class="mc-num">${track.number} · ${track.style.toUpperCase()}</div><div class="mc-name">${track.name}</div>`;
    this.card.style.setProperty('--accent', `#${c.accent.toString(16).padStart(6, '0')}`);
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.cardTimer = setTimeout(() => this.card.classList.remove('show'), Math.max(1400, this.clock.barDurationSec * 1000 + 400));
  }

  /** Cosmetic overrides (equipped unlockables); set by the Customise screen. */
  cosmetics: ((w: ReturnType<typeof worldFor>) => ReturnType<typeof worldFor>) | null = w => {
    const e = this.save.equipped;
    return {
      ...w,
      blade: e.blade === 'auto' ? w.blade : (e.blade as typeof w.blade),
      shard: e.shard === 'auto' ? w.shard : (e.shard as typeof w.shard)
    };
  };

  /** Music builds A -> B -> C through each movement: by quota progress, or every 16 bars in Zen. */
  private advanceSection(): void {
    const run = this.run;
    const e = this.engine;
    if (!run || !e || run.morph || run.mode === 'overture') return;
    const t = run.track;
    const n = t.sections.length;
    if (n < 2) return;
    let p: number;
    if (run.mode === 'zen' || !Number.isFinite(run.movementStartScore) || t.quota <= 0) {
      p = (e.currentBar - (run.movementStartBar ?? 0)) / (16 * n);
    } else {
      p = (e.telemetry.score - run.movementStartScore) / t.quota;
    }
    this.stems.setSection(Math.min(n - 1, Math.floor(Math.max(0, p) * n)));
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
    run.movementStartBar = e.currentBar;
    this.sfx.setTrack(track);
    this.scheduler.resetHorizon();
    this.wall.setPoolTint(trackTint(track), performance.now() / 1000, this.clock.barDurationSec);
    this.applyWorld(track, true);
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
    if (this.countingIn) return;
    if (on === this.paused) {
      this.pause.show(on);
      return;
    }
    if (on) {
      this.paused = true;
      this.pause.show(true);
      this.input.cancelAll();
      this.clock.pause(this.audio.now);
      void this.audio.suspend();
    } else if (!this.blocked) {
      this.pause.show(false);
      this.countIn();
    }
  }

  private lastRank = 0;
  private countingIn = false;
  private readonly countEl = document.createElement('div');

  /** One bar of beat pips before play resumes, so nobody loses a life to an instant restart. */
  private countIn(): void {
    this.countingIn = true;
    const beatMs = Math.min(650, Math.max(380, (60 / this.clock.bpm) * 1000));
    const el = this.countEl;
    el.className = 'count-in';
    el.setAttribute('aria-live', 'assertive');
    if (!el.parentElement) this.ui.appendChild(el);
    el.innerHTML = '<span></span><span></span><span></span><span></span>';
    el.classList.remove('hidden');
    const pips = el.querySelectorAll('span');
    let i = 0;
    const tick = (): void => {
      if (i < 4) {
        pips[i]!.classList.add('on');
        if (i === 0) announce('Resuming in four beats');
        i++;
        setTimeout(tick, beatMs);
        return;
      }
      el.classList.add('hidden');
      this.countingIn = false;
      this.paused = false;
      void this.audio.resume().then(() => {
        this.clock.resume(this.audio.now);
        this.scheduler.resetHorizon();
      });
    };
    tick();
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
    if (run && !run.ended && !this.paused) this.watchFrameBudget(dt * 1000);

    if (e && run && !this.paused && !this.blocked && this.clock.isRunning) {
      this.applyMorph();
      if (beat.elapsedSec >= this.clock.outputLatencySec && !run.ended) {
        e.advanceToStep(beat.visualStep);
        this.drain();
        this.checkQuota();
      }
      this.input.update(performance.now());
      this.advanceSection();
      if (e.chainRank > this.lastRank) {
        this.hud.flareChain();
        this.wall.rankPulse(this.blade.accent);
        haptics.pulse('rank');
      }
      this.lastRank = e.chainRank;
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

    if (e) {
      // Hitstop: debris and pops hold for a beat of a frame, the blade keeps sweeping
      if (!this.fx.frozen) {
        this.wall.update(e, beat, dt);
        this.fx.update(wallSec, dt, this.wall, this.clock.barDurationSec, beat.beatProgress);
      } else {
        this.fx.tickClock(wallSec);
      }
      this.blade.update(beat);
      this.world.update(wallSec, dt, beat.beatProgress);
      this.stage.setZoom(this.fx.zoom);
    }
    if (e && run && !run.ended) {
      this.hud.update({
        score: Math.round(e.telemetry.score * run.bpmScale),
        chainRank: e.chainRank,
        combo: computeComboMultiplier(e.comboPasses),
        layers: this.stems.activeLayers,
        movement: run.mode === 'etude' ? `ETUDE · ${run.cfg.etude?.name.toUpperCase() ?? ''}` : run.mode === 'overture' ? 'OVERTURE' : run.mode === 'odyssey' ? `${run.track.number} · ${run.track.name.toUpperCase()}` : `${run.mode.toUpperCase()} · ${run.track.name.toUpperCase()}`,
        bpm: this.clock.bpm,
        bar: e.currentBar,
        risesIn: e.barsUntilNextPush,
        charge: e.charge
      });
    }
    this.stage.render();
  };

  /**
   * Device-adaptive quality: if more than 10% of the last 120 frames in play missed 20 ms, drop the
   * bloom pass (the glow sprites stay). Weak GPUs keep a locked frame rate instead of the extra pass.
   */
  private watchFrameBudget(ms: number): void {
    if (!this.stage.bloomEnabled) return;
    this.frameMs[this.frameIdx] = ms;
    this.frameIdx = (this.frameIdx + 1) % this.frameMs.length;
    if (this.frameIdx !== 0) return;
    let slow = 0;
    for (let i = 0; i < this.frameMs.length; i++) if (this.frameMs[i]! > 20) slow++;
    if (slow > this.frameMs.length * 0.1) {
      this.stage.setBloomEnabled(false);
      console.info('[breakbeat] frame budget missed; bloom pass disabled for this device');
    }
  }

  /** Shows or hides the in-run Pixi layers (title/results draw their own). */
  setWallVisible(on: boolean): void {
    this.stage.wall.visible = on;
    this.stage.glow.visible = on;
    this.stage.outlines.visible = on;
    this.stage.fx.visible = on;
    this.stage.blade.visible = on;
    this.stage.background.visible = on;
    document.getElementById('game')?.classList.toggle('title-mode', !on);
  }

  get cellPoint(): { x: number; y: number } {
    return this.cellPt;
  }
}
