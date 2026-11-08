---
title: "Laravel chunked upload backend example"
description: "A Laravel controller and routes implementing chunked, resumable and folder uploads: chunk, status, manifest and finalize endpoints, with the php.ini, CSRF and error settings it needs."
---

# Laravel example

A minimal implementation of the [backend contract](/protocol) with Laravel. It is a documentation example, not a shipped server: add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like it in production.

It was run against the real client (the built `@vedratech/anydrop-ui` file, quick-start configuration below) with a fresh Laravel 13.40 app on PHP 8.4 (Windows, `php artisan serve`): whole files and chunked files (a file of 4 chunks), a folder four levels deep with unicode names, a zero-byte file and empty folders (through the manifest), 800 files in one folder (manifest of 220 kB), a reload in the middle of an upload (only the missing chunks were sent), going offline, a repeated finalize, and the error responses below. The files on disk matched the source by SHA-256. Not run: Laravel 11 and 12, Linux, and PHP behind nginx or Apache (the configuration calls below exist in Laravel 11 and later).

## 1. Create the app and the files

PHP 8.3 or newer is needed for Laravel 13 (8.2 for Laravel 11 and 12). Enable the `fileinfo`, `mbstring` and `openssl` extensions (and `pdo_sqlite` for the default database) in `php.ini`.

```sh
composer create-project laravel/laravel anydrop-backend
cd anydrop-backend
php artisan install:api   # Laravel 11 and later: creates routes/api.php (it also installs Sanctum, which this example does not use)
```

Replace `routes/api.php` (Laravel serves these routes under `/api`):

```php
<?php
// routes/api.php: Laravel serves these under /api, so the client option is url: '/api/upload'
// (and manifestUrl: '/api/upload/manifest', and so on).
use App\Http\Controllers\UploadController;
use Illuminate\Support\Facades\Route;

Route::post('/upload', [UploadController::class, 'chunk']);
Route::get('/upload/status', [UploadController::class, 'status']);
Route::post('/upload/manifest', [UploadController::class, 'manifest']);
Route::post('/upload/finalize', [UploadController::class, 'finalize']);
Route::get('/upload/ping', fn () => response()->noContent()->header('Cache-Control', 'no-store')); // answers HEAD too
```

Create `app/Http/Controllers/UploadController.php`. Files are written to `storage/app/uploads`, unfinished chunks to `storage/app/uploads-tmp`:

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
        if (!$rel || str_starts_with($rel, '/') || str_contains($rel, '\\') || str_contains($rel, "\0")) {
            return null;
        }
        // On a Windows server a colon is a drive letter or an NTFS data stream, not part of a name.
        if (DIRECTORY_SEPARATOR === '\\' && str_contains($rel, ':')) {
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
        if (!$r->hasFile('file')) {
            return $this->fail(400, 'INVALID_CHUNK', 'Missing file');
        }
        $file = $r->file('file');

        // Not chunked (a file of at most chunkSize, or chunking is off): no `ad*` chunk fields, write the file in place.
        if (!$r->has('adUploadId')) {
            $dest = $this->target((string) $r->input('adRelativePath'));
            if (!$dest) {
                return $this->fail(400, 'INVALID_PATH', 'Invalid path');
            }
            if (!is_dir(dirname($dest))) {
                mkdir(dirname($dest), 0775, true);
            }
            $part = basename($dest) . '.' . Str::uuid() . '.part';
            $file->move(dirname($dest), $part);
            rename(dirname($dest) . '/' . $part, $dest); // temp name, then rename
            return response()->json(['ok' => true]);
        }

        $id = (string) $r->input('adUploadId');
        $index = (int) $r->input('adChunkIndex');
        $size = (int) $r->input('adChunkSize');
        $total = (int) $r->input('adTotalSize');
        $offset = (int) $r->input('adChunkOffset');
        if (!Str::isUuid($id) || $index < 0) {
            return $this->fail(400, 'INVALID_CHUNK', 'Invalid chunk request');
        }
        if ($file->getSize() !== min($size, $total - $offset)) {
            return $this->fail(400, 'INVALID_CHUNK', 'Chunk length does not match');
        }
        $dir = $this->tmp($id);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $file->move($dir, "$index.part"); // temp name, then rename: a cut-off write never shows as received
        rename("$dir/$index.part", "$dir/$index");
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
        $received = collect(scandir($dir))->filter(fn ($n) => ctype_digit($n))->map(fn ($n) => (int) $n)->values();
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

## 2. Two changes in `bootstrap/app.php`

Both are needed. Without the first, a path with a leading or trailing space is stored under a different name than the one the client sent (Laravel trims every string in the request). Without the second, a request over `post_max_size` gets a `413` without the `TOO_LARGE` code that the [protocol](/protocol) asks for, and the client reports it as `HTTP_ERROR`.

```php
<?php
// bootstrap/app.php: the generated file with the two marked changes
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException; // added
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // added: keep paths exactly as the client sent them
        $middleware->trimStrings(except: ['adRelativePath', 'relativePath', 'folders.*']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // added: the code the protocol asks for when a request is over post_max_size
        $exceptions->render(fn (PostTooLargeException $e) => response()->json(['code' => 'TOO_LARGE', 'message' => 'The upload is too large'], 413));
        // JSON error bodies for /api. Already in the Laravel 13 skeleton; Laravel 11 and 12 answer JSON when the
        // request sends Accept: application/json, which AnyDrop does by default.
        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());
    })->create();
```

## 3. PHP limits

One chunk is one request, so `upload_max_filesize` must be at least your `chunkSize` and `post_max_size` a little more (the form fields add about 1 kB). The PHP defaults are `upload_max_filesize = 2M` and `post_max_size = 8M`, and the quick-start `chunkSize` is 5 MiB. Find the file with `php --ini` (the one `php artisan serve` uses is the command-line `php.ini`) and set, for example:

```ini
upload_max_filesize = 8M
post_max_size = 16M
display_errors = Off
```

Restart `php artisan serve` (or PHP-FPM) afterwards. If you skip this:

- **`upload_max_filesize` smaller than a chunk:** PHP drops the file part without an error, and the client's error list shows `INVALID_CHUNK` ("Missing file", HTTP 400) for every chunk. This is the most common first failure.
- **`post_max_size` smaller than a chunk:** `413` with `TOO_LARGE` (with the `bootstrap/app.php` change above). With `display_errors = On`, PHP prints a warning in front of the JSON, the client cannot parse the body and reports `HTTP_ERROR` ("Invalid JSON response from server."). Keep `display_errors` off, as in `php.ini-production`.

Also check the web server's request size limit (for nginx, `client_max_body_size`).

## 4. The client

```js
const ad = new AnyDrop('#uploader', {
  url: '/api/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024, // not larger than upload_max_filesize
  sendManifest: true,
  manifestUrl: '/api/upload/manifest',
  chunkStatusUrl: '/api/upload/status',
  finalizeUrl: '/api/upload/finalize',
  connectivityProbeUrl: '/api/upload/ping', // optional
});
```

The finalize and status URLs are needed: without `finalizeUrl` the controller never assembles the chunks. Serve the page from the Laravel app (put the built `index.global.js` and `style.css` in `public/`), or, from another origin, use absolute URLs: Laravel's default CORS settings already answer the preflight for `api/*` from any origin (a chunked upload from a page on another origin worked in Chromium). Narrow `allowed_origins` in `config/cors.php` (`php artisan config:publish cors`) for production.

## 5. Notes

- **Routes in `routes/web.php`:** only if you exclude them from CSRF verification, otherwise every request gets `419` (`{"message":"CSRF token mismatch."}`, shown as `HTTP_ERROR`). With the routes in `web.php` the client URLs have no `/api` prefix. In `bootstrap/app.php`, inside `withMiddleware`:

  ```php
  $middleware->validateCsrfTokens(except: ['upload', 'upload/*']);
  ```

  `routes/api.php` has no CSRF check and no session, so it is the better place.
- **Windows:** the client always sends `/` in paths, and the controller rejects `\`. `storage_path()` with `/` works on Windows. The controller also rejects `:` on a Windows server (without that, `C:/x` is a `500` and `a:b` creates an NTFS data stream). `php artisan serve` handles one request at a time: it is fine for testing (800 small files took about three and a half minutes), use a real web server for anything else.
- **Rate limits:** a folder upload sends many requests. If your `api` middleware group limits requests (the `throttle:api` middleware), exempt these routes or raise the limit. The client retries a `429` with backoff.
- **Errors:** the controller answers with the documented `{ "code", "message" }` body: `400 INVALID_PATH`, `400 INVALID_CHUNK`, `409 CHUNK_MISMATCH`, `404 HTTP_ERROR` for an unknown upload in chunk status. The client shows the server `code` in `getErrors()`.

See also the [Express example](/backend/express) and the [protocol](/protocol).
