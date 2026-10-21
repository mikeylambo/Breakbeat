/** BREAKBEAT v0.6 entry: screens and flow. */

import { App, type RunConfig } from './ui/App.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { ProfileSheet } from './ui/ProfileSheet.js';
import { EtudeScreen } from './ui/EtudeScreen.js';
import { OvertureScreen } from './ui/overture/OvertureScreen.js';
import { nextMovementIndex } from './meta/Save.js';
import { ZEN_INDEX } from './audio/tracks.js';
import { readFlag, writeFlag } from './platform/Storage.js';
import { WallView } from './render/WallView.js';
import { announce, el } from './ui/dom.js';
import type { PulseEvent } from './pulse/types.js';
import { TUNING } from './tuning.js';
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
      results.hide();
      title.show(false);
      coach.classList.add('hidden');
      app.backdrop.show(false);
      app.setWallVisible(true);
    },
    () => showTitle()
  );
  const profile = new ProfileSheet({ save: app.save, persist: () => app.persistSave() });
  app.ui.appendChild(profile.root);
  const title = new TitleScreen({
    continue: w(() => (app.save.overtureDone ? play({ mode: 'odyssey', movement: nextMovementIndex(app.save) }) : startOverture())),
    movement: i => w(() => play({ mode: 'odyssey', movement: i }))(),
    endless: w(() => play({ mode: 'endless', movement: 0 })),
    daily: w(() => play({ mode: 'daily', movement: 0 })),
    zen: w(() => play({ mode: 'zen', movement: ZEN_INDEX })),
    etudes: w(() => etudes.showList(true)),
    settings: () => app.openSettings(),
    calibrate: w(() => app.calibration.show(true)),
    profile: () => profile.show(true),
    calibrated: () => app.settings.calibrated
  });
  app.ui.appendChild(title.root);
  const place = (): void => applyUiTransform(app.ui, computeLayout());
  place();
  window.addEventListener('resize', place);
  title.render(app.save);
  // The boot title is already on screen: swap in place, no entrance animation
  title.root.classList.add('no-anim');
  title.show(true);
  document.getElementById('boot')?.remove();
  setTimeout(() => title.root.classList.remove('no-anim'), 1000);
  app.calibration.onDone = () => {
    if (title.root.classList.contains('hidden')) return;
    title.render(app.save);
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

  function showTitle(): void {
    etudes.clear();
    results.hide();
    app.abandonRun();
    app.setWallVisible(false);
    app.backdrop.show(true);
    title.render(app.save);
    title.show(true);
    announce('Breakbeat. Title.');
  }

  async function play(cfg: RunConfig): Promise<void> {
    if (cfg.mode !== 'overture') lastCfg = cfg;
    results.hide();
    title.show(false);
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
  };
  app.showTitle = showTitle;
  app.replayOverture = () => {
    app.closeSheets();
    void startOverture();
  };
  await ready;
  window.removeEventListener('resize', place);
  showTitle();
  document.getElementById('game')!.dataset.ready = '1';
  (window as unknown as { __bb: unknown }).__bb = app;
  (app as unknown as { __overture: unknown }).__overture = overture;
}

void main();
