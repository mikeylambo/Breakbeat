/** Shell-compatible storage (mirrors @slu/web-shell BrowserStorage). Every access is try/catch guarded. */

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Synchronous JSON read of a raw (un-namespaced) key. Returns `fallback` on any failure. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = store()?.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota: progress simply does not persist.
  }
}

export function readFlag(key: string): boolean {
  try {
    return store()?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    if (on) store()?.setItem(key, '1');
    else store()?.removeItem(key);
  } catch {
    // ignore
  }
}

export class BrowserStorage implements StorageAdapter {
  constructor(private readonly namespace: string) {}

  private key(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    return readJson<T | null>(this.key(key), null);
  }

  async set<T>(key: string, value: T): Promise<void> {
    writeJson(this.key(key), value);
  }

  async remove(key: string): Promise<void> {
    try {
      store()?.removeItem(this.key(key));
    } catch {
      // ignore
    }
  }

  async clear(): Promise<void> {
    const s = store();
    if (!s) return;
    try {
      const prefix = `${this.namespace}:`;
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k?.startsWith(prefix)) s.removeItem(k);
      }
    } catch {
      // ignore
    }
  }
}
