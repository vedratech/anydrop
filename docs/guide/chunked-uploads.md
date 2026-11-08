---
title: "Chunked file uploads in the browser"
description: "Split large files into chunks with Blob.slice(), upload them in parallel with retry and backoff, and assemble them on the server."
---

# Chunked uploads

A chunked upload splits a large file into pieces and sends each piece in its own request. If a request fails, only that chunk is sent again; if the user pauses or the connection drops, the file continues from the last finished chunk.

## Turn it on

```js
const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024, // bytes; the default is 2 MiB
  finalizeUrl: '/upload/finalize', // assemble the file after the last chunk
});
```

Files up to `chunkSize` are sent whole even with `chunking: true`. Use `forceChunking: true` to chunk small files too (a zero-byte file is one empty chunk).

Files are only read with `Blob.slice()`, one chunk per request, so even a multi-gigabyte file never sits in memory.

## What the server receives

Each chunk is a `multipart/form-data` `POST` with the file slice in the field `file` and these fields:

| Field | Meaning |
|---|---|
| `adUploadId` | The uploadId of the file (UUID). |
| `adChunkIndex` | Index of this chunk, from 0. |
| `adChunkCount` | Number of chunks. |
| `adChunkSize` | The chunk size. |
| `adChunkOffset` | Byte offset of this chunk. |
| `adTotalSize` | Size of the whole file. |
| `adRelativePath`, `adSessionId` | The file's path and the batch id. |

Your server must accept chunks in any order and more than once (writing the same chunk again is harmless). When the last chunk arrived, AnyDrop sends the **finalize** request (`finalizeUrl`) so the server can assemble the file. All details are in the [protocol](/protocol), and the [Express example](/backend/express) implements it.

## Parallelism

```js
new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  parallelUploads: 2, // files uploading at once (default 2)
  parallelChunkUploads: 3, // chunks of one file in flight (default false = 1)
  maxChunksInFlight: 4, // optional cap on all upload requests of the instance
});
```

`parallelChunkUploads: true` means as many as `parallelUploads`. With `maxChunksInFlight`, requests are shared round-robin between files.

## Retries

Failed chunk, manifest, chunk-status and finalize requests are retried (`retryChunks`, default `true`) up to `retryChunksLimit` times (default 3) after a growing, randomised delay, or after the server's `Retry-After`. Network errors, timeouts, 408, 429 and 5xx are retried; 401, 403 and other 4xx are not. When a file finally fails, it emits `error` once and gets one entry in the [error list](/guide/errors-retry). Whole-file uploads (no chunking) are never retried automatically.

## The chunk size is fixed per file

A file's chunk layout is decided when its first chunk is sent (`file.upload.chunkSize`). Changing `chunkSize` later with `setOption` only affects files that have not started, because the server may already hold a chunk at the old offsets.

## Your own finalize step

If you assemble the file some other way, replace the finalize request:

```js
new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunksUploaded(file, done) {
    fetch('/merge?id=' + file.upload.uuid).then(() => done(), done);
  },
});
```

`done()` succeeds. `done(new Error('...'))`, `done('message')` or throwing fails the file with `FINALIZE_FAILED`.

## Large files

A backend that assembles a very large file on the last chunk can take longer than the stall watchdog allows. Use `finalizeUrl` so assembly happens in its own request, or raise `stallTimeout`. See [Offline and connectivity](/guide/offline).

## Progress

```js
ad.on('uploadprogress', (file, percent, bytesSent) => {
  console.log(file.name, Math.round(percent) + '%', bytesSent, 'bytes');
});
```

`file.upload` also has `chunksDone` (the chunk indexes the server acknowledged) and `totalChunkCount`.
