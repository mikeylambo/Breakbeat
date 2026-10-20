/** BREAKBEAT v0.6 entry: screens and flow. */

import { App, type RunConfig } from './ui/App.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { OvertureScreen } from './ui/overture/OvertureScreen.js';
import { nextMovementIndex } from './meta/Save.js';
import { readFlag, writeFlag } from './platform/Storage.js';
import { WallView } from './render/WallView.js';
import { announce, el } from './ui/dom.js';
import type { PulseEvent } from './pulse/types.js';
import { TUNING } from './tuning.js';

const TAUGHT_AIR = 'breakbeat-taught-air';
const app = new App();

async function main(): Promise<void> {
  await app.init();
  const title = new TitleScreen({
    continue: () => (app.save.overtureDone ? play({ mode: 'odyssey', movement: nextMovementIndex(app.save) }) : startOverture()),
    movement: i => play({ mode: 'odyssey', movement: i }),
    endless: () => play({ mode: 'endless', movement: 0 }),
    daily: () => play({ mode: 'daily', movement: 0 }),
    zen: () => play({ mode: 'zen', movement: 5 }),
    settings: () => app.openSettings()
  });
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
  const coach = el('div', 'coachmark hidden', 'Catch it mid-fall · <span>×1.25</span>', { role: 'status' });
  app.ui.append(title.root, overture.root, coach, results.root);

  function markOvertureDone(): void {
    if (!app.save.overtureDone) {
      app.save.overtureDone = true;
      app.persistSave();
    }
  }

  function showTitle(): void {
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
  let coachUntil = 0;
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
      coach.classList.remove('hidden');
      coachUntil = performance.now() / 1000 + twoBars;
      writeFlag(TAUGHT_AIR, true);
      announce('Catch it mid-fall for times one point two five.');
      return;
    }
  }

  app.hooks.onEvent = ev => {
    if (overture.active) overture.onEvent(ev);
    else maybeTeachAir(ev);
  };
  app.hooks.onFrame = () => {
    if (overture.active) overture.onFrame();
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
  showTitle();
  document.getElementById('game')!.dataset.ready = '1';
  (window as unknown as { __bb: unknown }).__bb = app;
}

void main();
