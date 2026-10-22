/**
 * SplashScreen — the title card. A tilted BREAKBEAT logo over a slow sunburst and the wall strip,
 * "Press any key" in the corner. The press is the gesture browsers need before audio may play, so
 * the music lands exactly as the main menu appears.
 */

import { el } from './dom.js';

export class SplashScreen {
  readonly root = el('div', 'splash hidden', '', { role: 'main', 'aria-label': 'Breakbeat. Press any key to start.' });
  private readonly prompt = el('div', 'splash-press', '', { 'aria-hidden': 'true' });
  private armed = false;

  constructor(private readonly onStart: () => void) {
    this.root.innerHTML = SPLASH_HTML;
    this.root.querySelector('.splash-press')!.replaceWith(this.prompt);
    this.prompt.textContent = matchMedia('(hover: none)').matches ? 'TAP TO START' : 'PRESS ANY KEY';
    window.addEventListener('keydown', e => {
      if (!this.armed || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'f' || e.key === 'F') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.start();
    });
    this.root.addEventListener('pointerdown', e => {
      if (!this.armed || e.button > 0) return;
      e.preventDefault();
      this.start();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    this.root.classList.remove('go');
    // A beat of grace so a held key from the previous screen doesn't skip straight through
    this.armed = false;
    if (on) setTimeout(() => (this.armed = this.visible), 250);
  }

  private start(): void {
    this.armed = false;
    this.root.classList.add('go');
    this.onStart();
  }
}

/** Shared with src/index.html's boot markup (keep in sync) so the first paint is the real title. */
export const SPLASH_HTML = `<div class="splash-burst" aria-hidden="true"></div><div class="splash-dots" aria-hidden="true"></div><div class="splash-logo"><h1 class="splash-word"><span class="w-break">BREAK</span><span class="w-beat">BEAT</span></h1><div class="splash-stripe"><span>VOL. 01</span><span>THE ODYSSEY</span></div></div><div class="splash-press"></div><div class="splash-foot">19 MOVEMENTS · 3 ACTS + CODA</div>`;
