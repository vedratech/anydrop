// Portions adapted from Dropzone (MIT, Copyright (c) 2026 Matias Simon <m@tias.me>), see THIRD_PARTY_NOTICES.md.
// Walks dropped or pasted entries (`webkitGetAsEntry`) and yields files in batches.
//
// - `readEntries()` is called on the same reader until it returns an empty batch (Chrome returns
//   at most 100 entries per call).
// - Each `readEntries` batch is yielded as soon as its files are read, so the engine can process
//   10k files without one long task. Subdirectories are walked after their parent (depth first).
// - A directory that yields nothing (no entries, or only ignored hidden files) is yielded as a
//   `folder` item, so empty folders are not lost.
// - Read errors are reported through `onError` and never stop or hang the walk.
import { basename, joinPath, normalizePath } from '../util/path';
import type {
  DataTransferLike,
  DirectoryEntryLike,
  DirectoryReaderLike,
  EntryLike,
  FileEntryLike,
  ReadOptions,
  RootInput,
  SourceItem,
} from './types';

/**
 * Takes what is needed from a drop or paste **synchronously** (items are only readable during
 * the event): directory/file entries where `webkitGetAsEntry` exists, otherwise plain files.
 * Mirrors Dropzone's `drop()` / `_addFilesFromItems()`.
 */
export function snapshotDataTransfer(dt: DataTransferLike): RootInput[] {
  const out: RootInput[] = [];
  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const entry = (
        typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      ) as EntryLike | null;
      if (entry) {
        if (entry.isFile) {
          const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
          out.push(file ? { file } : { entry });
        } else if (entry.isDirectory) {
          out.push({ entry });
        }
      } else if (
        typeof item.getAsFile === 'function' &&
        (item.kind == null || item.kind === 'file')
      ) {
        const file = item.getAsFile();
        if (file) out.push({ file });
      }
    }
  } else if (dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (file) out.push({ file });
    }
  }
  return out;
}

/** Walks the snapshotted roots. Loose files come first (as in Dropzone), then each directory. */
export async function* walkRoots(
  roots: RootInput[],
  o: ReadOptions,
): AsyncGenerator<SourceItem[], void, undefined> {
  const loose: Promise<SourceItem | null>[] = [];
  const dirs: DirectoryEntryLike[] = [];
  for (const root of roots) {
    if ('file' in root) {
      loose.push(
        Promise.resolve({ kind: 'file', file: root.file, path: root.file.name, fromFolder: false }),
      );
    } else if (root.entry.isDirectory) {
      if (o.folders) dirs.push(root.entry as DirectoryEntryLike);
    } else if (root.entry.isFile) {
      loose.push(readFile(root.entry as FileEntryLike, root.entry.name, false, o));
    }
  }
  if (loose.length) {
    const items = compact(await Promise.all(loose));
    if (items.length) yield items;
  }
  const ctx = { n: 0 };
  for (const dir of dirs) yield* walkDir(dir, entryPath(dir, ''), o, ctx);
}

async function* walkDir(
  dir: DirectoryEntryLike,
  path: string,
  o: ReadOptions,
  ctx: { n: number },
): AsyncGenerator<SourceItem[], void, undefined> {
  const start = ctx.n;
  const subdirs: [DirectoryEntryLike, string][] = [];
  let entryCount = 0;
  let failed = false;
  let reader: DirectoryReaderLike | undefined;
  try {
    reader = dir.createReader();
  } catch (error) {
    o.onError?.(error, path);
    failed = true;
  }
  while (reader) {
    let batch: EntryLike[];
    try {
      batch = await readEntries(reader);
    } catch (error) {
      o.onError?.(error, path);
      failed = true;
      break;
    }
    if (!batch.length) break;
    entryCount += batch.length;
    const reads: Promise<SourceItem | null>[] = [];
    for (const entry of batch) {
      const p = entryPath(entry, path);
      if (entry.isDirectory) {
        subdirs.push([entry as DirectoryEntryLike, p]);
      } else if (entry.isFile && !(o.ignoreHiddenFiles && entry.name.charAt(0) === '.')) {
        reads.push(readFile(entry as FileEntryLike, p, true, o));
      }
    }
    if (reads.length) {
      const items = compact(await Promise.all(reads));
      if (items.length) {
        ctx.n += items.length;
        yield items;
      }
    }
  }
  if (o.folders) for (const [sub, p] of subdirs) yield* walkDir(sub, p, o, ctx);
  if (ctx.n === start && !(failed && entryCount === 0)) {
    ctx.n++;
    yield [{ kind: 'folder', path, raw: entryCount === 0 }];
  }
}

/** The entry's `fullPath` when it is consistent with its name, else parent path + name. */
function entryPath(entry: EntryLike, parent: string): string {
  const full = typeof entry.fullPath === 'string' ? normalizePath(entry.fullPath) : '';
  return full && basename(full) === entry.name ? full : joinPath(parent, entry.name);
}

function readEntries(reader: DirectoryReaderLike): Promise<EntryLike[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries((entries) => resolve(Array.prototype.slice.call(entries)), reject);
  });
}

function readFile(
  entry: FileEntryLike,
  path: string,
  fromFolder: boolean,
  o: ReadOptions,
): Promise<SourceItem | null> {
  return new Promise((resolve) => {
    const fail = (error: unknown): void => {
      o.onError?.(error, path);
      resolve(null);
    };
    try {
      entry.file((file) => resolve({ kind: 'file', file, path, fromFolder }), fail);
    } catch (error) {
      fail(error);
    }
  });
}

function compact(items: (SourceItem | null)[]): SourceItem[] {
  const out: SourceItem[] = [];
  for (const item of items) if (item) out.push(item);
  return out;
}
