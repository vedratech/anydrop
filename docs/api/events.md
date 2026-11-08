---
title: "Events reference"
description: "Every AnyDrop event with its arguments: file events plus folder, pause, resume, connectivity and error list events."
---

# Events

Subscribe with `ad.on(name, handler)`. It returns a function that removes the listener. Handlers run with `this` set to the instance, and a handler that throws is reported without stopping the other listeners. An event can also be passed as an option: `new AnyDrop('#el', { success(file, response) { ... } })`.

```ts
const off = ad.on('success', (file, response) => console.log(file.relativePath, response));
off(); // unsubscribe
```

The generated type of every event and its arguments is [`AnyDropEvents`](/api/generated/anydrop-core/interfaces/AnyDropEvents). Events marked **UI** are emitted by `@vedratech/anydrop-ui` only. In the UI, a DOM `CustomEvent` named `anydrop:<event>` (with `detail` set to the arguments) is also dispatched on the element for every event.

The usual order for one uploaded file is: `processing`, then for each request `sending` and `uploadprogress`, then `success`, `complete`, `foldercomplete` (innermost folder first), and `queuecomplete` after the last file.

Jump to: [Input](#input-events) / [Files](#file-events) / [Upload](#upload-events) / [Folders](#folder-events) / [Pause and connection](#pause-and-connection-events) / [Errors](#error-events)

## Input events

### `drop`

`(event: DragEvent)`

`drop()` was called with a `dataTransfer`.

### `paste`

`(event: ClipboardEvent)`

`paste()` was called with `clipboardData.items`.

### `dragstart`, `dragenter`, `dragover`, `dragleave` and `dragend`

`(event: DragEvent)` (**UI**)

Drag events over the element. The element also gets the class `ad-drag-hover` while a drag is over it.

```ts
ad.on('dragenter', () => ad.element.classList.add('highlight'));
ad.on('dragleave', () => ad.element.classList.remove('highlight'));
```

## File events

### `addedfile`

`(file: AnyDropFile)`

Each added file, before its validation has finished.

```ts
ad.on('addedfile', (file) => console.log('added', file.relativePath, file.size));
```

### `addedfiles`

`(files: AnyDropFile[])`

Once per batch, after the walk and validation, with every file of the batch (accepted and rejected). A batch is everything added by one drop, paste or input selection, or by `addFile()` calls in the same tick.

```ts
ad.on('addedfiles', (files) => console.log(files.length, 'files in this batch'));
```

### `emptyfolder`

`(path: string)`

A dropped directory has no entries at all. It fires even with `preserveEmptyFolders: false`.

### `removedfile`

`(file: AnyDropFile)`

`removeFile()` or `removeAllFiles()` removed a file. Afterwards `foldercomplete` is checked again for the remaining ancestor folders.

### `reset`

`()`

The last file was removed.

### `thumbnail`

`(file: AnyDropFile, dataUrl: string)` (**UI**)

A thumbnail was created for an accepted image.

```ts
const img = document.querySelector('#my-preview'); // an <img id="my-preview">
ad.on('thumbnail', (file, dataUrl) => (img.src = dataUrl));
```

### `maxfilesexceeded`

`(file: AnyDropFile)`

A file was rejected because of `maxFiles` (after its `error` and `complete`).

### `maxfilesreached`

`(files: AnyDropFile[])`

A check found exactly `maxFiles` accepted files. It can repeat.

## Upload events

### `processing`

`(file: AnyDropFile)`

A file starts uploading (its status becomes `uploading`). With `uploadMultiple` the event `processingmultiple` follows.

### `processingmultiple`

`(files: AnyDropFile[])`

Only with `uploadMultiple`: a request with these files started.

### `sending`

`(file: AnyDropFile, xhr: XMLHttpRequest, formData?: FormData)`

Before each request body is sent. Add fields to `formData` here (the file blob is appended after). `formData` is absent with `binaryBody`. With a custom transport, `xhr` is whatever native object the transport passed to `beforeSend`.

```ts
ad.on('sending', (file, xhr, formData) => formData?.append('albumId', '42'));
```

### `sendingmultiple`

`(files: AnyDropFile[], xhr: XMLHttpRequest, formData?: FormData)`

Only with `uploadMultiple`: before a request body is sent.

### `uploadprogress`

`(file: AnyDropFile, progress: number, bytesSent: number)`

Each progress event of a request, not throttled. `progress` is 0 to 100. It can go down when a request is aborted.

```ts
ad.on('uploadprogress', (file, pct) => console.log(file.name, Math.round(pct) + '%'));
```

### `totaluploadprogress`

`(progress: number, totalBytes: number, totalBytesSent: number)`

Overall progress after each `uploadprogress` and `removedfile`, over the files that are `queued`, `uploading` or `paused`. It is 100 when there are none.

### `success`

`(file: AnyDropFile, response: unknown, e: null)`

A file is uploaded. `response` is the finalize response when one was sent, else the last upload response (parsed JSON when the server sent JSON). For a file skipped because it was uploaded before, `response` is `{ skipped: true, uploadId }`.

```ts
ad.on('success', (file, response) => console.log('stored as', response.path));
```

### `successmultiple`

`(files: AnyDropFile[], response: unknown, e: null)`

Only with `uploadMultiple`: once per successful request.

### `complete`

`(file: AnyDropFile)`

A file is finished: uploaded, failed, rejected or canceled. Always follows `success`, `error` or `canceled`.

### `completemultiple`

`(files: AnyDropFile[])`

Only with `uploadMultiple`: once per finished request.

### `canceled`

`(file: AnyDropFile)`

`cancelUpload()` canceled a file. No `error` follows.

### `canceledmultiple`

`(files: AnyDropFile[])`

Only with `uploadMultiple`: the files of a canceled request.

### `queuecomplete`

`()`

After a `complete` (deferred by `setTimeout` 0), when no file is added, queued, uploading or paused, no batch is still being read and no manifest is in flight. It fires at most once per run (a run starts when a file enters `processing`), so `queuecomplete() { this.removeAllFiles(); }` fires once. It also fires after a drop where every file was rejected.

```ts
ad.on('queuecomplete', () => {
  const failed = ad.getErrors();
  console.log(failed.length ? failed.length + ' failed' : 'all uploaded');
});
```

## Folder events

### `addedfolder`

`(folder: FolderNode)`

Once per new folder node, during the walk. Parents come before children, and before the folder's first `addedfile`. It does not fire for merged folders or the root.

```ts
ad.on('addedfolder', (folder) => console.log('new folder', folder.path));
```

### `removedfolder`

`(folder: FolderNode)`

A folder was removed from the tree because its last file was removed. Deepest first, right after that `removedfile`. Not on `destroy()`.

### `folderprogress`

`(folder: FolderNode, progress: number, bytesSent: number)`

For every ancestor folder of a file that made progress (not the root), throttled to one event per folder per 100 ms, and always sent at 100.

```ts
ad.on('folderprogress', (folder, pct) => console.log(folder.path, Math.round(pct) + '%'));
```

### `foldercomplete`

`(folder: FolderNode)`

Every file in the folder is finished, or an empty folder reached `success`. Innermost folder first. It can fire again later, for example after a retry.

## Pause and connection events

### `paused`

`(target: PauseTarget)`

Once per `pause*()` call or automatic pause, after the files changed status. `target` is `{ scope: 'all', reason }` with reason `'user'`, `'offline'`, `'hidden'` or `'unreachable'`, or `{ scope: 'folder', folder, reason: 'user' }`, or `{ scope: 'file', file, reason: 'user' }`.

```ts
ad.on('paused', (t) => console.log('paused', t.scope, t.reason));
```

### `resumed`

`(target: PauseTarget)`

The same shape, once per `resume*()` call or automatic resume (`reason: 'offline'` when back online, `'hidden'` when the page is visible again, `'unreachable'` when the server answered a probe).

### `offline`

`()`

The browser's `offline` event, whatever the auto-resume settings are. It comes before `paused`. Starting an upload while offline emits `paused` only.

### `online`

`()`

The browser's `online` event.

### `reconnecting`

`(attempt: number, delayMs: number)`

While the connection is lost, before each wait until the next probe. `attempt` counts from 1.

```ts
const status = document.querySelector('#status'); // any element
ad.on('reconnecting', (n, ms) => {
  status.textContent = 'Retrying in ' + Math.round(ms / 1000) + ' s';
});
```

## Error events

### `error`

`(file: AnyDropFile, message: unknown, xhr?: XMLHttpRequest)`

A file was rejected, or its upload finally failed (once, after any retries). `message` is the built-in message, what your `accept()` passed, the parsed JSON error body, or a string. It is followed by `complete`.

```ts
ad.on('error', (file, message) => console.warn(file.relativePath, message));
```

### `errormultiple`

`(files: AnyDropFile[], message: unknown, xhr?: XMLHttpRequest)`

Only with `uploadMultiple`: once per failed request (or once for a single rejected file), after the `error` event of each file.

### `errorlistchanged`

`(errors: ErrorEntry[])`

The error list changed. The argument is a copy. Changes are merged into one event per microtask, so 5,000 rejections fire it once. See [Errors and retry](/guide/errors-retry).

```ts
const badge = document.querySelector('#error-count'); // any element
ad.on('errorlistchanged', (errors) => (badge.textContent = String(errors.length)));
```
