/**
 * RunHud — left: score, chain rank word + multiplier, 5 stem pips. Bottom-left: movement and
 * BPM/bar. Top-right: pause. Bottom-right: NEXT ROW / RISES IN N BAR(S). Nothing else.
 * Values are written to the DOM only when they change.
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
}

export class RunHud {
  readonly root = el('div', 'hud', '', { role: 'region', 'aria-label': 'Run status' });
  private readonly score = el('div', 'hud-score', '0', { 'aria-label': 'Score' });
  private readonly chainWord = el('span', 'hud-chain-word', 'STEADY');
  private readonly chainMult = el('span', 'hud-chain-mult', '×1.0');
  private readonly pips: HTMLElement[] = [];
  private readonly chargeLabel = el('div', 'hud-charge-label', 'CHARGE');
  private readonly chargeFill = el('span', 'hud-charge-fill');
  private readonly chargeBox = el('div', 'hud-charge', '', { role: 'meter', 'aria-label': 'Charge' });
  private readonly movement = el('div', 'hud-movement', '');
  private readonly tempo = el('div', 'hud-tempo', '');
  private readonly next = el('div', 'hud-next', '');
  private readonly nextLabel = el('div', 'hud-next-label', 'NEXT ROW');
  private readonly nextValue = el('div', 'hud-next-value', '');
  private last: HudValues = { score: -1, chainRank: -1, combo: -1, layers: -1, movement: '', bpm: -1, bar: -1, risesIn: -2, charge: -1 };

  constructor(onPause: () => void) {
    const left = el('div', 'hud-left');
    const chain = el('div', 'hud-chain', '', { 'aria-label': 'Chain' });
    chain.append(this.chainWord, this.chainMult);
    const stems = el('div', 'hud-stems', '', { 'aria-label': 'Active stems' });
    for (let i = 0; i < 5; i++) {
      const p = el('span', 'hud-pip');
      this.pips.push(p);
      stems.appendChild(p);
    }
    const bar = el('div', 'hud-charge-bar');
    bar.appendChild(this.chargeFill);
    this.chargeBox.append(this.chargeLabel, bar);
    left.append(el('div', 'hud-label', 'SCORE'), this.score, chain, stems, this.chargeBox);
    const bottomLeft = el('div', 'hud-bottom-left');
    bottomLeft.append(this.movement, this.tempo);
    this.next.append(this.nextLabel, this.nextValue);
    const pause = button('hud-pause icon-btn', ICONS.pause, 'Pause', onPause);
    this.root.append(left, bottomLeft, this.next, pause);
  }

  /** Overture hides score/chain; the stem chips take the left column. */
  setOverture(on: boolean): void {
    this.root.classList.toggle('overture', on);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('pure', hidden);
  }

  update(v: HudValues): void {
    const l = this.last;
    if (v.score !== l.score) {
      setText(this.score, fmt(v.score));
      l.score = v.score;
    }
    if (v.chainRank !== l.chainRank || v.combo !== l.combo) {
      setText(this.chainWord, CHAIN_WORDS[Math.max(0, Math.min(4, v.chainRank))]!);
      setText(this.chainMult, `×${v.combo.toFixed(1)}`);
      this.chainWord.dataset.rank = String(v.chainRank);
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
      setText(this.movement, v.movement);
      l.movement = v.movement;
    }
    if (v.bpm !== l.bpm || v.bar !== l.bar) {
      setText(this.tempo, `${Math.round(v.bpm)} BPM · BAR ${Math.max(1, v.bar)}`);
      l.bpm = v.bpm;
      l.bar = v.bar;
    }
    const c = Math.round(v.charge * 100);
    if (c !== l.charge) {
      this.chargeFill.style.transform = `scaleX(${c / 100})`;
      const ready = c >= 100;
      this.chargeBox.classList.toggle('ready', ready);
      setText(this.chargeLabel, ready ? 'HOLD READY' : 'CHARGE');
      this.chargeBox.setAttribute('aria-valuenow', String(c));
      l.charge = c;
    }
    if (v.risesIn !== l.risesIn) {
      this.next.classList.toggle('hidden', v.risesIn === null);
      if (v.risesIn !== null) setText(this.nextValue, `RISES IN ${v.risesIn} BAR${v.risesIn === 1 ? '' : 'S'}`);
      l.risesIn = v.risesIn;
    }
  }
}
