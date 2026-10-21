/**
 * EtudeScreen — the puzzle list, the in-run goal caption (name, goal, passes left, hint) and the
 * solved / out-of-passes banner.
 */

import data from '../../content/etudes.json';
import { EtudeRun, goalText, type EtudeDef } from '../meta/Etude.js';
import type { PulseEvent } from '../pulse/types.js';
import type { App } from './App.js';
import { announce, button, el, ICONS } from './dom.js';

export const ETUDES: readonly EtudeDef[] = (data as unknown as { etudes: EtudeDef[] }).etudes;

export class EtudeScreen {
  readonly list = el('div', 'sheet-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Etudes' });
  readonly caption = el('div', 'etude-caption hidden', '', { 'aria-live': 'polite' });
  readonly banner = el('div', 'etude-banner hidden', '', { role: 'alertdialog' });
  private run: EtudeRun | null = null;
  private index = 0;
  private lastLeft = -1;
  private resolved = false;
  private engineRef: unknown = null;

  constructor(
    private readonly app: App,
    private readonly prepare: () => void,
    private readonly onExit: () => void
  ) {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.list.classList.contains('hidden')) this.showList(false);
    });
  }

  get active(): boolean {
    return !!this.run;
  }

  showList(on: boolean): void {
    this.list.classList.toggle('hidden', !on);
    if (!on) return;
    const solved = this.app.save.etudes;
    const card = el('div', 'sheet etude-sheet');
    const head = el('div', 'settings-head');
    head.append(
      el('div', 'sheet-title', `ETUDES · ${solved.length}/${ETUDES.length}`),
      button('icon-btn settings-close', ICONS.close, 'Close etudes', () => this.showList(false))
    );
    const grid = el('div', 'etude-grid');
    ETUDES.forEach((et, i) => {
      const done = solved.includes(et.id);
      const open = i === 0 || solved.includes(ETUDES[i - 1]!.id) || done;
      const b = button(
        `etude-item${done ? ' done' : ''}${open ? '' : ' locked'}`,
        `<span class="et-num">${String(i + 1).padStart(2, '0')}${done ? ' ✓' : ''}</span><span class="et-name">${et.name}</span><small>${goalText(et.goal).toUpperCase()} · ${et.passes} PASS${et.passes === 1 ? '' : 'ES'}</small>`,
        `${et.name}. ${goalText(et.goal)} in ${et.passes} passes.${done ? ' Solved.' : ''}${open ? '' : ' Locked.'}`,
        () => {
          if (open) this.start(i);
        }
      );
      if (!open) b.setAttribute('aria-disabled', 'true');
      grid.appendChild(b);
    });
    card.append(head, grid);
    this.list.innerHTML = '';
    this.list.appendChild(card);
  }

  start(i: number): void {
    this.index = i;
    const def = ETUDES[i]!;
    this.showList(false);
    this.banner.classList.add('hidden');
    this.resolved = false;
    this.lastLeft = -1;
    this.run = new EtudeRun(def);
    this.caption.classList.remove('hidden');
    this.prepare();
    void this.app.startRun({ mode: 'etude', movement: i, etude: def });
  }

  onEvent(ev: PulseEvent): void {
    this.run?.onEvent(ev);
  }

  onFrame(): void {
    let run = this.run;
    const e = this.app.engine;
    if (!run || !e) return;
    if (e !== this.engineRef) {
      // A fresh engine (start, or Restart from the pause sheet) means a fresh attempt
      this.engineRef = e;
      run = this.run = new EtudeRun(run.def);
      this.resolved = false;
      this.lastLeft = -1;
      this.banner.classList.add('hidden');
    }
    if (this.resolved) return;
    const left = run.passesLeft(e);
    if (left !== this.lastLeft) {
      this.lastLeft = left;
      const d = run.def;
      this.caption.innerHTML = `<div class="et-cap-main">${d.name} · <span>${goalText(d.goal)}</span></div><div class="et-cap-sub">${left} PASS${left === 1 ? '' : 'ES'} LEFT · ${d.hint}</div>`;
    }
    const state = run.check(e);
    if (state === 'playing') return;
    this.resolved = true;
    const won = state === 'won';
    if (won && !this.app.save.etudes.includes(run.def.id)) {
      this.app.save.etudes.push(run.def.id);
      this.app.persistSave();
    }
    const next = this.index + 1 < ETUDES.length;
    this.banner.innerHTML = `<div class="eb-title">${won ? 'SOLVED' : 'OUT OF PASSES'}</div>`;
    const row = el('div', 'eb-actions');
    if (won && next) row.appendChild(button('btn btn-primary', 'Next etude', 'Next etude', () => this.start(this.index + 1)));
    row.appendChild(button(won ? 'btn' : 'btn btn-primary', 'Retry', 'Retry', () => this.start(this.index)));
    row.appendChild(button('btn btn-quiet', 'All etudes', 'All etudes', () => this.exit(true)));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    announce(won ? `Solved ${run.def.name}.` : 'Out of passes. Retry?');
  }

  /** Hides the etude UI without leaving the current screen. */
  clear(): void {
    this.run = null;
    this.banner.classList.add('hidden');
    this.caption.classList.add('hidden');
  }

  exit(openList: boolean): void {
    this.clear();
    this.onExit();
    if (openList) this.showList(true);
  }
}
