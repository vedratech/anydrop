// M7 (decision 0022 section 8.4): the React and Angular wrappers in real apps, production builds, against
// the mock upload server. The same scenarios run on each of the three examples (react-vite, nextjs,
// angular) in chromium, firefox, webkit and iphone:
//
//   1  the page loads: server HTML where there is one, no console errors, no hydration warnings
//   2  a folder uploads: tree and success events, the server holds the source tree (paths, SHA-256)
//   3  Pause all and Resume all: no request while paused, no chunk written twice, the upload finishes
//   4  a forced 500 shows in the error list, "Retry failed" resends only the failed file
//   5  the custom row shows context from the app (React context, Angular service); focus and state in a
//      row survive progress updates
//   6  mounted row views equal destroyed row views once the rows are gone
//   7  changing language and theme during an upload neither stops it nor recreates the instance
//
// Folders are added the way a user can on this device: the folder picker where the UI offers one, else a
// synthetic folder drop of in-page files (Playwright's WebKit posts an empty body for a slice of a
// path-backed file, see STATUS "Playwright WebKit"). No `page.route` over upload traffic (WEBKIT-FLAKE-1).
import {
  EXAMPLES,
  addFolder,
  duplicateWrites,
  expect,
  expectServerTree,
  expectUploaded,
  expectedTree,
  generateFolder,
  heldCount,
  lastSeq,
  mockConfig,
  mockLog,
  mockReport,
  ownPosts,
  ownUploads,
  test,
  watchConsole,
} from './support';

const SMALL = ['--files', '14', '--depth', '2', '--empty', '1', '--max-kb', '150'];
// Enough chunks that an upload slowed by the mock still takes seconds (pause and option-change tests).
const LONG = ['--files', '24', '--depth', '2', '--empty', '1', '--max-kb', '200'];

for (const ex of EXAMPLES) {
  test.describe(`${ex.name}`, () => {
    test.describe.configure({ timeout: 120_000 });

    test('1 the page loads: server HTML, no console errors, no hydration warnings', async ({
      page,
      request,
    }) => {
      const html = await (await request.get(ex.url)).text();
      if (ex.name === 'react-vite') {
        expect(html).toContain('<div id="root"></div>'); // client rendered
      } else if (ex.name === 'nextjs') {
        // 0022 4.3 and 5.1: the host is two empty divs on the server, no instance.
        expect(html).toContain('<div id="uploader"><div></div></div>');
        expect(html).toContain('<div id="server-rendered"><div></div></div>');
        expect(html).not.toContain('ad-root');
      } else {
        expect(html).toMatch(/<any-drop[^>]*id="zone"[^>]*><div><\/div><\/any-drop>/);
        expect(html).not.toContain('ad-root');
      }

      const bad = watchConsole(page);
      await page.goto(ex.url);
      await expect(page.locator(ex.zone)).toBeVisible();
      await expect(page.locator('.ad-root:not(.ad-panel)')).toHaveCount(ex.roots);
      // The instance is alive: the host carries the UI's classes.
      await expect(page.locator(ex.zone)).toHaveClass(/ad-root/);
      // Hydration problems are reported shortly after load (React "did not match", "Hydration failed";
      // Angular NG05xx), so give them a moment.
      await page.waitForTimeout(800);
      expect(bad).toEqual([]);
    });

    test('2 a folder uploads: tree, success, and the server holds exactly the source tree', async ({
      page,
    }) => {
      const folder = await generateFolder(SMALL, ex);
      try {
        const bad = watchConsole(page);
        await page.goto(ex.url);
        await addFolder(page, ex.zone, folder);
        await expectUploaded(page, ex, folder);
        // The wrapper's event props or outputs reached the app (React onAddedfolder, Angular (addedfolder)).
        await expect(page.getByTestId('event-log')).toContainText(folder.root);
        await expect(page.getByTestId('event-log')).toContainText(/queuecomplete|queue complete/);
        const report = await expectServerTree(folder, expectedTree(page, folder));
        expect(ownUploads(report, folder.root).every((u) => u.complete)).toBe(true);
        expect(bad).toEqual([]);
      } finally {
        await folder.cleanup();
      }
    });

    test('3 Pause all and Resume all: nothing is sent while paused, no chunk is committed twice', async ({
      page,
    }, info) => {
      const webkit = info.project.name === 'webkit' || info.project.name === 'iphone';
      const folder = await generateFolder(LONG, ex);
      // 500 ms per chunk of this folder only: the upload lasts long enough to pause in the middle.
      const slow = { pathPrefix: folder.root + '/', ms: 500 };
      await mockConfig({ addSlowRule: slow });
      try {
        await page.goto(ex.url);
        await page.evaluate(() => {
          const w = window as unknown as { __aborts: number };
          w.__aborts = 0;
          const abort = XMLHttpRequest.prototype.abort;
          XMLHttpRequest.prototype.abort = function () {
            if (this.readyState >= 2 || this.readyState === 1) w.__aborts++;
            return abort.call(this);
          };
        });
        await addFolder(page, ex.zone, folder);
        await expect
          .poll(async () => heldCount(await mockReport(folder.root), folder.root), {
            intervals: [100],
            timeout: 30_000,
          })
          .toBeGreaterThanOrEqual(2);

        await page.getByTestId('pause-all').click();
        const pausedAt = Date.now();
        // Requests already on the wire may still land (WebKit even commits aborted ones): wait until
        // the server's count of this folder stops moving, then nothing more may arrive.
        let settled = -1;
        await expect
          .poll(
            async () => {
              const n = heldCount(await mockReport(folder.root), folder.root);
              const same = n === settled;
              settled = n;
              return same;
            },
            { intervals: [700], timeout: 20_000 },
          )
          .toBe(true);
        const total = folder.tree.files.reduce(
          (n, f) => n + Math.max(1, Math.ceil(f.size / 65536)),
          0,
        );
        expect(
          settled,
          `the pause came too late: ${settled} of ${total} chunks were already on the server`,
        ).toBeLessThan(total);
        await page.waitForTimeout(1500);
        // A request already on the wire at the click may still arrive and commit (that is why the count
        // above has to settle first), but none may START after it. `ts` is when the server received it.
        const late = ownPosts(await mockLog(), folder.root).filter(
          (e) => (e.ts ?? 0) > pausedAt + 250,
        );
        expect(
          late.map((e) => ({
            seq: e.seq,
            path: e.relativePath,
            chunk: e.chunkIndex,
            status: e.status,
            note: e.note,
            msAfterPause: (e.ts ?? 0) - pausedAt,
          })),
          'chunk requests that started after Pause all',
        ).toEqual([]);
        expect(heldCount(await mockReport(folder.root), folder.root)).toBe(settled);

        await page.getByTestId('resume-all').click();
        await expectUploaded(page, ex, folder);
        const report = await expectServerTree(folder, expectedTree(page, folder));
        const aborts = await page.evaluate(
          () => (window as unknown as { __aborts: number }).__aborts,
        );
        // WebKit commits a chunk whose request was aborted, so its resend is a second (idempotent) write.
        expect(duplicateWrites(report, folder.root)).toBeLessThanOrEqual(webkit ? aborts : 0);
      } finally {
        await mockConfig({ removeSlowRules: { pathPrefix: slow.pathPrefix } });
        await folder.cleanup();
      }
    });

    test('4 a forced 500 lands in the error list, "Retry failed" resends only that file', async ({
      page,
    }) => {
      const folder = await generateFolder(SMALL, ex);
      const victim = [...folder.tree.files].sort((a, b) => b.size - a.size)[0]!;
      expect(victim.size).toBeGreaterThan(65536); // several chunks
      await mockConfig({ addFailRule: { where: 'chunk', relativePath: victim.path, status: 500 } });
      try {
        await page.goto(ex.url);
        await addFolder(page, ex.zone, folder);
        const n = folder.tree.files.length;
        await expect(page.locator(`${ex.zone} .ad-summary`)).toContainText(
          `${n - 1} of ${n} uploaded, 1 failed`,
          { timeout: 90_000 },
        );
        await expect(page.getByTestId('error-list')).toContainText(victim.path);
        await expect(page.getByTestId('event-log')).toContainText(`error ${victim.path}`);
        await expect(page.getByTestId('retry-failed')).toBeEnabled();

        // The server recovers; "Retry failed" must send only what failed.
        await mockConfig({ removeFailRules: { relativePath: victim.path } });
        const seq = await lastSeq();
        await page.getByTestId('retry-failed').click();
        await expectUploaded(page, ex, folder);
        const posts = ownPosts(await mockLog(seq), folder.root);
        expect(posts.length).toBeGreaterThan(0);
        expect(posts.filter((p) => p.relativePath !== victim.path)).toEqual([]);
        await expectServerTree(folder, expectedTree(page, folder));
        await expect(page.getByTestId('retry-failed')).toBeDisabled();
      } finally {
        await mockConfig({ removeFailRules: { relativePath: victim.path } });
        await folder.cleanup();
      }
    });

    test('5 the custom row gets app context, and focus and state in a row survive progress', async ({
      page,
    }) => {
      const folder = await generateFolder(
        ['--files', '6', '--depth', '1', '--empty', '0', '--max-kb', '700'],
        ex,
      );
      const slow = { pathPrefix: folder.root + '/', ms: 400 };
      await mockConfig({ addSlowRule: slow });
      try {
        await page.goto(ex.url);
        await addFolder(page, ex.zone, folder);
        // A row that is part way through its upload (not 0%, not finishing): its pause or ping button is
        // focused, then the page itself watches for the next progress change of that row.
        let seen: {
          focused: boolean;
          same?: string;
          attached: boolean;
          text?: string;
          first: string;
          now: string;
          status: string;
        } | null = null;
        for (let attempt = 0; attempt < 6 && !seen; attempt++) {
          const row = page
            .locator('[data-ad-slot=file]')
            .filter({ has: page.getByTestId('row-status').filter({ hasText: /uploading/ }) })
            .filter({ has: page.getByTestId('row-progress').filter({ hasNotText: /^\s*100/ }) })
            .first();
          await expect(row).toBeVisible();
          // React: a value from a context provider above <AnyDrop>. Angular: a service injected in the row.
          await expect(row.getByTestId(ex.row.context)).toHaveText(ex.row.contextText);
          const button = await row.getByTestId(ex.row.focus).elementHandle();
          if (!button) continue;
          // Angular's row keeps a click counter in the component: a click sets state. WebKit does not focus a
          // button on click, so focus it explicitly in every browser.
          if (ex.name === 'angular') await button.click();
          await button.evaluate((el) => {
            (el as unknown as { __same: string }).__same = 'node';
            (el as HTMLElement).focus();
          });
          const r = await button.evaluate(async (el) => {
            const row = el.closest('[data-ad-slot=file]');
            const read = () => ({
              progress: row?.querySelector('[data-testid=row-progress]')?.textContent?.trim() ?? '',
              status: row?.querySelector('[data-testid=row-status]')?.textContent?.trim() ?? '',
            });
            const first = read();
            const end = performance.now() + 20_000;
            while (performance.now() < end) {
              await new Promise((r) => setTimeout(r, 10));
              const now = read();
              if (now.progress !== first.progress) {
                return {
                  focused: document.activeElement === el,
                  same: (el as unknown as { __same?: string }).__same,
                  attached: el.isConnected,
                  text: el.textContent?.trim(),
                  first: first.progress,
                  now: now.progress,
                  status: now.status,
                };
              }
            }
            return null;
          });
          // Only a change while the file is still uploading says something about focus (a finished row
          // legitimately drops its pause button).
          test.info().annotations.push({ type: 'attempt', description: JSON.stringify(r) });
          if (r && r.status === 'uploading') seen = r;
        }
        expect(seen, 'no progress change of an uploading row was observed').not.toBeNull();
        expect(seen).toMatchObject({ focused: true, same: 'node', attached: true });
        if (ex.name === 'angular') expect(seen!.text).toBe('ping 1'); // component state survived too

        await expectUploaded(page, ex, folder);
        await expectServerTree(folder, expectedTree(page, folder));
      } finally {
        await mockConfig({ removeSlowRules: { pathPrefix: slow.pathPrefix } });
        await folder.cleanup();
      }
    });

    test('6 no leaked row views: mounted equals destroyed once the rows are gone', async ({
      page,
    }) => {
      const folder = await generateFolder(
        ['--files', '90', '--depth', '2', '--empty', '0', '--max-kb', '4'],
        ex,
      );
      try {
        await page.goto(ex.url);
        await addFolder(page, ex.zone, folder);
        await expectUploaded(page, ex, folder, 120_000);
        const count = async (id: string) => Number(await page.getByTestId(id).innerText());

        // Scroll the virtual list to the end, the middle and the top: rows are mounted and destroyed.
        for (const at of [1, 0.5, 0]) {
          await page.evaluate(
            ({ zone, at }) => {
              const root = document.querySelector(zone)!;
              const sc = [root, ...root.querySelectorAll('*')].find((el) => {
                const o = getComputedStyle(el).overflowY;
                return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 4;
              });
              if (!sc) throw new Error('no scrollable list in the zone');
              sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * at;
            },
            { zone: ex.zone, at },
          );
          await page.waitForTimeout(150);
        }
        const mounted = await count(ex.counters.mounted);
        const destroyed = await count(ex.counters.destroyed);
        expect(mounted, 'rows were mounted').toBeGreaterThan(0);
        expect(destroyed, 'rows scrolled out were destroyed').toBeGreaterThan(0);
        expect(mounted - destroyed, 'only the visible rows are alive').toBeLessThan(40);

        // Clear removes every row: no view may stay behind.
        await page.locator(`${ex.zone} [data-ad-action=clear]`).click();
        await expect
          .poll(
            async () => (await count(ex.counters.mounted)) - (await count(ex.counters.destroyed)),
            { intervals: [100] },
          )
          .toBe(0);
        expect(await count(ex.counters.mounted)).toBeGreaterThanOrEqual(mounted);
      } finally {
        await folder.cleanup();
      }
    });

    test('7 changing language and theme during an upload does not stop it or recreate the instance', async ({
      page,
    }) => {
      const folder = await generateFolder(LONG, ex);
      const slow = { pathPrefix: folder.root + '/', ms: 400 };
      await mockConfig({ addSlowRule: slow });
      try {
        await page.goto(ex.url);
        await addFolder(page, ex.zone, folder);
        await expect
          .poll(async () => heldCount(await mockReport(folder.root), folder.root), {
            intervals: [100],
            timeout: 30_000,
          })
          .toBeGreaterThanOrEqual(2);
        const before = heldCount(await mockReport(folder.root), folder.root);

        await page.getByTestId('locale').selectOption(ex.locale.value);
        await page.getByTestId('preset').selectOption('glass');
        await expect(page.locator(ex.zone)).toHaveAttribute('lang', ex.locale.lang);
        await expect(page.locator('.ad-root:not(.ad-panel)')).toHaveCount(ex.roots);

        // Judged by the server: the toolbar summary is now in another language.
        const n = folder.tree.files.length;
        await expect
          .poll(
            async () => {
              const up = ownUploads(await mockReport(folder.root), folder.root);
              return up.length === n && up.every((u) => u.complete);
            },
            { timeout: 90_000, intervals: [200] },
          )
          .toBe(true);
        const report = await expectServerTree(folder, expectedTree(page, folder));
        expect(heldCount(report, folder.root)).toBeGreaterThan(before);
        expect(duplicateWrites(report, folder.root)).toBe(0);
      } finally {
        await mockConfig({ removeSlowRules: { pathPrefix: slow.pathPrefix } });
        await folder.cleanup();
      }
    });
  });
}
