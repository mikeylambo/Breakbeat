/** BREAKBEAT v0.6 entry. */

import { App } from './ui/App.js';

const app = new App();
void app.init().then(() => {
  // Step 7 harness: tap to start Movement 01 (the title screen arrives in step 8)
  const start = (): void => {
    window.removeEventListener('pointerdown', start);
    void app.startRun({ mode: 'odyssey', movement: 0 });
  };
  window.addEventListener('pointerdown', start);
  app.hooks.onRunEnd = () => void app.startRun({ mode: 'odyssey', movement: 0 });
  (window as unknown as { __bb: App }).__bb = app;
});
