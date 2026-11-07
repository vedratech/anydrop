// The CDN build (`dist/index.global.js`) on a plain HTML page, with Dropzone's documentation markup
// and no script of our own (decision 0014): `window.AnyDrop` is the class, `AnyDrop.options.x` is
// honoured, `.dropzone` forms are discovered, and `autoDiscover = false` is respected.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, type IsolatedMock } from './support/mock';

const HERE = dirname(fileURLToPath(import.meta.url));
const IIFE = join(HERE, '..', '..', 'packages', 'ui', 'dist', 'index.global.js');
type AnyStatic = {
  new (el: string): unknown;
  instances: unknown[];
  autoDiscover: boolean;
  AnyDropCore: unknown;
  VERSION: string;
  uiDefaults: unknown;
  DEFAULT_TEMPLATE: unknown;
  AnyDrop: unknown;
  discover(): unknown[];
  forElement(el: string): unknown;
};

// The page is served on the mock's origin (routes intercept /__cdn/), so uploads are same-origin.
async function serve(page: Page, mock: IsolatedMock, html: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${mock.url}/__cdn/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__cdn/index.global.js') {
      return route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(IIFE, 'utf8'),
      });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto(`${mock.url}/__cdn/`);
  return errors;
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the CDN build is browser independent');
});

const docsPage = (mock: IsolatedMock, extra = '') => `<!doctype html><html><body>
<script src="/__cdn/index.global.js"></script>
${extra}
<form action="${mock.url}/upload" class="dropzone" id="my-awesome-dropzone"></form>
</body></html>`;

test('window.AnyDrop is the class, with the other exports as statics', async ({ page, mock }) => {
  const errors = await serve(
    page,
    mock,
    docsPage(mock, '<script>AnyDrop.autoDiscover = false;</script>'),
  );
  const info = await page.evaluate(() => {
    const A = (window as unknown as { AnyDrop: AnyStatic }).AnyDrop;
    return {
      type: typeof A,
      core: typeof A.AnyDropCore,
      version: /^\d+\.\d+\.\d+/.test(A.VERSION),
      defaults: typeof A.uiDefaults,
      template: typeof A.DEFAULT_TEMPLATE,
      self: A.AnyDrop === A,
      instances: A.instances.length,
    };
  });
  expect(info).toEqual({
    type: 'function',
    core: 'function',
    version: true,
    defaults: 'function',
    template: 'string',
    self: true,
    instances: 0,
  });
  expect(errors).toEqual([]);
});

test('Dropzone docs markup works with no script of our own', async ({ page, mock }) => {
  const errors = await serve(
    page,
    mock,
    docsPage(
      mock,
      '<script>AnyDrop.options.myAwesomeDropzone = { paramName: "file", maxFilesize: 2 };</script>',
    ),
  );
  const form = page.locator('#my-awesome-dropzone');
  await expect(form).toHaveClass(/dz-clickable/);
  await expect(form.locator('.dz-message')).toContainText('Drop files here to upload');
  await page
    .locator('body > input[data-ad-input=files]')
    .setInputFiles([{ name: 'cdn.txt', mimeType: 'text/plain', buffer: Buffer.from('hello cdn') }]);
  await expect(form.locator('.dz-preview')).toHaveCount(1);
  await expect(form.locator('.dz-preview.dz-success')).toHaveCount(1);
  expect((await mock.report()).merged.files.map((f) => f.path)).toEqual(['cdn.txt']);
  expect(
    await page.evaluate(
      () => (window as unknown as { AnyDrop: AnyStatic }).AnyDrop.instances.length,
    ),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test('autoDiscover = false is respected, and a manual instance is not attached twice', async ({
  page,
  mock,
}) => {
  const errors = await serve(
    page,
    mock,
    docsPage(mock, '<script>AnyDrop.autoDiscover = false;</script>'),
  );
  await page.waitForTimeout(100);
  const before = await page.evaluate(
    () => (window as unknown as { AnyDrop: AnyStatic }).AnyDrop.instances.length,
  );
  expect(before).toBe(0);
  const after = await page.evaluate(() => {
    const A = (window as unknown as { AnyDrop: AnyStatic }).AnyDrop;
    const dz = new A('#my-awesome-dropzone');
    const again = A.discover();
    return {
      instances: A.instances.length,
      again: again.length,
      same: A.forElement('#my-awesome-dropzone') === dz,
    };
  });
  expect(after).toEqual({ instances: 1, again: 0, same: true });
  expect(errors).toEqual([]);
});
