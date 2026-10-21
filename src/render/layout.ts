/** Letterbox layout of the 844x390 logical stage inside the safe area (shared by Stage and the DOM UI). */

import { TUNING } from '../tuning.js';

export interface StageLayout {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

let probe: HTMLDivElement | null = null;

export function computeLayout(): StageLayout {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;inset:0;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cs = getComputedStyle(probe);
  const st = parseFloat(cs.paddingTop) || 0;
  const sr = parseFloat(cs.paddingRight) || 0;
  const sb = parseFloat(cs.paddingBottom) || 0;
  const sl = parseFloat(cs.paddingLeft) || 0;
  const availW = Math.max(1, w - sl - sr);
  const availH = Math.max(1, h - st - sb);
  const scale = Math.min(availW / TUNING.STAGE_W, availH / TUNING.STAGE_H);
  return { scale, x: sl + (availW - TUNING.STAGE_W * scale) / 2, y: st + (availH - TUNING.STAGE_H * scale) / 2, width: w, height: h };
}

export function applyUiTransform(ui: HTMLElement, l: StageLayout): void {
  ui.style.transform = `translate(${l.x}px, ${l.y}px) scale(${l.scale})`;
  document.documentElement.style.setProperty('--stage-scale', String(l.scale));
  document.documentElement.style.setProperty('--stage-x', `${l.x}px`);
  document.documentElement.style.setProperty('--stage-y', `${l.y}px`);
}
