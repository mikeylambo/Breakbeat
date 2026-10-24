/** ProfileSheet — three tabs: Stats (lifetime, challenges, playtest log), Achievements, Locker (blade + debris). ← → switch. */

import { t as tr, tn, tx } from '../i18n/i18n.js';
import { MOVEMENTS } from '../audio/tracks.js';
import { UNLOCKS, isUnlocked, starCount, totalStars, challengesFor } from '../meta/Progress.js';
import { mastery, type SaveData } from '../meta/Save.js';
import { ACHIEVEMENTS, type AchContext } from '../meta/Achievements.js';
import { button, el, fmt, ICONS, uiSound } from './dom.js';
import { clear as clearPlaytest, exportFile, runs as playtestRuns } from '../meta/Playtest.js';

export interface ProfileHost {
  save: SaveData;
  persist(): void;
}

function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export class ProfileSheet {
  readonly root = el('div', 'sheet-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Profile' });
  private readonly body = el('div', 'profile-body');
  private readonly tabs = el('div', 'set-tabs', '', { role: 'tablist', 'aria-label': 'Profile' });
  private tab: 'Stats' | 'Achievements' | 'Locker' = 'Stats';
  open = false;

  constructor(private readonly host: ProfileHost) {
    const card = el('div', 'sheet profile-sheet');
    const head = el('div', 'settings-head');
    head.append(el('div', 'sheet-title', tr('profile.title')), this.tabs, button('icon-btn settings-close', ICONS.close, 'Close profile', () => this.show(false)));
    card.append(head, this.body);
    this.root.appendChild(card);
    this.root.addEventListener('click', e => {
      if (e.target === this.root) this.show(false);
    });
    window.addEventListener('keydown', e => {
      if (this.open && e.key === 'Escape') this.show(false);
      else if (this.open && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const order = ['Stats', 'Achievements', 'Locker'] as const;
        this.tab = order[(order.indexOf(this.tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]!;
        uiSound('move', order.indexOf(this.tab));
        this.render();
      }
    });
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.render();
  }

  private render(): void {
    const save = this.host.save;
    const st = save.stats;
    const stars = totalStars(save);
    const max = MOVEMENTS.length * 3;
    this.body.innerHTML = '';
    this.tabs.innerHTML = '';
    for (const t of ['Stats', 'Achievements', 'Locker'] as const) {
      const b = button(`set-tab${t === this.tab ? ' on' : ''}`, t === 'Achievements' ? `${tr('profile.achievements')} ${save.achievements.length}/${ACHIEVEMENTS.length}` : tr(t === 'Stats' ? 'profile.stats' : 'profile.locker'), t, () => {
        this.tab = t;
        this.render();
      });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === this.tab));
      this.tabs.appendChild(b);
    }
    if (this.tab === 'Achievements') return this.renderAchievements();

    const left = el('section', 'profile-col');
    left.appendChild(el('div', 'set-group', tr('profile.lifetime')));
    const grid = el('div', 'stat-grid');
    const stat = (label: string, value: string): void => {
      grid.appendChild(el('div', 'pstat', `<div class="pstat-v">${value}</div><div class="pstat-l">${label}</div>`));
    };
    stat(tr('profile.runs'), fmt(save.runs));
    stat(tr('profile.playTime'), duration(st.playSec));
    stat(tr('profile.groups'), fmt(st.groups));
    stat(tr('profile.allClears'), fmt(st.allClears));
    stat(tr('profile.overcharges'), fmt(st.overcharges));
    stat(tr('profile.airPrimes'), fmt(st.airPrimes));
    stat(tr('profile.bestChain'), fmt(st.bestChain));
    stat(tr('profile.bestPass'), fmt(st.bestPass));
    left.appendChild(grid);
    left.appendChild(el('div', 'set-group', tr('profile.challenges')));
    const next = MOVEMENTS.map((m, i) => ({ m, i, mask: save.stars[m.id] ?? 0 })).find(x => starCount(x.mask) < 3 && save.cleared.length >= x.i);
    const ch = el('div', 'profile-challenges');
    ch.innerHTML = `<div class="stars-total">★ ${stars} <span>/ ${max}</span></div>`;
    if (next) {
      const list = challengesFor(next.m, next.i)
        .map((c, k) => `<li class="${next.mask & (1 << k) ? 'done' : ''}">${next.mask & (1 << k) ? '★' : '☆'} ${c.label}</li>`)
        .join('');
      ch.innerHTML += `<div class="ch-next">${next.m.number} · ${next.m.name.toUpperCase()}</div><ul class="ch-list">${list}</ul>`;
    }
    left.appendChild(ch);

    // Playtest log: recent runs with device timing and replays, exported as a file on request
    const log = el('div', 'pt-row');
    const n = playtestRuns().length;
    log.append(
      el('div', 'pt-copy', `<b>${tr('profile.playtest')}</b><span>${tn('profile.playtestRuns', n)}</span>`),
      button('btn bt-btn pt-btn', tr('profile.export'), 'Export the playtest log as a file', () => {
        uiSound('pick');
        exportFile({ save: { runs: save.runs, cleared: save.cleared, best: save.best, stats: save.stats } });
      }),
      button('btn bt-btn pt-btn', tr('profile.clear'), 'Clear the playtest log', () => {
        clearPlaytest();
        uiSound('back');
        this.render();
      })
    );
    left.appendChild(log);

    const right = el('section', 'profile-col');
    for (const kind of ['blade', 'shard'] as const) {
      right.appendChild(el('div', 'set-group', kind === 'blade' ? tr('profile.blade') : tr('profile.debris')));
      const row = el('div', 'locker');
      const current = save.equipped[kind];
      const auto = button(`lock-item${current === 'auto' ? ' on' : ''}`, `<span>${tr('profile.movement')}</span><small>${tr('profile.auto')}</small>`, `${kind}: match the movement`, () => this.equip(kind, 'auto'));
      row.appendChild(auto);
      for (const u of UNLOCKS.filter(x => x.kind === kind)) {
        const ok = isUnlocked(save, u);
        const b = button(
          `lock-item${current === u.id ? ' on' : ''}${ok ? '' : ' locked'}`,
          `<span>${u.name}</span><small>${ok ? tr('profile.unlocked') : `★ ${u.stars}`}</small>`,
          ok ? `${kind}: ${u.name}` : `${u.name}, locked, needs ${u.stars} stars`,
          () => {
            if (ok) this.equip(kind, u.id);
          }
        );
        if (!ok) b.setAttribute('aria-disabled', 'true');
        row.appendChild(b);
      }
      right.appendChild(row);
    }
    right.appendChild(el('div', 'locker-note', tr('profile.lockerNote')));
    this.body.classList.remove('ach-body');
    this.body.append(this.tab === 'Stats' ? left : right);
  }

  private renderAchievements(): void {
    const save = this.host.save;
    const ctx: AchContext = { save, movements: MOVEMENTS, rankOf: sc => mastery(sc).rank };
    const grid = el('div', 'ach-grid');
    for (const a of ACHIEVEMENTS) {
      const got = save.achievements.includes(a.id);
      const hide = a.secret && !got;
      const p = !got && a.progress ? a.progress(ctx) : null;
      const bar = p ? `<i class="ach-bar"><i style="transform:scaleX(${Math.min(1, p[0] / p[1]).toFixed(3)})"></i></i><em>${fmt(Math.min(p[0], p[1]))} / ${fmt(p[1])}</em>` : '';
      grid.appendChild(
        el('div', `ach${got ? ' got' : ''}`, `<b>${hide ? tr('profile.secret') : tx(`ach.${a.id}.name`, a.name)}</b><span>${hide ? tr('profile.keepPlaying') : tx(`ach.${a.id}.desc`, a.desc)}</span>${bar}`, { 'aria-label': `${hide ? 'Secret achievement' : a.name}. ${hide ? '' : a.desc} ${got ? 'Earned.' : 'Not yet.'}` })
      );
    }
    this.body.classList.add('ach-body');
    this.body.appendChild(grid);
  }

  private equip(kind: 'blade' | 'shard', id: string): void {
    this.host.save.equipped[kind] = id;
    this.host.persist();
    this.render();
  }
}
