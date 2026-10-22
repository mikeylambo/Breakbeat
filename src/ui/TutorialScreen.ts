/**
 * TutorialScreen — Tutorial & Tips. Left: the topic directory. Right: the topic's slides, each an
 * animated diagram drawn in the game's own tiles plus two or three lines of copy. Topics with a
 * drill get "Try it" (Enter or T): a small fixed board on the real wall with one goal, then back
 * here. ↑ ↓ topic, ← → slide, Esc back. The last entry replays the interactive Overture.
 */

import { goalText, type EtudeDef } from '../meta/Etude.js';
import { computeResonanceMultiplier, TUNING } from '../tuning.js';
import { DRILLS, drillDone } from './EtudeScreen.js';
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

const TOPICS: Topic[] = [
  {
    id: 'basics',
    name: 'The Basics',
    slides: [
      {
        title: 'You choose what breaks',
        body: 'Tap a group of <b>2 or more</b> touching blocks of the same colour to <b>prime</b> it. Single blocks can’t be primed.',
        art: board(['..........', '..zz.j....', 'amzZjjam..', 'aMMZzmmaj.', 'jjMaazjjaa'], { ring: [1, 3, 2, 4], overlay: label(2 * P, 6 * P + 4, 'PRIMED: 3 MAGENTA', 'middle', '#ffc461'), pad: [6, 6, 28, 6] })
      },
      {
        title: 'The music chooses when',
        body: 'The <b>blade</b> crosses the wall once every bar, one column per 16th note. A primed group goes off the moment the blade reaches it.',
        art: board(['............', '...MM.......', '..jjM...ZZ..', 'aamjzz.aZja.', 'jzzaam.ajjmm', 'mmajjzaazzaa'], { blade: true })
      },
      {
        title: 'Ahead or behind',
        body: 'Prime <b>ahead</b> of the blade and it goes off this pass. Prime <b>behind</b> it and it waits for the next pass.',
        art: board(['............', '..MM....jj..', '..aM....JJ..', 'zzamjj.amJza', 'jjzaam.zzmma'], {
          bladeAt: 6,
          pad: [22, 6, 6, 6],
          overlay: label(2.5 * P, -10, '← NEXT PASS', 'middle') + label(9 * P, -10, 'THIS PASS →', 'middle', '#ffc461')
        })
      }
    ]
  },
  {
    id: 'collapse',
    name: 'Collapse',
    slides: [
      {
        title: 'What goes up falls down',
        body: 'When a group detonates, the blocks above it <b>fall</b> into the gap, and empty columns <b>slide inward</b>. Falls can line up new groups for you.',
        art: board(['..........', '...m......', '...z......', '...A......', '..aAAj....', 'jjzmma.zz.'], {
          overlay: arrow(3 * P + S / 2, 1 * P - 4, 3 * P + S / 2, 3 * P + 2) + label(4.6 * P, 2 * P + 4, 'FALLS', 'start', '#ffc461')
        })
      }
    ]
  },
  {
    id: 'resonance',
    name: 'Resonance',
    slides: [
      {
        title: 'One pass, many groups',
        body: 'Every group that goes off in the <b>same pass</b> raises the multiplier for the rest. Set up several, then let one sweep take them all.',
        art: board(['............', '.MM...ZZ....', '.aM..jZm.AA.', 'jjzzaamzjAmz', 'mmajjzzaamjj'], { blade: true })
      },
      {
        title: 'The Resonance table',
        body: 'Groups in one pass and their multiplier. It keeps climbing past six, up to <b>×' + TUNING.RESONANCE_CAP + '</b>.',
        art: resonanceTable()
      }
    ]
  },
  {
    id: 'chain',
    name: 'Chain',
    slides: [
      {
        title: 'Keep the groove',
        body: 'Detonate something on <b>every pass</b> to build a chain: +' + TUNING.COMBO_STEP + '× per pass, up to ×' + TUNING.COMBO_CAP + '. A pass with nothing resets it.',
        art: chainArt()
      },
      {
        title: 'The band joins in',
        body: 'Chain rank brings the music’s layers in one at a time: <b>STEADY → GROOVE → DRIVE → SURGE → RESONANT</b>. Play well and the track gets fuller.',
        art: ranksArt()
      }
    ]
  },
  {
    id: 'overcharge',
    name: 'Charge & Overcharge',
    slides: [
      {
        title: 'Earn the Charge',
        body: 'Every detonation fills the <b>Charge</b> meter, and extra groups in the same pass fill it faster. Full meter: <b>HOLD READY</b>.',
        art: chargeArt()
      },
      {
        title: 'Hold to Overcharge',
        body: '<b>Long-press</b> a primed group to hold it. It skips one pass, then blasts <b>every block around it</b> in 8 directions for <b>×2</b>. A hold spends the full meter.',
        art: board(['..........', '..xxxx....', '..xHHx....', '..xHxx....', '.jxxxzam..', 'mmzajjzzaa'], { blade: true })
      }
    ]
  },
  {
    id: 'air',
    name: 'Air-primes',
    slides: [
      {
        title: 'Catch it mid-fall',
        body: 'Prime a group while any of its blocks are still <b>falling</b> for <b>×' + TUNING.AIR_MULT + '</b>. Falls are slowed so you always get at least a quarter of a second.',
        art: board(['..........', '....Z.....', '....Z.....', '..........', '...a.m....', 'jjzaamjjzz'], {
          overlay: arrow(4 * P + S / 2, 2 * P + S + 2, 4 * P + S / 2, 3 * P + S) + label(5.5 * P, 2 * P, 'IN THE AIR: ×1.25', 'start', '#ffc461')
        })
      }
    ]
  },
  {
    id: 'wall',
    name: 'The Rising Wall',
    slides: [
      {
        title: 'The wall keeps coming',
        body: 'Every two bars a new row pushes up from the bottom on the downbeat, tightening to every bar later on. <b>NEXT ROW</b> on the HUD counts it down.',
        art: risingArt()
      },
      {
        title: 'Danger',
        body: 'Blocks in the <b>top two rows</b> mean danger: the music muffles and the wall pulses. If a push has nowhere to go, the run is over.',
        art: board(['.mz..a....', 'jmzamaz...', 'jjzaamzz.m', 'mmajjzzaam', 'zzmmaajjzz'], { danger: 2, overlay: label(10 * P + 4, 2 * P - 4, 'DANGER', 'start', '#f4f1ea'), pad: [6, 64, 6, 6] })
      }
    ]
  },
  {
    id: 'scoring',
    name: 'Scoring & Bonuses',
    slides: [
      {
        title: 'Bigger groups, much bigger scores',
        body: 'A group is worth ' + TUNING.GEM_BASE + ' × size<sup>' + TUNING.SIZE_EXP + '</sup>, then × Resonance × Chain × Air × Overcharge. Growing a group pays more than splitting it.',
        art: sizeArt()
      },
      {
        title: 'Wall bonuses',
        body: '<b>All Clear</b>: empty the wall for ' + TUNING.ALL_CLEAR_BONUS.toLocaleString('en-US') + ' × chain, plus 3 fresh rows. <b>One Colour Left</b>: only one colour remains, ' + TUNING.ONE_COLOUR_BONUS.toLocaleString('en-US') + ' × chain.',
        art: board(['..........', '..........', '..........', '..........', '..........'], { overlay: label(5 * P, 2.2 * P, 'ALL CLEAR', 'middle', '#ffc461').replace('class="tut-label"', 'class="tut-label tut-big"') + label(5 * P, 3.4 * P, '10,000 × CHAIN', 'middle') })
      }
    ]
  },
  {
    id: 'symbols',
    name: 'Block Symbols',
    slides: [
      {
        title: 'A shape for every colour',
        body: 'Turn on <b>Block symbols</b> in Settings and each colour gets its own shape, so you never need to tell two colours apart. <b>Bold</b> makes them stronger. They never change the rules.',
        art: symbolsArt()
      }
    ]
  },
  {
    id: 'modes',
    name: 'Modes',
    slides: [
      {
        title: 'Ways to play',
        body: '<b>Odyssey</b>: 19 movements, each with a score quota and three challenge stars. <b>Endless</b>: every movement in turn. <b>Daily</b>: one fixed wall a day. <b>Zen</b>: no rising wall. <b>Etudes</b>: hand-built puzzles.',
        art: modesArt()
      }
    ]
  },
  {
    id: 'controls',
    name: 'Controls',
    slides: [
      {
        title: 'Touch, mouse and keys',
        body: `${kbd('Tap')} / ${kbd('Click')} prime · ${kbd('Long-press')} hold · ${kbd('Esc')} pause · ${kbd('V')} hide HUD · ${kbd('H')} HUD style · ${kbd('F')} fullscreen. With a mouse, hovering a group previews it.`,
        art: controlsArt()
      }
    ]
  },
  { id: 'overture', name: 'Play the Overture', slides: [] }
];

export class TutorialScreen {
  readonly root = el('div', 'tutorial hidden', '', { role: 'main', 'aria-label': 'Tutorial and tips' });
  private readonly menu: MenuList;
  private readonly stage = el('section', 'tut-stage', '', { 'aria-live': 'polite' });
  private readonly dots = el('div', 'tut-dots');
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
    left.append(el('h2', 'sl-title', 'Tutorial & Tips'), this.menu.root);
    const prev = el('button', 'tut-nav prev', '‹', { type: 'button', 'aria-label': 'Previous slide' });
    const next = el('button', 'tut-nav next', '›', { type: 'button', 'aria-label': 'Next slide' });
    prev.addEventListener('click', () => this.page(-1));
    next.addEventListener('click', () => this.page(1));
    const right = el('section', 'tut-right');
    right.append(this.stage, prev, next, this.dots);
    this.root.innerHTML = DEFS;
    this.root.append(el('div', 'sl-panel', '', { 'aria-hidden': 'true' }), left, right, el('div', 'sl-foot', '<b>↑ ↓</b>TOPIC<b>← →</b>SLIDE<b>T</b>TRY IT<b>ESC</b>BACK'));
    this.renderItems(0);
  }

  private drillFor(i: number): EtudeDef | null {
    return DRILLS.find(d => d.topic === TOPICS[i]?.id) ?? null;
  }

  /** Directory rows; topics with a drill carry a TRY IT tag (ticked once passed). */
  private renderItems(index: number): void {
    const items: MenuItem[] = TOPICS.map((t, i) => {
      const d = this.drillFor(i);
      const tag = d ? `<span class="tut-tag${drillDone(d) ? ' done' : ''}">${drillDone(d) ? '✓' : 'TRY IT'}</span>` : '';
      return {
        id: t.id,
        label: `${t.name}${d ? (drillDone(d) ? '. Drill passed.' : '. Has a drill.') : ''}`,
        cls: t.id === 'overture' ? 'tut-play' : '',
        action: () => (t.id === 'overture' ? this.a.overture() : d ? this.a.drill(d) : this.page(1)),
        html: `<span class="slab-i">${String(i + 1).padStart(2, '0')}</span><span class="mi-name">${t.name}</span>${tag}`
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
    const t = TOPICS[this.topic]!;
    if (!t.slides.length) return;
    const n = this.slide + d;
    if (n < 0 || n >= t.slides.length) {
      // Past the end of a topic: move on to the next one
      const k = this.topic + (n < 0 ? -1 : 1);
      if (k < 0 || k >= TOPICS.length || !TOPICS[k]!.slides.length) return;
      this.menu.select(k, true);
      this.topic = k;
      this.slide = n < 0 ? TOPICS[k]!.slides.length - 1 : 0;
    } else this.slide = n;
    uiSound('move', this.slide + 1);
    this.render();
  }

  private render(): void {
    const t = TOPICS[this.topic]!;
    this.root.classList.toggle('single', t.slides.length < 2);
    if (!t.slides.length) {
      this.stage.innerHTML = `<div class="tut-art">${board(['..........', '...jj.....', '..aJJm....', 'mmzajjzzaa'], { blade: true })}</div><div class="tut-copy"><div class="tut-kicker">INTERACTIVE</div><h3>Play the Overture</h3><p>The one-minute playable lesson from your first launch: tap, many groups, hold. It flows straight into Movement 01.</p><p class="tut-cta">${kbd('Enter')} to start</p></div>`;
      this.dots.innerHTML = '';
      return;
    }
    const s = t.slides[this.slide]!;
    this.stage.innerHTML = `<div class="tut-art">${s.art}</div><div class="tut-copy"><div class="tut-kicker">${t.name.toUpperCase()} · ${this.slide + 1}/${t.slides.length}</div><h3>${s.title}</h3><p>${s.body}</p></div>`;
    const d = this.drillFor(this.topic);
    if (d) {
      const done = drillDone(d);
      const b = el('button', `tut-try${done ? ' done' : ''}`, `<span class="tt-play">${ICONS.play}</span><span class="tt-text"><b>Try it${done ? ' ✓' : ''}</b><small>${d.name.toUpperCase()} · ${goalText(d.goal).toUpperCase()}</small></span><kbd>T</kbd>`, { type: 'button', 'aria-label': `Try it: ${d.name}. ${goalText(d.goal)}.` });
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
    this.dots.innerHTML = t.slides.map((_, i) => `<i class="${i === this.slide ? 'on' : ''}"></i>`).join('');
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
  b += label(194, 176, 'GROUPS IN ONE PASS', 'middle');
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
  b += label(8, 26, 'PASS WITH A DETONATION', 'start') + label(8 + 6 * 40 + 16, 116, 'MISSED: RESET', 'middle', '#ff8dbb');
  return svg(372, 128, b);
}

function ranksArt(): string {
  const words = ['STEADY', 'GROOVE', 'DRIVE', 'SURGE', 'RESONANT'];
  const colours = ['#8a8fa3', '#2e9ee8', '#2cc994', '#f2a93b', '#ffc461'];
  const stems = ['KICK + BASS', '+ KEYS', '+ LEAD', '+ TOP', 'FULL MIX'];
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
    b += label(222, y + 8, f >= 1 ? 'HOLD READY' : i === 0 ? '+1 GROUP' : '+3 GROUPS, ONE PASS', 'start', f >= 1 ? '#ffc461' : '#8a8fa3');
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
      label(10 * P + 30, 4.6 * P, 'NEXT ROW', 'start', '#ffc461') +
      label(10 * P + 30, 5.3 * P, 'RISES IN 2 BARS', 'start')
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
    b += label(x + (w * P) / 2 - 2, 98, `${n} BLOCKS`, 'middle');
    b += `<text x="${x + (w * P) / 2 - 2}" y="118" text-anchor="middle" class="tut-label tut-word" fill="#ffc461">${pts(n)}</text>`;
    x += w * P + 46;
  });
  return svg(360, 128, b);
}

function symbolsArt(): string {
  let b = '';
  const names = ['AMBER', 'MAGENTA', 'AZURE', 'JADE'];
  const marks = ['DIAMOND', 'RING', 'BARS', 'TRIANGLE'];
  for (let k = 0; k < 4; k++) {
    const x = 18 + k * 88;
    b += `<g transform="translate(${x} 22) scale(2.2)">${tile(k, 0, 0)}</g>`;
    b += label(x + 22, 92, names[k]!, 'middle', '#f4f1ea') + label(x + 22, 108, marks[k]!, 'middle');
  }
  return svg(370, 118, b).replace('class="tut-svg"', 'class="tut-svg tut-keep-sym"');
}

function modesArt(): string {
  const modes: [string, string][] = [
    ['ODYSSEY', '19 MOVEMENTS · ★★★ EACH'],
    ['ENDLESS', 'EVERY MOVEMENT IN TURN'],
    ['DAILY', 'ONE WALL A DAY'],
    ['ZEN', 'NO RISING WALL'],
    ['ETUDES', '8 PUZZLES']
  ];
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
    label(250, 40, 'TAP: PRIME', 'start', '#f4f1ea') +
    label(250, 60, 'HOLD 0.3 s: OVERCHARGE', 'start') +
    label(250, 80, 'ESC: PAUSE', 'start');
  return svg(400, 112, b);
}
