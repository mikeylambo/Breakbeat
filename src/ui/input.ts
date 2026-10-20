/**
 * Input — one gesture for prime and hold:
 * - pointerdown on an unprimed group primes it immediately;
 * - keeping the press for HOLD_MS then holds that same group (prime + hold in one gesture);
 * - a long press on an already-primed group holds it; a tap on a primed group does nothing;
 * - moving beyond TAP_SLOP_PX cancels a pending hold.
 * Up to four simultaneous presses (two thumbs plus spares). No allocation per event.
 */

import { TUNING } from '../tuning.js';

export interface InputTarget {
  /** Logical stage point -> cell index (-1 = off the wall). */
  cellAt(x: number, y: number): number;
  /** Prime the group at cell; returns its group id, or -1 if nothing primed. */
  prime(cell: number): number;
  /** Group id currently covering `cell`, or -1. */
  groupAt(cell: number): number;
  /** True if that group can still be held. */
  canHold(groupId: number): boolean;
  hold(cell: number): void;
  /** Logical centre of a cell (hold ring position). */
  cellCentre(cell: number, out: { x: number; y: number }): void;
  toLogical(clientX: number, clientY: number, out: { x: number; y: number }): void;
  /** Hold-ring feedback: p in [0,1], or -1 to hide. */
  holdRing(x: number, y: number, p: number): void;
  /** Pointer went down while not in play (menus handle their own input). */
  enabled(): boolean;
}

interface Press {
  id: number;
  active: boolean;
  startX: number;
  startY: number;
  startMs: number;
  cell: number;
  groupId: number;
  holdPending: boolean;
}

export class InputController {
  private readonly presses: Press[] = [];
  private readonly pt = { x: 0, y: 0 };
  private readonly centre = { x: 0, y: 0 };

  constructor(
    private readonly el: HTMLElement,
    private readonly target: InputTarget
  ) {
    for (let i = 0; i < 4; i++) {
      this.presses.push({ id: -1, active: false, startX: 0, startY: 0, startMs: 0, cell: -1, groupId: -1, holdPending: false });
    }
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp, { passive: true });
    window.addEventListener('pointercancel', this.onUp, { passive: true });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private slot(id: number): Press | null {
    for (const p of this.presses) if (p.active && p.id === id) return p;
    return null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.target.enabled()) return;
    e.preventDefault();
    const free = this.presses.find(p => !p.active);
    if (!free) return;
    this.target.toLogical(e.clientX, e.clientY, this.pt);
    const cell = this.target.cellAt(this.pt.x, this.pt.y);
    if (cell < 0) return;
    let groupId = this.target.groupAt(cell);
    if (groupId < 0) groupId = this.target.prime(cell);
    if (groupId < 0) return;
    free.active = true;
    free.id = e.pointerId;
    free.startX = e.clientX;
    free.startY = e.clientY;
    free.startMs = e.timeStamp || performance.now();
    free.cell = cell;
    free.groupId = groupId;
    free.holdPending = this.target.canHold(groupId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.slot(e.pointerId);
    if (!p || !p.holdPending) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (dx * dx + dy * dy > TUNING.TAP_SLOP_PX * TUNING.TAP_SLOP_PX) {
      p.holdPending = false;
      this.target.holdRing(0, 0, -1);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.slot(e.pointerId);
    if (!p) return;
    p.active = false;
    if (p.holdPending) this.target.holdRing(0, 0, -1);
    p.holdPending = false;
  };

  /** Once per frame: advances pending holds and drives the hold ring. */
  update(nowMs: number): void {
    let shown = false;
    for (const p of this.presses) {
      if (!p.active || !p.holdPending) continue;
      if (!this.target.canHold(p.groupId)) {
        p.holdPending = false;
        continue;
      }
      const t = (nowMs - p.startMs) / TUNING.HOLD_MS;
      this.target.cellCentre(p.cell, this.centre);
      if (t >= 1) {
        p.holdPending = false;
        this.target.hold(p.cell);
        this.target.holdRing(0, 0, -1);
      } else if (!shown && t > 0.12) {
        // a short grace before the ring shows keeps plain taps clean
        this.target.holdRing(this.centre.x, this.centre.y, (t - 0.12) / 0.88);
        shown = true;
      }
    }
  }

  cancelAll(): void {
    for (const p of this.presses) {
      p.active = false;
      p.holdPending = false;
    }
    this.target.holdRing(0, 0, -1);
  }
}
