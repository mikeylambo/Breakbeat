/**
 * ResultsScreen — a reveal, not a form. The score counts up on the music, the mastery badge
 * stamps down, a personal best gets its fanfare, then the stats tick in. Right: the best-pass
 * replay loop and "Practise next". Bottom: Next / Replay / Share / Title as one keyboard row.
 * Any key or tap during the reveal skips to the end. The run's movement keeps playing underneath.
 */

import { t as tr, tn } from '../i18n/i18n.js';
import { mastery, todayUtc } from '../meta/Save.js';
import { flush, prefs, savePrefs, submit, top } from '../meta/Leaderboard.js';
import { recordRun, type CoachAdvice } from '../meta/Coach.js';
import { ReplayView } from '../render/ReplayView.js';
import type { App, RunResult } from './App.js';
import { announce, button, coveredBySheet, el, fmt, setText, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { sharePass } from './share.js';

export interface ResultsActions {
  next(): void;
  replay(): void;
  title(): void;
}

/** Reveal timeline (seconds from show) */
const T_SCORE = 0.35;
const T_SCORE_END = 1.45;
const T_STAMP = 1.6;
const T_PB = 1.95;
const T_STATS = 2.2;
const T_DONE = 2.9;

export class ResultsScreen {
  readonly root = el('div', 'results hidden', '', { role: 'main', 'aria-label': 'Results' });
  private readonly actionsMenu: MenuList;
  private replay: ReplayView | null = null;
  private t0 = 0;
  private last = 0;
  private result: RunResult | null = null;
  private sharing = false;
  /** Reveal state */
  private revealT = 0;
  private revealDone = true;
  private score = 0;
  private scoreEl: HTMLElement | null = null;
  private statEls: { el: HTMLElement; value: number; at: number }[] = [];
  private ticks = 0;
  private pb = false;

  constructor(
    private readonly app: App,
    private readonly actions: ResultsActions
  ) {
    this.actionsMenu = new MenuList({ cls: 'results-actions', horizontal: true, active: () => this.visible && this.revealDone });
    window.addEventListener('keydown', e => {
      if (!this.visible || coveredBySheet(this.root) || e.metaKey || e.ctrlKey) return;
      if (!this.revealDone) {
        this.skipReveal();
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === 'Escape') {
        uiSound('back');
        this.actions.title();
      } else if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
        uiSound('pick');
        this.actions.replay();
      }
    });
    this.root.addEventListener('pointerdown', () => {
      if (!this.revealDone) this.skipReveal();
    });
  }

  private ensureReplay(): ReplayView {
    if (!this.replay) {
      this.replay = new ReplayView(this.app.atlas);
      const scale = 0.62;
      this.replay.root.scale.set(scale);
      this.replay.root.position.set(812 - this.replay.width * scale - 5, 46);
      this.app.stage.root.addChild(this.replay.root);
    }
    return this.replay;
  }

  show(r: RunResult): void {
    this.result = r;
    const { run, engine, score, previousBest } = r;
    const t = engine.telemetry;
    let advice: CoachAdvice | null = null;
    if (run.mode !== 'overture') {
      advice = recordRun({
        airPrimesLanded: t.airPrimesLanded,
        overchargesLanded: t.overchargesLanded,
        groupsPerPassAvg: t.groupsPerPassAvg,
        longestCombo: t.longestCombo
      });
    }
    const best = Math.max(score, previousBest);
    const m = mastery(best);
    const pb = score > previousBest;
    this.pb = pb && previousBest > 0;
    this.score = score;
    const movementLabel =
      run.cfg.track ? `MY BEAT · ${run.track.name.toUpperCase()}` : run.mode === 'odyssey' ? `${run.track.number} · ${run.track.name.toUpperCase()}` : `${run.mode.toUpperCase()} · ${run.track.name.toUpperCase()}`;

    this.root.innerHTML = '';
    this.root.classList.toggle('is-pb', pb);
    const left = el('section', 'results-left');
    this.scoreEl = el('div', 'results-score', '0', { 'aria-label': `Score ${fmt(score)}` });
    left.append(el('div', 'results-kicker', `${run.mode === 'odyssey' ? `ACT ${run.track.act} · ` : ''}${movementLabel}`), this.scoreEl);
    const rank = el('div', 'results-rank');
    const pct = Math.round(Math.max(0, Math.min(1, m.progress)) * 100);
    rank.innerHTML = `<span class="badge badge-${m.rank.toLowerCase()}">${m.rank}</span><span class="rank-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${m.next ?? 'max rank'}"><span style="--p:${pct / 100}"></span></span><span class="rank-next">${m.next ? tr('results.toRank', { n: fmt(m.toNext), rank: m.next }) : tr('results.topRank')}</span>`;
    left.appendChild(rank);
    const pbLine = pb
      ? el('div', 'results-pb new', previousBest > 0 ? tr('results.newPb', { n: fmt(score - previousBest) }) : tr('results.firstClear'))
      : el('div', 'results-pb', score === 0 ? tr('results.nothing') : score === previousBest ? tr('results.level') : tr('results.toBest', { n: fmt(previousBest - score) }));
    left.appendChild(pbLine);
    const stats = el('div', 'results-stats');
    this.statEls = [];
    const stat = (label: string, value: number, i: number): HTMLElement => {
      const v = el('div', 'stat-value', '0');
      this.statEls.push({ el: v, value, at: T_STATS + i * 0.14 });
      const s = el('div', 'stat');
      s.style.setProperty('--i', String(i));
      s.append(v, el('div', 'stat-label', label));
      return s;
    };
    stats.append(stat(tr('results.chain'), t.longestCombo, 0), stat(tr('results.overcharge'), t.overchargesLanded, 1), stat(tr('results.airPrimes'), t.airPrimesLanded, 2));
    left.appendChild(stats);
    if (r.newStars.length) left.appendChild(el('div', 'results-stars', r.newStars.map(x => `<span>★ ${x}</span>`).join('')));

    const right = el('section', 'results-right');
    const snap = engine.bestPassSnapshot;
    right.appendChild(
      el('div', 'replay-label', snap ? tn('results.bestPass', snap.groupsDetonated, { pts: fmt(snap.points) }) : tr('results.noPass'))
    );
    if (run.mode === 'daily' && r.replay) right.appendChild(this.boardCard(r));
    else {
      const card = el('div', 'practise-card');
      card.innerHTML = `<div class="practise-label">${tr('results.practiseNext')}</div><div class="practise-text">${advice ? advice.text : tr('results.finishRun')}</div>`;
      right.appendChild(card);
    }

    const items: MenuItem[] = [];
    const item = (id: string, name: string, action: () => void, cls = ''): MenuItem => ({ id, label: name, cls, action, html: `<span class="mi-name">${name}</span>` });
    if (run.mode === 'odyssey') items.push(item('next', tr('results.nextMovement'), this.actions.next, 'btn-primary'), item('replay', tr('results.replay'), this.actions.replay));
    else items.push(item('replay', tr('results.playAgain'), this.actions.replay, 'btn-primary'));
    const share = item('share', tr('results.share'), () => void this.share());
    if (!snap) share.locked = true;
    items.push(share, item('title', tr('results.title'), this.actions.title, 'quiet'));
    const foot = el('div', 'results-foot');
    foot.append(this.actionsMenu.root, el('div', 'results-keys', tr('results.keys')));
    this.root.append(left, right, foot);
    this.actionsMenu.setItems(items, 0);

    const replay = this.ensureReplay();
    replay.setSnapshot(snap, this.app.clock.bpm);
    replay.root.visible = !!snap;
    this.t0 = performance.now() / 1000;
    this.last = this.t0;
    this.revealT = 0;
    this.ticks = 0;
    this.revealDone = false;
    this.root.classList.remove('hidden', 'revealed', 'stamped', 'pb-in', 'stats-in');
    this.actionsMenu.relayout();
    if (document.documentElement.classList.contains('reduced-motion')) this.skipReveal();
    announce(`Run over. ${movementLabel}. Score ${fmt(score)}. ${pb ? 'New personal best.' : `${fmt(previousBest - score)} to your best.`} ${advice ? advice.text : ''}`);
  }

  /**
   * Daily Board: asks once for a name (opt-in), then posts each Daily. The server replays the run
   * and keeps its own score; the card shows your rank and today's top three.
   */
  private boardCard(r: RunResult): HTMLElement {
    const card = el('div', 'practise-card board-card', '', { 'aria-live': 'polite' });
    const day = todayUtc();
    const head = `<div class="practise-label">${tr('board.title')}</div>`;
    const optIn = (): void => {
      const p = prefs();
      card.innerHTML = `${head}<div class="practise-text">${tr('board.ask')}</div>`;
      const row = el('div', 'board-form');
      const name = el('input', 'ee-name board-name', '', { type: 'text', maxlength: '16', placeholder: tr('board.name'), 'aria-label': 'Name on the board', spellcheck: 'false' }) as HTMLInputElement;
      name.value = p.name;
      // Typing here must not drive the results keys (R is replay)
      name.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') go();
      });
      const go = (): void => {
        if (!name.value.trim()) {
          name.focus();
          return;
        }
        savePrefs({ ...p, on: true, name: name.value });
        void post();
      };
      row.append(name, button('btn btn-primary board-post', tr('board.post'), tr('board.post'), go));
      card.appendChild(row);
    };
    const post = async (): Promise<void> => {
      card.innerHTML = `${head}<div class="practise-text">${tr('board.checking')}</div>`;
      try {
        await flush(day);
        const res = await submit(day, r.replay!);
        this.app.achieve('board');
        const rows = await top(day, 3).catch(() => []);
        const me = prefs();
        const pct = Math.max(1, Math.round((res.rank / Math.max(1, res.total)) * 100));
        const list = rows.map((x, i) => `<li class="${x.score === res.best && x.name === me.name ? 'me' : ''}"><i>${i + 1}</i><span>${x.name}</span><b>${fmt(x.score)}</b></li>`).join('');
        card.innerHTML = `<div class="board-head">${head}</div><div class="board-body"><div class="board-rank"><b>#${res.rank}</b><span>${tr('board.of', { n: fmt(res.total), pct })}</span>${res.best > res.score ? `<span>${tr('board.best', { n: fmt(res.best) })}</span>` : ''}</div><ol class="board-list">${list}</ol></div>`;
        card.querySelector('.board-head')!.appendChild(
          button('board-off', tr('board.stop'), tr('board.stop'), () => {
            savePrefs({ ...prefs(), on: false });
            card.innerHTML = `${head}<div class="practise-text">${tr('board.off')}</div>`;
          })
        );
        announce(`Daily board: rank ${res.rank} of ${res.total}.`);
      } catch (err) {
        const why = err instanceof Error ? err.message : '';
        card.innerHTML = `${head}<div class="practise-text">${why === 'offline' ? tr('board.offline') : tr('board.failed')}</div>`;
      }
    };
    if (prefs().on) void post();
    else optIn();
    return card;
  }

  hide(): void {
    this.root.classList.add('hidden');
    if (this.replay) this.replay.root.visible = false;
    this.result = null;
    this.revealDone = true;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  private skipReveal(): void {
    this.revealT = T_DONE;
    this.step(T_DONE, true);
  }

  /** Advances the reveal to time `t`. */
  private step(t: number, skipping = false): void {
    const c = this.root.classList;
    if (this.scoreEl) {
      const p = Math.max(0, Math.min(1, (t - T_SCORE) / (T_SCORE_END - T_SCORE)));
      const eased = 1 - Math.pow(1 - p, 3);
      setText(this.scoreEl, fmt(this.score * eased));
      // a tick per ~80 ms while it climbs, rising through the chord
      const tick = Math.floor(p * 14);
      if (!skipping && p > 0 && p < 1 && tick > this.ticks) {
        this.ticks = tick;
        uiSound('tick', tick);
      }
    }
    if (t >= T_STAMP && !c.contains('stamped')) {
      c.add('stamped');
      if (!skipping) uiSound('stamp');
    }
    if (t >= T_PB && !c.contains('pb-in')) {
      c.add('pb-in');
      if (!skipping && this.root.classList.contains('is-pb')) uiSound('fanfare');
    }
    if (t >= T_STATS) c.add('stats-in');
    for (const s of this.statEls) {
      const p = Math.max(0, Math.min(1, (t - s.at) / 0.4));
      setText(s.el, fmt(s.value * p));
    }
    if (t >= T_DONE) {
      c.add('revealed');
      this.revealDone = true;
      this.actionsMenu.relayout();
    }
  }

  onFrame(): void {
    if (!this.visible) return;
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - this.last);
    if (!this.revealDone) {
      this.revealT += dt;
      this.step(this.revealT);
    }
    if (this.replay) this.replay.update(now - this.t0, dt);
    this.last = now;
  }

  private async share(): Promise<void> {
    const r = this.result;
    const snap = r?.engine.bestPassSnapshot;
    if (!r || !snap || this.sharing) return;
    this.sharing = true;
    const btn = this.root.querySelector('.results-actions .menu-item:nth-of-type(' + (this.actionsMenu.items.findIndex(i => i.id === 'share') + 1) + ') .mi-name') as HTMLElement | null;
    if (btn) btn.textContent = tr('results.recording');
    const track = r.run.track;
    try {
      this.app.stopAttract();
      await this.app.audio.unlock();
      const result = await sharePass({
        snapshot: snap,
        bpm: this.app.clock.bpm,
        score: r.score,
        title: r.run.cfg.track ? `MY BEAT · ${track.name.toUpperCase()}` : r.run.mode === 'odyssey' ? `${track.number} · ${track.name.toUpperCase()}` : r.run.mode.toUpperCase(),
        audio: this.app.audio.recordStream(),
        startMusic: () => {
          void this.app.stems.start(track, this.app.audio.now + 0.02, 6);
          return () => this.app.stems.stopAll(this.app.audio.now + 0.1);
        }
      });
      if (btn) btn.textContent = result === 'downloaded' ? tr('results.saved') : result === 'shared' ? tr('results.shared') : tr('results.share');
    } finally {
      this.sharing = false;
      if (this.visible) {
        if (r.run.cfg.track) void this.app.attractTo(r.run.cfg.track, 2);
        else this.app.attract('odyssey', r.run.movement, 2);
      }
    }
  }
}
