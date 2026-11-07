#!/usr/bin/env node
/**
 * Deterministic test-folder generator. Output goes to e2e/fixtures/generated (gitignored).
 *
 *   pnpm fixtures [--files 1000] [--depth 4] [--empty 5] [--wide 120] [--large 0]
 *                 [--large-mb 1024] [--max-kb 8] [--seed 1337] [--out <dir>]
 *
 * Writes:
 *   <out>/tree/               the nested folder to upload (the root folder is named "tree")
 *   <out>/tree.manifest.json  expected files (path, size, sha256) and folders, relative to <out>
 *   <out>/large/              `--large N` sparse files of `--large-mb` MB each (hash on demand)
 *
 * The tree contains: nested folders down to `--depth`, `--empty` empty folders (some nested), one
 * folder with `--wide` entries (more than 100, to exercise readEntries batching), zero-byte files,
 * names with spaces and non-ASCII characters, and files of random size up to `--max-kb`.
 * The same seed always produces the same tree and bytes.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const int = (k, d) => (args[k] === undefined ? d : Number.parseInt(String(args[k]), 10));
const opts = {
  files: int('files', 1000),
  depth: int('depth', 4),
  empty: int('empty', 5),
  wide: int('wide', 120),
  large: int('large', 0),
  largeMb: int('large-mb', 1024),
  maxKb: int('max-kb', 8),
  seed: int('seed', 1337),
};
const outDir = resolve(args.out ? String(args.out) : join(HERE, 'generated'));
for (const [k, v] of Object.entries(opts)) {
  if (!Number.isFinite(v) || v < 0) {
    console.error(`Invalid value for --${k}`);
    process.exit(2);
  }
}

const NAMES = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'photos 2024',
  'résumé',
  '日本語',
  'docs',
  'src',
  'ünïcödé',
  'misc',
  'a b c',
];
const EXTS = ['txt', 'bin', 'json', 'png', 'pdf', 'md', 'heic', 'csv'];

const rng = makeRng(opts.seed);
const manifest = { seed: opts.seed, root: 'tree', files: [], folders: ['tree'] };

// 1. Folder skeleton: the root has 4 children, deeper folders 1 to 3, down to opts.depth.
const dirs = ['tree'];
function grow(prefix, level) {
  if (level >= opts.depth) return;
  const n = level === 0 ? 4 : rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const name = `${NAMES[rng.int(0, NAMES.length - 1)]}-${level}${i}`;
    const rel = `${prefix}/${name}`;
    dirs.push(rel);
    grow(rel, level + 1);
  }
}
grow('tree', 0);

// 2. Empty folders, some at the top and some nested.
const emptyDirs = [];
for (let i = 0; i < opts.empty; i++) {
  const parent = dirs[rng.int(0, dirs.length - 1)];
  emptyDirs.push(`${parent}/empty-${i}${i % 2 ? ' (nothing here)' : ''}`);
}
// 3. One wide folder with more than 100 entries.
const wideDir = opts.wide > 0 ? 'tree/wide-folder' : null;

await rm(outDir, { recursive: true, force: true });
const allDirs = [...dirs, ...emptyDirs, ...(wideDir ? [wideDir] : [])];
for (const d of allDirs) {
  await mkdir(join(outDir, d), { recursive: true });
  if (d !== 'tree') manifest.folders.push(d);
}

async function writeSmall(rel) {
  const size = rng.next() < 0.05 ? 0 : rng.int(1, Math.max(1, opts.maxKb * 1024));
  const data = rng.bytes(size);
  await writeFile(join(outDir, rel), data);
  manifest.files.push({ path: rel, size, sha256: createHash('sha256').update(data).digest('hex') });
}

let counter = 0;
const fileName = () => {
  const n = counter++;
  return `${NAMES[n % NAMES.length]} file-${String(n).padStart(5, '0')}.${EXTS[n % EXTS.length]}`;
};

let remaining = opts.files;
if (wideDir) {
  const count = Math.max(opts.wide, 101);
  for (let i = 0; i < count; i++) {
    await writeSmall(`${wideDir}/${fileName()}`);
    remaining--;
  }
}
while (remaining > 0) {
  const dir = dirs[rng.int(0, dirs.length - 1)];
  await writeSmall(`${dir}/${fileName()}`);
  remaining--;
}

manifest.files.sort((a, b) => (a.path < b.path ? -1 : 1));
manifest.folders.sort();
await writeFile(join(outDir, 'tree.manifest.json'), JSON.stringify(manifest, null, 1));

// 4. Large sparse files. Never committed: the output directory is gitignored.
async function makeSparse(path, sizeBytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '');
  if (process.platform === 'win32') {
    try {
      execFileSync('fsutil', ['sparse', 'setflag', path], { stdio: 'ignore' });
    } catch {
      /* not sparse: the file will take real disk space */
    }
  }
  await truncate(path, sizeBytes);
  // Seeded non-zero bytes at the start, middle and end so hashes and offsets mean something.
  const fd = openSync(path, 'r+');
  try {
    for (const pos of [0, Math.floor(sizeBytes / 2), Math.max(0, sizeBytes - 64)]) {
      const len = Math.min(64, sizeBytes - pos);
      writeSync(fd, rng.bytes(64), 0, len, pos);
    }
    // A distinct marker in every MiB, so a chunk sent at the wrong offset or twice changes the hash.
    for (let pos = 1048576 + 13; pos + 16 <= sizeBytes; pos += 1048576) {
      writeSync(fd, rng.bytes(16), 0, 16, pos);
    }
  } finally {
    closeSync(fd);
  }
}
for (let i = 0; i < opts.large; i++) {
  await makeSparse(join(outDir, 'large', `large-${i}.bin`), opts.largeMb * 1024 * 1024);
}

console.log(
  `Generated ${manifest.files.length} files, ${manifest.folders.length} folders ` +
    `(${emptyDirs.length} empty), ${opts.large} large file(s) in ${outDir}`,
);
