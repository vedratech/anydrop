---
title: "Upload large files (1 GB and more) from the browser"
description: "How to upload files of 1 GB or more from the browser without loading them into memory: chunk size, size limits, proxy limits, assembly and a recovery plan."
---

# Upload large files (1 GB and more) from the browser

Uploading a multi-gigabyte file in one request is fragile: one dropped packet restarts everything, proxies cut long requests, and a server may refuse such a body. The reliable way is to send the file in chunks and let the client resume. This page lists the settings that matter for large files in AnyDrop.

## The setup

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 8 * 1024 * 1024, // bytes; the default is 2 MiB
  maxFilesize: 20 * 1024, // MiB; the default is 256, so raise it for big files
  parallelChunkUploads: 3, // chunks of one file in flight
  retryChunksLimit: 5, // retries per request; the default is 3
  chunkStatusUrl: '/upload/status', // resume from what the server holds
  finalizeUrl: '/upload/finalize', // assemble in its own request
  connectivityProbeUrl: '/upload/ping', // detect a dead network quickly
});
```

## Why this works for big files

- **Memory stays at chunk size.** AnyDrop only reads a file with `Blob.slice()`, one chunk per request, so a multi-gigabyte file is never loaded into memory.
- **A failure costs one chunk.** Network errors, timeouts, 408, 429 and 5xx are retried for that chunk only, with growing delays.
- **Pause and resume continue where they stopped.** Only chunks the server has not acknowledged are sent. See [Pause and resume uploads](/use-cases/pause-resume-uploads).
- **A dropped connection is not an error.** The upload pauses and carries on when the server answers again. See [uploads that survive a lost connection](/use-cases/upload-lost-connection).
- **A reload is survivable.** Progress is stored in IndexedDB, and dropping the same file again sends only the missing chunks ([details](/guide/resume-after-reload)).

## Settings to check

| Setting | Why |
|---|---|
| `maxFilesize` | Defaults to 256 MiB. A larger file is rejected with `REJECTED_SIZE` before anything is sent. Set it to your real limit, or `null` to turn the check off. |
| `chunkSize` | A bigger chunk means fewer requests but more to resend on a failure. The chunk layout of a file is fixed when its first chunk is sent. Keep it below the smallest body limit on the path (see below). |
| `finalizeUrl` | Assembling a very large file on the last chunk can take longer than the stall watchdog allows. A separate finalize request avoids that. You can also raise `stallTimeout`. |
| `parallelChunkUploads` | More chunks in flight use more of the connection, but also more server work. Cap the total with `maxChunksInFlight`. |

## Server and proxy limits

Most failures with big files come from the server side, not the browser. Check these against your `chunkSize`:

- the web server and reverse proxy request body limit (for example nginx `client_max_body_size`);
- the framework limit for multipart bodies (multer `limits.fileSize` in Express, `upload_max_filesize` and `post_max_size` in PHP);
- the time and disk space the assembly step needs, and where partial chunks are stored;
- a per-user cap on total storage.

Write each chunk to a temporary name and rename it, so a cut-off write never counts as received. Details and checks are in the [backend overview](/backend/) and the [protocol](/protocol).

## What not to promise

AnyDrop does not set a maximum file size by itself beyond `maxFilesize`: the practical limit is what your server, storage and the browser's ability to read the file allow. On iOS, background tabs are suspended, so keep the page open while a large file uploads ([iOS limits](/guide/mobile-ios)). Test your own largest file and your own proxy chain before relying on it.

## Related

- [Chunked and resumable file uploads in the browser](/use-cases/chunked-resumable-uploads)
- [Chunked uploads guide](/guide/chunked-uploads)
- [Laravel and Express chunked upload backend](/use-cases/chunked-upload-backend)
