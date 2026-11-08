---
title: "Methods reference"
description: "Every AnyDrop method: queue control, files and folders, pause and resume, errors and retry, connection state, and lifecycle with destroy()."
---

# Methods

Every public method and property of `AnyDropCore` (from `@vedratech/anydrop-core`) and of `AnyDrop` (from `@vedratech/anydrop-ui`, which extends the core, so everything here works on both). Methods that exist only in the UI are marked **UI**. The generated type reference is at [`AnyDropCore`](/api/generated/anydrop-core/classes/AnyDropCore) and [`AnyDrop`](/api/generated/anydrop-ui/classes/AnyDrop).

In the examples, `ad` is an instance (`new AnyDrop('#uploader', { url: '/upload' })` or `new AnyDropCore({ url: '/upload' })`).

Jump to: [Adding files](#adding-files) / [Reading state](#reading-state) / [Queue and removal](#queue-and-removal) / [Pause and resume](#pause-and-resume) / [Errors](#errors) / [Persistence](#persistence) / [Options, events and cleanup](#options-events-and-cleanup) / [UI only](#ui-only) / [UI statics](#ui-statics) / [Core statics](#core-statics) / [Exports](#exports)

## Adding files

### `drop(event)`

`(event: { dataTransfer? }) => Promise<AnyDropFile[]>`

Handles a `drop` event: emits `drop`, reads the files and folders (with `webkitGetAsEntry`, calling `readEntries()` until it returns nothing) and resolves after `addedfiles`. **Call it synchronously** from the listener, because the browser clears the dropped items afterwards. The UI does this for you.

```ts
const area = document.querySelector('#upload-area'); // <div id="upload-area"></div>

area.addEventListener('dragover', (e) => e.preventDefault());
area.addEventListener('drop', (e) => {
  e.preventDefault();
  ad.drop(e);
});
```

### `paste(event)`

`(event: { clipboardData? }) => Promise<AnyDropFile[]>`

Handles a `paste` event: emits `paste` and adds pasted files. A text-only paste adds nothing.

```ts
window.addEventListener('paste', (e) => ad.paste(e));
```

### `addDataTransfer(dataTransfer)`

`(dataTransfer: DataTransferLike) => Promise<AnyDropFile[]>`

Like `drop()`, without emitting the `drop` event.

### `addFromInput(input)`

`(input: { files?: ArrayLike<File> | null } | FileList | File[]) => Promise<AnyDropFile[]>`

Adds the files of an `<input type="file">` or `<input webkitdirectory>` (paths come from `webkitRelativePath`), a `FileList` or an array. Large selections are read in slices of 500, so the page stays responsive.

```ts
const folderInput = document.querySelector('#folder-input'); // <input id="folder-input" type="file" webkitdirectory>

folderInput.addEventListener('change', () => {
  ad.addFromInput(folderInput);
  folderInput.value = '';
});
```

### `addFile(file, folderPath?)`

`(file: File, folderPath?: string) => AnyDropFile`

Adds one file. `folderPath` puts it in a folder; without it a non-empty `webkitRelativePath` is used. Calls in the same tick form one batch. Adding the same `File` again returns it unchanged.

```ts
ad.addFile(file, 'Photos/2024'); // lands in the folder Photos/2024
```

### `addFiles(files)`

`(files: File[]) => AnyDropFile[]`

Adds several files as one batch.

## Reading state

### `files`

`AnyDropFile[]`

Every file, in add order (Dropzone's `files`). Read it, do not modify it.

### `getTree()`

`() => FolderNode`

The virtual root folder (`path: ''`). It is a live object: read it, do not change it. See [Folders and the tree](/guide/folders).

```ts
for (const folder of ad.getTree().children) console.log(folder.path, folder.progress);
```

### `getFolder(path)`

`(path: string) => FolderNode | undefined`

A folder by path.

```ts
ad.getFolder('Photos/2024')?.counts; // { total, added, queued, uploading, ... }
```

### `getFile(id)`

`(id: string) => AnyDropFile | undefined`

A file by its `file.id`.

### `getAcceptedFiles()` and `getRejectedFiles()`

`() => AnyDropFile[]`

Files by `file.accepted`.

### `getFilesWithStatus(status)`

`(status: FileStatus) => AnyDropFile[]`

Files with one status: `'added'`, `'queued'`, `'uploading'`, `'paused'`, `'success'`, `'error'` or `'canceled'`.

```ts
ad.getFilesWithStatus('error').length;
```

### `getAddedFiles()`, `getQueuedFiles()`, `getUploadingFiles()` and `getPausedFiles()`

`() => AnyDropFile[]`

Files by status. `getUploadingFiles()` excludes paused files.

### `getActiveFiles()`

`() => AnyDropFile[]`

Files that are `queued`, `uploading` or `paused`.

### `filesize(bytes)`

`(size: number) => string`

Dropzone's size text, using `filesizeBase` and `dictFileSizeUnits`.

```ts
ad.filesize(1500000); // '<strong>1.5</strong> MB'
```

## Queue and removal

### `enqueueFile(file)` and `enqueueFiles(files)`

`(file: AnyDropFile) => void` and `(files: AnyDropFile[]) => void`

Queue added, accepted files (needed with `autoQueue: false`). Throws for other files, like Dropzone.

### `processQueue()`

`() => void`

Starts queued files in add order until `parallelUploads` files are uploading. If called while a batch is still being read, it runs again when that batch closes, so `ad.addFile(f); ad.processQueue()` works with `autoProcessQueue: false`.

```ts
const ad = new AnyDropCore({ url: '/upload', autoProcessQueue: false });
ad.addFile(someFile); // a File you already have
document.querySelector('#upload-btn').onclick = () => ad.processQueue();
```

### `processFile(file)` and `processFiles(files)`

`(file: AnyDropFile) => void` and `(files: AnyDropFile[]) => void`

Start these `queued` files now, even beyond `parallelUploads` (as Dropzone does). With `uploadMultiple`, the files of one batch share a request.

### `uploadFile(file)` and `uploadFiles(files)`

`(file: AnyDropFile) => void` and `(files: AnyDropFile[]) => void`

Aliases of `processFile(s)`. Overriding them changes nothing; use the [`transport`](/guide/custom-transport) option instead.

### `cancelUpload(file)`

`(file: AnyDropFile) => void`

Cancels a file that is not finished: aborts its requests, sets the status `canceled`, then emits `canceled` and `complete` (no `error`). With `uploadMultiple`, every file of the same request is canceled.

### `cancelFolder(path)`

`(path: string) => void`

Cancels every unfinished file under a folder (`canceled` and `complete` for each), then emits `foldercomplete`. The files keep their rows in the tree.

### `removeFile(file)`

`(file: AnyDropFile) => void`

Removes a file from the instance and the tree. Folders left empty are removed too, unless they were dropped empty. Emits `removedfile` (and `removedfolder` per pruned folder), then `reset` when no file is left.

### `removeAllFiles(cancelIfNecessary = false)`

`(cancelIfNecessary?: boolean) => void`

Removes every file that is not uploading (or every file with `true`), then every folder left without files, including folders dropped empty.

```ts
ad.on('queuecomplete', () => ad.removeAllFiles());
```

### `disable()` and `enable()`

`() => void`

`disable()` sets `disabled` to `true` and cancels every file; adding files still works. `enable()` clears the flag. In the UI they also remove or restore the drag, drop, paste and click listeners and disable the buttons.

### `disabled`

`boolean`

Set by `disable()`.

## Pause and resume

### `pause()` and `resume()`

`() => void`

`pause()` pauses every file. `resume()` clears the instance pause and every system reason (offline, hidden, unreachable); folder and file pauses stay. Each emits `paused` or `resumed` once per call.

```ts
document.querySelector('#pause').onclick = () => ad.pause();
document.querySelector('#resume').onclick = () => ad.resume();
```

### `pauseFolder(path)` and `resumeFolder(path)`

`(path: string) => void`

Pause every file under a folder (also files added to it later), and clear that folder's own pause. Unknown paths are ignored.

```ts
ad.pauseFolder('Photos/2024');
```

### `pauseFile(file | id)` and `resumeFile(file | id)`

`(file: AnyDropFile | string) => void`

Pause one file, and clear its own pause. A paused folder or a paused instance still holds the file.

### `reconnect()`

`() => void`

"Retry now": probes at once while the connection is `unreachable`, and lifts an `offline` pause the browser no longer reports. It does nothing when online. Unlike `resume()` it keeps the pauses the user made.

```ts
document.querySelector('#retry-now').onclick = () => ad.reconnect();
```

### `getConnectionState()`

`() => ConnectionState`

Returns `{ state, attempt, retryAt }`. `state` is `'online'`, `'offline'` or `'unreachable'`; `attempt` is the probe number (0 when online) and `retryAt` the `Date.now()` time of the next probe, or `null`. Useful to show the right banner when a component mounts.

```ts
if (ad.getConnectionState().state === 'unreachable') console.log('show your own banner');
```

## Errors

### `getErrors()`

`() => ErrorEntry[]`

A copy of the error list: one entry per file currently in `error`.

### `clearErrors()`

`() => void`

Empties the error list. The files stay in `error`.

### `exportErrors(format = 'json')`

`(format?: 'json' | 'csv') => string`

The error list as `'json'` or `'csv'` (RFC 4180, CRLF). In CSV, text cells that start with `=`, `+`, `-`, `@`, a tab or a CR get a `'` prefix, so a spreadsheet never runs a file name or server message as a formula.

```ts
const csv = ad.exportErrors('csv');
const link = document.createElement('a');
link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
link.download = 'errors.csv';
link.click();
```

### `retryFailedOnly(folderPath?)`

`(folderPath?: string) => number`

Re-queues the failed files (all, or under `folderPath`), except validation rejections, and returns how many. Done chunks are kept; with `chunkStatusUrl` the server is asked first; a failed batch manifest is sent again.

```ts
const n = ad.retryFailedOnly('Photos/2024');
```

### `retryFile(file | id)`

`(file: AnyDropFile | string) => boolean`

Re-queues one failed file like `retryFailedOnly`. Returns whether it did.

## Persistence

### `clearPersistedState()`

`() => Promise<void>`

Deletes this `persistKey`'s saved progress, for a "start over" button. It works after `destroy()` and does nothing with `persistState: false`. Files already in the list stop writing records.

```ts
await ad.clearPersistedState();
```

## Options, events and cleanup

### `options`

The resolved options object. Read it; change options with `setOption`.

### `setOption(name, value)`

`(name, value) => void`

Changes an option at runtime. Throws for combinations Dropzone rejects (`chunking` with `uploadMultiple`, `binaryBody` with `uploadMultiple`). In the UI it works for every UI option too.

```ts
ad.setOption('maxFiles', 5);
ad.setOption('folderView', 'flat'); // UI
```

### `getOption(name)`

`(name) => value`

Reads an option.

### `resolveOption(option, ...args)`

`(option, ...args) => value`

Calls a function option with `this` set to the instance, otherwise returns the value (Dropzone's `resolveOption`).

```ts
ad.resolveOption(ad.options.url, files);
```

### `on(event, fn)`

`(event, fn) => Unsubscribe`

Adds a listener and returns a function that removes it. The returned function also has `on` and `once`, so `ad.on('a', f).on('b', g)` chains as in Dropzone (`off` is not chainable). Does nothing after `destroy()`. See [Events](/api/events).

```ts
const off = ad.on('success', (file) => console.log(file.relativePath));
off(); // remove this listener
```

### `once(event, fn)`

`(event, fn) => Unsubscribe`

A listener that runs once.

### `off(event?, fn?)`

`(event?, fn?) => this`

`off()` removes every listener, `off(event)` every listener of that event, `off(event, fn)` one listener (also one added with `once`).

### `emit(event, ...args)`

`(event, ...args) => this`

Emits an event, as in Dropzone.

### `hasListeners(event)`

`(event) => boolean`

Whether anyone listens to the event.

### `destroy()`

`() => void`

Aborts every request, ends folder walks, removes every listener and timer, and empties the instance. It emits nothing. After it, `addFile()` throws and `drop()` resolves with `[]`. In the UI it also removes everything the instance added to the DOM. Call it when your component unmounts.

### `isDestroyed`

`boolean`

Whether `destroy()` was called.

## UI only

### `element`

`HTMLElement` (**UI**)

The element the instance is attached to. The instance is also reachable as `element.anydrop` and, as Dropzone has it, `element.dropzone`.

### `hiddenFileInput`

`HTMLInputElement | null` (**UI**)

The hidden file input that the file picker opens (Dropzone's `hiddenFileInput`).

### `displayExistingFile(mockFile, imageUrl, callback?, crossOrigin?, resizeThumbnail = true)`

(**UI**)

Shows a file that is already on the server as a row at the root. It is not added to `files`, the tree or a manifest. `removeFile(mockFile)` removes the row.

```ts
ad.displayExistingFile({ name: 'cover.jpg', size: 12345 }, '/files/cover.jpg');
```

### `downloadErrors(format?)`

`(format?: 'json' | 'csv') => void` (**UI**)

Downloads the error list as a file.

### `copyErrors()`

`() => Promise<boolean>` (**UI**)

Copies the error list to the clipboard. Resolves with whether it worked.

## UI statics

These exist on the `AnyDrop` class (**UI**).

### `AnyDrop.options`

`Record<string, AnyDropConfig | false>`

Dropzone's `Dropzone.options`: presets for the element with id `my-id` as `AnyDrop.options.myId = { ... }`. `false` stops `discover()` from attaching to that element.

### `AnyDrop.instances`

`AnyDrop[]`

Every live instance. `destroy()` removes an instance again.

### `AnyDrop.autoDiscover`

`boolean`

Read by the CDN build only: set it to `false` right after the script tag to stop auto-discovery of `.dropzone` and `.anydrop` elements.

### `AnyDrop.discover(root = document)`

`(root?: ParentNode) => AnyDrop[]`

Attaches an instance to every `.dropzone` or `.anydrop` element under `root` that has none. Returns the new instances. The npm builds never call it by themselves.

### `AnyDrop.forElement(element)`

`(element: string | HTMLElement) => AnyDrop`

The instance attached to an element.

### `AnyDrop.isBrowserSupported()`

`() => boolean`

Whether the browser has the APIs the UI needs.

### `AnyDrop.supportsFolderPicker()`

`() => boolean`

Feature detection of the folder picker (`'webkitdirectory' in input`). It is `false` on iOS Safari.

### `AnyDrop.confirm(question, accepted, rejected?)`

`(question: string, accepted: () => void, rejected?: () => void) => void`

Asks a question with `window.confirm`. Override it to use your own dialog.

```ts
// myDialog is your own function that returns a Promise<void>
AnyDrop.confirm = (question, accepted, rejected) => myDialog(question).then(accepted, rejected);
```

## Core statics

These exist on both classes, and as named exports.

### `version`

`string`

`AnyDropCore.version`, the library version.

### `ADDED`, `QUEUED`, `ACCEPTED`, `UPLOADING`, `PROCESSING`, `PAUSED`, `SUCCESS`, `ERROR` and `CANCELED`

File status constants (`'added'`, `'queued'`, `'queued'`, `'uploading'`, `'uploading'`, `'paused'`, `'success'`, `'error'`, `'canceled'`). `ACCEPTED` is Dropzone's alias of `QUEUED` and `PROCESSING` its alias of `UPLOADING`.

```ts
if (file.status === AnyDropCore.SUCCESS) { /* ... */ }
```

### `isValidFile(file, acceptedFiles)`

Dropzone's `acceptedFiles` matcher: whether a file matches a list such as `'image/*,.pdf'`.

### `uuidv4()`

`() => string`

Creates a UUID version 4 (it works without HTTPS).

## Exports

Named exports of the packages that are not methods.

### `AnyDropCore`

The headless engine class from `@vedratech/anydrop-core`. See [Headless core](/guide/headless-core).

### `AnyDrop`

The UI class from `@vedratech/anydrop-ui`. In the CDN build it is also `window.AnyDrop`, with `AnyDrop.AnyDropCore`, `AnyDrop.VERSION`, `AnyDrop.uiDefaults` and `AnyDrop.DEFAULT_TEMPLATE` as statics.

### `VERSION`

`string`

The library version, exported by both packages.

### `defaultOptions()`

`() => AnyDropCoreOptions`

A fresh object with the default core options (instances share no state).

### `xhrTransport`

`Transport`

The built-in XMLHttpRequest transport. Use it as the fallback inside your own [custom transport](/guide/custom-transport).

### `uiDefaults()`

`() => AnyDropUIOptions`

A fresh object with the default UI options.

### `DEFAULT_TEMPLATE`

`string`

The default preview markup (Dropzone's template with the same `data-dz-*` hooks and `dz-*` classes).
