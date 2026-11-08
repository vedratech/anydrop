// Built-in XMLHttpRequest transport: abort, upload progress, timeout. XHR is created per request,
// inside send(), so nothing touches browser globals at import time.
import type { Transport, TransportHandle, TransportResponse } from './types';

const INVALID_JSON = 'Invalid JSON response from server.';

/**
 * The response body for a response text: parsed when the content type mentions
 * `application/json` (the string `'Invalid JSON response from server.'` if it does not parse),
 * else the text itself.
 */
export function parseBody(text: string, contentType: string | null): unknown {
  if (!contentType || !contentType.includes('application/json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return INVALID_JSON;
  }
}

/** The built-in transport, based on `XMLHttpRequest` (which has upload progress). Use it as the fallback in your own transport. */
export const xhrTransport: Transport = {
  send(req) {
    const xhr = new XMLHttpRequest();
    let resolve!: (r: TransportResponse) => void;
    const handle: TransportHandle = {
      abort: () => xhr.abort(),
      promise: new Promise<TransportResponse>((r) => (resolve = r)),
    };
    const header = (name: string): string | null => {
      try {
        return xhr.getResponseHeader(name);
      } catch {
        return null;
      }
    };
    const finish = (error?: TransportResponse['error']): void =>
      resolve({
        status: error ? 0 : xhr.status,
        body: error ? undefined : parseBody(xhr.responseText, header('content-type')),
        header,
        error,
        xhr,
      });
    xhr.open(req.method, req.url, true);
    if (req.timeout) xhr.timeout = req.timeout;
    xhr.withCredentials = req.withCredentials;
    xhr.onload = () => finish();
    xhr.onerror = () => finish('network');
    xhr.ontimeout = () => finish('timeout');
    xhr.onabort = () => finish('abort');
    // Some browsers have no `xhr.upload`; the request object reports progress then.
    (xhr.upload || xhr).onprogress = (e: ProgressEvent) => {
      if (handle.onProgress) handle.onProgress(e.loaded, e.total);
    };
    for (const name in req.headers) {
      const value = req.headers[name];
      if (value) xhr.setRequestHeader(name, value);
    }
    if (req.beforeSend) req.beforeSend(xhr);
    xhr.send(req.body);
    return handle;
  },
};
