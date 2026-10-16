import { T } from '../../tuning.js';
import type { Tile } from '../../pulse/Pulse.js';
import type { ContentRules } from '../../pulse/ContentRules.js';
import type { DeterministicRng } from '../../shell/DeterministicRNG.js';
export class GemRules implements ContentRules {
  spawnRow(rng: DeterministicRng, count: number): number[] {
    // Periodically guaranteed neighbouring pairs; no specialty tiles in flagship modes.
    const row: number[] = [];
    while (row.length < count) {
      const type = rng.int(0, T.GEM_COLORS - 1);
      const pair = rng.chance(.37);
      row.push(type);
      if (pair && row.length < count) row.push(type);
    }
    return row;
  }
  primeable(board: (Tile | null)[][], x: number, y: number): number[] {
    const first = board[y]?.[x];
    if (!first || first.group !== null) return [];
    const queue: [number, number][] = [[x, y]], seen = new Set<string>(), ids: number[] = [];
    while (queue.length) {
      const [cx, cy] = queue.pop()!, key = `${cx},${cy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tile = board[cy]?.[cx];
      if (!tile || tile.type !== first.type || tile.group !== null) continue;
      ids.push(tile.id);
      queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return ids.length >= T.MIN_GROUP ? ids.sort((a,b) => a-b) : [];
  }
  collapse(board: (Tile | null)[][]): { board: (Tile | null)[][]; moved: number[] } {
    const moved: number[] = [], cols: Tile[][] = [];
    for (let x = 0; x < T.BOARD_COLS; x++) {
      const stack = [] as Tile[];
      for (let y = T.BOARD_ROWS - 1; y >= 0; y--) {
        const t = board[y]?.[x]; if (t) stack.push(t);
      }
      if (stack.length) cols.push(stack);
    }
    const offset = Math.floor((T.BOARD_COLS - cols.length) / 2);
    const result: (Tile | null)[][] = Array.from({ length: T.BOARD_ROWS }, () => Array(T.BOARD_COLS).fill(null));
    cols.forEach((stack, c) => stack.forEach((tile, i) => {
      const x = offset + c, y = T.BOARD_ROWS - 1 - i;
      if (tile.x !== x || tile.y !== y) moved.push(tile.id);
      tile.x = x; tile.y = y; result[y]![x] = tile;
    }));
    return { board: result, moved };
  }
  expandClear(board: (Tile | null)[][], ids: readonly number[]): number[] {
    const result = new Set(ids);
    for (const row of board) for (const t of row) {
      if (!t || !ids.includes(t.id)) continue;
      for (let dy = -T.OVERCHARGE_RADIUS; dy <= T.OVERCHARGE_RADIUS; dy++)
        for (let dx = -T.OVERCHARGE_RADIUS; dx <= T.OVERCHARGE_RADIUS; dx++) {
          const neighbor = board[t.y + dy]?.[t.x + dx];
          if (neighbor) result.add(neighbor.id);
        }
    }
    return [...result].sort((a,b)=>a-b);
  }
  scoreGroup(size: number): number { return T.GEM_BASE * Math.pow(size, T.SIZE_EXP); }
  tileView(tile: Tile): number { return tile.type; }
}
