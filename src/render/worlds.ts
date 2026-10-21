/**
 * Visual worlds: every movement gets its own atmosphere around the wall (background motif, blade
 * style, shard material, accent light). Tiles never change, so the game stays readable.
 */

export type Motif = 'grid' | 'ripples' | 'dust' | 'embers' | 'bars' | 'prisms' | 'waves' | 'stars' | 'rain' | 'pulse';
export type BladeStyle = 'beam' | 'laser' | 'scan' | 'brush' | 'ghost';
export type ShardMaterial = 'shard' | 'pixel' | 'ember' | 'glass' | 'petal';

export interface World {
  motif: Motif;
  blade: BladeStyle;
  shard: ShardMaterial;
  /** Accent light used by the motif, blade glow and wake */
  accent: number;
}

const W = (motif: Motif, blade: BladeStyle, shard: ShardMaterial, accent: number): World => ({ motif, blade, shard, accent });

/** World per genre style (see content/tracks.json `style`). */
export const WORLDS: Record<string, World> = {
  overture: W('stars', 'beam', 'shard', 0x9edcff),
  house: W('pulse', 'beam', 'shard', 0x6fb6ff),
  garage: W('rain', 'scan', 'glass', 0x7fe6e0),
  techno: W('bars', 'laser', 'pixel', 0xb79bff),
  synthwave: W('grid', 'scan', 'shard', 0xff6fb5),
  afro: W('ripples', 'brush', 'petal', 0x6ff0b8),
  electro: W('bars', 'laser', 'pixel', 0x5fd2ff),
  lofi: W('dust', 'brush', 'petal', 0xd8b98a),
  jazz: W('dust', 'brush', 'shard', 0xffc461),
  breaks: W('rain', 'beam', 'shard', 0x7fb2ff),
  halftime: W('waves', 'scan', 'glass', 0xa98bff),
  ambient: W('ripples', 'ghost', 'glass', 0x8fd8ff),
  disco: W('prisms', 'beam', 'glass', 0xffa0d6),
  industrial: W('embers', 'laser', 'ember', 0xff9a4d),
  footwork: W('pulse', 'laser', 'pixel', 0xff7aa0),
  trap: W('stars', 'scan', 'shard', 0xc08bff),
  hyperpop: W('prisms', 'beam', 'pixel', 0xff8be8),
  jungle: W('waves', 'brush', 'ember', 0x8fe07a),
  coda: W('stars', 'ghost', 'glass', 0xfff1d0)
};

export function worldFor(style: string): World {
  return WORLDS[style] ?? WORLDS.house!;
}
