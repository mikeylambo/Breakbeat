/**
 * ResultsScreen — left: movement, score, mastery badge + progress to the next rank, personal-best
 * line, stats (chain, Overcharge, air-primes). Right: best-pass replay loop, "Practise next",
 * Next movement / Replay / Share pass.
 */

import { mastery } from '../meta/Save.js';
import { recordRun, type CoachAdvice } from '../meta/Coach.js';
import { ReplayView } from '../render/ReplayView.js';
import type { App, RunResult } from './App.js';
import { announce, button, el, fmt, ICONS } from './dom.js';
import { sharePass } from './share.js';

export interface ResultsActions {
  next(): void;
  replay(): void;
  title(): void;
}

export class ResultsScreen {
  readonly root = el('div', 'results hidden', '', { role: 'main', 'aria-label': 'Results' });
  private replay: ReplayView | null = null;
  private t0 = 0;
  private last = 0;
  private result: RunResult | null = null;
  private sharing = false;

  constructor(
    private readonly app: App,
    private readonly actions: ResultsActions
  ) {}

  private ensureReplay(): ReplayView {
    if (!this.replay) {
      this.replay = new ReplayView(this.app.atlas);
      const scale = 0.68;
      this.replay.root.scale.set(scale);
      this.replay.root.position.set(812 - this.replay.width * scale, 44);
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
    const movementLabel =
      run.mode === 'odyssey' ? `${run.track.number} · ${run.track.name.toUpperCase()}` : `${run.mode.toUpperCase()} · ${run.track.name.toUpperCase()}`;

    this.root.innerHTML = '';
    const left = el('section', 'results-left');
    left.append(
      el('div', 'results-kicker', movementLabel),
      el('div', 'results-score', fmt(score), { 'aria-label': `Score ${fmt(score)}` })
    );
    const rank = el('div', 'results-rank');
    const pct = Math.round(Math.max(0, Math.min(1, m.progress)) * 100);
    rank.innerHTML = `<span class="badge badge-${m.rank.toLowerCase()}">${m.rank}</span><span class="rank-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${m.next ?? 'max rank'}"><span style="width:${pct}%"></span></span><span class="rank-next">${m.next ? `${fmt(m.toNext)} TO ${m.next}` : 'TOP RANK'}</span>`;
    left.appendChild(rank);
    const pbLine = pb
      ? el('div', 'results-pb new', `NEW PERSONAL BEST · +${fmt(score - previousBest)}`)
      : previousBest === 0
        ? el('div', 'results-pb', 'No best yet')
        : el('div', 'results-pb', score === previousBest ? 'Level with your best' : `${fmt(previousBest - score)} to your best`);
    left.appendChild(pbLine);
    const stats = el('div', 'results-stats');
    const stat = (label: string, value: string): HTMLElement => el('div', 'stat', `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`);
    stats.append(stat('CHAIN', String(t.longestCombo)), stat('OVERCHARGE', String(t.overchargesLanded)), stat('AIR-PRIMES', String(t.airPrimesLanded)));
    left.appendChild(stats);
    left.appendChild(button('icon-btn results-home', ICONS.close, 'Back to title', this.actions.title));

    const right = el('section', 'results-right');
    const snap = engine.bestPassSnapshot;
    right.appendChild(
      el('div', 'replay-label', snap ? `BEST PASS · +${fmt(snap.points)} · ${snap.groupsDetonated} GROUP${snap.groupsDetonated === 1 ? '' : 'S'}` : 'NO PASS LANDED')
    );
    const card = el('div', 'practise-card');
    card.innerHTML = `<div class="practise-label">PRACTISE NEXT</div><div class="practise-text">${advice ? advice.text : 'Finish a run to get a practice target.'}</div>`;
    right.appendChild(card);
    const row = el('div', 'results-actions');
    const shareBtn = button('btn', 'Share pass', 'Share best pass', () => void this.share());
    if (!snap) shareBtn.disabled = true;
    row.append(button('btn btn-primary', 'Next movement', 'Next movement', this.actions.next), button('btn', 'Replay', 'Replay', this.actions.replay), shareBtn);
    right.appendChild(row);
    this.root.append(left, right);

    const replay = this.ensureReplay();
    replay.setSnapshot(snap, this.app.clock.bpm);
    replay.root.visible = !!snap;
    this.t0 = performance.now() / 1000;
    this.last = this.t0;
    this.root.classList.remove('hidden');
    announce(`Run over. ${movementLabel}. Score ${fmt(score)}. ${pb ? 'New personal best.' : `${fmt(previousBest - score)} to your best.`} ${advice ? advice.text : ''}`);
  }

  hide(): void {
    this.root.classList.add('hidden');
    if (this.replay) this.replay.root.visible = false;
    this.result = null;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  onFrame(): void {
    if (!this.visible || !this.replay) return;
    const now = performance.now() / 1000;
    this.replay.update(now - this.t0, Math.min(0.05, now - this.last));
    this.last = now;
  }

  private async share(): Promise<void> {
    const r = this.result;
    const snap = r?.engine.bestPassSnapshot;
    if (!r || !snap || this.sharing) return;
    this.sharing = true;
    const btn = this.root.querySelector('.results-actions .btn:last-child') as HTMLButtonElement | null;
    if (btn) btn.textContent = 'Recording…';
    try {
      await this.app.audio.unlock();
      const track = r.run.track;
      const result = await sharePass({
        snapshot: snap,
        bpm: this.app.clock.bpm,
        score: r.score,
        title: r.run.mode === 'odyssey' ? `${track.number} · ${track.name.toUpperCase()}` : r.run.mode.toUpperCase(),
        audio: this.app.audio.recordStream(),
        startMusic: () => {
          void this.app.stems.start(track, this.app.audio.now + 0.02, 6);
          return () => this.app.stems.stopAll(this.app.audio.now + 0.1);
        }
      });
      if (btn) btn.textContent = result === 'downloaded' ? 'Saved' : result === 'shared' ? 'Shared' : 'Share pass';
    } finally {
      this.sharing = false;
    }
  }
}
