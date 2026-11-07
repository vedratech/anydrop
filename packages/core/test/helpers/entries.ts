// Mocked FileSystemEntry trees and DataTransfer objects for walker, core and parity tests.
// Directory readers return at most `batchSize` entries per readEntries() call (Chrome: 100) and
// call back asynchronously, like browsers do.

export type Spec = { [name: string]: number | File | Spec };

export interface MockOptions {
  /** Entries per readEntries() call. Default 100 (Chrome). */
  batchSize?: number;
  /** How callbacks are delivered. Default 'microtask'. */
  delivery?: 'microtask' | 'timeout';
  /** Paths (without leading slash) whose file() or readEntries() fails. */
  failPaths?: string[];
  lastModified?: number;
}

export interface Stats {
  readEntriesCalls: number;
  fileCalls: number;
  /** readEntries() calls per directory path. */
  readsByDir: Map<string, number>;
  /** Directory paths whose reader returned an empty batch (the loop ended properly). */
  drained: Set<string>;
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  txt: 'text/plain',
  gif: 'image/gif',
};

/** A File whose MIME type is guessed from the name like a desktop browser would ('' if unknown). */
export function makeFile(
  name: string,
  size = 1,
  type?: string,
  lastModified = 1_700_000_000_000,
): File {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const t = type !== undefined ? type : TYPES[ext] || '';
  return new File([new Uint8Array(size)], name, { type: t, lastModified });
}

export class MockFileEntry {
  readonly isFile = true;
  readonly isDirectory = false;
  constructor(
    readonly name: string,
    readonly fullPath: string,
    readonly _file: File,
    private readonly ctx: Ctx,
  ) {}
  file(ok: (f: File) => void, err?: (e: unknown) => void): void {
    this.ctx.stats.fileCalls++;
    const fail = this.ctx.fail.has(this.fullPath.slice(1));
    this.ctx.deliver(() => (fail ? err?.(new Error('NotReadableError')) : ok(this._file)));
  }
}

export class MockDirEntry {
  readonly isFile = false;
  readonly isDirectory = true;
  constructor(
    readonly name: string,
    readonly fullPath: string,
    readonly children: (MockFileEntry | MockDirEntry)[],
    private readonly ctx: Ctx,
  ) {}
  createReader(): {
    readEntries(
      ok: (e: (MockFileEntry | MockDirEntry)[]) => void,
      err?: (e: unknown) => void,
    ): void;
  } {
    let pos = 0;
    const path = this.fullPath.slice(1);
    return {
      readEntries: (ok, err) => {
        const s = this.ctx.stats;
        s.readEntriesCalls++;
        s.readsByDir.set(path, (s.readsByDir.get(path) || 0) + 1);
        if (this.ctx.fail.has(path)) {
          this.ctx.deliver(() => err?.(new Error('NotReadableError')));
          return;
        }
        const batch = this.children.slice(pos, pos + this.ctx.batchSize);
        pos += batch.length;
        if (!batch.length) s.drained.add(path);
        this.ctx.deliver(() => ok(batch));
      },
    };
  }
}

interface Ctx {
  batchSize: number;
  deliver: (fn: () => void) => void;
  fail: Set<string>;
  stats: Stats;
  lastModified: number;
}

export interface MockTree {
  roots: (MockFileEntry | MockDirEntry)[];
  stats: Stats;
  /** Every file path (without leading slash). */
  filePaths: string[];
  /** Every directory path. */
  dirPaths: string[];
}

/** Builds entries from a spec: a number is a file size, a File is used as is, an object is a directory. */
export function buildEntries(spec: Spec, opts: MockOptions = {}): MockTree {
  const stats: Stats = {
    readEntriesCalls: 0,
    fileCalls: 0,
    readsByDir: new Map(),
    drained: new Set(),
  };
  const ctx: Ctx = {
    batchSize: opts.batchSize ?? 100,
    deliver: opts.delivery === 'timeout' ? (fn) => setTimeout(fn, 0) : (fn) => queueMicrotask(fn),
    fail: new Set(opts.failPaths || []),
    stats,
    lastModified: opts.lastModified ?? 1_700_000_000_000,
  };
  const filePaths: string[] = [];
  const dirPaths: string[] = [];
  const build = (s: Spec, parent: string): (MockFileEntry | MockDirEntry)[] =>
    Object.keys(s).map((name) => {
      const v = s[name]!;
      const path = parent ? parent + '/' + name : name;
      if (typeof v === 'number' || v instanceof File) {
        filePaths.push(path);
        const f = typeof v === 'number' ? makeFile(name, v, undefined, ctx.lastModified) : v;
        return new MockFileEntry(name, '/' + path, f, ctx);
      }
      dirPaths.push(path);
      return new MockDirEntry(name, '/' + path, build(v, path), ctx);
    });
  return { roots: build(spec, ''), stats, filePaths, dirPaths };
}

/** A DataTransfer-like object for a drop of `roots` (what Chrome gives for files and folders). */
export function dataTransfer(roots: (MockFileEntry | MockDirEntry)[]): {
  items: {
    kind: string;
    webkitGetAsEntry(): MockFileEntry | MockDirEntry;
    getAsFile(): File | null;
  }[];
  files: File[];
} {
  const files = roots.map((e) =>
    e instanceof MockFileEntry ? e._file : new File([], e.name, { type: '' }),
  );
  return {
    items: roots.map((e, i) => ({
      kind: 'file',
      webkitGetAsEntry: () => e,
      getAsFile: () => files[i]!,
    })),
    files,
  };
}

/** Builds a large spec: `levels` nested directories, `filesPerLevel` files each, plus extras. */
export function deepSpec(levels: number, filesPerLevel: number): Spec {
  const root: Spec = {};
  let cur = root;
  for (let l = 1; l <= levels; l++) {
    const next: Spec = {};
    for (let i = 0; i < filesPerLevel; i++) next[`f${l}-${i}.txt`] = 1;
    next['empty'] = {};
    next['.DS_Store'] = 1;
    cur[`l${l}`] = next;
    cur = next;
  }
  return root;
}
