// Shared helpers for the M3 tests (pause, resume, lifecycle, errors).
import { AnyDropCore, type AnyDropCoreConfig } from '../../src/index';
import { fakeTransport, okAll, type Call, type FakeTransport } from './transport';

export const URLS = {
  url: '/upload',
  manifestUrl: '/upload/manifest',
  finalizeUrl: '/upload/finalize',
  chunkStatusUrl: '/upload/status',
};

/** A core on a fake transport. `auto` answers requests (null = answer by hand). */
export function mk(
  opts: AnyDropCoreConfig = {},
  auto: ((c: Call, t: FakeTransport) => void) | null = okAll,
) {
  const t = fakeTransport(auto || undefined);
  let n = 0;
  const core = new AnyDropCore({
    url: '/upload',
    transport: t,
    _uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    _random: () => 0.5,
    chunking: true,
    chunkSize: 10,
    ...opts,
  });
  return { core, t };
}

/** A file with bytes 0,1,2,... (fixed lastModified, so fingerprints repeat across instances). */
export function bytesFile(name: string, size: number): File {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = i % 251;
  return new File([b], name, { lastModified: 1_700_000_000_000 });
}

/** Waits (real timers) until `pred()` is true; IndexedDB round trips take several macrotasks. */
export async function until(pred: () => unknown, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('until(): timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Chunk indexes of the upload POSTs sent for an uploadId, in order. */
export function sentChunks(t: FakeTransport, uploadId: string): number[] {
  return t
    .uploads()
    .filter((c) => c.field('dzuuid') === uploadId)
    .map((c) => Number(c.field('dzchunkindex')));
}

/** Upload calls not answered yet. */
export const openUploads = (t: FakeTransport): Call[] => t.uploads().filter((c) => !c.done);

/** Every record in the `anydrop` IndexedDB (read directly, as a page would after a reload). */
export function readRecords(): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('anydrop', 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore('uploads', { keyPath: 'key' }).createIndex('t', 'updatedAt');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const g = db.transaction('uploads', 'readonly').objectStore('uploads').getAll();
      g.onsuccess = () => {
        db.close();
        resolve(g.result as Array<Record<string, unknown>>);
      };
      g.onerror = () => reject(g.error);
    };
  });
}

/** Writes records straight into IndexedDB (a previous session). */
export function writeRecords(records: Array<Record<string, unknown>>): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('anydrop', 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore('uploads', { keyPath: 'key' }).createIndex('t', 'updatedAt');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction('uploads', 'readwrite');
      for (const rec of records) t.objectStore('uploads').put(rec);
      t.oncomplete = () => {
        db.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
  });
}
