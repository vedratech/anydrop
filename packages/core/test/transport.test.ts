// The built-in XHR transport, with a fake XMLHttpRequest: open/headers/timeout/credentials,
// beforeSend order, progress, JSON parsing, network error, timeout and abort; and the request
// field and header helpers.
//
// Behaviour spec (fixed examples below):
//
// parseBody(text, contentType): unknown
//   - When contentType is a string that contains the text 'application/json' (case-sensitive, so
//     'application/json; charset=utf-8' counts), the text is parsed as JSON. Text that does not
//     parse, including an empty text, gives the string 'Invalid JSON response from server.'
//   - For any other content type, or none, the text is returned unchanged.
//
// headersFor(options: { defaultHeaders, headers }, extra?): Record<string, string>
//   - With defaultHeaders on, it starts with Accept: application/json, Cache-Control: no-cache
//     and X-Requested-With: XMLHttpRequest; with it off it starts empty.
//   - `extra` (for example a Content-Type) is added next, then options.headers. A later source
//     wins for the same key; keys are compared exactly (case-sensitive). Empty values stay in
//     the result (the transport skips them when it sends). Null or missing sources add nothing.
//
// paramName(options: { paramName, uploadMultiple }, n): string
//   - A paramName function is called with n and its result is used.
//   - A paramName string is used as is, or as 'name[n]' when uploadMultiple is on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { headersFor, paramName } from '../src/transport/fields';
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

  it('parses JSON only for a JSON content type', () => {
    expect(parseBody('{"a":1}', 'application/json')).toEqual({ a: 1 });
    expect(parseBody('{"a":1}', 'text/plain')).toBe('{"a":1}');
    expect(parseBody('nope', 'application/json')).toBe('Invalid JSON response from server.');
    expect(parseBody('', null)).toBe('');
  });

  it('parses when the JSON type has parameters, and reports empty or broken JSON', () => {
    expect(parseBody('{"a":1}', 'application/json; charset=utf-8')).toEqual({ a: 1 });
    expect(parseBody('[1]', 'application/json')).toEqual([1]);
    expect(parseBody('null', 'application/json')).toBeNull();
    expect(parseBody(' {"a":1} ', 'application/json')).toEqual({ a: 1 });
    expect(parseBody('', 'application/json')).toBe('Invalid JSON response from server.');
    expect(parseBody('{"a":1}', 'application/vnd.api+json')).toBe('{"a":1}');
    expect(parseBody('{"a":1}', null)).toBe('{"a":1}');
  });
});

describe('headersFor', () => {
  const on = { defaultHeaders: true, headers: null };
  it('adds the default headers unless turned off', () => {
    expect(headersFor(on)).toEqual({
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
    });
    expect(headersFor({ defaultHeaders: false, headers: null })).toEqual({});
    expect(headersFor({ defaultHeaders: false, headers: undefined } as never)).toEqual({});
  });

  it('merges extra, then the headers option, later wins, keys are exact', () => {
    const result = headersFor(
      { defaultHeaders: true, headers: { Accept: 'text/plain', X: '1', 'cache-control': 'x' } },
      { 'Content-Type': 'a/b', X: '2' },
    );
    expect(result).toEqual({
      Accept: 'text/plain',
      'Cache-Control': 'no-cache',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'a/b',
      X: '1',
      'cache-control': 'x',
    });
    expect(headersFor({ defaultHeaders: false, headers: { A: '1' } }, { B: '2' })).toEqual({
      A: '1',
      B: '2',
    });
  });

  it('keeps empty values, so the option can blank a default header', () => {
    expect(headersFor({ defaultHeaders: true, headers: { Accept: '' } }).Accept).toBe('');
    expect(headersFor({ defaultHeaders: false, headers: { A: '1' } }, { A: '' })).toEqual({
      A: '1',
    });
  });

  it('does not change its inputs', () => {
    const headers = { A: '1' };
    const extra = { B: '2' };
    headersFor({ defaultHeaders: true, headers }, extra);
    expect(headers).toEqual({ A: '1' });
    expect(extra).toEqual({ B: '2' });
  });
});

describe('paramName', () => {
  it('uses a string as is, or indexed with uploadMultiple', () => {
    expect(paramName({ paramName: 'file', uploadMultiple: false }, 0)).toBe('file');
    expect(paramName({ paramName: 'file', uploadMultiple: false }, 3)).toBe('file');
    expect(paramName({ paramName: 'file', uploadMultiple: true }, 0)).toBe('file[0]');
    expect(paramName({ paramName: 'file', uploadMultiple: true }, 2)).toBe('file[2]');
    expect(paramName({ paramName: 'a[]', uploadMultiple: true }, 1)).toBe('a[][1]');
  });

  it('calls a function with the index, with or without uploadMultiple', () => {
    const fn = (n: number) => 'f' + n;
    expect(paramName({ paramName: fn, uploadMultiple: true }, 2)).toBe('f2');
    expect(paramName({ paramName: fn, uploadMultiple: false }, 2)).toBe('f2');
  });
});
