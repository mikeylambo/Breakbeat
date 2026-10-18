import { DeterministicRng, stableHashString } from '../shell/DeterministicRNG.js';
import { T, resonance } from '../tuning.js';
import { pressureCadence, pressureForecast } from './Balance.js';
import { challengeState } from './Challenges.js';
/** Entirely deterministic game rules. No DOM, WebAudio or presentation dependencies. */
export class Pulse {
    config;
    rules;
    board = [];
    groups = new Map();
    stats = { score: 0, bestPass: 0, longestCombo: 0, overcharges: 0, airPrimes: 0, groups: 0, passes: 0, pressureRows: 0, maxPassGroups: 0, overchargeTiles: 0 };
    pass = 0;
    step = -1;
    combo = 0;
    over = false;
    events = [];
    flight = null;
    rng;
    nextTile = 1;
    nextGroup = 1;
    passScore = 0;
    passKills = 0;
    pressureDebt = false;
    get nextPressureBars() { return pressureForecast(this.config.mode, this.pass, this.config.skinLevel); }
    previewNextRow() { return this.rules.spawnRow(new DeterministicRng(this.rng.state), T.BOARD_COLS); }
    get challengeProgress() { return this.config.mode === 'endless' ? challengeState(this.config.challenge, this.stats) : null; }
    constructor(config, rules) {
        this.config = config;
        this.rules = rules;
        this.rng = new DeterministicRng(stableHashString(config.seed));
        this.board = Array.from({ length: T.BOARD_ROWS }, () => Array(T.BOARD_COLS).fill(null));
        const rows = this.rng.int(T.INIT_MIN_ROWS, T.INIT_MAX_ROWS);
        for (let y = T.BOARD_ROWS - rows; y < T.BOARD_ROWS; y++)
            this.fillRow(y);
        this.ensurePairs();
    }
    get stepSeconds() { return 60 / this.config.bpm / 4; }
    makeTile(x, y, type) { return { id: this.nextTile++, x, y, type, group: null }; }
    fillRow(y) {
        const types = this.rules.spawnRow(this.rng, T.BOARD_COLS);
        types.forEach((type, x) => this.board[y][x] = this.makeTile(x, y, type));
        return types;
    }
    ensurePairs() {
        if (!this.hasPrimeable()) {
            const b = this.board[T.BOARD_ROWS - 1];
            if (b[0] && b[1])
                b[1].type = b[0].type;
        }
    }
    hasPrimeable() {
        for (let y = 0; y < T.BOARD_ROWS; y++)
            for (let x = 0; x < T.BOARD_COLS; x++)
                if (this.rules.primeable(this.board, x, y).length)
                    return true;
        return false;
    }
    getTile(id) {
        for (const row of this.board)
            for (const t of row)
                if (t?.id === id)
                    return t;
        return undefined;
    }
    /**
     * Prime a group at (x, y).
     * - Never locks out the board during cascades.
     * - If the group is ahead of the sweepline on the current pass, it becomes active immediately
     *   so the approaching sweepline detonates it on this pass.
     * - If the sweepline has already passed the group's left edge on this bar, it queues for the next bar.
     */
    prime(x, y, air = false) {
        if (this.over)
            return null;
        if (air)
            return this.primeAir(x, y, Math.max(0, this.step) * this.stepSeconds);
        const ids = this.rules.primeable(this.board, x, y);
        if (!ids.length)
            return null;
        const isMidAir = !!this.flight && this.flight.tiles.some(f => f.moved && ids.includes(f.id));
        return this.queueGroup(ids, isMidAir);
    }
    currentCoveredColumns() {
        if (this.step < 0 || this.pass <= 0)
            return 0;
        const substep = this.step % T.SIXTEENTHS;
        return ((substep + 1) * T.BOARD_COLS) / T.SIXTEENTHS;
    }
    queueGroup(ids, air) {
        const id = this.nextGroup++;
        const firstTile = this.getTile(ids[0]);
        const type = firstTile.type;
        let minX = T.BOARD_COLS;
        for (const tileId of ids) {
            const tile = this.getTile(tileId);
            if (tile) {
                tile.group = id;
                if (tile.x < minX)
                    minX = tile.x;
            }
        }
        if (this.flight) {
            for (const f of this.flight.tiles)
                if (ids.includes(f.id))
                    f.group = id;
        }
        // If primed ahead of the sweepline during an active pass, the approaching sweep takes it on THIS pass!
        const covered = this.currentCoveredColumns();
        const aheadOfSweep = this.pass >= 1 && minX >= covered;
        const readyPass = aheadOfSweep ? this.pass : Math.max(1, this.pass + 1);
        const state = air ? 'airborne' : (aheadOfSweep ? 'active' : 'queued');
        this.groups.set(id, { id, tiles: ids, state, air, held: false, readyPass });
        this.events.push({ kind: 'prime', ids, air, groupId: id, type, atStep: this.step });
        if (air)
            this.stats.airPrimes++;
        return id;
    }
    /** Progress derives from the conductor's clock, not wall-clock frame time. */
    flightProgress(atSeconds, sinceStep) {
        if (!this.flight)
            return 1;
        const originStep = sinceStep ?? this.flight.sinceStep;
        return Math.max(0, Math.min(1, (atSeconds - originStep * this.stepSeconds) / this.flight.seconds));
    }
    flightPosition(tile, atSeconds) {
        if (!tile.moved)
            return { x: tile.toX, y: tile.toY };
        const p = this.flightProgress(atSeconds, tile.sinceStep);
        const travel = Math.min(1, p / T.AIR_CONTACT_FROM);
        const smooth = 1 - Math.pow(1 - travel, 3);
        const settle = p > T.AIR_CONTACT_FROM ? Math.sin((p - T.AIR_CONTACT_FROM) / (1 - T.AIR_CONTACT_FROM) * Math.PI) * 0.035 : 0;
        return {
            x: tile.fromX + (tile.toX - tile.fromX) * smooth,
            y: tile.fromY + (tile.toY - tile.fromY) * smooth - settle
        };
    }
    /**
     * Air groups are checked against in-flight positions OR landed positions while a cascade is active.
     * If the user taps a stationary group while another column is falling, this falls back cleanly in main.ts.
     */
    primeAir(x, y, atSeconds) {
        const flight = this.flight;
        if (!flight || this.over)
            return null;
        const p = this.flightProgress(atSeconds);
        if (p < T.AIR_CONTACT_FROM || p > 1)
            return null;
        const candidates = flight.tiles.filter(t => t.moved && !t.group);
        const selected = candidates.find(t => {
            const pos = this.flightPosition(t, atSeconds);
            return Math.abs(pos.x - x) < 0.65 && Math.abs(pos.y - y) < 0.65;
        });
        if (!selected)
            return null;
        const occupied = this.board[selected.toY]?.[selected.toX];
        if (!occupied || occupied.group !== null)
            return null;
        const ids = this.rules.primeable(this.board, selected.toX, selected.toY);
        if (ids.length < 2 || !ids.some(id => candidates.some(t => t.id === id)))
            return null;
        const others = flight.tiles.filter(t => ids.includes(t.id) && t.id !== selected.id);
        const center = this.flightPosition(selected, atSeconds);
        if (!others.some(t => {
            const v = this.flightPosition(t, atSeconds);
            return Math.abs(center.x - v.x) + Math.abs(center.y - v.y) < 1.75;
        }))
            return null;
        return this.queueGroup(ids, true);
    }
    hold(x, y) {
        const tile = this.board[y]?.[x];
        const group = tile?.group == null ? undefined : this.groups.get(tile.group);
        if (!group || group.held || !['queued', 'active', 'airborne'].includes(group.state))
            return false;
        group.held = true;
        group.state = 'held';
        this.events.push({ kind: 'hold', ids: group.tiles, groupId: group.id, type: tile.type, atStep: this.step });
        return true;
    }
    advancePhysics(atSeconds) {
        if (this.flight && this.flightProgress(atSeconds) >= 1)
            this.land();
    }
    land() {
        if (!this.flight)
            return;
        const flight = this.flight;
        this.flight = null;
        for (const g of this.groups.values()) {
            if (g.state === 'airborne') {
                const minX = Math.min(...g.tiles.map(id => this.getTile(id)?.x ?? T.BOARD_COLS));
                const ahead = this.pass >= 1 && minX >= this.currentCoveredColumns();
                g.state = ahead ? 'active' : 'queued';
                g.readyPass = ahead ? this.pass : Math.max(1, this.pass + 1);
            }
        }
        this.events.push({ kind: 'land', ids: flight.tiles.filter(t => t.moved).map(t => t.id), atStep: this.step });
        this.ensurePairs();
    }
    /** Deterministic 16th-note simulation; wall-clock input is never used. */
    advanceTo(absoluteStep) {
        if (this.over)
            return;
        for (let s = this.step + 1; s <= absoluteStep; s++) {
            this.step = s;
            this.advancePhysics(s * this.stepSeconds);
            if (s % T.SIXTEENTHS === 0)
                this.startPass();
            // Sweepline ALWAYS crosses on every 16th note — cascades never freeze the sweepline!
            this.cross(s % T.SIXTEENTHS);
            if (this.over)
                break;
        }
    }
    startPass() {
        if (this.pass > 0)
            this.finishPass();
        this.pass++;
        this.stats.passes = this.pass;
        const pressureDue = this.config.mode !== 'zen' && this.pass > 1 && (this.pass - 1) % this.pressureBars() === 0;
        if (pressureDue && this.flight)
            this.pressureDebt = true;
        else if ((pressureDue || this.pressureDebt) && !this.flight) {
            this.pushPressure();
            this.pressureDebt = false;
        }
        if (this.over)
            return;
        for (const g of this.groups.values()) {
            if (g.readyPass <= this.pass && (g.state === 'queued' || g.state === 'airborne')) {
                g.state = 'active';
            }
        }
        if (this.config.mode === 'zen' && !this.flight && this.countTiles() < T.ZEN_REPLENISH_ROWS * T.BOARD_COLS) {
            this.pushPressure();
        }
    }
    pressureBars() { return pressureCadence(this.config.mode, this.pass, this.config.skinLevel); }
    pushPressure() {
        if (this.board[0].some(Boolean)) {
            this.over = true;
            this.events.push({ kind: 'end', atStep: this.step });
            return;
        }
        for (let y = 0; y < T.BOARD_ROWS - 1; y++) {
            this.board[y] = this.board[y + 1];
            for (const t of this.board[y])
                if (t)
                    t.y = y;
        }
        this.board[T.BOARD_ROWS - 1] = Array(T.BOARD_COLS).fill(null);
        const row = this.fillRow(T.BOARD_ROWS - 1);
        this.stats.pressureRows++;
        this.events.push({ kind: 'pressure', row, atStep: this.step });
        this.ensurePairs();
    }
    cross(substep) {
        const covered = ((substep + 1) * T.BOARD_COLS) / T.SIXTEENTHS;
        const toDetonate = [];
        for (const g of this.groups.values()) {
            if (g.readyPass > this.pass || g.state === 'queued' || g.state === 'airborne')
                continue;
            if (g.state === 'skipped' && this.pass < g.readyPass)
                continue;
            const tiles = g.tiles.map(id => this.getTile(id)).filter((t) => !!t);
            if (!tiles.length) {
                this.groups.delete(g.id);
                continue;
            }
            if (Math.min(...tiles.map(t => t.x)) >= covered)
                continue;
            if (g.held && g.state === 'held') {
                g.state = 'skipped';
                g.readyPass = this.pass + 1;
                continue;
            }
            toDetonate.push(g);
        }
        if (!toDetonate.length)
            return;
        const removed = new Set();
        const planned = [];
        for (const g of toDetonate) {
            const remaining = g.tiles.filter(id => this.getTile(id) && !removed.has(id));
            if (!remaining.length) {
                this.groups.delete(g.id);
                continue;
            }
            const ids = (g.held ? this.rules.expandClear(this.board, remaining) : remaining).filter(id => !removed.has(id));
            const anchor = this.getTile(remaining[0]);
            ids.forEach(id => removed.add(id));
            planned.push({ group: g, ids, anchor });
        }
        if (!planned.length)
            return;
        const resonanceCount = this.passKills + planned.length;
        const factor = resonance(resonanceCount);
        const comboFactor = Math.min(T.COMBO_CAP, 1 + this.combo * T.COMBO_STEP);
        const bursts = [];
        for (const { group: g, ids, anchor } of planned) {
            const points = Math.round(this.rules.scoreGroup(ids.length) *
                factor *
                comboFactor *
                (g.air ? T.AIR_MULT : 1) *
                (g.held ? T.OVERCHARGE_MULT : 1));
            this.stats.score += points;
            this.passScore += points;
            this.stats.bestPass = Math.max(this.stats.bestPass, this.passScore);
            this.passKills++;
            this.stats.maxPassGroups = Math.max(this.stats.maxPassGroups, this.passKills);
            this.stats.groups++;
            if (g.held) {
                this.stats.overcharges++;
                this.stats.overchargeTiles += ids.length;
            }
            bursts.push({
                kind: 'burst',
                ids,
                x: anchor.x,
                y: anchor.y,
                overcharged: g.held,
                points,
                groupId: g.id,
                type: anchor.type,
                resonance: resonanceCount,
                atStep: this.step
            });
            this.groups.delete(g.id);
        }
        for (const g of [...this.groups.values()]) {
            if (g.tiles.some(id => removed.has(id))) {
                g.tiles = g.tiles.filter(id => !removed.has(id));
                if (!g.tiles.length)
                    this.groups.delete(g.id);
            }
        }
        // Capture current visual positions (accounting for any already-falling tiles) before collapsing.
        const nowSec = this.step * this.stepSeconds;
        const prevFlightMap = new Map(this.flight?.tiles.map(f => [f.id, f]) ?? []);
        const from = new Map();
        for (const row of this.board) {
            for (let x = 0; x < row.length; x++) {
                const tile = row[x];
                if (!tile)
                    continue;
                if (removed.has(tile.id)) {
                    row[x] = null;
                }
                else {
                    const pf = prevFlightMap.get(tile.id);
                    const pos = pf ? this.flightPosition(pf, nowSec) : { x: tile.x, y: tile.y };
                    from.set(tile.id, {
                        x: pos.x,
                        y: pos.y,
                        type: tile.type,
                        group: tile.group,
                        prevSince: pf?.sinceStep,
                        wasMoving: pf?.moved
                    });
                }
            }
        }
        const moved = this.rules.collapse(this.board);
        this.board = moved.board;
        const movedSet = new Set(moved.moved);
        const tiles = moved.board.flat().filter((t) => !!t).map(t => {
            const old = from.get(t.id);
            const newlyMoved = movedSet.has(t.id);
            const isMoving = newlyMoved || !!old.wasMoving;
            return {
                id: t.id,
                type: t.type,
                group: t.group,
                fromX: old.x,
                fromY: old.y,
                toX: t.x,
                toY: t.y,
                moved: isMoving,
                sinceStep: newlyMoved ? this.step : (old.prevSince ?? this.step)
            };
        });
        const durationSeconds = Math.max(T.AIR_FAIR_MS / 1000 / (1 - T.AIR_CONTACT_FROM), T.FALL_DURATION / T.FALL_SPEED_SCALE);
        this.flight = { sinceStep: this.step, seconds: durationSeconds, tiles };
        this.ensurePairs();
        this.events.push(...bursts, { kind: 'cascade', ids: moved.moved, durationSeconds, atStep: this.step }, { kind: 'score', value: this.stats.score, atStep: this.step });
    }
    finishPass() {
        if (this.passKills) {
            this.combo++;
            this.stats.longestCombo = Math.max(this.stats.longestCombo, this.combo);
        }
        else {
            this.combo = 0;
        }
        this.stats.bestPass = Math.max(this.stats.bestPass, this.passScore);
        this.passScore = 0;
        this.passKills = 0;
    }
    countTiles() { return this.board.flat().filter(Boolean).length; }
    snapshot() {
        return JSON.stringify({
            board: this.board.map(r => r.map(t => t ? [t.id, t.type, t.group] : null)),
            flight: this.flight,
            groups: [...this.groups.values()].sort((a, b) => a.id - b.id),
            stats: this.stats,
            pass: this.pass,
            step: this.step,
            combo: this.combo,
            over: this.over,
            pressureDebt: this.pressureDebt
        });
    }
    drain() { const events = this.events; this.events = []; return events; }
}
