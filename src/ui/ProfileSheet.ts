/** ProfileSheet — lifetime stats, challenge stars, and the cosmetic locker (blade + debris). */

import { MOVEMENTS } from '../audio/tracks.js';
import { UNLOCKS, isUnlocked, starCount, totalStars, challengesFor } from '../meta/Progress.js';
import type { SaveData } from '../meta/Save.js';
import { button, el, fmt, ICONS } from './dom.js';

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
  open = false;

  constructor(private readonly host: ProfileHost) {
    const card = el('div', 'sheet profile-sheet');
    const head = el('div', 'settings-head');
    head.append(el('div', 'sheet-title', 'PROFILE'), button('icon-btn settings-close', ICONS.close, 'Close profile', () => this.show(false)));
    card.append(head, this.body);
    this.root.appendChild(card);
    this.root.addEventListener('click', e => {
      if (e.target === this.root) this.show(false);
    });
    window.addEventListener('keydown', e => {
      if (this.open && e.key === 'Escape') this.show(false);
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

    const left = el('section', 'profile-col');
    left.appendChild(el('div', 'set-group', 'LIFETIME'));
    const grid = el('div', 'stat-grid');
    const stat = (label: string, value: string): void => {
      grid.appendChild(el('div', 'pstat', `<div class="pstat-v">${value}</div><div class="pstat-l">${label}</div>`));
    };
    stat('RUNS', fmt(save.runs));
    stat('PLAY TIME', duration(st.playSec));
    stat('GROUPS', fmt(st.groups));
    stat('ALL CLEARS', fmt(st.allClears));
    stat('OVERCHARGES', fmt(st.overcharges));
    stat('AIR-PRIMES', fmt(st.airPrimes));
    stat('BEST CHAIN', fmt(st.bestChain));
    stat('BEST PASS', fmt(st.bestPass));
    left.appendChild(grid);
    left.appendChild(el('div', 'set-group', 'CHALLENGES'));
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

    const right = el('section', 'profile-col');
    for (const kind of ['blade', 'shard'] as const) {
      right.appendChild(el('div', 'set-group', kind === 'blade' ? 'BLADE' : 'DEBRIS'));
      const row = el('div', 'locker');
      const current = save.equipped[kind];
      const auto = button(`lock-item${current === 'auto' ? ' on' : ''}`, '<span>Movement</span><small>AUTO</small>', `${kind}: match the movement`, () => this.equip(kind, 'auto'));
      row.appendChild(auto);
      for (const u of UNLOCKS.filter(x => x.kind === kind)) {
        const ok = isUnlocked(save, u);
        const b = button(
          `lock-item${current === u.id ? ' on' : ''}${ok ? '' : ' locked'}`,
          `<span>${u.name}</span><small>${ok ? 'UNLOCKED' : `★ ${u.stars}`}</small>`,
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
    right.appendChild(el('div', 'locker-note', 'Cosmetic only. Earn stars from movement challenges.'));
    this.body.append(left, right);
  }

  private equip(kind: 'blade' | 'shard', id: string): void {
    this.host.save.equipped[kind] = id;
    this.host.persist();
    this.render();
  }
}
