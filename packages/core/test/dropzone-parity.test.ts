// Differential tests: the same inputs go through the real Dropzone 6.3.5 (devDependency) and
// through AnyDropCore, and the observable results must match. Intentional differences
// (dropzone-parity skill) are asserted separately.
import Dropzone from 'dropzone';
import { describe, expect, it } from 'vitest';
import { AnyDropCore, defaultOptions, isValidFile, type AnyDropCoreConfig } from '../src/index';
import { filesize } from '../src/validate/dropzone-port';
import { mimeFromName } from '../src/validate/mime';
import { buildEntries, dataTransfer, type Spec } from './helpers/entries';

type DzFile = Parameters<Dropzone['addFile']>[0];
type FileSpec = { name: string; size: number; type: string };

function newDropzone(options: Record<string, unknown> = {}): Dropzone {
  return new Dropzone(document.createElement('div'), {
    url: '/upload',
    autoProcessQueue: false,
    previewsContainer: false,
    createImageThumbnails: false,
    ...options,
  } as never);
}

const mk = (s: FileSpec) => new File([new Uint8Array(s.size)], s.name, { type: s.type });
const tick = () => new Promise((r) => setTimeout(r, 0));
const EVENTS = ['addedfile', 'error', 'complete', 'maxfilesexceeded', 'maxfilesreached'] as const;

/** Records the per-file validation events of an emitter in order. */
function record(target: { on: (e: string, fn: (...a: unknown[]) => void) => unknown }): string[] {
  const log: string[] = [];
  for (const e of EVENTS) {
    target.on(e, (...args: unknown[]) => {
      const a = args[0] as { name?: string } | unknown[];
      if (e === 'maxfilesreached') log.push(`${e}:${(a as unknown[]).length}`);
      else if (e === 'error') log.push(`${e}:${(a as { name: string }).name}:${String(args[1])}`);
      else log.push(`${e}:${(a as { name: string }).name}`);
    });
  }
  return log;
}

async function runBoth(files: FileSpec[], options: Record<string, unknown>) {
  const dz = newDropzone(options);
  const dzLog = record(dz as never);
  const dzFiles = files.map(mk);
  for (const f of dzFiles) dz.addFile(f as DzFile);

  // No resume lookup (IndexedDB timing must not matter), and wait for `addedfiles`: the statuses
  // are final only after the batch closed.
  const core = new AnyDropCore({
    url: '/upload',
    autoProcessQueue: false,
    persistState: false,
    ...options,
  } as AnyDropCoreConfig);
  const coreLog = record(core as never);
  const closed = new Promise<void>((resolve) => core.once('addedfiles', () => resolve()));
  const coreFiles = core.addFiles(files.map(mk));
  await closed;

  await tick();
  await tick();
  await new Promise((r) => setTimeout(r, 30)); // async accept() callbacks
  const state = (fs: File[]) =>
    fs.map((f) => {
      const x = f as unknown as { name: string; accepted?: boolean; status: string };
      return `${x.name}:${String(x.accepted)}:${x.status}`;
    });
  return { dzLog, coreLog, dzState: state(dzFiles), coreState: state(coreFiles), core };
}

describe('Dropzone parity: isValidFile', () => {
  const names = [
    'a.png',
    'A.PNG',
    'photo.jpeg',
    'doc.pdf',
    'x',
    '.png',
    'a.tar.gz',
    'IMG_1.HEIC',
    'v.mov',
    'png',
  ];
  const types = [
    'image/png',
    'image/jpeg',
    'application/pdf',
    'text/plain',
    'image/heic',
    'video/quicktime',
    'Image/PNG',
  ];
  const accepted = [
    null,
    '',
    'image/*',
    'image/png',
    '.png',
    '.PNG,.pdf',
    ' image/* , application/pdf ',
    'video/*,.gz',
    '.tar.gz',
    'image/heic',
    'text/*',
    '*/*',
    'image',
  ];

  it('matches Dropzone for every file with a MIME type', () => {
    for (const name of names)
      for (const type of types)
        for (const acc of accepted) {
          const f = { name, type };
          expect([name, type, acc, isValidFile(f, acc)]).toEqual([
            name,
            type,
            acc,
            Dropzone.isValidFile(f as never, acc),
          ]);
        }
  });

  it('for an empty MIME type, behaves like Dropzone given the type guessed from the extension', () => {
    for (const name of names)
      for (const acc of accepted) {
        const guessed = { name, type: mimeFromName(name) };
        expect([name, acc, isValidFile({ name, type: '' }, acc)]).toEqual([
          name,
          acc,
          Dropzone.isValidFile(guessed as never, acc),
        ]);
      }
  });

  it('accepts an iOS HEIC photo with an empty type for image/* (intentional difference)', () => {
    const heic = { name: 'IMG_0001.HEIC', type: '' };
    expect(Dropzone.isValidFile(heic as never, 'image/*')).toBe(false);
    expect(isValidFile(heic, 'image/*')).toBe(true);
    expect(isValidFile({ name: 'scan.heif', type: '' }, 'image/heif')).toBe(true);
    expect(isValidFile({ name: 'unknown.xyz', type: '' }, 'image/*')).toBe(false);
  });

  it('accepts an array of types like Dropzone', () => {
    const f = { name: 'a.png', type: 'image/png' };
    expect(isValidFile(f, ['.jpg', 'image/*'])).toBe(
      Dropzone.isValidFile(f as never, ['.jpg', 'image/*']),
    );
  });
});

describe('Dropzone parity: accept chain (size, type, maxFiles, accept())', () => {
  const MiB = 1024 * 1024;
  const cases: { title: string; files: FileSpec[]; options: Record<string, unknown> }[] = [
    {
      title: 'maxFilesize boundary and message',
      files: [
        { name: 'exact.bin', size: MiB, type: '' },
        { name: 'over.bin', size: MiB + 1, type: '' },
        { name: 'big.bin', size: 3 * MiB + 12345, type: '' },
      ],
      options: { maxFilesize: 1 },
    },
    {
      title: 'maxFilesize null and 0 disable the check',
      files: [{ name: 'big.bin', size: 2 * MiB, type: '' }],
      options: { maxFilesize: 0 },
    },
    {
      title: 'acceptedFiles',
      files: [
        { name: 'a.png', size: 1, type: 'image/png' },
        { name: 'b.txt', size: 1, type: 'text/plain' },
        { name: 'c.pdf', size: 1, type: 'application/pdf' },
      ],
      options: { acceptedFiles: 'image/*,.pdf', dictInvalidFileType: 'Nope.' },
    },
    {
      title: 'maxFiles: events and order, maxfilesreached repeats',
      files: ['1', '2', '3', '4'].map((n) => ({ name: `${n}.txt`, size: 1, type: 'text/plain' })),
      options: { maxFiles: 2, dictMaxFilesExceeded: 'Max {{maxFiles}} files.' },
    },
    {
      title: 'maxFiles with rejected types in between (rejected files do not count)',
      files: [
        { name: 'a.png', size: 1, type: 'image/png' },
        { name: 'b.txt', size: 1, type: 'text/plain' },
        { name: 'c.png', size: 1, type: 'image/png' },
        { name: 'd.png', size: 1, type: 'image/png' },
      ],
      options: { maxFiles: 2, acceptedFiles: 'image/*' },
    },
    {
      title: 'size is checked before type, type before maxFiles',
      files: [
        { name: 'big.txt', size: MiB + 1, type: 'text/plain' },
        { name: 'ok.png', size: 1, type: 'image/png' },
        { name: 'more.png', size: 1, type: 'image/png' },
      ],
      options: { maxFilesize: 1, acceptedFiles: 'image/*', maxFiles: 1 },
    },
    {
      title: 'user accept() rejects synchronously, with any message',
      files: [
        { name: 'keep.txt', size: 1, type: 'text/plain' },
        { name: 'drop.txt', size: 1, type: 'text/plain' },
      ],
      options: {
        accept(file: File, done: (e?: unknown) => void) {
          if (file.name.startsWith('drop')) done('Not allowed');
          else done();
        },
      },
    },
    {
      title: 'async accept(): maxFiles only counts files accepted so far',
      files: ['1', '2', '3'].map((n) => ({ name: `${n}.txt`, size: 1, type: 'text/plain' })),
      options: {
        maxFiles: 1,
        accept(_file: File, done: (e?: unknown) => void) {
          setTimeout(() => done(), 5);
        },
      },
    },
    {
      title: 'maxFiles 0 rejects everything',
      files: [{ name: 'a.txt', size: 1, type: 'text/plain' }],
      options: { maxFiles: 0 },
    },
  ];

  for (const c of cases) {
    it(c.title, async () => {
      const r = await runBoth(c.files, c.options);
      expect(r.dzLog.filter((l) => l.startsWith('addedfile:'))).toHaveLength(c.files.length);
      expect(r.coreLog).toEqual(r.dzLog);
      expect(r.coreState).toEqual(r.dzState);
    });
  }

  it('rejected files carry a client error code in the error list', async () => {
    const r = await runBoth(cases[5]!.files, cases[5]!.options);
    expect(r.core.getErrors().map((e) => [e.relativePath, e.code, e.stage, e.retryable])).toEqual([
      ['big.txt', 'REJECTED_SIZE', 'validate', false],
      ['more.png', 'MAX_FILES', 'validate', false],
    ]);
  });
});

describe('Dropzone parity: folder drop', () => {
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

  async function dropBoth(s: Spec, options: Record<string, unknown> = {}) {
    const dzTree = buildEntries(s);
    const dz = newDropzone(options);
    const dzEmpty: string[] = [];
    dz.on('emptyfolder', (p: string) => dzEmpty.push(p));
    const dzAdded = new Promise<DzFile[]>((resolve) =>
      dz.on('addedfiles', (f: DzFile[]) => resolve(f)),
    );
    dz.drop({ dataTransfer: dataTransfer(dzTree.roots) });
    const dzFiles = await dzAdded;

    const coreTree = buildEntries(s);
    const core = new AnyDropCore({ url: '/upload', autoProcessQueue: false, ...options });
    const coreEmpty: string[] = [];
    core.on('emptyfolder', (p) => coreEmpty.push(p));
    let coreAddedfiles: File[] = [];
    core.on('addedfiles', (f) => (coreAddedfiles = f));
    const coreFiles = await core.drop({ dataTransfer: dataTransfer(coreTree.roots) as never });

    const key = (f: { name: string; fullPath?: string }) => f.fullPath ?? f.name;
    return {
      dz: { files: dzFiles.map(key).sort(), all: dz.files.map(key).sort(), empty: dzEmpty.sort() },
      core: {
        files: coreFiles.map(key).sort(),
        all: core.files.map(key).sort(),
        empty: coreEmpty.sort(),
        addedfiles: coreAddedfiles.map(key).sort(),
      },
      coreInstance: core,
    };
  }

  it('adds the same files with the same fullPath, and emits the same emptyfolder paths', async () => {
    const r = await dropBoth(spec);
    expect(r.core.all).toEqual(r.dz.all);
    expect(r.core.files).toEqual(r.dz.files);
    expect(r.core.addedfiles).toEqual(r.dz.files);
    expect(r.core.empty).toEqual(r.dz.empty);
    expect(r.core.all).toContain('Photos/.git/config'); // hidden folders are walked, as in Dropzone
    expect(r.core.all).toContain('.hidden-loose'); // loose hidden files are not ignored, as in Dropzone
  });

  it('matches with ignoreHiddenFiles off and for directories with more than 100 entries', async () => {
    const r = await dropBoth({ ...spec, ...big }, { ignoreHiddenFiles: false });
    expect(r.core.all).toEqual(r.dz.all);
    expect(r.core.empty).toEqual(r.dz.empty);
    expect(r.core.all.filter((p) => p.startsWith('Big/'))).toHaveLength(230);
  });

  it('loose files have no fullPath, folder files do (as in Dropzone)', async () => {
    const r = await dropBoth(spec);
    const loose = r.coreInstance.files.find((f) => f.name === 'loose.txt')!;
    expect(loose.fullPath).toBeUndefined();
    expect('fullPath' in loose).toBe(false);
    const inFolder = r.coreInstance.files.find((f) => f.name === 'd.txt')!;
    expect(inFolder.fullPath).toBe('Docs/deep/deeper/d.txt');
  });
});

describe('Dropzone parity: options, constants, filesize', () => {
  it('uses Dropzone 6.3.5 defaults for every shared option, except retryChunks (0007)', () => {
    const dz = newDropzone();
    const dzOptions = dz.options as unknown as Record<string, unknown>;
    const ours = defaultOptions() as unknown as Record<string, unknown>;
    const ignore = new Set([
      'url',
      'autoProcessQueue',
      'accept',
      'chunksUploaded',
      'params',
      'retryChunks',
      'method',
      // null = no transform (Dropzone's default resizes images: done by @vedratech/anydrop-ui, 0011)
      'transformFile',
    ]);
    for (const key of Object.keys(ours)) {
      if (!(key in dzOptions) || ignore.has(key)) continue;
      expect([key, ours[key]]).toEqual([key, dzOptions[key]]);
    }
    expect(dzOptions.retryChunks).toBe(false);
    expect(ours.retryChunks).toBe(true);
    // Dropzone upper-cases a string method at construction; so do we.
    expect(new AnyDropCore().options.method).toBe(dzOptions.method);
    expect(new AnyDropCore({ method: 'put' }).options.method).toBe('PUT');
  });

  it('has the same status constants', () => {
    for (const k of [
      'ADDED',
      'QUEUED',
      'ACCEPTED',
      'UPLOADING',
      'PROCESSING',
      'CANCELED',
      'ERROR',
      'SUCCESS',
    ] as const) {
      expect([k, AnyDropCore[k]]).toEqual([k, Dropzone[k]]);
    }
    expect(AnyDropCore.PAUSED).toBe('paused');
  });

  it('formats sizes like Dropzone.filesize', () => {
    const dz = newDropzone();
    const sizes = [0, 1, 99, 100, 999, 1000, 1234, 99_999, 100_000, 1_500_000, 2.5e9, 7.25e12, -5];
    for (const base of [1000, 1024]) {
      dz.options.filesizeBase = base;
      const core = new AnyDropCore({ filesizeBase: base });
      for (const s of sizes) expect(core.filesize(s)).toBe(dz.filesize(s));
    }
    const units = { tb: 'To', gb: 'Go', mb: 'Mo', kb: 'Ko', b: 'o' };
    expect(filesize(1_500_000, 1000, units)).toBe('<strong>1.5</strong> Mo');
  });

  it('throws for uploadMultiple + chunking and binaryBody + uploadMultiple, like Dropzone', () => {
    expect(() => newDropzone({ uploadMultiple: true, chunking: true })).toThrow(
      'You cannot set both: uploadMultiple and chunking.',
    );
    expect(() => new AnyDropCore({ uploadMultiple: true, chunking: true })).toThrow(
      'You cannot set both: uploadMultiple and chunking.',
    );
    expect(() => new AnyDropCore({ uploadMultiple: true, binaryBody: true })).toThrow(
      'You cannot set both: binaryBody and uploadMultiple.',
    );
  });

  it('throws the same error from enqueueFile for a rejected file', async () => {
    const core = new AnyDropCore({ acceptedFiles: '.png', autoQueue: false });
    const f = core.addFile(new File(['x'], 'a.txt'));
    const dz = newDropzone({ acceptedFiles: '.png', autoQueue: false });
    const g = new File(['x'], 'a.txt');
    dz.addFile(g as DzFile);
    let dzMessage = '';
    try {
      dz.enqueueFile(g as DzFile);
    } catch (e) {
      dzMessage = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 0)); // our batch closes on a microtask (0011)
    expect(() => core.enqueueFile(f)).toThrow(dzMessage);
  });
});
