/**
 * App — owns the stage, audio, clock and the current run, and routes between screens.
 * One frame loop: query the audio clock once, hand the result to engine, renderer and HUD.
 */

import { getLang, t as tr, tx } from '../i18n/i18n.js';
import { etudeHint, etudeName } from '../meta/Etude.js';
import { TUNING, computeComboMultiplier, type GameMode } from '../tuning.js';
import { BeatClock, createBeatQuery } from '../pulse/BeatClock.js';
import { applyUntil, engineFor, replayOf, simulate, type Replay, type SimResult } from '../pulse/Replay.js';
import { Ghosts, type GhostRecord } from '../meta/Ghosts.js';
import { CursorInput } from './pad.js';
import { addFrame, newFrameStats, record as recordPlaytest, type FrameStats } from '../meta/Playtest.js';
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
import { VisualizerView } from '../render/VisualizerView.js';
import { applyUiTransform } from '../render/layout.js';
import { worldFor } from '../render/worlds.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { AudioFeatures } from '../audio/AudioFeatures.js';
import { StemPlayer } from '../audio/StemPlayer.js';
import { SfxPlayer } from '../audio/SfxPlayer.js';
import { Scheduler } from '../audio/Scheduler.js';
import { MusicDirector } from '../audio/MusicDirector.js';
import { MOVEMENTS, OVERTURE, ZEN_INDEX, trackTint, type TrackDef } from '../audio/tracks.js';
import { installBrowserLifecycle } from '../platform/Lifecycle.js';
import { loadSave, mastery, todayUtc, writeSave, type SaveData } from '../meta/Save.js';
import { evaluate as evaluateAchievements, noteDaily, type AchContext, type AchDef } from '../meta/Achievements.js';
import type { PracticeSetup } from '../meta/Practice.js';
import { MIXTAPE_BARS, tapeKey } from '../meta/Mixtape.js';
import { bsideKey, remixRules } from '../meta/Remix.js';
import { awardChallenges, recordStats } from '../meta/Progress.js';
import type { EtudeDef } from '../meta/Etude.js';
import { loadSettings, saveSettings, type Settings } from '../meta/Settings.js';
import { InputController } from './input.js';
import { haptics } from './haptics.js';
import { RunHud } from './RunHud.js';
import { PauseSheet } from './PauseSheet.js';
import { RotateCard } from './RotateCard.js';
import { announce, el, fmt, setUiSound, type UiSoundKind } from './dom.js';
import { SettingsSheet } from './SettingsSheet.js';
import { CalibrationSheet } from './CalibrationSheet.js';
import { DeskPanels } from './DeskPanels.js';


export interface RunConfig {
  mode: GameMode;
  /** Movement index into MOVEMENTS (ignored for the Overture) */
  movement: number;
  seed?: string;
  /** Etude puzzle (fixed board, no pressure) */
  etude?: EtudeDef;
  /** A player's own song (Upload Your Own Beat): played on its own, best kept per song */
  track?: TrackDef;
  /** Practice: one movement, one looping section, a chosen tempo and wall. Keeps no bests. */
  practice?: PracticeSetup;
  /** Mixtape: movement indices in play order */
  mixtape?: number[];
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
  /** Started as a real run (not the Overture or an Etude), so its replay can be kept and verified */
  replayable: boolean;
  bpmScale: number;
  movementsCleared: number;
  /** Mixtape: index into cfg.mixtape of the track playing */
  tapePos: number;
  startedMs: number;
}

export interface RunResult {
  /** The whole run as data (null for the Overture and Etudes) */
  replay: Replay | null;
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
  vis!: VisualizerView;
  desk!: DeskPanels;
  private deskTick = 0;
  private hoverCell = -1;
  private hoverStep = -2;
  private readonly card = document.createElement('div');
  private cardTimer: ReturnType<typeof setTimeout> | null = null;
  readonly audio = new AudioEngine();
  readonly stems = new StemPlayer(this.audio);
  /** One shared frame of stem and spectrum features, updated once per frame before any view. */
  readonly features = new AudioFeatures(this.audio);
  readonly sfx = new SfxPlayer(this.audio);
  /** Best-run replays per key, raced as pace ghosts */
  readonly ghosts = new Ghosts();
  /** The ghost racing this run: its engine re-simulates the best run in lockstep */
  ghost: { rec: GhostRecord; engine: PulseEngine; next: number; ended: boolean; passed: boolean } | null = null;
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
  /** Reticle play for keyboard and controllers, and controller menu navigation */
  cursor!: CursorInput;
  /** Frame timing of the current run, for the playtest log */
  private runFrames: FrameStats = newFrameStats();
  /** Adaptive quality: recent frame deltas (ms) while playing */
  private readonly frameMs = new Float32Array(120);
  private frameIdx = 0;
  private readonly cellPt = { x: 0, y: 0 };
  /** Opens the settings sheet. */
  openSettings: () => void;
  /** Returns to the title (set by TitleScreen). */
  showTitle: () => void = () => {};
  /** Label for the pause sheet's quit row (set by main). */
  quitLabel: () => string = () => tr('pause.quit');
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
      },
      info: () => {
        const run = this.run;
        const e = this.engine;
        if (!run || !e) return { title: '', score: '', quit: this.quitLabel() };
        const t = run.track;
        const title =
          run.mode === 'etude' || run.mode === 'overture'
            ? this.modeLabel(run)
            : `${run.mode === 'odyssey' ? `${tr('sl.act', { n: t.act }).toUpperCase()} · ` : `${this.modeLabel(run)} · `}${t.number} ${t.name.toUpperCase()} · ${tr('hud.barN', { n: Math.max(1, e.currentBar) })}`;
        return { title, score: run.mode === 'overture' || run.mode === 'etude' ? '' : Math.round(e.telemetry.score * run.bpmScale).toLocaleString(getLang()), quit: this.quitLabel() };
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
    this.atlas = new TileAtlas(this.stage.resolution, this.settings.symbols, this.settings.colourAssist);
    await yieldFrame();
    this.wall = new WallView(this.stage, this.atlas);
    this.blade = new BladeView(this.stage, this.atlas);
    await yieldFrame();
    this.fx = new FxView(this.stage, this.atlas);
    this.backdrop = new TitleBackdrop(this.stage, this.atlas);
    this.world = new WorldView(this.atlas, this.features);
    // Under the wall layers but outside them: the title shows the world without the wall
    this.stage.camera.addChildAt(this.world.root, 0);
    this.vis = new VisualizerView(this.atlas, this.features);
    this.stage.camera.addChildAt(this.vis.root, 1);
    this.card.className = 'movement-card';
    this.card.setAttribute('aria-hidden', 'true');
    this.applySettings();

    this.hud.show(false);
    this.ui.append(this.card, this.hud.root, this.pause.root, this.settingsSheet.root, this.calibration.root);
    this.desk = new DeskPanels(document.body);
    this.stage.onLayout(l => {
      applyUiTransform(this.ui, l);
      this.desk.layout(l);
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
      hover: cell => this.hoverAt(cell),
      hold: cell => this.hold(cell)
    });
    this.cursor = new CursorInput({
      playing: () => !!this.run && !this.run.ended && !this.paused && !this.blocked,
      prime: cell => this.prime(cell),
      hold: cell => this.hold(cell),
      groupAt: cell => this.groupAt(cell),
      canHold: id => {
        const g = this.engine?.groups.get(id);
        return !!g && !g.held && !!this.engine?.canHold;
      },
      hover: cell => this.hoverAt(cell),
      cellCentre: (cell, out) => WallView.cellCentre(cell % TUNING.BOARD_COLS, (cell / TUNING.BOARD_COLS) | 0, out),
      holdRing: (x, y, p) => this.fx.setHoldRing(x, y, p),
      ui: this.ui
    });
    this.cursor.attachRumble(haptics);

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
      // V hides the HUD in a run (menus use V for themselves, e.g. Listen's visualizer)
      if ((e.key === 'v' || e.key === 'V') && this.run) {
        this.settings.hudHidden = !this.settings.hudHidden;
        saveSettings(this.settings);
        this.hud.setHidden(this.settings.hudHidden);
      } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      } else if (e.key === 'Escape' && this.run && !this.run.ended && !this.settingsSheet.open) {
        this.setPaused(!this.paused);
      }
    });

    setUiSound((kind, i) => this.uiSound(kind, i));
    // The first gesture anywhere wakes the title music
    const wake = (): void => {
      void this.audio.unlock().then(() => {
        if (this.audio.running && !this.attractOn) void this.playAttract();
      });
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);

    // Render placeholder audio in the background; no user gesture needed for offline rendering.
    void this.sfx.load();
    void this.stems.load(this.save.overtureDone ? MOVEMENTS[0]! : OVERTURE).then(() => this.stems.load(MOVEMENTS[0]!));

    this.scheduler.start();
    // Catch up achievements an existing save already meets, quietly
    this.achieve(undefined, undefined, true);
    requestAnimationFrame(this.frame);
  }

  applySettings(): void {
    const s = this.settings;
    this.audio.setVolumes(s.volume, s.music, s.sfx);
    this.atlas.setLook(s.symbols, s.colourAssist);
    document.documentElement.dataset.symbols = s.symbols ? 'on' : 'off';
    this.wall.setAtlas(this.atlas);
    this.fx.setAtlas(this.atlas);
    this.backdrop?.setAtlas(this.atlas);
    this.wall.reducedMotion = s.reducedMotion;
    if (this.world) {
      this.world.reducedMotion = s.reducedMotion;
      this.world.intensity = 0.4 + 0.6 * s.flash;
    }
    if (this.vis) {
      this.vis.reducedMotion = s.reducedMotion;
      this.vis.strobeFree = s.strobeFree;
      this.vis.flash = s.flash;
      if (s.visualizer !== 'off') this.vis.setPreset(s.visualizer);
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
    // Streamer mode: a flat chroma-key green behind the wall (world, visualizer and light pool off)
    document.documentElement.classList.toggle('streamer', s.streamer);
    if (this.world) this.world.root.renderable = !s.streamer;
    if (this.vis) this.vis.root.renderable = !s.streamer;
    this.stage.background.renderable = !s.streamer;
    this.streamScore.hidden = true;
  }

  /** Streamer mode's big score overlay: score, chain and what is playing, sized for a stream. */
  private readonly streamScore = el('div', 'stream-score', '', { 'aria-hidden': 'true' });
  private lastStream = '';
  private updateStreamScore(score: number, combo: number, run: RunState): void {
    const on = this.settings.streamer && !run.ended && run.mode !== 'overture';
    this.streamScore.hidden = !on;
    if (!on) return;
    if (!this.streamScore.isConnected) this.ui.appendChild(this.streamScore);
    const html = `<b>${fmt(score)}</b><span>×${combo.toFixed(1)} · ${run.track.name.toUpperCase()}</span>`;
    if (html !== this.lastStream) {
      this.lastStream = html;
      this.streamScore.innerHTML = html;
    }
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
    this.stopAttract();
    const overture = cfg.mode === 'overture';
    const index = overture ? 0 : Math.max(0, Math.min(MOVEMENTS.length - 1, cfg.movement));
    const trackIndex = cfg.mode === 'mixtape' && cfg.mixtape?.length ? cfg.mixtape[0]! : App.trackIndex(cfg.mode, cfg.movement);
    const track = cfg.track ?? (overture ? OVERTURE : MOVEMENTS[trackIndex]!);
    const practice = cfg.mode === 'practice' ? cfg.practice : undefined;
    const remix = cfg.mode === 'remix' ? remixRules(track, trackIndex) : undefined;
    const bpmScale = cfg.mode === 'daily' || overture ? 1 : practice ? Math.max(0.7, Math.min(1, practice.tempo)) : this.settings.bpmScale;
    const bpm = track.bpm * bpmScale;
    const seed = cfg.seed ?? (cfg.mode === 'daily' ? `daily-${todayUtc()}` : `${cfg.mode}-${Date.now().toString(36)}`);
    const ghostKey = App.ghostKey(cfg, index);
    const [, , ghostRec] = await Promise.all([this.stems.load(track), this.sfx.load(), ghostKey && this.settings.ghost ? this.ghosts.get(ghostKey) : null]);
    this.ghost = ghostRec && ghostRec.replay.seed !== '' ? { rec: ghostRec, engine: engineFor(ghostRec.replay, new GemRules('brick')), next: 0, ended: false, passed: false } : null;

    const engine = new PulseEngine(
      {
        seed,
        mode: cfg.mode,
        bpm,
        colorCount: remix?.colors ?? track.colors,
        riseBars: cfg.etude?.pressure ?? remix?.riseBars ?? (practice?.wall === 'fast' ? 1 : practice?.wall === 'pressure' ? 2 : track.riseBars),
        pressureFrom: remix?.flip ? 'top' : 'bottom',
        pressureEnabled: !overture && (!cfg.etude || !!cfg.etude.pressure) && practice?.wall !== 'still',
        fixedDeal: cfg.etude?.board,
        initialRows: practice?.wall === 'pressure' ? TUNING.BOARD_ROWS - TUNING.DANGER_ROWS - 1 : undefined,
        steadyRise: !!practice
      },
      new GemRules('brick')
    );
    this.engine = engine;
    this.runFrames = newFrameStats();
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
      replayable: !overture && !cfg.etude && !practice,
      bpmScale,
      movementsCleared: 0,
      tapePos: 0,
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
    await this.stems.start(track, t0, overture ? 1 : 2, practice ? Math.max(0, Math.min(track.sections.length - 1, practice.section)) : 0);
    this.audio.setDanger(0, this.audio.now + 0.05, 0.05);
    this.wall.markDirty();
    this.wall.dangerLevel = 0;
    this.wall.setFlipped(engine.config.pressureFrom === 'top');
    this.wall.setPoolTint(trackTint(track), performance.now() / 1000, 0);
    this.applyWorld(track, !overture && !cfg.etude);
    this.wall.dealIn(performance.now() / 1000);
    this.blade.fadeIn();
    this.lastRank = 0;
    this.fx.markGroupsDirty();
    this.lastHapticStep = -1;
    this.hud.show(true);
    this.desk.setRun(true);
    this.save.runs++;
    this.persistSave();
    if (cfg.etude) announce(`${cfg.etude.topic ? tr('tut.try') : tr('say.etude')}: ${etudeName(cfg.etude)}. ${etudeHint(cfg.etude)}`);
    else if (cfg.track) announce(tr('say.beat', { name: track.name, bpm: Math.round(bpm) }));
    else if (!overture) announce(tr('say.movementBpm', { num: track.number, name: track.name, bpm: Math.round(bpm) }));
  }

  /** "ENDLESS", "B-SIDE", "TRY IT · PRIME"…: the run's mode in the current language, upper case. */
  private modeLabel(run: RunState): string {
    if (run.mode === 'etude') return `${run.cfg.etude?.topic ? tr('tut.tryTag') : tr('say.etude').toUpperCase()} · ${run.cfg.etude ? etudeName(run.cfg.etude).toUpperCase() : ''}`;
    if (run.mode === 'overture') return tr('ls.overture').toUpperCase();
    if (run.mode === 'mixtape') return `${tr('title.mixtape').toUpperCase()} ${run.tapePos + 1}/${run.cfg.mixtape?.length ?? 1}`;
    return tx(`title.${run.mode}`, run.mode).toUpperCase();
  }

  /** The key a run's best (and its ghost) is kept under; null for runs that keep none. */
  static ghostKey(cfg: RunConfig, movement: number): string | null {
    if (cfg.etude || cfg.mode === 'overture' || cfg.mode === 'practice') return null;
    if (cfg.track) return cfg.track.id;
    if (cfg.mode === 'daily') return `daily-${todayUtc()}`;
    if (cfg.mode === 'odyssey') return MOVEMENTS[movement]!.id;
    if (cfg.mode === 'remix') return bsideKey(MOVEMENTS[movement]!.id);
    if (cfg.mode === 'mixtape') return tapeKey(cfg.mixtape ?? [], MOVEMENTS);
    return cfg.mode;
  }

  /** Steps the ghost to the live engine's step and reports pace, top-out and passing it. */
  private stepGhost(liveStep: number, liveScore: number): number | null {
    const g = this.ghost;
    if (!g) return null;
    const end = g.rec.replay.end.s;
    if (!g.ended) {
      g.next = applyUntil(g.engine, g.rec.replay, g.next, Math.min(liveStep, end));
      if (liveStep >= end || g.engine.gameOver) {
        g.ended = true;
        this.hud.calloutText(tr('hud.ghostOut'), tr('hud.barN', { n: Math.max(1, g.engine.currentBar) }));
        announce(tr('say.ghostOut', { n: g.engine.currentBar }));
      }
    }
    const ghostScore = Math.round(g.engine.telemetry.score * g.rec.scale);
    if (!g.passed && liveScore > g.rec.score) {
      g.passed = true;
      this.achieve('ghost-passed');
      this.hud.calloutText(tr('hud.pastBest'), `+${fmt(liveScore - g.rec.score)}`);
      announce(tr('say.pastBest'));
    }
    return liveScore - ghostScore;
  }

  /** Which movement's music a run of `mode` plays. */
  static trackIndex(mode: GameMode, movement: number): number {
    const index = Math.max(0, Math.min(MOVEMENTS.length - 1, movement));
    if (mode === 'etude') return movement % 6;
    if (mode === 'zen') return ZEN_INDEX;
    if (mode === 'daily') return Math.floor(Date.parse(todayUtc()) / 86400000) % MOVEMENTS.length;
    return index;
  }

  // ---------------------------------------------------------------- attract (title / results music)

  private attractTrack: TrackDef | null = null;
  private attractLayers = 3;
  private attractToken = 0;
  private attractMorph: { step: number; bpm: number } | null = null;
  /** True once the attract music is scheduled on the transport */
  attractOn = false;
  /** Step on which the attract track's bar 1 lands (the latest scheduled start or blend) */
  attractStartStep = 0;
  /** Music held by Listen mode's pause */
  musicHeld = false;
  /** Visualizer presence forced by a screen (Listen mode), else the settings rule applies */
  visOverride: number | null = null;

  /**
   * Menus play music: the selected run's movement loops behind the title (and the last run's
   * behind results), its world drawn around it. Changing selection morphs on the next downbeat,
   * so browsing the setlist is beat-matched like a DJ blend.
   */
  attract(mode: GameMode, movement: number, layers = 3): void {
    if (this.run) return;
    void this.attractTo(mode === 'overture' ? OVERTURE : MOVEMENTS[App.trackIndex(mode, movement)]!, layers);
  }

  /**
   * Plays `track` behind a menu with `layers` stems (6 = full mix). A running transport blends on
   * `atStep` when it is at least half a bar away, else on the next downbeat. Resolves to the step
   * the track's bar 1 lands on, or null when superseded or audio is locked.
   */
  attractTo(track: TrackDef, layers = 3, atStep?: number): Promise<number | null> {
    if (this.run) return Promise.resolve(null);
    if (track === this.attractTrack && layers === this.attractLayers && atStep === undefined) return Promise.resolve(this.attractOn ? this.attractStartStep : null);
    this.attractTrack = track;
    this.attractLayers = layers;
    const w = this.cosmetics?.(worldFor(track.style)) ?? worldFor(track.style);
    this.world.setWorld(w);
    this.vis.accent = w.accent;
    this.world.root.visible = true;
    this.wall.setPoolTint(trackTint(track), performance.now() / 1000, 0);
    this.sfx.setTrack(track);
    document.documentElement.style.setProperty('--world', `#${w.accent.toString(16).padStart(6, '0')}`);
    return this.playAttract(atStep);
  }

  private playAttract(atStep?: number): Promise<number | null> {
    const track = this.attractTrack;
    if (!track || this.run) return Promise.resolve(null);
    if (!this.audio.running) {
      // Back from a paused run the context is suspended by us: wake it (no-op until a gesture otherwise)
      if (!document.hidden && !this.blocked && !this.musicHeld) void this.audio.resume().then(() => {
          if (this.audio.running && this.attractTrack === track && !this.attractOn) void this.playAttract();
        });
      return Promise.resolve(null);
    }
    const token = ++this.attractToken;
    return this.stems.load(track).then(() => {
      if (token !== this.attractToken || this.run || this.attractTrack !== track) return null;
      const now = this.audio.now;
      const bpm = track.bpm;
      if (this.attractOn && this.clock.isRunning && this.stems.track) {
        // Blend on the next downbeat at least half a bar away
        const q = this.clock.query(now);
        const s16 = q.absoluteStep % TUNING.SIXTEENTHS_PER_BAR;
        let step = (q.bar + (s16 >= 8 ? 1 : 0)) * TUNING.SIXTEENTHS_PER_BAR;
        if (atStep !== undefined && atStep >= step) step = atStep;
        const atSec = this.clock.stepToAudioSec(step);
        if (this.stems.track !== track) void this.stems.morph(track, atSec, Math.min(1.2, (60 / bpm) * 2));
        this.stems.setLayers(this.attractLayers, atSec, 60 / bpm);
        this.attractMorph = { step, bpm };
        this.attractStartStep = step;
        return step;
      }
      const t0 = now + 0.08;
      this.stems.rate = 1;
      this.clock.bpm = bpm;
      this.clock.start(t0);
      this.attractMorph = null;
      this.attractOn = true;
      this.attractStartStep = 0;
      void this.stems.start(track, t0, this.attractLayers);
      return 0;
    });
  }

  /**
   * Holds the music (Listen mode's pause): audio and clock stop together and stay stopped through
   * visibility and rotation changes until released.
   */
  holdMusic(on: boolean): void {
    if (on === this.musicHeld) return;
    this.musicHeld = on;
    if (on) {
      this.clock.pause(this.audio.now);
      void this.audio.suspend();
    } else if (!document.hidden && !this.blocked) {
      void this.audio.resume().then(() => this.clock.resume(this.audio.now));
    }
  }

  /** Stops the menu music (a run is starting). */
  stopAttract(): void {
    this.attractToken++;
    this.attractTrack = null;
    this.attractMorph = null;
    if (this.attractOn) this.stems.stopAll(this.audio.now + 0.05);
    this.attractOn = false;
  }

  /** The track currently looping behind a menu. */
  get attracting(): TrackDef | null {
    return this.attractOn ? this.attractTrack : null;
  }

  /** Menu feedback: tones in the key of the music playing. */
  uiSound(kind: UiSoundKind, i = 0): void {
    if (!this.audio.running) return;
    const t = this.audio.now + 0.004;
    if (kind === 'move') this.sfx.play(`prime-${i % 4}`, t, 0.3, true);
    else if (kind === 'pick') {
      this.sfx.play(`prime-${i % 4}`, t, 0.45, true);
      this.sfx.play('detonate', t, 0.35);
    } else if (kind === 'back') this.sfx.play('slide', t, 0.5);
    else if (kind === 'tick') this.sfx.play(`prime-${i % 4}`, t, 0.16 + 0.04 * (i % 3), true);
    else if (kind === 'stamp') {
      this.sfx.play('detonate', t, 0.7);
      this.sfx.play('prime-0', t, 0.4, true);
    } else if (kind === 'fanfare') this.sfx.play('allclear', t, 0.55);
    else this.sfx.play('slide', t, 0.8);
  }

  /** The running run as a replay so far (null outside a real run). */
  currentReplay(): Replay | null {
    return this.engine && this.run?.replayable ? replayOf(this.engine) : null;
  }

  /** Re-simulates a replay with the game's rules: ghosts, and checking a run before it is shared. */
  simulateReplay(r: Replay): SimResult {
    return simulate(r, new GemRules('brick'));
  }

  /**
   * Checks achievements after a run or a moment; new ones are saved and toasted. `quiet` marks
   * them without toasts (the boot catch-up, so an existing save does not get a burst).
   */
  achieve(moment?: AchContext['moment'], run?: AchContext['run'], quiet = false): AchDef[] {
    const got = evaluateAchievements({ save: this.save, movements: MOVEMENTS, rankOf: sc => mastery(sc).rank, moment, run });
    if (!got.length) return got;
    this.persistSave();
    if (!quiet) for (const a of got) this.toastQueue.push(a);
    return got;
  }

  private readonly toastQueue: AchDef[] = [];
  private readonly toastEl = el('div', 'ach-toast', '', { role: 'status' });
  private toastUntil = 0;

  /** Shows queued achievement toasts one at a time. */
  private updateToasts(nowMs: number): void {
    if (nowMs < this.toastUntil) return;
    if (this.toastEl.classList.contains('on')) {
      this.toastEl.classList.remove('on');
      this.toastUntil = nowMs + 350;
      return;
    }
    const a = this.toastQueue.shift();
    if (!a) return;
    if (!this.toastEl.isConnected) this.ui.appendChild(this.toastEl);
    this.toastEl.innerHTML = `<small>${tr('ach.toast')}</small><b>${tx(`ach.${a.id}.name`, a.name)}</b><span>${tx(`ach.${a.id}.desc`, a.desc)}</span>`;
    this.toastEl.classList.add('on');
    this.uiSound('fanfare');
    announce(`${tr('ach.toast')}: ${tx(`ach.${a.id}.name`, a.name)}. ${tx(`ach.${a.id}.desc`, a.desc)}`);
    this.toastUntil = nowMs + 3200;
  }

  /** Adds a finished or quit run to the local playtest log (Profile > Export). */
  private logPlaytest(run: RunState, engine: PulseEngine, score: number, replay: Replay | null, ended: 'topped-out' | 'quit'): void {
    if (run.mode === 'overture' || engine.currentStep < 16) return;
    const s = this.settings;
    recordPlaytest({
      at: new Date().toISOString(),
      mode: run.cfg.etude ? `etude:${run.cfg.etude.id}` : run.mode,
      track: run.track.id.startsWith('beat-') ? 'my-beat' : run.track.id,
      score,
      bars: engine.currentBar,
      seconds: Math.round((performance.now() - run.startedMs) / 1000),
      ended,
      telemetry: { ...engine.telemetry },
      frames: { ...this.runFrames },
      device: {
        dpr: devicePixelRatio,
        width: innerWidth,
        height: innerHeight,
        touch: matchMedia('(pointer: coarse)').matches,
        bloom: this.stage.bloomEnabled,
        outputLatencyMs: Math.round(this.audio.outputLatencySec * 1000),
        sampleRate: this.audio.ctx.sampleRate,
        ua: navigator.userAgent
      },
      settings: { offsetMs: s.offsetMs, bpmScale: s.bpmScale, flash: s.flash, strobeFree: s.strobeFree, reducedMotion: s.reducedMotion, symbols: s.symbols, colourAssist: s.colourAssist, calibrated: s.calibrated },
      replay
    });
  }

  /** Ends the current run silently (quit / restart). */
  abandonRun(): void {
    if (!this.run) return;
    if (this.engine && !this.run.ended) this.logPlaytest(this.run, this.engine, Math.round(this.engine.telemetry.score * this.run.bpmScale), this.run.replayable ? replayOf(this.engine) : null, 'quit');
    this.run.ended = true;
    this.ghost = null;
    this.stems.stopAll();
    this.input?.cancelAll();
    this.run = null;
    this.engine = null;
    this.director.engine = null;
    this.hud.show(false);
    this.streamScore.hidden = true;
    this.desk.setRun(false);
    this.setHover(-1);
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
    // The board changed: refresh the hover preview once
    if (this.hoverCell >= 0 && ev.type !== 'danger') this.hoverStep = -2;
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
        announce(tr('say.allClear', { n: ev.points }));
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
    this.hoverAt(-1);
    this.setHover(-1);
    const now = this.audio.now;
    this.stems.stopAll(now + this.clock.barDurationSec);
    this.wall.collapse(performance.now() / 1000);
    this.blade.fadeOut();
    this.scheduler.queue('over', now + 0.02, 0.9);
    const score = Math.round(engine.telemetry.score * run.bpmScale);
    const replay = run.replayable ? replayOf(engine) : null;
    const ghostKey = App.ghostKey(run.cfg, run.startMovement);
    if (replay && ghostKey) void this.ghosts.offer({ key: ghostKey, score, scale: run.bpmScale, replay, at: Date.now() });
    this.ghost = null;
    const key = run.cfg.track ? run.cfg.track.id : run.mode === 'odyssey' ? MOVEMENTS[run.startMovement]!.id : run.mode === 'remix' ? bsideKey(MOVEMENTS[run.startMovement]!.id) : run.mode === 'mixtape' ? tapeKey(run.cfg.mixtape ?? [], MOVEMENTS) : run.mode;
    let previousBest = 0;
    if (run.mode === 'daily') {
      const today = todayUtc();
      previousBest = this.save.daily.date === today ? this.save.daily.best : 0;
      if (score > previousBest) this.save.daily = { date: today, best: score };
    } else if (run.mode !== 'overture' && run.mode !== 'practice') {
      previousBest = this.save.best[key] ?? 0;
      if (score > previousBest) this.save.best[key] = score;
    }
    let newStars: string[] = [];
    this.logPlaytest(run, engine, score, replay, 'topped-out');
    if (run.mode !== 'overture') {
      recordStats(this.save, engine.telemetry, (performance.now() - run.startedMs) / 1000, run.movementsCleared);
      if (run.mode === 'daily') noteDaily(this.save, todayUtc());
      if (run.mode === 'odyssey') {
        const track = MOVEMENTS[run.startMovement]!;
        newStars = awardChallenges(this.save, track, run.startMovement, { t: engine.telemetry, score, cleared: run.movementsCleared > 0 });
      }
    }
    this.achieve(undefined, { mode: run.mode, score, bars: engine.currentBar, seconds: (performance.now() - run.startedMs) / 1000, t: engine.telemetry, myBeat: !!run.cfg.track });
    this.persistSave();
    setTimeout(() => {
      this.hud.show(false);
      this.streamScore.hidden = true;
      this.hooks.onRunEnd?.({ run, engine, score, previousBest, key, newStars, replay });
    }, 1700);
  }

  /** Movement world (motif, blade, shards) and its title card, held for one bar. */
  applyWorld(track: TrackDef, card: boolean): void {
    const w = worldFor(track.style);
    const c = this.cosmetics?.(w) ?? w;
    this.world.setWorld(c);
    this.vis.accent = c.accent;
    this.blade.setStyle(c.blade, c.accent);
    this.fx.setShardMaterial(c.shard);
    if (!card) return;
    this.card.innerHTML = `<div class="mc-num">${track.flatMix ? `MY BEAT · ${Math.round(track.bpm)} BPM` : this.run?.mode === 'remix' ? `${track.number} · ${tr('rx.bside').toUpperCase()} · ${tx(`rx.twist.${remixRules(track, this.run.startMovement).twist}`, '').toUpperCase()}` : `${track.number} · ${track.style.toUpperCase()}`}</div><div class="mc-name">${track.name}</div>`;
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
    // Practice holds its chosen section for the whole run
    if (!run || !e || run.morph || run.mode === 'overture' || run.mode === 'practice') return;
    const t = run.track;
    const n = t.sections.length;
    if (n < 2) return;
    let p: number;
    if (run.mode === 'mixtape') {
      p = (e.currentBar - (run.movementStartBar ?? 1)) / MIXTAPE_BARS;
    } else if (run.mode === 'zen' || !Number.isFinite(run.movementStartScore) || t.quota <= 0) {
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
    const earned = e.telemetry.score - run.movementStartScore;
    if (run.mode === 'remix' && earned >= run.track.quota) {
      // A B-side is one movement: reaching its quota clears it, then it plays on until the wall wins
      if (!this.save.bsides.includes(run.track.id)) {
        this.save.bsides.push(run.track.id);
        this.persistSave();
      }
      run.movementsCleared++;
      run.movementStartScore = Number.POSITIVE_INFINITY;
      this.hud.calloutText(tr('rx.cleared'), run.track.name.toUpperCase());
      announce(tr('rx.sayCleared', { name: run.track.name }));
      return;
    }
    if (run.cfg.track || (run.mode !== 'odyssey' && run.mode !== 'endless' && run.mode !== 'daily')) return;
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

  /**
   * Mixtape: a track plays MIXTAPE_BARS from the bar it started on, then the next one crossfades in on
   * the downbeat (scheduled a full bar ahead so the stems start sample-accurately). After the last
   * track the run ends.
   */
  private checkTape(): void {
    const run = this.run;
    const e = this.engine;
    const list = run?.cfg.mixtape;
    if (!run || !e || run.ended || run.morph || run.mode !== 'mixtape' || !list) return;
    const start = run.movementStartBar ?? 1;
    // Bar B begins at step (B - 1) * 16
    const switchStep = (start + MIXTAPE_BARS - 1) * TUNING.SIXTEENTHS_PER_BAR;
    if (run.tapePos >= list.length - 1) {
      if (e.currentStep >= switchStep) {
        announce(tr('mx.sayDone'));
        this.endRun();
      }
      return;
    }
    if (switchStep - e.currentStep > TUNING.SIXTEENTHS_PER_BAR) return;
    const next = list[run.tapePos + 1]!;
    const atSec = this.clock.stepToAudioSec(switchStep);
    run.morph = { step: switchStep, index: next, atSec };
    const track = MOVEMENTS[next]!;
    void this.stems.morph(track, atSec, (60 / (track.bpm * run.bpmScale)) * 4);
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
    e.reconfigure(bpm, track.colors, track.riseBars);
    run.morph = null;
    if (run.mode === 'mixtape') run.tapePos++;
    run.movement = index;
    run.track = track;
    run.movementStartScore = e.telemetry.score;
    // A mixtape track counts its bars from its own downbeat (the engine may still be on the bar before)
    run.movementStartBar = run.mode === 'mixtape' ? Math.floor(step / TUNING.SIXTEENTHS_PER_BAR) + 1 : e.currentBar;
    this.sfx.setTrack(track);
    this.scheduler.resetHorizon();
    this.wall.setPoolTint(trackTint(track), performance.now() / 1000, this.clock.barDurationSec);
    this.applyWorld(track, true);
    announce(tr('say.movement', { num: track.number, name: track.name }));
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
  private lastBeatCss = '';
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
        if (i === 0) announce(tr('say.resuming'));
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
    if (!this.blocked && !this.musicHeld) void this.audio.resume().then(() => this.clock.resume(this.audio.now));
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
    } else if (!this.paused && !this.musicHeld) {
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
    this.features.update(this.clock.isRunning ? beat : null);
    const e = this.engine;
    const run = this.run;
    if (run && !run.ended && !this.paused) {
      this.watchFrameBudget(dt * 1000);
      addFrame(this.runFrames, dt * 1000);
    }

    if (e && run && !this.paused && !this.blocked && this.clock.isRunning) {
      this.applyMorph();
      if (beat.elapsedSec >= this.clock.outputLatencySec && !run.ended) {
        e.advanceToStep(beat.visualStep);
        this.drain();
        this.checkQuota();
        this.checkTape();
      }
      this.input.update(performance.now());
      this.updateDesk();
      if (this.hoverCell >= 0 && this.hoverStep === -2) {
        this.hoverStep = -1;
        this.setHover(this.hoverCell);
      } else if (this.hoverCell < 0 && this.hoverStep !== -3) {
        this.hoverStep = -3;
        this.setHover(-1);
      }
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

    if (!e && this.attractOn) {
      const m = this.attractMorph;
      if (m && beat.absoluteStep >= m.step) {
        this.clock.setBpmAtStep(m.bpm, m.step);
        this.attractMorph = null;
      }
    }
    this.cursor?.update();
    this.updateToasts(performance.now());
    this.hooks.onFrame?.();
    // Visualizer: behind the menus while their music plays, and behind the wall in Zen when chosen
    const vs = this.settings;
    const inZen = !!e && run?.mode === 'zen' && vs.zenVisualizer && !this.paused;
    this.vis.setTarget(this.visOverride ?? (vs.visualizer === 'off' ? 0 : !e && this.attractOn ? 0.7 : inZen ? 0.55 : 0), this.visOverride !== null);
    this.vis.update(dt);
    this.backdrop.update(wallSec, this.attractOn && this.clock.isRunning ? beat : null, this.clock.barDurationSec);
    if (!e) {
      // Menus: the world breathes on the music; CSS reads the beat as --beat (1 on the beat -> 0)
      const bp = this.attractOn && this.clock.isRunning ? beat.beatProgress : (wallSec / (60 / 116)) % 1;
      if (this.world.root.visible) this.world.update(wallSec, dt, bp);
      const pulse = this.settings.reducedMotion || !this.attractOn ? 0 : (1 - bp) * (1 - bp);
      const v = pulse.toFixed(2);
      if (v !== this.lastBeatCss) {
        this.lastBeatCss = v;
        document.documentElement.style.setProperty('--beat', v);
      }
    }

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
      this.updateStreamScore(Math.round(e.telemetry.score * run.bpmScale), computeComboMultiplier(e.comboPasses), run);
      this.hud.update({
        score: Math.round(e.telemetry.score * run.bpmScale),
        chainRank: e.chainRank,
        combo: computeComboMultiplier(e.comboPasses),
        layers: this.stems.activeLayers,
        movement: run.cfg.track ? run.track.name.toUpperCase() : run.mode === 'odyssey' ? `${run.track.number} · ${run.track.name.toUpperCase()}` : run.mode === 'etude' || run.mode === 'overture' ? this.modeLabel(run) : `${this.modeLabel(run)} · ${run.track.name.toUpperCase()}`,
        bpm: this.clock.bpm,
        bar: e.currentBar,
        risesIn: e.barsUntilNextPush,
        charge: e.charge,
        ghost: this.stepGhost(e.currentStep, Math.round(e.telemetry.score * run.bpmScale)),
        best: run.mode === 'daily' ? (this.save.daily.date === todayUtc() ? this.save.daily.best : 0) : (this.save.best[App.ghostKey(run.cfg, run.startMovement) ?? run.mode] ?? 0),
        groups: e.telemetry.groupsCleared,
        credit: run.cfg.track ? `♪ ${run.track.name} · ${Math.round(run.track.bpm)} BPM` : run.mode === 'overture' ? '♪ Overture' : `♪ ${run.track.number} ${run.track.name} · ${run.track.style[0]!.toUpperCase()}${run.track.style.slice(1)}`,
        pulse: this.settings.reducedMotion ? 0 : (1 - beat.beatProgress) * (1 - beat.beatProgress),
        danger: this.wall.dangerLevel
      });
    }
    this.stage.render();
  };

  /** Desktop: live stats in the letterbox bars, a few times per second. */
  private updateDesk(): void {
    const run = this.run;
    const e = this.engine;
    if (!run || !e || ++this.deskTick % 12 !== 0) return;
    const t = e.telemetry;
    const key = run.mode === 'odyssey' ? MOVEMENTS[run.startMovement]!.id : run.mode;
    const quota = run.track.quota || 1;
    const label =
      run.mode === 'etude'
        ? `${run.cfg.etude?.topic ? 'TRY IT' : 'ETUDE'} · ${run.cfg.etude?.name.toUpperCase() ?? ''}`
        : run.mode === 'overture'
          ? 'OVERTURE'
          : `ACT ${run.track.act} · ${run.track.number} ${run.track.name.toUpperCase()}`;
    this.desk.update({
      act: run.track.act,
      movementIndex: run.movement,
      label,
      progress: Number.isFinite(run.movementStartScore) ? (t.score - run.movementStartScore) / quota : 1,
      best: this.save.best[key] ?? 0,
      groups: t.groupsCleared,
      bestPass: t.bestPassScore,
      allClears: t.allClears,
      overcharges: t.overchargesLanded,
      airPrimes: t.airPrimesLanded
    });
  }

  /** Desktop hover: the group under the mouse previews before you click. */
  hoverAt(cell: number): void {
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    this.hoverStep = -2;
  }

  private setHover(cell: number): void {
    const e = this.engine;
    const g = document.getElementById('game');
    if (!e || cell < 0 || !this.canTouch(cell)) {
      this.wall.setHover(null);
      g?.classList.remove('can-prime');
      return;
    }
    const col = cell % TUNING.BOARD_COLS;
    const row = (cell / TUNING.BOARD_COLS) | 0;
    const cluster = e.rules.primeable(e.board, col, row, e.getLockedTileIds());
    const cells = cluster && cluster.length >= TUNING.MIN_GROUP ? cluster.map(t => t.row * TUNING.BOARD_COLS + t.col) : null;
    this.wall.setHover(cells);
    g?.classList.toggle('can-prime', !!cells);
  }

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
    if (on) this.world.root.visible = true;
    document.getElementById('game')?.classList.toggle('title-mode', !on);
  }

  get cellPoint(): { x: number; y: number } {
    return this.cellPt;
  }
}

