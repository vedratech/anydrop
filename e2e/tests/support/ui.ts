// Helpers for the UI-level scenario specs: open the demo against an isolated mock, generate a seeded
// folder, load it through the folder picker or a synthetic folder drop (fake FileSystemEntry trees
// in a DataTransfer-like object), and read the server's view of the upload.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { walkTree, type Tree } from '../../fixtures/lib.mjs';
import { expect, test, type IsolatedMock, type MockLogEntry, type MockReport } from './mock';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_GENERATOR = join(HERE, '..', '..', 'fixtures', 'generate.mjs');

export const isMobile = (project: string) => /iphone|pixel/.test(project);

/** Opens the demo with its uploads pointed at the isolated mock. Returns the collected page errors. */
export async function openDemo(page: Page, mock: IsolatedMock): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?mock=${encodeURIComponent(mock.url)}`);
  await expect(page.getByTestId('version')).toHaveText(/^\d+\.\d+\.\d+/);
  return errors;
}

export interface Generated {
  /** The directory handed to the generator; the uploaded folder is `<out>/tree`. */
  out: string;
  /** What the server must end up with: paths start with `tree/`. */
  tree: Tree;
  /** What `<input webkitdirectory>` can report: no empty folders. */
  treeWithoutEmptyFolders: Tree;
  /** The folder's name under `out` when it was renamed from `tree` (example-app specs, unique roots). */
  root?: string;
  cleanup(): Promise<void>;
}

/** A seeded tree from `fixtures/generate.mjs` (the same arguments always give the same bytes). */
export async function generateTree(args: string[]): Promise<Generated> {
  const out = await mkdtemp(join(tmpdir(), 'anydrop-ui-scn-'));
  execFileSync(process.execPath, [FIXTURE_GENERATOR, '--out', out, ...args], { stdio: 'pipe' });
  const walked = await walkTree(out);
  const tree: Tree = {
    files: walked.files.filter((f) => f.path.startsWith('tree/')),
    folders: walked.folders.filter((f) => f === 'tree' || f.startsWith('tree/')),
  };
  const withFiles = tree.folders.filter((d) => tree.files.some((f) => f.path.startsWith(d + '/')));
  return {
    out,
    tree,
    treeWithoutEmptyFolders: { files: tree.files, folders: withFiles },
    cleanup: () => rm(out, { recursive: true, force: true }),
  };
}

/** Drops the generated folder on `zone` as a synthetic `drop` event with fake FileSystemEntry objects. */
export async function dropGenerated(page: Page, zone: string, g: Generated): Promise<void> {
  const files = await Promise.all(
    g.tree.files.map(async (f) => ({
      path: f.path,
      b64: (await readFile(join(g.out, f.path))).toString('base64'),
    })),
  );
  await page.evaluate(
    ({ zone, files, folders }) => {
      type Entry = Record<string, unknown>;
      const kids = new Map<string, Entry[]>();
      const roots: Entry[] = [];
      const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
      const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
      for (const d of [...folders].sort()) {
        const children: Entry[] = [];
        kids.set(d, children);
        const entry: Entry = {
          isFile: false,
          isDirectory: true,
          name: nameOf(d),
          fullPath: '/' + d,
          // Like Chrome: at most 100 entries per call, asynchronous, then an empty batch.
          createReader() {
            let i = 0;
            return {
              readEntries(ok: (e: Entry[]) => void) {
                setTimeout(() => {
                  ok(children.slice(i, i + 100));
                  i += 100;
                }, 0);
              },
            };
          },
        };
        const parent = parentOf(d);
        if (parent) (kids.get(parent) as Entry[]).push(entry);
        else roots.push(entry);
      }
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], nameOf(f.path), { lastModified: 1_700_000_000_000 });
        const entry: Entry = {
          isFile: true,
          isDirectory: false,
          name: nameOf(f.path),
          fullPath: '/' + f.path,
          file: (ok: (x: File) => void) => setTimeout(() => ok(file), 0),
        };
        const parent = parentOf(f.path);
        if (parent) (kids.get(parent) as Entry[]).push(entry);
        else roots.push(entry);
      }
      const e = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
        dataTransfer?: unknown;
      };
      e.dataTransfer = {
        types: ['Files'],
        files: [],
        items: roots.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
      };
      document.querySelector(zone)!.dispatchEvent(e);
    },
    { zone, files, folders: g.tree.folders },
  );
}

/**
 * Loads the folder through the UI the way a user would on this device: the folder picker when the
 * zone offers one, otherwise a folder drop. Returns which one was used.
 *
 * WebKit (Playwright's build): a Blob.slice() of a path-backed picked File is sent as an empty body,
 * so chunked uploads of picked files cannot work there (reproduced without AnyDrop, see
 * large-file.spec.ts). Unless `picker` is forced, WebKit gets a folder drop, whose Files are created
 * in the page.
 */
export async function addFolder(
  page: Page,
  zone: string,
  g: Generated,
  opts: { picker?: boolean } = {},
): Promise<'pick' | 'drop'> {
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  const done = (m: 'pick' | 'drop'): 'pick' | 'drop' => {
    lastMode.set(page, m);
    return m;
  };
  const input = page.locator(`${zone} input[data-ad-input=folder]`);
  const canPick =
    (await input.count()) > 0 &&
    (await page.locator(`${zone} [data-ad-action=pick-folder]`).isVisible());
  if (canPick && (opts.picker ?? !webkit)) {
    await input.setInputFiles(join(g.out, g.root ?? 'tree'));
    return done('pick');
  }
  await dropGenerated(page, zone, g);
  return done('drop');
}

const lastMode = new WeakMap<Page, 'pick' | 'drop'>();

/**
 * The tree the server must end up with for the way the folder was added: a folder drop reports empty
 * folders, `<input webkitdirectory>` cannot (so only folders that hold files are expected).
 */
export const expectedTree = (page: Page, g: Generated): Tree =>
  lastMode.get(page) === 'drop' ? g.tree : g.treeWithoutEmptyFolders;

/** Runs a test on the listed projects only; the others skip with the reason (documented skips). */
export function onlyProjects(projects: string[], reason: string): void {
  test.skip(!projects.includes(test.info().project.name), reason);
}

/** Number of chunk and whole-file POSTs the mock has seen (`/upload`), optionally from a log position. */
export const uploadPosts = (log: MockLogEntry[]) =>
  log.filter((e) => e.method === 'POST' && e.path === '/upload');

/** `path#chunkIndex` of every chunk the server holds, from the report (chunked uploads). */
export function heldChunks(report: MockReport): Set<string> {
  const s = new Set<string>();
  for (const u of report.uploads) for (const i of u.received) s.add(`${u.relativePath}#${i}`);
  return s;
}

export const completedPaths = (report: MockReport) =>
  new Set(report.uploads.filter((u) => u.complete).map((u) => u.relativePath));

/** Counts `xhr.abort()` calls on requests already sent (for the WebKit duplicate-write allowance). */
export async function spyAborts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __aborts: number };
    w.__aborts = 0;
    const abort = XMLHttpRequest.prototype.abort;
    XMLHttpRequest.prototype.abort = function () {
      if (this.readyState >= 2 || this.readyState === 1) w.__aborts++;
      return abort.call(this);
    };
  });
}
export const abortCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __aborts: number }).__aborts);

export const summary = (page: Page, zone: string) => page.locator(`${zone} .ad-summary`);

/**
 * What a failed "N of N uploaded, 0 failed" check needs to be understood from a CI log alone: the
 * error registry (code, message, httpStatus, relativePath, attempt), the connection state, and the
 * mock's log of requests with status >= 400 (with `bytes`) plus the requests right before the first
 * of them. Also attached as test annotations. Classifies the case from decision 0019.
 */
export async function describeFailure(
  page: Page,
  zone: string,
  mock?: IsolatedMock,
): Promise<string> {
  const name = zone.replace(/^#/, '').replace(/-zone$/, '');
  const inst = await page
    .evaluate((n) => {
      type I = { getErrors(): unknown[]; getConnectionState?: () => unknown };
      const i = (window as unknown as Record<string, Record<string, I>>).anydrop?.[n];
      return i ? { errors: i.getErrors(), connection: i.getConnectionState?.() ?? null } : null;
    }, name)
    .catch(() => null);
  const errors = (inst?.errors ?? []) as Array<{
    code?: string;
    message?: string;
    httpStatus?: number;
    relativePath?: string;
    attempt?: number;
    chunkIndex?: number;
    stage?: string;
    at?: number;
  }>;
  const log = mock ? await mock.log().catch(() => [] as MockLogEntry[]) : [];
  const bad = log.filter((e) => (e.status ?? 0) >= 400);
  const firstBad = bad.length ? log.indexOf(bad[0]!) : -1;
  const before = firstBad >= 0 ? log.slice(Math.max(0, firstBad - 12), firstBad) : [];
  const slim = (e: MockLogEntry) =>
    `#${e.seq} ${e.method} ${e.path} ${e.status ?? '-'}${e.code ? ' ' + e.code : ''}` +
    `${e.relativePath ? ' ' + e.relativePath : ''}${e.chunkIndex !== undefined ? ' chunk=' + e.chunkIndex : ''}` +
    `${e.bytes !== undefined ? ' bytes=' + e.bytes : ''}${e.bodyBytes !== undefined ? ' body=' + e.bodyBytes + '/CL=' + e.contentLength : ''}${e.ts ? ' t=' + (e.ts % 1_000_000) : ''}${e.note ? ' note=' + e.note : ''}`;
  // WEBKIT-FLAKE-1 (decision 0019): the only errors are 400 INVALID_CHUNK with an empty chunk body.
  const emptyBody = (m?: string) => /length 0 do not match/.test(m ?? '');
  const flake1 =
    errors.length > 0 &&
    errors.every(
      (e) => e.code === 'INVALID_CHUNK' && e.httpStatus === 400 && emptyBody(e.message),
    ) &&
    bad.every((e) => e.code === 'INVALID_CHUNK' && e.bytes === 0);
  const verdict = flake1
    ? 'WEBKIT-FLAKE-1 (decision 0019): every failure is 400 INVALID_CHUNK with an empty chunk body, a known WebKit test-browser artefact'
    : errors.length
      ? 'NOT WEBKIT-FLAKE-1: unexpected error codes or statuses, treat as a possible product bug'
      : 'no entries in the error registry: files are not failing with errors, look at the connection state and the server log';
  const text = [
    `verdict: ${verdict}`,
    `connection state: ${JSON.stringify(inst?.connection ?? null)}`,
    `error registry (${errors.length}): ${JSON.stringify(
      errors.map((e) => ({
        code: e.code,
        message: e.message,
        httpStatus: e.httpStatus,
        relativePath: e.relativePath,
        attempt: e.attempt,
        chunkIndex: e.chunkIndex,
        stage: e.stage,
        at: e.at,
      })),
    )}`,
    `mock log entries with status >= 400 (${bad.length}):\n  ${bad.map(slim).join('\n  ')}`,
    `mock log, the ${before.length} requests before the first of them:\n  ${before.map(slim).join('\n  ')}`,
  ].join('\n');
  try {
    const t = test.info();
    t.annotations.push({ type: flake1 ? 'WEBKIT-FLAKE-1' : 'upload-failure', description: text });
  } catch {
    /* not inside a test */
  }
  return text;
}

/** Waits until the zone's toolbar says every file is uploaded and none failed. */
export async function expectAllUploaded(
  page: Page,
  zone: string,
  total: number,
  timeout = 120_000,
  mock?: IsolatedMock,
): Promise<void> {
  try {
    await expect(summary(page, zone)).toContainText(`${total} of ${total} uploaded, 0 failed`, {
      timeout,
    });
  } catch (e) {
    (e as Error).message += '\n' + (await describeFailure(page, zone, mock));
    throw e;
  }
}

/** Polls the mock until `pred` holds for its report. */
export async function waitForReport(
  mock: IsolatedMock,
  pred: (r: MockReport) => boolean,
  timeout = 60_000,
): Promise<MockReport> {
  let last!: MockReport;
  await expect
    .poll(
      async () => {
        last = await mock.report();
        return pred(last);
      },
      { timeout, intervals: [50] },
    )
    .toBe(true);
  return last;
}

/**
 * Whether this build has the connectivity handling of decision 0017 (core `getConnectionState`,
 * `reconnect()`, `stallTimeout`; ui "Waiting for connection"). Once it does, a network that
 * returns no HTTP response at all is waited out instead of producing error entries.
 */
export const connectivityBuilt = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const t = (window as unknown as { anydrop: { tree: Record<string, unknown> } }).anydrop.tree;
    const o = t.options as Record<string, unknown>;
    return (
      typeof t.getConnectionState === 'function' &&
      typeof t.reconnect === 'function' &&
      'stallTimeout' in o &&
      'dictWaitingForConnection' in o
    );
  });

/** The resume records the library keeps in IndexedDB (decision 0004), read as a fresh page sees them. */
export const resumeRecords = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ uploadId: string; completed: boolean; chunksDone: number[] }>>(
        (resolve) => {
          const r = indexedDB.open('anydrop', 1);
          r.onupgradeneeded = () =>
            r.result.createObjectStore('uploads', { keyPath: 'key' }).createIndex('t', 'updatedAt');
          r.onerror = () => resolve([]);
          r.onsuccess = () => {
            const db = r.result;
            const g = db.transaction('uploads', 'readonly').objectStore('uploads').getAll();
            g.onsuccess = () => {
              db.close();
              resolve(g.result);
            };
          };
        },
      ),
  );
