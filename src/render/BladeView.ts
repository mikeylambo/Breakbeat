/**
 * BladeView — the 2 px sweep blade, its rotated-square head above the wall and a 100 px wake that
 * fades in from the left. Position comes from the audio clock every frame, never from frame deltas.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { BeatQuery } from '../pulse/BeatClock.js';
import type { TileAtlas } from './TileAtlas.js';
import { UI } from './palette.js';
import type { Stage } from './Stage.js';
import { WALL_GEOMETRY as G } from './WallView.js';

export class BladeView {
  readonly root = new Container();
  private readonly line: Sprite;
  private readonly head: Sprite;
  private readonly wake: Sprite;
  private readonly glow: Sprite;
  private readonly headGlow: Sprite;
  visible = true;

  constructor(stage: Stage, atlas: TileAtlas) {
    const top = G.WY - 6;
    const height = G.WALL_H + 12;

    this.wake = new Sprite(makeWakeTexture());
    this.wake.width = 100;
    this.wake.height = G.WALL_H;
    this.wake.y = G.WY;
    this.wake.tint = UI.wake;
    this.wake.alpha = 0.13;

    this.line = new Sprite(atlas.white);
    this.line.width = 2;
    this.line.height = height;
    this.line.y = top;
    this.line.tint = UI.blade;

    this.head = new Sprite(atlas.diamond);
    this.head.anchor.set(0.5);
    // atlas diamond is a 9 px square rotated 45deg in a 14 px frame -> scale to a 12 px rotated square
    this.head.scale.set(12 / 9 / Math.SQRT2 * 1.0);
    this.head.y = G.WY - 13;
    this.head.tint = UI.blade;

    this.root.addChild(this.wake, this.line, this.head);
    stage.blade.addChild(this.root);

    this.glow = new Sprite(atlas.softDot);
    this.glow.anchor.set(0.5);
    this.glow.width = 22;
    this.glow.height = height + 30;
    this.glow.y = G.WY + G.WALL_H / 2;
    this.glow.tint = 0xbfe6ff;
    this.glow.alpha = 0.55;
    this.glow.blendMode = 'add';
    this.headGlow = new Sprite(atlas.softDot);
    this.headGlow.anchor.set(0.5);
    this.headGlow.width = 30;
    this.headGlow.height = 30;
    this.headGlow.y = this.head.y;
    this.headGlow.tint = 0xbfe6ff;
    this.headGlow.alpha = 0.7;
    this.headGlow.blendMode = 'add';
    stage.glow.addChild(this.glow, this.headGlow);
  }

  /** Blade x for a fractional column (column c is crossed during sixteenth c). */
  static xFor(col: number): number {
    return G.WX + col * G.PITCH - 1;
  }

  update(beat: BeatQuery): void {
    const x = BladeView.xFor(beat.sweepColFloat);
    this.root.visible = this.visible;
    this.glow.visible = this.visible;
    this.headGlow.visible = this.visible;
    this.line.x = x - 1;
    this.head.x = x;
    this.glow.x = x;
    this.headGlow.x = x;
    // The wake never reaches back past the wall's left edge
    const w = Math.max(0, Math.min(100, x - G.WX));
    this.wake.x = x - w;
    this.wake.width = w;
  }
}

function makeWakeTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 4);
  return Texture.from(c);
}
