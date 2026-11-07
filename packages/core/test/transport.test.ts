// The built-in XHR transport, with a fake XMLHttpRequest: open/headers/timeout/credentials,
// beforeSend order, progress, JSON parsing (Dropzone rule), network error, timeout and abort.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBody, xhrTransport } from '../src/transport/xhr';

class FakeXHR {
  static last: FakeXHR;
  log: string[] = [];
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  headers: Record<string, string> = {};
  resHeaders: Record<string, string> = {};
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  body: unknown;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string, async: boolean) {
    this.log.push(`open ${method} ${url} ${async}`);
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  getResponseHeader(k: string) {
    return this.resHeaders[k.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.log.push('send');
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

const req = (over = {}) => ({
  method: 'POST',
  url: '/u',
  headers: { A: '1', Empty: '' },
  body: 'x',
  timeout: 5000,
  withCredentials: true,
  ...over,
});

describe('xhrTransport', () => {
  it('opens, sets headers, timeout and credentials, calls beforeSend before send, reports progress', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    let seen: unknown;
    const h = xhrTransport.send(
      req({
        beforeSend: (x: unknown) => {
          seen = x;
          (x as FakeXHR).log.push('beforeSend');
        },
      }),
    );
    const x = FakeXHR.last;
    expect(seen).toBe(x);
    expect(x.log).toEqual(['open POST /u true', 'beforeSend', 'send']);
    expect(x.headers).toEqual({ A: '1' });
    expect([x.timeout, x.withCredentials, x.body]).toEqual([5000, true, 'x']);
    const progress = vi.fn();
    h.onProgress = progress;
    x.upload.onprogress!({ loaded: 5, total: 10 } as ProgressEvent);
    expect(progress).toHaveBeenCalledWith(5, 10);
    x.status = 201;
    x.responseText = '{"ok":true}';
    x.resHeaders = { 'content-type': 'application/json; charset=utf-8', 'retry-after': '2' };
    x.onload!();
    const res = await h.promise;
    expect(res).toMatchObject({ status: 201, body: { ok: true }, xhr: x });
    expect(res.header('Retry-After')).toBe('2');
  });

  it('resolves (never rejects) on network error, timeout and abort', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    let h = xhrTransport.send(req());
    for (const [kind, fire] of [
      ['network', (x: FakeXHR) => x.onerror!()],
      ['timeout', (x: FakeXHR) => x.ontimeout!()],
      ['abort', () => h.abort()],
    ] as const) {
      h = xhrTransport.send(req());
      fire(FakeXHR.last);
      expect(await h.promise).toMatchObject({ status: 0, error: kind });
    }
  });

  it('parses JSON only for a JSON content type, like Dropzone', () => {
    expect(parseBody('{"a":1}', 'application/json')).toEqual({ a: 1 });
    expect(parseBody('{"a":1}', 'text/plain')).toBe('{"a":1}');
    expect(parseBody('nope', 'application/json')).toBe('Invalid JSON response from server.');
    expect(parseBody('', null)).toBe('');
  });
});
