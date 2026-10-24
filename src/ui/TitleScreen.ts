/**
 * TitleScreen — the main menu (mode select). Angled slabs on the right (Continue, Odyssey, Endless,
 * Daily, Zen, Etudes, Tutorial & Tips, Profile, Settings), the selected mode's name huge and tilted
 * behind them, Odyssey progress on the left, a one-line description and key hints along the bottom.
 * Whatever is selected is previewed live: its music and world play behind the menu.
 */

import { t } from '../i18n/i18n.js';
import { listenQueue } from './ListenScreen.js';
import { MOVEMENTS } from '../audio/tracks.js';
import { starCount, totalStars } from '../meta/Progress.js';
import { nextMovementIndex, todayUtc, type SaveData } from '../meta/Save.js';
import type { GameMode } from '../tuning.js';
import { el, fmt, setText, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { SleeveLayer } from './SleeveLayer.js';
import { LOGO_HTML } from './logo.js';
import type { TrackDef } from '../audio/tracks.js';

export interface TitleActions {
  continue(): void;
  odyssey(): void;
  endless(): void;
  daily(): void;
  zen(): void;
  etudes(): void;
  listen(): void;
  beats(): void;
  /** Songs on the My Beats shelf (for the row's count) */
  beatsCount(): number;
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
  readonly root = el('div', 'title-screen hidden', '', { role: 'main', 'aria-label': t('title.menu') });
  private readonly menu: MenuList;
  private readonly ghost = el('div', 'mm-ghost', '', { 'aria-hidden': 'true' });
  private readonly desc = el('div', 'mm-desc', '', { 'aria-live': 'polite' });
  private readonly stats = el('div', 'mm-stats');
  private readonly nowPlaying = el('div', 'now-playing', '', { 'aria-hidden': 'true' });
  private readonly npText = el('span', 'np-text');
  private readonly sync = el('div', 'mm-sync');
  private readonly sleeve = new SleeveLayer();
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
    head.innerHTML = `<div class="mm-mark">${LOGO_HTML}</div>`;
    const eq = el('span', 'np-eq', '<i></i><i></i><i></i><i></i>');
    this.nowPlaying.append(eq, this.npText);
    const foot = el('div', 'mm-foot');
    foot.append(this.desc, el('div', 'mm-keys', '<b>↑ ↓</b>SELECT<b>ENTER</b>CONFIRM<b>ESC</b>BACK'));
    const panel = el('div', 'mm-panel', '', { 'aria-hidden': 'true' });
    panel.appendChild(this.sleeve.root);
    this.root.append(panel, this.ghost, head, this.stats, this.nowPlaying, this.sync, this.menu.root, foot);
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
        name: first ? t('title.begin') : t('title.continue'),
        meta: first ? t('title.overtureMeta') : `${nm.number} · ${nm.name.toUpperCase()}`,
        desc: first ? t('title.beginDesc') : t('title.continueDesc', { num: nm.number, name: nm.name, bpm: nm.bpm }),
        ghost: first ? t('title.begin') : t('title.play'),
        cls: 'btn-continue',
        action: a.continue
      },
      { id: 'odyssey', name: t('title.odyssey'), meta: `${cleared}/${MOVEMENTS.length}`, desc: t('title.odysseyDesc'), ghost: t('title.odyssey'), action: a.odyssey },
      { id: 'endless', name: t('title.endless'), meta: save.best.endless ? fmt(save.best.endless) : '—', desc: t('title.endlessDesc'), ghost: t('title.endless'), action: a.endless },
      { id: 'daily', name: t('title.daily'), meta: save.daily.date === today ? fmt(save.daily.best) : t('title.new'), desc: t('title.dailyDesc'), ghost: t('title.daily'), cls: save.daily.date === today ? '' : 'fresh', action: a.daily },
      { id: 'zen', name: t('title.zen'), meta: save.best.zen ? fmt(save.best.zen) : '—', desc: t('title.zenDesc'), ghost: t('title.zen'), action: a.zen },
      { id: 'etudes', name: t('title.etudes'), meta: `${save.etudes.length}/8`, desc: t('title.etudesDesc'), ghost: t('title.etudes'), action: a.etudes },
      { id: 'listen', name: t('title.listen'), meta: `${listenQueue(save).length}/${MOVEMENTS.length + 1}`, desc: t('title.listenDesc'), ghost: t('title.listen'), action: a.listen },
      { id: 'beats', name: t('title.beats'), meta: a.beatsCount() ? String(a.beatsCount()) : t('title.new'), desc: t('title.beatsDesc'), ghost: t('title.beatsGhost'), cls: a.beatsCount() ? '' : 'fresh', action: a.beats },
      { id: 'tutorial', name: t('title.tutorial'), meta: '', desc: t('title.tutorialDesc'), ghost: t('title.tutorialGhost'), cls: 'quiet', action: a.tutorial },
      { id: 'profile', name: t('title.profile'), meta: '', desc: t('title.profileDesc'), ghost: t('title.profile'), cls: 'quiet', action: a.profile },
      { id: 'settings', name: t('title.settings'), meta: '', desc: t('title.settingsDesc'), ghost: t('title.settings'), cls: 'quiet', action: a.settings }
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
    this.stats.innerHTML = `<div class="mm-stat-label">${t('title.odysseyComplete')}</div><div class="mm-pct">${pct}<small>%</small></div><div class="mm-stat-row"><span><b>★ ${stars}</b> / ${MOVEMENTS.length * 3}</span><span><b>${fmt(save.runs)}</b> ${t('title.runs')}</span><span><b>${MOVEMENTS.filter(m => starCount(save.stars[m.id]) === 3).length}</b> ${t('title.mastered')}</span></div>`;

    this.sync.innerHTML = '';
    if (save.overtureDone && !a.calibrated()) {
      const b = el('button', 'util-btn sync-chip', `<span>${t('title.syncTiming')}</span><b>${t('title.sec10')}</b>`, { type: 'button', 'aria-label': t('title.syncLabel') });
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

  /** The sleeve of whatever is playing behind the menu. */
  setSleeve(track: TrackDef | null): void {
    this.sleeve.set(track);
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
