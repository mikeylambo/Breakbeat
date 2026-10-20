/** BREAKBEAT v0.6 palette: two complementary pairs; every colour also differs in lightness and glyph. */

export interface TileColour {
  name: string;
  base: number;
  core: number;
  deep: number;
  primedCore: number;
  glyph: 'diamond' | 'ring' | 'bars' | 'triangle' | 'hexagon';
}

export const TILE_COLOURS: readonly TileColour[] = [
  { name: 'Amber', base: 0xf2a93b, core: 0xffd58a, deep: 0x7e4210, primedCore: 0xfff1d0, glyph: 'diamond' },
  { name: 'Magenta', base: 0xe0367e, core: 0xff8dbb, deep: 0x540d30, primedCore: 0xffe0ec, glyph: 'ring' },
  { name: 'Azure', base: 0x2e9ee8, core: 0x9edcff, deep: 0x0a325a, primedCore: 0xe3f5ff, glyph: 'bars' },
  { name: 'Jade', base: 0x2cc994, core: 0xa6f7d6, deep: 0x094634, primedCore: 0xe2fff3, glyph: 'triangle' },
  // 5th colour: later skins only
  { name: 'Violet', base: 0x9a7bff, core: 0xcfc0ff, deep: 0x2e1d6e, primedCore: 0xf0ebff, glyph: 'hexagon' }
];

export const UI = {
  bg: 0x05060a,
  panel: 0x0b0d15,
  text: 0xf4f1ea,
  secondary: 0x8a8fa3,
  quiet: 0x5e6376,
  held: 0xffc461,
  mint: 0x7cf2c4,
  blade: 0xf2faff,
  danger: 0xf4f1ea,
  wake: 0x2e9ee8
} as const;

export const HELD_GRADIENT = ['#FFFFFF', '#FFE7B5', '#FFAE3D'] as const;

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

/** Brightness/saturation adjust in RGB space (idle tiles: brightness 0.72, saturation 0.88). */
export function adjust(c: number, brightness: number, saturation: number): number {
  let r = (c >> 16) & 255;
  let g = (c >> 8) & 255;
  let b = c & 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = (l + (r - l) * saturation) * brightness;
  g = (l + (g - l) * saturation) * brightness;
  b = (l + (b - l) * saturation) * brightness;
  const cl = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return (cl(r) << 16) | (cl(g) << 8) | cl(b);
}
