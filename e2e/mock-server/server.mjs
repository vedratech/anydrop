#!/usr/bin/env node
/**
 * AnyDrop mock upload server. TEST ONLY, never published.
 *
 * Implements the wire protocol in docs/protocol.md (v1):
 *   POST {url}            chunk / whole file upload (multipart/form-data, ad* fields)
 *   GET  {statusUrl}      chunk status for resume
 *   POST {manifestUrl}    folder manifest (creates every folder, including empty ones)
 *   POST {finalizeUrl}    assemble + verify + atomic rename
 *   HEAD {connectivityProbeUrl}  optional connectivity probe, 204 (protocol v1.4, decision 0017)
 * plus test-only endpoints under /__ (report, log, config, reset, health).
 *
 * No dependencies: only Node built-ins. Start with `pnpm mock-server` (port 3001).
 *
 * Environment variables (all optional):
 *   AD_PORT               listen port (default 3001)
 *   AD_HOST               listen host (default: all interfaces, handy for real-device tests)
 *   AD_UPLOAD_DIR         storage root (default e2e/.uploads, gitignored)
 *   AD_FAIL_RATE          0..1, probability that a chunk POST fails with HTTP 500 (default 0)
 *   AD_LATENCY_MS         fixed delay added to every protocol request (default 0)
 *   AD_LATENCY_JITTER_MS  extra random 0..N ms delay (default 0)
 *   AD_SEED               integer seed for the fault/jitter PRNG (default 1)
 *   AD_AUTO_ASSEMBLE      1|0, assemble a file as soon as all chunks arrived (default 1; simple backends
 *                         without a finalize step behave like this). Set 0 to require /finalize.
 *   AD_MAX_FILE_MB        reject files larger than this with 413 TOO_LARGE (default: unlimited)
 *   AD_STRICT_MANIFEST    1|0, reject chunks and finalize requests whose uploadId is not in the session's
 *                         latest manifest with 400 INVALID_CHUNK (protocol v1.3 and later, decision 0016; default 0)
 *   AD_MAX_BODY_MB        reject single requests larger than this with 413 (default 1024)
 *   AD_LOG                1|0, log one line per request to stdout (default 1 when run as a CLI)
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ROUTES = {
  upload: '/upload',
  status: '/upload/status',
  manifest: '/upload/manifest',
  finalize: '/upload/finalize',
  ping: '/upload/ping',
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Small deterministic PRNG (mulberry32) so fault injection is reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class HttpError extends Error {
  constructor(status, code, message, extra, headers) {
    super(message);
    this.headers = headers;
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * Validate a client-supplied relative path. Returns the normalised path (no leading slash,
 * `/` separators). Throws 400 INVALID_PATH for anything that could escape the session folder.
 */
export function cleanRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) {
    throw new HttpError(400, 'INVALID_PATH', 'relativePath is missing or too long');
  }
  // eslint-disable-next-line no-control-regex
  if (p.startsWith('/') || p.includes('\\') || /[\x00-\x1f]/.test(p) || /^[A-Za-z]:/.test(p)) {
    throw new HttpError(400, 'INVALID_PATH', `relativePath is not allowed: ${JSON.stringify(p)}`);
  }
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new HttpError(400, 'INVALID_PATH', `relativePath is not allowed: ${JSON.stringify(p)}`);
    }
  }
  return parts.join('/');
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        tooLarge = true; // keep draining so the client can read our 413
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) reject(new HttpError(413, 'TOO_LARGE', `Request body exceeds ${limit} bytes`));
      else resolveBody(Buffer.concat(chunks, size));
    });
    req.on('error', reject);
    req.on('close', () => {
      if (!req.complete) reject(new HttpError(499, 'ABORTED', 'client aborted'));
    });
  });
}

async function readJson(req, limit) {
  const text = (await readBody(req, limit)).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'INVALID_CHUNK', 'Request body is not valid JSON');
  }
}

/** Minimal multipart/form-data parser. File parts are returned as zero-copy subarrays. */
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new HttpError(400, 'INVALID_CHUNK', 'Expected multipart/form-data');
  const boundary = m[1] || m[2];
  const delim = Buffer.from('--' + boundary);
  const sep2 = Buffer.from('\r\n--' + boundary);
  const fields = {};
  const files = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing "--"
    start += 2; // CRLF after boundary
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const header = buf.subarray(start, headerEnd).toString('utf8');
    const next = buf.indexOf(sep2, headerEnd + 4);
    if (next === -1) break;
    const body = buf.subarray(headerEnd + 4, next);
    const name = /name="([^"]*)"/i.exec(header)?.[1];
    const filename = /filename="([^"]*)"/i.exec(header)?.[1];
    if (filename !== undefined) files.push({ name, filename, data: body });
    else if (name !== undefined) fields[name] = body.toString('utf8');
    pos = next + 2; // skip the CRLF so indexOf finds the delimiter itself
  }
  return { fields, file: files[0] ?? null, files };
}

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
}

/**
 * Create a mock server instance. Nothing is listening until `start()` is called.
 * @param {object} [opts] See the environment variables above for meaning and defaults.
 */
export function createMockServer(opts = {}) {
  const env = process.env;
  const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  const config = {
    port: opts.port ?? num(env.AD_PORT, 3001),
    host: opts.host ?? env.AD_HOST ?? undefined,
    uploadDir: resolve(opts.uploadDir ?? env.AD_UPLOAD_DIR ?? join(HERE, '..', '.uploads')),
    failRate: opts.failRate ?? num(env.AD_FAIL_RATE, 0),
    latencyMs: opts.latencyMs ?? num(env.AD_LATENCY_MS, 0),
    latencyJitterMs: opts.latencyJitterMs ?? num(env.AD_LATENCY_JITTER_MS, 0),
    seed: opts.seed ?? num(env.AD_SEED, 1),
    autoAssemble: opts.autoAssemble ?? (env.AD_AUTO_ASSEMBLE ?? '1') !== '0',
    maxFileBytes:
      opts.maxFileBytes ?? (env.AD_MAX_FILE_MB ? num(env.AD_MAX_FILE_MB, 0) * 1048576 : 0),
    maxBodyBytes: opts.maxBodyBytes ?? num(env.AD_MAX_BODY_MB, 1024) * 1048576,
    log: opts.log ?? false,
    /** Protocol v1.3 (0016): chunks and finalize for an uploadId missing from the latest manifest get 400. */
    strictManifest: opts.strictManifest ?? (env.AD_STRICT_MANIFEST ?? '0') === '1',
    /** Forced failures: [{ where, relativePath?, uploadId?, chunkIndex?, status, code, times }] */
    /** Status of random (AD_FAIL_RATE) failures, e.g. 429 to exercise Retry-After handling. */
    failStatus: opts.failStatus ?? num(env.AD_FAIL_STATUS, 500),
    /** Seconds sent as `Retry-After` with random failures (0 = header omitted). */
    failRetryAfter: opts.failRetryAfter ?? num(env.AD_FAIL_RETRY_AFTER, 0),
    failRules: [],
  };

  let rng = makeRng(config.seed);
  const partsDir = () => join(config.uploadDir, '.parts');
  const tmpDir = () => join(config.uploadDir, '.tmp');

  /** uploadId -> upload record. In memory: a server restart forgets uploads (use /__reset). */
  const uploads = new Map();
  /** sessionId -> { manifest, entries (relativePath -> uploadId, latest manifest wins), manifestCalls } */
  const sessions = new Map();
  const requestLog = [];
  const stats = { inFlight: 0, maxInFlight: 0, injectedFailures: 0 };
  let seq = 0;
  const hashCache = new Map(); // path -> { key, sha256 }

  function resetState() {
    uploads.clear();
    sessions.clear();
    requestLog.length = 0;
    stats.inFlight = 0;
    stats.maxInFlight = 0;
    stats.injectedFailures = 0;
    hashCache.clear();
    seq = 0;
    rng = makeRng(config.seed);
    for (const r of config.failRules) r.hits = 0;
  }

  const sessionDir = (id) => join(config.uploadDir, id);

  function safeJoin(base, rel) {
    const full = resolve(base, ...rel.split('/'));
    if (full !== base && !full.startsWith(base + sep)) {
      throw new HttpError(400, 'INVALID_PATH', 'path escapes the session folder');
    }
    return full;
  }

  function sessionOf(raw) {
    const id = raw || 'no-session';
    if (!ID_RE.test(id))
      throw new HttpError(400, 'INVALID_PATH', 'sessionId has invalid characters');
    return id;
  }

  function send(res, status, body, extraHeaders) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(payload);
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    if (origin) res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ||
        'Content-Type, Authorization, X-Requested-With, Cache-Control',
    );
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }

  async function delay() {
    const ms = config.latencyMs + (config.latencyJitterMs ? rng() * config.latencyJitterMs : 0);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /** Returns an HttpError if a forced rule or the random fail rate says this request must fail. */
  function injectedFailure(where, info) {
    for (const rule of config.failRules) {
      if ((rule.where || 'chunk') !== where) continue;
      if (rule.relativePath !== undefined && rule.relativePath !== info.relativePath) continue;
      if (rule.uploadId !== undefined && rule.uploadId !== info.uploadId) continue;
      if (rule.chunkIndex !== undefined && rule.chunkIndex !== info.chunkIndex) continue;
      rule.hits = rule.hits || 0;
      if (rule.times != null && rule.hits >= rule.times) continue;
      rule.hits++;
      return new HttpError(
        rule.status || 500,
        rule.code || (rule.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR'),
        'Injected failure (rule)',
        undefined,
        rule.retryAfter ? { 'Retry-After': String(rule.retryAfter) } : undefined,
      );
    }
    if (where === 'chunk' && config.failRate > 0 && rng() < config.failRate) {
      const status = config.failStatus || 500;
      return new HttpError(
        status,
        status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
        'Injected failure (AD_FAIL_RATE)',
        undefined,
        config.failRetryAfter ? { 'Retry-After': String(config.failRetryAfter) } : undefined,
      );
    }
    return null;
  }

  function getUpload(uploadId) {
    return uploads.get(uploadId);
  }

  /** Concatenate parts in index order into a temp file, verify, then rename atomically. */
  async function assemble(up, { checksum } = {}) {
    if (up.complete) return;
    const missing = [];
    for (let i = 0; i < up.totalChunks; i++) if (!up.received.has(i)) missing.push(i);
    if (missing.length) {
      throw new HttpError(409, 'CHUNK_MISMATCH', 'Not all chunks have been received', { missing });
    }
    await mkdir(tmpDir(), { recursive: true });
    const tmp = join(tmpDir(), `${up.uploadId}.assemble`);
    const hash = createHash('sha256');
    let written = 0;
    const out = createWriteStream(tmp);
    // The destination can disappear (the storage directory was wiped, a test ended): an unhandled
    // stream 'error' would otherwise crash the process.
    let outError = null;
    out.on('error', (e) => {
      outError = e;
    });
    try {
      for (let i = 0; i < up.totalChunks; i++) {
        const part = join(partsDir(), up.uploadId, String(i));
        await new Promise((res, rej) => {
          const rs = createReadStream(part);
          if (outError) return rej(outError);
          out.once('error', rej);
          rs.on('data', (d) => {
            hash.update(d);
            written += d.length;
          });
          rs.on('error', rej);
          rs.on('end', () => {
            out.off('error', rej);
            res();
          });
          rs.pipe(out, { end: false });
        });
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    } catch (e) {
      out.destroy();
      await rm(tmp, { force: true });
      throw new HttpError(500, 'SERVER_ERROR', `assemble failed: ${e.message}`);
    }
    const digest = hash.digest('hex');
    if (written !== up.totalSize) {
      await rm(tmp, { force: true });
      throw new HttpError(
        409,
        'CHUNK_MISMATCH',
        `Assembled size ${written} != totalSize ${up.totalSize}`,
      );
    }
    if (checksum && checksum.toLowerCase() !== digest) {
      await rm(tmp, { force: true });
      throw new HttpError(400, 'INVALID_CHUNK', 'checksum mismatch');
    }
    const target = safeJoin(sessionDir(up.sessionId), up.relativePath);
    try {
      await mkdir(dirname(target), { recursive: true });
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw new HttpError(
        400,
        'INVALID_PATH',
        `cannot store ${up.relativePath}: ${e.code || e.message}`,
      );
    }
    up.complete = true;
    up.sha256 = digest;
    up.assembledAt = Date.now();
    hashCache.set(target, { key: `${written}:${(await stat(target)).mtimeMs}`, sha256: digest });
    await rm(join(partsDir(), up.uploadId), { recursive: true, force: true });
  }

  /** Concurrent duplicates of the last chunk must not assemble twice. */
  function assembleOnce(up, o) {
    if (!up.assembling)
      up.assembling = assemble(up, o).finally(() => {
        up.assembling = null;
      });
    return up.assembling;
  }

  // ---------------------------------------------------------------- protocol handlers

  /** Whole-file write: temp file, size known, atomic rename into the session folder. */
  async function storeWholeFile(sessionId, relativePath, data) {
    const uploadId =
      'nz_' +
      createHash('sha256').update(`${sessionId}|${relativePath}`).digest('hex').slice(0, 32);
    await mkdir(tmpDir(), { recursive: true });
    const tmp = join(tmpDir(), `${uploadId}.${seq}.whole`);
    await writeFile(tmp, data);
    const target = safeJoin(sessionDir(sessionId), relativePath);
    try {
      await mkdir(dirname(target), { recursive: true });
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true });
      throw new HttpError(
        400,
        'INVALID_PATH',
        `cannot store ${relativePath}: ${e.code || e.message}`,
      );
    }
    const prev = uploads.get(uploadId);
    uploads.set(uploadId, {
      uploadId,
      sessionId,
      relativePath,
      totalChunks: 1,
      totalSize: data.length,
      chunkSize: data.length,
      received: new Set([0]),
      writes: { 0: (prev?.writes[0] || 0) + 1 },
      complete: true,
      sha256: createHash('sha256').update(data).digest('hex'),
      createdAt: Date.now(),
    });
    return uploadId;
  }

  async function handleUploadMultiple(fields, files, res, entry) {
    // Protocol v1.2 and later: one request can mix batches, so each file carries `adSessionId[i]`
    // (the plain `adSessionId` is accepted as a fallback). Decision 0013.
    const items = files.map((f) => {
      const i = /\[(\d+)\]$/.exec(f.name || '')?.[1];
      const rel = fields[`adRelativePath[${i}]`] || fields[`fullPath[${i}]`] || f.filename;
      const sessionId = sessionOf(fields[`adSessionId[${i}]`] || fields.adSessionId);
      return { sessionId, relativePath: cleanRelativePath(rel), data: f.data };
    });
    entry.relativePath = items.map((i) => i.relativePath).join(',');
    entry.files = items.length;
    entry.bytes = items.reduce((n, i) => n + i.data.length, 0);
    await delay();
    if (res.destroyed || res.socket?.destroyed) {
      entry.note = 'client-aborted-before-commit';
      return null;
    }
    const failure = injectedFailure('chunk', { relativePath: items[0]?.relativePath });
    if (failure) {
      stats.injectedFailures++;
      entry.note = 'injected-failure';
      throw failure;
    }
    for (const it of items) await storeWholeFile(it.sessionId, it.relativePath, it.data);
    return { ok: true, files: items.length };
  }

  /** Strict mode (0016): the upload must be in the session's latest manifest. */
  function checkAnnounced(sessionId, relativePath, uploadId) {
    const announced = sessions.get(sessionId)?.entries?.get(relativePath);
    if (announced !== uploadId) {
      throw new HttpError(
        400,
        'INVALID_CHUNK',
        announced === undefined
          ? `uploadId ${uploadId} is not in the manifest of session ${sessionId} (none sent for ${relativePath})`
          : `uploadId ${uploadId} is not the one in the latest manifest for ${relativePath}`,
      );
    }
  }

  async function handleUpload(req, res, entry) {
    const raw = await readBody(req, config.maxBodyBytes);
    // Whole request body as received (a chunk the browser sent without its payload shows here).
    entry.bodyBytes = raw.length;
    entry.contentLength = req.headers['content-length'];
    const { fields, file, files } = parseMultipart(raw, req.headers['content-type']);
    if (!file) throw new HttpError(400, 'INVALID_CHUNK', 'No file part in the request');
    // uploadMultiple (non-chunked only): file[0], adRelativePath[0], file[1], adRelativePath[1], ...
    if (fields.adChunkIndex === undefined && files.some((f) => /\[\d+\]$/.test(f.name || ''))) {
      return handleUploadMultiple(fields, files, res, entry);
    }

    const chunked = fields.adChunkIndex !== undefined;
    const sessionId = sessionOf(fields.adSessionId);
    const relativePath = cleanRelativePath(
      fields.adRelativePath || fields.fullPath || file.filename,
    );
    const totalChunks = chunked ? Number(fields.adChunkCount) : 1;
    const chunkIndex = chunked ? Number(fields.adChunkIndex) : 0;
    const totalSize = Number(fields.adTotalSize ?? file.data.length);
    const chunkSize = Number(fields.adChunkSize ?? file.data.length);
    const uploadId =
      fields.adUploadId ||
      'nz_' +
        createHash('sha256').update(`${sessionId}|${relativePath}`).digest('hex').slice(0, 32);
    entry.uploadId = uploadId;
    entry.chunkIndex = chunkIndex;
    entry.relativePath = relativePath;
    entry.bytes = file.data.length;

    if (fields.adUploadId && !ID_RE.test(fields.adUploadId)) {
      throw new HttpError(400, 'INVALID_CHUNK', 'adUploadId has invalid characters');
    }
    if (config.strictManifest && fields.adUploadId)
      checkAnnounced(sessionId, relativePath, uploadId);
    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      chunkIndex >= totalChunks ||
      !Number.isFinite(totalSize) ||
      totalSize < 0
    ) {
      throw new HttpError(400, 'INVALID_CHUNK', 'Invalid chunk index, count or size fields');
    }
    if (config.maxFileBytes && totalSize > config.maxFileBytes) {
      throw new HttpError(413, 'TOO_LARGE', `File exceeds ${config.maxFileBytes} bytes`);
    }
    if (chunked) {
      const offset =
        fields.adChunkOffset === undefined ? chunkIndex * chunkSize : Number(fields.adChunkOffset);
      const expected = Math.max(0, Math.min(chunkSize, totalSize - offset));
      if (offset !== chunkIndex * chunkSize || file.data.length !== expected) {
        throw new HttpError(
          400,
          'INVALID_CHUNK',
          `Chunk ${chunkIndex}: offset ${offset} / length ${file.data.length} do not match (expected offset ${chunkIndex * chunkSize}, length ${expected})`,
        );
      }
    }

    await delay();
    if (res.destroyed || res.socket?.destroyed) {
      entry.note = 'client-aborted-before-commit';
      return null;
    }
    const failure = injectedFailure('chunk', { uploadId, relativePath, chunkIndex });
    if (failure) {
      stats.injectedFailures++;
      entry.note = 'injected-failure';
      throw failure;
    }

    let up = getUpload(uploadId);
    if (
      up &&
      (up.totalChunks !== totalChunks ||
        up.totalSize !== totalSize ||
        up.relativePath !== relativePath)
    ) {
      throw new HttpError(
        409,
        'CHUNK_MISMATCH',
        'Chunk metadata differs from earlier chunks of this upload',
      );
    }
    if (!up) {
      up = {
        uploadId,
        sessionId,
        relativePath,
        totalChunks,
        totalSize,
        chunkSize,
        received: new Set(),
        writes: {},
        complete: false,
        sha256: null,
        createdAt: Date.now(),
      };
      uploads.set(uploadId, up);
    }
    // A resumed file keeps its uploadId under a new sessionId: same upload, but the file is
    // assembled into the session of its latest chunk, and every session that touched it is recorded.
    if (!up.complete) up.sessionId = sessionId;
    (up.sessionIds ||= new Set()).add(sessionId);
    up.writes[chunkIndex] = (up.writes[chunkIndex] || 0) + 1;
    if (up.writes[chunkIndex] > 1) entry.duplicate = true;

    if (!up.complete) {
      // Idempotent write: same index overwrites the same part file.
      const dir = join(partsDir(), uploadId);
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `${chunkIndex}.tmp-${process.pid}-${seq}`);
      await writeFile(tmp, file.data);
      await rename(tmp, join(dir, String(chunkIndex)));
      up.received.add(chunkIndex);
      if (config.autoAssemble && up.received.size === up.totalChunks) await assembleOnce(up);
    }
    return {
      ok: true,
      uploadId,
      chunkIndex,
      received: up.received.size,
      totalChunks,
      complete: up.complete,
    };
  }

  async function handleStatus(url) {
    const uploadId = url.searchParams.get('uploadId');
    if (!uploadId)
      throw new HttpError(400, 'INVALID_CHUNK', 'uploadId query parameter is required');
    const up = getUpload(uploadId);
    if (!up) throw new HttpError(404, 'NOT_FOUND', 'Unknown uploadId');
    const received = up.complete
      ? Array.from({ length: up.totalChunks }, (_, i) => i)
      : [...up.received].sort((a, b) => a - b);
    return { received, complete: up.complete, totalChunks: up.totalChunks };
  }

  async function handleManifest(req, entry) {
    const body = await readJson(req, config.maxBodyBytes);
    const sessionId = sessionOf(body.sessionId);
    const folders = Array.isArray(body.folders) ? body.folders : [];
    const files = Array.isArray(body.files) ? body.files : [];
    const roots = Array.isArray(body.roots) ? body.roots : [];
    entry.session = sessionId;
    entry.files = files.length;
    entry.folders = folders.length;
    await delay();
    const failure = injectedFailure('manifest', {});
    if (failure) throw failure;
    const base = sessionDir(sessionId);
    await mkdir(base, { recursive: true });
    for (const f of [...roots, ...folders]) {
      const rel = cleanRelativePath(f);
      try {
        await mkdir(safeJoin(base, rel), { recursive: true });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(
          400,
          'INVALID_PATH',
          `cannot create folder ${rel}: ${e.code || e.message}`,
        );
      }
    }
    for (const f of files) cleanRelativePath(f.relativePath); // validate only
    const s = sessions.get(sessionId) || { manifestCalls: 0 };
    s.manifest = body;
    // A repeated manifest replaces the earlier one entry by entry, keyed by relativePath (v1.3).
    s.entries ||= new Map();
    for (const f of files) {
      if (f && typeof f.uploadId === 'string')
        s.entries.set(cleanRelativePath(f.relativePath), f.uploadId);
    }
    s.manifestCalls++;
    sessions.set(sessionId, s);
    return { ok: true };
  }

  async function handleFinalize(req, entry) {
    const body = await readJson(req, config.maxBodyBytes);
    const { uploadId } = body;
    entry.uploadId = uploadId;
    entry.relativePath = body.relativePath;
    await delay();
    const failure = injectedFailure('finalize', { uploadId, relativePath: body.relativePath });
    if (failure) throw failure;
    const up = typeof uploadId === 'string' ? getUpload(uploadId) : undefined;
    if (!up) throw new HttpError(404, 'NOT_FOUND', 'Unknown uploadId');
    if (config.strictManifest) checkAnnounced(up.sessionId, up.relativePath, uploadId);
    up.finalizeCalls = (up.finalizeCalls || 0) + 1;
    if (
      body.relativePath !== undefined &&
      cleanRelativePath(body.relativePath) !== up.relativePath
    ) {
      throw new HttpError(409, 'CHUNK_MISMATCH', 'relativePath differs from the uploaded chunks');
    }
    if (body.totalSize !== undefined && Number(body.totalSize) !== up.totalSize) {
      throw new HttpError(409, 'CHUNK_MISMATCH', 'totalSize differs from the uploaded chunks');
    }
    if (body.totalChunks !== undefined && Number(body.totalChunks) !== up.totalChunks) {
      throw new HttpError(409, 'CHUNK_MISMATCH', 'totalChunks differs from the uploaded chunks');
    }
    await assembleOnce(up, { checksum: body.checksum });
    return { ok: true, path: `${up.sessionId}/${up.relativePath}` };
  }

  // ---------------------------------------------------------------- test-only endpoints

  async function walk(base) {
    const files = [];
    const folders = [];
    async function rec(dir, prefix) {
      let items;
      try {
        items = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const it of items) {
        const rel = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.isDirectory()) {
          folders.push(rel);
          await rec(join(dir, it.name), rel);
        } else if (it.isFile()) {
          const full = join(dir, it.name);
          const st = await stat(full);
          const key = `${st.size}:${st.mtimeMs}`;
          let c = hashCache.get(full);
          if (!c || c.key !== key) {
            c = { key, sha256: await sha256File(full) };
            hashCache.set(full, c);
          }
          files.push({ path: rel, size: st.size, sha256: c.sha256 });
        }
      }
    }
    await rec(base, '');
    return { files, folders };
  }

  async function buildReport(sessionFilter) {
    let ids = [];
    try {
      ids = (await readdir(config.uploadDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      /* nothing uploaded yet */
    }
    if (sessionFilter) ids = ids.filter((i) => i === sessionFilter);
    const out = {};
    for (const id of ids) {
      const tree = await walk(sessionDir(id));
      out[id] = {
        ...tree,
        manifestCalls: sessions.get(id)?.manifestCalls || 0,
        manifest: sessions.get(id)?.manifest || null,
      };
    }
    const uploadList = [...uploads.values()]
      .filter(
        (u) => !sessionFilter || u.sessionIds?.has(sessionFilter) || u.sessionId === sessionFilter,
      )
      .map((u) => ({
        uploadId: u.uploadId,
        sessionId: u.sessionId,
        sessionIds: [...(u.sessionIds ?? [u.sessionId])],
        relativePath: u.relativePath,
        totalChunks: u.totalChunks,
        totalSize: u.totalSize,
        received: [...u.received].sort((a, b) => a - b),
        writes: u.writes,
        duplicateChunkWrites: Object.values(u.writes).filter((n) => n > 1).length,
        finalizeCalls: u.finalizeCalls || 0,
        complete: u.complete,
        sha256: u.sha256,
      }));
    // Union of all (filtered) sessions, by path: handy after a reload, when a resumed upload spans
    // several sessions. Later sessions overwrite earlier ones.
    const mergedFiles = new Map();
    const mergedFolders = new Set();
    for (const id of ids) {
      for (const f of out[id].files) mergedFiles.set(f.path, f);
      for (const d of out[id].folders) mergedFolders.add(d);
    }
    return {
      uploadDir: config.uploadDir,
      sessions: out,
      merged: {
        files: [...mergedFiles.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
        folders: [...mergedFolders].sort(),
      },
      uploads: uploadList,
      stats: { ...stats, requests: requestLog.length },
    };
  }

  const PUBLIC_CONFIG_KEYS = [
    'failRate',
    'failStatus',
    'failRetryAfter',
    'latencyMs',
    'latencyJitterMs',
    'seed',
    'autoAssemble',
    'maxFileBytes',
    'maxBodyBytes',
    'strictManifest',
    'failRules',
  ];
  const publicConfig = () => Object.fromEntries(PUBLIC_CONFIG_KEYS.map((k) => [k, config[k]]));

  async function handleControl(req, res, url) {
    const path = url.pathname;
    if (path === '/__health')
      return send(res, 200, { ok: true, uploadDir: config.uploadDir, config: publicConfig() });
    if (path === '/__report' && req.method === 'GET') {
      return send(res, 200, await buildReport(url.searchParams.get('session') || undefined));
    }
    if (path === '/__log' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const uploadId = url.searchParams.get('uploadId');
      return send(
        res,
        200,
        requestLog.filter((e) => e.seq > since && (!uploadId || e.uploadId === uploadId)),
      );
    }
    if (path === '/__config' && req.method === 'GET') return send(res, 200, publicConfig());
    if (path === '/__config' && (req.method === 'POST' || req.method === 'PATCH')) {
      const patch = await readJson(req, 1 << 20);
      for (const k of PUBLIC_CONFIG_KEYS) if (k in patch) config[k] = patch[k];
      if ('seed' in patch) rng = makeRng(config.seed);
      return send(res, 200, publicConfig());
    }
    if (path === '/__reset' && req.method === 'POST') {
      const keepConfig = url.searchParams.get('keepConfig') === '1';
      resetState();
      if (!keepConfig) {
        config.failRules = [];
        config.failRate = opts.failRate ?? num(env.AD_FAIL_RATE, 0);
        config.latencyMs = opts.latencyMs ?? num(env.AD_LATENCY_MS, 0);
        config.autoAssemble = opts.autoAssemble ?? (env.AD_AUTO_ASSEMBLE ?? '1') !== '0';
      }
      await rm(config.uploadDir, { recursive: true, force: true });
      await mkdir(config.uploadDir, { recursive: true });
      return send(res, 200, { ok: true });
    }
    throw new HttpError(404, 'NOT_FOUND', 'Unknown control endpoint');
  }

  // ---------------------------------------------------------------- request dispatch

  async function onRequest(req, res) {
    applyCors(req, res);
    const url = new URL(req.url || '/', 'http://mock.local');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const started = Date.now();
    const isProtocol = Object.values(ROUTES).includes(url.pathname);
    const entry = { seq: ++seq, ts: started, method: req.method, path: url.pathname };
    const isChunk = isProtocol && url.pathname === ROUTES.upload && req.method === 'POST';
    if (isChunk) {
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      entry.inFlightAtStart = stats.inFlight;
    }
    let aborted = false;
    res.on('close', () => {
      if (!res.writableEnded) aborted = true;
    });
    try {
      let body;
      let status = 200;
      if (url.pathname.startsWith('/__')) {
        return await handleControl(req, res, url);
      }
      if (url.pathname === ROUTES.upload && req.method === 'POST')
        body = await handleUpload(req, res, entry);
      else if (url.pathname === ROUTES.status && req.method === 'GET') {
        await delay();
        const f = injectedFailure('status', { uploadId: url.searchParams.get('uploadId') });
        if (f) throw f;
        entry.uploadId = url.searchParams.get('uploadId') || undefined;
        body = await handleStatus(url);
      } else if (url.pathname === ROUTES.manifest && req.method === 'POST')
        body = await handleManifest(req, entry);
      else if (url.pathname === ROUTES.finalize && req.method === 'POST')
        body = await handleFinalize(req, entry);
      else if (url.pathname === ROUTES.ping && (req.method === 'HEAD' || req.method === 'GET')) {
        // Connectivity probe (protocol v1.4, decision 0017): any HTTP answer means "reachable".
        entry.status = 204;
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      } else if (isProtocol)
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} not allowed here`);
      else throw new HttpError(404, 'NOT_FOUND', 'Unknown endpoint');
      if (body === null) {
        entry.status = 499;
        return;
      }
      entry.status = status;
      send(res, status, body);
    } catch (e) {
      const err =
        e instanceof HttpError ? e : new HttpError(500, 'SERVER_ERROR', String(e?.message || e));
      if (!(e instanceof HttpError)) console.error('[mock-server] unexpected error', e);
      entry.status = err.status;
      entry.code = err.code;
      if (err.status === 499 || aborted) entry.note = entry.note || 'client-aborted';
      else if (!res.headersSent)
        send(res, err.status, { code: err.code, message: err.message, ...err.extra }, err.headers);
    } finally {
      if (isChunk) stats.inFlight--;
      entry.durationMs = Date.now() - started;
      if (!url.pathname.startsWith('/__')) {
        requestLog.push(entry);
        if (requestLog.length > 200000) requestLog.splice(0, 50000);
        if (config.log) {
          const bits = [entry.status, req.method, url.pathname];
          if (entry.relativePath) bits.push(entry.relativePath);
          if (entry.chunkIndex !== undefined) bits.push(`#${entry.chunkIndex}`);
          if (entry.code) bits.push(entry.code);
          if (entry.note) bits.push(`(${entry.note})`);
          if (entry.duplicate) bits.push('(duplicate)');
          console.log(`[mock] ${bits.join(' ')} ${entry.durationMs}ms`);
        }
      }
    }
  }

  const server = createServer((req, res) => {
    onRequest(req, res).catch((e) => {
      console.error('[mock-server] fatal', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.keepAliveTimeout = 5000;

  return {
    config,
    server,
    reset: async () => {
      resetState();
      await rm(config.uploadDir, { recursive: true, force: true });
      await mkdir(config.uploadDir, { recursive: true });
    },
    /** Resolves with the actual port (pass `port: 0` for an ephemeral one). */
    async start() {
      await mkdir(config.uploadDir, { recursive: true });
      await new Promise((res, rej) => {
        server.once('error', rej);
        server.listen(config.port, config.host, res);
      });
      const addr = server.address();
      return typeof addr === 'object' && addr ? addr.port : config.port;
    },
    close: () =>
      new Promise((res) => {
        server.closeAllConnections?.();
        server.close(() => res());
      }),
    newSessionId: () => randomUUID(),
  };
}

// CLI entry: `node e2e/mock-server/server.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = createMockServer({ log: (process.env.AD_LOG ?? '1') !== '0' });
  mock
    .start()
    .then((port) => {
      const c = mock.config;
      console.log(`[mock] AnyDrop mock server on http://localhost:${port}`);
      console.log(`[mock] storing uploads in ${c.uploadDir}`);
      console.log(
        `[mock] failRate=${c.failRate} latency=${c.latencyMs}ms(+${c.latencyJitterMs}) autoAssemble=${c.autoAssemble} seed=${c.seed}`,
      );
    })
    .catch((e) => {
      console.error(`[mock] failed to start: ${e.message}`);
      process.exit(1);
    });
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
