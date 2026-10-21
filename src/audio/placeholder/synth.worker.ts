/** Synth worker: renders placeholder PCM off the main thread and transfers the buffers back. */

import { renderSfxPCM, renderStemPCM, type PcmTrack, type StemName } from './pcm.js';

interface Job {
  id: number;
  kind: 'stem' | 'sfx';
  track?: PcmTrack;
  stem?: StemName;
  name?: string;
}

const ctx = self as unknown as { onmessage: (e: MessageEvent<Job>) => void; postMessage: (m: unknown, t: Transferable[]) => void };
ctx.onmessage = e => {
  const job = e.data;
  const pcm = job.kind === 'stem' ? renderStemPCM(job.track!, job.stem!) : renderSfxPCM(job.name!);
  ctx.postMessage({ id: job.id, pcm }, [pcm.buffer]);
};
