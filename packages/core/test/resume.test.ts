// Resume records (M3, decision 0004) on fake-indexeddb: batched writes after 2xx, adopting a record
// in a new instance (a reload), skipping finished files, chunkStatusUrl only when resuming, TTL,
// persistKey scope, clearPersistedState, the memory fallback, and the transformFile rule (0011).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyDropCoreConfig } from '../src/index';
import { idbStore, memoryStore, TTL } from '../src/resume/store';
import {
  bytesFile,
  mk,
  openUploads,
  readRecords,
  sentChunks,
  until,
  writeRecords,
} from './helpers/m3';
import { okAll, type Call, type FakeTransport } from './helpers/transport';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const KEY = '%2Fupload::Docs/a.bin|40|1700000000000';
const UID = 'aaaaaaaa-0000-4000-8000-000000000001';

function record(over: Record<string, unknown> = {}) {
  return {
    key: KEY,
    uploadId: UID,
    chunkSize: 10,
    totalChunks: 4,
    chunksDone: [0, 1],
    completed: false,
    updatedAt: Date.now(),
    ...over,
  };
}

/** A new instance (after a "reload") that drops Docs/a.bin (40 bytes, 4 chunks of 10). */
async function reloadAndAdd(
  opts: AnyDropCoreConfig = {},
  auto: ((c: Call, t: FakeTransport) => void) | null = okAll,
) {
  const { core, t } = mk(opts, auto);
  const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
  const added = new Promise<void>((r) => core.on('addedfiles', () => r()));
  await added;
  return { core, t, f };
}

describe('resume records (0004)', () => {
  it('writes a record only after a 2xx, batched, and marks it completed on success', async () => {
    const { core, t } = mk({}, null);
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => openUploads(t).length === 1);
    const c0 = openUploads(t)[0]!;
    c0.progress(5, 10);
    await new Promise((r) => setTimeout(r, 300));
    expect(await readRecords()).toEqual([]); // nothing before the 2xx
    c0.reply();
    expect(await readRecords()).toEqual([]); // batched: not written yet
    await sleep(300);
    expect(await readRecords()).toEqual([
      expect.objectContaining({
        key: KEY,
        uploadId: f.upload.uuid,
        chunkSize: 10,
        totalChunks: 4,
        chunksDone: [0],
        completed: false,
      }),
    ]);
    for (let i = 0; i < 3; i++) {
      await until(() => openUploads(t).length === 1);
      openUploads(t)[0]!.reply();
    }
    await until(() => f.status === 'success');
    core.destroy(); // flushes
    await sleep(50);
    const [rec] = await readRecords();
    expect(rec).toEqual(expect.objectContaining({ completed: true, chunksDone: [0, 1, 2, 3] }));
  });

  it('after a reload, adopts uploadId and chunksDone and sends only the missing chunks (no status GET without chunkStatusUrl)', async () => {
    await writeRecords([record()]);
    const { t, f } = await reloadAndAdd();
    expect(f.upload.uuid).toBe(UID);
    expect(f.upload.resumed).toBe(true);
    await until(() => f.status === 'success');
    expect(sentChunks(t, UID)).toEqual([2, 3]);
    expect(t.calls.some((c) => c.kind === 'status')).toBe(false);
  });

  it('skips a file recorded as completed: success(file, { skipped, uploadId }) and complete, nothing sent', async () => {
    await writeRecords([record({ completed: true, chunksDone: [0, 1, 2, 3] })]);
    const { core, t } = mk();
    const success = vi.fn();
    const complete = vi.fn();
    core.on('success', success);
    core.on('complete', complete);
    const f = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => f.status === 'success');
    expect(f.upload.skipped).toBe(true);
    expect(f.upload.progress).toBe(100);
    expect(success).toHaveBeenCalledWith(f, { skipped: true, uploadId: UID }, null);
    expect(complete).toHaveBeenCalledWith(f);
    expect(t.calls).toHaveLength(0);
  });

  it('with chunkStatusUrl: the server wins for partial records; complete:true skips; 404 restarts fresh', async () => {
    // Partial record, server has more.
    await writeRecords([record()]);
    let r = await reloadAndAdd({ chunkStatusUrl: '/upload/status' }, (c) =>
      c.kind === 'status' ? c.reply(200, { received: [0, 1, 2] }) : okAll(c),
    );
    await until(() => r.f.status === 'success');
    expect(sentChunks(r.t, UID)).toEqual([3]);
    r.core.destroy();

    // Completed record, the server confirms.
    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    await writeRecords([record({ completed: true })]);
    r = await reloadAndAdd({ chunkStatusUrl: '/upload/status' }, (c) =>
      c.kind === 'status' ? c.reply(200, { received: [0, 1, 2, 3], complete: true }) : okAll(c),
    );
    await until(() => r.f.status === 'success');
    expect(r.f.upload.skipped).toBe(true);
    expect(r.t.uploads()).toHaveLength(0);
    r.core.destroy();

    // Completed record, the server does not know it: uploaded again with a new uploadId.
    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    await writeRecords([record({ completed: true })]);
    r = await reloadAndAdd({ chunkStatusUrl: '/upload/status' }, (c) =>
      c.kind === 'status' ? c.reply(404, { code: 'NOT_FOUND' }) : okAll(c),
    );
    await until(() => r.f.status === 'success');
    expect(r.f.upload.skipped).toBeFalsy();
    expect(r.f.upload.uuid).not.toBe(UID);
    expect(sentChunks(r.t, r.f.upload.uuid)).toEqual([0, 1, 2, 3]);
  });

  it('fresh files never ask chunkStatusUrl', async () => {
    const { core, t } = mk({ chunkStatusUrl: '/upload/status' });
    const files = [1, 2, 3].map((i) => core.addFile(bytesFile(`f${i}.bin`, 25)));
    await until(() => files.every((f) => f.status === 'success'));
    expect(t.calls.some((c) => c.kind === 'status')).toBe(false);
  });

  it('a record with another chunk size is deleted and the file starts fresh', async () => {
    await writeRecords([record({ chunkSize: 8, totalChunks: 5 })]);
    const { core, t, f } = await reloadAndAdd();
    expect(f.upload.uuid).not.toBe(UID);
    await until(() => f.status === 'success');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 1, 2, 3]);
    core.destroy();
    await until(async () => (await readRecords())[0]?.uploadId === f.upload.uuid);
  });

  it('records older than 7 days are ignored and swept; other persistKeys are not touched', async () => {
    await writeRecords([
      record({ updatedAt: Date.now() - TTL - 1000 }),
      record({ key: 'user-1::Docs/a.bin|40|1700000000000', uploadId: 'other' }),
    ]);
    const { core, f } = await reloadAndAdd({ persistState: true });
    expect(f.upload.uuid).not.toBe(UID);
    expect(f.upload.resumed).toBeFalsy();
    core.destroy();
    await until(async () => (await readRecords()).every((r) => r.uploadId !== UID));
    // A different persistKey: its record was not adopted by '/upload' and survives.
    expect((await readRecords()).map((r) => r.key)).toContain(
      'user-1::Docs/a.bin|40|1700000000000',
    );
  });

  it('persistKey scopes records: another key does not resume', async () => {
    await writeRecords([record()]);
    const { f } = await reloadAndAdd({ persistKey: 'user-2' });
    expect(f.upload.uuid).not.toBe(UID);
  });

  it('clearPersistedState() deletes only this persistKey', async () => {
    await writeRecords([record(), record({ key: 'other::x|1|1' })]);
    const { core } = mk();
    await core.clearPersistedState();
    expect((await readRecords()).map((r) => r.key)).toEqual(['other::x|1|1']);
  });

  it('removeFile and cancelUpload delete the record', async () => {
    await writeRecords([record()]);
    const { core, f } = await reloadAndAdd({}, null);
    core.removeFile(f);
    core.destroy();
    await until(async () => (await readRecords()).length === 0);
  });

  it('only one active file claims a record; a second with the same fingerprint starts fresh', async () => {
    await writeRecords([record()]);
    const { core } = mk({}, null);
    const a = core.addFile(bytesFile('a.bin', 40), 'Docs');
    const b = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => a.status !== 'added');
    expect(a.upload.uuid).toBe(UID);
    expect(b.upload.uuid).not.toBe(UID);
    expect(b.upload.resumed).toBeFalsy();
  });

  it('persistState: false writes and reads nothing', async () => {
    await writeRecords([record()]);
    const { core, f } = await reloadAndAdd({ persistState: false });
    expect(f.upload.uuid).not.toBe(UID);
    await until(() => f.status === 'success');
    core.destroy();
    expect((await readRecords()).map((r) => r.uploadId)).toEqual([UID]);
  });

  it('a transformFile that passes the file through unchanged keeps chunk-level resume (0011)', async () => {
    await writeRecords([record()]);
    const transformFile = (file: File, done: (b: Blob) => void) => done(file);
    const { core, t, f } = await reloadAndAdd({ transformFile });
    expect(f.upload.uuid).toBe(UID);
    await until(() => f.status === 'success');
    expect(sentChunks(t, UID)).toEqual([2, 3]);
    core.destroy();
    await until(async () => (await readRecords())[0]?.completed === true);
  });

  it('a transformFile that changes the bytes drops the restored state and writes no chunk records (0011)', async () => {
    await writeRecords([record()]);
    const transformFile = (file: File, done: (b: Blob) => void) =>
      done(new Blob([new Uint8Array(file.size)]));
    const { core, t, f } = await reloadAndAdd({ transformFile }, null);
    await until(() => openUploads(t).length === 1);
    expect(f.upload.uuid).not.toBe(UID); // the transform changed the bytes: fresh upload
    expect(openUploads(t)[0]!.field('adChunkIndex')).toBe('0');
    openUploads(t)[0]!.reply();
    core.destroy();
    await sleep(50);
    expect(await readRecords()).toEqual([]); // old record deleted, no chunk record written
  });

  it('completed files are still skipped when transformFile is set (0011)', async () => {
    await writeRecords([record({ completed: true })]);
    const transformFile = (_file: File, done: (b: Blob) => void) => done(new Blob(['x']));
    const { t, f } = await reloadAndAdd({ transformFile });
    await until(() => f.status === 'success');
    expect(f.upload.skipped).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  it('pagehide flushes pending writes at once', async () => {
    const { core, t } = mk({}, null);
    core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => openUploads(t).length === 1);
    openUploads(t)[0]!.reply();
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event('pagehide'));
    await until(async () => (await readRecords()).length === 1, 200);
    core.destroy();
  });

  it('if IndexedDB throws, warns once, keeps going in memory, and the upload works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const { core } = mk();
    const a = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => a.status === 'success');
    const b = core.addFile(bytesFile('b.bin', 40), 'Docs');
    await until(() => b.status === 'success');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('IndexedDB'))).toHaveLength(1);
    // The memory store still remembers the finished file within this instance.
    core.removeFile(b);
    const again = core.addFile(bytesFile('a.bin', 40), 'Docs');
    await until(() => again.status === 'success');
    expect(again.upload.skipped).toBe(true);
  });
});

describe('ResumeStore implementations (0009)', () => {
  it('memory and IndexedDB stores agree: get, pending writes, delete, clear by prefix, TTL', async () => {
    for (const s of [memoryStore(), idbStore()]) {
      s.put(record() as never);
      s.put(record({ key: 'p2::x', uploadId: 'u2' }) as never);
      s.put(record({ key: '%2Fupload::old', updatedAt: 1 }) as never);
      expect(
        (await s.get('%2Fupload::', [KEY, '%2Fupload::old', '%2Fupload::none'])).map(
          (r) => r && r.uploadId,
        ),
      ).toEqual([UID, undefined, undefined]);
      s.flush();
      s.del(KEY);
      expect(await s.get('%2Fupload::', [KEY])).toEqual([undefined]);
      await s.clear('p2::');
      expect(await s.get('p2::', ['p2::x'])).toEqual([undefined]);
      s.close();
    }
  });
});
