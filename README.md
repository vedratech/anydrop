# AnyDrop

A front-end upload library that treats **folders as first-class objects**. It is configured like [Dropzone.js](https://www.dropzone.dev/) and adds a folder picker and tree view, chunked uploads, pause and resume, a persistent error list, and a layout that works on phones.

- **Folders in, folders out.** Drop or pick whole folders (several at once, mixed with loose files). Every file keeps its relative path, empty folders are kept, and the backend can receive the folder structure as a manifest.
- **Same configuration as Dropzone.** `new Dropzone(el, opts)` becomes `new AnyDrop(el, opts)`. See [Migrating from Dropzone](docs/migrating-from-dropzone.md).
- **Two packages.** [`@vedratech/anydrop-core`](packages/core/README.md) is the headless engine (no dependencies, no DOM rendering). [`@vedratech/anydrop-ui`](packages/ui/README.md) is the plain-JavaScript drop zone, folder tree and mobile layout on top of it.
- **Frontend only.** AnyDrop ships no server. Your backend implements a small HTTP contract: see [docs/protocol.md](docs/protocol.md) and the [Express and Laravel examples](#backend-examples) below.

## Install

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core   # drop zone and UI
npm install @vedratech/anydrop-core                          # headless engine only
```

From a CDN (pin the minor version). The UI build includes the core and sets `window.AnyDrop` to the class, as Dropzone does:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>
```

The headless core alone: `https://cdn.jsdelivr.net/npm/@vedratech/anydrop-core@0.1`, global `AnyDropCore`.

## Quick start: UI

```html
<div id="uploader"></div>
<script type="module">
  import { AnyDrop } from '@vedratech/anydrop-ui';
  import '@vedratech/anydrop-ui/style.css';

  const ad = new AnyDrop('#uploader', {
    url: '/upload',
    chunking: true,
    chunkSize: 5 * 1024 * 1024,
    sendManifest: true, // send the folder structure, including empty folders
    manifestUrl: '/upload/manifest',
    chunkStatusUrl: '/upload/status', // resume: ask the server which chunks it has
    finalizeUrl: '/upload/finalize', // assemble the file after the last chunk
  });

  ad.on('queuecomplete', () => console.log('done', ad.getErrors()));
</script>
```

With a CDN script tag, `new AnyDrop('#uploader', {...})` works the same way. Elements with the class `dropzone` or `anydrop` are also attached automatically by the CDN build (see the [UI README](packages/ui/README.md)).

## Quick start: headless core

```ts
import { AnyDropCore } from '@vedratech/anydrop-core';

const core = new AnyDropCore({ url: '/upload', chunking: true, sendManifest: true, manifestUrl: '/upload/manifest' });

core.on('folderprogress', (folder, percent) => console.log(folder.path, Math.round(percent)));
core.on('error', (file, message) => console.warn(file.relativePath, message));

dropZone.addEventListener('dragover', (e) => e.preventDefault());
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  core.drop(e); // call synchronously: the browser clears the dropped items afterwards
});
```

Everything is driven by options, methods and events, with no framework assumptions: `on()` returns an unsubscribe function, `destroy()` removes all listeners, DOM and timers, `setOption()` works at runtime, and nothing touches `window` or `document` when you import the package (safe for server-side rendering).

## Features

- Drag and drop of **files and folders together**; separate file and folder pickers; paste from the clipboard.
- A folder tree (or flat list) with the relative path of every file, **empty folders kept**, and a folder manifest for the backend.
- **Chunked uploads** with Dropzone's field names, retry with backoff, and `Blob.slice()` so a file is never loaded into memory whole.
- **Pause and resume** for everything, a folder or a single file. Resume after a reload (IndexedDB) and after network loss.
- **Bad connections handled:** uploads pause by themselves when the browser is offline, the tab is hidden, or the server cannot be reached (including requests that stall), probe the connection with growing delays, and carry on when it returns. The UI shows a banner with a "Retry now" button.
- A **persistent error list**: a reason per file, retry only the failed files (all, or per folder), export as JSON or CSV.
- The same options and events as Dropzone, plus folder events (`addedfolder`, `folderprogress`, `foldercomplete`, ...).
- Mobile friendly: tap-to-upload layout, 44 px targets, safe areas, lazy and capped thumbnails, HEIC photos recognised.
- Accessible (keyboard, live region, contrast), dark mode, every text translatable.
- ESM, CJS and IIFE builds, TypeScript types, a pluggable `transport` for S3, tus or fetch adapters.

## How it compares

AnyDrop is a focused upload widget for folders and large or unreliable uploads; Dropzone, Uppy and FilePond each have their own strengths and plugin ecosystems. The one thing we publish is the download size, measured the same way for every library (minified and gzipped, esbuild, 2026-11-07):

| | JavaScript (gzip) | CSS (gzip) |
|---|---:|---:|
| Dropzone 6.3.5 | 11.7 kB | 1.3 kB |
| **AnyDrop ui + core** | 31.8 kB | 3.1 kB |
| FilePond 4.32.12 (core, no plugins) | 40.5 kB | 5.2 kB |
| Uppy core + dashboard + xhr-upload | 78.4 kB | 10.4 kB |

AnyDrop with the UI is about 2.7 times the size of Dropzone: it adds folders and a tree view, chunking with pause and resume, an IndexedDB resume store, connectivity handling, an error registry and a mobile layout. Method, versions and the headless numbers are in [docs/size-comparison.md](docs/size-comparison.md).

## Browser support

AnyDrop targets ES2019 and ships no polyfills. It feature-detects what it needs and never sniffs the user agent.

| Browser | Files | Folder drop | Folder picker | Resume after reload | Notes |
|---|---|---|---|---|---|
| Chrome, Edge (desktop) | yes | yes | yes | yes | |
| Firefox (desktop) | yes | yes | yes | yes | |
| Safari (desktop) | yes | yes | yes | yes | |
| Safari on iOS and iPadOS | yes | no | no (a notice is shown) | yes (in memory only if IndexedDB is blocked) | see "iOS limits" |
| Chrome on Android | yes | n/a | where the browser offers it | yes | |

The automated end-to-end suite runs on Chromium, Firefox and WebKit plus iPhone and Pixel emulation. Playwright's WebKit is not iOS Safari: the results of the checks on real devices are tracked in [docs/device-checks.md](docs/device-checks.md).

## iOS limits

- **No folders.** iOS Safari has no folder picker and no folder drag and drop. AnyDrop detects this (it does not look at the user agent), hides the folder button and shows a notice (`dictNoFolderSupport`); users select files from Photos, Files or the camera (`capture: 'environment'`). Folder paths appear only where the browser provides them.
- **Background tabs are suspended.** When the tab goes to the background or the screen locks, iOS can stop the page. AnyDrop pauses on `pagehide`, pauses when a request fails while the page is hidden, and resumes from the last finished chunk when the page is visible again. Keep the page open while uploading large files.
- **Memory.** Files are only read in chunks, thumbnails are lazy and capped, and the default concurrency is low (`parallelUploads: 2`).
- Private browsing and some iOS versions block IndexedDB: resume after a reload then does not work, and AnyDrop warns once and keeps the state in memory.

## Backend examples

Your server implements four endpoints (full details in [docs/protocol.md](docs/protocol.md)). The snippets below are minimal documentation examples, not a shipped server: add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like them in production.

| Endpoint | Method | Purpose |
|---|---|---|
| `/upload` | `POST` multipart | One chunk (`file`, `dzuuid`, `dzchunkindex`, `dzchunksize`, `dzchunkbyteoffset`, `dztotalfilesize`, ...). Accept chunks in any order and more than once. |
| `/upload/status?uploadId=` | `GET` | `{ "received": [0, 1, 4] }`, `{ "received": [], "complete": true }` once assembled, or `404` if unknown. |
| `/upload/manifest` | `POST` JSON | The folders and files of a batch; create every folder, including empty ones. A repeated manifest replaces the earlier one. |
| `/upload/finalize` | `POST` JSON | `{ uploadId, relativePath, totalSize, totalChunks }`: assemble the chunks into the final file. Idempotent. |

Errors are `{ "code": "...", "message": "..." }` with an HTTP status ([error table](docs/protocol.md#6-errors)). Optionally add `HEAD /upload/ping` (any status, `Cache-Control: no-store`) and set `connectivityProbeUrl` so a dead network is detected quickly.

### Express

```js
// npm i express multer
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('uploads');
const TMP = path.resolve('uploads-tmp');
const UUID = /^[0-9a-f-]{36}$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
const app = express();
app.use(express.json());

const fail = (res, status, code, message) => res.status(status).json({ code, message });

// Absolute path inside ROOT for a client-supplied relative path, or null.
function target(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\')) return null;
  if (rel.split('/').some((s) => s === '' || s === '..')) return null;
  const abs = path.resolve(ROOT, rel);
  return abs.startsWith(ROOT + path.sep) ? abs : null;
}
const exists = (p) => fs.stat(p).then(() => true, () => false);

// Chunk upload. The same chunk may arrive twice: writing it again is harmless.
app.post('/upload', upload.single('file'), async (req, res) => {
  const { dzuuid } = req.body;
  const index = Number(req.body.dzchunkindex);
  const size = Number(req.body.dzchunksize);
  const total = Number(req.body.dztotalfilesize);
  const offset = Number(req.body.dzchunkbyteoffset);
  if (!UUID.test(dzuuid) || !req.file || !Number.isInteger(index) || index < 0) {
    return fail(res, 400, 'INVALID_CHUNK', 'Invalid chunk request');
  }
  if (req.file.size !== Math.min(size, total - offset)) {
    return fail(res, 400, 'INVALID_CHUNK', 'Chunk length does not match');
  }
  const dir = path.join(TMP, dzuuid);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, String(index)), req.file.buffer);
  res.json({ ok: true });
});

// Chunk status, used to resume.
app.get('/upload/status', async (req, res) => {
  const id = String(req.query.uploadId || '');
  if (!UUID.test(id)) return fail(res, 404, 'HTTP_ERROR', 'Unknown upload');
  const dir = path.join(TMP, id);
  if (await exists(path.join(dir, 'done'))) return res.json({ received: [], complete: true });
  if (!(await exists(dir))) return fail(res, 404, 'HTTP_ERROR', 'Unknown upload');
  const names = await fs.readdir(dir);
  res.json({ received: names.filter((n) => /^\d+$/.test(n)).map(Number) });
});

// Folder manifest: create every folder, including the empty ones.
app.post('/upload/manifest', async (req, res) => {
  const { folders = [] } = req.body || {};
  for (const folder of folders) {
    const abs = target(folder);
    if (!abs) return fail(res, 400, 'INVALID_PATH', 'Invalid folder path');
    await fs.mkdir(abs, { recursive: true });
  }
  res.json({ ok: true });
});

// Finalize: assemble the chunks into the final file, then forget them. Idempotent.
app.post('/upload/finalize', async (req, res) => {
  const { uploadId, relativePath, totalSize, totalChunks } = req.body || {};
  const dest = target(relativePath);
  if (!UUID.test(uploadId) || !dest) return fail(res, 400, 'INVALID_PATH', 'Invalid request');
  const dir = path.join(TMP, uploadId);
  if (await exists(path.join(dir, 'done'))) return res.json({ ok: true, path: relativePath });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.${uploadId}.part`;
  await fs.writeFile(part, '');
  for (let i = 0; i < totalChunks; i++) {
    try {
      await fs.appendFile(part, await fs.readFile(path.join(dir, String(i))));
    } catch {
      await fs.rm(part, { force: true });
      return fail(res, 409, 'CHUNK_MISMATCH', `Chunk ${i} is missing`);
    }
  }
  if ((await fs.stat(part)).size !== totalSize) {
    await fs.rm(part, { force: true });
    return fail(res, 409, 'CHUNK_MISMATCH', 'Assembled size does not match');
  }
  await fs.rename(part, dest); // atomic
  await fs.rm(dir, { recursive: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'done'), relativePath);
  res.json({ ok: true, path: relativePath });
});

// Optional: connectivityProbeUrl
app.head('/upload/ping', (req, res) => res.set('Cache-Control', 'no-store').status(204).end());

app.listen(3000);
```

If the page and the API are on different origins, also answer the CORS preflight (`OPTIONS`) for these routes, allowing the methods `GET`, `POST` and `HEAD` and the headers the client sends (`X-Requested-With`, `Cache-Control`, `Content-Type` and your own).

### Laravel

```php
<?php
// routes/api.php
use App\Http\Controllers\UploadController;
use Illuminate\Support\Facades\Route;

Route::post('/upload', [UploadController::class, 'chunk']);
Route::get('/upload/status', [UploadController::class, 'status']);
Route::post('/upload/manifest', [UploadController::class, 'manifest']);
Route::post('/upload/finalize', [UploadController::class, 'finalize']);
Route::get('/upload/ping', fn () => response()->noContent()->header('Cache-Control', 'no-store')); // answers HEAD too
```

```php
<?php
// app/Http/Controllers/UploadController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

class UploadController extends Controller
{
    private function fail(int $status, string $code, string $message)
    {
        return response()->json(['code' => $code, 'message' => $message], $status);
    }

    private function tmp(string $id): string
    {
        return storage_path("app/uploads-tmp/$id");
    }

    // Absolute path inside storage/app/uploads for a client-supplied relative path, or null.
    private function target(?string $rel): ?string
    {
        if (!$rel || str_starts_with($rel, '/') || str_contains($rel, '\\')) {
            return null;
        }
        foreach (explode('/', $rel) as $segment) {
            if ($segment === '' || $segment === '..') {
                return null;
            }
        }
        return storage_path("app/uploads/$rel");
    }

    // Chunk upload. The same chunk may arrive twice: writing it again is harmless.
    public function chunk(Request $r)
    {
        $id = (string) $r->input('dzuuid');
        if (!Str::isUuid($id) || !$r->hasFile('file')) {
            return $this->fail(400, 'INVALID_CHUNK', 'Invalid chunk request');
        }
        $index = (int) $r->input('dzchunkindex');
        $size = (int) $r->input('dzchunksize');
        $total = (int) $r->input('dztotalfilesize');
        $offset = (int) $r->input('dzchunkbyteoffset');
        $file = $r->file('file');
        if ($index < 0 || $file->getSize() !== min($size, $total - $offset)) {
            return $this->fail(400, 'INVALID_CHUNK', 'Chunk length does not match');
        }
        $dir = $this->tmp($id);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $file->move($dir, (string) $index);
        return response()->json(['ok' => true]);
    }

    // Chunk status, used to resume.
    public function status(Request $r)
    {
        $id = (string) $r->query('uploadId');
        $dir = $this->tmp($id);
        if (!Str::isUuid($id)) {
            return $this->fail(404, 'HTTP_ERROR', 'Unknown upload');
        }
        if (is_file("$dir/done")) {
            return response()->json(['received' => [], 'complete' => true]);
        }
        if (!is_dir($dir)) {
            return $this->fail(404, 'HTTP_ERROR', 'Unknown upload');
        }
        $received = collect(scandir($dir))->filter('ctype_digit')->map('intval')->values();
        return response()->json(['received' => $received]);
    }

    // Folder manifest: create every folder, including the empty ones.
    public function manifest(Request $r)
    {
        foreach ((array) $r->input('folders', []) as $folder) {
            $abs = $this->target((string) $folder);
            if (!$abs) {
                return $this->fail(400, 'INVALID_PATH', 'Invalid folder path');
            }
            if (!is_dir($abs)) {
                mkdir($abs, 0775, true);
            }
        }
        return response()->json(['ok' => true]);
    }

    // Finalize: assemble the chunks into the final file. Idempotent.
    public function finalize(Request $r)
    {
        $id = (string) $r->input('uploadId');
        $rel = (string) $r->input('relativePath');
        $dest = $this->target($rel);
        if (!Str::isUuid($id) || !$dest) {
            return $this->fail(400, 'INVALID_PATH', 'Invalid request');
        }
        $dir = $this->tmp($id);
        if (is_file("$dir/done")) {
            return response()->json(['ok' => true, 'path' => $rel]);
        }
        if (!is_dir(dirname($dest))) {
            mkdir(dirname($dest), 0775, true);
        }
        $part = "$dest.$id.part";
        $out = fopen($part, 'wb');
        for ($i = 0; $i < (int) $r->input('totalChunks'); $i++) {
            $chunk = "$dir/$i";
            if (!is_file($chunk)) {
                fclose($out);
                unlink($part);
                return $this->fail(409, 'CHUNK_MISMATCH', "Chunk $i is missing");
            }
            $in = fopen($chunk, 'rb');
            stream_copy_to_stream($in, $out);
            fclose($in);
        }
        fclose($out);
        if (filesize($part) !== (int) $r->input('totalSize')) {
            unlink($part);
            return $this->fail(409, 'CHUNK_MISMATCH', 'Assembled size does not match');
        }
        rename($part, $dest); // atomic on the same filesystem
        array_map('unlink', glob("$dir/*"));
        file_put_contents("$dir/done", $rel);
        return response()->json(['ok' => true, 'path' => $rel]);
    }
}
```

Check `upload_max_filesize` and `post_max_size` in `php.ini` against your `chunkSize`, and the web server's request size limit. Put the routes in `routes/web.php` only if you exclude them from CSRF verification.

## Documentation

- [`@vedratech/anydrop-ui`](packages/ui/README.md): UI options, texts, theming, accessibility.
- [`@vedratech/anydrop-core`](packages/core/README.md): every option, method and event of the engine, error codes, the transport interface.
- [Backend contract (protocol v1.4)](docs/protocol.md)
- [Migrating from Dropzone](docs/migrating-from-dropzone.md)
- [Size comparison](docs/size-comparison.md)
- [Real-device checks](docs/device-checks.md)

## License

MIT. Parts adapted from Dropzone (MIT) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
