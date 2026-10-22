/** Tiny DOM helpers for the HUD and menus (DOM over the Pixi canvas). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  for (const k in attrs) e.setAttribute(k, attrs[k]!);
  return e;
}

export function button(cls: string, html: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, html, { type: 'button', 'aria-label': label });
  b.addEventListener('click', e => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** Sets textContent only when it changes (HUD values update every frame). */
export function setText(e: HTMLElement, v: string): void {
  if (e.textContent !== v) e.textContent = v;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

let announcer: HTMLElement | null = null;
/** Screen-reader live region announcement. */
export function announce(msg: string): void {
  announcer ??= document.getElementById('announcer');
  if (!announcer) return;
  announcer.textContent = '';
  // next frame so repeated messages are re-read
  requestAnimationFrame(() => {
    if (announcer) announcer.textContent = msg;
  });
}

export const ICONS = {
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/></svg>',
  rotate: '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect x="20" y="8" width="24" height="40" rx="4" stroke="currentColor" stroke-width="3" fill="none"/><path d="M10 40c0 9 7 16 16 16h4" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M27 51l4 5-4 5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6L3.3 9.5l6.1-.7z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};

export type UiSoundKind = 'move' | 'pick' | 'back' | 'deny' | 'tick' | 'stamp' | 'fanfare';
let uiSoundFn: ((kind: UiSoundKind, index: number) => void) | null = null;

/** Menu feedback sounds (set once by App; silent until audio is unlocked). */
export function setUiSound(fn: (kind: UiSoundKind, index: number) => void): void {
  uiSoundFn = fn;
}

export function uiSound(kind: UiSoundKind, index = 0): void {
  uiSoundFn?.(kind, index);
}

/** True when a modal sheet is open that does not contain `node` (menus underneath ignore keys). */
export function coveredBySheet(node: HTMLElement): boolean {
  const open = document.querySelectorAll<HTMLElement>('.sheet-scrim:not(.hidden), .etude-banner:not(.hidden), .rotate-card:not(.hidden)');
  for (const s of open) if (!s.contains(node)) return true;
  return false;
}

/** Blade wipe across the whole window: resolves at the midpoint (swap screens there). */
export function bladeWipe(host: HTMLElement = document.body, accent = '#ffc461'): Promise<void> {
  if (document.documentElement.classList.contains('reduced-motion')) return Promise.resolve();
  const w = el('div', 'blade-wipe', '<i></i>', { 'aria-hidden': 'true' });
  w.style.setProperty('--accent', accent);
  host.appendChild(w);
  setTimeout(() => w.remove(), 700);
  return new Promise(r => setTimeout(r, 230));
}
