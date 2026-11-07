// M5, decision 0017: offline, lie-fi, stalls, server restarts, outages. Everything goes through the
// demo page (the folder tree zone) and ends the same way: the received tree equals the source
// (SHA-256), no error entry was caused by connectivity, and only the missing chunks were sent again
// (WebKit may commit an aborted chunk twice, decision 0015).
//
// The features under test (core: `stallTimeout`, the 'unreachable' state, probing, `reconnect()`,
// `getConnectionState()`, the `reconnecting` event; ui: the connection banner and "Waiting for
// connection" rows) are being built. Until they exist, every test is `test.fixme` (detected at run
// time, so the tests switch on by themselves as the features land).
import { diffTrees } from '../fixtures/lib.mjs';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { test, expect, type IsolatedMock } from './support/mock';
import {
  abortCount,
  addFolder,
  completedPaths,
  expectedTree,
  onlyProjects,
  connectivityBuilt,
  expectAllUploaded,
  generateTree,
  heldChunks,
  openDemo,
  spyAborts,
  uploadPosts,
  waitForReport,
  type Generated,
} from './support/ui';

const ZONE = '#tree-zone';
const TREE_ARGS = [
  '--files',
  '14',
  '--depth',
  '2',
  '--empty',
  '1',
  '--wide',
  '0',
  '--max-kb',
  '700',
];

type Tree = {
  setOption(n: string, v: unknown): void;
  getConnectionState?: () => { state: string; attempt: number; retryAt: number | null };
  reconnect?: () => void;
  getErrors(): unknown[];
  on(e: string, fn: (...a: unknown[]) => void): unknown;
  options: Record<string, unknown>;
};
type W = { anydrop: { tree: Tree }; __rc: Array<[number, number]>; __lifecycle: string[] };

const heldTotal = (r: Awaited<ReturnType<IsolatedMock['report']>>) =>
  r.uploads.reduce((n, u) => n + u.received.length, 0);
const duplicates = (r: Awaited<ReturnType<IsolatedMock['report']>>) =>
  r.uploads.reduce((n, u) => n + u.duplicateChunkWrites, 0);

/** The connectivity features exist in this build (core and ui). Otherwise the test is fixme. */
async function requireFeatures(page: Page): Promise<void> {
  const ready = await connectivityBuilt(page);
  test.fixme(!ready, 'pending decision 0017: connectivity handling (core and ui) is not built yet');
  // Record the lifecycle events for the assertions below.
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__rc = [];
    w.__lifecycle = [];
    const t = w.anydrop.tree;
    t.on('reconnecting', (...a) => w.__rc.push([a[0] as number, a[1] as number]));
    t.on('paused', (...a) => w.__lifecycle.push('paused:' + (a[0] as { reason?: string }).reason));
    t.on('resumed', (...a) =>
      w.__lifecycle.push('resumed:' + (a[0] as { reason?: string }).reason),
    );
  });
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as W).anydrop.tree.getConnectionState!());
const errorCount = (page: Page) =>
  page.evaluate(() => (window as unknown as W).anydrop.tree.getErrors().length);
const lifecycle = (page: Page) => page.evaluate(() => (window as unknown as W).__lifecycle);
const reconnecting = (page: Page) => page.evaluate(() => (window as unknown as W).__rc);

const banner = (page: Page) => page.locator(`${ZONE} .ad-banner`);
const offlineText = (page: Page) =>
  banner(page)
    .and(page.locator('[data-state=offline]'))
    .getByText(/you are offline/i);
const unreachableText = (page: Page) =>
  banner(page)
    .and(page.locator('[data-state=unreachable]'))
    .getByText(/connection lost\. retrying in \d+ s/i);
const waitingRows = (page: Page) =>
  page.locator(`${ZONE} .ad-file-row .ad-badge`, { hasText: /waiting for connection/i });
const retryNow = (page: Page) => banner(page).locator('[data-ad-action=retry-now]');

/** Starts a run: demo opened, features present, folder added, some chunks already on the server. */
async function begin(
  page: Page,
  mock: IsolatedMock,
  g: Generated,
  opts: { chunks?: number; latency?: number } = {},
): Promise<void> {
  await openDemo(page, mock);
  await requireFeatures(page);
  await mock.configure({ latencyMs: opts.latency ?? 120 });
  await addFolder(page, ZONE, g);
  if (opts.chunks) await waitForReport(mock, (r) => heldTotal(r) >= opts.chunks!);
}

/** URLs that start with `base + path`; a trailing `$` in `path` means "ends there". */
function urlStartsWith(base: string, path: string): RegExp {
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = path.endsWith('$');
  return new RegExp(`^${esc(base)}${esc(exact ? path.slice(0, -1) : path)}${exact ? '$' : ''}`);
}

/**
 * Network-level kill switch: while down, every request to the mock's /upload* fails with no HTTP
 * response. The route exists only while down, so that normal traffic is never intercepted (in
 * Playwright's WebKit, intercepted uploads are where the sporadic empty chunk body was seen,
 * WEBKIT-FLAKE-1). With `only` set the route stays installed and aborts just the chunks of that file.
 */
async function lieFi(page: Page, mock: IsolatedMock) {
  const flags = {
    down: false,
    pings: 0,
    statuses: 0,
    chunkPosts: 0,
    only: null as string | null,
    async set(down: boolean): Promise<void> {
      if (down === flags.down) return;
      flags.down = down;
      if (down) await page.route(re, handler);
      else if (flags.only === null) await page.unroute(re, handler);
    },
  };
  const re = urlStartsWith(mock.url, '/upload');
  const handler = async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const isPing = path === '/upload/ping';
    const isStatus = path === '/upload/status';
    const isChunk = path === '/upload' && req.method() === 'POST';
    const hit =
      flags.down &&
      (flags.only === null ||
        (isChunk && (req.postDataBuffer()?.toString('latin1') ?? '').includes(flags.only)));
    if (isPing && flags.down) flags.pings++;
    if (isStatus && flags.down) flags.statuses++;
    if (isChunk && flags.down) flags.chunkPosts++;
    if (hit) return route.abort('internetdisconnected');
    return route.continue();
  };
  return flags;
}

/** The common ending of every scenario. */
async function finish(
  page: Page,
  mock: IsolatedMock,
  g: Generated,
  opts: { allowDuplicates?: number; browserName?: string; expectTree?: Generated['tree'] } = {},
): Promise<void> {
  await expectAllUploaded(page, ZONE, g.tree.files.length);
  const report = await mock.report();
  expect(diffTrees(opts.expectTree ?? expectedTree(page, g), report.merged)).toEqual([]);
  expect(await errorCount(page)).toBe(0);
  expect(await state(page)).toMatchObject({ state: 'online' });
  await expect(page.locator(`${ZONE} .ad-errors`)).toBeHidden();
  const allow =
    (opts.allowDuplicates ?? 0) + (opts.browserName === 'webkit' ? await abortCount(page) : 0);
  expect(duplicates(report)).toBeLessThanOrEqual(allow);
}

/** Chunks the server held at `snapshot` are not sent again (bar `allow` raced commits). */
function resentSince(
  snapshot: Awaited<ReturnType<IsolatedMock['report']>>,
  log: Awaited<ReturnType<IsolatedMock['log']>>,
  logAt: number,
) {
  const held = heldChunks(snapshot);
  const done = completedPaths(snapshot);
  return uploadPosts(log.slice(logAt)).filter(
    (e) => held.has(`${e.relativePath}#${e.chunkIndex}`) || done.has(e.relativePath ?? ''),
  );
}

const withTree = async (fn: (g: Generated) => Promise<void>, args = TREE_ARGS) => {
  const g = await generateTree(args);
  try {
    await fn(g);
  } finally {
    await g.cleanup();
  }
};

/** Sets `navigator.onLine` false in the page and clears it, without blocking the network. */
const setOffline = (ctx: BrowserContext, v: boolean) => ctx.setOffline(v);

test.describe('connectivity (decision 0017)', () => {
  // WEBKIT-FLAKE-1: now and then, only in WebKit and only under load, one chunk of a file arrives with an
  // empty body (the server answers 400 INVALID_CHUNK "length 0") and that file fails. It could not be
  // reproduced with a minimal XHR/FormData/Blob.slice probe, and it is not triggered by the library
  // retrying. The webkit and iphone projects retry twice (see playwright.config.ts) so it shows up as
  // "flaky"; in any other project an empty-body 400 is a failure and a core bug (decision 0019).

  test.beforeEach(async ({ page }) => {
    await spyAborts(page); // counts xhr.abort() calls: WebKit may commit an aborted chunk (0015)
    test.setTimeout(240_000);
    // The logic under test is engine independent core code. Chromium and WebKit run it (WebKit also
    // aborts differently, decision 0015); Firefox, and the iphone and pixel projects (the same two
    // engines with a phone viewport) skip it to keep the matrix short. The raw engine differences are
    // recorded on all five projects by connectivity-engines.spec.ts.
    onlyProjects(
      ['chromium', 'webkit'],
      'connectivity logic is engine independent; chromium and webkit cover it (see connectivity-engines.spec.ts for all engines)',
    );
  });

  test('1 offline mid-upload: banner, "Waiting for connection", nothing sent, resumes by itself', async ({
    page,
    context,
    mock,
    browserName,
  }) => {
    await withTree(async (g) => {
      await begin(page, mock, g, { chunks: 6 });
      await setOffline(context, true);
      await expect(offlineText(page)).toBeVisible({ timeout: 20_000 });
      await expect(waitingRows(page).first()).toBeVisible();
      expect((await state(page)).state).toBe('offline');
      await page.waitForTimeout(700);
      const snapshot = await mock.report();
      const logAt = (await mock.log()).length;
      await page.waitForTimeout(900);
      expect((await mock.log()).length).toBe(logAt); // nothing is sent while offline
      expect(await errorCount(page)).toBe(0);
      await setOffline(context, false);
      await expect(offlineText(page)).toBeHidden({ timeout: 20_000 });
      await finish(page, mock, g, { allowDuplicates: 2, browserName });
      expect(resentSince(snapshot, await mock.log(), logAt).length).toBeLessThanOrEqual(2);
      expect(await lifecycle(page)).toEqual(
        expect.arrayContaining(['paused:offline', 'resumed:offline']),
      );
    });
  });

  for (const withProbe of [true, false]) {
    test(`2 lie-fi ${withProbe ? 'with' : 'without'} connectivityProbeUrl: unreachable after 3 failures, countdown, no retries used, probe brings it back`, async ({
      page,
      mock,
    }) => {
      await withTree(async (g) => {
        await begin(page, mock, g);
        if (withProbe) {
          await page.evaluate(
            (u) => (window as unknown as W).anydrop.tree.setOption('connectivityProbeUrl', u),
            `${mock.url}/upload/ping`,
          );
        }
        const net = await lieFi(page, mock);
        await waitForReport(mock, (r) => heldTotal(r) >= 6);
        const snapshot = await mock.report();
        const logAt = (await mock.log()).length;
        await net.set(true); // navigator.onLine stays true
        await expect(unreachableText(page)).toBeVisible({ timeout: 30_000 });
        expect((await state(page)).state).toBe('unreachable');
        await expect(retryNow(page)).toBeVisible();
        await expect(waitingRows(page).first()).toBeVisible();
        expect(await page.evaluate(() => navigator.onLine)).toBe(true);
        // Probing with backoff: `reconnecting` events keep coming, still no error entries.
        await expect
          .poll(async () => (await reconnecting(page)).length, { timeout: 30_000 })
          .toBeGreaterThanOrEqual(2);
        const rc = await reconnecting(page);
        expect(rc[1]![0]).toBeGreaterThan(rc[0]![0]);
        expect(await errorCount(page)).toBe(0);
        await expect(page.locator(`${ZONE} .ad-errors`)).toBeHidden();
        // The probe: HEAD ping when configured, otherwise the chunk status of the failed file.
        if (withProbe) expect(net.pings).toBeGreaterThan(0);
        else {
          expect(net.pings).toBe(0);
          expect(net.statuses).toBeGreaterThan(0);
        }
        await net.set(false); // the link is back: the next probe succeeds
        await expect(unreachableText(page)).toBeHidden({ timeout: 40_000 });
        await finish(page, mock, g);
        // Nothing reached the server while down. At most the requests already on the wire when the
        // outage began may commit without the client seeing the answer, and be sent again.
        expect(resentSince(snapshot, await mock.log(), logAt).length).toBeLessThanOrEqual(2);
        expect(await lifecycle(page)).toEqual(
          expect.arrayContaining(['paused:unreachable', 'resumed:unreachable']),
        );
      });
    });
  }

  test('3 a stalled request (no response ever) is aborted as STALLED, retried, and succeeds', async ({
    page,
    mock,
  }) => {
    await withTree(async (g) => {
      await openDemo(page, mock);
      await requireFeatures(page);
      await mock.configure({ latencyMs: 60 });
      await page.evaluate(() =>
        (window as unknown as W).anydrop.tree.setOption('stallTimeout', 2000),
      );
      const held: Route[] = [];
      const re = urlStartsWith(mock.url, '/upload$');
      // Installed only while holding, so normal uploads are never intercepted (WEBKIT-FLAKE-1).
      const holder = async (route: Route) => {
        if (route.request().method() === 'POST') {
          held.push(route); // never answered
          return;
        }
        return route.continue();
      };
      const failed: number[] = [];
      page.on('requestfailed', (r) => {
        if (r.url() === `${mock.url}/upload`) failed.push(Date.now());
      });
      await addFolder(page, ZONE, g);
      await waitForReport(mock, (r) => heldTotal(r) >= 6);
      const snapshot = await mock.report();
      const logAt = (await mock.log()).length;
      await page.route(re, holder);
      // The watchdog aborts the held requests (2 s without progress, at most 4 x that after the body).
      await expect.poll(() => failed.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      expect(held.length).toBeGreaterThanOrEqual(1);
      await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2); // the retry
      expect(await errorCount(page)).toBe(0);
      await page.unroute(re, holder);
      for (const r of held.splice(0)) await r.abort('failed').catch(() => undefined);
      await finish(page, mock, g);
      // At most the requests that were already on the wire when the hold began (they may commit on the
      // server while the client never sees the answer); the held ones never reach the server.
      expect(resentSince(snapshot, await mock.log(), logAt).length).toBeLessThanOrEqual(2);
    });
  });

  test('4 the mock server is stopped mid-upload and restarted on the same port: the upload recovers by itself', async ({
    page,
    mock,
  }) => {
    await withTree(async (g) => {
      await begin(page, mock, g, { chunks: 6 });
      await mock.stop(); // connection refused
      await expect(unreachableText(page)).toBeVisible({ timeout: 40_000 });
      expect(await errorCount(page)).toBe(0);
      const snapshot = await mock.report().catch(() => null);
      await page.waitForTimeout(2500);
      await mock.restart();
      await expect(unreachableText(page)).toBeHidden({ timeout: 60_000 });
      await finish(page, mock, g, { allowDuplicates: 2 });
      expect(snapshot).toBeNull(); // the mock was really down while we looked
    });
  });

  test('5 offline at start: files wait as paused, nothing is sent or fails, the upload starts when online', async ({
    page,
    context,
    mock,
  }) => {
    await withTree(async (g) => {
      await openDemo(page, mock);
      await requireFeatures(page);
      await setOffline(context, true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await addFolder(page, ZONE, g);
      await expect(offlineText(page)).toBeVisible({ timeout: 20_000 });
      await expect(waitingRows(page).first()).toBeVisible();
      await page.waitForTimeout(1500);
      expect((await mock.log()).length).toBe(0);
      expect(await errorCount(page)).toBe(0);
      await setOffline(context, false);
      await finish(page, mock, g);
    });
  });

  for (const stage of ['manifest', 'finalize'] as const) {
    test(`6 offline during the ${stage} request: the batch does not fail, the request is sent again`, async ({
      page,
      context,
      mock,
      browserName,
    }) => {
      await withTree(async (g) => {
        await openDemo(page, mock);
        await requireFeatures(page);
        await mock.configure({ latencyMs: 40 });
        let attempts = 0;
        await page.route(`${mock.url}/upload/${stage}`, async (route) => {
          attempts++;
          if (attempts === 1) {
            await context.setOffline(true);
            return route.abort('internetdisconnected');
          }
          return route.continue();
        });
        await addFolder(page, ZONE, g);
        await expect.poll(() => attempts, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
        await expect(offlineText(page)).toBeVisible({ timeout: 20_000 });
        expect(await errorCount(page)).toBe(0);
        await page.waitForTimeout(800);
        await setOffline(context, false);
        await finish(page, mock, g, { allowDuplicates: 2, browserName });
        expect(attempts).toBeGreaterThanOrEqual(2); // sent again after reconnecting
        const sentOk = (await mock.log()).filter(
          (e) => e.path === `/upload/${stage}` && e.status === 200,
        );
        expect(sentOk.length).toBeGreaterThanOrEqual(1);
      });
    });
  }

  test('7 reload during an outage, then the link is back and the same folder is picked: finished work is skipped', async ({
    page,
    mock,
  }) => {
    // Playwright's setOffline also blocks the page load, so the outage is a network kill switch
    // that leaves the demo page itself reachable.
    await withTree(async (g) => {
      await begin(page, mock, g);
      const net = await lieFi(page, mock);
      await waitForReport(
        mock,
        (r) =>
          r.uploads.filter((u) => u.complete).length >= 3 &&
          r.uploads.some((u) => !u.complete && u.received.length > 0),
      );
      await net.set(true);
      await expect(unreachableText(page)).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await expect(page.getByTestId('version')).toHaveText(/^\d+\.\d+\.\d+/);
      await requireFeatures(page);
      await page.waitForTimeout(600);
      const snapshot = await mock.report();
      const logAt = (await mock.log()).length;
      await addFolder(page, ZONE, g); // still down: the files wait
      await expect(waitingRows(page).first()).toBeVisible({ timeout: 40_000 });
      expect(await errorCount(page)).toBe(0);
      await net.set(false);
      await finish(page, mock, g);
      const done = completedPaths(snapshot);
      const held = heldChunks(snapshot);
      for (const p of uploadPosts((await mock.log()).slice(logAt))) {
        expect(done.has(p.relativePath ?? '')).toBe(false);
        expect(held.has(`${p.relativePath}#${p.chunkIndex}`)).toBe(false);
      }
    });
  });

  test('8 a long outage (over 2 minutes of probing, on a fake clock) ends by itself', async ({
    page,
    mock,
  }) => {
    await withTree(async (g) => {
      await page.clock.install();
      await begin(page, mock, g, { chunks: 4 });
      await page.evaluate(
        (u) => (window as unknown as W).anydrop.tree.setOption('connectivityProbeUrl', u),
        `${mock.url}/upload/ping`,
      );
      const net = await lieFi(page, mock);
      await net.set(true);
      await expect(unreachableText(page)).toBeVisible({ timeout: 30_000 });
      // 3 virtual minutes: each step lets due probes fire, then lets the failed ones come back.
      for (let i = 0; i < 40; i++) {
        await page.clock.runFor(5000);
        await page.waitForTimeout(60);
      }
      expect((await reconnecting(page)).length).toBeGreaterThanOrEqual(6);
      const delays = (await reconnecting(page)).map((r) => r[1]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(60_000); // the probe delay is capped
      expect(await errorCount(page)).toBe(0);
      expect((await state(page)).state).toBe('unreachable');
      await net.set(false);
      for (let i = 0; i < 20 && (await state(page)).state !== 'online'; i++) {
        await page.clock.runFor(5000);
        await page.waitForTimeout(100);
      }
      await finish(page, mock, g);
    });
  });

  test('8b @slow a real 2 minute outage', async ({ page, mock }) => {
    test.skip(!process.env.AD_SLOW, 'set AD_SLOW=1 to run the real-time 2 minute outage');
    test.setTimeout(400_000);
    await withTree(async (g) => {
      await begin(page, mock, g, { chunks: 4 });
      const net = await lieFi(page, mock);
      await net.set(true);
      await expect(unreachableText(page)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(130_000);
      expect(await errorCount(page)).toBe(0);
      await net.set(false);
      await expect(unreachableText(page)).toBeHidden({ timeout: 90_000 });
      await finish(page, mock, g);
    });
  });

  test('9 "Retry now" probes at once; with the outage still on no retry is used up', async ({
    page,
    mock,
  }) => {
    await withTree(async (g) => {
      await begin(page, mock, g);
      await page.evaluate(
        (u) => (window as unknown as W).anydrop.tree.setOption('connectivityProbeUrl', u),
        `${mock.url}/upload/ping`,
      );
      const net = await lieFi(page, mock);
      await waitForReport(mock, (r) => heldTotal(r) >= 4);
      await net.set(true);
      await expect(retryNow(page)).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < 6; i++) {
        const before = net.pings;
        await retryNow(page).click();
        await expect.poll(() => net.pings, { timeout: 10_000 }).toBeGreaterThan(before);
        await expect(retryNow(page)).toBeVisible(); // still unreachable
      }
      expect(await errorCount(page)).toBe(0);
      await expect(page.locator(`${ZONE} .ad-file-row[data-status=error]`)).toHaveCount(0);
      await net.set(false);
      await retryNow(page).click();
      await expect(unreachableText(page)).toBeHidden({ timeout: 30_000 });
      await finish(page, mock, g);
    });
  });

  for (const status of [500, 429]) {
    test(`10 a ${status} storm does not make the connection "unreachable": normal retries, normal errors`, async ({
      page,
      mock,
    }) => {
      await withTree(async (g) => {
        await begin(page, mock, g, { chunks: 4 });
        await mock.configure({
          failRate: 1,
          failStatus: status,
          failRetryAfter: status === 429 ? 1 : 0,
        });
        const seen = new Set<string>();
        await expect
          .poll(
            async () => {
              seen.add((await state(page)).state);
              return page.evaluate(() => (window as unknown as W).anydrop.tree.getErrors().length);
            },
            { timeout: 120_000, intervals: [250] },
          )
          .toBeGreaterThan(0); // retries ran out: real errors, as in 0007
        expect([...seen]).toEqual(['online']);
        await expect(unreachableText(page)).toBeHidden();
        await expect(offlineText(page)).toBeHidden();
        await mock.configure({ failRate: 0, failRetryAfter: 0 });
        await page.locator(`${ZONE} .ad-toolbar [data-ad-action=retry-failed]`).click();
        await expectAllUploaded(page, ZONE, g.tree.files.length);
        expect(diffTrees(expectedTree(page, g), (await mock.report()).merged)).toEqual([]);
      });
    });
  }

  test('11 one file that can never succeed while the probe answers: it ends in error after its retries, the rest finish (loop guard)', async ({
    page,
    mock,
  }) => {
    await withTree(async (g) => {
      await openDemo(page, mock);
      await requireFeatures(page);
      await mock.configure({ latencyMs: 40 });
      await page.evaluate(
        (u) => (window as unknown as W).anydrop.tree.setOption('connectivityProbeUrl', u),
        `${mock.url}/upload/ping`,
      );
      const bad = g.tree.files.filter((f) => f.size > 100_000)[0]!;
      const badName = bad.path.slice(bad.path.lastIndexOf('/') + 1);
      const net = await lieFi(page, mock);
      net.only = badName;
      await net.set(true);
      await addFolder(page, ZONE, g);
      await expect(page.locator(`${ZONE} .ad-errors`)).toBeVisible({ timeout: 180_000 });
      const everyoneElse = g.treeWithoutEmptyFolders.files.filter((f) => f.path !== bad.path);
      await expect(page.locator(`${ZONE} .ad-summary`)).toContainText(
        `${g.tree.files.length - 1} of ${g.tree.files.length} uploaded, 1 failed`,
        { timeout: 120_000 },
      );
      expect(await errorCount(page)).toBe(1);
      const report = await mock.report();
      expect(
        diffTrees(
          { files: everyoneElse, folders: [] },
          { files: report.merged.files, folders: [] },
        ),
      ).toEqual([]);
    });
  });

  for (const when of ['before', 'during'] as const) {
    test(`12 "Retry now" with a folder paused by the user ${when} the outage: the others resume, the folder stays paused`, async ({
      page,
      mock,
    }) => {
      await withTree(async (g) => {
        await begin(page, mock, g, { chunks: 4, latency: 250 });
        await page.evaluate(
          (u) => (window as unknown as W).anydrop.tree.setOption('connectivityProbeUrl', u),
          `${mock.url}/upload/ping`,
        );
        const net = await lieFi(page, mock);
        const zone = page.locator(ZONE);
        const rows = zone.locator('.ad-folder-row');
        /** The first folder row below the root with a pause button. */
        const pausableSub = async () => {
          for (let i = 1; i < (await rows.count()); i++) {
            if (await rows.nth(i).locator('[data-ad-action=pause]').isVisible()) return rows.nth(i);
          }
          return null;
        };
        if (when === 'before') {
          const sub = (await pausableSub()) ?? rows.nth(1);
          await sub.locator('[data-ad-action=pause]').click();
          await expect(sub.locator('.ad-badge')).toHaveText('Paused');
          await net.set(true);
          await expect(retryNow(page)).toBeVisible({ timeout: 60_000 });
        } else {
          await net.set(true);
          await expect(retryNow(page)).toBeVisible({ timeout: 60_000 });
        }
        if (when === 'during') {
          // Decision 0019: a folder can be paused through the UI while the banner is showing.
          const found = await pausableSub();
          test.fixme(
            !found,
            'pending decision 0019: the ui hides the pause buttons while files wait for the connection',
          );
          await found!.locator('[data-ad-action=pause]').click();
          await expect(found!.locator('.ad-badge')).toHaveText('Paused'); // not "Waiting for connection"
        }
        await net.set(false);
        await retryNow(page).click();
        await expect(unreachableText(page)).toBeHidden({ timeout: 30_000 });
        await expect(
          rows.filter({ has: page.locator('.ad-badge', { hasText: /^Paused$/ }) }).first(),
        ).toBeVisible();
        await page.waitForTimeout(500);
        // The others finish (everything except the paused folder); the folder stays paused.
        const paused = rows.filter({ has: page.locator('.ad-badge', { hasText: /^Paused$/ }) });
        await expect(paused.first()).toBeVisible();
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const t = (window as unknown as W).anydrop.tree as unknown as {
                  getUploadingFiles(): unknown[];
                  getQueuedFiles(): unknown[];
                };
                return t.getUploadingFiles().length + t.getQueuedFiles().length;
              }),
            { timeout: 120_000 },
          )
          .toBe(0);
        await expect(paused.first()).toBeVisible(); // still paused after the others are done
        // Only the folder the user paused has a Resume button (the root row shows "Paused" too, but
        // as a roll-up of its files).
        await rows.locator('[data-ad-action=resume]:visible').first().click();
        await finish(page, mock, g);
      });
    });
  }
});
