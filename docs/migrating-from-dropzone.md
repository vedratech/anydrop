# Migrating from Dropzone

AnyDrop is configured like Dropzone.js (version 6.3.5): in most pages you replace `Dropzone` with `AnyDrop` and keep your options, events and markup. This page lists what stays the same, what is new, and every place where AnyDrop behaves differently on purpose.

## Quick switch

```html
<!-- before -->
<script src="https://unpkg.com/dropzone@6.3.5/dist/dropzone-min.js"></script>
<link rel="stylesheet" href="https://unpkg.com/dropzone@6.3.5/dist/dropzone.css" />

<!-- after -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>
```

```js
// before
const dz = new Dropzone('#uploader', { url: '/upload', chunking: true });
// after
const ad = new AnyDrop('#uploader', { url: '/upload', chunking: true });
```

With npm: `npm install @vedratech/anydrop-ui @vedratech/anydrop-core`, then `import { AnyDrop } from '@vedratech/anydrop-ui'` and `import '@vedratech/anydrop-ui/style.css'`.

- `window.AnyDrop` (CDN build) is the class itself, like `window.Dropzone`. `AnyDrop.options.myId = {...}`, `AnyDrop.forElement(el)`, `AnyDrop.instances` and `element.dropzone` work.
- Auto-discovery: the CDN build attaches to `.dropzone` and `.anydrop` elements after the page loads, like Dropzone; set `AnyDrop.autoDiscover = false` to stop it. The npm builds never do this on import (safe for server-side rendering): call `AnyDrop.discover()`.
- Dropzone's own `dropzone.css` is not needed. Dropzone's `dz-*` classes and the `data-dz-*` hooks of `previewTemplate` are kept (also as `ad-*`), so your template and your CSS keep working.
- DOM events: AnyDrop dispatches `anydrop:<event>` where Dropzone dispatches `dropzone:<event>`.

## What stays the same

**Options** (same name, type and default unless the table below says otherwise): `url`, `method`, `withCredentials`, `timeout`, `headers`, `defaultHeaders`, `binaryBody`, `params`, `paramName`, `uploadMultiple`, `parallelUploads`, `chunking`, `forceChunking`, `chunkSize`, `parallelChunkUploads`, `retryChunks`, `retryChunksLimit`, `chunksUploaded`, `transformFile`, `maxFilesize`, `filesizeBase`, `maxFiles`, `acceptedFiles`, `accept`, `ignoreHiddenFiles`, `renameFile`, `autoProcessQueue`, `autoQueue`, `clickable`, `previewsContainer`, `previewTemplate`, `hiddenInputContainer`, `addRemoveLinks`, `capture`, `createImageThumbnails`, `maxThumbnailFilesize`, `thumbnailWidth`, `thumbnailHeight`, `thumbnailMethod`, `resize*`, `disablePreviews`, `forceFallback`, `fallback`, `init` and every `dict*` text. The deprecated `renameFilename` and `acceptedMimeTypes` are mapped as Dropzone does.

**Events:** `drop`, `dragstart`, `dragend`, `dragenter`, `dragover`, `dragleave`, `paste`, `reset`, `addedfile`, `addedfiles`, `removedfile`, `thumbnail`, `error`, `errormultiple`, `processing`, `processingmultiple`, `uploadprogress`, `totaluploadprogress`, `sending`, `sendingmultiple`, `success`, `successmultiple`, `canceled`, `canceledmultiple`, `complete`, `completemultiple`, `maxfilesexceeded`, `maxfilesreached`, `queuecomplete`, `emptyfolder`. Handlers passed as options run with `this` = the instance.

**Methods:** `processQueue`, `enqueueFile(s)`, `addFile`, `removeFile`, `removeAllFiles`, `cancelUpload`, `getAcceptedFiles`, `getRejectedFiles`, `getAddedFiles`, `getQueuedFiles`, `getUploadingFiles`, `getActiveFiles`, `getFilesWithStatus`, `processFile(s)`, `uploadFile(s)`, `resolveOption`, `disable`, `enable`, `displayExistingFile`, `destroy`, `on`, `off`, `emit`, `filesize`, `drop`, `paste`, `files`, and the statics (status constants, `isValidFile`, `uuidv4`, `version`).

**Backend:** the chunk fields are Dropzone's (`dzuuid`, `dzchunkindex`, `dztotalchunkcount`, `dzchunksize`, `dzchunkbyteoffset`, `dztotalfilesize`), so an existing Dropzone chunk backend keeps working. AnyDrop adds `adRelativePath` and `adSessionId` fields to every request; ignore them if you do not need folders. See the [backend contract](protocol.md).

## What is new

| Kind | Name | What it does |
|---|---|---|
| option | `folders`, `preserveEmptyFolders`, `folderView` | Folder drops and the folder picker, empty folders kept, `'tree'` or `'flat'` list |
| option | `sendManifest`, `manifestUrl` | Send the folder structure (including empty folders) before the first file |
| option | `chunkStatusUrl`, `finalizeUrl` | Resume from the chunks the server has; assemble the file after the last chunk |
| option | `pauseMode`, `persistState`, `persistKey` | Pause behaviour and resume after a reload (IndexedDB) |
| option | `autoPauseOnHidden`, `autoResumeOnReconnect`, `stallTimeout`, `connectivityProbeUrl`, `maxChunksInFlight` | Offline, hidden-tab and lost-connection handling; request cap |
| option | `transport` | Replace the XMLHttpRequest transport (S3, tus, fetch adapters) |
| option (ui) | `rowHeight`, `toolbar`, `errorPanel`, `pickerButtons`, `enablePaste`, `theme` | Interface options |
| method | `pause`, `resume`, `pauseFolder`, `resumeFolder`, `pauseFile`, `resumeFile`, `cancelFolder` | Pause and resume at three levels |
| method | `getErrors`, `retryFailedOnly`, `retryFile`, `clearErrors`, `exportErrors`, `clearPersistedState` | The persistent error list |
| method | `getTree`, `getFolder`, `getFile`, `getPausedFiles`, `addFiles`, `addFromInput`, `addDataTransfer`, `setOption`, `getOption`, `once`, `hasListeners`, `reconnect`, `getConnectionState` | Folder tree, input helpers, runtime options, connection state |
| event | `addedfolder`, `removedfolder`, `folderprogress`, `foldercomplete`, `paused`, `resumed`, `offline`, `online`, `reconnecting`, `errorlistchanged` | Folder and pause events |

`addFile(file, folderPath?)` takes an optional folder path. `drop()` and `paste()` return a promise.

## Intentional differences

| Difference | Reason |
|---|---|
| `retryChunks` defaults to `true` (Dropzone: `false`); non-chunked uploads are never auto-retried | protocol chunk writes are idempotent; reliability is a product goal; whole-file retries could duplicate data on old backends |
| `addedfiles(files)` fires once per batch after the walk and validation, also for `addFile()`/`addFiles()` batches and pastes | Dropzone 6.3.5 `drop()` also fires it after the walk with the added files (fixed upstream, so no difference there), but Dropzone never fires it for `addFile()` or paste. Every batch gets one, so the manifest and `addedfiles` line up |
| Accepted files stay `added` until their batch closes (a microtask for `addFile()`), then become `queued` | Dropzone queues inside `addFile()`. The batch must be complete before anything is queued |
| `acceptedFiles`: a file with an empty MIME type is matched using the type guessed from its extension | iOS gives HEIC photos an empty type, so Dropzone rejects them under `image/*`. Files with a MIME type behave exactly as in Dropzone |
| `on()`/`once()` return an unsubscribe function, not `this`. It carries bound `on` and `once`, so `.on().on()` chaining works; `.on().off()` does not | wrapper-ready API; `off` is left out because a bare `unsub.off()` would remove every listener |
| A removal re-checks `queuecomplete` only when the removed file was unfinished (`added`, `queued`, `paused`) during an open run; at most one `queuecomplete` per run | Dropzone never fires it from a removal; this only covers "the last pending file was removed" so the UI cannot hang |
| Auto-discover happens only in the CDN (IIFE) build, on `DOMContentLoaded` (or `setTimeout(0)` if the page has already loaded); ESM/CJS imports never auto-discover, call `AnyDrop.discover()` instead. Already-attached elements are skipped instead of throwing | importing the npm package must have no side effects (SSR, `sideEffects`); avoids Dropzone's double-attach error |
| `canceled` does not emit `error(file, dictUploadCanceled)` and creates no error entry; the ui shows `dictUploadCanceled` in the preview instead | cancel is not a failure; keeps `error` events, `getErrors()` and `retryFailedOnly()` consistent |
| `processQueue()`/`enqueueFile()` on files of a still-open batch are applied when the batch closes; `getQueuedFiles()` right after `addFile()` is still `[]` | batches close asynchronously |
| Overriding `uploadFiles` on an instance does not change how files are sent | use the request hook; `uploadFile(s)` are aliases of `processFile(s)` |
| `chunksUploaded` receives the instance as a third argument, and `done(Error \| string)` fails the file | Dropzone ignores `done`'s argument; only real errors count, so ported `done(response)` still succeeds |
| With `transformFile`, a transformed file is not chunk-resumed after a reload | the transform output may differ byte for byte between runs |
| `params` defaults to `null`; the `dz*` chunk fields and our `ad*` fields are built in, and what `params()` returns is merged over them (a `null`/`undefined` value drops a built-in field). Dropzone's `params` default builds the `dz*` fields, so a user `params()` replaces them | ported `params()` that return the `dz*` fields themselves still work (same keys, no duplicates); a `params()` that forgets them no longer breaks the chunk protocol |
| The `chunk` passed to `params(files, xhr, chunk)` is `{ file, index, start, end, retries }` (no `dataBlock`, `status`, `xhr`) | the engine keeps its own request state; `chunk.file` and `chunk.index` work as in Dropzone |
| `success(file, response, e)`: `e` is always `null` (Dropzone passes the XHR `load` event for whole-file uploads) | the transport interface does not expose native events |
| Core only: without `url`, `processQueue()` starts nothing and files stay `queued` (Dropzone throws `No URL provided.` in the constructor; the UI package throws it too, like Dropzone) | a headless core without a URL is useful for review-before-upload and tests |
| `totaluploadprogress` reports `100` when the active files hold 0 bytes (Dropzone: `NaN`) | zero-byte files |
| `queuecomplete` also waits for open batches, paused files and manifests in flight | the queue is not complete while a drop is still being read or its manifest is pending |
| With `sendManifest: true` but no `manifestUrl`, no manifest is sent | nothing to send it to; empty folders then complete like with `sendManifest: false` |
| A path with a `..` segment is rejected at validation (`INVALID_PATH`) | it could escape the upload folder on a careless backend |
| A listener that throws is reported (`reportError`) and the other listeners still run | Dropzone lets the exception escape `emit()`, which would stall a folder walk |
| `destroy()` emits no `removedfile`/`reset` events | wrappers call `destroy()` on unmount; the UI removes its own DOM |
| `chunksUploaded` defaults to `null` (Dropzone: a function calling `done()`) | lets core tell a user hook from the built-in finalize; same behaviour when `finalizeUrl` is not set |
| A folder holding only ignored hidden files (for example `.gitkeep`) is kept as an empty folder | folder-first: the structure survives. `emptyfolder` still fires only for folders with no entries at all, as in Dropzone |
| Files paused mid-upload have status `paused`, not `uploading`; `getActiveFiles()` includes them | Dropzone has no pause |
| A file that finished uploading and is dropped again (same path, size, lastModified, same `persistKey`) is skipped: `success(file, { skipped: true, uploadId })` instead of a second upload; the server is asked first when `chunkStatusUrl` is set | resume records remember finished files within a session and across reloads; `clearPersistedState()` or `persistState: false` restores Dropzone's behaviour |
| A chunk layout (`chunkSize`) is fixed when the file's first chunk is sent; a later `setOption('chunkSize')` only affects files that have not sent one | an aborted chunk may already be committed on the server, so offsets must not move |
| `exportErrors('csv')` prefixes text cells that start with `=`, `+`, `-`, `@`, tab or CR with `'` | CSV injection; Dropzone has no error export |
| ui: handlers passed as options (`success(file) {}`) add to the built-in rendering instead of replacing the default handler; `disablePreviews: true` hands rendering over | rows are derived from file state (virtualized), not from events; Dropzone replaces `Dropzone.prototype.defaultOptions.success` etc. |
| ui: `file.previewElement` / `previewTemplate` are lazy getters; elements user code read or assigned are kept, others of rows that scrolled away are dropped when the list has more than 400 rows | 5,000 files must not mean 5,000 DOM subtrees |
| ui: the `resize*` options install a default `transformFile` only when set, and a user `transformFile` wins | a transformed file is not chunk-resumed, because the transform may produce different bytes on each run |
| ui: `dict*` texts are rendered as text, not HTML; `enablePaste` is an option (default false); `resize(file, w, h, method)` and `resizeTransparencyFill` are not supported, a resize loses EXIF; `dictThumbnailError` is shown as screen-reader text and a tooltip | XSS safety; Dropzone 6.3.5 wires no paste; the resize pipeline is ours |
| ui: `AnyDrop.instances`, `element.dropzone` alias, `hiddenFileInput`, `AnyDrop.confirm` mirror Dropzone | wrappers and ported code |

## Checklist

1. Swap the script, the stylesheet and the constructor name.
2. Keep your options. Check the table above for `retryChunks` (on by default now) and handlers passed as options (they add to the built-in rendering; set `disablePreviews: true` to render yourself).
3. If you listened to `error` to detect a canceled upload, listen to `canceled` instead.
4. If your backend should see folders, set `sendManifest` and `manifestUrl`, and implement the manifest endpoint from the [backend contract](protocol.md).
5. Optional: `chunkStatusUrl` and `finalizeUrl` for resume and assembly.
