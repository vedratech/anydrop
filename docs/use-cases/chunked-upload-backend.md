---
title: "Laravel and Express chunked upload backend"
description: "Build a chunked, resumable upload backend in Express or Laravel for a browser client: chunk, status, manifest and finalize endpoints, with code and a checklist."
---

# Laravel and Express chunked upload backend

AnyDrop is frontend only and ships no server. Your backend implements a small HTTP contract. This page shows the shape of a backend in Express or Laravel. The complete, tested-against-the-client Express server is in the [Express example](/backend/express), and the [Laravel example](/backend/laravel) is the same contract as a controller (its PHP is syntax-checked but not run against the client, so test it in your project).

## The client side

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024,
  sendManifest: true,
  manifestUrl: '/upload/manifest',
  chunkStatusUrl: '/upload/status',
  finalizeUrl: '/upload/finalize',
});
```

With Laravel, routes in `routes/api.php` are served under `/api`, so the URLs become `/api/upload`, `/api/upload/manifest` and so on.

## The four endpoints

| Endpoint | Purpose |
|---|---|
| `POST /upload` | Receives a chunk (with the `dz*` fields) or a whole file (with `adRelativePath`). Must accept chunks in any order and more than once. |
| `GET /upload/status` | Returns `{ "received": [0, 1, 4] }` so the client can resume. A `404` means the upload is unknown. Only needed for resume. |
| `POST /upload/manifest` | Receives the folder list as JSON, so empty folders can be created. Only needed with `sendManifest`. |
| `POST /upload/finalize` | Assembles the chunks into the final file after the last chunk. Must be safe to call twice. |

Every field and status code is in the [protocol](/protocol).

## Express, the chunk endpoint

An excerpt of the [full example](/backend/express) (multer with memory storage, chunks written to a temporary name and renamed):

```js
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'INVALID_CHUNK', 'Missing file');
  const { adUploadId } = req.body;
  // ... a whole file (no dz* fields) is written to its adRelativePath ...
  const index = Number(req.body.adChunkIndex);
  const size = Number(req.body.adChunkSize);
  const total = Number(req.body.adTotalSize);
  const offset = Number(req.body.adChunkOffset);
  if (req.file.size !== Math.min(size, total - offset)) {
    return fail(res, 400, 'INVALID_CHUNK', 'Chunk length does not match');
  }
  await writeAtomic(path.join(TMP, adUploadId, String(index)), req.file.buffer);
  res.json({ ok: true });
});
```

## Laravel, the routes

```php
// routes/api.php (run `php artisan install:api` first on Laravel 11 and later)
Route::post('/upload', [UploadController::class, 'chunk']);
Route::get('/upload/status', [UploadController::class, 'status']);
Route::post('/upload/manifest', [UploadController::class, 'manifest']);
Route::post('/upload/finalize', [UploadController::class, 'finalize']);
```

The controller is in the [Laravel example](/backend/laravel). Check `upload_max_filesize` and `post_max_size` in `php.ini` against your `chunkSize`, and the web server's request size limit.

## Checklist before production

- Authenticate every request, and check that an `uploadId` belongs to the current user.
- Never build a file path from client input without checking it: reject empty, absolute, backslash, `..` and empty-segment paths.
- Limit the size of a chunk, of a manifest request body (a manifest lists every file of a batch) and the storage per user. Express's default JSON limit rejects a manifest of more than about 600 files, so raise it.
- Write chunks to a temporary name and rename them.
- On a different origin, answer the CORS preflight for `GET`, `POST` and `HEAD`.

## Related

- [Chunked and resumable file uploads in the browser](/use-cases/chunked-resumable-uploads)
- [Backend overview](/backend/)
- [Upload large files (1 GB and more)](/use-cases/upload-large-files)
