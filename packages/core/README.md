# @vedratech/anydrop-core

Headless engine for AnyDrop: folder-first, chunked, resumable uploads, configured like Dropzone.js. No runtime dependencies, no DOM rendering, safe to import during server-side rendering (nothing touches `window` or `document` at import time).

It reads input (drop, paste, file and folder inputs), validates, builds the folder tree, uploads whole files or chunks with retry, sends a folder manifest, pauses and resumes at three levels, resumes after a reload (IndexedDB), pauses by itself when the browser is offline, the page is hidden or the server cannot be reached, and keeps a persistent error list. The UI is in [`@vedratech/anydrop-ui`](https://www.npmjs.com/package/@vedratech/anydrop-ui).

**Documentation: https://vedratech.github.io/anydrop/** ([guide](https://vedratech.github.io/anydrop/guide/headless-core), [API reference](https://vedratech.github.io/anydrop/api/), [backend contract](https://vedratech.github.io/anydrop/protocol), [live demo](https://vedratech.github.io/anydrop/demo))

## Install

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

## Example

With an element that receives drops and a folder input in your page:

```html
<div id="upload-area">Drop files or folders here</div>
<input id="folder-input" type="file" webkitdirectory />
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
core.on('folderprogress', (folder, pct) => console.log(folder.path, Math.round(pct), '%'));
core.on('error', (file, message) => console.warn(file.relativePath, message));
core.on('queuecomplete', () => console.log('all done', core.getErrors()));

const area = document.querySelector('#upload-area');
area.addEventListener('dragover', (e) => e.preventDefault());
area.addEventListener('drop', (e) => {
  e.preventDefault();
  core.drop(e); // call synchronously: the browser clears the dropped items afterwards
});

const folderInput = document.querySelector('#folder-input');
folderInput.addEventListener('change', () => {
  core.addFromInput(folderInput);
  folderInput.value = '';
});

const tree = core.getTree(); // live folder tree
off(); // remove one listener
core.destroy(); // remove everything
```

Dropzone options keep Dropzone 6.3.5's names, types and defaults unless noted. Change an option later with `core.setOption(name, value)`.

## Options

Types and defaults. Descriptions and examples: [Options reference](https://vedratech.github.io/anydrop/api/options).

### Request and queue

| Option | Type | Default |
|---|---|---|
| `url` | `string \| (files, dataBlocks) => string \| null` | `null` |
| `method` | `string \| (files, dataBlocks) => string` | `'post'` |
| `withCredentials` | `boolean` | `false` |
| `timeout` | `number \| null \| (files) => number \| null` | `null` |
| `headers` | `Record<string, string> \| null` | `null` |
| `defaultHeaders` | `boolean` | `true` |
| `params` | `object \| (files, xhr, chunk) => object \| null` | `null` |
| `paramName` | `string \| (n) => string` | `'file'` |
| `uploadMultiple` | `boolean` | `false` |
| `binaryBody` | `boolean` | `false` |
| `parallelUploads` | `number` | `2` |
| `maxChunksInFlight` | `number \| null` | `null` |
| `autoQueue` | `boolean` | `true` |
| `autoProcessQueue` | `boolean` | `true` |
| `transport` | `Transport \| null` | `null` |
| `transformFile` | `(file, done) => void \| null` | `null` |
| `renameFile` | `((file) => string) \| null` | `null` |

### Chunking

| Option | Type | Default |
|---|---|---|
| `chunking` | `boolean` | `false` |
| `forceChunking` | `boolean` | `false` |
| `chunkSize` | `number` | `2097152` (2 MiB) |
| `parallelChunkUploads` | `boolean \| number` | `false` |
| `retryChunks` | `boolean` | `true` |
| `retryChunksLimit` | `number` | `3` |
| `chunksUploaded` | `(file, done, instance) => void \| null` | `null` |
| `finalizeUrl` | `string \| null` | `null` |
| `chunkStatusUrl` | `string \| null` | `null` |

### Validation

| Option | Type | Default |
|---|---|---|
| `acceptedFiles` | `string \| null` | `null` |
| `maxFilesize` | `number \| null` | `256` |
| `maxFiles` | `number \| null` | `null` |
| `accept` | `(file, done) => void` | calls `done()` |
| `ignoreHiddenFiles` | `boolean` | `true` |
| `filesizeBase` | `number` | `1000` |

### Folders

| Option | Type | Default |
|---|---|---|
| `folders` | `boolean` | `true` |
| `preserveEmptyFolders` | `boolean` | `true` |
| `sendManifest` | `boolean` | `false` |
| `manifestUrl` | `string \| null` | `null` |

### Pause, resume and persistence

| Option | Type | Default |
|---|---|---|
| `pauseMode` | `'abort' \| 'finishChunk'` | `'abort'` |
| `persistState` | `boolean` | `true` |
| `persistKey` | `string \| null` | `null` |

### Connectivity

| Option | Type | Default |
|---|---|---|
| `autoPauseOnHidden` | `boolean` | `true` |
| `autoResumeOnReconnect` | `boolean` | `true` |
| `stallTimeout` | `number \| null` | `30000` |
| `connectivityProbeUrl` | `string \| null` | `null` |

### Messages

`dictFileTooBig`, `dictInvalidFileType`, `dictMaxFilesExceeded`, `dictResponseError`, `dictUploadCanceled`, `dictFileUnreadable`, `dictInvalidPath`, `dictFileSizeUnits`: the texts of validation and upload errors. Deprecated Dropzone names `renameFilename` and `acceptedMimeTypes` are mapped as Dropzone does. Any event name can also be passed as an option (`new AnyDropCore({ addedfile(file) { ... } })`).

## Methods

| Method | Description |
|---|---|
| `drop(event)` | Handles a `drop` event: emits `drop`, reads the files and folders (with `webkitGetAsEntry`, calling `readEntries()` until it returns nothing) and resolves after `addedfiles`. **Call it synchronously** from the listener, because the browser clears the dropped items afterwards |
| `paste(event)` | Handles a `paste` event: emits `paste` and adds pasted files |
| `addDataTransfer(dataTransfer)` | Like `drop()`, without emitting the `drop` event |
| `addFromInput(input)` | Adds the files of an `<input type="file">` or `<input webkitdirectory>` (paths come from `webkitRelativePath`), a `FileList` or an array |
| `addFile(file, folderPath?)` | Adds one file. `folderPath` puts it in a folder; without it a non-empty `webkitRelativePath` is used |
| `addFiles(files)` | Adds several files as one batch |
| `files` | Every file, in add order (Dropzone's `files`) |
| `getTree()` | The virtual root folder (`path: ''`) |
| `getFolder(path)` | A folder by path |
| `getFile(id)` | A file by its `file.id` |
| `getAcceptedFiles()` and `getRejectedFiles()` | Files by `file.accepted` |
| `getFilesWithStatus(status)` | Files with one status: `'added'`, `'queued'`, `'uploading'`, `'paused'`, `'success'`, `'error'` or `'canceled'` |
| `getAddedFiles()`, `getQueuedFiles()`, `getUploadingFiles()` and `getPausedFiles()` | Files by status. `getUploadingFiles()` excludes paused files |
| `getActiveFiles()` | Files that are `queued`, `uploading` or `paused` |
| `filesize(bytes)` | Dropzone's size text, using `filesizeBase` and `dictFileSizeUnits` |
| `enqueueFile(file)` and `enqueueFiles(files)` | Queue added, accepted files (needed with `autoQueue: false`) |
| `processQueue()` | Starts queued files in add order until `parallelUploads` files are uploading |
| `processFile(file)` and `processFiles(files)` | Start these `queued` files now, even beyond `parallelUploads` (as Dropzone does) |
| `uploadFile(file)` and `uploadFiles(files)` | Aliases of `processFile(s)` |
| `cancelUpload(file)` | Cancels a file that is not finished: aborts its requests, sets the status `canceled`, then emits `canceled` and `complete` (no `error`) |
| `cancelFolder(path)` | Cancels every unfinished file under a folder (`canceled` and `complete` for each), then emits `foldercomplete` |
| `removeFile(file)` | Removes a file from the instance and the tree |
| `removeAllFiles(cancelIfNecessary = false)` | Removes every file that is not uploading (or every file with `true`), then every folder left without files, including folders dropped empty |
| `disable()` and `enable()` | `disable()` sets `disabled` to `true` and cancels every file; adding files still works. `enable()` clears the flag |
| `disabled` | Set by `disable()` |
| `pause()` and `resume()` | `pause()` pauses every file. `resume()` clears the instance pause and every system reason (offline, hidden, unreachable); folder and file pauses stay |
| `pauseFolder(path)` and `resumeFolder(path)` | Pause every file under a folder (also files added to it later), and clear that folder's own pause |
| `pauseFile(file | id)` and `resumeFile(file | id)` | Pause one file, and clear its own pause |
| `reconnect()` | "Retry now": probes at once while the connection is `unreachable`, and lifts an `offline` pause the browser no longer reports |
| `getConnectionState()` | Returns `{ state, attempt, retryAt }`. `state` is `'online'`, `'offline'` or `'unreachable'`; `attempt` is the probe number (0 when online) and `retryAt` the `Date.now()` time of the next probe, or `null` |
| `getErrors()` | A copy of the error list: one entry per file currently in `error` |
| `clearErrors()` | Empties the error list |
| `exportErrors(format = 'json')` | The error list as `'json'` or `'csv'` (RFC 4180, CRLF) |
| `retryFailedOnly(folderPath?)` | Re-queues the failed files (all, or under `folderPath`), except validation rejections, and returns how many |
| `retryFile(file | id)` | Re-queues one failed file like `retryFailedOnly` |
| `clearPersistedState()` | Deletes this `persistKey`'s saved progress, for a "start over" button |
| `options` | The resolved options object |
| `setOption(name, value)` | Changes an option at runtime |
| `getOption(name)` | Reads an option |
| `resolveOption(option, ...args)` | Calls a function option with `this` set to the instance, otherwise returns the value (Dropzone's `resolveOption`) |
| `on(event, fn)` | Adds a listener and returns a function that removes it |
| `once(event, fn)` | A listener that runs once |
| `off(event?, fn?)` | `off()` removes every listener, `off(event)` every listener of that event, `off(event, fn)` one listener (also one added with `once`) |
| `emit(event, ...args)` | Emits an event, as in Dropzone |
| `hasListeners(event)` | Whether anyone listens to the event |
| `destroy()` | Aborts every request, ends folder walks, removes every listener and timer, and empties the instance |
| `isDestroyed` | Whether `destroy()` was called |

Statics and exports: `AnyDropCore.ADDED`, `QUEUED`, `ACCEPTED`, `UPLOADING`, `PROCESSING`, `PAUSED`, `SUCCESS`, `ERROR`, `CANCELED`, `isValidFile`, `uuidv4`, `version`; named exports `defaultOptions()`, `xhrTransport`, `VERSION` and every public type. Details and examples: [Methods reference](https://vedratech.github.io/anydrop/api/methods).

## Events

| Event | Arguments | Description |
|---|---|---|
| `drop` | `(event: DragEvent)` | `drop()` was called with a `dataTransfer` |
| `paste` | `(event: ClipboardEvent)` | `paste()` was called with `clipboardData.items` |
| `dragstart`, `dragenter`, `dragover`, `dragleave` and `dragend` | `(event: DragEvent)` | Drag events over the element, as in Dropzone |
| `addedfile` | `(file: AnyDropFile)` | Each added file, before its validation has finished |
| `addedfiles` | `(files: AnyDropFile[])` | Once per batch, after the walk and validation, with every file of the batch (accepted and rejected) |
| `emptyfolder` | `(path: string)` | A dropped directory has no entries at all |
| `removedfile` | `(file: AnyDropFile)` | `removeFile()` or `removeAllFiles()` removed a file |
| `reset` | `()` | The last file was removed |
| `thumbnail` | `(file: AnyDropFile, dataUrl: string)` | A thumbnail was created for an accepted image |
| `maxfilesexceeded` | `(file: AnyDropFile)` | A file was rejected because of `maxFiles` (after its `error` and `complete`) |
| `maxfilesreached` | `(files: AnyDropFile[])` | A check found exactly `maxFiles` accepted files |
| `processing` | `(file: AnyDropFile)` | A file starts uploading (its status becomes `uploading`) |
| `processingmultiple` | `(files: AnyDropFile[])` | Only with `uploadMultiple`: a request with these files started |
| `sending` | `(file: AnyDropFile, xhr: XMLHttpRequest, formData?: FormData)` | Before each request body is sent |
| `sendingmultiple` | `(files: AnyDropFile[], xhr: XMLHttpRequest, formData?: FormData)` | Only with `uploadMultiple`: before a request body is sent |
| `uploadprogress` | `(file: AnyDropFile, progress: number, bytesSent: number)` | Each progress event of a request, not throttled. `progress` is 0 to 100 |
| `totaluploadprogress` | `(progress: number, totalBytes: number, totalBytesSent: number)` | Overall progress after each `uploadprogress` and `removedfile`, over the files that are `queued`, `uploading` or `paused` |
| `success` | `(file: AnyDropFile, response: unknown, e: null)` | A file is uploaded. `response` is the finalize response when one was sent, else the last upload response (parsed JSON when the server sent JSON) |
| `successmultiple` | `(files: AnyDropFile[], response: unknown, e: null)` | Only with `uploadMultiple`: once per successful request |
| `complete` | `(file: AnyDropFile)` | A file is finished: uploaded, failed, rejected or canceled |
| `completemultiple` | `(files: AnyDropFile[])` | Only with `uploadMultiple`: once per finished request |
| `canceled` | `(file: AnyDropFile)` | `cancelUpload()` canceled a file |
| `canceledmultiple` | `(files: AnyDropFile[])` | Only with `uploadMultiple`: the files of a canceled request |
| `queuecomplete` | `()` | After a `complete` (deferred by `setTimeout` 0), when no file is added, queued, uploading or paused, no batch is still being read and no manifest is in flight |
| `addedfolder` | `(folder: FolderNode)` | Once per new folder node, during the walk |
| `removedfolder` | `(folder: FolderNode)` | A folder was removed from the tree because its last file was removed |
| `folderprogress` | `(folder: FolderNode, progress: number, bytesSent: number)` | For every ancestor folder of a file that made progress (not the root), throttled to one event per folder per 100 ms, and always sent at 100 |
| `foldercomplete` | `(folder: FolderNode)` | Every file in the folder is finished, or an empty folder reached `success` |
| `paused` | `(target: PauseTarget)` | Once per `pause*()` call or automatic pause, after the files changed status. `target` is `{ scope: 'all', reason }` with reason `'user'`, `'offline'`, `'hidden'` or `'unreachable'`, or `{ scope: 'folder', folder, reason: 'user' }`, or `{ scope: 'file', file, reason: 'user' }` |
| `resumed` | `(target: PauseTarget)` | The same shape, once per `resume*()` call or automatic resume (`reason: 'offline'` when back online, `'hidden'` when the page is visible again, `'unreachable'` when the server answered a probe) |
| `offline` | `()` | The browser's `offline` event, whatever the auto-resume settings are |
| `online` | `()` | The browser's `online` event |
| `reconnecting` | `(attempt: number, delayMs: number)` | While the connection is lost, before each wait until the next probe. `attempt` counts from 1 |
| `error` | `(file: AnyDropFile, message: unknown, xhr?: XMLHttpRequest)` | A file was rejected, or its upload finally failed (once, after any retries). `message` is the Dropzone message, what your `accept()` passed, the parsed JSON error body, or a string |
| `errormultiple` | `(files: AnyDropFile[], message: unknown, xhr?: XMLHttpRequest)` | Only with `uploadMultiple`: once per failed request (or once for a single rejected file), after the `error` event of each file |
| `errorlistchanged` | `(errors: ErrorEntry[])` | The error list changed |

Order for one uploaded file: `processing`, then per request `sending` and `uploadprogress`, then `success`, `complete`, `foldercomplete`, and `queuecomplete` after the last file. Events marked (UI) are emitted by `@vedratech/anydrop-ui`. [Events reference](https://vedratech.github.io/anydrop/api/events).

## Error codes

`NETWORK`, `TIMEOUT`, `STALLED`, `SERVER_ERROR`, `HTTP_ERROR`, `AUTH`, `TOO_LARGE`, `INVALID_PATH`, `INVALID_CHUNK`, `CHUNK_MISMATCH`, `REJECTED_SIZE`, `REJECTED_TYPE`, `MAX_FILES`, `REJECTED`, `FINALIZE_FAILED`, `UNREADABLE`, `TRANSFORM_FAILED`, `REQUEST_SETUP_FAILED`. What each means and which are retried: [Error codes](https://vedratech.github.io/anydrop/api/error-codes).

## Transport

Every request goes through a transport with one method, so S3, tus or fetch adapters can replace the built-in XMLHttpRequest one:

```ts
import { AnyDropCore, xhrTransport, type Transport } from '@vedratech/anydrop-core';

const logging: Transport = {
  send(request) {
    const handle = xhrTransport.send(request); // { abort(), onProgress?, promise }
    handle.promise.then((res) => console.log(request.url, res.status));
    return handle;
  },
};
new AnyDropCore({ url: '/upload', transport: logging });
```

The rules a transport must follow are in the [custom transport guide](https://vedratech.github.io/anydrop/guide/custom-transport).

## Documentation

Everything is on the website: **https://vedratech.github.io/anydrop/**

- [Guide](https://vedratech.github.io/anydrop/guide/introduction) and [quick start](https://vedratech.github.io/anydrop/guide/quick-start)
- [API reference](https://vedratech.github.io/anydrop/api/): [options](https://vedratech.github.io/anydrop/api/options), [methods](https://vedratech.github.io/anydrop/api/methods), [events](https://vedratech.github.io/anydrop/api/events), [error codes](https://vedratech.github.io/anydrop/api/error-codes), [types](https://vedratech.github.io/anydrop/api/types)
- [Backend contract](https://vedratech.github.io/anydrop/protocol), with [Express](https://vedratech.github.io/anydrop/backend/express) and [Laravel](https://vedratech.github.io/anydrop/backend/laravel) examples
- [Migrating from Dropzone](https://vedratech.github.io/anydrop/migrating-from-dropzone)
- [Live demo](https://vedratech.github.io/anydrop/demo)
- [Size comparison](https://vedratech.github.io/anydrop/size-comparison)

## License

MIT © 2026 Jayesh Gupta. Parts adapted from Dropzone (MIT) are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
