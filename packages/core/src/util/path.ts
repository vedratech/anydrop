// Path helpers: `/` separators, no leading slash, no `.` or empty segments.
// No Unicode normalisation: names are kept exactly as the browser gives them.

/** `'\\a//./b/'` → `'a/b'`. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/** `'a/b/c'` → `'a/b'`, `'c'` → `''`. */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** `'a/b/c'` → `'c'`. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir && name ? dir + '/' + name : dir || name;
}

/**
 * Path sent on the wire (`adRelativePath`, manifest): the folder part of `relativePath`
 * plus `upload.filename`, so `renameFile()` changes only the last segment.
 */
export function sentRelativePath(file: {
  relativePath: string;
  upload: { filename: string };
}): string {
  return joinPath(dirname(file.relativePath), file.upload.filename);
}
