---
title: "Size comparison: AnyDrop, Dropzone, Uppy, FilePond"
description: "Measured minified and gzipped download sizes of AnyDrop, Dropzone, Uppy, FilePond and Resumable.js, with the method and versions so you can reproduce them."
---

# Size comparison: AnyDrop and the libraries people compare it with

Measured on **2026-11-07** and re-measured on **2026-11-08** (AnyDrop `0.1.0` build). The compared libraries are the same versions in both runs; only the AnyDrop rows moved, by a few bytes (see the end of this page). Numbers are **minified + gzip** of what a browser downloads. Brotli is shown as a second column because most CDNs serve it.

## Method

1. Install the packages in a temp directory **outside the repo** (`npm i dropzone@6.3.5 @uppy/core @uppy/dashboard @uppy/xhr-upload filepond resumablejs esbuild`).
2. For each library write a one-line entry file that imports the public entry point(s) and keeps a reference on `globalThis` (so nothing is tree-shaken away).
3. Bundle with **esbuild**: `--bundle --minify --format=iife --target=es2019 --platform=browser`, `process.env.NODE_ENV="production"`, no legal comments. This is the same recipe for every library, so the numbers are comparable.
4. Compress with Node's zlib: gzip **level 9** and brotli quality 11. (`pnpm size` uses size-limit's own gzip, which differs by a few hundred bytes. The budgets in `.size-limit.json` stay the source of truth for AnyDrop's own limits.)
5. For libraries that ship a ready minified file (Dropzone `dist/dropzone-min.js`, AnyDrop `dist/index.global.js`) that file is measured too ("as downloaded").
6. CSS is measured separately, as shipped (the minified file when the package ships one).
7. 1 kB = 1024 bytes in the tables. Note that `pnpm size` (size-limit) counts 1 kB = 1000 bytes, so the same CDN file reads 33.9 kB there and 33.1 kB here (33,926 bytes gzip); the `.size-limit.json` budgets are in size-limit's unit.

Versions: Dropzone **6.3.5**, Uppy `@uppy/core` **6.3.1**, `@uppy/dashboard` **6.0.3**, `@uppy/xhr-upload` **6.0.1**, FilePond **4.32.12** (no plugins), Resumable.js (`resumablejs`) **1.1.0**, AnyDrop `0.1.0` build of 2026-11-08 (pre-release).

## JavaScript

| Library (what is included) | Minified | gzip | brotli |
|---|---:|---:|---:|
| **Resumable.js** 1.1.0 (headless: no UI, no folder tree) | 16.7 kB | **5.2 kB** | 4.7 kB |
| **Dropzone** 6.3.5, esbuild bundle | 37.4 kB | **11.7 kB** | 10.4 kB |
| Dropzone 6.3.5, shipped `dropzone-min.js` | 37.2 kB | 11.6 kB | 10.2 kB |
| **Uppy** core + xhr-upload (no UI) | 54.9 kB | **18.5 kB** | 16.5 kB |
| **AnyDrop core** (headless engine, esbuild bundle of `@vedratech/anydrop-core`) | 53.7 kB | **18.1 kB** | 16.3 kB |
| **FilePond** 4.32.12 (core, no plugins) | 136.8 kB | **40.5 kB** | 35.5 kB |
| **AnyDrop ui + core** (`@vedratech/anydrop-ui`, esbuild bundle) | 97.5 kB | **31.8 kB** | 28.2 kB |
| AnyDrop ui + core, shipped CDN file `dist/index.global.js` | 101.7 kB | 33.1 kB | 29.3 kB |
| **Uppy** core + dashboard + xhr-upload | 249.7 kB | **78.4 kB** | 66.8 kB |

## CSS (separate files)

| Library | File | Bytes | gzip | brotli |
|---|---|---:|---:|---:|
| Dropzone | `dropzone.css` | 4.5 kB | **1.3 kB** | 1.0 kB |
| Dropzone | `basic.css` | 0.8 kB | 0.3 kB | 0.2 kB |
| Uppy | core `style.min.css` | 3.2 kB | 1.0 kB | 0.8 kB |
| Uppy | dashboard `style.min.css` | 66.8 kB | **10.4 kB** | 9.2 kB |
| FilePond | `filepond.css` | 26.1 kB | **5.2 kB** | 4.4 kB |
| **AnyDrop ui** | `style.css` | 13.0 kB | **3.1 kB** | 2.6 kB |

## Reading the numbers

- AnyDrop with UI (about 32 to 33 kB gzip, plus 3.1 kB CSS) is **about 2.7 times Dropzone** (11.7 kB plus 1.3 kB CSS) and **less than half of Uppy with Dashboard** (78.4 kB plus 10.4 kB CSS). It is below FilePond (40.5 kB plus 5.2 kB CSS).
- AnyDrop is not "lighter than Dropzone". What it adds on top of Dropzone's feature set: folders and a tree view, chunking with pause and resume, an IndexedDB resume store, connectivity handling, an error registry and a mobile layout. Resumable.js is smaller because it only does chunking, with no UI, no folders and no persistence.
- The headless AnyDrop core (18.1 kB) is about the same size as Uppy core with its XHR plugin (18.5 kB), and Uppy's core has no folder tree, persistence or pause model of its own.
- Claims that are supported by these numbers: "about 40% of the size of Uppy with Dashboard", "smaller than FilePond with the folder tree and chunking included". Claims that are **not** supported: "lighter than Dropzone".

## Reproduce

```bash
mkdir /tmp/size-probe && cd /tmp/size-probe && npm init -y
npm i dropzone@6.3.5 @uppy/core @uppy/dashboard @uppy/xhr-upload filepond resumablejs esbuild
# entry files (one import each, assigned to globalThis), then:
npx esbuild entries/uppy.js --bundle --minify --format=iife --target=es2019 --define:process.env.NODE_ENV='"production"' | gzip -9 | wc -c
```

The numbers on this page were produced by a script that follows the method above; re-run it before quoting any figure if the libraries or AnyDrop's build have changed. The ui CDN file is at 33.1 kB (33,926 bytes) by this method, which is 33.9 kB in `pnpm size`'s unit, against a size budget of 35 kB.

## Size budgets

The size budgets enforced in CI (`.size-limit.json`) are core 19.5 kB, ui without core 16.5 kB and the ui CDN file 35 kB, counted in size-limit's unit (1 kB = 1000 bytes). The AnyDrop rows above were measured against the 2026-11-08 build (CDN file 33.1 kB by this method; 33.9 kB in `pnpm size`). The numbers are measured again when AnyDrop's build or a compared library changes. Size statements are limited to what this page supports.

## Change since the first measurement

Re-measured on 2026-11-08 with the same script and the same library versions (Dropzone, Uppy, FilePond and Resumable.js numbers are identical). AnyDrop, in bytes (gzip level 9): ui + core esbuild bundle 32,519 to 32,529; shipped CDN file 33,916 to 33,926 (+10 bytes, minified 104,107 to 104,139); `style.css` 3,181 to 3,188; headless core unchanged. No rounded figure in the tables above changed except the ui + core minified size (97.4 to 97.5 kB). The figures quoted on the other pages are therefore the same as on 2026-11-07.
