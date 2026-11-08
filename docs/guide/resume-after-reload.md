---
title: "Resume uploads after a page reload"
description: "Continue an interrupted upload after the tab was closed or the page reloaded: AnyDrop saves chunk progress in IndexedDB and sends only the missing chunks."
---

# Resume after reload

If the user closes the tab, the browser crashes or the page reloads in the middle of an upload, AnyDrop can continue from where it stopped. It remembers the chunks the server acknowledged, and when the user drops or picks the same files again, only the missing chunks are sent.

::: tip
A web page cannot read files from disk by itself, so after a reload the user must add the same files again. AnyDrop recognises them and skips what is done.
:::

## How it works

With `persistState` (on by default), each chunked file's acknowledged chunks are saved in IndexedDB (database `anydrop`), keyed by `persistKey` and the file's `relativePath|size|lastModified`. Saving happens about every 250 ms, and at once when the page is hidden. Dropping the same files again after a reload resumes them with their old uploadId, and finished files are skipped (`success` with `upload.skipped = true`).

```js
const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkStatusUrl: '/upload/status', // the server's answer wins over the saved record
  finalizeUrl: '/upload/finalize',
  persistKey: 'user-42', // scope the saved progress to this user
});
```

## Let the server decide

With `chunkStatusUrl`, the client asks the server which chunks it holds before resuming, and the server's answer wins over the saved record. The endpoint returns `{ "received": [0, 1, 4] }`. A `404` means the server does not know the upload, so the file restarts with a new uploadId (and the batch manifest is sent again). `{ "received": [], "complete": true }` lets a file finished earlier be skipped. The [protocol](/protocol) describes it in full.

It is asked only for files that are being resumed, never for fresh files.

## Skipped files

A file that was uploaded completely and is dropped again is skipped (`success` with `upload.skipped`): when the server confirms it (`chunkStatusUrl`), or without asking when there is no such option. The `success` response is `{ skipped: true, uploadId }`.

```js
ad.on('success', (file, response) => {
  if (file.upload.skipped) console.log(file.relativePath, 'was already uploaded');
});
```

To upload a file again on purpose, call `clearPersistedState()` or remove the file first.

## Always scope the key

Include the user id in `persistKey` in apps with logins, so one account never resumes another's upload. Without it, the key is `url` when it is a string, otherwise `'default'`.

## Start over

```js
await ad.clearPersistedState(); // delete this persistKey's saved progress
```

## Limits

- Saved records expire after 7 days.
- If IndexedDB is missing, throws, is blocked or does not answer within 1.5 seconds (private mode, some iOS versions), AnyDrop warns once and keeps the state in memory. An upload never waits for it.
- A file that went through a `transformFile` that returned a different blob gets no chunk-level resume across reloads, because a re-encoded image may differ byte for byte. The `resize*` options of the UI install such a transform. Finished files are still skipped.
- Non-chunked uploads carry no uploadId on the wire, so with `chunkStatusUrl` a finished non-chunked file is uploaded again after a reload. Use `forceChunking` if that matters.
- `persistState: false` turns all of this off.
