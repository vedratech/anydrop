# AnyDrop: folder upload for the browser

**Drag and drop folder upload in JavaScript and TypeScript, with chunked and resumable uploads, pause and resume, retry and a persistent error list. Works on phones.**

[![npm version](https://img.shields.io/npm/v/@vedratech/anydrop-ui.svg)](https://www.npmjs.com/package/@vedratech/anydrop-ui)
[![npm downloads](https://img.shields.io/npm/dm/@vedratech/anydrop-ui.svg)](https://www.npmjs.com/package/@vedratech/anydrop-ui)
[![bundle size](https://deno.bundlejs.com/badge?q=@vedratech/anydrop-ui)](https://bundlejs.com/?q=@vedratech/anydrop-ui)
[![CI](https://github.com/vedratech/anydrop/actions/workflows/ci.yml/badge.svg)](https://github.com/vedratech/anydrop/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/@vedratech/anydrop-ui.svg)](https://github.com/vedratech/anydrop/blob/main/LICENSE)
[![docs](https://img.shields.io/badge/docs-vedratech.github.io%2Fanydrop-1d4ed8.svg)](https://vedratech.github.io/anydrop/)

AnyDrop is a front-end upload library that treats **folders as first-class objects**. It is configured with plain options and events, and has a folder picker and tree view, chunked uploads, pause and resume, a persistent error list, and a layout that works on phones. Packages: [`@vedratech/anydrop-ui`](packages/ui/README.md) and [`@vedratech/anydrop-core`](packages/core/README.md). Badges show the UI package; the badges of the core package are in its [README](packages/core/README.md).

## Documentation: https://vedratech.github.io/anydrop/

| | |
|---|---|
| [Get started](https://vedratech.github.io/anydrop/guide/introduction) | Guide: install, quick start, folders, chunking, resume, offline, errors |
| [Live demo](https://vedratech.github.io/anydrop/demo) | The real UI, with a simulated network |
| [API reference](https://vedratech.github.io/anydrop/api/) | Every option, method, event, error code and type |
| [Backend](https://vedratech.github.io/anydrop/backend/) | The HTTP contract, with Express and Laravel examples |

## Why AnyDrop

Use it when users upload **whole folders**, when files are **large or the connection is unreliable**, or when people use **phones**.

- Folder tree, empty folders and a folder manifest for the backend.
- Chunked uploads with retry on by default.
- Pause and resume (everything, a folder or one file), also after a page reload (IndexedDB).
- Automatic handling of offline and unreachable servers.
- A persistent error list with retry and export.
- A headless core without a UI.

Uppy and FilePond have plugin ecosystems that AnyDrop does not. If you only need plain file uploads, one of them may suit you better. Sizes are in the [Size](#size) section.

Guides for common tasks:
[upload a folder in JavaScript](https://vedratech.github.io/anydrop/use-cases/upload-folder-javascript),
[chunked and resumable uploads](https://vedratech.github.io/anydrop/use-cases/chunked-resumable-uploads),
[upload large files](https://vedratech.github.io/anydrop/use-cases/upload-large-files),
[pause and resume uploads](https://vedratech.github.io/anydrop/use-cases/pause-resume-uploads),
[uploads that survive a lost connection](https://vedratech.github.io/anydrop/use-cases/upload-lost-connection),
[folder upload with React, Angular or Vue](https://vedratech.github.io/anydrop/use-cases/folder-upload-react-angular-vue),
[Laravel and Express chunked upload backend](https://vedratech.github.io/anydrop/use-cases/chunked-upload-backend).

## Two packages

- [`@vedratech/anydrop-core`](packages/core/README.md): the headless engine (no dependencies, no DOM rendering).
- [`@vedratech/anydrop-ui`](packages/ui/README.md): the plain-JavaScript drop zone, folder tree and mobile layout on top of it.

AnyDrop is frontend only and ships no server: your backend implements a small [HTTP contract](https://vedratech.github.io/anydrop/protocol).

## Install

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core   # drop zone and UI
npm install @vedratech/anydrop-core                          # headless engine only
```

From a CDN (pin the minor version). The UI build includes the core and sets `window.AnyDrop`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>
```

## Minimal example

```html
<div id="uploader"></div>
```

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024,
  sendManifest: true, // send the folder structure, including empty folders
  manifestUrl: '/upload/manifest',
});

ad.on('queuecomplete', () => console.log('done', ad.getErrors()));
```

Headless, with your own drop area (`<div id="upload-area">`):

```js
import { AnyDropCore } from '@vedratech/anydrop-core';

const core = new AnyDropCore({
  url: '/upload',
  chunking: true,
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

## Features

- Drag and drop of **files and folders together**, folder and file pickers, paste. Empty folders are kept, and the backend can receive the structure as a manifest.
- **Chunked uploads** with retry with backoff, and `Blob.slice()` so a file is never loaded into memory whole.
- **Pause and resume** for everything, a folder or one file, and resume after a reload (IndexedDB).
- **Bad connections handled:** uploads pause by themselves when the browser is offline, the tab is hidden or the server cannot be reached, and carry on when it returns.
- A **persistent error list** with a reason per file, retry of failed files only, and JSON or CSV export.
- Folder events next to the file events. Mobile friendly, accessible, dark mode, every text translatable.
- ESM, CJS and IIFE builds, TypeScript types, and a pluggable `transport` for S3, tus or fetch adapters.

## Size

Download size, measured the same way for every library (minified and gzipped with esbuild, 1 kB = 1024 bytes, measured 2026-11-08): AnyDrop ui + core 34.7 kB, FilePond 4.32.12 (core, no plugins) 40.5 kB, Uppy core + dashboard + xhr-upload 78.4 kB (CSS excluded). AnyDrop with the UI is less than half the size of Uppy with Dashboard. Method and the CSS numbers: [size comparison](https://vedratech.github.io/anydrop/size-comparison).

## Browser support

Chrome, Edge, Firefox and Safari (desktop), Safari on iOS and iPadOS, Chrome on Android. Safari on iOS has no folder picker and no folder drop, and AnyDrop says so instead of failing. See [Mobile and iOS](https://vedratech.github.io/anydrop/guide/mobile-ios) for the table and the iOS limits.

## Backend

Your server implements four endpoints: `POST /upload` (a chunk or a whole file), `GET /upload/status`, `POST /upload/manifest` and `POST /upload/finalize`. Full contract: [protocol](https://vedratech.github.io/anydrop/protocol). Working examples: [Express](https://vedratech.github.io/anydrop/backend/express) and [Laravel](https://vedratech.github.io/anydrop/backend/laravel).

## Contributing

```sh
pnpm install
pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm size
pnpm docs:dev     # the documentation website with hot reload
pnpm docs:build   # builds the packages, the API reference and the site
```

## Author

Created and maintained by **Jayesh Gupta** ([@jayeshgupta91](https://github.com/jayeshgupta91)).

## License

MIT © 2026 Jayesh Gupta.
