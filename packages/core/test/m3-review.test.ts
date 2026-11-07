// Fixes from the M3 review: IndexedDB that hangs (B1), chunk layout fixed at the first chunk sent
// (B2), status requests only when chunks were sent or a record was restored (M1), manifest resent
// when an uploadId changes (0016), the Chrome offline race (M2), clearPersistedState (M3), and the
// minor items.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_TIMEOUT, idbStore } from '../src/resume/store';
import { buildEntries, dataTransfer } from './helpers/entries';
import {
  URLS,
  bytesFile,
  mk,
  openUploads,
  readRecords,
  sentChunks,
  until,
  writeRecords,
} from './helpers/m3';
import { okAll, settle, type Call } from './helpers/transport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NO_PERSIST = { persistState: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UID = 'aaaaaaaa-0000-4000-8000-000000000001';
const key = (name = 'a.bin', scope = '%2Fupload') => `${scope}::Docs/${name}|40|1700000000000`;

function record(over: Record<string, unknown> = {}) {
  return {
    key: key(),
    uploadId: UID,
    chunkSize: 10,
    totalChunks: 4,
    chunksDone: [0, 1],
    completed: false,
    updatedAt: Date.now(),
    ...over,
  };
}

describe('B1: IndexedDB that never answers', () => {
  it('open() never calls back: after ~1.5 s the memory store is used and files upload', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}) as IDBOpenDBRequest);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
    const { core } = mk();
    const f = core.addFile(bytesFile('a.bin', 25), 'Docs');
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT - 100);
    expect(f.status).toBe('added'); // still waiting for the resume lookup
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.status).toBe('success');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('IndexedDB'))).toHaveLength(1);
    core.destroy();
  });

  it('onblocked falls back to memory at once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const r = {} as IDBOpenDBRequest;
      queueMicrotask(() => r.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
      return r;
    });
    const { core } = mk();
    const f = core.addFile(bytesFile('a.bin', 25), 'Docs');
    await until(() => f.status === 'success', 500);
    core.destroy();
  });

  it('get() resolves "no records" when the transaction never finishes; a late open() is closed', async () => {
    const close = vi.fn();
    const stubDb = {
      close,
      transaction: () => ({
        objectStore: () => ({ index: () => ({ openCursor: () => ({}) }), getAll: () => ({}) }),
      }),
    };
    let req!: IDBOpenDBRequest;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      req = { result: stubDb } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onsuccess?.(new Event('success')));
      return req;
    });
    vi.useFakeTimers();
    const s = idbStore();
    const got = s.get('p::', ['p::a']);
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT + 10);
    expect(await got).toEqual([undefined]);

    // A database that opens after the timeout is closed again.
    const late = { close: vi.fn(), transaction: () => ({}) };
    const s2 = idbStore();
    let r2!: IDBOpenDBRequest;
    vi.spyOn(indexedDB, 'open').mockImplementation(() => (r2 = {} as IDBOpenDBRequest));
    void s2.get('p::', ['p::a']);
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT + 10);
    (r2 as { result: unknown }).result = late;
    r2.onsuccess?.(new Event('success'));
    expect(late.close).toHaveBeenCalledTimes(1);
  });

  it('onversionchange closes the connection; the next access opens a new one', async () => {
    const dbs: { close: ReturnType<typeof vi.fn>; onversionchange?: () => void }[] = [];
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const d = {
        close: vi.fn(),
        transaction: () => {
          const t: Record<string, unknown> = {
            objectStore: () => ({
              index: () => ({ openCursor: () => ({}) }),
              getAll: () => ({}),
            }),
          };
          queueMicrotask(() => (t.oncomplete as () => void)?.());
          return t;
        },
      };
      dbs.push(d);
      const r = { result: d } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => r.onsuccess?.(new Event('success')));
      return r;
    });
    const s = idbStore();
    await s.get('p::', ['p::a']);
    expect(open).toHaveBeenCalledTimes(1);
    dbs[0]!.onversionchange?.();
    expect(dbs[0]!.close).toHaveBeenCalled();
    await s.get('p::', ['p::a']);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('B2: the chunk layout is fixed when the first chunk is sent', () => {
  it('abort before the first 2xx, setOption(chunkSize), resume with status received:[0]: original offsets', async () => {
    const { core, t } = mk({ ...NO_PERSIST, chunkStatusUrl: URLS.chunkStatusUrl }, null);
    const f = core.addFile(bytesFile('a.bin', 40));
    await settle();
    const first = openUploads(t)[0]!;
    expect(first.field('dzchunksize')).toBe('10');
    core.pause(); // 'abort': chunk 0 is aborted before any 2xx
    expect(first.aborted).toBe(true);
    core.setOption('chunkSize', 15);
    core.resume();
    await settle();
    const status = t.calls.find((c) => c.kind === 'status')!;
    status.reply(200, { received: [0] }); // the server committed the aborted chunk (0015)
    await settle();
    expect(f.upload.chunkSize).toBe(10);
    expect(f.upload.totalChunkCount).toBe(4);
    const next = openUploads(t)[0]!;
    expect(next.field('dzchunkindex')).toBe('1');
    expect(next.field('dzchunksize')).toBe('10');
    expect(next.field('dzchunkbyteoffset')).toBe('10');
    expect(next.field('dztotalchunkcount')).toBe('4');
    core.destroy();
  });

  it('a file that sent nothing still takes the current chunkSize', async () => {
    const { core, t } = mk({ ...NO_PERSIST, autoProcessQueue: false }, null);
    const f = core.addFile(bytesFile('a.bin', 40));
    await settle();
    core.setOption('chunkSize', 20);
    core.processQueue();
    await settle();
    expect(openUploads(t)[0]!.field('dzchunksize')).toBe('20');
    expect(f.upload.totalChunkCount).toBe(2);
    core.destroy();
  });
});

describe('M1: chunkStatusUrl only with something to resume', () => {
  it('a file paused before its first chunk and resumed does not ask', async () => {
    const { core, t } = mk({ ...NO_PERSIST, chunkStatusUrl: URLS.chunkStatusUrl });
    const f = core.addFile(bytesFile('a.bin', 40));
    core.pause();
    await settle();
    core.resume();
    await until(() => f.status === 'success');
    expect(t.calls.some((c) => c.kind === 'status')).toBe(false);
  });

  it('a file retried before its first chunk does not ask', async () => {
    let boom = true;
    const { core, t } = mk({
      ...NO_PERSIST,
      chunkStatusUrl: URLS.chunkStatusUrl,
      transformFile: (file: File, done: (b: Blob) => void) => {
        if (boom) {
          boom = false;
          throw new Error('no');
        }
        done(file);
      },
    });
    const f = core.addFile(bytesFile('a.bin', 40));
    await until(() => f.status === 'error');
    core.retryFailedOnly();
    await until(() => f.status === 'success');
    expect(t.calls.some((c) => c.kind === 'status')).toBe(false);
  });

  it('a file that sent a chunk and is resumed asks', async () => {
    const { core, t } = mk({ ...NO_PERSIST, chunkStatusUrl: URLS.chunkStatusUrl }, null);
    core.addFile(bytesFile('a.bin', 40));
    await settle();
    core.pause();
    core.resume();
    await settle();
    expect(t.calls.filter((c) => c.kind === 'status')).toHaveLength(1);
    core.destroy();
  });
});

describe('0016: the manifest is sent again when an uploadId changes', () => {
  const OPTS = {
    sendManifest: true,
    manifestUrl: URLS.manifestUrl,
    chunkStatusUrl: URLS.chunkStatusUrl,
  };
  const manifests = (t: ReturnType<typeof mk>['t']) => t.calls.filter((c) => c.kind === 'manifest');
  const files = (c: Call) => c.json!.files as { uploadId: string; relativePath: string }[];

  it('a 404 for a restored file: one extra manifest with the new id, sent before its first chunk', async () => {
    await writeRecords([record()]);
    const { core, t } = mk(OPTS, (c) =>
      c.kind === 'status' ? c.reply(404, { code: 'NOT_FOUND' }) : okAll(c),
    );
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    const ms = manifests(t);
    expect(ms).toHaveLength(2);
    expect(files(ms[0]!)[0]!.uploadId).toBe(UID); // the adopted id
    expect(f.upload.uuid).not.toBe(UID);
    expect(files(ms[1]!)[0]!.uploadId).toBe(f.upload.uuid);
    expect(ms[1]!.json!.sessionId).toBe(ms[0]!.json!.sessionId);
    const firstChunk = t.calls.findIndex((c) => c.kind === 'upload');
    expect(t.calls.indexOf(ms[1]!)).toBeLessThan(firstChunk);
    expect(sentChunks(t, UID)).toEqual([]);
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 1, 2, 3]);
    // The record holds the new id.
    core.destroy();
    await until(async () => (await readRecords())[0]?.uploadId === f.upload.uuid);
  });

  it('two 404s in one batch share one resend, and both ids are in it', async () => {
    await writeRecords([
      record(),
      record({ key: key('b.bin'), uploadId: 'bbbbbbbb-0000-4000-8000-000000000002' }),
    ]);
    const { core, t } = mk({ ...OPTS, parallelUploads: 2 }, (c) =>
      c.kind === 'status' ? c.reply(404, { code: 'NOT_FOUND' }) : okAll(c),
    );
    const a = core.addFile(bytesFile('a.bin', 40), 'Docs');
    const b = core.addFile(bytesFile('b.bin', 40), 'Docs');
    await until(() => a.status === 'success' && b.status === 'success');
    const ms = manifests(t);
    expect(ms).toHaveLength(2);
    expect(
      files(ms[1]!)
        .map((x) => x.uploadId)
        .sort(),
    ).toEqual([a.upload.uuid, b.upload.uuid].sort());
  });

  it('a failing resend errors only the file that waits for it; retryFailedOnly resends first', async () => {
    await writeRecords([record()]);
    let resend = 0;
    const { core, t } = mk({ ...OPTS, parallelUploads: 2, retryChunks: false }, (c) => {
      if (c.kind === 'status') return c.reply(404, { code: 'NOT_FOUND' });
      // The 2nd manifest (the first resend) fails.
      if (c.kind === 'manifest' && ++resend === 2) return c.reply(500, { code: 'BOOM' });
      okAll(c);
    });
    const a = core.addFile(bytesFile('a.bin', 40), 'Docs'); // restored: 404 -> new id
    const b = core.addFile(bytesFile('b.bin', 40), 'Docs'); // fresh: unaffected
    await until(() => a.status === 'error' && b.status === 'success');
    expect(core.getErrors().map((e) => [e.relativePath, e.stage, e.code])).toEqual([
      ['Docs/a.bin', 'manifest', 'BOOM'],
    ]);
    expect(sentChunks(t, a.upload.uuid)).toEqual([]); // nothing under an unannounced id
    const before = manifests(t).length;
    expect(core.retryFailedOnly()).toBe(1);
    await until(() => a.status === 'success');
    const ms = manifests(t);
    expect(ms.length).toBeGreaterThan(before);
    const last = ms[ms.length - 1]!;
    expect(files(last).find((x) => x.relativePath === 'Docs/a.bin')!.uploadId).toBe(a.upload.uuid);
    expect(core.getErrors()).toEqual([]);
  });

  it('nothing extra without sendManifest, or while the manifest is not sent yet', async () => {
    await writeRecords([record()]);
    const { core, t } = mk({ chunkStatusUrl: URLS.chunkStatusUrl }, (c) =>
      c.kind === 'status' ? c.reply(404, { code: 'NOT_FOUND' }) : okAll(c),
    );
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    expect(manifests(t)).toHaveLength(0);
  });
});

describe('M2: a network error just before the offline event (Chrome)', () => {
  it('a chunk: no retry is used, no error entry; online sends it again', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...NO_PERSIST, retryChunksLimit: 0 }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await vi.advanceTimersByTimeAsync(0);
    openUploads(t)[0]!.fail('network'); // navigator.onLine is still true
    await vi.advanceTimersByTimeAsync(300);
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 6; i++) {
      t.calls.filter((c) => !c.done).forEach((c) => okAll(c));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(f.status).toBe('success');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0, 1]);
    core.destroy();
  });

  it('a whole file is not errored', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...NO_PERSIST, chunking: false }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await vi.advanceTimersByTimeAsync(0);
    openUploads(t)[0]!.fail('network');
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('without an offline event the failure is judged after the grace period', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...NO_PERSIST, chunking: false }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await vi.advanceTimersByTimeAsync(0);
    openUploads(t)[0]!.fail('network');
    await vi.advanceTimersByTimeAsync(500);
    expect(f.status).toBe('uploading');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.status).toBe('error');
    core.destroy();
  });
});

describe('M3: clearPersistedState', () => {
  it('stops the files in the list from writing records', async () => {
    const { core, t } = mk({}, null);
    core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => openUploads(t).length === 1);
    openUploads(t)[0]!.reply();
    await sleep(300);
    expect(await readRecords()).toHaveLength(1);
    await core.clearPersistedState();
    expect(await readRecords()).toEqual([]);
    await until(() => openUploads(t).length === 1);
    openUploads(t)[0]!.reply();
    await sleep(300);
    expect(await readRecords()).toEqual([]); // not written again
    core.destroy();
  });

  it('after destroy() it opens a fresh connection and deletes the records', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeRecords([record()]);
    const { core } = mk();
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    core.destroy();
    await core.clearPersistedState();
    expect(await readRecords()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('with persistState: false it does not touch IndexedDB', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    const { core } = mk(NO_PERSIST);
    await core.clearPersistedState();
    expect(open).not.toHaveBeenCalled();
  });

  it('record keys are scoped by the encoded persistKey: "a" does not clear "a::b"', async () => {
    const b = mk({ persistKey: 'a::b' }, null);
    b.core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => openUploads(b.t).length === 1);
    openUploads(b.t)[0]!.reply();
    await sleep(300);
    const keys = (await readRecords()).map((r) => r.key);
    expect(keys).toEqual([key('a.bin', 'a%3A%3Ab')]);
    const a = mk({ persistKey: 'a' });
    await a.core.clearPersistedState();
    expect((await readRecords()).map((r) => r.key)).toEqual(keys);
    b.core.destroy();
  });
});

describe('minor items', () => {
  it('watch(): hidden is read when listening starts', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { core, t } = mk(NO_PERSIST, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await vi.advanceTimersByTimeAsync(0);
    openUploads(t)[0]!.fail('network'); // no visibilitychange event ever came
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('a skip candidate the server does not confirm as complete starts fresh under a new uploadId', async () => {
    await writeRecords([record({ completed: true, chunksDone: [0, 1, 2, 3] })]);
    const { core, t } = mk({ chunkStatusUrl: URLS.chunkStatusUrl }, (c) =>
      c.kind === 'status' ? c.reply(200, { received: [0, 1] }) : okAll(c),
    );
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    expect(f.upload.skipped).toBeFalsy();
    expect(f.upload.uuid).not.toBe(UID);
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 1, 2, 3]);
  });

  it('a restored chunksDone is range-checked', async () => {
    await writeRecords([record({ chunksDone: [0, 99, -1, 1.5, 'x', 2] })]);
    const { core, t } = mk();
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    expect(sentChunks(t, UID)).toEqual([1, 3]);
    core.destroy();
  });

  it('removing a file forgets its pause flag', async () => {
    const { core } = mk({ ...NO_PERSIST, autoProcessQueue: false });
    const f = core.addFile(bytesFile('a.bin', 5));
    await settle();
    core.pauseFile(f);
    const flags = (core as unknown as { flags: { files: WeakSet<object> } }).flags;
    expect(flags.files.has(f)).toBe(true);
    core.removeFile(f);
    expect(flags.files.has(f)).toBe(false);
  });

  it('pauseFolder and resumeFolder normalise the path', async () => {
    const { core } = mk({ ...NO_PERSIST, autoProcessQueue: false });
    core.addFile(bytesFile('a.bin', 5), 'A/B');
    await settle();
    core.pauseFolder('/A//B/');
    expect(core.getFolder('A/B')!.userPaused).toBe(true);
    core.resumeFolder('A\\B');
    expect(core.getFolder('A/B')!.userPaused).toBe(false);
  });

  it('removeAllFiles drops pruned folders from a manifest that is not sent yet (0015)', async () => {
    const { core, t } = mk({
      ...NO_PERSIST,
      sendManifest: true,
      manifestUrl: URLS.manifestUrl,
      autoProcessQueue: false,
      preserveEmptyFolders: true,
    });
    await core.drop({ dataTransfer: dataTransfer(buildEntries({ E: {} }).roots) as never });
    expect(core.getFolder('E')).toBeDefined();
    core.removeAllFiles();
    expect(core.getFolder('E')).toBeUndefined();
    await core.drop({ dataTransfer: dataTransfer(buildEntries({ F: {} }).roots) as never });
    core.processQueue();
    await settle();
    const ms = t.calls.filter((c) => c.kind === 'manifest');
    expect(ms).toHaveLength(1);
    expect(ms[0]!.json!.folders).toEqual(['F']);
    core.destroy();
  });
});
