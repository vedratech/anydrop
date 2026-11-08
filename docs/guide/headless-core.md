# Headless core

`@vedratech/anydrop-core` is the engine without any interface. Use it when you build your own UI, or a wrapper for a framework. It reads dropped and picked files, validates them, builds the folder tree, uploads in chunks, and pauses, resumes and retries. It has no dependencies and renders nothing.

```sh
npm install @vedratech/anydrop-core
```

## A complete example

Start with an element that will receive drops, and a folder input:

```html
<div id="upload-area">Drop files or folders here</div>
<input id="folder-input" type="file" webkitdirectory />
```

Then connect them to the engine:

```js
import { AnyDropCore } from '@vedratech/anydrop-core';

const core = new AnyDropCore({
  url: '/upload',
  chunking: true,
  sendManifest: true,
  manifestUrl: '/upload/manifest',
});

core.on('folderprogress', (folder, percent) => console.log(folder.path, Math.round(percent)));
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
  folderInput.value = ''; // so the same folder can be picked again
});
```

Everything is driven by options, methods and events, with no framework assumptions: `on()` returns an unsubscribe function, `destroy()` removes all listeners and timers, `setOption()` works at runtime, and nothing touches `window` or `document` when you import the package.

## Core concepts

**The file object is the native `File`** with properties added (`id`, `relativePath`, `fullPath`, `fingerprint`, `folder`, `status`, `accepted`, `upload`). You can pass it to `FormData`, `FileReader` or `URL.createObjectURL`. See [`AnyDropFile`](/api/types#anydropfile).

**Batches.** Everything added by one user action (a drop, a paste, an input selection), or by `addFile()` calls in the same tick, is one batch. For each batch, every file emits `addedfile` and is validated. When the walk and every `accept()` callback are done, `addedfiles(files)` fires once, and then accepted files are queued (with `autoQueue`).

**Folders are nodes.** The tree has a virtual root (`path: ''`) holding top-level folders and loose files. Folders are unique by path, so dropping `Photos` twice merges into one node. Every node keeps counters, byte totals, a rolled-up `status` and `progress`. See [Folders and the tree](/guide/folders).

**Uploading.** Queued files start in add order. `parallelUploads` counts files uploading at once. Each uploading file sends one chunk at a time, or up to `parallelChunkUploads` chunks. With `sendManifest`, a batch's manifest is sent right before its first file and must succeed before any of its files is sent. After the last chunk of a file, the finalize request (or your `chunksUploaded` hook) runs.

**Memory.** Files are only read with `Blob.slice()`, one chunk per request. A file is never loaded whole.

## Read the state

```js
const tree = core.getTree(); // live folder tree
core.getFolder('Photos/2024');
core.getQueuedFiles();
core.getErrors(); // a copy of the error list
core.getConnectionState(); // { state, attempt, retryAt }
```

## Control it

```js
core.pause();
core.resume();
core.pauseFolder('Photos');
core.retryFailedOnly();
core.setOption('maxFiles', 10);
core.destroy();
```

## Subclass hooks

`@vedratech/anydrop-ui` extends `AnyDropCore`. If you build your own subclass, two protected hooks exist: `_addFormElementData(formData)` is called for every upload request with form data (after `sending`, before the file blobs are appended), and `_completeExternal(file)` emits `complete` for a file that is outside the queue.

## Next

- [Chunked uploads](/guide/chunked-uploads), [Pause and resume](/guide/pause-resume), [Errors and retry](/guide/errors-retry)
- [Events cookbook](/guide/events-cookbook)
- [Options](/api/options), [Methods](/api/methods), [Events](/api/events)
