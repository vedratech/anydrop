// Resume records behind one internal interface, with an IndexedDB and a memory
// implementation. AnyDropCore reaches them only through createResumeStore(), imported in one place.
// Every IndexedDB access is wrapped: private mode and iOS can throw, and an upload must never fail
// because of persistence. On any failure the store warns once and carries on in memory.
// Nothing runs at import time.

import { warn } from '../util/env';

export interface ResumeRecord {
  /** `${persistKey}::${fingerprint}` */
  key: string;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  /** Chunk indexes acknowledged with a 2xx. */
  chunksDone: number[];
  completed: boolean;
  updatedAt: number;
}

export interface ResumeStore {
  /**
   * Records of these keys, which all start with `prefix` (one read of the prefix range, so a
   * 10k-file drop costs one request). Pending writes win; expired records are missing.
   */
  get(prefix: string, keys: string[]): Promise<(ResumeRecord | undefined)[]>;
  /** Batched: written in one transaction about every 250 ms, or on `flush()`. */
  put(record: ResumeRecord): void;
  del(key: string): void;
  /** Writes pending changes now (page hidden, `pagehide`, `destroy()`). */
  flush(): void;
  /** Flushes, then releases the database. */
  close(): void;
  /** Deletes every record whose key starts with `prefix`. */
  clear(prefix: string): Promise<void>;
}

/** Records expire after 7 days; swept when the database opens. */
export const TTL = 7 * 864e5;
/** Some iOS Safari versions never call back from `indexedDB.open()`: give up after this (ms). */
export const OPEN_TIMEOUT = 1500;
const STORE = 'uploads';
const range = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '￿');
/** `p`, or `fallback` when it takes longer than `OPEN_TIMEOUT`. */
const within = <T>(p: Promise<T>, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), OPEN_TIMEOUT);
    void p.then((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
const live = (r: ResumeRecord | undefined) => (r && r.updatedAt > Date.now() - TTL ? r : undefined);

/** In-memory store: the fallback when IndexedDB is missing or throws (per instance). */
export function memoryStore(): ResumeStore {
  const map = new Map<string, ResumeRecord>();
  return {
    get: (_prefix, keys) => Promise.resolve(keys.map((k) => live(map.get(k)))),
    put: (r) => void map.set(r.key, r),
    del: (k) => void map.delete(k),
    flush() {},
    close() {},
    clear(prefix) {
      map.forEach((_, k) => {
        if (!k.indexOf(prefix)) map.delete(k);
      });
      return Promise.resolve();
    },
  };
}

/** IndexedDB store: database `anydrop`, object store `uploads`, keyed by `key`, index on `updatedAt`. */
export function idbStore(): ResumeStore {
  let mem: ResumeStore | null = null;
  let db: Promise<IDBDatabase | null> | null = null;
  const pending = new Map<string, ResumeRecord | null>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const fail = (error?: unknown): null => {
    if (!mem) {
      mem = memoryStore();
      warn('IndexedDB is not available; resume state is kept in memory only.', error);
    }
    return null;
  };
  const run = (d: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void) =>
    new Promise<boolean>((resolve) => {
      try {
        const t = d.transaction(STORE, mode);
        t.oncomplete = () => resolve(true);
        t.onerror = t.onabort = () => resolve(!!fail(t.error));
        fn(t.objectStore(STORE));
      } catch (error) {
        resolve(!!fail(error));
      }
    });
  const open = (): Promise<IDBDatabase | null> =>
    db ||
    (db = new Promise((resolve) => {
      // A hung, blocked or failed open falls back to memory (an upload must never wait for it).
      let over = false;
      const t = setTimeout(() => give('open timed out'), OPEN_TIMEOUT);
      const give = (error?: unknown): void => {
        over = true;
        clearTimeout(t);
        resolve(fail(error));
      };
      try {
        const r = indexedDB.open('anydrop', 1);
        r.onupgradeneeded = () =>
          r.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('t', 'updatedAt');
        r.onblocked = () => give('open blocked');
        r.onerror = () => give(r.error);
        r.onsuccess = () => {
          const d = r.result;
          if (over) return d.close(); // too late: memory is in use
          clearTimeout(t);
          d.onversionchange = () => {
            d.close();
            db = null;
          };
          // TTL sweep on start-up: only the expired records are visited.
          void run(d, 'readwrite', (s) => {
            const c = s.index('t').openCursor(IDBKeyRange.upperBound(Date.now() - TTL));
            c.onsuccess = () => {
              const cur = c.result;
              if (cur) {
                cur.delete();
                cur.continue();
              }
            };
          });
          resolve(d);
        };
      } catch (error) {
        give(error);
      }
    }));
  /** Runs a transaction; `false` when IndexedDB failed (then `mem` is the store). */
  const tx = async (mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void) => {
    const d = mem ? null : await open();
    return !!d && !mem && run(d, mode, fn);
  };
  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.size) return;
    const batch = Array.from(pending);
    pending.clear();
    void tx('readwrite', (s) => batch.forEach(([k, r]) => (r ? s.put(r) : s.delete(k)))).then(
      (ok) => {
        const m = mem;
        if (!ok && m) batch.forEach(([k, r]) => (r ? m.put(r) : m.del(k)));
      },
    );
  };
  /** Closes the connection; the next access opens a new one. */
  const release = (): void => {
    if (db) void db.then((d) => d && d.close());
    db = null;
  };
  const later = (): void => {
    if (!timer) timer = setTimeout(flush, 250);
  };

  return {
    async get(prefix, keys) {
      const found = new Map<string, ResumeRecord>();
      // A read that hangs counts as "no records": the files start fresh.
      const ok = await within(
        tx('readonly', (s) => {
          const r = s.getAll(range(prefix));
          r.onsuccess = () => (r.result as ResumeRecord[]).forEach((x) => found.set(x.key, x));
        }),
        false,
      );
      const m = !ok && mem ? await (mem as ResumeStore).get(prefix, keys) : null;
      return keys.map((k, i) =>
        live(pending.has(k) ? pending.get(k) || undefined : m ? m[i] : found.get(k)),
      );
    },
    put(r) {
      pending.set(r.key, r);
      later();
    },
    del(k) {
      pending.set(k, null);
      later();
    },
    flush,
    close() {
      flush();
      closed = true;
      release();
    },
    async clear(prefix) {
      pending.forEach((_, k) => {
        if (!k.indexOf(prefix)) pending.delete(k);
      });
      const ok = await tx('readwrite', (s) => s.delete(range(prefix)));
      if (!ok && mem) await (mem as ResumeStore).clear(prefix);
      if (closed) release(); // cleared after close(): a fresh connection, closed again
    },
  };
}

/** The one factory: IndexedDB, falling back to memory on the first failure. */
export function createResumeStore(): ResumeStore {
  return idbStore();
}
