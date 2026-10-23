/**
 * VisualizerView — music visualizers driven by the shared AudioFeatures frame.
 *  Horizon  mirrored spectrum skyline: lows at the centre, falling peak caps, a faint reflection up top
 *  Rings    one ring per stem in the tile colours; each hit throws a ripple, satellites orbit per bar
 *  Scope    the mix waveform as a glowing line, tapered into the screen edges
 *  Shatter  tile shards burst from each stem's emitter on its hits and fall away
 * Lives on the background layer (behind the wall). Everything is pooled; nothing is allocated per
 * frame. Strobe-free caps flash events (ripples, bursts) at 3 a second; reduced motion calms
 * travel and orbit; flash intensity scales brightness.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { TUNING } from '../tuning.js';
import { BAND_COUNT, WAVE_POINTS, type AudioFeatures } from '../audio/AudioFeatures.js';
import { TILE_COLOURS } from './palette.js';
import { VISUALIZER_PRESETS, type VisualizerPreset } from './visualizerPresets.js';
import type { TileAtlas } from './TileAtlas.js';

export { VISUALIZER_PRESETS, type VisualizerPreset };

const W = TUNING.STAGE_W;
const H = TUNING.STAGE_H;
/** Stem colours, in STEM_NAMES order: kick Amber, bass Magenta, keys Azure, lead Jade, top Violet. */
const STEM_TINT = TILE_COLOURS.map(c => c.base);
const STEM_CORE = TILE_COLOURS.map(c => c.core);

const BARS = BAND_COUNT * 2;
const RING_R = [64, 100, 136, 172, 208];
const RIPPLES = 14;
const SHARDS = 120;
const STROBE_GAP_SEC = 1 / 3;
/** Scope end taper, so the line grows out of the screen edges instead of starting cut off. */
const TAPER = Float32Array.from({ length: WAVE_POINTS }, (_, w) => Math.sin((Math.PI * w) / (WAVE_POINTS - 1)));
const COST_FRAMES = 240;

export class VisualizerView {
  readonly root = new Container();
  preset: VisualizerPreset = 'horizon';
  accent = 0x6fb6ff;
  reducedMotion = false;
  strobeFree = false;
  /** 0..1 brightness scale (Flash intensity). */
  flash = 1;
  /** Current fade-in, 0..1 */
  presence = 0;
  /** Frame cost (ms) and flash-event log, for the VISUALIZER gate. */
  readonly costMs = new Float32Array(COST_FRAMES);
  events = 0;
  minEventGapSec = Infinity;

  private target = 0;
  /** Stay up through silence (Listen: a soloed quiet stem should look quiet, not vanish) */
  private hold = false;
  private costIdx = 0;
  private clock = 0;
  private lastEventSec = -Infinity;
  private readonly prevOnset = new Float32Array(5);
  private readonly layers: Record<VisualizerPreset, Container>;

  // Horizon
  private readonly bars: Sprite[] = [];
  private readonly mirror: Sprite[] = [];
  private readonly caps: Sprite[] = [];
  private readonly peak = new Float32Array(BARS);
  // Rings
  private readonly rings: Graphics[] = [];
  private readonly sats: Sprite[] = [];
  private readonly ripples: Graphics[] = [];
  private readonly ripAge = new Float32Array(RIPPLES).fill(1);
  private readonly ripStem = new Uint8Array(RIPPLES);
  private ripNext = 0;
  // Scope
  private readonly segs: Sprite[] = [];
  private readonly glow: Sprite[] = [];
  private readonly waveY = new Float32Array(WAVE_POINTS);
  private wavePeak = 0.05;
  // Shatter
  private readonly shards: Sprite[] = [];
  private readonly sx = new Float32Array(SHARDS);
  private readonly sy = new Float32Array(SHARDS);
  private readonly svx = new Float32Array(SHARDS);
  private readonly svy = new Float32Array(SHARDS);
  private readonly sspin = new Float32Array(SHARDS);
  private readonly slife = new Float32Array(SHARDS);
  private shardNext = 0;
  private seed = 0x9e3779b9;

  constructor(
    atlas: TileAtlas,
    private readonly features: AudioFeatures
  ) {
    const mk = (): Container => {
      const c = new Container();
      c.visible = false;
      this.root.addChild(c);
      return c;
    };
    this.layers = { horizon: mk(), rings: mk(), scope: mk(), shatter: mk() };
    this.root.visible = false;

    const slot = W / BARS;
    for (let i = 0; i < BARS; i++) {
      const x = i * slot + slot / 2;
      const b = new Sprite(atlas.white);
      b.anchor.set(0.5, 1);
      b.position.set(x, H);
      b.width = slot - 6;
      b.blendMode = 'add';
      const m = new Sprite(atlas.white);
      m.anchor.set(0.5, 0);
      m.position.set(x, 0);
      m.width = slot - 6;
      m.blendMode = 'add';
      const c = new Sprite(atlas.white);
      c.anchor.set(0.5, 1);
      c.x = x;
      c.width = slot - 6;
      c.height = 2;
      this.bars.push(b);
      this.mirror.push(m);
      this.caps.push(c);
      this.layers.horizon.addChild(m, b, c);
    }

    for (let i = 0; i < 5; i++) {
      const g = new Graphics().circle(0, 0, RING_R[i]!).stroke({ width: 1.5, color: 0xffffff, alpha: 1 });
      g.position.set(W / 2, H / 2);
      g.tint = STEM_TINT[i]!;
      g.blendMode = 'add';
      const s = new Sprite(atlas.softDot);
      s.anchor.set(0.5);
      s.tint = STEM_CORE[i]!;
      s.blendMode = 'add';
      this.rings.push(g);
      this.sats.push(s);
      this.layers.rings.addChild(g, s);
    }
    for (let i = 0; i < RIPPLES; i++) {
      const g = new Graphics().circle(0, 0, 100).stroke({ width: 2, color: 0xffffff, alpha: 1 });
      g.position.set(W / 2, H / 2);
      g.blendMode = 'add';
      g.visible = false;
      this.ripples.push(g);
      this.layers.rings.addChild(g);
    }

    for (let i = 0; i < WAVE_POINTS - 1; i++) {
      for (const list of [this.glow, this.segs]) {
        const s = new Sprite(atlas.white);
        s.anchor.set(0, 0.5);
        s.blendMode = 'add';
        list.push(s);
        this.layers.scope.addChild(s);
      }
    }

    for (let i = 0; i < SHARDS; i++) {
      const s = new Sprite(atlas.shard);
      s.anchor.set(0.5);
      s.visible = false;
      s.blendMode = 'add';
      this.shards.push(s);
      this.layers.shatter.addChild(s);
      this.slife[i] = 0;
    }
  }

  setPreset(p: VisualizerPreset): void {
    if (p === this.preset) return;
    this.preset = p;
    this.ripAge.fill(1);
    this.slife.fill(0);
    for (const r of this.ripples) r.visible = false;
    for (const s of this.shards) s.visible = false;
  }

  /** Target presence: 0 fades out, 1 is full strength (Listen mode); menus and Zen sit lower. */
  setTarget(v: number, holdWhenQuiet = false): void {
    this.target = Math.max(0, Math.min(1, v));
    this.hold = holdWhenQuiet;
  }

  update(dt: number): void {
    const t0 = performance.now();
    const f = this.features;
    const goal = f.live || this.hold ? this.target : 0;
    this.presence += (goal - this.presence) * (1 - Math.exp(-dt / 0.35));
    if (goal === 0 && this.presence < 0.004) this.presence = 0;
    this.root.visible = this.presence > 0;
    if (this.root.visible) {
      this.clock += dt;
      for (const p of VISUALIZER_PRESETS) this.layers[p[0]].visible = p[0] === this.preset;
      const k = this.presence * (0.35 + 0.65 * this.flash);
      if (this.preset === 'horizon') this.horizon(dt, k);
      else if (this.preset === 'rings') this.ringsUpdate(dt, k);
      else if (this.preset === 'scope') this.scope(dt, k);
      else this.shatter(dt, k);
    }
    for (let i = 0; i < 5; i++) this.prevOnset[i] = f.onset[i]!;
    this.costMs[this.costIdx] = performance.now() - t0;
    this.costIdx = (this.costIdx + 1) % COST_FRAMES;
  }

  /** A stem hit this frame (rising edge of its onset pulse), gated by the strobe-free rate cap. */
  private hit(i: number): number {
    const o = this.features.onset[i]!;
    if (!(o > 0.39 && this.prevOnset[i]! <= 0.39)) return 0;
    const gap = this.clock - this.lastEventSec;
    if (this.strobeFree && gap < STROBE_GAP_SEC) return 0;
    this.events++;
    this.minEventGapSec = Math.min(this.minEventGapSec, gap);
    this.lastEventSec = this.clock;
    return o;
  }

  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  private horizon(dt: number, k: number): void {
    const f = this.features;
    const calm = this.reducedMotion ? 0.55 : 1;
    const centre = (BARS - 1) / 2;
    for (let i = 0; i < BARS; i++) {
      const band = Math.min(BAND_COUNT - 1, Math.floor(Math.abs(i - centre)));
      // Gentle compression so sparse grooves still draw a skyline between hits
      const v = Math.pow(f.bands[band]!, 0.75);
      const h = (8 + 170 * v) * calm;
      const b = this.bars[i]!;
      b.height = h;
      b.tint = this.accent;
      b.alpha = k * (0.2 + 0.3 * v + 0.15 * f.kick);
      const m = this.mirror[i]!;
      m.height = h * 0.32;
      m.tint = this.accent;
      m.alpha = k * 0.1;
      this.peak[i] = Math.max(h, this.peak[i]! - (this.reducedMotion ? 30 : 60) * dt);
      const c = this.caps[i]!;
      c.y = H - this.peak[i]! - 3;
      c.alpha = k * 0.55;
    }
  }

  private ringsUpdate(dt: number, k: number): void {
    const f = this.features;
    const orbit = this.reducedMotion ? 0 : 1;
    for (let i = 0; i < 5; i++) {
      const g = this.rings[i]!;
      const e = f.env[i]!;
      g.scale.set(1 + (this.reducedMotion ? 0.04 : 0.12) * e);
      g.alpha = k * (0.08 + 0.42 * e);
      const s = this.sats[i]!;
      const dir = i % 2 === 0 ? 1 : -1;
      const a = (f.barPhase * orbit * dir + i / 5) * Math.PI * 2 - Math.PI / 2;
      const r = RING_R[i]! * g.scale.x;
      s.position.set(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      s.scale.set(0.5 + 0.6 * e);
      s.alpha = k * (0.3 + 0.6 * e);
      const o = this.hit(i);
      if (o > 0) {
        const j = this.ripNext;
        this.ripNext = (j + 1) % RIPPLES;
        this.ripAge[j] = 0;
        this.ripStem[j] = i;
      }
    }
    const life = this.reducedMotion ? 1.6 : 0.9;
    const reach = this.reducedMotion ? 50 : 170;
    for (let j = 0; j < RIPPLES; j++) {
      const g = this.ripples[j]!;
      const age = this.ripAge[j]!;
      if (age >= 1) {
        g.visible = false;
        continue;
      }
      this.ripAge[j] = age + dt / life;
      const st = this.ripStem[j]!;
      g.visible = true;
      g.tint = STEM_CORE[st]!;
      g.scale.set((RING_R[st]! + reach * (1 - (1 - age) * (1 - age))) / 100);
      g.alpha = k * 0.5 * (1 - age) * (1 - age);
    }
  }

  private scope(dt: number, k: number): void {
    const f = this.features;
    let pk = 0;
    for (let w = 0; w < WAVE_POINTS; w++) pk = Math.max(pk, Math.abs(f.wave[w]!));
    this.wavePeak = Math.max(pk, this.wavePeak * Math.exp(-dt / 0.6), 0.01);
    // Square-root compression: the kick's transient no longer flattens everything between hits
    const amp = this.reducedMotion ? 45 : 120;
    const inv = 1 / this.wavePeak;
    const ys = this.waveY;
    for (let w = 0; w < WAVE_POINTS; w++) {
      const v = f.wave[w]! * inv;
      ys[w] = H / 2 + Math.sign(v) * Math.sqrt(Math.abs(v)) * amp * TAPER[w]!;
    }
    const step = W / (WAVE_POINTS - 1);
    const thick = 2 + 2.5 * f.kick;
    const lineA = k * (0.45 + 0.4 * f.energy);
    for (let w = 0; w < WAVE_POINTS - 1; w++) {
      const dy = ys[w + 1]! - ys[w]!;
      const len = Math.sqrt(step * step + dy * dy) + 0.5;
      const rot = Math.atan2(dy, step);
      const ta = TAPER[w]!;
      const s = this.segs[w]!;
      s.position.set(w * step, ys[w]!);
      s.width = len;
      s.height = thick;
      s.rotation = rot;
      s.tint = this.accent;
      s.alpha = lineA * (0.3 + 0.7 * ta);
      // A wide soft underlay on the same geometry reads as glow without a filter pass
      const g = this.glow[w]!;
      g.position.set(w * step, ys[w]!);
      g.width = len;
      g.height = thick * 5;
      g.rotation = rot;
      g.tint = this.accent;
      g.alpha = lineA * 0.12 * ta;
    }
  }

  private shatter(dt: number, k: number): void {
    const f = this.features;
    const calm = this.reducedMotion ? 0.3 : 1;
    for (let i = 0; i < 5; i++) {
      const o = this.hit(i);
      if (o <= 0) continue;
      const n = Math.round((4 + 8 * o) * (this.reducedMotion ? 0.5 : 1));
      for (let m = 0; m < n; m++) this.spawn(i, calm);
    }
    const g = 340 * calm;
    const drift = 1 + 1.5 * f.low;
    for (let i = 0; i < SHARDS; i++) {
      const s = this.shards[i]!;
      const life = this.slife[i]!;
      if (life <= 0) {
        s.visible = false;
        continue;
      }
      this.slife[i] = life - dt / 1.3;
      this.svy[i] = this.svy[i]! + g * dt;
      this.svx[i] = this.svx[i]! * Math.exp(-dt * 0.8);
      this.sx[i] = this.sx[i]! + this.svx[i]! * dt * drift;
      this.sy[i] = this.sy[i]! + this.svy[i]! * dt;
      s.visible = true;
      s.position.set(this.sx[i]!, this.sy[i]!);
      s.rotation += this.sspin[i]! * dt * calm;
      s.alpha = k * Math.min(1, life * 2.5) * 0.85;
    }
  }

  /** One shard from stem `i`'s emitter: kick from the floor, bass from the sides, keys from the
   *  top corners, lead from the side gutters, top as sparks anywhere. */
  private spawn(i: number, calm: number): void {
    const j = this.shardNext;
    this.shardNext = (j + 1) % SHARDS;
    const sp = (180 + 260 * this.rand()) * calm;
    let x: number;
    let y: number;
    let a: number;
    switch (i) {
      case 0:
        x = W / 2 + (this.rand() - 0.5) * 120;
        y = H + 6;
        a = -Math.PI / 2 + (this.rand() - 0.5) * 1.4;
        break;
      case 1: {
        const left = this.rand() < 0.5;
        x = left ? -6 : W + 6;
        y = H * (0.45 + 0.4 * this.rand());
        a = (left ? 0 : Math.PI) + (left ? -1 : 1) * (0.3 + 0.6 * this.rand());
        break;
      }
      case 2: {
        const left = this.rand() < 0.5;
        x = left ? 40 : W - 40;
        y = -6;
        a = Math.PI / 2 + (left ? -0.6 : 0.6) * this.rand();
        break;
      }
      case 3:
        x = this.rand() < 0.5 ? 80 : W - 80;
        y = H * (0.25 + 0.5 * this.rand());
        a = this.rand() * Math.PI * 2;
        break;
      default:
        x = this.rand() * W;
        y = this.rand() * H * 0.6;
        a = -Math.PI / 2 + (this.rand() - 0.5) * 2;
    }
    this.sx[j] = x;
    this.sy[j] = y;
    this.svx[j] = Math.cos(a) * sp;
    this.svy[j] = Math.sin(a) * sp;
    this.sspin[j] = (this.rand() - 0.5) * 14;
    this.slife[j] = 1;
    const s = this.shards[j]!;
    s.tint = this.rand() < 0.3 ? STEM_CORE[i]! : STEM_TINT[i]!;
    s.scale.set(0.6 + 0.9 * this.rand());
    s.rotation = this.rand() * Math.PI * 2;
  }
}
