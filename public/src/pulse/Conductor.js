import { loadAudioStem } from '../shell/StemLoader.js';
export const SIXTEENTHS_PER_BAR = 16;
export function stepTime(origin, step, bpm) { return origin + step * 60 / bpm / 4; }
export function quantizeStep(time, origin, bpm) { return Math.max(0, Math.ceil(Math.max(0, time - origin) * bpm / 60 * 4 - 1e-8)); }
export function visualElapsed(audioCurrentTime, origin, outputLatency) {
    return Math.max(0, audioCurrentTime - origin - Math.max(0, outputLatency));
}
export class Conductor {
    ctx = null;
    origin = 0;
    lastScheduled = -1;
    paused = true;
    interval = 0;
    rank = 0;
    volume = .7;
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
        this.master.connect(this.ctx.destination);
        this.loaded = [];
        // All asset loading completes BEFORE the clock starts. No play-time HTTP calls.
        if (track?.stems.length) {
            this.loaded = await Promise.all(track.stems.map(async (stem) => {
                return { stem, buffer: await loadAudioStem(this.ctx, stem.src) };
            }));
        }
        this.origin = this.ctx.currentTime + .18 + (track?.offsetMs ?? 0) / 1000;
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
            src.loopStart = Math.min(Math.max(0, loopStart), Math.max(0, buffer.duration - .02));
            src.loopEnd = Math.min(loopEnd, buffer.duration);
            if (src.loopEnd <= src.loopStart)
                src.loopEnd = buffer.duration;
            gain.gain.value = stem.rank <= this.rank ? (stem.gain ?? .75) : 0;
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
        const at = this.nextGridTime(ctx.currentTime + .005);
        for (const layer of this.layers) {
            layer.gain.gain.cancelScheduledValues(at);
            layer.gain.gain.setTargetAtTime(layer.stem.rank <= target ? (layer.stem.gain ?? .75) : 0, at, .06);
        }
    }
    setVolume(volume) { this.volume = Math.max(0, Math.min(1, volume)); this.syncVolume(); }
    setMuted(muted) { this.muted = muted; this.syncVolume(); }
    syncVolume() { if (this.ctx && this.master)
        this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, .015); }
    hz(semitones) { return 220 * Math.pow(2, (semitones + this.key) / 12); }
    nextGridTime(time) { return stepTime(this.origin, quantizeStep(time, this.origin, this.bpm), this.bpm); }
    /** Contract: event step always maps to the exact audio grid; late callbacks are
     *  recovered at the next grid rather than emitting an off-grid sound. */
    eventAudioTime(atStep) {
        const now = (this.ctx?.currentTime ?? 0) + .006;
        const nominal = stepTime(this.origin, atStep, this.bpm);
        return nominal >= now ? nominal : this.nextGridTime(now);
    }
    tone(at, hz, duration, gain, wave = 'sine', cutoff = 0) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const osc = ctx.createOscillator(), amp = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(hz, at);
        if (cutoff)
            osc.frequency.exponentialRampToValueAtTime(Math.max(50, hz * cutoff), at + duration);
        amp.gain.setValueAtTime(.0001, at);
        amp.gain.exponentialRampToValueAtTime(Math.max(.0001, gain), at + .008);
        amp.gain.exponentialRampToValueAtTime(.0001, at + duration);
        osc.connect(amp).connect(this.master);
        osc.start(at);
        osc.stop(at + duration + .02);
    }
    kick(at, gain) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const osc = ctx.createOscillator(), amp = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(128, at);
        osc.frequency.exponentialRampToValueAtTime(44, at + .14);
        amp.gain.setValueAtTime(Math.max(.0001, gain), at);
        amp.gain.exponentialRampToValueAtTime(.0001, at + .19);
        osc.connect(amp).connect(this.master);
        osc.start(at);
        osc.stop(at + .2);
    }
    schedule() {
        if (!this.ctx || this.paused)
            return;
        const ctx = this.ctx, horizon = ctx.currentTime + .14;
        while (stepTime(this.origin, this.lastScheduled + 1, this.bpm) < horizon) {
            const index = ++this.lastScheduled, at = stepTime(this.origin, index, this.bpm);
            if (at < ctx.currentTime - .012 || this.usingStems)
                continue;
            const beat = index % 16, bar = Math.floor(index / 16);
            // Six movement-specific procedural arrangements are temporary music, not the OST.
            const p = this.profile;
            const sparse = p === 'stillwater' || p === 'coda', broken = p === 'neon-rush' || p === 'fracture';
            if (beat === 0 || (!sparse && (p === 'fracture' ? beat === 7 || beat === 11 : beat === 8)) || (p === 'ignition' && beat === 4))
                this.kick(at, beat === 0 ? .19 : .10);
            if ((p === 'afterglow' ? (beat === 4 || beat === 12) : (broken ? [3, 7, 11, 15].includes(beat) : beat === 12)))
                this.tone(at, 185, .09, p === 'fracture' ? .08 : .047, 'triangle', .55);
            if ((p === 'neon-rush' ? beat % 1 === 0 : sparse ? beat % 4 === 0 : beat % 2 === 0))
                this.tone(at, this.hz(22), .042, (sparse ? .005 : .009) + (this.rank * .003), 'square');
            if (this.rank >= 1 && (sparse ? beat === 2 : broken ? beat % 4 === 3 : beat % 4 === 2))
                this.tone(at, this.hz([0, 3, 7, 10][bar % 4]), sparse ? .5 : .18, .026, 'triangle');
            if (this.rank >= 2 && beat === 0)
                this.tone(at, this.hz(-12 + [0, 5, 3, 7][bar % 4]), sparse ? 1.8 : 1, .05, 'sine');
            if (this.rank >= 3 && (sparse ? beat === 10 : beat % 4 === 3))
                this.tone(at, this.hz(12 + (index * 7) % 12), .1, .023, 'triangle');
            if (this.rank >= 4 && beat === 0)
                this.tone(at, this.hz(12 + ([0, 3, 7, 10][bar % 4] ?? 0)), 1.2, .035, 'sine');
        }
    }
    /** Persistent note sounds throughout the group's life; holds add an octave. */
    sustain(id, color, step) {
        if (!this.ctx || !this.master || this.paused)
            return;
        const at = this.eventAudioTime(step), notes = [0, 3, 7, 10, 14], note = notes[color] ?? 0;
        if (this.voices.has(id))
            return;
        const amp = this.ctx.createGain(), osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = this.hz(note);
        amp.gain.setValueAtTime(.0001, at);
        amp.gain.setTargetAtTime(.018, at, .06);
        osc.connect(amp).connect(this.master);
        osc.start(at);
        this.voices.set(id, { oscillators: [osc], gain: amp, note, held: false });
        this.tone(at, this.hz(note + 12), .13, .055, 'triangle');
    }
    hold(id, step) {
        const ctx = this.ctx, voice = this.voices.get(id);
        if (!ctx || !voice || voice.held)
            return;
        const at = this.eventAudioTime(step), harmonic = ctx.createOscillator();
        harmonic.type = 'triangle';
        harmonic.frequency.value = this.hz(voice.note + 12);
        harmonic.connect(voice.gain);
        harmonic.start(at);
        voice.oscillators.push(harmonic);
        voice.held = true;
        voice.gain.gain.setTargetAtTime(.03, at, .05);
    }
    /** An Overcharge temporarily unmutes one extra rank until the next bar. */
    overchargeDrop(step, heldGroups = 1) {
        const ctx = this.ctx;
        if (!ctx)
            return;
        const at = this.eventAudioTime(step);
        const end = Math.max(at + .1, stepTime(this.origin, (Math.floor(step / 16) + 1) * 16, this.bpm));
        for (const layer of this.layers) {
            if (layer.stem.rank > this.rank && layer.stem.rank <= Math.min(4, this.rank + heldGroups)) {
                layer.gain.gain.setTargetAtTime(layer.stem.gain ?? .75, at, .03);
                layer.gain.gain.setTargetAtTime(0, end, .05);
            }
        }
        if (!this.usingStems)
            this.tone(at, this.hz(-12), Math.max(.18, end - at), .065, 'sawtooth', .55);
    }
    syncGroups(ids) { for (const id of this.voices.keys())
        if (!ids.has(id))
            this.release(id); }
    release(id, immediate = false) {
        const voice = this.voices.get(id), ctx = this.ctx;
        if (!voice || !ctx)
            return;
        const at = ctx.currentTime, stop = at + (immediate ? .004 : .12);
        voice.gain.gain.cancelScheduledValues(at);
        voice.gain.gain.setTargetAtTime(.0001, at, immediate ? .001 : .028);
        for (const oscillator of voice.oscillators) {
            try {
                oscillator.stop(stop);
            }
            catch { }
        }
        this.voices.delete(id);
    }
    effect(kind, color = 0, step) {
        const ctx = this.ctx;
        if (!ctx || this.paused)
            return;
        const at = step === undefined ? this.nextGridTime(ctx.currentTime + .006) : this.eventAudioTime(step);
        const notes = [0, 3, 7, 10, 14], n = notes[color] ?? 0;
        if (kind === 'prime')
            this.tone(at, this.hz(n), .19, .065, 'sine');
        if (kind === 'hold')
            this.tone(at, this.hz(n + 12), .43, .075, 'triangle');
        if (kind === 'burst') {
            this.kick(at, .10);
            this.tone(at, this.hz(n + 12), .25, .07, 'triangle', .5);
        }
        if (kind === 'over') {
            this.kick(at, .24);
            this.tone(at, this.hz(n - 12), .7, .10, 'sawtooth', .7);
        }
        if (kind === 'slide')
            this.tone(at, this.hz(-5), .12, .022, 'sine', .7);
        if (kind === 'error')
            this.tone(at, this.hz(-7), .1, .025, 'triangle');
        if (kind === 'resolve') {
            this.tone(at, this.hz(0), .68, .07, 'sine');
            this.tone(at + .03, this.hz(7), .6, .045, 'triangle');
            this.tone(at + .09, this.hz(12), .55, .03, 'sine');
        }
    }
}
