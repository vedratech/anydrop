// M2 done-when (internal/IMPLEMENTATION.md, decisions 0001/0010): the built core alone, in a real browser,
// uploads a generated folder tree to an isolated mock server and the server holds the exact tree
// (paths, sizes, SHA-256, empty folders). Concurrency limits are checked on both sides:
// files uploading <= parallelUploads, POSTs per file <= the per-file limit, total POSTs <=
// maxChunksInFlight when set, and <= 2 with default options.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { diffTrees, walkTree, type Tree } from '../fixtures/lib.mjs';
import { test, expect } from './support/mock';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_IIFE = join(HERE, '..', '..', 'packages', 'core', 'dist', 'index.global.js');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'core engine e2e runs once, in chromium');
});

async function generate(args: string[]): Promise<{ out: string; source: Tree }> {
  const out = await mkdtemp(join(tmpdir(), 'anydrop-core-e2e-'));
  execFileSync(
    process.execPath,
    [join(HERE, '..', 'fixtures', 'generate.mjs'), '--out', out, ...args],
    {
      stdio: 'pipe',
    },
  );
  const walked = await walkTree(out);
  const source = {
    files: walked.files.filter((f) => f.path.startsWith('tree/')),
    folders: walked.folders.filter((f) => f === 'tree' || f.startsWith('tree/')),
  };
  return { out, source };
}

/** Opens a page on the mock's origin (same-origin requests) and loads the built core IIFE. */
async function openCore(page: Page, mockUrl: string): Promise<void> {
  await page.goto(`${mockUrl}/__health`);
  await page.addScriptTag({ path: CORE_IIFE });
}

interface PageResult {
  maxUploading: number;
  maxInFlight: number;
  maxPerFile: number;
  statuses: Record<string, number>;
  errors: unknown[];
  queuecomplete: number;
  sessionIds: string[];
}

/**
 * Runs in the page: builds mocked FileSystemEntry objects (readEntries returns at most 100 per
 * call, like Chrome) from the given files and folders, drops them on a fresh AnyDropCore, wraps the
 * built-in XHR transport to measure requests in flight, and resolves on `queuecomplete`.
 */
async function runInPage(
  page: Page,
  files: Array<{ path: string; b64: string }>,
  folders: string[],
  options: Record<string, unknown>,
  input: 'drop' | 'none' = 'drop',
): Promise<PageResult> {
  return page.evaluate(
    async ({ files, folders, options, input }) => {
      type Entry = Record<string, unknown>;
      type Core = {
        on(e: string, fn: (...a: unknown[]) => void): unknown;
        addDataTransfer(dt: unknown): Promise<unknown[]>;
        addFromInput(i: unknown): Promise<unknown[]>;
        getUploadingFiles(): unknown[];
        files: Array<{ status: string }>;
      };
      type Mod = {
        AnyDropCore: new (o: Record<string, unknown>) => Core;
        xhrTransport: { send(r: Record<string, unknown>): { promise: Promise<unknown> } };
      };
      const mod = (globalThis as unknown as { AnyDropCore: Mod }).AnyDropCore;
      const res = {
        maxUploading: 0,
        maxInFlight: 0,
        maxPerFile: 0,
        statuses: {} as Record<string, number>,
        errors: [] as unknown[],
        queuecomplete: 0,
        sessionIds: [] as string[],
      };
      let inFlight = 0;
      const perFile = new Map<string, number>();
      const transport = {
        send(req: Record<string, unknown>) {
          const isUpload = req.body instanceof FormData;
          let key = '';
          const before = req.beforeSend as ((x: unknown) => void) | undefined;
          req.beforeSend = (x: unknown) => {
            if (before) before(x);
            if (!isUpload) return;
            const fd = req.body as FormData;
            key = String(fd.get('adUploadId') || fd.get('adRelativePath'));
            const sid = String(fd.get('adSessionId'));
            if (!res.sessionIds.includes(sid)) res.sessionIds.push(sid);
            inFlight++;
            res.maxInFlight = Math.max(res.maxInFlight, inFlight);
            perFile.set(key, (perFile.get(key) || 0) + 1);
            res.maxPerFile = Math.max(res.maxPerFile, perFile.get(key) as number);
          };
          const h = mod.xhrTransport.send(req);
          void h.promise.then(() => {
            if (!isUpload) return;
            inFlight--;
            perFile.set(key, (perFile.get(key) as number) - 1);
          });
          return h;
        },
      };
      const core = new mod.AnyDropCore({ ...options, transport });
      const track = () => {
        res.maxUploading = Math.max(res.maxUploading, core.getUploadingFiles().length);
      };
      core.on('processing', track);
      core.on('uploadprogress', track);
      core.on('error', (f, m) =>
        res.errors.push([(f as { relativePath: string }).relativePath, m]),
      );
      const done = new Promise<void>((resolve) =>
        core.on('queuecomplete', () => {
          res.queuecomplete++;
          resolve();
        }),
      );

      const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (input === 'drop') {
        // Mocked entries: a directory reader returns at most 100 entries per call, asynchronously.
        const kids = new Map<string, Entry[]>();
        const dir = (path: string): Entry => {
          const children: Entry[] = [];
          kids.set(path, children);
          return {
            isFile: false,
            isDirectory: true,
            name: path.slice(path.lastIndexOf('/') + 1),
            fullPath: '/' + path,
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
        };
        const roots: Entry[] = [];
        const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
        for (const d of [...folders].sort()) {
          const e = dir(d);
          const parent = parentOf(d);
          if (parent) (kids.get(parent) as Entry[]).push(e);
          else roots.push(e);
        }
        for (const f of files) {
          const name = f.path.slice(f.path.lastIndexOf('/') + 1);
          const file = new File([bytes(f.b64)], name, { lastModified: 1_700_000_000_000 });
          (kids.get(parentOf(f.path)) as Entry[]).push({
            isFile: true,
            isDirectory: false,
            name,
            fullPath: '/' + f.path,
            file: (ok: (x: File) => void) => setTimeout(() => ok(file), 0),
          });
        }
        await core.addDataTransfer({
          items: roots.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })),
        });
      } else {
        await core.addFromInput(document.querySelector('input[type=file]'));
      }
      await done;
      for (const f of core.files) res.statuses[f.status] = (res.statuses[f.status] || 0) + 1;
      return res;
    },
    { files, folders, options, input },
  );
}

async function filesOf(out: string, source: Tree) {
  return Promise.all(
    source.files.map(async (f) => ({
      path: f.path,
      b64: (await readFile(join(out, f.path))).toString('base64'),
    })),
  );
}

test('a dropped folder tree uploads in chunks and arrives identical, within every concurrency limit', async ({
  page,
  mock,
}) => {
  test.setTimeout(120_000);
  const { out, source } = await generate([
    '--files',
    '300',
    '--depth',
    '4',
    '--empty',
    '5',
    '--max-kb',
    '6',
  ]);
  try {
    expect(source.files.length).toBeGreaterThanOrEqual(300);
    expect(source.folders.some((f) => f.includes('empty-'))).toBe(true);
    expect(source.files.some((f) => f.size === 0)).toBe(true);
    await mock.configure({
      latencyMs: 3,
      latencyJitterMs: 10,
      // Deterministic failures: retried with backoff and Retry-After, so they leave no trace.
      failRules: [
        { where: 'chunk', chunkIndex: 1, status: 503, times: 2 },
        { where: 'chunk', chunkIndex: 2, status: 429, retryAfter: 1, times: 1 },
        { where: 'manifest', status: 500, times: 1 },
      ],
    });
    const files = await filesOf(out, source);
    await openCore(page, mock.url);
    const options = {
      url: `${mock.url}/upload`,
      manifestUrl: `${mock.url}/upload/manifest`,
      finalizeUrl: `${mock.url}/upload/finalize`,
      chunkStatusUrl: `${mock.url}/upload/status`,
      sendManifest: true,
      chunking: true,
      chunkSize: 1024,
      parallelUploads: 3,
      parallelChunkUploads: 2,
      maxChunksInFlight: 4,
    };
    const res = await runInPage(page, files, source.folders, options);

    expect(res.errors).toEqual([]);
    expect(res.statuses).toEqual({ success: source.files.length });
    expect(res.queuecomplete).toBe(1);
    expect(res.sessionIds).toHaveLength(1);

    const report = await mock.report(res.sessionIds[0]);
    const session = report.sessions[res.sessionIds[0]!]!;
    expect(diffTrees(source, { files: session.files, folders: session.folders })).toEqual([]);
    // One manifest per batch: the first attempt failed (500), the retry succeeded.
    const manifests = (await mock.log()).filter((e) => e.path === '/upload/manifest');
    expect(manifests.map((e) => e.status)).toEqual([500, 200]);
    expect(session.manifestCalls).toBe(1);
    expect(report.uploads.every((u) => u.complete)).toBe(true);
    expect(report.stats.injectedFailures).toBeGreaterThanOrEqual(3);

    // Limits: files uploading, POSTs per file, total POSTs (client side), total POSTs (server side).
    expect(res.maxUploading).toBeLessThanOrEqual(3);
    expect(res.maxUploading).toBeGreaterThan(1);
    expect(res.maxPerFile).toBeLessThanOrEqual(2);
    expect(res.maxInFlight).toBeLessThanOrEqual(4);
    expect(report.stats.maxInFlight).toBeLessThanOrEqual(4);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('with default options a folder picked through <input webkitdirectory> uploads whole files, at most 2 POSTs in flight', async ({
  page,
  mock,
}) => {
  test.setTimeout(120_000);
  const { out, source } = await generate([
    '--files',
    '120',
    '--depth',
    '3',
    '--empty',
    '0',
    '--max-kb',
    '4',
    '--wide',
    '10',
  ]);
  try {
    await mock.configure({ latencyMs: 5, latencyJitterMs: 10 });
    await openCore(page, mock.url);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      document.body.appendChild(input);
    });
    await page.setInputFiles('input[type=file]', join(out, 'tree'));
    const res = await runInPage(page, [], [], { url: `${mock.url}/upload` }, 'none');

    expect(res.errors).toEqual([]);
    expect(res.statuses).toEqual({ success: source.files.length });
    const report = await mock.report(res.sessionIds[0]);
    const session = report.sessions[res.sessionIds[0]!]!;
    // <input webkitdirectory> never reports empty folders, so only folders holding files are expected.
    const withFiles = source.folders.filter((d) =>
      source.files.some((f) => f.path.startsWith(d + '/')),
    );
    expect(diffTrees({ files: source.files, folders: withFiles }, session)).toEqual([]);
    expect(report.uploads.every((u) => u.totalChunks === 1)).toBe(true);
    expect(res.maxUploading).toBeLessThanOrEqual(2);
    expect(res.maxInFlight).toBeLessThanOrEqual(2);
    expect(report.stats.maxInFlight).toBeLessThanOrEqual(2);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
