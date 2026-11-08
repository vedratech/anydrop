# Laravel example

A minimal implementation of the [backend contract](/protocol) with Laravel. It is a documentation example, not a shipped server, and the PHP has been syntax-checked but **not run** against the client: test it in your own project. Add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like it in production.

```php
<?php
// routes/api.php: Laravel serves these under /api, so the client option is url: '/api/upload'
// (and manifestUrl: '/api/upload/manifest', and so on). On Laravel 11 and later, run `php artisan install:api` first.
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
        if (!$r->hasFile('file')) {
            return $this->fail(400, 'INVALID_CHUNK', 'Missing file');
        }
        $file = $r->file('file');

        // Not chunked (a file of at most chunkSize, or chunking is off): no dz* fields, write the file in place.
        if (!$r->has('dzuuid')) {
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

        $id = (string) $r->input('dzuuid');
        if (!Str::isUuid($id)) {
            return $this->fail(400, 'INVALID_CHUNK', 'Invalid chunk request');
        }
        $index = (int) $r->input('dzchunkindex');
        $size = (int) $r->input('dzchunksize');
        $total = (int) $r->input('dztotalfilesize');
        $offset = (int) $r->input('dzchunkbyteoffset');
        if ($index < 0 || $file->getSize() !== min($size, $total - $offset)) {
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

Check `upload_max_filesize` and `post_max_size` in `php.ini` against your `chunkSize`, and the web server's request size limit. Put the routes in `routes/web.php` only if you exclude them from CSRF verification.

See also the [Express example](/backend/express) and the [protocol](/protocol).
