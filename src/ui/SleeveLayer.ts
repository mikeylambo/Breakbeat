/** SleeveLayer — a movement's sleeve art behind a menu panel, cross-fading when the track changes. */

import type { TrackDef } from '../audio/tracks.js';
import { sleeveUrl } from '../render/SleeveArt.js';
import { el } from './dom.js';

export class SleeveLayer {
  readonly root = el('div', 'sleeve-layer', '', { 'aria-hidden': 'true' });
  private readonly a = el('i', 'sleeve');
  private readonly b = el('i', 'sleeve');
  private front = this.a;
  private current = '';

  constructor() {
    this.root.append(this.a, this.b);
  }

  /** Shows `track`'s sleeve (null hides it); locked tracks show desaturated. */
  set(track: TrackDef | null, locked = false): void {
    const url = track ? sleeveUrl(track) : '';
    const key = `${url}|${locked}`;
    if (key === this.current) return;
    this.current = key;
    const back = this.front === this.a ? this.b : this.a;
    back.style.backgroundImage = url ? `url("${url}")` : 'none';
    back.classList.toggle('locked', locked);
    back.classList.add('on');
    this.front.classList.remove('on');
    this.front = back;
  }
}
