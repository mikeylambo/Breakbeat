/** TitleBackdrop — a faint strip of wall along the bottom of the title with a blade crossing it. */

import { Container, Sprite } from 'pixi.js';
import { TUNING } from '../tuning.js';
import type { BeatQuery } from '../pulse/BeatClock.js';
import type { Stage } from './Stage.js';
import type { TileAtlas } from './TileAtlas.js';
import { UI } from './palette.js';

const PITCH = TUNING.TILE_PX + TUNING.TILE_GAP_PX;
const COUNT = Math.ceil(TUNING.STAGE_W / PITCH) + 1;
const Y = 364;
/** Fixed deal so the strip never flickers between visits */
const KINDS = [0, 0, 2, 1, 3, 3, 2, 0, 1, 1, 2, 3, 0, 2, 2, 1, 3, 0, 0, 1, 2, 3, 3, 1, 0, 2, 1, 3];

export class TitleBackdrop {
  readonly root = new Container();
  private readonly tiles: Sprite[] = [];
  private readonly blade: Sprite;
  private readonly bladeGlow: Sprite;

  constructor(stage: Stage, private atlas: TileAtlas) {
    for (let i = 0; i < COUNT; i++) {
      const s = new Sprite(atlas.idle(KINDS[i % KINDS.length]!));
      s.position.set(-6 + i * PITCH, Y);
      s.alpha = 0.22;
      this.tiles.push(s);
      this.root.addChild(s);
    }
    this.bladeGlow = new Sprite(atlas.softDot);
    this.bladeGlow.anchor.set(0.5);
    this.bladeGlow.height = 70;
    this.bladeGlow.width = 26;
    this.bladeGlow.y = Y + 15;
    this.bladeGlow.tint = 0xbfe6ff;
    this.bladeGlow.alpha = 0.45;
    this.bladeGlow.blendMode = 'add';
    this.blade = new Sprite(atlas.white);
    this.blade.width = 2;
    this.blade.height = 40;
    this.blade.y = Y - 5;
    this.blade.tint = UI.blade;
    this.blade.alpha = 0.7;
    this.root.addChild(this.bladeGlow, this.blade);
    this.root.visible = false;
    stage.app.stage.addChildAt(this.root, 0);
    stage.onLayout(l => {
      this.root.scale.set(l.scale);
      this.root.position.set(l.x, l.y);
    });
  }

  setAtlas(atlas: TileAtlas): void {
    this.atlas = atlas;
    this.tiles.forEach((s, i) => (s.texture = atlas.idle(KINDS[i % KINDS.length]!)));
  }

  show(on: boolean): void {
    this.root.visible = on;
  }

  /** The blade crosses once every 2 bars of whatever is playing (wall time when silent). */
  update(nowSec: number, beat: BeatQuery | null, barSec: number): void {
    if (!this.root.visible) return;
    const period = beat ? barSec * 2 : (60 / 116) * 8;
    const t = beat ? beat.visualElapsedSec : nowSec;
    const p = (t % period) / period;
    const x = p * (TUNING.STAGE_W + 40) - 20;
    const kick = beat ? (1 - beat.beatProgress) ** 3 : 0;
    this.blade.x = x - 1;
    this.blade.alpha = 0.6 + 0.4 * kick;
    this.bladeGlow.x = x;
    this.bladeGlow.alpha = 0.35 + 0.4 * kick;
    for (let i = 0; i < this.tiles.length; i++) {
      const s = this.tiles[i]!;
      const d = x - (s.x + 15);
      // tiles the blade just crossed light up and fade back; the whole strip breathes on the kick
      s.alpha = 0.2 + 0.06 * kick + (d > 0 && d < 140 ? 0.34 * (1 - d / 140) : 0);
    }
  }
}
