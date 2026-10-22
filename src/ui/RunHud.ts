/**
 * RunHud — Lumines-style panel. Right: stacked label slabs (movement, bar, score with its "+points",
 * hi-score, chain, groups). Bottom-left: the round Charge gauge, the game's one dial, so it carries
 * the juice: a spark rides the leading edge, every gain pulses it, a full meter fires a shockwave and
 * spins a ring on the beat, spending it flashes and drains. Top-left: the next-row pips. Centre: a
 * big callout on every chain rank-up. Danger tints the panel. DOM writes only on change.
 */

import { button, el, fmt, ICONS, setText } from './dom.js';

export const CHAIN_WORDS = ['STEADY', 'GROOVE', 'DRIVE', 'SURGE', 'RESONANT'] as const;

export interface HudValues {
  score: number;
  chainRank: number;
  combo: number;
  layers: number;
  movement: string;
  bpm: number;
  bar: number;
  risesIn: number | null;
  /** Charge meter 0..1 (1 = a hold is available) */
  charge: number;
  /** Personal best for this run's key (0 = none) */
  best: number;
  groups: number;
  /** "♪ 04 Phosphor · Synthwave" */
  credit: string;
  /** Beat pulse 1 -> 0 over each beat */
  pulse: number;
  /** Wall danger level 0..2 */
  danger: number;
}

const BLANK: HudValues = { score: -1, chainRank: -1, combo: -1, layers: -1, movement: '', bpm: -1, bar: -1, risesIn: -2, charge: -1, best: -1, groups: -1, credit: '', pulse: -1, danger: -1 };

/** Re-triggers a one-shot CSS animation class. */
function kick(e: Element | null, cls: string): void {
  if (!e) return;
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

export class RunHud {
  readonly root = el('div', 'hud hud-b', '', { role: 'region', 'aria-label': 'Run status' });
  private readonly score = el('div', 'hud-score', '0', { 'aria-label': 'Score' });
  private readonly scoreRow: HTMLElement;
  private readonly gain = el('b', 'hb-gain', '', { 'aria-hidden': 'true' });
  private readonly vals: Record<'movement' | 'tempo' | 'best' | 'chain' | 'groups', HTMLElement>;
  private readonly gauge = el('div', 'hud-charge hb-gauge', '', { role: 'meter', 'aria-label': 'Charge', 'aria-valuemin': '0', 'aria-valuemax': '100' });
  private readonly fill: SVGCircleElement;
  private readonly spark: HTMLElement;
  private readonly gaugeLabel = el('div', 'hb-gauge-label', 'CHARGE');
  private readonly pips: HTMLElement[] = [];
  private readonly rise = el('div', 'hb-rise');
  private readonly risePips: HTMLElement[] = [];
  private readonly riseValue = el('div', 'hb-rise-value');
  private readonly credit = el('div', 'hb-credit');
  private readonly callout = el('div', 'hb-callout', '', { 'aria-hidden': 'true' });
  private last: HudValues = { ...BLANK };
  private gainSum = 0;
  private gainAt = 0;
  private lastPulse = '';
  private riseTotal = 2;

  constructor(onPause: () => void) {
    const panel = el('div', 'hb-panel');
    const row = (label: string, value: HTMLElement, cls = '', extra?: HTMLElement): HTMLElement => {
      const w = el('div', `hb-row ${cls}`);
      const l = el('div', 'hb-label', `<span>${label}</span>`);
      if (extra) l.appendChild(extra);
      w.append(l, value);
      return w;
    };
    const v = (cls = ''): HTMLElement => el('div', `hb-value ${cls}`);
    this.vals = { movement: v(), tempo: v(), best: v(), chain: v(), groups: v() };
    const scoreBox = el('div', 'hb-value hud-scorebox');
    scoreBox.appendChild(this.score);
    this.scoreRow = row('SCORE', scoreBox, 'hs hb-scorerow', this.gain);
    panel.append(
      row('MOVEMENT', this.vals.movement, 'hb-move'),
      row('BAR', this.vals.tempo),
      this.scoreRow,
      row('HI-SCORE', this.vals.best, 'hs'),
      row('CHAIN', this.vals.chain, 'hs hb-chain'),
      row('GROUPS', this.vals.groups, 'hs')
    );

    // Gauge: track, fill, a spark on the leading edge, a spin ring and a shockwave for "ready"
    this.gauge.innerHTML = `<i class="g-wave" aria-hidden="true"></i><i class="g-ring" aria-hidden="true"></i><svg viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="33" class="g-track"/>
      <circle cx="40" cy="40" r="33" class="g-fill" pathLength="100"/>
    </svg><i class="g-spark" aria-hidden="true"></i>`;
    this.fill = this.gauge.querySelector('.g-fill') as SVGCircleElement;
    this.spark = this.gauge.querySelector('.g-spark') as HTMLElement;
    const stems = el('div', 'hud-stems hs', '', { 'aria-label': 'Active stems' });
    for (let i = 0; i < 5; i++) {
      const p = el('span', 'hud-pip');
      this.pips.push(p);
      stems.appendChild(p);
    }
    this.gauge.append(this.gaugeLabel, stems);

    this.rise.append(el('div', 'hb-rise-label', 'NEXT ROW'));
    const track = el('div', 'hb-rise-pips');
    for (let i = 0; i < 4; i++) {
      const p = el('i');
      this.risePips.push(p);
      track.appendChild(p);
    }
    this.rise.append(track, this.riseValue);
    this.root.append(panel, this.gauge, this.rise, this.credit, this.callout, button('hud-pause icon-btn', ICONS.pause, 'Pause', onPause));
  }

  /** Overture hides score/chain. */
  setOverture(on: boolean): void {
    this.root.classList.toggle('overture', on);
  }

  /** Chain rank-up: a big centre callout in the rank's colour. */
  flareChain(): void {
    if (this.root.classList.contains('overture')) return;
    const rank = Math.max(0, Math.min(4, this.last.chainRank));
    this.callout.innerHTML = `<span>${CHAIN_WORDS[rank]}</span><b>×${this.last.combo.toFixed(1)}</b>`;
    this.callout.dataset.rank = String(rank);
    kick(this.callout, 'go');
    kick(this.vals.chain, 'flare');
  }

  /** Draws the eye to the Charge gauge (first-time lesson). */
  flashCharge(): void {
    kick(this.gauge, 'teach');
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) {
      this.gainSum = 0;
      this.gain.classList.remove('on');
      this.gauge.classList.remove('burst', 'spend', 'gulp', 'ready');
      this.last = { ...BLANK };
    }
  }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('pure', hidden);
  }

  update(v: HudValues): void {
    const l = this.last;
    const now = performance.now();
    if (v.score !== l.score) {
      setText(this.score, fmt(v.score));
      if (l.score >= 0 && v.score > l.score) {
        // Gains within ~0.7 s add up into one "+points" pop; big ones light the whole slab
        this.gainSum = now - this.gainAt < 700 ? this.gainSum + v.score - l.score : v.score - l.score;
        this.gainAt = now;
        setText(this.gain, `+${fmt(this.gainSum)}`);
        kick(this.gain, 'on');
        kick(this.scoreRow, this.gainSum >= 1000 ? 'big' : 'bump');
      }
      l.score = v.score;
    }
    if (v.chainRank !== l.chainRank || v.combo !== l.combo) {
      setText(this.vals.chain, `×${v.combo.toFixed(1)} ${CHAIN_WORDS[Math.max(0, Math.min(4, v.chainRank))]}`);
      this.root.dataset.rank = String(v.chainRank);
      l.chainRank = v.chainRank;
      l.combo = v.combo;
    }
    if (v.layers !== l.layers) {
      // layers 2..6 -> pips: kick+bass = 1 pip ... full = 5
      const lit = Math.max(1, Math.min(5, v.layers - 1));
      this.pips.forEach((p, i) => p.classList.toggle('on', i < lit));
      l.layers = v.layers;
    }
    if (v.movement !== l.movement) {
      setText(this.vals.movement, v.movement);
      l.movement = v.movement;
    }
    if (v.bpm !== l.bpm || v.bar !== l.bar) {
      setText(this.vals.tempo, `${Math.max(1, v.bar)} · ${Math.round(v.bpm)} BPM`);
      l.bpm = v.bpm;
      l.bar = v.bar;
    }
    if (v.best !== l.best) {
      setText(this.vals.best, v.best > 0 ? fmt(v.best) : '—');
      l.best = v.best;
    }
    if (v.groups !== l.groups) {
      setText(this.vals.groups, fmt(v.groups));
      l.groups = v.groups;
    }
    if (v.credit !== l.credit) {
      setText(this.credit, v.credit);
      l.credit = v.credit;
    }
    const c = Math.round(v.charge * 100);
    if (c !== l.charge) {
      const ready = c >= 100;
      const wasReady = l.charge >= 100;
      this.fill.style.strokeDashoffset = String(100 - c);
      this.spark.style.transform = `rotate(${c * 3.6}deg)`;
      this.gauge.classList.toggle('empty', c <= 0);
      if (l.charge >= 0) {
        if (ready && !wasReady) kick(this.gauge, 'burst');
        else if (!ready && wasReady) kick(this.gauge, 'spend');
        else if (c > l.charge) kick(this.gauge, 'gulp');
      }
      this.gauge.classList.toggle('ready', ready);
      this.gauge.setAttribute('aria-valuenow', String(c));
      setText(this.gaugeLabel, ready ? 'HOLD' : 'CHARGE');
      l.charge = c;
    }
    if (v.risesIn !== l.risesIn) {
      this.rise.classList.toggle('hidden', v.risesIn === null);
      if (v.risesIn !== null) {
        if (v.risesIn > this.riseTotal || l.risesIn === -2) this.riseTotal = Math.max(1, Math.min(4, v.risesIn));
        this.risePips.forEach((p, i) => {
          p.classList.toggle('off', i >= this.riseTotal);
          p.classList.toggle('on', i < this.riseTotal - v.risesIn!);
        });
        setText(this.riseValue, `RISES IN ${v.risesIn} BAR${v.risesIn === 1 ? '' : 'S'}`);
        this.root.classList.toggle('rise-soon', v.risesIn <= 1);
      }
      l.risesIn = v.risesIn;
    }
    if (v.danger !== l.danger) {
      this.root.dataset.danger = String(v.danger);
      l.danger = v.danger;
    }
    const p = v.pulse.toFixed(2);
    if (p !== this.lastPulse) {
      this.lastPulse = p;
      this.root.style.setProperty('--beat', p);
    }
  }
}
