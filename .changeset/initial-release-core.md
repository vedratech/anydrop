---
'@vedratech/anydrop-core': minor
---

Initial release of the headless upload engine, configured like Dropzone.js (same option names, events and `dz*` chunk fields) with folders as first-class objects.

- Input: drops of files and folders together (including empty folders), pastes, and file and folder inputs, each file with its relative path. A live folder tree with status and progress per folder.
- Validation like Dropzone 6.3.5: `acceptedFiles`, `maxFilesize`, `maxFiles`, `ignoreHiddenFiles`, `accept()`.
- Uploads: whole files or chunks (`Blob.slice()`, a file is never read whole), `parallelUploads`, `parallelChunkUploads`, `maxChunksInFlight`, retry with exponential backoff and `Retry-After`, `uploadMultiple`, `binaryBody`, `transformFile`, and a pluggable `transport`.
- Folder manifest (`sendManifest`, `manifestUrl`), finalize (`finalizeUrl` or a `chunksUploaded` hook) and chunk status (`chunkStatusUrl`) for resuming.
- Pause and resume for everything, a folder or a single file; resume after a reload (IndexedDB, with a memory fallback) and after network loss.
- Bad connections: uploads pause when the browser is offline, the tab is hidden or the server cannot be reached (`stallTimeout`, `connectivityProbeUrl`, `reconnect()`, `getConnectionState()`), probe with growing delays and resume by themselves.
- A persistent error list with a reason per file: `getErrors()`, `retryFailedOnly()`, `retryFile()`, `exportErrors()` as JSON or CSV.
- Safe for server-side rendering; `on()` returns an unsubscribe function and `destroy()` cleans up everything. ESM, CJS and IIFE builds with TypeScript types.

The backend contract is published in `docs/protocol.md` (protocol v1.4).
