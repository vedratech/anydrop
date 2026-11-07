// Reads a file input (`<input type=file multiple>`) or a folder input (`<input webkitdirectory>`).
// Folder inputs give each file a `webkitRelativePath` that starts with the picked folder's name.
// Browsers do not report empty folders through inputs; a folder whose only files were ignored
// hidden files is kept as a `folder` item, like in a drop walk.
import { dirname, normalizePath } from '../util/path';
import type { ReadOptions, SourceItem } from './types';

/** The files of an input element, or a FileList / array, snapshotted synchronously. */
export function snapshotFiles(input: { files?: ArrayLike<File> | null } | ArrayLike<File>): File[] {
  const list =
    typeof (input as ArrayLike<File>).length === 'number'
      ? (input as ArrayLike<File>)
      : (input as { files?: ArrayLike<File> | null }).files;
  return list ? Array.prototype.slice.call(list) : [];
}

/** Relative path of a picked file: its normalised `webkitRelativePath`, or its name. */
export function pathOfPickedFile(file: File): { path: string; fromFolder: boolean } {
  const rel =
    typeof file.webkitRelativePath === 'string' ? normalizePath(file.webkitRelativePath) : '';
  return rel.indexOf('/') > 0
    ? { path: rel, fromFolder: true }
    : { path: file.name, fromFolder: false };
}

export function readFileList(
  files: File[],
  o: Pick<ReadOptions, 'ignoreHiddenFiles'>,
): SourceItem[] {
  const out: SourceItem[] = [];
  let hiddenDirs: Set<string> | undefined;
  for (const file of files) {
    const { path, fromFolder } = pathOfPickedFile(file);
    if (fromFolder && o.ignoreHiddenFiles && file.name.charAt(0) === '.') {
      (hiddenDirs || (hiddenDirs = new Set())).add(dirname(path));
      continue;
    }
    out.push({ kind: 'file', file, path, fromFolder });
  }
  if (hiddenDirs) {
    // Folders that only held hidden files: keep them, unless something else creates them.
    const present = new Set<string>();
    for (const item of out) {
      for (let d = dirname(item.path); d && !present.has(d); d = dirname(d)) present.add(d);
    }
    // Innermost first, so a kept folder makes its kept parent unnecessary.
    const kept = Array.from(hiddenDirs).sort((a, b) => b.length - a.length);
    for (const d of kept) {
      if (present.has(d)) continue;
      out.push({ kind: 'folder', path: d, raw: false });
      for (let p = d; p && !present.has(p); p = dirname(p)) present.add(p);
    }
  }
  return out;
}
