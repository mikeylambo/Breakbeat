/**
 * EtudeScreen — the puzzle list, the in-run goal caption (name, goal, passes left, hint) and the
 * solved / out-of-passes banner. Tutorial "Try it" drills run through here too, returning to the
 * tutorial when done.
 */

import { t, tn, tx } from '../i18n/i18n.js';
import data from '../../content/etudes.json';
import drillData from '../../content/drills.json';
import { readFlag, writeFlag } from '../platform/Storage.js';
import { etudeHint, etudeName, EtudeRun, goalText, type EtudeDef } from '../meta/Etude.js';
export { etudeName };
import { decodeEtude, solutionOf, SHARED_SEED, verify, type SharedEtude } from '../meta/EtudeCode.js';
import { GemRules } from '../content/gems/GemRules.js';
import type { PulseEvent } from '../pulse/types.js';
import type { App } from './App.js';
import { announce, button, el, ICONS } from './dom.js';

export const ETUDES: readonly EtudeDef[] = (data as unknown as { etudes: EtudeDef[] }).etudes;
export const DRILLS: readonly EtudeDef[] = (drillData as unknown as { drills: EtudeDef[] }).drills;

const drillKey = (d: EtudeDef): string => `breakbeat-${d.id}`;
export const drillDone = (d: EtudeDef): boolean => readFlag(drillKey(d));


/** Decode failures (EtudeCode throws English) in the current language. */
const CODE_ERRORS: Record<string, string> = {
  'That etude code is incomplete.': 'et.err.incomplete',
  'That etude code is damaged.': 'et.err.damaged',
  'That etude was made by a newer version.': 'et.err.newer',
  'That etude has impossible rules.': 'et.err.rules',
  'That etude has no wall.': 'et.err.noWall'
};

export class EtudeScreen {
  readonly list = el('div', 'sheet-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title.etudes') });
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
    return this.custom?.backLabel ?? t('pause.backTutorial');
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
      el('div', 'sheet-title', `${t('title.etudes').toUpperCase()} · ${solved.length}/${ETUDES.length}`),
      button('btn bt-btn et-create', t('et.create'), t('et.createAria'), () => {
        this.showList(false);
        this.onCreate?.();
      }),
      button('icon-btn settings-close', ICONS.close, t('et.close'), () => this.showList(false))
    );
    const sharedRow = el('div', 'et-shared');
    const sh = this.shared;
    if (sh) {
      const d = sh.def;
      sharedRow.append(
        el('div', 'et-shared-copy', `<small>${t('et.sharedTag')}</small><b>${d.name}</b><span>${goalText(d.goal)} · ${tn('et.passes', d.passes)}</span>`),
        button('btn btn-primary', `${ICONS.play}<span>${t('title.play')}</span>`, t('et.playAria', { name: d.name }), () => this.playShared(sh))
      );
    } else {
      const input = el('input', 'ee-name et-code', '', { type: 'text', placeholder: t('et.paste'), 'aria-label': t('et.pasteAria'), spellcheck: 'false' }) as HTMLInputElement;
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
      sharedRow.append(input, button('btn bt-btn', t('et.open'), t('et.openAria'), go), note);
    }
    const grid = el('div', 'etude-grid');
    ETUDES.forEach((et, i) => {
      const done = solved.includes(et.id);
      const open = i === 0 || solved.includes(ETUDES[i - 1]!.id) || done;
      const b = button(
        `etude-item${done ? ' done' : ''}${open ? '' : ' locked'}`,
        `<span class="et-num">${String(i + 1).padStart(2, '0')}${done ? ' ✓' : ''}</span><span class="et-name">${etudeName(et)}</span><small>${goalText(et.goal).toUpperCase()} · ${tn('et.passes', et.passes).toUpperCase()}</small>`,
        `${etudeName(et)}. ${goalText(et.goal)} · ${tn('et.passes', et.passes)}.${done ? ` ${t('et.solvedAria')}` : ''}${open ? '' : ` ${t('et.lockedAria')}`}`,
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
      return verify(e, new GemRules('brick')) ? e : t('et.err.unsolvable');
    } catch (err) {
      const key = err instanceof Error ? CODE_ERRORS[err.message] : undefined;
      return key ? tx(key, key) : t('et.err.notCode');
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
    this.playCustom(sh.def, () => this.exit(true), t('et.all'));
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
      this.caption.innerHTML = `<div class="et-cap-main">${this.custom ? `${t('et.yours')} · ` : this.drill ? `${t('tut.tryTag')} · ` : ''}${etudeName(d)} · <span>${goalText(d.goal)}</span></div><div class="et-cap-sub">${tn('et.left', left)} · ${etudeHint(d)}</div>`;
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
    this.banner.innerHTML = `<div class="eb-title">${won ? t('et.solved') : t('et.out')}</div>`;
    const row = el('div', 'eb-actions');
    if (won && next) row.appendChild(button('btn btn-primary', t('et.next'), t('et.next'), () => this.start(this.index + 1)));
    row.appendChild(button(won ? 'btn' : 'btn btn-primary', t('et.retry'), t('et.retry'), () => this.start(this.index)));
    row.appendChild(button('btn btn-quiet', t('et.all'), t('et.all'), () => this.exit(true)));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    announce(won ? t('et.saySolved', { name: etudeName(run.def) }) : t('et.sayOut'));
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
    this.banner.innerHTML = `<div class="eb-title">${won ? t('et.nice') : t('et.tryAgain')}</div><div class="eb-sub">${won ? t('et.gotIt') : etudeHint(d)}</div>`;
    const row = el('div', 'eb-actions');
    const primary = won ? button('btn btn-primary', t('pause.backTutorial'), t('pause.backTutorial'), back) : button('btn btn-primary', t('et.retry'), t('et.retry'), () => this.startDrill(d, this.drillBack!));
    row.append(primary, won ? button('btn', t('et.again'), t('et.againDrill'), () => this.startDrill(d, this.drillBack!)) : button('btn btn-quiet', t('pause.backTutorial'), t('pause.backTutorial'), back));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    primary.focus({ preventScroll: true });
    announce(won ? t('et.sayNice', { name: etudeName(d) }) : `${t('et.tryAgainSay')} ${etudeHint(d)}`);
  }

  private customBanner(won: boolean, d: EtudeDef, c: NonNullable<EtudeScreen['custom']>): void {
    const e = this.app.engine;
    if (won && c.onWin && e) c.onWin(e.initial.bpm, solutionOf(e));
    const back = (): void => {
      this.clear();
      c.back();
    };
    this.banner.innerHTML = `<div class="eb-title">${won ? t('et.solved') : t('et.out')}</div><div class="eb-sub">${won ? (c.onWin ? t('et.solveSaved') : t('et.nameSolved', { name: d.name })) : d.hint}</div>`;
    const row = el('div', 'eb-actions');
    const retry = (): void => this.playCustom(d, c.back, c.backLabel, c.onWin);
    const primary = won ? button('btn btn-primary', c.backLabel, c.backLabel, back) : button('btn btn-primary', t('et.retry'), t('et.retry'), retry);
    row.append(primary, won ? button('btn', t('et.again'), t('et.againAria'), retry) : button('btn btn-quiet', c.backLabel, c.backLabel, back));
    this.banner.appendChild(row);
    this.banner.classList.remove('hidden');
    primary.focus({ preventScroll: true });
    announce(won ? t('et.saySolved', { name: d.name }) : `${t('et.sayOutShort')} ${d.hint}`);
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
