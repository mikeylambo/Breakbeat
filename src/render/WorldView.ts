/**
 * WorldView — the movement's atmosphere around the wall: a pooled, beat-reactive background motif.
 * It lives on the background layer behind the wall panel, so it frames the board without ever
 * crossing the tiles. Nothing is allocated per frame.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { TUNING } from '../tuning.js';
import type { TileAtlas } from './TileAtlas.js';
import type { Motif, World } from './worlds.js';

const N = 48;
const W = TUNING.STAGE_W;
const H = TUNING.STAGE_H;

export class WorldView {
  readonly root = new Container();
  private readonly dots: Sprite[] = [];
  private readonly px = new Float32Array(N);
  private readonly py = new Float32Array(N);
  private readonly pv = new Float32Array(N);
  private readonly ph = new Float32Array(N);
  private readonly rings: Graphics[] = [];
  private readonly lines: Graphics[] = [];
  private motif: Motif = 'pulse';
  private accent = 0x6fb6ff;
  private fade = 1;
  reducedMotion = false;
  intensity = 1;

  constructor(private readonly atlas: TileAtlas) {
    for (let i = 0; i < N; i++) {
      const s = new Sprite(atlas.softDot);
      s.anchor.set(0.5);
      s.visible = false;
      s.blendMode = 'add';
      this.dots.push(s);
      this.root.addChild(s);
    }
    for (let i = 0; i < 5; i++) {
      const g = new Graphics().circle(0, 0, 100).stroke({ width: 1.2, color: 0xffffff, alpha: 1 });
      g.visible = false;
      g.blendMode = 'add';
      this.rings.push(g);
      this.root.addChild(g);
    }
    for (let i = 0; i < 14; i++) {
      const g = new Graphics();
      g.visible = false;
      this.lines.push(g);
      this.root.addChild(g);
    }
  }

  private seed = 0x1234567;
  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  setWorld(world: World): void {
    this.motif = world.motif;
    this.accent = world.accent;
    this.fade = 0;
    for (const d of this.dots) {
      d.visible = false;
      d.anchor.set(0.5);
      d.scale.set(1);
      d.rotation = 0;
    }
    for (const r of this.rings) r.visible = false;
    for (const l of this.lines) {
      l.clear();
      l.visible = false;
    }
    for (let i = 0; i < N; i++) {
      this.px[i] = this.rand() * W;
      this.py[i] = this.rand() * H;
      this.pv[i] = 0.4 + this.rand() * 0.6;
      this.ph[i] = this.rand() * Math.PI * 2;
    }
    const a = this.accent;
    switch (this.motif) {
      case 'grid':
        // Horizon lines below and above the wall plus converging verticals
        for (let i = 0; i < 10; i++) this.lines[i]!.rect(0, 0, W, 1).fill({ color: a, alpha: 1 });
        for (let i = 10; i < 14; i++) this.lines[i]!.moveTo(0, 0).lineTo(0, 1).stroke({ width: 1, color: a, alpha: 1 });
        break;
      case 'waves':
        for (let i = 0; i < 4; i++) {
          const g = this.lines[i]!;
          for (let x = 0; x <= W * 2; x += 8) {
            const y = Math.sin((x / 120) * Math.PI + i) * (10 + i * 4);
            if (x === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke({ width: 1.2, color: a, alpha: 1 });
        }
        break;
      case 'bars':
      case 'rain':
        for (let i = 0; i < N; i++) {
          const d = this.dots[i]!;
          d.texture = this.atlas.white;
        }
        break;
      case 'prisms':
        for (const d of this.dots) d.texture = this.atlas.diamond;
        break;
      default:
        for (const d of this.dots) d.texture = this.atlas.softDot;
    }
  }

  update(nowSec: number, dt: number, beatProgress: number): void {
    this.fade = Math.min(1, this.fade + dt * 0.8);
    const pulse = (1 - beatProgress) * (1 - beatProgress);
    const k = this.fade * this.intensity;
    const motion = this.reducedMotion ? 0.15 : 1;
    const a = this.accent;
    switch (this.motif) {
      case 'stars':
      case 'dust':
      case 'embers':
      case 'pulse': {
        const count = this.motif === 'pulse' ? 24 : 44;
        for (let i = 0; i < N; i++) {
          const d = this.dots[i]!;
          if (i >= count) {
            d.visible = false;
            continue;
          }
          d.visible = true;
          d.tint = a;
          if (this.motif === 'dust') {
            this.px[i] = (this.px[i]! + 6 * this.pv[i]! * dt * motion + W) % W;
            this.py[i] = (this.py[i]! - 3 * this.pv[i]! * dt * motion + H) % H;
            d.scale.set(0.25 + 0.2 * this.pv[i]!);
            d.alpha = k * (0.12 + 0.1 * Math.sin(nowSec * 0.7 + this.ph[i]!));
          } else if (this.motif === 'embers') {
            this.py[i] = this.py[i]! - 40 * this.pv[i]! * dt * motion;
            if (this.py[i]! < -10) {
              this.py[i] = H + 10;
              this.px[i] = this.rand() * W;
            }
            this.px[i] = this.px[i]! + Math.sin(nowSec * 2 + this.ph[i]!) * 8 * dt;
            d.scale.set(0.18 + 0.15 * this.pv[i]!);
            d.alpha = k * (0.35 + 0.35 * pulse) * (0.5 + 0.5 * Math.sin(nowSec * 9 + this.ph[i]!));
          } else if (this.motif === 'stars') {
            d.scale.set(0.12 + 0.12 * this.pv[i]!);
            d.alpha = k * (0.18 + 0.3 * Math.max(0, Math.sin(nowSec * 1.3 * this.pv[i]! + this.ph[i]!)) + 0.15 * pulse);
          } else {
            // pulse: large soft blooms at the sides that throb on the beat
            const side = i % 2 === 0 ? 70 : W - 70;
            this.px[i] = side + Math.sin(this.ph[i]!) * 60;
            d.scale.set(1.2 + 1.6 * this.pv[i]! + 0.6 * pulse);
            d.alpha = k * (0.05 + 0.1 * pulse) * this.pv[i]!;
          }
          d.position.set(this.px[i]!, this.py[i]!);
        }
        break;
      }
      case 'bars': {
        // Equaliser columns either side of the wall, on the beat
        for (let i = 0; i < N; i++) {
          const d = this.dots[i]!;
          if (i >= 16) {
            d.visible = false;
            continue;
          }
          d.visible = true;
          d.tint = a;
          const left = i < 8;
          const j = i % 8;
          const x = left ? 24 + j * 16 : W - 24 - j * 16;
          const h = 30 + 140 * Math.abs(Math.sin(nowSec * (1.4 + this.pv[i]!) + this.ph[i]!)) * (0.5 + 0.5 * pulse);
          d.position.set(x, H - 30);
          d.anchor.set(0.5, 1);
          d.width = 6;
          d.height = h * motion + 20 * (1 - motion);
          d.alpha = k * (0.08 + 0.1 * pulse);
        }
        break;
      }
      case 'rain': {
        for (let i = 0; i < N; i++) {
          const d = this.dots[i]!;
          d.visible = true;
          d.tint = a;
          this.py[i] = this.py[i]! + 220 * this.pv[i]! * dt * motion;
          if (this.py[i]! > H + 30) {
            this.py[i] = -30;
            this.px[i] = this.rand() * W;
          }
          d.anchor.set(0.5);
          d.width = 1;
          d.height = 16 + 20 * this.pv[i]!;
          d.position.set(this.px[i]!, this.py[i]!);
          d.alpha = k * (0.1 + 0.08 * pulse);
        }
        break;
      }
      case 'prisms': {
        for (let i = 0; i < N; i++) {
          const d = this.dots[i]!;
          if (i >= 18) {
            d.visible = false;
            continue;
          }
          d.visible = true;
          d.tint = i % 3 === 0 ? 0xffffff : a;
          d.rotation = nowSec * 0.3 * this.pv[i]! * motion + this.ph[i]!;
          d.scale.set(1 + 2 * this.pv[i]!);
          this.py[i] = (this.py[i]! - 8 * this.pv[i]! * dt * motion + H) % H;
          d.position.set(this.px[i]!, this.py[i]!);
          d.alpha = k * (0.06 + 0.1 * pulse) * this.pv[i]!;
        }
        break;
      }
      case 'ripples': {
        for (let i = 0; i < this.rings.length; i++) {
          const r = this.rings[i]!;
          r.visible = true;
          r.tint = a;
          const p = (nowSec * 0.18 * motion + i / this.rings.length) % 1;
          r.position.set(i % 2 === 0 ? 90 : W - 90, i % 2 === 0 ? H * 0.7 : H * 0.3);
          r.scale.set(0.2 + p * 2.4);
          r.alpha = k * 0.28 * (1 - p) * (0.7 + 0.3 * pulse);
        }
        break;
      }
      case 'grid': {
        for (let i = 0; i < 10; i++) {
          const l = this.lines[i]!;
          l.visible = true;
          const p = (i / 10 + nowSec * 0.12 * motion) % 1;
          // perspective: lines bunch toward the horizon at the wall's base
          const y = H - 18 - Math.pow(p, 2.2) * 14 + (1 - Math.pow(1 - p, 2)) * 0;
          l.position.set(0, i % 2 === 0 ? y : 22 * (1 - p));
          l.alpha = k * (0.06 + 0.22 * p) * (0.7 + 0.3 * pulse);
        }
        for (let i = 10; i < 14; i++) {
          const l = this.lines[i]!;
          l.visible = true;
          const j = i - 10;
          const x = j < 2 ? 40 + j * 60 : W - 40 - (j - 2) * 60;
          l.position.set(x, 0);
          l.scale.set(1, H);
          l.alpha = k * 0.08;
        }
        break;
      }
      case 'waves': {
        for (let i = 0; i < 4; i++) {
          const l = this.lines[i]!;
          l.visible = true;
          l.position.set(-((nowSec * (14 + i * 6) * motion) % 240), i < 2 ? 18 + i * 10 : H - 18 - (i - 2) * 10);
          l.alpha = k * (0.12 + 0.1 * pulse);
        }
        break;
      }
    }
  }
}
