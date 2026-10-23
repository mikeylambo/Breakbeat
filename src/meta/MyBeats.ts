/**
 * MyBeats — the player's songs, kept on this device in IndexedDB: a small `meta` store (listed
 * often) and a `files` store with the original bytes (read only when a song is played or tuned).
 * Nothing leaves the device. When IndexedDB is unavailable (private mode, blocked storage) the
 * shelf lives in memory for the session.
 */

import type { BeatMeta } from '../audio/byo.js';

const DB = 'breakbeat-beats';
const VERSION = 1;

interface FileRow {
  id: string;
  bytes: ArrayBuffer;
}

export class MyBeats {
  private db: Promise<IDBDatabase | null>;
  private readonly memMeta = new Map<string, BeatMeta>();
  private readonly memFiles = new Map<string, ArrayBuffer>();

  constructor() {
    this.db = new Promise(resolve => {
      try {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /** Newest first. */
  async list(): Promise<BeatMeta[]> {
    const db = await this.db;
    const rows = db ? await this.all<BeatMeta>(db, 'meta').catch(() => [...this.memMeta.values()]) : [...this.memMeta.values()];
    return rows.sort((a, b) => b.addedAt - a.addedAt);
  }

  async bytes(id: string): Promise<ArrayBuffer | null> {
    const db = await this.db;
    if (!db) return this.memFiles.get(id) ?? null;
    const row = await this.get<FileRow>(db, 'files', id).catch(() => null);
    return row?.bytes ?? this.memFiles.get(id) ?? null;
  }

  async put(meta: BeatMeta, bytes?: ArrayBuffer): Promise<void> {
    this.memMeta.set(meta.id, meta);
    if (bytes) this.memFiles.set(meta.id, bytes);
    const db = await this.db;
    if (!db) return;
    try {
      await this.tx(db, ['meta', 'files'], t => {
        t.objectStore('meta').put(meta);
        if (bytes) t.objectStore('files').put({ id: meta.id, bytes } satisfies FileRow);
      });
      // Stored durably: drop the session copy of the bytes
      this.memFiles.delete(meta.id);
    } catch {
      // quota or blocked: the session copy keeps it playable until reload
    }
  }

  async remove(id: string): Promise<void> {
    this.memMeta.delete(id);
    this.memFiles.delete(id);
    const db = await this.db;
    if (!db) return;
    await this.tx(db, ['meta', 'files'], t => {
      t.objectStore('meta').delete(id);
      t.objectStore('files').delete(id);
    }).catch(() => undefined);
  }

  private all<T>(db: IDBDatabase, store: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private get<T>(db: IDBDatabase, store: string, id: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private tx(db: IDBDatabase, stores: string[], fn: (t: IDBTransaction) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      fn(t);
    });
  }
}
