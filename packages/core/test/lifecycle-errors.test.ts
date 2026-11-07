// Lifecycle auto-pause (0008), the error registry and retryFailedOnly (0007), and the M2 review
// fixes that M3 builds on (0013: run tracking, REQUEST_SETUP_FAILED, external aborts,
// cross-batch uploadMultiple; per-file chunk size; 404 restart with chunks in flight).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEntry, PauseTarget } from '../src/index';
import { buildEntries, dataTransfer, makeFile } from './helpers/entries';
import { URLS, bytesFile, mk, openUploads, sentChunks } from './helpers/m3';
import { okAll, settle, type Call } from './helpers/transport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NO_PERSIST = { persistState: false };

function log(core: ReturnType<typeof mk>['core']) {
  const out: string[] = [];
  const tag = (t: PauseTarget) => (t.scope === 'all' ? t.reason : t.scope);
  core.on('paused', (t) => out.push('paused:' + tag(t)));
  core.on('resumed', (t) => out.push('resumed:' + tag(t)));
  core.on('offline', () => out.push('offline'));
  core.on('online', () => out.push('online'));
  return out;
}

const answerAll = async (t: ReturnType<typeof mk>['t'], rounds = 30) => {
  for (let i = 0; i < rounds; i++) {
    t.calls.filter((c) => !c.done).forEach((c) => okAll(c));
    await settle(1);
  }
};

describe('lifecycle (0008)', () => {
  it('offline pauses (pauseMode abort) and online resumes; only missing chunks are sent', async () => {
    const { core, t } = mk(NO_PERSIST, null);
    const ev = log(core);
    const f = core.addFile(bytesFile('a.bin', 30));
    await settle();
    openUploads(t)[0]!.reply();
    await settle();
    const c1 = openUploads(t)[0]!;
    window.dispatchEvent(new Event('offline'));
    expect(c1.aborted).toBe(true);
    expect(f.status).toBe('paused');
    expect(ev).toEqual(['offline', 'paused:offline']);
    window.dispatchEvent(new Event('online'));
    expect(ev).toEqual(['offline', 'paused:offline', 'online', 'resumed:offline']);
    await answerAll(t);
    expect(f.status).toBe('success');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 1, 1, 2]);
    core.destroy();
  });

  it('autoResumeOnReconnect: false keeps the offline pause until resume()', async () => {
    const { core } = mk({ ...NO_PERSIST, autoResumeOnReconnect: false }, null);
    const f = core.addFile(bytesFile('a.bin', 30));
    await settle();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(f.status).toBe('paused');
    core.resume();
    expect(f.status).toBe('uploading');
    core.destroy();
  });

  it('a request failing while navigator.onLine is false pauses: no retry used, no error entry', async () => {
    const { core, t } = mk({ ...NO_PERSIST, retryChunksLimit: 0 }, null);
    const ev = log(core);
    const f = core.addFile(bytesFile('a.bin', 20));
    await settle();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    openUploads(t)[0]!.fail('network');
    await settle();
    expect(f.status).toBe('paused');
    expect(ev).toEqual(['paused:offline']);
    expect(core.getErrors()).toEqual([]);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await answerAll(t);
    // retryChunksLimit 0, yet the chunk is sent again: the offline failure used no retry.
    expect(f.status).toBe('success');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0, 1]);
    core.destroy();
  });

  it('hidden: nothing is aborted; a network failure while hidden pauses (iOS); visible resumes', async () => {
    const { core, t } = mk(NO_PERSIST, null);
    const ev = log(core);
    const f = core.addFile(bytesFile('a.bin', 20));
    await settle();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const c0 = openUploads(t)[0]!;
    expect(c0.aborted).toBe(false);
    expect(f.status).toBe('uploading');
    c0.fail('timeout');
    await settle();
    expect(f.status).toBe('paused');
    expect(ev).toEqual(['paused:hidden']);
    expect(core.getErrors()).toEqual([]);
    vis.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ev).toEqual(['paused:hidden', 'resumed:hidden']);
    await answerAll(t);
    expect(f.status).toBe('success');
    core.destroy();
  });

  it('autoPauseOnHidden: false treats a failure while hidden as a normal failure', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...NO_PERSIST, autoPauseOnHidden: false, retryChunks: false }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    expect(f.status).toBe('uploading');
    openUploads(t)[0]!.fail('network');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.status).toBe('error');
    expect(core.getErrors()[0]!.code).toBe('NETWORK');
    core.destroy();
  });

  it('pagehide flushes and pauses at once with abort; pageshow resumes', async () => {
    const { core, t } = mk({ ...NO_PERSIST, pauseMode: 'finishChunk' }, null);
    const ev = log(core);
    const f = core.addFile(bytesFile('a.bin', 20));
    await settle();
    const c0 = openUploads(t)[0]!;
    window.dispatchEvent(new Event('pagehide'));
    expect(c0.aborted).toBe(true); // always abort, whatever pauseMode
    expect(f.status).toBe('paused');
    window.dispatchEvent(new Event('pageshow'));
    expect(ev).toEqual(['paused:hidden', 'resumed:hidden']);
    expect(f.status).toBe('uploading');
    core.destroy();
  });

  it('listeners are added on the first processQueue and removed by destroy()', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { core } = mk({ ...NO_PERSIST, autoProcessQueue: false });
    core.addFile(bytesFile('a.bin', 5));
    await settle();
    const names = () => add.mock.calls.map((c) => c[0]);
    expect(names()).not.toContain('offline');
    core.processQueue();
    expect(names()).toEqual(expect.arrayContaining(['online', 'offline', 'pagehide', 'pageshow']));
    const offline = vi.fn();
    core.on('offline', offline);
    core.destroy();
    expect(remove.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['online', 'offline', 'pagehide', 'pageshow']),
    );
    window.dispatchEvent(new Event('offline'));
    expect(offline).not.toHaveBeenCalled();
  });

  it('a manifest failing while offline waits for the instance to run again, then is sent again', async () => {
    const { core, t } = mk({ ...NO_PERSIST, ...URLS, sendManifest: true }, null);
    core.addFile(bytesFile('a.bin', 5), 'D');
    await settle();
    const m = t.calls[0]!;
    expect(m.kind).toBe('manifest');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    m.fail('network');
    await settle();
    expect(t.calls).toHaveLength(1);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(t.calls.filter((c) => c.kind === 'manifest')).toHaveLength(2);
    expect(t.calls[1]!.json!.sessionId).toBe(m.json!.sessionId);
    core.destroy();
  });
});

describe('errors and retryFailedOnly (0007)', () => {
  const failOn = (paths: string[]) => (c: Call) =>
    c.kind === 'upload' &&
    paths.includes(c.field('adRelativePath') || '') &&
    c.field('dzchunkindex') === '1'
      ? c.reply(400, { code: 'INVALID_CHUNK', message: 'bad' })
      : okAll(c);

  it('one entry per failed file; retryFailedOnly(path) re-queues that subtree, keeps done chunks, asks chunkStatusUrl', async () => {
    let failing = ['X/a.bin', 'Y/b.bin'];
    const { core, t } = mk(
      { ...NO_PERSIST, chunkStatusUrl: '/upload/status', acceptedFiles: '.bin' },
      (c) => failOn(failing)(c),
    );
    const changes: ErrorEntry[][] = [];
    core.on('errorlistchanged', (e) => changes.push(e));
    const a = core.addFile(bytesFile('a.bin', 30), 'X');
    const b = core.addFile(bytesFile('b.bin', 30), 'Y');
    const bad = core.addFile(makeFile('c.txt', 1), 'X');
    await settle(10);
    expect([a.status, b.status, bad.status]).toEqual(['error', 'error', 'error']);
    const errors = core.getErrors();
    expect(errors.map((e) => [e.relativePath, e.code, e.stage, e.chunkIndex, e.retryable])).toEqual(
      [
        ['X/c.txt', 'REJECTED_TYPE', 'validate', undefined, false],
        ['X/a.bin', 'INVALID_CHUNK', 'upload', 1, true],
        ['Y/b.bin', 'INVALID_CHUNK', 'upload', 1, true],
      ],
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).toEqual(errors);
    expect(t.calls.some((c) => c.kind === 'status')).toBe(false); // fresh files never ask

    failing = [];
    expect(core.retryFailedOnly('X')).toBe(1); // the rejected .txt is not retried
    expect(core.getErrors().map((e) => e.relativePath)).toEqual(['X/c.txt', 'Y/b.bin']);
    await settle(10);
    expect(a.status).toBe('success');
    // The retry asked the server first, then sent only what was missing.
    expect(t.calls.filter((c) => c.kind === 'status')).toHaveLength(1);
    expect(sentChunks(t, a.upload.uuid)).toEqual([0, 1, 0, 1, 2]); // status said nothing received
    expect(b.status).toBe('error');

    core.clearErrors();
    expect(core.getErrors()).toEqual([]);
    expect(b.status).toBe('error');
    expect(core.retryFailedOnly()).toBe(1);
    await settle(10);
    expect(b.status).toBe('success');
  });

  it('a failed manifest is sent again with the same sessionId; empty folders recover', async () => {
    let fail = true;
    const { core, t } = mk(
      { ...NO_PERSIST, ...URLS, sendManifest: true, retryChunks: false },
      (c) =>
        c.kind === 'manifest' && fail
          ? c.reply(500, { code: 'SERVER_ERROR', message: 'x' })
          : okAll(c),
    );
    await core.drop({
      dataTransfer: dataTransfer(buildEntries({ D: { 'a.bin': 5, E: {} } }).roots) as never,
    });
    await settle(10);
    expect(core.getErrors().map((e) => [e.relativePath, e.stage, e.fileId === null])).toEqual([
      ['D/a.bin', 'manifest', false],
      ['D/E', 'manifest', true],
    ]);
    fail = false;
    expect(core.retryFailedOnly()).toBe(1);
    await settle(10);
    const manifests = t.calls.filter((c) => c.kind === 'manifest');
    expect(manifests).toHaveLength(2);
    expect(manifests[1]!.json!.sessionId).toBe(manifests[0]!.json!.sessionId);
    expect(core.getErrors()).toEqual([]);
    expect(core.getFolder('D/E')!.status).toBe('success');
    expect(core.files[0]!.status).toBe('success');
  });

  it('exportErrors: JSON and RFC 4180 CSV', async () => {
    const { core } = mk({ ...NO_PERSIST, acceptedFiles: '.png' });
    core.addFile(makeFile('a "q", b.txt', 1));
    await settle();
    expect(JSON.parse(core.exportErrors('json'))[0].code).toBe('REJECTED_TYPE');
    expect(core.exportErrors('csv').split('\r\n')[1]).toContain('"a ""q"", b.txt"');
  });
});

describe('M4 requests', () => {
  it('retryFile(file | id) re-queues one failed file and returns whether it did', async () => {
    let fail = true;
    const { core } = mk({ ...NO_PERSIST, chunking: false }, (c) =>
      fail ? c.reply(400, { code: 'HTTP_ERROR', message: 'x' }) : okAll(c),
    );
    const a = core.addFile(bytesFile('a.bin', 3));
    const b = core.addFile(bytesFile('b.bin', 3));
    await settle();
    expect([a.status, b.status]).toEqual(['error', 'error']);
    fail = false;
    expect(core.retryFile(a.id)).toBe(true);
    expect(core.retryFile('nope')).toBe(false);
    await settle();
    expect([a.status, b.status]).toEqual(['success', 'error']);
    expect(core.retryFile(a)).toBe(false); // not in error any more
    expect(core.getErrors().map((e) => e.relativePath)).toEqual(['b.bin']);
  });

  it('removeAllFiles() also prunes folders dropped empty, with removedfolder for each', async () => {
    const { core } = mk({ ...NO_PERSIST, url: null });
    await core.drop({
      dataTransfer: dataTransfer(buildEntries({ A: { 'x.bin': 1, E: {} }, Z: {} }).roots) as never,
    });
    const gone: string[] = [];
    core.on('removedfolder', (n) => gone.push(n.path));
    core.removeAllFiles();
    expect(gone.sort()).toEqual(['A', 'A/E', 'Z']);
    expect(core.getTree().children).toEqual([]);
  });

  it('_completeExternal() emits complete and re-checks queuecomplete only during a run', async () => {
    class Sub extends (await import('../src/index')).AnyDropCore {
      done(f: File) {
        this._completeExternal(f as never);
      }
    }
    const core = new Sub({ persistState: false });
    const qc = vi.fn();
    const complete = vi.fn();
    core.on('queuecomplete', qc);
    core.on('complete', complete);
    core.done(makeFile('mock.png'));
    await settle();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(qc).not.toHaveBeenCalled(); // idle: no extra queuecomplete
  });
});

describe('M2 review fixes', () => {
  it('a 404 after a 409 restarts under a new uploadId with nothing of the old chunks landing (M1)', async () => {
    const { core, t } = mk(
      { ...NO_PERSIST, chunkStatusUrl: '/upload/status', parallelChunkUploads: 3 },
      null,
    );
    const f = core.addFile(bytesFile('a.bin', 60));
    await settle();
    const first = openUploads(t);
    expect(first).toHaveLength(3);
    const old = f.upload.uuid;
    first[0]!.reply(409, { code: 'CHUNK_MISMATCH', message: 'x' });
    await settle();
    // The other chunks in flight were aborted before the status request.
    expect(first[1]!.aborted && first[2]!.aborted).toBe(true);
    t.calls.find((c) => c.kind === 'status')!.reply(404, { code: 'NOT_FOUND' });
    await settle();
    expect(f.upload.uuid).not.toBe(old);
    expect(f.upload.chunksDone.size).toBe(0);
    await answerAll(t);
    expect(f.status).toBe('success');
    expect(sentChunks(t, f.upload.uuid).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("the chunk size is fixed per file: setOption('chunkSize') mid-file keeps its offsets (M2)", async () => {
    const { core, t } = mk({ ...NO_PERSIST }, null);
    const f = core.addFile(bytesFile('a.bin', 30));
    await settle();
    openUploads(t)[0]!.reply();
    await settle();
    core.pause();
    core.setOption('chunkSize', 4);
    core.resume();
    await settle();
    const c = openUploads(t)[0]!;
    expect([c.field('dzchunkindex'), c.field('dzchunkbyteoffset'), c.field('dzchunksize')]).toEqual(
      ['1', '10', '10'],
    );
    expect(f.upload.chunkSize).toBe(10);
    expect(f.upload.totalChunkCount).toBe(3);
  });

  it('a throw while a request is built fails the file with REQUEST_SETUP_FAILED and frees its slot (0013)', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const { core, t } = mk({
      ...NO_PERSIST,
      parallelUploads: 1,
      params(files) {
        if (files[0]!.name === 'a.bin') throw new Error('params bug');
        return {};
      },
    });
    const a = core.addFile(bytesFile('a.bin', 5));
    const b = core.addFile(bytesFile('b.bin', 5));
    await settle(10);
    expect(a.status).toBe('error');
    expect(core.getErrors()).toEqual([
      expect.objectContaining({
        relativePath: 'a.bin',
        code: 'REQUEST_SETUP_FAILED',
        message: 'params bug',
        retryable: true,
      }),
    ]);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'params bug' }));
    expect(b.status).toBe('success');
    expect(t.uploads().map((c) => c.field('adRelativePath'))).toEqual(['b.bin']);
    vi.unstubAllGlobals();
  });

  it('a throwing url() or transport fails the manifest/finalize stage too (0013)', async () => {
    vi.stubGlobal('reportError', vi.fn());
    const { core } = mk({
      ...NO_PERSIST,
      url: () => {
        throw new Error('no url');
      },
    });
    const f = core.addFile(bytesFile('a.bin', 5));
    await settle();
    expect(core.getErrors()[0]).toEqual(
      expect.objectContaining({ fileId: f.id, code: 'REQUEST_SETUP_FAILED', stage: 'upload' }),
    );
    vi.unstubAllGlobals();
  });

  it('url/method receive (files, dataBlocks); timeout is resolved (B3, minor 1)', async () => {
    const seen: unknown[] = [];
    const { core, t } = mk({
      ...NO_PERSIST,
      url(files, blocks) {
        seen.push([
          files.length,
          blocks.map((b) => [b.name, b.data.size, b.filename, b.chunkIndex]),
        ]);
        return '/upload';
      },
      method: (_files, blocks) => (blocks.length ? 'put' : 'post'),
      timeout: (files) => files.length * 1000,
    });
    core.addFile(bytesFile('a.bin', 15));
    await settle(10);
    expect(seen).toEqual([
      [1, [['file', 10, 'a.bin', 0]]],
      [1, [['file', 5, 'a.bin', 1]]],
    ]);
    expect(t.uploads()[0]!.req.method).toBe('PUT');
    expect(t.uploads()[0]!.req.timeout).toBe(1000);
  });

  it('an abort from outside (file.xhr.abort()) is a NETWORK failure and is retried (0013)', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...NO_PERSIST }, null);
    const f = core.addFile(bytesFile('a.bin', 15), 'D');
    const whole = core.addFile(bytesFile('w.bin', 5), 'D');
    await vi.advanceTimersByTimeAsync(0);
    openUploads(t).forEach((c) => c.abortFromOutside());
    await vi.advanceTimersByTimeAsync(4000);
    // The chunk is retried; the whole file is not (0007), and fails with NETWORK, not ABORTED.
    expect(f.status).toBe('uploading');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0]);
    expect(whole.status).toBe('error');
    expect(core.getErrors().map((e) => [e.relativePath, e.code])).toEqual([['D/w.bin', 'NETWORK']]);
  });

  it('uploadMultiple groups queued files across batches: one request, one successmultiple (0013)', async () => {
    const { core, t } = mk({
      ...NO_PERSIST,
      chunking: false,
      uploadMultiple: true,
      autoProcessQueue: false,
    });
    const sm = vi.fn();
    core.on('successmultiple', sm);
    core.addFile(bytesFile('a.bin', 3));
    await settle();
    core.addFile(bytesFile('b.bin', 3));
    await settle();
    core.processQueue();
    await settle();
    const [c] = t.uploads();
    expect(t.uploads()).toHaveLength(1);
    expect(c!.field('adSessionId')).toBeNull();
    expect(c!.field('adSessionId[0]')).not.toBe(c!.field('adSessionId[1]'));
    expect(sm).toHaveBeenCalledTimes(1);
  });

  it('queuecomplete fires once with a removeAllFiles() handler (0013)', async () => {
    const { core } = mk(NO_PERSIST);
    const qc = vi.fn(function (this: typeof core) {
      this.removeAllFiles();
    });
    core.on('queuecomplete', qc);
    core.addFile(bytesFile('a.bin', 3));
    core.addFile(bytesFile('b.bin', 3));
    await settle(10);
    expect(qc).toHaveBeenCalledTimes(1);
    expect(core.files).toHaveLength(0);
  });

  it("setOption('url') restarts a stalled queue; sendManifest without manifestUrl warns once", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { core, t } = mk({ ...NO_PERSIST, url: null, sendManifest: true });
    const f = core.addFile(bytesFile('a.bin', 3));
    core.addFile(bytesFile('b.bin', 3));
    await settle();
    expect(f.status).toBe('queued');
    core.setOption('url', '/upload');
    await settle(10);
    expect(f.status).toBe('success');
    expect(t.calls.some((c) => c.kind === 'manifest')).toBe(false);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('manifestUrl'))).toHaveLength(1);
  });

  it('renameFile output with a separator or a dot name is rejected as INVALID_PATH', async () => {
    const { core } = mk({ ...NO_PERSIST, renameFile: (f) => (f.name === 'a' ? '../x' : 'ok/x') });
    core.addFile(makeFile('a'));
    core.addFile(makeFile('b'));
    await settle();
    expect(core.getErrors().map((e) => e.code)).toEqual(['INVALID_PATH', 'INVALID_PATH']);
  });

  it('disable() cancels queued files first and starts nothing; processFile on a non-queued file warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1 }, null);
    const a = core.addFile(bytesFile('a.bin', 5));
    const b = core.addFile(bytesFile('b.bin', 5));
    await settle();
    const canceled: string[] = [];
    core.on('canceled', (f) => canceled.push(f.name));
    core.disable();
    expect(canceled).toEqual(['b.bin', 'a.bin']);
    expect(t.uploads()).toHaveLength(1);
    core.processFile(a);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not queued'), 'a.bin', 'canceled');
    expect(b.status).toBe('canceled');
  });
});
