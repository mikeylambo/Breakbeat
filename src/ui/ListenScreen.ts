/**
 * ListenScreen — the soundtrack. Every movement you have cleared (and the Overture) plays as a
 * full mix inside its world, with the visualizer at full strength.
 * Left: the act's tracks (locked ones say how to earn them). Right: the deck for what is playing:
 * time and pass, A/B/C section scrub, a five-stem mixer (meters, mute, solo), and the transport
 * (previous, play/pause, next, repeat, sleep timer, visualizer, clean view).
 * Keys: ↑ ↓ track, ← → act, Enter play, Space pause, N / P next / previous, A B C sections,
 * 1–5 mute (Shift solo), R repeat, S sleep, V visualizer, H clean view, Esc back.
 * Media keys and lock-screen controls work through the Media Session API where available.
 */

import { Jukebox, PASSES, type JukeboxHost } from '../audio/Jukebox.js';
import { ACTS, MOVEMENTS, OVERTURE, STEM_NAMES, type TrackDef } from '../audio/tracks.js';
import type { SaveData } from '../meta/Save.js';
import { hex, TILE_COLOURS } from '../render/palette.js';
import { VISUALIZER_PRESETS } from '../render/visualizerPresets.js';
import { worldFor } from '../render/worlds.js';
import type { App } from './App.js';
import { announce, button, el, ICONS, setText, uiSound } from './dom.js';
import { MenuList, type MenuItem } from './MenuList.js';
import { SleeveLayer } from './SleeveLayer.js';

const BAR = 16;
const LISTEN_LAYERS = 6;

const ICON = {
  prev: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14M19 5.5v13L9 12z" stroke="currentColor" stroke-width="2.2" fill="currentColor" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17 5v14M5 5.5v13L15 12z" stroke="currentColor" stroke-width="2.2" fill="currentColor" stroke-linejoin="round"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 11V9a3 3 0 0 1 3-3h11m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H6m3 3-3-3 3-3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="currentColor"/></svg>',
  vis: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 18v-4M8 18V8M12 18v-7M16 18V5M20 18v-9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  clean: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
};

/** Overture (once played) plus every cleared movement, in album order. */
export function listenQueue(save: SaveData): TrackDef[] {
  const q: TrackDef[] = [];
  if (save.overtureDone) q.push(OVERTURE);
  for (const m of MOVEMENTS) if (save.cleared.includes(m.id)) q.push(m);
  return q;
}

export interface ListenActions {
  back(): void;
}

export class ListenScreen {
  readonly root = el('div', 'setlist-screen listen-screen hidden', '', { role: 'main', 'aria-label': 'Listen' });
  readonly jukebox: Jukebox;
  private readonly list: MenuList;
  private readonly acts = el('div', 'act-tabs', '', { role: 'tablist', 'aria-label': 'Acts' });
  private readonly deck = el('section', 'sl-detail ls-deck');
  private readonly hint = el('div', 'ls-hint', '', { 'aria-live': 'polite' });
  private readonly cleanHint = el('div', 'ls-clean-hint', 'TAP OR PRESS H TO RETURN', { 'aria-hidden': 'true' });
  private readonly sleeve = new SleeveLayer();
  private readonly ghost = el('div', 'sl-ghost', '', { 'aria-hidden': 'true' });
  // Deck parts, built once and updated per frame
  private readonly dKicker = el('div', 'sld-kicker');
  private readonly dName = el('div', 'sld-name');
  private readonly dMeta = el('div', 'sld-meta');
  private readonly dTime = el('div', 'ls-time');
  private readonly secBtns: HTMLButtonElement[] = [];
  private readonly secFill: HTMLElement[] = [];
  private readonly secRow = el('div', 'ls-sections', '', { role: 'group', 'aria-label': 'Sections' });
  private readonly meters: HTMLElement[] = [];
  private readonly muteBtns: HTMLButtonElement[] = [];
  private readonly soloBtns: HTMLButtonElement[] = [];
  private readonly playBtn: HTMLButtonElement;
  private readonly repeatBtn: HTMLButtonElement;
  private readonly sleepBtn: HTMLButtonElement;
  private readonly visBtn: HTMLButtonElement;
  private act: string = ACTS[0];
  private save: SaveData | null = null;
  private shown: TrackDef | null = null;
  private lastTime = '';
  private lastSleep = '';
  private clean = false;

  constructor(
    private readonly app: App,
    private readonly a: ListenActions
  ) {
    const host: JukeboxHost = {
      step: () => app.clock.query(app.audio.now).absoluteStep,
      now: () => app.audio.now,
      blendTo: async (track, atStep) => {
        // The same track already sounding restarts from bar 1, so passes line up with the music
        if (app.stems.track === track && app.attractOn) {
          const at = await app.attractTo(track, LISTEN_LAYERS, atStep ?? this.nextBar());
          if (at !== null) app.stems.jumpSection(0, app.clock.stepToAudioSec(at));
          return at;
        }
        return app.attractTo(track, LISTEN_LAYERS, atStep);
      },
      preload: track => void app.stems.load(track),
      flowToSection: i => app.stems.setSection(i),
      jumpSection: (i, at) => app.stems.jumpSection(i, app.clock.stepToAudioSec(at)),
      setMix: (levels, ramp) => app.audio.setStemMix(levels, ramp),
      hold: on => app.holdMusic(on)
    };
    this.jukebox = new Jukebox(host, () => (this.save ? listenQueue(this.save) : []));

    this.list = new MenuList({
      cls: 'setlist',
      active: () => this.visible && !this.clean,
      onSelect: (_, it) => this.onSelect(it),
      onKey: e => this.onKey(e)
    });
    const head = el('div', 'sl-head');
    head.append(el('h2', 'sl-title', 'Listen'), this.acts);
    const left = el('section', 'sl-left');
    left.append(head, this.list.root);
    const panel = el('div', 'sl-panel', '', { 'aria-hidden': 'true' });
    panel.appendChild(this.sleeve.root);

    // Sections
    for (let i = 0; i < 3; i++) {
      const fill = el('i', 'ls-sec-fill');
      const b = button('ls-sec', `<span>${'ABC'[i]}</span>`, `Section ${'ABC'[i]}`, () => {
        uiSound('tick', i);
        this.jukebox.jump(i);
      });
      b.prepend(fill);
      this.secBtns.push(b);
      this.secFill.push(fill);
      this.secRow.appendChild(b);
    }

    // Mixer
    const mixer = el('div', 'ls-mixer', '', { role: 'group', 'aria-label': 'Stem mixer' });
    STEM_NAMES.forEach((name, i) => {
      const strip = el('div', 'ls-strip');
      strip.style.setProperty('--stem', hex(TILE_COLOURS[i]!.base));
      const meter = el('div', 'ls-meter', '<i></i>', { 'aria-hidden': 'true' });
      const m = button('ls-ms', 'M', `Mute ${name}`, () => {
        this.jukebox.toggleMute(i);
        uiSound('tick', i);
        this.syncMixer();
      });
      const s = button('ls-ms', 'S', `Solo ${name}`, () => {
        this.jukebox.toggleSolo(i);
        uiSound('tick', i);
        this.syncMixer();
      });
      const btns = el('div', 'ls-ms-row');
      btns.append(m, s);
      strip.append(meter, el('span', 'ls-stem', name.toUpperCase()), btns);
      this.meters.push(meter.firstElementChild as HTMLElement);
      this.muteBtns.push(m);
      this.soloBtns.push(s);
      mixer.appendChild(strip);
    });

    // Transport
    const tr = el('div', 'ls-transport');
    this.playBtn = button('ls-btn ls-play', ICONS.pause, 'Pause', () => this.togglePause());
    this.repeatBtn = button('ls-btn ls-chip', '', 'Repeat', () => this.cycleRepeat());
    this.sleepBtn = button('ls-btn ls-chip', '', 'Sleep timer', () => this.cycleSleep());
    this.visBtn = button('ls-btn ls-chip', '', 'Visualizer', () => this.cycleVis());
    tr.append(
      button('ls-btn', ICON.prev, 'Previous track', () => this.skip(-1)),
      this.playBtn,
      button('ls-btn', ICON.next, 'Next track', () => this.skip(1)),
      this.repeatBtn,
      this.sleepBtn,
      this.visBtn,
      button('ls-btn', ICON.clean, 'Clean view', () => this.setClean(true))
    );

    this.deck.append(this.dKicker, this.dName, this.dMeta, this.dTime, this.secRow, mixer, tr);
    const foot = el('div', 'sl-foot', '<b>ENTER</b>PLAY<b>SPACE</b>PAUSE<b>A B C</b>SECTION<b>1–5</b>MUTE<b>⇧</b>SOLO<b>V</b>VISUAL<b>H</b>CLEAN<b>ESC</b>BACK');
    this.root.append(panel, this.ghost, left, this.deck, this.hint, foot, this.cleanHint);
    this.root.addEventListener('pointerdown', () => {
      if (this.clean) this.setClean(false);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Opens Listen: keeps the menu's track if it is unlocked, else starts the album. */
  open(save: SaveData): void {
    this.save = save;
    const q = listenQueue(save);
    const playing = this.app.attracting;
    const start = playing && q.includes(playing) ? playing : (q[0] ?? null);
    this.act = start && start !== OVERTURE ? start.act : ACTS[0];
    this.root.classList.remove('hidden');
    this.setClean(false);
    this.app.visOverride = 1;
    this.app.vis.setPreset(this.app.settings.listenVisualizer);
    this.app.backdrop.show(false);
    this.renderList(start);
    this.list.relayout();
    this.shown = null;
    this.syncChips();
    this.syncMixer();
    this.deck.classList.toggle('empty', !start);
    if (start) this.jukebox.play(start);
    else setText(this.hint, 'Clear a movement in the Odyssey to add its music here.');
    this.installMediaSession();
    announce(start ? `Listen. ${q.length} tracks unlocked.` : 'Listen. Nothing unlocked yet.');
  }

  /** Leaves Listen: unity mix, music running, menu visualizer rules back. */
  close(): void {
    this.root.classList.add('hidden');
    this.jukebox.stop();
    this.app.visOverride = null;
    this.app.applySettings();
    this.app.backdrop.show(true);
    this.clearMediaSession();
  }

  /** Per frame while open. */
  onFrame(): void {
    if (!this.visible) return;
    const jb = this.jukebox;
    jb.update();
    const f = this.app.features;
    for (let i = 0; i < this.meters.length; i++) this.meters[i]!.style.transform = `scaleY(${(0.02 + 0.98 * f.env[i]!).toFixed(3)})`;

    const t = jb.track;
    if (t !== this.shown) this.showTrack(t);
    if (!t) return;
    const step = jb.paused ? jb.sectionStartStep : this.app.clock.query(this.app.audio.now).absoluteStep;
    const { pass, progress } = jb.passInfo(step);
    const pend = jb.pendingSection?.index ?? -1;
    for (let i = 0; i < this.secBtns.length; i++) {
      const b = this.secBtns[i]!;
      const has = i < t.sections.length;
      b.hidden = !has;
      b.classList.toggle('on', i === jb.section);
      b.classList.toggle('queued', i === pend && pend !== jb.section);
      this.secFill[i]!.style.transform = `scaleX(${i === jb.section ? progress.toFixed(3) : i < jb.section ? '1' : '0'})`;
    }
    const sixteenth = 60 / t.bpm / 4;
    const el = Math.max(0, step - jb.trackStartStep) * sixteenth;
    const total = Jukebox.lengthSteps(t) * sixteenth;
    const sec = t.sections[jb.section]?.name ?? 'A';
    const time = `${clock(el)} <s>/ ${jb.repeat === 'one' ? '∞' : clock(total)}</s><span>${sec} · PASS ${jb.repeat === 'one' ? pass : `${pass}/${PASSES}`}</span>`;
    if (time !== this.lastTime) {
      this.lastTime = time;
      this.dTime.innerHTML = time;
    }
    const left = jb.sleepLeft;
    const sl = left > 0 ? `${ICON.moon}<span>${clock(left)}</span>` : `${ICON.moon}<span>${jb.slept ? 'SLEPT' : 'SLEEP'}</span>`;
    if (sl !== this.lastSleep) {
      this.lastSleep = sl;
      this.sleepBtn.innerHTML = sl;
      this.sleepBtn.classList.toggle('on', left > 0);
    }
    this.playBtn.innerHTML = jb.paused ? ICONS.play : ICONS.pause;
    this.playBtn.setAttribute('aria-label', jb.paused ? 'Play' : 'Pause');
    if (jb.slept) setText(this.hint, 'Goodnight. Press play to carry on.');
  }

  private showTrack(t: TrackDef | null): void {
    this.shown = t;
    this.root.querySelectorAll('.menu-item').forEach(r => r.classList.toggle('playing', !!t && (r as HTMLElement).dataset.id === t.id));
    if (!t) return;
    const ov = t === OVERTURE;
    this.sleeve.set(ov ? null : t);
    this.root.style.setProperty('--sel-accent', hex(worldFor(t.style).accent));
    this.ghost.textContent = t.number;
    setText(this.dKicker, `NOW PLAYING · ${ov ? 'OVERTURE' : t.act === 'Coda' ? 'CODA' : `ACT ${t.act}`} · ${t.number}`);
    setText(this.dName, t.name);
    this.dMeta.innerHTML = `<span>${t.style.toUpperCase()}</span><span>${t.bpm} BPM</span><span>KEY ${t.key.toUpperCase()}</span>`;
    setText(this.hint, '');
    this.lastTime = '';
    this.updateMediaMetadata(t);
    if (this.jukebox.autoAdvanced) this.app.achieve('listen-full');
    announce(`Now playing: ${t.number} ${t.name}.`);
  }

  private renderList(select: TrackDef | null): void {
    const save = this.save;
    if (!save) return;
    this.acts.innerHTML = '';
    for (const a of ACTS) {
      const tab = button(`act-tab${a === this.act ? ' on' : ''}`, a === 'Coda' ? 'CODA' : `ACT ${a}`, a === 'Coda' ? 'Coda' : `Act ${a}`, () => this.setAct(a));
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(a === this.act));
      this.acts.appendChild(tab);
    }
    const q = listenQueue(save);
    const tracks = [...(this.act === ACTS[0] ? [OVERTURE] : []), ...MOVEMENTS.filter(m => m.act === this.act)];
    const items: MenuItem[] = tracks.map(t => {
      const open = q.includes(t);
      return {
        id: t.id,
        label: `${t.number} ${t.name}. ${open ? `${t.style}, ${t.bpm} BPM.` : 'Locked: clear it in the Odyssey.'}`,
        cls: `track-row${this.jukebox.track === t ? ' playing' : ''}`,
        locked: !open,
        action: () => this.jukebox.play(t),
        html: `<span class="track-num">${t.number}</span><span class="track-name">${t.name}<small>${open ? t.style.toUpperCase() : 'CLEAR IT TO UNLOCK'}</small></span><span class="ls-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="track-lock">${open ? '' : ICONS.lock}</span>`
      };
    });
    const at = select ? tracks.indexOf(select) : 0;
    this.list.setItems(items, Math.max(0, at));
    this.list.root.querySelectorAll('.menu-item').forEach((r, i) => ((r as HTMLElement).dataset.id = tracks[i]!.id));
  }

  private setAct(act: string, step = 0): void {
    this.act = act;
    uiSound('move', 2);
    this.renderList(null);
    if (step < 0) this.list.select(this.list.items.length - 1, true);
  }

  private onSelect(it: MenuItem): void {
    if (!it.locked) {
      setText(this.hint, '');
      return;
    }
    const i = MOVEMENTS.findIndex(m => m.id === it.id);
    setText(this.hint, i < 0 ? 'Play the Overture to unlock it.' : `Clear ${MOVEMENTS[i]!.number} ${MOVEMENTS[i]!.name} in the Odyssey to unlock it.`);
  }

  private onKey(e: KeyboardEvent): boolean {
    const jb = this.jukebox;
    const code = e.code;
    if (e.key === 'Escape' || e.key === 'Backspace') {
      uiSound('back');
      this.a.back();
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === ']' || e.key === 'ArrowLeft' || e.key === '[') {
      const dir = e.key === 'ArrowRight' || e.key === ']' ? 1 : -1;
      this.setAct(ACTS[(ACTS.indexOf(this.act as (typeof ACTS)[number]) + dir + ACTS.length) % ACTS.length]!);
      return true;
    }
    if (e.key === ' ') {
      this.togglePause();
      return true;
    }
    const digit = /^Digit([1-5])$/.exec(code);
    if (digit) {
      const i = Number(digit[1]) - 1;
      if (e.shiftKey) jb.toggleSolo(i);
      else jb.toggleMute(i);
      uiSound('tick', i);
      this.syncMixer();
      return true;
    }
    switch (code) {
      case 'KeyA':
      case 'KeyB':
      case 'KeyC':
        uiSound('tick', code.charCodeAt(3) - 65);
        jb.jump(code.charCodeAt(3) - 65);
        return true;
      case 'KeyN':
        this.skip(1);
        return true;
      case 'KeyP':
        this.skip(-1);
        return true;
      case 'KeyR':
        this.cycleRepeat();
        return true;
      case 'KeyS':
        this.cycleSleep();
        return true;
      case 'KeyV':
        this.cycleVis();
        return true;
      case 'KeyH':
        this.setClean(!this.clean);
        return true;
    }
    return false;
  }

  /** H in clean view: the list's key routing is off there, so this catches the way back. */
  readonly onWindowKey = (e: KeyboardEvent): void => {
    if (!this.visible || !this.clean) return;
    if (e.code === 'KeyH' || e.key === 'Escape') {
      e.preventDefault();
      this.setClean(false);
    } else if (e.key === ' ') {
      e.preventDefault();
      this.togglePause();
    }
  };

  private togglePause(): void {
    if (!this.jukebox.track) return;
    this.jukebox.togglePause();
    uiSound(this.jukebox.paused ? 'back' : 'pick');
    this.updatePlaybackState();
  }

  private skip(dir: 1 | -1): void {
    uiSound('move', dir > 0 ? 3 : 1);
    if (dir > 0) this.jukebox.next();
    else this.jukebox.prev();
  }

  private cycleRepeat(): void {
    this.jukebox.cycleRepeat();
    uiSound('tick', 1);
    this.syncChips();
    announce(this.jukebox.repeat === 'one' ? 'Repeat this section.' : 'Play through the album.');
  }

  private cycleSleep(): void {
    this.jukebox.cycleSleep();
    uiSound('tick', 2);
    this.lastSleep = '';
    announce(this.jukebox.sleepMinutes ? `Sleep in ${this.jukebox.sleepMinutes} minutes.` : 'Sleep timer off.');
  }

  private cycleVis(): void {
    const s = this.app.settings;
    const i = VISUALIZER_PRESETS.findIndex(p => p[0] === s.listenVisualizer);
    s.listenVisualizer = VISUALIZER_PRESETS[(i + 1) % VISUALIZER_PRESETS.length]![0];
    this.app.persistSettings();
    this.app.vis.setPreset(s.listenVisualizer);
    uiSound('tick', 3);
    this.syncChips();
  }

  private setClean(on: boolean): void {
    this.clean = on;
    this.root.classList.toggle('clean', on);
    if (on) announce('Clean view. Press H to return.');
  }

  private syncChips(): void {
    const jb = this.jukebox;
    this.repeatBtn.innerHTML = `${ICON.repeat}<span>${jb.repeat === 'one' ? 'ONE' : 'ALL'}</span>`;
    this.repeatBtn.classList.toggle('on', jb.repeat === 'one');
    const label = VISUALIZER_PRESETS.find(p => p[0] === this.app.settings.listenVisualizer)?.[1] ?? '';
    this.visBtn.innerHTML = `${ICON.vis}<span>${label.toUpperCase()}</span>`;
    this.lastSleep = '';
  }

  private syncMixer(): void {
    const jb = this.jukebox;
    const anySolo = jb.solo.some(Boolean);
    for (let i = 0; i < this.muteBtns.length; i++) {
      this.muteBtns[i]!.classList.toggle('on', jb.mute[i]!);
      this.muteBtns[i]!.setAttribute('aria-pressed', String(jb.mute[i]));
      this.soloBtns[i]!.classList.toggle('on', jb.solo[i]!);
      this.soloBtns[i]!.setAttribute('aria-pressed', String(jb.solo[i]));
      this.meters[i]!.parentElement!.parentElement!.classList.toggle('silent', jb.levels[i] === 0 || (anySolo && !jb.solo[i]));
    }
  }

  private nextBar(): number {
    const s = this.app.clock.query(this.app.audio.now).absoluteStep;
    return Math.ceil((s + BAR / 2) / BAR) * BAR;
  }

  // ---------------------------------------------------------------- media session

  private installMediaSession(): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.setActionHandler('play', () => this.jukebox.paused && this.togglePause());
      ms.setActionHandler('pause', () => !this.jukebox.paused && this.togglePause());
      ms.setActionHandler('nexttrack', () => this.skip(1));
      ms.setActionHandler('previoustrack', () => this.skip(-1));
    } catch {
      // unsupported action
    }
  }

  private updateMediaMetadata(t: TrackDef): void {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new MediaMetadata({
        title: t.name,
        artist: 'BREAKBEAT',
        album: `Vol. 01 · ${t === OVERTURE ? 'Overture' : t.act === 'Coda' ? 'Coda' : `Act ${t.act}`}`,
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      this.updatePlaybackState();
    } catch {
      // ignore
    }
  }

  private updatePlaybackState(): void {
    const ms = navigator.mediaSession;
    if (ms) ms.playbackState = this.jukebox.paused ? 'paused' : 'playing';
  }

  private clearMediaSession(): void {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = null;
      ms.playbackState = 'none';
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) ms.setActionHandler(a, null);
    } catch {
      // ignore
    }
  }
}

function clock(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
