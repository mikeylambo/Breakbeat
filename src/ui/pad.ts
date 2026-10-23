/**
 * Cursor play and controllers.
 * In a run: a reticle sits on the wall. D-pad / left stick / arrows / WASD move it a cell at a time
 * (with key repeat); A / Space / J primes the group under it, and keeping it held 300 ms holds
 * (Overcharge), the same one-gesture prime+hold as touch. X / K holds a primed group directly.
 * Start / Esc pauses (Esc is the app's own key). The group under the reticle previews like a mouse hover.
 * Everywhere else, a controller drives the menus by sending the keys they already understand:
 * d-pad / stick = arrows, A = Enter, B = Escape, Start = Enter, LB / RB = [ ].
 * Rumble mirrors the haptic vocabulary on controllers that support it.
 */

import { TUNING } from '../tuning.js';
import type { BrowserHaptics } from '../platform/Haptics.js';
import { el } from './dom.js';

export interface CursorHost {
  /** A run is live (not paused, not blocked) */
  playing(): boolean;
  prime(cell: number): number;
  hold(cell: number): void;
  groupAt(cell: number): number;
  canHold(groupId: number): boolean;
  hover(cell: number): void;
  cellCentre(cell: number, out: { x: number; y: number }): void;
  holdRing(x: number, y: number, p: number): void;
  /** The DOM layer in stage coordinates */
  ui: HTMLElement;
}

const COLS = TUNING.BOARD_COLS;
const ROWS = TUNING.BOARD_ROWS;
const REPEAT_FIRST = 260;
const REPEAT_NEXT = 85;
const MENU_FIRST = 380;
const MENU_NEXT = 120;
const DEAD = 0.5;

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const ARROW: Record<Dir, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

const RUMBLE: Record<string, [number, number, number]> = {
  prime: [40, 0.1, 0.35],
  detonate: [60, 0.35, 0.25],
  overcharge: [180, 0.9, 0.5],
  allclear: [320, 0.7, 0.7],
  rank: [140, 0.4, 0.6],
  tick: [20, 0, 0.2]
};

export class CursorInput {
  /** Wall cell under the reticle */
  cell = (ROWS - 1) * COLS + (COLS >> 1);
  /** A controller has been used (shows pad prompts) */
  padActive = false;
  private readonly reticle = el('div', 'pad-reticle hidden', '<i></i>', { 'aria-hidden': 'true' });
  private readonly pt = { x: 0, y: 0 };
  private visible = false;
  /** Held directions with their next repeat time (ms) */
  private readonly held = new Map<Dir, number>();
  private press: { cell: number; group: number; at: number; done: boolean } | null = null;
  private padPrev: boolean[] = [];
  private pad: Gamepad | null = null;

  constructor(private readonly host: CursorHost) {
    host.ui.appendChild(this.reticle);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('pointermove', () => this.show(false));
    window.addEventListener('gamepadconnected', () => (this.padActive = true));
  }

  /** Hooks rumble into the haptic vocabulary. */
  attachRumble(h: BrowserHaptics): void {
    const pulse = h.pulse.bind(h);
    h.pulse = (id: string): boolean => {
      this.rumble(id);
      return pulse(id);
    };
  }

  private rumble(id: string): void {
    const r = RUMBLE[id];
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect(t: string, p: object): Promise<unknown> } }) | null)?.vibrationActuator;
    if (!r || !act || !this.padActive) return;
    void act.playEffect('dual-rumble', { duration: r[0], strongMagnitude: r[1], weakMagnitude: r[2] }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- keyboard

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.host.playing() || e.metaKey || e.ctrlKey || e.altKey) return;
    const d = KEY_DIR[e.code];
    if (d) {
      e.preventDefault();
      if (!e.repeat) this.dir(d, true);
      return;
    }
    if ((e.code === 'Space' || e.code === 'KeyJ') && !e.repeat) {
      e.preventDefault();
      this.down();
    } else if (e.code === 'KeyK' && !e.repeat) {
      e.preventDefault();
      this.holdNow();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const d = KEY_DIR[e.code];
    if (d) this.dir(d, false);
    if (e.code === 'Space' || e.code === 'KeyJ') this.up();
  };

  // ---------------------------------------------------------------- shared

  private dir(d: Dir, on: boolean): void {
    if (!on) {
      this.held.delete(d);
      return;
    }
    if (this.held.has(d)) return;
    this.held.set(d, performance.now() + (this.host.playing() ? REPEAT_FIRST : MENU_FIRST));
    this.step(d);
  }

  private step(d: Dir): void {
    if (!this.host.playing()) {
      key(ARROW[d]);
      return;
    }
    const c = this.cell % COLS;
    const r = (this.cell / COLS) | 0;
    const nc = Math.max(0, Math.min(COLS - 1, c + (d === 'left' ? -1 : d === 'right' ? 1 : 0)));
    const nr = Math.max(0, Math.min(ROWS - 1, r + (d === 'up' ? -1 : d === 'down' ? 1 : 0)));
    this.cell = nr * COLS + nc;
    this.show(true);
    // If a press is held and the reticle moves, it becomes a fresh press on the new cell
    if (this.press) this.press = null;
  }

  private down(): void {
    this.show(true);
    const group = this.host.prime(this.cell);
    const g = group >= 0 ? group : this.host.groupAt(this.cell);
    this.press = { cell: this.cell, group: g, at: performance.now(), done: false };
  }

  private up(): void {
    this.press = null;
    this.host.holdRing(0, 0, -1);
  }

  private holdNow(): void {
    this.show(true);
    this.host.hold(this.cell);
  }

  private show(on: boolean): void {
    if (on === this.visible) {
      if (on) this.place();
      return;
    }
    this.visible = on;
    this.reticle.classList.toggle('hidden', !on);
    if (on) this.place();
    else this.host.hover(-1);
  }

  private place(): void {
    this.host.cellCentre(this.cell, this.pt);
    this.reticle.style.transform = `translate(${this.pt.x - 17}px, ${this.pt.y - 17}px)`;
    this.host.hover(this.cell);
  }

  /** Once per frame: controller polling, key repeat, the hold timer. */
  update(): void {
    const now = performance.now();
    const playing = this.host.playing();
    if (!playing && this.visible) this.show(false);
    this.pollPad(playing);
    for (const [d, at] of this.held) {
      if (now >= at) {
        this.held.set(d, now + (playing ? REPEAT_NEXT : MENU_NEXT));
        this.step(d);
      }
    }
    const p = this.press;
    if (p && !p.done && playing) {
      const prog = (now - p.at) / TUNING.HOLD_MS;
      if (p.group >= 0 && this.host.canHold(p.group)) {
        this.host.cellCentre(p.cell, this.pt);
        this.host.holdRing(this.pt.x, this.pt.y, Math.min(1, prog));
        if (prog >= 1) {
          p.done = true;
          this.host.hold(p.cell);
          this.host.holdRing(0, 0, -1);
        }
      }
    }
  }

  private pollPad(playing: boolean): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const g of pads) if (g && g.connected && (!pad || g.timestamp > pad.timestamp)) pad = g;
    this.pad = pad;
    if (!pad) return;
    const b = (i: number): boolean => !!pad!.buttons[i]?.pressed;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const now: Record<Dir, boolean> = { up: b(12) || ay < -DEAD, down: b(13) || ay > DEAD, left: b(14) || ax < -DEAD, right: b(15) || ax > DEAD };
    const btn = [b(0), b(1), b(2), b(4), b(5), b(9)];
    const prev = this.padPrev;
    const edge = (i: number): boolean => btn[i]! && !prev[i];
    const rel = (i: number): boolean => !btn[i] && !!prev[i];
    if (btn.some(Boolean) || Object.values(now).some(Boolean)) this.padActive = true;
    for (const d of DIRS) {
      const was = !!prev[6 + DIRS.indexOf(d)];
      if (now[d] && !was) this.dir(d, true);
      else if (!now[d] && was) this.dir(d, false);
    }
    if (playing) {
      if (edge(0)) this.down();
      if (rel(0)) this.up();
      if (edge(2)) this.holdNow();
      if (edge(5)) key('Escape');
    } else {
      if (edge(0) || edge(5)) key('Enter');
      if (edge(1)) key('Escape');
      if (edge(3)) key('[');
      if (edge(4)) key(']');
    }
    this.padPrev = [...btn, ...DIRS.map(d => now[d])];
  }
}

/** Sends a key the screens already handle (menus, sheets, pause). */
function key(k: string): void {
  const code = k.startsWith('Arrow') || k === 'Enter' || k === 'Escape' ? k : k === '[' ? 'BracketLeft' : 'BracketRight';
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true }));
}
