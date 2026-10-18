/**
 * BREAKBEAT — Architectural Wall Renderer & Light-Casting Engine (GDD Pages 1–6).
 * - Zero `ctx.shadowBlur` calls: uses pre-baked offscreen material sprites + layered alpha geometry for 120 fps.
 * - Real neighbour light-casting: primed blocks cast coloured light onto orthogonal neighbours;
 *   held (Overcharged) blocks cast harmonic light onto all 8 neighbours and mark the 8-way blast zone.
 * - 3-frame anticipation squash -> directional shard burst -> 60 ms hitstop on chains of 4+ -> 2% camera breath.
 * - Includes the 3-second Best-Pass Replay Loop renderer for the Results Card.
 */

import { TUNING } from '../tuning.js';
import type { BeatQuery } from '../pulse/BeatClock.js';
import type { PulseEngine } from '../pulse/PulseEngine.js';
import type { BestPassSnapshot, PrimedGroup, PulseTile } from '../pulse/types.js';
import type { ColorSwatch, SkinDefinition } from '../content/gems/Skins.js';

interface DebrisShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  vAngle: number;
  rgb: [number, number, number];
  life: number;
  maxLife: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  subtext: string;
  color: string;
  life: number;
  maxLife: number;
}

interface ShockwaveRing {
  col: number;
  row: number;
  rgb: [number, number, number];
  overcharged: boolean;
  life: number;
  maxLife: number;
}

export interface AccessibilityRenderOptions {
  flashIntensity: number; // 0..1
  strobeFree: boolean;
}

export class WallRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private skin: SkinDefinition;
  private spriteAtlas = new Map<number, HTMLCanvasElement>();

  private shards: DebrisShard[] = [];
  private popups: ScorePopup[] = [];
  private shockwaves: ShockwaveRing[] = [];

  private cameraBreath = 0;
  private hitstopUntilMs = 0;
  private lastFrameMs = performance.now();

  /** Hover / long-press progress indicator */
  holdCursor: { col: number; row: number; progress: number } | null = null;
  hoveredClusterIds: Set<number> = new Set();

  constructor(canvas: HTMLCanvasElement, skin: SkinDefinition) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D context unavailable');
    this.ctx = context;
    this.skin = skin;
    this.bakeMaterialAtlas();
  }

  setSkin(skin: SkinDefinition): void {
    if (this.skin.id === skin.id && this.spriteAtlas.size > 0) return;
    this.skin = skin;
    this.bakeMaterialAtlas();
  }

  /**
   * Pre-bakes tactile 80x80 block sprites per colour swatch & material so each colour has
   * both its own hue AND its own physical block material / geometric relief (GDD Page 2 & 6).
   */
  private bakeMaterialAtlas(): void {
    this.spriteAtlas.clear();
    const size = 80;
    const pad = 3;
    const inner = size - pad * 2;

    this.skin.swatches.forEach((swatch, idx) => {
      if (typeof document === 'undefined') return;
      const off = document.createElement('canvas');
      off.width = size;
      off.height = size;
      const g = off.getContext('2d');
      if (!g) return;

      // Base bevelled block body
      this.roundRectPath(g, pad, pad, inner, inner, 8);
      const grad = g.createLinearGradient(pad, pad, pad + inner, pad + inner);
      grad.addColorStop(0, swatch.highlight);
      grad.addColorStop(0.32, swatch.fill);
      grad.addColorStop(1, swatch.shadow);
      g.fillStyle = grad;
      g.fill();

      // Top-left lit chisel bevel
      g.save();
      this.roundRectPath(g, pad + 1.5, pad + 1.5, inner - 3, inner - 3, 6.5);
      g.clip();

      g.fillStyle = 'rgba(255, 255, 255, 0.22)';
      g.fillRect(pad, pad, inner, 5);
      g.fillRect(pad, pad, 5, inner);

      g.fillStyle = 'rgba(0, 0, 0, 0.34)';
      g.fillRect(pad, pad + inner - 6, inner, 6);
      g.fillRect(pad + inner - 6, pad, 6, inner);

      // Material-specific surface texture
      this.drawMaterialSurface(g, pad, pad, inner, swatch);

      // Colour-specific geometric relief emblem (accessible even in monochrome)
      this.drawReliefPattern(g, size / 2, size / 2, inner * 0.32, swatch);

      g.restore();

      // Crisp outer mortar hairline
      this.roundRectPath(g, pad + 0.5, pad + 0.5, inner - 1, inner - 1, 8);
      g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      g.lineWidth = 1;
      g.stroke();

      this.spriteAtlas.set(idx, off);
    });
  }

  private drawMaterialSurface(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    swatch: ColorSwatch
  ): void {
    const mat = this.skin.material;
    if (mat === 'brick') {
      // Kilned masonry mortar groove & mineral speckles
      g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + 6, y + w * 0.5);
      g.lineTo(x + w - 6, y + w * 0.5);
      g.stroke();
    } else if (mat === 'glass') {
      // Cathedral diagonal refraction sheen & lead came inner frame
      g.fillStyle = 'rgba(255, 255, 255, 0.16)';
      g.beginPath();
      g.moveTo(x + 6, y + 6);
      g.lineTo(x + w * 0.68, y + 6);
      g.lineTo(x + 6, y + w * 0.68);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(15, 20, 30, 0.45)';
      g.lineWidth = 2;
      g.strokeRect(x + 7, y + 7, w - 14, w - 14);
    } else if (mat === 'crystal') {
      // Bismuth stepped hopper frames
      g.strokeStyle = swatch.highlight;
      g.globalAlpha = 0.32;
      g.lineWidth = 1.5;
      g.strokeRect(x + 8, y + 8, w - 16, w - 16);
      g.strokeRect(x + 15, y + 15, w - 30, w - 30);
      g.globalAlpha = 1;
    } else if (mat === 'phosphor') {
      // CRT scanlines
      g.fillStyle = 'rgba(0, 0, 0, 0.26)';
      for (let sy = y + 4; sy < y + w - 4; sy += 4) {
        g.fillRect(x + 4, sy, w - 8, 1.5);
      }
    } else if (mat === 'obsidian') {
      // Volcanic fracture diagonal vein
      g.strokeStyle = swatch.highlight;
      g.globalAlpha = 0.28;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + 10, y + w - 12);
      g.lineTo(x + w * 0.45, y + w * 0.52);
      g.lineTo(x + w - 10, y + 12);
      g.stroke();
      g.globalAlpha = 1;
    } else {
      // Carved monolith inner slab
      g.fillStyle = 'rgba(255, 255, 255, 0.08)';
      g.fillRect(x + 10, y + 10, w - 20, w - 20);
    }
  }

  private drawReliefPattern(
    g: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    swatch: ColorSwatch
  ): void {
    g.save();
    g.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    g.fillStyle = 'rgba(255, 255, 255, 0.22)';
    g.lineWidth = 2;

    switch (swatch.reliefPattern) {
      case 'courses': {
        // Horizontal architectural bars
        g.strokeRect(cx - r, cy - r * 0.55, r * 2, r * 1.1);
        g.beginPath();
        g.moveTo(cx - r, cy);
        g.lineTo(cx + r, cy);
        g.stroke();
        break;
      }
      case 'chevron': {
        // Upward diamond / chevron facet
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r, cy);
        g.closePath();
        g.stroke();
        break;
      }
      case 'hopper': {
        // Concentric stepped square
        g.strokeRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
        g.fillRect(cx - r * 0.3, cy - r * 0.3, r * 0.6, r * 0.6);
        break;
      }
      case 'radial': {
        // Inscribed circle + core dot
        g.beginPath();
        g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, r * 0.26, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'triad': {
        // Inscribed upward triangle
        g.beginPath();
        g.moveTo(cx, cy - r * 0.9);
        g.lineTo(cx + r * 0.86, cy + r * 0.72);
        g.lineTo(cx - r * 0.86, cy + r * 0.72);
        g.closePath();
        g.stroke();
        break;
      }
    }
    g.restore();
  }

  /** Spawns detonation shatter debris, shockwave ring, hitstop, and 2% camera breath. */
  emitDetonationVisuals(
    cells: { col: number; row: number; kind: number }[],
    points: number,
    resonanceCount: number,
    overcharged: boolean,
    airPrimed: boolean,
    a11y: AccessibilityRenderOptions
  ): void {
    if (cells.length === 0) return;

    let sumCol = 0;
    let sumRow = 0;
    for (const c of cells) {
      sumCol += c.col;
      sumRow += c.row;
    }
    const avgCol = sumCol / cells.length;
    const avgRow = sumRow / cells.length;

    const firstKind = cells[0]!.kind;
    const swatch = this.skin.swatches[firstKind % this.skin.swatches.length]!;

    // Shockwave ring
    this.shockwaves.push({
      col: avgCol + 0.5,
      row: avgRow + 0.5,
      rgb: swatch.rgb,
      overcharged,
      life: 0,
      maxLife: overcharged ? 0.52 : 0.36
    });

    // Cap active shards at 140 so particle count stays bounded
    const shardsPerBlock = this.shards.length > 100 ? 1 : overcharged ? 3 : 2;
    for (const cell of cells) {
      const cellSwatch = this.skin.swatches[cell.kind % this.skin.swatches.length]!;
      for (let i = 0; i < shardsPerBlock; i++) {
        const angle = (Math.PI * 2 * i) / shardsPerBlock + (Math.random() - 0.5) * 0.8;
        const speed = (overcharged ? 4.2 : 2.8) + Math.random() * 2.5;
        this.shards.push({
          x: cell.col + 0.5,
          y: cell.row + 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.4,
          size: 0.16 + Math.random() * 0.12,
          angle: Math.random() * Math.PI * 2,
          vAngle: (Math.random() - 0.5) * 8,
          rgb: cellSwatch.rgb,
          life: 0,
          maxLife: 0.38 + Math.random() * 0.18
        });
      }
    }

    // Score & chain callout popup
    const badges: string[] = [];
    if (overcharged) badges.push('OVERCHARGE ×2');
    if (airPrimed) badges.push('AIR ×1.25');
    if (resonanceCount >= 2) badges.push(`CHAIN ${resonanceCount}`);

    this.popups.push({
      x: avgCol + 0.5,
      y: avgRow + 0.2,
      text: `+${points.toLocaleString()}`,
      subtext: badges.join(' · '),
      color: overcharged ? '#ffe699' : swatch.highlight,
      life: 0,
      maxLife: 0.85
    });

    // GDD Page 6: 60 ms hitstop on chains of 4+ -> a 2% camera breath. Never shake spam.
    if (!a11y.strobeFree) {
      if (resonanceCount >= TUNING.HITSTOP_CHAIN_THRESHOLD || overcharged) {
        this.hitstopUntilMs = performance.now() + TUNING.HITSTOP_MS;
        this.cameraBreath = TUNING.CAMERA_BREATH_MAX;
      } else {
        this.cameraBreath = Math.max(this.cameraBreath, TUNING.CAMERA_BREATH_MAX * 0.55);
      }
    }
  }

  /** Main 120fps wall render pass. */
  render(
    engine: PulseEngine,
    beat: BeatQuery,
    a11y: AccessibilityRenderOptions
  ): void {
    const nowMs = performance.now();
    const rawDt = Math.min(0.05, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    // Respect 60ms hitstop on chains of 4+
    const inHitstop = nowMs < this.hitstopUntilMs;
    const dt = inHitstop ? 0 : rawDt;

    // Decay 2% camera breath smoothly
    this.cameraBreath = Math.max(0, this.cameraBreath - dt * 0.085);

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    const cols = TUNING.BOARD_COLS;
    const rows = TUNING.BOARD_ROWS;

    // Reserve bottom preview strip (0.65 row height) for incoming pressure row preview
    const totalVerticalUnits = rows + 0.72;
    const cellPx = Math.min(W / cols, H / totalVerticalUnits);
    const boardW = cellPx * cols;
    const boardH = cellPx * rows;
    const originX = (W - boardW) * 0.5;
    const originY = (H - (boardH + cellPx * 0.72)) * 0.5;

    ctx.save();

    // Clear cabinet well background
    ctx.fillStyle = this.skin.wellSurface;
    ctx.fillRect(0, 0, W, H);

    // Apply subtle 2% harmonic camera breath anchored at wall center
    if (this.cameraBreath > 0.0001) {
      const scale = 1 + this.cameraBreath;
      const cx = originX + boardW * 0.5;
      const cy = originY + boardH * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    // 1. Draw architectural grid hairlines & danger line
    this.drawWellGrid(ctx, originX, originY, boardW, boardH, cellPx, cols, rows, beat, engine);

    // 2. Compute Neighbour Light-Casting Map & Overcharge 8-Way Blast Footprint
    const lightMap = this.computeNeighbourLightMap(engine, cols, rows, beat);

    // 3. Draw ambient neighbour light pools beneath tiles
    this.drawNeighbourLightPools(ctx, originX, originY, cellPx, cols, rows, lightMap);

    // 4. Build lookup of primed groups by tileId
    const tileGroupMap = new Map<number, PrimedGroup>();
    for (const g of engine.groups.values()) {
      for (const id of g.tileIds) tileGroupMap.set(id, g);
    }

    // Beat pulse factor (0..1)
    const beatPulse = Math.pow(1 - beat.beatProgress, 2.2);

    // 5. Draw all wall blocks (with 3-frame anticipation squash near sweep)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = engine.board[r]![c];
        if (!tile) continue;

        const interp = engine.getInterpolatedTilePos(tile, beat.visualElapsedSec);
        const group = tileGroupMap.get(tile.id) ?? null;

        // 3-frame anticipation squash as the sweepline approaches an active primed group
        let squashX = 1;
        let squashY = 1;
        if (group && group.state !== 'queued' && group.state !== 'held') {
          const distToSweep = tile.col - beat.sweepColFloat;
          if (distToSweep >= -0.15 && distToSweep <= TUNING.ANTICIPATION_SQUASH_COLS) {
            const t = 1 - Math.max(0, distToSweep) / TUNING.ANTICIPATION_SQUASH_COLS;
            squashX = 1 + t * 0.09;
            squashY = 1 - t * 0.08;
          }
        } else if (group) {
          // Primed groups inhale gently on the beat
          const breathe = beatPulse * (group.held ? 0.055 : 0.032);
          squashX = 1 + breathe;
          squashY = 1 + breathe;
        }

        const drawX = originX + interp.col * cellPx;
        const drawY = originY + interp.row * cellPx;

        this.drawBlock(
          ctx,
          tile,
          drawX,
          drawY,
          cellPx,
          squashX,
          squashY,
          group,
          interp.airborne,
          lightMap[r]![c]!,
          beatPulse
        );
      }
    }

    // 6. Draw connected monolithic contours around primed & held groups
    this.drawPrimedGroupContours(ctx, engine, originX, originY, cellPx, beatPulse, beat);

    // 7. Draw long-press Hold radial progress ring if user is holding down on a primed group
    if (this.holdCursor && this.holdCursor.progress > 0.05) {
      const hx = originX + (this.holdCursor.col + 0.5) * cellPx;
      const hy = originY + (this.holdCursor.row + 0.5) * cellPx;
      ctx.save();
      ctx.strokeStyle = '#ffe699';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        hx,
        hy,
        cellPx * 0.44,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.holdCursor.progress)
      );
      ctx.stroke();
      ctx.restore();
    }

    // 8. Draw incoming pressure row preview trough at the bottom of the wall
    this.drawIncomingPreviewRow(ctx, engine, originX, originY + boardH + cellPx * 0.14, cellPx, cols);

    // 9. Draw the Sweepline Persona (unless skin is Coda 'invisible')
    this.drawSweepPersona(ctx, originX, originY, boardW, boardH, cellPx, beat, engine, a11y);

    // 10. Update and draw shockwaves, debris shards, and score popups
    this.updateAndDrawEffects(ctx, dt, originX, originY, cellPx);

    ctx.restore();
  }

  private drawWellGrid(
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    boardW: number,
    boardH: number,
    cellPx: number,
    cols: number,
    rows: number,
    beat: BeatQuery,
    engine: PulseEngine
  ): void {
    ctx.strokeStyle = this.skin.gridHairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const x = Math.round(originX + c * cellPx) + 0.5;
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY + boardH);
    }
    for (let r = 0; r <= rows; r++) {
      const y = Math.round(originY + r * cellPx) + 0.5;
      ctx.moveTo(originX, y);
      ctx.lineTo(originX + boardW, y);
    }
    ctx.stroke();

    // Danger line across the top row boundary (row 1)
    const topOccupied = engine.board[0]!.some(Boolean) || engine.board[1]!.some(Boolean);
    const dangerY = originY + cellPx;
    const dangerAlpha = topOccupied
      ? 0.55 + 0.35 * Math.sin(beat.visualElapsedSec * 10)
      : 0.28;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 77, 109, ${dangerAlpha.toFixed(3)})`;
    ctx.lineWidth = topOccupied ? 2 : 1.25;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(originX, dangerY);
    ctx.lineTo(originX + boardW, dangerY);
    ctx.stroke();
    ctx.restore();
  }

  private computeNeighbourLightMap(
    engine: PulseEngine,
    cols: number,
    rows: number,
    beat: BeatQuery
  ): { r: number; g: number; b: number; intensity: number; blastTarget: boolean }[][] {
    const map = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({
        r: 0,
        g: 0,
        b: 0,
        intensity: 0,
        blastTarget: false
      }))
    );

    const pulse = 0.75 + 0.25 * Math.cos(beat.beatProgress * Math.PI * 2);

    for (const group of engine.groups.values()) {
      const swatch = this.skin.swatches[group.kind % this.skin.swatches.length]!;
      const [sr, sg, sb] = swatch.rgb;
      const isHeld = group.held;

      for (const id of group.tileIds) {
        const tile = engine.findTileById(id);
        if (!tile) continue;

        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const isDiag = dr !== 0 && dc !== 0;
            if (isDiag && !isHeld) continue; // Only Held/Overcharged groups cast onto diagonals!

            const nr = tile.row + dr;
            const nc = tile.col + dc;
            const cell = map[nr]?.[nc];
            if (!cell) continue;

            const weight = (isHeld ? 0.52 : 0.32) * (isDiag ? 0.75 : 1.0) * pulse;
            cell.r = Math.min(255, cell.r + sr * weight);
            cell.g = Math.min(255, cell.g + sg * weight);
            cell.b = Math.min(255, cell.b + sb * weight);
            cell.intensity = Math.min(1, cell.intensity + weight);
            if (isHeld) {
              cell.blastTarget = true;
            }
          }
        }
      }
    }

    return map;
  }

  private drawNeighbourLightPools(
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    cellPx: number,
    cols: number,
    rows: number,
    lightMap: { r: number; g: number; b: number; intensity: number; blastTarget: boolean }[][]
  ): void {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = lightMap[r]![c]!;
        if (cell.intensity <= 0.02) continue;

        const x = originX + c * cellPx;
        const y = originY + r * cellPx;
        ctx.fillStyle = `rgba(${Math.round(cell.r)}, ${Math.round(cell.g)}, ${Math.round(
          cell.b
        )}, ${(cell.intensity * 0.24).toFixed(3)})`;
        ctx.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2);

        // If targeted by an adjacent Held/Overcharged group's 8-way blast, draw subtle corner reticle ticks
        if (cell.blastTarget) {
          ctx.strokeStyle = 'rgba(255, 230, 150, 0.42)';
          ctx.lineWidth = 1.25;
          const m = 4;
          const len = 5;
          ctx.beginPath();
          ctx.moveTo(x + m, y + m + len);
          ctx.lineTo(x + m, y + m);
          ctx.lineTo(x + m + len, y + m);

          ctx.moveTo(x + cellPx - m - len, y + cellPx - m);
          ctx.lineTo(x + cellPx - m, y + cellPx - m);
          ctx.lineTo(x + cellPx - m, y + cellPx - m - len);
          ctx.stroke();
        }
      }
    }
  }

  private drawBlock(
    ctx: CanvasRenderingContext2D,
    tile: PulseTile,
    x: number,
    y: number,
    cellPx: number,
    squashX: number,
    squashY: number,
    group: PrimedGroup | null,
    airborne: boolean,
    neighbourLight: { r: number; g: number; b: number; intensity: number; blastTarget: boolean },
    beatPulse: number
  ): void {
    const sprite = this.spriteAtlas.get(tile.kind % this.skin.swatches.length);
    const swatch = this.skin.swatches[tile.kind % this.skin.swatches.length]!;

    const cx = x + cellPx * 0.5;
    const cy = y + cellPx * 0.5;
    const w = cellPx * squashX;
    const h = cellPx * squashY;

    if (sprite) {
      ctx.drawImage(sprite, cx - w * 0.5, cy - h * 0.5, w, h);
    } else {
      ctx.fillStyle = swatch.fill;
      ctx.fillRect(cx - w * 0.5 + 2, cy - h * 0.5 + 2, w - 4, h - 4);
    }

    // Cast light from adjacent primed/held blocks onto this unprimed block!
    if (!group && neighbourLight.intensity > 0.05) {
      ctx.fillStyle = `rgba(${Math.round(neighbourLight.r)}, ${Math.round(
        neighbourLight.g
      )}, ${Math.round(neighbourLight.b)}, ${(neighbourLight.intensity * 0.36).toFixed(3)})`;
      this.roundRectPath(ctx, cx - w * 0.5 + 2, cy - h * 0.5 + 2, w - 4, h - 4, 5);
      ctx.fill();
    }

    // Hover highlight for primeable cluster under pointer
    if (!group && this.hoveredClusterIds.has(tile.id)) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.5;
      this.roundRectPath(ctx, cx - w * 0.5 + 2, cy - h * 0.5 + 2, w - 4, h - 4, 5);
      ctx.stroke();
    }

    // Mid-air falling indicator (subtle upward motion trail so air-priming is readable)
    if (airborne && !group) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.22, cy - h * 0.32);
      ctx.lineTo(cx + w * 0.22, cy - h * 0.32);
      ctx.stroke();
    }

    // Primed / Held inner luminescence
    if (group) {
      const isHeld = group.held;
      const coreAlpha = isHeld ? 0.38 + beatPulse * 0.28 : 0.2 + beatPulse * 0.22;
      ctx.fillStyle = isHeld
        ? `rgba(255, 245, 200, ${coreAlpha.toFixed(3)})`
        : `rgba(255, 255, 255, ${coreAlpha.toFixed(3)})`;
      this.roundRectPath(ctx, cx - w * 0.36, cy - h * 0.36, w * 0.72, h * 0.72, 4);
      ctx.fill();
    }

    // Remix Mutator overlays (only present in Remix mode)
    if (tile.special !== 'none') {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(cellPx * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label =
        tile.special === 'wildcard'
          ? '★'
          : tile.special === 'hazard'
            ? '×'
            : String(tile.timerBars ?? 1);
      ctx.fillText(label, cx, cy);
      ctx.restore();
    }
  }

  /**
   * Draws unified exterior borders around primed groups so connected blocks fuse into
   * a single breathing architectural cluster.
   */
  private drawPrimedGroupContours(
    ctx: CanvasRenderingContext2D,
    engine: PulseEngine,
    originX: number,
    originY: number,
    cellPx: number,
    beatPulse: number,
    beat: BeatQuery
  ): void {
    for (const group of engine.groups.values()) {
      const swatch = this.skin.swatches[group.kind % this.skin.swatches.length]!;
      const coords = new Set<string>();
      const tiles: { col: number; row: number }[] = [];

      for (const id of group.tileIds) {
        const t = engine.findTileById(id);
        if (!t) continue;
        const pos = engine.getInterpolatedTilePos(t, beat.visualElapsedSec);
        const rc = Math.round(pos.col);
        const rr = Math.round(pos.row);
        coords.add(`${rc},${rr}`);
        tiles.push({ col: pos.col, row: pos.row });
      }
      if (tiles.length === 0) continue;

      const isHeld = group.held;
      const isQueued = group.state === 'queued';

      ctx.save();
      ctx.strokeStyle = isHeld
        ? '#ffe89e'
        : isQueued
          ? 'rgba(255, 255, 255, 0.55)'
          : swatch.highlight;
      ctx.lineWidth = isHeld ? 3.0 + beatPulse * 1.2 : 2.2 + beatPulse * 0.8;
      if (isQueued) {
        ctx.setLineDash([4, 3]);
      }

      const inset = 2;
      ctx.beginPath();
      for (const t of tiles) {
        const c = Math.round(t.col);
        const r = Math.round(t.row);
        const x = originX + t.col * cellPx;
        const y = originY + t.row * cellPx;

        // Top edge
        if (!coords.has(`${c},${r - 1}`)) {
          ctx.moveTo(x + inset, y + inset);
          ctx.lineTo(x + cellPx - inset, y + inset);
        }
        // Bottom edge
        if (!coords.has(`${c},${r + 1}`)) {
          ctx.moveTo(x + inset, y + cellPx - inset);
          ctx.lineTo(x + cellPx - inset, y + cellPx - inset);
        }
        // Left edge
        if (!coords.has(`${c - 1},${r}`)) {
          ctx.moveTo(x + inset, y + inset);
          ctx.lineTo(x + inset, y + cellPx - inset);
        }
        // Right edge
        if (!coords.has(`${c + 1},${r}`)) {
          ctx.moveTo(x + cellPx - inset, y + inset);
          ctx.lineTo(x + cellPx - inset, y + cellPx - inset);
        }
      }
      ctx.stroke();

      // Badge on anchor tile for Held / Air-Primed status
      if (isHeld || group.airPrimed) {
        const topTile = tiles.reduce((best, cur) =>
          cur.row < best.row || (cur.row === best.row && cur.col < best.col) ? cur : best
        );
        const bx = originX + (topTile.col + 0.5) * cellPx;
        const by = originY + (topTile.row + 0.25) * cellPx;
        ctx.fillStyle = isHeld ? '#1a1405' : '#081820';
        this.roundRectPath(ctx, bx - cellPx * 0.36, by - 7, cellPx * 0.72, 14, 4);
        ctx.fill();
        ctx.fillStyle = isHeld ? '#ffe680' : '#7bf5ff';
        ctx.font = `800 ${Math.max(8, Math.round(cellPx * 0.23))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isHeld ? '×2 HOLD' : 'AIR', bx, by);
      }

      ctx.restore();
    }
  }

  /** Draws the dimmed upcoming pressure row preview at the bottom of the wall (GDD Page 2). */
  private drawIncomingPreviewRow(
    ctx: CanvasRenderingContext2D,
    engine: PulseEngine,
    originX: number,
    previewY: number,
    cellPx: number,
    cols: number
  ): void {
    const upcoming = engine.previewUpcomingRow();
    const h = cellPx * 0.46;
    const barsLeft = engine.barsUntilNextPush;
    const imminent = barsLeft === 1;

    ctx.save();
    ctx.globalAlpha = imminent ? 0.72 : 0.42;

    for (let c = 0; c < cols; c++) {
      const tile = upcoming[c];
      if (!tile) continue;
      const swatch = this.skin.swatches[tile.kind % this.skin.swatches.length]!;
      const x = originX + c * cellPx + 2.5;
      ctx.fillStyle = swatch.fill;
      this.roundRectPath(ctx, x, previewY, cellPx - 5, h, 4);
      ctx.fill();
      ctx.strokeStyle = swatch.highlight;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draws the skin's Sweep Persona (GDD Page 5):
   * - 'blade': A blade of light
   * - 'rain': A wave of rain
   * - 'prism': A refracted crystal vector
   * - 'scanbeam': A CRT phosphor beam
   * - 'embers': A flock of rising embers
   * - 'aurora': A ribbon of silk
   * - 'invisible': Coda mode (play by ear!)
   */
  private drawSweepPersona(
    ctx: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    boardW: number,
    boardH: number,
    cellPx: number,
    beat: BeatQuery,
    engine: PulseEngine,
    a11y: AccessibilityRenderOptions
  ): void {
    const persona = this.skin.sweepPersona;
    const flashScale = Math.max(0.15, a11y.flashIntensity);

    if (persona === 'invisible') {
      // Coda mode: sweep is invisible on the wall; only a subtle downbeat rim tick at the top bezel
      if (beat.beat === 0 && beat.beatProgress < 0.25) {
        const a = (1 - beat.beatProgress * 4) * 0.35 * flashScale;
        ctx.strokeStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(originX + 1, originY + 1, boardW - 2, boardH - 2);
      }
      return;
    }

    const sweepX = originX + beat.sweepColFloat * cellPx;
    const trailW = cellPx * (persona === 'scanbeam' ? 1.8 : 1.15);

    ctx.save();

    // Trailing wake gradient
    const wake = ctx.createLinearGradient(sweepX - trailW, 0, sweepX + 4, 0);
    wake.addColorStop(0, 'rgba(255, 255, 255, 0)');
    wake.addColorStop(0.75, `${this.skin.sweepSecondary}22`);
    wake.addColorStop(1, `${this.skin.sweepColor}66`);
    ctx.fillStyle = wake;
    ctx.fillRect(Math.max(originX, sweepX - trailW), originY, trailW + 4, boardH);

    // Core blade line
    ctx.strokeStyle = this.skin.sweepColor;
    ctx.lineWidth = persona === 'blade' ? 3.2 : 2.5;
    ctx.beginPath();
    ctx.moveTo(sweepX, originY);
    ctx.lineTo(sweepX, originY + boardH);
    ctx.stroke();

    // Persona-specific visual accents (zero shadowBlur!)
    if (persona === 'rain') {
      ctx.strokeStyle = this.skin.sweepSecondary;
      ctx.lineWidth = 1.4;
      const t = beat.visualElapsedSec * 360;
      for (let i = 0; i < 9; i++) {
        const ry = originY + ((i * 67 + t) % Math.max(1, boardH - 18));
        const rx = sweepX - (i % 3) * 5;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry + 14);
        ctx.stroke();
      }
    } else if (persona === 'embers') {
      ctx.fillStyle = this.skin.sweepSecondary;
      const t = beat.visualElapsedSec * 220;
      for (let i = 0; i < 8; i++) {
        const ey = originY + boardH - ((i * 73 + t) % Math.max(1, boardH - 10));
        const ex = sweepX + Math.sin(i * 2.1 + beat.visualElapsedSec * 6) * 8;
        ctx.fillRect(ex - 2, ey - 2, 4, 4);
      }
    } else if (persona === 'prism') {
      ctx.strokeStyle = this.skin.sweepSecondary;
      ctx.lineWidth = 1.2;
      for (let r = 1; r < TUNING.BOARD_ROWS; r += 2) {
        const py = originY + r * cellPx;
        ctx.strokeRect(sweepX - 4, py - 4, 8, 8);
      }
    }

    // Highlight intersections where the sweepline touches a primed block
    const sweepColIdx = Math.floor(beat.sweepColFloat);
    for (const g of engine.groups.values()) {
      for (const id of g.tileIds) {
        const t = engine.findTileById(id);
        if (t && t.col === sweepColIdx) {
          const iy = originY + (t.row + 0.5) * cellPx;
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * flashScale).toFixed(3)})`;
          ctx.fillRect(sweepX - cellPx * 0.45, iy - 2.5, cellPx * 0.9, 5);
        }
      }
    }

    ctx.restore();
  }

  private updateAndDrawEffects(
    ctx: CanvasRenderingContext2D,
    dt: number,
    originX: number,
    originY: number,
    cellPx: number
  ): void {
    // 1. Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i]!;
      sw.life += dt;
      if (sw.life >= sw.maxLife) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      const p = sw.life / sw.maxLife;
      const alpha = (1 - p) * (sw.overcharged ? 0.7 : 0.48);
      const radius = (0.4 + p * (sw.overcharged ? 2.4 : 1.5)) * cellPx;
      ctx.strokeStyle = `rgba(${sw.rgb[0]}, ${sw.rgb[1]}, ${sw.rgb[2]}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = sw.overcharged ? 3 : 2;
      ctx.beginPath();
      ctx.arc(originX + sw.col * cellPx, originY + sw.row * cellPx, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Debris shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]!;
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.shards.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 9.5 * dt; // gravity
      s.angle += s.vAngle * dt;

      const alpha = 1 - s.life / s.maxLife;
      const px = originX + s.x * cellPx;
      const py = originY + s.y * cellPx;
      const sz = s.size * cellPx;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(s.angle);
      ctx.fillStyle = `rgba(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}, ${alpha.toFixed(3)})`;
      ctx.fillRect(-sz * 0.5, -sz * 0.5, sz, sz);
      ctx.restore();
    }

    // 3. Score popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i]!;
      pop.life += dt;
      if (pop.life >= pop.maxLife) {
        this.popups.splice(i, 1);
        continue;
      }
      const p = pop.life / pop.maxLife;
      const alpha = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
      const px = originX + pop.x * cellPx;
      const py = originY + (pop.y - p * 0.9) * cellPx;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = `800 ${Math.round(cellPx * 0.44)}px system-ui, sans-serif`;
      ctx.fillStyle = '#09080d';
      ctx.fillText(pop.text, px + 1.5, py + 1.5);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, px, py);

      if (pop.subtext) {
        ctx.font = `700 ${Math.round(cellPx * 0.25)}px system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pop.subtext, px, py + cellPx * 0.36);
      }
      ctx.restore();
    }
  }

  /**
   * Converts client pointer coordinates `(clientX, clientY)` into board `{ col, row }`,
   * or `null` if outside the 10x14 wall.
   */
  clientToBoardCell(clientX: number, clientY: number): { col: number; row: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const cols = TUNING.BOARD_COLS;
    const rows = TUNING.BOARD_ROWS;
    const totalVerticalUnits = rows + 0.72;
    const cellPx = Math.min(this.canvas.width / cols, this.canvas.height / totalVerticalUnits);
    const boardW = cellPx * cols;
    const boardH = cellPx * rows;
    const originX = (this.canvas.width - boardW) * 0.5;
    const originY = (this.canvas.height - (boardH + cellPx * 0.72)) * 0.5;

    const col = Math.floor((canvasX - originX) / cellPx);
    const row = Math.floor((canvasY - originY) / cellPx);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { col, row };
  }

  /**
   * Renders the Best-Pass 3-Second Replay Loop onto a mini-canvas on the Results Card (GDD Page 4).
   */
  renderBestPassReplay(
    targetCanvas: HTMLCanvasElement,
    snapshot: BestPassSnapshot | null,
    nowMs: number
  ): void {
    const g = targetCanvas.getContext('2d');
    if (!g) return;
    const W = targetCanvas.width;
    const H = targetCanvas.height;

    g.fillStyle = this.skin.wellSurface;
    g.fillRect(0, 0, W, H);

    const cols = TUNING.BOARD_COLS;
    const rows = TUNING.BOARD_ROWS;
    const cellPx = Math.min(W / cols, H / rows);
    const ox = (W - cellPx * cols) * 0.5;
    const oy = (H - cellPx * rows) * 0.5;

    // 3-second continuous loop (0..1)
    const loopProgress = ((nowMs % 3000) / 3000);
    const currentSixteenth = loopProgress * TUNING.SIXTEENTHS_PER_BAR;
    const sweepX = ox + loopProgress * cols * cellPx;

    if (!snapshot || snapshot.cells.length === 0) {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('NO PASS RECORDED YET', W * 0.5, H * 0.5);
      return;
    }

    for (const cell of snapshot.cells) {
      const detStep = cell.detonatedStep;
      const alreadyDetonated = detStep !== null && currentSixteenth >= detStep + 0.8;
      if (alreadyDetonated) continue;

      const justDetonating =
        detStep !== null && currentSixteenth >= detStep && currentSixteenth < detStep + 0.8;

      const swatch = this.skin.swatches[cell.kind % this.skin.swatches.length]!;
      const x = ox + cell.col * cellPx;
      const y = oy + cell.row * cellPx;

      g.fillStyle = justDetonating ? '#ffffff' : swatch.fill;
      g.fillRect(x + 1, y + 1, cellPx - 2, cellPx - 2);

      if (cell.primed) {
        g.strokeStyle = cell.overcharged ? '#ffe680' : '#ffffff';
        g.lineWidth = cell.overcharged ? 2 : 1.25;
        g.strokeRect(x + 1.5, y + 1.5, cellPx - 3, cellPx - 3);
      }
    }

    // Sweep line crossing the replay mini-board
    g.strokeStyle = this.skin.sweepColor;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(sweepX, oy);
    g.lineTo(sweepX, oy + rows * cellPx);
    g.stroke();
  }

  private roundRectPath(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const rad = Math.min(r, w * 0.5, h * 0.5);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }
}
