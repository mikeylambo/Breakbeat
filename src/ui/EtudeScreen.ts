/**
 * EtudeScreen — the puzzle list, the in-run goal caption (name, goal, passes left, hint) and the
 * solved / out-of-passes banner. Tutorial "Try it" drills run through here too, returning to the
 * tutorial when done.
 */

import data from '../../content/etudes.json';
import drillData from '../../content/drills.json';
import { readFlag, writeFlag } from '../platform/Storage.js';
import { EtudeRun, goalText, type EtudeDef } from '../meta/Etude.js';
import { decodeEtude, solutionOf, SHARED_SEED, verify, type SharedEtude } from '../meta/EtudeCode.js';
import { GemRules } from '../content/gems/GemRules.js';
import type { PulseEvent } from '../pulse/types.js';
import type { App } from './App.js';
import { announce, button, el, ICONS } from './dom.js';

export const ETUDES: readonly EtudeDef[] = (data as unknown as { etudes: EtudeDef[] }).etudes;
export const DRILLS: readonly EtudeDef[] = (drillData as unknown as { drills: EtudeDef[] }).drills;

const drillKey = (d: EtudeDef): string => `breakbeat-${d.id}`;
export const drillDone = (d: EtudeDef): boolean => readFlag(drillKey(d));

export class EtudeScreen {
  readonly list = el('div', 'sheet-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Etudes' });
  readonly caption = el('div', 'etude-caption hidden', '', { 'aria-live': 'polite' });
  readonly banner = el('div', 'etude-banner hidden', '', { role: 'alertdialog' });
  private run: EtudeRun | null = null;
  private index = 0;
  private lastLeft = -1;
  private resolved = false;
  private engineRef: unknown = null;
  /** Set while a tutorial drill runs: where "Back to tutorial" goes */
  private drillBack: (() => void) | null = null;
  private drill: EtudeDef | null = null;
  /** A player-made etude in play (editor test or shared link): banner labels and what a win does */
  private custom: { back: () => void; backLabel: string; onWin?: (bpm: number, solution: SharedEtude['solution']) => void } | null = null;
  /** An etude opened from a link, verified solvable, featured at the top of the list */
  shared: SharedEtude | null = null;
  /** Opens the editor (set by main) */
  onCreate: (() => void) | null = null;
  constructor(
    private readonly app: App,
    private readonly prepare: () => void,
    private readonly onExit: () => void
  ) {
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.list.classList.contains('hidden')) this.showList(false);
    });
  }

  /** A tutorial drill is running. */
  get drilling(): boolean {
    return !!this.drill;
  }

  /** Where the pause sheet's quit row goes while a drill or player-made etude runs. */
  get backLabel(): string {
    return this.custom?.backLabel ?? 'Back to tutorial';
  }

  /** Pause → back: leave the drill for the tutorial slide it came from. */
  leaveDrill(): void {
    const fn = this.drillBack;
    this.clear();
    fn?.();
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
      button('btn bt-btn et-create', 'Create', 'Make your own etude', () => {
        this.showList(false);
        this.onCreate?.();
      }),
      button('icon-btn settings-close', ICONS.close, 'Close etudes', () => this.showList(false))
    );
    const sharedRow = el('div', 'et-shared');
    const sh = this.shared;
    if (sh) {
      const d = sh.def;
      sharedRow.append(
        el('div', 'et-shared-copy', `<small>SHARED WITH YOU · SOLVABLE ✓</small><b>${d.name}</b><span>${goalText(d.goal)} · ${d.passes} PASS${d.passes === 1 ? '' : 'ES'}</span>`),
        button('btn btn-primary', `${ICONS.play}<span>Play</span>`, `Play ${d.name}`, () => this.playShared(sh))
      );
    } else {
      const input = el('input', 'ee-name et-code', '', { type: 'text', placeholder: 'Paste an etude link or code', 'aria-label': 'Etude link or code', spellcheck: 'false' }) as HTMLInputElement;
      const note = el('small', 'et-code-note');
      const go = (): void => {
        const raw = input.value.trim();
        const code = raw.includes('#e=') ? raw.slice(raw.indexOf('#e=') + 3) : raw;
        const r = EtudeScreen.open(code);
        if (typeof r === 'string') {
          note.textContent = r;
          return;
        }
        this.shared = r;
        this.showList(true);
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') go();
        e.stopPropagation();
      });
      sharedRow.append(input, button('btn bt-btn', 'Open', 'Open the etude', go), note);
    }
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
    card.append(head, sharedRow, grid);
    this.list.innerHTML = '';
    this.list.appendChild(card);
  }

  /** Decodes and verifies a shared code: the etude, or a reason it cannot be played. */
  static open(code: string): SharedEtude | string {
    try {
      const e = decodeEtude(code);
      return verify(e, new GemRules('brick')) ? e : 'That etude could not be verified as solvable.';
    } catch (err) {
      return err instanceof Error ? err.message : 'That is not an etude code.';
    }
  }

  /** Plays a player-made etude; a win hands its inputs to `onWin` (the editor's solve). */
  playCustom(def: EtudeDef, back: () => void, backLabel: string, onWin?: (bpm: number, solution: SharedEtude['solution']) => void): void {
    this.drill = def;
    this.drillBack = back;
    this.custom = { back, backLabel, onWin };
    this.launch(def, 0);
  }

  private playShared(sh: SharedEtude): void {
    this.playCustom(sh.def, () => this.exit(true), 'All etudes');
  }

  start(i: number): void {
    this.index = i;
    this.drill = null;
    this.drillBack = null;
    this.custom = null;
    this.launch(ETUDES[i]!, i);
  }

  /** Runs a tutorial drill; `back` returns to the tutorial. */
  startDrill(def: EtudeDef, back: () => void): void {
    this.drill = def;
    this.drillBack = back;
    this.custom = null;
    this.launch(def, 0);
  }

  private launch(def: EtudeDef, i: number): void {
    this.showList(false);
    this.banner.classList.add('hidden');
    this.resolved = false;
    this.lastLeft = -1;
    this.run = new EtudeRun(def);
    this.caption.classList.remove('hidden');
    this.prepare();
    // Drills use a fixed seed so their incoming rows match the ETUDES gate's proof
    void this.app.startRun({ mode: 'etude', movement: i, etude: def, seed: this.drill ? SHARED_SEED : undefined });
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
      this.caption.innerHTML = `<div class="et-cap-main">${this.custom ? 'YOUR ETUDE · ' : this.drill ? 'TRY IT · ' : ''}${d.name} · <span>${goalText(d.goal)}</span></div><div class="et-cap-sub">${left} PASS${left === 1 ? '' : 'ES'} LEFT · ${d.hint}</div>`;
    }
    const state = run.check(e);
    if (state === 'playing') return;
    this.resolved = true;
    const won = state === 'won';
    if (this.drill) {
      this.drillBanner(won);
      return;
    }
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

  private drillBanner(won: boolean): void {
    const d = this.drill!;
    const c = this.custom;
    if (c) return this.customBanner(won, d, c);
    if (won) writeFlag(drillKey(d), true);
    const back = (): void => {
      const fn = this.drillBack;
      this.clear();
      fn?.();
    };
    this.banner.innerHTML = `<div class="eb-title">${won ? 'NICE' : 'TRY AGAIN'}</div><div class="eb-sub">${won ? 'You\u2019ve got it.' : d.hint}</div>`;
    const row = el('div', 'eb-actions');
    const primary = won ? button('btn btn-primary', 'Back to tutorial', 'Back to tutorial', back) : button('btn btn-primary', 'Retry', 'Retry', () => this.startDrill(d, this.drillBack!));
    row.append(primary, won ? button('btn', 'Again', 'Play the drill again', () => this.startDrill(d, this.drillBack!)) : button('btn btn-quiet', 'Back to tutorial', 'Back to tutorial', back));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    primary.focus({ preventScroll: true });
    announce(won ? `Nice. ${d.name} done.` : `Try again. ${d.hint}`);
  }

  private customBanner(won: boolean, d: EtudeDef, c: NonNullable<EtudeScreen['custom']>): void {
    const e = this.app.engine;
    if (won && c.onWin && e) c.onWin(e.initial.bpm, solutionOf(e));
    const back = (): void => {
      this.clear();
      c.back();
    };
    this.banner.innerHTML = `<div class="eb-title">${won ? 'SOLVED' : 'OUT OF PASSES'}</div><div class="eb-sub">${won ? (c.onWin ? 'Your solve is saved: it can be shared now.' : `${d.name} solved.`) : d.hint}</div>`;
    const row = el('div', 'eb-actions');
    const retry = (): void => this.playCustom(d, c.back, c.backLabel, c.onWin);
    const primary = won ? button('btn btn-primary', c.backLabel, c.backLabel, back) : button('btn btn-primary', 'Retry', 'Retry', retry);
    row.append(primary, won ? button('btn', 'Again', 'Play it again', retry) : button('btn btn-quiet', c.backLabel, c.backLabel, back));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    primary.focus({ preventScroll: true });
    announce(won ? `Solved ${d.name}.` : `Out of passes. ${d.hint}`);
  }

  /** Hides the etude UI without leaving the current screen. */
  clear(): void {
    if (this.banner.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.run = null;
    this.drill = null;
    this.drillBack = null;
    this.custom = null;
    this.banner.classList.add('hidden');
    this.caption.classList.add('hidden');
  }

  exit(openList: boolean): void {
    this.clear();
    this.onExit();
    if (openList) this.showList(true);
  }
}
