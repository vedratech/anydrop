// In-page harness for core e2e tests (M3): loads the built core IIFE on the mock's origin and
// installs `window.H`, which creates an AnyDropCore whose built-in XHR transport is wrapped to
// record every upload POST (uploadId, chunk index, outcome), logs pause/lifecycle events, builds
// mocked FileSystemEntry drops, and reads the resume records straight from IndexedDB.
/* eslint-disable @typescript-eslint/no-explicit-any -- page-side glue around the untyped IIFE global */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CORE_IIFE = join(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'core',
  'dist',
  'index.global.js',
);

export interface SentChunk {
  uploadId: string;
  index: number;
  path: string;
  /** HTTP status, or 'abort' / 'network' / 'timeout', or null while in flight. */
  status: number | string | null;
}

export interface FileState {
  path: string;
  status: string;
  uuid: string;
  done: number[];
  skipped: boolean;
}

/** Opens the mock's origin (same-origin requests), loads the core IIFE and installs `window.H`. */
export async function openHarness(page: Page, mockUrl: string): Promise<void> {
  await page.goto(`${mockUrl}/__health`);
  await page.addScriptTag({ path: CORE_IIFE });
  await page.evaluate(install);
}

function install(): void {
  const w = window as any;
  const mod = w.AnyDropCore;
  const H: any = { sent: [], events: [], inFlight: 0, maxInFlight: 0, qc: 0, lastErrors: null };
  H.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  H.until = async (pred: () => boolean, ms = 60_000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('H.until timed out: ' + String(pred));
      await H.sleep(5);
    }
  };
  /** Resolves on the next upload POST (optionally one matching `pred`). */
  H.nextSend = (pred?: (r: any) => boolean) =>
    new Promise((resolve) => {
      H.onSend = (r: any) => {
        if (!pred || pred(r)) {
          H.onSend = null;
          resolve(r);
        }
      };
    });
  H.make = (options: Record<string, unknown>) => {
    const transport = {
      send(req: any) {
        const fd = req.body instanceof FormData ? req.body : null;
        let rec: any = null;
        const before = req.beforeSend;
        req.beforeSend = (x: unknown) => {
          if (before) before(x);
          if (!fd || fd.get('adChunkIndex') == null) return;
          rec = {
            uploadId: String(fd.get('adUploadId')),
            index: Number(fd.get('adChunkIndex')),
            path: String(fd.get('adRelativePath')),
            status: null,
          };
          H.sent.push(rec);
          H.inFlight++;
          H.maxInFlight = Math.max(H.maxInFlight, H.inFlight);
          if (H.onSend) H.onSend(rec);
        };
        const h = mod.xhrTransport.send(req);
        h.promise.then((res: any) => {
          if (!rec) return;
          H.inFlight--;
          rec.status = res.error || res.status;
        });
        return h;
      },
    };
    // `fastBackoff`: functions cannot cross page.evaluate, so the shortest jitter is set here.
    const extra = options.fastBackoff ? { _random: () => 0 } : {};
    const core = new mod.AnyDropCore({ ...options, ...extra, transport });
    const tag = (t: any) =>
      t.scope === 'all'
        ? `all:${t.reason}`
        : t.scope === 'folder'
          ? `folder:${t.folder.path}`
          : `file:${t.file.relativePath}`;
    core.on('paused', (t: any) => H.events.push('paused:' + tag(t)));
    core.on('resumed', (t: any) => H.events.push('resumed:' + tag(t)));
    core.on('offline', () => H.events.push('offline'));
    core.on('online', () => H.events.push('online'));
    core.on('queuecomplete', () => H.qc++);
    core.on('errorlistchanged', (e: unknown[]) => (H.lastErrors = e));
    H.core = core;
    return core;
  };
  /** A DataTransfer-like drop of mocked entries (readEntries returns at most 100 per call). */
  H.dt = (files: Array<{ path: string; b64: string }>, folders: string[]) => {
    const kids = new Map<string, any[]>();
    const roots: any[] = [];
    const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
    const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);
    for (const d of [...folders].sort()) {
      const children: any[] = [];
      kids.set(d, children);
      const e = {
        isFile: false,
        isDirectory: true,
        name: name(d),
        fullPath: '/' + d,
        createReader() {
          let i = 0;
          return {
            readEntries(ok: (e: any[]) => void) {
              setTimeout(() => {
                ok(children.slice(i, i + 100));
                i += 100;
              }, 0);
            },
          };
        },
      };
      const parent = parentOf(d);
      if (parent) (kids.get(parent) as any[]).push(e);
      else roots.push(e);
    }
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name(f.path), { lastModified: 1_700_000_000_000 });
      const e = {
        isFile: true,
        isDirectory: false,
        name: name(f.path),
        fullPath: '/' + f.path,
        file: (ok: (x: File) => void) => setTimeout(() => ok(file), 0),
      };
      const parent = parentOf(f.path);
      if (parent) (kids.get(parent) as any[]).push(e);
      else roots.push(e);
    }
    return { items: roots.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })) };
  };
  H.state = () =>
    H.core.files.map((f: any) => ({
      path: f.relativePath,
      status: f.status,
      uuid: f.upload.uuid,
      done: [...f.upload.chunksDone].sort((a: number, b: number) => a - b),
      skipped: !!f.upload.skipped,
    }));
  H.acked = () => H.sent.filter((r: any) => r.status === 200);
  /** The resume records in IndexedDB, read the way a fresh page sees them. */
  H.records = () =>
    new Promise((resolve) => {
      const r = indexedDB.open('anydrop', 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore('uploads', { keyPath: 'key' }).createIndex('t', 'updatedAt');
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result;
        const g = db.transaction('uploads', 'readonly').objectStore('uploads').getAll();
        g.onsuccess = () => {
          db.close();
          resolve(g.result);
        };
      };
    });
  w.H = H;
}
