---
title: "Express chunked upload backend example"
description: "A working Express 5 and multer backend for chunked, resumable and folder uploads with manifest, chunk status and finalize endpoints."
---

# Express example

A minimal implementation of the [backend contract](/protocol) with Express 5 and multer. It is a documentation example, not a shipped server: add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like it in production.

It was run against the real client with the quick-start configuration: whole files, chunked files, folders with empty folders (through the manifest), a reload in the middle of an upload, going offline, and a repeated finalize.

```sh
npm i express multer
```

```js
// npm i express multer
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve('uploads');
const TMP = path.resolve('uploads-tmp');
const UUID = /^[0-9a-f-]{36}$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
const app = express();
// The manifest lists every file of a batch: the 100 kB default limit rejects (413) more than about 600 files.
app.use(express.json({ limit: '20mb' }));

const fail = (res, status, code, message) => res.status(status).json({ code, message });

// Absolute path inside ROOT for a client-supplied relative path, or null.
function target(rel) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.includes('\\')) return null;
  if (rel.split('/').some((s) => s === '' || s === '..')) return null;
  const abs = path.resolve(ROOT, rel);
  return abs.startsWith(ROOT + path.sep) ? abs : null;
}
// Write to a temp name, then rename: a cut-off write never shows up as received.
async function writeAtomic(dest, data) {
  const part = `${dest}.${randomUUID()}.part`;
  await fs.writeFile(part, data);
  await fs.rename(part, dest);
}
const exists = (p) => fs.stat(p).then(() => true, () => false);

// Chunk upload, or a whole file. The same chunk may arrive twice: writing it again is harmless.
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'INVALID_CHUNK', 'Missing file');
  const { adUploadId } = req.body;

  // Not chunked (a file of at most chunkSize, or chunking is off): no `ad*` chunk fields, write the file in place.
  if (adUploadId === undefined) {
    const dest = target(req.body.adRelativePath);
    if (!dest) return fail(res, 400, 'INVALID_PATH', 'Invalid path');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await writeAtomic(dest, req.file.buffer);
    return res.json({ ok: true });
  }

  const index = Number(req.body.adChunkIndex);
  const size = Number(req.body.adChunkSize);
  const total = Number(req.body.adTotalSize);
  const offset = Number(req.body.adChunkOffset);
  if (!UUID.test(adUploadId) || !Number.isInteger(index) || index < 0) {
    return fail(res, 400, 'INVALID_CHUNK', 'Invalid chunk request');
  }
  if (req.file.size !== Math.min(size, total - offset)) {
    return fail(res, 400, 'INVALID_CHUNK', 'Chunk length does not match');
  }
  const dir = path.join(TMP, adUploadId);
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, String(index)), req.file.buffer);
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

## Notes

If the page and the API are on different origins, also answer the CORS preflight (`OPTIONS`) for these routes, allowing the methods `GET`, `POST` and `HEAD` and the headers the client sends (`X-Requested-With`, `Cache-Control`, `Content-Type` and your own).

See also the [Laravel example](/backend/laravel) and the [protocol](/protocol).
