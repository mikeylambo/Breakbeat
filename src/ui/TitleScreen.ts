/**
 * TitleScreen — the front of the record. Left: SLU · VOL. 01, the BREAK/BEAT wordmark (it hits on
 * the music), and the main menu (Continue, Endless, Daily, Zen, Etudes). Right: the Odyssey setlist,
 * one act at a time. Both columns are MenuLists: mouse and keys share one selection, and whatever
 * is selected is previewed live (its music and world play behind the title). ← → switch columns.
 */

import { ACTS, MOVEMENTS } from '../audio/tracks.js';
import { starCount } from '../meta/Progress.js';
import { isUnlocked, mastery, nextMovementIndex, todayUtc, type SaveData } from '../meta/Save.js';
import type { GameMode } from '../tuning.js';
import { hex } from '../render/palette.js';
import { worldFor } from '../render/worlds.js';
import { button, el, fmt, ICONS, setText, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';

export interface TitleActions {
  continue(): void;
  movement(index: number): void;
  endless(): void;
  daily(): void;
  zen(): void;
  etudes(): void;
  settings(): void;
  calibrate(): void;
  profile(): void;
  /** Selection changed: play this run's music and world behind the title */
  preview(mode: GameMode, movement: number): void;
  /** True once timing has been synced or the chip dismissed */
  calibrated(): boolean;
  /** True while title music is audible */
  sounding(): boolean;
}

const BADGE_LABEL: Record<string, string> = { BRONZE: 'BRZ', SILVER: 'SLV', GOLD: 'GLD', OBSIDIAN: 'OBS', RESONANT: 'RES' };

export class TitleScreen {
  readonly root = el('div', 'title-screen hidden', '', { role: 'main', 'aria-label': 'Title' });
  private readonly wordmark = el('h1', 'wordmark', '<span class="w-break">BREAK</span><span class="w-beat">BEAT</span><i class="w-slash"></i>', { 'aria-label': 'Breakbeat' });
  private readonly menu: MenuList;
  private readonly setlist: MenuList;
  private readonly acts = el('div', 'act-tabs', '', { role: 'tablist', 'aria-label': 'Acts' });
  private readonly nowPlaying = el('div', 'now-playing', '', { 'aria-hidden': 'true' });
  private readonly npText = el('span', 'np-text');
  private readonly utility = el('div', 'title-utility');

  /** Act shown in the setlist */
  private act: string = ACTS[0];
  private save: SaveData | null = null;
  private lastBar = -1;
  private sounding = false;
  private npLabel = '';

  constructor(private readonly actions: TitleActions) {
    this.menu = new MenuList({
      cls: 'main-menu',
      active: () => this.visible,
      onSelect: () => {
        if (this.menu.focused) this.previewCurrent();
      },
      onKey: e => {
        if (e.key !== 'ArrowRight') return false;
        this.focusSetlist(true);
        return true;
      }
    });
    this.setlist = new MenuList({
      cls: 'setlist',
      active: () => this.visible,
      onSelect: (_, it) => {
        this.root.style.setProperty('--sel-accent', hex(worldFor(MOVEMENTS[Number(it.id)]!.style).accent));
        if (this.setlist.focused) this.previewCurrent();
      },
      onKey: (e, m) => {
        if (e.key === 'ArrowLeft') {
          this.focusSetlist(false);
          return true;
        }
        const n = m.items.length;
        const step = e.key === 'ArrowDown' && m.index === n - 1 ? 1 : e.key === 'ArrowUp' && m.index === 0 ? -1 : e.key === 'PageDown' || e.key === ']' ? 1 : e.key === 'PageUp' || e.key === '[' ? -1 : 0;
        if (!step) return false;
        const k = (ACTS.indexOf(this.act as (typeof ACTS)[number]) + step + ACTS.length) % ACTS.length;
        this.setAct(ACTS[k]!, step > 0 ? 'first' : 'last');
        return true;
      }
    });
    this.setlist.setFocused(false);
    this.menu.root.addEventListener('pointerenter', () => this.focusSetlist(false, true));
    this.setlist.root.addEventListener('pointerenter', () => this.focusSetlist(true, true));

    const left = el('section', 'title-left');
    left.append(el('div', 'title-kicker', 'SLU <b>·</b> VOL. 01'), this.wordmark, this.menu.root);

    const right = el('section', 'tracklist', '', { 'aria-label': 'The Odyssey' });
    const head = el('div', 'tracklist-head');
    head.append(el('span', 'tracklist-title', 'THE ODYSSEY'), this.acts);
    const eq = el('span', 'np-eq', '<i></i><i></i><i></i><i></i>');
    this.nowPlaying.append(eq, this.npText);
    right.append(head, this.setlist.root, this.nowPlaying);

    this.root.append(left, right, this.utility);
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
    const row = (id: string, name: string, meta: string, label: string, action: () => void, cls = ''): MenuItem => ({
      id,
      label,
      cls,
      action,
      html: `<span class="mi-name">${name}</span><span class="mi-meta">${meta}</span>`
    });
    const items: MenuItem[] = [
      {
        id: 'continue',
        cls: 'btn-continue',
        label: first ? 'Begin: Overture' : `Continue: ${nm.name}`,
        action: a.continue,
        html: `<span class="mi-name">${first ? 'Begin' : 'Continue'}</span><span class="mi-meta">${first ? 'OVERTURE · ABOUT 60 SEC' : `${nm.number} · ${nm.name.toUpperCase()} · ${nm.bpm} BPM`}</span>${ICONS.play}`
      },
      row('endless', 'Endless', save.best.endless ? `BEST ${fmt(save.best.endless)}` : 'NO BEST YET', 'Endless', a.endless),
      row('daily', 'Daily', save.daily.date === today ? `BEST ${fmt(save.daily.best)}` : 'NEW TODAY', 'Daily', a.daily, save.daily.date === today ? '' : 'fresh'),
      row('zen', 'Zen', save.best.zen ? `BEST ${fmt(save.best.zen)}` : 'NO PRESSURE', 'Zen', a.zen),
      row('etudes', 'Etudes', `${save.etudes.length}/8 SOLVED`, 'Etudes', a.etudes)
    ];
    this.menu.setItems(items, this.menu.items.length ? this.menu.index : 0);

    this.utility.innerHTML = '';
    const stars = Object.values(save.stars).reduce((n, m) => n + starCount(m), 0);
    this.utility.append(
      button('util-btn title-settings', `${ICONS.gear}<span>Settings</span>`, 'Settings', () => {
        uiSound('pick');
        a.settings();
      }),
      button('util-btn title-profile', `${ICONS.star}<span>Profile</span>${stars ? `<b>${stars}</b>` : ''}`, 'Profile, stats and locker', () => {
        uiSound('pick');
        a.profile();
      })
    );
    if (save.overtureDone && !a.calibrated()) this.utility.appendChild(button('util-btn sync-chip', '<span>Sync timing</span><b>10 SEC</b>', 'Sync audio timing', a.calibrate));
    this.utility.appendChild(el('div', 'util-keys', '<b>↑ ↓</b>CHOOSE<b>← →</b>SETLIST<b>ENTER</b>PLAY'));

    if (!this.setlist.items.length) this.act = MOVEMENTS[next]!.act;
    this.renderSetlist(this.setlist.items.length ? this.setlist.index : MOVEMENTS.filter(m => m.act === this.act).indexOf(nm));
    this.setSounding(this.sounding, true);
  }

  private setAct(act: string, at: 'first' | 'last' | number = 'first'): void {
    if (act === this.act && typeof at === 'number') return;
    this.act = act;
    uiSound('move', 2);
    const count = MOVEMENTS.filter(m => m.act === act).length;
    this.renderSetlist(at === 'first' ? 0 : at === 'last' ? count - 1 : at);
  }

  private renderSetlist(index: number): void {
    const save = this.save;
    if (!save) return;
    const next = nextMovementIndex(save);
    const first = !save.overtureDone;
    this.acts.innerHTML = '';
    for (const a of ACTS) {
      const tab = button(`act-tab${a === this.act ? ' on' : ''}`, a === 'Coda' ? 'CODA' : a, a === 'Coda' ? 'Coda' : `Act ${a}`, () => {
        this.focusSetlist(true, true);
        this.setAct(a, 0);
        this.previewCurrent();
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(a === this.act));
      this.acts.appendChild(tab);
    }
    const items: MenuItem[] = [];
    MOVEMENTS.forEach((m, i) => {
      if (m.act !== this.act) return;
      const unlocked = isUnlocked(save, i);
      const cleared = save.cleared.includes(m.id);
      const best = save.best[m.id] ?? 0;
      const rank = best > 0 ? mastery(best).rank : null;
      const sc = starCount(save.stars[m.id]);
      const badge = rank ? `<span class="badge badge-${rank.toLowerCase()}" title="${rank}">${BADGE_LABEL[rank]}</span>` : `<span class="badge badge-none"></span>`;
      const sub = unlocked
        ? `${m.style.toUpperCase()} · <span class="track-stars" aria-label="${sc} of 3 stars">${'★'.repeat(sc)}<s>${'★'.repeat(3 - sc)}</s></span>${best ? ` · ${fmt(best)}` : ''}`
        : 'LOCKED';
      items.push({
        id: String(i),
        label: `${m.number} ${m.name}. ${m.bpm} BPM. ${unlocked ? (rank ? `Mastery ${rank}.` : cleared ? 'Cleared.' : 'Unlocked.') : 'Locked.'}`,
        cls: `track-row${i === next && !first ? ' next' : ''}`,
        locked: !unlocked,
        action: () => this.actions.movement(i),
        html: `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${sub}</small></span>${badge}<span class="track-bpm">${m.bpm}<small>BPM</small></span><span class="track-lock">${unlocked ? '' : ICONS.lock}</span>`
      });
    });
    this.setlist.setItems(items, Math.max(0, Math.min(items.length - 1, index)));
  }

  /** Moves keyboard focus between the main menu and the setlist. */
  private focusSetlist(on: boolean, fromPointer = false): void {
    if (this.setlist.focused === on) return;
    this.setlist.setFocused(on);
    this.menu.setFocused(!on);
    if (!fromPointer) uiSound('move', on ? 3 : 0);
    this.previewCurrent();
  }

  /** Previews whatever the focused column has selected (App ignores repeats). */
  previewCurrent(): void {
    const save = this.save;
    if (!save || !this.visible) return;
    if (this.setlist.focused) {
      const i = Number(this.setlist.items[this.setlist.index]?.id ?? 0);
      if (isUnlocked(save, i)) this.actions.preview('odyssey', i);
      return;
    }
    const id = this.menu.items[this.menu.index]?.id ?? 'continue';
    if (id === 'continue') this.actions.preview(save.overtureDone ? 'odyssey' : 'overture', nextMovementIndex(save));
    else if (id === 'endless') this.actions.preview('endless', 0);
    else if (id === 'daily') this.actions.preview('daily', 0);
    else if (id === 'zen') this.actions.preview('zen', 0);
  }

  /** The "now playing" line under the setlist. */
  setNowPlaying(text: string): void {
    this.npLabel = text;
    if (this.sounding) setText(this.npText, text);
  }

  setSounding(on: boolean, force = false): void {
    if (on === this.sounding && !force) return;
    this.sounding = on;
    this.nowPlaying.classList.toggle('muted', !on);
    setText(this.npText, on ? this.npLabel : matchMedia('(hover: none)').matches ? 'TAP ANYWHERE FOR SOUND' : 'PRESS ANY KEY FOR SOUND');
  }

  /** Per frame while visible: the wordmark hits on every other downbeat. */
  onBeat(bar: number, sounding: boolean): void {
    if (sounding !== this.sounding) this.setSounding(sounding);
    if (!sounding || bar === this.lastBar) return;
    const hit = this.lastBar >= 0 && bar % 2 === 1;
    this.lastBar = bar;
    if (!hit) return;
    this.wordmark.classList.remove('hit');
    void this.wordmark.offsetWidth;
    this.wordmark.classList.add('hit');
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) return;
    this.lastBar = -1;
    this.menu.relayout();
    this.setlist.relayout();
    this.previewCurrent();
  }
}
