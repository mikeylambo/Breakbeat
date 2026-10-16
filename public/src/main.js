import { GemRules } from './content/gems/GemRules.js';
import { Pulse } from './pulse/Pulse.js';
import { Conductor } from './pulse/Conductor.js';
import { skins } from './content/skins.js';
import { T } from './tuning.js';
import { renderTile, renderSweep } from './content/MaterialRenderer.js';
import { migrateProgress, rankFor, personaUnlock, normalizedScore, recordResult } from './experience/Progression.js';
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
const settings = getSaved(settingsKey, { volume: .7, flash: .7, strobeFree: false, reducedMotion: false, haptics: true, mute: false, autoPrime: false, highContrast: false, bpmScale: 1 });
let progress;
try {
    progress = migrateProgress(JSON.parse(localStorage.getItem(progressKey) || 'null'));
}
catch {
    progress = migrateProgress(null);
}
settings.bpmScale = [.8, .9, 1, 1.1, 1.2].includes(settings.bpmScale) ? settings.bpmScale : 1;
const recorder = new PassRecorder();
let lesson = 'prime', tutorialActive = !progress.tutorialComplete, trainingReplay = false, assistUsed = false, lastAssistPass = 0;
let replayShown = null, replayStartMs = 0, feedbackTimeout = 0, sessionId = 0;
let mode = 'odyssey', skinIndex = 0, game = null, playing = false, paused = false, finished = false, frameTime = 0;
let selected = { x: 4, y: 10 }, hitstopUntil = 0;
let bursts = [];
let debris = [];
let menuPhase = 'menu';
function sessionBpm() { return Math.round(skin().bpm * (mode === 'daily' ? 1 : settings.bpmScale)); }
function currentScale() { return mode === 'daily' ? 1 : settings.bpmScale; }
function scoreNow() { return normalizedScore(game?.stats.score ?? 0, currentScale()); }
function recordKey() { return `${mode}:${skin().id}${assistUsed ? ':assisted' : ''}`; }
function feedback(text) { const el = $('feedbackToast'); el.textContent = text; el.classList.add('active'); window.clearTimeout(feedbackTimeout); feedbackTimeout = window.setTimeout(() => el.classList.remove('active'), 1600); }
function tip() {
    if (!tutorialActive) {
        $('tipTitle').textContent = 'CONDUCT THE WALL';
        $('tipBody').textContent = 'Prime multiple groups for resonance. Hold one for an explosive second pass.';
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
        feedback('LESSONS COMPLETE / YOU ARE THE CONDUCTOR');
    }
    else
        feedback(LESSONS[lesson].action);
}
function findCandidate() {
    if (!game || game.flight)
        return null;
    let candidate = null;
    for (let y = 0; y < T.BOARD_ROWS; y++)
        for (let x = 0; x < T.BOARD_COLS; x++) {
            const len = game.rules.primeable(game.board, x, y).length;
            if (len >= T.MIN_GROUP && (!candidate || len > candidate.size))
                candidate = { x, y, size: len };
        }
    return candidate;
}
function performAssist(auto = false) {
    if (!game || !playing || paused || mode === 'daily' || game.flight)
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
    $('boardFrame').classList.toggle('danger-warn', highest < 7 && highest >= 4);
    $('boardFrame').classList.toggle('danger-critical', highest < 4);
    $('dangerText').textContent = highest < 4 ? '◆ CRITICAL / CLEAR NOW' : highest < 7 ? '◆ PRESSURE RISING' : '◂ DANGER ZONE';
}
function movementInfo() {
    $('journeyOverview').classList.toggle('hidden', mode !== 'odyssey');
    const completed = new Set(progress.completed);
    $('journeyHeadline').textContent = `MOVEMENT ${String(skinIndex + 1).padStart(2, '0')} / 06`;
    $('journeyTrack').textContent = Array.from({ length: 6 }, (_, i) => completed.has(String(i)) ? '◆' : i === skinIndex ? '◇' : '·').join(' ');
    const key = `${mode}:${skin().id}`, record = progress.records[key], best = progress.best[key] ?? 0;
    $('movementInfo').innerHTML = `<strong>${skin().name}</strong> / ${skin().subtitle.toUpperCase()} &nbsp; · &nbsp; ${best ? `BEST ${fmt(best)} / ${rankFor(best)}` : 'UNPLAYED'}${record?.assisted ? ' (ASSISTED)' : ''}`;
    renderPersonas();
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
    let title = mode === 'daily' ? 'START DAILY DESCENT' : mode === 'zen' ? 'ENTER THE FLOW' : mode === 'endless' ? 'START ENDLESS' : 'PLAY ' + skin().name;
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
    $('multiplier').textContent = `×${Math.min(3, 1 + game.combo * .1).toFixed(1)}`;
    $('barText').textContent = `BAR ${String(game.pass || 1).padStart(3, '0')}`;
    $('sweepLabel').textContent = `${Math.floor((conductor.absoluteStep % 16) / 4) + 1} / 04`;
    $('bpmText').textContent = `${sessionBpm()} BPM`;
    $('trackTitle').textContent = skin().name;
}
function triggerHaptic(pattern) { if (settings.haptics && 'vibrate' in navigator)
    navigator.vibrate(pattern); }
function burstScore(points) { const el = $('floatingScore'); el.textContent = `+${Math.floor(points).toLocaleString()}`; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
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
                    feedback('AIR PRIME +25%');
                break;
            }
            case 'hold': {
                conductor.hold(event.groupId, event.atStep);
                triggerHaptic([14, 30, 14]);
                learn({ kind: 'hold' });
                feedback('HOLD / OVERCHARGE ARMED');
                break;
            }
            case 'burst': {
                conductor.release(event.groupId);
                conductor.effect(event.overcharged ? 'over' : 'burst', event.type, event.atStep);
                burstScore(event.points);
                triggerHaptic(event.overcharged ? skin().haptic.over : skin().haptic.burst);
                if (event.overcharged)
                    conductor.overchargeDrop(event.atStep);
                const now = performance.now(), c = color(event.type);
                bursts.push({ x: event.x, y: event.y, born: now, color: c, power: event.overcharged ? 2 : 1 });
                for (let i = 0; i < Math.min(24, event.ids.length * 4); i++) {
                    const angle = i * 2.39996 + (event.groupId % 7), speed = (event.overcharged ? 8 : 5) * (0.65 + (i % 5) * .18);
                    debris.push({ x: (event.x + .5) * 72, y: (event.y + .5) * 72, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, color: c, shape: (event.groupId + i) % 4 });
                }
                if (event.resonance >= 4 && !settings.reducedMotion)
                    hitstopUntil = now + 60;
                learn({ kind: 'burst', overcharged: event.overcharged });
                if (event.overcharged)
                    feedback('OVERCHARGE ×2');
                else if (event.resonance >= 3)
                    feedback(`RESONANCE ×${event.resonance}`);
                break;
            }
            case 'cascade': {
                if (event.ids.length)
                    conductor.effect('slide', 0, event.atStep);
                break;
            }
            case 'land': break;
            case 'pressure': {
                danger();
                break;
            }
            case 'end':
                void end(false);
                break;
        }
    }
    // Overcharge can consume neighbouring primed groups: no dangling sustained notes.
    conductor.syncGroups(new Set(game.groups.keys()));
    if (mode === 'odyssey' && !finished && game.stats.score >= [3600, 5600, 7600, 10000, 12500, 15000][skinIndex]) {
        end(true);
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
    game = new Pulse({ seed: mode === 'daily' ? `breakbeat:${today()}` : `breakbeat:${mode}:${skin().id}:${Math.random().toString(36).slice(2)}`, mode, bpm: sessionBpm() }, new GemRules());
    selected = { x: 4, y: 10 };
    bursts = [];
    debris = [];
    hitstopUntil = 0;
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
    const result = recordResult(progress, key, { score, bestPass: normalizedScore(game.stats.bestPass, currentScale()), longestCombo: game.stats.longestCombo, overcharges: game.stats.overcharges, airPrimes: game.stats.airPrimes, survivalSeconds: Math.round(conductor.elapsed), date: today(), assisted: assistUsed }, recorder.best);
    if (mode === 'daily')
        progress.daily[today()] = score;
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
    $('unlockPanel').classList.toggle('hidden', !newlyUnlocked.length && !success);
    $('unlockPanel').textContent = [success ? `MOVEMENT ${skinIndex + 1} COMPLETE${skinIndex < 5 ? ' • NEXT MOVEMENT UNLOCKED' : ' • ODYSSEY COMPLETE'}` : '', ...newlyUnlocked.map(p => `NEW SWEEP PERSONA UNLOCKED: ${p.toUpperCase()}`)].filter(Boolean).join(' / ');
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
    await conductor.stop();
    game = null;
    show('pauseOverlay', false);
    show('resultOverlay', false);
    show('menuOverlay', true);
    $('pauseBtn').setAttribute('disabled', 'true');
    $('assistBtn').setAttribute('disabled', 'true');
    $('modeLabel').textContent = 'THE RHYTHM DEMOLITION EXPERIMENT';
    renderSkinRow();
    updateStartLabel();
    movementInfo();
    setHud();
}
function tileAt(clientX, clientY) { const r = canvas.getBoundingClientRect(); return { x: Math.floor((clientX - r.left) / r.width * T.BOARD_COLS), y: Math.floor((clientY - r.top) / r.height * T.BOARD_ROWS) }; }
function inputTile(x, y, held = false) {
    if (!game || !playing || paused || finished)
        return;
    if (x < 0 || x >= T.BOARD_COLS || y < 0 || y >= T.BOARD_ROWS)
        return;
    selected = { x, y };
    inspectSelected();
    if (held) {
        if (!game.hold(x, y))
            conductor.effect('error');
    }
    else {
        const id = game.flight ? game.primeAir(x, y, conductor.elapsed) : game.prime(x, y);
        if (id === null)
            conductor.effect('error');
    }
    consume(game.drain());
}
let pointer = null;
canvas.addEventListener('pointerdown', e => {
    if (!playing || paused)
        return;
    e.preventDefault();
    const at = tileAt(e.clientX, e.clientY);
    const id = e.pointerId;
    canvas.setPointerCapture(id);
    pointer = { id, ...at, held: false, timer: window.setTimeout(() => { if (pointer?.id === id) {
            pointer.held = true;
            inputTile(at.x, at.y, true);
        } }, T.HOLD_MS) };
});
canvas.addEventListener('pointerup', e => { if (!pointer || pointer.id !== e.pointerId)
    return; window.clearTimeout(pointer.timer); if (!pointer.held) {
    const at = tileAt(e.clientX, e.clientY);
    if (at.x === pointer.x && at.y === pointer.y)
        inputTile(at.x, at.y);
} pointer = null; });
canvas.addEventListener('pointercancel', () => { if (pointer)
    window.clearTimeout(pointer.timer); pointer = null; });
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
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rgb = (hex) => { const s = hex.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
function tileDraw(tile, x, y, now, glow) {
    const g = tile.group === null ? undefined : game?.groups.get(tile.group);
    const held = !!g?.held, active = !!g, phase = conductor.sweep;
    const nearCross = !!g && g.state === 'active' && phase <= ((tile.x + .5) / 10) && ((tile.x + .5) / 10 - phase) < .035;
    ctx.save();
    if (nearCross && !settings.reducedMotion) {
        ctx.translate(x + 36, y + 36);
        ctx.scale(1.07, .93);
        ctx.translate(-x - 36, -y - 36);
    }
    renderTile(ctx, skin(), tile, x, y, active, held, phase, settings.flash, glow);
    ctx.restore();
}
function draw(now) {
    const w = 720, h = 1008, s = skin();
    ctx.save();
    ctx.fillStyle = s.back;
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h * .72, 20, w / 2, h * .6, h * .95);
    bg.addColorStop(0, s.texture === 'phosphor' ? '#162859bb' : s.texture === 'glass' ? '#4730449e' : '#25304680');
    bg.addColorStop(1, '#06081211');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (s.texture === 'phosphor') {
        ctx.fillStyle = '#7aa0cf0c';
        for (let yy = 2; yy < h; yy += 9)
            ctx.fillRect(0, yy, w, 2);
    }
    if (s.texture === 'stone') {
        ctx.strokeStyle = '#ffffff0b';
        for (let yy = 3; yy < h; yy += 72) {
            ctx.beginPath();
            ctx.moveTo(0, yy);
            ctx.lineTo(w, yy);
            ctx.stroke();
        }
    }
    if (s.texture === 'crystal') {
        ctx.strokeStyle = '#9dc4ed12';
        for (let i = 0; i < 18; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 60, 0);
            ctx.lineTo(i * 30, h);
            ctx.stroke();
        }
    }
    ctx.strokeStyle = '#9da9be17';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 10; x++) {
        ctx.beginPath();
        ctx.moveTo(x * 72 + .5, 0);
        ctx.lineTo(x * 72 + .5, h);
        ctx.stroke();
    }
    for (let y = 0; y <= 14; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * 72 + .5);
        ctx.lineTo(w, y * 72 + .5);
        ctx.stroke();
    }
    const phase = conductor.ready ? conductor.sweep : (now / 11000) % 1;
    const beat = conductor.ready ? conductor.absoluteStep % 16 : Math.floor(now / 160) % 16;
    ctx.fillStyle = '#ff597219';
    ctx.fillRect(0, 0, w, 72);
    ctx.strokeStyle = '#ff597b99';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.lineTo(w, 72);
    ctx.stroke();
    if (game) {
        const flight = game.flight, flightMap = new Map(flight?.tiles.map(f => [f.id, f]) ?? []);
        const shown = game.board.flat().filter((t) => !!t);
        // Neighbour lighting is O(tiles) instead of O(tiles²) to protect mobile frame pacing.
        const heat = new Map();
        for (const other of shown) {
            if (other.group === null)
                continue;
            const strength = game.groups.get(other.group)?.held ? 2.5 : 1.4;
            for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                    const distance = Math.abs(dx) + Math.abs(dy);
                    if (distance === 0 || distance > 2)
                        continue;
                    const key = (other.y + dy) * 10 + (other.x + dx);
                    heat.set(key, Math.max(heat.get(key) ?? 0, strength / distance));
                }
        }
        const nearby = (tile) => heat.get(tile.y * 10 + tile.x) ?? 0;
        const snap = now < hitstopUntil && !settings.reducedMotion;
        for (const tile of shown) {
            const f = flightMap.get(tile.id), pos = f ? game.flightPosition(f, conductor.elapsed) : { x: tile.x, y: tile.y };
            if (snap) {
                ctx.save();
                ctx.translate((tile.x + .5) * 72, (tile.y + .5) * 72);
                ctx.scale(1.035, .965);
                ctx.translate(-(tile.x + .5) * 72, -(tile.y + .5) * 72);
            }
            tileDraw(tile, pos.x * 72, pos.y * 72, now, nearby(tile));
            if (snap)
                ctx.restore();
        }
        const lineX = phase * w;
        renderSweep(ctx, s, lineX, w, h, settings.flash, conductor.elapsed * 1000);
        if (s.sweep !== 'hidden' && progress.persona !== 'blade') {
            ctx.save();
            ctx.globalAlpha = settings.strobeFree ? .55 : Math.max(.2, settings.flash);
            const x = lineX;
            if (progress.persona === 'echo') {
                for (let i = 1; i <= 3; i++) {
                    ctx.strokeStyle = rgba(s.accent, .43 / i);
                    ctx.lineWidth = 5 / i;
                    ctx.beginPath();
                    ctx.moveTo(x - i * 17, 0);
                    ctx.lineTo(x - i * 17, h);
                    ctx.stroke();
                }
            }
            else {
                for (let j = -1; j <= 1; j++) {
                    ctx.strokeStyle = j === 0 ? '#ffffff' : s.palette[(j + 4) % 4];
                    ctx.lineWidth = j === 0 ? 3 : 6;
                    ctx.beginPath();
                    ctx.moveTo(x + j * 9, 0);
                    ctx.lineTo(x - j * 9, h);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
        if (flight) {
            ctx.font = '800 16px sans-serif';
            ctx.fillStyle = '#ffffffdc';
            ctx.fillText('AIR CONTACT  •  TAP A FALLING PAIR', 14, h - 17);
            const progress = game.flightProgress(conductor.elapsed);
            ctx.fillStyle = '#ffffff6c';
            ctx.fillRect(0, h - 6, w * progress, 6);
        }
        if (playing && !paused && game.combo >= 4 && !settings.strobeFree) {
            ctx.fillStyle = rgba(s.accent, settings.flash * .018);
            ctx.fillRect(0, 0, w, h);
        }
        if (playing && matchMedia('(pointer:fine)').matches) {
            ctx.strokeStyle = '#ffffffb8';
            ctx.lineWidth = 2;
            ctx.strokeRect(selected.x * 72 + 2, selected.y * 72 + 2, 68, 68);
        }
    }
    else {
        for (let y = 6; y < 14; y++)
            for (let x = 0; x < 10; x++)
                if ((x * 19 + y * 7) % 9 > 1) {
                    const i = (x * 31 + y * 17) % 4;
                    tileDraw({ id: 0, x, y, type: i, group: null }, x * 72, y * 72, now, 0);
                }
        renderSweep(ctx, s, phase * w, w, h, .45, now);
    }
    bursts = bursts.filter(b => now - b.born < 650);
    for (const burst of bursts) {
        const dt = (now - burst.born) / 650, rad = (24 + 135 * dt) * burst.power;
        ctx.strokeStyle = rgba(burst.color, (1 - dt) * settings.flash * .75);
        ctx.lineWidth = 6 * (1 - dt);
        ctx.beginPath();
        ctx.arc((burst.x + .5) * 72, (burst.y + .5) * 72, rad, 0, Math.PI * 2);
        ctx.stroke();
    }
    debris = debris.filter(p => now - p.born < 660);
    if (!settings.reducedMotion)
        for (const particle of debris) {
            const t = (now - particle.born) / 1000, x = particle.x + particle.vx * 95 * t, y = particle.y + particle.vy * 95 * t + 160 * t * t;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(t * particle.vx * .8);
            ctx.fillStyle = rgba(particle.color, Math.max(0, 1 - t * 1.6));
            const size = particle.shape === 1 ? 8 : 5;
            ctx.fillRect(-size / 2, -size / 2, size, size);
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
                    rctx.globalAlpha = primed ? 1 : .73;
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
                    const x = (pos % 10 + .5) * 72, y = (Math.floor(pos / 10) + .5) * 72;
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
    input.addEventListener('change', () => { settings[key] = input.checked; if (key === 'highContrast')
        $('boardFrame').classList.toggle('high-contrast', settings.highContrast); save(); });
}
const speed = $('bpmScale');
speed.value = String(settings.bpmScale);
speed.addEventListener('change', () => { settings.bpmScale = Number(speed.value); save(); movementInfo(); });
window.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused)
    void pause(); });
// No service worker is registered: offline play requires a locally cached installation or packaged build.
selectMode('odyssey');
setHud();
requestAnimationFrame(tick);
