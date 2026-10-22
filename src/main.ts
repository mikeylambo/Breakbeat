/** BREAKBEAT entry: screens and flow (title card -> main menu -> setlist / tutorial -> run -> results). */

import { App, type RunConfig } from './ui/App.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { SplashScreen } from './ui/SplashScreen.js';
import { SetlistScreen } from './ui/SetlistScreen.js';
import { TutorialScreen } from './ui/TutorialScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { ProfileSheet } from './ui/ProfileSheet.js';
import { EtudeScreen } from './ui/EtudeScreen.js';
import { OvertureScreen } from './ui/overture/OvertureScreen.js';
import { nextMovementIndex } from './meta/Save.js';
import { ZEN_INDEX } from './audio/tracks.js';
import { readFlag, writeFlag } from './platform/Storage.js';
import { WallView } from './render/WallView.js';
import { announce, bladeWipe, el, uiSound } from './ui/dom.js';
import type { PulseEvent } from './pulse/types.js';
import { TUNING, type GameMode } from './tuning.js';
import { applyUiTransform, computeLayout } from './render/layout.js';

const TAUGHT_AIR = 'breakbeat-taught-air';
const TAUGHT_CHARGE = 'breakbeat-taught-charge';
const app = new App();

async function main(): Promise<void> {
  // Instant start: the title is live before the renderer, atlas and audio finish booting.
  const ready = app.init();
  const w =
    (fn: () => unknown) =>
    (): void => {
      void app.audio.resume().catch(() => undefined);
      void ready.then(() => fn());
    };
  const etudes = new EtudeScreen(
    app,
    () => {
      hideMenus();
      coach.classList.add('hidden');
      app.backdrop.show(false);
      app.setWallVisible(true);
    },
    () => showTitle()
  );
  const profile = new ProfileSheet({ save: app.save, persist: () => app.persistSave() });
  app.ui.appendChild(profile.root);
  const preview = (mode: GameMode, movement: number): void => void ready.then(() => app.attract(mode, movement));

  // Title card -> main menu. The press unlocks audio, so the music lands with the menu.
  const splash = new SplashScreen(() => {
    void app.audio.unlock();
    uiSound('stamp');
    void ready.then(async () => {
      await app.audio.unlock();
      await bladeWipe();
      splash.show(false);
      showTitle(false);
    });
  });
  const title = new TitleScreen({
    continue: w(() => (app.save.overtureDone ? play({ mode: 'odyssey', movement: nextMovementIndex(app.save) }) : startOverture())),
    odyssey: () => {
      title.show(false);
      setlist.open(app.save);
    },
    endless: w(() => play({ mode: 'endless', movement: 0 })),
    daily: w(() => play({ mode: 'daily', movement: 0 })),
    zen: w(() => play({ mode: 'zen', movement: ZEN_INDEX })),
    etudes: w(() => etudes.showList(true)),
    tutorial: () => {
      title.show(false);
      tutorial.open();
    },
    settings: () => app.openSettings(),
    calibrate: w(() => app.calibration.show(true)),
    profile: () => profile.show(true),
    back: () => {
      title.show(false);
      splash.show(true);
    },
    preview,
    calibrated: () => app.settings.calibrated
  });
  const setlist = new SetlistScreen({
    play: i => w(() => play({ mode: 'odyssey', movement: i }))(),
    preview: i => preview('odyssey', i),
    back: () => {
      setlist.hide();
      title.show(true);
    }
  });
  const tutorial = new TutorialScreen({
    back: () => {
      tutorial.hide();
      title.show(true);
    },
    overture: () => {
      tutorial.hide();
      void startOverture();
    },
    drill: def =>
      w(async () => {
        app.stopAttract();
        await bladeWipe();
        etudes.startDrill(def, () => {
          // Back to the slide the drill came from
          app.abandonRun();
          hideMenus();
          app.setWallVisible(false);
          app.backdrop.show(true);
          tutorial.open();
        });
      })()
  });
  app.ui.append(splash.root, title.root, setlist.root, tutorial.root);
  const place = (): void => applyUiTransform(app.ui, computeLayout());
  place();
  window.addEventListener('resize', place);
  title.render(app.save);
  // The boot title card is already on screen: swap in place, no entrance animation
  splash.root.classList.add('no-anim');
  splash.show(true);
  document.getElementById('boot')?.remove();
  setTimeout(() => splash.root.classList.remove('no-anim'), 1000);
  app.calibration.onDone = () => {
    if (title.root.classList.contains('hidden')) return;
    title.render(app.save);
    title.previewCurrent();
  };
  const overture = new OvertureScreen(
    app,
    () => {
      markOvertureDone();
      play({ mode: 'odyssey', movement: 0 });
    },
    () => {
      markOvertureDone();
      app.morphOvertureToMovement();
      announce('Overture complete. Movement 01, Ignition.');
    }
  );
  const results = new ResultsScreen(app, {
    next: () => play({ mode: 'odyssey', movement: nextMovementIndex(app.save) }),
    replay: () => {
      const cfg = lastCfg;
      if (cfg) void play(cfg);
    },
    title: () => showTitle()
  });
  let lastCfg: RunConfig | null = null;
  let nowPlaying: unknown = null;
  let coachUntil = 0;
  const coach = el('div', 'coachmark hidden', '', { role: 'status' });
  const showCoach = (html: string, seconds: number): void => {
    coach.innerHTML = html;
    coach.classList.remove('hidden');
    coachUntil = performance.now() / 1000 + seconds;
  };
  app.ui.append(overture.root, coach, results.root);

  function markOvertureDone(): void {
    if (!app.save.overtureDone) {
      app.save.overtureDone = true;
      app.persistSave();
    }
  }

  function hideMenus(): void {
    results.hide();
    title.show(false);
    setlist.hide();
    tutorial.hide();
    splash.show(false);
  }

  /** Back to the main menu (after a run, or from the title card). */
  function showTitle(fromRun = true): void {
    etudes.clear();
    if (fromRun) app.abandonRun();
    hideMenus();
    app.setWallVisible(false);
    app.backdrop.show(true);
    title.render(app.save);
    title.show(true);
    announce('Breakbeat. Main menu.');
  }

  async function play(cfg: RunConfig): Promise<void> {
    if (cfg.mode !== 'overture') lastCfg = cfg;
    // Leaving a menu: the music cuts, a blade wipes the screen, the wall deals in behind it
    if (title.visible || results.visible || setlist.visible || tutorial.visible) {
      app.stopAttract();
      await bladeWipe();
    }
    hideMenus();
    coach.classList.add('hidden');
    app.backdrop.show(false);
    app.setWallVisible(true);
    await app.startRun(cfg);
  }

  async function startOverture(): Promise<void> {
    await play({ mode: 'overture', movement: 0 });
    overture.begin();
    announce('Overture. Tap the glowing group.');
  }

  // In-run air-prime lesson: once ever, Movement 01 or later, time never slows
  const centre = { x: 0, y: 0 };
  function maybeTeachAir(ev: PulseEvent): void {
    const run = app.run;
    const e = app.engine;
    if (ev.type !== 'cascade' || !run || !e || run.mode === 'overture' || run.mode === 'zen') return;
    if (readFlag(TAUGHT_AIR)) return;
    const locked = e.getLockedTileIds();
    for (const id of ev.movedTileIds) {
      if (!e.falling.has(id)) continue;
      const t = e.findTileById(id);
      if (!t) continue;
      const cluster = e.rules.primeable(e.board, t.col, t.row, locked);
      if (!cluster || cluster.length < TUNING.MIN_GROUP) continue;
      let x = 0;
      let y = 0;
      let far = 0;
      for (const m of cluster) {
        WallView.cellCentre(m.col, m.row, centre);
        x += centre.x;
        y += centre.y;
      }
      x /= cluster.length;
      y /= cluster.length;
      for (const m of cluster) {
        WallView.cellCentre(m.col, m.row, centre);
        far = Math.max(far, Math.hypot(centre.x - x, centre.y - y));
      }
      const twoBars = app.clock.barDurationSec * 2;
      app.fx.teach(x, y, far + 24, twoBars);
      showCoach('Catch it mid-fall · <span>×1.25</span>', twoBars);
      writeFlag(TAUGHT_AIR, true);
      announce('Catch it mid-fall for times one point two five.');
      return;
    }
  }

  app.ui.append(etudes.caption, etudes.banner, etudes.list);
  app.hooks.onEvent = ev => {
    if (etudes.active) etudes.onEvent(ev);
    if (overture.running) overture.onEvent(ev);
    else maybeTeachAir(ev);
  };
  app.hooks.onFrame = () => {
    if (overture.running) overture.onFrame();
    if (etudes.active) etudes.onFrame();
    // Charge lesson: the first time the meter fills in a real run, once ever
    const run = app.run;
    if (run && !run.ended && run.mode !== 'overture' && app.engine?.canHold && !readFlag(TAUGHT_CHARGE)) {
      writeFlag(TAUGHT_CHARGE, true);
      showCoach('<span>HOLD READY</span> · long-press a primed group to Overcharge it', app.clock.barDurationSec * 2);
      app.hud.flashCharge();
      announce('Charge full. Long-press a primed group to overcharge it.');
    }
    results.onFrame();
    if (title.visible) {
      const t = app.attracting;
      if (t !== nowPlaying) {
        nowPlaying = t;
        if (t) title.setNowPlaying(t.id === 'overture' ? 'NOW PLAYING · OVERTURE' : `NOW PLAYING · ${t.number} ${t.name.toUpperCase()} · ${t.style.toUpperCase()}`);
      }
    }
    if (coachUntil && performance.now() / 1000 > coachUntil) {
      coachUntil = 0;
      coach.classList.add('hidden');
    }
  };
  app.hooks.onRunEnd = r => {
    if (r.run.mode === 'overture') {
      showTitle();
      return;
    }
    lastCfg = r.run.cfg;
    app.abandonRun();
    app.setWallVisible(false);
    results.show(r);
    app.attract('odyssey', r.run.movement, 2);
  };
  app.showTitle = showTitle;
  app.replayOverture = () => {
    app.closeSheets();
    void startOverture();
  };
  await ready;
  window.removeEventListener('resize', place);
  // Offline: install the service worker once the game is up (never competes with boot)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    setTimeout(() => void navigator.serviceWorker.register('/sw.js').catch(() => undefined), 1500);
  }
  app.setWallVisible(false);
  app.backdrop.show(true);
  title.previewCurrent();
  document.getElementById('game')!.dataset.ready = '1';
  (window as unknown as { __bb: unknown }).__bb = app;
  (app as unknown as { __overture: unknown }).__overture = overture;
}

void main();
