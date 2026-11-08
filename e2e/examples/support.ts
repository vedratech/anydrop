// Helpers for the example-app specs (decision 0022 section 8.4): one shared mock upload server that the
// three example apps proxy /upload to, a uniquely named seeded folder per test (so tests that run in
// parallel never see each other's files), and checks made against what the server holds.
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { diffTrees } from '../fixtures/lib.mjs';
import type { Tree } from '../fixtures/lib.mjs';
import { expect, test } from '@playwright/test';
import { generateTree, type Generated } from '../tests/support/ui';
import type { MockLogEntry, MockReport } from '../tests/support/mock';

export { addFolder, expectedTree, isMobile } from '../tests/support/ui';
export { expect, test };

/** The mock server every example proxies to (set by playwright.examples.config.ts). */
export const MOCK = `http://localhost:${process.env.AD_PORT}`;

export interface Example {
  name: 'react-vite' | 'nextjs' | 'angular';
  url: string;
  /** The element the instance lives on (the host's inner div, 0022 4.3 and 5.3). */
  zone: string;
  /** True when the server sends the page as HTML that is then hydrated. */
  ssr: boolean;
  /** `.ad-root` elements on the page once hydrated (Next shows an extra server-rendered uploader). */
  roots: number;
  /** Test ids of the custom file row (renderFile / anyDropFile). */
  row: { context: string; contextText: string; focus: string };
  /** Test ids of the mounted / destroyed row-view counters. */
  counters: { mounted: string; destroyed: string };
  /** Language and theme values to switch to mid-upload, and the `lang` the UI should then carry. */
  locale: { value: string; lang: string };
}

export const EXAMPLES: Example[] = [
  {
    name: 'react-vite',
    url: `http://localhost:${process.env.EX_REACT_PORT}`,
    zone: '#uploader > div',
    ssr: false,
    roots: 1,
    row: { context: 'row-context', contextText: 'ctx:acme', focus: 'row-pause' },
    counters: { mounted: 'slot-mounted', destroyed: 'slot-destroyed' },
    locale: { value: 'de', lang: 'de' },
  },
  {
    name: 'nextjs',
    url: `http://localhost:${process.env.EX_NEXT_PORT}`,
    zone: '#uploader > div',
    ssr: true,
    roots: 2,
    row: { context: 'row-context', contextText: 'ctx:acme', focus: 'row-pause' },
    counters: { mounted: 'slot-mounted', destroyed: 'slot-destroyed' },
    locale: { value: 'de', lang: 'de' },
  },
  {
    name: 'angular',
    url: `http://localhost:${process.env.EX_NG_PORT}`,
    zone: '#zone > div',
    ssr: true,
    roots: 1,
    row: { context: 'row-theme', contextText: 'from-injected-service', focus: 'row-ping' },
    counters: { mounted: 'slot-mounts', destroyed: 'slot-destroys' },
    locale: { value: 'hi', lang: 'hi' },
  },
];

// -------------------------------------------------------------------------------- shared mock

const getJson = async <T>(path: string): Promise<T> =>
  (await fetch(MOCK + path)).json() as Promise<T>;
/** The mock's report; with a root folder name only what concerns that folder (cheap on a shared server). */
export const mockReport = (root?: string) =>
  getJson<MockReport>(`/__report${root ? `?prefix=${encodeURIComponent(root)}` : ''}`);
export const mockLog = (since = 0) => getJson<MockLogEntry[]>(`/__log?since=${since}`);
/** Sequence number of the newest request the mock has logged (a position to read the log from). */
export async function lastSeq(): Promise<number> {
  const log = await mockLog();
  return log.length ? log[log.length - 1]!.seq : 0;
}
export async function mockConfig(patch: Record<string, unknown>): Promise<void> {
  const r = await fetch(MOCK + '/__config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`mock /__config answered ${r.status}`);
}

// ----------------------------------------------------------------------------------- fixtures

export interface Folder extends Generated {
  root: string;
}

/**
 * A seeded folder (fixtures/generate.mjs) whose root folder has a name that is unique to this test,
 * so the shared mock can be asked about it alone. Paths of `tree` start with `root`.
 */
export async function generateFolder(
  args: string[],
  example: Example,
  info = test.info(),
): Promise<Folder> {
  const root = `x-${example.name}-${info.project.name}-${info.workerIndex}-${info.retry}-${Math.random().toString(36).slice(2, 7)}`;
  const g = await generateTree(['--wide', '0', ...args]);
  await rename(join(g.out, 'tree'), join(g.out, root));
  const re = (p: string) => root + p.slice('tree'.length);
  const map = (t: Tree): Tree => ({
    files: t.files.map((f) => ({ ...f, path: re(f.path) })),
    folders: t.folders.map(re),
  });
  return { ...g, root, tree: map(g.tree), treeWithoutEmptyFolders: map(g.treeWithoutEmptyFolders) };
}

/** What the shared mock holds under this folder's root (its report, narrowed to the root). */
export function serverTree(report: MockReport, root: string): Tree {
  const own = (p: string) => p === root || p.startsWith(root + '/');
  return {
    files: report.merged.files.filter((f) => own(f.path)),
    folders: report.merged.folders.filter(own),
  };
}

export const ownUploads = (report: MockReport, root: string) =>
  report.uploads.filter((u) => u.relativePath.startsWith(root + '/'));

/** Chunk and whole-file POSTs of this folder, from a log position. */
export const ownPosts = (log: MockLogEntry[], root: string) =>
  log.filter(
    (e) => e.method === 'POST' && e.path === '/upload' && e.relativePath?.startsWith(root + '/'),
  );

export async function expectServerTree(
  folder: Folder,
  expected: Tree,
  report?: MockReport,
): Promise<MockReport> {
  const r = report ?? (await mockReport(folder.root));
  expect(diffTrees(expected, serverTree(r, folder.root))).toEqual([]);
  return r;
}

/**
 * Waits for "N of N uploaded, 0 failed" in the toolbar. On failure the message carries the shared
 * mock's failing requests for this folder and says whether they look like WEBKIT-FLAKE-1 (decision 0019:
 * a chunk that reaches the server with an empty body in Playwright's WebKit).
 */
export async function expectUploaded(
  page: Page,
  example: Example,
  folder: Folder,
  timeout = 90_000,
): Promise<void> {
  const total = folder.tree.files.length;
  try {
    await expect(page.locator(`${example.zone} .ad-summary`)).toContainText(
      `${total} of ${total} uploaded, 0 failed`,
      { timeout },
    );
  } catch (e) {
    const bad = (await mockLog()).filter(
      (l) => (l.status ?? 0) >= 400 && l.relativePath?.startsWith(folder.root + '/'),
    );
    const flake = bad.length > 0 && bad.every((l) => l.code === 'INVALID_CHUNK' && l.bytes === 0);
    const text = `${flake ? 'WEBKIT-FLAKE-1 (decision 0019): ' : 'NOT WEBKIT-FLAKE-1, possible product bug: '}${bad.length} failing requests for ${folder.root}: ${JSON.stringify(
      bad.slice(0, 6).map((l) => ({
        path: l.relativePath,
        chunk: l.chunkIndex,
        status: l.status,
        code: l.code,
        bytes: l.bytes,
      })),
    )}`;
    test
      .info()
      .annotations.push({ type: flake ? 'WEBKIT-FLAKE-1' : 'upload-failure', description: text });
    (e as Error).message += '\n' + text;
    throw e;
  }
}

/** Held chunks (all uploads) of one folder. */
export const heldCount = (report: MockReport, root: string) =>
  ownUploads(report, root).reduce((n, u) => n + u.received.length, 0);

export const duplicateWrites = (report: MockReport, root: string) =>
  ownUploads(report, root).reduce((n, u) => n + u.duplicateChunkWrites, 0);

/** Console messages that must not appear on a healthy page (errors and warnings). */
export function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') bad.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
  return bad;
}
