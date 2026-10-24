/**
 * DeskPanels — desktop/tablet layout. When the letterbox leaves real bars above and below the
 * stage, they carry an act/movement progress strip (top) and live run stats + controls (bottom).
 * Updated a few times per second, DOM only on change.
 */

import { t as tr } from '../i18n/i18n.js';
import { MOVEMENTS } from '../audio/tracks.js';
import { el, fmt, setText } from './dom.js';
import type { StageLayout } from '../render/layout.js';

export interface DeskValues {
  act: string;
  movementIndex: number;
  label: string;
  progress: number;
  best: number;
  groups: number;
  bestPass: number;
  allClears: number;
  overcharges: number;
  airPrimes: number;
}

export class DeskPanels {
  readonly top = el('div', 'desk desk-top hidden', '', { 'aria-hidden': 'true' });
  readonly bottom = el('div', 'desk desk-bottom hidden', '', { 'aria-hidden': 'true' });
  private readonly label = el('div', 'desk-label');
  private readonly track = el('div', 'desk-track');
  private readonly best = el('div', 'desk-best');
  private readonly stats = el('div', 'desk-stats');
  private readonly keys = el('div', 'desk-keys', '<b>Click</b> prime · <b>Hold</b> overcharge · <b>Esc</b> pause · <b>V</b> hide HUD · <b>F</b> fullscreen');
  private readonly statEls: HTMLElement[] = [];
  private roomy = false;
  private inRun = false;
  private lastAct = '';
  private lastIdx = -2;

  constructor(host: HTMLElement) {
    this.top.append(this.label, this.track, this.best);
    for (const name of [tr('profile.groups'), tr('profile.bestPass'), tr('profile.allClears'), tr('profile.overcharges'), tr('profile.airPrimes')]) {
      const v = el('span', 'ds-v', '0');
      this.statEls.push(v);
      const s = el('div', 'ds');
      s.append(v, el('span', 'ds-l', name));
      this.stats.appendChild(s);
    }
    this.bottom.append(this.stats, this.keys);
    host.append(this.top, this.bottom);
  }

  layout(l: StageLayout): void {
    // Only when the bars are tall enough to read comfortably
    this.roomy = l.y >= 56 && l.width >= 760;
    const w = 844 * l.scale;
    const k = Math.min(1.6, Math.max(1.1, l.scale * 0.85));
    for (const p of [this.top, this.bottom]) {
      p.style.left = `${l.x}px`;
      p.style.width = `${w}px`;
      p.style.height = `${l.y}px`;
      p.style.setProperty('--k', String(k));
    }
    this.apply();
  }

  setRun(on: boolean): void {
    this.inRun = on;
    this.apply();
  }

  private apply(): void {
    const show = this.roomy && this.inRun;
    this.top.classList.toggle('hidden', !show);
    this.bottom.classList.toggle('hidden', !show);
    document.documentElement.classList.toggle('desk-roomy', this.roomy);
  }

  update(v: DeskValues): void {
    if (!this.inRun || !this.roomy) return;
    setText(this.label, v.label);
    if (v.act !== this.lastAct || v.movementIndex !== this.lastIdx) {
      this.lastAct = v.act;
      this.lastIdx = v.movementIndex;
      this.track.innerHTML = '';
      MOVEMENTS.forEach((m, i) => {
        if (m.act !== v.act) return;
        const seg = el('span', `dt-seg${i < v.movementIndex ? ' done' : i === v.movementIndex ? ' now' : ''}`);
        seg.appendChild(el('i'));
        seg.title = m.name;
        this.track.appendChild(seg);
      });
    }
    const now = this.track.querySelector('.dt-seg.now i') as HTMLElement | null;
    if (now) now.style.transform = `scaleX(${Math.max(0, Math.min(1, v.progress))})`;
    setText(this.best, v.best > 0 ? tr('board.best', { n: fmt(v.best) }) : '');
    const vals = [v.groups, v.bestPass, v.allClears, v.overcharges, v.airPrimes];
    vals.forEach((n, i) => setText(this.statEls[i]!, fmt(n)));
  }
}
