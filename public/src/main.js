import { GemRules } from './content/gems/GemRules.js';
import { Pulse } from './pulse/Pulse.js';
import { Conductor } from './pulse/Conductor.js';
import { skins, mastery } from './content/skins.js';
import { T } from './tuning.js';
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
const settings = getSaved(settingsKey, { volume: .7, flash: .7, strobeFree: false, reducedMotion: false, haptics: true, mute: false });
const progress = getSaved(progressKey, { unlocked: 1, best: {}, daily: {} });
let mode = 'odyssey', skinIndex = 0, game = null, playing = false, paused = false, finished = false, frameTime = 0;
let selected = { x: 4, y: 10 }, fallingUntil = 0, transition = new Map();
let bursts = [];
let menuPhase = 'menu';
let hintStage = 0;
const cues = [
    ['FIND YOUR FIRST GROUP', 'Tap two or more touching blocks of the same colour.'],
    ['LET THE SWEEP PLAY', 'Every group you prime breaks on the next sweep. No timing judgment.'],
    ['GO BIGGER', 'Prime multiple groups for a resonance chain.'],
    ['HOLD TO OVERCHARGE', 'Long-press a primed group to skip a sweep, then explode outward.'],
    ['CATCH THE FALL', 'Tap connecting colours while tiles are falling for an air-prime bonus.']
];
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
function tip(index) { if (index <= hintStage && index !== 0)
    return; hintStage = index; const item = cues[Math.min(index, cues.length - 1)]; $('tipTitle').textContent = item[0]; $('tipBody').textContent = item[1]; }
function selectMode(next) {
    mode = next;
    document.querySelectorAll('.mode-option').forEach(el => el.classList.toggle('selected', el.dataset.mode === mode));
    $('dailySub').textContent = mode === 'daily' ? 'Local daily attempt • unranked without server' : 'A new pattern each UTC day.';
    if (mode === 'daily')
        skinIndex = new Date().getUTCDate() % Math.min(progress.unlocked, skins.length);
    renderSkinRow();
    updateStartLabel();
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
        btn.addEventListener('click', () => { skinIndex = i; renderSkinRow(); updateStartLabel(); });
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
    $('score').textContent = fmt(game.stats.score);
    $('rank').textContent = game.combo >= 12 ? 'RESONANT' : game.combo >= 8 ? 'FRENZY' : game.combo >= 4 ? 'DRIVE' : game.combo >= 2 ? 'GROOVE' : 'PULSE';
    $('multiplier').textContent = `×${Math.min(3, 1 + game.combo * .1).toFixed(1)}`;
    $('barText').textContent = `BAR ${String(game.pass || 1).padStart(3, '0')}`;
    $('sweepLabel').textContent = `${Math.floor((conductor.absoluteStep % 16) / 4) + 1} / 04`;
    $('bpmText').textContent = `${skin().bpm} BPM`;
    $('trackTitle').textContent = skin().name;
}
function triggerHaptic(pattern) { if (settings.haptics && 'vibrate' in navigator)
    navigator.vibrate(pattern); }
function burstScore(points) { const el = $('floatingScore'); el.textContent = `+${Math.floor(points).toLocaleString()}`; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function consume(events, previous) {
    if (!game)
        return;
    for (const event of events) {
        switch (event.kind) {
            case 'prime': {
                const t = game.getTile(event.ids[0]);
                conductor.effect('prime', t?.type ?? 0);
                triggerHaptic(12);
                if (hintStage < 1)
                    tip(1);
                if (event.air)
                    tip(4);
                break;
            }
            case 'hold': {
                const t = game.getTile(event.ids[0]);
                conductor.effect('hold', t?.type ?? 0);
                triggerHaptic([14, 30, 14]);
                tip(3);
                break;
            }
            case 'burst': {
                conductor.effect(event.overcharged ? 'over' : 'burst', event.groupId % 4);
                burstScore(event.points);
                triggerHaptic(event.overcharged ? [30, 30, 45] : 20);
                bursts.push({ x: event.x, y: event.y, born: performance.now(), color: color(event.groupId % 4), power: event.overcharged ? 2 : 1 });
                if (event.overcharged)
                    tip(3);
                break;
            }
            case 'cascade': {
                if (event.ids.length) {
                    transition = new Map([...previous].filter(([id]) => event.ids.includes(id)));
                    fallingUntil = performance.now() + Math.max(T.AIR_FAIR_MS, 470 / T.FALL_SPEED_SCALE);
                    conductor.effect('slide');
                }
                break;
            }
            case 'pressure': {
                if (hintStage < 2)
                    tip(2);
                break;
            }
            case 'end':
                end(false);
                break;
        }
    }
    if (game.stats.groups > 2 && hintStage < 2)
        tip(2);
    if (mode === 'odyssey' && !finished && game.stats.score >= [3600, 5600, 7600, 10000, 12500, 15000][skinIndex]) {
        end(true);
    }
    setHud();
}
async function start() {
    if (mode === 'daily' && progress.daily[today()] !== undefined)
        return;
    finished = false;
    paused = false;
    hintStage = 0;
    tip(0);
    menuPhase = 'play';
    game = new Pulse({ seed: mode === 'daily' ? `breakbeat:${today()}` : `breakbeat:${mode}:${skin().id}:${Math.random().toString(36).slice(2)}`, mode, bpm: skin().bpm }, new GemRules());
    selected = { x: 4, y: 10 };
    transition.clear();
    bursts = [];
    fallingUntil = 0;
    conductor.muted = settings.mute;
    conductor.setVolume(settings.volume);
    await conductor.start(skin().bpm, skin().key);
    playing = true;
    show('menuOverlay', false);
    show('pauseOverlay', false);
    show('resultOverlay', false);
    $('pauseBtn').removeAttribute('disabled');
    $('modeLabel').textContent = mode === 'odyssey' ? `ODYSSEY / MOVEMENT ${String(skinIndex + 1).padStart(2, '0')}` : mode.toUpperCase().replace('ZEN', 'ZEN / FREE PLAY');
    announce(`Session started. ${mode}. ${skin().name}, ${skin().bpm} beats per minute.`);
    setHud();
}
async function end(success) {
    if (!game || finished)
        return;
    finished = true;
    playing = false;
    menuPhase = 'result';
    await conductor.setPause(true);
    game.stats.bestPass = Math.max(game.stats.bestPass, 0);
    const key = `${mode}:${skin().id}`, previousBest = progress.best[key] || 0;
    progress.best[key] = Math.max(previousBest, game.stats.score);
    if (mode === 'daily')
        progress.daily[today()] = game.stats.score;
    if (success && mode === 'odyssey')
        progress.unlocked = Math.max(progress.unlocked, Math.min(skinIndex + 2, skins.length));
    save();
    $('resultEyebrow').textContent = success ? 'MOVEMENT CLEARED // NEW TRACK UNLOCKED' : 'THE LAST BEAT';
    $('resultTitle').innerHTML = success ? 'WHAT A<br><span>RELEASE.</span>' : 'THE WALL<br><span>FELL.</span>';
    $('resultScore').textContent = fmt(game.stats.score);
    $('resultRank').textContent = `${mastery(game.stats.score)} / ${skin().name}`;
    $('bestPass').textContent = fmt(game.stats.bestPass);
    $('longestCombo').textContent = String(game.stats.longestCombo);
    $('overcharges').textContent = String(game.stats.overcharges);
    $('airPrimes').textContent = String(game.stats.airPrimes);
    show('pauseOverlay', false);
    show('resultOverlay', true);
    $('pauseBtn').setAttribute('disabled', 'true');
    announce('Run completed. Score ' + fmt(game.stats.score));
}
async function pause() { if (!playing || paused)
    return; paused = true; await conductor.setPause(true); show('pauseOverlay', true); announce('Game paused'); }
async function resume() { if (!playing || !paused)
    return; paused = false; show('pauseOverlay', false); await conductor.setPause(false); announce('Game resumed'); }
async function home() {
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
    $('modeLabel').textContent = 'THE RHYTHM DEMOLITION EXPERIMENT';
    renderSkinRow();
    updateStartLabel();
    setHud();
}
function tileAt(clientX, clientY) { const r = canvas.getBoundingClientRect(); return { x: Math.floor((clientX - r.left) / r.width * T.BOARD_COLS), y: Math.floor((clientY - r.top) / r.height * T.BOARD_ROWS) }; }
function inputTile(x, y, held = false) {
    if (!game || !playing || paused || finished)
        return;
    if (x < 0 || x >= T.BOARD_COLS || y < 0 || y >= T.BOARD_ROWS)
        return;
    selected = { x, y };
    const tile = game.board[y]?.[x];
    if (!tile)
        return;
    if (held) {
        if (!game.hold(x, y))
            conductor.effect('error');
    }
    else {
        const airborne = performance.now() < fallingUntil && game.falling.has(tile.id);
        if (game.prime(x, y, airborne) === null)
            conductor.effect('error');
    }
    consume(game.drain(), new Map());
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
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'h', 'H', 'p', 'P', 'Escape'].includes(e.key))
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
    if (e.key === 'h' || e.key === 'H')
        inputTile(selected.x, selected.y, true);
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape')
        void pause();
});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rgb = (hex) => { const s = hex.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
function tileDraw(t, x, y, now) {
    const u = 72, colorHex = color(t.type), g = t.group === null ? undefined : game?.groups.get(t.group);
    const ready = g && g.state !== 'queued', active = !!g, held = !!g?.held, beat = conductor.sweep;
    const glow = active ? (.55 + .25 * Math.sin(beat * Math.PI * 8)) : 0;
    if (active) {
        ctx.shadowBlur = held ? 28 : 16;
        ctx.shadowColor = colorHex;
    }
    const pad = 3 + (active ? Math.sin(beat * Math.PI * 8) * 1.2 : 0), xx = x + pad, yy = y + pad, w = u - 2 * pad;
    ctx.fillStyle = active ? colorHex : rgba(colorHex, .82);
    ctx.fillRect(xx, yy, w, w);
    ctx.shadowBlur = 0;
    const grad = ctx.createLinearGradient(xx, yy, xx + w, yy + w);
    grad.addColorStop(0, '#fff4');
    grad.addColorStop(.42, '#fff0');
    grad.addColorStop(1, '#080a1e77');
    ctx.fillStyle = grad;
    ctx.fillRect(xx, yy, w, w);
    ctx.strokeStyle = active ? '#fff9' : '#f3eaf054';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(xx + .5, yy + .5, w - 1, w - 1);
    ctx.fillStyle = rgba('#050715', held ? .65 : .24);
    ctx.strokeStyle = rgba('#141526', active ? .7 : .33);
    ctx.lineWidth = 2;
    const cx = x + 36, cy = y + 36;
    // Four distinct engraved material signatures; the player never relies on hue alone.
    if (t.type === 0) {
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy + 11);
        ctx.lineTo(cx + 12, cy - 17);
        ctx.lineTo(cx + 17, cy - 9);
        ctx.lineTo(cx - 10, cy + 17);
        ctx.stroke();
        ctx.fillRect(cx - 16, cy - 17, 8, 8);
    }
    if (t.type === 1) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 19);
        ctx.lineTo(cx + 18, cy);
        ctx.lineTo(cx, cy + 19);
        ctx.lineTo(cx - 18, cy);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#fff4';
        ctx.stroke();
    }
    if (t.type === 2) {
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
    }
    if (t.type === 3) {
        ctx.beginPath();
        ctx.moveTo(cx - 17, cy - 13);
        ctx.lineTo(cx + 17, cy + 13);
        ctx.moveTo(cx + 17, cy - 13);
        ctx.lineTo(cx - 17, cy + 13);
        ctx.stroke();
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
    }
    if (active) {
        ctx.fillStyle = rgba('#fff', held ? .35 : glow * .4);
        ctx.fillRect(xx + 4, yy + 4, w - 8, 3);
        if (held) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(xx + 6, yy + 6, w - 12, w - 12);
            ctx.font = 'bold 15px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText('✦', x + 12, y + 20);
        }
        else if (!ready) {
            ctx.fillStyle = '#ffffff9e';
            ctx.fillRect(x + 49, y + 10, 8, 8);
        }
    }
}
function draw(now) {
    const w = 720, h = 1008;
    ctx.fillStyle = skin().back;
    ctx.fillRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h * .7, 30, w / 2, h * .6, h * .95);
    bg.addColorStop(0, '#2830446a');
    bg.addColorStop(1, '#07091011');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#747d881e';
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
    const time = conductor.ready ? conductor.sweep : (now / 11000) % 1, beat = conductor.ready ? conductor.absoluteStep % 16 : Math.floor(now / 160) % 16;
    ctx.fillStyle = '#ff597219';
    ctx.fillRect(0, 0, w, 72);
    ctx.strokeStyle = '#ff597b99';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.lineTo(w, 72);
    ctx.stroke();
    if (game) {
        const eased = clamp((now - (fallingUntil - 470 / T.FALL_SPEED_SCALE)) / (470 / T.FALL_SPEED_SCALE), 0, 1);
        for (const row of game.board)
            for (const t of row) {
                if (!t)
                    continue;
                const from = transition.get(t.id), smooth = 1 - Math.pow(1 - eased, 3);
                const x = ((from?.x ?? t.x) + (t.x - (from?.x ?? t.x)) * smooth) * 72;
                const y = ((from?.y ?? t.y) + (t.y - (from?.y ?? t.y)) * smooth) * 72;
                tileDraw(t, x, y, now);
            }
        if (eased >= 1 && transition.size) {
            transition.clear();
            game.falling.clear();
        }
        const phase = conductor.ready ? time : 0;
        if (skin().id !== 'coda' && phase >= 0) {
            const lineX = phase * w;
            const beam = ctx.createLinearGradient(lineX - 45, 0, lineX + 15, 0);
            beam.addColorStop(0, '#8ce8ff00');
            beam.addColorStop(.65, rgba(skin().accent, .18));
            beam.addColorStop(.89, rgba(skin().accent, settings.flash * .55));
            beam.addColorStop(1, rgba('#ffffff', settings.flash * .84));
            ctx.fillStyle = beam;
            ctx.fillRect(lineX - 45, 0, 60, h);
            ctx.strokeStyle = rgba('#ffffff', settings.flash * .85 + .12);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(lineX, 0);
            ctx.lineTo(lineX, h);
            ctx.stroke();
        }
        if (now < fallingUntil) {
            ctx.font = '800 15px sans-serif';
            ctx.fillStyle = '#e9dca9';
            ctx.fillText('AIR PRIME WINDOW', 16, h - 15);
        }
        if (playing && !paused && game.combo >= 4 && !settings.strobeFree) {
            ctx.fillStyle = rgba(skin().accent, settings.flash * .025);
            ctx.fillRect(0, 0, w, h);
        }
        if (playing && matchMedia('(pointer:fine)').matches) {
            ctx.strokeStyle = '#ffffffba';
            ctx.lineWidth = 2;
            ctx.strokeRect(selected.x * 72 + 2, selected.y * 72 + 2, 68, 68);
        }
    }
    else {
        for (let y = 6; y < 14; y++)
            for (let x = 0; x < 10; x++)
                if ((x * 19 + y * 7) % 9 > 1) {
                    const i = (x * 31 + y * 17) % 4;
                    const t = { id: 0, x, y, type: i, group: null };
                    tileDraw(t, x * 72, y * 72, now);
                }
        const lineX = time * w;
        ctx.fillStyle = rgba(skin().accent, .6);
        ctx.fillRect(lineX, 0, 2, h);
    }
    bursts = bursts.filter(b => now - b.born < 670);
    for (const b of bursts) {
        const dt = (now - b.born) / 670, rad = (24 + 135 * dt) * b.power;
        ctx.strokeStyle = rgba(b.color, (1 - dt) * settings.flash * .85);
        ctx.lineWidth = 6 * (1 - dt);
        ctx.beginPath();
        ctx.arc((b.x + .5) * 72, (b.y + .5) * 72, rad, 0, Math.PI * 2);
        ctx.stroke();
    }
    document.querySelectorAll('#beatline b').forEach((el, i) => el.classList.toggle('lit', Math.floor(beat / 4) === i));
}
function tick(now) {
    frameTime = now;
    if (game && playing && !paused && !game.over) {
        const next = conductor.absoluteStep;
        if (next > game.step) {
            const prior = new Map();
            for (const row of game.board)
                for (const t of row)
                    if (t)
                        prior.set(t.id, { x: t.x, y: t.y });
            game.advanceTo(next);
            consume(game.drain(), prior);
            conductor.setRank(Math.floor(game.combo / 3));
        }
    }
    draw(now);
    requestAnimationFrame(tick);
}
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
$('soundBtn').addEventListener('click', () => { settings.mute = !settings.mute; conductor.muted = settings.mute; $('soundBtn').textContent = settings.mute ? '◖×' : '◖))'; save(); });
$('settingsBtn').addEventListener('click', () => { if (playing && !paused)
    void pause(); show('settingsOverlay', true); });
$('closeSettings').addEventListener('click', () => show('settingsOverlay', false));
const volume = $('volume'), flash = $('flash');
volume.value = String(settings.volume * 100);
flash.value = String(settings.flash * 100);
volume.addEventListener('input', () => { settings.volume = +volume.value / 100; conductor.setVolume(settings.volume); save(); });
flash.addEventListener('input', () => { settings.flash = +flash.value / 100; save(); });
for (const key of ['strobeFree', 'reducedMotion', 'haptics']) {
    const input = $(key);
    input.checked = settings[key];
    input.addEventListener('change', () => { settings[key] = input.checked; save(); });
}
window.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused)
    void pause(); });
// No service worker is registered: offline play requires a locally cached installation or packaged build.
selectMode('odyssey');
setHud();
requestAnimationFrame(tick);
