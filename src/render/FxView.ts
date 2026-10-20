/**
 * FxView — shards, score pops, hitstop, camera breath, held reticles + HOLD chips, queued pips,
 * the hold ring, All Clear / One Colour moments and the air-prime teaching ring.
 * Everything is pooled; nothing is allocated per frame.
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { TUNING, computeResonanceMultiplier } from '../tuning.js';
import type { PulseEvent } from '../pulse/types.js';
import type { TileAtlas } from './TileAtlas.js';
import { TILE_COLOURS, UI } from './palette.js';
import type { Stage } from './Stage.js';
import { G_HELD, G_OVER, G_QUEUED, WALL_GEOMETRY as G, type WallView } from './WallView.js';

const N = TUNING.FX_SHARD_POOL;
const POPS = 12;
const CHIPS = 6;
const PIPS = 16;
const FLASHES = 48;

export interface FxSettings {
  reducedMotion: boolean;
  /** 0..1 scales every flash, glow pulse and the All Clear flash */
  flash: number;
  strobeFree: boolean;
}

export class FxView {
  readonly settings: FxSettings = { reducedMotion: false, flash: 1, strobeFree: false };
  private readonly layer = new Container();
  private readonly shards: Sprite[] = [];
  private readonly sx = new Float32Array(N);
  private readonly sy = new Float32Array(N);
  private readonly svx = new Float32Array(N);
  private readonly svy = new Float32Array(N);
  private readonly slife = new Float32Array(N);
  private readonly smax = new Float32Array(N);
  private readonly svr = new Float32Array(N);
  private shardCursor = 0;
  private seed = 0x9e3779b9;

  private readonly flashes: Sprite[] = [];
  private readonly flashLife = new Float32Array(FLASHES);
  private flashCursor = 0;
  private readonly recentFlashes = new Float64Array(3);

  private readonly pops: Container[] = [];
  private readonly popPts: Text[] = [];
  private readonly popSub: Text[] = [];
  private readonly popLife = new Float32Array(POPS);
  private readonly popY = new Float32Array(POPS);
  private popCursor = 0;

  private readonly reticle = new Graphics();
  private readonly chips: Container[] = [];
  private readonly chipText: Text[] = [];
  private readonly pips: Sprite[] = [];
  private readonly holdRing = new Graphics();
  private readonly teachRing = new Graphics();
  private holdRingX = 0;
  private holdRingY = 0;
  private holdRingP = -1;
  private teachCx = 0;
  private teachCy = 0;
  private teachR = 0;
  private teachUntil = 0;
  private readonly thumbX = new Float32Array(4);
  private readonly thumbY = new Float32Array(4);
  private thumbCount = 0;
  private readonly preview = new Graphics();
  private readonly previewChip = new Container();
  private previewOn = false;

  private readonly floorFlash: Sprite;
  private readonly bigText: Text;
  private readonly bigSub: Text;
  private readonly bigLayer = new Container();
  private bigUntil = 0;
  private bigFadeSec = 0.5;
  private bigStart = 0;

  private hitstopUntil = 0;
  private breath = 0;
  private passBar = -1;
  private passGroups = 0;
  private now = 0;
  private reticleDirty = true;

  constructor(
    private readonly stage: Stage,
    private atlas: TileAtlas
  ) {
    stage.fx.addChild(this.layer);
    for (let i = 0; i < N; i++) {
      const s = new Sprite(atlas.shard);
      s.anchor.set(0.5);
      s.visible = false;
      this.shards.push(s);
      this.layer.addChild(s);
    }
    for (let i = 0; i < FLASHES; i++) {
      const f = new Sprite(atlas.glow);
      f.anchor.set(0.5);
      f.visible = false;
      f.blendMode = 'add';
      this.flashes.push(f);
      stage.glow.addChild(f);
    }
    this.layer.addChild(this.reticle);
    for (let i = 0; i < PIPS; i++) {
      const p = new Sprite(atlas.ring);
      p.anchor.set(0.5);
      p.width = 7;
      p.height = 7;
      p.visible = false;
      this.pips.push(p);
      this.layer.addChild(p);
    }
    const chipStyle = new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 8, fill: 0x05060a, letterSpacing: 0.8 });
    for (let i = 0; i < CHIPS; i++) {
      const c = new Container();
      const bg = new Graphics().roundRect(0, 0, 44, 13, 3).fill({ color: UI.held });
      const t = new Text({ text: 'HOLD ×2', style: chipStyle });
      t.anchor.set(0.5);
      t.position.set(22, 6.8);
      c.addChild(bg, t);
      c.visible = false;
      this.chips.push(c);
      this.chipText.push(t);
      this.layer.addChild(c);
    }

    for (let i = 0; i < POPS; i++) {
      // Own styles per pop: each pop is coloured by its group
      const ptsStyle = new TextStyle({ fontFamily: 'Unbounded', fontWeight: '700', fontSize: 17, fill: 0xffffff });
      const subStyle = new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 9, fill: 0xffffff, letterSpacing: 1 });
      const c = new Container();
      const a = new Text({ text: '0', style: ptsStyle });
      a.anchor.set(0.5, 1);
      const b = new Text({ text: '', style: subStyle });
      b.anchor.set(0.5, 0);
      b.y = 1;
      c.addChild(a, b);
      c.visible = false;
      this.pops.push(c);
      this.popPts.push(a);
      this.popSub.push(b);
      this.layer.addChild(c);
    }

    this.layer.addChild(this.holdRing, this.teachRing, this.preview);
    const pc = new Graphics().roundRect(0, 0, 66, 13, 3).stroke({ width: 1, color: UI.held, alpha: 0.9 });
    const pt = new Text({ text: '×2 · 8-WAY', style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 8, fill: UI.held, letterSpacing: 0.8 }) });
    pt.anchor.set(0.5);
    pt.position.set(33, 6.8);
    this.chipText.push(pt);
    this.previewChip.addChild(pc, pt);
    this.previewChip.visible = false;
    this.layer.addChild(this.previewChip);

    this.floorFlash = new Sprite(atlas.softDot);
    this.floorFlash.anchor.set(0.5);
    this.floorFlash.position.set(G.WX + G.WALL_W / 2, G.WY + G.WALL_H + 1);
    this.floorFlash.width = G.WALL_W + 60;
    this.floorFlash.height = 26;
    this.floorFlash.tint = 0xffe7b5;
    this.floorFlash.visible = false;
    this.floorFlash.blendMode = 'add';
    stage.glow.addChild(this.floorFlash);

    this.bigText = new Text({ text: 'ALL CLEAR', style: new TextStyle({ fontFamily: 'Unbounded', fontWeight: '700', fontSize: 50, fill: 0xfff6e4, letterSpacing: 2 }) });
    this.bigText.anchor.set(0.5);
    this.bigSub = new Text({ text: '', style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 13, fill: UI.held, letterSpacing: 3 }) });
    this.bigSub.anchor.set(0.5);
    this.bigSub.y = 38;
    this.bigLayer.addChild(this.bigText, this.bigSub);
    this.bigLayer.position.set(G.WX + G.WALL_W / 2, G.WY + 112);
    this.bigLayer.visible = false;
    stage.blade.addChild(this.bigLayer);
  }

  setAtlas(atlas: TileAtlas): void {
    this.atlas = atlas;
    for (const s of this.shards) s.texture = atlas.shard;
    for (const f of this.flashes) f.texture = atlas.glow;
    for (const p of this.pips) p.texture = atlas.ring;
  }

  /** Crisp text at any letterbox scale. */
  setTextResolution(res: number): void {
    for (const t of this.popPts) t.resolution = res;
    for (const t of this.popSub) t.resolution = res;
    for (const t of this.chipText) t.resolution = res;
    this.bigText.resolution = res;
    this.bigSub.resolution = res;
  }

  get frozen(): boolean {
    return this.now < this.hitstopUntil;
  }

  /** Zoom for the camera this frame (1 = rest). */
  get zoom(): number {
    return 1 + TUNING.CAMERA_BREATH_MAX * this.breath;
  }

  markGroupsDirty(): void {
    this.reticleDirty = true;
  }

  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  private canFlash(): boolean {
    if (!this.settings.strobeFree) return true;
    // Strobe-free: at most 3 flashes per second
    const oldest = this.recentFlashes[0]!;
    if (this.now - oldest < 1) return false;
    this.recentFlashes[0] = this.recentFlashes[1]!;
    this.recentFlashes[1] = this.recentFlashes[2]!;
    this.recentFlashes[2] = this.now;
    return true;
  }

  private spawnFlash(x: number, y: number, tint: number, scale: number, alpha: number): void {
    const f = this.flashes[this.flashCursor]!;
    this.flashLife[this.flashCursor] = 1;
    this.flashCursor = (this.flashCursor + 1) % FLASHES;
    f.visible = true;
    f.position.set(x, y);
    f.tint = tint;
    f.scale.set(scale);
    f.alpha = alpha * this.settings.flash;
  }

  private spawnShards(x: number, y: number, tint: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const k = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % N;
      const s = this.shards[k]!;
      s.visible = true;
      s.tint = tint;
      s.alpha = 1;
      const a = this.rand() * Math.PI * 2;
      const v = 60 + this.rand() * 170;
      this.sx[k] = x + (this.rand() - 0.5) * 20;
      this.sy[k] = y + (this.rand() - 0.5) * 20;
      if (this.settings.reducedMotion) {
        this.svx[k] = 0;
        this.svy[k] = 0;
        this.svr[k] = 0;
      } else {
        this.svx[k] = Math.cos(a) * v;
        this.svy[k] = Math.sin(a) * v - 90;
        this.svr[k] = (this.rand() - 0.5) * 14;
      }
      const life = 0.45 + this.rand() * 0.35;
      this.slife[k] = life;
      this.smax[k] = life;
      s.scale.set(0.7 + this.rand() * 0.9);
      s.rotation = a;
      s.position.set(this.sx[k]!, this.sy[k]!);
    }
  }

  private spawnPop(x: number, y: number, points: number, sub: string, tint: number): void {
    const i = this.popCursor;
    this.popCursor = (this.popCursor + 1) % POPS;
    const c = this.pops[i]!;
    c.visible = true;
    c.position.set(x, y);
    c.alpha = 1;
    this.popY[i] = y;
    this.popLife[i] = 0.6;
    this.popPts[i]!.text = points.toLocaleString('en-US');
    this.popPts[i]!.style.fill = tint;
    this.popSub[i]!.text = sub;
    this.popSub[i]!.style.fill = tint;
  }

  /** Engine events, in order, as they are drained each frame. */
  onEvent(ev: PulseEvent, wall: WallView): void {
    switch (ev.type) {
      case 'detonate': {
        if (ev.bar !== this.passBar) {
          this.passBar = ev.bar;
          this.passGroups = 0;
        }
        this.passGroups++;
        const colour = TILE_COLOURS[ev.kind % TILE_COLOURS.length]!;
        let cx = 0;
        let cy = 0;
        const n = ev.cells.length;
        const perCell = Math.max(1, Math.round((10 + Math.min(6, n)) / Math.max(1, n)));
        const flashOk = this.canFlash();
        for (const cell of ev.cells) {
          const x = G.WX + cell.col * G.PITCH + G.TILE / 2;
          const y = G.WY + cell.row * G.PITCH + G.TILE / 2;
          cx += x;
          cy += y;
          const tint = TILE_COLOURS[cell.kind % TILE_COLOURS.length]!.base;
          this.spawnShards(x, y, tint, ev.overcharged ? perCell + 1 : perCell);
          if (flashOk) this.spawnFlash(x, y, ev.overcharged ? UI.held : colour.core, ev.overcharged ? 1.1 : 0.8, 0.9);
        }
        cx /= Math.max(1, n);
        cy /= Math.max(1, n);
        this.spawnPop(cx, cy - 4, ev.points, `RESONANCE ×${computeResonanceMultiplier(ev.resonanceCount)}`, ev.overcharged ? UI.held : colour.core);
        if (this.passGroups >= TUNING.HITSTOP_CHAIN_THRESHOLD && this.passGroups === TUNING.HITSTOP_CHAIN_THRESHOLD) {
          this.hitstopUntil = this.now + TUNING.HITSTOP_MS / 1000;
        }
        if (!this.settings.reducedMotion && (this.passGroups >= TUNING.HITSTOP_CHAIN_THRESHOLD || ev.overcharged)) {
          this.breath = Math.min(1, Math.max(this.breath, 0.45 + 0.15 * this.passGroups));
        }
        break;
      }
      case 'allclear': {
        this.showBig('ALL CLEAR', `+${ev.points.toLocaleString('en-US')}`, 0xfff6e4, 50);
        if (this.canFlash()) {
          wall.allClearFlash = 1;
          this.floorFlash.visible = true;
          this.floorFlash.alpha = 1 * this.settings.flash;
        }
        if (!this.settings.reducedMotion) this.breath = 1;
        break;
      }
      case 'onecolour': {
        const c = TILE_COLOURS[ev.kind % TILE_COLOURS.length]!;
        this.showBig('ONE COLOUR', `+${ev.points.toLocaleString('en-US')}`, c.core, 30);
        break;
      }
      case 'prime':
      case 'hold':
      case 'cascade':
      case 'pressure':
        this.reticleDirty = true;
        break;
      default:
        break;
    }
  }

  private barSec = 2;

  private showBig(text: string, sub: string, colour: number, size: number): void {
    this.bigText.text = text;
    this.bigText.style.fontSize = size;
    this.bigText.style.fill = colour;
    this.bigSub.text = sub;
    this.bigSub.y = size * 0.72 + 6;
    this.bigLayer.visible = true;
    this.bigLayer.alpha = 1;
    this.bigStart = this.now;
    // Hold one bar, then fade
    this.bigUntil = this.now + this.barSec;
    this.bigFadeSec = 0.5;
  }

  /** Hold ring: p in [0,1] while a press is pending, -1 to hide. */
  setHoldRing(x: number, y: number, p: number): void {
    this.holdRingX = x;
    this.holdRingY = y;
    this.holdRingP = p;
  }

  /** Air-prime lesson: ring a falling group for `seconds`. */
  teach(cx: number, cy: number, r: number, seconds: number): void {
    this.teachCx = cx;
    this.teachCy = cy;
    this.teachR = r;
    this.teachUntil = this.now + seconds;
  }

  /** Overture: pulsing thumb rings on target groups (logical centres), or none. */
  setThumbRings(points: { x: number; y: number }[]): void {
    this.thumbCount = Math.min(4, points.length);
    for (let i = 0; i < this.thumbCount; i++) {
      this.thumbX[i] = points[i]!.x;
      this.thumbY[i] = points[i]!.y;
    }
  }

  /** Overture lesson 3: preview the 8-way blast zone of a group (cell bounds), or hide. */
  setBlastPreview(c0: number, r0: number, c1: number, r1: number, on: boolean): void {
    this.previewOn = on;
    this.preview.clear();
    this.previewChip.visible = on;
    if (!on) return;
    const x0 = G.WX + Math.max(0, c0 - 1) * G.PITCH - 3;
    const y0 = G.WY + Math.max(0, r0 - 1) * G.PITCH - 3;
    const x1 = G.WX + Math.min(G.COLS - 1, c1 + 1) * G.PITCH + G.TILE + 3;
    const y1 = G.WY + Math.min(G.ROWS - 1, r1 + 1) * G.PITCH + G.TILE + 3;
    const g = this.preview;
    for (let x = x0; x < x1; x += 7) {
      g.moveTo(x, y0).lineTo(Math.min(x + 4, x1), y0);
      g.moveTo(x, y1).lineTo(Math.min(x + 4, x1), y1);
    }
    for (let y = y0; y < y1; y += 7) {
      g.moveTo(x0, y).lineTo(x0, Math.min(y + 4, y1));
      g.moveTo(x1, y).lineTo(x1, Math.min(y + 4, y1));
    }
    g.stroke({ width: 1, color: UI.held, alpha: 0.55 });
    this.previewChip.position.set(x1 - 66, y0 - 17);
  }

  update(nowSec: number, dt: number, wall: WallView, barSec: number, beatProgress: number): void {
    this.now = nowSec;
    this.barSec = barSec;
    const g = 420;
    for (let k = 0; k < N; k++) {
      if (this.slife[k]! <= 0) continue;
      const s = this.shards[k]!;
      const life = this.slife[k]! - dt;
      this.slife[k] = life;
      if (life <= 0) {
        s.visible = false;
        continue;
      }
      this.svy[k] = this.svy[k]! + g * dt;
      this.sx[k] = this.sx[k]! + this.svx[k]! * dt;
      this.sy[k] = this.sy[k]! + this.svy[k]! * dt;
      s.position.set(this.sx[k]!, this.sy[k]!);
      s.rotation += this.svr[k]! * dt;
      s.alpha = Math.min(1, (life / this.smax[k]!) * 1.6);
    }
    for (let i = 0; i < FLASHES; i++) {
      if (this.flashLife[i]! <= 0) continue;
      const f = this.flashes[i]!;
      const l = this.flashLife[i]! - dt * 5;
      this.flashLife[i] = l;
      if (l <= 0) f.visible = false;
      else f.alpha = l * 0.9 * this.settings.flash;
    }
    for (let i = 0; i < POPS; i++) {
      if (this.popLife[i]! <= 0) continue;
      const c = this.pops[i]!;
      const l = this.popLife[i]! - dt;
      this.popLife[i] = l;
      if (l <= 0) {
        c.visible = false;
        continue;
      }
      const p = 1 - l / 0.6;
      c.y = this.popY[i]! - 12 * (1 - (1 - p) * (1 - p));
      c.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }

    // Camera breath decays (reduced motion never sets it)
    this.breath = Math.max(0, this.breath - dt * 2.2);

    if (this.floorFlash.visible) {
      this.floorFlash.alpha = Math.max(0, this.floorFlash.alpha - dt * 0.8);
      if (this.floorFlash.alpha <= 0) this.floorFlash.visible = false;
    }

    if (this.bigLayer.visible) {
      if (nowSec > this.bigUntil + this.bigFadeSec) this.bigLayer.visible = false;
      else if (nowSec > this.bigUntil) this.bigLayer.alpha = 1 - (nowSec - this.bigUntil) / this.bigFadeSec;
      else {
        const t = Math.min(1, (nowSec - this.bigStart) / 0.18);
        this.bigLayer.scale.set(this.settings.reducedMotion ? 1 : 0.92 + 0.08 * t);
        this.bigLayer.alpha = t;
      }
    }

    this.updateMarkers(wall, beatProgress);

    // Hold ring
    const hr = this.holdRing;
    hr.clear();
    if (this.holdRingP >= 0) {
      const r = 19;
      hr.circle(this.holdRingX, this.holdRingY, r).stroke({ width: 2, color: 0xffffff, alpha: 0.18 });
      if (this.holdRingP > 0) {
        hr.moveTo(this.holdRingX, this.holdRingY - r)
          .arc(this.holdRingX, this.holdRingY, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.holdRingP))
          .stroke({ width: 3, color: UI.held, alpha: 1, cap: 'round' });
      }
    }

    // Air-prime lesson ring
    const tr = this.teachRing;
    tr.clear();
    if (nowSec < this.teachUntil) {
      const pulse = 1 + 0.08 * Math.sin(nowSec * 10);
      tr.circle(this.teachCx, this.teachCy, this.teachR * pulse).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    }
    for (let i = 0; i < this.thumbCount; i++) {
      // Two rings breathing on the beat: a solid inner ring and an expanding echo
      const p = beatProgress;
      tr.circle(this.thumbX[i]!, this.thumbY[i]!, 12 + 2 * (1 - p)).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
      tr.circle(this.thumbX[i]!, this.thumbY[i]!, 14 + 16 * p).stroke({ width: 1.5, color: 0xffffff, alpha: 0.55 * (1 - p) * this.settings.flash });
    }
    if (this.previewOn) this.preview.alpha = 0.6 + 0.4 * (1 - beatProgress);
  }

  private updateMarkers(wall: WallView, beatProgress: number): void {
    let pip = 0;
    let chip = 0;
    if (this.reticleDirty) this.reticle.clear();
    for (let s = 0; s < wall.groupCount; s++) {
      const info = wall.groups[s]!;
      const trX = G.WX + info.trCol * G.PITCH + G.TILE;
      const trY = G.WY + info.trRow * G.PITCH;
      if (info.state === G_QUEUED && pip < PIPS) {
        const p = this.pips[pip++]!;
        p.visible = true;
        p.position.set(trX - 5, trY + 5);
        p.tint = 0xffffff;
        p.alpha = 0.95;
      }
      if (info.state === G_HELD || info.state === G_OVER) {
        const c0 = Math.max(0, info.anchorCol - 1);
        const c1 = Math.min(G.COLS - 1, info.maxCol + 1);
        const r0 = Math.max(0, info.minRow - 1);
        const r1 = Math.min(G.ROWS - 1, info.maxRow + 1);
        const x0 = G.WX + c0 * G.PITCH - 3;
        const y0 = G.WY + r0 * G.PITCH - 3;
        const x1 = G.WX + c1 * G.PITCH + G.TILE + 3;
        const y1 = G.WY + r1 * G.PITCH + G.TILE + 3;
        if (this.reticleDirty) this.drawReticle(x0, y0, x1, y1);
        if (chip < CHIPS) {
          const c = this.chips[chip++]!;
          c.visible = true;
          c.position.set(Math.min(G.WX + G.WALL_W - 44, x1 - 44), Math.max(2, y0 - 16));
        }
      }
    }
    this.reticleDirty = false;
    // Reticle breathes on the beat
    this.reticle.alpha = 0.7 + 0.3 * (1 - beatProgress) * this.settings.flash;
    for (let i = pip; i < PIPS; i++) this.pips[i]!.visible = false;
    for (let i = chip; i < CHIPS; i++) this.chips[i]!.visible = false;
  }

  private drawReticle(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.reticle;
    const dash = 4;
    const gap = 3;
    for (let x = x0 + 8; x < x1 - 8; x += dash + gap) {
      const e = Math.min(x + dash, x1 - 8);
      g.moveTo(x, y0).lineTo(e, y0);
      g.moveTo(x, y1).lineTo(e, y1);
    }
    for (let y = y0 + 8; y < y1 - 8; y += dash + gap) {
      const e = Math.min(y + dash, y1 - 8);
      g.moveTo(x0, y).lineTo(x0, e);
      g.moveTo(x1, y).lineTo(x1, e);
    }
    g.stroke({ width: 1, color: UI.held, alpha: 0.7 });
    const b = 7;
    g.moveTo(x0, y0 + b).lineTo(x0, y0).lineTo(x0 + b, y0);
    g.moveTo(x1 - b, y0).lineTo(x1, y0).lineTo(x1, y0 + b);
    g.moveTo(x1, y1 - b).lineTo(x1, y1).lineTo(x1 - b, y1);
    g.moveTo(x0 + b, y1).lineTo(x0, y1).lineTo(x0, y1 - b);
    g.stroke({ width: 2, color: UI.held, alpha: 1 });
  }
}
