# @vedratech/anydrop-ui

Plain-JavaScript UI for AnyDrop: a drop zone with file and folder pickers, a virtualized folder tree (or flat list), a toolbar, a persistent error panel, thumbnails and a mobile layout. It extends `AnyDropCore` from [`@vedratech/anydrop-core`](https://www.npmjs.com/package/@vedratech/anydrop-core) and is configured like Dropzone.js, so `new Dropzone(el, opts)` becomes `new AnyDrop(el, opts)`.

**Documentation: https://vedratech.github.io/anydrop/** ([quick start](https://vedratech.github.io/anydrop/guide/quick-start), [API reference](https://vedratech.github.io/anydrop/api/), [backend contract](https://vedratech.github.io/anydrop/protocol), [live demo](https://vedratech.github.io/anydrop/demo))

## Install

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core
```

```html
<div id="uploader"></div>
```

```ts
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  sendManifest: true,
  manifestUrl: '/upload/manifest',
  folderView: 'tree',
});
const off = ad.on('queuecomplete', () => console.log(ad.getErrors()));
ad.setOption('folderView', 'flat');
ad.destroy(); // removes all DOM, listeners and timers
```

From a CDN (pin the minor version, add the stylesheet). The script makes `window.AnyDrop` **the class itself** (core included), as `window.Dropzone` is:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>
<script>
  new AnyDrop('#uploader', { url: '/upload' });
</script>
```

The other exports are statics on it: `AnyDrop.AnyDrop`, `AnyDrop.AnyDropCore`, `AnyDrop.VERSION`, `AnyDrop.uiDefaults`, `AnyDrop.DEFAULT_TEMPLATE`. The CDN build also attaches to `.dropzone` and `.anydrop` elements (set `AnyDrop.autoDiscover = false` to stop it). The npm builds never do anything on import (safe for server-side rendering); call `AnyDrop.discover()` yourself.

## What you get

A drop zone (files and folders, paste, click), "Select files" and "Select folder" buttons (the folder button only where the browser supports it), a virtualized tree or flat list with pause, resume, retry and cancel per row, a toolbar, an error panel with JSON and CSV export, lazy thumbnails, a connection banner with a "Retry now" button, a touch layout with 44 px targets, keyboard navigation and screen-reader announcements, dark mode and CSS variables. Every [core option, method and event](https://www.npmjs.com/package/@vedratech/anydrop-core) works too.

## UI options

Types and defaults. Descriptions: [Options reference](https://vedratech.github.io/anydrop/api/options#ui).

| Option | Type | Default |
|---|---|---|
| `clickable` | `boolean \| string \| HTMLElement \| (string \| HTMLElement)[]` | `true` |
| `previewsContainer` | `string \| HTMLElement \| null \| false` | `null` |
| `previewTemplate` | `string` | Dropzone's template |
| `hiddenInputContainer` | `string \| HTMLElement` | `'body'` |
| `addRemoveLinks` | `boolean` | `false` |
| `capture` | `string \| null` | `null` |
| `createImageThumbnails` | `boolean` | `true` |
| `maxThumbnailFilesize` | `number` | `10` |
| `thumbnailWidth` | `number \| null` | `120` |
| `thumbnailHeight` | `number \| null` | `120` |
| `thumbnailMethod` | `'crop' \| 'contain'` | `'crop'` |
| `resizeWidth` | `number \| null` | `null` |
| `resizeHeight` | `number \| null` | `null` |
| `resizeMethod` | `'crop' \| 'contain'` | `'contain'` |
| `resizeMimeType` | `string \| null` | `null` |
| `resizeQuality` | `number` | `0.8` |
| `disablePreviews` | `boolean` | `false` |
| `forceFallback` | `boolean` | `false` |
| `fallback` | `(() => void) \| null` | `null` |
| `init` | `(() => void) \| null` | `null` |
| `folderView` | `'tree' \| 'flat'` | `'tree'` |
| `rowHeight` | `number` | `56` |
| `toolbar` | `boolean` | `true` |
| `errorPanel` | `boolean` | `true` |
| `pickerButtons` | `boolean` | `true` |
| `enablePaste` | `boolean` | `false` |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` |

## Texts

Every text is a `dict*` option, rendered as plain text; `{{name}}` placeholders are replaced. The 52 interface texts with their defaults are listed in the [options reference](https://vedratech.github.io/anydrop/api/options#texts), and the core's message texts in the [core README](https://www.npmjs.com/package/@vedratech/anydrop-core). Names: `dictDefaultMessage`, `dictFallbackMessage`, `dictFallbackText`, `dictFallbackUpload`, `dictCancelUpload`, `dictCancelUploadConfirmation`, `dictRemoveFile`, `dictRemoveFileConfirmation`, `dictThumbnailError`, `dictNoFolderSupport`, `dictSelectFiles`, `dictSelectFolder`, `dictTapToUpload`, `dictPauseAll`, `dictResumeAll`, `dictRetryFailed`, `dictClear`, `dictPause`, `dictResume`, `dictRetry`, `dictExpand`, `dictCollapse`, `dictStatusAdded`, `dictStatusQueued`, `dictStatusUploading`, `dictStatusPaused`, `dictStatusSuccess`, `dictStatusError`, `dictStatusCanceled`, `dictSummary`, `dictFolderCount`, `dictErrorsTitle`, `dictExportJson`, `dictExportCsv`, `dictCopyErrors`, `dictCopied`, `dictCopyFailed`, `dictDismissErrors`, `dictRegionLabel`, `dictListLabel`, `dictToolbarLabel`, `dictAnnounceAdded`, `dictAnnounceComplete`, `dictAnnounceErrors`, `dictAnnounceProgress`, `dictAnnouncePaused`, `dictAnnounceResumed`, `dictOffline`, `dictReconnecting`, `dictRetryNow`, `dictConnectionRestored`, `dictWaitingForConnection`.

## Methods, statics and events added by the UI

| Method | Description |
|---|---|
| `element` | The element the instance is attached to |
| `hiddenFileInput` | The hidden file input that the file picker opens (Dropzone's `hiddenFileInput`) |
| `displayExistingFile(mockFile, imageUrl, callback?, crossOrigin?, resizeThumbnail = true)` | Shows a file that is already on the server as a row at the root |
| `downloadErrors(format?)` | Downloads the error list as a file |
| `copyErrors()` | Copies the error list to the clipboard |

| Static | Description |
|---|---|
| `AnyDrop.options` | Dropzone's `Dropzone.options`: presets for the element with id `my-id` as `AnyDrop.options.myId = { ... }`. `false` stops `discover()` from attaching to that element |
| `AnyDrop.instances` | Every live instance. `destroy()` removes an instance again |
| `AnyDrop.autoDiscover` | Read by the CDN build only: set it to `false` right after the script tag to stop auto-discovery of `.dropzone` and `.anydrop` elements |
| `AnyDrop.discover(root = document)` | Attaches an instance to every `.dropzone` or `.anydrop` element under `root` that has none |
| `AnyDrop.forElement(element)` | The instance attached to an element |
| `AnyDrop.isBrowserSupported()` | Whether the browser has the APIs the UI needs |
| `AnyDrop.supportsFolderPicker()` | Feature detection of the folder picker (`'webkitdirectory' in input`) |
| `AnyDrop.confirm(question, accepted, rejected?)` | Asks a question with `window.confirm` |

- `setOption(name, value)` works at runtime for every UI option. `disable()` and `enable()` also remove and restore the drag, drop, paste and click listeners.
- Events emitted by the UI: `dragstart`, `dragenter`, `dragover`, `dragleave`, `dragend`, `thumbnail`. A DOM `CustomEvent` named `anydrop:<event>` (arguments in `detail`) is dispatched on the element for every event.
- Event handlers passed as options **add** to the built-in rendering; they do not replace it as in Dropzone. Set `disablePreviews: true` to render everything yourself.
- Exports: `AnyDrop`, `uiDefaults()`, `DEFAULT_TEMPLATE`, `VERSION` and the types `AnyDropConfig`, `AnyDropUIOptions`, `AnyDropDict`, `AnyDropFullOptions`, `ElementRef`, `MockFile`.

## Theming

Set CSS variables on the element, for example `#uploader { --ad-color-accent: #7c3aed; }`. Dark mode follows `prefers-color-scheme`; force it with the `theme` option. The variables and classes are listed in [Customising the UI](https://vedratech.github.io/anydrop/guide/customising-ui).

## Mobile and iOS

44 px tap targets, safe-area padding, a layout that holds from 320 px, and a "files only" notice where there is no folder picker (iOS Safari has none). Use `capture: 'environment'` to open the camera. Details and limits: [Mobile and iOS](https://vedratech.github.io/anydrop/guide/mobile-ios).

## Documentation

Everything is on the website: **https://vedratech.github.io/anydrop/**

- [Guide](https://vedratech.github.io/anydrop/guide/introduction) and [quick start](https://vedratech.github.io/anydrop/guide/quick-start)
- [API reference](https://vedratech.github.io/anydrop/api/): [options](https://vedratech.github.io/anydrop/api/options), [methods](https://vedratech.github.io/anydrop/api/methods), [events](https://vedratech.github.io/anydrop/api/events), [error codes](https://vedratech.github.io/anydrop/api/error-codes), [types](https://vedratech.github.io/anydrop/api/types)
- [Backend contract](https://vedratech.github.io/anydrop/protocol), with [Express](https://vedratech.github.io/anydrop/backend/express) and [Laravel](https://vedratech.github.io/anydrop/backend/laravel) examples
- [Migrating from Dropzone](https://vedratech.github.io/anydrop/migrating-from-dropzone)
- [Live demo](https://vedratech.github.io/anydrop/demo)
- [Size comparison](https://vedratech.github.io/anydrop/size-comparison)

## License

MIT © 2026 Jayesh Gupta. Parts adapted from Dropzone (MIT) are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
