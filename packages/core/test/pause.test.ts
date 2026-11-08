// Pause and resume (M3, decision 0008): three levels, both pauseModes, chunk accounting, slot
// release, user flags versus later adds, and cancelFolder.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyDropFile, PauseTarget } from '../src/index';
import { bytesFile, mk, openUploads, sentChunks } from './helpers/m3';
import { okAll, settle } from './helpers/transport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NO_PERSIST = { persistState: false };

function events(core: ReturnType<typeof mk>['core']) {
  const log: string[] = [];
  const tag = (t: PauseTarget) =>
    t.scope === 'all'
      ? `all:${t.reason}`
      : t.scope === 'folder'
        ? `folder:${t.folder.path}`
        : `file:${t.file.relativePath}`;
  core.on('paused', (t) => log.push('paused ' + tag(t)));
  core.on('resumed', (t) => log.push('resumed ' + tag(t)));
  return log;
}

describe('pause() / resume() (instance)', () => {
  it("'abort' aborts in-flight chunks, which are not counted and are sent again; done chunks are not", async () => {
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1 }, null);
    const log = events(core);
    const a = core.addFile(bytesFile('a.bin', 40), 'X');
    const b = core.addFile(bytesFile('b.bin', 40), 'X');
    await settle();
    openUploads(t)[0]!.reply(); // chunk 0 of a
    await settle();
    expect(openUploads(t).map((c) => c.field('adChunkIndex'))).toEqual(['1']);
    const inFlight = openUploads(t)[0]!;
    inFlight.progress(5, 10);
    expect(a.upload.bytesSent).toBe(15);

    core.pause();
    expect(inFlight.aborted).toBe(true);
    expect(a.status).toBe('paused');
    expect(b.status).toBe('paused');
    expect(a.upload.bytesSent).toBe(10); // the aborted chunk no longer counts
    expect([...a.upload.chunksDone]).toEqual([0]);
    expect(core.getUploadingFiles()).toEqual([]);
    expect(core.getPausedFiles()).toEqual([a, b]);
    expect(core.getTree().status).toBe('paused');
    expect(core.getFolder('X')!.status).toBe('paused');
    await settle();
    expect(openUploads(t)).toHaveLength(0);
    expect(log).toEqual(['paused all:user']);

    const done = new Promise<void>((r) => core.on('queuecomplete', () => r()));
    core.resume();
    expect(log).toEqual(['paused all:user', 'resumed all:user']);
    // Answer everything from now on.
    const answer = async () => {
      for (let i = 0; i < 50 && core.getActiveFiles().length; i++) {
        t.calls.filter((c) => !c.done).forEach((c) => okAll(c));
        await settle(1);
      }
    };
    await answer();
    await done;
    expect(sentChunks(t, a.upload.uuid)).toEqual([0, 1, 1, 2, 3]);
    expect(sentChunks(t, b.upload.uuid)).toEqual([0, 1, 2, 3]);
    expect(a.status).toBe('success');
  });

  it("'finishChunk' lets the in-flight chunk finish and count, starts nothing new, then frees the slot", async () => {
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1, pauseMode: 'finishChunk' }, null);
    const a = core.addFile(bytesFile('a.bin', 40));
    const b = core.addFile(bytesFile('b.bin', 40));
    await settle();
    const c0 = openUploads(t)[0]!;
    core.pauseFile(a);
    expect(c0.aborted).toBe(false);
    expect(a.status).toBe('paused');
    // The slot is still held by a's chunk in flight: b does not start yet.
    await settle();
    expect(openUploads(t)).toEqual([c0]);
    c0.reply();
    await settle();
    expect([...a.upload.chunksDone]).toEqual([0]);
    expect(a.upload.bytesSent).toBe(10);
    // a gave up its slot once nothing of it was in flight; b took it.
    expect(openUploads(t).map((c) => c.field('adUploadId'))).toEqual([b.upload.uuid]);
    expect(sentChunks(t, a.upload.uuid)).toEqual([0]);
  });

  it("'finishChunk' on a non-chunked file lets the whole file finish", async () => {
    const { core, t } = mk({ ...NO_PERSIST, chunking: false, pauseMode: 'finishChunk' }, null);
    const a = core.addFile(bytesFile('a.bin', 5));
    await settle();
    core.pause();
    expect(a.status).toBe('paused');
    openUploads(t)[0]!.reply();
    await settle();
    expect(a.status).toBe('success');
  });

  it('files added while the instance is paused arrive paused; queued files wait', async () => {
    const { core, t } = mk(NO_PERSIST);
    core.pause();
    const a = core.addFile(bytesFile('a.bin', 5));
    await settle();
    expect(a.status).toBe('paused');
    expect(t.uploads()).toHaveLength(0);
    core.resume();
    await settle();
    expect(a.status).toBe('success');
  });

  it('a paused file keeps its place in the add order (resumed files are picked first)', async () => {
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1, chunking: false }, null);
    const files = ['a', 'b', 'c'].map((n) => core.addFile(bytesFile(n, 3)));
    await settle();
    core.pauseFile(files[0]!); // aborted, slot goes to b
    await settle();
    expect(openUploads(t).map((c) => c.field('adRelativePath'))).toEqual(['b']);
    core.resumeFile(files[0]!);
    openUploads(t)[0]!.reply(); // b done: a (older) goes before c
    await settle();
    expect(openUploads(t).map((c) => c.field('adRelativePath'))).toEqual(['a']);
  });
});

describe('pauseFolder() / resumeFolder()', () => {
  it('pauses only that subtree, frees the slot for other files, and folder rows show paused', async () => {
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1 }, null);
    const log = events(core);
    const x = core.addFile(bytesFile('x.bin', 20), 'P/Q');
    const y = core.addFile(bytesFile('y.bin', 20), 'R');
    await settle();
    expect(openUploads(t)[0]!.field('adUploadId')).toBe(x.upload.uuid);
    core.pauseFolder('P');
    expect(core.getFolder('P')!.userPaused).toBe(true);
    expect(core.getFolder('P/Q')!.status).toBe('paused');
    expect(core.getFolder('P/Q')!.userPaused).toBe(false);
    expect(x.status).toBe('paused');
    await settle();
    expect(openUploads(t).map((c) => c.field('adUploadId'))).toEqual([y.upload.uuid]);

    // resumeFile does not override the paused folder above it.
    core.resumeFile(x);
    expect(x.status).toBe('paused');
    // A file added later to the paused folder arrives paused.
    const z = core.addFile(bytesFile('z.bin', 5), 'P/Q');
    await settle();
    expect(z.status).toBe('paused');

    core.resumeFolder('P');
    expect(x.status).toBe('queued');
    expect(z.status).toBe('queued');
    expect(log).toEqual(['paused folder:P', 'resumed file:P/Q/x.bin', 'resumed folder:P']);
    core.pauseFolder('nope'); // unknown paths are ignored
    expect(log).toHaveLength(3);
  });

  it('a user pause survives offline/online; resume() clears every reason', async () => {
    const { core } = mk(NO_PERSIST, null);
    const log = events(core);
    const a = core.addFile(bytesFile('a.bin', 20));
    await settle();
    core.pause();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(a.status).toBe('paused');
    expect(log).toEqual(['paused all:user', 'paused all:offline', 'resumed all:offline']);
    window.dispatchEvent(new Event('offline'));
    core.resume();
    expect(a.status).not.toBe('paused');
    core.destroy();
  });
});

describe('pauseFile() / resumeFile()', () => {
  it('accepts the file or its id; one event per call; unknown ids are ignored', async () => {
    const { core } = mk(NO_PERSIST, null);
    const log = events(core);
    const a = core.addFile(bytesFile('a.bin', 20));
    await settle();
    core.pauseFile(a.id);
    expect(a.status).toBe('paused');
    core.resumeFile(a);
    expect(a.status).not.toBe('paused');
    core.pauseFile('nope');
    expect(log).toEqual(['paused file:a.bin', 'resumed file:a.bin']);
  });

  it('removing the last paused file of a run ends it with queuecomplete (0013)', async () => {
    const { core } = mk(NO_PERSIST, null);
    const a = core.addFile(bytesFile('a.bin', 20));
    await settle();
    core.pauseFile(a);
    const qc = vi.fn();
    core.on('queuecomplete', qc);
    core.removeFile(a);
    await settle();
    expect(qc).toHaveBeenCalledTimes(1);
  });
});

describe('cancelFolder() (0008)', () => {
  it('cancels every unfinished file under the folder, then foldercomplete; others continue', async () => {
    const { core, t } = mk({ ...NO_PERSIST, parallelUploads: 1 }, null);
    const a = core.addFile(bytesFile('a.bin', 20), 'A');
    const b = core.addFile(bytesFile('b.bin', 20), 'A/S');
    const c = core.addFile(bytesFile('c.bin', 20), 'C');
    await settle();
    const log: string[] = [];
    for (const name of ['canceled', 'complete', 'foldercomplete', 'error'] as const) {
      core.on(name as 'complete', (...args: unknown[]) => {
        const x = args[0] as AnyDropFile | { path: string };
        log.push(`${name}:${'relativePath' in x ? x.relativePath : x.path}`);
      });
    }
    const inFlight = openUploads(t)[0]!;
    core.cancelFolder('A');
    expect(inFlight.aborted).toBe(true);
    // The freed slot goes straight to c.
    expect([a.status, b.status, c.status]).toEqual(['canceled', 'canceled', 'uploading']);
    expect(log).toEqual([
      'canceled:A/a.bin',
      'complete:A/a.bin',
      'canceled:A/S/b.bin',
      'complete:A/S/b.bin',
      'foldercomplete:A/S',
      'foldercomplete:A',
    ]);
    expect(core.getFolder('A')!.status).toBe('canceled');
    expect(core.getFolder('A')!.files).toEqual([a]); // rows are kept
  });
});
