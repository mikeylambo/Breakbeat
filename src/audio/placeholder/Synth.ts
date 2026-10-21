/**
 * Placeholder synth front end. Renders PCM in a Web Worker (public/synth-worker.js) so stems and
 * one-shots never cost main-thread time, even mid-run when a movement morph needs new stems.
 * Falls back to rendering inline when Workers are unavailable.
 */

import type { StemName, TrackDef } from '../tracks.js';
import { SR, renderSfxPCM, renderStemPCM } from './pcm.js';

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, (pcm: Float32Array) => void>();

function getWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker('./synth-worker.js');
    worker.onmessage = (e: MessageEvent<{ id: number; pcm: Float32Array }>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data.pcm);
    };
    worker.onerror = () => {
      workerFailed = true;
      worker = null;
    };
  } catch {
    workerFailed = true;
  }
  return worker;
}

function toBuffer(pcm: Float32Array): AudioBuffer {
  const buf = new AudioBuffer({ length: pcm.length, numberOfChannels: 1, sampleRate: SR });
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  return buf;
}

function run(job: object, inline: () => Float32Array): Promise<AudioBuffer> {
  const w = getWorker();
  if (!w) return Promise.resolve(toBuffer(inline()));
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, pcm => resolve(toBuffer(pcm)));
    w.postMessage({ id, ...job });
  });
}

export function renderStem(track: TrackDef, stem: StemName): Promise<AudioBuffer> {
  const t = { id: track.id, bpm: track.bpm, key: track.key, style: track.style, sections: track.sections.map(x => x.bars) };
  return run({ kind: 'stem', track: t, stem }, () => renderStemPCM(t, stem));
}

export function renderSfx(name: string): Promise<AudioBuffer> {
  return run({ kind: 'sfx', name }, () => renderSfxPCM(name));
}
