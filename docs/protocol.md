---
title: "Upload protocol v1.4: the backend contract"
description: "The full AnyDrop HTTP contract: chunk fields, manifest, chunk status, finalize, status codes, error format and edge cases for backend authors."
---

# AnyDrop backend contract (protocol v1.4)

> This page is generated from the project's protocol specification. AnyDrop ships no server: you implement this contract in your own backend ([Express](/backend/express) and [Laravel](/backend/laravel) examples, and a [backend overview](/backend/)). Client packages: `@vedratech/anydrop-core` ([guide](/guide/headless-core)) and `@vedratech/anydrop-ui` ([guide](/guide/quick-start)).

Default field names are **the same as Dropzone's chunking fields**, so an existing Dropzone chunk backend keeps working. Our additions use the `ad` prefix. All field names can be renamed with the `params()` option: what it returns is merged over the built-in fields, and a `null` value drops a built-in field (so `{ dzuuid: null, uuid: file.upload.uuid }` renames `dzuuid`).

## 1. Upload session
A **batch** is everything added by one user action (a drop, a picker selection, a paste), or by programmatic adds in the same tick. Each batch gets its own `sessionId` (UUID v4) and at most one manifest; every chunk carries its batch's `adSessionId`. Each file gets one `uploadId` (UUID v4, equal to Dropzone's `dzuuid`). If chunk status answers `404` (section 4), the file gets a **new** `uploadId` and, when manifests are used, the batch manifest is resent with it (section 2). Each file also gets a `fingerprint = relativePath|size|lastModified`, used to resume from IndexedDB. A resumed file reuses the `uploadId` from its earlier session, so a backend can see a known `uploadId` under a new `sessionId`. It must treat that as the same upload. Backends must check that an `uploadId` belongs to the current user.

## 2. Manifest (optional, `sendManifest: true`), sent before any file
`POST {manifestUrl}` with JSON:
```json
{
  "sessionId": "uuid",
  "roots": ["MyFolder", "Other"],
  "folders": ["MyFolder", "MyFolder/sub", "MyFolder/empty", "Other"],
  "files": [{ "uploadId": "uuid", "relativePath": "MyFolder/sub/a.png", "size": 1234, "lastModified": 1700000000000, "type": "image/png" }]
}
```
Response `200 { "ok": true }`. The server creates all folders, including empty ones.
A user can drop several folders and loose files at once, so there can be several `roots`. A loose file's `relativePath` is just its name.
- One manifest per batch, sent right before the batch's first file starts. No file of the batch is sent until it returns 2xx.
- Lists only accepted files, with `relativePath` as sent (after `renameFile`). `folders` includes ancestors, and includes empty folders only when `preserveEmptyFolders` is on.
- **Idempotent:** the client resends the same manifest (same `sessionId`) after a failure or on `retryFailedOnly`. A repeated manifest for the same `sessionId` **replaces** the earlier one entry by entry, keyed by `relativePath` (the latest manifest wins). It is also resent when a file gets a new `uploadId` after the manifest was sent (a `404` from chunk status, section 4); that file sends no chunk with the new id until the resend returns 2xx. The server may drop partial data held under the old id. When manifests are used, a backend **may** reject chunks or finalize for an `uploadId` that is not in the session's latest manifest.
- Listed files may never arrive (removed or canceled on the client). The server must not wait for them forever.
- Empty folders reach the server only through the manifest.
- `size` is the size of the original file. When the app sets `transformFile` (for example image resizing), the uploaded size can differ; `dztotalfilesize` on each chunk is authoritative.

## 3. Chunk / file upload
`POST {url}` as `multipart/form-data`:
| Field | Meaning |
|---|---|
| `{paramName}` (default `file`) | chunk blob (or the whole file when not chunking) |
| `dzuuid` | uploadId |
| `dzchunkindex` | 0-based chunk index |
| `dztotalchunkcount` | total chunks |
| `dzchunksize` | configured chunk size in bytes |
| `dzchunkbyteoffset` | byte offset of this chunk |
| `dztotalfilesize` | total file size |
| `adRelativePath` | path relative to the dropped root, `/` separators, no leading `/` |
| `adSessionId` | session id (in `uploadMultiple` requests: `adSessionId[i]` per file instead, v1.2) |
| `adChecksum` (optional) | SHA-256 hex of the chunk |

The server **should** check that each chunk body is exactly `min(dzchunksize, dztotalfilesize - dzchunkbyteoffset)` bytes (with `binaryBody`, the request body; a zero-byte file is one empty chunk) and answer `400 INVALID_CHUNK` otherwise. This turns a browser that sends an empty or short body into a visible, retryable error (the user's Retry resends only missing chunks) instead of a silently truncated file (v1.4 addendum).

The server must accept chunks **in any order** and **more than once** (writes are idempotent). A chunk can arrive more than once even without retries: a request the client aborted may still be committed (seen in WebKit after a pause with `pauseMode: 'abort'`). Response: `200` with any JSON body.
Non-chunked uploads (one request per file, no `dz*` chunk fields) are never retried automatically. With `uploadMultiple` (non-chunked only), one request carries several files, and the per-file fields are indexed like Dropzone's param names: `file[0]`, `adRelativePath[0]`, `adSessionId[0]`, `file[1]`, `adRelativePath[1]`, `adSessionId[1]`, … One request can carry files from **different batches** (sessions), as Dropzone's `processQueue()` groups whatever is queued, so a multi-file request sends **no** plain `adSessionId`; read `adSessionId[i]` for each file.

## 4. Chunk status (resume)
`GET {chunkStatusUrl}?uploadId={uuid}` returns `200 { "received": [0,1,2,5] }`, or `200 { "received": [...], "complete": true }` once the file is assembled or finalized, or `404` if unknown (the client restarts the file from chunk 0 with a **new uploadId** and, when `sendManifest` is on, resends the batch manifest so the server learns the new id; see section 2).
The client uploads only the missing indexes. If the server status and the client's IndexedDB record disagree, the server wins. When the client's record says a file is finished, it skips the file only if the server answers `"complete": true`.
The client calls this only for files it is resuming (a stored record, a resume or retry after chunks were sent, or a `409`), never for fresh files.

Notes (v1.2 addendum, no wire change): non-chunked uploads carry no `dzuuid`, so a server cannot answer chunk status for them; a non-chunked file finished in an earlier session is uploaded again after a reload when `chunkStatusUrl` is set (apps that need the skip use `forceChunking`). `dzchunksize` is fixed per file once its first chunk is sent and stays the same across pause, resume, retry and reload. With `binaryBody` the chunk is the raw request body and no `dz*`/`ad*` fields are sent, as in Dropzone.

## 5. Finalize
After all chunks succeed: `POST {finalizeUrl}` with JSON `{ "uploadId", "relativePath", "totalSize", "totalChunks", "checksum?" }`. This is the equivalent of Dropzone's `chunksUploaded` hook, which users can override.
The server assembles to a temp file, verifies the size (and checksum if given), and renames atomically. Response: `200 { "ok": true, "path": "..." }`.
If `finalizeUrl` is not set, no finalize request is sent. The backend must then assemble the file itself once it has received every chunk, which is how most existing Dropzone backends already work.
Finalize is sent only for chunked uploads. It must be idempotent: a repeated finalize for an assembled file returns `200` again. A user-supplied `chunksUploaded(file, done)` replaces the built-in finalize request.

## 6. Errors
Non-2xx responses carry JSON `{ "code": "STRING_CODE", "message": "human text" }`. The client stores them in the error registry.
| HTTP | code | Client behaviour |
|---|---|---|
| 400 | `INVALID_PATH`, `INVALID_CHUNK` | do not retry; mark the file as error |
| 409 | `CHUNK_MISMATCH` | refetch status, then resend the missing chunks (at most 3 times per file); without a `chunkStatusUrl` the client cannot refetch, so the file fails with `CHUNK_MISMATCH` and is not retried |
| 413 | `TOO_LARGE` (the client uses the `code` in the body; a 413 without one is `HTTP_ERROR`, so always send the code) | do not retry |
| 401 / 403 | `AUTH` (also the client fallback when the body has no `code`) | do not retry automatically; emit `error` (an `onAuthExpired` refresh hook is on the roadmap) |
| 408 / 429 | body code or `SERVER_ERROR` | retry with backoff, honouring a `Retry-After` header in seconds (capped at 60 s) |
| 5xx / network / timeout / stall | `SERVER_ERROR` / `NETWORK` / `TIMEOUT` / `STALLED` | retry with backoff up to `retryChunksLimit`; failures with **no HTTP response** (network, timeout, stall) also feed connectivity detection: after 3 in a row across the instance the client pauses as `unreachable` and probes (section 7) instead of using up retries |
| other 4xx | body code or `HTTP_ERROR` | do not retry |
If the body is not JSON or has no `code`, the client uses the fallback code in the table.
Automatic retries (when `retryChunks` is on, the default) cover chunk POSTs plus the manifest, status and finalize requests. Backoff before retry *n* is `random(0.5..1) × min(30 s, 1 s × 2^(n-1))`. Failures while the browser is offline, or while the page is hidden, pause the upload instead and do not use up retries.
Codes created on the client: `ABORTED`, `PAUSED`, `OFFLINE`, `TIMEOUT`, `STALLED` (no upload progress for `stallTimeout`, default 30 s, or no response within 4 × `stallTimeout` after the body was sent), `HTTP_ERROR`, `REJECTED_TYPE`, `REJECTED_SIZE`, `MAX_FILES`, `REJECTED` (the user `accept()` callback rejected the file), `FINALIZE_FAILED` (a user `chunksUploaded` hook reported an error or threw), `UNREADABLE` (a request failed with a network error and the file can no longer be read: a cloud placeholder that is not downloaded, or a file moved or deleted; not retried automatically), `TRANSFORM_FAILED` (the user `transformFile` threw), `REQUEST_SETUP_FAILED` (a request could not be built or handed to the transport: user `url`/`method`/`params` threw, `xhr.open` or `setRequestHeader` threw; nothing was sent, not retried automatically), and `INVALID_PATH` also as a validation code (the path has a `..` segment). The rejection codes (`REJECTED_TYPE`, `REJECTED_SIZE`, `MAX_FILES`, `REJECTED`, and `INVALID_PATH` at validation) are set before anything is sent. `ABORTED`, `PAUSED` and `OFFLINE` are internal request outcomes and never appear in the error list.

## 7. Connectivity probe (optional, v1.4)
`HEAD {connectivityProbeUrl}`, with the same headers and credentials as uploads and no body. Answer quickly with any status (`204` recommended) and `Cache-Control: no-store`; enable CORS when it is cross-origin, otherwise the browser reports it as unreachable. The client treats **any** HTTP status as "the server is reachable". It is used only while the client is in the `unreachable` state (probe backoff `random(0.5..1) × min(60 s, 2 s × 2^(n-1))`). Without it the client probes with `GET {chunkStatusUrl}?uploadId=` for the failed file (any HTTP status counts as reachable, so a `404` is fine), or, with no `chunkStatusUrl`, by re-sending the failed request.

Probes carry the default `Accept`, `Cache-Control` and `X-Requested-With` headers (unless `defaultHeaders` is `false`) plus any `headers` option. A cross-origin backend therefore needs a CORS preflight response that allows `HEAD` (and `GET` for the fallback) and those headers. With `autoResumeOnReconnect: false`, probes run only when the app calls `reconnect()`. Backends that serve uploads through a proxy which can reset large bodies should provide this endpoint, so a failing request is not mistaken for a dead network.

## Changelog
- **v1.4 addendum:** section 3: backends should reject a chunk whose byte length does not match `dzchunksize` / `dztotalfilesize` / `dzchunkbyteoffset` with `400 INVALID_CHUNK`. No wire change; the client still does not retry a 400 automatically.
- **v1.4:** optional connectivity probe endpoint (section 7); client code `STALLED`; no-response failures feed `unreachable` detection and do not use up retries during an outage. Additive; existing backends need nothing.
- **v1.3:** a repeated manifest replaces the earlier one per `relativePath` (latest wins; ignoring the repeat is no longer allowed); the client resends the whole manifest when a file's uploadId changes after a status `404`; backends may reject uploadIds that are not in the latest manifest. Same wire format, changed backend contract.
- **v1.2 addendum:** clarifications only, no wire change: a `409` without `chunkStatusUrl` fails the file; non-chunked files cannot be confirmed by chunk status; `dzchunksize` is fixed per file; `binaryBody` sends no fields. The mock server and backends need nothing.
- **v1.2 addendum:** clarified that an aborted chunk may still be committed, so duplicates can occur without retries. No wire change.
- **v1.2:** `uploadMultiple` requests may carry files from several batches and send `adSessionId[i]` per file instead of one plain `adSessionId` (**wire change**). Client-only code `REQUEST_SETUP_FAILED`. The mock server reads `adSessionId[i]`, falling back to the plain field.
- **v1.1 addendum:** client-only codes `UNREADABLE`, `TRANSFORM_FAILED`, and `INVALID_PATH` at validation (paths with `..`); the `params()` merge rule (a `null` value drops a built-in field). No wire change, no version bump; the mock server and backends need nothing.
- **v1.1 addendum:** client-only code `FINALIZE_FAILED`; the manifest `size` is the size before `transformFile`. No wire change, no version bump.
- **v1.1 addendum:** client-only error code `REJECTED` for files rejected by the user `accept()` callback. No wire change, so no version bump; the mock server and backends need nothing.
- **v1.1:** sessions are per batch; the manifest is idempotent and may list uploadIds from earlier sessions; optional `complete` in chunk status; status is only queried when resuming; finalize is idempotent and chunked-only; `uploadMultiple` field indexing; 408/429/`Retry-After`; `TIMEOUT` and `HTTP_ERROR` codes; fallback codes for non-JSON errors. All changes add to v1 or clarify it.
- **v1:** first version.
