/**
 * Stage — the Pixi application, letterboxed 844x390 logical stage inside the safe area,
 * and the layer stack: background -> glow (bloom here only) -> wall -> outlines -> fx -> blade.
 * The HUD is DOM (src/ui/) laid over the same logical rectangle via `onLayout`.
 */

import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { TUNING } from '../tuning.js';
import { computeLayout, type StageLayout } from './layout.js';

export type { StageLayout } from './layout.js';


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

  async init(host: HTMLElement): Promise<void> {
    this.resolution = Math.min(2, window.devicePixelRatio || 1);
    await this.app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      resolution: this.resolution,
      autoDensity: true,
      antialias: false,
      backgroundAlpha: 0,
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

    // Bloom at half resolution, clipped to the play area: the glow layer is soft by nature
    this.bloom = new AdvancedBloomFilter({ threshold: 0.18, bloomScale: 1.1, brightness: 1, blur: 3, quality: 2 });
    this.bloom.resolution = 0.35;
    this.softwareGL = detectSoftwareGL(canvas);
    // Software rasterisers (no GPU) skip the bloom pass; the glow sprites are pre-softened gradients
    this.setBloomEnabled(!this.softwareGL);


    const onResize = (): void => this.relayout();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    this.relayout();
  }

  softwareGL = false;
  bloomEnabled = true;

  setBloomEnabled(on: boolean): void {
    this.bloomEnabled = on;
    this.glow.filters = on && this.bloom ? [this.bloom] : [];
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
    const l = computeLayout();
    this.layout = l;
    const { scale, x, y, width: w, height: h } = l;
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

function detectSoftwareGL(canvas: HTMLCanvasElement): boolean {
  try {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}
