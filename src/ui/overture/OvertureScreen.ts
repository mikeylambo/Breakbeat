/**
 * OvertureScreen — presentation for the Overture: stem chips in the left column (KICK lit;
 * BASS, KEYS, LEAD outlined until unlocked), one centred caption in the empty upper wall,
 * pulsing thumb rings on target groups, the lesson-3 blast preview, and an always-visible Skip.
 */

import overtureData from '../../../content/overture.json';
import { TUNING } from '../../tuning.js';
import type { App } from '../App.js';
import { WallView } from '../../render/WallView.js';
import { button, el } from '../dom.js';
import { OvertureLessons, type OvertureData } from './OvertureLessons.js';
import type { PulseEvent } from '../../pulse/types.js';

const STEMS = ['KICK', 'BASS', 'KEYS', 'LEAD'];

export class OvertureScreen {
  readonly root = el('div', 'overture hidden', '', { 'aria-label': 'Overture' });
  private readonly chips: HTMLElement[] = [];
  private readonly caption = el('div', 'overture-caption', '', { 'aria-live': 'polite' });
  private lessons: OvertureLessons | null = null;
  private shownLesson = -1;
  private layers = 1;
  private readonly pt = { x: 0, y: 0 };

  constructor(
    private readonly app: App,
    private readonly onSkip: () => void,
    private readonly onDone: () => void
  ) {
    const col = el('div', 'stem-chips', '', { 'aria-label': 'Stems' });
    STEMS.forEach((s, i) => {
      const c = el('div', `stem-chip${i === 0 ? ' on' : ''}`, s);
      this.chips.push(c);
      col.appendChild(c);
    });
    const skip = button('btn-skip', 'Skip', 'Skip the Overture', () => this.skip());
    this.root.append(col, this.caption, skip);
  }

  get active(): boolean {
    return !!this.lessons && !this.lessons.done;
  }

  /** Called right after the Overture run has started. */
  begin(): void {
    const engine = this.app.engine!;
    this.lessons = new OvertureLessons(overtureData as unknown as OvertureData);
    this.lessons.begin(engine);
    this.layers = 1;
    this.shownLesson = -1;
    this.chips.forEach((c, i) => c.classList.toggle('on', i === 0));
    this.root.classList.remove('hidden');
    this.app.hud.setOverture(true);
    this.sync();
  }

  private skip(): void {
    if (!this.lessons) return;
    this.lessons.skip();
    this.end();
    this.onSkip();
  }

  private end(): void {
    this.root.classList.add('hidden');
    this.app.hud.setOverture(false);
    this.app.wall.focus = null;
    this.app.canTouch = () => true;
    this.app.fx.setThumbRings([]);
    this.app.fx.setBlastPreview(0, 0, 0, 0, false);
    this.lessons = null;
  }

  onEvent(ev: PulseEvent): void {
    const engine = this.app.engine;
    if (!this.lessons || !engine) return;
    this.lessons.onEvent(ev, engine);
    if (ev.type !== 'danger') this.sync();
  }

  onFrame(): void {
    const engine = this.app.engine;
    const L = this.lessons;
    if (!L || !engine) return;
    L.onStep(engine);
    if (L.layers !== this.layers) {
      this.layers = L.layers;
      this.app.director.forceLayers(L.layers);
      this.chips.forEach((c, i) => c.classList.toggle('on', i < L.layers));
    }
    if (L.lesson !== this.shownLesson) this.sync();
    if (L.done) {
      this.end();
      this.onDone();
    }
  }

  /** Re-derive focus, rings, caption and blast preview for the current lesson state. */
  private sync(): void {
    const L = this.lessons;
    const engine = this.app.engine;
    if (!L || !engine) return;
    this.shownLesson = L.lesson;
    this.app.wall.focus = L.focus;
    this.app.wall.markDirty();
    const focus = L.focus;
    this.app.canTouch = cell => !focus || focus[cell] === 1;

    // Thumb rings sit on target groups that are not primed yet
    const pts: { x: number; y: number }[] = [];
    let previewOn = false;
    for (const g of L.targetCells(engine)) {
      let primed = false;
      let x = 0;
      let y = 0;
      let c0 = 99;
      let r0 = 99;
      let c1 = -1;
      let r1 = -1;
      for (const cell of g) {
        const c = cell % TUNING.BOARD_COLS;
        const r = (cell / TUNING.BOARD_COLS) | 0;
        const t = engine.board[r]?.[c];
        if (t && engine.getGroupForTile(t.id)) primed = true;
        WallView.cellCentre(c, r, this.pt);
        x += this.pt.x;
        y += this.pt.y;
        c0 = Math.min(c0, c);
        r0 = Math.min(r0, r);
        c1 = Math.max(c1, c);
        r1 = Math.max(r1, r);
      }
      if (!primed) pts.push({ x: x / g.length, y: y / g.length });
      if (L.lesson === 3 && !primed) {
        this.app.fx.setBlastPreview(c0, r0, c1, r1, true);
        previewOn = true;
      }
    }
    if (!previewOn) this.app.fx.setBlastPreview(0, 0, 0, 0, false);
    this.app.fx.setThumbRings(pts);

    const l = L.current;
    if (l?.caption) {
      this.caption.innerHTML = `<div class="cap-main">${l.caption}</div>${l.sub ? `<div class="cap-sub">${l.sub}</div>` : ''}`;
      this.caption.classList.toggle('lesson-3', l.id === 3);
      this.caption.classList.remove('hidden');
    } else {
      this.caption.classList.add('hidden');
    }
  }
}
