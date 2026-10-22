/**
 * Tutorial diagrams: small inline-SVG walls drawn in the game's own palette and glyphs.
 * A board is rows of characters, top row first:
 *   a m z j   amber, magenta, azure, jade        .  empty
 *   A M Z J   the same, primed (they detonate when the animated blade reaches them)
 *   H         held (Overcharged) amber           x  blasted by an Overcharge (pops with it)
 */

import { TILE_COLOURS, hex } from '../../render/palette.js';

const P = 22;
const S = 20;
/** One blade crossing (s) */
export const SWEEP_SEC = 2.6;

const KIND: Record<string, number> = { a: 0, m: 1, z: 2, j: 3 };

export interface BoardOpts {
  /** Animated blade sweeping left to right */
  blade?: boolean;
  /** Static blade at column (float) */
  bladeAt?: number;
  /** Highlight a rectangle of cells [c0, r0, c1, r1] */
  ring?: [number, number, number, number];
  /** Extra SVG drawn in board coordinates (labels, arrows) */
  overlay?: string;
  /** Extra padding around the board for labels: [top, right, bottom, left] */
  pad?: [number, number, number, number];
  /** Dashed line under this many rows (danger zone) */
  danger?: number;
}

function glyph(kind: number, cx: number, cy: number, colour: string): string {
  switch (TILE_COLOURS[kind]!.glyph) {
    case 'diamond':
      return `<path d="M${cx} ${cy - 4.5}L${cx + 4.5} ${cy}L${cx} ${cy + 4.5}L${cx - 4.5} ${cy}Z" fill="none" stroke="${colour}" stroke-width="1.4"/>`;
    case 'ring':
      return `<circle cx="${cx}" cy="${cy}" r="3.8" fill="none" stroke="${colour}" stroke-width="1.4"/>`;
    case 'bars':
      return `<path d="M${cx - 4.5} ${cy - 3}h9M${cx - 4.5} ${cy}h9M${cx - 4.5} ${cy + 3}h9" stroke="${colour}" stroke-width="1.3"/>`;
    case 'triangle':
      return `<path d="M${cx} ${cy - 4.2}L${cx + 4.6} ${cy + 3.6}L${cx - 4.6} ${cy + 3.6}Z" fill="none" stroke="${colour}" stroke-width="1.4"/>`;
    default:
      return '';
  }
}

export function tile(kind: number, x: number, y: number, state: 'idle' | 'primed' | 'held' = 'idle'): string {
  const c = TILE_COLOURS[kind]!;
  const fill = state === 'idle' ? hex(c.base) : state === 'held' ? '#ffe7b5' : hex(c.core);
  const g = glyph(kind, x + S / 2, y + S / 2, state === 'idle' ? 'rgba(0,0,0,0.38)' : hex(c.deep));
  const outline = state === 'primed' ? `<rect x="${x - 1}" y="${y - 1}" width="${S + 2}" height="${S + 2}" rx="4" fill="none" stroke="#fff" stroke-width="1.4"/>` : '';
  const heldRing = state === 'held' ? `<rect x="${x - 2}" y="${y - 2}" width="${S + 4}" height="${S + 4}" rx="5" fill="none" stroke="#ffc461" stroke-width="1.6" stroke-dasharray="3 2"/>` : '';
  return `<rect x="${x}" y="${y}" width="${S}" height="${S}" rx="3.5" fill="${fill}" opacity="${state === 'idle' ? 0.86 : 1}"/>${g}${outline}${heldRing}`;
}

export function board(rows: string[], o: BoardOpts = {}): string {
  const cols = Math.max(...rows.map(r => r.length));
  const [pt, pr, pb, pl] = o.pad ?? [6, 6, 6, 6];
  const w = cols * P;
  const h = rows.length * P;
  const vw = w + pl + pr;
  const vh = h + pt + pb;
  let body = `<rect x="-4" y="-4" width="${w + 6}" height="${h + 6}" rx="6" fill="rgba(11,13,21,0.9)" stroke="rgba(255,255,255,0.08)"/>`;
  for (let c = 4; c < cols; c += 4) body += `<rect x="${c * P - 1.5}" y="-2" width="1" height="${h + 2}" fill="rgba(255,255,255,0.06)"/>`;
  if (o.danger) body += `<line x1="-4" x2="${w + 2}" y1="${o.danger * P - 1}" y2="${o.danger * P - 1}" stroke="rgba(244,241,234,0.4)" stroke-dasharray="4 3"/>`;
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.' || ch === ' ') return;
      const x = c * P;
      const y = r * P;
      const lower = ch.toLowerCase();
      const kind = ch === 'H' || ch === 'x' ? (ch === 'H' ? 0 : -1) : KIND[lower] ?? 0;
      const primed = ch !== lower || ch === 'H';
      // A primed tile pops as the animated blade crosses its column
      const pop = o.blade && (primed || ch === 'x');
      const delay = ((c + 0.5) / cols) * SWEEP_SEC;
      const open = pop ? `<g class="tut-pop" style="animation-delay:${delay.toFixed(2)}s;transform-origin:${x + S / 2}px ${y + S / 2}px">` : '<g>';
      const t = ch === 'x' ? tile(r % 4, x, y) : tile(kind, x, y, ch === 'H' ? 'held' : primed ? 'primed' : 'idle');
      body += `${open}${t}</g>`;
    });
  });
  if (o.ring) {
    const [c0, r0, c1, r1] = o.ring;
    body += `<rect x="${c0 * P - 4}" y="${r0 * P - 4}" width="${(c1 - c0 + 1) * P + 6}" height="${(r1 - r0 + 1) * P + 6}" rx="6" fill="none" stroke="#ffc461" stroke-width="1.6" stroke-dasharray="5 3"/>`;
  }
  if (o.bladeAt !== undefined) body += bladeSvg(o.bladeAt * P, h);
  if (o.blade) body += `<g class="tut-blade" style="--w:${w}px">${bladeSvg(0, h)}</g>`;
  body += o.overlay ?? '';
  return `<svg class="tut-svg" viewBox="${-pl} ${-pt} ${vw} ${vh}" role="img" aria-hidden="true">${body}</svg>`;
}

function bladeSvg(x: number, h: number): string {
  return `<rect x="${x - 6}" y="-10" width="12" height="${h + 16}" fill="url(#tutBladeGlow)" opacity="0.55"/><rect x="${x - 0.75}" y="-10" width="1.5" height="${h + 16}" fill="#f2faff"/><path d="M${x} -16l4 4-4 4-4-4z" fill="#f2faff"/>`;
}

/** Shared SVG defs (blade glow gradient), injected once per page. */
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="tutBladeGlow" x1="0" x2="1"><stop offset="0" stop-color="#9edcff" stop-opacity="0"/><stop offset="0.5" stop-color="#9edcff" stop-opacity="0.9"/><stop offset="1" stop-color="#9edcff" stop-opacity="0"/></linearGradient><marker id="tutArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ffc461"/></marker></defs></svg>`;

export function label(x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start', colour = '#8a8fa3'): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="tut-label" fill="${colour}">${text}</text>`;
}

export function arrow(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#ffc461" stroke-width="1.4" fill="none" marker-end="url(#tutArrow)"/>`;
}

export const PITCH = P;
export const SIZE = S;
