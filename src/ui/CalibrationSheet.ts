/**
 * CalibrationSheet — tap along to 12 clicks; the median of the last 8 taps (measured against what
 * is audible, via AudioContext.getOutputTimestamp) becomes the audio offset. Fixes Bluetooth and
 * TV latency the browser does not report.
 */

import type { App } from './App.js';
import { announce, button, el } from './dom.js';

const BEATS = 12;
const BPM = 100;

export class CalibrationSheet {
  readonly root = el('div', 'sheet-scrim calib-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sync timing' });
  private readonly ring = el('div', 'calib-ring');
  private readonly dots = el('div', 'calib-dots');
  private readonly status = el('div', 'calib-status', '', { 'aria-live': 'polite' });
  private readonly action: HTMLButtonElement;
  private beats: number[] = [];
  private taps: number[] = [];
  private running = false;
  private raf = 0;
  open = false;
  onDone: () => void = () => {};

  constructor(private readonly app: App) {
    const card = el('div', 'sheet calib-sheet');
    card.append(
      el('div', 'sheet-title', 'SYNC TIMING'),
      el('div', 'calib-copy', 'Tap anywhere on each click. Headphones on, volume up.'),
      this.ring,
      this.dots,
      this.status
    );
    this.action = button('btn btn-primary', 'Start', 'Start calibration', () => void this.start());
    const row = el('div', 'calib-actions');
    row.append(this.action, button('btn btn-quiet', 'Close', 'Close', () => this.show(false)));
    card.appendChild(row);
    this.root.appendChild(card);
    this.root.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.tap(e.timeStamp);
    });
    window.addEventListener('keydown', e => {
      if (this.open && (e.key === ' ' || e.key === 'Enter') && this.running) {
        e.preventDefault();
        this.tap(e.timeStamp);
      }
    });
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.reset();
    else {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.onDone();
    }
  }

  private reset(): void {
    const ms = this.app.settings.offsetMs;
    this.status.textContent = `Current offset ${ms > 0 ? '+' : ''}${ms} ms`;
    this.dots.innerHTML = '<span></span>'.repeat(BEATS);
    this.action.textContent = 'Start';
    this.action.disabled = false;
  }

  private async start(): Promise<void> {
    await this.app.audio.resume();
    await this.app.audio.unlock();
    await this.app.sfx.load();
    this.taps = [];
    this.beats = [];
    this.running = true;
    this.action.disabled = true;
    this.action.textContent = 'Listening…';
    this.status.textContent = 'Tap on each click';
    const beat = 60 / BPM;
    const t0 = this.app.audio.now + 0.6;
    for (let i = 0; i < BEATS; i++) {
      const t = t0 + i * beat;
      this.beats.push(t);
      this.app.sfx.play(i % 4 === 0 ? 'detonate' : 'prime-0', t, 0.9);
    }
    const dots = this.dots.querySelectorAll('span');
    const loop = (): void => {
      const now = this.app.audio.now;
      let lit = 0;
      for (const b of this.beats) if (now >= b) lit++;
      dots.forEach((d, i) => d.classList.toggle('on', i < lit));
      const next = this.beats.find(b => b > now - 0.05);
      const phase = next === undefined ? 1 : Math.max(0, Math.min(1, (next - now) / beat));
      this.ring.style.transform = `scale(${1 + 0.18 * (1 - phase) * (1 - phase)})`;
      if (now < this.beats[BEATS - 1]! + 0.6) this.raf = requestAnimationFrame(loop);
      else this.finish();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Converts an event timestamp to the AudioContext time that was audible at that moment. */
  private toAudible(eventMs: number): number {
    const ctx = this.app.audio.ctx as AudioContext & { getOutputTimestamp?: () => AudioTimestamp };
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.contextTime + (eventMs - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - this.app.audio.outputLatencySec - (performance.now() - eventMs) / 1000;
  }

  private tap(eventMs: number): void {
    if (!this.running) return;
    const t = this.toAudible(eventMs);
    let best = Infinity;
    for (const b of this.beats) if (Math.abs(t - b) < Math.abs(best)) best = t - b;
    if (Math.abs(best) < 0.3) this.taps.push(best);
    this.ring.classList.remove('hit');
    void this.ring.offsetWidth;
    this.ring.classList.add('hit');
  }

  private finish(): void {
    this.running = false;
    const use = this.taps.slice(-8).sort((a, b) => a - b);
    this.action.disabled = false;
    this.action.textContent = 'Again';
    if (use.length < 5) {
      this.status.textContent = 'Not enough taps. Try again.';
      return;
    }
    const median = use[use.length >> 1]!;
    const ms = Math.max(-150, Math.min(150, Math.round((median * 1000) / 5) * 5));
    this.app.settings.offsetMs = ms;
    this.app.settings.calibrated = true;
    this.app.persistSettings();
    this.status.textContent = `Offset ${ms > 0 ? '+' : ''}${ms} ms · saved`;
    announce(`Timing synced. Offset ${ms} milliseconds.`);
  }
}
