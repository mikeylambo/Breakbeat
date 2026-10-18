/**
 * BREAKBEAT — Main Application Controller (GDD Build 01).
 * Connects PulseEngine, GemRules, StemConductor, WallRenderer, Action-Gated Lessons,
 * Odyssey Campaign Progression, and the 3-second Best-Pass Replay Results Card.
 */
import { TUNING, computeComboMultiplier, computeMasteryRank } from './tuning.js';
import { PulseEngine } from './pulse/PulseEngine.js';
import { GemRules } from './content/gems/GemRules.js';
import { SKINS, getSkinById } from './content/gems/Skins.js';
import { StemConductor } from './audio/StemConductor.js';
import { WallRenderer } from './render/WallRenderer.js';
const STORAGE_KEY_LESSONS = 'breakbeat.ag.lessons.v1';
const STORAGE_KEY_MASTERY = 'breakbeat.ag.mastery.v1';
function loadLessons() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_LESSONS);
        if (raw)
            return JSON.parse(raw);
    }
    catch {
        // Ignore storage errors
    }
    return { primedOnce: false, sweptOnce: false, heldOnce: false, airPrimedOnce: false };
}
function saveLessons(state) {
    try {
        localStorage.setItem(STORAGE_KEY_LESSONS, JSON.stringify(state));
    }
    catch {
        // Ignore storage errors
    }
}
function loadMasteryMap() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_MASTERY);
        if (raw)
            return JSON.parse(raw);
    }
    catch {
        // Ignore
    }
    return {};
}
function recordSkinBestScore(skinId, score) {
    const map = loadMasteryMap();
    if (score > (map[skinId] ?? 0)) {
        map[skinId] = score;
        try {
            localStorage.setItem(STORAGE_KEY_MASTERY, JSON.stringify(map));
        }
        catch {
            // Ignore
        }
    }
}
function utcDailySeed() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `daily-${y}-${m}-${d}`;
}
function el(id) {
    const node = document.getElementById(id);
    if (!node)
        throw new Error(`Missing DOM element #${id}`);
    return node;
}
function bootstrap() {
    const wallCanvas = el('wallCanvas');
    const replayCanvas = el('replayCanvas');
    let currentMode = 'odyssey';
    let currentSkinIndex = 0;
    let currentSkin = SKINS[0];
    let bpmScale = 1.0;
    let autoPrimeAssist = false;
    let hudHidden = false;
    let studioOpen = false;
    const a11y = {
        flashIntensity: 1.0,
        strobeFree: false
    };
    const lessons = loadLessons();
    const rules = new GemRules(currentSkin.material);
    const conductor = new StemConductor(currentSkin);
    const renderer = new WallRenderer(wallCanvas, currentSkin);
    let engine = createEngineForState();
    // Long-press Hold tracking
    let activeHoldPointer = null;
    function createEngineForState() {
        rules.material = currentSkin.material;
        const seed = currentMode === 'daily'
            ? utcDailySeed()
            : `${currentMode}-${currentSkin.id}-${Date.now().toString(36)}`;
        const scaledBpm = Math.round(currentSkin.bpm * bpmScale);
        conductor.setSkin(currentSkin, bpmScale);
        renderer.setSkin(currentSkin);
        applySkinCssVariables(currentSkin);
        return new PulseEngine({
            seed,
            mode: currentMode,
            bpm: scaledBpm,
            colorCount: currentSkin.colorCount,
            riseBars: currentSkin.riseBars,
            pressureFrom: TUNING.PRESSURE_FROM
        }, rules);
    }
    function applySkinCssVariables(skin) {
        const root = document.documentElement.style;
        root.setProperty('--stage-top', skin.stageBgTop);
        root.setProperty('--stage-bottom', skin.stageBgBottom);
        root.setProperty('--bezel-metal', skin.bezelMetal);
        root.setProperty('--well-surface', skin.wellSurface);
        root.setProperty('--accent', skin.sweepColor);
        root.setProperty('--accent-secondary', skin.sweepSecondary);
    }
    function startNewRun() {
        el('resultsModal').classList.add('hidden');
        engine = createEngineForState();
        conductor.start();
        updateHud();
        updateLessonBanner();
        renderSkinCards();
    }
    function advanceOdysseySkinIfQuotaMet() {
        if (currentMode !== 'odyssey')
            return;
        if (engine.telemetry.blocksCleared >= currentSkin.quotaBlocks && currentSkinIndex < SKINS.length - 1) {
            currentSkinIndex++;
            currentSkin = SKINS[currentSkinIndex];
            rules.material = currentSkin.material;
            engine.config.colorCount = currentSkin.colorCount;
            engine.config.riseBars = currentSkin.riseBars;
            const newBpm = Math.round(currentSkin.bpm * bpmScale);
            engine.config.bpm = newBpm;
            conductor.setSkin(currentSkin, bpmScale);
            renderer.setSkin(currentSkin);
            applySkinCssVariables(currentSkin);
            renderSkinCards();
        }
    }
    function updateLessonBanner() {
        const footer = el('lessonFooter');
        const badge = el('lessonStepBadge');
        const copy = el('lessonCopy');
        if (!lessons.primedOnce) {
            footer.classList.remove('hidden');
            badge.textContent = 'LESSON 1/4';
            copy.textContent = 'Tap any connected 2+ same-colour group to prime & lock it.';
        }
        else if (!lessons.sweptOnce) {
            footer.classList.remove('hidden');
            badge.textContent = 'LESSON 2/4';
            copy.textContent = 'Watch the sweepline detonate your primed group on the beat.';
        }
        else if (!lessons.heldOnce) {
            footer.classList.remove('hidden');
            badge.textContent = 'LESSON 3/4';
            copy.textContent = 'Long-press a primed group (0.3s) to Hold it for a ×2 Overcharge blast.';
        }
        else if (!lessons.airPrimedOnce) {
            footer.classList.remove('hidden');
            badge.textContent = 'LESSON 4/4';
            copy.textContent = 'Tap falling blocks mid-cascade to land an Air-Prime (×1.25).';
        }
        else {
            // All lessons retired on first use (GDD Page 6)!
            footer.classList.add('hidden');
        }
    }
    function updateHud() {
        // Score normalized if BPM scaled down
        const normScore = Math.round(engine.telemetry.score * Math.min(1, bpmScale));
        el('hudScore').textContent = normScore.toLocaleString();
        const comboMult = computeComboMultiplier(engine.comboPasses);
        el('hudCombo').textContent = `${comboMult.toFixed(1)}×`;
        el('hudRank').textContent = `RANK ${engine.chainRank}`;
        // Update 5-stem equalizer pips
        const pips = el('stemMeters').querySelectorAll('.stem-pip');
        const rank = engine.chainRank;
        const heldCount = engine.activeHeldCount;
        pips.forEach((pip, idx) => {
            pip.classList.remove('active', 'overcharge');
            if (idx === 0 || idx <= rank) {
                pip.classList.add('active');
            }
            if (idx === 4 && (rank >= 4 || heldCount > 0)) {
                pip.classList.add('overcharge');
            }
        });
        // Danger / Pressure indicator
        const dangerPill = el('dangerPill');
        const topOccupied = engine.board[0].some(Boolean) || engine.board[1].some(Boolean);
        const barsLeft = engine.barsUntilNextPush;
        if (topOccupied) {
            dangerPill.textContent = 'DANGER LINE!';
            dangerPill.classList.add('critical');
        }
        else {
            dangerPill.classList.remove('critical');
            dangerPill.textContent =
                barsLeft === null
                    ? 'ZEN FLOW'
                    : barsLeft === 1
                        ? 'RISE NEXT BAR'
                        : `RISE IN ${barsLeft}`;
        }
    }
    function processEngineEvents() {
        const events = engine.drainEvents();
        for (const ev of events) {
            if (ev.type === 'prime') {
                conductor.triggerPrime(ev.kind, ev.tileIds.length, ev.airPrimed);
                if (!lessons.primedOnce) {
                    lessons.primedOnce = true;
                    saveLessons(lessons);
                    updateLessonBanner();
                }
                if (ev.airPrimed && !lessons.airPrimedOnce) {
                    lessons.airPrimedOnce = true;
                    saveLessons(lessons);
                    updateLessonBanner();
                }
            }
            else if (ev.type === 'hold') {
                conductor.triggerHold(ev.kind);
                if (!lessons.heldOnce) {
                    lessons.heldOnce = true;
                    saveLessons(lessons);
                    updateLessonBanner();
                }
            }
            else if (ev.type === 'detonate') {
                conductor.triggerDetonate(ev.kind, ev.resonanceCount, ev.overcharged);
                renderer.emitDetonationVisuals(ev.cells, ev.points, ev.resonanceCount, ev.overcharged, ev.airPrimed, a11y);
                if (!lessons.sweptOnce) {
                    lessons.sweptOnce = true;
                    saveLessons(lessons);
                    updateLessonBanner();
                }
                advanceOdysseySkinIfQuotaMet();
            }
            else if (ev.type === 'cascade') {
                conductor.triggerCascadeSlide(ev.movedTileIds.length);
            }
            else if (ev.type === 'gameover') {
                conductor.triggerTonicResolution();
                openResultsCard();
            }
        }
    }
    function openResultsCard() {
        const normScore = Math.round(engine.telemetry.score * Math.min(1, bpmScale));
        recordSkinBestScore(currentSkin.id, normScore);
        const mastery = computeMasteryRank(normScore);
        el('resultsKicker').textContent =
            engine.gameOverReason === 'detonator'
                ? 'DETONATOR EXPIRED · RESOLVED TO TONIC'
                : `${currentSkin.title} · RESOLVED TO TONIC`;
        el('resultsScore').textContent = normScore.toLocaleString();
        el('resultsMastery').textContent = mastery;
        const bestSnap = engine.bestPassSnapshot;
        el('replayPassMeta').textContent = bestSnap
            ? `BAR ${bestSnap.bar} · ${bestSnap.points.toLocaleString()} PTS (${bestSnap.groupsDetonated} GROUPS)`
            : '0 PTS';
        el('statBestPass').textContent = engine.telemetry.bestPassScore.toLocaleString();
        el('statLongestCombo').textContent = `${engine.telemetry.longestCombo} BARS`;
        el('statOvercharges').textContent = String(engine.telemetry.overchargesLanded);
        el('statAirPrimes').textContent = String(engine.telemetry.airPrimesLanded);
        el('statBars').textContent = String(engine.telemetry.barsSurvived);
        el('statBlocks').textContent = String(engine.telemetry.blocksCleared);
        el('resultsModal').classList.remove('hidden');
        renderSkinCards();
    }
    function renderSkinCards() {
        const container = el('skinList');
        const masteryMap = loadMasteryMap();
        container.innerHTML = '';
        SKINS.forEach((skin, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `skin-card${skin.id === currentSkin.id ? ' active' : ''}`;
            const bestScore = masteryMap[skin.id] ?? 0;
            const rank = bestScore > 0 ? computeMasteryRank(bestScore) : 'UNRANKED';
            const dotsHtml = skin.swatches
                .slice(0, skin.colorCount)
                .map(s => `<span class="swatch-dot" style="background:${s.fill}"></span>`)
                .join('');
            btn.innerHTML = `
        <div class="skin-meta">
          <span class="skin-act">${skin.act} · ${skin.bpm} BPM · ${skin.keyName}</span>
          <span class="skin-name">${skin.title}</span>
          <span class="skin-sub">${skin.subtitle} · ${rank}</span>
        </div>
        <div class="skin-swatches">${dotsHtml}</div>
      `;
            btn.addEventListener('click', () => {
                conductor.unlock();
                currentSkinIndex = idx;
                currentSkin = getSkinById(skin.id);
                startNewRun();
            });
            container.appendChild(btn);
        });
    }
    // Pointer gestures on the 10x14 wall:
    // - Tap an unprimed 2+ group -> primes immediately on pointerdown!
    // - Press and hold (300ms) on a primed group -> holds it for Overcharge!
    wallCanvas.addEventListener('pointerdown', (e) => {
        conductor.unlock();
        if (engine.gameOver || studioOpen)
            return;
        const cell = renderer.clientToBoardCell(e.clientX, e.clientY);
        if (!cell)
            return;
        const beat = conductor.query();
        const tile = engine.board[cell.row]?.[cell.col];
        if (!tile)
            return;
        const existingGroup = engine.getGroupForTile(tile.id);
        if (existingGroup) {
            // Begin long-press Hold timer (HOLD_MS = 300ms)
            if (!existingGroup.held) {
                activeHoldPointer = {
                    pointerId: e.pointerId,
                    col: cell.col,
                    row: cell.row,
                    startedMs: performance.now(),
                    triggered: false
                };
            }
        }
        else {
            // Instant tap-to-prime on unprimed cluster!
            engine.primeAt(cell.col, cell.row, beat.visualElapsedSec);
            processEngineEvents();
            updateHud();
        }
    });
    wallCanvas.addEventListener('pointermove', (e) => {
        const cell = renderer.clientToBoardCell(e.clientX, e.clientY);
        renderer.hoveredClusterIds.clear();
        if (!cell) {
            activeHoldPointer = null;
            renderer.holdCursor = null;
            return;
        }
        if (activeHoldPointer && activeHoldPointer.pointerId === e.pointerId) {
            if (cell.col !== activeHoldPointer.col || cell.row !== activeHoldPointer.row) {
                activeHoldPointer = null;
                renderer.holdCursor = null;
            }
        }
        // Highlight primeable cluster under hover pointer
        const locked = engine.getLockedTileIds();
        const cluster = rules.primeable(engine.board, cell.col, cell.row, locked);
        if (cluster) {
            for (const t of cluster)
                renderer.hoveredClusterIds.add(t.id);
        }
    });
    const clearHoldPointer = () => {
        activeHoldPointer = null;
        renderer.holdCursor = null;
    };
    wallCanvas.addEventListener('pointerup', clearHoldPointer);
    wallCanvas.addEventListener('pointercancel', clearHoldPointer);
    wallCanvas.addEventListener('pointerleave', () => {
        renderer.hoveredClusterIds.clear();
        clearHoldPointer();
    });
    // UI Controls
    function togglePureHud() {
        hudHidden = !hudHidden;
        el('hudStrip').classList.toggle('hidden', hudHidden);
        el('btnRestoreHud').classList.toggle('hidden', !hudHidden);
    }
    function setStudioOpen(open) {
        studioOpen = open;
        el('studioDrawer').classList.toggle('hidden', !open);
        if (open) {
            conductor.pause();
        }
        else {
            conductor.resume();
        }
    }
    el('btnPureView').addEventListener('click', togglePureHud);
    el('btnRestoreHud').addEventListener('click', togglePureHud);
    el('btnStudio').addEventListener('click', () => setStudioOpen(true));
    el('btnCloseStudio').addEventListener('click', () => setStudioOpen(false));
    el('btnNewRun').addEventListener('click', () => {
        conductor.unlock();
        setStudioOpen(false);
        startNewRun();
    });
    el('btnPlayAgain').addEventListener('click', () => {
        conductor.unlock();
        startNewRun();
    });
    el('btnResultsSkins').addEventListener('click', () => {
        el('resultsModal').classList.add('hidden');
        setStudioOpen(true);
    });
    // Mode selector pills
    el('modePills').querySelectorAll('.mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            conductor.unlock();
            const mode = btn.dataset.mode;
            if (!mode)
                return;
            currentMode = mode;
            el('modePills')
                .querySelectorAll('.mode-pill')
                .forEach(b => b.classList.toggle('active', b === btn));
            startNewRun();
        });
    });
    // Accessibility inputs
    el('sliderFlash').addEventListener('input', e => {
        const val = Number(e.target.value);
        a11y.flashIntensity = Math.max(0.2, Math.min(1, val / 100));
    });
    el('selectBpmScale').addEventListener('change', e => {
        bpmScale = Number(e.target.value) || 1.0;
        startNewRun();
    });
    el('checkStrobeFree').addEventListener('change', e => {
        a11y.strobeFree = e.target.checked;
    });
    el('checkAutoAssist').addEventListener('change', e => {
        autoPrimeAssist = e.target.checked;
    });
    el('checkMute').addEventListener('change', e => {
        conductor.setMuted(e.target.checked);
    });
    // Keyboard shortcuts
    window.addEventListener('keydown', e => {
        if (e.key === 'v' || e.key === 'V') {
            togglePureHud();
        }
        else if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault();
            setStudioOpen(!studioOpen);
        }
        else if (e.key === 'r' || e.key === 'R') {
            conductor.unlock();
            setStudioOpen(false);
            startNewRun();
        }
    });
    // Pause track and sweep together when tab is hidden (GDD Page 2)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            conductor.pause();
        }
        else if (!studioOpen && !engine.gameOver) {
            conductor.resume();
        }
    });
    // Main 120fps Conduct & Render Loop
    let lastAutoAssistBar = -1;
    function frameLoop(nowMs) {
        if (!studioOpen && !engine.gameOver) {
            const beat = conductor.query();
            // Check active long-press Hold gesture (300 ms)
            if (activeHoldPointer && !activeHoldPointer.triggered) {
                const elapsedHold = nowMs - activeHoldPointer.startedMs;
                const progress = Math.min(1, elapsedHold / TUNING.HOLD_MS);
                renderer.holdCursor = {
                    col: activeHoldPointer.col,
                    row: activeHoldPointer.row,
                    progress
                };
                if (elapsedHold >= TUNING.HOLD_MS) {
                    activeHoldPointer.triggered = true;
                    renderer.holdCursor = null;
                    engine.holdAt(activeHoldPointer.col, activeHoldPointer.row);
                }
            }
            // Motor accessibility: Auto-Prime Assist primes 1 available cluster per measure if enabled
            if (autoPrimeAssist && beat.bar !== lastAutoAssistBar && engine.groups.size === 0) {
                lastAutoAssistBar = beat.bar;
                const locked = engine.getLockedTileIds();
                outer: for (let r = TUNING.BOARD_ROWS - 1; r >= 0; r--) {
                    for (let c = 0; c < TUNING.BOARD_COLS; c++) {
                        if (engine.primeAt(c, r, beat.visualElapsedSec)) {
                            break outer;
                        }
                    }
                }
            }
            // Step simulation to current 16th note
            engine.advanceToStep(beat.absoluteStep);
            processEngineEvents();
            // Schedule multi-stem synth layers
            const primedColors = new Set();
            for (const g of engine.groups.values())
                primedColors.add(g.kind);
            conductor.scheduleStems(engine.chainRank, engine.activeHeldCount, primedColors);
            updateHud();
            renderer.render(engine, beat, a11y);
        }
        else if (engine.gameOver) {
            // Keep rendering the Best-Pass 3-second replay loop while the Results Card is open!
            renderer.renderBestPassReplay(replayCanvas, engine.bestPassSnapshot, nowMs);
        }
        requestAnimationFrame(frameLoop);
    }
    renderSkinCards();
    updateHud();
    updateLessonBanner();
    requestAnimationFrame(frameLoop);
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    }
    else {
        bootstrap();
    }
}
