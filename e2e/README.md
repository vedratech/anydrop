# e2e: Playwright tests, fixtures and the mock upload server

Test-only. Nothing in this folder is published.

## Commands (run from the repo root)

| Command                                               | What it does                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm mock-server` (alias `pnpm dev:mock`)            | Mock server on http://localhost:3001, storing into `e2e/.uploads/`        |
| `pnpm demo` (alias `pnpm dev:demo`)                   | Demo on http://localhost:5173 (reads `VITE_MOCK_URL`, default port 3001)  |
| `pnpm fixtures --files 1500 --depth 4 --empty 5`      | Seeded nested test folder in `e2e/fixtures/generated/tree` (gitignored)   |
| `pnpm fixtures --large 1 --large-mb 1024`             | Adds sparse large files in `e2e/fixtures/generated/large/`                |
| `pnpm compare <expectedDir> <actualDir>`              | Exit 1 when paths, sizes, SHA-256 or empty folders differ                 |
| `pnpm test:e2e [--project=chromium] [file]`           | Playwright. Starts the mock server and the demo itself (`webServer`).     |
| `pnpm e2e:clean`                                      | Removes `e2e/test-results` and `e2e/playwright-report`                    |
| `pnpm check:consumer`                                 | Fresh-consumer smoke test (packed tarballs, Vite app, plain HTML page, locale and theme imports, TypeScript bundler/node16/node10) |

**Run `pnpm build` first.** The demo page used by the e2e suite runs against the built packages
(`AD_PKG=dist`, set by the Playwright config, no hot reload), so edits to the sources in the middle of a run
cannot reload a test page, and the tests exercise what ships.

**Concurrent runs are safe.** Every run gets its own output and report directory
(`test-results/<AD_E2E_RUN>`, decision 0015) and its own random ports for the demo and the shared mock
server (`AD_PORT`, `DEMO_PORT` pin them, `AD_E2E_REUSE=1` reuses servers you started yourself). `--output`
still overrides the output directory.

Projects: `chromium`, `firefox`, `webkit`, `iphone` (device "iPhone 14"), `pixel` (device "Pixel 7").
Install browsers once with `pnpm exec playwright install chromium firefox webkit`.

## Specs

| Spec | Covers |
| --- | --- |
| `demo.spec.ts` | the demo page loads (smoke, all projects) |
| `mock-server*.spec.ts` | the mock server follows the upload protocol (chromium) |
| `core-upload.spec.ts`, `core-m3.spec.ts` | the headless core in a browser: tree, chunking, limits, pause and resume, offline, reload, errors (chromium; `core-m3` on all projects) |
| `ui.spec.ts`, `cdn.spec.ts` | the UI and the CDN build on a plain page |
| `ui-scenarios.spec.ts` | verify-upload 1 to 5 through the demo UI: 1,100 file folder drop and folder picker by SHA-256, offline mid-upload, pause at file, folder and global level, reload and pick again, server errors and "Retry failed" |
| `ui-custom.spec.ts` | decision 0021: custom row actions and overrides (`actionclicked` before the action), RTL with `ar`, render-hook focus and leak counters (2,000 files), preset contrast (WCAG, `support/contrast.ts`), compact layout at 320 px, locale files on a plain page |
| `large-file.spec.ts` | verify-upload 7: 1 GiB (Chromium), 256 MiB (Firefox), 64 MiB (mobile, WebKit) through the UI, `Blob.slice` only, JS heap sampled in Chromium, SHA-256 matches |
| `wrapper-ready.spec.ts` | verify-upload 8: no leaked listeners, timers, observers, object URLs or requests after `destroy()`, independent instances, Node import without a DOM |
| `docs-snippets.spec.ts` | verify-upload 9: AnyDrop's own documented snippets run as written (programmatic config, events, `processQueue`, `maxFiles`, rejection messages, headers, `sending` formData, `AnyDrop.options.<id>` presets, `.anydrop` auto-discovery) |
| `connectivity.spec.ts` | decision 0017: offline, lie-fi, stalls, server restart, offline at start, manifest and finalize, reload during an outage, long outage (fake clock), Retry now, 5xx and 429 storms, the loop guard (chromium and webkit; `AD_SLOW=1` adds a real 2 minute outage) |
| `connectivity-engines.spec.ts` | records how each engine fails a request (refused, DNS, aborted, held) and whether upload progress events fire |

WebKit note: in Playwright's WebKit build a `Blob.slice()` of a file chosen with `setInputFiles(path)` is sent as an
empty body (reproduced without AnyDrop), so on webkit and iphone the specs add folders by a folder drop (Files made
in the page) and `large-file.spec.ts` builds its file in the page. See `docs/device-checks.md` for the real-iPhone check.

## Writing tests

- Import `test` and `expect` from `./support/mock` to get the `mock` fixture: a fresh, isolated
  mock server on an ephemeral port with its own temp upload dir, closed after the test. Use it for
  anything that changes the mock config (failures, latency) or counts requests. The shared server on
  port 3001 is only for the demo smoke tests.
- `mock.report(sessionId)` returns the received tree (files with SHA-256, folders including empty
  ones), per-upload chunk bookkeeping (`received`, `writes`, `duplicateChunkWrites`) and stats
  (`maxInFlight`, `injectedFailures`). `mock.log()` is the request log. `mock.configure({...})`.
- Compare against the source with `walkTree` and `diffTrees` from `fixtures/lib.mjs`.
- Generate data in the test with `execFileSync(process.execPath, ['fixtures/generate.mjs', '--out', tmp, ...])`
  (see `tests/mock-server-tree.spec.ts`). The generator is seeded, so results are reproducible.
- Browser independent tests should `test.skip` outside the chromium project.

## Mock server

`e2e/mock-server/server.mjs`, Node built-ins only. Implements the backend contract in `docs/protocol.md` (v1.

| Method and path             | Behaviour                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /upload`              | multipart chunk or whole file (`ad*` fields). Idempotent; any order; validates path, index, offset and length. Auto-assembles when all chunks are in (`AD_AUTO_ASSEMBLE=0` turns that off). |
| `GET /upload/status?uploadId=` | `200 { received: [..], complete, totalChunks }` or `404 NOT_FOUND`                               |
| `POST /upload/manifest`     | JSON manifest; creates every folder (including empty ones) under `<uploadDir>/<sessionId>/`        |
| `POST /upload/finalize`     | verifies chunks, size and optional checksum, assembles to a temp file, renames atomically; `409 CHUNK_MISMATCH` with `missing: []` if incomplete |
| `GET /__health`             | liveness and current config                                                                         |
| `GET /__report[?session=]`  | received tree with SHA-256 (read from disk), uploads bookkeeping, stats                             |
| `GET /__log[?since=&uploadId=]` | request log (`seq`, `status`, `code`, `uploadId`, `chunkIndex`, `duplicate`, `note`)           |
| `GET/POST /__config`        | read or patch `failRate`, `latencyMs`, `latencyJitterMs`, `autoAssemble`, `maxFileBytes`, `failRules` |
| `POST /__reset[?keepConfig=1]` | forget all uploads and wipe the storage dir                                                      |

Errors are `{ code, message }` with the codes from the protocol (`INVALID_PATH`, `INVALID_CHUNK`,
`CHUNK_MISMATCH`, `TOO_LARGE`, `SERVER_ERROR`, `NOT_FOUND`). CORS allows any origin and echoes the
requested headers.

Environment variables: `AD_PORT` (3001), `AD_HOST`, `AD_UPLOAD_DIR`, `AD_FAIL_RATE` (0..1, chunk POSTs
only, seeded by `AD_SEED`), `AD_FAIL_STATUS` (status of random failures, default 500; 429 to test
`Retry-After`), `AD_FAIL_RETRY_AFTER` (seconds), `AD_LATENCY_MS`, `AD_LATENCY_JITTER_MS`, `AD_AUTO_ASSEMBLE`,
`AD_MAX_FILE_MB`, `AD_MAX_BODY_MB`, `AD_STRICT_MANIFEST` (1: chunks and finalize for an uploadId that is not in the session's latest manifest get `400 INVALID_CHUNK`, decision 0016), `AD_LOG`.

Forced failures (deterministic): `POST /__config` with
`{ "failRules": [{ "where": "chunk", "relativePath": "a/b.bin", "chunkIndex": 2, "status": 500, "times": 1 }] }`.
`where` is `chunk` (default), `status`, `manifest` or `finalize`; omit `times` to fail every match. Add `"retryAfter": 3` with status 429 or 503 to send a
`Retry-After` header.

Protocol v1.4 behaviour (v1.1 to v1.4 additions): the same manifest may be sent repeatedly; a known `uploadId` may arrive under a
new `sessionId` (the file is assembled into the session of its last chunk, `GET /__report` has a
`merged` tree across sessions); chunk status returns `complete: true` after assembly; finalize is
idempotent; `uploadMultiple` requests (`file[0]`, `adRelativePath[0]`, ...) are stored as whole files.

Notes: the request body is fully read before the server decides to fail, so browsers never see a
reset connection from an early reply. A chunk whose client disconnected during the simulated latency
is not committed (logged as `client-aborted-before-commit`). The server listens on all interfaces,
so a phone on the same network can use `http://<your-lan-ip>:3001` for real-device checks.
