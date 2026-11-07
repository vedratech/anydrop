import { describe, expect, it } from 'vitest';
import { augmentFile } from '../src/file';
import { TreeStore, type FolderNodeImpl } from '../src/tree/TreeStore';
import type { AnyDropFile, FileStatus } from '../src/types';
import { dirname } from '../src/util/path';
import { makeFile } from './helpers/entries';

let n = 0;
function add(
  tree: TreeStore,
  path: string,
  size = 100,
  accepted: boolean | 'pending' = true,
): AnyDropFile {
  const folder = tree.ensureFolder(dirname(path));
  const f = augmentFile(makeFile(path.slice(path.lastIndexOf('/') + 1), size), {
    id: `id-${++n}`,
    uploadId: `u-${n}`,
    relativePath: path,
    fromFolder: true,
    folder,
    chunking: false,
    forceChunking: false,
    chunkSize: 1000,
    rename: (x) => x.name,
  });
  f.accepted = accepted === 'pending' ? undefined : accepted;
  tree.addFile(f);
  return f;
}
function set(tree: TreeStore, f: AnyDropFile, status: FileStatus, bytesSent?: number): void {
  f.status = status;
  if (bytesSent !== undefined) f.upload.bytesSent = bytesSent;
  tree.update(f);
}

describe('TreeStore', () => {
  it('creates folders once per path, parents first, and merges later adds', () => {
    const tree = new TreeStore();
    const created: string[] = [];
    const onCreate = (node: FolderNodeImpl) => created.push(node.path);
    tree.ensureFolder('A/B/C', onCreate);
    tree.ensureFolder('A/B/D', onCreate);
    tree.ensureFolder('A/B', onCreate);
    expect(created).toEqual(['A', 'A/B', 'A/B/C', 'A/B/D']);
    const b = tree.getFolder('A/B')!;
    expect(b.children.map((c) => c.name)).toEqual(['C', 'D']);
    expect(b.depth).toBe(2);
    expect(b.parent!.parent).toBe(tree.root);
    expect(tree.getFolder('/A//B/')).toBe(b);
    expect(tree.folderCount).toBe(4);
  });

  it('keeps counters and bytes along the whole path', () => {
    const tree = new TreeStore();
    const a = add(tree, 'A/B/a.txt', 100);
    const b = add(tree, 'A/b.txt', 300);
    add(tree, 'loose.txt', 50);
    const A = tree.getFolder('A')!;
    expect(A.counts.total).toBe(2);
    expect(A.bytesTotal).toBe(400);
    expect(tree.root.counts.total).toBe(3);
    expect(tree.root.bytesTotal).toBe(450);
    set(tree, a, 'uploading', 50);
    set(tree, b, 'queued');
    expect(A.counts.uploading).toBe(1);
    expect(A.counts.added).toBe(0);
    expect(A.bytesSent).toBe(50);
    expect(A.progress).toBeCloseTo(12.5);
    expect(A.status).toBe('uploading');
    // progress can go down (aborted chunk)
    set(tree, a, 'uploading', 10);
    expect(tree.getFolder('A/B')!.progress).toBeCloseTo(10);
  });

  it('applies the 0005 roll-up rules', () => {
    const tree = new TreeStore();
    const [x, y, z] = [add(tree, 'F/x'), add(tree, 'F/y'), add(tree, 'F/z')];
    const F = tree.getFolder('F')!;
    expect(F.status).toBe('added');
    set(tree, x, 'queued');
    expect(F.status).toBe('queued');
    set(tree, x, 'paused');
    expect(F.status).toBe('added'); // y and z are still 'added'
    set(tree, y, 'paused');
    set(tree, z, 'paused');
    expect(F.status).toBe('paused'); // every non-terminal file is paused
    set(tree, z, 'success', 100);
    expect(F.status).toBe('paused');
    set(tree, x, 'uploading');
    expect(F.status).toBe('uploading');
    set(tree, x, 'success', 100);
    set(tree, y, 'canceled');
    expect(F.status).toBe('success');
    expect(tree.isComplete(F)).toBe(true);
    set(tree, x, 'error');
    expect(F.status).toBe('error');
    const G = [add(tree, 'G/a'), add(tree, 'G/b')];
    G.forEach((f) => set(tree, f, 'canceled'));
    expect(tree.getFolder('G')!.status).toBe('canceled');
  });

  it('counts only accepted, non-canceled files in bytes', () => {
    const tree = new TreeStore();
    const ok = add(tree, 'R/ok', 100);
    const rejected = add(tree, 'R/bad', 500, false);
    const pending = add(tree, 'R/pending', 700, 'pending');
    const R = tree.getFolder('R')!;
    set(tree, rejected, 'error');
    expect(R.bytesTotal).toBe(100);
    expect(R.counts.error).toBe(1);
    pending.accepted = true;
    tree.update(pending);
    expect(R.bytesTotal).toBe(800);
    set(tree, ok, 'uploading', 100);
    set(tree, ok, 'canceled');
    expect(R.bytesTotal).toBe(700);
    expect(R.bytesSent).toBe(0);
  });

  it('inherits pause from the instance and from ancestor folders', () => {
    let all = false;
    const tree = new TreeStore(() => all);
    const f = add(tree, 'A/B/f');
    set(tree, f, 'queued');
    const A = tree.getFolder('A')!;
    const B = tree.getFolder('A/B')!;
    A.userPaused = true;
    tree.refreshSubtree(A);
    expect([A.status, B.status, tree.root.status]).toEqual(['paused', 'paused', 'queued']);
    A.userPaused = false;
    all = true;
    tree.refreshSubtree(tree.root);
    expect([A.status, B.status, tree.root.status]).toEqual(['paused', 'paused', 'paused']);
  });

  it('gives empty folders the 0005 rule 3 status and progress', () => {
    const tree = new TreeStore();
    const E = tree.ensureFolder('X/empty');
    expect(E.status).toBe('queued');
    expect(E.progress).toBe(0);
    tree.setEmptyStatus(E, 'success');
    expect(E.status).toBe('success');
    expect(E.progress).toBe(100);
    expect(tree.root.status).toBe('added'); // the root with no files
  });

  it('removes files, prunes folders left empty, and keeps folders dropped empty', () => {
    const tree = new TreeStore();
    const a = add(tree, 'A/B/a', 10);
    const b = add(tree, 'A/b', 20);
    const kept = tree.ensureFolder('A/Kept');
    kept._keep = true;
    const removed = tree.removeFile(a);
    expect(removed.map((r) => r.path)).toEqual(['A/B']);
    expect(tree.getFolder('A/B')).toBeUndefined();
    expect(tree.getFolder('A')!.bytesTotal).toBe(20);
    tree.removeFile(b);
    expect(tree.getFolder('A')).toBeDefined(); // still holds the kept empty folder
    expect(tree.getFolder('A/Kept')).toBe(kept);
    expect(tree.root.counts.total).toBe(0);
    expect(tree.root.bytesTotal).toBe(0);
    expect(tree.removeFile(b)).toEqual([]); // second removal is a no-op
  });

  it('clears in place (the root object stays the same)', () => {
    const tree = new TreeStore();
    const root = tree.root;
    add(tree, 'A/a');
    tree.clear();
    expect(tree.root).toBe(root);
    expect(root.children).toEqual([]);
    expect(root.counts.total).toBe(0);
    expect(tree.getFolder('A')).toBeUndefined();
    expect(tree.fileCount).toBe(0);
  });
});
