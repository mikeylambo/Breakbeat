/**
 * PauseSheet — the run freezes under a dark wash; a menu (Resume, Restart, Settings, Quit to title)
 * slides in from the left with the movement and score above it. Opening it suspends audio.
 */

import { el, setText } from './dom.js';
import { MenuList } from './MenuList.js';

export interface PauseActions {
  resume(): void;
  restart(): void;
  settings(): void;
  quit(): void;
  /** What is paused: movement line and current score */
  info(): { title: string; score: string };
}

export class PauseSheet {
  readonly root = el('div', 'sheet-scrim pause-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' });
  private readonly menu: MenuList;
  private readonly what = el('div', 'pause-what');
  private readonly score = el('div', 'pause-score');
  open = false;

  constructor(private readonly a: PauseActions) {
    const card = el('div', 'pause-sheet');
    this.menu = new MenuList({ cls: 'pause-menu', active: () => this.open });
    const row = (id: string, name: string, action: () => void, cls = ''): { id: string; label: string; cls: string; action: () => void; html: string } => ({
      id,
      label: name,
      cls,
      action,
      html: `<span class="mi-name">${name}</span>`
    });
    this.menu.setItems([
      row('resume', 'Resume', a.resume, 'btn-primary'),
      row('restart', 'Restart', a.restart),
      row('settings', 'Settings', a.settings),
      row('quit', 'Quit to title', a.quit, 'quiet')
    ]);
    card.append(el('div', 'pause-title', 'PAUSED'), this.what, this.score, this.menu.root, el('div', 'pause-keys', '<b>ESC</b>RESUME'));
    this.root.appendChild(card);
  }

  show(on: boolean): void {
    const was = this.open;
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (!on || was) return;
    const i = this.a.info();
    setText(this.what, i.title);
    setText(this.score, i.score);
    this.menu.select(0, true);
    this.menu.relayout();
  }
}
