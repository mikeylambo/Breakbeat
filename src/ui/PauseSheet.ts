/**
 * PauseSheet — the run freezes under a dark wash; a menu (Resume, Restart, Settings, Quit to title)
 * slides in from the left with the movement and score above it. Opening it suspends audio.
 */

import { t } from '../i18n/i18n.js';
import { el, setText } from './dom.js';
import { MenuList } from './MenuList.js';

export interface PauseActions {
  resume(): void;
  restart(): void;
  settings(): void;
  quit(): void;
  /** What is paused: movement line and current score */
  info(): { title: string; score: string; quit: string };
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
      row('resume', t('pause.resume'), a.resume, 'btn-primary'),
      row('restart', t('pause.restart'), a.restart),
      row('settings', t('pause.settings'), a.settings),
      row('quit', t('pause.quit'), a.quit, 'quiet')
    ]);
    card.append(el('div', 'pause-title', t('pause.title')), this.what, this.score, this.menu.root, el('div', 'pause-keys', `<b>ESC</b>${t('pause.keyResume')}`));
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
    const q = this.root.querySelector('.menu-item.quiet .mi-name');
    if (q) setText(q as HTMLElement, i.quit);
    this.menu.select(0, true);
    this.menu.relayout();
  }
}
