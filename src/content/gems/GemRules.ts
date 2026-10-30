/**
 * GemRules — BREAKBEAT ContentRules implementation (GDD Pages 7–8).
 * - Connected same-colour group of 2+, mid-fall included
 * - Destruct-O-Match collapse: vertical gravity, then empty columns slide inward
 * - Overcharge expandClear: radius 1 in all 8 directions, any colour
 * - Scoring: GEM_BASE * size^1.35 * resonance * combo * air * overcharge
 */

import { TUNING } from '../../tuning.js';
import type { SeededRng } from '../../pulse/Rng.js';
import type {
  CollapseResult,
  ContentRules,
  PulseTile,
  ScoreContext,
  SpawnContext,
  SpecialMutation,
  TileVisualDescriptor
} from '../../pulse/types.js';
import type { BlockMaterialType } from './Skins.js';

/** Wildcard / hazard / detonator blocks in Remix. Engine support exists; rendering does not yet. */
const SPECIAL_BLOCKS = false;

export class GemRules implements ContentRules {
  readonly gesture = 'tap-prime-hold' as const;
  readonly cols = TUNING.BOARD_COLS;
  readonly rows = TUNING.BOARD_ROWS;
  readonly initialRows = TUNING.INITIAL_ROWS;

  material: BlockMaterialType;

  constructor(material: BlockMaterialType = 'brick') {
    this.material = material;
  }

  /**
   * Spawns a 10-tile row with weighted colours and a guaranteed adjacent pair
   * so the SOLVABLE gate (never 2 consecutive pushes with zero primeable groups)
   * is satisfied across 1,000 seeds x 300 pushes.
   * Respects PURITY: special blocks only spawn in 'remix' mode.
   */
  spawnRow(rng: SeededRng, ctx: SpawnContext): PulseTile[] {
    const colors = Math.max(2, Math.min(5, ctx.colorCount));
    const kinds: number[] = [];

    for (let c = 0; c < ctx.cols; c++) {
      let k = rng.nextInt(0, colors);
      // Prevent monotonous 4-in-a-row runs while preserving natural 2-3 clusters
      if (c >= 2 && kinds[c - 1] === k && kinds[c - 2] === k) {
        k = (k + 1 + rng.nextInt(0, colors - 1)) % colors;
      }
      kinds.push(k);
    }

    // Guarantee at least one horizontal adjacent pair so the board always has a primeable 2+ cluster
    let hasAdjacentPair = false;
    for (let c = 0; c < ctx.cols - 1; c++) {
      if (kinds[c] === kinds[c + 1]) {
        hasAdjacentPair = true;
        break;
      }
    }
    if (!hasAdjacentPair) {
      const pairCol = rng.nextInt(0, ctx.cols - 1);
      kinds[pairCol + 1] = kinds[pairCol]!;
    }

    const row: PulseTile[] = [];
    for (let c = 0; c < ctx.cols; c++) {
      let special: SpecialMutation = 'none';
      let timerBars: number | undefined;

      // PURITY gate: special blocks ONLY in 'remix' mode
      // Off until special blocks have art and a tutorial: an unseen hazard would read as a bug
      if (SPECIAL_BLOCKS && ctx.mode === 'remix' && ctx.bar > 0) {
        const roll = rng.nextFloat();
        if (roll < 0.04) {
          special = 'wildcard';
        } else if (roll < 0.07) {
          special = 'hazard';
        } else if (roll < 0.09) {
          special = 'detonator';
          timerBars = 4;
        }
      }

      row.push({
        id: ctx.allocTileId(),
        col: c,
        row: ctx.rows - 1,
        kind: kinds[c]!,
        special,
        timerBars
      });
    }

    return row;
  }

  /**
   * Returns the orthogonally connected same-colour group of 2+ containing `(col, row)`,
   * or `null` if fewer than 2 connected blocks exist.
   * Mid-fall tiles are stored in `board` at their target coordinates and remain tappable (AIR_FAIR).
   */
  primeable(
    board: (PulseTile | null)[][],
    col: number,
    row: number,
    lockedTileIds: ReadonlySet<number>
  ): PulseTile[] | null {
    const start = board[row]?.[col];
    if (!start || lockedTileIds.has(start.id) || start.special === 'hazard') {
      return null;
    }

    const targetKind = start.kind;
    const visited = new Set<number>([start.id]);
    const queue: PulseTile[] = [start];
    const cluster: PulseTile[] = [];

    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ] as const;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      cluster.push(cur);

      for (const [dc, dr] of dirs) {
        const nc = cur.col + dc;
        const nr = cur.row + dr;
        const nb = board[nr]?.[nc];
        if (!nb || visited.has(nb.id) || lockedTileIds.has(nb.id) || nb.special === 'hazard') {
          continue;
        }
        if (nb.kind === targetKind || nb.special === 'wildcard' || start.special === 'wildcard') {
          visited.add(nb.id);
          queue.push(nb);
        }
      }
    }

    if (cluster.length < TUNING.MIN_GROUP) {
      return null;
    }
    return cluster;
  }

  /**
   * Destruct-O-Match Cascade (GDD Page 2 & 7):
   * 1. Vertical gravity drops unlocked blocks into empty spaces below them (locked blocks stay fixed).
   * 2. Empty columns close by sliding inward toward the center of the wall.
   */
  collapse(
    board: (PulseTile | null)[][],
    lockedTileIds: ReadonlySet<number>
  ): CollapseResult {
    const rows = board.length;
    const cols = board[0]?.length ?? TUNING.BOARD_COLS;
    const moved = new Set<number>();

    // Phase 1: Vertical gravity per column
    for (let c = 0; c < cols; c++) {
      let writeRow = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        const tile = board[r]![c];
        if (!tile) continue;

        if (lockedTileIds.has(tile.id)) {
          // Locked primed tile stays anchored in place; tiles above cannot fall past it
          writeRow = r - 1;
        } else {
          while (writeRow > r && board[writeRow]![c] !== null) {
            writeRow--;
          }
          if (writeRow > r && board[writeRow]![c] === null) {
            board[r]![c] = null;
            tile.row = writeRow;
            board[writeRow]![c] = tile;
            moved.add(tile.id);
            writeRow--;
          } else {
            writeRow = r - 1;
          }
        }
      }
    }

    // Phase 2: Inward column slide (Destruct-O-Match rules)
    // Only slide if no locked tiles would be sheared apart, or slide whole unlocked segments inward
    // when a column is completely empty from top to bottom.
    const isColEmpty = (c: number): boolean => {
      for (let r = 0; r < rows; r++) {
        if (board[r]![c] !== null) return false;
      }
      return true;
    };

    const colHasLocked = (c: number): boolean => {
      for (let r = 0; r < rows; r++) {
        const t = board[r]![c];
        if (t && lockedTileIds.has(t.id)) return true;
      }
      return false;
    };

    const centerLeft = Math.floor((cols - 1) / 2); // col 4
    const centerRight = centerLeft + 1; // col 5

    // Pull left half rightward into empty columns toward centerLeft
    for (let target = centerLeft; target > 0; target--) {
      if (!isColEmpty(target)) continue;
      let source = -1;
      for (let s = target - 1; s >= 0; s--) {
        if (colHasLocked(s)) break; // don't shear across locked columns
        if (!isColEmpty(s)) {
          source = s;
          break;
        }
      }
      if (source !== -1) {
        for (let r = 0; r < rows; r++) {
          const tile = board[r]![source]!;
          if (tile) {
            board[r]![source] = null;
            tile.col = target;
            board[r]![target] = tile;
            moved.add(tile.id);
          }
        }
      }
    }

    // Pull right half leftward into empty columns toward centerRight
    for (let target = centerRight; target < cols - 1; target++) {
      if (!isColEmpty(target)) continue;
      let source = -1;
      for (let s = target + 1; s < cols; s++) {
        if (colHasLocked(s)) break;
        if (!isColEmpty(s)) {
          source = s;
          break;
        }
      }
      if (source !== -1) {
        for (let r = 0; r < rows; r++) {
          const tile = board[r]![source]!;
          if (tile) {
            board[r]![source] = null;
            tile.col = target;
            board[r]![target] = tile;
            moved.add(tile.id);
          }
        }
      }
    }

    return { movedTileIds: [...moved] };
  }

  /**
   * Overcharge blast expansion (GDD Page 3 & 7):
   * When `overcharged` is true, detonates with a radius of 1 in all 8 directions, any colour.
   */
  expandClear(
    board: (PulseTile | null)[][],
    groupTiles: readonly PulseTile[],
    overcharged: boolean,
    protectedTileIds: ReadonlySet<number>
  ): PulseTile[] {
    if (!overcharged) {
      return [...groupTiles];
    }

    const out = new Map<number, PulseTile>();
    for (const t of groupTiles) {
      out.set(t.id, t);
    }

    const radius = TUNING.OVERCHARGE_RADIUS;
    for (const t of groupTiles) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nb = board[t.row + dr]?.[t.col + dc];
          if (nb && !protectedTileIds.has(nb.id) && !out.has(nb.id)) {
            out.set(nb.id, nb);
          }
        }
      }
    }

    return [...out.values()];
  }

  /**
   * Canonical GDD Scoring Formula (Page 3):
   * group = GEM_BASE * size^1.35 * resonance * combo * air * overcharge
   */
  scoreGroup(_groupTiles: readonly PulseTile[], ctx: ScoreContext): number {
    const base = TUNING.GEM_BASE * Math.pow(ctx.size, TUNING.SIZE_EXP);
    const airFactor = ctx.airPrimed ? TUNING.AIR_MULT : 1.0;
    const overchargeFactor = ctx.overcharged ? TUNING.OVERCHARGE_MULT : 1.0;
    return Math.round(base * ctx.resonance * ctx.combo * airFactor * overchargeFactor);
  }

  tileView(tile: PulseTile): TileVisualDescriptor {
    return {
      colorIndex: tile.kind,
      materialId: this.material,
      shapeVariant: tile.kind % 5,
      special: tile.special
    };
  }
}
