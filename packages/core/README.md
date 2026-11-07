# @vedratech/anydrop-core

Headless engine for AnyDrop: folder-first, chunked, resumable uploads, configured like Dropzone.js. No runtime dependencies, no DOM rendering, safe to import during server-side rendering (nothing touches `window` or `document` at import time).

Reading input (drop, paste, file and folder inputs), validation, the folder tree, chunked and whole-file uploads, retry with backoff, manifest and finalize, pause and resume at three levels, resume after a reload (IndexedDB), automatic pausing when the browser is offline, the page is hidden or the server cannot be reached, and a persistent error list all live here. It talks to your backend through the [backend contract](https://github.com/vedratech/anydrop/blob/main/docs/protocol.md). The UI is in [`@vedratech/anydrop-ui`](https://github.com/vedratech/anydrop/blob/main/packages/ui/README.md); coming from Dropzone? See the [migration guide](https://github.com/vedratech/anydrop/blob/main/docs/migrating-from-dropzone.md).

```sh
npm install @vedratech/anydrop-core
```

Or from a CDN (pin the minor version; the global is `AnyDropCore`):

```html
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-core@0.1"></script>
<script>
  const core = new AnyDropCore.AnyDropCore({ url: '/upload' });
</script>
```

```ts
import { AnyDropCore } from '@vedratech/anydrop-core';

const core = new AnyDropCore({
  url: '/upload',
  acceptedFiles: 'image/*,.pdf',
  maxFilesize: 2048, // MiB
  chunking: true,
  chunkSize: 5 * 1024 * 1024,
  sendManifest: true,
  manifestUrl: '/upload/manifest',
  finalizeUrl: '/upload/finalize',
});

const off = core.on('addedfolder', (folder) => console.log('new folder', folder.path));
core.on('addedfiles', (files) => console.log(files.length, 'files in this batch'));
core.on('folderprogress', (folder, pct) => console.log(folder.path, Math.round(pct), '%'));
core.on('error', (file, message) => console.warn(file.relativePath, message));
core.on('queuecomplete', () => console.log('all done', core.getErrors()));

dropZone.addEventListener('dragover', (e) => e.preventDefault());
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  core.drop(e); // call synchronously: the browser clears the dropped items afterwards
});
folderInput.addEventListener('change', () => {
  core.addFromInput(folderInput); // <input type="file" webkitdirectory>
  folderInput.value = '';
});

const tree = core.getTree(); // live folder tree
off(); // remove one listener
core.destroy(); // remove everything
```

## Core concepts

- **The file object is the native `File`** with properties added (`id`, `relativePath`, `fullPath`, `fingerprint`, `folder`, `status`, `accepted`, `upload`), exactly like Dropzone. You can pass it to `FormData`, `FileReader` or `URL.createObjectURL`.
- **Batches.** Everything added by one user action (a drop, a paste, an input selection), or by `addFile()`/`addFiles()` calls in the same tick, is one batch. Per batch: every file emits `addedfile` and is validated; when the walk and every `accept()` callback are done, `addedfiles(files)` fires once, then accepted files are queued (`autoQueue`).
- **Folders are nodes.** The tree has a virtual root (`path: ''`) holding top-level folders and loose files. Folders are unique by path, so dropping `Photos` twice merges into one node. Every node keeps status counters, byte totals, a rolled-up `status` and `progress`, updated incrementally (O(depth) per change).
- **Empty folders are kept** (`preserveEmptyFolders`). A folder whose only files were ignored hidden files (such as `.gitkeep`) counts as empty. Browsers do not report empty folders through `<input webkitdirectory>`, only through drops. Empty folders reach the server **only through the manifest** (`sendManifest`).
- **Uploading.** Queued files start in add order. `parallelUploads` counts files uploading at once (as in Dropzone). Each uploading file sends one chunk at a time, or up to `parallelChunkUploads` chunks; `maxChunksInFlight` optionally caps all upload requests of the instance, shared round-robin. With `sendManifest`, a batch's manifest is sent right before its first file and must succeed before any of its files is sent. After the last chunk of a file, the finalize request (or your `chunksUploaded` hook) runs. The wire format is the AnyDrop upload protocol ([backend contract v1.4](https://github.com/vedratech/anydrop/blob/main/docs/protocol.md)): Dropzone's `dz*` chunk fields plus `adRelativePath` and `adSessionId` (`adSessionId[i]` per file in an `uploadMultiple` request).
- **Retries.** Failed chunk, manifest, chunk-status and finalize requests are retried (`retryChunks`, default `true`) up to `retryChunksLimit` times, after `random(0.5..1) × min(30 s, 1 s × 2^(n-1))` or the server's `Retry-After` (seconds, at most 60 s). Network errors, timeouts, 408, 429 and 5xx are retried; 401/403 and other 4xx are not. Whole-file uploads (no chunking) are never retried automatically. When a file finally fails it emits `error` once and gets one entry in `getErrors()`.
- **Pause and resume.** `pause()`, `pauseFolder(path)` and `pauseFile(file)` set user flags on the instance, a folder or a file; `resume*()` clears only its own flag, so a file in a paused folder stays paused until the folder is resumed. Offline and hidden-page pauses are separate system flags: coming back online never undoes your pause, and `resume()` clears everything. A paused file gives up its upload slot (with `pauseMode: 'abort'` at once, with `'finishChunk'` once its chunk in flight is done), keeps its place in the add order, and sends only the chunks the server has not acknowledged when it resumes.
- **Resume after a reload.** With `persistState` (default), each chunked file's acknowledged chunks are saved in IndexedDB (database `anydrop`, keyed by `persistKey` and `relativePath|size|lastModified`), in one write about every 250 ms and at once when the page is hidden. Dropping or picking the same files again after a reload resumes them with their old uploadId and skips finished files (`success` with `upload.skipped = true`). With `chunkStatusUrl`, the server is asked first and its answer wins. Records expire after 7 days. If IndexedDB is missing, throws, is blocked or does not answer within 1.5 s (private mode, some iOS versions), core warns once and keeps the state in memory: an upload never waits for it. A file that was uploaded completely in this page session or an earlier one and is dropped again is skipped (`success` with `upload.skipped`) when the server confirms it (`chunkStatusUrl`), or without asking when there is none; call `clearPersistedState()` or remove the file first to upload it again on purpose.
- **Lifecycle.** From the first `processQueue()`, core listens to `online`/`offline`, `visibilitychange`, `pagehide` and `pageshow` (removed by `destroy()`). Offline pauses; online resumes (`autoResumeOnReconnect`). A hidden tab keeps uploading; if a request then fails with a network error or timeout (how iOS suspension shows), the upload pauses instead of using up retries, and resumes when the page is visible again (`autoPauseOnHidden`). `pagehide` pauses at once. A failure while offline also becomes a pause: it uses no retry and makes no error entry. Chrome reports a lost connection as a failed request just before the `offline` event, so a network error waits one second for that event before it is judged. **Lost connection ("lie-fi").** When the browser says it is online but requests get no answer at all (captive portal, DNS, an unreachable server), core counts consecutive failures without any HTTP response (network error, `timeout`, stall). Only a response, of any status, resets the count. The third in a row pauses the instance as `unreachable`: that failure and every later one uses no retry and makes no error entry, and nothing is lost. Core then probes with growing delays (`random(0.5, 1) x min(60 s, 2 s x 2^(n-1))`, no attempt limit): `HEAD connectivityProbeUrl`, else `GET chunkStatusUrl` for the failed file, else the failed request itself. Any response ends the pause (`resumed` with `reason: 'unreachable'`). `online`, the page becoming visible and `reconnect()` probe at once. 5xx, 429 and 408 are responses: they use retries as before and never count. A request that can never succeed while the server answers still ends in `error` after its retries. **Stalls.** A request with no upload progress for `stallTimeout` (30 s), or without a response 4 x `stallTimeout` after its body was sent, is aborted and retried as `STALLED`; the check compares timestamps, so a throttled background tab cannot hide a stall. **Offline at start.** `processQueue()` while `navigator.onLine` is `false` pauses `offline` at once (a `paused` event, no `offline` event). Manifest, status and finalize requests follow the same rules and never fail a batch or a file.
- **Memory.** Files are only read with `Blob.slice()`, one chunk per request; a file is never loaded whole.

## Options

Pass options to the constructor, change them later with `setOption(name, value)`. Dropzone options keep Dropzone 6.3.5's names, types and defaults unless noted.

### Validation and input

| Option | Type | Default | Description |
|---|---|---|---|
| `acceptedFiles` | `string \| null` | `null` | Comma-separated list in the `accept` attribute syntax: `.ext`, `type/*`, `type/subtype`. Example: `'image/*,.pdf'`. When a file has an empty MIME type (iOS HEIC photos), the type is guessed from its extension first. |
| `maxFilesize` | `number \| null` | `256` | Maximum size in MiB. `null` or `0` disables the check. Example: `maxFilesize: 2048`. |
| `maxFiles` | `number \| null` | `null` | Maximum number of accepted files. Extra files are rejected and emit `maxfilesexceeded`. Example: `maxFiles: 10`. |
| `accept` | `(file, done) => void` | calls `done()` | Your own check, called after the built-in ones with `this` = the instance. `done()` accepts, `done(message)` rejects (code `REJECTED`). May be asynchronous; the batch waits for it. Example: `accept(file, done) { file.size === 0 ? done('Empty file') : done(); }` |
| `ignoreHiddenFiles` | `boolean` | `true` | Skip files whose name starts with `.` inside dropped or picked folders (loose files and hidden folders are not skipped, as in Dropzone). |
| `renameFile` | `((file) => string) \| null` | `null` | Name sent to the server (`file.upload.filename`); changes only the last segment of the sent path. `relativePath` and `fingerprint` keep the original name. Example: `renameFile: (f) => f.name.toLowerCase()`. |
| `filesizeBase` | `number` | `1000` | Base used by `filesize()`. Example: `1024`. |
| `folders` | `boolean` | `true` | Accept dropped folders (and, in `@vedratech/anydrop-ui`, show the folder picker where supported). When `false`, dropped folders are skipped. |
| `preserveEmptyFolders` | `boolean` | `true` | Keep empty folders in the tree and list them in the manifest. |

### Queue

| Option | Type | Default | Description |
|---|---|---|---|
| `autoQueue` | `boolean` | `true` | Queue accepted files when their batch closes. With `false`, files stay `added` until `enqueueFile()`. |
| `autoProcessQueue` | `boolean` | `true` | Call `processQueue()` after each batch and after each finished file. With `false`, every `processQueue()` call starts up to `parallelUploads` files once, as in Dropzone. |

### Requests and chunking

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string \| (files, dataBlocks) => string \| null` | `null` | Upload URL. A function gets the files and Dropzone's data blocks `[{ name, data, filename, chunkIndex? }]`, with `this` = the instance. Without a URL nothing is uploaded (files stay `queued`); setting one later with `setOption('url', …)` starts the queue. Example: `'/upload'`. |
| `method` | `string \| (files, dataBlocks) => string` | `'post'` | HTTP method, upper-cased (as in Dropzone). Example: `'put'`. |
| `withCredentials` | `boolean` | `false` | Send cookies cross-origin. |
| `timeout` | `number \| null \| (files) => number \| null` | `null` | Request timeout in ms; `null` = none. A timeout fails with code `TIMEOUT` and is retried like a network error. Example: `30000`. |
| `headers` | `Record<string, string> \| null` | `null` | Extra headers on every request (uploads, manifest, status, finalize). Empty values are not sent. Example: `{ Authorization: 'Bearer …' }`. |
| `defaultHeaders` | `boolean` | `true` | Send Dropzone's `Accept: application/json`, `Cache-Control: no-cache` and `X-Requested-With: XMLHttpRequest`. |
| `params` | `object \| (files, xhr, chunk) => object \| null` | `null` | Extra form fields, merged over the built-in `dz*`/`ad*` fields; a `null` value drops a built-in field, so you can rename it. `this` = the instance; `chunk` is `{ file, index, start, end, retries }` or `null`. Example: `params: (files, xhr, chunk) => ({ dzuuid: null, uploadId: files[0].upload.uuid })`. |
| `paramName` | `string \| (n) => string` | `'file'` | Form field of the file (`file[0]`, `file[1]`, … with `uploadMultiple`). |
| `uploadMultiple` | `boolean` | `false` | Up to the free `parallelUploads` slots of queued files per request, from any batch whose manifest is done (as Dropzone's `processQueue()`), with indexed fields (`file[0]`, `adRelativePath[0]`, `adSessionId[0]`, …); the `*multiple` events fire once per request. Not with `chunking` (the constructor throws). |
| `binaryBody` | `boolean` | `false` | Send the file (or chunk) as the raw body with `Content-Type` = the file type; no form fields. With `chunking` this means **no `dz*` metadata** reaches the server (use `headers`/`sending` to send your own). Not with `uploadMultiple` (the constructor throws). |
| `parallelUploads` | `number` | `2` | Files uploading at once (a file holds its slot from `processing` to `complete`). |
| `parallelChunkUploads` | `boolean \| number` | `false` | Chunks of one file in flight: `false` = 1, `true` = `parallelUploads`, a number = that many (at least 1, `Infinity` = all), as in Dropzone 6.3.5. |
| `maxChunksInFlight` | `number \| null` | `null` | Optional cap on upload requests in flight across the instance, shared round-robin across files; `null` = no cap (then at most `parallelUploads × parallelChunkUploads`). Example: `4`. |
| `chunking` | `boolean` | `false` | Split files larger than `chunkSize` into chunks. |
| `forceChunking` | `boolean` | `false` | Chunk files smaller than `chunkSize` too (a zero-byte file is one empty chunk). |
| `chunkSize` | `number` | `2097152` (2 MiB) | Chunk size in bytes, fixed per file when its first chunk is sent (`file.upload.chunkSize`), so changing it later never moves the offsets of a file that started (the server may already hold an aborted chunk). Example: `5 * 1024 * 1024`. |
| `retryChunks` | `boolean` | `true` | Retry failed chunk, manifest, status and finalize requests with backoff (Dropzone default: `false`). Whole-file uploads are never retried automatically. |
| `retryChunksLimit` | `number` | `3` | Retries per request (so at most 4 attempts). |
| `chunksUploaded` | `(file, done, instance) => void \| null` | `null` | Replaces the built-in finalize request. `this` = the options (Dropzone). `done()` (with any value that is not an `Error` or non-empty string) succeeds; `done(new Error('…'))` or `done('message')`, or throwing, fails the file with `FINALIZE_FAILED`. Example: `chunksUploaded(file, done) { fetch('/merge?id=' + file.upload.uuid).then(() => done(), done); }` |
| `transformFile` | `(file, done) => void \| null` | `null` | Called when the file starts processing; pass the blob to upload to `done(blob)`. Chunk info (`upload.total`, `chunked`, `totalChunkCount`) is computed from that blob, so the values set when the file is added are provisional. The blob is kept for pause, resume and retries in this session. When it returns a different blob, that file gets no chunk-level resume across reloads (a re-encoded image may differ byte for byte): a restored state is dropped and the file starts under a new uploadId. A file passed through unchanged (`done(file)`) keeps resume. Finished files are always skipped. Throwing fails the file with `TRANSFORM_FAILED`. |
| `transport` | `Transport \| null` | `null` | Sends the requests; `null` = the built-in XMLHttpRequest transport. See [Transport](#transport). |
| `sendManifest` | `boolean` | `false` | Send the folder manifest (needs `manifestUrl`) right before a batch's first file. Files of the batch wait for it; if it fails after retries, they fail with `stage: 'manifest'`. Empty folders stay `queued` until it succeeds. |
| `manifestUrl` | `string \| null` | `null` | `POST` target of the manifest. Example: `'/upload/manifest'`. |
| `finalizeUrl` | `string \| null` | `null` | `POST` target of the finalize request after the last chunk of a chunked file. Without it (and without `chunksUploaded`), the file succeeds after its last chunk. |
| `chunkStatusUrl` | `string \| null` | `null` | `GET ?uploadId=` that returns the chunks the server has. Asked only for files being resumed (a stored record, a resume or retry after the file ran, or a `409 CHUNK_MISMATCH`), never for fresh files. The server's answer wins; a `404` restarts the file with a new uploadId (and, with `sendManifest`, the batch manifest is sent again with it first, protocol v1.3); `complete: true` lets a file finished in an earlier session be skipped. Without it, a `409` is not retried: the file fails with `CHUNK_MISMATCH`. Non-chunked uploads carry no uploadId on the wire, so with this option a finished non-chunked file is uploaded again after a reload (use `forceChunking` if that matters). |

### Pause, resume and persistence

| Option | Type | Default | Description |
|---|---|---|---|
| `pauseMode` | `'abort' \| 'finishChunk'` | `'abort'` | What a pause does to requests in flight: abort them (the chunk is sent again in full later) or let them finish and count (a whole file then finishes). Example: `pauseMode: 'finishChunk'`. |
| `persistState` | `boolean` | `true` | Save acknowledged chunks and finished files in IndexedDB, so a reload resumes. `false` turns all of it off. |
| `persistKey` | `string \| null` | `null` | Scope of saved progress; `null` = `url` when it is a string, else `'default'`. Include the user id in apps with logins, so one account never resumes another's upload. Example: `persistKey: 'user-42'`. |
| `autoPauseOnHidden` | `boolean` | `true` | Pause on `pagehide`, and when a request fails while the page is hidden (iOS). A hidden desktop tab keeps uploading. |
| `autoResumeOnReconnect` | `boolean` | `true` | Resume when the browser comes back online, and probe by itself while the connection is lost (`unreachable`). With `false`, nothing resumes or probes automatically: call `reconnect()` or `resume()`. |
| `stallTimeout` | `number \| null` | `30000` | Milliseconds without upload progress while a request body is sent (or four times that while waiting for the response once it is sent) before the request is aborted and retried as `STALLED`. `null` turns the watchdog off; it runs only while requests are in flight. A backend that assembles a very large file on the last chunk should use `finalizeUrl`, or a higher value. Custom transports must call `onProgress`. Example: `stallTimeout: 60000`. |
| `connectivityProbeUrl` | `string \| null` | `null` | `HEAD` target used to probe while the connection is lost. Any HTTP status counts as reachable (`204` and `Cache-Control: no-store` recommended; enable CORS if it is cross-origin). Without it core probes with `chunkStatusUrl`, or with the failed request itself, which then keeps the instance waiting while that request cannot succeed: set it. Example: `connectivityProbeUrl: '/upload/ping'`. |

### Messages

| Option | Default |
|---|---|
| `dictFileTooBig` | `'File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.'` |
| `dictInvalidFileType` | `"You can't upload files of this type."` |
| `dictMaxFilesExceeded` | `'You cannot upload any more files.'` (`{{maxFiles}}` is replaced) |
| `dictResponseError` | `'Server responded with {{statusCode}} code.'`: the `error` message when the response has no body |
| `dictUploadCanceled` | `'Upload canceled.'` (shown by `@vedratech/anydrop-ui`; core emits no `error` on cancel) |
| `dictFileUnreadable` | `'The file could not be read (not downloaded, moved or deleted).'`: code `UNREADABLE`, for example an iCloud placeholder |
| `dictInvalidPath` | `'Invalid file path.'`: code `INVALID_PATH`, a path with a `..` segment |
| `dictFileSizeUnits` | `{ tb: 'TB', gb: 'GB', mb: 'MB', kb: 'KB', b: 'b' }` (a partial object is merged) |

### Event handlers as options

As in Dropzone, any event name can be given as an option: `new AnyDropCore({ addedfile(file) { … } })`. The handler runs with `this` = the instance. `setOption('addedfile', fn)` replaces it, `setOption('addedfile', null)` removes it.

## Methods

| Method | Returns | Description |
|---|---|---|
| `drop(event)` | `Promise<AnyDropFile[]>` | Handles a `drop` event: emits `drop`, reads files and folders (`webkitGetAsEntry`, `readEntries()` called until it returns nothing), resolves after `addedfiles`. Call it synchronously from the listener. |
| `paste(event)` | `Promise<AnyDropFile[]>` | Handles a `paste` event: emits `paste`, adds pasted files. Text-only pastes add nothing. |
| `addDataTransfer(dataTransfer)` | `Promise<AnyDropFile[]>` | Like `drop()`, without the `drop` event. |
| `addFromInput(input)` | `Promise<AnyDropFile[]>` | Adds the files of `<input type="file">` or `<input webkitdirectory>` (paths from `webkitRelativePath`), a `FileList` or an array. Large selections are read in slices of 500 so the page stays responsive. Example: `core.addFromInput(input.files)`. |
| `addFile(file, folderPath?)` | `AnyDropFile` | Adds one file. `folderPath` puts it in a folder: `core.addFile(file, 'Photos/2024')`. Without it, a non-empty `webkitRelativePath` is used. Calls in the same tick form one batch. Adding the same `File` again returns it unchanged. |
| `addFiles(files)` | `AnyDropFile[]` | Adds several files (one batch). |
| `getTree()` | `FolderNode` | The virtual root folder. Live object: read it, do not change it. |
| `getFolder(path)` | `FolderNode \| undefined` | Folder by path: `core.getFolder('Photos/2024')`. |
| `getFile(id)` | `AnyDropFile \| undefined` | File by `file.id`. |
| `files` | `AnyDropFile[]` | Every file, in add order (Dropzone's `files`). Do not modify. |
| `getAcceptedFiles()`, `getRejectedFiles()` | `AnyDropFile[]` | By `file.accepted`. |
| `getFilesWithStatus(status)` | `AnyDropFile[]` | By status. |
| `getAddedFiles()`, `getQueuedFiles()`, `getUploadingFiles()`, `getPausedFiles()` | `AnyDropFile[]` | By status (`getUploadingFiles()` excludes paused files). |
| `getActiveFiles()` | `AnyDropFile[]` | Files `queued`, `uploading` or `paused`. |
| `enqueueFile(file)`, `enqueueFiles(files)` | `void` | Queue added, accepted files (with `autoQueue: false`). Throws for other files, like Dropzone. |
| `processQueue()` | `void` | Starts queued files, in add order, until `parallelUploads` files are uploading. Called while a batch is still being read, it runs again when that batch closes, so `core.addFile(f); core.processQueue()` works with `autoProcessQueue: false`. |
| `processFile(file)`, `processFiles(files)` | `void` | Start these `queued` files now, even beyond `parallelUploads` (Dropzone). With `uploadMultiple`, files of one batch share a request. Example: `core.processFile(file)`. |
| `uploadFile(file)`, `uploadFiles(files)` | `void` | Aliases of `processFile(s)`. Overriding them changes nothing; use `transport`. |
| `cancelUpload(file)` | `void` | Cancels a file that is not finished: aborts its requests, status `canceled`, then `canceled` and `complete` (no `error`). With `uploadMultiple`, every file of the same request is canceled. |
| `disable()`, `enable()` | `void` | `disable()` sets `disabled = true` and cancels every file (Dropzone); adding files still works. `enable()` clears the flag. |
| `resolveOption(option, ...args)` | value | Calls a function option with `this` = the instance, else returns it (Dropzone). Example: `core.resolveOption(core.options.url, files)`. |
| `removeFile(file)` | `void` | Removes a file from the instance and the tree; folders left empty are removed too, unless they were dropped empty. Emits `removedfile`, then `reset` when no file is left. |
| `removeAllFiles(cancelIfNecessary = false)` | `void` | Removes every file that is not uploading (or every file when `true`), then every folder left without files, including folders dropped empty (`removedfolder` each). |
| `getErrors()` | `ErrorEntry[]` | A copy of the error list: one entry per file currently in `error`. |
| `clearErrors()` | `void` | Empties the error list; the files stay in `error`. |
| `exportErrors(format = 'json')` | `string` | The error list as `'json'` or `'csv'` (RFC 4180, CRLF). In CSV, text cells that start with `=`, `+`, `-`, `@`, a tab or a CR get a `'` prefix, so a spreadsheet never runs a file name or server message as a formula (numbers are untouched). Example: `download(core.exportErrors('csv'))`. |
| `retryFailedOnly(folderPath?)` | `number` | Re-queues the failed files (under `folderPath`, or all) except validation rejections, and returns how many. Done chunks are kept; with `chunkStatusUrl` the server is asked first; a failed batch manifest is sent again with the same `sessionId`, which also recovers its empty folders. Example: `core.retryFailedOnly('Photos/2024')`. |
| `retryFile(file \| id)` | `boolean` | Re-queues one failed file like `retryFailedOnly`; returns whether it did. |
| `pause()`, `resume()` | `void` | Pause every file / clear the instance pause and every system reason (offline, hidden, unreachable). Folder and file pauses stay. Emits `paused` / `resumed` once per call. A failure right after `resume()` while the connection is still lost pauses again without using a retry. |
| `reconnect()` | `void` | "Retry now": probes at once while the state is `unreachable` and lifts an `offline` pause the browser no longer reports. Does nothing when online. Unlike `resume()` it keeps the pauses the user made. Example: `retryButton.onclick = () => core.reconnect()`. |
| `getConnectionState()` | `ConnectionState` (`{ state, attempt, retryAt }`) | `state` is `'online'`, `'offline'` or `'unreachable'`; `attempt` is the probe number (0 when online) and `retryAt` the `Date.now()` time of the next probe, or `null`. Lets a UI show the right banner on mount. Example: `core.getConnectionState().state === 'unreachable'`. |
| `pauseFolder(path)`, `resumeFolder(path)` | `void` | Pause every file under a folder (also files added to it later) / clear that folder's own pause. Unknown paths are ignored. Example: `core.pauseFolder('Photos/2024')`. |
| `pauseFile(file \| id)`, `resumeFile(file \| id)` | `void` | Pause one file / clear its own pause (a paused folder or instance still holds it). |
| `cancelFolder(path)` | `void` | Cancels every unfinished file under a folder (`canceled` and `complete` per file), then `foldercomplete`. The files keep their tree rows. |
| `clearPersistedState()` | `Promise<void>` | Deletes this `persistKey`'s saved progress, for a "start over" button. Files already in the list stop writing records (they do not come back); call it while idle if you want a clean slate. Works after `destroy()` (it opens a fresh connection) and does nothing with `persistState: false`. Example: `await core.clearPersistedState()`. |
| `filesize(bytes)` | `string` | Dropzone's size text: `core.filesize(1500000)` → `'<strong>1.5</strong> MB'`. |
| `setOption(name, value)` | `void` | Changes an option at runtime. Throws for combinations Dropzone rejects. Example: `core.setOption('maxFiles', 5)`. |
| `getOption(name)` | value | Reads an option. |
| `on(event, fn)` | `Unsubscribe` | Adds a listener and returns a function that removes it. The function also has `on` and `once`, so `core.on('a', f).on('b', g)` chains as in Dropzone (`off` is not chainable). Does nothing after `destroy()`. |
| `once(event, fn)` | `Unsubscribe` | Listener that runs once. |
| `off(event?, fn?)` | `this` | `off()` removes every listener, `off(event)` every listener of that event, `off(event, fn)` one listener (also one added with `once`). |
| `emit(event, ...args)` | `this` | Emits an event (as in Dropzone). |
| `hasListeners(event)` | `boolean` | Whether anyone listens. |
| `destroy()` | `void` | Aborts every request, ends walks, removes every listener and timer, and empties the instance. Emits nothing. Later `addFile()` calls throw; `drop()` resolves with `[]`. |
| `disabled` | `boolean` | Set by `disable()`. |
| `isDestroyed` | `boolean` | Whether `destroy()` was called. |

Statics and exports: `AnyDropCore.ADDED`, `QUEUED`, `ACCEPTED` (= `QUEUED`), `UPLOADING`, `PROCESSING` (= `UPLOADING`), `PAUSED`, `SUCCESS`, `ERROR`, `CANCELED`; `AnyDropCore.isValidFile(file, acceptedFiles)`; `AnyDropCore.uuidv4()`; `AnyDropCore.version`. The same constants, `isValidFile`, `uuidv4`, `defaultOptions()`, `xhrTransport` and every public type are named exports of `@vedratech/anydrop-core`.

Deprecated Dropzone options are mapped as Dropzone 6.3.5 does: `renameFilename(name, file)` becomes `renameFile`, `acceptedMimeTypes` is copied to `acceptedFiles` (setting both throws).

## Events

Listeners run with `this` = the instance. A listener that throws is reported (through `reportError`) without stopping other listeners.

| Event | Arguments | When |
|---|---|---|
| `drop` | `(event)` | `drop()` was called with a `dataTransfer`. |
| `paste` | `(event)` | `paste()` was called with `clipboardData.items`. |
| `addedfolder` | `(folder: FolderNode)` | Once per new folder node, during the walk; parents before children, and before the folder's first `addedfile`. Not for merged folders or the root. |
| `addedfile` | `(file)` | Each added file, before validation finishes. |
| `emptyfolder` | `(path: string)` | A dropped directory has no entries at all (Dropzone 6.3). Fires even with `preserveEmptyFolders: false`. |
| `error` | `(file, message, xhr?)` | A file was rejected, or its upload finally failed (once, after any retries). `message` is the Dropzone message, what your `accept()` passed, the parsed JSON error body, or a string. Followed by `complete`. |
| `errormultiple` | `(files, message, xhr?)` | Only with `uploadMultiple`: once per failed request (or once for a single rejected file), after the `error` event of each file. |
| `processing` | `(file)` | A file starts uploading (status `uploading`). With `uploadMultiple` also `processingmultiple(files)`. |
| `sending` | `(file, xhr, formData?)` | Before each request body is sent; add fields to `formData` here (the file blob is appended after). `formData` is absent with `binaryBody`. Also `sendingmultiple(files, xhr, formData?)`. |
| `uploadprogress` | `(file, progress, bytesSent)` | Each progress event of a request (not throttled). Progress can go down when a request is aborted. |
| `totaluploadprogress` | `(progress, totalBytes, totalBytesSent)` | After each `uploadprogress` and `removedfile`, over files `queued`, `uploading` or `paused` (100 when there are none). |
| `folderprogress` | `(folder, progress, bytesSent)` | For every ancestor folder of a file that made progress (not the root), throttled to one event per folder per 100 ms, always sent at 100. |
| `success` | `(file, response, null)` | A file is uploaded. `response` is the finalize response when one was sent, else the last upload response. Also `successmultiple(files, response, null)`. |
| `complete` | `(file)` | A file is finished: uploaded, failed, rejected or canceled. Also `completemultiple(files)` with `uploadMultiple`. |
| `queuecomplete` | `()` | After a `complete` (deferred by `setTimeout 0`), when no file is added, queued, uploading or paused, no batch is still being read and no manifest is in flight. At most once per run (a run starts when a file enters `processing`), so `queuecomplete() { this.removeAllFiles(); }` fires once; removing the last unfinished file of a run ends it. Also after a drop where every file was rejected. |
| `maxfilesexceeded` | `(file)` | A file was rejected because of `maxFiles` (after its `error` and `complete`). |
| `maxfilesreached` | `(files)` | A check found exactly `maxFiles` accepted files (as in Dropzone, it can repeat). |
| `addedfiles` | `(files)` | Once per batch, after the walk and validation, with every file of the batch (accepted and rejected). |
| `foldercomplete` | `(folder)` | Every file in the folder is finished, or an empty folder reached `success`. Innermost folder first; can fire again later. |
| `canceled` | `(file)` | `cancelUpload()` canceled a file (no `error` follows). Also `canceledmultiple(files)` with `uploadMultiple`. |
| `removedfile` | `(file)` | `removeFile()` / `removeAllFiles()`. Afterwards `foldercomplete` is checked again for the remaining ancestors. |
| `removedfolder` | `(folder)` | A folder was pruned from the tree because its last file was removed; deepest first, right after that `removedfile`. Not on `destroy()`. |
| `reset` | `()` | The last file was removed. |
| `errorlistchanged` | `(errors: ErrorEntry[])` | The error list changed. A copy; merged to one event per microtask (5,000 rejections fire once). |
| `paused` | `(target)` | Once per `pause*()` call or automatic pause, after the files changed status. `target` is `{ scope: 'all', reason: 'user' \| 'offline' \| 'hidden' \| 'unreachable' }`, `{ scope: 'folder', folder, reason: 'user' }` or `{ scope: 'file', file, reason: 'user' }`. |
| `resumed` | `(target)` | Same shape, once per `resume*()` call or automatic resume (`reason: 'offline'` when back online, `'hidden'` when visible again, `'unreachable'` when the server answered a probe). |
| `offline`, `online` | `()` | The browser events, whatever the auto-resume settings are; `offline` comes before `paused`. Starting while offline emits `paused` only. |
| `reconnecting` | `(attempt, delayMs)` | While the connection is lost: before each wait until the next probe (`attempt` counts from 1). Example: `core.on('reconnecting', (n, ms) => show('Retrying in ' + Math.round(ms / 1000) + ' s'))`. |

Emitted by `@vedratech/anydrop-ui`: `dragstart`, `dragend`, `dragenter`, `dragover`, `dragleave`, `thumbnail`.

Order for one uploaded file: `processing`, then per request `sending` and `uploadprogress`, then `success`, `complete`, `foldercomplete` (innermost folder first), and `queuecomplete` after the last file.

## Error codes

`ErrorEntry.code` is typed `ErrorCode` (`KnownErrorCode | (string & {})`, both exported): the codes below autocomplete, and a backend may send any other string in its JSON error body (`{ code, message }`). Every entry has a `stage`: `validate`, `manifest`, `status`, `upload` or `finalize`.

| Code | Meaning | Retried automatically |
|---|---|---|
| `NETWORK` | No response (also an abort core did not start, for example your code calling `file.xhr.abort()`) | yes |
| `TIMEOUT` | The `timeout` option elapsed | yes |
| `STALLED` | Aborted by the stall watchdog (`stallTimeout`) | yes |
| `SERVER_ERROR` | 5xx, 408 or 429 without a code in the body | yes |
| `HTTP_ERROR` | Other 4xx without a code in the body | no |
| `AUTH` | 401 or 403 | no |
| `TOO_LARGE` | 413, from the server | no |
| `INVALID_PATH` | A path with a `..` segment (also sent by a server) | no |
| `INVALID_CHUNK` | The server rejected a chunk (400) | no |
| `CHUNK_MISMATCH` | 409; without `chunkStatusUrl` the file fails with it | no |
| `REJECTED_SIZE`, `REJECTED_TYPE`, `MAX_FILES` | Validation: `maxFilesize`, `acceptedFiles`, `maxFiles` | no |
| `REJECTED` | Your `accept()` callback rejected the file | no |
| `FINALIZE_FAILED` | `chunksUploaded` reported an error or threw | no |
| `UNREADABLE` | The file can no longer be read (for example an iCloud placeholder that is not downloaded; shown with `dictFileUnreadable`) | no |
| `TRANSFORM_FAILED` | `transformFile` threw | no |
| `REQUEST_SETUP_FAILED` | Something threw while a request was built or handed to the transport (your `url`, `method`, `timeout`, `params` or `paramName` function, `xhr.open`, `setRequestHeader`, a custom transport); reported with `reportError`; `retryFailedOnly()` tries again | no |

Offline, hidden-page and lost-connection (`unreachable`) failures never become entries: they pause. A 4xx/5xx status is a response, so it never counts as a lost connection.

## Transport

Requests go through a transport with one method, so S3, tus or fetch adapters can replace the built-in XMLHttpRequest one (XHR is used because `fetch` has no upload progress):

```ts
import { AnyDropCore, xhrTransport, type Transport } from '@vedratech/anydrop-core';

const logging: Transport = {
  send(request) {
    // request: { method, url, headers, body, timeout, withCredentials, beforeSend? }
    const handle = xhrTransport.send(request); // { abort(), onProgress?, promise }
    handle.promise.then((res) => console.log(request.url, res.status)); // { status, body, header(name), error? }
    return handle;
  },
};
new AnyDropCore({ url: '/upload', transport: logging });
```

The transport receives **every** request core makes, not only uploads: chunk and file uploads (`FormData` or `Blob` body), the manifest and finalize requests (`POST`, JSON string body, `Content-Type: application/json`), the chunk-status request (`GET`, no body) and the connectivity probe (`HEAD`, or `GET` for the `chunkStatusUrl` fallback, no body, 10 s timeout). The transport must handle `HEAD` and `GET` with `body: null`, and must resolve with whatever HTTP status arrives: any status, even 4xx or 5xx, means "the server is reachable"; only a failure with no status counts as no response. Branch on `request.url` or `request.method` if your adapter should only handle uploads, and pass the rest to `xhrTransport`.

A transport must call `request.beforeSend(native)` once, right before it sends the body, **when it is present**: only upload requests have it (core runs `params()`, emits `sending` and appends the file there). The manifest, status, finalize and probe requests have no `beforeSend`, so call it as `request.beforeSend?.(native)`. For the same reason, headers or credentials added inside `beforeSend` (or in the `sending` event) reach uploads only: put authentication in the `headers` option and `withCredentials`, which every request uses. A transport must also call `handle.onProgress(loaded, total)` while the body uploads, and always resolve `promise`: with `error: 'network' | 'timeout' | 'abort'` and `status: 0` when no response arrived (core itself marks a request it aborted for stalling as `'stalled'`). `body` is the parsed JSON when the response is JSON.

## Types

```ts
type FileStatus = 'added' | 'queued' | 'uploading' | 'paused' | 'success' | 'error' | 'canceled';

interface AnyDropFile extends File {
  readonly id: string; // UUID v4, never changes
  readonly relativePath: string; // 'Photos/2024/a.jpg', or 'a.jpg' for a loose file
  readonly fullPath?: string; // only for files from folders (as in Dropzone)
  readonly fingerprint: string; // 'relativePath|size|lastModified'
  readonly folder: FolderNode;
  status: FileStatus;
  accepted?: boolean;
  upload: { uuid: string; filename: string; progress: number; total: number; bytesSent: number;
            chunked: boolean; chunkSize: number; totalChunkCount: number; chunksDone: Set<number>;
            resumed?: boolean; // state came from IndexedDB or chunkStatusUrl
            skipped?: boolean }; // finished in an earlier session, nothing sent
}

interface FolderNode {
  readonly path: string; // '' for the root
  readonly name: string;
  readonly parent: FolderNode | null;
  readonly depth: number; // root = 0
  readonly children: readonly FolderNode[];
  readonly files: readonly AnyDropFile[];
  readonly status: FileStatus; // rolled up from the files below
  readonly progress: number; // 0-100, bytes-weighted over accepted, non-canceled files
  readonly bytesTotal: number;
  readonly bytesSent: number;
  readonly counts: { total; added; queued; uploading; paused; success; error; canceled };
  readonly userPaused: boolean;
}

type PauseReason = 'user' | 'offline' | 'hidden' | 'unreachable';

interface ConnectionState { // getConnectionState()
  state: 'online' | 'offline' | 'unreachable';
  attempt: number; // probe number, 0 when online
  retryAt: number | null; // Date.now() time of the next probe
}

type ErrorCode = KnownErrorCode | (string & {}); // see Error codes

interface DataBlock { name: string; data: Blob; filename: string; chunkIndex?: number } // url()/method()

interface ErrorEntry {
  fileId: string | null; relativePath: string; uploadId: string | null;
  code: string; // see Error codes
  message: string; httpStatus?: number;
  stage: 'validate' | 'manifest' | 'status' | 'upload' | 'finalize';
  chunkIndex?: number; attempt: number; retryable: boolean; at: number;
}
```

**Folder status roll-up:** when every file below is finished, the folder is `error` if any failed, else `canceled` if all were canceled, else `success`. Otherwise it is `uploading` if any file uploads, `paused` if the folder (or an ancestor, or everything) is paused or every unfinished file is paused, `queued` if any is queued, else `added`. An empty folder is `queued` until its batch is processed, then `success` (or `error` if its manifest fails). Rejected files stay in the tree as `error` but do not count in `bytesTotal`. Bytes count `upload.total`, the size actually sent (it differs from `file.size` only with `transformFile`).

## Subclass hooks

For `@vedratech/anydrop-ui` and other subclasses (protected, part of the typed API; do not shadow `tree`, `errors` or `unsubscribe`):

| Hook | Description |
|---|---|
| `_addFormElementData(formData)` | Dropzone's hook: called for every upload request with form data, after `sending` and before the file blobs are appended. Override it to add fields (the ui adds a `<form>` element's inputs). |
| `_completeExternal(file)` | Emits `complete` for a file outside the queue (a `displayExistingFile` mock file) and re-checks `queuecomplete` while a run is open. |

## Differences from Dropzone

In short: `on()` returns an unsubscribe function (chainable with `.on()`/`.once()`); files become `queued` when their batch closes, not inside `addFile()`; every batch (also `addFile()` and paste) fires `addedfiles`; `acceptedFiles` guesses an empty MIME type from the extension; listener exceptions are caught; `destroy()` emits nothing; `retryChunks` defaults to `true`; `params()` is merged over the built-in `dz*`/`ad*` fields instead of replacing them; `canceled` emits no `error`; without `url` nothing uploads (Dropzone throws); a path with `..`, or a `renameFile()` result with a separator, is rejected (`INVALID_PATH`); `uploadMultiple` requests send `adSessionId[i]` per file; files can be paused (status `paused`) and finished files are skipped after a reload (`success(file, { skipped: true, uploadId })`).
