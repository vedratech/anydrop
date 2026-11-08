---
title: "Options reference"
description: "Every AnyDrop option with type, default and example: Dropzone-compatible core options plus folder, chunking, resume, connectivity and UI options."
---

# Options

Pass options to the constructor, and change them later with [`setOption(name, value)`](/api/methods#setoption-name-value). The core options come from `@vedratech/anydrop-core`; the UI options (and the texts) only exist in `@vedratech/anydrop-ui`, which accepts every core option as well.

Dropzone options keep Dropzone 6.3.5's names, types and defaults unless the description says otherwise. A function option runs with `this` set to the instance. The full TypeScript definitions are generated from the source: [`AnyDropCoreOptions`](/api/generated/anydrop-core/interfaces/AnyDropCoreOptions) and [`AnyDropUIOptions`](/api/generated/anydrop-ui/interfaces/AnyDropUIOptions).

```ts
import { AnyDrop } from '@vedratech/anydrop-ui';

const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  maxFilesize: 2048, // MiB
  acceptedFiles: 'image/*,.pdf',
});

ad.setOption('maxFiles', 10); // change it at runtime
```

Jump to: [Request and queue](#request-and-queue) / [Chunking](#chunking) / [Validation](#validation) / [Folders](#folders) / [Pause, resume and persistence](#pause-resume-and-persistence) / [Connectivity](#connectivity) / [UI](#ui) / [Texts](#texts) / [Event handlers as options](#event-handlers-as-options)

## Request and queue

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string \| (files, dataBlocks) => string \| null` | `null` | Upload URL. A function gets the files and Dropzone's data blocks `[{ name, data, filename, chunkIndex? }]`. Without a URL nothing is uploaded (files stay `queued`; the UI constructor throws `No URL provided.`); setting one later with `setOption('url', ...)` starts the queue. A `<form action>` can supply it in the UI. Example: `'/upload'`. |
| `method` | `string \| (files, dataBlocks) => string` | `'post'` | HTTP method, upper-cased. Example: `'put'`. |
| `withCredentials` | `boolean` | `false` | Send cookies on cross-origin requests. |
| `timeout` | `number \| null \| (files) => number \| null` | `null` | Request timeout in ms; `null` means none. A timeout fails with code `TIMEOUT` and is retried like a network error. Example: `30000`. |
| `headers` | `Record<string, string> \| null` | `null` | Extra headers on every request (uploads, manifest, status, finalize). Empty values are not sent. Example: `{ Authorization: 'Bearer ...' }`. |
| `defaultHeaders` | `boolean` | `true` | Send Dropzone's `Accept: application/json`, `Cache-Control: no-cache` and `X-Requested-With: XMLHttpRequest`. |
| `params` | `object \| (files, xhr, chunk) => object \| null` | `null` | Extra form fields, merged over the built-in `dz*` and `ad*` fields. A `null` value drops a built-in field, so you can rename it. `chunk` is `{ file, index, start, end, retries }` or `null`. Example: `params: (files, xhr, chunk) => ({ dzuuid: null, uploadId: files[0].upload.uuid })`. |
| `paramName` | `string \| (n) => string` | `'file'` | Form field of the file (`file[0]`, `file[1]`, ... with `uploadMultiple`). |
| `uploadMultiple` | `boolean` | `false` | Send several files in one request, with indexed fields (`file[0]`, `adRelativePath[0]`, ...). The `*multiple` events fire once per request. Cannot be combined with `chunking` (the constructor throws). |
| `binaryBody` | `boolean` | `false` | Send the file (or chunk) as the raw body with `Content-Type` set to the file type, and no form fields. With `chunking` that means no `dz*` metadata reaches the server. Cannot be combined with `uploadMultiple`. |
| `parallelUploads` | `number` | `2` | Files uploading at once. A file holds its slot from `processing` to `complete`. |
| `maxChunksInFlight` | `number \| null` | `null` | Optional cap on upload requests in flight across the instance, shared round-robin between files. `null` means no cap (then at most `parallelUploads` times `parallelChunkUploads`). Example: `4`. |
| `autoQueue` | `boolean` | `true` | Queue accepted files when their batch closes. With `false`, files stay `added` until you call `enqueueFile()`. |
| `autoProcessQueue` | `boolean` | `true` | Call `processQueue()` after each batch and after each finished file. With `false`, every `processQueue()` call starts up to `parallelUploads` files once. |
| `transport` | `Transport \| null` | `null` | Sends the requests. `null` means the built-in XMLHttpRequest transport. See [Custom transport](/guide/custom-transport). |
| `transformFile` | `(file, done) => void \| null` | `null` | Called when a file starts processing. Pass the blob to upload to `done(blob)`. Chunk info is computed from that blob. When it returns a different blob, that file gets no chunk-level resume across reloads; a file passed through unchanged (`done(file)`) keeps resume. Throwing fails the file with `TRANSFORM_FAILED`. |
| `renameFile` | `((file) => string) \| null` | `null` | Name sent to the server (`file.upload.filename`). Changes only the last segment of the sent path; `relativePath` and `fingerprint` keep the original name. Example: `renameFile: (f) => f.name.toLowerCase()`. |

## Chunking

| Option | Type | Default | Description |
|---|---|---|---|
| `chunking` | `boolean` | `false` | Split files larger than `chunkSize` into chunks. |
| `forceChunking` | `boolean` | `false` | Chunk files smaller than `chunkSize` too (a zero-byte file is one empty chunk). |
| `chunkSize` | `number` | `2097152` (2 MiB) | Chunk size in bytes. It is fixed per file when its first chunk is sent, so changing it later never moves the offsets of a file that already started. Example: `5 * 1024 * 1024`. |
| `parallelChunkUploads` | `boolean \| number` | `false` | Chunks of one file in flight: `false` means 1, `true` means `parallelUploads`, a number is that many (at least 1, `Infinity` for all). |
| `retryChunks` | `boolean` | `true` | Retry failed chunk, manifest, chunk-status and finalize requests with backoff. Dropzone's default is `false`. Whole-file uploads are never retried automatically. |
| `retryChunksLimit` | `number` | `3` | Retries per request, so at most 4 attempts. |
| `chunksUploaded` | `(file, done, instance) => void \| null` | `null` | Replaces the built-in finalize request. `this` is the options object, as in Dropzone. `done()` succeeds; `done(new Error('...'))`, `done('message')` or throwing fails the file with `FINALIZE_FAILED`. Example: `chunksUploaded(file, done) { fetch('/merge?id=' + file.upload.uuid).then(() => done(), done); }`. |
| `finalizeUrl` | `string \| null` | `null` | `POST` target of the finalize request after the last chunk of a chunked file. Without it (and without `chunksUploaded`) the file succeeds after its last chunk. |
| `chunkStatusUrl` | `string \| null` | `null` | `GET ?uploadId=` that returns the chunks the server already has. Asked only for files that are being resumed, never for fresh files. The server's answer wins; a `404` restarts the file with a new uploadId; `complete: true` lets a file finished in an earlier session be skipped. Without it, a `409` is not retried and the file fails with `CHUNK_MISMATCH`. |

## Validation

| Option | Type | Default | Description |
|---|---|---|---|
| `acceptedFiles` | `string \| null` | `null` | Comma-separated list in the `accept` attribute syntax: `.ext`, `type/*`, `type/subtype`. Example: `'image/*,.pdf'`. When a file has an empty MIME type (iOS HEIC photos), the type is guessed from its extension first. |
| `maxFilesize` | `number \| null` | `256` | Maximum size in MiB. `null` or `0` disables the check. Example: `2048`. |
| `maxFiles` | `number \| null` | `null` | Maximum number of accepted files. Extra files are rejected and emit `maxfilesexceeded`. Example: `10`. |
| `accept` | `(file, done) => void` | calls `done()` | Your own check, called after the built-in ones. `done()` accepts, `done(message)` rejects (code `REJECTED`). It may be asynchronous; the batch waits for it. Example: `accept(file, done) { file.size === 0 ? done('Empty file') : done(); }`. |
| `ignoreHiddenFiles` | `boolean` | `true` | Skip files whose name starts with `.` inside dropped or picked folders. Loose files and hidden folders are not skipped, as in Dropzone. |
| `filesizeBase` | `number` | `1000` | Base used by `filesize()`. Example: `1024`. |

## Folders

| Option | Type | Default | Description |
|---|---|---|---|
| `folders` | `boolean` | `true` | Accept dropped folders (and, in the UI, show the folder picker where the browser supports it). When `false`, dropped folders are skipped. |
| `preserveEmptyFolders` | `boolean` | `true` | Keep empty folders in the tree and list them in the manifest. |
| `sendManifest` | `boolean` | `false` | Send the folder manifest (needs `manifestUrl`) right before a batch's first file. The files of the batch wait for it; if it fails after its retries they fail with `stage: 'manifest'`. |
| `manifestUrl` | `string \| null` | `null` | `POST` target of the manifest. Example: `'/upload/manifest'`. |

## Pause, resume and persistence

| Option | Type | Default | Description |
|---|---|---|---|
| `pauseMode` | `'abort' \| 'finishChunk'` | `'abort'` | What a pause does to requests in flight: abort them (the chunk is sent again in full later) or let them finish and count. Example: `'finishChunk'`. |
| `persistState` | `boolean` | `true` | Save acknowledged chunks and finished files in IndexedDB so a reload can resume. `false` turns all of it off. |
| `persistKey` | `string \| null` | `null` | Scope of saved progress. `null` means `url` when it is a string, else `'default'`. Include the user id in apps with logins, so one account never resumes another's upload. Example: `'user-42'`. |

## Connectivity

| Option | Type | Default | Description |
|---|---|---|---|
| `autoPauseOnHidden` | `boolean` | `true` | Pause on `pagehide`, and when a request fails while the page is hidden (how iOS suspension shows). A hidden desktop tab keeps uploading. |
| `autoResumeOnReconnect` | `boolean` | `true` | Resume when the browser comes back online, and probe by itself while the connection is lost. With `false`, nothing resumes or probes automatically: call `reconnect()` or `resume()`. |
| `stallTimeout` | `number \| null` | `30000` | Milliseconds without upload progress while a request body is sent (or four times that while waiting for the response) before the request is aborted and retried as `STALLED`. `null` turns the watchdog off. Custom transports must call `onProgress`. Example: `60000`. |
| `connectivityProbeUrl` | `string \| null` | `null` | `HEAD` target used to probe while the connection is lost. Any HTTP status counts as reachable (`204` with `Cache-Control: no-store` is recommended; enable CORS if it is cross-origin). Without it, core probes with `chunkStatusUrl` or with the failed request itself. Example: `'/upload/ping'`. |

## UI

These options exist in `@vedratech/anydrop-ui` only.

| Option | Type | Default | Description |
|---|---|---|---|
| `clickable` | `boolean \| string \| HTMLElement \| (string \| HTMLElement)[]` | `true` | `true` (the element itself), `false`, a selector (every match), an element or an array. Clicking opens the file dialog. A selector that matches nothing throws. |
| `previewsContainer` | `string \| HTMLElement \| null \| false` | `null` | Where the toolbar, list and error panel go. `null` means inside the element; `false` means no previews. |
| `previewTemplate` | `string` | Dropzone's template | Markup of one file's preview. The `data-dz-name`, `data-dz-size`, `data-dz-thumbnail`, `data-dz-uploadprogress`, `data-dz-errormessage` and `data-dz-remove` hooks are filled in. |
| `hiddenInputContainer` | `string \| HTMLElement` | `'body'` | Where the hidden `<input type=file>` elements go. |
| `addRemoveLinks` | `boolean` | `false` | Add a "Remove file" or "Cancel upload" link to each preview. |
| `capture` | `string \| null` | `null` | Passed to the file input (`'environment'`, `'user'`) to open the camera. |
| `createImageThumbnails` | `boolean` | `true` | Create thumbnails for images. |
| `maxThumbnailFilesize` | `number` | `10` | MiB. Larger images get no thumbnail. |
| `thumbnailWidth` | `number \| null` | `120` | Thumbnail width in px, capped at 512. |
| `thumbnailHeight` | `number \| null` | `120` | Thumbnail height in px, capped at 512. Both `null` means natural size, still capped at 512 px. |
| `thumbnailMethod` | `'crop' \| 'contain'` | `'crop'` | How the image fits the thumbnail box. |
| `resizeWidth` | `number \| null` | `null` | Scale images down to this width before upload. |
| `resizeHeight` | `number \| null` | `null` | Scale images down to this height before upload. |
| `resizeMethod` | `'crop' \| 'contain'` | `'contain'` | How the image fits the resize box. |
| `resizeMimeType` | `string \| null` | `null` | MIME type of the resized image; `null` keeps the type. |
| `resizeQuality` | `number` | `0.8` | Encoder quality from 0 to 1. |
| `disablePreviews` | `boolean` | `false` | No preview elements, no list, no toolbar, no error panel. The zone and the pickers still work, and `thumbnail` events still fire. |
| `forceFallback` | `boolean` | `false` | Render a plain form with a file input, as Dropzone does, even when the browser supports everything. |
| `fallback` | `(() => void) \| null` | `null` | Runs when the browser lacks the needed APIs, or with `forceFallback`. `null` means the default form. |
| `init` | `(() => void) \| null` | `null` | Called at the end of the constructor, like Dropzone's `init`. |
| `folderView` | `'tree' \| 'flat'` | `'tree'` | A collapsible tree, or a flat list of files with their full path. Can be changed with `setOption`. |
| `rowHeight` | `number` | `56` | Row height in px of the virtualised list. Use a larger value for a taller `previewTemplate`. |
| `toolbar` | `boolean` | `true` | Show the toolbar. |
| `errorPanel` | `boolean` | `true` | Show the error panel when files failed. |
| `pickerButtons` | `boolean` | `true` | The "Select files" and "Select folder" buttons. They appear only when the element itself is clickable. |
| `enablePaste` | `boolean` | `false` | Add files pasted into the element. Off by default, as Dropzone 6.3.5 does not wire `paste` either. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `'auto'` follows `prefers-color-scheme`. |

## Texts

Every text is an option, so it can be translated. Texts are rendered as plain text, not HTML. A `{{name}}` placeholder is replaced by the value of that name. See [Customising the UI](/guide/customising-ui) for an example.

### Messages (core)

These come from `@vedratech/anydrop-core` and are used in `error` events and error entries.

| Option | Default | Description |
|---|---|---|
| `dictFileTooBig` | `'File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.'` | A file is larger than `maxFilesize`. |
| `dictInvalidFileType` | `"You can't upload files of this type."` | A file does not match `acceptedFiles`. |
| `dictMaxFilesExceeded` | `'You cannot upload any more files.'` | A file is rejected because of `maxFiles`. |
| `dictResponseError` | `'Server responded with {{statusCode}} code.'` | The `error` message when the response has no body. |
| `dictUploadCanceled` | `'Upload canceled.'` | Shown by the UI for a canceled file; core emits no `error` on cancel. |
| `dictFileUnreadable` | `'The file could not be read (not downloaded, moved or deleted).'` | Code `UNREADABLE`, for example an iCloud placeholder. |
| `dictInvalidPath` | `'Invalid file path.'` | Code `INVALID_PATH`: a path with a `..` segment. |
| `dictFileSizeUnits` | `{ tb: 'TB', gb: 'GB', mb: 'MB', kb: 'KB', b: 'b' }` | Unit labels of `filesize()`. A partial object is merged. |

### Interface texts (UI)

| Option | Default | Description |
|---|---|---|
| `dictDefaultMessage` | `Drop files here to upload` | Text of the drop zone. |
| `dictFallbackMessage` | `Your browser does not support drag'n'drop file uploads.` | Shown when the browser lacks drag and drop. |
| `dictFallbackText` | `Please use the fallback form below to upload your files like in the olden days.` | Shown above the fallback form. |
| `dictFallbackUpload` | `Upload!` | Button of the fallback form. |
| `dictCancelUpload` | `Cancel upload` | `addRemoveLinks` link while uploading. |
| `dictCancelUploadConfirmation` | `Are you sure you want to cancel this upload?` | Asked before canceling. |
| `dictRemoveFile` | `Remove file` | `addRemoveLinks` link when finished. |
| `dictRemoveFileConfirmation` | `null` | Question asked before removing a finished file, through `AnyDrop.confirm`. `null` means no question. |
| `dictThumbnailError` | `Failed to load the image. The file may be corrupted.` | Screen-reader text and tooltip. |
| `dictNoFolderSupport` | `This browser can only select files, not folders. Pick the files you need, or use a desktop browser to upload a whole folder.` | Notice where there is no folder picker (iOS). |
| `dictSelectFiles` | `Select files` | File picker button. |
| `dictSelectFolder` | `Select folder` | Folder picker button. |
| `dictTapToUpload` | `Tap to upload` | The zone on touch devices. |
| `dictPauseAll` | `Pause all` | Toolbar button. |
| `dictResumeAll` | `Resume all` | Toolbar button. |
| `dictRetryFailed` | `Retry failed` | Toolbar and error panel button. |
| `dictClear` | `Clear` | Toolbar button. |
| `dictPause` | `Pause` | Row button. |
| `dictResume` | `Resume` | Row button. |
| `dictRetry` | `Retry` | Row button. |
| `dictExpand` | `Expand folder` | Accessible name of the folder toggle. |
| `dictCollapse` | `Collapse folder` | Accessible name of the folder toggle. |
| `dictStatusAdded` | `Added` | Row status. |
| `dictStatusQueued` | `Queued` | Row status. |
| `dictStatusUploading` | `Uploading` | Row status. |
| `dictStatusPaused` | `Paused` | Row status. |
| `dictStatusSuccess` | `Done` | Row status. |
| `dictStatusError` | `Failed` | Row status. |
| `dictStatusCanceled` | `Canceled` | Row status. |
| `dictSummary` | `{{done}} of {{total}} uploaded, {{failed}} failed` | Toolbar summary. |
| `dictFolderCount` | `{{done}}/{{total}}` | Count on a folder row. |
| `dictErrorsTitle` | `{{count}} failed` | Title of the error panel. |
| `dictExportJson` | `Export JSON` | Error panel button. |
| `dictExportCsv` | `Export CSV` | Error panel button. |
| `dictCopyErrors` | `Copy list` | Error panel button. |
| `dictCopied` | `Copied to the clipboard.` | Message after copying. |
| `dictCopyFailed` | `Could not copy the list.` | Message when copying failed. |
| `dictDismissErrors` | `Dismiss list` | Error panel button. |
| `dictRegionLabel` | `File upload` | Accessible name of the zone. |
| `dictListLabel` | `Files to upload` | Accessible name of the list. |
| `dictToolbarLabel` | `Upload actions` | Accessible name of the toolbar. |
| `dictAnnounceAdded` | `{{count}} files added.` | Screen-reader message. |
| `dictAnnounceComplete` | `Upload complete.` | Screen-reader message. |
| `dictAnnounceErrors` | `{{count}} files failed.` | Screen-reader message. |
| `dictAnnounceProgress` | `Uploading, {{percent}} percent.` | Screen-reader message. |
| `dictAnnouncePaused` | `Upload paused.` | Screen-reader message. |
| `dictAnnounceResumed` | `Upload resumed.` | Screen-reader message. |
| `dictOffline` | `You are offline. Uploads will continue when you are back online.` | Connection banner, browser offline. |
| `dictReconnecting` | `Connection lost. Retrying in {{seconds}} s` | Connection banner, server unreachable. |
| `dictRetryNow` | `Retry now` | Banner button; calls `reconnect()`. |
| `dictConnectionRestored` | `Connection restored` | Announced when the banner hides. |
| `dictWaitingForConnection` | `Waiting for connection` | Row text instead of "Paused" while only the system holds the file. |

## Deprecated options

Dropzone's deprecated names are mapped as Dropzone 6.3.5 does.

| Option | Description |
|---|---|
| `renameFilename` | `(name, file) => newName`. Becomes `renameFile`. |
| `acceptedMimeTypes` | Copied to `acceptedFiles`. Setting both throws. |

## Event handlers as options

As in Dropzone, any [event](/api/events) name can be given as an option: `new AnyDropCore({ addedfile(file) { ... } })`. The handler runs with `this` set to the instance. `setOption('addedfile', fn)` replaces it and `setOption('addedfile', null)` removes it. In the UI, handlers given as options run in addition to the built-in rendering; they do not replace it as in Dropzone (set `disablePreviews: true` to render everything yourself).
