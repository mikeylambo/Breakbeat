/**
 * EtudeEditor — build an Etude, solve it, share it as a link.
 * Left: the wall (16 x 10). Paint with a colour (1–4) or erase (E); tiles settle to the floor like
 * the real wall. Right: name, goal, passes, a starting hold, a rising wall. Test plays it; solving
 * it is what unlocks Share, and the link carries your solve so every receiver knows it can be done.
 * Any edit after a solve asks for a fresh one. The draft is kept on this device.
 */

import { t, tn, tx } from '../i18n/i18n.js';
import { encodeEtude, solutionOf, type SharedEtude } from '../meta/EtudeCode.js';
import { goalText, type EtudeDef, type EtudeGoal } from '../meta/Etude.js';
import { cleanName } from '../meta/text.js';
import { readJson, writeJson } from '../platform/Storage.js';
import { TILE_COLOURS, hex } from '../render/palette.js';
import { TUNING } from '../tuning.js';
import type { App } from './App.js';
import { announce, button, el, ICONS, uiSound } from './dom.js';

const KEY = 'breakbeat-etude-draft';
const COLS = TUNING.BOARD_COLS;
const ROWS = TUNING.BOARD_ROWS;
const GOALS: readonly EtudeGoal['type'][] = ['allclear', 'groups', 'air', 'chain', 'overcharge', 'score', 'survive'];
const DEFAULT_VALUE: Record<EtudeGoal['type'], number> = { allclear: 0, groups: 2, air: 1, chain: 2, overcharge: 1, score: 1000, survive: 2 };

interface Draft {
  name: string;
  hint: string;
  goal: EtudeGoal;
  passes: number;
  charge: number;
  pressure: number;
  /** ROWS x COLS, -1 empty */
  cells: number[][];
  /** Set by a solve; cleared by any edit */
  solved: { bpm: number; solution: SharedEtude['solution'] } | null;
}

function blank(): Draft {
  const cells = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(-1));
  // A starter wall: two rows to play with
  const seed = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 2, 3, 3, 2, 1, 0];
  for (let c = 0; c < COLS; c++) {
    cells[ROWS - 1]![c] = seed[c]!;
    cells[ROWS - 2]![c] = seed[(c + 5) % COLS]!;
  }
  return { name: t('ee.defaultName'), hint: '', goal: { type: 'allclear' }, passes: 2, charge: 0, pressure: 0, cells, solved: null };
}

export interface EditorActions {
  /** Play the draft; `onWin` gets the solving engine's inputs, `back` returns here. */
  test(def: EtudeDef, onWin: (bpm: number, solution: SharedEtude['solution']) => void, back: () => void): void;
  back(): void;
}

export class EtudeEditor {
  readonly root = el('div', 'etude-editor hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('ee.aria') });
  private draft: Draft;
  private brush = 0;
  private painting = false;
  private readonly cellEls: HTMLElement[] = [];
  private readonly grid = el('div', 'ee-grid', '', { role: 'grid', 'aria-label': t('ee.wall') });
  private readonly side = el('section', 'ee-side');
  private readonly status = el('div', 'ee-status', '', { 'aria-live': 'polite' });

  constructor(
    private readonly app: App,
    private readonly a: EditorActions
  ) {
    this.draft = { ...blank(), ...readJson<Partial<Draft>>(KEY, {}) } as Draft;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const cell = el('button', 'ee-cell', '', { type: 'button', 'aria-label': t('ee.cell', { c: c + 1, r: ROWS - r }) });
        cell.addEventListener('pointerdown', e => {
          e.preventDefault();
          this.painting = true;
          this.paint(c);
        });
        cell.addEventListener('pointerenter', () => {
          if (this.painting) this.paint(c);
        });
        this.cellEls.push(cell);
        this.grid.appendChild(cell);
      }
    window.addEventListener('pointerup', () => (this.painting = false));
    window.addEventListener('keydown', this.onKey);
    const left = el('section', 'ee-left');
    left.append(el('h2', 'sl-title', t('ee.title')), this.grid, this.palette());
    this.root.append(left, this.side);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.render();
    announce(t('ee.sayOpen'));
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  // ---------------------------------------------------------------- wall

  private palette(): HTMLElement {
    const p = el('div', 'ee-palette', '', { role: 'radiogroup', 'aria-label': t('ee.brush') });
    const brushes = [...TILE_COLOURS.slice(0, 4).map((c, i) => [i, tx(`colour.${c.name.toLowerCase()}`, c.name)] as const), [-1, t('ee.erase')] as const];
    for (const [v, name] of brushes) {
      const b = button(`ee-brush${v === this.brush ? ' on' : ''}`, v < 0 ? '×' : String(v + 1), t('ee.brushAria', { name }), () => this.setBrush(v));
      if (v >= 0) b.style.setProperty('--c', hex(TILE_COLOURS[v]!.base));
      b.setAttribute('role', 'radio');
      p.appendChild(b);
    }
    return p;
  }

  private setBrush(v: number): void {
    this.brush = v;
    uiSound('tick', Math.max(0, v));
    this.root.querySelectorAll('.ee-brush').forEach((b, i) => {
      const on = (i < 4 ? i : -1) === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  /** Paints the column's next free cell (erase removes the top tile); tiles settle to the floor. */
  private paint(col: number): void {
    const d = this.draft;
    const stack = d.cells.map(r => r[col]!).filter(k => k >= 0);
    if (this.brush < 0) stack.shift();
    else if (stack.length < ROWS - 1) stack.unshift(this.brush);
    else return;
    for (let r = 0; r < ROWS; r++) d.cells[r]![col] = r < ROWS - stack.length ? -1 : stack[r - (ROWS - stack.length)]!;
    uiSound('tick', Math.max(0, this.brush));
    this.edited();
  }

  private renderGrid(): void {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = this.draft.cells[r]![c]!;
        const e = this.cellEls[r * COLS + c]!;
        e.classList.toggle('on', k >= 0);
        e.style.setProperty('--c', k >= 0 ? hex(TILE_COLOURS[k]!.base) : 'transparent');
      }
  }

  // ---------------------------------------------------------------- rules

  private render(): void {
    this.renderGrid();
    const d = this.draft;
    this.side.innerHTML = '';
    const name = el('input', 'ee-name', '', { type: 'text', maxlength: '24', 'aria-label': t('ee.name'), spellcheck: 'false' }) as HTMLInputElement;
    name.value = d.name;
    name.addEventListener('input', () => {
      d.name = name.value;
      this.edited(false);
    });
    const hint = el('input', 'ee-name ee-hint', '', { type: 'text', maxlength: '60', placeholder: t('ee.hintPh'), 'aria-label': t('ee.hint'), spellcheck: 'false' }) as HTMLInputElement;
    hint.value = d.hint;
    hint.addEventListener('input', () => {
      d.hint = hint.value;
      this.edited(false);
    });
    const row = (label: string, value: string, ...btns: HTMLButtonElement[]): HTMLElement => {
      const r = el('div', 'bt-row');
      const g = el('div', 'bt-btns');
      g.append(...btns);
      r.append(el('div', 'bt-val', `<small>${label}</small><b>${value}</b>`), g);
      return r;
    };
    const b = (html: string, label: string, fn: () => void): HTMLButtonElement =>
      button('ls-btn', html, label, () => {
        fn();
        uiSound('tick', 1);
        this.edited();
      });
    const valued = d.goal.type !== 'allclear';
    const step = d.goal.type === 'score' ? 250 : 1;
    this.side.append(
      el('div', 'sld-kicker', t('et.yours')),
      name,
      hint,
      row(
        t('ee.goal'),
        goalText(d.goal),
        b('◀', t('ee.prevGoal'), () => this.cycleGoal(-1)),
        b('▶', t('ee.nextGoal'), () => this.cycleGoal(1)),
        ...(valued ? [b('−', t('ee.less'), () => (d.goal.value = Math.max(1, (d.goal.value ?? 1) - step))), b('+', t('ee.more'), () => (d.goal.value = Math.min(d.goal.type === 'score' ? 60000 : 12, (d.goal.value ?? 1) + step)))] : [])
      ),
      row(t('ee.passes'), String(d.passes), b('−', t('ee.fewerPasses'), () => (d.passes = Math.max(1, d.passes - 1))), b('+', t('ee.morePasses'), () => (d.passes = Math.min(8, d.passes + 1)))),
      row(t('ee.startHold'), d.charge ? t('ee.yes') : t('ee.no'), b(d.charge ? t('ee.on') : t('ee.off'), t('ee.holdAria'), () => (d.charge = d.charge ? 0 : 1))),
      row(t('ee.rising'), d.pressure ? tn('ee.every', d.pressure) : t('ee.off'), b(d.pressure ? t('ee.on') : t('ee.off'), t('ee.risingAria'), () => (d.pressure = d.pressure === 0 ? 2 : d.pressure === 2 ? 1 : 0)))
    );
    const act = el('div', 'bt-actions');
    act.append(
      button('btn btn-primary sld-play', `${ICONS.play}<span>${d.solved ? t('ee.solveAgain') : t('ee.test')}</span>`, t('ee.test'), () => this.test()),
      button(`btn bt-btn${d.solved ? ' ee-share-ready' : ''}`, t('ee.share'), d.solved ? t('ee.shareAria') : t('ee.shareLocked'), () => void this.share()),
      button('btn bt-btn', t('profile.clear'), t('ee.clearAria'), () => {
        d.cells = blank().cells.map(r => r.fill(-1));
        this.edited();
      }),
      button('btn bt-btn', t('ee.back'), t('ee.backAria'), () => {
        this.hide();
        this.a.back();
      })
    );
    this.side.append(act, this.status);
    this.setStatus(d.solved ? t('ee.ready') : t('ee.unlock'));
  }

  private cycleGoal(dir: number): void {
    const d = this.draft;
    const i = (GOALS.indexOf(d.goal.type) + dir + GOALS.length) % GOALS.length;
    const type = GOALS[i]!;
    d.goal = type === 'allclear' ? { type } : { type, value: DEFAULT_VALUE[type] };
    if (type === 'survive' && !d.pressure) d.pressure = 2;
  }

  /** Any change voids the solve (re-renders unless typing in a field). */
  private edited(rerender = true): void {
    this.draft.solved = null;
    writeJson(KEY, this.draft);
    if (rerender) this.render();
    else this.setStatus(t('ee.unlock'));
  }

  private setStatus(s: string): void {
    this.status.textContent = s;
  }

  def(): EtudeDef {
    const d = this.draft;
    const def: EtudeDef = {
      id: 'draft',
      name: cleanName(d.name, t('ee.defaultName')).slice(0, 24),
      hint: cleanName(d.hint, '').slice(0, 60) || t('ee.madeByYou'),
      goal: d.goal,
      passes: d.passes,
      board: d.cells.map(r => [...r]),
      solution: []
    };
    if (d.charge) def.charge = d.charge;
    if (d.pressure) def.pressure = d.pressure;
    return def;
  }

  private test(): void {
    if (!this.draft.cells.some(r => r.some(k => k >= 0))) {
      uiSound('deny');
      this.setStatus(t('ee.paintFirst'));
      return;
    }
    this.hide();
    this.a.test(
      this.def(),
      (bpm, solution) => {
        this.draft.solved = { bpm, solution };
        writeJson(KEY, this.draft);
      },
      () => this.open()
    );
  }

  private async share(): Promise<void> {
    const d = this.draft;
    if (!d.solved) {
      uiSound('deny');
      this.setStatus(t('ee.solveFirst'));
      return;
    }
    const code = encodeEtude({ def: this.def(), bpm: d.solved.bpm, solution: d.solved.solution });
    const url = `${location.origin}${location.pathname}#e=${code}`;
    const text = t('ee.shareText', { name: this.def().name, goal: goalText(d.goal), passes: tn('et.passes', d.passes) });
    try {
      if (navigator.share) await navigator.share({ title: t('ee.shareTitle'), text, url });
      else {
        await navigator.clipboard.writeText(url);
        this.setStatus(t('ee.copied'));
      }
      uiSound('pick');
      this.app.achieve('etude-shared');
    } catch {
      this.setStatus(url);
    }
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.visible || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key >= '1' && e.key <= '4') this.setBrush(Number(e.key) - 1);
    else if (e.key === 'e' || e.key === 'E' || e.key === '0') this.setBrush(-1);
    else if (e.key === 'Escape') {
      this.hide();
      this.a.back();
    } else return;
    e.preventDefault();
  };
}

/** For callers that captured a solving engine. */
export { solutionOf };
