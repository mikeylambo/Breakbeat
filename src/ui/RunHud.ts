/**
 * RunHud — three switchable styles over the same data (Settings → HUD style, ?hud=a|b|c, or H in a run):
 *  A · Clean   score, chain and Charge down the left; movement bottom-left; next row bottom-right.
 *  B · Panel   Lumines-style stacked label slabs on the right, a round Charge gauge bottom-left,
 *              the next-row countdown as a pip timeline, and a big centre callout on every rank-up.
 *  C · Edge    nothing in the margins: Charge is a bar up the wall's left edge, the next row counts
 *              down the right edge, and score / chain / movement read out in one line under the wall.
 * Every style: the score bumps and pops "+points" when it grows, and the HUD breathes on the beat.
 * Values are written to the DOM only when they change.
 */

import { button, el, fmt, ICONS, setText } from './dom.js';

export const CHAIN_WORDS = ['STEADY', 'GROOVE', 'DRIVE', 'SURGE', 'RESONANT'] as const;
export type HudStyle = 'a' | 'b' | 'c';
export const HUD_STYLES: readonly HudStyle[] = ['a', 'b', 'c'];
export const HUD_NAMES: Record<HudStyle, string> = { a: 'CLEAN', b: 'PANEL', c: 'EDGE' };

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
}

type Slot = 'score' | 'gain' | 'chainWord' | 'chainMult' | 'movement' | 'tempo' | 'next' | 'best' | 'groups' | 'credit' | 'chargeLabel' | 'bar';

export class RunHud {
  readonly root = el('div', 'hud', '', { role: 'region', 'aria-label': 'Run status' });
  style: HudStyle = 'a';
  private slots: Partial<Record<Slot, HTMLElement>> = {};
  private pips: HTMLElement[] = [];
  private risePips: HTMLElement[] = [];
  private chargeFill: HTMLElement | null = null;
  private chargeBox: HTMLElement | null = null;
  private scoreBox: HTMLElement | null = null;
  private callout: HTMLElement | null = null;
  private last: HudValues = RunHud.blank();
  private gainSum = 0;
  private gainAt = 0;
  private lastPulse = '';
  private lastRiseTotal = 2;

  constructor(private readonly onPause: () => void) {
    this.build();
  }

  private static blank(): HudValues {
    return { score: -1, chainRank: -1, combo: -1, layers: -1, movement: '', bpm: -1, bar: -1, risesIn: -2, charge: -1, best: -1, groups: -1, credit: '', pulse: -1 };
  }

  /** Switches style and rebuilds (values re-render on the next update). */
  setStyle(s: HudStyle): void {
    if (s === this.style && this.root.childElementCount) return;
    this.style = s;
    this.build();
  }

  private build(): void {
    const r = this.root;
    r.innerHTML = '';
    r.className = r.className.replace(/\bhud-[abc]\b/g, '').trim() + ` hud-${this.style}`;
    this.slots = {};
    this.pips = [];
    this.risePips = [];
    this.last = RunHud.blank();
    const s = (name: Slot, cls: string, text = '', attrs: Record<string, string> = {}): HTMLElement => {
      const e = el('div', cls, text, attrs);
      this.slots[name] = e;
      return e;
    };
    const stems = (): HTMLElement => {
      const box = el('div', 'hud-stems hs', '', { 'aria-label': 'Active stems' });
      for (let i = 0; i < 5; i++) {
        const p = el('span', 'hud-pip');
        this.pips.push(p);
        box.appendChild(p);
      }
      return box;
    };
    const charge = (cls: string): HTMLElement => {
      this.chargeBox = el('div', `hud-charge ${cls}`, '', { role: 'meter', 'aria-label': 'Charge', 'aria-valuemin': '0', 'aria-valuemax': '100' });
      this.chargeFill = el('span', 'hud-charge-fill');
      return this.chargeBox;
    };
    const scoreWrap = (): HTMLElement => {
      this.scoreBox = el('div', 'hud-scorebox hs');
      this.scoreBox.append(s('score', 'hud-score', '0', { 'aria-label': 'Score' }), s('gain', 'hud-gain', '', { 'aria-hidden': 'true' }));
      return this.scoreBox;
    };
    const pause = button('hud-pause icon-btn', ICONS.pause, 'Pause', this.onPause);
    this.callout = null;

    if (this.style === 'a') {
      const left = el('div', 'hud-left');
      const chain = el('div', 'hud-chain hs', '', { 'aria-label': 'Chain' });
      chain.append(s('chainWord', 'hud-chain-word', 'STEADY'), s('chainMult', 'hud-chain-mult', '×1.0'));
      const bar = el('div', 'hud-charge-bar');
      const box = charge('');
      bar.appendChild(this.chargeFill!);
      box.append(s('chargeLabel', 'hud-charge-label', 'CHARGE'), bar);
      left.append(el('div', 'hud-label hs', 'SCORE'), scoreWrap(), chain, stems(), box);
      const bl = el('div', 'hud-bottom-left');
      bl.append(s('movement', 'hud-movement'), s('tempo', 'hud-tempo'));
      const next = s('next', 'hud-next');
      next.innerHTML = '<div class="hud-next-label">NEXT ROW</div>';
      const nv = el('div', 'hud-next-value');
      next.appendChild(nv);
      this.slots.next = next;
      this.slots.bar = nv;
      r.append(left, bl, next, pause);
    } else if (this.style === 'b') {
      const panel = el('div', 'hb-panel');
      const row = (label: string, slot: Slot, cls = '', extra?: HTMLElement): HTMLElement => {
        const w = el('div', `hb-row ${cls}`);
        const l = el('div', 'hb-label', `<span>${label}</span>`);
        if (extra) l.appendChild(extra);
        w.append(l, slot === 'score' ? scoreWrap() : s(slot, 'hb-value'));
        return w;
      };
      const gainEl = el('b', 'hb-gain');
      panel.append(
        row('MOVEMENT', 'movement', 'hb-move'),
        row('BAR', 'tempo'),
        row('SCORE', 'score', 'hs', gainEl),
        row('HI-SCORE', 'best', 'hs'),
        row('CHAIN', 'chainMult', 'hs hb-chain'),
        row('GROUPS', 'groups', 'hs')
      );
      // B shows the gain on the SCORE label slab, Lumines-style
      this.slots.gain = gainEl;
      const box = charge('hb-gauge');
      box.innerHTML = '<svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="g-track"/><circle cx="40" cy="40" r="34" class="g-fill" pathLength="100"/></svg>';
      box.append(s('chargeLabel', 'hb-gauge-label', 'CHARGE'), stems());
      this.chargeFill = box.querySelector('.g-fill') as HTMLElement;
      const rise = el('div', 'hb-rise');
      rise.append(el('div', 'hb-rise-label', 'NEXT ROW'));
      const track = el('div', 'hb-rise-pips');
      for (let i = 0; i < 4; i++) {
        const p = el('i');
        this.risePips.push(p);
        track.appendChild(p);
      }
      rise.append(track, s('bar', 'hb-rise-value'));
      this.slots.next = rise;
      this.callout = el('div', 'hb-callout', '', { 'aria-hidden': 'true' });
      r.append(panel, box, rise, s('credit', 'hb-credit'), this.callout, pause);
      s('chainWord', 'hb-word');
    } else {
      const box = charge('hc-charge');
      box.append(this.chargeFill!, s('chargeLabel', 'hc-charge-label', ''));
      const rise = el('div', 'hc-rise');
      for (let i = 0; i < 4; i++) {
        const p = el('i');
        this.risePips.push(p);
        rise.appendChild(p);
      }
      rise.appendChild(s('bar', 'hc-rise-label'));
      this.slots.next = rise;
      const line = el('div', 'hc-line');
      const chain = el('div', 'hc-chain hs');
      chain.append(s('chainWord', 'hud-chain-word', 'STEADY'), s('chainMult', 'hud-chain-mult', '×1.0'));
      line.append(s('movement', 'hc-move'), scoreWrap(), chain, stems());
      r.append(box, rise, line, pause);
      s('tempo', 'hc-tempo');
    }
  }

  /** Overture hides score/chain. */
  setOverture(on: boolean): void {
    this.root.classList.toggle('overture', on);
  }

  /** Chain rank-up: the rank word flares (B: a big centre callout too). */
  flareChain(): void {
    const w = this.slots.chainWord;
    if (w) {
      w.classList.remove('flare');
      void w.offsetWidth;
      w.classList.add('flare');
    }
    const c = this.callout;
    if (c && !this.root.classList.contains('overture')) {
      const rank = Math.max(0, Math.min(4, this.last.chainRank));
      c.innerHTML = `<span>${CHAIN_WORDS[rank]}</span><b>×${this.last.combo.toFixed(1)}</b>`;
      c.dataset.rank = String(rank);
      c.classList.remove('go');
      void c.offsetWidth;
      c.classList.add('go');
    }
  }

  /** Draws the eye to the Charge meter (first-time lesson). */
  flashCharge(): void {
    const b = this.chargeBox;
    if (!b) return;
    b.classList.remove('teach');
    void b.offsetWidth;
    b.classList.add('teach');
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (on) {
      this.gainSum = 0;
      this.slots.gain?.classList.remove('on');
    }
  }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('pure', hidden);
  }

  update(v: HudValues): void {
    const l = this.last;
    const sl = this.slots;
    const now = performance.now();
    if (v.score !== l.score) {
      if (sl.score) setText(sl.score, fmt(v.score));
      if (l.score >= 0 && v.score > l.score) {
        // Gains within ~0.7 s add up into one "+points" pop
        this.gainSum = now - this.gainAt < 700 ? this.gainSum + v.score - l.score : v.score - l.score;
        this.gainAt = now;
        if (sl.gain) {
          setText(sl.gain, `+${fmt(this.gainSum)}`);
          sl.gain.classList.remove('on');
          void sl.gain.offsetWidth;
          sl.gain.classList.add('on');
        }
        const sb = this.scoreBox;
        if (sb) {
          sb.classList.remove('bump');
          void sb.offsetWidth;
          sb.classList.add('bump');
        }
      }
      l.score = v.score;
    }
    if (v.chainRank !== l.chainRank || v.combo !== l.combo) {
      const word = CHAIN_WORDS[Math.max(0, Math.min(4, v.chainRank))]!;
      if (sl.chainWord) {
        setText(sl.chainWord, word);
        sl.chainWord.dataset.rank = String(v.chainRank);
      }
      if (sl.chainMult) {
        setText(sl.chainMult, this.style === 'b' ? `×${v.combo.toFixed(1)} ${word}` : `×${v.combo.toFixed(1)}`);
        sl.chainMult.dataset.rank = String(v.chainRank);
      }
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
      if (sl.movement) setText(sl.movement, v.movement);
      l.movement = v.movement;
    }
    if (v.bpm !== l.bpm || v.bar !== l.bar) {
      if (sl.tempo) setText(sl.tempo, this.style === 'b' ? `${Math.max(1, v.bar)} · ${Math.round(v.bpm)} BPM` : `${Math.round(v.bpm)} BPM · BAR ${Math.max(1, v.bar)}`);
      l.bpm = v.bpm;
      l.bar = v.bar;
    }
    if (v.best !== l.best) {
      if (sl.best) setText(sl.best, v.best > 0 ? fmt(v.best) : '—');
      l.best = v.best;
    }
    if (v.groups !== l.groups) {
      if (sl.groups) setText(sl.groups, fmt(v.groups));
      l.groups = v.groups;
    }
    if (v.credit !== l.credit) {
      if (sl.credit) setText(sl.credit, v.credit);
      l.credit = v.credit;
    }
    const c = Math.round(v.charge * 100);
    if (c !== l.charge) {
      const ready = c >= 100;
      const f = this.chargeFill;
      if (f) {
        if (this.style === 'b') f.style.strokeDashoffset = String(100 - c);
        else if (this.style === 'c') f.style.transform = `scaleY(${c / 100})`;
        else f.style.transform = `scaleX(${c / 100})`;
      }
      this.chargeBox?.classList.toggle('ready', ready);
      this.chargeBox?.setAttribute('aria-valuenow', String(c));
      if (sl.chargeLabel) setText(sl.chargeLabel, ready ? (this.style === 'a' ? 'HOLD READY' : 'HOLD') : this.style === 'c' ? '' : 'CHARGE');
      l.charge = c;
    }
    if (v.risesIn !== l.risesIn) {
      sl.next?.classList.toggle('hidden', v.risesIn === null);
      if (v.risesIn !== null) {
        if (v.risesIn > this.lastRiseTotal || l.risesIn === -2) this.lastRiseTotal = Math.max(1, Math.min(4, v.risesIn));
        const total = this.lastRiseTotal;
        this.risePips.forEach((p, i) => {
          p.classList.toggle('off', i >= total);
          p.classList.toggle('on', i < total - v.risesIn!);
        });
        if (sl.bar) setText(sl.bar, this.style === 'c' ? `${v.risesIn}` : `RISES IN ${v.risesIn} BAR${v.risesIn === 1 ? '' : 'S'}`);
        this.root.classList.toggle('rise-soon', v.risesIn <= 1);
      }
      l.risesIn = v.risesIn;
    }
    const p = v.pulse.toFixed(2);
    if (p !== this.lastPulse) {
      this.lastPulse = p;
      this.root.style.setProperty('--beat', p);
    }
  }
}
