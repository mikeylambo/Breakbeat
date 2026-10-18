import { loadAudioStem } from '../shell/StemLoader.js';
export const SIXTEENTHS_PER_BAR = 16;
export function stepTime(origin, step, bpm) { return origin + step * 60 / bpm / 4; }
export function quantizeStep(time, origin, bpm) { return Math.max(0, Math.ceil(Math.max(0, time - origin) * bpm / 60 * 4 - 1e-8)); }
export function visualElapsed(audioCurrentTime, origin, outputLatency) {
    return Math.max(0, audioCurrentTime - origin - Math.max(0, outputLatency));
}
export class Conductor {
    ctx = null;
    noiseBuf = null;
    origin = 0;
    lastScheduled = -1;
    paused = true;
    interval = 0;
    rank = 0;
    volume = 0.7;
    master = null;
    layers = [];
    voices = new Map();
    loaded = [];
    bpm = 124;
    key = 0;
    muted = false;
    usingStems = false;
    profile = 'ignition';
    get ready() { return !!this.ctx; }
    get running() { return !!this.ctx && !this.paused; }
    get contextTime() { return this.ctx?.currentTime ?? 0; }
    get beatSeconds() { return 60 / this.bpm; }
    get stepSeconds() { return this.beatSeconds / 4; }
    get outputLatency() { return (this.ctx?.outputLatency ?? 0) + (this.ctx?.baseLatency ?? 0); }
    get elapsed() { return visualElapsed(this.contextTime, this.origin, this.outputLatency); }
    get absoluteStep() { return Math.floor(this.elapsed / this.stepSeconds + 1e-6); }
    get sweep() { return this.elapsed % (this.stepSeconds * 16) / (this.stepSeconds * 16); }
    get latencyMs() { return Math.round(this.outputLatency * 1000); }
    get trackMode() { return this.usingStems ? 'STEMS' : 'LIVE SYNTH'; }
    async start(bpm, key = 0, track) {
        await this.stop();
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        await this.ctx.resume();
        this.bpm = bpm;
        this.key = key;
        this.profile = track?.id ?? 'ignition';
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        // Gentle master dynamics compressor so multi-group detonations punch cleanly without clipping
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 10;
        comp.ratio.value = 3.5;
        comp.attack.value = 0.004;
        comp.release.value = 0.14;
        this.master.connect(comp).connect(this.ctx.destination);
        // Pre-generate noise buffer for crisp percussion (hi-hats & snare)
        const sr = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, Math.floor(sr * 0.35), sr);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++)
            data[i] = Math.random() * 2 - 1;
        this.loaded = [];
        if (track?.stems.length) {
            this.loaded = await Promise.all(track.stems.map(async (stem) => {
                return { stem, buffer: await loadAudioStem(this.ctx, stem.src) };
            }));
        }
        this.origin = this.ctx.currentTime + 0.12 + (track?.offsetMs ?? 0) / 1000;
        this.lastScheduled = -1;
        this.paused = false;
        this.usingStems = this.loaded.length > 0;
        this.createLayers(track);
        this.interval = window.setInterval(() => this.schedule(), 20);
        this.schedule();
    }
    createLayers(track) {
        const ctx = this.ctx;
        if (!ctx || !track)
            return;
        const startBar = Math.max(0, track.loopStartBar - 1), endBar = Math.max(track.loopEndBar, startBar + 1);
        const loopStart = startBar * 16 * this.stepSeconds, loopEnd = endBar * 16 * this.stepSeconds;
        for (const { stem, buffer } of this.loaded) {
            const src = ctx.createBufferSource(), gain = ctx.createGain();
            src.buffer = buffer;
            src.loop = true;
            src.playbackRate.value = this.bpm / (track.bpm || this.bpm);
            src.loopStart = Math.min(Math.max(0, loopStart), Math.max(0, buffer.duration - 0.02));
            src.loopEnd = Math.min(loopEnd, buffer.duration);
            if (src.loopEnd <= src.loopStart)
                src.loopEnd = buffer.duration;
            gain.gain.value = stem.rank <= this.rank ? (stem.gain ?? 0.75) : 0;
            src.connect(gain).connect(this.master);
            src.start(this.origin, src.loopStart);
            this.layers.push({ stem, buffer, gain, source: src });
        }
    }
    async stop() {
        if (this.interval)
            window.clearInterval(this.interval);
        this.interval = 0;
        for (const id of [...this.voices.keys()])
            this.release(id, true);
        for (const layer of this.layers) {
            try {
                layer.source.stop();
            }
            catch { }
            layer.source.disconnect();
        }
        this.layers = [];
        const old = this.ctx;
        this.ctx = null;
        this.master = null;
        this.noiseBuf = null;
        this.paused = true;
        this.usingStems = false;
        if (old)
            await old.close().catch(() => { });
    }
    async setPause(paused) {
        if (!this.ctx || this.paused === paused)
            return;
        this.paused = paused;
        if (paused)
            await this.ctx.suspend();
        else {
            await this.ctx.resume();
            this.schedule();
        }
    }
    setRank(rank) {
        const target = Math.max(0, Math.min(4, rank));
        if (target === this.rank)
            return;
        this.rank = target;
        const ctx = this.ctx;
        if (!ctx)
            return;
        const at = this.nextGridTime(ctx.currentTime + 0.005);
        for (const layer of this.layers) {
            layer.gain.gain.cancelScheduledValues(at);
            layer.gain.gain.setTargetAtTime(layer.stem.rank <= target ? (layer.stem.gain ?? 0.75) : 0, at, 0.06);
        }
    }
    setVolume(volume) { this.volume = Math.max(0, Math.min(1, volume)); this.syncVolume(); }
    setMuted(muted) { this.muted = muted; this.syncVolume(); }
    syncVolume() {
        if (this.ctx && this.master)
            this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
    }
    hz(semitones) { return 220 * Math.pow(2, (semitones + this.key) / 12); }
    nextGridTime(time) { return stepTime(this.origin, quantizeStep(time, this.origin, this.bpm), this.bpm); }
    eventAudioTime(atStep) {
        const now = (this.ctx?.currentTime ?? 0) + 0.005;
        const nominal = stepTime(this.origin, atStep, this.bpm);
        return nominal >= now ? nominal : this.nextGridTime(now);
    }
    tone(at, hz, duration, gain, wave = 'sine', cutoff = 0, filterHz = 2800) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const osc = ctx.createOscillator(), amp = ctx.createGain(), flt = ctx.createBiquadFilter();
        osc.type = wave;
        osc.frequency.setValueAtTime(hz, at);
        if (cutoff)
            osc.frequency.exponentialRampToValueAtTime(Math.max(40, hz * cutoff), at + duration);
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(filterHz, at);
        flt.frequency.exponentialRampToValueAtTime(Math.max(220, filterHz * 0.35), at + duration);
        amp.gain.setValueAtTime(0.0001, at);
        amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), at + 0.006);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(flt).connect(amp).connect(this.master);
        osc.start(at);
        osc.stop(at + duration + 0.02);
    }
    kick(at, gain) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const osc = ctx.createOscillator(), amp = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(145, at);
        osc.frequency.exponentialRampToValueAtTime(42, at + 0.13);
        amp.gain.setValueAtTime(Math.max(0.0001, gain), at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.21);
        osc.connect(amp).connect(this.master);
        osc.start(at);
        osc.stop(at + 0.22);
    }
    snare(at, gain) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        // Pitched drum body
        this.tone(at, 195, 0.085, gain * 0.7, 'triangle', 0.48, 1800);
        // Crisp noise snap
        if (this.noiseBuf) {
            const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), amp = ctx.createGain();
            src.buffer = this.noiseBuf;
            flt.type = 'bandpass';
            flt.frequency.setValueAtTime(2200, at);
            flt.Q.value = 0.9;
            amp.gain.setValueAtTime(gain * 0.85, at);
            amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
            src.connect(flt).connect(amp).connect(this.master);
            src.start(at);
            src.stop(at + 0.14);
        }
    }
    hat(at, gain, open = false) {
        const ctx = this.ctx;
        if (!ctx || !this.master || !this.noiseBuf)
            return;
        const dur = open ? 0.11 : 0.032;
        const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), amp = ctx.createGain();
        src.buffer = this.noiseBuf;
        flt.type = 'highpass';
        flt.frequency.setValueAtTime(7200, at);
        amp.gain.setValueAtTime(gain, at);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        src.connect(flt).connect(amp).connect(this.master);
        src.start(at);
        src.stop(at + dur + 0.01);
    }
    schedule() {
        if (!this.ctx || this.paused)
            return;
        const ctx = this.ctx, horizon = ctx.currentTime + 0.14;
        while (stepTime(this.origin, this.lastScheduled + 1, this.bpm) < horizon) {
            const index = ++this.lastScheduled, at = stepTime(this.origin, index, this.bpm);
            if (at < ctx.currentTime - 0.012 || this.usingStems)
                continue;
            const beat = index % 16, bar = Math.floor(index / 16);
            const p = this.profile;
            const sparse = p === 'stillwater' || p === 'coda';
            const broken = p === 'neon-rush' || p === 'fracture';
            // Breakbeat kick pattern (Amen/2-step inspired syncopation)
            const isKick = beat === 0 || (!sparse && (broken ? (beat === 6 || beat === 10) : (beat === 10 || (bar % 2 === 1 && beat === 14))));
            if (isKick)
                this.kick(at, beat === 0 ? 0.24 : 0.16);
            // Snare on backbeats (4 and 12) plus ghost note on 15
            if (beat === 4 || beat === 12)
                this.snare(at, sparse ? 0.06 : 0.12);
            else if (!sparse && beat === 15 && bar % 2 === 1)
                this.snare(at, 0.045);
            // Crisp 16th hi-hat groove
            if (sparse ? beat % 4 === 0 : (beat % 2 === 0 || this.rank >= 1)) {
                const vel = beat % 4 === 2 ? 0.038 : (beat % 2 === 0 ? 0.024 : 0.014);
                this.hat(at, vel + this.rank * 0.004, beat === 14 && !sparse);
            }
            // Warm sub/reese bassline
            const rootProg = [0, -2, 3, -4][bar % 4];
            if (beat === 0 || (!sparse && (beat === 6 || beat === 10))) {
                this.tone(at, this.hz(rootProg - 12), beat === 0 ? 0.34 : 0.22, 0.095, 'sawtooth', 0, 520);
            }
            // Rank 1+: Rhodes/pad chord stabs
            if (this.rank >= 1 && (beat === 0 || beat === 6 || beat === 12)) {
                const chord = [0, 3, 7, 10];
                for (const interval of chord) {
                    this.tone(at, this.hz(rootProg + interval), 0.24, 0.016, 'triangle', 0, 1600);
                }
            }
            // Rank 2+: Syncopated arp
            if (this.rank >= 2 && beat % 2 === 1) {
                const arpNotes = [0, 3, 7, 10, 12, 10, 7, 3];
                const note = arpNotes[(beat >> 1) % arpNotes.length];
                this.tone(at, this.hz(rootProg + note + 12), 0.11, 0.022, 'triangle', 0, 2400);
            }
            // Rank 3+: High shimmer lead
            if (this.rank >= 3 && (beat === 2 || beat === 8 || beat === 14)) {
                this.tone(at, this.hz(rootProg + 19), 0.2, 0.02, 'sine', 0, 3200);
            }
        }
    }
    /** Warm musical chord pluck + gentle low-level pad sustain when a group is primed. */
    sustain(id, color, step) {
        if (!this.ctx || !this.master || this.paused)
            return;
        const at = this.eventAudioTime(step), notes = [0, 3, 7, 10, 14], note = notes[color] ?? 0;
        if (this.voices.has(id))
            return;
        const amp = this.ctx.createGain(), flt = this.ctx.createBiquadFilter(), osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = this.hz(note);
        flt.type = 'lowpass';
        flt.frequency.value = 950;
        amp.gain.setValueAtTime(0.0001, at);
        amp.gain.setTargetAtTime(0.012, at, 0.04);
        osc.connect(flt).connect(amp).connect(this.master);
        osc.start(at);
        this.voices.set(id, { oscillators: [osc], gain: amp, note, held: false });
        // Immediate tactile melodic pluck on prime
        this.tone(at, this.hz(note + 12), 0.14, 0.065, 'triangle', 0, 2800);
        this.tone(at + 0.015, this.hz(note + 19), 0.11, 0.035, 'sine', 0, 3400);
    }
    hold(id, step) {
        const ctx = this.ctx, voice = this.voices.get(id);
        if (!ctx || !voice || voice.held)
            return;
        const at = this.eventAudioTime(step), harmonic = ctx.createOscillator();
        harmonic.type = 'sine';
        harmonic.frequency.value = this.hz(voice.note + 12);
        harmonic.connect(voice.gain);
        harmonic.start(at);
        voice.oscillators.push(harmonic);
        voice.held = true;
        voice.gain.gain.setTargetAtTime(0.022, at, 0.05);
    }
    overchargeDrop(step, heldGroups = 1) {
        const ctx = this.ctx;
        if (!ctx)
            return;
        const at = this.eventAudioTime(step);
        const end = Math.max(at + 0.1, stepTime(this.origin, (Math.floor(step / 16) + 1) * 16, this.bpm));
        for (const layer of this.layers) {
            if (layer.stem.rank > this.rank && layer.stem.rank <= Math.min(4, this.rank + heldGroups)) {
                layer.gain.gain.setTargetAtTime(layer.stem.gain ?? 0.75, at, 0.03);
                layer.gain.gain.setTargetAtTime(0, end, 0.05);
            }
        }
        if (!this.usingStems)
            this.tone(at, this.hz(-12), Math.max(0.22, end - at), 0.08, 'sawtooth', 0.5, 900);
    }
    syncGroups(ids) {
        for (const id of this.voices.keys())
            if (!ids.has(id))
                this.release(id);
    }
    release(id, immediate = false) {
        const voice = this.voices.get(id), ctx = this.ctx;
        if (!voice || !ctx)
            return;
        const at = ctx.currentTime, stop = at + (immediate ? 0.004 : 0.1);
        voice.gain.gain.cancelScheduledValues(at);
        voice.gain.gain.setTargetAtTime(0.0001, at, immediate ? 0.001 : 0.025);
        for (const oscillator of voice.oscillators) {
            try {
                oscillator.stop(stop);
            }
            catch { }
        }
        this.voices.delete(id);
    }
    effect(kind, color = 0, step, resonanceStep = 1) {
        const ctx = this.ctx;
        if (!ctx || this.paused)
            return;
        const at = step === undefined ? this.nextGridTime(ctx.currentTime + 0.004) : this.eventAudioTime(step);
        const scale = [0, 3, 5, 7, 10, 12, 15, 19, 22, 24];
        const n = scale[color % scale.length] ?? 0;
        if (kind === 'prime') {
            this.tone(at, this.hz(n + 12), 0.15, 0.065, 'triangle', 0, 2600);
        }
        else if (kind === 'hold') {
            this.tone(at, this.hz(n + 7), 0.25, 0.06, 'triangle', 0, 2400);
            this.tone(at + 0.04, this.hz(n + 12), 0.32, 0.075, 'sine', 0, 3200);
        }
        else if (kind === 'burst') {
            // Step up pentatonic scale as resonance increases during a pass!
            const arpNote = scale[Math.min(scale.length - 1, (color + Math.max(0, resonanceStep - 1)) % scale.length)];
            this.kick(at, 0.14);
            this.snare(at, 0.08);
            this.tone(at, this.hz(arpNote + 12), 0.24, 0.085, 'triangle', 0, 3200);
            this.tone(at + 0.02, this.hz(arpNote + 19), 0.18, 0.045, 'sine', 0, 3800);
        }
        else if (kind === 'over') {
            this.kick(at, 0.28);
            this.snare(at, 0.16);
            this.tone(at, this.hz(n), 0.45, 0.095, 'sawtooth', 0, 1800);
            this.tone(at, this.hz(n + 12), 0.42, 0.085, 'triangle', 0, 3500);
            this.tone(at + 0.03, this.hz(n + 19), 0.38, 0.07, 'sine', 0, 4200);
        }
        else if (kind === 'slide') {
            this.tone(at, this.hz(-5), 0.09, 0.02, 'sine', 0.72, 900);
        }
        else if (kind === 'error') {
            this.tone(at, this.hz(-7), 0.08, 0.018, 'triangle', 0.85, 600);
        }
        else if (kind === 'resolve') {
            this.tone(at, this.hz(0), 0.65, 0.065, 'triangle', 0, 1800);
            this.tone(at + 0.04, this.hz(7), 0.6, 0.045, 'triangle', 0, 2200);
            this.tone(at + 0.09, this.hz(12), 0.55, 0.04, 'sine', 0, 2600);
        }
    }
}
