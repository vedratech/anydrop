# @vedratech/anydrop-core

## 0.1.0

### Minor Changes

- fc3c562: Core declares the `actionclicked` event type (`AnyDropEvents`) that the UI emits when a row action is used.
- 14b8838: Initial release of the headless upload engine, configured with plain options and events, with folders as first-class objects.
  
  - Input: drops of files and folders together (including empty folders), pastes, and file and folder inputs, each file with its relative path. A live folder tree with status and progress per folder.
  - Validation: `acceptedFiles`, `maxFilesize`, `maxFiles`, `ignoreHiddenFiles`, `accept()`.
  - Uploads: whole files or chunks (`Blob.slice()`, a file is never read whole), `parallelUploads`, `parallelChunkUploads`, `maxChunksInFlight`, retry with exponential backoff and `Retry-After`, `uploadMultiple`, `binaryBody`, `transformFile`, and a pluggable `transport`.
  - Folder manifest (`sendManifest`, `manifestUrl`), finalize (`finalizeUrl` or a `chunksUploaded` hook) and chunk status (`chunkStatusUrl`) for resuming.
  - Pause and resume for everything, a folder or a single file; resume after a reload (IndexedDB, with a memory fallback) and after network loss.
  - Bad connections: uploads pause when the browser is offline, the tab is hidden or the server cannot be reached (`stallTimeout`, `connectivityProbeUrl`, `reconnect()`, `getConnectionState()`), probe with growing delays and resume by themselves.
  - A persistent error list with a reason per file: `getErrors()`, `retryFailedOnly()`, `retryFile()`, `exportErrors()` as JSON or CSV.
  - Safe for server-side rendering; `on()` returns an unsubscribe function and `destroy()` cleans up everything. ESM, CJS and IIFE builds with TypeScript types.
  
  The backend contract is published in `docs/protocol.md` (protocol v2.0). The upload form fields are `adUploadId`, `adChunkIndex`, `adTotalSize`, `adChunkSize`, `adChunkCount` and `adChunkOffset`, next to `adRelativePath` and `adSessionId`.

### Patch Changes

- 80f081b: Documentation website at https://vedratech.github.io/anydrop/ (guide, API reference generated from the source, backend contract, live demo). The READMEs are shorter and link to it. Public types, options and events now have TSDoc comments; no behaviour change.
- 06e0654: Better package metadata for discovery: keyword-rich descriptions and more npm keywords, `homepage` points to the documentation site, and the READMEs have badges and a short size comparison with other upload libraries. No behaviour change.
