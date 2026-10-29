/**
 * TutorialScreen — Tutorial & Tips. Left: the topic directory. Right: the topic's slides, each an
 * animated diagram drawn in the game's own tiles plus two or three lines of copy. Topics with a
 * drill get "Try it" (Enter or T): a small fixed board on the real wall with one goal, then back
 * here. ↑ ↓ topic, ← → slide, Esc back. The last entry replays the interactive Overture.
 */

import { getLang, t, tx } from '../i18n/i18n.js';
import { goalText, type EtudeDef } from '../meta/Etude.js';
import { computeResonanceMultiplier, TUNING } from '../tuning.js';
import { DRILLS, drillDone, etudeName } from './EtudeScreen.js';
import { el, ICONS, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { arrow, board, DEFS, label, PITCH as P, SIZE as S, tile } from './tutorial/diagram.js';

export interface TutorialActions {
  back(): void;
  overture(): void;
  /** "Try it": play this topic's drill on the real wall */
  drill(def: EtudeDef): void;
}

interface Slide {
  title: string;
  body: string;
  art: string;
}

interface Topic {
  id: string;
  name: string;
  slides: Slide[];
}

const pts = (n: number): number => Math.round(TUNING.GEM_BASE * Math.pow(n, TUNING.SIZE_EXP));
const kbd = (k: string): string => `<kbd>${k}</kbd>`;

/** Built on first use, after the language is set. */
function topics(): Topic[] {
  const sl = (id: string, art: string, vars?: Record<string, string | number>): Slide => ({ title: tx(`tut.${id}.title`, id), body: tx(`tut.${id}.body`, id, vars), art });
  const tp = (id: string, slides: Slide[]): Topic => ({ id, name: tx(`tut.${id}`, id), slides });
  const n = (v: number): string => v.toLocaleString(getLang());
  return [
    tp('basics', [
      sl('basics.1', board(['..........', '..zz.j....', 'amzZjjam..', 'aMMZzmmaj.', 'jjMaazjjaa'], { ring: [1, 3, 2, 4], overlay: label(2 * P, 6 * P + 4, t('tut.art.primed3'), 'middle', '#ffc461'), pad: [6, 6, 28, 6] })),
      sl('basics.2', board(['............', '...MM.......', '..jjM...ZZ..', 'aamjzz.aZja.', 'jzzaam.ajjmm', 'mmajjzaazzaa'], { blade: true })),
      sl(
        'basics.3',
        board(['............', '..MM....jj..', '..aM....JJ..', 'zzamjj.amJza', 'jjzaam.zzmma'], {
          bladeAt: 6,
          pad: [22, 6, 6, 6],
          overlay: label(2.5 * P, -10, t('tut.art.nextPass'), 'middle') + label(9 * P, -10, t('tut.art.thisPass'), 'middle', '#ffc461')
        })
      )
    ]),
    tp('collapse', [
      sl(
        'collapse.1',
        board(['..........', '...m......', '...z......', '...A......', '..aAAj....', 'jjzmma.zz.'], {
          overlay: arrow(3 * P + S / 2, 1 * P - 4, 3 * P + S / 2, 3 * P + 2) + label(4.6 * P, 2 * P + 4, t('tut.art.falls'), 'start', '#ffc461')
        })
      )
    ]),
    tp('resonance', [
      sl('resonance.1', board(['............', '.MM...ZZ....', '.aM..jZm.AA.', 'jjzzaamzjAmz', 'mmajjzzaamjj'], { blade: true })),
      sl('resonance.2', resonanceTable(), { cap: TUNING.RESONANCE_CAP })
    ]),
    tp('chain', [sl('chain.1', chainArt(), { step: TUNING.COMBO_STEP, cap: TUNING.COMBO_CAP }), sl('chain.2', ranksArt(), { ranks: ['steady', 'groove', 'drive', 'surge', 'resonant'].map(r => tx(`hud.${r}`, r)).join(' → ') })]),
    tp('overcharge', [sl('overcharge.1', chargeArt()), sl('overcharge.2', board(['..........', '..xxxx....', '..xHHx....', '..xHxx....', '.jxxxzam..', 'mmzajjzzaa'], { blade: true }))]),
    tp('air', [
      sl(
        'air.1',
        board(['..........', '....Z.....', '....Z.....', '..........', '...a.m....', 'jjzaamjjzz'], {
          overlay: arrow(4 * P + S / 2, 2 * P + S + 2, 4 * P + S / 2, 3 * P + S) + label(5.5 * P, 2 * P, t('tut.art.inAir', { n: TUNING.AIR_MULT }), 'start', '#ffc461')
        }),
        { n: TUNING.AIR_MULT }
      )
    ]),
    tp('wall', [
      sl('wall.1', risingArt()),
      sl('wall.2', board(['.mz..a....', 'jmzamaz...', 'jjzaamzz.m', 'mmajjzzaam', 'zzmmaajjzz'], { danger: 2, overlay: label(10 * P + 4, 2 * P - 4, t('tut.art.danger'), 'start', '#f4f1ea'), pad: [6, 64, 6, 6] }))
    ]),
    tp('scoring', [
      sl('scoring.1', sizeArt(), { base: TUNING.GEM_BASE, exp: `<sup>${TUNING.SIZE_EXP}</sup>` }),
      sl(
        'scoring.2',
        board(['..........', '..........', '..........', '..........', '..........'], {
          overlay: label(5 * P, 2.2 * P, t('tut.art.allClear'), 'middle', '#ffc461').replace('class="tut-label"', 'class="tut-label tut-big"') + label(5 * P, 3.4 * P, t('tut.art.xChain', { n: n(TUNING.ALL_CLEAR_BONUS) }), 'middle')
        }),
        { all: n(TUNING.ALL_CLEAR_BONUS), one: n(TUNING.ONE_COLOUR_BONUS) }
      )
    ]),
    tp('symbols', [sl('symbols.1', symbolsArt())]),
    tp('modes', [sl('modes.1', modesArt())]),
    tp('controls', [sl('controls.1', controlsArt(), { tap: kbd(t('tut.key.tap')), click: kbd(t('tut.key.click')), press: kbd(t('tut.key.press')), esc: kbd('Esc'), v: kbd('V'), f: kbd('F') })]),
    tp('overture', [])
  ];
}

export class TutorialScreen {
  readonly root = el('div', 'tutorial hidden', '', { role: 'main', 'aria-label': t('tut.aria') });
  private readonly menu: MenuList;
  private readonly stage = el('section', 'tut-stage', '', { 'aria-live': 'polite' });
  private readonly dots = el('div', 'tut-dots');
  private readonly topics = topics();
  private topic = 0;
  private slide = 0;

  constructor(private readonly a: TutorialActions) {
    this.menu = new MenuList({
      cls: 'tut-menu',
      active: () => this.visible,
      onSelect: i => {
        this.topic = i;
        this.slide = 0;
        this.render();
      },
      onKey: e => {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          uiSound('back');
          this.a.back();
          return true;
        }
        if ((e.key === 't' || e.key === 'T') && !e.repeat) {
          const d = this.drillFor(this.topic);
          if (d) {
            uiSound('pick');
            this.a.drill(d);
          }
          return !!d;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          this.page(e.key === 'ArrowRight' ? 1 : -1);
          return true;
        }
        return false;
      }
    });
    const left = el('section', 'tut-left');
    left.append(el('h2', 'sl-title', t('title.tutorial')), this.menu.root);
    const prev = el('button', 'tut-nav prev', '‹', { type: 'button', 'aria-label': t('tut.prev') });
    const next = el('button', 'tut-nav next', '›', { type: 'button', 'aria-label': t('tut.next') });
    prev.addEventListener('click', () => this.page(-1));
    next.addEventListener('click', () => this.page(1));
    const right = el('section', 'tut-right');
    right.append(this.stage, prev, next, this.dots);
    this.root.innerHTML = DEFS;
    this.root.append(el('div', 'sl-panel', '', { 'aria-hidden': 'true' }), left, right, el('div', 'sl-foot', t('tut.keys')));
    this.renderItems(0);
  }

  private drillFor(i: number): EtudeDef | null {
    return DRILLS.find(d => d.topic === this.topics[i]?.id) ?? null;
  }

  /** Directory rows; topics with a drill carry a TRY IT tag (ticked once passed). */
  private renderItems(index: number): void {
    const items: MenuItem[] = this.topics.map((tp, i) => {
      const d = this.drillFor(i);
      const tag = d ? `<span class="tut-tag${drillDone(d) ? ' done' : ''}">${drillDone(d) ? '✓' : t('tut.tryTag')}</span>` : '';
      return {
        id: tp.id,
        label: d ? t(drillDone(d) ? 'tut.ariaDrillDone' : 'tut.ariaDrill', { name: tp.name }) : tp.name,
        cls: tp.id === 'overture' ? 'tut-play' : '',
        action: () => (tp.id === 'overture' ? this.a.overture() : d ? this.a.drill(d) : this.page(1)),
        html: `<span class="slab-i">${String(i + 1).padStart(2, '0')}</span><span class="mi-name">${tp.name}</span>${tag}`
      };
    });
    this.menu.setItems(items, index);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.renderItems(this.topic);
    this.menu.relayout();
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private page(d: number): void {
    const tp = this.topics[this.topic]!;
    if (!tp.slides.length) return;
    const n = this.slide + d;
    if (n < 0 || n >= tp.slides.length) {
      // Past the end of a topic: move on to the next one
      const k = this.topic + (n < 0 ? -1 : 1);
      if (k < 0 || k >= this.topics.length || !this.topics[k]!.slides.length) return;
      this.menu.select(k, true);
      this.topic = k;
      this.slide = n < 0 ? this.topics[k]!.slides.length - 1 : 0;
    } else this.slide = n;
    uiSound('move', this.slide + 1);
    this.render();
  }

  private render(): void {
    const tp = this.topics[this.topic]!;
    this.root.classList.toggle('single', tp.slides.length < 2);
    if (!tp.slides.length) {
      this.stage.innerHTML = `<div class="tut-art">${board(['..........', '...jj.....', '..aJJm....', 'mmzajjzzaa'], { blade: true })}</div><div class="tut-copy"><div class="tut-kicker">${t('tut.interactive')}</div><h3>${t('tut.overture')}</h3><p>${t('tut.overtureBody')}</p><p class="tut-cta">${t('tut.toStart', { key: kbd('Enter') })}</p></div>`;
      this.dots.innerHTML = '';
      return;
    }
    const s = tp.slides[this.slide]!;
    this.stage.innerHTML = `<div class="tut-art">${s.art}</div><div class="tut-copy"><div class="tut-kicker">${tp.name.toUpperCase()} · ${this.slide + 1}/${tp.slides.length}</div><h3>${s.title}</h3><p>${s.body}</p></div>`;
    const d = this.drillFor(this.topic);
    if (d) {
      const done = drillDone(d);
      const b = el('button', `tut-try${done ? ' done' : ''}`, `<span class="tt-play">${ICONS.play}</span><span class="tt-text"><b>${t('tut.try')}${done ? ' ✓' : ''}</b><small>${etudeName(d).toUpperCase()} · ${goalText(d.goal).toUpperCase()}</small></span><kbd>T</kbd>`, { type: 'button', 'aria-label': t('tut.ariaTry', { name: etudeName(d), goal: goalText(d.goal) }) });
      b.addEventListener('click', e => {
        e.stopPropagation();
        uiSound('pick');
        this.a.drill(d);
      });
      this.stage.querySelector('.tut-copy')!.appendChild(b);
    }
    this.stage.classList.remove('in');
    void this.stage.offsetWidth;
    this.stage.classList.add('in');
    this.dots.innerHTML = tp.slides.map((_, i) => `<i class="${i === this.slide ? 'on' : ''}"></i>`).join('');
  }
}

// ---------------------------------------------------------------- bespoke diagrams

function svg(w: number, h: number, body: string): string {
  return `<svg class="tut-svg" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">${body}</svg>`;
}

function resonanceTable(): string {
  let b = '';
  const n = [1, 2, 3, 4, 5, 6, 8, 10];
  n.forEach((g, i) => {
    const m = computeResonanceMultiplier(g);
    const x = 10 + i * 46;
    const h = 18 + m * 22;
    b += `<rect x="${x}" y="${140 - h}" width="34" height="${h}" rx="3" fill="${i >= 5 ? '#ffc461' : '#2e9ee8'}" opacity="${0.35 + i * 0.08}"/>`;
    b += label(x + 17, 132 - h, `×${m}`, 'middle', '#f4f1ea');
    b += label(x + 17, 158, `${g}`, 'middle');
  });
  b += label(194, 176, t('tut.art.groupsOnePass'), 'middle');
  return svg(380, 184, b);
}

function chainArt(): string {
  let b = '';
  for (let i = 0; i < 9; i++) {
    const x = 8 + i * 40;
    const ok = i !== 6;
    b += `<rect x="${x}" y="40" width="32" height="32" rx="5" fill="${ok ? 'rgba(46,158,232,0.25)' : 'rgba(224,54,126,0.18)'}" stroke="${ok ? '#2e9ee8' : '#e0367e'}"/>`;
    b += label(x + 16, 61, ok ? '✓' : '✕', 'middle', ok ? '#9edcff' : '#ff8dbb');
    const combo = i < 6 ? 1 + (i + 1) * 0.1 : i === 6 ? 1 : 1 + (i - 6) * 0.1;
    b += label(x + 16, 92, `×${combo.toFixed(1)}`, 'middle', i === 6 ? '#ff8dbb' : '#f4f1ea');
  }
  b += label(8, 26, t('tut.art.passDet'), 'start') + label(8 + 6 * 40 + 16, 116, t('tut.art.missed'), 'middle', '#ff8dbb');
  return svg(372, 128, b);
}

function ranksArt(): string {
  const words = ['steady', 'groove', 'drive', 'surge', 'resonant'].map(r => tx(`hud.${r}`, r));
  const colours = ['#8a8fa3', '#2e9ee8', '#2cc994', '#f2a93b', '#ffc461'];
  const stems = ['kickBass', 'keys', 'lead', 'top', 'full'].map(k => tx(`tut.art.${k}`, k));
  let b = '';
  words.forEach((w, i) => {
    const y = 14 + i * 30;
    for (let k = 0; k < 5; k++) b += `<rect x="${170 + k * 18}" y="${y + 2}" width="14" height="5" transform="skewX(-18)" fill="${k <= i ? colours[i] : 'rgba(244,241,234,0.12)'}"/>`;
    b += `<text x="8" y="${y + 9}" class="tut-label tut-word" fill="${colours[i]}">${w}</text>`;
    b += label(290, y + 9, stems[i]!, 'start');
  });
  return svg(380, 160, b);
}

function chargeArt(): string {
  let b = '';
  const fills = [0.24, 0.56, 1];
  fills.forEach((f, i) => {
    const y = 18 + i * 44;
    b += `<rect x="10" y="${y}" width="200" height="8" fill="rgba(244,241,234,0.1)"/><rect x="10" y="${y}" width="${200 * f}" height="8" fill="${f >= 1 ? '#ffc461' : '#8a8fa3'}"/>`;
    b += label(222, y + 8, f >= 1 ? t('hud.holdReady') : i === 0 ? t('tut.art.plus1') : t('tut.art.plus3'), 'start', f >= 1 ? '#ffc461' : '#8a8fa3');
  });
  return svg(380, 140, b);
}

function risingArt(): string {
  const rows = ['..........', '..........', '...mz.....', '.ajmzz.a..', 'jjzaamzzam', 'MAZJMAZJMA'];
  return board(rows, {
    pad: [6, 92, 6, 6],
    overlay:
      `<rect x="-4" y="${5 * P - 3}" width="${10 * P + 2}" height="${P + 2}" fill="none" stroke="#ffc461" stroke-dasharray="4 3" rx="4"/>` +
      arrow(10 * P + 18, 6 * P, 10 * P + 18, 4 * P + 6) +
      label(10 * P + 30, 4.6 * P, t('hud.nextRow'), 'start', '#ffc461') +
      label(10 * P + 30, 5.3 * P, t('tut.art.risesIn2'), 'start')
  }).replace(/stroke="#fff" stroke-width="1.4"/g, 'stroke="none"');
}

function sizeArt(): string {
  let b = '';
  const groups: [number, number, number][] = [
    [2, 2, 1],
    [4, 2, 2],
    [9, 3, 3]
  ];
  let x = 10;
  groups.forEach(([n, w, h], gi) => {
    for (let i = 0; i < n; i++) b += tile(gi === 2 ? 3 : gi === 1 ? 2 : 1, x + (i % w) * P, 74 - h * P + Math.floor(i / w) * P, 'idle');
    b += label(x + (w * P) / 2 - 2, 98, t('tut.art.blocks', { n }), 'middle');
    b += `<text x="${x + (w * P) / 2 - 2}" y="118" text-anchor="middle" class="tut-label tut-word" fill="#ffc461">${pts(n)}</text>`;
    x += w * P + 46;
  });
  return svg(360, 128, b);
}

function symbolsArt(): string {
  let b = '';
  const names = ['amber', 'magenta', 'azure', 'jade'].map(k => tx(`colour.${k}`, k).toUpperCase());
  const marks = ['diamond', 'ring', 'bars', 'triangle'].map(k => tx(`tut.art.${k}`, k));
  for (let k = 0; k < 4; k++) {
    const x = 18 + k * 88;
    b += `<g transform="translate(${x} 22) scale(2.2)">${tile(k, 0, 0)}</g>`;
    b += label(x + 22, 92, names[k]!, 'middle', '#f4f1ea') + label(x + 22, 108, marks[k]!, 'middle');
  }
  return svg(370, 118, b).replace('class="tut-svg"', 'class="tut-svg tut-keep-sym"');
}

function modesArt(): string {
  const modes: [string, string][] = ['odyssey', 'endless', 'daily', 'zen', 'etudes'].map(m => [tx(`title.${m}`, m).toUpperCase(), tx(`tut.art.mode.${m}`, m)]);
  let b = '';
  modes.forEach(([m, d], i) => {
    const y = 8 + i * 30;
    b += `<path d="M${14 + i * 4} ${y}h170l-8 24h-170z" fill="${i === 0 ? '#ffc461' : 'rgba(244,241,234,0.07)'}"/>`;
    b += `<text x="${18 + i * 4}" y="${y + 17}" class="tut-label tut-word" fill="${i === 0 ? '#1a0f02' : '#f4f1ea'}">${m}</text>`;
    b += label(200 + i * 4, y + 16, d, 'start');
  });
  return svg(380, 160, b);
}

function controlsArt(): string {
  const b =
    board(['..........', '..ZZ......', '.aZm......', 'jjzaam.zz.'], { pad: [6, 6, 6, 6] }).replace('<svg class="tut-svg"', '<svg class="tut-svg" x="0" y="0" width="240" height="110"') +
    `<g transform="translate(70 30)"><circle cx="0" cy="0" r="16" fill="none" stroke="#ffc461" stroke-width="2" class="tut-press"/><circle cx="0" cy="0" r="5" fill="#ffc461"/></g>` +
    label(250, 40, t('tut.art.tapPrime'), 'start', '#f4f1ea') +
    label(250, 60, t('tut.art.holdOver'), 'start') +
    label(250, 80, t('tut.art.escPause'), 'start');
  return svg(400, 112, b);
}
