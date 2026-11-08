---
title: "Upload a folder in JavaScript: drag and drop and folder picker"
description: "How to upload a whole folder from the browser in JavaScript: drag and drop, a folder picker, relative paths, empty folders and a tree view, with working code."
---

# Upload a folder in JavaScript

Browsers can hand your page a whole folder in two ways: a drag and drop of a folder, and an `<input type="file" webkitdirectory>` picker. Both give you many files, and you still have to keep each file's relative path, send them, and decide what happens to empty folders. AnyDrop does that part: it reads both inputs, keeps the paths, shows a folder tree and uploads every file with its path.

## The short version

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core
```

```html
<div id="uploader"></div>
```

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

new AnyDrop('#uploader', {
  url: '/upload',
  sendManifest: true, // also send the folder structure, including empty folders
  manifestUrl: '/upload/manifest',
});
```

Without a bundler, load it from a CDN: see [Installation](/guide/installation#cdn). Users can now drop folders (several at once, mixed with loose files), or press **Select folder**. Every file is sent in a request that carries its relative path in the `adRelativePath` field, for example `Photos/2024/a.jpg`.

## What you get

- **Drop and pick.** The drop zone accepts folders and files together. The folder picker button appears only where the browser supports it (detected by feature, never by user agent).
- **Paths kept.** Each file has a `relativePath`. Dropping `Photos` twice merges into one folder node.
- **Empty folders.** Browsers report empty folders only through drops, not through `webkitdirectory`. With `sendManifest` they reach your server in the manifest request. See [Folders and the tree](/guide/folders).
- **A tree view.** A collapsible, virtualised list with progress and status per folder and file (`folderView: 'flat'` for a plain list).
- **Folder-level control.** Pause, resume, retry or cancel one folder: `pauseFolder()`, `resumeFolder()`, `cancelFolder()`. See [Pause and resume](/guide/pause-resume).

## Without the UI

If you only need the engine and have your own markup, use the headless core:

```js
import { AnyDropCore } from '@vedratech/anydrop-core';

const core = new AnyDropCore({
  url: '/upload',
  sendManifest: true,
  manifestUrl: '/upload/manifest',
});

const area = document.querySelector('#upload-area');
area.addEventListener('dragover', (e) => e.preventDefault());
area.addEventListener('drop', (e) => {
  e.preventDefault();
  core.drop(e); // call synchronously: the browser clears the dropped items afterwards
});
```

See [Headless core](/guide/headless-core).

## What your server receives

Plain uploads need one endpoint, `POST /upload`. Each file arrives as `multipart/form-data` with the file in `file` and its path in `adRelativePath`. Build the target path on the server from that field, and reject paths that are absolute or contain `..` (the [backend examples](/backend/) show how). The manifest, chunk status and finalize endpoints are optional and described in the [protocol](/protocol).

## Limits to know about

- **Safari on iOS and iPadOS** has no folder picker and no folder drop. AnyDrop hides the folder button and shows a notice, and users pick files instead. See [Mobile and iOS](/guide/mobile-ios).
- A browser only gives your page what the user chose. A page cannot read a folder from disk by itself.
- The list is virtualised, so thousands of files stay smooth.

## Related

- [Chunked and resumable uploads](/use-cases/chunked-resumable-uploads) for big files inside those folders.
- [Dropzone.js alternative with folder support](/use-cases/dropzone-alternative) if you already use Dropzone.
- [Folder upload with React, Angular or Vue](/use-cases/folder-upload-react-angular-vue).
