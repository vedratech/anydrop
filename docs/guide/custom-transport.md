---
title: "Custom upload transport: presigned S3, tus and more"
description: "Replace the XMLHttpRequest transport to upload to presigned S3 URLs, speak tus or log requests, while keeping chunking, pause, resume and progress."
---

# Custom transport

All requests go through a **transport**, an object with one method. The built-in transport uses `XMLHttpRequest` (because `fetch` has no upload progress). Replace it to upload to S3 with presigned URLs, to speak tus, to add logging, or to fake the network in tests. The [live demo](/demo) uses a fake transport.

```ts
interface Transport {
  send(request: TransportRequest): TransportHandle;
}
```

::: warning Before 1.0.0
In `@vedratech/anydrop-ui` 0.1.0, a plain-object `transport` passed to the constructor was copied. Since 1.0.0 the transport you pass is used as is.
:::

## A logging transport

```ts
import { AnyDropCore, xhrTransport, type Transport } from '@vedratech/anydrop-core';

const logging: Transport = {
  send(request) {
    // request: { method, url, headers, body, timeout, withCredentials, beforeSend? }
    const handle = xhrTransport.send(request); // { abort(), onProgress?, promise }
    handle.promise.then((res) => console.log(request.method, request.url, res.status));
    return handle;
  },
};

new AnyDropCore({ url: '/upload', transport: logging });
```

## What a transport receives

The transport receives **every** request core makes, not only uploads:

- chunk and file uploads (a `FormData` or `Blob` body);
- the manifest and finalize requests (`POST`, a JSON string body, `Content-Type: application/json`);
- the chunk-status request (`GET`, no body);
- the connectivity probe (`HEAD`, or `GET` for the `chunkStatusUrl` fallback, no body, 10 s timeout).

Branch on `request.url` or `request.method` if your adapter should only handle uploads, and pass the rest to `xhrTransport`. The transport must handle `HEAD` and `GET` with `body: null`.

## The rules

1. **Call `request.beforeSend(native)` once, right before sending the body, when it is present.** Only upload requests have it: core runs `params()`, emits `sending` and appends the file there. Use `request.beforeSend?.(native)`. Headers or credentials added inside `beforeSend` (or in the `sending` event) reach uploads only, so put authentication in the `headers` option and `withCredentials`, which every request uses.
2. **Call `handle.onProgress(loaded, total)` while the body uploads.** Core assigns `onProgress` after `send()` returns. The stall watchdog depends on it.
3. **Always resolve `promise`, never reject.** Resolve with any HTTP status, even 4xx or 5xx: that means "the server is reachable". When no response arrived, resolve with `status: 0` and `error: 'network' | 'timeout' | 'abort'`.
4. **`abort()` must make the promise resolve with `error: 'abort'`.**
5. `body` of the response is the parsed JSON when the response is JSON, else the text. `header(name)` gives a response header (core reads `Retry-After`).

## A fake network (for tests and demos)

```ts
const fake: Transport = {
  send(request) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onDone!: (r: TransportResponse) => void;
    const promise = new Promise<TransportResponse>((resolve) => (onDone = resolve));

    request.beforeSend?.(undefined);
    const handle: TransportHandle = {
      promise,
      abort() {
        clearTimeout(timer);
        onDone({ status: 0, body: null, header: () => null, error: 'abort' });
      },
    };
    // pretend the body takes 300 ms to upload
    timer = setTimeout(() => {
      handle.onProgress?.(1, 1);
      onDone({ status: 200, body: { ok: true }, header: () => null });
    }, 300);
    return handle;
  },
};
```

## Example: presigned S3 URLs

```ts
const s3: Transport = {
  send(request) {
    if (request.method !== 'POST' || !(request.body instanceof FormData)) {
      return xhrTransport.send(request); // manifest, status, probe: your own backend
    }
    const file = request.body.get('file') as Blob;
    // Ask your backend for a presigned URL for this file or chunk, then PUT the blob.
    // Resolve with the response of that PUT, and report progress with handle.onProgress.
    return putToPresignedUrl(file, request); // your own function that returns a TransportHandle
  },
};
```

`putToPresignedUrl` is yours to write; it must follow the rules above. The types [`Transport`](/api/types#transport), [`TransportRequest`](/api/types#transportrequest), [`TransportHandle`](/api/types#transporthandle) and [`TransportResponse`](/api/types#transportresponse) are exported by `@vedratech/anydrop-core`.
