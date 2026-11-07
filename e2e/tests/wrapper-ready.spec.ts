// verify-upload scenario 8, "ready for wrappers", through a real browser and the demo page:
//   (a) destroy() mid-upload leaves no listener, timer, observer, object URL or request behind
//       (spies installed before the page's scripts), for the UI class and for the headless core;
//   (b) several instances on one page work independently;
//   (c) importing the built packages in Node, with no DOM, does not throw (ESM and CJS).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './support/mock';
import { openDemo } from './support/ui';

type AnyFn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** Registries of everything that can outlive an instance. Installed before any page script runs. */
async function installLeakSpies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Rec = { what: string };
    const live = new Map<number, Rec>();
    let seq = 0;
    const w = window as unknown as {
      __leak: { snapshot(): number[]; describe(ids: number[]): string[]; requests(): number };
    };
    const name = (t: unknown): string => {
      const o = t as { nodeName?: string; constructor?: { name?: string }; id?: string };
      return (o.nodeName || o.constructor?.name || 'target') + (o.id ? '#' + o.id : '');
    };
    // Event listeners (XHR objects die with the request, so they are not tracked).
    const listeners = new Map<string, number>(); // `${targetId}|type|capture|fn` -> live id
    const ids = new WeakMap<object, number>();
    const idOf = (o: object) => {
      let i = ids.get(o);
      if (i === undefined) ids.set(o, (i = ++seq));
      return i;
    };
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      opts?: boolean | AddEventListenerOptions,
    ) {
      const o = typeof opts === 'object' ? opts : {};
      if (
        fn &&
        !(this instanceof XMLHttpRequest) &&
        !(this instanceof XMLHttpRequestUpload) &&
        !o.once &&
        !o.signal
      ) {
        const key = `${idOf(this)}|${type}|${typeof opts === 'boolean' ? opts : !!o.capture}|${idOf(fn as object)}`;
        if (!listeners.has(key)) {
          const id = ++seq;
          listeners.set(key, id);
          live.set(id, { what: `listener ${type} on ${name(this)}` });
        }
      }
      return add.call(this, type, fn as EventListener, opts);
    };
    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      type: string,
      fn: EventListenerOrEventListenerObject | null,
      opts?: boolean | EventListenerOptions,
    ) {
      if (fn) {
        const cap = typeof opts === 'boolean' ? opts : !!opts?.capture;
        const key = `${idOf(this)}|${type}|${cap}|${idOf(fn as object)}`;
        const id = listeners.get(key);
        if (id !== undefined) {
          listeners.delete(key);
          live.delete(id);
        }
      }
      return remove.call(this, type, fn as EventListener, opts);
    };
    // Timers.
    const st = window.setTimeout;
    const si = window.setInterval;
    const ct = window.clearTimeout;
    const ci = window.clearInterval;
    const timers = new Map<number, number>();
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
      const lid = ++seq;
      live.set(lid, {
        what: `setTimeout(${String(ms)}) ${typeof fn === 'function' ? fn.name || 'anonymous' : 'string'}`,
      });
      const h = st(
        (...x: unknown[]) => {
          live.delete(lid);
          timers.delete(h);
          return typeof fn === 'function' ? fn(...x) : undefined;
        },
        ms,
        ...a,
      );
      timers.set(h, lid);
      return h;
    }) as typeof setTimeout;
    window.clearTimeout = ((h?: number) => {
      const lid = h === undefined ? undefined : timers.get(h);
      if (lid !== undefined) {
        live.delete(lid);
        timers.delete(h as number);
      }
      return ct(h);
    }) as typeof clearTimeout;
    window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
      const lid = ++seq;
      live.set(lid, { what: `setInterval(${String(ms)})` });
      const h = si(fn, ms, ...a);
      timers.set(h, lid);
      return h;
    }) as typeof setInterval;
    window.clearInterval = ((h?: number) => {
      const lid = h === undefined ? undefined : timers.get(h);
      if (lid !== undefined) {
        live.delete(lid);
        timers.delete(h as number);
      }
      return ci(h);
    }) as typeof clearInterval;
    // Observers.
    for (const N of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver'] as const) {
      const C = (
        window as unknown as Record<string, { prototype: { observe: AnyFn; disconnect: AnyFn } }>
      )[N];
      if (!C) continue;
      const obs = C.prototype.observe;
      const dis = C.prototype.disconnect;
      const mine = new WeakMap<object, number>();
      C.prototype.observe = function (this: object, ...a: unknown[]) {
        if (!mine.has(this)) {
          const id = ++seq;
          mine.set(this, id);
          live.set(id, { what: `${N}.observe` });
        }
        return obs.apply(this, a);
      };
      C.prototype.disconnect = function (this: object) {
        const id = mine.get(this);
        if (id !== undefined) {
          live.delete(id);
          mine.delete(this);
        }
        return dis.call(this);
      };
    }
    // Object URLs (thumbnails).
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const urls = new Map<string, number>();
    URL.createObjectURL = (b: Blob | MediaSource) => {
      const u = create.call(URL, b);
      const id = ++seq;
      urls.set(u, id);
      live.set(id, { what: 'object URL' });
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      const id = urls.get(u);
      if (id !== undefined) {
        live.delete(id);
        urls.delete(u);
      }
      return revoke.call(URL, u);
    };
    // Requests in flight.
    let inFlight = 0;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body) {
      inFlight++;
      let done = false;
      const end = () => {
        if (!done) {
          done = true;
          inFlight--;
        }
      };
      this.addEventListener('loadend', end);
      return send.call(this, body as XMLHttpRequestBodyInit);
    };
    w.__leak = {
      snapshot: () => [...live.keys()],
      describe: (list) => list.map((i) => live.get(i)?.what ?? '?').filter((x) => x !== '?'),
      requests: () => inFlight,
    };
  });
}

const baseline = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __leak: { snapshot(): number[] } }).__leak.snapshot(),
  );
const leaked = (page: Page, before: number[]) =>
  page.evaluate((b) => {
    const l = (
      window as unknown as { __leak: { snapshot(): number[]; describe(x: number[]): string[] } }
    ).__leak;
    return l.describe(l.snapshot().filter((i) => !b.includes(i)));
  }, before);

for (const kind of ['ui', 'core'] as const) {
  test(`(a) destroy() mid-upload leaves no listeners, timers, observers, URLs or requests (${kind})`, async ({
    page,
    mock,
  }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'engine independent: runs once, in chromium',
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installLeakSpies(page);
    await openDemo(page, mock);
    await mock.configure({ latencyMs: 250 });
    const before = await baseline(page);
    await page.evaluate(
      async ({ kind, url }) => {
        const all = (window as unknown as { anydrop: Record<string, unknown> }).anydrop as {
          AnyDrop: new (el: string, o: Record<string, unknown>) => Record<string, AnyFn>;
          headless: { constructor: new (o: Record<string, unknown>) => Record<string, AnyFn> };
        };
        const opts = {
          url: `${url}/upload`,
          chunking: true,
          chunkSize: 16 * 1024,
          forceChunking: true,
          parallelUploads: 2,
          sendManifest: true,
          manifestUrl: `${url}/upload/manifest`,
          finalizeUrl: `${url}/upload/finalize`,
          chunkStatusUrl: `${url}/upload/status`,
        };
        let inst: Record<string, AnyFn>;
        if (kind === 'ui') {
          const el = document.createElement('div');
          el.id = 'leak-zone';
          document.body.appendChild(el);
          inst = new all.AnyDrop('#leak-zone', { ...opts, hiddenInputContainer: '#leak-zone' });
        } else {
          inst = new all.headless.constructor(opts);
        }
        const png = Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          ),
          (c) => c.charCodeAt(0),
        );
        const files = [new File([png], 'dot.png', { type: 'image/png' })];
        for (let i = 0; i < 6; i++) {
          files.push(new File([new Uint8Array(100_000).fill(i + 1)], `leak-${i}.bin`));
        }
        if (kind === 'ui') inst.addFiles!(files);
        else inst.addFromInput!(files);
        (window as unknown as { __leakInst: unknown }).__leakInst = inst;
      },
      { kind, url: mock.url },
    );
    // Mid-upload: requests are in flight and some chunks are on the server.
    await expect
      .poll(async () => (await mock.report()).uploads.reduce((n, u) => n + u.received.length, 0), {
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __leak: { requests(): number } }).__leak.requests(),
      ),
    ).toBeGreaterThan(0);
    await page.evaluate(() => {
      (window as unknown as { __leakInst: { destroy(): void } }).__leakInst.destroy();
    });
    await page.waitForTimeout(1500); // every pending retry or throttle timer would have fired by now
    expect(await leaked(page, before)).toEqual([]);
    expect(
      await page.evaluate(() =>
        (window as unknown as { __leak: { requests(): number } }).__leak.requests(),
      ),
    ).toBe(0);
    // And nothing more reaches the server.
    const n = (await mock.log()).length;
    await page.waitForTimeout(1200);
    expect((await mock.log()).length).toBe(n);
    if (kind === 'ui') {
      // destroy() empties the zone it rendered into.
      expect(await page.locator('#leak-zone').evaluate((e) => e.innerHTML)).toBe('');
    }
    expect(errors).toEqual([]);
  });
}

test('(b) several instances on one page work independently', async ({ page, mock }) => {
  await openDemo(page, mock);
  await mock.configure({ latencyMs: 80 });
  const res = await page.evaluate(
    async ({ url }) => {
      type Inst = {
        addFiles(f: File[]): void;
        pause(): void;
        resume(): void;
        destroy(): void;
        on(e: string, fn: (...a: unknown[]) => void): unknown;
        getAcceptedFiles(): Array<{ name: string; status: string }>;
        files: Array<{ name: string; status: string }>;
      };
      const AnyDrop = (
        window as unknown as {
          anydrop: { AnyDrop: new (el: string, o: Record<string, unknown>) => Inst };
        }
      ).anydrop.AnyDrop;
      const mk = (id: string) => {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
        return new AnyDrop('#' + id, {
          url: `${url}/upload`,
          chunking: true,
          chunkSize: 16 * 1024,
          forceChunking: true,
          hiddenInputContainer: '#' + id,
        });
      };
      const A = mk('inst-a');
      const B = mk('inst-b');
      const C = mk('inst-c');
      const seen: Record<string, string[]> = { a: [], b: [], c: [] };
      for (const [k, i] of [
        ['a', A],
        ['b', B],
        ['c', C],
      ] as const) {
        i.on('success', (f) => seen[k]!.push((f as { name: string }).name));
      }
      const mkFiles = (p: string) =>
        [0, 1, 2].map((i) => new File([new Uint8Array(60_000).fill(i + 1)], `${p}-${i}.bin`));
      A.pause(); // A is paused before it starts: it must not upload while B and C do
      A.addFiles(mkFiles('a'));
      B.addFiles(mkFiles('b'));
      C.addFiles(mkFiles('c'));
      await new Promise((r) => setTimeout(r, 200));
      C.destroy(); // destroying one instance does not touch the others
      const t0 = Date.now();
      while (seen.b!.length < 3 && Date.now() - t0 < 30_000)
        await new Promise((r) => setTimeout(r, 50));
      const bDone = [...seen.b!].sort();
      const aWhilePaused = [...seen.a!];
      A.resume();
      const t1 = Date.now();
      while (seen.a!.length < 3 && Date.now() - t1 < 30_000)
        await new Promise((r) => setTimeout(r, 50));
      return {
        bDone,
        aWhilePaused,
        aDone: [...seen.a!].sort(),
        aOwn: A.files.map((f) => f.name).sort(),
        bOwn: B.files.map((f) => f.name).sort(),
      };
    },
    { url: mock.url },
  );
  expect(res.bDone).toEqual(['b-0.bin', 'b-1.bin', 'b-2.bin']);
  expect(res.aWhilePaused).toEqual([]);
  expect(res.aDone).toEqual(['a-0.bin', 'a-1.bin', 'a-2.bin']);
  expect(res.aOwn).toEqual(['a-0.bin', 'a-1.bin', 'a-2.bin']); // no file crossed instances
  expect(res.bOwn).toEqual(['b-0.bin', 'b-1.bin', 'b-2.bin']);
  const report = await mock.report();
  const paths = report.merged.files.map((f) => f.path);
  for (const p of ['a', 'b']) for (const i of [0, 1, 2]) expect(paths).toContain(`${p}-${i}.bin`);
  expect(paths.filter((p) => p.startsWith('c-')).length).toBeLessThan(3); // C was destroyed mid-way
});

test('(c) the built packages import in Node without a DOM, as ESM and as CJS', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs once, in Node');
  const script = `
    const assert = require('node:assert');
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    (async () => {
      const root = process.argv[1];
      const path = require('node:path');
      const { pathToFileURL } = require('node:url');
      for (const pkg of ['core', 'ui']) {
        const esm = await import(pathToFileURL(path.join(root, 'packages', pkg, 'dist', 'index.js')).href);
        const cjs = require(path.join(root, 'packages', pkg, 'dist', 'index.cjs'));
        for (const m of [esm, cjs]) {
          assert.equal(typeof m.VERSION, 'string');
          assert.equal(typeof m.AnyDropCore === 'function' || typeof m.AnyDrop === 'function', true);
        }
        assert.equal(typeof window, 'undefined');
      }
      console.log('ok');
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script, ROOT], { encoding: 'utf8' });
  expect(out.trim()).toBe('ok');
});
