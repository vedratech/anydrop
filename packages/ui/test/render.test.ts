import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyDropFile } from '@vedratech/anydrop-core';
import type { AnyDropFileContext, AnyDropFolderContext, AnyDropToolbarContext } from '../src/index';
import { file, mount, settle } from './helpers';

let reported: unknown[];
beforeEach(() => {
  reported = [];
  vi.stubGlobal('reportError', (e: unknown) => reported.push(e));
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Sets the progress of the first file as core does, then announces it. */
const progress = (
  ad: { files: AnyDropFile[]; emit: (e: 'uploadprogress', ...a: never[]) => void },
  p: number,
) => {
  const f = ad.files[0] as AnyDropFile;
  f.upload.progress = p;
  (ad.emit as (e: string, ...a: unknown[]) => void)('uploadprogress', f, p, p);
};
const names = (n: number) => Array.from({ length: n }, (_, i) => file(`f${i}.txt`));
const rows = (el: HTMLElement) => el.querySelectorAll('.ad-file-row').length;
const scrollTo = (el: HTMLElement, top: number) => {
  const l = el.querySelector<HTMLElement>('.ad-list')!;
  l.scrollTop = top;
  l.dispatchEvent(new Event('scroll'));
};

describe('render.file: return values', () => {
  it('returning nothing or null keeps the default content and may decorate it', async () => {
    const { el, ad } = mount({
      render: {
        file(ctx) {
          ctx.row.setAttribute('data-decorated', ctx.label);
          return null;
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const row = el.querySelector('.ad-file-row')!;
    expect(row.getAttribute('data-decorated')).toBe('a.txt');
    expect(row.querySelector('.ad-file-preview')).not.toBeNull();
    expect(row.classList.contains('ad-row-custom')).toBe(false);
    ad.destroy();
  });

  it('an element replaces the content and is static', async () => {
    const hook = vi.fn(function (ctx: AnyDropFileContext) {
      return ctx.html`<p class="mine">${ctx.label}</p>`;
    });
    const { el, ad } = mount({ render: { file: hook } });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const row = el.querySelector('.ad-file-row')!;
    expect(row.querySelector('.mine')?.textContent).toBe('a.txt');
    expect(row.querySelector('.ad-file-preview')).toBeNull();
    expect(row.classList.contains('ad-row-custom')).toBe(true);
    expect(row.getAttribute('role')).toBe('treeitem');
    ad.emit('uploadprogress', ad.files[0] as AnyDropFile, 50, 5);
    await settle(ad);
    expect(hook).toHaveBeenCalledTimes(1);
    ad.destroy();
  });

  it('a view with el gets update on progress with the same element, and destroy once', async () => {
    const calls = { update: 0, destroy: 0 };
    let made: HTMLElement | null = null;
    const { el, ad } = mount({
      render: {
        file(ctx) {
          const pct = document.createElement('span');
          pct.className = 'pct';
          made = pct;
          const paint = (c: AnyDropFileContext) =>
            (pct.textContent = String(Math.round(c.progress)));
          paint(ctx);
          return {
            el: pct,
            update(c) {
              calls.update++;
              paint(c);
            },
            destroy() {
              calls.destroy++;
            },
          };
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const first = el.querySelector('.pct');
    expect(first).toBe(made);
    progress(ad, 40);
    await settle(ad);
    expect(el.querySelector('.pct')).toBe(first);
    expect(first!.textContent).toBe('40');
    expect(calls.update).toBeGreaterThan(0);
    expect(calls.destroy).toBe(0);
    ad.destroy();
    expect(calls.destroy).toBe(1);
  });

  it('a view without el keeps the default content and gets update and destroy', async () => {
    const calls = { update: 0, destroy: 0 };
    const { el, ad } = mount({
      render: {
        file: () => ({
          update: () => void calls.update++,
          destroy: () => void calls.destroy++,
        }),
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(el.querySelector('.ad-file-row .ad-file-preview')).not.toBeNull();
    ad.emit('uploadprogress', ad.files[0] as AnyDropFile, 10, 1);
    await settle(ad);
    expect(calls.update).toBeGreaterThan(0);
    ad.removeFile(ad.files[0] as AnyDropFile);
    await settle(ad);
    expect(calls.destroy).toBe(1);
    ad.destroy();
    expect(calls.destroy).toBe(1);
  });

  it('a string is shown as text, never as HTML', async () => {
    const { el, ad } = mount({
      render: { file: (ctx) => `<img src=x onerror="window.pwned=1">${ctx.label}` },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const row = el.querySelector('.ad-file-row')!;
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain('<img src=x');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    ad.destroy();
  });

  it('this is the instance', async () => {
    const seen: unknown[] = [];
    const { ad } = mount({
      render: {
        file() {
          seen.push(this);
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(seen[0]).toBe(ad);
    ad.destroy();
  });
});

describe('render hooks: context', () => {
  it('ctx.html escapes every value, also in a crafted file name', async () => {
    const evil = '<img src=x onerror=alert(1)>.txt';
    const { el, ad } = mount({
      render: { file: (ctx) => ctx.html`<b class="n" title="${ctx.label}">${ctx.label}</b>` },
    });
    await ad.addFiles([file(evil)]);
    await settle(ad);
    const b = el.querySelector('.ad-file-row .n')!;
    expect(b.querySelector('img')).toBeNull();
    expect(b.textContent).toBe(evil);
    expect(b.getAttribute('title')).toBe(evil);
    ad.destroy();
  });

  it('ctx.html returns a div around several top-level nodes, and handles null values', () => {
    const { ad } = mount();
    const c = ad._uiBase();
    const d = c.html`<i>a</i><i>${null}${undefined}b</i>`;
    expect(d.tagName).toBe('DIV');
    expect(d.children.length).toBe(2);
    expect(d.textContent).toBe('ab');
    expect(c.html`<em>${'&"\''}</em>`.textContent).toBe('&"\'');
    ad.destroy();
  });

  it('ctx.t uses the current text and fills placeholders; unknown keys return the key', () => {
    const { ad } = mount({ dictFolderCount: '{{done}} / {{total}}' });
    const c = ad._uiBase();
    expect(c.t('dictFolderCount', { done: 1, total: 2 })).toBe('1 / 2');
    expect(c.t('dictPause')).toBe('Pause');
    expect(c.t('nope' as never)).toBe('nope');
    ad.setOption('dictPause', 'Halt');
    expect(ad._uiBase().t('dictPause')).toBe('Halt');
    ad.destroy();
  });

  it('ctx.icon uses the icons option; ctx has the state and the parts', async () => {
    let seen: AnyDropFileContext | null = null;
    const { ad } = mount({
      icons: { star: '<svg id="s"></svg>' },
      render: {
        file(ctx) {
          seen = ctx;
          return null;
        },
      },
    });
    await ad.addFiles([file('a.txt', 2048)]);
    await settle(ad);
    const c = seen as unknown as AnyDropFileContext;
    expect(c.icon('star').querySelector('#s')).not.toBeNull();
    expect(c.kind).toBe('file');
    expect(c.status).toBe('added');
    expect(c.sizeText).toContain('2');
    expect(c.sizeText).not.toContain('<');
    expect(c.statusText).toBe('Added');
    expect(c.layout).toBe('list');
    expect(c.can.cancel).toBe(true);
    expect(c.can.remove).toBe(false);
    expect(c.parts.actions.classList.contains('ad-row-actions')).toBe(true);
    expect(c.parts.badge.textContent).toBe('Added');
    ad.destroy();
  });

  it('context actions call the core methods and are no-ops when they do not apply', async () => {
    let seen: AnyDropFileContext | null = null;
    const { ad } = mount({
      render: {
        file(ctx) {
          seen = ctx;
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const c = seen as unknown as AnyDropFileContext;
    const pause = vi.spyOn(ad, 'pauseFile');
    const remove = vi.spyOn(ad, 'removeFile');
    const cancel = vi.spyOn(ad, 'cancelUpload');
    c.remove(); // not finished: no-op
    c.resume(); // not paused by the user: no-op
    expect(remove).not.toHaveBeenCalled();
    c.pause();
    expect(pause).toHaveBeenCalledWith(ad.files[0]);
    c.cancel();
    expect(cancel).toHaveBeenCalled();
    ad.destroy();
  });
});

describe('render hooks: errors and focus', () => {
  it('a hook that throws is reported and the default content stays', async () => {
    const { el, ad } = mount({
      render: {
        file() {
          throw new Error('boom');
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(reported.length).toBeGreaterThan(0);
    expect(String(reported[0])).toContain('boom');
    expect(el.querySelector('.ad-file-row .ad-file-preview')).not.toBeNull();
    ad.destroy();
  });

  it('a throwing update or destroy is reported and ignored', async () => {
    const { ad } = mount({
      render: {
        file: () => ({
          update() {
            throw new Error('upd');
          },
          destroy() {
            throw new Error('dst');
          },
        }),
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    ad.emit('uploadprogress', ad.files[0] as AnyDropFile, 10, 1);
    await settle(ad);
    ad.destroy();
    expect(reported.map(String).join()).toContain('upd');
    expect(reported.map(String).join()).toContain('dst');
  });

  it('focus on a button inside a custom row survives progress updates', async () => {
    const { el, ad } = mount({
      render: {
        file(ctx) {
          const root = ctx.html`<div><button type="button" class="ad-btn mine">go</button><span class="p"></span></div>`;
          const p = root.querySelector('.p')!;
          return { el: root, update: (c) => (p.textContent = String(c.progress)) };
        },
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const btn = el.querySelector<HTMLElement>('.mine')!;
    btn.focus();
    expect(document.activeElement).toBe(btn);
    for (const p of [10, 50, 90]) {
      progress(ad, p);
      await settle(ad);
      expect(document.activeElement).toBe(btn);
    }
    expect(el.querySelector('.p')!.textContent).toBe('90');
    ad.destroy();
  });

  it('update is batched: many events in one frame give one update', async () => {
    const update = vi.fn();
    const { ad } = mount({ render: { file: () => ({ update }) } });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    update.mockClear();
    const f = ad.files[0] as AnyDropFile;
    for (let i = 1; i <= 20; i++) ad.emit('uploadprogress', f, i, i);
    await settle(ad);
    expect(update).toHaveBeenCalledTimes(1);
    ad.destroy();
  });
});

describe('render hooks: virtualisation and cleanup', () => {
  it('mounts equal mounted rows; rows that scroll out are destroyed exactly once', async () => {
    let mounts = 0;
    let destroys = 0;
    const { el, ad } = mount({
      folders: false,
      render: {
        file: () => {
          mounts++;
          return { destroy: () => void destroys++ };
        },
      },
    });
    await ad.addFiles(names(300));
    await settle(ad);
    expect(mounts).toBe(rows(el));
    expect(rows(el)).toBeLessThan(40);
    scrollTo(el, 56 * 200);
    expect(destroys).toBeGreaterThan(0);
    expect(mounts - destroys).toBe(rows(el));
    scrollTo(el, 0);
    expect(mounts - destroys).toBe(rows(el));
    ad.destroy();
    expect(destroys).toBe(mounts);
  });

  it('destroy runs once on removeFile, setOption(render) and destroy()', async () => {
    const live = new Set<number>();
    let id = 0;
    const doubled = vi.fn();
    const render = () => ({
      file: () => {
        const mine = ++id;
        live.add(mine);
        return {
          destroy: () => {
            if (!live.delete(mine)) doubled();
          },
        };
      },
    });
    const { el, ad } = mount({ render: render() });
    await ad.addFiles(names(3));
    await settle(ad);
    expect(live.size).toBe(rows(el));
    ad.removeFile(ad.files[0] as AnyDropFile);
    await settle(ad);
    expect(live.size).toBe(rows(el));
    ad.setOption('render', render());
    await settle(ad);
    expect(live.size).toBe(rows(el));
    expect(rows(el)).toBe(2);
    ad.setOption('render', {});
    await settle(ad);
    expect(live.size).toBe(0);
    ad.setOption('render', render());
    await settle(ad);
    ad.destroy();
    expect(live.size).toBe(0);
    expect(doubled).not.toHaveBeenCalled();
  });

  it('keeps virtualisation at 10,000 rows', async () => {
    let mounts = 0;
    const { el, ad } = mount({ folders: false, render: { file: () => void mounts++ } });
    await ad.addFiles(names(10000));
    await settle(ad);
    expect(rows(el)).toBeLessThan(60);
    scrollTo(el, 56 * 9000);
    expect(rows(el)).toBeLessThan(60);
    expect(mounts).toBeLessThan(200);
    ad.destroy();
  });
});

describe('render.folder', () => {
  it('replaces or decorates a folder row, and its context has the toggle and counts', async () => {
    let seen: AnyDropFolderContext | null = null;
    const { el, ad } = mount({
      render: {
        folder(ctx) {
          seen = ctx;
          return { destroy: () => void 0, update: () => void 0 };
        },
      },
    });
    await ad.addFile(file('a.txt'), 'Photos');
    await settle(ad);
    const c = seen as unknown as AnyDropFolderContext;
    expect(c.kind).toBe('folder');
    expect(c.label).toBe('Photos');
    expect(c.expanded).toBe(true);
    expect(c.counts.total).toBe(1);
    c.toggle();
    await settle(ad);
    expect(el.querySelector('.ad-file-row')).toBeNull();
    ad.destroy();
  });
});

describe('render.toolbar', () => {
  it('replaces the content, keeps role and label, and updates only when values changed', async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    let ctx0: AnyDropToolbarContext | null = null;
    const { el, ad } = mount({
      render: {
        toolbar(ctx) {
          ctx0 = ctx;
          const d = ctx.html`<div class="tb">${ctx.summaryText}</div>`;
          d.appendChild(ctx.parts.actions);
          return { el: d, update, destroy };
        },
      },
    });
    await ad.addFiles(names(2));
    await settle(ad);
    const tb = el.querySelector('.ad-toolbar')!;
    expect(tb.getAttribute('role')).toBe('toolbar');
    expect(tb.getAttribute('aria-label')).toBe('Upload actions');
    expect(tb.querySelector('.tb')).not.toBeNull();
    expect(tb.querySelector('[data-ad-action=pause-all]')).not.toBeNull();
    const n = update.mock.calls.length;
    await settle(ad);
    await settle(ad);
    expect(update.mock.calls.length).toBe(n); // nothing changed
    ad.emit('totaluploadprogress', 50, 10, 5);
    await settle(ad);
    expect(update.mock.calls.length).toBe(n + 1);
    expect((ctx0 as unknown as { counts: { total: number } }).counts).toBeDefined();
    ad.setOption('render', {});
    expect(destroy).toHaveBeenCalledTimes(1);
    ad.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('render.message', () => {
  it('replaces the message, updates on state changes, and its buttons do not open the picker', async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    const { el, ad } = mount({
      render: {
        message(ctx) {
          const d = ctx.html`<div><span class="t">${ctx.text}</span><button type="button" class="ad-btn own">own</button></div>`;
          return { el: d, update, destroy };
        },
      },
    });
    const msg = el.querySelector('.ad-message')!;
    expect(msg.querySelector('.t')?.textContent).toBe('Drop files here to upload');
    expect(msg.querySelector('.ad-message-text')).toBeNull();
    const input = ad.hiddenFileInput!;
    const open = vi.spyOn(input, 'click');
    msg.querySelector<HTMLElement>('.own')!.click();
    expect(open).not.toHaveBeenCalled();
    msg.querySelector<HTMLElement>('.t')!.click(); // a plain click still opens it
    expect(open).toHaveBeenCalledTimes(1);
    await settle(ad);
    const n = update.mock.calls.length;
    el.dispatchEvent(new Event('dragenter', { bubbles: true, cancelable: true }));
    await settle(ad);
    expect(update.mock.calls.length).toBe(n + 1);
    ad.setOption('dictDefaultMessage', 'Zone');
    await settle(ad);
    expect(update.mock.calls.length).toBe(n + 2);
    ad.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('setOption(render) rebuilds the message and destroys the old view', async () => {
    const destroy = vi.fn();
    const { el, ad } = mount({ render: { message: () => ({ destroy }) } });
    expect(el.querySelector('.ad-message-text')).not.toBeNull();
    ad.setOption('render', { message: () => 'Hello' });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.ad-message')!.textContent).toBe('Hello');
    ad.destroy();
  });
});

describe('render.errorItem', () => {
  it('runs for every error row, never gets update, and is destroyed when the list changes', async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    const { el, ad } = mount({
      render: {
        errorItem(ctx) {
          const d = ctx.html`<div class="ei">${ctx.entry.relativePath}</div>`;
          if (ctx.parts.retry) d.appendChild(ctx.parts.retry);
          return { el: d, update, destroy };
        },
      },
      acceptedFiles: 'image/*',
    });
    await ad.addFiles([file('a.txt'), file('b.txt')]);
    await settle(ad);
    const list = ad.getErrors();
    expect(list.length).toBe(2);
    expect(el.querySelectorAll('.ad-error-row .ei').length).toBe(2);
    expect(update).not.toHaveBeenCalled();
    ad.clearErrors();
    await settle(ad);
    expect(destroy).toHaveBeenCalledTimes(2);
    ad.destroy();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('errorRowHeight sets the row height of the error panel', async () => {
    const { el, ad } = mount({ acceptedFiles: 'image/*', errorRowHeight: 90 });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(el.querySelector<HTMLElement>('.ad-error-row')!.style.height).toBe('90px');
    ad.setOption('errorRowHeight', 100);
    await settle(ad);
    expect(el.querySelector<HTMLElement>('.ad-error-row')!.style.height).toBe('100px');
    ad.destroy();
  });
});
