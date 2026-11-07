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

  it('ignores hidden files only inside folders, like Dropzone, and still walks hidden folders', async () => {
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
