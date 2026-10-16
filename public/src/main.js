import { GemRules } from './content/gems/GemRules.js';
import { Pulse } from './pulse/Pulse.js';
import { Conductor } from './pulse/Conductor.js';
import { skins, mastery } from './content/skins.js';
import { T } from './tuning.js';
import { renderTile, renderSweep } from './content/MaterialRenderer.js';
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
let selected = { x: 4, y: 10 }, hitstopUntil = 0;
let bursts = [];
let debris = [];
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
function consume(events) {
    if (!game)
        return;
    for (const event of events) {
        switch (event.kind) {
            case 'prime': {
                conductor.sustain(event.groupId, event.type, event.atStep);
                triggerHaptic(skin().haptic.prime);
                if (hintStage < 1)
                    tip(1);
                if (event.air)
                    tip(4);
                break;
            }
            case 'hold': {
                conductor.hold(event.groupId, event.atStep);
                triggerHaptic([14, 30, 14]);
                tip(3);
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
                if (event.overcharged)
                    tip(3);
                break;
            }
            case 'cascade': {
                if (event.ids.length)
                    conductor.effect('slide', 0, event.atStep);
                break;
            }
            case 'land': break;
            case 'pressure': {
                if (hintStage < 2)
                    tip(2);
                break;
            }
            case 'end':
                void end(false);
                break;
        }
    }
    // Overcharge can consume neighbouring primed groups: no dangling sustained notes.
    conductor.syncGroups(new Set(game.groups.keys()));
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
        await conductor.start(skin().bpm, skin().key, track);
    }
    catch (err) {
        console.warn('Stem load failed. Using synthesized score.', err);
        await conductor.start(skin().bpm, skin().key);
    }
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
        conductor.setRank(Math.floor(game.combo / 3));
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
$('soundBtn').addEventListener('click', () => { settings.mute = !settings.mute; conductor.setMuted(settings.mute); $('soundBtn').textContent = settings.mute ? '◖×' : '◖))'; save(); });
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
