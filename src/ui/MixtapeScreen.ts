/**
 * MixtapeScreen — build a tape and play it. Left: every movement (locked ones can't be added).
 * Right: the tape in play order with its running time and best, then Play, Shuffle and Clear.
 * Enter adds the selected movement (up to MIXTAPE_MAX), Backspace / Delete removes the last track,
 * S shuffles, P plays (two tracks or more), Esc back. The last tape is remembered on this device.
 */

import { MOVEMENTS } from '../audio/tracks.js';
import { t } from '../i18n/i18n.js';
import { MIXTAPE_MAX, MIXTAPE_MIN, tapeKey, tapeSeconds } from '../meta/Mixtape.js';
import { isUnlocked, type SaveData } from '../meta/Save.js';
import { readJson, writeJson } from '../platform/Storage.js';
import { announce, button, el, fmt, ICONS, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';

export interface MixtapeActions {
  play(list: number[]): void;
  preview(index: number): void;
  back(): void;
}

const KEY = 'breakbeat-mixtape';

export class MixtapeScreen {
  readonly root = el('div', 'setlist-screen mixtape-screen hidden', '', { role: 'main', 'aria-label': t('title.mixtape') });
  private readonly list: MenuList;
  private readonly detail = el('section', 'sl-detail mx-detail', '', { 'aria-live': 'polite' });
  private save: SaveData | null = null;
  private tape: number[] = [];

  constructor(private readonly a: MixtapeActions) {
    this.list = new MenuList({
      cls: 'setlist',
      active: () => this.visible,
      onSelect: (_, it) => this.a.preview(Number(it.id)),
      onKey: e => this.onKey(e)
    });
    const head = el('div', 'sl-head');
    head.append(el('h2', 'sl-title', t('title.mixtape')));
    const left = el('section', 'sl-left');
    left.append(head, this.list.root);
    this.root.append(el('div', 'sl-panel', '', { 'aria-hidden': 'true' }), left, this.detail, el('div', 'sl-foot', t('mx.keys')));
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(save: SaveData): void {
    this.save = save;
    const kept = readJson<number[]>(KEY, []);
    this.tape = Array.isArray(kept) ? kept.filter(i => Number.isInteger(i) && i >= 0 && i < MOVEMENTS.length && isUnlocked(save, i)).slice(0, MIXTAPE_MAX) : [];
    this.root.classList.remove('hidden');
    this.renderList();
    this.renderTape();
    this.list.relayout();
    announce(t('mx.sayOpen'));
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      uiSound('back');
      this.a.back();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.removeLast();
      return true;
    }
    if (e.repeat) return false;
    if (e.key === 's' || e.key === 'S') {
      this.shuffle();
      return true;
    }
    if (e.key === 'p' || e.key === 'P') {
      this.play();
      return true;
    }
    return false;
  }

  private renderList(): void {
    const save = this.save;
    if (!save) return;
    const items: MenuItem[] = MOVEMENTS.map((m, i) => {
      const open = isUnlocked(save, i);
      return {
        id: String(i),
        label: `${m.number} ${m.name}. ${open ? `${m.style}, ${m.bpm} BPM. ${t('mx.addAria')}` : t('sl.locked')}`,
        cls: 'track-row',
        locked: !open,
        action: () => this.add(i),
        html: `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${open ? `${m.style.toUpperCase()} · ${m.bpm} BPM` : t('sl.lockedTag')}</small></span><span class="mx-count" aria-hidden="true"></span><span></span><span class="track-lock">${open ? '' : ICONS.lock}</span>`
      };
    });
    this.list.setItems(items, Math.max(0, this.list.index));
    this.markCounts();
  }

  /** Each movement row shows how many times it is on the tape. */
  private markCounts(): void {
    this.list.root.querySelectorAll('.menu-item').forEach((row, i) => {
      const n = this.tape.filter(x => x === i).length;
      const c = row.querySelector('.mx-count');
      if (c) c.textContent = n ? `×${n}` : '';
    });
  }

  private renderTape(): void {
    const save = this.save!;
    const n = this.tape.length;
    const secs = tapeSeconds(this.tape, MOVEMENTS);
    const best = n >= MIXTAPE_MIN ? (save.best[tapeKey(this.tape, MOVEMENTS)] ?? 0) : 0;
    this.detail.innerHTML = `
      <div class="sld-kicker">${t('mx.kicker', { n, max: MIXTAPE_MAX })}</div>
      <div class="sld-name">${t('mx.yourTape')}</div>
      <div class="sld-meta"><span>${n ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : '0:00'}</span><span>${best ? `${t('sl.best')} ${fmt(best)}` : `${t('sl.best')} —`}</span></div>`;
    const ol = el('ol', 'mx-tape');
    if (!n) ol.appendChild(el('li', 'mx-empty', t('mx.empty')));
    this.tape.forEach((i, k) => {
      const m = MOVEMENTS[i]!;
      const li = el('li', 'mx-track');
      li.append(
        el('span', 'mx-pos', String(k + 1).padStart(2, '0')),
        el('span', 'mx-name', `${m.name}<small>${m.bpm} BPM</small>`),
        button('icon-btn mx-remove', ICONS.close, t('mx.removeAria', { name: m.name }), () => this.remove(k))
      );
      ol.appendChild(li);
    });
    const row = el('div', 'bt-actions');
    const play = button('btn btn-primary sld-play', `${ICONS.play}<span>${t('title.play')}</span>`, t('mx.playAria'), () => this.play());
    if (n < MIXTAPE_MIN) play.setAttribute('aria-disabled', 'true');
    row.append(play, button('btn bt-btn', t('mx.shuffle'), t('mx.shuffle'), () => this.shuffle()), button('btn bt-btn', t('profile.clear'), t('mx.clearAria'), () => this.clear()));
    this.detail.append(ol, row);
    this.markCounts();
  }

  private changed(): void {
    writeJson(KEY, this.tape);
    this.renderTape();
  }

  private add(i: number): void {
    if (this.tape.length >= MIXTAPE_MAX) {
      uiSound('deny');
      announce(t('mx.full', { max: MIXTAPE_MAX }));
      return;
    }
    this.tape.push(i);
    uiSound('pick', this.tape.length % 4);
    announce(t('mx.sayAdded', { name: MOVEMENTS[i]!.name, n: this.tape.length }));
    this.changed();
  }

  private remove(k: number): void {
    const [i] = this.tape.splice(k, 1);
    if (i === undefined) return;
    uiSound('back');
    announce(t('mx.sayRemoved', { name: MOVEMENTS[i]!.name }));
    this.changed();
  }

  private removeLast(): void {
    if (this.tape.length) this.remove(this.tape.length - 1);
  }

  private shuffle(): void {
    if (this.tape.length < 2) return;
    for (let k = this.tape.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [this.tape[k], this.tape[j]] = [this.tape[j]!, this.tape[k]!];
    }
    uiSound('tick', 2);
    announce(t('mx.sayShuffled'));
    this.changed();
  }

  private clear(): void {
    this.tape = [];
    uiSound('back');
    this.changed();
  }

  private play(): void {
    if (this.tape.length < MIXTAPE_MIN) {
      uiSound('deny');
      announce(t('mx.needTwo'));
      return;
    }
    uiSound('pick');
    this.a.play([...this.tape]);
  }
}
