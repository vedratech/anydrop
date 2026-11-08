---
title: "Size comparison: AnyDrop, Uppy, FilePond"
description: "Measured minified and gzipped download sizes of AnyDrop, Uppy, FilePond and Resumable.js, with the method and versions so you can reproduce them."
---

# Size comparison: AnyDrop and the libraries people compare it with

The compared libraries were measured on **2026-11-07**; AnyDrop (`0.1.0` build) was measured again on **2026-11-08** with the same script. Numbers are **minified + gzip** of what a browser downloads. Brotli is shown as a second column because most CDNs serve it.

## Method

1. Install the packages in a temp directory **outside the repo** (`npm i @uppy/core @uppy/dashboard @uppy/xhr-upload filepond resumablejs esbuild`).
2. For each library write a one-line entry file that imports the public entry point(s) and keeps a reference on `globalThis` (so nothing is tree-shaken away).
3. Bundle with **esbuild**: `--bundle --minify --format=iife --target=es2019 --platform=browser`, `process.env.NODE_ENV="production"`, no legal comments. This is the same recipe for every library, so the numbers are comparable.
4. Compress with Node's zlib: gzip **level 9** and brotli quality 11. (`pnpm size` uses size-limit's own gzip, which differs by a few hundred bytes. The budgets in `.size-limit.json` stay the source of truth for AnyDrop's own limits.)
5. For libraries that ship a ready minified file (AnyDrop `dist/index.global.js`) that file is measured too ("as downloaded").
6. CSS is measured separately, as shipped (the minified file when the package ships one).
7. 1 kB = 1024 bytes in the tables. Note that `pnpm size` (size-limit) counts 1 kB = 1000 bytes, so the same CDN file reads 35.62 kB there and 34.8 kB here (35,621 bytes gzip); the `.size-limit.json` budgets are in size-limit's unit.

Versions: Uppy `@uppy/core` **6.3.1**, `@uppy/dashboard` **6.0.3**, `@uppy/xhr-upload` **6.0.1**, FilePond **4.32.12** (no plugins), Resumable.js (`resumablejs`) **1.1.0**, AnyDrop `0.1.0` build of 2026-11-08 with the UI customisation features (pre-release).

## JavaScript

| Library (what is included) | Minified | gzip | brotli |
|---|---:|---:|---:|
| **Resumable.js** 1.1.0 (headless: no UI, no folder tree) | 16.7 kB | **5.2 kB** | 4.7 kB |
| **Uppy** core + xhr-upload (no UI) | 54.9 kB | **18.5 kB** | 16.5 kB |
| **AnyDrop core** (headless engine, esbuild bundle of `@vedratech/anydrop-core`) | 54.1 kB | **18.4 kB** | 16.5 kB |
| **FilePond** 4.32.12 (core, no plugins) | 136.8 kB | **40.5 kB** | 35.5 kB |
| **AnyDrop ui + core** (`@vedratech/anydrop-ui`, esbuild bundle) | 105.6 kB | **34.7 kB** | 30.8 kB |
| AnyDrop ui + core, shipped CDN file `dist/index.global.js` | 106.6 kB | 34.8 kB | 30.9 kB |
| **Uppy** core + dashboard + xhr-upload | 249.7 kB | **78.4 kB** | 66.8 kB |

## CSS (separate files)

| Library | File | Bytes | gzip | brotli |
|---|---|---:|---:|---:|
| Uppy | core `style.min.css` | 3.2 kB | 1.0 kB | 0.8 kB |
| Uppy | dashboard `style.min.css` | 66.8 kB | **10.4 kB** | 9.2 kB |
| FilePond | `filepond.css` | 26.1 kB | **5.2 kB** | 4.4 kB |
| **AnyDrop ui** | `style.css` | 15.3 kB | **3.6 kB** | 3.1 kB |

## Reading the numbers

- AnyDrop with the UI (about 35 kB gzip, plus 3.6 kB CSS) is **less than half of Uppy with Dashboard** (78.4 kB plus 10.4 kB CSS) and below FilePond (40.5 kB plus 5.2 kB CSS).
- The size pays for folders and a tree view, chunking with pause and resume, an IndexedDB resume store, connectivity handling, an error registry and a mobile layout. Resumable.js is smaller because it only does chunking, with no UI, no folders and no persistence.
- The headless AnyDrop core (18.4 kB) is about the same size as Uppy core with its XHR plugin (18.5 kB), and Uppy's core has no folder tree, persistence or pause model of its own.
- Claims that are supported by these numbers: "about 45% of the size of Uppy with Dashboard", "smaller than FilePond with the folder tree and chunking included".

## Reproduce

```bash
mkdir /tmp/size-probe && cd /tmp/size-probe && npm init -y
npm i @uppy/core @uppy/dashboard @uppy/xhr-upload filepond resumablejs esbuild
# entry files (one import each, assigned to globalThis), then:
npx esbuild entries/uppy.js --bundle --minify --format=iife --target=es2019 --define:process.env.NODE_ENV='"production"' | gzip -9 | wc -c
```

The numbers on this page were produced by a script that follows the method above; re-run it before quoting any figure if the libraries or AnyDrop's build have changed. The ui CDN file is at 34.8 kB (35,621 bytes) by this method, which is 35.62 kB in `pnpm size`'s unit, against a size budget of 36 kB.

## Size budgets

The size budgets enforced in CI (`.size-limit.json`) are core 19.5 kB, ui without core 17.5 kB and the ui CDN file 36 kB, counted in size-limit's unit (1 kB = 1000 bytes). The AnyDrop rows above were measured against the 2026-11-08 build with the customisation features (CDN file 34.8 kB by this method; 35.62 kB in `pnpm size`; ui without core 17.03 kB). The numbers are measured again when AnyDrop's build or a compared library changes. Size statements are limited to what this page supports.
