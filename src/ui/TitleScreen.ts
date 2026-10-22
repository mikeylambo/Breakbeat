/**
 * TitleScreen — the main menu (mode select). Angled slabs on the right (Continue, Odyssey, Endless,
 * Daily, Zen, Etudes, Tutorial & Tips, Profile, Settings), the selected mode's name huge and tilted
 * behind them, Odyssey progress on the left, a one-line description and key hints along the bottom.
 * Whatever is selected is previewed live: its music and world play behind the menu.
 */

import { MOVEMENTS } from '../audio/tracks.js';
import { starCount, totalStars } from '../meta/Progress.js';
import { nextMovementIndex, todayUtc, type SaveData } from '../meta/Save.js';
import type { GameMode } from '../tuning.js';
import { el, fmt, setText, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';

export interface TitleActions {
  continue(): void;
  odyssey(): void;
  endless(): void;
  daily(): void;
  zen(): void;
  etudes(): void;
  tutorial(): void;
  settings(): void;
  profile(): void;
  calibrate(): void;
  /** Esc: back to the title card */
  back(): void;
  /** Selection changed: play this run's music and world behind the menu */
  preview(mode: GameMode, movement: number): void;
  /** True once timing has been synced or the chip dismissed */
  calibrated(): boolean;
}

interface Entry {
  id: string;
  name: string;
  meta: string;
  desc: string;
  ghost: string;
  cls?: string;
  action(): void;
}

export class TitleScreen {
  readonly root = el('div', 'title-screen hidden', '', { role: 'main', 'aria-label': 'Main menu' });
  private readonly menu: MenuList;
  private readonly ghost = el('div', 'mm-ghost', '', { 'aria-hidden': 'true' });
  private readonly desc = el('div', 'mm-desc', '', { 'aria-live': 'polite' });
  private readonly stats = el('div', 'mm-stats');
  private readonly nowPlaying = el('div', 'now-playing', '', { 'aria-hidden': 'true' });
  private readonly npText = el('span', 'np-text');
  private readonly sync = el('div', 'mm-sync');
  private entries: Entry[] = [];
  private save: SaveData | null = null;

  constructor(private readonly actions: TitleActions) {
    this.menu = new MenuList({
      cls: 'mode-menu',
      active: () => this.visible,
      onSelect: i => this.onSelect(i),
      onKey: e => {
        if (e.key !== 'Escape') return false;
        uiSound('back');
        this.actions.back();
        return true;
      }
    });
    const head = el('div', 'mm-head');
    head.innerHTML = '<div class="mm-mark"><span>BREAK</span><b>BEAT</b></div>';
    const eq = el('span', 'np-eq', '<i></i><i></i><i></i><i></i>');
    this.nowPlaying.append(eq, this.npText);
    const foot = el('div', 'mm-foot');
    foot.append(this.desc, el('div', 'mm-keys', '<b>↑ ↓</b>SELECT<b>ENTER</b>CONFIRM<b>ESC</b>BACK'));
    this.root.append(el('div', 'mm-panel', '', { 'aria-hidden': 'true' }), this.ghost, head, this.stats, this.nowPlaying, this.sync, this.menu.root, foot);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  render(save: SaveData): void {
    this.save = save;
    const a = this.actions;
    const next = nextMovementIndex(save);
    const nm = MOVEMENTS[next]!;
    const first = !save.overtureDone;
    const today = todayUtc();
    const cleared = save.cleared.length;
    this.entries = [
      {
        id: 'continue',
        name: first ? 'Begin' : 'Continue',
        meta: first ? 'OVERTURE · 60 SEC' : `${nm.number} · ${nm.name.toUpperCase()}`,
        desc: first ? 'Start here: a one-minute lesson that turns into your first movement.' : `Pick the Odyssey up at ${nm.number} ${nm.name}, ${nm.bpm} BPM.`,
        ghost: first ? 'Begin' : 'Play',
        cls: 'btn-continue',
        action: a.continue
      },
      { id: 'odyssey', name: 'Odyssey', meta: `${cleared}/${MOVEMENTS.length}`, desc: 'Nineteen movements across three acts and a coda. Clear a movement to unlock the next.', ghost: 'Odyssey', action: a.odyssey },
      { id: 'endless', name: 'Endless', meta: save.best.endless ? fmt(save.best.endless) : '—', desc: 'One wall, every movement in turn. The wall never stops rising.', ghost: 'Endless', action: a.endless },
      { id: 'daily', name: 'Daily', meta: save.daily.date === today ? fmt(save.daily.best) : 'NEW', desc: "Today's wall: the same deal all day. Your best run of the day is kept.", ghost: 'Daily', cls: save.daily.date === today ? '' : 'fresh', action: a.daily },
      { id: 'zen', name: 'Zen', meta: save.best.zen ? fmt(save.best.zen) : '—', desc: 'No rising wall, no game over. Just you and the music.', ghost: 'Zen', action: a.zen },
      { id: 'etudes', name: 'Etudes', meta: `${save.etudes.length}/8`, desc: 'Hand-built puzzles: clear the target in a set number of passes.', ghost: 'Etudes', action: a.etudes },
      { id: 'tutorial', name: 'Tutorial & Tips', meta: '', desc: 'How every piece of Breakbeat works, one slide at a time.', ghost: 'Learn', cls: 'quiet', action: a.tutorial },
      { id: 'profile', name: 'Profile', meta: '', desc: 'Lifetime stats, challenge stars and the cosmetic locker.', ghost: 'Profile', cls: 'quiet', action: a.profile },
      { id: 'settings', name: 'Settings', meta: '', desc: 'Sound, timing, display and accessibility.', ghost: 'Settings', cls: 'quiet', action: a.settings }
    ];
    const items: MenuItem[] = this.entries.map((e, i) => ({
      id: e.id,
      label: `${e.name}. ${e.desc}`,
      cls: `mode-slab ${e.cls ?? ''}`,
      action: e.action,
      html: `<span class="slab-i">${String(i + 1).padStart(2, '0')}</span><span class="mi-name">${e.name}</span><span class="mi-meta">${e.meta}</span>`
    }));
    this.menu.setItems(items, this.menu.items.length ? this.menu.index : 0);

    const pct = Math.round((cleared / MOVEMENTS.length) * 100);
    const stars = totalStars(save);
    this.stats.innerHTML = `<div class="mm-stat-label">ODYSSEY COMPLETE</div><div class="mm-pct">${pct}<small>%</small></div><div class="mm-stat-row"><span><b>★ ${stars}</b> / ${MOVEMENTS.length * 3}</span><span><b>${fmt(save.runs)}</b> RUNS</span><span><b>${MOVEMENTS.filter(m => starCount(save.stars[m.id]) === 3).length}</b> MASTERED</span></div>`;

    this.sync.innerHTML = '';
    if (save.overtureDone && !a.calibrated()) {
      const b = el('button', 'util-btn sync-chip', '<span>Sync timing</span><b>10 SEC</b>', { type: 'button', 'aria-label': 'Sync audio timing' });
      b.addEventListener('click', e => {
        e.stopPropagation();
        uiSound('pick');
        a.calibrate();
      });
      this.sync.appendChild(b);
    }
  }

  private onSelect(i: number): void {
    const e = this.entries[i];
    if (!e) return;
    setText(this.desc, e.desc);
    if (this.ghost.textContent !== e.ghost) {
      this.ghost.textContent = e.ghost;
      this.ghost.classList.remove('in');
      void this.ghost.offsetWidth;
      this.ghost.classList.add('in');
    }
    this.previewCurrent();
  }

  /** Previews whatever is selected (App ignores repeats). */
  previewCurrent(): void {
    const save = this.save;
    if (!save || !this.visible) return;
    const id = this.menu.items[this.menu.index]?.id ?? 'continue';
    if (id === 'continue' || id === 'odyssey') this.actions.preview(save.overtureDone ? 'odyssey' : 'overture', nextMovementIndex(save));
    else if (id === 'endless') this.actions.preview('endless', 0);
    else if (id === 'daily') this.actions.preview('daily', 0);
    else if (id === 'zen') this.actions.preview('zen', 0);
  }

  /** The "now playing" credit, bottom left. */
  setNowPlaying(text: string): void {
    setText(this.npText, text);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) return;
    this.menu.relayout();
    this.onSelect(this.menu.index);
  }
}
