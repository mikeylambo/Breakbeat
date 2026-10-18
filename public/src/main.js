import { GemRules } from './content/gems/GemRules.js';
import { Pulse } from './pulse/Pulse.js';
import { Conductor } from './pulse/Conductor.js';
import { skins } from './content/skins.js';
import { T } from './tuning.js';
import { CHALLENGES, challengeById } from './pulse/Challenges.js';
import { pressureBand } from './pulse/Balance.js';
import { renderTile, renderSweep } from './content/MaterialRenderer.js';
import { migrateProgress, rankFor, personaUnlock, normalizedScore, recordResult, completeChallenge } from './experience/Progression.js';
import { advanceLesson, LESSONS } from './experience/Tutorial.js';
import { PassRecorder, replayFrameAt } from './experience/Replay.js';
const $ = (id) => document.getElementById(id);
const canvas = $('board'), ctx = canvas.getContext('2d', { alpha: false });
const conductor = new Conductor();
const settingsKey = 'breakbeat-settings-v1', progressKey = 'breakbeat-progress-v1';
function getSaved(key, defaults) { try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') };
}
catch {
    return defaults;
} }
const settings = getSaved(settingsKey, { volume: 0.7, flash: 0.7, strobeFree: false, reducedMotion: false, haptics: true, mute: false, autoPrime: false, highContrast: false, bpmScale: 1 });
let progress;
try {
    progress = migrateProgress(JSON.parse(localStorage.getItem(progressKey) || 'null'));
}
catch {
    progress = migrateProgress(null);
}
settings.bpmScale = [0.8, 0.9, 1, 1.1, 1.2].includes(settings.bpmScale) ? settings.bpmScale : 1;
const recorder = new PassRecorder();
let lesson = 'prime', tutorialActive = !progress.tutorialComplete, trainingReplay = false, assistUsed = false, lastAssistPass = 0;
let replayShown = null, replayStartMs = 0, feedbackTimeout = 0, sessionId = 0;
let challengeSelection = null, challengeAnnounced = false, lastPressurePreview = '';
let mode = 'odyssey', skinIndex = 0, game = null, playing = false, paused = false, finished = false, frameTime = 0;
let selected = { x: 4, y: 10 }, hitstopUntil = 0, pressureRiseBorn = 0;
let bursts = [];
let popups = [];
let debris = [];
let menuPhase = 'menu';
function sessionBpm() { return Math.round(skin().bpm * (mode === 'daily' ? 1 : settings.bpmScale)); }
function currentScale() { return mode === 'daily' ? 1 : settings.bpmScale; }
function scoreNow() { return normalizedScore(game?.stats.score ?? 0, currentScale()); }
function recordKey() { return `${mode}:${skin().id}${mode === 'endless' && challengeSelection ? `:challenge:${challengeSelection}` : ''}${assistUsed ? ':assisted' : ''}`; }
function feedback(text) {
    const el = $('feedbackToast');
    el.textContent = text;
    el.classList.add('active');
    window.clearTimeout(feedbackTimeout);
    feedbackTimeout = window.setTimeout(() => el.classList.remove('active'), 1400);
}
function tip() {
    if (!tutorialActive) {
        $('tipTitle').textContent = 'CONDUCT THE WALL';
        $('tipBody').textContent = 'Tap groups ahead of the sweep. Tap again or hold to Overcharge ×2.';
        $('lessonAction').textContent = 'TAP • HOLD • COMPOSE';
        return;
    }
    const l = LESSONS[lesson];
    $('tipTitle').textContent = l.title;
    $('tipBody').textContent = l.body;
    $('lessonAction').textContent = l.action;
}
function learn(event) {
    if (!tutorialActive)
        return;
    const next = advanceLesson(lesson, event);
    if (next === lesson)
        return;
    lesson = next;
    tip();
    if (lesson === 'complete') {
        tutorialActive = false;
        progress.tutorialComplete = true;
        trainingReplay = false;
        save();
        feedback('LESSONS COMPLETE / CONDUCT THE WALL');
    }
    else {
        feedback(LESSONS[lesson].action);
    }
}
function findCandidate() {
    if (!game)
        return null;
    let candidate = null;
    for (let y = 0; y < T.BOARD_ROWS; y++) {
        for (let x = 0; x < T.BOARD_COLS; x++) {
            const len = game.rules.primeable(game.board, x, y).length;
            if (len >= T.MIN_GROUP && (!candidate || len > candidate.size))
                candidate = { x, y, size: len };
        }
    }
    return candidate;
}
function performAssist(auto = false) {
    if (!game || !playing || paused || mode === 'daily')
        return;
    const candidate = findCandidate();
    if (!candidate)
        return;
    assistUsed = true;
    selected = { x: candidate.x, y: candidate.y };
    inputTile(candidate.x, candidate.y);
    if (!auto)
        feedback(`ASSIST / ${candidate.size} TILES PRIMED`);
}
function inspectSelected() {
    if (!game)
        return;
    const tile = game.board[selected.y]?.[selected.x];
    const size = game.rules.primeable(game.board, selected.x, selected.y).length;
    $('selectedCell').textContent = `Column ${selected.x + 1}, row ${selected.y + 1}. ${tile ? `Color ${tile.type + 1}${tile.group === null ? '.' : ' primed.'}` : 'Empty.'} ${size >= 2 ? `${size}-tile group ready.` : ''}`;
}
function danger() {
    if (!game)
        return;
    let highest = 14;
    for (let y = 0; y < 14; y++)
        if (game.board[y]?.some(Boolean)) {
            highest = y;
            break;
        }
    const severity = pressureBand(14 - highest);
    $('boardFrame').classList.toggle('danger-warn', severity === 'rising');
    $('boardFrame').classList.toggle('danger-critical', severity === 'critical');
    $('dangerText').textContent = highest < 4 ? '◆ CRITICAL / CLEAR NOW' : highest < 7 ? '◆ PRESSURE RISING' : '◂ DANGER LINE';
}
function renderChallenges() {
    const visible = mode === 'endless';
    show('challengeSelect', visible);
    const row = $('challengeList');
    row.replaceChildren();
    if (!visible)
        return;
    const choices = [
        [null, 'STANDARD', 'FREE SURVIVAL'],
        ...CHALLENGES.map(c => [c.id, c.name, progress.completedChallenges.includes(c.id) ? '◆ COMPLETED' : `${c.target} TO CLEAR`])
    ];
    for (const [id, name, detail] of choices) {
        const b = document.createElement('button');
        b.className = `challenge-option${challengeSelection === id ? ' selected' : ''}`;
        b.innerHTML = `<span>${name}</span><small>${detail}</small>`;
        b.addEventListener('click', () => { challengeSelection = id; renderChallenges(); updateStartLabel(); });
        row.append(b);
    }
    const c = challengeById(challengeSelection);
    $('challengeDescription').textContent = c ? `${c.subtitle} No modifiers, boosts or special blocks. Trial results are kept separate.` : 'The original endless run, with no challenge conditions.';
}
function updateChallengeHud() {
    const state = game?.challengeProgress, c = challengeById(challengeSelection);
    const active = !!state && !!c;
    show('challengeHud', active);
    if (!state || !c)
        return;
    $('challengeHudLabel').textContent = c.name;
    $('challengeHudProgress').textContent = state.complete ? '◆ COMPLETE' : `${state.value} / ${state.target}`;
    $('challengeHud').classList.toggle('complete', state.complete);
    if (state.complete && !challengeAnnounced) {
        challengeAnnounced = true;
        completeChallenge(progress, c.id, scoreNow());
        save();
        feedback(`${c.name} / CONTRACT CLEARED`);
    }
}
function movementInfo() {
    $('journeyOverview').classList.toggle('hidden', mode !== 'odyssey');
    const completed = new Set(progress.completed);
    $('journeyHeadline').textContent = `MOVEMENT ${String(skinIndex + 1).padStart(2, '0')} / 06`;
    $('journeyTrack').textContent = Array.from({ length: 6 }, (_, i) => completed.has(String(i)) ? '◆' : i === skinIndex ? '◇' : '·').join(' ');
    const key = `${mode}:${skin().id}`, record = progress.records[key], best = progress.best[key] ?? 0;
    $('movementInfo').innerHTML = `<strong>${skin().name}</strong> / ${skin().subtitle.toUpperCase()} &nbsp; · &nbsp; ${best ? `BEST ${fmt(best)} / ${rankFor(best)}` : 'UNPLAYED'}${record?.assisted ? ' (ASSISTED)' : ''}`;
    renderPersonas();
    renderChallenges();
}
function renderPersonas() {
    const row = $('personaRow');
    row.replaceChildren();
    for (const persona of ['blade', 'echo', 'prism']) {
        const unlocked = personaUnlock(progress, persona), button = document.createElement('button');
        button.textContent = unlocked ? persona.toUpperCase() : `LOCK / ${persona === 'echo' ? 'SILVER' : 'GOLD'}`;
        button.className = progress.persona === persona ? 'selected' : '';
        button.disabled = !unlocked;
        button.title = unlocked ? `Use the ${persona} sweep persona` : `Earn ${persona === 'echo' ? 'Silver' : 'Gold'} mastery to unlock`;
        button.addEventListener('click', () => { progress.persona = persona; save(); renderPersonas(); });
        row.append(button);
    }
}
function save() { try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    localStorage.setItem(progressKey, JSON.stringify(progress));
}
catch { } }
function today() { return new Date().toISOString().slice(0, 10); }
function fmt(n) { return Math.floor(n).toLocaleString('en-US').padStart(6, '0'); }
function skin() { return skins[skinIndex]; }
function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
function announce(text) { $('announcer').textContent = text; }
function selectMode(next) {
    mode = next;
    document.querySelectorAll('.mode-option').forEach(el => el.classList.toggle('selected', el.dataset.mode === mode));
    $('dailySub').textContent = mode === 'daily' ? 'Local daily attempt • unranked without server' : 'A new pattern each UTC day.';
    if (mode === 'daily')
        skinIndex = new Date().getUTCDate() % Math.min(progress.unlocked, skins.length);
    renderSkinRow();
    updateStartLabel();
    movementInfo();
}
function renderSkinRow() {
    const root = $('skinRow');
    root.replaceChildren();
    skins.forEach((s, i) => {
        const btn = document.createElement('button');
        btn.className = `skin-pill${i === skinIndex ? ' selected' : ''}`;
        btn.title = `${s.name} — ${s.bpm} BPM${i >= progress.unlocked ? ' (locked)' : ''}`;
        btn.setAttribute('aria-label', btn.title);
        btn.disabled = i >= progress.unlocked || mode === 'daily';
        const sw = document.createElement('i');
        sw.style.background = `linear-gradient(125deg,${s.palette[0]},${s.palette[2]})`;
        btn.append(sw);
        btn.addEventListener('click', () => { skinIndex = i; renderSkinRow(); updateStartLabel(); movementInfo(); });
        root.append(btn);
    });
}
function updateStartLabel() {
    const btn = $('startBtn');
    let title = mode === 'daily' ? 'START DAILY DESCENT' : mode === 'zen' ? 'ENTER THE FLOW' : mode === 'endless' ? (challengeSelection ? `START ${challengeById(challengeSelection)?.name ?? 'ENDLESS'}` : 'START ENDLESS') : 'PLAY ' + skin().name;
    if (mode === 'daily' && progress.daily[today()] !== undefined)
        title = 'DAILY ALREADY PLAYED';
    btn.innerHTML = `${title} <span>→</span>`;
    btn.disabled = mode === 'daily' && progress.daily[today()] !== undefined;
}
function color(index) { return skin().palette[index % skin().palette.length]; }
function setHud() {
    if (!game) {
        $('score').textContent = '000000';
        $('rank').textContent = '—';
        $('multiplier').textContent = '×1.0';
        return;
    }
    $('score').textContent = fmt(scoreNow());
    $('rank').textContent = game.combo >= 12 ? 'RESONANT' : game.combo >= 8 ? 'FRENZY' : game.combo >= 4 ? 'DRIVE' : game.combo >= 2 ? 'GROOVE' : 'PULSE';
    $('multiplier').textContent = `×${Math.min(3, 1 + game.combo * 0.1).toFixed(1)}`;
    $('barText').textContent = `BAR ${String(game.pass || 1).padStart(3, '0')}`;
    $('sweepLabel').textContent = `${Math.floor((conductor.absoluteStep % 16) / 4) + 1} / 04`;
    $('bpmText').textContent = `${sessionBpm()} BPM`;
    $('trackTitle').textContent = skin().name;
    const forecast = game.nextPressureBars;
    const occupied = game.board.filter(row => row.some(Boolean)).length;
    $('pressureForecast').textContent = forecast === null ? 'ZEN / NO PRESSURE' : forecast === 1 ? 'RISE NEXT DOWNBEAT' : `RISE IN ${forecast} BARS`;
    $('pressureRows').textContent = `${game.stats.pressureRows} RISEN`;
    $('pressureFill').style.width = `${Math.min(100, occupied / T.BOARD_ROWS * 100)}%`;
    const preview = forecast !== null ? game.previewNextRow() : [];
    const signature = preview.join(',') + ':' + skinIndex;
    if (signature !== lastPressurePreview) {
        lastPressurePreview = signature;
        $('rowPreview').replaceChildren(...preview.map(type => {
            const dot = document.createElement('i');
            dot.style.background = color(type);
            return dot;
        }));
    }
    $('rowPreview').classList.toggle('hidden', !preview.length);
    updateChallengeHud();
}
function triggerHaptic(pattern) { if (settings.haptics && 'vibrate' in navigator)
    navigator.vibrate(pattern); }
function burstScore(points) {
    const el = $('floatingScore');
    el.textContent = `+${Math.floor(points).toLocaleString()}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
}
function consume(events) {
    if (!game)
        return;
    for (const event of events) {
        switch (event.kind) {
            case 'prime': {
                conductor.sustain(event.groupId, event.type, event.atStep);
                triggerHaptic(skin().haptic.prime);
                learn({ kind: 'prime', air: event.air });
                if (event.air)
                    feedback('AIR PRIME ×1.25');
                break;
            }
            case 'hold': {
                conductor.hold(event.groupId, event.atStep);
                triggerHaptic([14, 30, 14]);
                learn({ kind: 'hold' });
                break;
            }
            case 'burst': {
                conductor.release(event.groupId);
                conductor.effect(event.overcharged ? 'over' : 'burst', event.type, event.atStep, event.resonance);
                burstScore(event.points);
                triggerHaptic(event.overcharged ? skin().haptic.over : skin().haptic.burst);
                if (event.overcharged)
                    conductor.overchargeDrop(event.atStep);
                const now = performance.now(), c = color(event.type);
                bursts.push({ x: event.x, y: event.y, born: now, color: c, power: event.overcharged ? 2.1 : 1.15 });
                popups.push({
                    x: (event.x + 0.5) * 72,
                    y: (event.y + 0.5) * 72,
                    text: `+${event.points.toLocaleString()}`,
                    sub: event.overcharged ? 'OVERCHARGE ×2' : event.resonance >= 2 ? `CHAIN ×${event.resonance}` : undefined,
                    color: event.overcharged ? '#ffe699' : '#ffffff',
                    born: now
                });
                for (let i = 0; i < Math.min(28, event.ids.length * 5); i++) {
                    const angle = i * 2.39996 + (event.groupId % 7);
                    const speed = (event.overcharged ? 8.5 : 5.2) * (0.65 + (i % 5) * 0.18);
                    debris.push({
                        x: (event.x + 0.5) * 72,
                        y: (event.y + 0.5) * 72,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed - 1.4,
                        born: now,
                        color: c,
                        shape: (event.groupId + i) % 4
                    });
                }
                if (event.resonance >= 4 && !settings.reducedMotion)
                    hitstopUntil = now + 55;
                learn({ kind: 'burst', overcharged: event.overcharged });
                break;
            }
            case 'cascade': {
                if (event.ids.length)
                    conductor.effect('slide', 0, event.atStep);
                break;
            }
            case 'land': break;
            case 'pressure': {
                pressureRiseBorn = performance.now();
                danger();
                break;
            }
            case 'end':
                void end(false);
                break;
        }
    }
    conductor.syncGroups(new Set(game.groups.keys()));
    if (mode === 'odyssey' && !finished && game.stats.score >= [3600, 5600, 7600, 10000, 12500, 15000][skinIndex]) {
        void end(true);
    }
    setHud();
}
async function start() {
    if (mode === 'daily' && progress.daily[today()] !== undefined)
        return;
    const thisSession = ++sessionId;
    finished = false;
    paused = false;
    lesson = 'prime';
    tutorialActive = !progress.tutorialComplete || trainingReplay;
    tip();
    menuPhase = 'play';
    assistUsed = false;
    lastAssistPass = 0;
    replayShown = null;
    recorder.reset();
    challengeAnnounced = false;
    lastPressurePreview = '';
    game = new Pulse({
        seed: mode === 'daily' ? `breakbeat:${today()}` : `breakbeat:${mode}:${skin().id}:${Math.random().toString(36).slice(2)}`,
        mode,
        bpm: sessionBpm(),
        skinLevel: skinIndex + 1,
        challenge: mode === 'endless' ? challengeSelection : null
    }, new GemRules());
    selected = { x: 4, y: 10 };
    bursts = [];
    popups = [];
    debris = [];
    hitstopUntil = 0;
    pressureRiseBorn = 0;
    conductor.setMuted(settings.mute);
    conductor.setVolume(settings.volume);
    let track;
    try {
        const res = await fetch('./content/tracks.json');
        if (res.ok) {
            const entries = await res.json();
            track = entries.find(t => t.id === skin().id);
        }
    }
    catch (err) {
        console.info('Manifest unavailable. Starting synth fallback.', err);
    }
    try {
        await conductor.start(sessionBpm(), skin().key, track);
    }
    catch (err) {
        console.warn('Stem load failed. Using synthesized score.', err);
        await conductor.start(sessionBpm(), skin().key);
    }
    if (thisSession !== sessionId) {
        await conductor.stop();
        return;
    }
    playing = true;
    document.body.classList.add('in-play');
    $('assistBtn').toggleAttribute('disabled', mode === 'daily');
    $('boardFrame').classList.toggle('high-contrast', settings.highContrast);
    show('menuOverlay', false);
    show('pauseOverlay', false);
    show('resultOverlay', false);
    $('pauseBtn').removeAttribute('disabled');
    $('modeLabel').textContent = mode === 'odyssey' ? `ODYSSEY / MOVEMENT ${String(skinIndex + 1).padStart(2, '0')}` : mode.toUpperCase().replace('ZEN', 'ZEN / FREE PLAY');
    announce(`Session started. ${mode}. ${skin().name}, ${sessionBpm()} beats per minute.`);
    setHud();
}
async function end(success) {
    if (!game || finished)
        return;
    finished = true;
    playing = false;
    menuPhase = 'result';
    document.body.classList.remove('in-play');
    recorder.finish(game.stats.score);
    conductor.effect(success ? 'over' : 'resolve', 0, game.step);
    if (!success) {
        $('boardFrame').classList.add('fallen');
        $('dangerText').textContent = '◆ PRESSURE OVERLOAD';
    }
    await new Promise(resolve => window.setTimeout(resolve, success ? 220 : 600));
    await conductor.setPause(true);
    $('boardFrame').classList.remove('fallen');
    const score = scoreNow(), key = recordKey();
    const priorPersona = new Set(['blade', 'echo', 'prism'].filter(p => personaUnlock(progress, p)));
    const result = recordResult(progress, key, {
        score,
        bestPass: normalizedScore(game.stats.bestPass, currentScale()),
        longestCombo: game.stats.longestCombo,
        overcharges: game.stats.overcharges,
        airPrimes: game.stats.airPrimes,
        survivalSeconds: Math.round(conductor.elapsed),
        date: today(),
        assisted: assistUsed
    }, recorder.best);
    if (mode === 'daily')
        progress.daily[today()] = score;
    const completedContract = mode === 'endless' ? challengeById(challengeSelection) : null;
    if (completedContract && game.challengeProgress?.complete)
        completeChallenge(progress, completedContract.id, score);
    if (success && mode === 'odyssey') {
        progress.unlocked = Math.max(progress.unlocked, Math.min(skinIndex + 2, skins.length));
        if (!progress.completed.includes(String(skinIndex)))
            progress.completed.push(String(skinIndex));
    }
    save();
    const newlyUnlocked = ['echo', 'prism'].filter(p => !priorPersona.has(p) && personaUnlock(progress, p));
    $('resultEyebrow').textContent = success ? 'MOVEMENT CLEARED // ODYSSEY' : 'THE LAST BEAT';
    $('resultTitle').innerHTML = success ? 'WHAT A<br><span>RELEASE.</span>' : 'THE WALL<br><span>FELL.</span>';
    $('resultScore').textContent = fmt(score);
    $('resultRank').textContent = `${result.rank} / ${skin().name}`;
    $('resultAccolade').textContent = `${result.newRecord ? '★ NEW PERSONAL BEST • ' : ''}${assistUsed ? 'ASSISTED RUN • ' : ''}${currentScale() !== 1 ? `BPM NORMALIZED ${Math.round(currentScale() * 100)}%` : 'PURE PERFORMANCE'}`;
    $('bestPass').textContent = fmt(normalizedScore(game.stats.bestPass, currentScale()));
    $('longestCombo').textContent = String(game.stats.longestCombo);
    $('overcharges').textContent = String(game.stats.overcharges);
    $('airPrimes').textContent = String(game.stats.airPrimes);
    $('survival').textContent = `${Math.floor(conductor.elapsed / 60)}:${String(Math.floor(conductor.elapsed % 60)).padStart(2, '0')}`;
    $('personalBest').textContent = fmt(progress.best[key] || score);
    replayShown = recorder.best ?? progress.replays[key] ?? null;
    replayStartMs = performance.now();
    $('replayPanel').classList.toggle('missing', !replayShown?.frames.length);
    $('replayScore').textContent = fmt(normalizedScore(replayShown?.score ?? 0, currentScale()));
    const contract = mode === 'endless' ? challengeById(challengeSelection) : null, state = game.challengeProgress;
    show('challengeResult', !!contract);
    if (contract && state) {
        $('challengeResult').classList.toggle('unfinished', !state.complete);
        $('challengeResult').textContent = `${state.complete ? '◆ CONTRACT CLEARED' : '◇ CONTRACT INCOMPLETE'} / ${contract.name} • ${state.value} OF ${state.target}${state.complete ? ` • BEST ${fmt(progress.challengeBest[contract.id] || score)}` : ''}`;
    }
    $('unlockPanel').classList.toggle('hidden', !newlyUnlocked.length && !success);
    $('unlockPanel').textContent = [
        success ? `MOVEMENT ${skinIndex + 1} COMPLETE${skinIndex < 5 ? ' • NEXT MOVEMENT UNLOCKED' : ' • ODYSSEY COMPLETE'}` : '',
        ...newlyUnlocked.map(p => `NEW SWEEP PERSONA UNLOCKED: ${p.toUpperCase()}`)
    ].filter(Boolean).join(' / ');
    $('nextMovementBtn').classList.toggle('hidden', !success || mode !== 'odyssey' || skinIndex >= 5);
    show('pauseOverlay', false);
    show('resultOverlay', true);
    $('pauseBtn').setAttribute('disabled', 'true');
    $('assistBtn').setAttribute('disabled', 'true');
    announce('Run completed. Score ' + fmt(score));
}
async function pause() { if (!playing || paused)
    return; paused = true; await conductor.setPause(true); show('pauseOverlay', true); announce('Game paused'); }
async function resume() { if (!playing || !paused)
    return; paused = false; show('pauseOverlay', false); await conductor.setPause(false); announce('Game resumed'); }
async function home() {
    sessionId++;
    playing = false;
    paused = false;
    finished = false;
    menuPhase = 'menu';
    document.body.classList.remove('in-play');
    await conductor.stop();
    game = null;
    show('pauseOverlay', false);
    show('resultOverlay', false);
    show('menuOverlay', true);
    show('challengeHud', false);
    $('pauseBtn').setAttribute('disabled', 'true');
    $('assistBtn').setAttribute('disabled', 'true');
    $('modeLabel').textContent = 'THE RHYTHM DEMOLITION EXPERIMENT';
    renderSkinRow();
    updateStartLabel();
    movementInfo();
    setHud();
}
function tileAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
        x: Math.floor((clientX - r.left) / r.width * T.BOARD_COLS),
        y: Math.floor((clientY - r.top) / r.height * T.BOARD_ROWS)
    };
}
/**
 * Responsive input handling:
 * - Tapping an unprimed group primes it IMMEDIATELY on pointerdown (0ms latency).
 * - Continuing to hold for HOLD_MS (or tapping an already-primed group) arms Overcharge Hold!
 * - Neverlocks out stationary tiles when another column is cascading.
 */
function inputTile(x, y, forceHold = false) {
    if (!game || !playing || paused || finished)
        return false;
    if (x < 0 || x >= T.BOARD_COLS || y < 0 || y >= T.BOARD_ROWS)
        return false;
    selected = { x, y };
    inspectSelected();
    const existingTile = game.board[y]?.[x];
    if (forceHold) {
        // If not yet primed, prime it first so one-gesture press-and-hold works seamlessly!
        if (existingTile && existingTile.group === null) {
            game.prime(x, y);
        }
        const heldOk = game.hold(x, y);
        if (!heldOk)
            conductor.effect('error');
        consume(game.drain());
        return heldOk;
    }
    // If user taps an already-primed group, upgrade it to Overcharge Hold!
    if (existingTile && existingTile.group !== null) {
        const g = game.groups.get(existingTile.group);
        if (g && !g.held) {
            game.hold(x, y);
            consume(game.drain());
            return true;
        }
        return false;
    }
    // Try mid-air prime first if a cascade is active near (x,y), otherwise fall back to normal board prime!
    let id = null;
    if (game.flight) {
        id = game.primeAir(x, y, conductor.elapsed);
    }
    if (id === null) {
        id = game.prime(x, y);
    }
    if (id === null) {
        conductor.effect('error');
        return false;
    }
    consume(game.drain());
    return true;
}
let pointer = null;
canvas.addEventListener('pointerdown', e => {
    if (!playing || paused || !game)
        return;
    e.preventDefault();
    const at = tileAt(e.clientX, e.clientY);
    const id = e.pointerId;
    canvas.setPointerCapture(id);
    const tile = game.board[at.y]?.[at.x];
    const alreadyPrimed = tile?.group !== null && tile?.group !== undefined;
    // Instant action on pointerdown: prime immediately (or if already primed, arm hold immediately!)
    inputTile(at.x, at.y, alreadyPrimed);
    // If it was just primed on pointerdown, holding for HOLD_MS upgrades it to Overcharge Hold!
    pointer = {
        id,
        ...at,
        timer: window.setTimeout(() => {
            if (pointer?.id === id && game) {
                const currentTile = game.board[at.y]?.[at.x];
                if (currentTile?.group !== null && currentTile?.group !== undefined) {
                    const g = game.groups.get(currentTile.group);
                    if (g && !g.held) {
                        game.hold(at.x, at.y);
                        consume(game.drain());
                    }
                }
            }
        }, 240)
    };
});
canvas.addEventListener('pointerup', e => {
    if (!pointer || pointer.id !== e.pointerId)
        return;
    window.clearTimeout(pointer.timer);
    pointer = null;
});
canvas.addEventListener('pointercancel', () => {
    if (pointer)
        window.clearTimeout(pointer.timer);
    pointer = null;
});
window.addEventListener('keydown', e => {
    if (!playing || paused || !document.getElementById('settingsOverlay')?.classList.contains('hidden'))
        return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'h', 'H', 'a', 'A', 'p', 'P', 'Escape'].includes(e.key))
        e.preventDefault();
    if (e.key === 'ArrowLeft')
        selected.x = Math.max(0, selected.x - 1);
    if (e.key === 'ArrowRight')
        selected.x = Math.min(9, selected.x + 1);
    if (e.key === 'ArrowUp')
        selected.y = Math.max(0, selected.y - 1);
    if (e.key === 'ArrowDown')
        selected.y = Math.min(13, selected.y + 1);
    if (e.key === 'Enter' || e.key === ' ')
        inputTile(selected.x, selected.y);
    if (e.key === 'a' || e.key === 'A')
        performAssist();
    if (e.key.startsWith('Arrow'))
        inspectSelected();
    if (e.key === 'h' || e.key === 'H')
        inputTile(selected.x, selected.y, true);
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape')
        void pause();
});
const rgb = (hex) => { const s = hex.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
function computeEdges(board, tile) {
    const { x, y, type, group } = tile;
    const tTop = board[y - 1]?.[x];
    const tRight = board[y]?.[x + 1];
    const tBottom = board[y + 1]?.[x];
    const tLeft = board[y]?.[x - 1];
    if (group !== null) {
        const g = game?.groups.get(group);
        return {
            top: tTop?.group === group,
            right: tRight?.group === group,
            bottom: tBottom?.group === group,
            left: tLeft?.group === group,
            queued: !!g && g.readyPass > (game?.pass ?? 0)
        };
    }
    return {
        sameTop: !!(tTop && tTop.group === null && tTop.type === type),
        sameRight: !!(tRight && tRight.group === null && tRight.type === type),
        sameBottom: !!(tBottom && tBottom.group === null && tBottom.type === type),
        sameLeft: !!(tLeft && tLeft.group === null && tLeft.type === type)
    };
}
function tileDraw(tile, x, y, now, glow, edges = {}) {
    const g = tile.group === null ? undefined : game?.groups.get(tile.group);
    const held = !!g?.held, active = !!g, phase = conductor.sweep;
    const nearCross = !!g && g.readyPass <= (game?.pass ?? 0) && g.state !== 'held' && phase <= ((tile.x + 0.5) / 10) && ((tile.x + 0.5) / 10 - phase) < 0.04;
    ctx.save();
    if (nearCross && !settings.reducedMotion) {
        ctx.translate(x + 36, y + 36);
        ctx.scale(1.06, 0.94);
        ctx.translate(-x - 36, -y - 36);
    }
    renderTile(ctx, skin(), tile, x, y, active, held, phase, settings.flash, glow, edges);
    ctx.restore();
}
function draw(now) {
    const w = 720, h = 1008, s = skin();
    ctx.save();
    ctx.fillStyle = s.back;
    ctx.fillRect(0, 0, w, h);
    // Subtle deep atmospheric well gradient
    const bg = ctx.createRadialGradient(w / 2, h * 0.68, 20, w / 2, h * 0.58, h * 0.95);
    bg.addColorStop(0, rgba(s.accent, 0.1));
    bg.addColorStop(1, '#05070f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const phase = conductor.ready ? conductor.sweep : (now / 11000) % 1;
    const beat = conductor.ready ? conductor.absoluteStep % 16 : Math.floor(now / 160) % 16;
    const activeCol = Math.floor(phase * 10);
    // Subtle illuminated column under the sweepline
    ctx.fillStyle = rgba(s.accent, 0.035);
    ctx.fillRect(activeCol * 72, 0, 72, h);
    // Clean, understated grid lines
    ctx.strokeStyle = '#ffffff0a';
    ctx.lineWidth = 1;
    for (let x = 1; x < 10; x++) {
        ctx.beginPath();
        ctx.moveTo(x * 72 + 0.5, 0);
        ctx.lineTo(x * 72 + 0.5, h);
        ctx.stroke();
    }
    for (let y = 1; y < 14; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * 72 + 0.5);
        ctx.lineTo(w, y * 72 + 0.5);
        ctx.stroke();
    }
    // Danger Zone ceiling band (Row 0)
    ctx.fillStyle = '#ff4d6d14';
    ctx.fillRect(0, 0, w, 72);
    ctx.strokeStyle = '#ff597b66';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.lineTo(w, 72);
    ctx.stroke();
    ctx.setLineDash([]);
    if (game) {
        const flight = game.flight;
        const flightMap = new Map(flight?.tiles.map(f => [f.id, f]) ?? []);
        const shown = game.board.flat().filter((t) => !!t);
        // Smooth 150ms upward slide animation when a new pressure row pushes the wall up
        const riseAge = now - pressureRiseBorn;
        const riseOffsetPx = (!settings.reducedMotion && riseAge >= 0 && riseAge < 160)
            ? Math.pow(1 - riseAge / 160, 2.4) * 72
            : 0;
        // Neighbour lighting map
        const heat = new Map();
        for (const other of shown) {
            if (other.group === null)
                continue;
            const strength = game.groups.get(other.group)?.held ? 2.4 : 1.2;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const distance = Math.abs(dx) + Math.abs(dy);
                    if (distance === 0 || distance > 2)
                        continue;
                    const key = (other.y + dy) * 10 + (other.x + dx);
                    heat.set(key, Math.max(heat.get(key) ?? 0, strength / distance));
                }
            }
        }
        const nearby = (tile) => heat.get(tile.y * 10 + tile.x) ?? 0;
        const snap = now < hitstopUntil && !settings.reducedMotion;
        // Draw incoming pressure row preview dimmed inside the bottom edge of the well
        const forecast = game.nextPressureBars;
        if (forecast !== null) {
            const nextTypes = game.previewNextRow();
            const previewAlpha = forecast === 1 ? (0.28 + 0.14 * Math.sin(phase * Math.PI * 4)) : 0.12;
            const stripH = forecast === 1 ? 12 : 6;
            for (let x = 0; x < 10; x++) {
                const c = s.palette[nextTypes[x] ?? 0];
                ctx.fillStyle = rgba(c, previewAlpha);
                ctx.fillRect(x * 72 + 4, h - stripH, 64, stripH);
            }
        }
        // Draw all tiles with connected cluster edges
        for (const tile of shown) {
            const f = flightMap.get(tile.id);
            const pos = f ? game.flightPosition(f, conductor.elapsed) : { x: tile.x, y: tile.y };
            const edges = (f && f.moved) ? {} : computeEdges(game.board, tile);
            const drawX = pos.x * 72;
            const drawY = pos.y * 72 + riseOffsetPx;
            if (snap) {
                ctx.save();
                ctx.translate(drawX + 36, drawY + 36);
                ctx.scale(1.03, 0.97);
                ctx.translate(-(drawX + 36), -(drawY + 36));
            }
            tileDraw(tile, drawX, drawY, now, nearby(tile), edges);
            if (snap)
                ctx.restore();
        }
        // Draw 8-way Overcharge blast radius indicator around Held groups
        for (const g of game.groups.values()) {
            if (!g.held)
                continue;
            const tiles = g.tiles.map(id => game.getTile(id)).filter((t) => !!t);
            if (!tiles.length)
                continue;
            const minX = Math.max(0, Math.min(...tiles.map(t => t.x)) - 1);
            const maxX = Math.min(9, Math.max(...tiles.map(t => t.x)) + 1);
            const minY = Math.max(0, Math.min(...tiles.map(t => t.y)) - 1);
            const maxY = Math.min(13, Math.max(...tiles.map(t => t.y)) + 1);
            ctx.save();
            ctx.strokeStyle = rgba('#ffe49e', 0.45 + 0.25 * Math.sin(phase * Math.PI * 8));
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 6]);
            ctx.strokeRect(minX * 72 + 2, minY * 72 + 2 + riseOffsetPx, (maxX - minX + 1) * 72 - 4, (maxY - minY + 1) * 72 - 4);
            ctx.restore();
        }
        const lineX = phase * w;
        renderSweep(ctx, s, lineX, w, h, settings.flash, conductor.elapsed * 1000);
        if (s.sweep !== 'hidden' && progress.persona !== 'blade') {
            ctx.save();
            ctx.globalAlpha = settings.strobeFree ? 0.55 : Math.max(0.2, settings.flash);
            if (progress.persona === 'echo') {
                for (let i = 1; i <= 3; i++) {
                    ctx.strokeStyle = rgba(s.accent, 0.4 / i);
                    ctx.lineWidth = 4 / i;
                    ctx.beginPath();
                    ctx.moveTo(lineX - i * 16, 0);
                    ctx.lineTo(lineX - i * 16, h);
                    ctx.stroke();
                }
            }
            else {
                for (let j = -1; j <= 1; j++) {
                    ctx.strokeStyle = j === 0 ? '#ffffff' : s.palette[(j + 4) % 4];
                    ctx.lineWidth = j === 0 ? 2.5 : 5;
                    ctx.beginPath();
                    ctx.moveTo(lineX + j * 8, 0);
                    ctx.lineTo(lineX - j * 8, h);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
        if (playing && !paused && game.combo >= 4 && !settings.strobeFree) {
            ctx.fillStyle = rgba(s.accent, settings.flash * 0.015);
            ctx.fillRect(0, 0, w, h);
        }
    }
    else {
        // Menu attract background board
        for (let y = 6; y < 14; y++) {
            for (let x = 0; x < 10; x++) {
                if ((x * 19 + y * 7) % 9 > 1) {
                    const i = (x * 31 + y * 17) % 4;
                    tileDraw({ id: 0, x, y, type: i, group: null }, x * 72, y * 72, now, 0);
                }
            }
        }
        renderSweep(ctx, s, phase * w, w, h, 0.45, now);
    }
    // Shockwave rings
    bursts = bursts.filter(b => now - b.born < 620);
    for (const burst of bursts) {
        const dt = (now - burst.born) / 620;
        const ease = 1 - Math.pow(1 - dt, 3);
        const rad = (20 + 130 * ease) * burst.power;
        ctx.strokeStyle = rgba(burst.color, (1 - dt) * settings.flash * 0.85);
        ctx.lineWidth = 5 * (1 - dt);
        ctx.beginPath();
        ctx.arc((burst.x + 0.5) * 72, (burst.y + 0.5) * 72, rad, 0, Math.PI * 2);
        ctx.stroke();
    }
    // Shatter debris particles
    debris = debris.filter(p => now - p.born < 640);
    if (!settings.reducedMotion) {
        for (const particle of debris) {
            const t = (now - particle.born) / 1000;
            const x = particle.x + particle.vx * 95 * t;
            const y = particle.y + particle.vy * 95 * t + 190 * t * t;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(t * particle.vx * 0.9);
            ctx.fillStyle = rgba(particle.color, Math.max(0, 1 - t * 1.55));
            const size = particle.shape === 1 ? 9 : 6;
            ctx.fillRect(-size / 2, -size / 2, size, size);
            ctx.restore();
        }
    }
    // In-canvas floating score & multiplier popups right over detonations
    popups = popups.filter(p => now - p.born < 820);
    for (const pop of popups) {
        const dt = (now - pop.born) / 820;
        const alpha = dt < 0.2 ? dt / 0.2 : Math.max(0, 1 - (dt - 0.2) / 0.8);
        const yy = pop.y - dt * 48;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = '900 30px "Barlow Condensed", sans-serif';
        ctx.fillStyle = '#070811cc';
        ctx.fillText(pop.text, pop.x + 2, yy + 2);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, pop.x, yy);
        if (pop.sub) {
            ctx.font = '800 13px "DM Sans", sans-serif';
            ctx.fillStyle = '#ffd670';
            ctx.fillText(pop.sub, pop.x, yy - 24);
        }
        ctx.restore();
    }
    if (replayShown && !$('resultOverlay').classList.contains('hidden')) {
        const preview = $('replayCanvas'), rctx = preview.getContext('2d');
        if (rctx) {
            const frame = replayFrameAt(replayShown, now - replayStartMs);
            if (frame) {
                rctx.fillStyle = '#090c16';
                rctx.fillRect(0, 0, 720, 1008);
                for (let n = 0; n < frame.cells.length; n++) {
                    const value = frame.cells[n];
                    if (value < 0)
                        continue;
                    const type = value % 4, primed = value >= 4, held = value >= 8, x = n % 10 * 72, y = Math.floor(n / 10) * 72;
                    rctx.fillStyle = s.palette[type];
                    rctx.globalAlpha = primed ? 1 : 0.73;
                    rctx.fillRect(x + 3, y + 3, 66, 66);
                    rctx.strokeStyle = held ? '#ffffff' : primed ? '#edcde8' : '#20232c';
                    rctx.lineWidth = held ? 5 : 2;
                    rctx.strokeRect(x + 4, y + 4, 64, 64);
                }
                rctx.globalAlpha = 1;
                rctx.strokeStyle = '#fff9';
                rctx.lineWidth = 5;
                rctx.beginPath();
                const rx = frame.step / 16 * 720;
                rctx.moveTo(rx, 0);
                rctx.lineTo(rx, 1008);
                rctx.stroke();
                for (const pos of frame.blasts) {
                    const x = (pos % 10 + 0.5) * 72, y = (Math.floor(pos / 10) + 0.5) * 72;
                    rctx.strokeStyle = '#ffdfad';
                    rctx.lineWidth = 7;
                    rctx.beginPath();
                    rctx.arc(x, y, 47, 0, 2 * Math.PI);
                    rctx.stroke();
                }
            }
        }
    }
    document.querySelectorAll('#beatline b').forEach((el, i) => el.classList.toggle('lit', Math.floor(beat / 4) === i));
    ctx.restore();
}
function tick(now) {
    frameTime = now;
    if (game && playing && !paused && !game.over) {
        const next = conductor.absoluteStep, previousStep = game.step;
        if (next > game.step)
            game.advanceTo(next);
        game.advancePhysics(conductor.elapsed);
        const events = game.drain();
        if (events.length || game.step !== previousStep)
            consume(events);
        recorder.capture(game.pass, game.step, game.stats.score, game.board, game.groups, events.filter(e => e.kind === 'burst').map(e => e.y * 10 + e.x));
        if (settings.autoPrime && !tutorialActive && mode !== 'daily' && game.pass > lastAssistPass && !game.flight) {
            lastAssistPass = game.pass;
            performAssist(true);
        }
        danger();
        conductor.setRank(Math.floor(game.combo / 3));
    }
    draw(now);
    requestAnimationFrame(tick);
}
$('assistBtn').addEventListener('click', () => performAssist());
$('tutorialBtn').addEventListener('click', () => { trainingReplay = true; lesson = 'prime'; feedback('LEARNING PATH ARMED / START A SESSION'); });
$('nextMovementBtn').addEventListener('click', () => { if (mode === 'odyssey' && skinIndex < 5) {
    skinIndex++;
    void start();
} });
$('startBtn').addEventListener('click', () => void start());
document.querySelectorAll('.mode-option').forEach(btn => btn.addEventListener('click', () => selectMode(btn.dataset.mode)));
$('pauseBtn').addEventListener('click', () => void pause());
$('resumeBtn').addEventListener('click', () => void resume());
$('quitBtn').addEventListener('click', () => void home());
$('home').addEventListener('click', e => { e.preventDefault(); if (playing)
    void pause();
else
    void home(); });
$('againBtn').addEventListener('click', () => void start());
$('resultsHomeBtn').addEventListener('click', () => void home());
$('soundBtn').addEventListener('click', () => { settings.mute = !settings.mute; conductor.setMuted(settings.mute); $('soundBtn').textContent = settings.mute ? '◖×' : '◖))'; save(); });
$('menuSettingsBtn').addEventListener('click', () => show('settingsOverlay', true));
$('settingsBtn').addEventListener('click', () => { if (playing && !paused)
    void pause(); show('settingsOverlay', true); });
$('closeSettings').addEventListener('click', () => show('settingsOverlay', false));
const volume = $('volume'), flash = $('flash');
volume.value = String(settings.volume * 100);
flash.value = String(settings.flash * 100);
volume.addEventListener('input', () => { settings.volume = +volume.value / 100; conductor.setVolume(settings.volume); save(); });
flash.addEventListener('input', () => { settings.flash = +flash.value / 100; save(); });
for (const key of ['strobeFree', 'reducedMotion', 'haptics', 'autoPrime', 'highContrast']) {
    const input = $(key);
    input.checked = settings[key];
    input.addEventListener('change', () => {
        settings[key] = input.checked;
        if (key === 'highContrast')
            $('boardFrame').classList.toggle('high-contrast', settings.highContrast);
        save();
    });
}
const speed = $('bpmScale');
speed.value = String(settings.bpmScale);
speed.addEventListener('change', () => { settings.bpmScale = Number(speed.value); save(); movementInfo(); });
window.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused)
    void pause(); });
selectMode('odyssey');
setHud();
requestAnimationFrame(tick);
