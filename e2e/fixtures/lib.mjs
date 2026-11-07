// Shared helpers for the fixture generator, the compare script and the e2e tests.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Deterministic PRNG (mulberry32). Same seed gives the same tree on every machine. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    bytes(n) {
      const buf = Buffer.allocUnsafe(n);
      for (let i = 0; i < n; i += 4) {
        const v = Math.floor(next() * 4294967296);
        for (let j = 0; j < 4 && i + j < n; j++) buf[i + j] = (v >>> (j * 8)) & 0xff;
      }
      return buf;
    },
  };
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Walk a directory. Returns `{ files: [{ path, size, sha256 }], folders: [path] }`
 * with `/` separators, sorted by path. Empty folders are included in `folders`.
 */
export async function walkTree(root, { hash = true } = {}) {
  const files = [];
  const folders = [];
  async function rec(dir, prefix) {
    const items = await readdir(dir, { withFileTypes: true });
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const it of items) {
      const rel = prefix ? `${prefix}/${it.name}` : it.name;
      const full = join(dir, it.name);
      if (it.isDirectory()) {
        folders.push(rel);
        await rec(full, rel);
      } else if (it.isFile()) {
        const st = await stat(full);
        files.push({ path: rel, size: st.size, sha256: hash ? await sha256File(full) : undefined });
      }
    }
  }
  await rec(root, '');
  return { files, folders };
}

/**
 * Compare two trees from `walkTree`. Returns a list of human-readable differences (empty = equal).
 * `prefix` is prepended to every expected path before looking it up in `actual`.
 */
export function diffTrees(expected, actual, { prefix = '' } = {}) {
  const diffs = [];
  const pre = (p) => (prefix ? `${prefix}/${p}` : p);
  const aFiles = new Map(actual.files.map((f) => [f.path, f]));
  const aFolders = new Set(actual.folders);
  for (const f of expected.files) {
    const got = aFiles.get(pre(f.path));
    if (!got) diffs.push(`missing file: ${f.path}`);
    else if (got.size !== f.size)
      diffs.push(`size differs: ${f.path} (expected ${f.size}, got ${got.size})`);
    else if (f.sha256 && got.sha256 !== f.sha256) diffs.push(`sha256 differs: ${f.path}`);
    aFiles.delete(pre(f.path));
  }
  for (const d of expected.folders) {
    if (!aFolders.has(pre(d))) diffs.push(`missing folder: ${d}`);
    aFolders.delete(pre(d));
  }
  for (const [p] of aFiles) diffs.push(`unexpected file: ${p}`);
  for (const p of aFolders) diffs.push(`unexpected folder: ${p}`);
  return diffs;
}
