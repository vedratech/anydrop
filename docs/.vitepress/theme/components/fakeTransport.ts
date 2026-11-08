// Shared by the live demo and the theme builder: loads the real AnyDrop UI build that was copied to
// /demo at build time, and provides the fake `transport` that answers every request in the browser.
// Nothing here talks to a server.
import { withBase } from 'vitepress';

// Minimal local copies of the public transport types (the docs site does not depend on core).
interface Reply {
  status: number;
  body: unknown;
  header: (name: string) => string | null;
  error?: 'network' | 'timeout' | 'abort' | 'stalled';
}
interface FakeRequest {
  method: string;
  body: FormData | Blob | string | null;
  beforeSend?: (xhr: unknown) => void;
}
interface FakeHandle {
  abort(): void;
  onProgress?: (loaded: number, total: number) => void;
  promise: Promise<Reply>;
}
/** The part of the AnyDrop instance the docs pages use. */
export interface AnyDropLike {
  addFile(file: File, folder?: string): void;
  setOption(name: string, value: unknown): void;
  destroy(): void;
  element?: HTMLElement | null;
}

/** Read by the fake transport on every request, so changing a value takes effect at once. */
export interface Sim {
  failRate: number;
  speed: number; // MB/s
  offline: boolean;
}

export interface SimHooks {
  onRequest?: () => void;
  onFailure?: () => void;
}

/** The fake transport: the public `Transport` interface, with no network at all. */
export function createFakeTransport(sim: Sim, hooks: SimHooks = {}) {
  return {
    send(request: FakeRequest): FakeHandle {
      hooks.onRequest?.();
      let finish!: (r: Reply) => void;
      const promise = new Promise<Reply>((resolve) => (finish = resolve));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;
      const end = (r: Reply) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        finish(r);
      };
      const res = (status: number, body: unknown): Reply => ({ status, body, header: () => null });
      const noReply = (error: 'network' | 'abort'): Reply => ({
        status: 0,
        body: null,
        header: () => null,
        error,
      });

      const handle: FakeHandle = { promise, abort: () => end(noReply('abort')) };

      const isUpload = request.body instanceof FormData || request.body instanceof Blob;
      const latency = 120 + Math.random() * 220;

      if (!isUpload) {
        // manifest, finalize, probe
        timer = setTimeout(() => {
          if (sim.offline) return end(noReply('network'));
          if (request.method === 'HEAD') return end(res(204, null));
          let body: unknown = { ok: true };
          try {
            const sent = JSON.parse(String(request.body)) as { relativePath?: string };
            if (sent.relativePath) body = { ok: true, path: sent.relativePath };
          } catch {
            /* no JSON body */
          }
          end(res(200, body));
        }, latency);
        return handle;
      }

      // An upload: report progress while the body "goes out", and maybe fail on the way.
      request.beforeSend?.(undefined);
      const blob: Blob | null =
        request.body instanceof FormData ? (request.body.get('file') as Blob | null) : request.body;
      const total = Math.max(1, blob ? blob.size : 1);
      const duration = latency + (total / (sim.speed * 1024 * 1024)) * 1000;
      const failAt = Math.random() < sim.failRate ? 0.2 + Math.random() * 0.7 : -1;
      const start = Date.now();
      const tick = () => {
        if (sim.offline) return end(noReply('network'));
        const t = Math.min(1, (Date.now() - start) / duration);
        handle.onProgress?.(Math.round(total * t), total);
        if (failAt >= 0 && t >= failAt) {
          hooks.onFailure?.();
          return end(res(503, { code: 'SERVER_ERROR', message: 'Simulated server error' }));
        }
        if (t >= 1) return end(res(200, { ok: true }));
        timer = setTimeout(tick, 60);
      };
      timer = setTimeout(tick, 60);
      return handle;
    },
  };
}

function makeFile(name: string, kb: number, type: string): File {
  return new File([new Uint8Array(kb * 1024)], name, { type });
}

/** Adds a small sample tree ("Trip <n>") and one loose file. */
export function addSampleFolderTo(ad: AnyDropLike, n: number) {
  const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
  const root = `Trip ${n}`;
  const plan: [string, string, number, string][] = [
    [`${root}/Day 1`, 'IMG_0001.jpg', rand(900, 2400), 'image/jpeg'],
    [`${root}/Day 1`, 'IMG_0002.jpg', rand(900, 2400), 'image/jpeg'],
    [`${root}/Day 1`, 'IMG_0003.jpg', rand(900, 2400), 'image/jpeg'],
    [`${root}/Day 2`, 'IMG_0101.jpg', rand(900, 2400), 'image/jpeg'],
    [`${root}/Day 2`, 'IMG_0102.jpg', rand(900, 2400), 'image/jpeg'],
    [`${root}/Documents`, 'tickets.pdf', rand(200, 800), 'application/pdf'],
    [`${root}/Documents`, 'notes.txt', rand(2, 20), 'text/plain'],
  ];
  for (const [folder, name, kb, type] of plan) ad.addFile(makeFile(name, kb, type), folder);
  ad.addFile(makeFile(`summary-${n}.txt`, 4, 'text/plain')); // a loose file
}

/** The options both pages use: the real UI, no real server. */
export function fakeOptions(transport: unknown): Record<string, unknown> {
  return {
    url: '/fake/upload', // never requested: the transport answers
    transport,
    chunking: true,
    chunkSize: 512 * 1024,
    parallelUploads: 2,
    sendManifest: true,
    manifestUrl: '/fake/manifest',
    finalizeUrl: '/fake/finalize',
    connectivityProbeUrl: '/fake/ping',
    persistState: false, // there is no real server to resume against
  };
}

/** Loads the AnyDrop stylesheet and script (once). */
export function loadAnyDrop(): Promise<void> {
  const w = window as unknown as { AnyDrop?: unknown };
  if (w.AnyDrop) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = withBase('/demo/anydrop-ui.css');
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = withBase('/demo/anydrop-ui.js');
    js.onload = () => resolve();
    js.onerror = () => reject(new Error('Could not load the AnyDrop build'));
    document.head.appendChild(js);
  });
}

/** Loads a preset stylesheet (`/demo/themes/<name>.css`) once. Resolves false when it does not exist. */
export function loadPreset(name: string): Promise<boolean> {
  const id = `ad-preset-${name}`;
  if (document.getElementById(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = withBase(`/demo/themes/${name}.css`);
    link.onload = () => resolve(true);
    link.onerror = () => {
      link.remove();
      resolve(false);
    };
    document.head.appendChild(link);
  });
}
