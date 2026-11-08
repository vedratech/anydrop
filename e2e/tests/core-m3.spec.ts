// M3 done-when (internal/IMPLEMENTATION.md, decisions 0004, 0007, 0008): the built core IIFE in a real
// browser against an isolated mock server.
//   (a) pause and resume at each level, in both pauseModes: no chunk is committed twice;
//   (b) offline then online (context.setOffline): only the missing chunks are sent;
//   (c) reload mid-upload and drop the same folder again: finished chunks and files are skipped,
//       with and without chunkStatusUrl;
//   (d) random chunk failures with few retries: the error list matches the failures exactly, and
//       retryFailedOnly() brings it to zero with a matching received tree.
/* eslint-disable @typescript-eslint/no-explicit-any -- page-side access to the untyped harness global */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { diffTrees, walkTree, type Tree } from '../fixtures/lib.mjs';
import { test, expect, type IsolatedMock, type MockLogEntry } from './support/mock';
import { openHarness, type FileState, type SentChunk } from './support/core-harness';

// The M3 resume and error scenarios run against the strict mock (decision 0016): every chunk and
// finalize must carry an uploadId announced in the session's latest manifest.
test.use({ mockOptions: { strictManifest: true } });

const HERE = dirname(fileURLToPath(import.meta.url));

type Payload = Array<{ path: string; b64: string }>;

/** A handmade tree of random files: the payload for the page and the expected tree. */
function handmade(
  files: Array<[string, number]>,
  folders: string[],
): { payload: Payload; tree: Tree } {
  const payload: Payload = [];
  const tree: Tree = { files: [], folders };
  for (const [path, size] of files) {
    const data = randomBytes(size);
    payload.push({ path, b64: data.toString('base64') });
    tree.files.push({ path, size, sha256: createHash('sha256').update(data).digest('hex') });
  }
  return { payload, tree };
}

/** A seeded generated tree (`fixtures/generate.mjs`): nested folders, empty folders, zero-byte files. */
async function generated(
  args: string[],
): Promise<{ payload: Payload; tree: Tree; cleanup: () => Promise<void> }> {
  const out = await mkdtemp(join(tmpdir(), 'anydrop-m3-e2e-'));
  execFileSync(
    process.execPath,
    [join(HERE, '..', 'fixtures', 'generate.mjs'), '--out', out, ...args],
    {
      stdio: 'pipe',
    },
  );
  const walked = await walkTree(out);
  const tree = {
    files: walked.files.filter((f) => f.path.startsWith('tree/')),
    folders: walked.folders.filter((f) => f === 'tree' || f.startsWith('tree/')),
  };
  const payload = await Promise.all(
    tree.files.map(async (f) => ({
      path: f.path,
      b64: (await readFile(join(out, f.path))).toString('base64'),
    })),
  );
  return { payload, tree, cleanup: () => rm(out, { recursive: true, force: true }) };
}

function urls(mock: IsolatedMock, statusUrl: boolean) {
  return {
    url: `${mock.url}/upload`,
    manifestUrl: `${mock.url}/upload/manifest`,
    finalizeUrl: `${mock.url}/upload/finalize`,
    chunkStatusUrl: statusUrl ? `${mock.url}/upload/status` : null,
    sendManifest: true,
  };
}

const state = (page: Page) =>
  page.evaluate(() => (window as never as { H: { state(): FileState[] } }).H.state());
const sent = (page: Page) =>
  page.evaluate(() => (window as never as { H: { sent: SentChunk[] } }).H.sent);

/** Starts the upload in the page without waiting for it to finish. */
async function start(
  page: Page,
  payload: Payload,
  folders: string[],
  options: Record<string, unknown>,
) {
  await page.evaluate(
    async ({ payload, folders, options }) => {
      const H = (window as never as { H: any }).H;
      const core = H.make(options);
      await core.addDataTransfer(H.dt(payload, folders));
    },
    { payload, folders, options },
  );
}

async function waitQueueComplete(page: Page, n = 1) {
  await page.waitForFunction((n) => (window as never as { H: { qc: number } }).H.qc >= n, n, {
    timeout: 90_000,
  });
}

/** Every committed chunk was written exactly once on the server. */
function duplicates(report: Awaited<ReturnType<IsolatedMock['report']>>): number {
  return report.uploads.reduce((n, u) => n + u.duplicateChunkWrites, 0);
}

// The third case is decision 0015: with chunkStatusUrl set, a resumed file asks the server what it
// holds, so the chunk WebKit still commits after an abort is skipped (0 duplicates, bar a commit that
// lands after the status answer).
const PAUSE_CASES = [
  { pauseMode: 'abort', withStatus: false },
  { pauseMode: 'finishChunk', withStatus: false },
  { pauseMode: 'abort', withStatus: true },
] as const;
for (const { pauseMode, withStatus } of PAUSE_CASES) {
  test(`(a) pause and resume at instance, folder and file level with pauseMode '${pauseMode}'${withStatus ? ' and chunkStatusUrl' : ''}: no chunk committed twice`, async ({
    page,
    mock,
    browserName,
  }) => {
    test.setTimeout(120_000);
    const folders = ['A', 'B', 'B/empty'];
    // With chunkStatusUrl a resumed file skips what the server holds, so give every file enough
    // chunks that the folder level still has work left when it is paused.
    const size = withStatus ? 8192 : 4096;
    const { payload, tree } = handmade(
      [
        ['A/a1.bin', size],
        ['A/a2.bin', size],
        ['B/b1.bin', size],
        ['c.bin', withStatus ? 1024 : size], // a root file is queued first: keep it short
      ],
      folders,
    );
    // Server-side latency: an aborted chunk is still waiting there, so it is never committed.
    await mock.configure({ latencyMs: 300 });
    await openHarness(page, mock.url);
    await start(page, payload, folders, {
      ...urls(mock, withStatus),
      chunking: true,
      chunkSize: 1024,
      parallelUploads: 1,
      pauseMode,
    });

    const res = await page.evaluate(async () => {
      const H = (window as never as { H: any }).H;
      const core = H.core;
      const out: Record<string, unknown> = {};
      /** Pauses ~60 ms after the next chunk POST left, so a request is in flight. */
      const pauseDuringNextSend = async (pause: (r: SentChunk) => void) => {
        const r = (await H.nextSend()) as SentChunk;
        await H.sleep(60);
        pause(r);
        return r;
      };
      // 1. Instance.
      await H.until(() => H.acked().length >= 2);
      await pauseDuringNextSend(() => core.pause());
      // Every file that is not finished is paused (a short root file may already be done).
      const live = core.files.filter((f: { status: string }) => f.status !== 'success').length;
      out.allPaused =
        core.getUploadingFiles().length === 0 && live > 0 && core.getPausedFiles().length === live;
      await H.until(() => H.inFlight === 0);
      const n = H.sent.length;
      await H.sleep(800);
      out.idleWhilePaused = H.sent.length === n;
      core.resume();
      // 2. Folder: pausing A frees the slot for a file outside A.
      const r2 = await pauseDuringNextSend(() => core.pauseFolder('A'));
      out.pausedFolderWasA = r2.path.startsWith('A/');
      const other = (await H.nextSend()) as SentChunk;
      out.otherStarted = !other.path.startsWith('A/');
      out.folderStatus = core.getFolder('A').status;
      core.resumeFolder('A');
      // 3. File.
      const r3 = await pauseDuringNextSend((r: SentChunk) =>
        core.pauseFile(core.files.find((f: { relativePath: string }) => f.relativePath === r.path)),
      );
      const next = (await H.nextSend()) as SentChunk;
      out.slotReleasedByFile = next.path !== r3.path;
      core.resumeFile(core.files.find((f: { relativePath: string }) => f.relativePath === r3.path));
      await H.until(() => H.qc >= 1);
      out.events = H.events;
      out.errors = core.getErrors();
      return out;
    });

    expect(res).toMatchObject({
      allPaused: true,
      idleWhilePaused: true,
      pausedFolderWasA: true,
      otherStarted: true,
      folderStatus: 'paused',
      slotReleasedByFile: true,
      errors: [],
    });
    expect(res.events).toEqual([
      'paused:all:user',
      'resumed:all:user',
      'paused:folder:A',
      'resumed:folder:A',
      expect.stringMatching(/^paused:file:/),
      expect.stringMatching(/^resumed:file:/),
    ]);
    expect((await state(page)).every((f) => f.status === 'success')).toBe(true);

    const chunks = await sent(page);
    const aborted = chunks.filter((c) => c.status === 'abort').length;
    if (pauseMode === 'abort') expect(aborted).toBeGreaterThanOrEqual(3);
    else expect(aborted).toBe(0);
    // Client side: no chunk was acknowledged twice.
    const acked = chunks.filter((c) => c.status === 200).map((c) => `${c.uploadId}#${c.index}`);
    expect(new Set(acked).size).toBe(acked.length);

    const report = await mock.report();
    if (browserName === 'webkit' && pauseMode === 'abort' && !withStatus) {
      // WebKit finding (M3, decision 0015): xhr.abort() on a request whose body was already sent
      // does not close the connection, so the server still commits that chunk and the resend writes
      // it again (idempotent, the file is still correct). Only chunks the client aborted can repeat.
      expect(duplicates(report)).toBeLessThanOrEqual(aborted);
    } else {
      expect(duplicates(report)).toBe(0);
    }
    const session = Object.values(report.sessions)[0]!;
    expect(diffTrees(tree, session)).toEqual([]);
  });
}

test('(b) offline then online: the upload pauses, and only the missing chunks are sent', async ({
  page,
  context,
  mock,
}) => {
  test.setTimeout(120_000);
  const folders = ['F'];
  const { payload, tree } = handmade(
    [
      ['F/1.bin', 8192],
      ['F/2.bin', 8192],
      ['F/3.bin', 8192],
    ],
    folders,
  );
  await mock.configure({ latencyMs: 150 });
  await openHarness(page, mock.url);
  await start(page, payload, folders, { ...urls(mock, false), chunking: true, chunkSize: 1024 });
  await page.waitForFunction(
    () => (window as never as { H: { acked(): unknown[] } }).H.acked().length >= 4,
  );

  await context.setOffline(true);
  await page.waitForFunction(() =>
    (window as never as { H: { events: string[] } }).H.events.includes('paused:all:offline'),
  );
  const before = await state(page);
  const sentBefore = (await sent(page)).length;
  const inFlightAtOffline = await page.evaluate(
    () => (window as never as { H: { maxInFlight: number } }).H.maxInFlight,
  );
  expect(before.every((f) => f.status === 'paused')).toBe(true);
  await page.waitForTimeout(800);
  expect((await sent(page)).length).toBe(sentBefore); // nothing is sent while offline

  await context.setOffline(false);
  await waitQueueComplete(page);

  const events = await page.evaluate(
    () => (window as never as { H: { events: string[] } }).H.events,
  );
  expect(events).toEqual(['offline', 'paused:all:offline', 'online', 'resumed:all:offline']);
  const after = await state(page);
  expect(after.every((f) => f.status === 'success')).toBe(true);
  // Only the missing chunks: nothing acknowledged before going offline is sent again.
  const resent = (await sent(page))
    .slice(sentBefore)
    .filter((c) => before.find((f) => f.uuid === c.uploadId)!.done.includes(c.index));
  expect(resent).toEqual([]);

  const report = await mock.report();
  // A chunk the server committed just as the connection dropped may come again (writes are idempotent).
  expect(duplicates(report)).toBeLessThanOrEqual(inFlightAtOffline);
  expect(diffTrees(tree, Object.values(report.sessions)[0]!)).toEqual([]);
});

for (const withStatus of [false, true]) {
  test(`(c) reload mid-upload and drop the folder again ${withStatus ? 'with' : 'without'} chunkStatusUrl: finished chunks and files are skipped`, async ({
    page,
    mock,
  }) => {
    test.setTimeout(150_000);
    const { payload, tree, cleanup } = await generated([
      '--files',
      '40',
      '--depth',
      '3',
      '--empty',
      '2',
      '--max-kb',
      '6',
      '--wide',
      '0',
    ]);
    try {
      const options = {
        ...urls(mock, withStatus),
        chunking: true,
        forceChunking: true, // every file has an uploadId the server knows (chunk status)
        chunkSize: 1024,
      };
      // Core must never fall back to memory here (it warns once when IndexedDB fails).
      const idbWarnings: string[] = [];
      page.on('console', (m) => {
        if (/IndexedDB/i.test(m.text())) idbWarnings.push(m.text());
      });
      await mock.configure({ latencyMs: 40, latencyJitterMs: 20 });
      await openHarness(page, mock.url);
      await start(page, payload, tree.folders, options);
      // Mid-upload: IndexedDB already holds finished files and at least one part-way file.
      await expect
        .poll(
          async () => {
            const recs = (await page.evaluate(() =>
              (window as never as { H: any }).H.records(),
            )) as Array<{ completed: boolean; chunksDone: number[] }>;
            const done = recs.filter((r) => r.completed).length;
            return (
              done >= payload.length / 4 &&
              recs.some((r) => !r.completed && r.chunksDone.length > 0)
            );
          },
          { timeout: 60_000, intervals: [20] },
        )
        .toBe(true);
      // Reload mid-upload (pagehide flushes the records), then a fresh page with a fresh core.
      await page.reload();
      await openHarness(page, mock.url);
      type Rec = { key: string; uploadId: string; chunksDone: number[]; completed: boolean };
      const records = (await page.evaluate(() =>
        (window as never as { H: { records(): Promise<unknown> } }).H.records(),
      )) as Rec[];
      const completed = records.filter((r) => r.completed);
      const partial = records.filter((r) => !r.completed && r.chunksDone.length > 0);
      expect(completed.length).toBeGreaterThan(0);
      expect(partial.length).toBeGreaterThan(0);
      const logBefore = (await mock.log()).length;

      await start(page, payload, tree.folders, options);
      await waitQueueComplete(page);

      const after = await state(page);
      expect(after.every((f) => f.status === 'success')).toBe(true);
      // Finished files: skipped, no upload POST.
      const second = await sent(page);
      expect(after.filter((f) => f.skipped).length).toBe(completed.length);
      for (const r of completed)
        expect(second.filter((c) => c.uploadId === r.uploadId)).toEqual([]);
      // Finished chunks of part-way files: never sent again.
      for (const r of partial) {
        const again = second.filter(
          (c) => c.uploadId === r.uploadId && r.chunksDone.includes(c.index),
        );
        expect(again).toEqual([]);
      }
      const statusGets = (await mock.log(0))
        .slice(logBefore)
        .filter((e) => e.path === '/upload/status');
      const report = await mock.report();
      if (withStatus) {
        // Asked only for the files being resumed; the server's answer covers chunks in flight at the reload.
        expect(statusGets.length).toBe(records.length);
        expect(duplicates(report)).toBe(0);
      } else {
        expect(statusGets).toEqual([]);
        // Without the server's answer, chunks in flight at the reload, or acknowledged after the
        // last record write, are sent again (0004 accepts a lagging record: writes are idempotent).
        // The guarantee checked above is that every recorded chunk and file is skipped.
      }
      expect(diffTrees(tree, report.merged)).toEqual([]);
      expect(idbWarnings).toEqual([]);
    } finally {
      await cleanup();
    }
  });
}

test('(d) with random chunk failures and few retries the error list matches the failures, and retryFailedOnly() clears it', async ({
  page,
  mock,
}) => {
  test.setTimeout(150_000);
  const { payload, tree, cleanup } = await generated([
    '--files',
    '60',
    '--depth',
    '3',
    '--empty',
    '2',
    '--max-kb',
    '8',
    '--wide',
    '0',
  ]);
  try {
    const forced = payload.find((f) => f.b64.length > 2000)!.path;
    await mock.configure({
      failRate: 0.1, // AD_FAIL_RATE
      latencyMs: 2,
      // At least one file fails for sure: its chunk 0 fails on both attempts.
      failRules: [{ where: 'chunk', relativePath: forced, chunkIndex: 0, status: 500, times: 2 }],
    });
    await openHarness(page, mock.url);
    await start(page, payload, tree.folders, {
      ...urls(mock, false),
      chunking: true,
      forceChunking: true,
      chunkSize: 1024,
      parallelUploads: 3,
      retryChunksLimit: 1,
      fastBackoff: true, // shortest backoff (0.5 s)
    });
    await waitQueueComplete(page);

    type Entry = {
      fileId: string;
      uploadId: string;
      relativePath: string;
      code: string;
      httpStatus: number;
      stage: string;
      chunkIndex: number;
      attempt: number;
      retryable: boolean;
    };
    const res = await page.evaluate(() => {
      const H = (window as never as { H: any }).H;
      return {
        errors: H.core.getErrors() as unknown[],
        lastErrors: H.lastErrors as unknown[],
        failedIds: H.core.getFilesWithStatus('error').map((f: { id: string }) => f.id) as string[],
      };
    });
    const errors = res.errors as Entry[];
    expect(errors.length).toBeGreaterThan(0);
    expect(res.lastErrors).toEqual(errors);
    expect(errors.map((e) => e.fileId).sort()).toEqual([...res.failedIds].sort());

    // From the server's log: a chunk failed for good when it has failures and no 200.
    const log: MockLogEntry[] = (await mock.log()).filter((e) => e.path === '/upload');
    const byChunk = new Map<string, MockLogEntry[]>();
    for (const e of log) {
      const k = `${e.uploadId}#${e.chunkIndex}`;
      byChunk.set(k, [...(byChunk.get(k) || []), e]);
    }
    const failedForGood = [...byChunk.values()].filter((es) => !es.some((e) => e.status === 200));
    expect(
      failedForGood.map((es) => [es[0]!.uploadId, es[0]!.chunkIndex, es.length]).sort(),
    ).toEqual(errors.map((e) => [e.uploadId, e.chunkIndex, e.attempt]).sort());
    for (const e of errors) {
      expect(e).toMatchObject({
        code: 'SERVER_ERROR',
        httpStatus: 500,
        stage: 'upload',
        attempt: 2,
        retryable: true,
      });
    }
    expect(errors.map((e) => e.relativePath)).toContain(forced);

    await mock.configure({ failRate: 0, failRules: [] });
    const requeued = await page.evaluate(() =>
      (window as never as { H: any }).H.core.retryFailedOnly(),
    );
    expect(requeued).toBe(errors.length);
    await waitQueueComplete(page, 2);
    const final = await page.evaluate(() => {
      const H = (window as never as { H: any }).H;
      return {
        errors: H.core.getErrors(),
        lastErrors: H.lastErrors,
        statuses: H.state().map((f: FileState) => f.status),
      };
    });
    expect(final.errors).toEqual([]);
    expect(final.lastErrors).toEqual([]);
    expect(final.statuses.every((s: string) => s === 'success')).toBe(true);
    const report = await mock.report();
    expect(duplicates(report)).toBe(0);
    const session = Object.values(report.sessions)[0]!;
    expect(diffTrees(tree, session)).toEqual([]);
  } finally {
    await cleanup();
  }
});
