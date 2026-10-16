import type { Tile } from './Pulse.js';
import type { DeterministicRng } from '../shell/DeterministicRNG.js';
export interface ContentRules {
  spawnRow(rng: DeterministicRng, count: number): number[];
  primeable(board: (Tile | null)[][], x: number, y: number): number[];
  collapse(board: (Tile | null)[][]): { board: (Tile | null)[][]; moved: number[] };
  expandClear(board: (Tile | null)[][], ids: readonly number[]): number[];
  scoreGroup(size: number): number;
  tileView(tile: Tile): number;
}
