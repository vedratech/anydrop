// M1 done-when: a mocked FileSystemEntry tree with 10,000 files, depth 10, empty folders and
// more than 100 entries per directory produces the correct tree in under 1 s.
import { describe, expect, it } from 'vitest';
import { AnyDropCore, type FolderNode } from '../src/index';
import { BUDGET_MS, bestMs, timed } from './helpers/budget';
import { buildEntries, dataTransfer, deepSpec, type Spec } from './helpers/entries';

const LEVELS = 10;
const PER_LEVEL = 975; // 9,750 files in the deep chain
const WIDE_OK = 200;
const WIDE_REJECTED = 50; // 10,000 files in total

function spec(): Spec {
  const root = deepSpec(LEVELS, PER_LEVEL);
  const wide: Spec = {};
  for (let i = 0; i < WIDE_OK; i++) wide[`w${i}.txt`] = 1;
  for (let i = 0; i < WIDE_REJECTED; i++) wide[`w${i}.bin`] = 1;
  root.wide = wide;
  return { Root: root };
}

const levelPath = (k: number) =>
  ['Root', ...Array.from({ length: k }, (_, i) => `l${i + 1}`)].join('/');

describe('large tree (M1 done-when)', () => {
  it('builds the correct tree for 10,000 files at depth 10 in under 1 s', async () => {
    const tree = buildEntries(spec()); // fixtures (File objects) are not part of the timing
    const core = new AnyDropCore({ acceptedFiles: '.txt', autoProcessQueue: false });
    const folderEvents: FolderNode[] = [];
    const emptyEvents: string[] = [];
    let addedfileEvents = 0;
    let addedfilesEvents = 0;
    core.on('addedfolder', (n) => folderEvents.push(n));
    core.on('emptyfolder', (p) => emptyEvents.push(p));
    core.on('addedfile', () => addedfileEvents++);
    core.on('addedfiles', () => addedfilesEvents++);

    let first = true;
    let files: Awaited<ReturnType<typeof core.drop>> = [];
    // Warm-up, then the best of three drops (the first one is the one checked below).
    await new AnyDropCore({ autoProcessQueue: false }).drop({
      dataTransfer: dataTransfer(buildEntries({ W: { 'w.txt': 1 } }).roots) as never,
    });
    const ms = await bestMs(async () => {
      const c = first ? core : new AnyDropCore({ acceptedFiles: '.txt', autoProcessQueue: false });
      const dt = first ? tree.roots : buildEntries(spec()).roots;
      first = false;
      let got: Awaited<ReturnType<typeof core.drop>> = [];
      const took = await timed(async () => {
        got = await c.drop({ dataTransfer: dataTransfer(dt) as never });
      });
      if (c === core) files = got;
      return took;
    });

    expect(ms).toBeLessThan(BUDGET_MS); // target: under 1 s
    // Files and events
    expect(files).toHaveLength(10_000);
    expect(core.files).toHaveLength(10_000);
    expect(addedfileEvents).toBe(10_000);
    expect(addedfilesEvents).toBe(1);
    // Hidden files ignored, every directory read until readEntries returned an empty batch
    expect(files.some((f) => f.name === '.DS_Store')).toBe(false);
    for (const d of tree.dirPaths) expect(tree.stats.drained.has(d)).toBe(true);
    expect(tree.stats.readsByDir.get(levelPath(1))).toBe(11); // 978 entries: 10 batches + empty
    expect(tree.stats.readsByDir.get('Root/wide')).toBe(4); // 250 entries: 3 batches + empty

    // Shape: depth 10 chain, 975 files per level, an empty folder per level, a wide folder
    const root = core.getTree();
    expect(root.counts.total).toBe(10_000);
    for (let k = 1; k <= LEVELS; k++) {
      const node = core.getFolder(levelPath(k))!;
      expect(node.depth).toBe(k + 1);
      expect(node.files).toHaveLength(PER_LEVEL);
      expect(node.counts.total).toBe(PER_LEVEL * (LEVELS - k + 1));
      const childNames = node.children.map((c) => c.name).sort();
      expect(childNames).toEqual(k < LEVELS ? ['empty', `l${k + 1}`] : ['empty']);
      const empty = core.getFolder(levelPath(k) + '/empty')!;
      expect(empty.counts.total).toBe(0);
      expect(empty.status).toBe('success');
    }
    const deepest = core.getFolder(levelPath(LEVELS))!;
    expect(deepest.files[0]!.relativePath).toBe(`${levelPath(LEVELS)}/f${LEVELS}-0.txt`);
    expect(deepest.files[0]!.fullPath).toBe(deepest.files[0]!.relativePath);

    // Folders: Root, wide, 10 levels, 10 empty folders; parents announced before children
    expect(folderEvents).toHaveLength(22);
    const seen = new Set<FolderNode>([root]);
    for (const n of folderEvents) {
      expect(seen.has(n.parent!)).toBe(true);
      seen.add(n);
    }
    expect(emptyEvents).toHaveLength(LEVELS);

    // Validation: rejected files stay in the tree as errors, outside the byte totals
    const wide = core.getFolder('Root/wide')!;
    expect(wide.counts).toMatchObject({ total: 250, queued: WIDE_OK, error: WIDE_REJECTED });
    expect(root.counts).toMatchObject({ queued: 9_950, error: 50 });
    expect(root.bytesTotal).toBe(9_950);
    expect(core.getErrors()).toHaveLength(50);
    expect(root.status).toBe('queued');
  });

  it('merges a second drop, removes files incrementally, and keeps roll-ups exact', async () => {
    const core = new AnyDropCore({ autoProcessQueue: false });
    await core.drop({ dataTransfer: dataTransfer(buildEntries(spec()).roots) as never });
    const root = core.getTree();
    const newFolders: string[] = [];
    core.on('addedfolder', (n) => newFolders.push(n.path));

    // Merge: the same root again with one new file and one new folder
    await core.drop({
      dataTransfer: dataTransfer(
        buildEntries({ Root: { l1: { 'new.txt': 1, fresh: { 'n.txt': 1 } } } }).roots,
      ) as never,
    });
    expect(newFolders).toEqual(['Root/l1/fresh']);
    expect(core.getFolder('Root/l1')!.files).toHaveLength(PER_LEVEL + 1);
    expect(root.counts.total).toBe(10_002);
    expect(root.children).toHaveLength(1);

    // Remove: every file of the deepest level (its kept empty child keeps it), and all of 'wide'
    const deepest = core.getFolder(levelPath(LEVELS))!;
    expect(
      await timed(() => {
        for (const f of deepest.files.slice()) core.removeFile(f);
        for (const f of core.getFolder('Root/wide')!.files.slice()) core.removeFile(f);
      }),
    ).toBeLessThan(BUDGET_MS);
    expect(core.getFolder(levelPath(LEVELS))).toBe(deepest);
    expect(deepest.counts.total).toBe(0);
    expect(core.getFolder('Root/wide')).toBeUndefined();
    expect(root.counts.total).toBe(10_002 - PER_LEVEL - 250);
    expect(core.getFolder('Root')!.counts.total).toBe(root.counts.total);
    expect(root.bytesTotal).toBe(root.counts.total);

    // Status changes roll up in O(depth): cancel every remaining file
    expect(
      await timed(() => {
        for (const f of core.files.slice()) core.cancelUpload(f);
      }),
    ).toBeLessThan(BUDGET_MS);
    expect(root.counts.canceled).toBe(root.counts.total);
    expect(root.status).toBe('canceled');
    expect(root.bytesTotal).toBe(0);

    // removeAllFiles on a large instance stays fast
    expect(await timed(() => core.removeAllFiles(true))).toBeLessThan(BUDGET_MS);
    expect(root.counts.total).toBe(0);
  });
});
