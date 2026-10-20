/**
 * SettingsSheet — volume, flash intensity, strobe-free, reduced motion, haptics, haptic metronome,
 * colour-assist, BPM scaling (score-normalised), replay Overture, audio offset nudge, hide HUD.
 */

import type { Settings } from '../meta/Settings.js';
import { button, el, ICONS } from './dom.js';

export interface SettingsHost {
  settings: Settings;
  hapticsSupported: boolean;
  apply(): void;
  replayOverture(): void;
  onClose(): void;
}

export class SettingsSheet {
  readonly root = el('div', 'sheet-scrim settings-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' });
  private readonly body = el('div', 'settings-body');
  open = false;

  constructor(private readonly host: SettingsHost) {
    const card = el('div', 'sheet settings-sheet');
    const head = el('div', 'settings-head');
    head.append(el('div', 'sheet-title', 'SETTINGS'), button('icon-btn settings-close', ICONS.close, 'Close settings', () => this.show(false)));
    card.append(head, this.body);
    this.root.appendChild(card);
    this.root.addEventListener('click', e => {
      if (e.target === this.root) this.show(false);
    });
    window.addEventListener('keydown', e => {
      if (this.open && e.key === 'Escape') {
        e.stopImmediatePropagation();
        this.show(false);
      }
    });
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.render();
    else this.host.onClose();
  }

  private render(): void {
    const s = this.host.settings;
    const b = this.body;
    b.innerHTML = '';
    const change = (): void => this.host.apply();

    const slider = (label: string, key: 'volume' | 'music' | 'sfx' | 'flash'): HTMLElement => {
      const row = el('label', 'set-row');
      const input = el('input', 'set-slider', '', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': label });
      input.value = String(Math.round(s[key] * 100));
      const val = el('span', 'set-value', `${input.value}%`);
      input.addEventListener('input', () => {
        s[key] = Number(input.value) / 100;
        val.textContent = `${input.value}%`;
        change();
      });
      row.append(el('span', 'set-label', label), input, val);
      return row;
    };
    const toggle = (label: string, key: 'strobeFree' | 'reducedMotion' | 'haptics' | 'hapticMetronome' | 'colourAssist' | 'hudHidden', note = '', disabled = false): HTMLElement => {
      const row = el('label', `set-row set-toggle${disabled ? ' disabled' : ''}`);
      const input = el('input', '', '', { type: 'checkbox', role: 'switch', 'aria-label': label });
      input.checked = s[key];
      input.disabled = disabled;
      input.addEventListener('change', () => {
        s[key] = input.checked;
        change();
      });
      row.append(el('span', 'set-label', `${label}${note ? `<small>${note}</small>` : ''}`), input, el('span', 'switch', '', { 'aria-hidden': 'true' }));
      return row;
    };

    const col1 = el('div', 'set-col');
    col1.append(
      el('div', 'set-group', 'SOUND'),
      slider('Volume', 'volume'),
      slider('Music', 'music'),
      slider('Effects', 'sfx'),
      el('div', 'set-group', 'TIMING')
    );
    // Audio offset nudge
    const off = el('div', 'set-row');
    const offVal = el('span', 'set-value set-offset', `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`, { 'aria-live': 'polite' });
    const nudge = (d: number): void => {
      s.offsetMs = Math.max(-150, Math.min(150, s.offsetMs + d));
      offVal.textContent = `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`;
      change();
    };
    off.append(
      el('span', 'set-label', 'Audio offset<small>If the blade looks early, nudge +</small>'),
      button('step-btn', '−', 'Nudge audio offset earlier', () => nudge(-5)),
      offVal,
      button('step-btn', '+', 'Nudge audio offset later', () => nudge(5))
    );
    col1.appendChild(off);
    // BPM scaling
    const bpm = el('div', 'set-row');
    const seg = el('div', 'segmented', '', { role: 'radiogroup', 'aria-label': 'Tempo' });
    for (const [v, l] of [
      [0.85, '85%'],
      [1, '100%']
    ] as const) {
      const btn = button(`seg${s.bpmScale === v ? ' on' : ''}`, l, `Tempo ${l}`, () => {
        s.bpmScale = v;
        change();
        this.render();
      });
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(s.bpmScale === v));
      seg.appendChild(btn);
    }
    bpm.append(el('span', 'set-label', 'Tempo<small>Scores are scaled to match</small>'), seg);
    col1.appendChild(bpm);
    col1.appendChild(
      button('btn set-overture', 'Replay Overture', 'Replay the Overture', () => {
        this.show(false);
        this.host.replayOverture();
      })
    );

    const col2 = el('div', 'set-col');
    col2.append(
      el('div', 'set-group', 'COMFORT'),
      slider('Flash intensity', 'flash'),
      toggle('Strobe-free', 'strobeFree', 'Max 3 flashes a second'),
      toggle('Reduced motion', 'reducedMotion', 'No camera breath or wall slide'),
      toggle('Colour assist', 'colourAssist', 'Stronger glyphs'),
      toggle('Haptics', 'haptics', this.host.hapticsSupported ? '' : 'Not supported on this device', !this.host.hapticsSupported),
      toggle('Haptic metronome', 'hapticMetronome', 'A tick on every beat', !this.host.hapticsSupported),
      toggle('Hide HUD', 'hudHidden', 'Or press V')
    );
    b.append(col1, col2);
  }
}
