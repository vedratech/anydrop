import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnyDropCore, type AnyDropFile, type FolderNode } from '../src/index';
import { sentRelativePath } from '../src/util/path';
import { buildEntries, dataTransfer, makeFile, type Spec } from './helpers/entries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const flush = () => new Promise((r) => setTimeout(r, 0));

function drop(core: AnyDropCore, spec: Spec, opts?: Parameters<typeof buildEntries>[1]) {
  const t = buildEntries(spec, opts);
  return core.drop({ dataTransfer: dataTransfer(t.roots) as never });
}
function picked(path: string): File {
  const f = makeFile(path.slice(path.lastIndexOf('/') + 1));
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('file object (0002)', () => {
  it('is the native File with properties added', async () => {
    const core = new AnyDropCore({ persistState: false });
    const raw = makeFile('a.png', 10, 'image/png', 1234);
    const f = core.addFile(raw, 'Photos/2024');
    expect(f).toBe(raw);
    expect(f).toBeInstanceOf(File);
    expect(f.id).toMatch(UUID);
    expect(f.upload.uuid).toMatch(UUID);
    expect(f.id).not.toBe(f.upload.uuid);
    expect(f.relativePath).toBe('Photos/2024/a.png');
    expect(f.fullPath).toBe('Photos/2024/a.png');
    expect(f.fingerprint).toBe('Photos/2024/a.png|10|1234');
    expect(f.folder).toBe(core.getFolder('Photos/2024'));
    expect(f.status).toBe('added');
    expect(f.accepted).toBe(true);
    expect(f.upload).toMatchObject({
      filename: 'a.png',
      progress: 0,
      total: 10,
      bytesSent: 0,
      chunked: false,
      totalChunkCount: 1,
    });
    expect(f.upload.chunksDone.size).toBe(0);
    expect(() => {
      (f as { id: string }).id = 'x';
    }).toThrow();
    const fd = new FormData();
    fd.append('file', f);
    expect(fd.get('file')).toBeInstanceOf(File);
    await flush();
    expect(f.status).toBe('queued');
  });

  it('defines fullPath only for files from folders', () => {
    const core = new AnyDropCore();
    const loose = core.addFile(makeFile('x.txt'));
    expect(loose.relativePath).toBe('x.txt');
    expect('fullPath' in loose).toBe(false);
    expect(loose.folder).toBe(core.getTree());
    const fromPicker = core.addFile(picked('R/sub/y.txt'));
    expect(fromPicker.relativePath).toBe('R/sub/y.txt');
    expect(fromPicker.fullPath).toBe('R/sub/y.txt');
  });

  it('computes chunking info from the options', () => {
    const core = new AnyDropCore({ chunking: true, chunkSize: 4 });
    expect(core.addFile(makeFile('a', 10)).upload).toMatchObject({
      chunked: true,
      totalChunkCount: 3,
    });
    expect(core.addFile(makeFile('b', 4)).upload.chunked).toBe(false);
    core.setOption('forceChunking', true);
    expect(core.addFile(makeFile('c', 0)).upload).toMatchObject({
      chunked: true,
      totalChunkCount: 1,
    });
  });

  it('applies renameFile to upload.filename and the sent path only', () => {
    const core = new AnyDropCore({ renameFile: (f) => 'x-' + f.name });
    const f = core.addFile(makeFile('a.txt'), 'D');
    expect(f.upload.filename).toBe('x-a.txt');
    expect(f.relativePath).toBe('D/a.txt');
    expect(f.fingerprint.startsWith('D/a.txt|')).toBe(true);
    expect(sentRelativePath(f)).toBe('D/x-a.txt');
  });

  it('uses the injected id generator (tests)', () => {
    let i = 0;
    const core = new AnyDropCore({ _uuid: () => `u${++i}` });
    const f = core.addFile(makeFile('a'));
    expect([f.id, f.upload.uuid]).toEqual(['u2', 'u3']); // u1 is the batch sessionId
  });

  it('returns the same object when the same File is added twice', () => {
    const core = new AnyDropCore();
    const raw = makeFile('a');
    expect(core.addFile(raw)).toBe(core.addFile(raw));
    expect(core.files).toHaveLength(1);
  });
});

describe('batches and addedfiles (0003, 0006)', () => {
  it('merges addFile calls of the same tick into one batch', async () => {
    const core = new AnyDropCore({ persistState: false });
    const batches: string[][] = [];
    core.on('addedfiles', (files) => batches.push(files.map((f) => f.name)));
    core.addFile(makeFile('a'));
    core.addFiles([makeFile('b'), makeFile('c')]);
    await flush();
    core.addFile(makeFile('d'));
    await flush();
    expect(batches).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('fires addedfiles once after the walk, with accepted and rejected files, then queues', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png', autoProcessQueue: false });
    const log: string[] = [];
    core.on('addedfile', (f) => log.push('addedfile:' + f.relativePath));
    core.on('addedfiles', (files) => {
      log.push('addedfiles:' + files.length);
      log.push('statuses:' + files.map((f) => f.status).join(','));
    });
    const files = await drop(core, { A: { 'a.png': 1, 'b.txt': 1, S: { 'c.png': 1 } } });
    expect(log).toEqual([
      'addedfile:A/a.png',
      'addedfile:A/b.txt',
      'addedfile:A/S/c.png',
      'addedfiles:3',
      'statuses:added,error,added',
    ]);
    expect(files.map((f) => f.status)).toEqual(['queued', 'error', 'queued']);
  });

  it('emits addedfolder once per new folder, parents first, before the folder’s first file', async () => {
    const core = new AnyDropCore();
    const log: string[] = [];
    core.on('addedfolder', (n) => log.push('folder:' + n.path));
    core.on('addedfile', (f) => log.push('file:' + f.relativePath));
    await drop(core, { A: { B: { C: { 'c.txt': 1 } }, 'a.txt': 1 } });
    expect(log).toEqual([
      'folder:A',
      'file:A/a.txt',
      'folder:A/B',
      'folder:A/B/C',
      'file:A/B/C/c.txt',
    ]);
    log.length = 0;
    await drop(core, { A: { B: { 'b.txt': 1 }, N: { 'n.txt': 1 } } });
    expect(log).toEqual(['file:A/B/b.txt', 'folder:A/N', 'file:A/N/n.txt']); // A and A/B are merged
    expect(core.getFolder('A')!.counts.total).toBe(4);
    expect(core.getTree().children.map((c) => c.name)).toEqual(['A']);
  });

  it('resolves drop() with the batch files and supports several roots and loose files', async () => {
    const core = new AnyDropCore();
    const files = await drop(core, { X: { 'x.txt': 1 }, Y: { 'y.txt': 1 }, 'l.txt': 1 });
    expect(files.map((f) => f.relativePath)).toEqual(['l.txt', 'X/x.txt', 'Y/y.txt']);
    const root = core.getTree();
    expect(root.children.map((c) => c.path)).toEqual(['X', 'Y']);
    expect(root.files.map((f) => f.name)).toEqual(['l.txt']);
  });

  it('waits for async accept() before addedfiles, and ignores a second done()', async () => {
    const dones: ((e?: unknown) => void)[] = [];
    const core = new AnyDropCore({ accept: (_f, done) => dones.push(done) });
    const added = vi.fn();
    core.on('addedfiles', added);
    const p = core.addFromInput([makeFile('a'), makeFile('b')]);
    await flush();
    await flush();
    expect(dones).toHaveLength(2);
    expect(added).not.toHaveBeenCalled();
    dones[0]!();
    dones[1]!('nope');
    dones[1]!();
    const files = await p;
    expect(added).toHaveBeenCalledTimes(1);
    expect(files.map((f) => [f.accepted, f.status])).toEqual([
      [true, 'queued'],
      [false, 'error'],
    ]);
    expect(core.getErrors()[0]).toMatchObject({
      code: 'REJECTED',
      message: 'nope',
      stage: 'validate',
    });
  });

  it('treats an accept() that throws as a rejection and reports the error', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const core = new AnyDropCore({
      accept: () => {
        throw new Error('boom');
      },
    });
    const f = core.addFile(makeFile('a'));
    await flush();
    expect(f.status).toBe('error');
    expect(core.getErrors()[0]).toMatchObject({ code: 'REJECTED', message: 'boom' });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('keeps files in added with autoQueue: false until enqueueFile()', async () => {
    const core = new AnyDropCore({ autoQueue: false, autoProcessQueue: false });
    const f = core.addFile(makeFile('a'));
    await flush();
    expect(f.status).toBe('added');
    expect(core.getAddedFiles()).toEqual([f]);
    core.enqueueFiles([f]);
    expect(f.status).toBe('queued');
    expect(() => core.enqueueFile(f)).toThrow(/can't be queued/);
  });

  it('reads a large file input in slices as one batch', async () => {
    const core = new AnyDropCore();
    const added = vi.fn();
    core.on('addedfiles', added);
    const files = Array.from({ length: 1201 }, (_, i) => picked(`Big/d${i % 7}/f${i}.txt`));
    const result = await core.addFromInput({ files });
    expect(result).toHaveLength(1201);
    expect(added).toHaveBeenCalledTimes(1);
    expect(core.getFolder('Big')!.counts.total).toBe(1201);
    expect(core.getFolder('Big')!.children).toHaveLength(7);
  });
});

describe('validation results in the tree and the error list (0005, 0007)', () => {
  it('keeps rejected files in the tree, counted as error and not in bytes', async () => {
    const core = new AnyDropCore({ acceptedFiles: 'image/*' });
    await drop(core, { P: { 'a.png': 10, 'b.txt': 20 } });
    const P = core.getFolder('P')!;
    expect(P.counts).toMatchObject({ total: 2, queued: 1, error: 1 });
    expect(P.bytesTotal).toBe(10);
    expect(core.getRejectedFiles().map((f) => f.name)).toEqual(['b.txt']);
    expect(core.getAcceptedFiles().map((f) => f.name)).toEqual(['a.png']);
    const [entry] = core.getErrors();
    expect(entry).toMatchObject({
      relativePath: 'P/b.txt',
      code: 'REJECTED_TYPE',
      stage: 'validate',
      retryable: false,
      attempt: 0,
      uploadId: null,
    });
    expect(entry!.fileId).toBe(core.getRejectedFiles()[0]!.id);
  });

  it('merges errorlistchanged to one event per microtask and passes a copy', async () => {
    const core = new AnyDropCore({ maxFiles: 1 });
    const calls: number[] = [];
    core.on('errorlistchanged', (list) => {
      calls.push(list.length);
      list.pop();
    });
    core.addFiles(Array.from({ length: 50 }, (_, i) => makeFile(`f${i}`)));
    await flush();
    expect(calls).toEqual([49]);
    expect(core.getErrors()).toHaveLength(49);
    core.clearErrors();
    await flush();
    expect(calls).toEqual([49, 0]);
    expect(core.getRejectedFiles()[0]!.status).toBe('error'); // files stay in error
  });

  it('exports the error list as JSON and CSV', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png' });
    core.addFile(makeFile('a "b", c.txt'));
    await flush();
    expect(JSON.parse(core.exportErrors('json'))[0].code).toBe('REJECTED_TYPE');
    const csv = core.exportErrors('csv');
    expect(csv.split('\r\n')[0]).toBe(
      'fileId,relativePath,uploadId,code,message,httpStatus,stage,chunkIndex,attempt,retryable,at',
    );
    expect(csv).toContain('"a ""b"", c.txt"');
  });
});

describe('empty folders and foldercomplete', () => {
  it('keeps empty folders (success without a manifest) and emits emptyfolder', async () => {
    const core = new AnyDropCore();
    const empty: string[] = [];
    const complete: string[] = [];
    core.on('emptyfolder', (p) => empty.push(p));
    core.on('foldercomplete', (n) => complete.push(n.path));
    await drop(core, { R: { E: {}, H: { '.gitkeep': 1 }, N: { I: {} }, 'a.txt': 1 } });
    expect(empty.sort()).toEqual(['R/E', 'R/N/I']);
    for (const p of ['R/E', 'R/H', 'R/N', 'R/N/I'])
      expect(core.getFolder(p)!.status).toBe('success');
    expect(complete).toEqual(['R/N/I', 'R/E', 'R/H', 'R/N']); // innermost first
    expect(core.getFolder('R')!.status).toBe('queued');
  });

  it('leaves empty folders queued when a manifest will be sent', async () => {
    const core = new AnyDropCore({ sendManifest: true, manifestUrl: '/m' });
    await drop(core, { R: { E: {} } });
    expect(core.getFolder('R/E')!.status).toBe('queued');
  });

  it('drops empty folders when preserveEmptyFolders is off (emptyfolder still fires)', async () => {
    const core = new AnyDropCore({ preserveEmptyFolders: false });
    const empty = vi.fn();
    core.on('emptyfolder', empty);
    await drop(core, { R: { E: {}, 'a.txt': 1 } });
    expect(core.getFolder('R/E')).toBeUndefined();
    expect(core.getFolder('R')).toBeDefined();
    expect(empty).toHaveBeenCalledWith('R/E');
  });

  it('emits foldercomplete once, after the batch, when every file of a folder was rejected', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png' });
    const log: string[] = [];
    core.on('complete', (f) => log.push('complete:' + f.relativePath));
    core.on('foldercomplete', (n) => log.push('foldercomplete:' + n.path));
    core.on('addedfiles', () => log.push('addedfiles'));
    await drop(core, { A: { B: { 'x.txt': 1, 'y.txt': 1 }, 'ok.png': 1 } });
    expect(log).toEqual([
      'complete:A/B/x.txt',
      'complete:A/B/y.txt',
      'addedfiles',
      'foldercomplete:A/B',
    ]);
    expect(core.getFolder('A/B')!.status).toBe('error');
  });
});

describe('cancel and remove', () => {
  it('cancels a queued file: canceled, complete, foldercomplete', async () => {
    const core = new AnyDropCore();
    const [f] = await drop(core, { A: { 'a.txt': 5 } });
    const log: string[] = [];
    for (const e of ['canceled', 'complete'] as const)
      core.on(e, (x) => log.push(e + ':' + x.name));
    core.on('foldercomplete', (n) => log.push('foldercomplete:' + n.path));
    core.cancelUpload(f!);
    expect(log).toEqual(['canceled:a.txt', 'complete:a.txt', 'foldercomplete:A']);
    expect(f!.status).toBe('canceled');
    expect(core.getFolder('A')!).toMatchObject({ status: 'canceled', bytesTotal: 0 });
    core.cancelUpload(f!); // terminal: nothing happens
    expect(log).toHaveLength(3);
  });

  it('removes files, prunes folders, updates maxFiles and emits removedfile then reset', async () => {
    const core = new AnyDropCore({ maxFiles: 1 });
    const [a, b] = await drop(core, { A: { S: { 'a.txt': 1 } }, 'b.txt': 1 }).then((fs) =>
      fs.sort((x, y) => x.name.localeCompare(y.name)),
    );
    expect([a!.accepted, b!.accepted]).toEqual([false, true]); // b.txt (loose) came first
    expect(core.getErrors()).toHaveLength(1);
    const log: string[] = [];
    core.on('removedfile', (f) => log.push('removed:' + f.name));
    core.on('reset', () => log.push('reset'));
    core.on('maxfilesreached', () => log.push('maxfilesreached'));
    core.removeFile(a!);
    expect(core.getFolder('A/S')).toBeUndefined();
    expect(core.getFolder('A')).toBeUndefined();
    expect(core.getErrors()).toHaveLength(0);
    core.removeFile(b!);
    expect(log).toEqual(['removed:a.txt', 'maxfilesreached', 'removed:b.txt', 'reset']);
    expect(core.files).toHaveLength(0);
    expect(core.addFile(makeFile('c')).accepted).toBe(true); // the slot is free again
    core.removeFile(a!); // unknown: no-op
  });

  it('removeAllFiles removes everything in add order, also folders dropped empty, resets once', async () => {
    const core = new AnyDropCore();
    await drop(core, { A: { E: {}, 'a.txt': 1, 'b.txt': 1 }, 'c.txt': 1 });
    const log: string[] = [];
    core.on('removedfile', (f) => log.push(f.name));
    core.on('reset', () => log.push('reset'));
    core.removeAllFiles();
    expect(log).toEqual(['c.txt', 'a.txt', 'b.txt', 'reset']);
    expect(core.getTree().counts.total).toBe(0);
    // Clearing prunes every folder left without files, also ones dropped empty (M4 request).
    expect(core.getFolder('A/E')).toBeUndefined();
    expect(core.getFolder('A')).toBeUndefined();
  });

  it('a file removed while accept() is pending is left out of addedfiles', async () => {
    let done: (() => void) | undefined;
    const core = new AnyDropCore({ accept: (_f, d) => (done = d) });
    const f = core.addFile(makeFile('a'));
    core.removeFile(f);
    done!();
    const added = vi.fn();
    core.on('addedfiles', added);
    await flush();
    expect(added).toHaveBeenCalledWith([]);
  });
});

describe('input events', () => {
  it('drop() emits drop first; a drop without dataTransfer does nothing', async () => {
    const core = new AnyDropCore();
    const log: string[] = [];
    core.on('drop', () => log.push('drop'));
    core.on('addedfile', () => log.push('addedfile'));
    expect(await core.drop({})).toEqual([]);
    await drop(core, { 'a.txt': 1 });
    expect(log).toEqual(['drop', 'addedfile']);
  });

  it('a drop with no files still emits addedfiles([])', async () => {
    const core = new AnyDropCore();
    const added = vi.fn();
    core.on('addedfiles', added);
    await core.drop({
      dataTransfer: { items: [{ kind: 'string', getAsFile: () => null }], files: [] },
    });
    expect(added).toHaveBeenCalledWith([]);
  });

  it('paste() adds pasted files; a text-only paste adds nothing', async () => {
    const core = new AnyDropCore();
    const pastes = vi.fn();
    const added = vi.fn();
    core.on('paste', pastes);
    core.on('addedfiles', added);
    const img = makeFile('image.png', 3, 'image/png');
    const files = await core.paste({
      clipboardData: { items: [{ kind: 'file', getAsFile: () => img }] },
    });
    expect(files).toEqual([img]);
    expect(
      await core.paste({ clipboardData: { items: [{ kind: 'string', getAsFile: () => null }] } }),
    ).toEqual([]);
    expect(await core.paste({ clipboardData: null })).toEqual([]);
    expect(pastes).toHaveBeenCalledTimes(2);
    expect(added).toHaveBeenCalledTimes(1);
  });

  it('addDataTransfer() reads folders without emitting drop', async () => {
    const core = new AnyDropCore();
    const dropped = vi.fn();
    core.on('drop', dropped);
    const t = buildEntries({ F: { 'f.txt': 1 } });
    const files = await core.addDataTransfer(dataTransfer(t.roots) as never);
    expect(files[0]!.relativePath).toBe('F/f.txt');
    expect(dropped).not.toHaveBeenCalled();
  });

  it('skips dropped folders when folders is false', async () => {
    const core = new AnyDropCore({ folders: false });
    const files = await drop(core, { F: { 'f.txt': 1 }, 'g.txt': 1 });
    expect(files.map((f) => f.relativePath)).toEqual(['g.txt']);
  });
});

describe('options, events and lifecycle', () => {
  it('registers event handlers given as options, with this = the instance', async () => {
    const addedfile = vi.fn();
    const core = new AnyDropCore({ addedfile });
    core.addFile(makeFile('a'));
    expect(addedfile).toHaveBeenCalledTimes(1);
    expect(addedfile.mock.contexts[0]).toBe(core);
    const replacement = vi.fn();
    core.setOption('addedfile', replacement);
    core.addFile(makeFile('b'));
    expect(addedfile).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
    core.setOption('addedfile', null);
    core.addFile(makeFile('c'));
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it('setOption changes validation at runtime and rejects invalid combinations', () => {
    const core = new AnyDropCore();
    expect(core.addFile(makeFile('a.txt')).accepted).toBe(true);
    core.setOption('acceptedFiles', '.png');
    expect(core.getOption('acceptedFiles')).toBe('.png');
    expect(core.addFile(makeFile('b.txt')).accepted).toBe(false);
    core.setOption('chunking', true);
    expect(() => core.setOption('uploadMultiple', true)).toThrow(/uploadMultiple and chunking/);
    expect(core.options.uploadMultiple).toBe(false);
  });

  it('merges dictFileSizeUnits and keeps every instance’s options separate', () => {
    const a = new AnyDropCore({ dictFileSizeUnits: { mb: 'Mo' } as never });
    const b = new AnyDropCore();
    expect(a.options.dictFileSizeUnits).toEqual({ tb: 'TB', gb: 'GB', mb: 'Mo', kb: 'KB', b: 'b' });
    expect(b.options.dictFileSizeUnits.mb).toBe('MB');
    a.setOption('dictFileSizeUnits', { kb: 'Ko' } as never);
    expect(a.filesize(2000)).toBe('<strong>2</strong> Ko');
    expect(b.filesize(2000)).toBe('<strong>2</strong> KB');
    expect(new AnyDropCore({ maxFiles: undefined }).options.maxFiles).toBeNull();
  });

  it('on() returns an unsubscribe function; once() and off() work', () => {
    const core = new AnyDropCore();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const off = core.on('reset', a);
    core.once('reset', b);
    core.on('reset', c);
    core.emit('reset');
    off();
    core.emit('reset');
    expect([a.mock.calls.length, b.mock.calls.length, c.mock.calls.length]).toEqual([1, 1, 2]);
    core.off('reset');
    core.emit('reset');
    expect(c).toHaveBeenCalledTimes(2);
    expect(core.hasListeners('reset')).toBe(false);
  });

  it('a throwing listener does not stop the others or the engine', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const core = new AnyDropCore();
    core.on('addedfile', () => {
      throw new Error('listener bug');
    });
    const second = vi.fn();
    core.on('addedfile', second);
    const files = await drop(core, { A: { 'a.txt': 1 } });
    expect(files).toHaveLength(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener bug' }));
  });

  it('destroy() removes listeners and timers, ends walks, and blocks further use', async () => {
    vi.useFakeTimers();
    const core = new AnyDropCore({ autoQueue: false, persistState: false });
    const f = core.addFile(makeFile('a'));
    for (let i = 0; i < 5; i++) await Promise.resolve(); // the batch closes
    const spy = vi.spyOn(core, 'processQueue');
    core.enqueueFile(f); // schedules processQueue on a timer
    const listener = vi.fn();
    core.on('addedfile', listener);
    const pending = drop(core, { A: { 'a.txt': 1 } });
    core.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
    expect(await pending).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(0);
    expect(core.isDestroyed).toBe(true);
    expect(core.files).toHaveLength(0);
    expect(() => core.addFile(makeFile('b'))).toThrow(/destroyed/);
    expect(await core.drop({ dataTransfer: { files: [makeFile('c')] } })).toEqual([]);
    core.destroy(); // twice is fine
  });

  it('getters return the files by status', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png', autoQueue: false });
    const [a, b] = core.addFiles([makeFile('a.png'), makeFile('b.txt')]);
    await flush();
    expect(core.getAddedFiles()).toEqual([a]);
    expect(core.getFilesWithStatus('error')).toEqual([b]);
    core.enqueueFile(a!);
    expect(core.getQueuedFiles()).toEqual([a]);
    expect(core.getActiveFiles()).toEqual([a]);
    expect(core.getUploadingFiles()).toEqual([]);
    expect(core.getPausedFiles()).toEqual([]);
    expect(core.getFile(a!.id)).toBe(a);
    expect(core.getFile('nope')).toBeUndefined();
    const root: FolderNode = core.getTree();
    expect(root.path).toBe('');
    expect(root.files as AnyDropFile[]).toEqual([a, b]);
  });

  it('processQueue is a safe no-op until M2', () => {
    const core = new AnyDropCore();
    expect(() => core.processQueue()).not.toThrow();
  });
});

// Compile-time only: real DOM events and inputs are accepted by the input methods.
export function _typecheckDomInputs(
  core: AnyDropCore,
  drag: DragEvent,
  clip: ClipboardEvent,
  input: HTMLInputElement,
): void {
  void core.drop(drag);
  void core.paste(clip);
  void core.addFromInput(input);
  if (input.files) void core.addFromInput(input.files);
  if (drag.dataTransfer) void core.addDataTransfer(drag.dataTransfer);
}
