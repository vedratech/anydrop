---
title: "Dropzone.js alternative with folder support"
description: "AnyDrop is configured like Dropzone 6 and adds folder upload, a tree view, pause and resume and resume after reload. An honest comparison with sizes."
---

# Dropzone.js alternative with folder support

[Dropzone.js](https://www.dropzone.dev/) is a mature, widely used drag and drop uploader. AnyDrop is built as a drop-in replacement for the common case: it takes Dropzone 6.3.5's options and events, and adds what Dropzone does not have, mainly around folders, pause and resume, and unreliable connections.

## What stays the same

In most pages you swap the script, the stylesheet and the constructor name:

```js
// before
const dz = new Dropzone('#uploader', { url: '/upload', chunking: true });
// after
const ad = new AnyDrop('#uploader', { url: '/upload', chunking: true });
```

Your options, events, `previewTemplate`, `dz-*` classes and `data-dz-*` hooks keep working, and the chunk fields sent to your backend are Dropzone's (`dzuuid`, `dzchunkindex`, ...), so an existing Dropzone chunk backend keeps working. The full list is in [Migrating from Dropzone](/migrating-from-dropzone), including every place where AnyDrop behaves differently on purpose.

## What AnyDrop adds

| | Dropzone 6.3.5 | AnyDrop |
|---|---|---|
| Configured by options and events | yes | yes, same names |
| Chunked uploads with retry | yes (`retryChunks` is off by default) | yes (on by default; whole-file uploads are never auto-retried) |
| Folder tree view, per-folder progress | no | yes |
| Empty folders and a folder manifest for the backend | no | yes (`sendManifest`) |
| Pause and resume (all, a folder, a file) | no | yes |
| Resume after a page reload | no | yes (IndexedDB) |
| Automatic pause when offline or the server is unreachable | no | yes |
| Persistent error list, retry failed only, JSON or CSV export | no | yes |
| Headless core without a UI | no | yes (`@vedratech/anydrop-core`) |

## What Dropzone does better

- **It is smaller.** The numbers below are download sizes. If you only need simple file uploads, Dropzone is the smaller download.
- **It is established.** It has a long history, many tutorials and a large community. AnyDrop is new, at version 0.1.
- **Familiarity.** If your team already knows Dropzone, nothing changes for them.

## Size

Measured the same way for every library (minified and gzipped with esbuild, 1 kB = 1024 bytes, 2026-11-08):

| | JavaScript (gzip) | CSS (gzip) |
|---|---:|---:|
| Dropzone 6.3.5 | 11.7 kB | 1.3 kB |
| AnyDrop ui + core | 31.8 kB | 3.1 kB |
| FilePond 4.32.12 (core, no plugins) | 40.5 kB | 5.2 kB |
| Uppy core + dashboard + xhr-upload | 78.4 kB | 10.4 kB |

AnyDrop with the UI is about 2.7 times the size of Dropzone. The extra size pays for the features in the table above. Method and versions: [size comparison](/size-comparison).

## Which one should you pick?

- Pick **Dropzone** if you need plain file uploads and want the smallest download and the largest ecosystem.
- Pick **AnyDrop** if users upload folders, files are large or connections are unreliable, or people use phones, and you want to keep a Dropzone-style configuration.
- Uppy and FilePond have their own strengths, such as plugin ecosystems and cloud importers, which AnyDrop does not offer. AnyDrop also ships no server: your backend implements a [small HTTP contract](/backend/).

## Related

- [Migrating from Dropzone](/migrating-from-dropzone)
- [Upload a folder in JavaScript](/use-cases/upload-folder-javascript)
