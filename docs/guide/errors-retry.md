---
title: "Upload errors and retry failed files"
description: "A persistent error list with one reason per failed file, retry of failed files only or by folder, and export of the list as JSON or CSV."
---

# Errors and retry

Failures are never lost in a console message. AnyDrop keeps a **persistent error list**: one entry per file that is currently in `error`, with a reason, so users can see what failed, retry only the failures, and export the list.

## The error list

```js
const errors = ad.getErrors(); // a copy
// [{ fileId, relativePath, uploadId, code, message, httpStatus?, stage, chunkIndex?, attempt, retryable, at }]
```

Each [`ErrorEntry`](/api/types#errorentry) has a [`code`](/api/error-codes) (18 known codes, plus any string your backend sends), a human-readable `message`, a `stage` (`validate`, `manifest`, `status`, `upload` or `finalize`) and a `retryable` flag. Validation rejections (size, type, count) are not retryable.

```js
ad.on('errorlistchanged', (errors) => console.log(errors.length, 'failed')); // merged to one event per microtask
ad.on('error', (file, message) => console.warn(file.relativePath, message)); // fires once per failed file
ad.clearErrors(); // empties the list; the files stay in 'error'
```

## Retry only the failures

```js
const n = ad.retryFailedOnly(); // all failed files, returns how many were re-queued
ad.retryFailedOnly('Photos/2024'); // only the failed files under a folder
ad.retryFile(file); // one file (or its id); returns whether it did
```

Done chunks are kept, so a retry continues from where the file failed. With `chunkStatusUrl` the server is asked first. A failed batch manifest is sent again, which also recovers its empty folders. Validation rejections are not re-queued.

## Export

```js
const json = ad.exportErrors('json'); // or 'csv' (RFC 4180)
```

In CSV, text cells that start with `=`, `+`, `-`, `@`, a tab or a CR get a `'` prefix, so a spreadsheet never runs a file name or server message as a formula.

## Automatic retries

Failed requests are retried before a file is reported as failed. See [Chunked uploads](/guide/chunked-uploads#retries) for the rules and [Error codes](/api/error-codes) for which codes are retried. Offline, hidden-page and lost-connection failures never become entries, they pause the upload ([Offline and connectivity](/guide/offline)).

## In the UI

When the list is not empty, an error panel appears with one row per failed file and its reason, plus **Retry failed**, **Export JSON**, **Export CSV**, **Copy list** and **Dismiss**. Folder rows and file rows have their own Retry buttons. The same functions are available as `ad.downloadErrors('csv')` and `ad.copyErrors()`.

```js
new AnyDrop('#uploader', { url: '/upload', errorPanel: false }); // hide the panel and build your own
```

## Error messages from your backend

When the server answers with a JSON body `{ "code": "TOO_LARGE", "message": "..." }`, that code and message are used for the entry and passed to the `error` event. Without a body, AnyDrop uses `dictResponseError` (`Server responded with {{statusCode}} code.`).

## Build your own view

```js
const list = document.querySelector('#failed-files'); // a <ul id="failed-files">
ad.on('errorlistchanged', (errors) => {
  list.replaceChildren(
    ...errors.map((e) => {
      const li = document.createElement('li');
      li.textContent = `${e.relativePath}: ${e.message} (${e.code})`;
      return li;
    }),
  );
});
document.querySelector('#retry-all').onclick = () => ad.retryFailedOnly();
```
