/** BREAKBEAT v0.6 entry: screens and flow. */

import { App, type RunConfig } from './ui/App.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { nextMovementIndex } from './meta/Save.js';
import { announce } from './ui/dom.js';

const app = new App();

async function main(): Promise<void> {
  await app.init();
  const title = new TitleScreen({
    continue: () => play({ mode: 'odyssey', movement: nextMovementIndex(app.save) }),
    movement: i => play({ mode: 'odyssey', movement: i }),
    endless: () => play({ mode: 'endless', movement: 0 }),
    daily: () => play({ mode: 'daily', movement: 0 }),
    zen: () => play({ mode: 'zen', movement: 5 }),
    settings: () => app.openSettings()
  });
  app.ui.appendChild(title.root);

  function showTitle(): void {
    app.abandonRun();
    app.setWallVisible(false);
    app.backdrop.show(true);
    title.render(app.save);
    title.show(true);
    announce('Breakbeat. Title.');
  }

  function play(cfg: RunConfig): void {
    title.show(false);
    app.backdrop.show(false);
    app.setWallVisible(true);
    void app.startRun(cfg);
  }

  app.showTitle = showTitle;
  app.hooks.onRunEnd = () => showTitle();
  showTitle();
  document.getElementById('game')!.dataset.ready = '1';
  (window as unknown as { __bb: unknown }).__bb = app;
}

void main();
