---
title: "Chunked and resumable file uploads in the browser"
description: "Split files into chunks with Blob.slice(), retry only failed chunks, and resume after a pause, a lost connection or a page reload. Code and the server contract."
---

# Chunked and resumable file uploads in the browser

A chunked upload cuts a file into pieces and sends each piece in its own request. A resumable upload remembers which pieces the server already has, so after a failure only the missing ones are sent. AnyDrop does both, in the browser, with no dependencies in its core.

## How it works

1. The file is read with `Blob.slice()`, one chunk per request, so the whole file never sits in memory.
2. Each chunk is a `multipart/form-data` `POST` that carries the chunk in `file` and Dropzone's chunk fields (`dzuuid`, `dzchunkindex`, `dztotalchunkcount`, `dzchunksize`, `dzchunkbyteoffset`, `dztotalfilesize`).
3. A failed chunk is retried with growing, randomised delays (up to 3 times by default, honouring `Retry-After`).
4. After the last chunk, AnyDrop calls your finalize endpoint so the server can assemble the file.
5. To resume, the client asks your status endpoint which chunks the server holds, and sends only the others.

## Turn it on

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024, // bytes; default is 2 MiB
  parallelChunkUploads: 3, // chunks of one file in flight
  chunkStatusUrl: '/upload/status', // resume: the server's answer wins
  finalizeUrl: '/upload/finalize', // assemble after the last chunk
});
```

Files up to `chunkSize` are sent whole unless you set `forceChunking: true`.

## What resumes, and when

| Situation | What happens |
|---|---|
| A chunk request fails (network, timeout, 5xx, 429) | Only that chunk is retried. |
| The user pauses | The upload continues later from the last acknowledged chunk. See [Pause and resume uploads](/use-cases/pause-resume-uploads). |
| The connection drops | Uploads pause by themselves and continue on reconnect. See [uploads that survive a lost connection](/use-cases/upload-lost-connection). |
| The tab is closed or the page reloads | Progress is saved in IndexedDB. The user drops the same files again and only missing chunks are sent. A web page cannot read files from disk by itself, so this step cannot be skipped. See [Resume after reload](/guide/resume-after-reload). |

## What your backend must do

Accept chunks in any order and more than once (writing the same chunk again is harmless), answer a status request with `{ "received": [0, 1, 4] }`, and assemble the file on finalize. Because the chunk fields are the same as Dropzone's, an existing Dropzone chunk backend keeps working. The full contract is in the [protocol](/protocol), with working [Express](/backend/express) and [Laravel](/backend/laravel) examples (see also [Laravel and Express chunked upload backend](/use-cases/chunked-upload-backend)).

## Not a tus or S3 client

AnyDrop speaks its own small HTTP contract, not the tus protocol. If you need tus or presigned S3 uploads, a [custom transport](/guide/custom-transport) lets you keep AnyDrop's queue, pause, resume and UI while you control the requests.

## Related

- [Chunked uploads guide](/guide/chunked-uploads): every option, parallelism and retries.
- [Upload large files (1 GB and more)](/use-cases/upload-large-files).
