/**
 * SetlistScreen — The Odyssey, one act at a time. Left: the act's movements. Right: the selected
 * movement in detail (number, name, genre, tempo, key, best, mastery, its three challenges) and Play.
 * Selection previews the movement's music and world behind the screen. ← → or [ ] turn the act.
 */

import { ACTS, MOVEMENTS } from '../audio/tracks.js';
import { t } from '../i18n/i18n.js';
import { challengesFor, starCount } from '../meta/Progress.js';
import { isUnlocked, mastery, nextMovementIndex, type SaveData } from '../meta/Save.js';
import { hex } from '../render/palette.js';
import { worldFor } from '../render/worlds.js';
import { button, el, fmt, ICONS, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { SleeveLayer } from './SleeveLayer.js';

export interface SetlistActions {
  play(index: number): void;
  preview(index: number): void;
  back(): void;
}

/** "Act I" / "Coda" in the current language. */
export const actName = (a: string): string => (a === 'Coda' ? t('sl.coda') : t('sl.act', { n: a }));

const BADGE_LABEL: Record<string, string> = { BRONZE: 'BRZ', SILVER: 'SLV', GOLD: 'GLD', OBSIDIAN: 'OBS', RESONANT: 'RES' };

export class SetlistScreen {
  readonly root = el('div', 'setlist-screen hidden', '', { role: 'main', 'aria-label': t('sl.title') });
  private readonly list: MenuList;
  private readonly acts = el('div', 'act-tabs', '', { role: 'tablist', 'aria-label': t('sl.acts') });
  private readonly detail = el('section', 'sl-detail', '', { 'aria-live': 'polite' });
  private readonly sleeve = new SleeveLayer();
  private act: string = ACTS[0];
  private save: SaveData | null = null;

  constructor(private readonly a: SetlistActions) {
    this.list = new MenuList({
      cls: 'setlist',
      active: () => this.visible,
      onSelect: (_, it) => this.onSelect(Number(it.id)),
      onKey: (e, m) => {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          uiSound('back');
          this.a.back();
          return true;
        }
        const n = m.items.length;
        const step =
          e.key === 'ArrowRight' || e.key === ']' || e.key === 'PageDown' || (e.key === 'ArrowDown' && m.index === n - 1)
            ? 1
            : e.key === 'ArrowLeft' || e.key === '[' || e.key === 'PageUp' || (e.key === 'ArrowUp' && m.index === 0)
              ? -1
              : 0;
        if (!step) return false;
        const k = (ACTS.indexOf(this.act as (typeof ACTS)[number]) + step + ACTS.length) % ACTS.length;
        const count = MOVEMENTS.filter(x => x.act === ACTS[k]).length;
        this.setAct(ACTS[k]!, e.key === 'ArrowUp' ? count - 1 : 0);
        return true;
      }
    });
    const head = el('div', 'sl-head');
    head.append(el('h2', 'sl-title', t('sl.title')), this.acts);
    const left = el('section', 'sl-left');
    left.append(head, this.list.root);
    const foot = el('div', 'sl-foot', t('sl.keys'));
    const panel = el('div', 'sl-panel', '', { 'aria-hidden': 'true' });
    panel.appendChild(this.sleeve.root);
    this.root.append(panel, el('div', 'sl-ghost', '', { 'aria-hidden': 'true' }), left, this.detail, foot);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Opens on the act of `index` with it selected. */
  open(save: SaveData, index = nextMovementIndex(save)): void {
    this.save = save;
    this.act = MOVEMENTS[index]!.act;
    this.root.classList.remove('hidden');
    this.renderList(MOVEMENTS.filter(m => m.act === this.act).indexOf(MOVEMENTS[index]!));
    this.list.relayout();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private setAct(act: string, at: number): void {
    this.act = act;
    uiSound('move', 2);
    this.renderList(at);
  }

  private renderList(index: number): void {
    const save = this.save;
    if (!save) return;
    const next = nextMovementIndex(save);
    this.acts.innerHTML = '';
    for (const a of ACTS) {
      const tab = button(`act-tab${a === this.act ? ' on' : ''}`, actName(a).toUpperCase(), actName(a), () => this.setAct(a, 0));
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(a === this.act));
      this.acts.appendChild(tab);
    }
    const items: MenuItem[] = [];
    MOVEMENTS.forEach((m, i) => {
      if (m.act !== this.act) return;
      const unlocked = isUnlocked(save, i);
      const best = save.best[m.id] ?? 0;
      const rank = best > 0 ? mastery(best).rank : null;
      const sc = starCount(save.stars[m.id]);
      items.push({
        id: String(i),
        label: `${m.number} ${m.name}. ${unlocked ? `${m.style}, ${m.bpm} BPM.` : t('sl.locked')}`,
        cls: `track-row${i === next && save.overtureDone ? ' next' : ''}`,
        locked: !unlocked,
        action: () => this.a.play(i),
        html: `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${unlocked ? m.style.toUpperCase() : t('sl.lockedTag')}</small></span><span class="track-stars" aria-hidden="true">${unlocked ? `${'★'.repeat(sc)}<s>${'★'.repeat(3 - sc)}</s>` : ''}</span>${rank ? `<span class="badge badge-${rank.toLowerCase()}">${BADGE_LABEL[rank]}</span>` : '<span class="badge badge-none"></span>'}<span class="track-lock">${unlocked ? '' : ICONS.lock}</span>`
      });
    });
    this.list.setItems(items, Math.max(0, Math.min(items.length - 1, index)));
  }

  private onSelect(i: number): void {
    const save = this.save;
    if (!save) return;
    const m = MOVEMENTS[i]!;
    const unlocked = isUnlocked(save, i);
    this.sleeve.set(m, !unlocked);
    const accent = hex(worldFor(m.style).accent);
    this.root.style.setProperty('--sel-accent', accent);
    (this.root.querySelector('.sl-ghost') as HTMLElement).textContent = m.number;
    const best = save.best[m.id] ?? 0;
    const ms = mastery(best);
    const mask = save.stars[m.id] ?? 0;
    const ch = challengesFor(m, i)
      .map((c, k) => `<li class="${mask & (1 << k) ? 'done' : ''}"><i>${mask & (1 << k) ? '★' : '☆'}</i>${c.label}</li>`)
      .join('');
    this.detail.innerHTML = `
      <div class="sld-kicker">${actName(m.act).toUpperCase()} · ${m.number}</div>
      <div class="sld-name">${m.name}</div>
      <div class="sld-meta"><span>${m.style.toUpperCase()}</span><span>${m.bpm} BPM</span><span>${t('sl.key', { key: m.key.toUpperCase() })}</span></div>
      ${
        unlocked
          ? `<div class="sld-best"><div><small>${t('sl.best')}</small><b>${best ? fmt(best) : '—'}</b></div>${best ? `<span class="badge badge-${ms.rank.toLowerCase()}">${ms.rank}</span>` : ''}</div>
             <ul class="sld-ch">${ch}</ul>`
          : `<div class="sld-locked">${ICONS.lock}<span>${t('sl.unlock', { num: MOVEMENTS[i - 1]?.number ?? '', name: MOVEMENTS[i - 1]?.name ?? '' })}</span></div>`
      }`;
    if (unlocked) {
      const play = button('btn btn-primary sld-play', `${ICONS.play}<span>${t('title.play')}</span>`, t('et.playAria', { name: m.name }), () => {
        uiSound('pick');
        this.a.play(i);
      });
      this.detail.appendChild(play);
      this.a.preview(i);
    }
  }
}
