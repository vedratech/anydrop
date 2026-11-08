// What happens to files when they are added: the accept chain (size, type, count, accept()),
// the events and statuses it produces, folder drops, defaults and constants. The expected
// values are fixed; the matcher itself is specified in accept.test.ts.
import { describe, expect, it } from 'vitest';
import { AnyDropCore, defaultOptions, type AnyDropCoreConfig } from '../src/index';
import { buildEntries, dataTransfer, type Spec } from './helpers/entries';

type FileSpec = { name: string; size: number; type: string };

const MiB = 1024 * 1024;
const mk = (s: FileSpec) => new File([new Uint8Array(s.size)], s.name, { type: s.type });
const tick = () => new Promise((r) => setTimeout(r, 0));
const EVENTS = ['addedfile', 'error', 'complete', 'maxfilesexceeded', 'maxfilesreached'] as const;

/** Records the per-file validation events of an emitter in order. */
function record(target: { on: (e: string, fn: (...a: unknown[]) => void) => unknown }): string[] {
  const log: string[] = [];
  for (const e of EVENTS) {
    target.on(e, (...args: unknown[]) => {
      const first = args[0] as { name?: string } | unknown[];
      if (e === 'maxfilesreached') log.push(`${e}:${(first as unknown[]).length}`);
      else if (e === 'error')
        log.push(`${e}:${(first as { name: string }).name}:${String(args[1])}`);
      else log.push(`${e}:${(first as { name: string }).name}`);
    });
  }
  return log;
}

async function run(files: FileSpec[], options: Record<string, unknown>) {
  // No resume lookup (IndexedDB timing must not matter), and wait for `addedfiles`: the
  // statuses are final only after the batch closed.
  const core = new AnyDropCore({
    url: '/upload',
    autoProcessQueue: false,
    persistState: false,
    ...options,
  } as AnyDropCoreConfig);
  const log = record(core as never);
  const closed = new Promise<void>((resolve) => core.once('addedfiles', () => resolve()));
  const added = core.addFiles(files.map(mk));
  await closed;
  await tick();
  await tick();
  await new Promise((r) => setTimeout(r, 30)); // async accept() callbacks
  const state = added.map((f) => {
    const x = f as unknown as { name: string; accepted?: boolean; status: string };
    return `${x.name}:${String(x.accepted)}:${x.status}`;
  });
  return { log, state, core };
}

const txt = (name: string): FileSpec => ({ name, size: 1, type: 'text/plain' });
const png = (name: string): FileSpec => ({ name, size: 1, type: 'image/png' });

describe('accept chain: events, statuses and errors', () => {
  it('maxFilesize: the limit itself passes, the message has the size in MiB', async () => {
    const r = await run(
      [
        { name: 'exact.bin', size: MiB, type: '' },
        { name: 'over.bin', size: MiB + 1, type: '' },
        { name: 'big.bin', size: 3 * MiB + 12345, type: '' },
      ],
      { maxFilesize: 1 },
    );
    expect(r.log).toEqual([
      'addedfile:exact.bin',
      'addedfile:over.bin',
      'error:over.bin:File is too big (1MiB). Max filesize: 1MiB.',
      'complete:over.bin',
      'addedfile:big.bin',
      'error:big.bin:File is too big (3.01MiB). Max filesize: 1MiB.',
      'complete:big.bin',
    ]);
    expect(r.state).toEqual([
      'exact.bin:true:queued',
      'over.bin:false:error',
      'big.bin:false:error',
    ]);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code])).toEqual([
      ['over.bin', 'REJECTED_SIZE'],
      ['big.bin', 'REJECTED_SIZE'],
    ]);
  });

  it('maxFilesize 0 disables the check', async () => {
    const r = await run([{ name: 'big.bin', size: 2 * MiB, type: '' }], { maxFilesize: 0 });
    expect(r.log).toEqual(['addedfile:big.bin']);
    expect(r.state).toEqual(['big.bin:true:queued']);
  });

  it('acceptedFiles: a rejected type gets dictInvalidFileType', async () => {
    const r = await run(
      [png('a.png'), txt('b.txt'), { name: 'c.pdf', size: 1, type: 'application/pdf' }],
      { acceptedFiles: 'image/*,.pdf', dictInvalidFileType: 'Nope.' },
    );
    expect(r.log).toEqual([
      'addedfile:a.png',
      'addedfile:b.txt',
      'error:b.txt:Nope.',
      'complete:b.txt',
      'addedfile:c.pdf',
    ]);
    expect(r.state).toEqual(['a.png:true:queued', 'b.txt:false:error', 'c.pdf:true:queued']);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code, e.message])).toEqual([
      ['b.txt', 'REJECTED_TYPE', 'Nope.'],
    ]);
  });

  it('maxFiles: extra files are rejected, maxfilesreached repeats, then maxfilesexceeded', async () => {
    const r = await run(
      ['1', '2', '3', '4'].map((n) => txt(`${n}.txt`)),
      {
        maxFiles: 2,
        dictMaxFilesExceeded: 'Max {{maxFiles}} files.',
      },
    );
    expect(r.log).toEqual([
      'addedfile:1.txt',
      'addedfile:2.txt',
      'maxfilesreached:2',
      'addedfile:3.txt',
      'error:3.txt:Max 2 files.',
      'complete:3.txt',
      'maxfilesreached:3',
      'maxfilesexceeded:3.txt',
      'addedfile:4.txt',
      'error:4.txt:Max 2 files.',
      'complete:4.txt',
      'maxfilesreached:4',
      'maxfilesexceeded:4.txt',
    ]);
    expect(r.state).toEqual([
      '1.txt:true:queued',
      '2.txt:true:queued',
      '3.txt:false:error',
      '4.txt:false:error',
    ]);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code])).toEqual([
      ['3.txt', 'MAX_FILES'],
      ['4.txt', 'MAX_FILES'],
    ]);
  });

  it('maxFiles: files rejected for their type do not count', async () => {
    const r = await run([png('a.png'), txt('b.txt'), png('c.png'), png('d.png')], {
      maxFiles: 2,
      acceptedFiles: 'image/*',
    });
    expect(r.log).toEqual([
      'addedfile:a.png',
      'addedfile:b.txt',
      "error:b.txt:You can't upload files of this type.",
      'complete:b.txt',
      'addedfile:c.png',
      'maxfilesreached:3',
      'addedfile:d.png',
      'error:d.png:You cannot upload any more files.',
      'complete:d.png',
      'maxfilesreached:4',
      'maxfilesexceeded:d.png',
    ]);
    expect(r.state).toEqual([
      'a.png:true:queued',
      'b.txt:false:error',
      'c.png:true:queued',
      'd.png:false:error',
    ]);
  });

  it('checks size before type, and type before the count', async () => {
    const r = await run(
      [{ name: 'big.txt', size: MiB + 1, type: 'text/plain' }, png('ok.png'), png('more.png')],
      { maxFilesize: 1, acceptedFiles: 'image/*', maxFiles: 1 },
    );
    expect(r.log).toEqual([
      'addedfile:big.txt',
      'error:big.txt:File is too big (1MiB). Max filesize: 1MiB.',
      'complete:big.txt',
      'addedfile:ok.png',
      'maxfilesreached:2',
      'addedfile:more.png',
      'error:more.png:You cannot upload any more files.',
      'complete:more.png',
      'maxfilesreached:3',
      'maxfilesexceeded:more.png',
    ]);
    expect(r.state).toEqual(['big.txt:false:error', 'ok.png:true:queued', 'more.png:false:error']);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code, e.stage, e.retryable])).toEqual([
      ['big.txt', 'REJECTED_SIZE', 'validate', false],
      ['more.png', 'MAX_FILES', 'validate', false],
    ]);
  });

  it('a user accept() can reject synchronously with any message', async () => {
    const r = await run([txt('keep.txt'), txt('drop.txt')], {
      accept(file: File, done: (e?: unknown) => void) {
        if (file.name.startsWith('drop')) done('Not allowed');
        else done();
      },
    });
    expect(r.log).toEqual([
      'addedfile:keep.txt',
      'addedfile:drop.txt',
      'error:drop.txt:Not allowed',
      'complete:drop.txt',
    ]);
    expect(r.state).toEqual(['keep.txt:true:queued', 'drop.txt:false:error']);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code, e.message])).toEqual([
      ['drop.txt', 'REJECTED', 'Not allowed'],
    ]);
  });

  it('with an async accept(), maxFiles only counts the files accepted so far', async () => {
    const r = await run(
      ['1', '2', '3'].map((n) => txt(`${n}.txt`)),
      {
        maxFiles: 1,
        accept(_file: File, done: (e?: unknown) => void) {
          setTimeout(() => done(), 5);
        },
      },
    );
    expect(r.log).toEqual([
      'addedfile:1.txt',
      'addedfile:2.txt',
      'addedfile:3.txt',
      'maxfilesreached:3',
    ]);
    expect(r.state).toEqual(['1.txt:true:queued', '2.txt:true:queued', '3.txt:true:queued']);
  });

  it('maxFiles 0 rejects everything', async () => {
    const r = await run([txt('a.txt')], { maxFiles: 0 });
    expect(r.log).toEqual([
      'addedfile:a.txt',
      'error:a.txt:You cannot upload any more files.',
      'complete:a.txt',
      'maxfilesreached:1',
      'maxfilesexceeded:a.txt',
    ]);
    expect(r.state).toEqual(['a.txt:false:error']);
  });
});

describe('folder drop', () => {
  const spec: Spec = {
    Photos: {
      '2024': { 'a.png': 1, 'b.png': 1, '.DS_Store': 1 },
      empty: {},
      onlyHidden: { '.gitkeep': 1 },
      '.git': { config: 1, refs: {} },
      'c.png': 1,
    },
    Docs: { deep: { deeper: { 'd.txt': 1 } } },
    'loose.txt': 1,
    '.hidden-loose': 1,
  };
  const big: Spec = { Big: {} };
  for (let i = 0; i < 230; i++) (big.Big as Spec)[`f${i}.txt`] = 1;

  async function dropOf(s: Spec, options: Record<string, unknown> = {}) {
    const tree = buildEntries(s);
    const core = new AnyDropCore({ url: '/upload', autoProcessQueue: false, ...options });
    const empty: string[] = [];
    core.on('emptyfolder', (p) => empty.push(p));
    let addedfiles: File[] = [];
    core.on('addedfiles', (f) => (addedfiles = f));
    const files = await core.drop({ dataTransfer: dataTransfer(tree.roots) as never });
    const key = (f: { name: string; fullPath?: string }) => f.fullPath ?? f.name;
    return {
      core,
      files: files.map(key).sort(),
      all: core.files.map(key).sort(),
      empty: empty.sort(),
      addedfiles: addedfiles.map(key).sort(),
    };
  }

  const expected = [
    '.hidden-loose',
    'Docs/deep/deeper/d.txt',
    'Photos/.git/config',
    'Photos/2024/a.png',
    'Photos/2024/b.png',
    'Photos/c.png',
    'loose.txt',
  ];

  it('adds the files with their folder paths and emits emptyfolder for empty directories', async () => {
    const r = await dropOf(spec);
    expect(r.all).toEqual(expected);
    expect(r.files).toEqual(expected);
    expect(r.addedfiles).toEqual(expected);
    expect(r.empty).toEqual(['Photos/.git/refs', 'Photos/empty']); // onlyHidden held entries
  });

  it('walks hidden folders and keeps loose hidden files', async () => {
    const r = await dropOf(spec);
    expect(r.all).toContain('Photos/.git/config');
    expect(r.all).toContain('.hidden-loose');
    expect(r.all).not.toContain('Photos/2024/.DS_Store');
  });

  it('keeps hidden files in folders with ignoreHiddenFiles off, and reads directories with more than 100 entries', async () => {
    const r = await dropOf({ ...spec, ...big }, { ignoreHiddenFiles: false });
    expect(r.all.filter((p) => p.startsWith('Big/'))).toHaveLength(230);
    expect(r.all.filter((p) => !p.startsWith('Big/'))).toEqual([
      '.hidden-loose',
      'Docs/deep/deeper/d.txt',
      'Photos/.git/config',
      'Photos/2024/.DS_Store',
      'Photos/2024/a.png',
      'Photos/2024/b.png',
      'Photos/c.png',
      'Photos/onlyHidden/.gitkeep',
      'loose.txt',
    ]);
    expect(r.empty).toEqual(['Photos/.git/refs', 'Photos/empty']);
  });

  it('loose files have no fullPath, files from a folder do', async () => {
    const r = await dropOf(spec);
    const loose = r.core.files.find((f) => f.name === 'loose.txt')!;
    expect(loose.fullPath).toBeUndefined();
    expect('fullPath' in loose).toBe(false);
    const inFolder = r.core.files.find((f) => f.name === 'd.txt')!;
    expect(inFolder.fullPath).toBe('Docs/deep/deeper/d.txt');
  });
});

describe('defaults, constants and option checks', () => {
  it('has these defaults for the shared options', () => {
    expect(defaultOptions()).toMatchObject({
      method: 'post',
      withCredentials: false,
      timeout: null,
      headers: null,
      defaultHeaders: true,
      paramName: 'file',
      uploadMultiple: false,
      binaryBody: false,
      parallelUploads: 2,
      chunking: false,
      forceChunking: false,
      chunkSize: 2 * MiB,
      parallelChunkUploads: false,
      retryChunks: true,
      maxFilesize: 256,
      filesizeBase: 1000,
      maxFiles: null,
      acceptedFiles: null,
      ignoreHiddenFiles: true,
      autoProcessQueue: true,
      autoQueue: true,
      dictFileTooBig: 'File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.',
      dictInvalidFileType: "You can't upload files of this type.",
      dictResponseError: 'Server responded with {{statusCode}} code.',
      dictUploadCanceled: 'Upload canceled.',
      dictMaxFilesExceeded: 'You cannot upload any more files.',
      dictFileSizeUnits: { tb: 'TB', gb: 'GB', mb: 'MB', kb: 'KB', b: 'b' },
    });
  });

  it('upper-cases a string method at construction', () => {
    expect(new AnyDropCore().options.method).toBe('POST');
    expect(new AnyDropCore({ method: 'put' }).options.method).toBe('PUT');
  });

  it('has the status constants', () => {
    expect([
      AnyDropCore.ADDED,
      AnyDropCore.QUEUED,
      AnyDropCore.ACCEPTED,
      AnyDropCore.UPLOADING,
      AnyDropCore.PROCESSING,
      AnyDropCore.CANCELED,
      AnyDropCore.ERROR,
      AnyDropCore.SUCCESS,
      AnyDropCore.PAUSED,
    ]).toEqual([
      'added',
      'queued',
      'queued',
      'uploading',
      'uploading',
      'canceled',
      'error',
      'success',
      'paused',
    ]);
  });

  it('formats sizes with filesizeBase and the unit labels', () => {
    const sizes = [0, 1, 99, 100, 999, 1234, 99_999, 1_500_000, 2.5e9, 7.25e12, -5];
    const base1000 = new AnyDropCore({ filesizeBase: 1000 });
    expect(sizes.map((s) => base1000.filesize(s))).toEqual([
      '<strong>0</strong> b',
      '<strong>1</strong> b',
      '<strong>99</strong> b',
      '<strong>0.1</strong> KB',
      '<strong>1</strong> KB',
      '<strong>1.2</strong> KB',
      '<strong>100</strong> KB',
      '<strong>1.5</strong> MB',
      '<strong>2.5</strong> GB',
      '<strong>7.3</strong> TB',
      '<strong>0</strong> b',
    ]);
    const base1024 = new AnyDropCore({ filesizeBase: 1024 });
    expect(sizes.map((s) => base1024.filesize(s))).toEqual([
      '<strong>0</strong> b',
      '<strong>1</strong> b',
      '<strong>99</strong> b',
      '<strong>100</strong> b',
      '<strong>1</strong> KB',
      '<strong>1.2</strong> KB',
      '<strong>97.7</strong> KB',
      '<strong>1.4</strong> MB',
      '<strong>2.3</strong> GB',
      '<strong>6.6</strong> TB',
      '<strong>0</strong> b',
    ]);
    const french = new AnyDropCore({ dictFileSizeUnits: { mb: 'Mo' } as never });
    expect(french.filesize(1_500_000)).toBe('<strong>1.5</strong> Mo');
    expect(french.filesize(1_500)).toBe('<strong>1.5</strong> KB'); // the other labels stay
  });

  it('throws for uploadMultiple with chunking, and for binaryBody with uploadMultiple', () => {
    expect(() => new AnyDropCore({ uploadMultiple: true, chunking: true })).toThrow(
      'You cannot set both: uploadMultiple and chunking.',
    );
    expect(() => new AnyDropCore({ uploadMultiple: true, binaryBody: true })).toThrow(
      'You cannot set both: binaryBody and uploadMultiple.',
    );
  });

  it('enqueueFile throws for a file that was rejected', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png', autoQueue: false });
    const f = core.addFile(new File(['x'], 'a.txt'));
    await new Promise((r) => setTimeout(r, 0)); // the batch closes on a microtask
    expect(() => core.enqueueFile(f)).toThrow(
      "This file can't be queued because it has already been processed or was rejected.",
    );
  });
});
