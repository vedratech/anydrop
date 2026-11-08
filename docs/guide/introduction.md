---
title: "Introduction: folder-first file uploads for the browser"
description: "What AnyDrop is: a JavaScript upload library with folder drop, chunked and resumable uploads, pause and resume, and mobile support."
---

# Introduction

AnyDrop is a front-end upload library that treats **folders as first-class objects**. It is configured with plain options and events, and it has a folder picker and tree view, chunked uploads, pause and resume, a persistent error list and a layout that works on phones.

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

new AnyDrop('#uploader', { url: '/upload', chunking: true });
```

[Try it in the live demo](/demo), then follow the [quick start](/guide/quick-start).

## Two packages

| Package | What it is |
|---|---|
| `@vedratech/anydrop-core` | The headless engine: reads dropped and picked files and folders, validates, builds the tree, uploads in chunks, pauses and resumes. No dependencies, no DOM rendering. See [Headless core](/guide/headless-core). |
| `@vedratech/anydrop-ui` | A plain-JavaScript drop zone, folder tree, toolbar, error panel and mobile layout built on the core. Use it when you want a ready-made interface. See [Quick start](/guide/quick-start). |

There is no server to install. AnyDrop is frontend only, and your backend implements a [small HTTP contract](/backend/).

## When to use it

AnyDrop is a good fit when:

- users upload **whole folders** (several at once, mixed with loose files) and you want the structure on the server, empty folders included;
- files are **large or the connection is unreliable**, so you need chunking, pause, resume and automatic recovery;
- people use **phones**, including iOS Safari.

It may not be the right tool if you only need a small single-file input with no progress, or if you need ready-made integrations such as cloud storage importers or image editors. Uppy and FilePond each have their own strengths and plugin ecosystems.

## What it does

- Drag and drop of files and folders together, separate file and folder pickers, paste from the clipboard.
- A folder tree or flat list, with every file's relative path and a folder manifest for the backend.
- Chunked uploads with retry with backoff, and `Blob.slice()` so a file is never loaded into memory whole.
- Pause and resume for everything, a folder or a single file. Resume after a reload (IndexedDB) and after network loss.
- Automatic handling of bad connections: offline, hidden tab, unreachable server, stalled requests.
- A persistent error list with a reason per file, retry for failed files only, and JSON or CSV export.
- Accessible (keyboard, live region, contrast), dark mode, every text translatable.
- ESM, CJS and IIFE builds, TypeScript types, and a pluggable `transport` for S3, tus or fetch adapters.

## How it compares

The one thing we publish is the download size, measured the same way for every library (minified and gzipped with esbuild, 1 kB = 1024 bytes, measured 2026-11-08):

| | JavaScript (gzip) | CSS (gzip) |
|---|---:|---:|
| **AnyDrop ui + core** | 31.7 kB | 3.2 kB |
| FilePond 4.32.12 (core, no plugins) | 40.5 kB | 5.2 kB |
| Uppy core + dashboard + xhr-upload | 78.4 kB | 10.4 kB |

AnyDrop with the UI is less than half the size of Uppy with Dashboard (the ready-made CDN file is 32.1 kB gzip). The size pays for folders and a tree view, chunking with pause and resume, an IndexedDB resume store, connectivity handling, an error registry and a mobile layout. The method, library versions and the headless numbers are on the [size comparison](/size-comparison) page.

## Where next

- New to AnyDrop: [Installation](/guide/installation), then [Quick start](/guide/quick-start).
- Looking for a name: the [API reference](/api/).
- Building the server side: [Backend](/backend/).
