/**
 * ReplayView — loops the run's best pass: the wall as it stood at the start of that bar, the
 * blade crossing it, and each group bursting on the 16th it went off. Used on the results screen
 * and, rendered offscreen at 844x390, for share clips.
 */

import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { TUNING } from '../tuning.js';
import type { BestPassSnapshot } from '../pulse/types.js';
import { CORNER_BL, CORNER_BR, CORNER_TL, CORNER_TR, type TileAtlas } from './TileAtlas.js';
import { TILE_COLOURS, UI } from './palette.js';

const COLS = TUNING.BOARD_COLS;
const ROWS = TUNING.BOARD_ROWS;
const PITCH = TUNING.TILE_PX + TUNING.TILE_GAP_PX;
const TILE = TUNING.TILE_PX;
const W = COLS * PITCH - TUNING.TILE_GAP_PX;
const H = ROWS * PITCH - TUNING.TILE_GAP_PX;
const SHARDS = 160;

export class ReplayView {
  /** Wall-sized (510 x 318) content; scale/position `root` to place it. */
  readonly root = new Container();
  private readonly tiles: Sprite[] = [];
  private readonly glows: Sprite[] = [];
  private readonly blade: Sprite;
  private readonly bladeGlow: Sprite;
  private readonly frame = new Graphics();
  private readonly shards: Sprite[] = [];
  private readonly sv = new Float32Array(SHARDS * 5);
  private shardCursor = 0;
  private snap: BestPassSnapshot | null = null;
  private barSec = 2;
  private lastSixteenth = -1;
  private seed = 1234567;
  /** Optional caption (share clips) */
  readonly caption: Text;

  constructor(private readonly atlas: TileAtlas) {
    this.frame.roundRect(-8, -8, W + 16, H + 16, 10).fill({ color: UI.panel, alpha: 0.95 });
    this.frame.roundRect(-8.5, -8.5, W + 17, H + 17, 10.5).stroke({ width: 1, color: 0xffffff, alpha: 0.07 });
    for (let c = 1; c < COLS; c++) {
      this.frame.rect(c * PITCH - 1.5, 0, 1, H).fill({ color: 0xffffff, alpha: c % 4 === 0 ? 0.05 : 0.028 });
    }
    this.root.addChild(this.frame);
    const glowLayer = new Container();
    this.root.addChild(glowLayer);
    for (let i = 0; i < COLS * ROWS; i++) {
      const g = new Sprite(atlas.glow);
      g.anchor.set(0.5);
      g.visible = false;
      g.blendMode = 'add';
      this.glows.push(g);
      glowLayer.addChild(g);
      const s = new Sprite(atlas.idle(0));
      s.anchor.set(0.5);
      s.visible = false;
      this.tiles.push(s);
      this.root.addChild(s);
    }
    for (let i = 0; i < SHARDS; i++) {
      const s = new Sprite(atlas.shard);
      s.anchor.set(0.5);
      s.visible = false;
      this.shards.push(s);
      this.root.addChild(s);
    }
    this.bladeGlow = new Sprite(atlas.softDot);
    this.bladeGlow.anchor.set(0.5, 0.5);
    this.bladeGlow.width = 22;
    this.bladeGlow.height = H + 30;
    this.bladeGlow.y = H / 2;
    this.bladeGlow.tint = 0xbfe6ff;
    this.bladeGlow.alpha = 0.55;
    this.bladeGlow.blendMode = 'add';
    this.blade = new Sprite(atlas.white);
    this.blade.width = 2;
    this.blade.height = H + 12;
    this.blade.y = -6;
    this.blade.tint = UI.blade;
    this.root.addChild(this.bladeGlow, this.blade);
    this.caption = new Text({ text: '', style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 11, fill: UI.secondary, letterSpacing: 2 }) });
    this.caption.visible = false;
    this.root.addChild(this.caption);
  }

  get width(): number {
    return W;
  }

  get height(): number {
    return H;
  }

  setSnapshot(snap: BestPassSnapshot | null, bpm: number): void {
    this.snap = snap;
    this.barSec = (60 / bpm) * 4;
    this.lastSixteenth = -1;
    this.layout();
  }

  private primedAt(c: number, r: number, kind: number): boolean {
    const s = this.snap;
    if (!s) return false;
    for (const cell of s.cells) if (cell.col === c && cell.row === r) return cell.primed && cell.kind === kind;
    return false;
  }

  private layout(): void {
    for (const t of this.tiles) t.visible = false;
    for (const g of this.glows) g.visible = false;
    const s = this.snap;
    if (!s) return;
    s.cells.forEach((cell, i) => {
      const t = this.tiles[i]!;
      t.visible = true;
      t.position.set(cell.col * PITCH + TILE / 2, cell.row * PITCH + TILE / 2);
      if (cell.primed) {
        const up = this.primedAt(cell.col, cell.row - 1, cell.kind);
        const dn = this.primedAt(cell.col, cell.row + 1, cell.kind);
        const lf = this.primedAt(cell.col - 1, cell.row, cell.kind);
        const rt = this.primedAt(cell.col + 1, cell.row, cell.kind);
        let m = 0;
        if (!up && !lf) m |= CORNER_TL;
        if (!up && !rt) m |= CORNER_TR;
        if (!dn && !rt) m |= CORNER_BR;
        if (!dn && !lf) m |= CORNER_BL;
        t.texture = cell.overcharged ? this.atlas.held(cell.kind, m) : this.atlas.primed(cell.kind, m);
        const g = this.glows[i]!;
        g.visible = true;
        g.position.copyFrom(t.position);
        g.tint = cell.overcharged ? UI.held : TILE_COLOURS[cell.kind % TILE_COLOURS.length]!.base;
        g.alpha = cell.overcharged ? 0.8 : 0.45;
        g.scale.set(0.85);
      } else {
        t.texture = this.atlas.idle(cell.kind);
      }
    });
  }

  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  private burst(x: number, y: number, tint: number): void {
    for (let i = 0; i < 4; i++) {
      const k = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % SHARDS;
      const a = this.rand() * Math.PI * 2;
      const v = 50 + this.rand() * 140;
      const o = k * 5;
      this.sv[o] = x;
      this.sv[o + 1] = y;
      this.sv[o + 2] = Math.cos(a) * v;
      this.sv[o + 3] = Math.sin(a) * v - 70;
      this.sv[o + 4] = 0.6;
      const s = this.shards[k]!;
      s.visible = true;
      s.tint = tint;
      s.rotation = a;
    }
  }

  /** `t` is seconds since the loop started; the pass plays, then rests for half a bar. */
  update(t: number, dt: number): void {
    const s = this.snap;
    if (!s) return;
    const loop = this.barSec * 1.5;
    const p = (t % loop) / this.barSec;
    const inPass = p < 1;
    const sixteenth = inPass ? Math.floor(p * 16) : 16;
    if (sixteenth < this.lastSixteenth) this.layout();
    this.lastSixteenth = sixteenth;
    const x = Math.min(1, p) * W;
    this.blade.visible = inPass;
    this.bladeGlow.visible = inPass;
    this.blade.x = x - 1;
    this.bladeGlow.x = x;
    const cells = s.cells;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const tile = this.tiles[i]!;
      if (cell.detonatedStep !== null && cell.detonatedStep <= sixteenth && tile.visible) {
        tile.visible = false;
        this.glows[i]!.visible = false;
        this.burst(tile.x, tile.y, TILE_COLOURS[cell.kind % TILE_COLOURS.length]!.base);
      }
    }
    for (let k = 0; k < SHARDS; k++) {
      const o = k * 5;
      if (this.sv[o + 4]! <= 0) continue;
      const life = (this.sv[o + 4]! -= dt);
      const sp = this.shards[k]!;
      if (life <= 0) {
        sp.visible = false;
        continue;
      }
      this.sv[o + 3] = this.sv[o + 3]! + 380 * dt;
      this.sv[o] = this.sv[o]! + this.sv[o + 2]! * dt;
      this.sv[o + 1] = this.sv[o + 1]! + this.sv[o + 3]! * dt;
      sp.position.set(this.sv[o]!, this.sv[o + 1]!);
      sp.alpha = Math.min(1, life * 2);
    }
  }
}
