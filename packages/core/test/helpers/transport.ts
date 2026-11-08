// A fake Transport for engine tests: records every request, tracks requests in flight (overall and
// per uploadId), and lets the test answer each request by hand or through an `auto` responder.
import type {
  Transport,
  TransportHandle,
  TransportRequest,
  TransportResponse,
} from '../../src/transport/types';

export type Kind = 'upload' | 'manifest' | 'finalize' | 'status';

export interface Call {
  req: TransportRequest;
  kind: Kind;
  /** The FormData of an upload request (null for binaryBody / JSON requests). */
  form: FormData | null;
  /** Parsed JSON body of a manifest or finalize request. */
  json: Record<string, unknown> | null;
  /** The `xhr` handed to beforeSend (a stand-in object). */
  xhr: object;
  done: boolean;
  aborted: boolean;
  field(name: string): string | null;
  progress(loaded: number, total: number): void;
  reply(status?: number, body?: unknown, headers?: Record<string, string>): void;
  fail(error: 'network' | 'timeout'): void;
  /** Aborts the request as user code would (`file.xhr.abort()`), not through core. */
  abortFromOutside(): void;
}

export interface FakeTransport extends Transport {
  calls: Call[];
  uploads(): Call[];
  open(): Call[];
  inFlight: number;
  maxInFlight: number;
  /** Peak in-flight upload requests per `adUploadId` (or per relative path for whole files). */
  maxPerUpload: Map<string, number>;
}

function kindOf(url: string): Kind {
  if (url.indexOf('/manifest') >= 0) return 'manifest';
  if (url.indexOf('/finalize') >= 0) return 'finalize';
  if (url.indexOf('/status') >= 0) return 'status';
  return 'upload';
}

/** `auto(call)` runs on a microtask after each request is sent; it may call `reply`/`fail`. */
export function fakeTransport(auto?: (call: Call, t: FakeTransport) => void): FakeTransport {
  const per = new Map<string, number>();
  const t: FakeTransport = {
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
    maxPerUpload: new Map(),
    uploads: () => t.calls.filter((c) => c.kind === 'upload'),
    open: () => t.calls.filter((c) => !c.done),
    send(req: TransportRequest): TransportHandle {
      let resolve!: (r: TransportResponse) => void;
      const handle: TransportHandle = {
        abort: () => finish({ status: 0, body: undefined, error: 'abort' }, true),
        promise: new Promise((r) => (resolve = r)),
      };
      const kind = kindOf(req.url);
      const form = req.body instanceof FormData ? req.body : null;
      const xhr = { fake: true };
      const call: Call = {
        req,
        kind,
        form,
        json: typeof req.body === 'string' ? JSON.parse(req.body) : null,
        xhr,
        done: false,
        aborted: false,
        field: (name) => {
          const v = form ? form.get(name) : null;
          return typeof v === 'string' ? v : null;
        },
        progress: (loaded, total) => {
          if (!call.done && handle.onProgress) handle.onProgress(loaded, total);
        },
        reply: (status = 200, body: unknown = { ok: true }, headers = {}) =>
          finish({ status, body, header: (n) => headers[n] ?? headers[n.toLowerCase()] ?? null }),
        fail: (error) => finish({ status: 0, body: undefined, error }),
        abortFromOutside: () => finish({ status: 0, body: undefined, error: 'abort' }),
      };
      let key = '';
      function finish(r: Partial<TransportResponse>, aborted = false): void {
        if (call.done) return;
        call.done = true;
        call.aborted = aborted;
        if (kind === 'upload') {
          t.inFlight--;
          per.set(key, (per.get(key) || 1) - 1);
        }
        resolve({ header: () => null, ...r } as TransportResponse);
      }
      if (req.beforeSend) req.beforeSend(xhr);
      if (kind === 'upload') {
        key = call.field('adUploadId') || call.field('adRelativePath') || 'whole';
        t.inFlight++;
        t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
        per.set(key, (per.get(key) || 0) + 1);
        t.maxPerUpload.set(key, Math.max(t.maxPerUpload.get(key) || 0, per.get(key) as number));
      }
      t.calls.push(call);
      if (auto) queueMicrotask(() => auto(call, t));
      return handle;
    },
  };
  return t;
}

/** Answers every request with 200 (status GETs: nothing received). */
export const okAll = (c: Call): void =>
  c.kind === 'status' ? c.reply(200, { received: [] }) : c.reply(200, { ok: true, kind: c.kind });

/** Lets queued microtasks and zero-delay timers run (real timers only). */
export const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};
