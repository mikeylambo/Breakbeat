/**
 * OvertureLessons — the lesson logic, DOM-free so the OVERTURE_FLOW gate can drive it headless.
 * 1 · Tap   (one jade group, everything else dimmed)      -> completes on prime + detonate -> bass
 * 2 · Many  (three groups ahead of the blade)              -> one pass detonates 2+ groups  -> keys
 * 3 · Hold  (one amber group; the wall starts rising)      -> an Overcharged detonation     -> lead
 * Boards are fixed deals from content/overture.json; a new lesson is dealt on the next downbeat.
 */

import { TUNING } from '../../tuning.js';
import type { PulseEngine } from '../../pulse/PulseEngine.js';
import type { PulseEvent } from '../../pulse/types.js';

export interface OvertureLesson {
  id: number;
  name: string;
  board: number[][];
  /** Target groups as [col, row] lists, rows relative to the top of `board` */
  targets: [number, number][][];
  unlocks: string;
  focus: boolean;
  caption?: string;
  sub?: string;
  riseBars?: number;
}

export interface OvertureData {
  bpm: number;
  lessons: OvertureLesson[];
}

const COLS = TUNING.BOARD_COLS;
const ROWS = TUNING.BOARD_ROWS;

export class OvertureLessons {
  /** 1..3 while teaching; 4 once all three are complete */
  lesson = 0;
  /** Stem layers unlocked so far (kick only = 1) */
  layers = 1;
  done = false;
  skipped = false;
  /** Deterministic record of what happened, for the gate */
  readonly log: string[] = [];
  /** Cells that may be touched (null = all). Board cell index r*COLS+c. */
  focus: Uint8Array | null = null;
  /** Target tile ids per group for the current lesson (they follow their tiles as the wall rises) */
  targetIds: number[][] = [];
  private pendingDealBar = -1;
  private targetGroupIds = new Set<number>();
  private passBar = -1;
  private passCount = 0;

  constructor(private readonly data: OvertureData) {}

  get current(): OvertureLesson | null {
    return this.data.lessons[this.lesson - 1] ?? null;
  }

  /** Deals lesson 1 immediately (before the first downbeat). */
  begin(engine: PulseEngine): void {
    engine.setPressureEnabled(false);
    this.deal(engine, 1);
  }

  private deal(engine: PulseEngine, lesson: number): void {
    this.lesson = lesson;
    const l = this.data.lessons[lesson - 1]!;
    engine.dealFixed(l.board);
    const offset = ROWS - l.board.length;
    this.targetIds = l.targets.map(g => g.map(([c, r]) => engine.board[r + offset]![c]!.id));
    this.targetGroupIds.clear();
    this.passBar = -1;
    this.passCount = 0;
    if (l.focus) {
      this.focus = new Uint8Array(COLS * ROWS);
      for (const g of l.targets) for (const [c, r] of g) this.focus[(r + offset) * COLS + c] = 1;
    } else {
      this.focus = null;
    }
    // Lesson 3 is when the wall starts to rise
    if (lesson === 3) {
      // The lesson grants a full Charge meter; afterwards it is earned by detonations
      engine.charge = 1;
      (engine.config as { riseBars: number }).riseBars = l.riseBars ?? 2;
      engine.setPressureEnabled(true);
    }
    this.log.push(`deal:${lesson}@${Math.max(0, engine.currentStep)}`);
  }

  private complete(engine: PulseEngine): void {
    const l = this.current!;
    engine.completeLesson(l.id);
    this.layers = Math.min(4, this.layers + 1);
    this.log.push(`complete:${l.id}:${l.unlocks}@${engine.currentStep}`);
    this.targetIds = [];
    this.focus = null;
    if (l.id >= this.data.lessons.length) {
      this.done = true;
      this.lesson = this.data.lessons.length + 1;
      return;
    }
    // Next lesson on the next downbeat (or the one after if we're late in the bar)
    const sixteenth = Math.max(0, engine.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    this.pendingDealBar = Math.max(1, engine.currentBar) + (sixteenth >= 12 ? 2 : 1);
  }

  private redeal(engine: PulseEngine): void {
    const sixteenth = Math.max(0, engine.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    this.pendingDealBar = Math.max(1, engine.currentBar) + (sixteenth >= 12 ? 2 : 1);
    this.log.push(`retry:${this.lesson}@${engine.currentStep}`);
    this.pendingRedeal = true;
  }

  private pendingRedeal = false;

  /** Call after each sim advance. Deals pending boards at the first step of their bar. */
  onStep(engine: PulseEngine): void {
    // Lesson 2: a pass that set off only one group re-deals the three groups on this downbeat
    if (this.lesson === 2 && !this.done && this.pendingDealBar < 0 && this.passBar > 0 && engine.currentBar > this.passBar && this.passCount === 1) {
      this.log.push(`retry:2@${engine.currentStep}`);
      this.deal(engine, 2);
      return;
    }
    if (this.pendingDealBar > 0 && engine.currentBar >= this.pendingDealBar) {
      this.pendingDealBar = -1;
      if (this.pendingRedeal) {
        this.pendingRedeal = false;
        this.deal(engine, this.lesson);
      } else {
        this.deal(engine, this.lesson + 1);
      }
    }
  }

  private isTargetTile(id: number): boolean {
    for (const g of this.targetIds) if (g.includes(id)) return true;
    return false;
  }

  /** Current board cells of each target group (tiles that still exist). */
  targetCells(engine: PulseEngine): number[][] {
    const out: number[][] = [];
    for (const g of this.targetIds) {
      const cells: number[] = [];
      for (const id of g) {
        const t = engine.findTileById(id);
        if (t) cells.push(t.row * COLS + t.col);
      }
      if (cells.length) out.push(cells);
    }
    return out;
  }

  onEvent(ev: PulseEvent, engine: PulseEngine): void {
    if (this.done || this.pendingDealBar > 0) return;
    const l = this.current;
    if (!l) return;
    if (ev.type === 'prime') {
      // A target group was primed if any of its tiles sits on a target cell
      for (const id of ev.tileIds) {
        if (this.isTargetTile(id)) {
          this.targetGroupIds.add(ev.groupId);
          break;
        }
      }
      return;
    }
    if (ev.type !== 'detonate') return;
    switch (l.id) {
      case 1:
        if (this.targetGroupIds.has(ev.groupId)) this.complete(engine);
        break;
      case 2: {
        if (ev.bar !== this.passBar) {
          this.passBar = ev.bar;
          this.passCount = 0;
        }
        this.passCount++;
        if (this.passCount >= 2) this.complete(engine);
        break;
      }
      case 3:
        if (ev.overcharged) this.complete(engine);
        else if (this.targetGroupIds.has(ev.groupId)) this.redeal(engine);
        break;
    }
  }

  /** Skip: always available. Leads straight to Movement 01. */
  skip(): { mode: 'odyssey'; movement: 0 } {
    this.skipped = true;
    this.done = true;
    this.log.push('skip');
    return { mode: 'odyssey', movement: 0 };
  }
}
