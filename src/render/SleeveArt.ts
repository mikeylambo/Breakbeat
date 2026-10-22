/**
 * SleeveArt — every movement has a record sleeve, shown behind the menus. A track with commissioned
 * art (`sleeve` in content/tracks.json, served from public/sleeves/) uses it; every other track gets
 * a generated stand-in in the same screen-print language: two inks in the movement's colours,
 * slightly misregistered, a big motif from its world, halftone dots, paper grain, and the blade
 * line. Generated once per track and cached as an object URL.
 */

import type { TrackDef } from '../audio/tracks.js';
import { worldFor, type Motif } from './worlds.js';

const SIZE = 640;
const cache = new Map<string, string>();

export function sleeveUrl(track: TrackDef): string {
  if (track.sleeve) return `./${track.sleeve}`;
  let url = cache.get(track.id);
  if (!url) {
    url = generate(track);
    cache.set(track.id, url);
  }
  return url;
}

function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function css([r, g, b]: [number, number, number], a = 1): string {
  return `rgba(${r},${g},${b},${a})`;
}
function mix(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * k)) as [number, number, number];
}

function rng(seed: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619);
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function generate(track: TrackDef): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d')!;
  const world = worldFor(track.style);
  const ink1 = rgb(world.accent);
  const tint = rgb(parseInt(track.tint.slice(1), 16));
  const paper = mix(tint, [6, 7, 11], 0.35);
  const ink2 = mix(ink1, [255, 196, 97], 0.55);
  const r = rng(track.id);

  g.fillStyle = css(paper);
  g.fillRect(0, 0, SIZE, SIZE);

  // Ink 2 first, then ink 1 a few pixels off: the misregistration sells the print
  for (const [ink, dx, dy, alpha] of [
    [ink2, 7, -5, 0.55],
    [ink1, 0, 0, 0.9]
  ] as const) {
    g.save();
    g.translate(dx, dy);
    g.globalAlpha = alpha;
    g.fillStyle = css(ink);
    g.strokeStyle = css(ink);
    motif(g, world.motif, rng(track.id + ink.join()));
    g.restore();
  }

  // Halftone: dot size follows a diagonal light falloff
  g.fillStyle = css(mix(ink1, [255, 255, 255], 0.3), 0.5);
  const step = 11;
  for (let y = step / 2; y < SIZE; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < SIZE; x += step) {
      const d = 1 - Math.min(1, Math.hypot(x - SIZE * 0.75, y - SIZE * 0.2) / (SIZE * 0.85));
      const rad = d * d * 3.6;
      if (rad < 0.4) continue;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Paper grain
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (r() - 0.5) * 26;
    px[i] = px[i]! + n;
    px[i + 1] = px[i + 1]! + n;
    px[i + 2] = px[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);

  // The blade
  const bx = Math.round(SIZE * (0.5 + (r() - 0.5) * 0.16));
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(bx, 0, 3, SIZE);

  return cv.toDataURL('image/jpeg', 0.86);
}

/** The big shape of each world, drawn in the current ink. */
function motif(g: CanvasRenderingContext2D, m: Motif, r: () => number): void {
  const S = SIZE;
  const disc = (x: number, y: number, rad: number): void => {
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  switch (m) {
    case 'grid': {
      // a sun in bands over a perspective floor
      for (let i = 0; i < 9; i++) g.fillRect(S * 0.2, S * 0.18 + i * 26, S * 0.6, 16 - i);
      g.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        const y = S * 0.62 + i * i * 4;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
      }
      for (let i = -6; i <= 6; i++) {
        g.beginPath();
        g.moveTo(S / 2 + i * 14, S * 0.62);
        g.lineTo(S / 2 + i * 120, S);
        g.stroke();
      }
      break;
    }
    case 'ripples':
      g.lineWidth = 10;
      for (let i = 1; i < 9; i++) {
        g.beginPath();
        g.arc(S * 0.42, S * 0.6, i * 38, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'dust':
      disc(S * 0.62, S * 0.38, S * 0.24);
      for (let i = 0; i < 70; i++) disc(r() * S, r() * S, 1 + r() * 4);
      break;
    case 'embers':
      g.beginPath();
      g.moveTo(0, S);
      g.lineTo(S * 0.3, S * 0.45);
      g.lineTo(S * 0.48, S * 0.7);
      g.lineTo(S * 0.72, S * 0.3);
      g.lineTo(S, S);
      g.fill();
      for (let i = 0; i < 60; i++) g.fillRect(r() * S, r() * S * 0.7, 3, 3 + r() * 8);
      break;
    case 'bars':
      for (let i = 0; i < 16; i++) {
        const h = S * (0.2 + r() * 0.6);
        g.fillRect(i * (S / 16) + 3, S - h, S / 16 - 6, h);
      }
      break;
    case 'prisms':
      for (let i = 0; i < 7; i++) {
        const x = S * (0.15 + r() * 0.7);
        const y = S * (0.15 + r() * 0.7);
        const s = 30 + r() * 90;
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.7, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s * 0.7, y);
        g.closePath();
        g.fill();
      }
      break;
    case 'waves':
      for (let b = 0; b < 6; b++) {
        g.beginPath();
        g.moveTo(0, S);
        for (let x = 0; x <= S; x += 8) g.lineTo(x, S * 0.3 + b * 62 + Math.sin(x / 70 + b) * 26);
        g.lineTo(S, S);
        g.closePath();
        g.globalAlpha *= 0.55;
        g.fill();
      }
      break;
    case 'stars':
      g.lineWidth = 6;
      g.beginPath();
      g.arc(S * 0.5, S * 0.5, S * 0.3, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 90; i++) disc(r() * S, r() * S, r() < 0.1 ? 3 : 1.4);
      break;
    case 'rain':
      g.lineWidth = 3;
      for (let i = 0; i < 70; i++) {
        const x = r() * S * 1.3;
        const y = r() * S;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 40, y + 110);
        g.stroke();
      }
      break;
    default:
      // pulse: nested squares, like a speaker cone seen square-on
      g.lineWidth = 12;
      for (let i = 1; i < 7; i++) g.strokeRect(S / 2 - i * 42, S / 2 - i * 42, i * 84, i * 84);
      break;
  }
}
