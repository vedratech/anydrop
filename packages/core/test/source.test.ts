// Behaviour spec for src/source/walk.ts (the cases below are the fixed examples of it).
//
// walkRoots(roots, { ignoreHiddenFiles, folders, onError }): AsyncGenerator<SourceItem[]>
//   roots: { file } (a dropped File) or { entry } (a FileSystemEntry from webkitGetAsEntry()).
//   - Dropped files come first, in one array, in drop order: a { file } root has the path of its
//     name; a file entry is read with entry.file() and has the path of its name. They are
//     never "from a folder" and never hidden-filtered.
//   - Then each dropped directory is walked depth first, in drop order. Directory entries are
//     skipped (and not read at all) when `folders` is false.
//   - A directory is read with createReader() and readEntries() is called until it returns an
//     empty array (a browser returns at most about 100 entries per call). One array is yielded per
//     call that held files; a call that held only directories or ignored files yields nothing.
//   - Inside a directory, files starting with '.' are ignored when ignoreHiddenFiles is set;
//     hidden directories are always walked. The subdirectories of a directory are walked after
//     the directory's own entries are all read, in listing order.
//   - The path of an entry below a directory is its `fullPath` without the leading slash when
//     the last segment of that path is the entry's name; otherwise it is "parent path/name".
//     A dropped directory is named the same way (parent path is empty). Backslashes become '/'.
//   - A directory with nothing found in it or below it is yielded as a folder item, after its
//     subdirectories: raw: true when readEntries() listed nothing at all, raw: false when it
//     listed entries but every one was ignored (hidden files) or unreadable. A directory whose
//     listing failed is not claimed to be empty.
//   - A file entry whose file() fails, or a directory whose reader fails (also by throwing),
//     is reported to onError(error, path) with its path; the walk goes on with the rest.
//
// snapshotDataTransfer(data): RootInput[]  (called synchronously inside the drop event)
//   - When `items` has entries, every item is looked at (and `files` is not): items of kind
//     'string' are skipped; an item whose webkitGetAsEntry() is a directory gives { entry };
//     otherwise getAsFile() gives { file }; if that is null but the item has an entry, it gives
//     { entry }; otherwise the item is skipped.
//   - When `items` is missing or empty, `files` gives { file } for each file. Nothing: [].
import { describe, expect, it, vi } from 'vitest';
import { readFileList, snapshotFiles } from '../src/source/fileList';
import type { EntryLike, SourceItem } from '../src/source/types';
import { snapshotDataTransfer, walkRoots } from '../src/source/walk';
import { buildEntries, dataTransfer, makeFile, type Spec } from './helpers/entries';

async function collect(
  gen: AsyncIterable<SourceItem[]>,
): Promise<{ batches: number; items: SourceItem[] }> {
  const items: SourceItem[] = [];
  let batches = 0;
  for await (const b of gen) {
    batches++;
    items.push(...b);
  }
  return { batches, items };
}

const opts = { ignoreHiddenFiles: true, folders: true };
const paths = (items: SourceItem[], kind: 'file' | 'folder') =>
  items.filter((i) => i.kind === kind).map((i) => i.path);

describe('walkRoots (webkitGetAsEntry)', () => {
  it('calls readEntries until it returns an empty batch (more than 100 entries)', async () => {
    const spec: Spec = { big: {} };
    for (let i = 0; i < 250; i++) (spec.big as Spec)[`f${i}.txt`] = 1;
    const t = buildEntries(spec);
    const { items, batches } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        opts,
      ),
    );
    expect(items).toHaveLength(250);
    expect(t.stats.readsByDir.get('big')).toBe(4); // 100 + 100 + 50 + empty
    expect(t.stats.drained.has('big')).toBe(true);
    expect(batches).toBe(3); // yielded per readEntries batch
    expect(new Set(paths(items, 'file')).size).toBe(250);
  });

  it('keeps the readEntries loop going for every directory, at any depth', async () => {
    const t = buildEntries({ a: { b: { c: { 'x.txt': 1 } }, 'y.txt': 1 } }, { batchSize: 1 });
    await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        opts,
      ),
    );
    for (const d of t.dirPaths) expect(t.stats.drained.has(d)).toBe(true);
  });

  it('yields empty folders, marks raw-empty ones, and counts folders-only directories as non-empty', async () => {
    const t = buildEntries({
      root: { empty: {}, onlyHidden: { '.gitkeep': 1 }, nest: { inner: {} }, 'a.txt': 1 },
    });
    const { items } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        opts,
      ),
    );
    const folders = items.filter((i) => i.kind === 'folder');
    expect(folders).toEqual(
      expect.arrayContaining([
        { kind: 'folder', path: 'root/empty', raw: true },
        { kind: 'folder', path: 'root/onlyHidden', raw: false },
        { kind: 'folder', path: 'root/nest/inner', raw: true },
      ]),
    );
    expect(folders).toHaveLength(3); // 'root/nest' holds a folder, so it is not empty
    expect(paths(items, 'file')).toEqual(['root/a.txt']);
  });

  it('ignores hidden files only inside folders and still walks hidden folders', async () => {
    const t = buildEntries({ '.top': 1, p: { '.DS_Store': 1, '.git': { config: 1 }, 'k.txt': 1 } });
    const roots = t.roots.map((e) =>
      e.isFile ? { file: (e as { _file: File })._file } : { entry: e },
    );
    const { items } = await collect(walkRoots(roots, opts));
    expect(paths(items, 'file').sort()).toEqual(['.top', 'p/.git/config', 'p/k.txt']);
    const all = await collect(walkRoots(roots, { ...opts, ignoreHiddenFiles: false }));
    expect(paths(all.items, 'file')).toContain('p/.DS_Store');
  });

  it('yields loose files first, then folders depth first', async () => {
    const t = buildEntries({ A: { 'a1.txt': 1, S: { 's.txt': 1 }, 'a2.txt': 1 }, 'loose.txt': 1 });
    const { items } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        opts,
      ),
    );
    expect(paths(items, 'file')).toEqual(['loose.txt', 'A/a1.txt', 'A/a2.txt', 'A/S/s.txt']);
  });

  it('skips directories when folders is false', async () => {
    const t = buildEntries({ A: { 'a.txt': 1 }, 'b.txt': 1 });
    const { items } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        { ...opts, folders: false },
      ),
    );
    expect(paths(items, 'file')).toEqual(['b.txt']);
    expect(t.stats.readEntriesCalls).toBe(0);
  });

  it('reports unreadable files and directories and finishes the walk', async () => {
    const t = buildEntries(
      { A: { 'bad.txt': 1, 'ok.txt': 1, locked: { 'x.txt': 1 } } },
      { failPaths: ['A/bad.txt', 'A/locked'] },
    );
    const onError = vi.fn();
    const { items } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        { ...opts, onError },
      ),
    );
    expect(paths(items, 'file')).toEqual(['A/ok.txt']);
    expect(paths(items, 'folder')).toEqual([]); // an unreadable folder is not claimed to be empty
    expect(onError.mock.calls.map((c) => c[1]).sort()).toEqual(['A/bad.txt', 'A/locked']);
  });

  it('falls back to parent path + name when fullPath is missing or inconsistent', async () => {
    const f = makeFile('x.txt');
    const reader = (entries: EntryLike[]) => {
      let done = false;
      return {
        readEntries: (ok: (e: EntryLike[]) => void) => {
          const b = done ? [] : entries;
          done = true;
          queueMicrotask(() => ok(b));
        },
      };
    };
    const file = {
      isFile: true,
      isDirectory: false,
      name: 'x.txt',
      fullPath: '/wrong/y.txt',
      file: (ok: (f: File) => void) => ok(f),
    };
    const dir = { isFile: false, isDirectory: true, name: 'D', createReader: () => reader([file]) };
    const { items } = await collect(walkRoots([{ entry: dir }], opts));
    expect(items).toEqual([{ kind: 'file', file: f, path: 'D/x.txt', fromFolder: true }]);
  });

  it('works with callbacks delivered as tasks (setTimeout), like real browsers', async () => {
    const t = buildEntries(
      { A: { 'a.txt': 1, B: { 'b.txt': 1, E: {} } } },
      { delivery: 'timeout' },
    );
    const { items } = await collect(
      walkRoots(
        t.roots.map((entry) => ({ entry })),
        opts,
      ),
    );
    expect(paths(items, 'file')).toEqual(['A/a.txt', 'A/B/b.txt']);
    expect(paths(items, 'folder')).toEqual(['A/B/E']);
  });
});

describe('walkRoots: paths and failures', () => {
  const dirOf = (name: string, fullPath: string | undefined, children: EntryLike[]) => {
    let done = false;
    return {
      isFile: false,
      isDirectory: true,
      name,
      fullPath,
      createReader: () => ({
        readEntries: (ok: (e: EntryLike[]) => void) => {
          const batch = done ? [] : children;
          done = true;
          queueMicrotask(() => ok(batch));
        },
      }),
    };
  };
  const fileOf = (name: string, fullPath: string | undefined, f = makeFile(name)) => ({
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok: (f: File) => void) => ok(f),
  });

  it('takes a fullPath that ends with the entry name, normalised, else parent/name', async () => {
    const d = dirOf('D', '/Top\\D', [
      fileOf('a.txt', '/elsewhere/a.txt'),
      fileOf('b.txt', undefined),
      fileOf('c.txt', '/D/other.txt'),
    ]);
    const { items } = await collect(walkRoots([{ entry: d }], opts));
    expect(paths(items, 'file')).toEqual(['elsewhere/a.txt', 'Top/D/b.txt', 'Top/D/c.txt']);
  });

  it('names a dropped file entry and a dropped File by their name', async () => {
    const f = makeFile('x.txt');
    const { items } = await collect(
      walkRoots([{ entry: fileOf('e.txt', '/other/e.txt') }, { file: f }], opts),
    );
    expect(items.map((i) => [i.kind, i.path, (i as { fromFolder: boolean }).fromFolder])).toEqual([
      ['file', 'e.txt', false],
      ['file', 'x.txt', false],
    ]);
  });

  it('keeps hidden dropped files, even when ignoreHiddenFiles is set', async () => {
    const { items } = await collect(walkRoots([{ file: makeFile('.env') }], opts));
    expect(paths(items, 'file')).toEqual(['.env']);
  });

  it('yields a directory whose only files are unreadable as an empty, non-raw folder', async () => {
    const bad = {
      ...fileOf('bad.txt', '/R/bad.txt'),
      file: (_ok: unknown, err?: (e: unknown) => void) => err?.(new Error('x')),
    };
    const onError = vi.fn();
    const { items } = await collect(
      walkRoots([{ entry: dirOf('R', '/R', [bad]) }], { ...opts, onError }),
    );
    expect(items).toEqual([{ kind: 'folder', path: 'R', raw: false }]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![1]).toBe('R/bad.txt');
  });

  it('treats a directory whose subdirectories all failed as empty, and one whose reader throws as failed', async () => {
    const throwing = {
      isFile: false,
      isDirectory: true,
      name: 'bad',
      fullPath: '/R/bad',
      createReader: () => ({
        readEntries: () => {
          throw new Error('boom');
        },
      }),
    };
    const onError = vi.fn();
    const { items } = await collect(
      walkRoots([{ entry: dirOf('R', '/R', [throwing]) }], { ...opts, onError }),
    );
    expect(items).toEqual([{ kind: 'folder', path: 'R', raw: false }]);
    expect(onError.mock.calls.map((c) => c[1])).toEqual(['R/bad']);
  });

  it('ignores entries that are neither files nor directories', async () => {
    const odd = { isFile: false, isDirectory: false, name: 'odd' };
    const { items } = await collect(
      walkRoots([{ entry: odd as never }, { entry: dirOf('R', '/R', [odd as never]) }], opts),
    );
    expect(items).toEqual([{ kind: 'folder', path: 'R', raw: false }]);
  });

  it('reports a file entry whose file() throws', async () => {
    const throwing = {
      ...fileOf('t.txt', '/t.txt'),
      file: () => {
        throw new Error('x');
      },
    };
    const onError = vi.fn();
    const { items } = await collect(walkRoots([{ entry: throwing }], { ...opts, onError }));
    expect(items).toEqual([]);
    expect(onError.mock.calls.map((c) => c[1])).toEqual(['t.txt']);
  });
});

describe('snapshotDataTransfer', () => {
  it('takes entries for folders and getAsFile() for top-level files, synchronously', () => {
    const t = buildEntries({ A: { 'a.txt': 1 }, 'b.txt': 1 });
    const dt = dataTransfer(t.roots);
    const roots = snapshotDataTransfer(dt);
    expect(roots).toHaveLength(2);
    expect('entry' in roots[0]!).toBe(true);
    expect((roots[1] as { file: File }).file).toBe(dt.files[1]);
  });

  it('falls back to getAsFile() per item, skips string items, then to files', () => {
    const f = makeFile('p.png');
    const items = [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => f },
      { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => f },
    ];
    expect(snapshotDataTransfer({ items })).toEqual([{ file: f }, { file: f }]);
    expect(snapshotDataTransfer({ items: [], files: [f] })).toEqual([{ file: f }]);
    expect(snapshotDataTransfer({})).toEqual([]);
  });

  it('does not fall back to files when items has entries but none is usable', () => {
    const f = makeFile('p.png');
    expect(snapshotDataTransfer({ items: [{ kind: 'string' }], files: [f] })).toEqual([]);
    expect(snapshotDataTransfer({ items: [{ kind: 'file' }], files: [f] })).toEqual([]);
  });

  it('uses the entry of an item whose getAsFile() is null, and a directory entry before the file', () => {
    const dir = { isFile: false, isDirectory: true, name: 'D' };
    const file = { isFile: true, isDirectory: false, name: 'f' };
    const g = makeFile('g.png');
    const roots = snapshotDataTransfer({
      items: [
        { kind: 'file', webkitGetAsEntry: () => dir, getAsFile: () => g },
        { kind: 'file', webkitGetAsEntry: () => file, getAsFile: () => null },
        { kind: 'file', webkitGetAsEntry: () => file, getAsFile: () => g },
      ],
    });
    expect(roots).toEqual([{ entry: dir }, { entry: file }, { file: g }]);
  });
});

describe('readFileList (file and folder inputs)', () => {
  const picked = (path: string, size = 1) => {
    const f = makeFile(path.slice(path.lastIndexOf('/') + 1), size);
    Object.defineProperty(f, 'webkitRelativePath', { value: path });
    return f;
  };

  it('uses webkitRelativePath for folder inputs and the name for plain inputs', () => {
    const items = readFileList(
      [picked('Pics/2024/a.jpg'), makeFile('b.txt'), picked('Pics\\c.png')],
      opts,
    );
    expect(items).toEqual([
      expect.objectContaining({ path: 'Pics/2024/a.jpg', fromFolder: true }),
      expect.objectContaining({ path: 'b.txt', fromFolder: false }),
      expect.objectContaining({ path: 'Pics/c.png', fromFolder: true }),
    ]);
  });

  it('ignores hidden files in folders and keeps folders that held only hidden files', () => {
    const items = readFileList(
      [
        picked('R/.DS_Store'),
        picked('R/a.txt'),
        picked('R/keep/.gitkeep'),
        picked('R/x/y/.gitkeep'),
      ],
      opts,
    );
    expect(paths(items, 'file')).toEqual(['R/a.txt']);
    expect(paths(items, 'folder').sort()).toEqual(['R/keep', 'R/x/y']);
    const all = readFileList([picked('R/.DS_Store')], { ignoreHiddenFiles: false });
    expect(paths(all, 'file')).toEqual(['R/.DS_Store']);
  });

  it('snapshots an input element, a FileList-like, or an array', () => {
    const f = makeFile('a.txt');
    expect(snapshotFiles({ files: [f] })).toEqual([f]);
    expect(snapshotFiles([f])).toEqual([f]);
    expect(snapshotFiles({ files: null })).toEqual([]);
  });
});
