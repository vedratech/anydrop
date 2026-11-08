---
title: "Upload backend overview: the HTTP contract"
description: "The four endpoints a backend implements for AnyDrop chunked and folder uploads, compatible with Dropzone chunk fields. No server is shipped."
---

# Backend overview

AnyDrop is a front-end library. It ships no server: your backend implements a small HTTP contract. A backend that already handles Dropzone's chunk fields keeps working, because AnyDrop uses the same field names (`dzuuid`, `dzchunkindex`, ...) and adds a few of its own with the `ad` prefix.

- [Protocol (v1.4)](/protocol): the full contract, with every field, status code and edge case.
- [Express example](/backend/express): a complete working server in about 100 lines.
- [Laravel example](/backend/laravel): the same contract as a Laravel controller.

## The four endpoints

Your server implements these. Only the first is needed for plain uploads; the others switch on folders, resume and chunk assembly.

| Endpoint | Method | Option | Purpose |
|---|---|---|---|
| `/upload` | `POST` multipart | `url` | One chunk (`file`, `dzuuid`, `dzchunkindex`, `dzchunksize`, `dzchunkbyteoffset`, `dztotalfilesize`, ...), or a whole file when it is not chunked: then there are no `dz*` fields, only `file` and `adRelativePath`. Files up to `chunkSize` are sent whole even with `chunking: true`. Accept chunks in any order and more than once. |
| `/upload/status?uploadId=` | `GET` | `chunkStatusUrl` | `{ "received": [0, 1, 4] }`, or `{ "received": [], "complete": true }` once the file is assembled, or `404` if unknown. Lets the client resume. |
| `/upload/manifest` | `POST` JSON | `manifestUrl` (with `sendManifest`) | The folders and files of a batch. Create every folder, including empty ones. A repeated manifest replaces the earlier one. |
| `/upload/finalize` | `POST` JSON | `finalizeUrl` | `{ uploadId, relativePath, totalSize, totalChunks }`: assemble the chunks into the final file. Must be idempotent. |

Errors are `{ "code": "...", "message": "..." }` with an HTTP status; see the [error table](/protocol#_6-errors) and the client-side [error codes](/api/error-codes).

Optionally add `HEAD /upload/ping` (any status, `Cache-Control: no-store`) and set `connectivityProbeUrl`, so a dead network is detected quickly. See [Offline and connectivity](/guide/offline).

## The matching client configuration

```js
new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024,
  sendManifest: true,
  manifestUrl: '/upload/manifest',
  chunkStatusUrl: '/upload/status',
  finalizeUrl: '/upload/finalize',
  connectivityProbeUrl: '/upload/ping',
});
```

## Security checklist

The examples are minimal. Before you use anything like them in production:

- Authenticate every request, and check that an `uploadId` belongs to the current user.
- Never build a file path from client input without checking it. The examples reject paths that are empty, absolute, contain `\`, or contain `..` or empty segments.
- Limit the size of a chunk, of a manifest request body (a manifest lists every file of a batch) and of the total storage per user.
- Write chunks to a temporary name and rename them, so a cut-off write never counts as received.
- If the page and the API are on different origins, answer the CORS preflight for `GET`, `POST` and `HEAD`, and allow the headers the client sends (`X-Requested-With`, `Cache-Control`, `Content-Type` and your own).
- Check chunk lengths: a chunk whose length does not match `dzchunksize` (or the rest of the file for the last chunk) should be answered with `400 INVALID_CHUNK`.
