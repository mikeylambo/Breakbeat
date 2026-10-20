/**
 * Stage — the Pixi application, letterboxed 844x390 logical stage inside the safe area,
 * and the layer stack: background -> glow (bloom here only) -> wall -> outlines -> fx -> blade.
 * The HUD is DOM (src/ui/) laid over the same logical rectangle via `onLayout`.
 */

import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { TUNING } from '../tuning.js';
import { UI } from './palette.js';

export interface StageLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Stage {
  readonly app = new Application();
  readonly root = new Container();
  readonly camera = new Container();
  readonly background = new Container();
  readonly glow = new Container();
  readonly wall = new Container();
  readonly outlines = new Container();
  readonly fx = new Container();
  readonly blade = new Container();
  layout: StageLayout = { scale: 1, x: 0, y: 0, width: TUNING.STAGE_W, height: TUNING.STAGE_H };
  resolution = 1;
  private bloom: AdvancedBloomFilter | null = null;
  private readonly listeners: ((l: StageLayout) => void)[] = [];
  private probe: HTMLDivElement | null = null;

  async init(host: HTMLElement): Promise<void> {
    this.resolution = Math.min(2, window.devicePixelRatio || 1);
    await this.app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      resolution: this.resolution,
      autoDensity: true,
      antialias: true,
      background: UI.bg,
      autoStart: false,
      preference: 'webgl',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.app.ticker.stop();
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    // The camera breathes around the wall centre; layers live inside it.
    this.camera.addChild(this.background, this.glow, this.wall, this.outlines, this.fx, this.blade);
    this.root.addChild(this.camera);
    this.app.stage.addChild(this.root);
    const cx = TUNING.WALL_X + 255;
    const cy = TUNING.WALL_Y + 159;
    this.camera.pivot.set(cx, cy);
    this.camera.position.set(cx, cy);

    this.bloom = new AdvancedBloomFilter({ threshold: 0.18, bloomScale: 1.1, brightness: 1, blur: 6, quality: 4 });
    this.glow.filters = [this.bloom];

    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;inset:0;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(this.probe);

    const onResize = (): void => this.relayout();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    this.relayout();
  }

  /** Camera breath zoom (1 = rest). */
  setZoom(z: number): void {
    this.camera.scale.set(z);
  }

  setBloomStrength(k: number): void {
    if (this.bloom) this.bloom.bloomScale = 1.1 * k;
  }

  onLayout(fn: (l: StageLayout) => void): void {
    this.listeners.push(fn);
    fn(this.layout);
  }

  relayout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cs = this.probe ? getComputedStyle(this.probe) : null;
    const st = cs ? parseFloat(cs.paddingTop) || 0 : 0;
    const sr = cs ? parseFloat(cs.paddingRight) || 0 : 0;
    const sb = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
    const sl = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
    const availW = Math.max(1, w - sl - sr);
    const availH = Math.max(1, h - st - sb);
    const scale = Math.min(availW / TUNING.STAGE_W, availH / TUNING.STAGE_H);
    const x = sl + (availW - TUNING.STAGE_W * scale) / 2;
    const y = st + (availH - TUNING.STAGE_H * scale) / 2;
    this.layout = { scale, x, y, width: w, height: h };
    this.root.scale.set(scale);
    this.root.position.set(x, y);
    this.app.renderer.resize(w, h);
    for (const fn of this.listeners) fn(this.layout);
  }

  /** Maps a client (CSS px) point into logical stage coordinates. */
  toLogical(clientX: number, clientY: number, out: { x: number; y: number }): void {
    out.x = (clientX - this.layout.x) / this.layout.scale;
    out.y = (clientY - this.layout.y) / this.layout.scale;
  }

  render(): void {
    this.app.renderer.render(this.app.stage);
  }
}
