/**
 * TileAtlas — every tile texture is drawn once at boot (at device pixel ratio) into one canvas and
 * sliced into sub-textures, so the whole wall batches into a single draw. Rebuilt only when
 * colour-assist toggles. No shadowBlur: glows are gradients.
 *
 * States: idle (per kind), primed and held (per kind x 16 corner masks: outer corners of a fused
 * slab round to 6 px, inner corners stay square), plus shared white sprites for tinting.
 */

import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { TUNING } from '../tuning.js';
import { HELD_GRADIENT, TILE_COLOURS, adjust, hex, rgba, type TileColour } from './palette.js';

const T = TUNING.TILE_PX; // 30
const CELL = T + 4; // 2 px padding around every tile
const PER_ROW = 17;
const KINDS = TILE_COLOURS.length;
/** Corner mask bits: which corners are rounded (outer, convex). */
export const CORNER_TL = 1;
export const CORNER_TR = 2;
export const CORNER_BR = 4;
export const CORNER_BL = 8;

export class TileAtlas {
  private source: TextureSource | null = null;
  private idleTex: Texture[] = [];
  private primedTex: Texture[] = [];
  private heldTex: Texture[] = [];
  glow!: Texture;
  innerGlow!: Texture;
  shard!: Texture;
  ring!: Texture;
  white!: Texture;
  diamond!: Texture;
  softDot!: Texture;
  vignette!: Texture;

  constructor(
    private readonly resolution: number,
    public assist = false
  ) {
    this.build();
  }

  idle(kind: number): Texture {
    return this.idleTex[kind % KINDS]!;
  }

  primed(kind: number, corners: number): Texture {
    return this.primedTex[(kind % KINDS) * 16 + (corners & 15)]!;
  }

  held(kind: number, corners: number): Texture {
    return this.heldTex[(kind % KINDS) * 16 + (corners & 15)]!;
  }

  setAssist(on: boolean): void {
    if (on === this.assist) return;
    this.assist = on;
    this.build();
  }

  private build(): void {
    const res = this.resolution;
    const tileCount = KINDS * 33;
    const tileRows = Math.ceil(tileCount / PER_ROW);
    const W = PER_ROW * CELL;
    const H = tileRows * CELL + 64 + 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(W * res);
    canvas.height = Math.ceil(H * res);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(res, res);

    const frames: Rectangle[] = [];
    let slot = 0;
    const next = (): { x: number; y: number } => {
      const x = (slot % PER_ROW) * CELL;
      const y = Math.floor(slot / PER_ROW) * CELL;
      slot++;
      frames.push(new Rectangle(x + 2, y + 2, T, T));
      return { x: x + 2, y: y + 2 };
    };

    const glyphAlpha = this.assist ? 0.85 : 0.55;
    for (let k = 0; k < KINDS; k++) {
      const c = TILE_COLOURS[k]!;
      const p = next();
      drawIdle(ctx, p.x, p.y, c, glyphAlpha);
      for (let m = 0; m < 16; m++) {
        const q = next();
        drawPrimed(ctx, q.x, q.y, c, m);
      }
      for (let m = 0; m < 16; m++) {
        const q = next();
        drawHeld(ctx, q.x, q.y, c, m, this.assist);
      }
    }

    // Shared white sprites (tinted at runtime) on the last strip
    const miscY = tileRows * CELL + 2;
    const glowRect = new Rectangle(2, miscY, 60, 60);
    const g = ctx.createRadialGradient(32, miscY + 30, 0, 32, miscY + 30, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(2, miscY, 60, 60);

    const innerRect = new Rectangle(66, miscY, T, T);
    drawInnerGlow(ctx, 66, miscY);

    const shardRect = new Rectangle(100, miscY, 8, 8);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(104, miscY);
    ctx.lineTo(108, miscY + 4);
    ctx.lineTo(104, miscY + 8);
    ctx.lineTo(100, miscY + 4);
    ctx.closePath();
    ctx.fill();

    const ringRect = new Rectangle(112, miscY, 10, 10);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(117, miscY + 5, 3.6, 0, Math.PI * 2);
    ctx.stroke();

    const whiteRect = new Rectangle(126, miscY, 4, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(126, miscY, 4, 4);

    const diamondRect = new Rectangle(134, miscY, 14, 14);
    ctx.save();
    ctx.translate(141, miscY + 7);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.restore();

    const dotRect = new Rectangle(152, miscY, 16, 16);
    const d = ctx.createRadialGradient(160, miscY + 8, 0, 160, miscY + 8, 8);
    d.addColorStop(0, 'rgba(255,255,255,1)');
    d.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = d;
    ctx.fillRect(152, miscY, 16, 16);

    const vigRect = new Rectangle(172, miscY, 60, 60);
    const v = ctx.createRadialGradient(202, miscY + 30, 4, 202, miscY + 30, 30);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v;
    ctx.fillRect(172, miscY, 60, 60);

    const old = this.source;
    const source = TextureSource.from(canvas);
    source.resolution = res;
    source.scaleMode = 'linear';
    this.source = source;
    const sub = (r: Rectangle): Texture => new Texture({ source, frame: r });

    this.idleTex = [];
    this.primedTex = [];
    this.heldTex = [];
    let i = 0;
    for (let k = 0; k < KINDS; k++) {
      this.idleTex.push(sub(frames[i++]!));
      for (let m = 0; m < 16; m++) this.primedTex.push(sub(frames[i++]!));
      for (let m = 0; m < 16; m++) this.heldTex.push(sub(frames[i++]!));
    }
    this.glow = sub(glowRect);
    this.innerGlow = sub(innerRect);
    this.shard = sub(shardRect);
    this.ring = sub(ringRect);
    this.white = sub(whiteRect);
    this.diamond = sub(diamondRect);
    this.softDot = sub(dotRect);
    this.vignette = sub(vigRect);
    old?.destroy();
  }
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]): void {
  const [tl, tr, br, bl] = r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

function cornerRadii(mask: number, r: number): [number, number, number, number] {
  return [mask & CORNER_TL ? r : 0, mask & CORNER_TR ? r : 0, mask & CORNER_BR ? r : 0, mask & CORNER_BL ? r : 0];
}

function glyphPath(ctx: CanvasRenderingContext2D, glyph: TileColour['glyph'], cx: number, cy: number): 'stroke' | 'fill' {
  ctx.beginPath();
  switch (glyph) {
    case 'diamond':
      ctx.moveTo(cx, cy - 6.5);
      ctx.lineTo(cx + 6.5, cy);
      ctx.lineTo(cx, cy + 6.5);
      ctx.lineTo(cx - 6.5, cy);
      ctx.closePath();
      return 'stroke';
    case 'ring':
      ctx.arc(cx, cy, 5.2, 0, Math.PI * 2);
      return 'stroke';
    case 'bars':
      for (let i = -1; i <= 1; i++) ctx.rect(cx - 6, cy + i * 4.2 - 1, 12, 2);
      return 'fill';
    case 'triangle':
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 6.4, cy + 5);
      ctx.lineTo(cx - 6.4, cy + 5);
      ctx.closePath();
      return 'stroke';
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * 6.2;
        const py = cy + Math.sin(a) * 6.2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return 'stroke';
  }
}

function drawGlyph(ctx: CanvasRenderingContext2D, c: TileColour, x: number, y: number, colour: string, carved: boolean): void {
  const cx = x + T / 2;
  const cy = y + T / 2;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  if (carved) {
    // 1 px light lip under the carve sells the depth
    const mode = glyphPath(ctx, c.glyph, cx, cy + 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    if (mode === 'stroke') ctx.stroke();
    else ctx.fill();
  }
  const mode = glyphPath(ctx, c.glyph, cx, cy);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  if (mode === 'stroke') ctx.stroke();
  else ctx.fill();
}

function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, radii: [number, number, number, number], hi: number, lo: number): void {
  ctx.save();
  roundedPath(ctx, x, y, T, T, radii);
  ctx.clip();
  ctx.fillStyle = `rgba(255,255,255,${hi})`;
  ctx.fillRect(x, y, T, 1);
  ctx.fillStyle = `rgba(0,0,0,${lo})`;
  ctx.fillRect(x, y + T - 3, T, 3);
  ctx.restore();
}

function drawIdle(ctx: CanvasRenderingContext2D, x: number, y: number, c: TileColour, glyphAlpha: number): void {
  const core = adjust(c.core, 0.72, 0.88);
  const base = adjust(c.base, 0.72, 0.88);
  const deep = adjust(c.deep, 0.72, 0.88);
  const g = ctx.createRadialGradient(x + T * 0.5, y + T * 0.38, 1, x + T * 0.5, y + T * 0.5, T * 0.72);
  g.addColorStop(0, hex(core));
  g.addColorStop(0.5, hex(base));
  g.addColorStop(1, hex(deep));
  const radii: [number, number, number, number] = [4, 4, 4, 4];
  roundedPath(ctx, x, y, T, T, radii);
  ctx.fillStyle = g;
  ctx.fill();
  bevel(ctx, x, y, radii, 0.32, 0.28);
  drawGlyph(ctx, c, x, y, rgba(c.deep === 0 ? 0 : adjust(c.deep, 0.55, 1), glyphAlpha), true);
}

function drawPrimed(ctx: CanvasRenderingContext2D, x: number, y: number, c: TileColour, mask: number): void {
  const radii = cornerRadii(mask, 6);
  const g = ctx.createRadialGradient(x + T * 0.5, y + T * 0.4, 1, x + T * 0.5, y + T * 0.5, T * 0.75);
  g.addColorStop(0, hex(c.primedCore));
  g.addColorStop(0.45, hex(c.core));
  g.addColorStop(1, hex(c.base));
  roundedPath(ctx, x, y, T, T, radii);
  ctx.fillStyle = g;
  ctx.fill();
  bevel(ctx, x, y, radii, 0.5, 0.18);
  // Inverted glyph: light on the bright slab, with a soft deep under-shadow for legibility
  ctx.save();
  ctx.translate(0, 0.8);
  drawGlyph(ctx, c, x, y, rgba(c.deep, 0.35), false);
  ctx.restore();
  drawGlyph(ctx, c, x, y, rgba(0xffffff, 0.96), false);
}

function drawHeld(ctx: CanvasRenderingContext2D, x: number, y: number, c: TileColour, mask: number, assist: boolean): void {
  const radii = cornerRadii(mask, 6);
  const g = ctx.createRadialGradient(x + T * 0.5, y + T * 0.42, 1, x + T * 0.5, y + T * 0.5, T * 0.74);
  g.addColorStop(0, HELD_GRADIENT[0]);
  g.addColorStop(0.5, HELD_GRADIENT[1]);
  g.addColorStop(1, HELD_GRADIENT[2]);
  roundedPath(ctx, x, y, T, T, radii);
  ctx.fillStyle = g;
  ctx.fill();
  bevel(ctx, x, y, radii, 0.6, 0.12);
  // Colour identity stays through the glyph
  drawGlyph(ctx, c, x, y, rgba(c.deep, assist ? 0.9 : 0.62), false);
}

function drawInnerGlow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // White inner glow frame: bright at the edges, clear in the middle (tinted by the group colour)
  ctx.save();
  roundedPath(ctx, x, y, T, T, [4, 4, 4, 4]);
  ctx.clip();
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - i / 6) ** 1.6})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5 + i, y + 0.5 + i, T - 1 - 2 * i, T - 1 - 2 * i);
  }
  ctx.restore();
}
