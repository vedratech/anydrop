// Turns a drop into source items: the dropped files, and the files and empty folders found by
// walking the dropped directories (`webkitGetAsEntry()` entries).
//
// A drop has to be read synchronously, before the event handler returns (`snapshotDataTransfer`);
// the directories can be walked afterwards (`walkRoots`).
import { normalizePath } from '../util/path';
import type {
  BaseEntryLike,
  DataTransferLike,
  DirectoryEntryLike,
  DirectoryReaderLike,
  EntryLike,
  FileEntryLike,
  ReadOptions,
  RootInput,
  SourceItem,
} from './types';

/** Reads what a drop holds right now. Folders stay entries (walked later), files become `File`s. */
export function snapshotDataTransfer(data: DataTransferLike): RootInput[] {
  const roots: RootInput[] = [];
  const items = data.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (item.kind === 'string') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) {
        roots.push({ entry: entry as EntryLike });
        continue;
      }
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
      if (file) roots.push({ file });
      else if (entry) roots.push({ entry: entry as EntryLike });
    }
    return roots;
  }
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) roots.push({ file: files[i]! });
  }
  return roots;
}

/** Name-based path of an entry: its `fullPath` when that agrees with its name, else `parent/name`. */
function pathOfEntry(entry: BaseEntryLike, parent: string): string {
  const full = typeof entry.fullPath === 'string' ? normalizePath(entry.fullPath) : '';
  if (full && full.split('/').pop() === entry.name) return full;
  return normalizePath(parent ? parent + '/' + entry.name : entry.name);
}

const isHidden = (name: string): boolean => name.startsWith('.');

function readFileOf(entry: FileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    try {
      entry.file(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function readBatch(getReader: () => DirectoryReaderLike): Promise<EntryLike[]> {
  return new Promise((resolve, reject) => {
    try {
      getReader().readEntries(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

type DirTask = { entry: DirectoryEntryLike; path: string };

/**
 * Walks one directory: its files (one array per `readEntries()` call that held files), then its
 * subdirectories in listing order. Returns whether anything was found in the directory or below
 * it; if not, and nothing failed to read, the directory itself is yielded as an empty `folder`.
 */
async function* walkDirectory(
  dir: DirTask,
  options: ReadOptions,
): AsyncGenerator<SourceItem[], boolean> {
  const fail = (error: unknown, path: string): void => options.onError?.(error, path);
  let reader: DirectoryReaderLike | undefined;
  const subdirs: DirTask[] = [];
  let listed = 0;
  let found = false;
  let failed = false;
  for (;;) {
    let batch: EntryLike[];
    try {
      batch = await readBatch(() => (reader ??= dir.entry.createReader()));
    } catch (error) {
      fail(error, dir.path);
      failed = true;
      break;
    }
    if (batch.length === 0) break;
    listed += batch.length;
    const files: SourceItem[] = [];
    for (const child of batch) {
      const path = pathOfEntry(child, dir.path);
      if (child.isDirectory) {
        subdirs.push({ entry: child as DirectoryEntryLike, path });
      } else if (child.isFile && !(options.ignoreHiddenFiles && isHidden(child.name))) {
        try {
          const file = await readFileOf(child as FileEntryLike);
          files.push({ kind: 'file', file, path, fromFolder: true });
        } catch (error) {
          fail(error, path);
        }
      }
    }
    if (files.length > 0) {
      found = true;
      yield files;
    }
  }
  for (const sub of subdirs) {
    if (yield* walkDirectory(sub, options)) found = true;
  }
  if (!found && !failed) {
    yield [{ kind: 'folder', path: dir.path, raw: listed === 0 }];
    return true;
  }
  return found;
}

/**
 * Walks the dropped items. Yields arrays of items as they are found: first all dropped files in
 * one array, then each dropped directory depth first (see `walkDirectory`). Browsers return at
 * most about 100 entries per `readEntries()` call, so it is called until it returns an empty
 * array. A file or directory that cannot be read goes to `onError` and the walk carries on.
 */
export async function* walkRoots(
  roots: readonly RootInput[],
  options: ReadOptions,
): AsyncGenerator<SourceItem[]> {
  const dropped: SourceItem[] = [];
  const directories: DirTask[] = [];
  for (const root of roots) {
    if ('file' in root) {
      dropped.push({ kind: 'file', file: root.file, path: root.file.name, fromFolder: false });
      continue;
    }
    const entry = root.entry;
    if (entry.isFile) {
      const path = normalizePath(entry.name);
      try {
        const file = await readFileOf(entry as FileEntryLike);
        dropped.push({ kind: 'file', file, path, fromFolder: false });
      } catch (error) {
        options.onError?.(error, path);
      }
    } else if (entry.isDirectory && options.folders) {
      directories.push({ entry: entry as DirectoryEntryLike, path: pathOfEntry(entry, '') });
    }
  }
  if (dropped.length > 0) yield dropped;
  for (const dir of directories) yield* walkDirectory(dir, options);
}
