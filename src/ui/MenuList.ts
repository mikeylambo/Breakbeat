/**
 * MenuList — the game's menu primitive. Big type, one selected row marked by a sliding blade
 * cursor, mouse hover and keyboard (↑ ↓ Enter Space) share the same selection, and every move
 * plays a tone in the key of whatever music is running. Used by the title, pause and results.
 */

import { coveredBySheet, el, uiSound } from './dom.js';

export interface MenuItem {
  id: string;
  /** Inner HTML of the row */
  html: string;
  label: string;
  cls?: string;
  locked?: boolean;
  action(): void;
}

export interface MenuOptions {
  cls?: string;
  /** Selection moved (mouse or keys) */
  onSelect?(index: number, item: MenuItem): void;
  /** ← / → / edge handling; return true when handled */
  onKey?(e: KeyboardEvent, menu: MenuList): boolean;
  /** Keys are routed here only while this returns true */
  active?(): boolean;
  /** A row of buttons: ← → move, the cursor runs along the bottom edge */
  horizontal?: boolean;
}

export class MenuList {
  readonly root: HTMLElement;
  private readonly cursor = el('span', 'menu-cursor', '', { 'aria-hidden': 'true' });
  private rows: HTMLButtonElement[] = [];
  items: MenuItem[] = [];
  index = 0;
  /** Keyboard focus is in this menu (dims the cursor of the other column) */
  focused = true;

  constructor(private readonly opts: MenuOptions = {}) {
    this.root = el('div', `menu${opts.horizontal ? ' menu-row' : ''} ${opts.cls ?? ''}`, '', { role: 'menu' });
    window.addEventListener('keydown', this.onKey);
  }

  setItems(items: MenuItem[], index = this.index): void {
    this.items = items;
    this.root.innerHTML = '';
    this.root.appendChild(this.cursor);
    this.rows = items.map((it, i) => {
      const b = el('button', `menu-item ${it.cls ?? ''}${it.locked ? ' locked' : ''}`, it.html, { type: 'button', role: 'menuitem', 'aria-label': it.label });
      if (it.locked) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('pointerenter', e => {
        if (e.pointerType === 'mouse') this.select(i);
      });
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.select(i, true);
        this.pick();
      });
      this.root.appendChild(b);
      return b;
    });
    this.select(Math.max(0, Math.min(items.length - 1, index)), true);
  }

  /** Moves the selection; `silent` skips the tone (programmatic moves). */
  select(i: number, silent = false): void {
    if (!this.rows.length) return;
    i = Math.max(0, Math.min(this.rows.length - 1, i));
    const changed = i !== this.index || !this.rows[i]!.classList.contains('on');
    this.index = i;
    this.rows.forEach((r, k) => r.classList.toggle('on', k === i));
    this.placeCursor();
    if (!changed) return;
    if (!silent) uiSound('move', i);
    this.opts.onSelect?.(i, this.items[i]!);
  }

  setFocused(on: boolean): void {
    this.focused = on;
    this.root.classList.toggle('blur', !on);
  }

  /** Activates the selected row. */
  pick(): void {
    const it = this.items[this.index];
    const row = this.rows[this.index];
    if (!it || !row) return;
    if (it.locked) {
      uiSound('deny');
      row.classList.remove('deny');
      void row.offsetWidth;
      row.classList.add('deny');
      return;
    }
    uiSound('pick', this.index);
    row.classList.remove('picked');
    void row.offsetWidth;
    row.classList.add('picked');
    it.action();
  }

  private placeCursor(): void {
    const r = this.rows[this.index];
    if (!r) return;
    // offsets are layout-only (no transforms), so they are exact under the stage scale
    if (this.opts.horizontal) {
      this.cursor.style.transform = `translateX(${r.offsetLeft}px)`;
      this.cursor.style.width = `${r.offsetWidth}px`;
    } else {
      this.cursor.style.transform = `translateY(${r.offsetTop}px)`;
      this.cursor.style.height = `${r.offsetHeight}px`;
    }
  }

  /** Re-measures after the menu becomes visible (offsets are 0 while hidden). */
  relayout(): void {
    this.placeCursor();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.root.isConnected || this.root.offsetParent === null) return;
    if (this.opts.active && !this.opts.active()) return;
    if (!this.focused || coveredBySheet(this.root)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // One key press drives one menu: a screen that opens on it must not receive it too
    if (this.opts.onKey?.(e, this)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const n = this.rows.length;
    if (!n) return;
    const h = this.opts.horizontal;
    switch (e.key) {
      case h ? 'ArrowRight' : 'ArrowDown':
        this.select((this.index + 1) % n);
        break;
      case h ? 'ArrowLeft' : 'ArrowUp':
        this.select((this.index - 1 + n) % n);
        break;
      case 'Enter':
      case ' ':
        // One of our rows focused activates natively (and routes through its click); a button
        // focused anywhere else is stale focus, and preventDefault below stops it firing
        if (e.repeat || (e.target instanceof HTMLButtonElement && this.root.contains(e.target))) return;
        this.pick();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  };
}
