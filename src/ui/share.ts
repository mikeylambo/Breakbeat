/**
 * Share pass — renders ReplayView offscreen at 844x390 and records 3 s with
 * canvas.captureStream() + MediaRecorder (video/mp4 where supported, else webm), with the music
 * bus mixed in through a MediaStreamDestination. Web Share with files when available, else a
 * download. Without MediaRecorder, falls back to a PNG of the best-pass frame.
 */

import { Application, Container, Text, TextStyle } from 'pixi.js';
import { TUNING } from '../tuning.js';
import type { BestPassSnapshot } from '../pulse/types.js';
import { ReplayView } from '../render/ReplayView.js';
import { TileAtlas } from '../render/TileAtlas.js';
import { UI } from '../render/palette.js';
import { shareFiles } from '../platform/Share.js';

export interface ShareInput {
  snapshot: BestPassSnapshot;
  bpm: number;
  score: number;
  title: string;
  /** Mixed music stream (null = silent clip) */
  audio: MediaStream | null;
  /** Starts the movement's music for the clip; returns a stop function */
  startMusic: () => () => void;
}

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export async function sharePass(input: ShareInput): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const app = new Application();
  await app.init({ width: TUNING.STAGE_W, height: TUNING.STAGE_H, resolution: 1, background: UI.bg, autoStart: false, preference: 'webgl', preserveDrawingBuffer: true, antialias: true });
  const canvas = app.canvas as HTMLCanvasElement;
  try {
    const atlas = new TileAtlas(1);
    const replay = new ReplayView(atlas);
    replay.setSnapshot(input.snapshot, input.bpm);
    const scale = 0.94;
    replay.root.scale.set(scale);
    replay.root.position.set(TUNING.STAGE_W - 30 - replay.width * scale, (TUNING.STAGE_H - replay.height * scale) / 2);
    const brand = new Container();
    const word = new Text({ text: 'BREAK', style: new TextStyle({ fontFamily: 'Unbounded', fontWeight: '700', fontSize: 26, fill: UI.text }) });
    const beat = new Text({ text: 'BEAT', style: new TextStyle({ fontFamily: 'Unbounded', fontWeight: '700', fontSize: 26, fill: UI.held }) });
    beat.x = word.width;
    const title = new Text({ text: input.title, style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 10, fill: UI.secondary, letterSpacing: 2 }) });
    title.y = 44;
    const pts = new Text({ text: `+${input.snapshot.points.toLocaleString('en-US')}`, style: new TextStyle({ fontFamily: 'Unbounded', fontWeight: '600', fontSize: 22, fill: UI.text }) });
    pts.y = 70;
    const lbl = new Text({ text: `BEST PASS · ${input.snapshot.groupsDetonated} GROUPS`, style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 9, fill: UI.quiet, letterSpacing: 2 }) });
    lbl.y = 102;
    const total = new Text({ text: `SCORE ${input.score.toLocaleString('en-US')}`, style: new TextStyle({ fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: 10, fill: UI.secondary, letterSpacing: 2 }) });
    total.y = 300;
    brand.addChild(word, beat, title, pts, lbl, total);
    brand.position.set(30, 30);
    app.stage.addChild(replay.root, brand);

    const mime = pickMime();
    if (!mime || typeof canvas.captureStream !== 'function') {
      replay.update(input.snapshot ? (60 / input.bpm) * 4 * 0.98 : 0, 0.016);
      app.renderer.render(app.stage);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
      if (!blob) return 'failed';
      return shareFiles(new File([blob], 'breakbeat-best-pass.png', { type: 'image/png' }), 'BREAKBEAT best pass');
    }

    const stream = canvas.captureStream(30);
    for (const t of input.audio?.getAudioTracks() ?? []) stream.addTrack(t);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>(r => (rec.onstop = () => r()));
    const stopMusic = input.startMusic();
    rec.start(250);
    const start = performance.now();
    await new Promise<void>(resolve => {
      let last = start;
      const tick = (): void => {
        const now = performance.now();
        const t = (now - start) / 1000;
        replay.update(t, Math.min(0.05, (now - last) / 1000));
        last = now;
        app.renderer.render(app.stage);
        if (t < 3) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    stopMusic();
    await stopped;
    const type = mime.split(';')[0]!;
    const ext = type === 'video/mp4' ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    return shareFiles(new File([blob], `breakbeat-best-pass.${ext}`, { type }), 'BREAKBEAT best pass');
  } catch {
    return 'failed';
  } finally {
    app.destroy(true, { children: true, texture: true });
  }
}
