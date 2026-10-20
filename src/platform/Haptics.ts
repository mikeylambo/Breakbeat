/** Shell-compatible haptics (mirrors @slu/web-shell BrowserHaptics; mobile vibrate only). */

export interface HapticPattern {
  mobile: number | number[];
}
export type HapticCatalog = Record<string, HapticPattern>;

export class BrowserHaptics {
  private enabled = true;
  private readonly supported: boolean;

  constructor(private readonly catalog: HapticCatalog = {}) {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    if (!enabled && this.supported) {
      try {
        navigator.vibrate(0);
      } catch {
        // ignore
      }
    }
    return this.enabled;
  }

  pulse(id: string): boolean {
    const spec = this.catalog[id];
    if (!spec || !this.enabled || !this.supported) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    try {
      return navigator.vibrate(spec.mobile);
    } catch {
      return false;
    }
  }

  get isSupported(): boolean {
    return this.supported;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
}
