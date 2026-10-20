/** PauseSheet — Resume, Restart, Settings, Quit to title. Opening it suspends audio. */

import { button, el } from './dom.js';

export interface PauseActions {
  resume(): void;
  restart(): void;
  settings(): void;
  quit(): void;
}

export class PauseSheet {
  readonly root = el('div', 'sheet-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' });
  private readonly resumeBtn: HTMLButtonElement;
  open = false;

  constructor(a: PauseActions) {
    const card = el('div', 'sheet pause-sheet');
    card.appendChild(el('div', 'sheet-title', 'PAUSED'));
    this.resumeBtn = button('btn btn-primary', 'Resume', 'Resume', a.resume);
    card.append(
      this.resumeBtn,
      button('btn', 'Restart', 'Restart', a.restart),
      button('btn', 'Settings', 'Settings', a.settings),
      button('btn btn-quiet', 'Quit to title', 'Quit to title', a.quit)
    );
    this.root.appendChild(card);
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on && document.activeElement && document.activeElement !== document.body) this.resumeBtn.focus({ preventScroll: true });
  }
}
