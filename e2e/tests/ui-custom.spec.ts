// Decision 0021 (UI customisation API), section 13: custom row actions and overrides, RTL, render hooks
// (focus and leak checks), theme presets (contrast), the compact layout, locale texts and the CDN locale
// files. The demo's "Customisation" section (#ex-custom) is used where it fits; instances with their own
// hooks are created in the page where a test needs to count calls.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { collectSamples, failures, measure } from './support/contrast';
import { test, expect, type IsolatedMock } from './support/mock';
import { openDemo, uploadPosts } from './support/ui';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', '..', 'packages', 'ui', 'dist');

/** Loose shape of the page objects the tests use (the demo exposes them on window.anydrop). */
interface Inst {
  setOption(n: string, v: unknown): void;
  addFiles(f: File[]): Promise<void>;
  addFile(f: File, path?: string): Promise<void>;
  removeAllFiles(cancel?: boolean): void;
  destroy(): void;
  on(e: string, fn: (...a: never[]) => void): () => void;
  getErrors(): unknown[];
  files: Array<{ name: string; status: string }>;
}
declare global {
  interface Window {
    anydrop: {
      custom: Inst;
      liveViews(): number;
      AnyDrop: new (el: string, o: Record<string, unknown>) => Inst;
    };
    __log?: string[];
  }
}

const ZONE = '#custom-zone';
const PRESETS = ['minimal', 'rounded', 'enterprise', 'glass'] as const;

/** Demo, custom section scrolled in view, sample files added (nothing uploads until "Start"). */
async function openCustom(page: Page, mock: IsolatedMock, add = true): Promise<string[]> {
  const errors = await openDemo(page, mock);
  if (add) await page.locator('#custom-add').click();
  if (add) await expect(page.locator(`${ZONE} .ad-row`).first()).toBeVisible();
  return errors;
}

/** The page's horizontal overflow: nothing may be wider than the viewport. */
const overflow = (page: Page, selector = ZONE) =>
  page.evaluate((sel) => {
    const de = document.documentElement;
    const z = document.querySelector(sel) as HTMLElement | null;
    const wide: string[] = [];
    if (z) {
      for (const el of Array.from(z.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > de.clientWidth + 0.5 || r.left < -0.5)) {
          // scrolled-out virtual rows are positioned inside the scroller; only report visible ones
          const sc = el.closest('[role=tree],.ad-error-list');
          if (sc) {
            const sr = sc.getBoundingClientRect();
            if (r.bottom < sr.top || r.top > sr.bottom) continue;
          }
          wide.push(
            `${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}..${Math.round(r.right)}`,
          );
        }
      }
    }
    return {
      page: de.scrollWidth - de.clientWidth,
      zone: z ? z.scrollWidth - z.clientWidth : 0,
      viewport: de.clientWidth,
      wide: wide.slice(0, 6),
    };
  }, selector);

// ------------------------------------------------------------------ row actions

test('a custom action and an override of a built-in: actionclicked fires before the action runs', async ({
  page,
  mock,
}) => {
  const errors = await openDemo(page, mock);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'act-zone';
    document.body.appendChild(host);
    const log: string[] = (window.__log = []);
    const ad = new window.anydrop.AnyDrop('#act-zone', {
      url: 'http://localhost:1/upload', // never used: nothing is processed
      autoProcessQueue: false,
      hiddenInputContainer: '#act-zone',
      icons: {
        open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',
      },
      rowActions: {
        file: [
          'pause',
          'resume',
          'retry',
          'cancel',
          {
            id: 'open',
            label: 'Open it',
            icon: 'open',
            onClick: (ctx: { file: { name: string } }) => log.push('run:open:' + ctx.file.name),
          },
          {
            id: 'remove',
            onClick: (ctx: { remove(): void }) => {
              log.push(`run:remove(files=${ad.files.length})`);
              ctx.remove();
            },
          },
        ],
      },
    } as never) as unknown as Inst;
    ad.on('actionclicked', ((id: string, t: { name: string }) =>
      log.push(`event:${id}:${t.name}(files=${ad.files.length})`)) as never);
    // The DOM twin of the event bubbles from the element.
    host.addEventListener('anydrop:actionclicked', (e) =>
      log.push(`dom:${(e as CustomEvent).detail.args[0]}`),
    );
    void ad.addFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]);
  });
  const row = page.locator('#act-zone .ad-row').first();
  await expect(row).toBeVisible();
  const btn = (id: string) => row.locator(`[data-ad-action="${id}"]`);

  // The custom action is a native 44px button with the configured label and icon; "remove" is hidden
  // while the file is waiting (the override keeps the built-in rule).
  await expect(btn('open')).toBeVisible();
  await expect(btn('open')).toHaveAttribute('aria-label', 'Open it');
  await expect(btn('open').locator('.ad-icon svg')).toHaveCount(1);
  await expect(btn('remove')).toBeHidden();
  const box = (await btn('open').boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(43.5);

  await btn('open').click();
  await expect
    .poll(() => page.evaluate(() => window.__log))
    .toEqual(['event:open:a.txt(files=1)', 'dom:open', 'run:open:a.txt']);

  // The built-in cancel (not overridden) ends the file; then the overridden remove takes its place.
  await btn('cancel').click();
  await expect(row).toHaveAttribute('data-status', 'canceled');
  await expect(btn('remove')).toBeVisible();
  await expect(btn('cancel')).toBeHidden();
  await page.evaluate(() => void (window.__log!.length = 0));
  await btn('remove').click();
  await expect
    .poll(() => page.evaluate(() => window.__log))
    .toEqual([
      'event:remove:a.txt(files=1)', // still there when the event fires
      'dom:remove',
      'run:remove(files=1)', // the override runs before the built-in
    ]);
  await expect(page.locator('#act-zone .ad-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the keyboard shortcuts follow the configuration: an override also runs for Delete, a missing action does nothing', async ({
  page,
  mock,
}) => {
  const errors = await openDemo(page, mock);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'key-zone';
    document.body.appendChild(host);
    const log: string[] = (window.__log = []);
    const ad = new window.anydrop.AnyDrop('#key-zone', {
      url: 'http://localhost:1/upload',
      autoProcessQueue: false,
      hiddenInputContainer: '#key-zone',
      // no 'pause' / 'resume': the "p" key must do nothing; cancel overridden: Delete runs it
      rowActions: {
        file: [
          'retry',
          {
            id: 'cancel',
            onClick: (ctx: { cancel(): void }) => {
              log.push('run:cancel');
              ctx.cancel();
            },
          },
          'remove',
        ],
      },
    } as never) as unknown as Inst;
    ad.on('actionclicked', ((id: string) => log.push('event:' + id)) as never);
    void ad.addFiles([new File(['x'], 'k.txt', { type: 'text/plain' })]);
  });
  const row = page.locator('#key-zone .ad-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('[data-ad-action=pause]')).toHaveCount(0);
  await page.locator('#key-zone [role=tree]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('p');
  expect(await page.evaluate(() => window.__log)).toEqual([]);
  await page.keyboard.press('Delete');
  await expect(row).toHaveAttribute('data-status', 'canceled');
  expect(await page.evaluate(() => window.__log)).toEqual(['event:cancel', 'run:cancel']);
  await page.keyboard.press('Delete'); // now the finished row: remove
  await expect(page.locator('#key-zone .ad-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the demo custom action and override: actionclicked reaches the page and the log', async ({
  page,
  mock,
}) => {
  const errors = await openCustom(page, mock);
  await page.locator('#custom-action').click();
  await page.locator('#custom-start').click();
  const row = page.locator(`${ZONE} .ad-row`, { hasText: 'notes.txt' });
  await expect(row).toHaveAttribute('data-status', 'success', { timeout: 30_000 });
  // The finished row offers "remove" (not "cancel"), the demo's copy action and the override share the bar.
  await expect(row.locator('[data-ad-action=cancel]')).toBeHidden();
  await expect(row.locator('[data-ad-action=copy-name]')).toBeVisible();
  await row.locator('[data-ad-action=copy-name]').click();
  await expect(page.getByTestId('custom-log')).toHaveText('Action "copy-name" on notes.txt');
  await row.locator('[data-ad-action=remove]').click();
  await expect(page.getByTestId('custom-log')).toHaveText('Action "remove" on notes.txt');
  await expect(page.locator(`${ZONE} .ad-row`, { hasText: 'notes.txt' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ RTL

test.describe('right to left (locale ar)', () => {
  test('lang and dir on the root and the panel, and back to the page values after switching off', async ({
    page,
    mock,
  }) => {
    const errors = await openCustom(page, mock);
    const root = page.locator(ZONE);
    const panel = page.locator(`${ZONE} .ad-panel`);
    await expect(root).not.toHaveAttribute('dir', /.+/);
    await page.getByTestId('custom-locale').selectOption('ar');
    await expect(root).toHaveAttribute('dir', 'rtl');
    await expect(root).toHaveAttribute('lang', 'ar');
    await expect(panel).toHaveAttribute('dir', 'rtl');
    await expect(panel).toHaveAttribute('lang', 'ar');
    expect(await page.evaluate(() => document.body.getAttribute('dir'))).toBeNull(); // never the body
    expect(await panel.evaluate((e) => getComputedStyle(e).direction)).toBe('rtl');
    await page.getByTestId('custom-locale').selectOption('');
    await expect(root).not.toHaveAttribute('dir', /.+/);
    await expect(root).not.toHaveAttribute('lang', /.+/);
    await expect(panel).not.toHaveAttribute('dir', /.+/);
    // destroy() restores what the page had.
    await page.evaluate(() => {
      const el = document.querySelector('#custom-zone') as HTMLElement;
      el.setAttribute('lang', 'fr-CA');
      window.anydrop.custom.setOption('locale', 'ar');
    });
    await expect(root).toHaveAttribute('lang', 'ar');
    await page.evaluate(() => window.anydrop.custom.destroy());
    await expect(root).toHaveAttribute('lang', 'fr-CA');
    await expect(root).not.toHaveAttribute('dir', /.+/);
    expect(errors).toEqual([]);
  });

  test('Left and Right arrows swap, and the indent is on the right', async ({ page, mock }) => {
    const errors = await openCustom(page, mock);
    const tree = page.locator(`${ZONE} [role=tree]`);
    const folder = page.locator(`${ZONE} .ad-row[aria-expanded]`).first();
    await expect(folder).toBeVisible();
    // LTR first, as a control: ArrowLeft collapses an open folder, ArrowRight opens it.
    await tree.focus();
    await page.keyboard.press('Home');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowRight');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');

    await page.getByTestId('custom-locale').selectOption('ar');
    await expect(page.locator(`${ZONE} .ad-panel`)).toHaveAttribute('dir', 'rtl');
    await tree.focus();
    await page.keyboard.press('Home');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight'); // in RTL, Right is "go to the parent / collapse"
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('ArrowLeft'); // and Left opens it
    await expect(folder).toHaveAttribute('aria-expanded', 'true');

    // Indent: a nested row's content starts further from the RIGHT edge than a top-level row's.
    const inset = (loc: ReturnType<Page['locator']>) =>
      loc.evaluate((row) => {
        const r = row.getBoundingClientRect();
        const content =
          row.querySelector('.ad-file-preview, .ad-folder-main, .ad-file-thumb') ?? row;
        let min = Infinity;
        let max = -Infinity;
        for (const c of Array.from(row.children)) {
          const b = c.getBoundingClientRect();
          if (b.width) {
            min = Math.min(min, b.left);
            max = Math.max(max, b.right);
          }
        }
        void content;
        return { right: r.right - max, left: min - r.left };
      });
    const top = page.locator(`${ZONE} .ad-row[aria-level="1"]`).first();
    const nested = page.locator(`${ZONE} .ad-row[aria-level="2"]`).first();
    await expect(nested).toBeVisible();
    const a = await inset(top);
    const b = await inset(nested);
    expect(b.right, `nested inset-right ${b.right} vs top ${a.right}`).toBeGreaterThan(a.right + 4);
    expect(Math.abs(b.left - a.left), 'nothing is pushed to the left').toBeLessThan(
      b.right - a.right,
    );
    expect(errors).toEqual([]);
  });

  test('no horizontal overflow at 320px with files, an error and the toolbar', async ({
    page,
    mock,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const errors = await openCustom(page, mock);
    await page.getByTestId('custom-locale').selectOption('ar');
    await page.evaluate(() => {
      window.anydrop.custom.setOption('acceptedFiles', '.nomatch');
      void window.anydrop.custom.addFile(
        new File(['x'], 'a-very-long-file-name-that-keeps-going-and-going-and-going.bin'),
      );
    });
    await expect(page.locator(`${ZONE} .ad-errors`)).toBeVisible();
    for (const layout of ['#custom-layout-list', '#custom-layout-compact']) {
      await page.locator(layout).click();
      const o = await overflow(page);
      expect(o, `layout ${layout}: ${o.wide.join(' | ')}`).toMatchObject({ page: 0, zone: 0 });
    }
    expect(errors).toEqual([]);
  });
});

test('at 320px every row still shows its file name (list and compact, success and error rows)', async ({
  page,
  mock,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const errors = await openCustom(page, mock);
  await page.evaluate(() => {
    window.anydrop.custom.setOption('acceptedFiles', '.txt,.pdf,.jpg,.png');
    void window.anydrop.custom.addFile(new File(['x'], 'bad.exe'));
  });
  await page.locator('#custom-start').click();
  await expect(page.locator(`${ZONE} .ad-summary`)).toContainText('5 of 6 uploaded', {
    timeout: 30_000,
  });
  for (const layout of ['#custom-layout-list', '#custom-layout-compact']) {
    await page.locator(layout).click();
    const narrow = await page.locator(`${ZONE} .ad-row:not([aria-expanded])`).evaluateAll((rows) =>
      rows
        .map((r) => ({
          status: r.getAttribute('data-status'),
          name: (r.querySelector('.ad-file-name')?.textContent || '').trim(),
          width: Math.round(r.querySelector('.ad-file-name')?.getBoundingClientRect().width ?? 0),
        }))
        .filter((x) => x.width < 40),
    );
    expect(narrow, `${layout}: rows whose name box is under 40px wide`).toEqual([]);
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ render hooks

test('a render hook keeps keyboard focus inside its row while progress updates', async ({
  page,
  mock,
}) => {
  await mock.configure({ latencyMs: 120 });
  const errors = await openDemo(page, mock);
  await page.evaluate((url) => {
    const host = document.createElement('div');
    host.id = 'hook-zone';
    document.body.appendChild(host);
    const w = window as unknown as { __hook: Record<string, unknown> };
    const st = (w.__hook = {
      mounts: 0,
      updates: 0,
      destroys: 0,
      focusLost: 0,
      pct: [] as number[],
    });
    const ad = new window.anydrop.AnyDrop('#hook-zone', {
      url: url + '/upload',
      chunking: true,
      chunkSize: 16 * 1024,
      forceChunking: true,
      parallelUploads: 1,
      autoProcessQueue: false,
      hiddenInputContainer: '#hook-zone',
      render: {
        file(ctx: {
          html: (s: TemplateStringsArray, ...v: unknown[]) => HTMLElement;
          label: string;
          progress: number;
          parts: { actions: HTMLElement };
        }) {
          const el = ctx.html`<div class="my-row"><strong>${ctx.label}</strong> <span class="pct"></span> <button type="button" class="ad-btn" data-my="star">Star</button></div>`;
          el.appendChild(ctx.parts.actions);
          const btn = el.querySelector('[data-my=star]') as HTMLButtonElement;
          const pct = el.querySelector('.pct') as HTMLElement;
          st.mounts++;
          const paint = (c: { progress: number }) => {
            const had = document.activeElement === btn;
            pct.textContent = Math.round(c.progress) + '%';
            (w.__hook.pct as number[]).push(Math.round(c.progress));
            // focus must still be on the button after the in-place update
            if (had && document.activeElement !== btn) st.focusLost++;
          };
          paint(ctx);
          return {
            el,
            update(c: { progress: number }) {
              st.updates++;
              paint(c);
            },
            destroy() {
              st.destroys++;
            },
          };
        },
      },
    } as never) as unknown as Inst;
    void ad.addFiles([new File([new Uint8Array(300 * 1024)], 'big.bin')]);
  }, mock.url);
  const row = page.locator('#hook-zone .ad-row').first();
  const star = row.locator('[data-my=star]');
  await expect(star).toBeVisible();
  await expect(row).toHaveClass(/ad-row-custom/);
  // Keyboard users reach the custom button, and it is a native 44px button.
  await star.focus();
  await expect(star).toBeFocused();
  const box = (await star.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(43.5);
  await page.evaluate(() => {
    const ad = window.anydrop.AnyDrop as unknown as { instances: Inst[] };
    const me = ad.instances[ad.instances.length - 1] as Inst;
    me.setOption('autoProcessQueue', true);
    (me as unknown as { processQueue(): void }).processQueue();
  });
  await expect(row).toHaveAttribute('data-status', 'success', { timeout: 30_000 });
  await expect(star).toBeFocused();
  const st = await page.evaluate(
    () => (window as unknown as { __hook: Record<string, unknown> }).__hook,
  );
  expect(st.mounts, 'one mount for the one row').toBe(1);
  expect(st.updates as number, 'progress was painted several times').toBeGreaterThanOrEqual(3);
  expect(st.focusLost, 'focus never left the custom button during an update').toBe(0);
  expect(st.destroys).toBe(0);
  expect((st.pct as number[]).includes(100)).toBe(true);
  expect(uploadPosts(await mock.log()).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test.describe('render hook views do not leak', () => {
  const addMany = (n: number) => (page: Page) =>
    page.evaluate((count) => {
      const files: File[] = [];
      for (let i = 0; i < count; i++) {
        files.push(
          new File(['x'.repeat(10)], `file-${String(i).padStart(5, '0')}.txt`, {
            type: 'text/plain',
          }),
        );
      }
      return window.anydrop.custom.addFiles(files);
    }, n);

  test('liveViews() returns to 0 after Clear and after destroy()', async ({ page, mock }) => {
    const errors = await openCustom(page, mock);
    await page.locator('#custom-hook').click(); // the demo's decorating hook, counted by liveViews()
    const live = () => page.evaluate(() => window.anydrop.liveViews());
    await expect.poll(live).toBe(5); // five sample files, five mounted rows
    await expect(page.locator(`${ZONE} .my-tag`)).toHaveCount(5);
    // Structural change: remove one row, the view is destroyed with it.
    await page
      .locator(`${ZONE} .ad-row`, { hasText: 'notes.txt' })
      .locator('[data-ad-action=cancel]')
      .click();
    await page
      .locator(`${ZONE} .ad-row`, { hasText: 'notes.txt' })
      .locator('[data-ad-action=remove]')
      .click();
    await expect.poll(live).toBe(4);
    await page.locator(`${ZONE} .ad-toolbar`).getByRole('button', { name: 'Clear' }).click();
    await expect.poll(live).toBe(0);
    await expect(page.locator(`${ZONE} .my-tag`)).toHaveCount(0);
    // Add again, then destroy the instance with rows mounted: views are destroyed before the DOM goes.
    await page.locator('#custom-add').click();
    await expect.poll(live).toBeGreaterThan(0);
    await page.evaluate(() => window.anydrop.custom.destroy());
    await expect.poll(live).toBe(0);
    await expect(page.locator(`${ZONE} .ad-panel`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a 2,000-file list scrolled to the end and back: mounted views equal the rows in the DOM, 0 after Clear and destroy()', async ({
    page,
    mock,
  }) => {
    const errors = await openCustom(page, mock, false);
    await page.locator('#custom-hook').click();
    await addMany(2000)(page);
    const live = () => page.evaluate(() => window.anydrop.liveViews());
    const rows = () => page.locator(`${ZONE} .ad-row`).count();
    await expect.poll(live, { timeout: 30_000 }).toBeGreaterThan(0);
    const tree = page.locator(`${ZONE} [role=tree]`);
    const max = await tree.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(max, 'the list is long enough to scroll').toBeGreaterThan(10_000);
    let peak = 0;
    for (const f of [0.1, 0.3, 0.55, 0.8, 1, 0.6, 0.2, 0, 0.9, 0.4]) {
      await tree.evaluate((el, y) => (el.scrollTop = y), Math.floor(max * f));
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const l = await live();
      const r = await rows();
      peak = Math.max(peak, l);
      // Every mounted hook view belongs to a row that is in the DOM, none were left behind.
      expect(l, `live views ${l} vs rows in the DOM ${r} at ${f}`).toBe(r);
      expect(r).toBeLessThan(200);
    }
    expect(peak).toBeGreaterThan(5);
    await page.locator(`${ZONE} .ad-toolbar`).getByRole('button', { name: 'Clear' }).click();
    await expect.poll(live, { timeout: 15_000 }).toBe(0);
    await addMany(500)(page);
    await expect.poll(live).toBeGreaterThan(0);
    await tree.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.evaluate(() => window.anydrop.custom.destroy());
    await expect.poll(live).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ------------------------------------------------------------------ presets

test.describe('theme presets', () => {
  const SIGNATURE = [
    '--ad-color-bg',
    '--ad-color-surface',
    '--ad-color-text',
    '--ad-color-accent',
    '--ad-color-border',
    '--ad-radius',
    '--ad-border-style',
    '--ad-border-width',
    '--ad-shadow',
    '--ad-backdrop',
  ];
  const signature = (page: Page) =>
    page.evaluate((names) => {
      const z = document.querySelector('#custom-zone') as HTMLElement;
      const s = getComputedStyle(z);
      return names.map((n) => `${n}=${s.getPropertyValue(n).trim()}`).join(';');
    }, SIGNATURE);

  async function prepare(page: Page, mock: IsolatedMock, preset: string, scheme: string) {
    await page.emulateMedia({ colorScheme: scheme === 'os-dark' ? 'dark' : 'light' });
    const errors = await openCustom(page, mock);
    if (preset) await page.getByTestId('custom-preset').selectOption(preset);
    await page.getByTestId('custom-scheme').selectOption(scheme === 'os-dark' ? 'auto' : scheme);
    // States: success rows, one rejected file (error row and error panel), all visible together.
    await page.evaluate(() => {
      window.anydrop.custom.setOption('acceptedFiles', '.txt,.pdf,.jpg,.png');
      void window.anydrop.custom.addFile(new File(['x'], 'bad.exe'));
    });
    await page.locator('#custom-start').click();
    await expect(page.locator(`${ZONE} .ad-summary`)).toContainText('5 of 6 uploaded, 1 failed', {
      timeout: 30_000,
    });
    await expect(page.locator(`${ZONE} .ad-errors`)).toBeVisible();
    return errors;
  }

  test('each preset loads: the class is on the root and the panel and the variables change', async ({
    page,
    mock,
  }) => {
    const errors = await openCustom(page, mock);
    const base = await signature(page);
    const seen = new Set([base]);
    for (const p of PRESETS) {
      await page.getByTestId('custom-preset').selectOption(p);
      await expect(page.locator(ZONE)).toHaveClass(new RegExp(`ad-theme-${p}\\b`));
      await expect(page.locator(`${ZONE} .ad-panel`)).toHaveClass(new RegExp(`ad-theme-${p}\\b`));
      const sig = await signature(page);
      expect(sig, `${p}: the preset's CSS is loaded and changes variables`).not.toBe(base);
      expect(seen.has(sig), `${p} differs from every other preset`).toBe(false);
      seen.add(sig);
      // The class is swapped, never accumulated.
      expect(
        await page
          .locator(ZONE)
          .evaluate((e) => [...e.classList].filter((c) => c.startsWith('ad-theme-'))),
      ).toEqual([`ad-theme-${p}`]);
    }
    await page.getByTestId('custom-preset').selectOption('');
    expect(
      await page
        .locator(ZONE)
        .evaluate((e) => [...e.classList].filter((c) => c.startsWith('ad-theme-'))),
    ).toEqual([]);
    expect(await signature(page)).toBe(base);
    // A preset must not change the sizes that matter for touch targets or row height.
    await page.getByTestId('custom-preset').selectOption('glass');
    const heights = await page
      .locator(`${ZONE} .ad-row`)
      .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    expect(errors).toEqual([]);
  });

  for (const preset of ['', ...PRESETS]) {
    for (const scheme of ['light', 'dark', 'os-dark']) {
      test(`contrast, ${preset || 'no preset'}, ${scheme}: text 4.5:1, controls and focus ring 3:1`, async ({
        page,
        mock,
      }) => {
        const errors = await prepare(page, mock, preset, scheme);
        const samples = await collectSamples(page, ZONE);
        expect(samples.length, 'something was measured').toBeGreaterThan(15);
        const base = await page.evaluate(() => {
          // the page background under the section, for translucent presets
          const cv = document.createElement('canvas').getContext('2d')!;
          cv.fillStyle = getComputedStyle(document.body).backgroundColor;
          cv.fillRect(0, 0, 1, 1);
          const d = cv.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], 1] as [number, number, number, number];
        });
        const bad = failures(measure(samples, base));
        // De-duplicate repeated rows so the message stays readable.
        expect([...new Set(bad)], `${preset || 'none'}/${scheme}`).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  }
});

// ------------------------------------------------------------------ compact layout

test.describe('compact layout', () => {
  test('48px rows, 44px targets and no horizontal overflow at 320px', async ({ page, mock }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const errors = await openCustom(page, mock);
    await page.locator('#custom-layout-compact').click();
    await expect(page.locator(`${ZONE} .ad-panel`)).toHaveClass(/ad-layout-compact/);
    // Add an error and make the toolbar and the error panel show, so every kind of button is measured.
    await page.evaluate(() => {
      window.anydrop.custom.setOption('acceptedFiles', '.txt,.pdf,.jpg,.png');
      void window.anydrop.custom.addFile(new File(['x'], 'bad.exe'));
    });
    await expect(page.locator(`${ZONE} .ad-errors`)).toBeVisible();
    await page.locator('#custom-start').click();
    await expect(page.locator(`${ZONE} .ad-summary`)).toContainText('5 of 6 uploaded', {
      timeout: 30_000,
    });

    const heights = await page
      .locator(`${ZONE} .ad-row`)
      .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(5);
    expect(new Set(heights), 'every row is 48px').toEqual(new Set([48]));

    const small = await page.locator(ZONE).evaluate((z) => {
      const out: string[] = [];
      for (const b of Array.from(
        z.querySelectorAll<HTMLElement>('button, a, [role=button], input, select'),
      )) {
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height || b.hidden || getComputedStyle(b).visibility === 'hidden')
          continue;
        if ((b as HTMLInputElement).type === 'file') continue;
        const sc = b.closest('[role=tree],.ad-error-list');
        if (sc) {
          const s = sc.getBoundingClientRect();
          if (r.bottom < s.top || r.top > s.bottom) continue;
        }
        if (r.width < 43.5 || r.height < 43.5) {
          out.push(
            `${b.tagName.toLowerCase()}[${b.getAttribute('data-ad-action') ?? b.className}] ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return out;
    });
    expect(small, 'every visible button is at least 44x44').toEqual([]);
    const o = await overflow(page);
    expect(o, o.wide.join(' | ')).toMatchObject({ page: 0, zone: 0 });
    expect(errors).toEqual([]);
  });

  test('rowHeight overrides the layout default, and null goes back to it', async ({
    page,
    mock,
  }) => {
    const errors = await openCustom(page, mock);
    const h = () =>
      page
        .locator(`${ZONE} .ad-row`)
        .first()
        .evaluate((r) => Math.round(r.getBoundingClientRect().height));
    expect(await h()).toBe(56); // list
    await page.locator('#custom-layout-compact').click();
    await expect.poll(h).toBe(48);
    await page.evaluate(() => window.anydrop.custom.setOption('rowHeight', 64));
    await expect.poll(h).toBe(64);
    await page.evaluate(() => window.anydrop.custom.setOption('rowHeight', null));
    await expect.poll(h).toBe(48);
    await page.locator('#custom-layout-list').click();
    await expect.poll(h).toBe(56);
    expect(errors).toEqual([]);
  });

  test('5,000 files in compact keep the DOM bounded', async ({ page, mock }) => {
    const errors = await openCustom(page, mock, false);
    await page.locator('#custom-layout-compact').click();
    await page.evaluate(() => {
      const files: File[] = [];
      for (let i = 0; i < 5000; i++)
        files.push(new File(['x'], `c-${i}.txt`, { type: 'text/plain' }));
      return window.anydrop.custom.addFiles(files);
    });
    const tree = page.locator(`${ZONE} [role=tree]`);
    await expect(page.locator(`${ZONE} .ad-row`).first()).toBeVisible();
    for (const f of [0, 0.5, 1]) {
      await tree.evaluate((el, k) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * k), f);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      expect(await page.locator(`${ZONE} .ad-row`).count()).toBeLessThan(200);
    }
    expect(errors).toEqual([]);
  });
});

// ------------------------------------------------------------------ the error panel row height

test('errorRowHeight sets the height of the error rows at runtime', async ({ page, mock }) => {
  const errors = await openCustom(page, mock);
  await page.evaluate(() => {
    window.anydrop.custom.setOption('acceptedFiles', '.txt');
    void window.anydrop.custom.addFile(new File(['x'], 'bad.exe'));
  });
  const row = page.locator(`${ZONE} .ad-error-row`).first();
  await expect(row).toBeVisible();
  const h = () => row.evaluate((r) => Math.round(r.getBoundingClientRect().height));
  expect(await h()).toBe(64);
  await page.evaluate(() => window.anydrop.custom.setOption('errorRowHeight', 96));
  await expect.poll(h).toBe(96);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ the locales and the CDN files

test.describe('locale files on a plain page (CDN)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'the CDN files are browser independent');
  });

  async function serve(page: Page, mock: IsolatedMock, html: string): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(`${mock.url}/__cdn/**`, async (route) => {
      const path = new URL(route.request().url()).pathname.replace('/__cdn/', '');
      if (path === '') return route.fulfill({ contentType: 'text/html', body: html });
      try {
        const body = await readFile(join(DIST, path), 'utf8');
        return route.fulfill({
          contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript',
          body,
        });
      } catch {
        return route.fulfill({ status: 404, body: 'not found' });
      }
    });
    await page.goto(`${mock.url}/__cdn/`);
    return errors;
  }

  const LOCALES = ['hi', 'es', 'fr', 'de', 'pt-BR', 'ja', 'zh-CN', 'ar'];

  test('the main script, then a locale file: locale "hi" works, and a preset comes in through <link>', async ({
    page,
    mock,
  }) => {
    const errors = await serve(
      page,
      mock,
      `<!doctype html><html><head>
<link rel="stylesheet" href="/__cdn/style.css">
<link rel="stylesheet" href="/__cdn/themes/glass.css">
</head><body>
<form action="${mock.url}/upload" id="z"></form>
<script src="/__cdn/index.global.js"></script>
<script src="/__cdn/locales/hi.global.js"></script>
<script src="/__cdn/locales/ar.global.js"></script>
<script>
  window.hiCode = Object.keys(AnyDrop.locales).sort().join();
  window.zone = new AnyDrop('#z', { url: '${mock.url}/upload', locale: 'hi', themePreset: 'glass' });
</script></body></html>`,
    );
    expect(await page.evaluate(() => (window as never as { hiCode: string }).hiCode)).toBe('ar,hi');
    const info = await page.evaluate(() => {
      const A = (
        window as unknown as {
          AnyDrop: {
            locales: Record<string, { code: string; dir: string; dict: Record<string, string> }>;
          };
        }
      ).AnyDrop;
      const z = document.querySelector('#z') as HTMLElement;
      return {
        code: A.locales.hi?.code,
        dir: A.locales.hi?.dir,
        message: z.querySelector('.ad-message')?.textContent,
        expected: A.locales.hi?.dict.dictDefaultMessage,
        lang: z.getAttribute('lang'),
        dirAttr: z.getAttribute('dir'),
        cls: z.classList.contains('ad-theme-glass'),
        backdrop: getComputedStyle(z).getPropertyValue('--ad-backdrop').trim(),
        radius: getComputedStyle(z).getPropertyValue('--ad-radius').trim(),
      };
    });
    expect(info).toMatchObject({ code: 'hi', dir: 'ltr', lang: 'hi', dirAttr: 'ltr', cls: true });
    expect(info.message).toBe(info.expected);
    expect(info.backdrop, 'the glass file loaded through <link>').toContain('blur');
    expect(info.radius).toBe('14px');
    // Another locale on the same page, switched at runtime: RTL for ar, back to English with null.
    await page.evaluate(() => (window as never as { zone: Inst }).zone.setOption('locale', 'ar'));
    await expect(page.locator('#z')).toHaveAttribute('dir', 'rtl');
    await page.evaluate(() => (window as never as { zone: Inst }).zone.setOption('locale', null));
    await expect(page.locator('#z .ad-message')).toHaveText('Drop files here to upload');
    expect(errors).toEqual([]);
  });

  test('a locale file loaded before the main script says so, and an unknown code warns and uses English', async ({
    page,
    mock,
  }) => {
    const warnings: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    const errors = await serve(
      page,
      mock,
      `<!doctype html><html><body>
<form action="${mock.url}/upload" id="z"></form>
<script src="/__cdn/locales/hi.global.js"></script>
<script src="/__cdn/index.global.js"></script>
<script>
  AnyDrop.autoDiscover = false;
  new AnyDrop('#z', { url: '${mock.url}/upload', locale: 'xx-unknown' });
</script></body></html>`,
    );
    expect(errors.join('\n')).toContain('Load AnyDrop before its locale files.');
    await expect(page.locator('#z .ad-message')).toHaveText('Drop files here to upload');
    expect(warnings.join('\n')).toMatch(/\[anydrop\].*xx-unknown/);
  });

  test('every locale file registers its own code and direction, and no file still carries the English draft stubs', async ({
    page,
    mock,
  }) => {
    const scripts = ['en', ...LOCALES]
      .map((c) => `<script src="/__cdn/locales/${c}.global.js"></script>`)
      .join('\n');
    const errors = await serve(
      page,
      mock,
      `<!doctype html><html><body><script src="/__cdn/index.global.js"></script>${scripts}</body></html>`,
    );
    const got = await page.evaluate(() => {
      const L = (
        window as never as {
          AnyDrop: {
            locales: Record<string, { code: string; dir: string; dict: Record<string, unknown> }>;
          };
        }
      ).AnyDrop.locales;
      return Object.fromEntries(
        Object.entries(L).map(([k, v]) => [
          k,
          { code: v.code, dir: v.dir, keys: Object.keys(v.dict).length, dict: v.dict },
        ]),
      );
    });
    expect(Object.keys(got).sort()).toEqual(['en', ...LOCALES].sort());
    for (const [k, v] of Object.entries(got)) {
      expect(v.code, k).toBe(k);
      expect(v.dir, k).toBe(k === 'ar' ? 'rtl' : 'ltr');
      expect(v.keys, `${k} has every text`).toBe(got.en!.keys);
    }
    // Translated, not copied: the main texts must differ from English in every language but `en`.
    const MAIN = [
      'dictDefaultMessage',
      'dictPause',
      'dictResume',
      'dictRetry',
      'dictClear',
      'dictSelectFolder',
      'dictStatusSuccess',
      'dictStatusError',
    ];
    const same: string[] = [];
    for (const k of LOCALES)
      for (const key of MAIN) if (got[k]!.dict[key] === got.en!.dict[key]) same.push(`${k}.${key}`);
    expect(same, 'texts still equal to English (draft stubs)').toEqual([]);
    expect(errors).toEqual([]);
  });
});
