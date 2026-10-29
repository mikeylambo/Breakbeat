/**
 * SettingsSheet — four tabs so each page stays short: Sound (volumes, visualizer), Timing (audio
 * offset, tap test), Display (flash, strobe-free, reduced motion, hide HUD, ghost) and Accessibility
 * (tempo, block symbols, colour assist, haptics). ← → or Q / E switch tabs; Esc closes.
 */

import { getLang, LANGS, t as tr } from '../i18n/i18n.js';
import { VISUALIZER_PRESETS } from '../render/visualizerPresets.js';
import type { Settings } from '../meta/Settings.js';
import { button, el, ICONS, uiSound } from './dom.js';

export interface SettingsHost {
  settings: Settings;
  hapticsSupported: boolean;
  apply(): void;
  calibrate(): void;
  onClose(): void;
}

const TABS = ['Sound', 'Timing', 'Display', 'Accessibility', 'Language'] as const;
const TAB_KEY = { Sound: 'set.sound', Timing: 'set.timing', Display: 'set.display', Accessibility: 'set.access', Language: 'set.language' } as const;
type Tab = (typeof TABS)[number];

export class SettingsSheet {
  readonly root = el('div', 'sheet-scrim settings-scrim hidden', '', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tr('title.settings') });
  private readonly tabs = el('div', 'set-tabs', '', { role: 'tablist', 'aria-label': tr('set.sections') });
  private readonly body = el('div', 'settings-body', '', { role: 'tabpanel' });
  private tab: Tab = 'Sound';
  open = false;

  constructor(private readonly host: SettingsHost) {
    const card = el('div', 'sheet settings-sheet');
    const head = el('div', 'settings-head');
    head.append(el('div', 'sheet-title', tr('set.title')), this.tabs, button('icon-btn settings-close', ICONS.close, 'Close settings', () => this.show(false)));
    card.append(head, this.body);
    this.root.appendChild(card);
    this.root.addEventListener('click', e => {
      if (e.target === this.root) this.show(false);
    });
    window.addEventListener('keydown', e => {
      if (!this.open) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        this.show(false);
        return;
      }
      // Sliders keep ← → for themselves while focused
      const onSlider = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range';
      const step = e.key === 'e' || e.key === 'E' || (e.key === 'ArrowRight' && !onSlider) ? 1 : e.key === 'q' || e.key === 'Q' || (e.key === 'ArrowLeft' && !onSlider) ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.setTab(TABS[(TABS.indexOf(this.tab) + step + TABS.length) % TABS.length]!);
    });
  }

  show(on: boolean): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on) this.render();
    else this.host.onClose();
  }

  private setTab(t: Tab): void {
    if (t === this.tab) return;
    this.tab = t;
    uiSound('move', TABS.indexOf(t));
    this.render();
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
    const toggle = (label: string, key: 'strobeFree' | 'reducedMotion' | 'haptics' | 'hapticMetronome' | 'hudHidden' | 'zenVisualizer' | 'ghost', note = '', disabled = false): HTMLElement => {
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

    const segmented = <V extends string | number>(label: string, note: string, opts: readonly (readonly [V, string])[], get: () => V, set: (v: V) => void): HTMLElement => {
      const row = el('div', 'set-row');
      const seg = el('div', 'segmented', '', { role: 'radiogroup', 'aria-label': label });
      for (const [v, l] of opts) {
        const btn = button(`seg${get() === v ? ' on' : ''}`, l, `${label} ${l}`, () => {
          set(v);
          change();
          this.render();
        });
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(get() === v));
        seg.appendChild(btn);
      }
      row.append(el('span', 'set-label', `${label}${note ? `<small>${note}</small>` : ''}`), seg);
      return row;
    };
    const flag = (label: string, key: 'symbols' | 'colourAssist', note: string): HTMLElement => {
      const row = el('label', 'set-row set-toggle');
      const input = el('input', '', '', { type: 'checkbox', role: 'switch', 'aria-label': label });
      input.checked = s[key];
      input.addEventListener('change', () => {
        s[key] = input.checked;
        change();
      });
      row.append(el('span', 'set-label', `${label}<small>${note}</small>`), input, el('span', 'switch', '', { 'aria-hidden': 'true' }));
      return row;
    };

    this.tabs.innerHTML = '';
    for (const t of TABS) {
      const tb = button(`set-tab${t === this.tab ? ' on' : ''}`, tr(TAB_KEY[t]), tr(TAB_KEY[t]), () => this.setTab(t));
      tb.setAttribute('role', 'tab');
      tb.setAttribute('aria-selected', String(t === this.tab));
      this.tabs.appendChild(tb);
    }

    const page = el('div', 'set-page');
    if (this.tab === 'Sound') {
      page.append(
        slider(tr('set.volume'), 'volume'),
        slider(tr('set.music'), 'music'),
        slider(tr('set.effects'), 'sfx'),
        segmented(tr('set.visualizer'), tr('set.visualizerNote'), [['off', tr('set.off')], ...VISUALIZER_PRESETS] as const, () => s.visualizer, v => (s.visualizer = v)),
        toggle(tr('set.zenVis'), 'zenVisualizer', tr('set.zenVisNote'), s.visualizer === 'off')
      );
    } else if (this.tab === 'Timing') {
      const off = el('div', 'set-row');
      const offVal = el('span', 'set-value set-offset', `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`, { 'aria-live': 'polite' });
      const nudge = (d: number): void => {
        s.offsetMs = Math.max(-150, Math.min(150, s.offsetMs + d));
        offVal.textContent = `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs} ms`;
        change();
      };
      off.append(
        el('span', 'set-label', `${tr('set.offset')}<small>${tr('set.offsetNote')}</small>`),
        button('step-btn', '−', 'Nudge audio offset earlier', () => nudge(-5)),
        offVal,
        button('step-btn', '+', 'Nudge audio offset later', () => nudge(5))
      );
      page.append(
        off,
        button('btn set-overture', tr('set.sync'), tr('set.sync'), () => {
          this.show(false);
          this.host.calibrate();
        })
      );
    } else if (this.tab === 'Display') {
      page.append(
        slider(tr('set.flash'), 'flash'),
        toggle(tr('set.strobe'), 'strobeFree', tr('set.strobeNote')),
        toggle(tr('set.motion'), 'reducedMotion', tr('set.motionNote')),
        toggle(tr('set.hud'), 'hudHidden', tr('set.hudNote')),
        toggle(tr('set.ghost'), 'ghost', tr('set.ghostNote'))
      );
    } else if (this.tab === 'Language') {
      const list = el('div', 'lang-list', '', { role: 'radiogroup', 'aria-label': tr('set.language') });
      const cur = getLang();
      for (const [code, name] of LANGS) {
        const b = button(`lang-item${code === cur ? ' on' : ''}`, `<b>${name}</b>`, name, () => {
          if (code === cur) return;
          s.lang = code;
          this.host.apply();
          // Every screen reads its strings as it is built: restart in the new language
          setTimeout(() => location.reload(), 120);
        });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(code === cur));
        list.appendChild(b);
      }
      page.append(list, el('div', 'lang-note', tr('set.languageNote')));
    } else {
      page.append(
        segmented(tr('set.tempo'), tr('set.tempoNote'), [[0.85, '85%'], [1, '100%']] as const, () => s.bpmScale as 0.85 | 1, v => (s.bpmScale = v)),
        flag(tr('set.symbols'), 'symbols', tr('set.symbolsNote')),
        flag(tr('set.assist'), 'colourAssist', tr('set.assistNote')),
        toggle(tr('set.haptics'), 'haptics', this.host.hapticsSupported ? '' : tr('set.hapticsNo'), !this.host.hapticsSupported),
        toggle(tr('set.metronome'), 'hapticMetronome', tr('set.metronomeNote'), !this.host.hapticsSupported)
      );
    }
    b.appendChild(page);
  }
}
