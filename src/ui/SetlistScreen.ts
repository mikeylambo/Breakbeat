/**
 * SetlistScreen — The Odyssey, one act at a time. Left: the act's movements. Right: the selected
 * movement in detail (number, name, genre, tempo, key, best, mastery, its three challenges), Play and
 * Practice. Practice swaps the detail for its setup (section, tempo, wall); Enter then starts it.
 * Selection previews the movement's music and world behind the screen. ← → or [ ] turn the act, P practice.
 */

import { ACTS, MOVEMENTS } from '../audio/tracks.js';
import { t } from '../i18n/i18n.js';
import { challengesFor, starCount } from '../meta/Progress.js';
import { isUnlocked, mastery, nextMovementIndex, odysseyComplete, type SaveData } from '../meta/Save.js';
import { bsideKey, twistFor } from '../meta/Remix.js';
import { readJson, writeJson } from '../platform/Storage.js';
import { hex } from '../render/palette.js';
import { worldFor } from '../render/worlds.js';
import { announce, button, el, fmt, ICONS, uiSound } from './dom.js';
import { PRACTICE_TEMPOS, PRACTICE_WALLS, type PracticeSetup } from '../meta/Practice.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { SleeveLayer } from './SleeveLayer.js';

export interface SetlistActions {
  play(index: number): void;
  practise(index: number, setup: PracticeSetup): void;
  /** Play the movement's B-side (Remix) */
  remix(index: number): void;
  preview(index: number): void;
  back(): void;
}

/** "Act I" / "Coda" in the current language. */
export const actName = (a: string): string => (a === 'Coda' ? t('sl.coda') : t('sl.act', { n: a }));

/** The last practice setup, so "Practise" picks up where you left off (per device). */
const PRACTICE_KEY = 'breakbeat-practice';
const loadSetup = (): PracticeSetup => ({ section: 0, tempo: 0.8, wall: 'rising', ...readJson<Partial<PracticeSetup>>(PRACTICE_KEY, {}) });

const BADGE_LABEL: Record<string, string> = { BRONZE: 'BRZ', SILVER: 'SLV', GOLD: 'GLD', OBSIDIAN: 'OBS', RESONANT: 'RES' };

export class SetlistScreen {
  readonly root = el('div', 'setlist-screen hidden', '', { role: 'main', 'aria-label': t('sl.title') });
  private readonly list: MenuList;
  private readonly acts = el('div', 'act-tabs', '', { role: 'tablist', 'aria-label': t('sl.acts') });
  private readonly detail = el('section', 'sl-detail', '', { 'aria-live': 'polite' });
  private readonly sleeve = new SleeveLayer();
  private act: string = ACTS[0];
  private save: SaveData | null = null;
  private selected = 0;
  /** The practice setup panel is showing for the selected movement */
  private practising = false;
  private setup = loadSetup();
  /** Showing the B-sides (open once the Odyssey is complete) */
  private bside = false;
  private readonly sideTabs = el('div', 'side-tabs', '', { role: 'tablist', 'aria-label': t('rx.sides') });

  constructor(private readonly a: SetlistActions) {
    this.list = new MenuList({
      cls: 'setlist',
      active: () => this.visible,
      onSelect: (_, it) => this.onSelect(Number(it.id)),
      onKey: (e, m) => {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          uiSound('back');
          if (this.practising) this.showPractice(false);
          else this.a.back();
          return true;
        }
        if ((e.key === 'b' || e.key === 'B') && !e.repeat && this.save && odysseyComplete(this.save)) {
          this.setSide(!this.bside);
          return true;
        }
        if ((e.key === 'p' || e.key === 'P') && !e.repeat && !this.bside && this.save && isUnlocked(this.save, this.selected)) {
          uiSound('pick');
          this.showPractice(!this.practising);
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
    head.append(el('h2', 'sl-title', t('sl.title')), this.acts, this.sideTabs);
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

  /** Opens on the act of `index` with it selected; `practice` opens its practice setup. */
  open(save: SaveData, index = nextMovementIndex(save), practice = false): void {
    this.save = save;
    this.practising = practice && isUnlocked(save, index);
    if (!odysseyComplete(save) || practice) this.bside = false;
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

  private setSide(b: boolean): void {
    this.bside = b;
    this.practising = false;
    uiSound('move', b ? 3 : 1);
    this.root.classList.toggle('bside', b);
    this.renderList(MOVEMENTS.filter(m => m.act === this.act).indexOf(MOVEMENTS[this.selected]!));
    announce(b ? t('rx.sayB') : t('rx.sayA'));
  }

  private renderList(index: number): void {
    const save = this.save;
    if (!save) return;
    const next = nextMovementIndex(save);
    const complete = odysseyComplete(save);
    this.sideTabs.hidden = !complete;
    this.sideTabs.innerHTML = '';
    if (complete)
      for (const b of [false, true]) {
        const tab = button(`act-tab side-tab${b === this.bside ? ' on' : ''}`, b ? t('rx.bside').toUpperCase() : t('rx.aside'), b ? t('rx.bside') : t('rx.aside'), () => b !== this.bside && this.setSide(b));
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(b === this.bside));
        this.sideTabs.appendChild(tab);
      }
    this.root.classList.toggle('bside', this.bside);
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
      if (this.bside) {
        const best = save.best[bsideKey(m.id)] ?? 0;
        const rank = best > 0 ? mastery(best).rank : null;
        const done = save.bsides.includes(m.id);
        const twist = t(`rx.twist.${twistFor(m, i)}`);
        items.push({
          id: String(i),
          label: `${m.number} ${m.name}, ${t('rx.bside')}: ${twist}.${done ? ` ${t('et.solvedAria')}` : ''}`,
          cls: 'track-row',
          action: () => this.a.remix(i),
          html: `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${twist.toUpperCase()}</small></span><span class="track-stars" aria-hidden="true">${done ? '✓' : ''}</span>${rank ? `<span class="badge badge-${rank.toLowerCase()}">${BADGE_LABEL[rank]}</span>` : '<span class="badge badge-none"></span>'}<span class="track-lock"></span>`
        });
        return;
      }
      const best = save.best[m.id] ?? 0;
      const rank = best > 0 ? mastery(best).rank : null;
      const sc = starCount(save.stars[m.id]);
      items.push({
        id: String(i),
        label: `${m.number} ${m.name}. ${unlocked ? `${m.style}, ${m.bpm} BPM.` : t('sl.locked')}`,
        cls: `track-row${i === next && save.overtureDone ? ' next' : ''}`,
        locked: !unlocked,
        action: () => (this.practising ? this.startPractice(i) : this.a.play(i)),
        html: `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${unlocked ? m.style.toUpperCase() : t('sl.lockedTag')}</small></span><span class="track-stars" aria-hidden="true">${unlocked ? `${'★'.repeat(sc)}<s>${'★'.repeat(3 - sc)}</s>` : ''}</span>${rank ? `<span class="badge badge-${rank.toLowerCase()}">${BADGE_LABEL[rank]}</span>` : '<span class="badge badge-none"></span>'}<span class="track-lock">${unlocked ? '' : ICONS.lock}</span>`
      });
    });
    this.list.setItems(items, Math.max(0, Math.min(items.length - 1, index)));
  }

  private onSelect(i: number): void {
    const save = this.save;
    if (!save) return;
    if (i !== this.selected && this.practising && !isUnlocked(save, i)) this.practising = false;
    this.selected = i;
    const m = MOVEMENTS[i]!;
    const unlocked = isUnlocked(save, i);
    this.sleeve.set(m, !unlocked);
    const accent = hex(worldFor(m.style).accent);
    this.root.style.setProperty('--sel-accent', accent);
    (this.root.querySelector('.sl-ghost') as HTMLElement).textContent = m.number;
    if (this.bside) return this.renderBside(i);
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
      if (this.practising) this.renderPractice(i);
      else {
        const row = el('div', 'bt-actions');
        row.append(
          button('btn btn-primary sld-play', `${ICONS.play}<span>${t('title.play')}</span>`, t('et.playAria', { name: m.name }), () => {
            uiSound('pick');
            this.a.play(i);
          }),
          button('btn bt-btn', t('pr.practise'), t('pr.practiseAria', { name: m.name }), () => {
            uiSound('pick');
            this.showPractice(true);
          })
        );
        this.detail.appendChild(row);
      }
      this.a.preview(i);
    }
  }

  /** A B-side in detail: its twist in place of the challenges, its own best, and Play. */
  private renderBside(i: number): void {
    const save = this.save!;
    const m = MOVEMENTS[i]!;
    const twist = twistFor(m, i);
    const best = save.best[bsideKey(m.id)] ?? 0;
    const ms = mastery(best);
    const done = save.bsides.includes(m.id);
    this.detail.innerHTML = `
      <div class="sld-kicker">${t('rx.bside').toUpperCase()} · ${actName(m.act).toUpperCase()} · ${m.number}</div>
      <div class="sld-name">${m.name}</div>
      <div class="sld-meta"><span>${m.style.toUpperCase()}</span><span>${m.bpm} BPM</span><span>${t('sl.key', { key: m.key.toUpperCase() })}</span></div>
      <div class="sld-best"><div><small>${t('sl.best')}</small><b>${best ? fmt(best) : '—'}</b></div>${best ? `<span class="badge badge-${ms.rank.toLowerCase()}">${ms.rank}</span>` : ''}</div>
      <div class="rx-twist"><b>${t(`rx.twist.${twist}`)}</b><span>${t(`rx.desc.${twist}`)}</span>${done ? `<small>✓ ${t('rx.clearedTag')}</small>` : ''}</div>`;
    this.detail.appendChild(
      button('btn btn-primary sld-play', `${ICONS.play}<span>${t('title.play')}</span>`, t('rx.playAria', { name: m.name }), () => {
        uiSound('pick');
        this.a.remix(i);
      })
    );
    this.a.preview(i);
  }

  private showPractice(on: boolean): void {
    this.practising = on;
    this.onSelect(this.selected);
    if (on) announce(t('pr.sayOpen', { name: MOVEMENTS[this.selected]!.name }));
  }

  /** The practice setup in place of the challenges: section, tempo and wall, then Start. */
  private renderPractice(i: number): void {
    const m = MOVEMENTS[i]!;
    const s = this.setup;
    s.section = Math.min(s.section, m.sections.length - 1);
    // The setup takes the place of the challenges and the best score
    this.detail.querySelector('.sld-ch')?.remove();
    this.detail.querySelector('.sld-best')?.remove();
    const panel = el('div', 'pr-panel', '', { role: 'group', 'aria-label': t('pr.title') });
    const seg = <V extends string | number>(label: string, opts: readonly (readonly [V, string])[], get: () => V, set: (v: V) => void): HTMLElement => {
      const row = el('div', 'pr-row');
      const g = el('div', 'segmented', '', { role: 'radiogroup', 'aria-label': label });
      for (const [v, l] of opts) {
        const b = button(`seg${get() === v ? ' on' : ''}`, l, `${label}: ${l}`, () => {
          set(v);
          writeJson(PRACTICE_KEY, s);
          uiSound('tick', opts.findIndex(o => o[0] === v));
          this.onSelect(i);
        });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(get() === v));
        g.appendChild(b);
      }
      row.append(el('small', 'pr-label', label), g);
      return row;
    };
    panel.append(
      el('div', 'pr-kicker', t('pr.title').toUpperCase()),
      seg(t('pr.section'), m.sections.map((x, k) => [k, x.name] as const), () => s.section, v => (s.section = v)),
      seg(t('bt.tempo'), PRACTICE_TEMPOS.map(v => [v, `${Math.round(v * 100)}%`] as const), () => s.tempo, v => (s.tempo = v)),
      seg(t('pr.wall'), PRACTICE_WALLS.map(w => [w, t(`pr.wall.${w}`)] as const), () => s.wall, v => (s.wall = v)),
      el('div', 'pr-note', `${Math.round(m.bpm * s.tempo)} BPM · ${t(`pr.wallNote.${s.wall}`)}`)
    );
    const row = el('div', 'bt-actions');
    row.append(
      button('btn btn-primary sld-play', `${ICONS.play}<span>${t('pr.start')}</span>`, t('pr.startAria', { name: m.name }), () => this.startPractice(i)),
      button('btn bt-btn', t('ee.back'), t('pr.backAria'), () => {
        uiSound('back');
        this.showPractice(false);
      })
    );
    this.detail.append(panel, row);
  }

  private startPractice(i: number): void {
    uiSound('pick');
    writeJson(PRACTICE_KEY, this.setup);
    this.a.practise(i, { ...this.setup });
  }
}
