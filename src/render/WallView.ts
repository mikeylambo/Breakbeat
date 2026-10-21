/**
 * WallView — tiles (idle / lit / primed / held), fused primed slabs with a single perimeter outline,
 * light spill on the glow layer, beat lines, the danger line and the next-row preview strip.
 *
 * Per-frame work only moves and re-textures pooled sprites. Group structure (membership, corner
 * masks, lit neighbours, outlines) is rebuilt only when the engine reports a change (`markDirty`).
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { TUNING } from '../tuning.js';
import type { PulseEngine } from '../pulse/PulseEngine.js';
import type { BeatQuery } from '../pulse/BeatClock.js';
import { CORNER_BL, CORNER_BR, CORNER_TL, CORNER_TR, type TileAtlas } from './TileAtlas.js';
import { HELD_GRADIENT, TILE_COLOURS, UI } from './palette.js';
import type { Stage } from './Stage.js';

const COLS = TUNING.BOARD_COLS;
const ROWS = TUNING.BOARD_ROWS;
const CELLS = COLS * ROWS;
const PITCH = TUNING.TILE_PX + TUNING.TILE_GAP_PX;
const TILE = TUNING.TILE_PX;
const WX = TUNING.WALL_X;
const WY = TUNING.WALL_Y;
const WALL_W = COLS * PITCH - TUNING.TILE_GAP_PX;
const WALL_H = ROWS * PITCH - TUNING.TILE_GAP_PX;

/** Group render states */
export const G_ACTIVE = 0;
export const G_QUEUED = 1;
export const G_HELD = 2;
export const G_OVER = 3;

export interface WallGroupInfo {
  id: number;
  kind: number;
  state: number;
  /** Leftmost column (the blade fires it as it reaches this column) */
  anchorCol: number;
  minRow: number;
  maxRow: number;
  maxCol: number;
  /** Top-right tile (queued pip / HOLD chip anchor) */
  trCol: number;
  trRow: number;
  due: boolean;
}

export class WallView {
  readonly tiles: Sprite[] = [];
  private readonly lit: Sprite[] = [];
  private readonly glows: Sprite[] = [];
  private readonly preview: Sprite[] = [];
  private readonly slabFill = new Graphics();
  private readonly outline = new Graphics();
  private readonly beatFaint = new Graphics();
  private readonly beatStrong = new Graphics();
  private readonly dangerLine = new Graphics();
  private readonly backing = new Graphics();
  private readonly tileLayer = new Container();
  private readonly allClearGlow: Sprite;
  private tintCurrent = 0x1a2340;
  private tintFrom = 0x1a2340;
  private tintTo = 0x1a2340;
  private tintStart = 0;
  private tintDur = 0;

  /** cell -> group slot (-1 none) */
  readonly memberSlot = new Int16Array(CELLS).fill(-1);
  private readonly corner = new Uint8Array(CELLS);
  private readonly litKind = new Int8Array(CELLS).fill(-1);
  readonly groups: WallGroupInfo[] = [];
  groupCount = 0;
  private readonly idToCell = new Map<number, number>();
  /** Cells outside the Overture focus are dimmed to 34% (null = no focus). */
  focus: Uint8Array | null = null;

  private dirty = true;
  private pushStartSec = -1;
  /** Per-group anticipation squash this frame (by slot) */
  private readonly squash = new Float32Array(64);
  reducedMotion = false;
  flashScale = 1;
  dangerLevel = 0;
  allClearFlash = 0;

  constructor(
    private readonly stage: Stage,
    private atlas: TileAtlas
  ) {
    for (let i = 0; i < 64; i++) {
      this.groups.push({ id: 0, kind: 0, state: 0, anchorCol: 0, minRow: 0, maxRow: 0, maxCol: 0, trCol: 0, trRow: 0, due: false });
    }
    this.buildStatic();
    for (let i = 0; i < CELLS + 16; i++) {
      const s = new Sprite(atlas.idle(0));
      s.anchor.set(0.5);
      s.visible = false;
      this.tiles.push(s);
      this.tileLayer.addChild(s);
    }
    for (let i = 0; i < CELLS; i++) {
      const l = new Sprite(atlas.innerGlow);
      l.anchor.set(0.5);
      l.visible = false;
      l.blendMode = 'add';
      this.lit.push(l);
      const g = new Sprite(atlas.glow);
      g.anchor.set(0.5);
      g.visible = false;
      g.blendMode = 'add';
      this.glows.push(g);
      stage.glow.addChild(g);
    }
    stage.wall.addChild(this.tileLayer, this.slabFill);
    for (const l of this.lit) stage.wall.addChild(l);
    stage.outlines.addChild(this.outline);

    this.allClearGlow = new Sprite(atlas.vignette);
    this.allClearGlow.anchor.set(0.5);
    this.allClearGlow.position.set(WX + WALL_W / 2, WY + WALL_H / 2);
    this.allClearGlow.width = WALL_W * 1.25;
    this.allClearGlow.height = WALL_H * 1.3;
    this.allClearGlow.tint = 0xffc461;
    this.allClearGlow.visible = false;
    this.allClearGlow.blendMode = 'add';
    stage.glow.addChild(this.allClearGlow);
  }

  setAtlas(atlas: TileAtlas): void {
    this.atlas = atlas;
    for (const l of this.lit) l.texture = atlas.innerGlow;
    for (const g of this.glows) g.texture = atlas.glow;
    this.dirty = true;
  }

  private buildStatic(): void {
    const bg = this.stage.background;
    // Soft pool of light behind the wall

    this.backing.roundRect(WX - 8, WY - 8, WALL_W + 16, WALL_H + 12, 10).fill({ color: UI.panel, alpha: 0.92 });
    this.backing.roundRect(WX - 8.5, WY - 8.5, WALL_W + 17, WALL_H + 13, 10.5).stroke({ width: 1, color: 0xffffff, alpha: 0.06 });
    bg.addChild(this.backing);

    for (let c = 1; c < COLS; c++) {
      const x = WX + c * PITCH - 1.5;
      if (c % 4 === 0) this.beatStrong.rect(x, WY - 2, 1, WALL_H + 4);
      else this.beatFaint.rect(x, WY, 1, WALL_H);
    }
    this.beatFaint.fill({ color: 0xffffff, alpha: 0.028 });
    this.beatStrong.fill({ color: 0xffffff, alpha: 1 });
    this.beatStrong.alpha = 0.05;
    bg.addChild(this.beatFaint, this.beatStrong);

    const dy = WY + TUNING.DANGER_ROWS * PITCH - 1.5;
    this.dangerLine.rect(WX - 4, dy, WALL_W + 8, 1).fill({ color: UI.danger, alpha: 1 });
    this.dangerLine.alpha = 0.32;
    this.stage.outlines.addChild(this.dangerLine);

    for (let c = 0; c < COLS; c++) {
      const p = new Sprite(this.atlas.white);
      p.position.set(WX + c * PITCH, TUNING.PREVIEW_Y);
      p.width = TILE;
      p.height = 6;
      p.alpha = 0.38;
      this.preview.push(p);
      bg.addChild(p);
    }
  }

  /** Movement background: crossfade the light pool behind the wall over `seconds`. */
  setPoolTint(tint: number, nowSec: number, seconds: number): void {
    this.tintFrom = this.tintCurrent;
    this.tintTo = tint;
    this.tintStart = nowSec;
    this.tintDur = Math.max(0.001, seconds);
    if (seconds <= 0) this.applyPool(tint);
  }

  /** The light pool behind the wall is a CSS gradient under the transparent canvas (free to composite). */
  private applyPool(tint: number): void {
    this.tintCurrent = tint;
    const host = document.getElementById('game');
    host?.style.setProperty('--pool', `#${tint.toString(16).padStart(6, '0')}`);
  }

  private updatePool(nowSec: number): void {
    if (this.tintDur <= 0) return;
    const p = Math.min(1, Math.max(0, (nowSec - this.tintStart) / this.tintDur));
    const a = this.tintFrom;
    const b = this.tintTo;
    const mix = (sh: number): number => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * p) << sh;
    this.applyPool(mix(16) | mix(8) | mix(0));
    if (p >= 1) this.tintDur = 0;
  }

  markDirty(): void {
    this.dirty = true;
  }

  private collapseStart = -1;
  private dealStart = -1;

  private rankPulseLeft = 0;
  private rankTint = 0xffffff;

  /** Chain rank up: a quick accent glow across the wall. */
  rankPulse(tint: number): void {
    this.rankTint = tint;
    this.rankPulseLeft = 1;
  }

  /** Game over: the wall falls away row by row (bottom first), tumbling, over ~1.3 s. */
  collapse(nowSec: number): void {
    this.collapseStart = nowSec;
  }

  /** Run start: tiles drop in row by row from above over ~0.6 s. */
  dealIn(nowSec: number): void {
    this.collapseStart = -1;
    this.dealStart = this.reducedMotion ? -1 : nowSec;
  }

  /** Per-tile transition offset (collapse or deal-in); writes into `tx` (dy, rotation, alpha). */
  private readonly tx = { dy: 0, rot: 0, a: 1 };
  private transition(r: number, c: number, id: number, now: number): void {
    const t = this.tx;
    t.dy = 0;
    t.rot = 0;
    t.a = 1;
    if (this.collapseStart >= 0) {
      const delay = (ROWS - 1 - r) * 0.07 + ((id * 37) % 7) * 0.012;
      const e = now - this.collapseStart - delay;
      if (e > 0) {
        if (this.reducedMotion) {
          t.a = Math.max(0, 1 - e / 0.4);
        } else {
          t.dy = 520 * e * e;
          t.rot = (((id * 7919) % 200) / 100 - 1) * e * 3;
          t.a = Math.max(0, 1 - e / 0.9);
        }
      }
    } else if (this.dealStart >= 0) {
      const delay = (ROWS - 1 - r) * 0.045 + c * 0.008;
      const p = Math.min(1, Math.max(0, (now - this.dealStart - delay) / 0.28));
      if (p >= 1 && now - this.dealStart > 1.2) this.dealStart = -1;
      const e = 1 - (1 - p) * (1 - p) * (1 - p);
      t.dy = -(1 - e) * 120;
      t.a = p;
    }
  }

  /** Pressure push: the whole wall slides up one row over 160 ms. */
  startPush(visualSec: number): void {
    if (!this.reducedMotion) this.pushStartSec = visualSec;
  }

  cellAt(x: number, y: number): number {
    const c = Math.floor((x - WX + 1) / PITCH);
    const r = Math.floor((y - WY + 1) / PITCH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
    return r * COLS + c;
  }

  private rebuild(engine: PulseEngine): void {
    this.dirty = false;
    const board = engine.board;
    this.idToCell.clear();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = board[r]![c];
        if (t) this.idToCell.set(t.id, r * COLS + c);
      }
    }
    this.memberSlot.fill(-1);
    this.litKind.fill(-1);
    this.corner.fill(0);
    let slot = 0;
    for (const g of engine.groups.values()) {
      if (slot >= this.groups.length) break;
      const info = this.groups[slot]!;
      info.id = g.id;
      info.kind = g.kind;
      info.state = g.state === 'queued' ? G_QUEUED : g.state === 'held' ? G_HELD : g.state === 'overcharged' ? G_OVER : G_ACTIVE;
      if (g.state === 'held' && g.targetBar > Math.max(1, engine.currentBar)) info.state = G_HELD;
      info.minRow = ROWS;
      info.maxRow = -1;
      info.anchorCol = COLS;
      info.maxCol = -1;
      info.trRow = ROWS;
      info.trCol = -1;
      let n = 0;
      for (const id of g.tileIds) {
        const cell = this.idToCell.get(id);
        if (cell === undefined) continue;
        n++;
        this.memberSlot[cell] = slot;
        const r = (cell / COLS) | 0;
        const c = cell % COLS;
        if (c < info.anchorCol) info.anchorCol = c;
        if (c > info.maxCol) info.maxCol = c;
        if (r < info.minRow) info.minRow = r;
        if (r > info.maxRow) info.maxRow = r;
        if (r < info.trRow || (r === info.trRow && c > info.trCol)) {
          info.trRow = r;
          info.trCol = c;
        }
      }
      if (n > 0) slot++;
    }
    this.groupCount = slot;

    // Corner masks + lit neighbours
    for (let cell = 0; cell < CELLS; cell++) {
      const s = this.memberSlot[cell]!;
      if (s < 0) continue;
      const r = (cell / COLS) | 0;
      const c = cell % COLS;
      const up = this.same(s, c, r - 1);
      const dn = this.same(s, c, r + 1);
      const lf = this.same(s, c - 1, r);
      const rt = this.same(s, c + 1, r);
      let m = 0;
      if (!up && !lf) m |= CORNER_TL;
      if (!up && !rt) m |= CORNER_TR;
      if (!dn && !rt) m |= CORNER_BR;
      if (!dn && !lf) m |= CORNER_BL;
      this.corner[cell] = m;
      const info = this.groups[s]!;
      const eight = info.state === G_HELD || info.state === G_OVER;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (!eight && dr !== 0 && dc !== 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          const ncell = nr * COLS + nc;
          if (this.memberSlot[ncell]! >= 0 || !board[nr]![nc]) continue;
          // Held (8-way) light wins over orthogonal primed spill
          if (this.litKind[ncell]! < 0 || eight) this.litKind[ncell] = eight ? 5 : info.kind;
        }
      }
    }
    this.drawSlabs();
  }

  private same(slot: number, c: number, r: number): boolean {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return this.memberSlot[r * COLS + c] === slot;
  }

  /** Gap fills between member tiles and one 2 px perimeter per group (rebuilt on change only). */
  private drawSlabs(): void {
    const f = this.slabFill;
    const o = this.outline;
    f.clear();
    o.clear();
    for (let s = 0; s < this.groupCount; s++) {
      const info = this.groups[s]!;
      const col = TILE_COLOURS[info.kind % TILE_COLOURS.length]!;
      const heldish = info.state === G_HELD || info.state === G_OVER;
      const fillColour = heldish ? 0xffae3d : col.base;
      const lineColour = heldish ? 0xffffff : col.primedCore;
      for (let r = info.minRow; r <= info.maxRow; r++) {
        for (let c = info.anchorCol; c <= info.maxCol; c++) {
          if (!this.same(s, c, r)) continue;
          const X = WX + c * PITCH;
          const Y = WY + r * PITCH;
          const rt = this.same(s, c + 1, r);
          const dn = this.same(s, c, r + 1);
          if (rt) f.rect(X + TILE, Y, 2, TILE);
          if (dn) f.rect(X, Y + TILE, TILE, 2);
          if (rt && dn && this.same(s, c + 1, r + 1)) f.rect(X + TILE, Y + TILE, 2, 2);
          this.edges(o, s, c, r, X, Y);
        }
      }
      f.fill({ color: fillColour, alpha: 1 });
      o.stroke({ width: 2, color: lineColour, alpha: heldish ? 0.95 : 0.9, cap: 'butt', join: 'miter' });
    }
  }

  private edges(o: Graphics, s: number, c: number, r: number, X: number, Y: number): void {
    const R = 6;
    const up = this.same(s, c, r - 1);
    const dn = this.same(s, c, r + 1);
    const lf = this.same(s, c - 1, r);
    const rt = this.same(s, c + 1, r);
    const x0 = X + 1;
    const y0 = Y + 1;
    const x1 = X + TILE - 1;
    const y1 = Y + TILE - 1;
    // Each exposed edge: convex end -> stop short for the arc; joined end -> run 2 px into the gap
    if (!up) {
      o.moveTo(lf ? x0 - 3 : x0 + R - 1, y0).lineTo(rt ? x1 + 3 : x1 - R + 1, y0);
    }
    if (!dn) {
      o.moveTo(lf ? x0 - 3 : x0 + R - 1, y1).lineTo(rt ? x1 + 3 : x1 - R + 1, y1);
    }
    if (!lf) {
      o.moveTo(x0, up ? y0 - 3 : y0 + R - 1).lineTo(x0, dn ? y1 + 3 : y1 - R + 1);
    }
    if (!rt) {
      o.moveTo(x1, up ? y0 - 3 : y0 + R - 1).lineTo(x1, dn ? y1 + 3 : y1 - R + 1);
    }
    const r5 = R - 1;
    if (!up && !lf) o.moveTo(x0, y0 + r5).arc(x0 + r5, y0 + r5, r5, Math.PI, Math.PI * 1.5);
    if (!up && !rt) o.moveTo(x1 - r5, y0).arc(x1 - r5, y0 + r5, r5, Math.PI * 1.5, Math.PI * 2);
    if (!dn && !rt) o.moveTo(x1, y1 - r5).arc(x1 - r5, y1 - r5, r5, 0, Math.PI * 0.5);
    if (!dn && !lf) o.moveTo(x0 + r5, y1).arc(x0 + r5, y1 - r5, r5, Math.PI * 0.5, Math.PI);
  }

  /** Per-frame update: positions, textures, falls, anticipation, beat pulse, danger pulse. */
  update(engine: PulseEngine, beat: BeatQuery, frameSec: number): void {
    if (this.dirty) this.rebuild(engine);
    const nowWall = performance.now() / 1000;
    this.updatePool(nowWall);
    const hideSlabs = this.collapseStart >= 0 || this.dealStart >= 0;
    const stepSec = 60 / engine.config.bpm / 4;
    const visualSec = beat.visualElapsedSec;
    const bar = Math.floor(beat.visualStep / TUNING.SIXTEENTHS_PER_BAR) + 1;

    // Pressure slide: everything starts one row low and eases up
    let push = 0;
    if (this.pushStartSec >= 0) {
      const p = (visualSec - this.pushStartSec) / 0.16;
      if (p >= 1 || p < 0) this.pushStartSec = -1;
      else push = PITCH * (1 - p) * (1 - p);
    }

    // Anticipation: squash primed groups in the ~3 frames before the blade reaches them
    const colsPerSec = COLS / (stepSec * TUNING.SIXTEENTHS_PER_BAR);
    const window = colsPerSec * Math.max(frameSec, 1 / 60) * 3;
    for (let s = 0; s < this.groupCount; s++) {
      const info = this.groups[s]!;
      const g = engine.groups.get(info.id);
      info.due = !!g && g.targetBar <= bar && g.state !== 'held';
      const d = info.anchorCol - beat.sweepColFloat;
      this.squash[s] = info.due && d > 0 && d <= window && !this.reducedMotion ? 1 - 0.1 * (1 - d / window) : 1;
    }

    const board = engine.board;
    let used = 0;
    let glowUsed = 0;
    let litUsed = 0;
    const flash = this.flashScale;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = board[r]![c];
        if (!t) continue;
        const cell = r * COLS + c;
        let x = WX + c * PITCH + TILE / 2;
        let y = WY + r * PITCH + TILE / 2 + push;
        const motion = engine.falling.get(t.id);
        if (motion) {
          const p = (visualSec - motion.startedStep * stepSec) / TUNING.FALL_DURATION_SEC;
          if (p < 1) {
            const e = p <= 0 ? 0 : 1 - (1 - p) * (1 - p) * (1 - p);
            x = WX + (motion.fromCol + (motion.toCol - motion.fromCol) * e) * PITCH + TILE / 2;
            y = WY + (motion.fromRow + (motion.toRow - motion.fromRow) * e) * PITCH + TILE / 2 + push;
          }
        }
        const sprite = this.tiles[used++]!;
        sprite.visible = true;
        this.transition(r, c, t.id, nowWall);
        y += this.tx.dy;
        sprite.position.set(x, y);
        sprite.rotation = this.tx.rot;
        sprite.alpha = (this.focus && !this.focus[cell] ? 0.34 : 1) * this.tx.a;
        const slot = this.memberSlot[cell]!;
        if (slot >= 0) {
          const info = this.groups[slot]!;
          const heldish = info.state === G_HELD || info.state === G_OVER;
          sprite.texture = heldish ? this.atlas.held(info.kind, this.corner[cell]!) : this.atlas.primed(info.kind, this.corner[cell]!);
          const sq = this.squash[slot]!;
          sprite.scale.set(sq);
          const glow = this.glows[glowUsed++]!;
          glow.visible = true;
          glow.position.set(x, y);
          glow.tint = heldish ? UI.held : TILE_COLOURS[info.kind % TILE_COLOURS.length]!.base;
          const boost = sq < 1 ? 1.5 : 1;
          glow.alpha = Math.min(1, (heldish ? 0.85 : 0.5) * boost * flash) * this.tx.a;
          glow.scale.set(heldish ? 1.05 : 0.85);
        } else {
          sprite.texture = this.atlas.idle(t.kind);
          sprite.scale.set(1);
          const lk = this.litKind[cell]!;
          if (lk >= 0) {
            const l = this.lit[litUsed++]!;
            l.visible = true;
            l.position.set(x, y);
            l.tint = lk === 5 ? UI.held : TILE_COLOURS[lk % TILE_COLOURS.length]!.core;
            l.alpha = (lk === 5 ? 0.85 : 0.6) * sprite.alpha;
          }
        }
      }
    }
    for (let i = used; i < this.tiles.length; i++) {
      const s = this.tiles[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
    for (let i = glowUsed; i < this.glows.length; i++) {
      const s = this.glows[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
    for (let i = litUsed; i < this.lit.length; i++) {
      const s = this.lit[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
    this.slabFill.y = push;
    this.outline.y = push;
    this.slabFill.visible = !hideSlabs;
    this.outline.visible = !hideSlabs;

    // Next-row preview
    const upcoming = engine.previewUpcomingRow();
    for (let c = 0; c < COLS; c++) {
      const t = upcoming[c];
      const p = this.preview[c]!;
      p.visible = !!t && engine.pressureEnabled;
      if (t) p.tint = TILE_COLOURS[t.kind % TILE_COLOURS.length]!.base;
    }

    // Visual metronome: strong beat lines pulse on every beat (always on)
    const bp = beat.beatProgress;
    const pulse = (1 - bp) * (1 - bp) * (1 - bp);
    this.beatStrong.alpha = 0.05 + 0.07 * pulse * flash;

    // Danger line: pulses on the beat while danger > 0, brighter per level
    if (this.dangerLevel > 0) {
      this.dangerLine.alpha = Math.min(1, 0.32 + (0.18 + 0.18 * this.dangerLevel) * pulse * flash + 0.1 * this.dangerLevel);
    } else {
      this.dangerLine.alpha = 0.32;
    }

    if (this.rankPulseLeft > 0 && this.allClearFlash <= 0) {
      this.allClearGlow.visible = true;
      this.allClearGlow.tint = this.rankTint;
      this.allClearGlow.alpha = this.rankPulseLeft * 0.28 * flash;
      this.rankPulseLeft = Math.max(0, this.rankPulseLeft - frameSec * 2.2);
      if (this.rankPulseLeft <= 0) {
        this.allClearGlow.visible = false;
        this.allClearGlow.tint = 0xffc461;
      }
    } else if (this.allClearFlash > 0) {
      this.allClearGlow.tint = 0xffc461;
      this.allClearGlow.visible = true;
      this.allClearGlow.alpha = Math.min(1, this.allClearFlash * this.allClearFlash * 0.42 * flash);
      this.allClearFlash = Math.max(0, this.allClearFlash - frameSec * 0.9);
    } else {
      this.allClearGlow.visible = false;
    }
  }

  /** Logical-stage centre of a cell. */
  static cellCentre(col: number, row: number, out: { x: number; y: number }): void {
    out.x = WX + col * PITCH + TILE / 2;
    out.y = WY + row * PITCH + TILE / 2;
  }
}

export const WALL_GEOMETRY = { WX, WY, PITCH, TILE, WALL_W, WALL_H, COLS, ROWS } as const;
void HELD_GRADIENT;
