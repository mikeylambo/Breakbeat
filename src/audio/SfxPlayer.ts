/**
 * SfxPlayer — pre-decoded one-shots with a voice cap. The only nodes created at runtime are
 * AudioBufferSourceNode one-shots (plus their reusable per-voice gain from a fixed pool).
 */

import { TUNING } from '../tuning.js';
import type { AudioEngine } from './AudioEngine.js';
import { renderSfx } from './placeholder/Synth.js';
import { SFX_NAMES, keySemitone, type TrackDef } from './tracks.js';

const NAMES = ['prime-0', 'prime-1', 'prime-2', 'prime-3', ...SFX_NAMES];

interface Voice {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  endsAt: number;
}

export class SfxPlayer {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices: Voice[] = [];
  private keyRate = 1;
  private ready: Promise<void> | null = null;

  constructor(private readonly audio: AudioEngine) {
    for (let i = 0; i < TUNING.SFX_VOICE_CAP; i++) {
      const gain = audio.ctx.createGain();
      gain.connect(audio.sfxBus);
      this.voices.push({ gain, src: null, endsAt: 0 });
    }
  }

  /** Renders the placeholder one-shots once. */
  load(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const bufs = await Promise.all(NAMES.map(n => renderSfx(n)));
        NAMES.forEach((n, i) => this.buffers.set(n, bufs[i]!));
      })();
    }
    return this.ready;
  }

  /** Prime tones follow the movement's key. */
  setTrack(track: TrackDef): void {
    const semis = keySemitone(track.key);
    this.keyRate = Math.pow(2, (semis > 6 ? semis - 12 : semis) / 12);
  }

  /**
   * Plays `name` at audio time `atSec`. Returns the voice index (for cancel) or -1 when the
   * buffer is missing. When all voices are busy the one that ends soonest is stolen.
   */
  play(name: string, atSec: number, gain = 1, pitched = false): number {
    const buf = this.buffers.get(name);
    if (!buf) return -1;
    const ctx = this.audio.ctx;
    let idx = 0;
    let soonest = Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      if (v.endsAt <= ctx.currentTime) {
        idx = i;
        soonest = -1;
        break;
      }
      if (v.endsAt < soonest) {
        soonest = v.endsAt;
        idx = i;
      }
    }
    const voice = this.voices[idx]!;
    if (voice.src) {
      try {
        voice.src.stop();
      } catch {
        // ended
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = pitched ? this.keyRate : 1;
    src.playbackRate.value = rate;
    src.connect(voice.gain);
    const t = Math.max(ctx.currentTime, atSec);
    voice.gain.gain.setValueAtTime(gain, t);
    src.start(t);
    voice.src = src;
    voice.endsAt = t + buf.duration / rate;
    return idx;
  }

  cancel(voiceIdx: number): void {
    const v = this.voices[voiceIdx];
    if (!v?.src) return;
    try {
      v.src.stop();
    } catch {
      // ended
    }
    v.src = null;
    v.endsAt = 0;
  }
}
