/**
 * BREAKBEAT — Multi-Stem Audio Conductor & Key-Pitched SFX Kit (GDD Pages 2–6).
 * - Single source of truth via AudioContext.currentTime + BeatClock.
 * - 5-stem dynamic mix: Base Drums + 4 layers unlocked by Chain Rank & Held Overcharges.
 * - Sustained colour chords on primed groups; adds octave+fifth harmonic when Held.
 * - Rolling breakbeat drum fill as Resonance Chain climbs (4, 6, 10 groups).
 * - Gentle failure: resolves to a warm tonic chord when the wall overflows.
 */

import { BeatClock, type BeatQuery } from '../pulse/BeatClock.js';
import type { SkinDefinition } from '../content/gems/Skins.js';
import { TUNING } from '../tuning.js';

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class StemConductor {
  readonly clock: BeatClock;
  skin: SkinDefinition;
  muted = false;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastScheduledStep = -1;
  private fallbackStartMs = performance.now();

  constructor(skin: SkinDefinition) {
    this.skin = skin;
    this.clock = new BeatClock(skin.bpm, 0);
  }

  /** Initializes or resumes the WebAudio context on user gesture. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.36;
      this.masterGain.connect(this.ctx.destination);

      // Measure audio output latency once and offset visuals to match sound (GDD Page 3)
      const baseLat = this.ctx.baseLatency ?? 0;
      const outLat = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
      this.clock.outputLatencySec = Math.min(0.08, baseLat + outLat);

      this.buildNoiseBuffer();
      this.clock.start(this.ctx.currentTime);
    } else if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
      this.clock.resume(this.ctx.currentTime);
    }
  }

  private buildNoiseBuffer(): void {
    if (!this.ctx) return;
    const length = Math.floor(this.ctx.sampleRate * 0.35);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.09));
    }
    this.noiseBuffer = buffer;
  }

  private rawNowSec(): number {
    if (this.ctx) return this.ctx.currentTime;
    return (performance.now() - this.fallbackStartMs) / 1000;
  }

  start(): void {
    this.fallbackStartMs = performance.now();
    this.lastScheduledStep = -1;
    this.clock.reset(this.rawNowSec());
    this.clock.start(this.rawNowSec());
  }

  pause(): void {
    this.clock.pause(this.rawNowSec());
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.clock.resume(this.rawNowSec());
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.36, this.ctx.currentTime, 0.02);
    }
  }

  setSkin(skin: SkinDefinition, bpmScale = 1): void {
    this.skin = skin;
    this.clock.setBpm(Math.round(skin.bpm * bpmScale), this.rawNowSec());
  }

  setBpm(bpm: number): void {
    this.clock.setBpm(bpm, this.rawNowSec());
  }

  query(): BeatQuery {
    return this.clock.query(this.rawNowSec());
  }

  /** Returns the MIDI pitch in the active skin's key/scale for a given scale degree. */
  private scaleNoteMidi(degree: number, octaveOffset = 0): number {
    const scale = this.skin.scaleIntervals;
    const len = scale.length;
    const idx = ((degree % len) + len) % len;
    const oct = Math.floor(degree / len) + octaveOffset;
    return this.skin.rootMidi + scale[idx]! + oct * 12;
  }

  /** Next 16th-note audio time for quantized interactive SFX. */
  private nextSixteenthAudioTime(): number {
    if (!this.ctx) return 0;
    const q = this.clock.query(this.ctx.currentTime);
    const nextStep = q.absoluteStep + 1;
    const target = this.clock.stepToAudioSec(nextStep);
    return Math.max(this.ctx.currentTime + 0.005, target);
  }

  /**
   * Schedules multi-stem music layers ahead of the audio clock.
   * Bounded to max 4 steps per frame so tab resume can never stall the browser.
   */
  scheduleStems(chainRank: number, heldGroupCount: number, primedColors: ReadonlySet<number>): void {
    if (!this.ctx || !this.masterGain || this.muted || this.ctx.state !== 'running') {
      return;
    }

    const q = this.query();
    if (q.absoluteStep - this.lastScheduledStep > 6) {
      this.lastScheduledStep = q.absoluteStep - 1;
    }

    const lookaheadSteps = 2;
    const targetStep = q.absoluteStep + lookaheadSteps;

    for (let step = this.lastScheduledStep + 1; step <= targetStep; step++) {
      this.lastScheduledStep = step;
      const stepTime = Math.max(this.ctx.currentTime + 0.004, this.clock.stepToAudioSec(step));
      const sixteenth = step % TUNING.SIXTEENTHS_PER_BAR;
      const bar = Math.floor(step / TUNING.SIXTEENTHS_PER_BAR);

      this.scheduleStepLayers(stepTime, sixteenth, bar, chainRank, heldGroupCount, primedColors);
    }
  }

  private scheduleStepLayers(
    at: number,
    sixteenth: number,
    bar: number,
    chainRank: number,
    heldGroupCount: number,
    primedColors: ReadonlySet<number>
  ): void {
    const stepDur = this.clock.sixteenthDurationSec;

    // STEM 0: Breakbeat Drum Foundation (always unmuted)
    // Amen/Breakbeat syncopated pattern: Kicks on 0, 6, 10; Snares on 4, 12, ghost on 7, 15
    if (sixteenth === 0 || sixteenth === 6 || sixteenth === 10) {
      this.synthKick(at, sixteenth === 0 ? 0.24 : 0.17);
    }
    if (sixteenth === 4 || sixteenth === 12) {
      this.synthSnare(at, 0.16, 220);
    } else if (sixteenth === 7 || sixteenth === 9 || sixteenth === 15) {
      this.synthSnare(at, 0.055, 310); // ghosted breakbeat snare
    }
    // 16th-note hi-hat groove
    const hatGain = sixteenth % 4 === 0 ? 0.065 : sixteenth % 2 === 0 ? 0.04 : 0.022;
    this.synthHat(at, hatGain, sixteenth === 14 ? 0.12 : 0.035);

    // Primed groups sustain a soft breathing pulse on every beat (0, 4, 8, 12)
    if (sixteenth % 4 === 0 && primedColors.size > 0) {
      for (const colorIdx of primedColors) {
        const midi = this.scaleNoteMidi(colorIdx * 2, 1);
        this.synthTone(midiToHz(midi), at, stepDur * 2.4, 0.032, 'triangle');
      }
    }

    // STEM 1: Sub Bassline (Unmutes at Chain Rank >= 1)
    if (chainRank >= 1) {
      const bassPattern = [0, -1, 0, 2, -1, 3, 0, -1, 4, -1, 3, 2, 0, -1, 2, 4];
      const deg = bassPattern[sixteenth]!;
      if (deg >= 0) {
        const progShift = (bar % 4) === 2 ? 2 : (bar % 4) === 3 ? 4 : 0;
        const bassMidi = this.scaleNoteMidi(deg + progShift, -1);
        this.synthTone(midiToHz(bassMidi), at, stepDur * 1.6, 0.11, 'sawtooth', 420);
      }
    }

    // STEM 2: Chord Pad Stabs (Unmutes at Chain Rank >= 2)
    if (chainRank >= 2 && (sixteenth === 0 || sixteenth === 6 || sixteenth === 12)) {
      const chordRoot = (bar % 4) * 2;
      const triad = [chordRoot, chordRoot + 2, chordRoot + 4];
      for (const deg of triad) {
        const hz = midiToHz(this.scaleNoteMidi(deg, 1));
        this.synthTone(hz, at, stepDur * 3.8, 0.038, 'sine');
      }
    }

    // STEM 3: Syncopated Key Arp (Unmutes at Chain Rank >= 3)
    if (chainRank >= 3 && sixteenth % 2 === 1) {
      const arpDeg = (sixteenth + bar * 3) % 7;
      const hz = midiToHz(this.scaleNoteMidi(arpDeg, 2));
      this.synthTone(hz, at, stepDur * 0.9, 0.042, 'triangle');
    }

    // STEM 4: Overcharge Drop Stem (Unmutes at Chain Rank >= 4 OR whenever Held groups are active)
    if (chainRank >= 4 || heldGroupCount > 0) {
      if (sixteenth % 4 === 2) {
        const dropHz = midiToHz(this.scaleNoteMidi(0, 2));
        const fifthHz = midiToHz(this.scaleNoteMidi(4, 2));
        this.synthTone(dropHz, at, stepDur * 1.8, 0.045, 'sawtooth', 1600);
        this.synthTone(fifthHz, at, stepDur * 1.8, 0.035, 'triangle');
      }
    }
  }

  /** Pitched prime tone per colour, quantised to the nearest 16th (GDD Page 2 & 5). */
  triggerPrime(colorIndex: number, size: number, airPrimed: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const at = this.nextSixteenthAudioTime();
    const baseMidi = this.scaleNoteMidi(colorIndex * 2, 1);
    const fifthMidi = this.scaleNoteMidi(colorIndex * 2 + 4, 1);

    this.synthTone(midiToHz(baseMidi), at, 0.22, 0.095, 'triangle');
    this.synthTone(midiToHz(fifthMidi), at + 0.025, 0.24, 0.065, 'sine');
    if (airPrimed || size >= 5) {
      const octMidi = this.scaleNoteMidi(colorIndex * 2, 2);
      this.synthTone(midiToHz(octMidi), at + 0.045, 0.28, 0.075, 'sine');
    }
    this.vibrate(this.skin.hapticPattern.primeMs);
  }

  /** Hold SFX: sustained note gains a glowing harmonic fifth + octave (GDD Page 3). */
  triggerHold(colorIndex: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const at = this.nextSixteenthAudioTime();
    const rootMidi = this.scaleNoteMidi(colorIndex * 2, 1);
    const fifthMidi = this.scaleNoteMidi(colorIndex * 2 + 4, 2);
    const octMidi = this.scaleNoteMidi(colorIndex * 2, 2);

    this.synthTone(midiToHz(rootMidi), at, 0.42, 0.09, 'sawtooth', 1200);
    this.synthTone(midiToHz(fifthMidi), at + 0.02, 0.45, 0.08, 'triangle');
    this.synthTone(midiToHz(octMidi), at + 0.04, 0.5, 0.085, 'sine');
    this.vibrate(this.skin.hapticPattern.holdMs);
  }

  /**
   * Detonation SFX + Rolling Drum Fill on Resonance Chains (GDD Page 1 & 2):
   * Priming 4, 6, 10 groups and letting one sweep turn them into a rolling drum fill.
   */
  triggerDetonate(colorIndex: number, resonanceCount: number, overcharged: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const at = this.ctx.currentTime + 0.003;
    const degree = colorIndex * 2 + (resonanceCount - 1);
    const noteMidi = this.scaleNoteMidi(degree, 1);
    const octMidi = this.scaleNoteMidi(degree, 2);

    // Pitched crystal/stone shatter chord
    this.synthTone(midiToHz(noteMidi), at, 0.28, overcharged ? 0.15 : 0.11, 'triangle');
    this.synthTone(midiToHz(octMidi), at + 0.015, 0.24, 0.085, 'sine');

    // Rolling breakbeat drum fill that escalates with resonanceCount
    const tomPitch = 130 + Math.min(10, resonanceCount) * 24;
    this.synthSnare(at, Math.min(0.24, 0.1 + resonanceCount * 0.018), tomPitch);

    if (resonanceCount >= 3 || overcharged) {
      const subStep = this.clock.sixteenthDurationSec * 0.5;
      this.synthSnare(at + subStep, 0.12, tomPitch * 1.25);
    }
    if (overcharged) {
      this.synthKick(at, 0.28);
      const subMidi = this.scaleNoteMidi(0, 0);
      this.synthTone(midiToHz(subMidi), at, 0.45, 0.14, 'sawtooth', 650);
    }
    this.vibrate(this.skin.hapticPattern.detonateMs);
  }

  /** Cascade slide SFX pitched to the active key. */
  triggerCascadeSlide(movedCount: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const at = this.nextSixteenthAudioTime();
    const midi = this.scaleNoteMidi(Math.min(7, Math.floor(movedCount / 3)), 1);
    this.synthTone(midiToHz(midi), at, 0.09, 0.04, 'sine');
  }

  /** Gentle failure: resolves the music to its tonic chord on the last beat (GDD Page 6). */
  triggerTonicResolution(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const at = this.ctx.currentTime + 0.02;
    const chordDegrees = [0, 2, 4, 7];
    for (let i = 0; i < chordDegrees.length; i++) {
      const hz = midiToHz(this.scaleNoteMidi(chordDegrees[i]!, i === 0 ? 0 : 1));
      this.synthTone(hz, at + i * 0.04, 1.6, 0.075, 'sine');
    }
  }

  private synthKick(at: number, gainAmount: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, at);
    osc.frequency.exponentialRampToValueAtTime(38, at + 0.11);

    gain.gain.setValueAtTime(gainAmount, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(at);
    osc.stop(at + 0.17);
  }

  private synthSnare(at: number, gainAmount: number, bodyHz = 200): void {
    if (!this.ctx || !this.masterGain) return;
    // Tonal body
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(bodyHz, at);
    osc.frequency.exponentialRampToValueAtTime(bodyHz * 0.5, at + 0.07);
    oscGain.gain.setValueAtTime(gainAmount * 0.65, at);
    oscGain.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(at);
    osc.stop(at + 0.09);

    // Snare wires
    if (this.noiseBuffer) {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 950;
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(gainAmount, at);
      nGain.gain.exponentialRampToValueAtTime(0.001, at + 0.13);
      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(at);
      noise.stop(at + 0.14);
    }
  }

  private synthHat(at: number, gainAmount: number, duration: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainAmount, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(at);
    noise.stop(at + duration + 0.01);
  }

  private synthTone(
    freqHz: number,
    at: number,
    duration: number,
    gainAmount: number,
    type: OscillatorType,
    lowpassHz?: number
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqHz, at);

    gain.gain.setValueAtTime(0.001, at);
    gain.gain.linearRampToValueAtTime(gainAmount, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + duration);

    if (lowpassHz) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(lowpassHz, at);
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(this.masterGain);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private vibrate(pattern: number | readonly number[]): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern as number | number[]);
      } catch {
        // Ignore on unsupported devices
      }
    }
  }
}
