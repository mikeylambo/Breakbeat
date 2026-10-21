/**
 * PulseEngine — The shared sweep/prime engine (GDD Pages 2–9).
 * Owns time, the grid, the sweepline, prime/hold/overcharge state, cascades, and scoring.
 * Strictly isolated from content folders: calls exclusively through ContentRules.
 */

import {
  TUNING,
  computeChainRank,
  computeComboMultiplier,
  computeResonanceMultiplier
} from '../tuning.js';
import { SeededRng } from './Rng.js';
import type {
  BestPassSnapshot,
  BestPassSnapshotCell,
  ContentRules,
  FallingMotion,
  PrimedGroup,
  PulseConfig,
  PulseEvent,
  PulseTile
} from './types.js';

export interface RunTelemetry {
  score: number;
  bestPassScore: number;
  bestPassGroups: number;
  longestCombo: number;
  groupsCleared: number;
  blocksCleared: number;
  overchargesLanded: number;
  airPrimesLanded: number;
  barsSurvived: number;
  pressurePushes: number;
  passesWithDetonation: number;
  groupsPerPassAvg: number;
  allClears: number;
  oneColourBonuses: number;
}

export class PulseEngine {
  readonly config: Required<Omit<PulseConfig, 'fixedDeal'>> & Pick<PulseConfig, 'fixedDeal'>;
  readonly rules: ContentRules;
  readonly board: (PulseTile | null)[][];
  readonly groups = new Map<number, PrimedGroup>();
  readonly falling = new Map<number, FallingMotion>();
  readonly events: PulseEvent[] = [];

  telemetry: RunTelemetry = {
    score: 0,
    bestPassScore: 0,
    bestPassGroups: 0,
    longestCombo: 0,
    groupsCleared: 0,
    blocksCleared: 0,
    overchargesLanded: 0,
    airPrimesLanded: 0,
    barsSurvived: 0,
    pressurePushes: 0,
    passesWithDetonation: 0,
    groupsPerPassAvg: 0,
    allClears: 0,
    oneColourBonuses: 0
  };

  currentStep = -1;
  currentBar = 0;
  comboPasses = 0;
  gameOver = false;
  gameOverReason: 'overflow' | 'detonator' | null = null;
  bestPassSnapshot: BestPassSnapshot | null = null;
  /** Overcharge meter 0..CHARGE_MAX; a hold spends a full meter. */
  charge = 0;
  /** Occupied rows among the top DANGER_ROWS rows (0 = safe). */
  dangerLevel = 0;
  /** Pressure rise is live (Overture keeps it off until lesson 3). */
  pressureEnabled: boolean;

  private rng: SeededRng;
  private nextTileId = 1;
  private nextGroupId = 1;
  private upcomingRow: PulseTile[] = [];
  private passPoints = 0;
  private passDetonations = 0;
  private passOvercharges = 0;
  private currentPassCells: BestPassSnapshotCell[] = [];
  private refillRowsPending = 0;
  private oneColourArmed = true;

  constructor(config: PulseConfig, rules: ContentRules) {
    this.rules = rules;
    this.config = {
      seed: config.seed,
      mode: config.mode,
      bpm: config.bpm,
      colorCount: config.colorCount ?? TUNING.GEM_COLORS_START,
      riseBars: config.riseBars ?? TUNING.RISE_BARS,
      pressureFrom: config.pressureFrom ?? TUNING.PRESSURE_FROM,
      pressureEnabled: config.pressureEnabled ?? true,
      fixedDeal: config.fixedDeal
    };
    this.pressureEnabled = this.config.pressureEnabled;

    this.rng = new SeededRng(this.config.seed);
    this.board = Array.from({ length: rules.rows }, () =>
      Array<PulseTile | null>(rules.cols).fill(null)
    );

    this.dealInitialWall();
    this.queueUpcomingRow();
  }

  get sixteenthSec(): number {
    return 60 / this.config.bpm / 4;
  }

  /** Combo passes as they will stand after the current pass is finalized on the next downbeat. */
  get projectedComboPasses(): number {
    return this.passDetonations > 0 ? this.comboPasses + 1 : 0;
  }

  get canHold(): boolean {
    return this.charge >= TUNING.CHARGE_MAX;
  }

  get chainRank(): number {
    return computeChainRank(this.comboPasses);
  }

  get activeHeldCount(): number {
    let count = 0;
    for (const g of this.groups.values()) {
      if (g.held) count++;
    }
    return count;
  }

  /** Effective pressure cadence (tightens from 2 bars to 1 after RISE_TIGHTEN_BAR). */
  get effectiveRiseBars(): number {
    if (this.config.mode === 'zen') return 0;
    if (this.currentBar >= TUNING.RISE_TIGHTEN_BAR) return 1;
    return this.config.riseBars;
  }

  /** Bars remaining until the next pressure row pushes in on a downbeat. */
  get barsUntilNextPush(): number | null {
    if (this.config.mode === 'zen' || !this.pressureEnabled) return null;
    const cadence = this.effectiveRiseBars;
    if (cadence <= 1) return 1;
    for (let nextBar = Math.max(2, this.currentBar + 1); nextBar <= this.currentBar + 6; nextBar++) {
      const c = nextBar >= TUNING.RISE_TIGHTEN_BAR ? 1 : this.config.riseBars;
      if ((nextBar - 1) % c === 0) {
        return Math.max(1, nextBar - Math.max(1, this.currentBar));
      }
    }
    return 1;
  }

  previewUpcomingRow(): readonly PulseTile[] {
    return this.upcomingRow;
  }

  private allocTileId = (): number => {
    return this.nextTileId++;
  };

  private dealInitialWall(): void {
    if (this.config.fixedDeal) {
      this.dealFixed(this.config.fixedDeal);
      return;
    }
    const { rows, cols, initialRows } = this.rules;
    const startRow = this.config.pressureFrom === 'bottom' ? rows - initialRows : 0;
    const endRow = this.config.pressureFrom === 'bottom' ? rows : initialRows;

    for (let r = startRow; r < endRow; r++) {
      const rowTiles = this.rules.spawnRow(this.rng, {
        cols,
        rows,
        bar: 0,
        mode: this.config.mode,
        colorCount: this.config.colorCount,
        board: this.board,
        allocTileId: this.allocTileId
      });
      for (let c = 0; c < cols; c++) {
        const tile = rowTiles[c]!;
        tile.col = c;
        tile.row = r;
        this.board[r]![c] = tile;
      }
    }
  }

  /**
   * Replaces the wall with a fixed layout (rows x cols kinds, -1 = empty). Used by the
   * Overture: lesson boards are authored deals, never RNG. Clears primed groups and falls.
   */
  dealFixed(layout: readonly (readonly number[])[]): void {
    const { rows, cols } = this.rules;
    this.groups.clear();
    this.falling.clear();
    const offset = rows - layout.length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const kind = r >= offset ? layout[r - offset]?.[c] ?? -1 : -1;
        this.board[r]![c] = kind < 0 ? null : { id: this.allocTileId(), col: c, row: r, kind, special: 'none' };
      }
    }
    this.oneColourArmed = true;
    this.updateDanger(Math.max(0, this.currentStep));
  }

  /**
   * Overture hook: the lesson logic (src/ui/overture/) decides when a lesson is complete;
   * the engine records it as a deterministic event. Completing lesson 3 starts pressure.
   */
  completeLesson(lesson: number): void {
    if (lesson >= 3) this.pressureEnabled = true;
    this.events.push({ type: 'lesson', lesson, step: Math.max(0, this.currentStep), bar: Math.max(1, this.currentBar) });
  }

  setPressureEnabled(on: boolean): void {
    this.pressureEnabled = on;
  }

  private queueUpcomingRow(): void {
    this.upcomingRow = this.rules.spawnRow(this.rng, {
      cols: this.rules.cols,
      rows: this.rules.rows,
      bar: Math.max(1, this.currentBar + 1),
      mode: this.config.mode,
      colorCount: this.config.colorCount,
      board: this.board,
      allocTileId: this.allocTileId
    });
  }

  /** Set of all tile IDs currently locked in any primed group. */
  getLockedTileIds(): Set<number> {
    const locked = new Set<number>();
    for (const g of this.groups.values()) {
      for (const id of g.tileIds) locked.add(id);
    }
    return locked;
  }

  findTileById(tileId: number): PulseTile | null {
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        if (t && t.id === tileId) return t;
      }
    }
    return null;
  }

  getGroupForTile(tileId: number): PrimedGroup | null {
    for (const g of this.groups.values()) {
      if (g.tileIds.includes(tileId)) return g;
    }
    return null;
  }

  /** True if the tile is currently in mid-air fall at `atElapsedSec`. */
  isTileFalling(tileId: number, atElapsedSec?: number): boolean {
    const motion = this.falling.get(tileId);
    if (!motion) return false;
    const nowSec = atElapsedSec ?? Math.max(0, this.currentStep) * this.sixteenthSec;
    const startSec = motion.startedStep * this.sixteenthSec;
    return nowSec - startSec < motion.durationSec;
  }

  /** Interpolated visual position `{ col, row, airborneProgress }` of a tile during cascades. */
  getInterpolatedTilePos(
    tile: PulseTile,
    atElapsedSec: number
  ): { col: number; row: number; airborne: boolean; progress: number } {
    const motion = this.falling.get(tile.id);
    if (!motion) {
      return { col: tile.col, row: tile.row, airborne: false, progress: 1 };
    }
    const startSec = motion.startedStep * this.sixteenthSec;
    const raw = (atElapsedSec - startSec) / motion.durationSec;
    if (raw >= 1) {
      return { col: tile.col, row: tile.row, airborne: false, progress: 1 };
    }
    const p = Math.max(0, Math.min(1, raw));
    // Readable gravity curve (slight ease-in then soft landing)
    const eased = 1 - Math.pow(1 - p, 2.6);
    return {
      col: motion.fromCol + (motion.toCol - motion.fromCol) * eased,
      row: motion.fromRow + (motion.toRow - motion.fromRow) * eased,
      airborne: true,
      progress: p
    };
  }

  private expireCompletedFalls(atElapsedSec: number): void {
    for (const [id, motion] of this.falling.entries()) {
      const startSec = motion.startedStep * this.sixteenthSec;
      if (atElapsedSec - startSec >= motion.durationSec) {
        this.falling.delete(id);
      }
    }
  }

  /**
   * Columns the blade has covered this pass. One column per 16th (BOARD_COLS === SIXTEENTHS_PER_BAR),
   * so after sixteenth s has been processed, columns 0..s are covered.
   */
  private currentSweepCoveredCols(): number {
    if (this.currentStep < 0 || this.currentBar <= 0) return 0;
    return (this.currentStep % TUNING.SIXTEENTHS_PER_BAR) + 1;
  }

  /**
   * Tap to prime (GDD Page 2):
   * - Tapping any orthogonally connected same-colour group of 2+ primes it and locks it.
   * - Never judged for timing (TIMING_FREE).
   * - If any member tile is mid-fall, it scores as an Air-Prime (x1.25) and locks immediately.
   */
  primeAt(col: number, row: number, atElapsedSec?: number): PrimedGroup | null {
    if (this.gameOver) return null;
    const locked = this.getLockedTileIds();
    const tapped = this.board[row]?.[col];
    if (!tapped || locked.has(tapped.id)) return null;

    const cluster = this.rules.primeable(this.board, col, row, locked);
    if (!cluster || cluster.length < TUNING.MIN_GROUP) return null;

    const tileIds = cluster.map(t => t.id);
    const anchorCol = Math.min(...cluster.map(t => t.col));
    const airPrimed = cluster.some(t => this.isTileFalling(t.id, atElapsedSec));

    // Lock falling tiles in place when air-primed
    for (const id of tileIds) {
      this.falling.delete(id);
    }

    // Ahead/behind rule (matches Lumines for squares the line is already crossing):
    // - primed while the blade is LEFT of the group's leftmost tile -> goes off this pass;
    // - primed while the blade is OVER or PAST any of its tiles -> queues for the next pass.
    // The blade is over column s during sixteenth s, so "ahead" means anchorCol > s.
    const activeBar = Math.max(1, this.currentBar);
    const sweepCovered = this.currentStep < 0 ? 0 : this.currentSweepCoveredCols();
    const aheadOfSweep = this.currentStep < 0 || anchorCol >= sweepCovered;

    const group: PrimedGroup = {
      id: this.nextGroupId++,
      tileIds,
      kind: cluster[0]!.kind,
      state: aheadOfSweep ? 'active' : 'queued',
      held: false,
      airPrimed,
      createdBar: activeBar,
      targetBar: aheadOfSweep ? activeBar : activeBar + 1,
      anchorCol
    };

    this.groups.set(group.id, group);
    if (airPrimed) {
      this.telemetry.airPrimesLanded++;
    }

    const sixteenth = Math.max(0, this.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    this.events.push({
      type: 'prime',
      groupId: group.id,
      tileIds: [...tileIds],
      kind: group.kind,
      airPrimed,
      step: Math.max(0, this.currentStep),
      bar: activeBar,
      sixteenth
    });

    return group;
  }

  /**
   * Hold (GDD Page 2-3):
   * Long-press a primed group (HOLD_MS 300) to hold it. A held group skips exactly one pass
   * that would have detonated it, then detonates Overcharged (8-way blast, x2) on the following
   * pass. That includes a group held while queued behind the blade: it skips its queued pass and
   * goes off the pass after, i.e. two passes after it was primed. A group can be held once.
   */
  holdAt(col: number, row: number): PrimedGroup | null {
    if (this.gameOver) return null;
    const tile = this.board[row]?.[col];
    if (!tile) return null;
    const group = this.getGroupForTile(tile.id);
    if (!group || group.held || this.charge < TUNING.CHARGE_MAX) return null;
    this.charge -= TUNING.CHARGE_MAX;

    group.held = true;
    group.state = 'held';
    // targetBar is untouched: a queued group still waits for its pass before that pass is skipped.

    const activeBar = Math.max(1, this.currentBar);
    const sixteenth = Math.max(0, this.currentStep) % TUNING.SIXTEENTHS_PER_BAR;
    this.events.push({
      type: 'hold',
      groupId: group.id,
      tileIds: [...group.tileIds],
      kind: group.kind,
      step: Math.max(0, this.currentStep),
      bar: activeBar,
      sixteenth
    });

    return group;
  }

  /**
   * Advances the simulation to `targetStep` (quantized 16th-note index).
   * Caps maximum catch-up steps at 32 (2 bars) to prevent tab-resume freezes.
   */
  advanceToStep(targetStep: number): void {
    if (this.gameOver) return;
    if (targetStep - this.currentStep > 32) {
      this.currentStep = targetStep - 16;
    }

    for (let step = this.currentStep + 1; step <= targetStep; step++) {
      this.currentStep = step;
      const stepSec = step * this.sixteenthSec;
      this.expireCompletedFalls(stepSec);

      const sixteenth = step % TUNING.SIXTEENTHS_PER_BAR;
      if (sixteenth === 0) {
        this.onMeasureDownbeat(step);
      }
      if (this.gameOver) break;

      this.onSixteenthSweep(step, sixteenth);
      if (this.gameOver) break;
    }
  }

  private onMeasureDownbeat(step: number): void {
    if (this.currentBar > 0) {
      this.finalizeMeasure();
    }

    this.currentBar++;
    this.telemetry.barsSurvived = this.currentBar;

    // Promote queued groups that are due on this measure
    for (const g of this.groups.values()) {
      if (g.state === 'queued' && g.targetBar <= this.currentBar) {
        g.state = 'active';
      }
    }

    if (this.refillRowsPending > 0) {
      // All Clear refill: deal rows from the upcoming-row queue, whatever the rise cadence.
      const n = this.refillRowsPending;
      this.refillRowsPending = 0;
      for (let i = 0; i < n && !this.gameOver; i++) this.pushPressureRow(step);
      if (this.gameOver) return;
    } else {
      // Check if a pressure row is due on this downbeat
      const cadence = this.effectiveRiseBars;
      const shouldPush =
        this.pressureEnabled &&
        this.config.mode !== 'zen' &&
        cadence > 0 &&
        this.currentBar > 1 &&
        (this.currentBar - 1) % cadence === 0;

      if (shouldPush) {
        this.pushPressureRow(step);
        if (this.gameOver) return;
      } else if (this.config.mode === 'zen' && this.currentBar > 1 && this.countBoardTiles() < 30) {
        this.pushPressureRow(step);
      }
    }
    this.updateDanger(step);

    // Capture board state at start of pass for Best-Pass Replay snapshot
    this.capturePassStartSnapshot();
  }

  private capturePassStartSnapshot(): void {
    this.currentPassCells = [];
    const primedIds = this.getLockedTileIds();
    const overchargeIds = new Set<number>();
    for (const g of this.groups.values()) {
      if (g.held) for (const id of g.tileIds) overchargeIds.add(id);
    }
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        if (!t) continue;
        this.currentPassCells.push({
          col: c,
          row: r,
          kind: t.kind,
          primed: primedIds.has(t.id),
          overcharged: overchargeIds.has(t.id),
          detonatedStep: null
        });
      }
    }
  }

  private finalizeMeasure(): void {
    if (this.passPoints > this.telemetry.bestPassScore) {
      this.telemetry.bestPassScore = this.passPoints;
      this.telemetry.bestPassGroups = this.passDetonations;
      this.bestPassSnapshot = {
        bar: this.currentBar,
        points: this.passPoints,
        groupsDetonated: this.passDetonations,
        overcharges: this.passOvercharges,
        cells: this.currentPassCells.map(cell => ({ ...cell }))
      };
    }

    if (this.passDetonations > 0) {
      this.telemetry.passesWithDetonation++;
      this.telemetry.groupsPerPassAvg = Number(
        (this.telemetry.groupsCleared / this.telemetry.passesWithDetonation).toFixed(3)
      );
      this.comboPasses++;
      if (this.comboPasses > this.telemetry.longestCombo) {
        this.telemetry.longestCombo = this.comboPasses;
      }
    } else {
      this.comboPasses = 0;
    }

    this.passPoints = 0;
    this.passDetonations = 0;
    this.passOvercharges = 0;
  }

  private pushPressureRow(step: number): void {
    const { rows, cols } = this.rules;

    // Tick down any remix detonators before pushing
    if (this.config.mode === 'remix') {
      const locked = this.getLockedTileIds();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const t = this.board[r]![c];
          if (t && t.special === 'detonator' && !locked.has(t.id)) {
            t.timerBars = (t.timerBars ?? 4) - 1;
            if (t.timerBars <= 0) {
              this.gameOver = true;
              this.gameOverReason = 'detonator';
              this.events.push({ type: 'gameover', reason: 'detonator', step, bar: this.currentBar, sixteenth: 0 });
              return;
            }
          }
        }
      }
    }

    if (this.config.pressureFrom === 'bottom') {
      // Check danger line (top row y === 0): if any block occupies row 0, pushing overflows the wall!
      if (this.board[0]!.some(t => t !== null)) {
        this.gameOver = true;
        this.gameOverReason = 'overflow';
        this.events.push({ type: 'gameover', reason: 'overflow', step, bar: this.currentBar, sixteenth: 0 });
        return;
      }

      // Shift all rows up by 1
      for (let r = 0; r < rows - 1; r++) {
        this.board[r] = this.board[r + 1]!;
        for (let c = 0; c < cols; c++) {
          const t = this.board[r]![c];
          if (t) t.row = r;
        }
      }

      // Insert upcoming row at bottom (rows - 1)
      this.board[rows - 1] = Array<PulseTile | null>(cols).fill(null);
      for (let c = 0; c < cols; c++) {
        const incoming = this.upcomingRow[c]!;
        incoming.col = c;
        incoming.row = rows - 1;
        this.board[rows - 1]![c] = incoming;
      }
    } else {
      // Top-down pressure alternative
      if (this.board[rows - 1]!.some(t => t !== null)) {
        this.gameOver = true;
        this.gameOverReason = 'overflow';
        this.events.push({ type: 'gameover', reason: 'overflow', step, bar: this.currentBar, sixteenth: 0 });
        return;
      }
      for (let r = rows - 1; r > 0; r--) {
        this.board[r] = this.board[r - 1]!;
        for (let c = 0; c < cols; c++) {
          const t = this.board[r]![c];
          if (t) t.row = r;
        }
      }
      this.board[0] = Array<PulseTile | null>(cols).fill(null);
      for (let c = 0; c < cols; c++) {
        const incoming = this.upcomingRow[c]!;
        incoming.col = c;
        incoming.row = 0;
        this.board[0]![c] = incoming;
      }
    }

    this.telemetry.pressurePushes++;
    // A new row can bring a new colour in: re-arm One Colour Left.
    if (!this.oneColourArmed && this.distinctKinds() > 1) this.oneColourArmed = true;
    this.events.push({
      type: 'pressure',
      rowKinds: this.upcomingRow.map(t => t.kind),
      step,
      bar: this.currentBar,
      sixteenth: 0
    });
    this.queueUpcomingRow();
  }

  private onSixteenthSweep(step: number, sixteenth: number): void {
    // Sweep grid: the blade is over column `sixteenth`, so columns 0..sixteenth are covered.
    const coveredCols = sixteenth + 1;
    const readyToDetonate: PrimedGroup[] = [];

    for (const g of this.groups.values()) {
      // Not due yet (queued behind the blade, or overcharging for its next pass)
      if (g.targetBar > this.currentBar) continue;

      const liveTiles = g.tileIds
        .map(id => this.findTileById(id))
        .filter((t): t is PulseTile => t !== null);

      if (liveTiles.length < TUNING.MIN_GROUP) {
        this.groups.delete(g.id);
        continue;
      }

      const minCol = Math.min(...liveTiles.map(t => t.col));
      g.anchorCol = minCol;
      if (minCol >= coveredCols) continue;

      // Held group: first sweep crosses it without detonating and charges it into 'overcharged' for the next pass!
      if (g.state === 'held') {
        g.state = 'overcharged';
        g.targetBar = this.currentBar + 1;
        continue;
      }

      readyToDetonate.push(g);
    }

    if (readyToDetonate.length === 0) {
      this.updateDanger(step);
      return;
    }

    // Sort left-to-right, top-to-bottom for deterministic order
    readyToDetonate.sort((a, b) => a.anchorCol - b.anchorCol || a.id - b.id);

    const detonatingGroupIds = new Set(readyToDetonate.map(g => g.id));
    const protectedTileIds = new Set<number>();
    for (const g of this.groups.values()) {
      if (!detonatingGroupIds.has(g.id)) {
        for (const id of g.tileIds) protectedTileIds.add(id);
      }
    }

    const removedIds = new Set<number>();

    for (const g of readyToDetonate) {
      const liveTiles = g.tileIds
        .map(id => this.findTileById(id))
        .filter((t): t is PulseTile => t !== null);

      const isOvercharged = g.held && g.state === 'overcharged';
      const expandedTiles = this.rules.expandClear(
        this.board,
        liveTiles,
        isOvercharged,
        protectedTileIds
      );

      this.passDetonations++;
      if (!isOvercharged) {
        const gain = TUNING.CHARGE_PER_GROUP + (this.passDetonations > 1 ? TUNING.CHARGE_RESONANCE_BONUS : 0);
        this.charge = Math.min(TUNING.CHARGE_MAX, this.charge + gain);
      }
      if (isOvercharged) {
        this.passOvercharges++;
        this.telemetry.overchargesLanded++;
      }

      const resonance = computeResonanceMultiplier(this.passDetonations);
      const combo = computeComboMultiplier(this.comboPasses);
      const points = this.rules.scoreGroup(expandedTiles, {
        size: expandedTiles.length,
        resonance,
        combo,
        airPrimed: g.airPrimed,
        overcharged: isOvercharged
      });

      this.telemetry.score += points;
      this.passPoints += points;
      this.telemetry.groupsCleared++;
      this.telemetry.blocksCleared += expandedTiles.length;

      const blastedTileIds = expandedTiles
        .map(t => t.id)
        .filter(id => !g.tileIds.includes(id));

      for (const t of expandedTiles) {
        removedIds.add(t.id);
        const snap = this.currentPassCells.find(c => c.col === t.col && c.row === t.row);
        if (snap && snap.detonatedStep === null) {
          snap.detonatedStep = sixteenth;
        }
      }

      this.events.push({
        type: 'detonate',
        groupId: g.id,
        tileIds: [...g.tileIds],
        blastedTileIds,
        cells: expandedTiles.map(t => ({ col: t.col, row: t.row, kind: t.kind })),
        kind: g.kind,
        points,
        overcharged: isOvercharged,
        airPrimed: g.airPrimed,
        resonanceCount: this.passDetonations,
        combo,
        step,
        bar: this.currentBar,
        sixteenth
      });

      this.groups.delete(g.id);
    }

    // Record pre-collapse positions for smooth, readable cascades
    const stepSec = step * this.sixteenthSec;
    const prePositions = new Map<number, { col: number; row: number; kind: number }>();
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        if (!t) continue;
        if (removedIds.has(t.id)) {
          this.board[r]![c] = null;
          this.falling.delete(t.id);
        } else {
          const interp = this.getInterpolatedTilePos(t, stepSec);
          prePositions.set(t.id, { col: interp.col, row: interp.row, kind: t.kind });
        }
      }
    }

    // Run ContentRules.collapse(board) while protecting remaining locked groups
    const remainingLocked = this.getLockedTileIds();
    const { movedTileIds } = this.rules.collapse(this.board, remainingLocked);

    if (movedTileIds.length > 0) {
      for (const id of movedTileIds) {
        const tile = this.findTileById(id);
        const prev = prePositions.get(id);
        if (tile && prev) {
          this.falling.set(id, {
            tileId: id,
            kind: tile.kind,
            fromCol: prev.col,
            fromRow: prev.row,
            toCol: tile.col,
            toRow: tile.row,
            startedStep: step,
            durationSec: TUNING.FALL_DURATION_SEC
          });
        }
      }

      this.events.push({
        type: 'cascade',
        movedTileIds,
        step,
        bar: this.currentBar,
        sixteenth
      });
    }

    this.checkWallStateBonuses(step);
    this.updateDanger(step);
  }

  /** All Clear / One Colour Left, evaluated after a 16th's detonations and collapse. */
  private checkWallStateBonuses(step: number): void {
    const combo = computeComboMultiplier(this.comboPasses);
    let count = 0;
    let kind = -1;
    let mixed = false;
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        if (!t) continue;
        count++;
        if (kind === -1) kind = t.kind;
        else if (t.kind !== kind) mixed = true;
      }
    }

    if (count === 0) {
      const points = Math.round(TUNING.ALL_CLEAR_BONUS * combo);
      this.telemetry.score += points;
      this.passPoints += points;
      this.telemetry.allClears++;
      this.refillRowsPending = TUNING.ALL_CLEAR_REFILL_ROWS;
      this.oneColourArmed = true;
      this.events.push({ type: 'allclear', points, step, bar: this.currentBar });
      return;
    }

    if (!mixed && this.oneColourArmed) {
      this.oneColourArmed = false;
      const points = Math.round(TUNING.ONE_COLOUR_BONUS * combo);
      this.telemetry.score += points;
      this.passPoints += points;
      this.telemetry.oneColourBonuses++;
      this.events.push({ type: 'onecolour', points, kind, step, bar: this.currentBar });
    }
  }

  private distinctKinds(): number {
    let first = -1;
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        if (!t) continue;
        if (first === -1) first = t.kind;
        else if (t.kind !== first) return 2;
      }
    }
    return first === -1 ? 0 : 1;
  }

  private computeDangerLevel(): number {
    const pressureBottom = this.config.pressureFrom === 'bottom';
    let level = 0;
    for (let i = 0; i < TUNING.DANGER_ROWS; i++) {
      const r = pressureBottom ? i : this.rules.rows - 1 - i;
      const row = this.board[r]!;
      for (let c = 0; c < this.rules.cols; c++) {
        if (row[c]) {
          level++;
          break;
        }
      }
    }
    return level;
  }

  private updateDanger(step: number): void {
    const level = this.computeDangerLevel();
    if (level !== this.dangerLevel) {
      this.dangerLevel = level;
      this.events.push({ type: 'danger', level, step, bar: Math.max(1, this.currentBar) });
    }
  }

  countBoardTiles(): number {
    let count = 0;
    for (let r = 0; r < this.rules.rows; r++) {
      for (let c = 0; c < this.rules.cols; c++) {
        if (this.board[r]![c]) count++;
      }
    }
    return count;
  }

  /** Serializes board state for byte-identical determinism verification. */
  serializeWall(): string {
    const rows: string[] = [];
    for (let r = 0; r < this.rules.rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c < this.rules.cols; c++) {
        const t = this.board[r]![c];
        cells.push(t ? `${t.kind}${t.special !== 'none' ? '*' : ''}` : '.');
      }
      rows.push(cells.join(''));
    }
    return rows.join('/');
  }

  drainEvents(): PulseEvent[] {
    const out = this.events.splice(0, this.events.length);
    return out;
  }
}
