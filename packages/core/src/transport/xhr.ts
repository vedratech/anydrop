// Portions adapted from Dropzone (MIT, Copyright (c) 2026 Matias Simon <m@tias.me>), see THIRD_PARTY_NOTICES.md.
// Built-in XMLHttpRequest transport: abort, upload progress, timeout. XHR is created per request,
// inside send(), so nothing touches browser globals at import time.
import type { Transport, TransportHandle, TransportResponse } from './types';

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
    // Some browsers have no `xhr.upload` (Dropzone keeps the same fallback).
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

/** Dropzone's rule: JSON when `content-type` says so; a body that fails to parse becomes Dropzone's message. */
export function parseBody(text: string, contentType: string | null): unknown {
  if (contentType && contentType.indexOf('application/json') >= 0) {
    try {
      return JSON.parse(text);
    } catch {
      return 'Invalid JSON response from server.';
    }
  }
  return text;
}
