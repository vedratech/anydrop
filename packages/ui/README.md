# @vedratech/anydrop-ui

Plain-JavaScript UI for AnyDrop: a drop zone with file and folder pickers, a virtualized folder tree (or flat list), a toolbar, a persistent error panel, thumbnails, and a mobile layout. It extends `AnyDropCore` from `@vedratech/anydrop-core` and is configured like Dropzone.js, so `new Dropzone(el, opts)` becomes `new AnyDrop(el, opts)`.

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core
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

CDN (pin the minor version, add the stylesheet): `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css"><script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>` makes `window.AnyDrop` **the class itself** (core is included), as `window.Dropzone` is. `new AnyDrop(...)` and `AnyDrop.options.myId = {...}` work. The other exports are statics on it: `AnyDrop.AnyDrop`, `AnyDrop.AnyDropCore` (headless), `AnyDrop.VERSION`, `AnyDrop.uiDefaults`, `AnyDrop.DEFAULT_TEMPLATE`. The CDN build also **auto-discovers** `.dropzone` and `.anydrop` elements (see "Migrating from Dropzone"). The server side is described in the [backend contract](https://github.com/vedratech/anydrop/blob/main/docs/protocol.md), with Express and Laravel examples in the [root README](https://github.com/vedratech/anydrop/blob/main/README.md#backend-examples); the full guide for Dropzone users is [migrating-from-dropzone](https://github.com/vedratech/anydrop/blob/main/docs/migrating-from-dropzone.md).

Nothing touches `window` or `document` at import time (SSR-safe), there is no global state (several instances per page), and `destroy()` removes everything the instance added.

## UI section

### What you get
- **Drop zone.** The element is the drop target: drag states (`dz-drag-hover`), drops of files and folders, paste (images and files pasted into the element), click to open the file dialog.
- **Pickers.** A "Select files" and a "Select folder" button. The folder button exists only where `'webkitdirectory' in input` (feature detection, no user-agent sniffing). Where it does not (iOS Safari), a notice (`dictNoFolderSupport`) explains that only files can be selected.
- **List.** `folderView: 'tree'` shows a collapsible tree with a progress bar, status badge, and pause / resume / retry / cancel buttons per folder and per file. `'flat'` shows files only, with their full path. Both are virtualized (only the rows near the viewport are in the DOM), so 5,000+ files stay smooth.
- **Toolbar.** Summary, total progress, Pause all, Resume all, Retry failed, Clear.
- **Error panel.** Appears when `getErrors()` is not empty: one row per failed file with its reason, Retry failed, Export JSON, Export CSV (downloads), Copy list, Dismiss.
- **Thumbnails.** Lazy (only rows on screen), at most two at a time, capped by `maxThumbnailFilesize` and 512 px, object URLs revoked at once, HEIC/HEIF recognised by extension when the MIME type is empty. A browser that cannot decode the image shows `dictThumbnailError`.
- **Touch.** On a coarse pointer (or without drag and drop) the zone becomes one full-width "tap to upload" button.

### Options
Every core option works too (see `@vedratech/anydrop-core`). UI options:

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `clickable` | `boolean \| string \| HTMLElement \| (string \| HTMLElement)[]` | `true` | `true` (the element), `false`, a selector (every match, `querySelectorAll`), an element, or an array. Clicking opens the file dialog. A selector that matches nothing throws. |
| `previewsContainer` | `string \| HTMLElement \| null \| false` | `null` | Where the toolbar, list and error panel go. `null` = inside the element. `false` = no previews (like `disablePreviews`). A selector that matches nothing throws. |
| `previewTemplate` | `string` | Dropzone's template | One file's preview. The `data-dz-name`, `data-dz-size`, `data-dz-thumbnail`, `data-dz-uploadprogress`, `data-dz-errormessage` and `data-dz-remove` hooks are filled in. Dropzone's own default template works unchanged. |
| `hiddenInputContainer` | `string \| HTMLElement` | `'body'` | Where the hidden `<input type=file>` elements go. |
| `addRemoveLinks` | `boolean` | `false` | Adds a `dz-remove` link to each preview ("Remove file" / "Cancel upload"). |
| `dictRemoveFileConfirmation` | `string \| null` | `null` | Question asked before removing a finished file, through `AnyDrop.confirm`. |
| `capture` | `string \| null` | `null` | Passed to the file input (`'environment'`, `'user'`) for camera uploads. |
| `createImageThumbnails` | `boolean` | `true` | |
| `maxThumbnailFilesize` | `number` (MiB) | `10` | Larger images get no thumbnail. |
| `thumbnailWidth`, `thumbnailHeight` | `number \| null` | `120`, `120` | Capped at 512 px. Both `null` = natural size, still capped at 512 px (memory). |
| `thumbnailMethod` | `'crop' \| 'contain'` | `'crop'` | |
| `resizeWidth`, `resizeHeight`, `resizeMethod`, `resizeMimeType`, `resizeQuality` | `number \| null`, `number \| null`, `'crop' \| 'contain'`, `string \| null`, `number` | `null`, `null`, `'contain'`, `null`, `0.8` | Images are scaled down before upload, as the default `transformFile`. Your own `transformFile` wins. |
| `disablePreviews` | `boolean` | `false` | No preview elements, no list, no toolbar, no error panel. The zone and the pickers still work. `thumbnail` events still fire for every accepted image. |
| `forceFallback`, `fallback()` | `boolean`, `function \| null` | `false`, `null` | Renders a plain form with a file input, as Dropzone does, when the browser lacks File/FormData/... or when forced. |
| `init()` | `function \| null` | `null` | Called at the end of the constructor with `this` = the instance. |
| `folderView` | `'tree' \| 'flat'` | `'tree'` | Changeable with `setOption`. |
| `rowHeight` | `number` (px) | `56` | Use a larger value for a taller `previewTemplate`. |
| `toolbar`, `errorPanel` | `boolean` | `true`, `true` | Show the toolbar / the error panel. |
| `pickerButtons` | `boolean` | `true` | The "Select files" and "Select folder" buttons. They appear only when the element itself is the clickable (`clickable: true`). |
| `enablePaste` | `boolean` | `false` | Add files pasted into the element (Dropzone 6.3.5 does not wire `paste` either). |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `'auto'` follows `prefers-color-scheme`. |

Resize limits: the resize re-encodes the image, so EXIF data (orientation, GPS) is lost (the pixels are drawn upright by the browser). Dropzone's `resize(file, w, h, method)` override and `resizeTransparencyFill` are not supported. A `transformFile` applies to every file, so with `resize*` set no file can be chunk-resumed after a reload (a transform may produce different bytes on each run).

The `url` may come from a `<form action>`; without any url the constructor throws `No URL provided.` (Dropzone). Options are merged deeply (`dictFileSizeUnits`, `headers`, ...).

### Statics, properties and exports
- `AnyDrop.options.myId = {...}` presets options for the element with id `my-id` (`camelize` as in Dropzone); `false` stops `discover()` from attaching to it.
- `AnyDrop.forElement(el)`, `AnyDrop.instances` (live instances), `AnyDrop.isBrowserSupported()`, `AnyDrop.supportsFolderPicker()`, `AnyDrop.confirm(question, accepted, rejected?)` (override it to use your own dialog), `AnyDrop.discover(root = document)`, `AnyDrop.autoDiscover`.
- Instance: `ad.element` (also `element.anydrop` and Dropzone's alias `element.dropzone`), `ad.hiddenFileInput`.
- Exports: `AnyDrop`, `uiDefaults()` (the default UI options), `DEFAULT_TEMPLATE` (the default preview markup), and the types `AnyDropConfig`, `AnyDropUIOptions`, `AnyDropDict`, `MockFile` (the object `displayExistingFile` takes: `{ name, size, ... }`).

### Texts (`dict*`)
All text is an option, so it can be translated. Texts are rendered as plain text, not HTML (Dropzone renders `dictDefaultMessage` as HTML); to put markup in the drop message, put your own `<div class="dz-message">...</div>` in the page and it is used as is. Core's texts (`dictFileTooBig`, `dictInvalidFileType`, `dictMaxFilesExceeded`, `dictResponseError`, `dictUploadCanceled`, `dictFileUnreadable`, `dictInvalidPath`, `dictFileSizeUnits`) are listed in the core README. A `{{name}}` placeholder is replaced by the value of that name.

| Option | Default | Notes |
| --- | --- | --- |
| `dictDefaultMessage` | `Drop files here to upload` |  |
| `dictFallbackMessage` | `Your browser does not support drag'n'drop file uploads.` |  |
| `dictFallbackText` | `Please use the fallback form below to upload your files like in the olden days.` |  |
| `dictFallbackUpload` | `Upload!` | Button of the fallback form |
| `dictCancelUpload` | `Cancel upload` | `addRemoveLinks` link while uploading |
| `dictCancelUploadConfirmation` | `Are you sure you want to cancel this upload?` |  |
| `dictRemoveFile` | `Remove file` | `addRemoveLinks` link when finished |
| `dictRemoveFileConfirmation` | `null` | Question asked before removing a finished file; `null` = no question |
| `dictThumbnailError` | `Failed to load the image. The file may be corrupted.` | Screen-reader text and tooltip |
| `dictNoFolderSupport` | `This browser can only select files, not folders. Pick the files you need, or use a desktop browser to upload a whole folder.` | Notice where there is no folder picker (iOS) |
| `dictSelectFiles` | `Select files` |  |
| `dictSelectFolder` | `Select folder` |  |
| `dictTapToUpload` | `Tap to upload` | The zone on touch devices |
| `dictPauseAll` | `Pause all` |  |
| `dictResumeAll` | `Resume all` |  |
| `dictRetryFailed` | `Retry failed` |  |
| `dictClear` | `Clear` |  |
| `dictPause` | `Pause` |  |
| `dictResume` | `Resume` |  |
| `dictRetry` | `Retry` |  |
| `dictExpand` | `Expand folder` |  |
| `dictCollapse` | `Collapse folder` |  |
| `dictStatusAdded` | `Added` |  |
| `dictStatusQueued` | `Queued` |  |
| `dictStatusUploading` | `Uploading` |  |
| `dictStatusPaused` | `Paused` |  |
| `dictStatusSuccess` | `Done` |  |
| `dictStatusError` | `Failed` |  |
| `dictStatusCanceled` | `Canceled` |  |
| `dictSummary` | `{{done}} of {{total}} uploaded, {{failed}} failed` | `{{done}}`, `{{total}}`, `{{failed}}` |
| `dictFolderCount` | `{{done}}/{{total}}` | `{{done}}`, `{{total}}` |
| `dictErrorsTitle` | `{{count}} failed` | `{{count}}` |
| `dictExportJson` | `Export JSON` |  |
| `dictExportCsv` | `Export CSV` |  |
| `dictCopyErrors` | `Copy list` |  |
| `dictCopied` | `Copied to the clipboard.` |  |
| `dictCopyFailed` | `Could not copy the list.` |  |
| `dictDismissErrors` | `Dismiss list` |  |
| `dictRegionLabel` | `File upload` | Accessible name of the zone |
| `dictListLabel` | `Files to upload` | Accessible name of the list |
| `dictToolbarLabel` | `Upload actions` | Accessible name of the toolbar |
| `dictAnnounceAdded` | `{{count}} files added.` | Screen-reader message; `{{count}}` |
| `dictAnnounceComplete` | `Upload complete.` | Screen-reader message |
| `dictAnnounceErrors` | `{{count}} files failed.` | Screen-reader message; `{{count}}` |
| `dictAnnounceProgress` | `Uploading, {{percent}} percent.` | Screen-reader message; `{{percent}}` |
| `dictAnnouncePaused` | `Upload paused.` | Screen-reader message |
| `dictAnnounceResumed` | `Upload resumed.` | Screen-reader message |
| `dictOffline` | `You are offline. Uploads will continue when you are back online.` | Connection banner, browser offline |
| `dictReconnecting` | `Connection lost. Retrying in {{seconds}} s` | Connection banner, server unreachable; `{{seconds}}` |
| `dictRetryNow` | `Retry now` | Banner button, calls `reconnect()` |
| `dictConnectionRestored` | `Connection restored` | Announced when the banner hides |
| `dictWaitingForConnection` | `Waiting for connection` | Row text instead of "Paused" while only the system holds the file |

### Methods and events added by the UI
- `displayExistingFile(mockFile, imageUrl, callback?, crossOrigin?, resizeThumbnail = true)`: shows a file already on the server as a root row. It is not added to `files`, the tree or a manifest. `removeFile(mockFile)` removes the row.
- `disable()` / `enable()`: besides core's behaviour, remove or add the drag, drop, paste and click listeners, the `dz-clickable` classes, and disable the buttons.
- `setOption(name, value)` works at runtime for every UI option (`dict*`, `folderView`, `previewTemplate`, `clickable`, `folders`, ...).
- `downloadErrors('json' | 'csv')`, `copyErrors()`.
- A DOM `CustomEvent` named `anydrop:<event>` (with `detail` = the event arguments) is dispatched on the element for every event, like Dropzone's `dropzone:<event>`.
- The default `canceled` handling shows `dictUploadCanceled` in the preview. It does not emit `error`; listen to `canceled` when porting code that relied on Dropzone's `error`.
- Event handlers passed as options **add** to the built-in rendering, they do not replace it (Dropzone replaces its default handler). To take over rendering completely, set `disablePreviews: true`.
- `file.previewElement` (and Dropzone's alias `file.previewTemplate`) is created the first time it is read or the row scrolls into view, not on `addedfile`. Once user code has read or assigned `previewElement`, that element is kept. Other elements are rebuilt from the file's state when needed: with more than 400 rows, the element of a row that scrolled away is dropped. Rows that stay at the same place survive a rebuild.

### Keyboard and accessibility
The list is one focus stop (`role="tree"`, `aria-activedescendant`): Up/Down/Home/End/PageUp/PageDown move, Right/Left expand/collapse or move to the parent, Enter/Space toggle a folder, `p` pause or resume, `r` retry, Delete cancel or remove. Every button is also reachable with Tab and has an accessible name. Progress and errors are announced through a polite live region (`role="status"`); progress is announced every 10 %. Focus rings are visible, colours meet WCAG AA in the light and the dark theme, and rows have `aria-level`, `aria-posinset`, `aria-setsize`, `aria-expanded`.

### Theming: CSS variables
Set them on the element (or any ancestor), for example `#uploader { --ad-color-accent: #7c3aed; }`.

| Variable | Meaning |
| --- | --- |
| `--ad-color-bg`, `--ad-color-surface`, `--ad-color-text`, `--ad-color-muted` | Backgrounds and text |
| `--ad-color-border`, `--ad-color-border-soft` | Strong and soft borders |
| `--ad-color-accent`, `--ad-color-on-accent`, `--ad-color-hover` | Primary colour, text on it, hover background |
| `--ad-color-success`, `--ad-color-error`, `--ad-color-warning` | Status colours |
| `--ad-color-track`, `--ad-color-focus` | Progress track, focus ring |
| `--ad-radius`, `--ad-gap`, `--ad-target` | Corner radius, spacing, minimum tap target (44px) |
| `--ad-font`, `--ad-list-max-height`, `--ad-indent` | Font, list height (420px), tree indent per level (20px) |

Dark mode follows `prefers-color-scheme`; force it with the `theme` option or `data-ad-theme="light|dark"`.

### CSS classes
Our rules for the rows are written with a higher specificity than `dropzone.css`, so the two can be loaded together, but Dropzone's styles for its own card layout are not needed. Dropzone's classes are set too, so Dropzone stylesheets keep working: on the element `dz-clickable`, `dz-started`, `dz-drag-hover`, `dz-max-files-reached`, `dz-disabled`, `dz-browser-not-supported`; on previews `dz-preview`, `dz-processing`, `dz-success`, `dz-error`, `dz-complete`, `dz-image-preview`. Each is also set with our prefix (`ad-started`, `ad-drag-hover`, `ad-success`, ...). Our own hooks:

`ad-root` (element), `ad-touch` (touch layout), `ad-message`, `ad-message-text`, `ad-actions`, `ad-btn`, `ad-btn-primary`, `ad-icon-btn`, `ad-link-btn`, `ad-notice` (the folders-not-supported notice), `ad-panel`, `ad-toolbar`, `ad-summary`, `ad-toolbar-actions`, `ad-progress`, `ad-bar`, `ad-list`, `ad-spacer`, `ad-row` with `ad-folder-row` / `ad-file-row`, `ad-row-active`, `ad-s-<status>` (row status), `ad-caret` / `ad-open`, `ad-folder-name`, `ad-count`, `ad-badge`, `ad-row-actions`, `ad-errors`, `ad-errors-head`, `ad-errors-title`, `ad-errors-actions`, `ad-error-list`, `ad-error-row`, `ad-error-path`, `ad-error-reason`, `ad-live`, `ad-sr-only`, `ad-thumb-error`.

Buttons carry `data-ad-action` (`pick-files`, `pick-folder`, `pause-all`, `resume-all`, `retry-failed`, `clear`, `pause`, `resume`, `retry`, `cancel`, `toggle`, `export-json`, `export-csv`, `copy-errors`, `dismiss-errors`); the hidden inputs carry `data-ad-input="files|folder"`.

### Combine with a form
Use a `<form>` as the element (`<form action="/upload" class="dropzone" id="my-form">`). Its `action` is the `url`, and every named field of the form (`input`, `textarea`, `select`, `button`; unchecked boxes and radios are skipped) is added **once per request**, also with `uploadMultiple`. A `<div class="fallback">` inside the element is removed when the browser is supported and shown otherwise.

### Migrating from Dropzone
1. Replace `Dropzone` by `AnyDrop`: `new AnyDrop('#el', opts)`, `AnyDrop.options.myId = {}`, `AnyDrop.forElement(el)`. Your `dict*`, `previewTemplate`, `clickable`, `previewsContainer`, `init`, `accept`, `maxFilesize` and `thumbnail*` options keep working. Dropzone's own `dropzone.css` is not needed: ours styles the rows (our rules are written to win over `dropzone.css` when both are loaded, but load ours instead).
2. **autoDiscover.** The CDN build behaves like Dropzone: after the page loads it attaches to every `.dropzone` and `.anydrop` element (reading `AnyDrop.options[id]`), unless `AnyDrop.autoDiscover = false` is set right after the script tag. An element that already has an instance is skipped (Dropzone throws). The npm builds (ESM, CJS) never do this on import (SSR-safe); call `AnyDrop.discover()` yourself.
3. **Option handlers add, they do not replace.** In Dropzone, `addedfile`, `error`, `thumbnail`, `success`... given as options replace the default handler (and the default rendering). Here they run in addition to the built-in rendering, so a handler that builds its own preview now renders twice. Set `disablePreviews: true` to render everything yourself, or drop your handler. To keep a default behaviour, there is nothing to call: it already happens.
4. `canceled` no longer emits `error`; listen to `canceled`. `on()` returns an unsubscribe function (with `.on` and `.once` for chaining, without `.off`).
5. New: folders. Add `folders: true` (default) and, for a backend that wants the tree, `sendManifest` and `manifestUrl`.
6. Paste is off by default, as in Dropzone: set `enablePaste: true`.
7. Dropzone's `resize()` override and `resizeTransparencyFill` do not exist; a resize loses EXIF data.

### Connection banner
While the core reports that the browser is `offline` or the server is `unreachable`, a banner above the toolbar shows `dictOffline`, or `dictReconnecting` with a countdown (`{{seconds}}`, updated once a second from `retryAt`) and a **Retry now** button (`dictRetryNow`, 44px, keyboard operable) that calls `reconnect()`. When the connection returns the banner hides and `dictConnectionRestored` is announced. Files paused only by the system show `dictWaitingForConnection` instead of `dictStatusPaused`; files paused by the user keep "Paused". The live region announces state changes only, never the countdown ticks. The banner follows the CSS variables (dark mode included), the safe areas, and `prefers-reduced-motion` (no pulsing dot). It uses `getConnectionState()`, `reconnect()` and the `reconnecting` event of `@vedratech/anydrop-core`. Classes: `ad-banner`, `ad-banner-text`, `ad-banner-btn`. To test, use DevTools, Network, Offline, or the demo's "Offline and network" section.

### Pause, resume and retry
The buttons call `pause`, `resume`, `pauseFolder`, `resumeFolder`, `pauseFile`, `cancelFolder` and `retryFailedOnly` of the core Retrying one file calls `retryFile(file)`. During an outage (offline or server unreachable) the files are paused by the system, and the Pause buttons on rows, folders and the toolbar stay available: a pause the user makes then survives the reconnect, while the system pause ends by itself. Pausing a folder repaints the rows of its files at once.

### Mobile and iOS
44 px minimum tap targets, no hover-only controls, a layout that holds from 320 px, `env(safe-area-inset-*)` padding, inputs at 16 px or more, `touch-action` tuned so scrolling the list never triggers a tap, and the "files only" notice on browsers without a folder picker. Use `capture: 'environment'` to open the camera.
