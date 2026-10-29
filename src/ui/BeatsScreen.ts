/**
 * BeatsScreen — My Beats: play the wall to your own songs. Everything stays on this device.
 * Left: "Add a song" and the shelf (newest first, best score each). Right: the selected song with
 * Play, Tune and Delete; or, while a song is read, its progress; or the Tune panel:
 *  tempo   −/+ 0.05 BPM, ÷2 / ×2, tap tempo (Space)
 *  grid    downbeat one beat earlier / later, ±10 ms
 *  parts   A / B / C start bars, 4 bars at a time
 *  check   Preview plays a section of the song with a click on every beat (accent on the one)
 * Drop an audio file anywhere on the screen to add it.
 */

import { analyse, buildStems, cleanName, decode, hashBytes, songName, trackFor, type BeatMeta, type Stage } from '../audio/byo.js';
import { foldBpm, SECTION_BARS, tapTempo } from '../audio/beatDetect.js';
import type { Key } from '../i18n/en.js';
import { getLang, t, t as tr, tn, tx } from '../i18n/i18n.js';
import { MyBeats } from '../meta/MyBeats.js';
import type { App } from './App.js';
import { announce, button, el, fmt, ICONS, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';

export interface BeatsActions {
  play(track: ReturnType<typeof trackFor>): void;
  back(): void;
}

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_SECONDS = 10 * 60;
const stageText = (s: Stage): string => tx(`bt.stage.${s}`, s);
const ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm';

export class BeatsScreen {
  readonly root = el('div', 'setlist-screen beats-screen hidden', '', { role: 'main', 'aria-label': t('title.beats') });
  readonly shelf = new MyBeats();
  private readonly list: MenuList;
  private readonly detail = el('section', 'sl-detail bt-detail', '', { 'aria-live': 'polite' });
  private readonly file = el('input', 'bt-file', '', { type: 'file', accept: ACCEPT, 'aria-hidden': 'true', tabindex: '-1' }) as HTMLInputElement;
  private readonly drop = el('div', 'bt-drop', `<b>${t('bt.drop')}</b><small>${t('bt.dropNote')}</small>`, { 'aria-hidden': 'true' });
  private beats: BeatMeta[] = [];
  private selected: BeatMeta | null = null;
  /** Decoded audio of the song being tuned / previewed (dropped when leaving) */
  private decoded: { id: string; buf: AudioBuffer } | null = null;
  private tuning: BeatMeta | null = null;
  private busy = false;
  private confirmDelete = false;
  private taps: number[] = [];
  private previewSrc: AudioBufferSourceNode | null = null;
  private previewSection = 0;
  private previewTimer = 0;
  private clickTimer = 0;

  constructor(
    private readonly app: App,
    private readonly a: BeatsActions
  ) {
    this.list = new MenuList({
      cls: 'setlist',
      active: () => this.visible && !this.tuning && !this.busy,
      onSelect: (_, it) => this.onSelect(it),
      onKey: e => this.onKey(e)
    });
    const head = el('div', 'sl-head');
    head.append(el('h2', 'sl-title', t('title.beats')), el('span', 'bt-private', t('bt.private')));
    const left = el('section', 'sl-left');
    left.append(head, this.list.root);
    const foot = el('div', 'sl-foot', t('bt.keys'));
    this.root.append(el('div', 'sl-panel', '', { 'aria-hidden': 'true' }), left, this.detail, foot, this.drop, this.file);
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.add(f);
    });
    this.root.addEventListener('dragover', e => {
      if (!this.visible || this.busy) return;
      e.preventDefault();
      this.root.classList.add('dragging');
    });
    this.root.addEventListener('dragleave', e => {
      if (e.target === this.root || e.target === this.drop) this.root.classList.remove('dragging');
    });
    this.root.addEventListener('drop', e => {
      e.preventDefault();
      this.root.classList.remove('dragging');
      const f = e.dataTransfer?.files?.[0];
      if (f && !this.busy) void this.add(f);
    });
    window.addEventListener('keydown', this.onTuneKey);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  async open(): Promise<void> {
    this.root.classList.remove('hidden');
    this.tuning = null;
    this.beats = (await this.shelf.list()).map(b => ({ ...b, name: cleanName(b.name) }));
    this.renderList(this.selected?.id);
    this.list.relayout();
    announce(`${t('title.beats')}. ${this.beats.length ? tn('bt.songs', this.beats.length) : t('bt.sayEmpty')}`);
  }

  hide(): void {
    this.stopPreview();
    this.root.classList.add('hidden');
    this.tuning = null;
    this.decoded = null;
  }

  // ---------------------------------------------------------------- list

  private renderList(selectId?: string): void {
    const items: MenuItem[] = [
      {
        id: '+',
        label: t('bt.addAria'),
        cls: 'track-row bt-add',
        action: () => this.file.click(),
        html: `<span class="track-num">+</span><span class="track-name">${t('bt.add')}<small>MP3 · M4A · WAV · OGG · FLAC</small></span><span></span><span></span>`
      },
      ...this.beats.map(b => {
        const best = this.app.save.best[`beat-${b.id}`] ?? 0;
        return {
          id: b.id,
          label: `${b.name}. ${Math.round(b.bpm)} BPM, ${t(b.minor ? 'bt.keyMinor' : 'sl.key', { key: b.key })}.${best ? ` ${t('bt.bestAria', { n: fmt(best) })}` : ''}`,
          cls: 'track-row',
          action: () => void this.play(b),
          html: `<span class="track-num">${Math.round(b.bpm)}</span><span class="track-name">${b.name}<small>${b.key}${b.minor ? 'm' : ''} · ${clock(b.durationSec)}</small></span><span class="bt-best">${best ? fmt(best) : ''}</span><span></span>`
        };
      })
    ];
    const at = selectId ? items.findIndex(i => i.id === selectId) : this.beats.length ? 1 : 0;
    this.list.setItems(items, Math.max(0, at));
  }

  private onSelect(it: MenuItem): void {
    this.confirmDelete = false;
    this.selected = this.beats.find(b => b.id === it.id) ?? null;
    if (!this.busy && !this.tuning) this.renderDetail();
  }

  private renderDetail(): void {
    const b = this.selected;
    this.detail.innerHTML = '';
    if (!b) {
      this.detail.innerHTML = `
        <div class="sld-kicker">${t('bt.kicker')}</div>
        <div class="sld-name">${t('bt.headline1')}<br>${t('bt.headline2')}</div>
        <p class="bt-copy">${t('bt.intro')}</p>`;
      this.detail.appendChild(button('btn btn-primary sld-play', `<span>${t('bt.add')}</span>`, t('bt.add'), () => this.file.click()));
      return;
    }
    const best = this.app.save.best[`beat-${b.id}`] ?? 0;
    this.detail.innerHTML = `
      <div class="sld-kicker">${t('bt.myBeat')} · ${new Date(b.addedAt).toLocaleDateString(getLang(), { day: 'numeric', month: 'short' }).toUpperCase()}</div>
      <div class="sld-name bt-name">${b.name}</div>
      <div class="sld-meta"><span>${b.bpm.toFixed(1)} BPM</span><span>${t(b.minor ? 'bt.keyMinor' : 'sl.key', { key: b.key }).toUpperCase()}</span><span>${clock(b.durationSec)}</span></div>
      <div class="sld-best"><div><small>${t('sl.best')}</small><b>${best ? fmt(best) : '—'}</b></div></div>
      ${b.confidence < 0.08 ? `<div class="bt-warn">${t('bt.warn')}</div>` : ''}`;
    const row = el('div', 'bt-actions');
    row.append(
      button('btn btn-primary sld-play', `${ICONS.play}<span>${t('title.play')}</span>`, t('et.playAria', { name: b.name }), () => void this.play(b)),
      button('btn bt-btn', t('bt.tune'), t('bt.tuneAria', { name: b.name }), () => void this.tune(b)),
      button('btn bt-btn bt-del', t('bt.remove'), t('bt.removeAria', { name: b.name }), () => void this.remove(b))
    );
    this.detail.appendChild(row);
  }

  private onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      uiSound('back');
      this.a.back();
      return true;
    }
    const b = this.selected;
    if (!b) return false;
    if (e.code === 'KeyT') {
      void this.tune(b);
      return true;
    }
    if (e.key === 'Delete') {
      void this.remove(b);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- add

  private status(text: string, step = 0, of = 5): void {
    this.detail.innerHTML = `
      <div class="sld-kicker">${t('bt.reading')}</div>
      <div class="sld-name bt-name">${text}</div>
      <div class="bt-progress"><i style="transform:scaleX(${(step / of).toFixed(2)})"></i></div>`;
  }

  private fail(msg: string): void {
    this.busy = false;
    uiSound('deny');
    this.detail.innerHTML = `<div class="sld-kicker">${t('bt.failed')}</div><p class="bt-copy">${msg}</p>`;
    this.detail.appendChild(button('btn btn-primary sld-play', `<span>${t('bt.another')}</span>`, t('bt.anotherAria'), () => this.file.click()));
    announce(msg);
  }

  async add(f: File): Promise<void> {
    if (this.busy) return;
    if (f.size > MAX_BYTES) return this.fail(t('bt.err.size'));
    this.busy = true;
    this.stopPreview();
    this.tuning = null;
    const order: Stage[] = ['decode', 'tempo', 'key', 'sections'];
    const stage = (s: Stage): void => {
      this.status(`${stageText(s)}…`, order.indexOf(s) + 1, order.length + 1);
      announce(stageText(s));
    };
    try {
      stage('decode');
      const bytes = await f.arrayBuffer();
      const id = await hashBytes(bytes);
      let buf: AudioBuffer;
      try {
        buf = await decode(this.app.audio.ctx, bytes);
      } catch {
        return this.fail(t('bt.err.decode'));
      }
      if (buf.duration > MAX_SECONDS) return this.fail(t('bt.err.long'));
      const known = this.beats.find(b => b.id === id);
      const meta = known ?? (await analyse(buf, id, songName(f.name), stage));
      if (!known) await this.shelf.put(meta, bytes);
      this.decoded = { id, buf };
      this.beats = (await this.shelf.list()).map(b => ({ ...b, name: cleanName(b.name) }));
      this.busy = false;
      this.renderList(id);
      this.selected = this.beats.find(b => b.id === id) ?? meta;
      uiSound('fanfare');
      announce(t('bt.sayAdded', { name: meta.name, bpm: Math.round(meta.bpm), key: meta.key }));
      void this.tune(this.selected);
    } catch (err) {
      this.fail(errText(err, 'bt.err.read'));
    }
  }

  private async remove(b: BeatMeta): Promise<void> {
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      uiSound('tick');
      const del = this.detail.querySelector('.bt-del');
      if (del) del.textContent = t('bt.confirm');
      return;
    }
    this.confirmDelete = false;
    await this.shelf.remove(b.id);
    delete this.app.save.best[`beat-${b.id}`];
    this.app.persistSave();
    uiSound('back');
    this.beats = this.beats.filter(x => x.id !== b.id);
    this.selected = null;
    this.renderList();
    announce(t('bt.sayRemoved', { name: b.name }));
  }

  // ---------------------------------------------------------------- play

  private async audioFor(b: BeatMeta): Promise<AudioBuffer> {
    if (this.decoded?.id === b.id) return this.decoded.buf;
    const bytes = await this.shelf.bytes(b.id);
    if (!bytes) throw new Error(t('bt.err.gone'));
    const buf = await decode(this.app.audio.ctx, bytes);
    this.decoded = { id: b.id, buf };
    return buf;
  }

  private async play(b: BeatMeta): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.stopPreview();
    try {
      this.status(`${stageText('stems')}…`, 4, 5);
      const buf = await this.audioFor(b);
      const set = await buildStems(buf, b);
      const track = trackFor(b);
      this.app.stems.register(track, set);
      this.busy = false;
      this.tuning = null;
      this.a.play(track);
    } catch (err) {
      this.fail(errText(err, 'bt.err.prepare'));
    }
  }

  // ---------------------------------------------------------------- tune

  private async tune(b: BeatMeta): Promise<void> {
    this.tuning = { ...b, sections: [...b.sections] };
    this.taps = [];
    this.previewSection = 0;
    this.renderTune();
    try {
      await this.audioFor(b);
    } catch (err) {
      this.fail(errText(err, 'bt.err.unread'));
    }
  }

  private renderTune(): void {
    const t = this.tuning;
    if (!t) return;
    const beat = 60 / t.bpm;
    const set = (fn: (m: BeatMeta) => void): (() => void) => () => {
      fn(t);
      this.clampSections(t);
      uiSound('tick', 2);
      this.stopPreview();
      this.renderTune();
    };
    this.detail.innerHTML = `<div class="sld-kicker">${tr('bt.tune').toUpperCase()} · ${t.name.toUpperCase()}</div>`;
    const row = (label: string, value: string, ...btns: HTMLButtonElement[]): HTMLElement => {
      const r = el('div', 'bt-row');
      const v = el('div', 'bt-val', `<small>${label}</small><b>${value}</b>`);
      const g = el('div', 'bt-btns');
      g.append(...btns);
      r.append(v, g);
      return r;
    };
    const b = (html: string, label: string, fn: () => void): HTMLButtonElement => button('ls-btn', html, label, fn);
    const tap = b(tr('bt.tap'), tr('bt.tapAria'), () => this.tap());
    this.detail.append(
      row(
        tr('bt.tempo'),
        `${t.bpm.toFixed(2)} <s>BPM</s>`,
        b('−', tr('bt.slower'), set(m => (m.bpm = Math.max(60, +(m.bpm - 0.05).toFixed(2))))),
        b('+', tr('bt.faster'), set(m => (m.bpm = Math.min(180, +(m.bpm + 0.05).toFixed(2))))),
        b('÷2', tr('bt.half'), set(m => (m.bpm = m.bpm / 2 >= 60 ? m.bpm / 2 : m.bpm))),
        b('×2', tr('bt.double'), set(m => (m.bpm = m.bpm * 2 <= 180 ? m.bpm * 2 : m.bpm))),
        tap
      ),
      row(
        tr('bt.downbeat'),
        `${t.downbeatSec.toFixed(3)} <s>S</s>`,
        b('◀', tr('bt.beatEarlier'), set(m => (m.downbeatSec = wrapDownbeat(m.downbeatSec - beat, m.bpm)))),
        b('−10', tr('bt.msEarlier'), set(m => (m.downbeatSec = wrapDownbeat(m.downbeatSec - 0.01, m.bpm)))),
        b('+10', tr('bt.msLater'), set(m => (m.downbeatSec = wrapDownbeat(m.downbeatSec + 0.01, m.bpm)))),
        b('▶', tr('bt.beatLater'), set(m => (m.downbeatSec = wrapDownbeat(m.downbeatSec + beat, m.bpm))))
      )
    );
    const parts = el('div', 'bt-parts');
    for (let k = 0; k < 3; k++) {
      const p = el('div', `bt-part${this.previewSection === k ? ' on' : ''}`);
      p.append(
        el('span', 'bt-part-name', 'ABC'[k]!),
        el('span', 'bt-part-bar', tr('hud.barN', { n: t.sections[k]! + 1 })),
        b('◀', tr('bt.secEarlier', { s: 'ABC'[k]! }), set(m => (m.sections[k] = m.sections[k]! - 4))),
        b('▶', tr('bt.secLater', { s: 'ABC'[k]! }), set(m => (m.sections[k] = m.sections[k]! + 4))),
        b(ICONS.play, tr('bt.preview', { s: 'ABC'[k]! }), () => this.preview(k))
      );
      parts.appendChild(p);
    }
    this.detail.appendChild(parts);
    const act = el('div', 'bt-actions');
    act.append(
      button('btn btn-primary sld-play', `${ICONS.play}<span>${tr('bt.savePlay')}</span>`, tr('bt.savePlay'), () => void this.saveTune(true)),
      button('btn bt-btn', tr('bt.save'), tr('bt.save'), () => void this.saveTune(false)),
      button('btn bt-btn', tr('bt.cancel'), tr('bt.cancel'), () => {
        this.stopPreview();
        this.tuning = null;
        this.renderDetail();
      })
    );
    this.detail.appendChild(act);
  }

  private clampSections(t: BeatMeta): void {
    const dur = this.decoded?.id === t.id ? this.decoded.buf.duration : t.durationSec;
    t.bars = Math.max(SECTION_BARS, Math.floor(((dur - t.downbeatSec) * t.bpm) / 240));
    for (let k = 0; k < 3; k++) t.sections[k] = Math.max(0, Math.min(t.bars - SECTION_BARS, t.sections[k]!));
  }

  private tap(): void {
    const now = performance.now() / 1000;
    if (this.taps.length && now - this.taps[this.taps.length - 1]! > 2) this.taps = [];
    this.taps.push(now);
    uiSound('tick', this.taps.length % 4);
    const bpm = tapTempo(this.taps);
    if (bpm && this.tuning) {
      this.tuning.bpm = Math.round(foldBpm(bpm) * 100) / 100;
      this.clampSections(this.tuning);
      this.renderTune();
    }
  }

  private async saveTune(andPlay: boolean): Promise<void> {
    const t = this.tuning;
    if (!t) return;
    this.stopPreview();
    await this.shelf.put(t);
    this.beats = this.beats.map(b => (b.id === t.id ? t : b));
    this.selected = t;
    this.tuning = null;
    uiSound('pick');
    if (andPlay) void this.play(t);
    else {
      this.renderList(t.id);
      this.renderDetail();
    }
  }

  /** Eight bars of section `k` from the original song, with a click on every beat. */
  private preview(k: number): void {
    const t = this.tuning;
    const dec = this.decoded;
    if (!t || !dec || dec.id !== t.id) return;
    this.stopPreview();
    this.previewSection = k;
    this.renderTune();
    const app = this.app;
    const ctx = app.audio.ctx;
    const beat = 60 / t.bpm;
    const t0 = ctx.currentTime + 0.12;
    const from = t.downbeatSec + t.sections[k]! * beat * 4;
    app.audio.setStemMix([0, 0, 0, 0, 0], 0.12);
    const src = ctx.createBufferSource();
    src.buffer = dec.buf;
    src.connect(app.audio.musicBus);
    src.start(t0, from, beat * 4 * SECTION_BARS);
    this.previewSrc = src;
    // Clicks in the song's key, scheduled a quarter second ahead (the voice pool is small)
    app.sfx.setTrack(trackFor(t));
    let next = 0;
    const clicks = (): void => {
      const horizon = ctx.currentTime + 0.25;
      while (next < 4 * SECTION_BARS && t0 + next * beat < horizon) {
        app.sfx.play(next % 4 === 0 ? 'prime-3' : 'prime-0', t0 + next * beat, next % 4 === 0 ? 0.5 : 0.22, true);
        next++;
      }
    };
    clicks();
    this.clickTimer = window.setInterval(clicks, 50);
    this.previewTimer = window.setTimeout(() => this.stopPreview(), (beat * 4 * SECTION_BARS + 0.2) * 1000);
    announce(tr('bt.sayPreview', { s: 'ABC'[k]! }));
  }

  private stopPreview(): void {
    clearTimeout(this.previewTimer);
    clearInterval(this.clickTimer);
    if (!this.previewSrc) return;
    try {
      this.previewSrc.stop();
    } catch {
      // already ended
    }
    this.previewSrc.disconnect();
    this.previewSrc = null;
    this.app.audio.setStemMix([1, 1, 1, 1, 1], 0.3);
  }

  private readonly onTuneKey = (e: KeyboardEvent): void => {
    if (!this.visible || !this.tuning || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      this.tap();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.stopPreview();
      this.tuning = null;
      this.renderDetail();
    } else if (e.code === 'KeyP') {
      this.preview(this.previewSection);
    }
  };
}

/** Keeps the downbeat inside the first bar (moving it a beat back from the start wraps a bar on). */
function wrapDownbeat(sec: number, bpm: number): number {
  const bar = 240 / bpm;
  return ((sec % bar) + bar) % bar;
}

/** A thrown message in the current language: known analysis errors are translated, else `fallback`. */
function errText(err: unknown, fallback: Key): string {
  const m = err instanceof Error ? err.message : '';
  return m.startsWith('That song is too short') ? t('bt.err.short') : m || t(fallback);
}

function clock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

