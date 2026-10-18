/**
 * PulseEngine — The shared sweep/prime engine (GDD Pages 2–9).
 * Owns time, the grid, the sweepline, prime/hold/overcharge state, cascades, and scoring.
 * Strictly isolated from content folders: calls exclusively through ContentRules.
 */
import { TUNING, computeChainRank, computeComboMultiplier, computeResonanceMultiplier } from '../tuning.js';
import { SeededRng } from './Rng.js';
export class PulseEngine {
    config;
    rules;
    board;
    groups = new Map();
    falling = new Map();
    events = [];
    telemetry = {
        score: 0,
        bestPassScore: 0,
        bestPassGroups: 0,
        longestCombo: 0,
        groupsCleared: 0,
        blocksCleared: 0,
        overchargesLanded: 0,
        airPrimesLanded: 0,
        barsSurvived: 0,
        pressurePushes: 0
    };
    currentStep = -1;
    currentBar = 0;
    comboPasses = 0;
    gameOver = false;
    gameOverReason = null;
    bestPassSnapshot = null;
    rng;
    nextTileId = 1;
    nextGroupId = 1;
    upcomingRow = [];
    passPoints = 0;
    passDetonations = 0;
    passOvercharges = 0;
    currentPassCells = [];
    constructor(config, rules) {
        this.rules = rules;
        this.config = {
            seed: config.seed,
            mode: config.mode,
            bpm: config.bpm,
            colorCount: config.colorCount ?? TUNING.GEM_COLORS_START,
            riseBars: config.riseBars ?? TUNING.RISE_BARS,
            pressureFrom: config.pressureFrom ?? TUNING.PRESSURE_FROM
        };
        this.rng = new SeededRng(this.config.seed);
        this.board = Array.from({ length: rules.rows }, () => Array(rules.cols).fill(null));
        this.dealInitialWall();
        this.queueUpcomingRow();
    }
    get sixteenthSec() {
        return 60 / this.config.bpm / 4;
    }
    get chainRank() {
        return computeChainRank(this.comboPasses);
    }
    get activeHeldCount() {
        let count = 0;
        for (const g of this.groups.values()) {
            if (g.held)
                count++;
        }
        return count;
    }
    /** Effective pressure cadence (tightens from 2 bars to 1 after RISE_TIGHTEN_BAR). */
    get effectiveRiseBars() {
        if (this.config.mode === 'zen')
            return 0;
        if (this.currentBar >= TUNING.RISE_TIGHTEN_BAR)
            return 1;
        return this.config.riseBars;
    }
    /** Bars remaining until the next pressure row pushes in on a downbeat. */
    get barsUntilNextPush() {
        if (this.config.mode === 'zen')
            return null;
        const cadence = this.effectiveRiseBars;
        if (cadence <= 1)
            return 1;
        for (let nextBar = Math.max(2, this.currentBar + 1); nextBar <= this.currentBar + 6; nextBar++) {
            const c = nextBar >= TUNING.RISE_TIGHTEN_BAR ? 1 : this.config.riseBars;
            if ((nextBar - 1) % c === 0) {
                return Math.max(1, nextBar - Math.max(1, this.currentBar));
            }
        }
        return 1;
    }
    previewUpcomingRow() {
        return this.upcomingRow;
    }
    allocTileId = () => {
        return this.nextTileId++;
    };
    dealInitialWall() {
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
                const tile = rowTiles[c];
                tile.col = c;
                tile.row = r;
                this.board[r][c] = tile;
            }
        }
    }
    queueUpcomingRow() {
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
    getLockedTileIds() {
        const locked = new Set();
        for (const g of this.groups.values()) {
            for (const id of g.tileIds)
                locked.add(id);
        }
        return locked;
    }
    findTileById(tileId) {
        for (let r = 0; r < this.rules.rows; r++) {
            for (let c = 0; c < this.rules.cols; c++) {
                const t = this.board[r][c];
                if (t && t.id === tileId)
                    return t;
            }
        }
        return null;
    }
    getGroupForTile(tileId) {
        for (const g of this.groups.values()) {
            if (g.tileIds.includes(tileId))
                return g;
        }
        return null;
    }
    /** True if the tile is currently in mid-air fall at `atElapsedSec`. */
    isTileFalling(tileId, atElapsedSec) {
        const motion = this.falling.get(tileId);
        if (!motion)
            return false;
        const nowSec = atElapsedSec ?? Math.max(0, this.currentStep) * this.sixteenthSec;
        const startSec = motion.startedStep * this.sixteenthSec;
        return nowSec - startSec < motion.durationSec;
    }
    /** Interpolated visual position `{ col, row, airborneProgress }` of a tile during cascades. */
    getInterpolatedTilePos(tile, atElapsedSec) {
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
    expireCompletedFalls(atElapsedSec) {
        for (const [id, motion] of this.falling.entries()) {
            const startSec = motion.startedStep * this.sixteenthSec;
            if (atElapsedSec - startSec >= motion.durationSec) {
                this.falling.delete(id);
            }
        }
    }
    /** Current sweep column boundary `[0..BOARD_COLS]` based on quantized step. */
    currentSweepCoveredCols() {
        if (this.currentStep < 0 || this.currentBar <= 0)
            return 0;
        const sixteenth = this.currentStep % TUNING.SIXTEENTHS_PER_BAR;
        return ((sixteenth + 1) * this.rules.cols) / TUNING.SIXTEENTHS_PER_BAR;
    }
    /**
     * Tap to prime (GDD Page 2):
     * - Tapping any orthogonally connected same-colour group of 2+ primes it and locks it.
     * - Never judged for timing (TIMING_FREE).
     * - If any member tile is mid-fall, it scores as an Air-Prime (x1.25) and locks immediately.
     */
    primeAt(col, row, atElapsedSec) {
        if (this.gameOver)
            return null;
        const locked = this.getLockedTileIds();
        const tapped = this.board[row]?.[col];
        if (!tapped || locked.has(tapped.id))
            return null;
        const cluster = this.rules.primeable(this.board, col, row, locked);
        if (!cluster || cluster.length < TUNING.MIN_GROUP)
            return null;
        const tileIds = cluster.map(t => t.id);
        const anchorCol = Math.min(...cluster.map(t => t.col));
        const airPrimed = cluster.some(t => this.isTileFalling(t.id, atElapsedSec));
        // Lock falling tiles in place when air-primed
        for (const id of tileIds) {
            this.falling.delete(id);
        }
        const activeBar = Math.max(1, this.currentBar);
        const sweepCovered = this.currentStep < 0 ? 0 : this.currentSweepCoveredCols();
        const aheadOfSweep = this.currentStep < 0 || anchorCol >= sweepCovered;
        const group = {
            id: this.nextGroupId++,
            tileIds,
            kind: cluster[0].kind,
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
     * Long-press a primed group (HOLD_MS 300) to hold it: the next pass crosses it without
     * detonating, and the pass after that detonates it Overcharged (8-way blast, x2 score).
     * A group can be held once.
     */
    holdAt(col, row) {
        if (this.gameOver)
            return null;
        const tile = this.board[row]?.[col];
        if (!tile)
            return null;
        const group = this.getGroupForTile(tile.id);
        if (!group || group.held)
            return null;
        group.held = true;
        group.state = 'held';
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
    advanceToStep(targetStep) {
        if (this.gameOver)
            return;
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
            if (this.gameOver)
                break;
            this.onSixteenthSweep(step, sixteenth);
            if (this.gameOver)
                break;
        }
    }
    onMeasureDownbeat(step) {
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
        // Check if a pressure row is due on this downbeat
        const cadence = this.effectiveRiseBars;
        const shouldPush = this.config.mode !== 'zen' &&
            cadence > 0 &&
            this.currentBar > 1 &&
            (this.currentBar - 1) % cadence === 0;
        if (shouldPush) {
            this.pushPressureRow(step);
            if (this.gameOver)
                return;
        }
        else if (this.config.mode === 'zen' && this.currentBar > 1 && this.countBoardTiles() < 30) {
            this.pushPressureRow(step);
        }
        // Capture board state at start of pass for Best-Pass Replay snapshot
        this.capturePassStartSnapshot();
    }
    capturePassStartSnapshot() {
        this.currentPassCells = [];
        const primedIds = this.getLockedTileIds();
        const overchargeIds = new Set();
        for (const g of this.groups.values()) {
            if (g.held)
                for (const id of g.tileIds)
                    overchargeIds.add(id);
        }
        for (let r = 0; r < this.rules.rows; r++) {
            for (let c = 0; c < this.rules.cols; c++) {
                const t = this.board[r][c];
                if (!t)
                    continue;
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
    finalizeMeasure() {
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
            this.comboPasses++;
            if (this.comboPasses > this.telemetry.longestCombo) {
                this.telemetry.longestCombo = this.comboPasses;
            }
        }
        else {
            this.comboPasses = 0;
        }
        this.passPoints = 0;
        this.passDetonations = 0;
        this.passOvercharges = 0;
    }
    pushPressureRow(step) {
        const { rows, cols } = this.rules;
        // Tick down any remix detonators before pushing
        if (this.config.mode === 'remix') {
            const locked = this.getLockedTileIds();
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const t = this.board[r][c];
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
            if (this.board[0].some(t => t !== null)) {
                this.gameOver = true;
                this.gameOverReason = 'overflow';
                this.events.push({ type: 'gameover', reason: 'overflow', step, bar: this.currentBar, sixteenth: 0 });
                return;
            }
            // Shift all rows up by 1
            for (let r = 0; r < rows - 1; r++) {
                this.board[r] = this.board[r + 1];
                for (let c = 0; c < cols; c++) {
                    const t = this.board[r][c];
                    if (t)
                        t.row = r;
                }
            }
            // Insert upcoming row at bottom (rows - 1)
            this.board[rows - 1] = Array(cols).fill(null);
            for (let c = 0; c < cols; c++) {
                const incoming = this.upcomingRow[c];
                incoming.col = c;
                incoming.row = rows - 1;
                this.board[rows - 1][c] = incoming;
            }
        }
        else {
            // Top-down pressure alternative
            if (this.board[rows - 1].some(t => t !== null)) {
                this.gameOver = true;
                this.gameOverReason = 'overflow';
                this.events.push({ type: 'gameover', reason: 'overflow', step, bar: this.currentBar, sixteenth: 0 });
                return;
            }
            for (let r = rows - 1; r > 0; r--) {
                this.board[r] = this.board[r - 1];
                for (let c = 0; c < cols; c++) {
                    const t = this.board[r][c];
                    if (t)
                        t.row = r;
                }
            }
            this.board[0] = Array(cols).fill(null);
            for (let c = 0; c < cols; c++) {
                const incoming = this.upcomingRow[c];
                incoming.col = c;
                incoming.row = 0;
                this.board[0][c] = incoming;
            }
        }
        this.telemetry.pressurePushes++;
        this.events.push({
            type: 'pressure',
            rowKinds: this.upcomingRow.map(t => t.kind),
            step,
            bar: this.currentBar,
            sixteenth: 0
        });
        this.queueUpcomingRow();
    }
    onSixteenthSweep(step, sixteenth) {
        const coveredCols = ((sixteenth + 1) * this.rules.cols) / TUNING.SIXTEENTHS_PER_BAR;
        const readyToDetonate = [];
        for (const g of this.groups.values()) {
            if (g.state === 'queued' && g.targetBar > this.currentBar)
                continue;
            if (g.state === 'overcharged' && g.targetBar > this.currentBar)
                continue;
            const liveTiles = g.tileIds
                .map(id => this.findTileById(id))
                .filter((t) => t !== null);
            if (liveTiles.length < TUNING.MIN_GROUP) {
                this.groups.delete(g.id);
                continue;
            }
            const minCol = Math.min(...liveTiles.map(t => t.col));
            g.anchorCol = minCol;
            if (minCol >= coveredCols)
                continue;
            // Held group: first sweep crosses it without detonating and charges it into 'overcharged' for the next pass!
            if (g.state === 'held') {
                g.state = 'overcharged';
                g.targetBar = this.currentBar + 1;
                continue;
            }
            readyToDetonate.push(g);
        }
        if (readyToDetonate.length === 0)
            return;
        // Sort left-to-right, top-to-bottom for deterministic order
        readyToDetonate.sort((a, b) => a.anchorCol - b.anchorCol || a.id - b.id);
        const detonatingGroupIds = new Set(readyToDetonate.map(g => g.id));
        const protectedTileIds = new Set();
        for (const g of this.groups.values()) {
            if (!detonatingGroupIds.has(g.id)) {
                for (const id of g.tileIds)
                    protectedTileIds.add(id);
            }
        }
        const removedIds = new Set();
        for (const g of readyToDetonate) {
            const liveTiles = g.tileIds
                .map(id => this.findTileById(id))
                .filter((t) => t !== null);
            const isOvercharged = g.held && g.state === 'overcharged';
            const expandedTiles = this.rules.expandClear(this.board, liveTiles, isOvercharged, protectedTileIds);
            this.passDetonations++;
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
        const prePositions = new Map();
        for (let r = 0; r < this.rules.rows; r++) {
            for (let c = 0; c < this.rules.cols; c++) {
                const t = this.board[r][c];
                if (!t)
                    continue;
                if (removedIds.has(t.id)) {
                    this.board[r][c] = null;
                    this.falling.delete(t.id);
                }
                else {
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
    }
    countBoardTiles() {
        let count = 0;
        for (let r = 0; r < this.rules.rows; r++) {
            for (let c = 0; c < this.rules.cols; c++) {
                if (this.board[r][c])
                    count++;
            }
        }
        return count;
    }
    /** Serializes board state for byte-identical determinism verification. */
    serializeWall() {
        const rows = [];
        for (let r = 0; r < this.rules.rows; r++) {
            const cells = [];
            for (let c = 0; c < this.rules.cols; c++) {
                const t = this.board[r][c];
                cells.push(t ? `${t.kind}${t.special !== 'none' ? '*' : ''}` : '.');
            }
            rows.push(cells.join(''));
        }
        return rows.join('/');
    }
    drainEvents() {
        const out = this.events.splice(0, this.events.length);
        return out;
    }
}
