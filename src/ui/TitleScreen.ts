/**
 * TitleScreen — SLU · VOL. 01, the BREAK/BEAT wordmark, Continue (56 px, amber) with the next
 * movement under it, Endless / Daily / Zen tiles, Settings (44 px), and the Odyssey tracklist.
 * A faint wall strip with a blade runs along the bottom (TitleBackdrop). No tagline, no footer.
 */

import { ACTS, MOVEMENTS } from '../audio/tracks.js';
import { isUnlocked, mastery, nextMovementIndex, todayUtc, type SaveData } from '../meta/Save.js';
import { button, el, fmt, ICONS } from './dom.js';

export interface TitleActions {
  continue(): void;
  movement(index: number): void;
  endless(): void;
  daily(): void;
  zen(): void;
  settings(): void;
  calibrate(): void;
  /** True once timing has been synced or the chip dismissed */
  calibrated(): boolean;
}

const BADGE_LABEL: Record<string, string> = { BRONZE: 'BRZ', SILVER: 'SLV', GOLD: 'GLD', OBSIDIAN: 'OBS', RESONANT: 'RES' };

export class TitleScreen {
  readonly root = el('div', 'title-screen hidden', '', { role: 'main', 'aria-label': 'Title' });

  /** Act shown in the tracklist (null = the act of the next movement) */
  private act: string | null = null;
  private save: SaveData | null = null;

  constructor(private readonly actions: TitleActions) {}

  render(save: SaveData): void {
    const a = this.actions;
    this.save = save;
    const next = nextMovementIndex(save);
    const act = this.act ?? MOVEMENTS[next]!.act;
    const nm = MOVEMENTS[next]!;
    const first = !save.overtureDone;
    this.root.innerHTML = '';

    const left = el('section', 'title-left');
    left.appendChild(el('div', 'title-kicker', 'SLU · VOL. 01'));
    left.appendChild(el('h1', 'wordmark', '<span>BREAK</span><span class="beat">BEAT</span>', { 'aria-label': 'Breakbeat' }));

    const cont = button('btn-continue', `<span>${first ? 'Begin' : 'Continue'}</span>${ICONS.play}`, first ? 'Begin: Overture' : `Continue: ${nm.name}`, a.continue);
    left.appendChild(cont);
    left.appendChild(
      el('div', 'continue-sub', first ? 'OVERTURE · ABOUT 60 SECONDS' : `${nm.number} · ${nm.name.toUpperCase()} · ${nm.bpm} BPM`)
    );

    const modes = el('div', 'mode-tiles');
    const today = todayUtc();
    const daily = save.daily.date === today ? `BEST ${fmt(save.daily.best)}` : 'NEW TODAY';
    const tile = (name: string, status: string, fn: () => void): HTMLButtonElement =>
      button('mode-tile', `<span class="mode-name">${name}</span><span class="mode-status">${status}</span>`, `${name}. ${status}`, fn);
    modes.append(
      tile('Endless', save.best.endless ? `BEST ${fmt(save.best.endless)}` : 'NO BEST YET', a.endless),
      tile('Daily', daily, a.daily),
      tile('Zen', save.best.zen ? `BEST ${fmt(save.best.zen)}` : 'NO PRESSURE', a.zen)
    );
    left.appendChild(modes);
    left.appendChild(button('icon-btn title-settings', ICONS.gear, 'Settings', a.settings));
    if (save.overtureDone && !a.calibrated()) left.appendChild(button('sync-chip', 'SYNC TIMING · 10 SEC', 'Sync audio timing', a.calibrate));

    const right = el('section', 'tracklist', '', { 'aria-label': 'The Odyssey' });
    const head = el('div', 'tracklist-head', '', { role: 'tablist', 'aria-label': 'Acts' });
    head.appendChild(el('span', 'tracklist-title', 'THE ODYSSEY'));
    for (const a of ACTS) {
      const tab = button(`act-tab${a === act ? ' on' : ''}`, a === 'Coda' ? 'CODA' : `ACT ${a}`, `Act ${a}`, () => {
        this.act = a;
        if (this.save) this.render(this.save);
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(a === act));
      head.appendChild(tab);
    }
    right.appendChild(head);
    const list = el('ol', 'tracklist-rows');
    MOVEMENTS.forEach((m, i) => {
      if (m.act !== act) return;
      const unlocked = isUnlocked(save, i);
      const cleared = save.cleared.includes(m.id);
      const best = save.best[m.id] ?? 0;
      const rank = best > 0 ? mastery(best).rank : null;
      const li = el('li');
      const badge = rank ? `<span class="badge badge-${rank.toLowerCase()}" title="${rank}">${BADGE_LABEL[rank]}</span>` : `<span class="badge badge-none"></span>`;
      const label = `${m.number} ${m.name}. ${m.bpm} BPM. ${unlocked ? (rank ? `Mastery ${rank}.` : cleared ? 'Cleared.' : 'Unlocked.') : 'Locked.'}`;
      const row = button(
        `track-row${unlocked ? '' : ' locked'}${i === next && !first ? ' next' : ''}`,
        `<span class="track-num">${m.number}</span><span class="track-name">${m.name}<small>${m.style.toUpperCase()}</small></span>${badge}<span class="track-bpm">${m.bpm}</span><span class="track-lock">${unlocked ? '' : ICONS.lock}</span>`,
        label,
        () => {
          if (unlocked) a.movement(i);
        }
      );
      if (!unlocked) row.setAttribute('aria-disabled', 'true');
      li.appendChild(row);
      list.appendChild(li);
    });
    right.appendChild(list);

    this.root.append(left, right);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }
}
