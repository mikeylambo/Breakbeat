/**
 * Ghosts — the replay of your best run per key (movement id, mode, `daily-YYYY-MM-DD`, or a
 * player track's id), kept on this device in IndexedDB (memory fallback). A run re-simulates it
 * beside you as a pace ghost. Old Daily ghosts are dropped when a new day's is stored.
 */

import type { Replay } from '../pulse/Replay.js';

export interface GhostRecord {
  key: string;
  /** Normalised score (raw x tempo scale), as shown on the HUD */
  score: number;
  /** Tempo scale the run used, to normalise the ghost's score as it plays */
  scale: number;
  replay: Replay;
  at: number;
}

const DB = 'breakbeat-ghosts';

export class Ghosts {
  private readonly db: Promise<IDBDatabase | null>;
  private readonly mem = new Map<string, GhostRecord>();

  constructor() {
    this.db = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('best', { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async get(key: string): Promise<GhostRecord | null> {
    const db = await this.db;
    if (!db) return this.mem.get(key) ?? null;
    return new Promise(resolve => {
      try {
        const req = db.transaction('best', 'readonly').objectStore('best').get(key);
        req.onsuccess = () => resolve((req.result as GhostRecord | undefined) ?? this.mem.get(key) ?? null);
        req.onerror = () => resolve(this.mem.get(key) ?? null);
      } catch {
        resolve(this.mem.get(key) ?? null);
      }
    });
  }

  /** Stores `rec` if it beats what is kept for its key. */
  async offer(rec: GhostRecord): Promise<boolean> {
    const cur = await this.get(rec.key);
    if (cur && cur.score >= rec.score) return false;
    this.mem.set(rec.key, rec);
    const db = await this.db;
    if (!db) return true;
    await new Promise<void>(resolve => {
      try {
        const t = db.transaction('best', 'readwrite');
        const store = t.objectStore('best');
        store.put(rec);
        // One Daily ghost at a time: yesterday's wall never comes back
        if (rec.key.startsWith('daily-')) {
          const req = store.getAllKeys();
          req.onsuccess = () => {
            for (const k of req.result) if (typeof k === 'string' && k.startsWith('daily-') && k !== rec.key) store.delete(k);
          };
        }
        t.oncomplete = () => resolve();
        t.onerror = () => resolve();
        t.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
    return true;
  }
}
