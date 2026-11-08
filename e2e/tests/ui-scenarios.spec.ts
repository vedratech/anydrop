// M5: the verify-upload scenarios 1 to 5 and the internal/PLAN.md Verification bullets, driven through the
// demo page (the UI), never only through the headless core. An isolated mock server per test, a
// seeded folder from fixtures/generate.mjs, and every check made against what the server holds:
// paths, sizes, SHA-256, empty folders, and the request log.
//
//   S1  a 1,000+ file nested folder with empty folders: folder drop, and the folder picker
//   S2  the network dies mid-upload: offline auto-pause and resume; request failures, error list, retry
//   S3  pause and resume at file, folder and global level from the UI: no chunk committed twice
//   S4  reload mid-upload, pick the same folder again: finished files and chunks are skipped
//   S5  server errors on chunks: the error panel lists them, "Retry failed" resends only those
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { diffTrees, makeRng } from '../fixtures/lib.mjs';
import { test, expect, type MockReport } from './support/mock';
import {
  abortCount,
  addFolder,
  completedPaths,
  connectivityBuilt,
  dropGenerated,
  expectedTree,
  onlyProjects,
  expectAllUploaded,
  generateTree,
  heldChunks,
  openDemo,
  resumeRecords,
  spyAborts,
  uploadPosts,
  waitForReport,
} from './support/ui';

const ZONE = '#tree-zone';
type W = { anydrop: { tree: { getUploadingFiles(): unknown[] } } };

/** The panel list is virtualized, so read the full error list the way a user can: the CSV export. */
async function errorCsv(page: Page, panel: Locator): Promise<string> {
  const download = page.waitForEvent('download');
  await panel.locator('[data-ad-action=export-csv]').click();
  return readFile((await (await download).path())!, 'utf8');
}

const heldTotal = (r: MockReport) => r.uploads.reduce((n, u) => n + u.received.length, 0);
const duplicates = (r: MockReport) => r.uploads.reduce((n, u) => n + u.duplicateChunkWrites, 0);

test.describe('S1 a nested folder with 1,000+ files and empty folders', () => {
  test('folder drop: the server holds exactly the source tree (paths, SHA-256, empty folders)', async ({
    page,
    mock,
  }) => {
    test.setTimeout(300_000);
    onlyProjects(
      ['chromium', 'firefox', 'webkit', 'iphone'],
      'the 1,100 file drop is slow and the pixel project is the same engine as chromium (the 300 file picker test runs on all five)',
    );
    const g = await generateTree([
      '--files',
      '1100',
      '--depth',
      '4',
      '--empty',
      '5',
      '--wide',
      '120', // one folder with more than 100 entries: readEntries must be called in a loop
      '--max-kb',
      '4',
    ]);
    try {
      expect(g.tree.files.length).toBeGreaterThanOrEqual(1100);
      expect(g.tree.folders.filter((f) => f.includes('empty-')).length).toBe(5);
      expect(g.tree.files.some((f) => f.size === 0)).toBe(true);
      const errors = await openDemo(page, mock);
      await mock.configure({ latencyMs: 0 });
      await dropGenerated(page, ZONE, g);
      await expectAllUploaded(page, ZONE, g.tree.files.length, 240_000);
      const report = await mock.report();
      expect(diffTrees(g.tree, report.merged)).toEqual([]);
      expect(report.uploads.every((u) => u.complete)).toBe(true);
      expect(duplicates(report)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await g.cleanup();
    }
  });

  test('folder picker: <input webkitdirectory> uploads the exact tree (no empty folders: the picker cannot see them)', async ({
    page,
    mock,
  }) => {
    test.setTimeout(240_000);
    const g = await generateTree([
      '--files',
      '300',
      '--depth',
      '3',
      '--empty',
      '3',
      '--wide',
      '110',
      '--max-kb',
      '4',
    ]);
    try {
      await openDemo(page, mock);
      const zone = page.locator(ZONE);
      const picker = zone.locator('[data-ad-action=pick-folder]');
      test.skip(
        !(await picker.isVisible()),
        'the UI feature-detects webkitdirectory and offers no folder picker on this engine',
      );
      await addFolder(page, ZONE, g, { picker: true });
      await expectAllUploaded(page, ZONE, g.tree.files.length, 200_000);
      const report = await mock.report();
      expect(diffTrees(expectedTree(page, g), report.merged)).toEqual([]);
    } finally {
      await g.cleanup();
    }
  });
});

test.describe('S2 the network dies mid-upload', () => {
  test('offline then online: the UI pauses, nothing is sent offline, only missing chunks are sent after', async ({
    page,
    context,
    mock,
  }) => {
    test.setTimeout(180_000);
    const g = await generateTree([
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
    ]);
    try {
      await openDemo(page, mock);
      await mock.configure({ latencyMs: 120 });
      await addFolder(page, ZONE, g);
      await waitForReport(mock, (r) => heldTotal(r) >= 6);
      await context.setOffline(true);
      const zone = page.locator(ZONE);
      // The UI shows the pause: no row is uploading, and the toolbar offers Resume all.
      await expect(zone.locator('.ad-file-row[data-status=uploading]')).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(zone.locator('.ad-file-row[data-status=paused]').first()).toBeVisible();
      await expect(zone.locator('.ad-toolbar [data-ad-action=resume-all]')).toBeEnabled();
      // In-flight chunks settle on the server, then the log must stand still.
      await page.waitForTimeout(700);
      const snapshot = await mock.report();
      const logAt = (await mock.log()).length;
      await page.waitForTimeout(900);
      expect((await mock.log()).length).toBe(logAt);

      await context.setOffline(false);
      await expectAllUploaded(page, ZONE, g.tree.files.length);
      const report = await mock.report();
      expect(diffTrees(expectedTree(page, g), report.merged)).toEqual([]);
      // Only the missing chunks: nothing the server held at the snapshot is sent again (a chunk
      // that landed just as the connection dropped may come once per in-flight request).
      const held = heldChunks(snapshot);
      const done = completedPaths(snapshot);
      const resent = uploadPosts((await mock.log()).slice(logAt)).filter(
        (e) => held.has(`${e.relativePath}#${e.chunkIndex}`) || done.has(e.relativePath ?? ''),
      );
      expect(resent.length).toBeLessThanOrEqual(2);
      expect(duplicates(report)).toBeLessThanOrEqual(2);
    } finally {
      await g.cleanup();
    }
  });

  test('requests fail (connection killed): the error list shows them, and Retry failed sends only the missing chunks', async ({
    page,
    mock,
  }) => {
    test.setTimeout(180_000);
    const rng = makeRng(77);
    const files = Array.from({ length: 6 }, (_, i) => {
      const data = rng.bytes(96 * 1024 + i * 1000);
      return {
        name: `net-${i}.bin`,
        data,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    });
    await openDemo(page, mock);
    test.skip(
      await connectivityBuilt(page),
      'superseded by decision 0017: with connectivity handling a dead network is waited out ("unreachable"), ' +
        'it makes no error entries. That behaviour is covered in connectivity.spec.ts; error lists and ' +
        'retry are covered by S5.',
    );
    let killed = false;
    let passed = 0;
    // The network dies after the first 5 chunks went through, for every request after that.
    await page.route(`${mock.url}/upload`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (killed || passed >= 5) {
        killed = true;
        return route.abort('connectionfailed');
      }
      passed++;
      return route.continue();
    });
    const zone = page.locator('#errors-zone');
    await zone
      .locator('input[data-ad-input=files]')
      .setInputFiles(
        files.map((f) => ({ name: f.name, mimeType: 'application/octet-stream', buffer: f.data })),
      );
    const panel = zone.locator('.ad-errors');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel.locator('.ad-error-row').first()).toContainText('NETWORK');
    // Every file either finished or failed: the network is dead for the rest.
    await expect
      .poll(
        async () => {
          const m = /(\d+) of 6 uploaded, (\d+) failed/.exec(
            (await zone.locator('.ad-summary').textContent()) ?? '',
          );
          return m ? Number(m[1]) + Number(m[2]) : 0;
        },
        { timeout: 90_000 },
      )
      .toBe(6);
    const failed = await panel.locator('.ad-error-row').count();
    expect(failed).toBeGreaterThan(0);
    const csv = await errorCsv(page, panel);
    expect(csv.trim().split(/\r?\n/).length - 1).toBeGreaterThanOrEqual(failed);

    // The network comes back.
    await page.unroute(`${mock.url}/upload`);
    const before = await mock.report();
    const held = heldChunks(before);
    const logAt = (await mock.log()).length;
    await panel.locator('[data-ad-action=retry-failed]').click();
    await expect(zone.locator('.ad-summary')).toContainText(
      `${files.length} of ${files.length} uploaded, 0 failed`,
      {
        timeout: 60_000,
      },
    );
    await expect(panel).toBeHidden();
    const after = await mock.report();
    const posts = uploadPosts((await mock.log()).slice(logAt));
    // Only files that were listed as failed were sent again, and never a chunk the server held.
    for (const p of posts) {
      expect(csv, `${p.relativePath} was not in the error list`).toContain(String(p.relativePath));
      expect(held.has(`${p.relativePath}#${p.chunkIndex}`)).toBe(false);
    }
    expect(duplicates(after)).toBe(0);
    expect(
      diffTrees(
        {
          files: files.map((f) => ({ path: f.name, size: f.data.length, sha256: f.sha256 })),
          folders: [],
        },
        { files: after.merged.files, folders: [] },
      ),
    ).toEqual([]);
  });
});

test.describe('S3 pause and resume at file, folder and global level', () => {
  test('buttons in the UI: nothing is sent while paused, no chunk is committed twice, checksums match', async ({
    page,
    mock,
    browserName,
  }) => {
    test.setTimeout(240_000);
    await spyAborts(page);
    const g = await generateTree([
      '--files',
      '12',
      '--depth',
      '2',
      '--empty',
      '1',
      '--wide',
      '0',
      '--max-kb',
      '900',
    ]);
    try {
      await openDemo(page, mock);
      await mock.configure({ latencyMs: 400 });
      await addFolder(page, ZONE, g);
      const zone = page.locator(ZONE);
      const root = zone.locator('.ad-folder-row').first();
      await expect(root).toContainText('tree');
      const toolbar = zone.locator('.ad-toolbar');
      await waitForReport(mock, (r) => heldTotal(r) >= 3);

      /** The log must stand still: in-flight requests settle first, then nothing new arrives. */
      const expectIdle = async () => {
        await page.waitForTimeout(600);
        const n = (await mock.log()).length;
        await page.waitForTimeout(800);
        expect((await mock.log()).length).toBe(n);
      };

      // File level: pause one uploading file, the others keep going.
      await expect(zone.locator('.ad-file-row[data-status=uploading]').first()).toBeVisible();
      // The uploading file with the most chunks (it cannot finish before the click lands).
      const sizeOf = (n: string) =>
        g.tree.files.find((f) => f.path.endsWith('/' + n.trim()))?.size ?? 0;
      const names = await zone
        .locator('.ad-file-row[data-status=uploading] [data-dz-name]')
        .allTextContents();
      const fileName = [...names].sort((a, b) => sizeOf(b) - sizeOf(a))[0] ?? '';
      const fileRow = () =>
        zone
          .locator('.ad-file-row')
          .filter({ has: page.locator(`[data-dz-name]`, { hasText: fileName }) });
      await fileRow().locator('[data-ad-action=pause]').click();
      await expect(fileRow()).toHaveAttribute('data-status', 'paused');
      const progressedFrom = heldTotal(await mock.report());
      await waitForReport(mock, (r) => heldTotal(r) > progressedFrom + 2);

      // Folder level: the root folder pauses everything under it.
      await root.locator('[data-ad-action=pause]').click();
      await expect(root.locator('.ad-badge')).toHaveText('Paused');
      // Check the engine first (the file rows repaint as Paused too, see S3b).
      await expect
        .poll(() =>
          page.evaluate(() => (window as never as W).anydrop.tree.getUploadingFiles().length),
        )
        .toBe(0);
      await expectIdle();
      await root.locator('[data-ad-action=resume]').click();
      await expect(root.locator('.ad-badge')).not.toHaveText('Paused');
      // The file paused on its own stays paused: a folder resume clears only the folder flag.
      await expect(fileRow()).toHaveAttribute('data-status', 'paused');
      const afterFolder = heldTotal(await mock.report());
      await waitForReport(mock, (r) => heldTotal(r) > afterFolder + 2);

      // Global level: the toolbar.
      await toolbar.locator('[data-ad-action=pause-all]').click();
      await expect(toolbar.locator('[data-ad-action=resume-all]')).toBeEnabled();
      await expect(zone.locator('.ad-file-row[data-status=uploading]')).toHaveCount(0);
      await expectIdle();
      await toolbar.locator('[data-ad-action=resume-all]').click();

      // Finally the single file.
      await expect(fileRow().locator('[data-ad-action=resume]')).toBeVisible();
      await fileRow().locator('[data-ad-action=resume]').click();
      await expectAllUploaded(page, ZONE, g.tree.files.length);

      const report = await mock.report();
      expect(diffTrees(expectedTree(page, g), report.merged)).toEqual([]);
      // No chunk is committed twice. WebKit does not stop an aborted request whose body was sent
      // (decision 0015): there a chunk can repeat at most once per aborted request.
      if (browserName === 'webkit')
        expect(duplicates(report)).toBeLessThanOrEqual(await abortCount(page));
      else expect(duplicates(report)).toBe(0);
    } finally {
      await g.cleanup();
    }
  });
});

test.describe('S3b folder pause repaints file rows', () => {
  test('pausing a folder repaints the rows of its files as Paused', async ({ page, mock }) => {
    const g = await generateTree([
      '--files',
      '12',
      '--depth',
      '2',
      '--wide',
      '0',
      '--max-kb',
      '600',
    ]);
    try {
      await openDemo(page, mock);
      await mock.configure({ latencyMs: 150 });
      await addFolder(page, ZONE, g);
      await waitForReport(mock, (r) => heldTotal(r) >= 3);
      const zone = page.locator(ZONE);
      await zone.locator('.ad-folder-row').first().locator('[data-ad-action=pause]').click();
      await expect(zone.locator('.ad-file-row[data-status=paused]').first()).toBeVisible({
        timeout: 5000,
      });
      await expect(
        zone.locator('.ad-file-row:not([data-status=paused]):not([data-status=success])'),
      ).toHaveCount(0, {
        timeout: 5000,
      });
    } finally {
      await g.cleanup();
    }
  });
});

test.describe('S4 reload mid-upload, pick the same folder again', () => {
  test('finished files and chunks are skipped, the status endpoint is asked, the tree is complete', async ({
    page,
    mock,
  }) => {
    test.setTimeout(240_000);
    const g = await generateTree([
      '--files',
      '24',
      '--depth',
      '2',
      '--empty',
      '1',
      '--wide',
      '0',
      '--max-kb',
      '500',
    ]);
    try {
      await openDemo(page, mock);
      await mock.configure({ latencyMs: 120 });
      await addFolder(page, ZONE, g);
      // Mid-upload: some files are complete, and at least one is part-way.
      await waitForReport(
        mock,
        (r) =>
          r.uploads.filter((u) => u.complete).length >= 3 &&
          r.uploads.some((u) => !u.complete && u.received.length > 0),
      );
      // The resume records are written in batches (0004): wait until IndexedDB shows both finished
      // and part-way files, as a user who reloads a moment later would have.
      await expect
        .poll(
          async () => {
            const recs = await resumeRecords(page);
            return (
              recs.filter((r) => r.completed).length >= 3 &&
              recs.some((r) => !r.completed && r.chunksDone.length > 0)
            );
          },
          { timeout: 60_000, intervals: [50] },
        )
        .toBe(true);
      await page.reload(); // pagehide flushes the rest
      await expect(page.getByTestId('version')).toHaveText(/^\d+\.\d+\.\d+/);
      await page.waitForTimeout(600); // requests the server had already read finish committing
      const snapshot = await mock.report();
      // What the library had persisted (decision 0004). A file whose first chunk was still in
      // flight at the reload has no record yet and, as designed, starts over.
      const recorded = new Set((await resumeRecords(page)).map((r) => r.uploadId));
      const recordedPaths = new Set(
        snapshot.uploads.filter((u) => recorded.has(u.uploadId)).map((u) => u.relativePath),
      );
      const held = heldChunks(snapshot);
      const done = completedPaths(snapshot);
      const recordedDone = [...done].filter((p) => recordedPaths.has(p));
      expect(recordedDone.length).toBeGreaterThan(0);
      // (A part-way file may have been completed by its in-flight chunk after the reload: the
      // status endpoint says so and it is skipped, covered by the loop below.)
      const logAt = (await mock.log()).length;

      await addFolder(page, ZONE, g); // the same folder, again
      await expectAllUploaded(page, ZONE, g.tree.files.length);
      const report = await mock.report();
      expect(diffTrees(expectedTree(page, g), report.merged)).toEqual([]);
      const log = (await mock.log()).slice(logAt);
      const posts = uploadPosts(log);
      // Finished files: no request at all. Finished chunks of the others: never sent again.
      for (const p of posts) {
        const path = p.relativePath ?? '';
        if (!recordedPaths.has(path)) continue;
        expect(done.has(path), `file ${path} was already complete`).toBe(false);
        expect(held.has(`${path}#${p.chunkIndex}`), `chunk ${path}#${p.chunkIndex}`).toBe(false);
      }
      // Overall far less than a full upload: every recorded file skipped part or all of its work.
      expect(posts.length).toBeLessThan(
        g.tree.files.filter((f) => f.size > 0).reduce((n, f) => n + Math.ceil(f.size / 65536), 0),
      );
      // The demo sets chunkStatusUrl: the server was asked what it holds.
      expect(log.some((e) => e.path === '/upload/status')).toBe(true);
    } finally {
      await g.cleanup();
    }
  });
});

test.describe('S5 the server fails some chunks', () => {
  test('failures appear in the error panel; Retry failed resends only those files, and only what is missing', async ({
    page,
    mock,
  }) => {
    test.setTimeout(180_000);
    const rng = makeRng(4242);
    const files = Array.from({ length: 8 }, (_, i) => {
      const data = rng.bytes(110 * 1024 + i * 777);
      return {
        name: `srv-${i}.bin`,
        data,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    });
    await openDemo(page, mock);
    await mock.configure({
      failRate: 0.08, // AD_FAIL_RATE
      latencyMs: 5,
      failRules: [
        // Deterministic: two files fail on a middle chunk, every time.
        { where: 'chunk', relativePath: 'srv-1.bin', chunkIndex: 1, status: 500 },
        { where: 'chunk', relativePath: 'srv-5.bin', chunkIndex: 2, status: 500 },
      ],
    });
    const zone = page.locator('#errors-zone');
    await zone
      .locator('input[data-ad-input=files]')
      .setInputFiles(
        files.map((f) => ({ name: f.name, mimeType: 'application/octet-stream', buffer: f.data })),
      );
    const panel = zone.locator('.ad-errors');
    await expect(panel).toBeVisible({ timeout: 90_000 });
    // Let every file finish or fail.
    await expect
      .poll(
        async () => {
          const m = /(\d+) of 8 uploaded, (\d+) failed/.exec(
            (await zone.locator('.ad-summary').textContent()) ?? '',
          );
          return m ? Number(m[1]) + Number(m[2]) : 0;
        },
        { timeout: 90_000 },
      )
      .toBe(8);
    const csv = await errorCsv(page, panel);
    const csvLines = csv.trim().split(/\r?\n/);
    expect(csvLines.length - 1).toBeGreaterThanOrEqual(2);
    expect(csv).toContain('srv-1.bin');
    expect(csv).toContain('srv-5.bin');
    for (const line of csvLines.slice(1)) expect(line).toContain('SERVER_ERROR');

    await mock.configure({ failRate: 0, failRules: [] });
    const held = heldChunks(await mock.report());
    const logAt = (await mock.log()).length;
    await panel.locator('[data-ad-action=retry-failed]').click();
    await expect(zone.locator('.ad-summary')).toContainText('8 of 8 uploaded, 0 failed', {
      timeout: 60_000,
    });
    await expect(panel).toBeHidden();
    const after = await mock.report();
    for (const p of uploadPosts((await mock.log()).slice(logAt))) {
      expect(csv, `${p.relativePath} was not failed`).toContain(String(p.relativePath));
      expect(
        held.has(`${p.relativePath}#${p.chunkIndex}`),
        `${p.relativePath}#${p.chunkIndex} resent`,
      ).toBe(false);
    }
    expect(duplicates(after)).toBe(0);
    expect(
      diffTrees(
        {
          files: files.map((f) => ({ path: f.name, size: f.data.length, sha256: f.sha256 })),
          folders: [],
        },
        { files: after.merged.files, folders: [] },
      ),
    ).toEqual([]);
  });
});
