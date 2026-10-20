/**
 * Pulse Core — Content-agnostic interfaces (GDD Page 7-8).
 * Pulse owns time, the grid, the sweep, and the score pipeline;
 * everything that says what a tile IS sits behind ContentRules.
 */

import type { GameMode, PressureDirection } from '../tuning.js';
import type { SeededRng } from './Rng.js';

export type SpecialMutation = 'none' | 'wildcard' | 'hazard' | 'detonator';

export interface PulseTile {
  id: number;
  col: number;
  row: number;
  /** Content payload: color index (0..4) in Breakbeat, or letter in Word game */
  kind: number;
  special: SpecialMutation;
  timerBars?: number;
}

export type GroupLifecycle = 'queued' | 'active' | 'held' | 'overcharged';

export interface PrimedGroup {
  id: number;
  tileIds: number[];
  kind: number;
  state: GroupLifecycle;
  held: boolean;
  airPrimed: boolean;
  createdBar: number;
  targetBar: number;
  anchorCol: number;
}

export interface FallingMotion {
  tileId: number;
  kind: number;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  startedStep: number;
  durationSec: number;
}

export interface TileVisualDescriptor {
  colorIndex: number;
  materialId: string;
  shapeVariant: number;
  special: SpecialMutation;
}

export interface SpawnContext {
  cols: number;
  rows: number;
  bar: number;
  mode: GameMode;
  colorCount: number;
  board: (PulseTile | null)[][];
  allocTileId: () => number;
}

export interface ScoreContext {
  size: number;
  resonance: number;
  combo: number;
  airPrimed: boolean;
  overcharged: boolean;
}

export interface CollapseResult {
  movedTileIds: number[];
}

/**
 * The canonical GDD ContentRules interface (Page 7-8).
 * PulseEngine calls through this interface and never imports src/content/.
 */
export interface ContentRules {
  readonly gesture: 'tap-prime-hold' | 'trace-prime-hold';
  readonly cols: number;
  readonly rows: number;
  readonly initialRows: number;

  spawnRow(rng: SeededRng, ctx: SpawnContext): PulseTile[];
  primeable(
    board: (PulseTile | null)[][],
    col: number,
    row: number,
    lockedTileIds: ReadonlySet<number>
  ): PulseTile[] | null;
  collapse(
    board: (PulseTile | null)[][],
    lockedTileIds: ReadonlySet<number>
  ): CollapseResult;
  expandClear(
    board: (PulseTile | null)[][],
    groupTiles: readonly PulseTile[],
    overcharged: boolean,
    protectedTileIds: ReadonlySet<number>
  ): PulseTile[];
  scoreGroup(groupTiles: readonly PulseTile[], ctx: ScoreContext): number;
  tileView(tile: PulseTile): TileVisualDescriptor;
}

export interface BestPassSnapshotCell {
  col: number;
  row: number;
  kind: number;
  primed: boolean;
  overcharged: boolean;
  detonatedStep: number | null;
}

export interface BestPassSnapshot {
  bar: number;
  points: number;
  groupsDetonated: number;
  overcharges: number;
  cells: BestPassSnapshotCell[];
}

export type PulseEvent =
  | {
      type: 'prime';
      groupId: number;
      tileIds: number[];
      kind: number;
      airPrimed: boolean;
      step: number;
      bar: number;
      sixteenth: number;
    }
  | {
      type: 'hold';
      groupId: number;
      tileIds: number[];
      kind: number;
      step: number;
      bar: number;
      sixteenth: number;
    }
  | {
      type: 'detonate';
      groupId: number;
      tileIds: number[];
      blastedTileIds: number[];
      cells: { col: number; row: number; kind: number }[];
      kind: number;
      points: number;
      overcharged: boolean;
      airPrimed: boolean;
      resonanceCount: number;
      combo: number;
      step: number;
      bar: number;
      sixteenth: number;
    }
  | {
      type: 'cascade';
      movedTileIds: number[];
      step: number;
      bar: number;
      sixteenth: number;
    }
  | {
      type: 'pressure';
      rowKinds: number[];
      step: number;
      bar: number;
      sixteenth: number;
    }
  | {
      type: 'allclear';
      points: number;
      step: number;
      bar: number;
    }
  | {
      type: 'onecolour';
      points: number;
      kind: number;
      step: number;
      bar: number;
    }
  | {
      type: 'danger';
      level: number;
      step: number;
      bar: number;
    }
  | {
      type: 'lesson';
      lesson: number;
      step: number;
      bar: number;
    }
  | {
      type: 'gameover';
      reason: 'overflow' | 'detonator';
      step: number;
      bar: number;
      sixteenth: number;
    };

export interface PulseConfig {
  seed: string;
  mode: GameMode;
  bpm: number;
  colorCount?: number;
  riseBars?: number;
  pressureFrom?: PressureDirection;
  /**
   * Fixed deal (Overture): rows x cols of tile kinds, -1 = empty. When present the
   * initial wall comes from this layout instead of the RNG.
   */
  fixedDeal?: number[][];
  /** Pressure rows rise only while enabled (Overture enables them at lesson 3). Default true. */
  pressureEnabled?: boolean;
}
