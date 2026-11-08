// TreeStore: folder nodes unique by path, file records, and incremental roll-up.
// Every file change updates the counters and byte totals of its ancestors and recomputes their
// status and progress: O(depth) per change, never O(files).
import type { AnyDropFile, FileStatus, FolderNode } from '../types';
import { basename, dirname, normalizePath } from '../util/path';

type MutableCounts = { -readonly [K in keyof FolderNode['counts']]: number };

function zeroCounts(): MutableCounts {
  return {
    total: 0,
    added: 0,
    queued: 0,
    uploading: 0,
    paused: 0,
    success: 0,
    error: 0,
    canceled: 0,
  };
}

/** Internal node class. Exposed to users through the read-only `FolderNode` type. */
export class FolderNodeImpl implements FolderNode {
  readonly children: FolderNodeImpl[] = [];
  readonly files: AnyDropFile[] = [];
  status: FileStatus;
  progress = 0;
  bytesTotal = 0;
  bytesSent = 0;
  counts: MutableCounts = zeroCounts();
  userPaused = false;
  /** @internal Status of this folder while it has no descendant files. */
  _empty: FileStatus;
  /** @internal Kept when it becomes empty through removals (it was dropped empty). */
  _keep = false;
  /** @internal `foldercomplete` was emitted for the current terminal state (cleared when it is not terminal). */
  _fc = false;

  constructor(
    readonly path: string,
    readonly name: string,
    readonly parent: FolderNodeImpl | null,
    readonly depth: number,
  ) {
    this._empty = this.status = parent ? 'queued' : 'added';
  }
}

/** What the store last counted for a file, so later updates apply exact deltas. */
interface FileRecord {
  file: AnyDropFile;
  status: FileStatus;
  total: number;
  sent: number;
}

export class TreeStore {
  readonly root = new FolderNodeImpl('', '', null, 0);
  private folders = new Map<string, FolderNodeImpl>([['', this.root]]);
  private records = new Map<string, FileRecord>();
  private path: FolderNodeImpl[] = [];

  /** `isAllPaused`: whether the whole instance is paused (M3 pause controller). */
  constructor(private readonly isAllPaused: () => boolean = () => false) {}

  get fileCount(): number {
    return this.records.size;
  }

  get folderCount(): number {
    return this.folders.size - 1;
  }

  getFolder(path: string): FolderNodeImpl | undefined {
    return this.folders.get(normalizePath(path));
  }

  getFile(id: string): AnyDropFile | undefined {
    const rec = this.records.get(id);
    return rec && rec.file;
  }

  has(file: AnyDropFile): boolean {
    const rec = this.records.get(file.id);
    return !!rec && rec.file === file;
  }

  /**
   * Returns the folder at `path` (already normalised), creating it and any missing ancestor.
   * `onCreate` runs for each new node, parents first.
   */
  ensureFolder(path: string, onCreate?: (node: FolderNodeImpl) => void): FolderNodeImpl {
    const existing = this.folders.get(path);
    if (existing) return existing;
    const parent = this.ensureFolder(dirname(path), onCreate);
    const node = new FolderNodeImpl(path, basename(path), parent, parent.depth + 1);
    parent.children.push(node);
    this.folders.set(path, node);
    if (onCreate) onCreate(node);
    return node;
  }

  /** Adds a file (its `folder` must come from `ensureFolder`). */
  addFile(file: AnyDropFile): void {
    const folder = file.folder as FolderNodeImpl;
    folder.files.push(file);
    const rec: FileRecord = { file, status: file.status, total: 0, sent: 0 };
    this.records.set(file.id, rec);
    for (let n: FolderNodeImpl | null = folder; n; n = n.parent) {
      n.counts.total++;
      n.counts[rec.status]++;
    }
    this.update(file, true);
  }

  /**
   * Applies the file's current `status`, `accepted` and `upload.bytesSent` to the tree.
   * Bytes count only for accepted, non-canceled files.
   */
  update(file: AnyDropFile, force = false): void {
    const rec = this.records.get(file.id);
    if (!rec || rec.file !== file) return;
    const status = file.status;
    const counted = file.accepted === true && status !== 'canceled';
    // upload.total: the size actually sent (a transformFile result can differ from file.size).
    const total = counted ? file.upload.total : 0;
    const sent = counted ? Math.min(Math.max(file.upload.bytesSent, 0), total) : 0;
    const prev = rec.status;
    const dTotal = total - rec.total;
    const dSent = sent - rec.sent;
    if (prev === status && !dTotal && !dSent && !force) return;
    for (let n: FolderNodeImpl | null = file.folder as FolderNodeImpl; n; n = n.parent) {
      if (prev !== status) {
        n.counts[prev]--;
        n.counts[status]++;
      }
      n.bytesTotal += dTotal;
      n.bytesSent += dSent;
    }
    rec.status = status;
    rec.total = total;
    rec.sent = sent;
    this.refreshPath(file.folder as FolderNodeImpl);
  }

  /**
   * Removes a file. Folders left without files and subfolders are removed too, unless they were
   * dropped empty (`_keep`). Returns the removed folders, innermost first.
   */
  removeFile(file: AnyDropFile): FolderNodeImpl[] {
    const rec = this.records.get(file.id);
    const removed: FolderNodeImpl[] = [];
    if (!rec || rec.file !== file) return removed;
    this.records.delete(file.id);
    const folder = file.folder as FolderNodeImpl;
    const i = folder.files.lastIndexOf(file);
    if (i >= 0) folder.files.splice(i, 1);
    for (let n: FolderNodeImpl | null = folder; n; n = n.parent) {
      n.counts.total--;
      n.counts[rec.status]--;
      n.bytesTotal -= rec.total;
      n.bytesSent -= rec.sent;
    }
    let n = folder;
    while (n.parent && n.counts.total === 0 && n.children.length === 0 && !n._keep) {
      const parent = n.parent;
      parent.children.splice(parent.children.indexOf(n), 1);
      this.folders.delete(n.path);
      removed.push(n);
      n = parent;
    }
    this.refreshPath(n);
    return removed;
  }

  /** Removes every folder without descendant files, also dropped-empty ones. Children before parents. */
  pruneEmpty(): FolderNodeImpl[] {
    const out: FolderNodeImpl[] = [];
    const visit = (n: FolderNodeImpl): void => {
      for (const c of n.children.slice()) visit(c);
      if (n.parent && !n.counts.total && !n.children.length) {
        n.parent.children.splice(n.parent.children.indexOf(n), 1);
        this.folders.delete(n.path);
        out.push(n);
      }
    };
    visit(this.root);
    return out;
  }

  /** Sets the status an empty folder shows (0005 rule 3: queued, then success or error). */
  setEmptyStatus(node: FolderNodeImpl, status: FileStatus): void {
    node._empty = status;
    this.refreshPath(node);
  }

  /** Whether every descendant file is terminal (and there is at least one). */
  isComplete(node: FolderNode): boolean {
    const c = node.counts;
    return c.total > 0 && c.success + c.error + c.canceled === c.total;
  }

  /** Recomputes status and progress of `node` and every descendant (after pause changes, M3). */
  refreshSubtree(node: FolderNodeImpl): void {
    this.refreshPath(node);
    const stack = node.children.slice();
    for (let n = stack.pop(); n; n = stack.pop()) {
      this.refreshPath(n);
      for (const c of n.children) stack.push(c);
    }
  }

  /** Empties the tree in place (the root object stays the same). */
  clear(): void {
    const r = this.root;
    r.children.length = 0;
    r.files.length = 0;
    r.counts = zeroCounts();
    r.bytesTotal = r.bytesSent = 0;
    r.userPaused = false;
    this.folders = new Map([['', r]]);
    this.records = new Map();
    this.refreshPath(r);
  }

  /** Status and progress of every node from the root down to `leaf`. */
  private refreshPath(leaf: FolderNodeImpl): void {
    const path = this.path;
    path.length = 0;
    for (let n: FolderNodeImpl | null = leaf; n; n = n.parent) path.push(n);
    let paused = this.isAllPaused();
    for (let i = path.length - 1; i >= 0; i--) {
      const n = path[i] as FolderNodeImpl;
      paused = paused || n.userPaused;
      const s = (n.status = rollUp(n, paused));
      if (s !== 'success' && s !== 'error' && s !== 'canceled') n._fc = false;
      n.progress =
        n.bytesTotal > 0 ? (n.bytesSent / n.bytesTotal) * 100 : n.status === 'success' ? 100 : 0;
    }
    path.length = 0;
  }
}

/** Roll-up rules of. `paused`: this folder, an ancestor or the instance is paused. */
function rollUp(n: FolderNodeImpl, paused: boolean): FileStatus {
  const c = n.counts;
  if (c.total === 0) return n._empty;
  const terminal = c.success + c.error + c.canceled;
  if (terminal === c.total)
    return c.error ? 'error' : c.canceled === c.total ? 'canceled' : 'success';
  if (c.uploading) return 'uploading';
  if (paused || c.paused === c.total - terminal) return 'paused';
  if (c.queued) return 'queued';
  return 'added';
}
