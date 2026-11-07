// M4 done-when: the plain-JavaScript UI in a real browser, driven through the demo page and an
// isolated mock server. Covers drop, file pick and folder pick through the UI, the tree and flat
// views, virtualization, the toolbar, the error panel, the Dropzone docs configuration, and the
// mobile layout (iphone and pixel projects).
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { diffTrees, walkTree } from '../fixtures/lib.mjs';
import { test, expect, type IsolatedMock } from './support/mock';

const HERE = dirname(fileURLToPath(import.meta.url));
type AD = {
  setOption(n: string, v: unknown): void;
  addFiles(f: File[]): void;
  destroy(): void;
  retryFailedOnly?: unknown;
};
type All = {
  tree: AD;
  errors: AD;
  mobile: AD;
  AnyDrop: new (
    el: string,
    o: Record<string, unknown>,
  ) => AD & {
    on(e: string, fn: () => void): unknown;
  };
};
const desktop = (name: string) => !/iphone|pixel/.test(name);

async function open(page: Page, mock: IsolatedMock): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?mock=${encodeURIComponent(mock.url)}`);
  await expect(page.getByTestId('version')).toHaveText(/^\d+\.\d+\.\d+/);
  return errors;
}

async function generate(files: number): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'anydrop-ui-e2e-'));
  execFileSync(
    process.execPath,
    [
      join(HERE, '..', 'fixtures', 'generate.mjs'),
      '--out',
      out,
      '--files',
      String(files),
      '--depth',
      '3',
      '--empty',
      '2',
      '--wide',
      '10',
      '--max-kb',
      '4',
    ],
    { stdio: 'pipe' },
  );
  return out;
}

/** Drops mocked FileSystemEntry objects (a folder with a subfolder, an empty folder and files). */
async function dropTree(page: Page, zone: string): Promise<void> {
  await page.evaluate((sel) => {
    type Entry = Record<string, unknown>;
    const file = (name: string, text: string, full: string): Entry => ({
      isFile: true,
      isDirectory: false,
      name,
      fullPath: full,
      file: (ok: (f: File) => void) => ok(new File([text], name, { type: 'text/plain' })),
    });
    const dir = (name: string, full: string, kids: Entry[]): Entry => ({
      isFile: false,
      isDirectory: true,
      name,
      fullPath: full,
      createReader() {
        let done = false;
        return {
          readEntries(ok: (e: Entry[]) => void) {
            ok(done ? [] : kids);
            done = true;
          },
        };
      },
    });
    const root = dir('Docs', '/Docs', [
      file('a.txt', 'hello', '/Docs/a.txt'),
      dir('Sub', '/Docs/Sub', [file('b.txt', 'world', '/Docs/Sub/b.txt')]),
      dir('Empty', '/Docs/Empty', []),
    ]);
    const e = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
    };
    e.dataTransfer = {
      types: ['Files'],
      files: [],
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
    };
    document.querySelector(sel)!.dispatchEvent(e);
  }, zone);
}

test.describe('desktop UI', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!desktop(testInfo.project.name), 'desktop layout');
  });

  test('drop: a dropped folder shows as a tree and arrives intact', async ({ page, mock }) => {
    const errors = await open(page, mock);
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('.ad-folder-row')).toHaveCount(3);
    await expect(zone.locator('.ad-folder-row').first()).toContainText('Docs');
    await expect(zone.locator('.ad-summary')).toContainText('2 of 2 uploaded');
    const report = await mock.report();
    expect(report.merged.files.map((f) => f.path).sort()).toEqual(['Docs/Sub/b.txt', 'Docs/a.txt']);
    expect(report.merged.folders).toContain('Docs/Empty');
    expect(errors).toEqual([]);
  });

  test('folder pick: the folder picker uploads the exact tree', async ({ page, mock }) => {
    await open(page, mock);
    const out = await generate(40);
    try {
      const zone = page.locator('#tree-zone');
      await expect(zone.locator('[data-ad-action=pick-folder]')).toBeVisible();
      await zone.locator('input[data-ad-input=folder]').setInputFiles(join(out, 'tree'));
      await expect(zone.locator('.ad-folder-row').first()).toBeVisible();
      await expect(zone.locator('.ad-summary')).toContainText(/(\d+) of \1 uploaded, 0 failed/, {
        timeout: 30_000,
      });
      const expected = await walkTree(out);
      const report = await mock.report();
      const diff = diffTrees(
        { files: expected.files.filter((f) => f.path.startsWith('tree/')), folders: [] },
        { files: report.merged.files, folders: [] },
      );
      expect(diff).toEqual([]);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  test('file pick: the Dropzone docs configuration works unchanged', async ({ page, mock }) => {
    await open(page, mock);
    const input = page.locator('body > input[data-ad-input=files]');
    await input.setInputFiles([
      { name: 'ok.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'justinbieber.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') },
    ]);
    const zone = page.getByTestId('basic-zone');
    await expect(zone).toHaveClass(/dz-started/);
    await expect(zone.locator('.dz-preview')).toHaveCount(2);
    await expect(zone.locator('.dz-preview.dz-error [data-dz-errormessage]')).toHaveText(
      "Naha, you don't.",
    );
    await expect(zone.locator('.dz-preview.dz-success [data-dz-name]')).toHaveText('ok.txt');
    expect((await mock.report()).merged.files.map((f) => f.path)).toEqual(['ok.txt']);
    await expect(zone.locator('.dz-remove').first()).toBeVisible();
  });

  test('tree: collapse, flat view, and per-folder status', async ({ page, mock }) => {
    await open(page, mock);
    await mock.configure({ latencyMs: 0 });
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('.ad-file-row')).toHaveCount(2);
    await zone.locator('.ad-folder-row .ad-caret').first().click();
    await expect(zone.locator('.ad-row')).toHaveCount(1);
    await zone.locator('.ad-folder-row .ad-caret').first().click();
    await expect(zone.locator('.ad-row')).toHaveCount(5);
    await expect(zone.locator('.ad-folder-row').first().locator('.ad-badge')).toHaveText('Done');
    await page.locator('#tree-view-flat').click();
    await expect(zone.locator('.ad-folder-row')).toHaveCount(0);
    await expect(zone.locator('.ad-file-row')).toHaveCount(2);
    await expect(zone.locator('.ad-file-row').first()).toContainText('Docs/');
  });

  test('keyboard: arrows move the active row and left/right collapse and expand', async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    await dropTree(page, '#tree-zone');
    const list = page.locator('#tree-zone .ad-list');
    await expect(page.locator('#tree-zone .ad-file-row')).toHaveCount(2);
    await list.focus();
    // The first focus activates the first row.
    const id = await list.getAttribute('aria-activedescendant');
    await expect(page.locator(`#${id}`)).toHaveClass(/ad-folder-row/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tree-zone .ad-row')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tree-zone .ad-row')).toHaveCount(5);
  });

  test('toolbar: clear empties the list; M3 buttons are safe to press', async ({ page, mock }) => {
    const errors = await open(page, mock);
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('.ad-file-row')).toHaveCount(2);
    for (const a of ['pause-all', 'resume-all', 'retry-failed']) {
      const b = zone.locator(`.ad-toolbar [data-ad-action=${a}]`);
      // The buttons enable and disable as the upload progresses: a missed click is fine here.
      await b.click({ timeout: 1000 }).catch(() => undefined);
    }
    await zone.locator('.ad-toolbar [data-ad-action=clear]').click();
    await expect(zone.locator('.ad-row')).toHaveCount(0);
    await expect(zone).not.toHaveClass(/dz-started/);
    expect(errors).toEqual([]);
  });

  test('pause and resume from the toolbar and from a folder row', async ({ page, mock }) => {
    await open(page, mock);
    await mock.configure({ latencyMs: 600 });
    await page.evaluate(() => {
      (window as unknown as { anydrop: All }).anydrop.tree.setOption('parallelUploads', 1);
    });
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    const docs = zone.locator('.ad-folder-row').first();
    await expect(docs).toContainText('Docs');
    await docs.locator('[data-ad-action=pause]').click();
    await expect(docs.locator('.ad-badge')).toHaveText('Paused');
    await expect(docs.locator('[data-ad-action=resume]')).toBeVisible();
    await mock.configure({ latencyMs: 0 });
    await docs.locator('[data-ad-action=resume]').click();
    await expect(zone.locator('.ad-summary')).toContainText('2 of 2 uploaded', { timeout: 20_000 });
    await mock.configure({ latencyMs: 600 });
    await dropTree(page, '#tree-zone');
    await zone.locator('.ad-toolbar [data-ad-action=pause-all]').click({ timeout: 3000 });
    await expect(zone.locator('.ad-toolbar [data-ad-action=resume-all]')).toBeEnabled();
    await mock.configure({ latencyMs: 0 });
    await zone.locator('.ad-toolbar [data-ad-action=resume-all]').click();
    await expect(zone.locator('.ad-toolbar [data-ad-action=pause-all]')).toBeDisabled({
      timeout: 20_000,
    });
  });

  test('thumbnails: a picked image gets a small lazy thumbnail', async ({ page, mock }) => {
    await open(page, mock);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const zone = page.locator('#mobile-zone');
    await zone
      .locator('input[data-ad-input=files]')
      .setInputFiles([{ name: 'dot.png', mimeType: 'image/png', buffer: png }]);
    await expect(zone.locator('.dz-image img')).toHaveAttribute('src', /^data:image\//);
    await expect(zone.locator('.dz-preview')).toHaveClass(/dz-image-preview/);
  });

  test('a form with uploadMultiple sends each field once per request, not once per file', async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    const counts = await page.evaluate(async (url) => {
      const w = window as unknown as { anydrop: All };
      const sent: string[][] = [];
      const real = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (body) {
        if (body instanceof FormData) sent.push(Array.from(body.keys()));
        return real.call(this, body as XMLHttpRequestBodyInit);
      };
      const f = document.createElement('form');
      f.id = 'multi';
      f.innerHTML = '<input name="note" value="hi"><input name="tag" value="x">';
      document.body.appendChild(f);
      const dz = new w.anydrop.AnyDrop('#multi', {
        url: url + '/upload',
        uploadMultiple: true,
        parallelUploads: 3,
      });
      const done = new Promise<void>((r) => dz.on('queuecomplete', () => r()));
      dz.addFiles([1, 2, 3].map((i) => new File(['x' + i], `m${i}.txt`)));
      await done;
      dz.destroy();
      XMLHttpRequest.prototype.send = real;
      return sent.map((keys) => ({
        note: keys.filter((k) => k === 'note').length,
        tag: keys.filter((k) => k === 'tag').length,
      }));
    }, mock.url);
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts) expect(c).toEqual({ note: 1, tag: 1 });
  });

  test('keyboard: Enter on a row button presses that button', async ({ page, mock }) => {
    await open(page, mock);
    await mock.configure({ latencyMs: 800 });
    await page.evaluate(() => {
      const w = window as unknown as { anydrop: All; __paused: number };
      w.__paused = 0;
      const tree = w.anydrop.tree as unknown as { pauseFile(f: unknown): void };
      const real = tree.pauseFile.bind(tree);
      tree.pauseFile = (f) => {
        w.__paused++;
        real(f);
      };
      w.anydrop.tree.setOption('parallelUploads', 1);
    });
    await dropTree(page, '#tree-zone');
    const btn = page.locator('#tree-zone .ad-file-row [data-ad-action=pause]').first();
    await btn.focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as { __paused: number }).__paused)).toBe(1);
  });

  test('cancelling a row keeps focus in the list', async ({ page, mock }) => {
    await open(page, mock);
    await mock.configure({ latencyMs: 800 });
    await dropTree(page, '#tree-zone');
    const btn = page.locator('#tree-zone .ad-file-row [data-ad-action=cancel]').first();
    await btn.focus();
    await page.keyboard.press('Enter');
    const inside = await page.evaluate(() =>
      document.querySelector('#tree-zone .ad-list')!.contains(document.activeElement),
    );
    expect(inside).toBe(true);
  });

  test("with Dropzone's own stylesheet loaded, our rows keep their layout", async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    await page.addStyleTag({
      path: join(
        HERE,
        '..',
        '..',
        'packages',
        'core',
        'node_modules',
        'dropzone',
        'dist',
        'dropzone.css',
      ),
    });
    await page.evaluate(() => document.querySelector('#tree-zone')!.classList.add('dropzone'));
    await mock.configure({ latencyMs: 0 });
    await dropTree(page, '#tree-zone');
    const row = page.locator('#tree-zone .ad-file-row').first();
    await expect(row).toBeVisible();
    const style = await row.evaluate((el) => {
      const q = (s: string) => getComputedStyle(el.querySelector(s) as Element);
      return {
        image: q('.dz-image').width,
        details: q('.dz-details').position,
        opacity: q('.dz-details').opacity,
        progress: q('.dz-progress').position,
        mark: q('.dz-success-mark').display,
      };
    });
    expect(style).toEqual({
      image: '40px',
      details: 'static',
      opacity: '1',
      progress: 'absolute',
      mark: 'none',
    });
  });

  test('virtualization: 5,000 files keep the DOM small and stay scrollable', async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    const t0 = Date.now();
    await page.evaluate(() => {
      const ad = (window as unknown as { anydrop: All }).anydrop.tree;
      ad.setOption('autoProcessQueue', false);
      const files: File[] = [];
      for (let i = 0; i < 5000; i++) files.push(new File(['x'], `f${i}.txt`));
      ad.addFiles(files);
    });
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('.ad-summary')).toContainText('0 of 5000 uploaded');
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(await zone.locator('.ad-row').count()).toBeLessThan(80);
    await zone.locator('.ad-list').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(zone.locator('.ad-row', { hasText: 'f4999.txt' })).toBeVisible();
    expect(await zone.locator('.ad-row').count()).toBeLessThan(80);
  });

  test('error panel: rejected and failed files get a reason; export and dismiss work', async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    await mock.configure({ failRate: 1 });
    const zone = page.locator('#errors-zone');
    await zone.locator('input[data-ad-input=files]').setInputFiles([
      { name: 'good.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') },
      { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('abc') },
    ]);
    const panel = zone.locator('.ad-errors');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator('.ad-error-row')).toHaveCount(2, { timeout: 30_000 });
    await expect(panel.locator('.ad-errors-title')).toHaveText('2 failed');
    await expect(panel.locator('.ad-error-row', { hasText: 'bad.pdf' })).toContainText(
      'REJECTED_TYPE',
    );
    await expect(panel.locator('.ad-error-row', { hasText: 'good.txt' })).toContainText(
      'SERVER_ERROR',
    );
    const download = page.waitForEvent('download');
    await panel.locator('[data-ad-action=export-csv]').click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('anydrop-errors.csv');
    const csv = await readFile((await d.path())!, 'utf8');
    expect(csv).toContain('bad.pdf');
    expect(csv).toContain('good.txt');
    await panel.locator('[data-ad-action=dismiss-errors]').click();
    await expect(panel).toBeHidden();
  });

  test('error panel: retry failed re-sends the failed files', async ({ page, mock }) => {
    await open(page, mock);
    const hasRetry = await page.evaluate(
      () =>
        typeof (window as unknown as { anydrop: All }).anydrop.errors.retryFailedOnly ===
        'function',
    );
    test.skip(!hasRetry, 'pending M3: core has no retryFailedOnly yet');
    await mock.configure({ failRate: 1 });
    const zone = page.locator('#errors-zone');
    await zone
      .locator('input[data-ad-input=files]')
      .setInputFiles([{ name: 'good.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') }]);
    await expect(zone.locator('.ad-errors .ad-error-row')).toHaveCount(1, { timeout: 30_000 });
    await mock.configure({ failRate: 0 });
    await zone.locator('.ad-errors [data-ad-action=retry-failed]').click();
    await expect(zone.locator('.ad-summary')).toContainText('1 of 1 uploaded, 0 failed', {
      timeout: 30_000,
    });
    await expect(zone.locator('.ad-errors')).toBeHidden();
  });

  test('accessibility: live region, focus ring, labelled controls', async ({ page, mock }) => {
    await open(page, mock);
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('[aria-live=polite]')).not.toHaveText('');
    const unlabelled = await zone
      .locator('.ad-row-actions button, .ad-caret')
      .evaluateAll((bs) => bs.filter((b) => !b.getAttribute('aria-label')).length);
    expect(unlabelled).toBe(0);
    await zone.locator('[data-ad-action=pick-files]').focus();
    const outline = await zone
      .locator('[data-ad-action=pick-files]')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('destroy() removes everything and instances are independent', async ({ page, mock }) => {
    await open(page, mock);
    const res = await page.evaluate(() => {
      const all = (window as unknown as { anydrop: All }).anydrop;
      const before = document.querySelectorAll('input[data-ad-input]').length;
      all.mobile.destroy();
      const zone = document.querySelector('#mobile-zone')!;
      return {
        before,
        after: document.querySelectorAll('input[data-ad-input]').length,
        html: zone.innerHTML,
        cls: zone.className,
        treeAlive: !!document.querySelector('#tree-zone .ad-actions'),
      };
    });
    expect(res.after).toBeLessThan(res.before);
    expect(res.html).toBe('');
    expect(res.cls).toBe('');
    expect(res.treeAlive).toBe(true);
  });
});

test.describe('mobile layout', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(desktop(testInfo.project.name), 'mobile projects only');
  });

  test('touch: one full-width tap-to-upload button, 44px targets, no horizontal scroll', async ({
    page,
    mock,
  }) => {
    await open(page, mock);
    const zone = page.locator('#mobile-zone');
    await zone.scrollIntoViewIfNeeded();
    await expect(zone).toHaveClass(/ad-touch/);
    const btn = zone.locator('[data-ad-action=pick-files]');
    await expect(btn).toHaveText('Tap to upload');
    const [bb, zb] = await Promise.all([btn.boundingBox(), zone.boundingBox()]);
    expect(bb!.height).toBeGreaterThanOrEqual(44);
    expect(bb!.width).toBeGreaterThan(zb!.width - 40);
    await expect(zone.locator('.ad-message-text')).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('every control is at least 44x44 and the layout holds at 320px', async ({ page, mock }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, mock);
    await dropTree(page, '#tree-zone');
    const zone = page.locator('#tree-zone');
    await expect(zone.locator('.ad-file-row')).toHaveCount(2);
    const small = await zone.locator('button').evaluateAll((bs) =>
      bs
        .map((b) => ({
          r: b.getBoundingClientRect(),
          label: b.getAttribute('aria-label') || b.textContent,
        }))
        .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5))
        .map(({ label, r }) => `${label}: ${r.width}x${r.height}`),
    );
    expect(small).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('file pick works on mobile', async ({ page, mock }) => {
    await open(page, mock);
    await page
      .locator('#mobile-zone input[data-ad-input=files]')
      .setInputFiles([
        { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') },
      ]);
    await expect(page.locator('#mobile-zone .ad-summary')).toContainText('1 of 1 uploaded', {
      timeout: 30_000,
    });
  });
});

test.describe('connection banner (0017)', () => {
  test('offline shows the banner and "Waiting for connection"; online hides it', async ({
    page,
    mock,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'chromium only');
    await open(page, mock);
    const hasApi = await page.evaluate(
      () =>
        typeof (window as unknown as { anydrop: { network: { getConnectionState?: unknown } } })
          .anydrop.network.getConnectionState === 'function',
    );
    test.skip(!hasApi, 'pending core: getConnectionState (decision 0017)');
    await mock.configure({ latencyMs: 400 });
    const zone = page.locator('#network-zone');
    await zone.locator('input[data-ad-input=files]').setInputFiles([
      {
        name: 'n.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(200 * 1024, 1),
      },
    ]);
    await expect(zone.locator('.ad-file-row')).toHaveCount(1);
    await context.setOffline(true);
    await expect(zone.locator('.ad-banner')).toBeVisible();
    await expect(zone.locator('.ad-banner')).toContainText('You are offline');
    await expect(zone.locator('.ad-file-row .ad-badge')).toHaveText('Waiting for connection');
    await context.setOffline(false);
    await expect(zone.locator('.ad-banner')).toBeHidden();
    await expect(zone.locator('.ad-summary')).toContainText('1 of 1 uploaded', { timeout: 30_000 });
  });
});
