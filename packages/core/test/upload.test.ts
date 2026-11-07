// Upload engine (M2): requests and fields, the two concurrency limits (0001, 0010), retry and
// backoff (0007), manifest and finalize (0003, 0011), events, queue control, cancel and destroy.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AnyDropCore, type AnyDropCoreConfig, type AnyDropFile } from '../src/index';
import { backoff, classify, retryAfter } from '../src/scheduler/retry';
import { buildEntries, dataTransfer, makeFile, type Spec } from './helpers/entries';
import { fakeTransport, okAll, settle, type Call, type FakeTransport } from './helpers/transport';

const URLS = {
  url: '/upload',
  manifestUrl: '/upload/manifest',
  finalizeUrl: '/upload/finalize',
  chunkStatusUrl: '/upload/status',
};

function mk(
  opts: AnyDropCoreConfig = {},
  auto: ((c: Call, t: FakeTransport) => void) | null = okAll,
) {
  const t = fakeTransport(auto || undefined);
  let n = 0;
  const core = new AnyDropCore({
    ...URLS,
    transport: t,
    _uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    _random: () => 0.5,
    // M2 engine tests: no resume lookup, so batches close without an IndexedDB round trip (M3 tests cover it).
    persistState: false,
    ...opts,
  });
  return { core, t };
}

/** A file with bytes 0,1,2,... so chunk contents can be checked. */
function bytesFile(name: string, size: number): File {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = i % 251;
  return new File([b], name, { lastModified: 1_700_000_000_000 });
}

function drop(core: AnyDropCore, spec: Spec) {
  return core.drop({ dataTransfer: dataTransfer(buildEntries(spec).roots) as never });
}

/** Records event names (and the file path for file events) in order. */
function record(core: AnyDropCore, names: string[]) {
  const log: string[] = [];
  for (const name of names) {
    core.on(name as 'complete', (...args: unknown[]) => {
      const a = args[0] as { relativePath?: string; path?: string } | undefined;
      const tag = a && typeof a === 'object' ? (a.relativePath ?? a.path) : undefined;
      log.push(tag !== undefined ? `${name}:${tag}` : name);
    });
  }
  return log;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('requests and fields (protocol section 3)', () => {
  it('sends a chunked file with the dz* and ad* fields, one chunk at a time, then finalize', async () => {
    const { core, t } = mk({ chunking: true, chunkSize: 10 });
    const f = core.addFile(bytesFile('a.bin', 25), 'Docs');
    const success = vi.fn();
    core.on('success', success);
    await settle(10);
    const ups = t.uploads();
    expect(ups).toHaveLength(3);
    expect(t.maxInFlight).toBe(1);
    const c = ups[1] as Call;
    expect({
      dzuuid: c.field('dzuuid'),
      dzchunkindex: c.field('dzchunkindex'),
      dztotalfilesize: c.field('dztotalfilesize'),
      dzchunksize: c.field('dzchunksize'),
      dztotalchunkcount: c.field('dztotalchunkcount'),
      dzchunkbyteoffset: c.field('dzchunkbyteoffset'),
      adRelativePath: c.field('adRelativePath'),
    }).toEqual({
      dzuuid: f.upload.uuid,
      dzchunkindex: '1',
      dztotalfilesize: '25',
      dzchunksize: '10',
      dztotalchunkcount: '3',
      dzchunkbyteoffset: '10',
      adRelativePath: 'Docs/a.bin',
    });
    expect(c.field('adSessionId')).toMatch(/^0{8}-/);
    const blob = c.form!.get('file') as File;
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(
      Array.from({ length: 10 }, (_, i) => (i + 10) % 251),
    );
    // The file blob is the last field (S3 wants it last), as in Dropzone.
    expect(Array.from(c.form!.keys()).pop()).toBe('file');
    const fin = t.calls.find((x) => x.kind === 'finalize')!;
    expect(fin.json).toEqual({
      uploadId: f.upload.uuid,
      relativePath: 'Docs/a.bin',
      totalSize: 25,
      totalChunks: 3,
    });
    expect(f.status).toBe('success');
    expect([...f.upload.chunksDone].sort()).toEqual([0, 1, 2]);
    // success receives the finalize response (0003).
    expect(success).toHaveBeenCalledWith(f, { ok: true, kind: 'finalize' }, null);
  });

  it('sends a whole file in one request without dz* fields, never finalizes, upper-cases method', async () => {
    const { core, t } = mk({ method: 'put', headers: { Authorization: 'Bearer x' } });
    const f = core.addFile(bytesFile('a.txt', 5));
    const success = vi.fn();
    core.on('success', success);
    await settle();
    const [c] = t.uploads();
    expect(c!.req.method).toBe('PUT');
    expect(c!.req.headers).toEqual({
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: 'Bearer x',
    });
    expect(Array.from(c!.form!.keys())).toEqual(['adRelativePath', 'adSessionId', 'file']);
    expect(t.calls.some((x) => x.kind === 'finalize')).toBe(false);
    expect(success).toHaveBeenCalledWith(f, { ok: true, kind: 'upload' }, null);
    expect(f.upload.progress).toBe(100);
  });

  it('small chunked files are single requests unless forceChunking (Dropzone)', async () => {
    const { core, t } = mk({ chunking: true, chunkSize: 100 });
    core.addFile(bytesFile('small.bin', 5));
    await settle();
    expect(t.uploads()[0]!.field('dzchunkindex')).toBeNull();
    expect(t.calls.some((x) => x.kind === 'finalize')).toBe(false);
  });

  it('merges params() over the built-in fields; null drops one (renaming), with this = instance', async () => {
    const seen: unknown[] = [];
    const { core, t } = mk({
      chunking: true,
      chunkSize: 4,
      params(files, xhr, chunk) {
        seen.push(this);
        return { dzuuid: null, uuid: files[0]!.upload.uuid, idx: chunk!.index, list: ['a', 'b'] };
      },
    });
    core.addFile(bytesFile('a.bin', 6));
    await settle(10);
    const c = t.uploads()[0]!;
    expect(seen[0]).toBe(core);
    expect(c.field('dzuuid')).toBeNull();
    expect(c.field('uuid')).toMatch(/^0{8}/);
    expect(c.field('idx')).toBe('0');
    expect(c.form!.getAll('list')).toEqual(['a', 'b']);
  });

  it('emits sending(file, xhr, formData) before the blob is appended; binaryBody sends the blob raw', async () => {
    const { core, t } = mk();
    core.on('sending', (file, xhr, fd) => {
      expect(fd!.has('file')).toBe(false);
      fd!.append('extra', '1');
      expect(file.xhr).toBe(xhr);
    });
    core.addFile(bytesFile('a.txt', 3));
    await settle();
    expect(t.uploads()[0]!.field('extra')).toBe('1');

    const b = mk({ binaryBody: true });
    const sending = vi.fn();
    b.core.on('sending', sending);
    const f = b.core.addFile(new File(['abc'], 'a.txt', { type: 'text/plain' }));
    await settle();
    expect(b.t.uploads()[0]!.req.body).toBe(f);
    expect(b.t.uploads()[0]!.req.headers['Content-Type']).toBe('text/plain');
    expect(sending.mock.calls[0]).toEqual([f, b.t.uploads()[0]!.xhr, undefined]);
  });

  it('does not start anything without a url', async () => {
    const { core, t } = mk({ url: null });
    const f = core.addFile(bytesFile('a.txt', 3));
    await settle();
    expect(t.calls).toHaveLength(0);
    expect(f.status).toBe('queued');
  });
});

describe('concurrency (0001, 0010)', () => {
  it('parallelUploads counts files; files start in add order; defaults keep 2 POSTs in flight', async () => {
    const { core, t } = mk({ chunking: true, chunkSize: 2 }, null);
    const files = ['a', 'b', 'c', 'd'].map((n) => core.addFile(bytesFile(n, 6)));
    await settle();
    expect(core.getUploadingFiles()).toEqual([files[0], files[1]]);
    expect(t.open()).toHaveLength(2);
    // Answer requests until everything is done, checking the limits at every step.
    let maxUploading = 0;
    for (let guard = 0; guard < 100 && t.open().length; guard++) {
      maxUploading = Math.max(maxUploading, core.getUploadingFiles().length);
      okAll(t.open()[0]!);
      await settle(2);
    }
    expect(files.every((f) => f.status === 'success')).toBe(true);
    expect(maxUploading).toBe(2);
    expect(t.maxInFlight).toBe(2);
    expect(Math.max(...t.maxPerUpload.values())).toBe(1);
    const firstChunks = t.uploads().filter((c) => c.field('dzchunkindex') === '0');
    expect(firstChunks.map((c) => c.field('adRelativePath'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    [false, 1],
    [true, 2],
    [3, 3],
    [0, 1],
    [-2, 1],
    [Infinity, 5],
  ] as const)('parallelChunkUploads %s allows %i chunks per file', async (value, expected) => {
    const { core, t } = mk({ chunking: true, chunkSize: 1, parallelChunkUploads: value }, null);
    core.addFile(bytesFile('a', 5));
    await settle();
    expect(t.open()).toHaveLength(expected);
  });

  it('maxChunksInFlight caps POSTs across files, shared round-robin; null means no cap', async () => {
    const { core, t } = mk(
      {
        chunking: true,
        chunkSize: 1,
        parallelChunkUploads: true,
        parallelUploads: 3,
        maxChunksInFlight: 4,
      },
      null,
    );
    ['a', 'b', 'c'].forEach((n) => core.addFile(bytesFile(n, 5)));
    await settle();
    expect(t.open().map((c) => c.field('adRelativePath'))).toEqual(['a', 'b', 'c', 'a']);
    okAll(t.open()[1]!); // b's chunk ends: the freed slot goes round-robin, oldest first
    await settle(2);
    expect(t.open().map((c) => c.field('adRelativePath'))).toEqual(['a', 'c', 'a', 'b']);
    expect(t.open()).toHaveLength(4);
    expect(t.maxInFlight).toBe(4);

    const free = mk(
      { chunking: true, chunkSize: 1, parallelChunkUploads: true, parallelUploads: 3 },
      null,
    );
    ['a', 'b', 'c'].forEach((n) => free.core.addFile(bytesFile(n, 5)));
    await settle();
    expect(free.t.open()).toHaveLength(9); // 3 files x parallelUploads chunks, as in Dropzone
  });

  it('setOption on the limits affects only the requests that start next', async () => {
    const { core, t } = mk({ parallelUploads: 1 }, null);
    ['a', 'b', 'c'].forEach((n) => core.addFile(bytesFile(n, 2)));
    await settle();
    expect(t.open()).toHaveLength(1);
    core.setOption('parallelUploads', 3);
    await settle();
    expect(t.open()).toHaveLength(3);
    core.setOption('parallelUploads', 1);
    await settle();
    expect(t.open().every((c) => !c.aborted)).toBe(true);
    expect(t.open()).toHaveLength(3);
  });
});

describe('retry and backoff (0007)', () => {
  it('classifies responses', () => {
    const r = (status: number, body?: unknown, error?: 'network' | 'timeout' | 'abort', h = {}) =>
      classify({ status, body, error, header: (n) => (h as Record<string, string>)[n] ?? null });
    expect(r(200)).toBeNull();
    expect(r(0, undefined, 'network')).toMatchObject({ code: 'NETWORK', retry: true });
    expect(r(0, undefined, 'timeout')).toMatchObject({ code: 'TIMEOUT', retry: true });
    expect(r(0, undefined, 'abort')).toMatchObject({ code: 'ABORTED', retry: false });
    expect(r(500, 'oops')).toMatchObject({ code: 'SERVER_ERROR', retry: true, httpStatus: 500 });
    expect(r(503, { code: 'BUSY' })).toMatchObject({ code: 'BUSY', retry: true });
    expect(r(429, {}, undefined, { 'Retry-After': '3' })).toMatchObject({
      retry: true,
      wait: 3000,
    });
    expect(r(408)).toMatchObject({ code: 'SERVER_ERROR', retry: true });
    expect(r(401)).toMatchObject({ code: 'AUTH', retry: false });
    expect(r(403, { code: 'AUTH' })).toMatchObject({ code: 'AUTH', retry: false });
    expect(r(400, { code: 'INVALID_PATH' })).toMatchObject({ code: 'INVALID_PATH', retry: false });
    expect(r(404)).toMatchObject({ code: 'HTTP_ERROR', retry: false });
    expect(r(409, { code: 'CHUNK_MISMATCH' })).toMatchObject({ mismatch: true, retry: false });
    expect(retryAfter('120')).toBe(60000);
    expect(retryAfter('nope')).toBeUndefined();
    expect(retryAfter(null)).toBeUndefined();
  });

  it('backs off random(0.5..1) x min(30 s, 1 s x 2^(n-1))', () => {
    expect(backoff(1, () => 0)).toBe(500);
    expect(backoff(1, () => 1)).toBe(1000);
    expect(backoff(3, () => 0.5)).toBe(3000);
    expect(backoff(10, () => 1)).toBe(30000);
  });

  it('retries a failed chunk after the backoff, up to retryChunksLimit, then fails with one entry', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ chunking: true, chunkSize: 2 }, null);
    const f = core.addFile(bytesFile('a', 4), 'D');
    const errors = vi.fn();
    core.on('error', errors);
    await vi.advanceTimersByTimeAsync(0);
    t.open()[0]!.reply(200);
    await vi.advanceTimersByTimeAsync(0);
    const delays = [750, 1500, 3000]; // random 0.5 -> factor 0.75
    t.open()[0]!.reply(500, { code: 'SERVER_ERROR', message: 'boom' });
    for (const d of delays) {
      await vi.advanceTimersByTimeAsync(d - 1);
      expect(t.open()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.open()).toHaveLength(1);
      expect(t.open()[0]!.field('dzchunkindex')).toBe('1');
      t.open()[0]!.reply(500, { code: 'SERVER_ERROR', message: 'boom' });
    }
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.uploads()).toHaveLength(5);
    expect(f.status).toBe('error');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![1]).toEqual({ code: 'SERVER_ERROR', message: 'boom' });
    expect(core.getErrors()).toEqual([
      expect.objectContaining({
        fileId: f.id,
        relativePath: 'D/a',
        uploadId: f.upload.uuid,
        code: 'SERVER_ERROR',
        message: 'boom',
        httpStatus: 500,
        stage: 'upload',
        chunkIndex: 1,
        attempt: 4,
        retryable: true,
      }),
    ]);
  });

  it('honours Retry-After, and a chunk that succeeds on retry leaves no entry', async () => {
    vi.useFakeTimers();
    const { core, t } = mk(
      { chunking: true, forceChunking: true, chunkSize: 2, finalizeUrl: null },
      null,
    );
    const f = core.addFile(bytesFile('a', 2), 'D');
    await vi.advanceTimersByTimeAsync(0);
    t.open()[0]!.reply(429, {}, { 'Retry-After': '5' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(t.open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    t.open()[0]!.reply(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.status).toBe('success');
    expect(core.getErrors()).toEqual([]);
  });

  it('never retries a whole-file upload, nor anything with retryChunks: false', async () => {
    for (const opts of [{}, { chunking: true, chunkSize: 1, retryChunks: false }]) {
      const { core, t } = mk(opts, (c) => c.reply(500));
      const f = core.addFile(bytesFile('a', 2));
      await settle(10);
      expect(t.uploads()).toHaveLength(1);
      expect(f.status).toBe('error');
      expect(core.getErrors()[0]).toMatchObject({ code: 'SERVER_ERROR', attempt: 1 });
    }
  });

  it("does not retry 4xx; a timeout uses Dropzone's message", async () => {
    const { core } = mk({ chunking: true, chunkSize: 1 }, (c) =>
      c.reply(413, { code: 'TOO_LARGE', message: 'big' }),
    );
    const f = core.addFile(bytesFile('a', 2));
    await settle(10);
    expect(core.getErrors()[0]).toMatchObject({ fileId: f.id, code: 'TOO_LARGE', attempt: 1 });

    const b = mk({ timeout: 2000, retryChunks: false }, (c) => c.fail('timeout'));
    const err = vi.fn();
    b.core.on('error', err);
    b.core.addFile(bytesFile('a', 2));
    await settle(10);
    expect(err.mock.calls[0]![1]).toBe('Request timedout after 2 seconds');
    expect(b.core.getErrors()[0]).toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports an unreadable file (iCloud placeholder, moved file) clearly instead of retrying', async () => {
    const { core, t } = mk({ chunking: true, chunkSize: 1 }, (c) => c.fail('network'));
    const raw = bytesFile('cloud.heic', 3);
    vi.spyOn(raw, 'slice').mockImplementation(() => {
      const b = new Blob(['x']);
      b.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
      b.slice = () => b;
      return b;
    });
    vi.useFakeTimers();
    const f = core.addFile(raw);
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    expect(t.uploads()).toHaveLength(1);
    expect(f.status).toBe('error');
    expect(core.getErrors()[0]).toMatchObject({
      code: 'UNREADABLE',
      message: core.options.dictFileUnreadable,
      retryable: true,
    });
  });

  it('409 CHUNK_MISMATCH refetches the chunk status and resends only the missing chunks', async () => {
    let first = true;
    const { core, t } = mk({ chunking: true, chunkSize: 1 }, (c) => {
      if (c.kind === 'status') return c.reply(200, { received: [0, 2] });
      if (c.kind === 'upload' && c.field('dzchunkindex') === '1' && first) {
        first = false;
        return c.reply(409, { code: 'CHUNK_MISMATCH' });
      }
      c.reply(200);
    });
    const f = core.addFile(bytesFile('a', 3));
    await settle(20);
    expect(t.calls.map((c) => c.kind + (c.field('dzchunkindex') ?? ''))).toEqual([
      'upload0',
      'upload1',
      'status',
      'upload1',
      'finalize',
    ]);
    expect(t.calls[2]!.req.url).toBe(`/upload/status?uploadId=${f.upload.uuid}`);
    expect(f.status).toBe('success');
  });
});

describe('manifest (0003)', () => {
  it('is sent once per batch before its first file, with accepted files, folders and roots', async () => {
    const { core, t } = mk({
      sendManifest: true,
      renameFile: (f) => f.name.toUpperCase(),
      acceptedFiles: '.txt,.TXT',
    });
    await drop(core, {
      Root: { 'a.txt': 1, 'bad.png': 1, empty: {}, sub: { 'b.txt': 2 } },
      'loose.txt': 1,
    });
    await settle(10);
    expect(t.calls[0]!.kind).toBe('manifest');
    expect(t.calls.filter((c) => c.kind === 'manifest')).toHaveLength(1);
    const m = t.calls[0]!.json!;
    expect(m.roots).toEqual(['Root']);
    expect(m.folders).toEqual(['Root', 'Root/empty', 'Root/sub']);
    expect((m.files as { relativePath: string }[]).map((f) => f.relativePath).sort()).toEqual([
      'LOOSE.TXT',
      'Root/A.TXT',
      'Root/sub/B.TXT',
    ]);
    const sessionId = m.sessionId;
    expect(t.uploads().every((c) => c.field('adSessionId') === sessionId)).toBe(true);
    expect(core.getFolder('Root/empty')!.status).toBe('success');
  });

  it('holds the batch until the manifest returns; a batch of only empty folders still sends one', async () => {
    const { core, t } = mk({ sendManifest: true }, null);
    const fc = vi.fn();
    core.on('foldercomplete', fc);
    await drop(core, { E: { inner: {} } });
    await settle();
    expect(t.calls.map((c) => c.kind)).toEqual(['manifest']);
    expect(core.getFolder('E/inner')!.status).toBe('queued');
    t.calls[0]!.reply(200);
    await settle();
    expect(core.getFolder('E/inner')!.status).toBe('success');
    expect(fc.mock.calls.map((c) => (c[0] as { path: string }).path)).toEqual(['E/inner', 'E']);

    core.addFile(bytesFile('x', 1), 'F');
    await settle();
    expect(t.open().map((c) => c.kind)).toEqual(['manifest']);
    t.open()[0]!.reply(200);
    await settle();
    expect(t.open().map((c) => c.kind)).toEqual(['upload']);
  });

  it('a failed manifest (after retries) fails the batch files and empty folders', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ sendManifest: true }, (c) =>
      c.reply(500, { code: 'DOWN', message: 'down' }),
    );
    const errors = vi.fn();
    core.on('error', errors);
    const done = drop(core, { R: { 'a.txt': 1, empty: {} } });
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(t.calls.map((c) => c.kind)).toEqual(['manifest', 'manifest', 'manifest', 'manifest']);
    const f = core.files[0]!;
    expect(f.status).toBe('error');
    expect(errors).toHaveBeenCalledTimes(1);
    expect(core.getFolder('R/empty')!.status).toBe('error');
    expect(core.getErrors()).toEqual([
      expect.objectContaining({ fileId: f.id, code: 'DOWN', stage: 'manifest', attempt: 4 }),
      expect.objectContaining({ fileId: null, relativePath: 'R/empty', stage: 'manifest' }),
    ]);
  });
});

describe('finalize hook chunksUploaded (0011)', () => {
  it('replaces finalize: this = options, instance as third argument, done(value) succeeds', async () => {
    const seen: unknown[] = [];
    let inst: unknown;
    const { core, t } = mk({
      chunking: true,
      chunkSize: 1,
      chunksUploaded(file, done, instance) {
        seen.push(this);
        inst = instance;
        done({ some: 'response' });
      },
    });
    const success = vi.fn();
    core.on('success', success);
    const f = core.addFile(bytesFile('a', 2));
    await settle(10);
    expect(seen[0]).toBe(core.options);
    expect(inst).toBe(core);
    expect(t.calls.some((c) => c.kind === 'finalize')).toBe(false);
    expect(f.status).toBe('success');
    expect(success.mock.calls[0]![1]).toEqual({ ok: true, kind: 'upload' }); // last chunk response
  });

  it.each([
    ['an Error', (done: (e?: unknown) => void) => done(new Error('nope')), 'nope'],
    ['a string', (done: (e?: unknown) => void) => done('bad'), 'bad'],
    [
      'a throw',
      () => {
        throw new Error('thrown');
      },
      'thrown',
    ],
  ])('fails with FINALIZE_FAILED on %s; the first call wins', async (_n, hook, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // reportError fallback
    const { core } = mk({
      chunking: true,
      chunkSize: 1,
      chunksUploaded: (_f, done) => {
        hook(done);
        done();
      },
    });
    const f = core.addFile(bytesFile('a', 2));
    await settle(10);
    expect(f.status).toBe('error');
    expect(core.getErrors()[0]).toMatchObject({
      code: 'FINALIZE_FAILED',
      stage: 'finalize',
      message,
    });
  });
});

describe('queue control', () => {
  it('autoProcessQueue: false waits for processQueue(), which starts parallelUploads files once', async () => {
    const { core, t } = mk({ autoProcessQueue: false });
    const files = ['a', 'b', 'c'].map((n) => core.addFile(bytesFile(n, 1)));
    await settle();
    expect(t.calls).toHaveLength(0);
    core.processQueue();
    await settle();
    expect(files.map((f) => f.status)).toEqual(['success', 'success', 'queued']);
  });

  it('addFile(f); processQueue() in one tick works with autoProcessQueue: false (0011)', async () => {
    const { core } = mk({ autoProcessQueue: false, autoQueue: false });
    const f = core.addFile(bytesFile('a', 1));
    core.enqueueFile(f); // deferred: the batch is still open
    core.processQueue();
    expect(core.getQueuedFiles()).toEqual([]);
    await settle();
    expect(f.status).toBe('success');
  });

  it('a deferred enqueueFile() of a rejected file is dropped with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { core } = mk({ autoQueue: false, acceptedFiles: '.png' });
    const f = core.addFile(bytesFile('a.txt', 1));
    expect(() => core.enqueueFile(f)).not.toThrow();
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(f.status).toBe('error');
  });

  it('processFile(s) start files beyond parallelUploads; uploadFile is an alias', async () => {
    const { core, t } = mk({ autoProcessQueue: false, parallelUploads: 1 }, null);
    const files = ['a', 'b', 'c'].map((n) => core.addFile(bytesFile(n, 1)));
    core.processFile(files[0]!); // batch open: deferred
    await settle();
    core.uploadFiles([files[1]!, files[2]!]);
    await settle();
    expect(core.getUploadingFiles()).toHaveLength(3);
    expect(t.open()).toHaveLength(3);
  });

  it('fires queuecomplete once after the last file, also after an all-rejected drop', async () => {
    const { core } = mk({ acceptedFiles: '.png' });
    const qc = vi.fn();
    core.on('queuecomplete', qc);
    await drop(core, { D: { 'a.txt': 1, 'b.txt': 1 } });
    await settle();
    expect(qc).toHaveBeenCalledTimes(1);
    core.addFile(makeFile('c.png', 3));
    core.addFile(makeFile('d.png', 3));
    await settle(10);
    expect(qc).toHaveBeenCalledTimes(2);
  });

  it('emits Dropzone-ordered events for one file, plus folder events', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ chunking: true, chunkSize: 2 }, null);
    const log = record(core, [
      'processing',
      'sending',
      'success',
      'complete',
      'foldercomplete',
      'queuecomplete',
    ]);
    const prog: number[] = [];
    const total: number[] = [];
    const folder: number[] = [];
    core.on('uploadprogress', (_f, p) => prog.push(Math.round(p)));
    core.on('totaluploadprogress', (p) => total.push(Math.round(p)));
    core.on('folderprogress', (_n, p) => folder.push(Math.round(p)));
    core.addFile(bytesFile('a', 4), 'D');
    await vi.advanceTimersByTimeAsync(0);
    t.open()[0]!.progress(50, 100);
    t.open()[0]!.progress(100, 100);
    t.open()[0]!.reply(200);
    await vi.advanceTimersByTimeAsync(0);
    t.open()[0]!.progress(50, 100);
    await vi.advanceTimersByTimeAsync(150); // folderprogress is throttled to 100 ms
    t.open()[0]!.reply(200);
    await vi.advanceTimersByTimeAsync(0);
    t.open()[0]!.reply(200); // finalize
    await vi.advanceTimersByTimeAsync(10);
    expect(prog).toEqual([25, 50, 75, 100]);
    expect(total).toEqual([25, 50, 75, 100]);
    expect(folder).toEqual([75, 100]);
    expect(log).toEqual([
      'processing:D/a',
      'sending:D/a',
      'sending:D/a',
      'success:D/a',
      'complete:D/a',
      'foldercomplete:D',
      'queuecomplete',
    ]);
  });
});

describe('uploadMultiple (0003)', () => {
  it('sends up to parallelUploads files in one request with indexed fields (protocol v1.2)', async () => {
    const { core, t } = mk({ uploadMultiple: true, parallelUploads: 3 });
    const log = record(core, [
      'processingmultiple',
      'sendingmultiple',
      'successmultiple',
      'completemultiple',
    ]);
    await drop(core, { D: { 'a.txt': 1, 'b.txt': 1, 'c.txt': 1, 'd.txt': 1 } });
    await settle(10);
    const [c1, c2] = t.uploads();
    expect(Array.from(c1!.form!.keys())).toEqual([
      'adRelativePath[0]',
      'adSessionId[0]',
      'adRelativePath[1]',
      'adSessionId[1]',
      'adRelativePath[2]',
      'adSessionId[2]',
      'file[0]',
      'file[1]',
      'file[2]',
    ]);
    expect(c1!.field('adRelativePath[2]')).toBe('D/c.txt');
    expect(c2!.field('adRelativePath[0]')).toBe('D/d.txt');
    expect(log.filter((l) => l === 'successmultiple')).toHaveLength(2);
    expect(core.files.every((f) => f.status === 'success')).toBe(true);
  });

  it('rejections emit errormultiple([file]) and completemultiple([file]) (Dropzone)', async () => {
    const { core } = mk({ uploadMultiple: true, acceptedFiles: '.png' });
    const em = vi.fn();
    const cm = vi.fn();
    core.on('errormultiple', em);
    core.on('completemultiple', cm);
    const f = core.addFile(makeFile('a.txt'));
    await settle();
    expect(em).toHaveBeenCalledWith([f], expect.any(String));
    expect(cm).toHaveBeenCalledWith([f]);
  });
});

describe('transformFile (0011)', () => {
  it('runs when the file starts processing; chunk info and bytes come from the transformed blob', async () => {
    const order: string[] = [];
    const { core, t } = mk({
      chunking: true,
      chunkSize: 2,
      transformFile(file, done) {
        order.push('transform');
        expect(this).toBe(core);
        setTimeout(() => done(new Blob(['abcdef'])), 0);
      },
    });
    core.on('processing', () => order.push('processing'));
    const f = core.addFile(bytesFile('a', 1));
    expect(f.upload.chunked).toBe(false); // provisional until processing starts
    await settle(15);
    expect(order).toEqual(['processing', 'transform']);
    expect(f.upload).toMatchObject({ chunked: true, totalChunkCount: 3, total: 6, progress: 100 });
    expect(t.uploads().map((c) => c.field('dztotalfilesize'))).toEqual(['6', '6', '6']);
    expect(await (t.uploads()[2]!.form!.get('file') as Blob).text()).toBe('ef');
    expect(core.getTree().progress).toBe(100);
  });
});

describe('cancel, destroy, zero bytes, paths', () => {
  it('cancelUpload aborts the requests in flight; canceled + complete, no error (0012)', async () => {
    const { core, t } = mk({ chunking: true, chunkSize: 1, parallelChunkUploads: 2 }, null);
    const f = core.addFile(bytesFile('a', 4), 'D');
    const log = record(core, ['canceled', 'complete', 'error', 'foldercomplete']);
    await settle();
    const open = t.open();
    expect(open).toHaveLength(2);
    core.cancelUpload(f);
    expect(open.every((c) => c.aborted)).toBe(true);
    expect(f.status).toBe('canceled');
    expect(log).toEqual(['canceled:D/a', 'complete:D/a', 'foldercomplete:D']);
    expect(core.getErrors()).toEqual([]);
    await settle();
    expect(t.calls).toHaveLength(2);
  });

  it('destroy() aborts every request and emits nothing more', async () => {
    const { core, t } = mk({}, null);
    core.addFile(bytesFile('a', 1));
    await settle();
    const spy = vi.fn();
    core.on('error', spy);
    core.destroy();
    expect(t.calls[0]!.aborted).toBe(true);
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(core.on('error', spy)).toBeTypeOf('function');
  });

  it('uploads zero-byte files (chunked and not) to 100% without hanging', async () => {
    for (const opts of [{}, { chunking: true, forceChunking: true }]) {
      const { core, t } = mk(opts);
      const f = core.addFile(new File([], 'empty.txt'));
      await settle(10);
      expect(f.status).toBe('success');
      expect(f.upload.progress).toBe(100);
      expect(t.uploads()).toHaveLength(1);
    }
  });

  it('rejects paths with a .. segment at validation (INVALID_PATH)', async () => {
    const { core, t } = mk();
    const f = core.addFile(makeFile('a.txt'), 'x/../../etc');
    await settle();
    expect(f.status).toBe('error');
    expect(core.getErrors()[0]).toMatchObject({ code: 'INVALID_PATH', stage: 'validate' });
    expect(t.calls).toHaveLength(0);
  });

  it('disable() cancels every file and enable() clears the flag; adding still works', async () => {
    const { core } = mk({}, null);
    const a = core.addFile(bytesFile('a', 1));
    await settle();
    core.disable();
    expect(core.disabled).toBe(true);
    expect(a.status).toBe('canceled');
    const b = core.addFile(bytesFile('b', 1));
    core.enable();
    expect(core.disabled).toBe(false);
    await settle();
    expect(b.status).toBe('uploading');
  });
});

describe('API surface (0012, M1 review)', () => {
  it('on()/once() return an unsubscribe that chains; off(event, fn) removes once listeners', () => {
    const core = new AnyDropCore();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const off = core.on('reset', a).on('reset', b);
    core.once('reset', c);
    core.off('reset', c);
    core.emit('reset');
    expect([a.mock.calls.length, b.mock.calls.length, c.mock.calls.length]).toEqual([1, 1, 0]);
    off();
    core.emit('reset');
    expect(b).toHaveBeenCalledTimes(1);
    expect('off' in off).toBe(false);
  });

  it('emits removedfolder deepest first after removedfile; no completion re-check outside a run (0013)', async () => {
    const { core } = mk({ url: null, acceptedFiles: '.png' });
    await drop(core, { A: { B: { 'x.png': 1 }, 'bad.txt': 1 } });
    const log = record(core, ['removedfile', 'removedfolder', 'foldercomplete']);
    core.removeFile(core.files.find((f) => f.name === 'x.png')!);
    // Nothing ever entered processing, so no run is open and nothing is re-checked.
    expect(log).toEqual(['removedfile:A/B/x.png', 'removedfolder:A/B']);
  });

  it('maps the deprecated acceptedMimeTypes and renameFilename; resolveOption', () => {
    const core = new AnyDropCore({ acceptedMimeTypes: 'image/*', renameFilename: (n) => 'x-' + n });
    expect(core.options.acceptedFiles).toBe('image/*');
    expect(core.addFile(makeFile('a.png')).upload.filename).toBe('x-a.png');
    expect(() => new AnyDropCore({ acceptedMimeTypes: 'a', acceptedFiles: 'b' })).toThrow(
      "You can't provide both 'acceptedFiles' and 'acceptedMimeTypes'.",
    );
    expect(core.resolveOption(5)).toBe(5);
    expect(
      core.resolveOption(function (this: unknown, n: number) {
        return [this, n];
      }, 2),
    ).toEqual([core, 2]);
  });

  it('types `this` as the instance in handlers and accept()', () => {
    const core = new AnyDropCore({
      success(f) {
        expectTypeOf(this).toEqualTypeOf<AnyDropCore>();
        this.removeFile(f);
      },
      accept(file, done) {
        expectTypeOf(this).toEqualTypeOf<AnyDropCore>();
        expectTypeOf(file).toEqualTypeOf<AnyDropFile>();
        done();
      },
    });
    expect(core).toBeInstanceOf(AnyDropCore);
  });
});
