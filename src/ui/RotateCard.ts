/** RotateCard — full-screen portrait blocker. The game pauses until landscape. */

import { el, ICONS } from './dom.js';

export class RotateCard {
  readonly root = el('div', 'rotate-card hidden', '', { role: 'alertdialog', 'aria-label': 'Rotate your device' });

  constructor() {
    this.root.innerHTML = `<div class="rotate-icon">${ICONS.rotate}</div><div class="rotate-title">Rotate your device</div><div class="rotate-sub">BREAKBEAT plays in landscape.</div>`;
    document.body.appendChild(this.root);
  }

  /** True while the viewport is portrait (taller than wide). */
  static isPortrait(): boolean {
    return window.innerHeight > window.innerWidth;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}
