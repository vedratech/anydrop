# @vedratech/anydrop-ui

**Folder upload UI for the browser: drag and drop folders, chunked and resumable uploads, pause and resume, retry. Part of [AnyDrop](https://github.com/vedratech/anydrop).**

[![npm version](https://img.shields.io/npm/v/@vedratech/anydrop-ui.svg)](https://www.npmjs.com/package/@vedratech/anydrop-ui)
[![npm downloads](https://img.shields.io/npm/dm/@vedratech/anydrop-ui.svg)](https://www.npmjs.com/package/@vedratech/anydrop-ui)
[![bundle size](https://deno.bundlejs.com/badge?q=@vedratech/anydrop-ui)](https://bundlejs.com/?q=@vedratech/anydrop-ui)
[![CI](https://github.com/vedratech/anydrop/actions/workflows/ci.yml/badge.svg)](https://github.com/vedratech/anydrop/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/@vedratech/anydrop-ui.svg)](https://github.com/vedratech/anydrop/blob/main/LICENSE)
[![docs](https://img.shields.io/badge/docs-vedratech.github.io%2Fanydrop-1d4ed8.svg)](https://vedratech.github.io/anydrop/)

Plain-JavaScript UI for AnyDrop: a drop zone with file and folder pickers, a virtualized folder tree (or flat list), a toolbar, a persistent error panel, thumbnails and a mobile layout. It extends `AnyDropCore` from [`@vedratech/anydrop-core`](https://www.npmjs.com/package/@vedratech/anydrop-core) and is configured with plain options: `new AnyDrop(el, opts)`.

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

From a CDN (pin the minor version, add the stylesheet). The script makes `window.AnyDrop` **the class itself** (core included):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>
<script>
  new AnyDrop('#uploader', { url: '/upload' });
</script>
```

The other exports are statics on it: `AnyDrop.AnyDrop`, `AnyDrop.AnyDropCore`, `AnyDrop.VERSION`, `AnyDrop.uiDefaults`, `AnyDrop.DEFAULT_TEMPLATE`. The CDN build also attaches to `.anydrop` elements (set `AnyDrop.autoDiscover = false` to stop it). The npm builds never do anything on import (safe for server-side rendering); call `AnyDrop.discover()` yourself.

## What you get

A drop zone (files and folders, paste, click), "Select files" and "Select folder" buttons (the folder button only where the browser supports it), a virtualized tree or flat list with pause, resume, retry and cancel per row, a toolbar, an error panel with JSON and CSV export, lazy thumbnails, a connection banner with a "Retry now" button, a touch layout with 44 px targets, keyboard navigation and screen-reader announcements, dark mode and CSS variables. Every [core option, method and event](https://www.npmjs.com/package/@vedratech/anydrop-core) works too.

## UI options

Types and defaults. Descriptions: [Options reference](https://vedratech.github.io/anydrop/api/options#ui).

| Option | Type | Default |
|---|---|---|
| `clickable` | `boolean \| string \| HTMLElement \| (string \| HTMLElement)[]` | `true` |
| `previewsContainer` | `string \| HTMLElement \| null \| false` | `null` |
| `previewTemplate` | `string` | Markup of one file preview; the `data-ad-*` hooks are filled in |
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
| `rowHeight` | `number \| null` | `null` (the layout's height: 56, compact 48) |
| `layout` | `'list' \| 'compact'` | `'list'` |
| `render` | `{ file, folder, toolbar, message, errorItem }` | `{}` |
| `rowActions` | `{ file, folder }` lists of built-in ids and custom actions | all built-ins |
| `icons` | `Record<string, string> \| (name) => string \| HTMLElement \| null \| undefined \| null` | `null` |
| `errorRowHeight` | `number` | `64` |
| `toolbar` | `boolean` | `true` |
| `errorPanel` | `boolean` | `true` |
| `pickerButtons` | `boolean` | `true` |
| `enablePaste` | `boolean` | `false` |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` |
| `themePreset` | `string \| null` | `null` |
| `locale` | `AnyDropLocale \| string \| null` | `null` (English) |
| `dir` | `'auto' \| 'ltr' \| 'rtl'` | `'auto'` |

The customisation options (`render`, `layout`, `rowActions`, `icons`, `locale`, `dir`, `themePreset`, `errorRowHeight`) are described under [Customising the UI](#customising-the-ui).

## Texts

Every text is a `dict*` option, rendered as plain text; `{{name}}` placeholders are replaced. The 52 interface texts with their defaults are listed in the [options reference](https://vedratech.github.io/anydrop/api/options#texts), and the core's message texts in the [core README](https://www.npmjs.com/package/@vedratech/anydrop-core). Names: `dictDefaultMessage`, `dictFallbackMessage`, `dictFallbackText`, `dictFallbackUpload`, `dictCancelUpload`, `dictCancelUploadConfirmation`, `dictRemoveFile`, `dictRemoveFileConfirmation`, `dictThumbnailError`, `dictNoFolderSupport`, `dictSelectFiles`, `dictSelectFolder`, `dictTapToUpload`, `dictPauseAll`, `dictResumeAll`, `dictRetryFailed`, `dictClear`, `dictPause`, `dictResume`, `dictRetry`, `dictExpand`, `dictCollapse`, `dictStatusAdded`, `dictStatusQueued`, `dictStatusUploading`, `dictStatusPaused`, `dictStatusSuccess`, `dictStatusError`, `dictStatusCanceled`, `dictSummary`, `dictFolderCount`, `dictErrorsTitle`, `dictExportJson`, `dictExportCsv`, `dictCopyErrors`, `dictCopied`, `dictCopyFailed`, `dictDismissErrors`, `dictRegionLabel`, `dictListLabel`, `dictToolbarLabel`, `dictAnnounceAdded`, `dictAnnounceComplete`, `dictAnnounceErrors`, `dictAnnounceProgress`, `dictAnnouncePaused`, `dictAnnounceResumed`, `dictOffline`, `dictReconnecting`, `dictRetryNow`, `dictConnectionRestored`, `dictWaitingForConnection`.

## Methods, statics and events added by the UI

| Method | Description |
|---|---|
| `element` | The element the instance is attached to |
| `hiddenFileInput` | The hidden file input that the file picker opens |
| `displayExistingFile(mockFile, imageUrl, callback?, crossOrigin?, resizeThumbnail = true)` | Shows a file that is already on the server as a row at the root |
| `downloadErrors(format?)` | Downloads the error list as a file |
| `copyErrors()` | Copies the error list to the clipboard |

| Static | Description |
|---|---|
| `AnyDrop.options` | Presets for the element with id `my-id` as `AnyDrop.options.myId = { ... }`. `false` stops `discover()` from attaching to that element |
| `AnyDrop.instances` | Every live instance. `destroy()` removes an instance again |
| `AnyDrop.autoDiscover` | Read by the CDN build only: set it to `false` right after the script tag to stop auto-discovery of `.anydrop` elements |
| `AnyDrop.discover(root = document)` | Attaches an instance to every `.anydrop` element under `root` that has none |
| `AnyDrop.locales` | Language packs by code (`AnyDrop.locales.ar = ar`); the CDN files `locales/<code>.global.js` fill it |
| `AnyDrop.forElement(element)` | The instance attached to an element |
| `AnyDrop.isBrowserSupported()` | Whether the browser has the APIs the UI needs |
| `AnyDrop.supportsFolderPicker()` | Feature detection of the folder picker (`'webkitdirectory' in input`) |
| `AnyDrop.confirm(question, accepted, rejected?)` | Asks a question with `window.confirm` |

- `setOption(name, value)` works at runtime for every UI option. `disable()` and `enable()` also remove and restore the drag, drop, paste and click listeners.
- Events emitted by the UI: `dragstart`, `dragenter`, `dragover`, `dragleave`, `dragend`, `thumbnail`, `actionclicked(action, target)`. A DOM `CustomEvent` named `anydrop:<event>` (arguments in `detail`) is dispatched on the element for every event.
- Event handlers passed as options **add** to the built-in rendering; they do not replace it. Set `disablePreviews: true` to render everything yourself.
- Exports: `AnyDrop`, `uiDefaults()`, `DEFAULT_TEMPLATE`, `VERSION` and the types `AnyDropConfig`, `AnyDropUIOptions`, `AnyDropDict`, `AnyDropFullOptions`, `ElementRef`, `MockFile`, `AnyDropLayout`, `AnyDropLocale`, `AnyDropTexts`, `AnyDropIcons`, `AnyDropIconName`, `AnyDropRenderHooks`, `AnyDropRenderHook`, `AnyDropRenderView`, `AnyDropRenderResult`, `AnyDropRenderContext`, `AnyDropFileContext`, `AnyDropFolderContext`, `AnyDropToolbarContext`, `AnyDropMessageContext`, `AnyDropErrorItemContext`, `AnyDropRowAction`, `AnyDropFileAction`, `AnyDropFolderAction`.

## Customising the UI

Everything below works at runtime with `setOption()`. Changing `render`, `rowActions`, `icons`, `layout` or `errorRowHeight` rebuilds the list (every view gets `destroy()`, the scroll position is not kept).

### Render hooks

`render` replaces or decorates one part of the UI. A hook is a function that gets a context (`ctx`) and runs with `this` = the instance. It returns one of:

| Return value | Effect |
|---|---|
| nothing, `null` | The default content. The hook may decorate it through `ctx.parts` or `ctx.row`. No `update` or `destroy` calls. |
| an `HTMLElement` | Replaces the default content. Static: it gets no `update` calls. |
| `{ el, update?, destroy? }` | Replaces the default content with `el`; `update(ctx)` is called when the item changed, `destroy()` once before `el` leaves the DOM. |
| `{ update?, destroy? }` (no `el`) | Keeps the default content and only gets `update` and `destroy`. |
| a `string` | Shown as **plain text** (never as HTML). |

Hooks: `render.file`, `render.folder`, `render.toolbar`, `render.message` (the drop message, which is also the empty state) and `render.errorItem` (one row of the error panel).

```ts
// Decorate: add a tag to the default row, and undo it in destroy().
new AnyDrop('#uploader', {
  url: '/upload',
  render: {
    file(ctx) {
      const tag = ctx.html`<b class="tag">${ctx.file.type || 'file'}</b>`;
      ctx.parts.preview.appendChild(tag);
      return { destroy: () => tag.remove() };
    },
  },
});

// Replace: update the same element in place (focus inside it survives progress updates).
ad.setOption('render', {
  file(ctx) {
    const el = ctx.html`<div><strong>${ctx.label}</strong> <span class="pct"></span></div>`;
    el.appendChild(ctx.parts.actions); // the built-in 44px buttons, still painted by AnyDrop
    const pct = el.querySelector('.pct');
    const paint = (c) => (pct.textContent = c.status === 'error' ? c.errorMessage : Math.round(c.progress) + '%');
    paint(ctx);
    return { el, update: paint };
  },
});
```

Every context has `instance`, `layout`, `t(key, vars?)` (a `dict*` text with `{{name}}` filled in), `html` and `icon(name)`.

- `ctx.html` is a tagged template that builds DOM from markup. Every `${value}` is HTML-escaped, so a crafted file name cannot inject script. It returns the single top-level element, or a `<div>` around several nodes.
- File context: `file`, `label`, `sizeText`, `status`, `statusText`, `waiting`, `progress`, `error`, `errorMessage`, `thumbnail`, `depth`, `active`, `row`, `parts { preview, badge, actions }`, `can { pause, resume, retry, cancel, remove }` and `pause()`, `resume()`, `retry()`, `cancel()`, `remove()` (the built-in actions; a call that does not apply does nothing).
- Folder context: `folder`, `label`, `status`, `statusText`, `waiting`, `progress`, `depth`, `active`, `row`, `counts`, `expanded`, `toggle()`, `parts { toggle, main, badge, actions }`, `can`, `pause()`, `resume()`, `retry()`, `cancel()`.
- Toolbar context: `el`, `parts { info, actions }`, `counts`, `progress`, `summaryText`, `can`, `pauseAll()`, `resumeAll()`, `retryFailed()`, `clear()`. Message context: `el`, `parts { text }`, `text`, `touch`, `dragging`, `disabled`, `maxFilesReached`, `hasFiles`, `canPickFolder`, `pickFiles()`, `pickFolder()`. Error item context: `entry`, `index`, `file`, `row`, `parts { text, retry }`, `retry()`.

Rules:

- The row container (`.ad-row`, `.ad-error-row`) belongs to the library: do not change its `role`, `id`, `aria-*`, `data-status`, `style.top` or `style.height`.
- Rows are virtualized: a hook runs when a row scrolls into view, and `destroy()` runs when it scrolls away or the list is rebuilt. **Undo decorations in `destroy()`**, because the default preview element is re-used.
- A hook (or `update`, or `destroy`) that throws is reported and ignored; a throwing hook leaves the default content.
- Content must fit the row (`rowHeight`, `errorRowHeight`); overflow is hidden. Interactive elements must be native `<button>` or `<a>` and at least 44 x 44 px (use the classes `ad-btn` or `ad-btn ad-icon-btn`).
- A replacing hook should render readable text, or set `aria-label` on `ctx.row`.
- Clicks on `button`, `a`, `input`, `select`, `textarea` or `[data-ad-action]` inside a custom message do not open the file picker.

### Row actions

`rowActions` chooses the buttons of file rows and folder rows, and their order. Each entry is a built-in id or an object. Giving only `file` keeps the default `folder` list; an empty array shows no buttons.

```ts
rowActions: {
  file: [
    'pause', 'resume', 'retry', 'cancel',
    { id: 'remove', onClick(ctx) { if (askUser()) ctx.remove(); } }, // override a built-in
    {
      id: 'open',                       // custom: lower-case kebab-case, becomes data-ad-action="open"
      label: 'Open in new tab',         // text, or (ctx) => text
      icon: 'external',                 // a name from `icons`, or SVG markup
      when: (ctx) => ctx.status === 'success',
      onClick: (ctx, event) => window.open(myUrlFor(ctx.file)),
    },
  ],
}
```

| Built-in id | Rows | Shown when | Does |
|---|---|---|---|
| `pause` | file, folder | it can be paused | `pauseFile`, `pauseFolder` |
| `resume` | file, folder | it was paused by the user | `resumeFile`, `resumeFolder` |
| `retry` | file, folder | it failed and can be retried | `retryFile`, `retryFailedOnly(path)` |
| `cancel` | file, folder | the upload is not finished | `cancelUpload`, `cancelFolder` |
| `remove` | file | `success`, `error` or `canceled` | `removeFile` |

An object with a built-in `id` overrides it: `label`, `icon` and `when` default to the built-in's (`when` is AND-ed with the built-in rule), and `onClick` replaces its handler. `toggle` is reserved. The keyboard shortcuts follow the configuration: `p` runs `resume` when it applies, else `pause`; `r` runs `retry`; Delete or Backspace runs `cancel` when it applies, else `remove`. A shortcut does nothing when its action is not configured, and an override's `onClick` runs for its shortcut too.

The event `actionclicked(action, target)` fires before any row action runs (button or shortcut, built-in or custom). `target` is the file or the folder. It is also dispatched as the DOM event `anydrop:actionclicked`. It cannot be cancelled: override the action to change or stop it.

Hidden buttons keep their place in the DOM (`hidden` attribute), so focus does not jump. When a focused button is hidden (cancel gives way to remove), the focus moves to the button that is shown.

### Icons

`icons` replaces the built-in SVGs: a record of SVG strings, or a function that returns SVG markup or an element (`null` or `undefined` = the built-in icon). Names: `folder`, `file`, `toggle`, `pause`, `resume`, `retry`, `cancel`, `remove`, `success`, `error`; custom row actions may use any other name.

```ts
icons: { retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="..."/></svg>' }
icons: (name) => myIconSet[name] // string, element (a new one per call) or undefined
```

**Icons are trusted developer input, never user data**: a string is inserted as HTML. Every icon is wrapped in `<span class="ad-icon" aria-hidden="true">`; buttons keep their `aria-label`. Built-in SVGs use `fill="currentColor"`; the stylesheet sets only the size (`--ad-icon-size`), so stroke-based icons render as drawn. The success and error marks of a preview (shown by custom CSS) and the `file` icon of a non-image thumbnail come from `icons` too.

### Layouts

| `layout` | Look |
|---|---|
| `'list'` (default) | One row per file: thumbnail (the `file` icon for non-images), name, size, badge, buttons. 56 px rows. |
| `'compact'` | 48 px rows, no thumbnail, the size on the line of the name (under it on a phone), a smaller badge. The buttons stay 44 x 44 px. |

`rowHeight` is `null` by default, which means the height of the layout; a number overrides it in every layout. Both layouts are virtualized (10,000 rows keep the DOM small) and work with `previewTemplate`, render hooks and row actions. The panel gets the class `ad-layout-<name>`. `errorRowHeight` (default `64`) is the height of a row of the error panel.

### Languages and right-to-left text

```ts
import { AnyDrop } from '@vedratech/anydrop-ui';
import { ar } from '@vedratech/anydrop-ui/locales/ar';
new AnyDrop('#uploader', { url: '/upload', locale: ar }); // lang="ar" dir="rtl"
```

Language packs are separate modules (`@vedratech/anydrop-ui/locales/<code>`) that import nothing, so they cost nothing in your bundle until you use one. Files: `en`, `hi`, `es`, `fr`, `de`, `pt-BR` (export `ptBR`), `ja`, `zh-CN` (export `zhCN`) and `ar` (right to left); each also has a default export. Every pack except `en` is a draft that waits for a native review. From a CDN, load the pack after the main script; it registers itself in `AnyDrop.locales`:

```html
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/index.global.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/locales/ar.global.js"></script>
<script>new AnyDrop('#uploader', { url: '/upload', locale: 'ar' });</script>
```

- `locale` is a pack object, a registered code (`AnyDrop.locales[code]`), or `null` (built-in English). `'en'` also means English. An unknown code logs a warning and uses English.
- Precedence: built-in English, then the pack, then the `dict*` options you set (constructor, `AnyDrop.options` preset or `setOption('dictX', ...)`). `setOption('locale', x)` rewrites every other text and keeps yours.
- Spreading also works: `new AnyDrop(el, { url, ...ar.dict })` (no `lang` or `dir` then).
- `dir` is `'auto'` (default), `'ltr'` or `'rtl'`. `auto` follows the locale, or the page when there is no locale. With a locale or an explicit `dir`, the element and the panel get `lang` and `dir`; the element's own values are put back by `destroy()` and by `setOption('locale', null)`. `document.body` is never changed.
- In right-to-left text the layout mirrors (indent, buttons, caret) and ArrowLeft and ArrowRight swap in the list.
- Register your own pack with `AnyDrop.locales.xx = { code: 'xx', dir: 'ltr', dict: { ... } }`. There are no plural rules: prefer wording that works for any count.

### Theme presets and variables

`themePreset: 'minimal' | 'rounded' | 'enterprise' | 'glass'` (or your own name) adds the class `ad-theme-<name>` to the element and to the panel. Import the preset file after `style.css`; a file only acts on elements with its class:

```ts
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/glass.css';
new AnyDrop('#uploader', { url: '/upload', themePreset: 'glass', theme: 'dark' });
```

`theme` (`auto`, `light`, `dark`) is the colour scheme and combines with any preset. A preset sets variables and sets them for light and dark, with AA contrast. `glass` blurs the backdrop of the zone only, with solid surfaces where `backdrop-filter` is missing. Your own preset: `.ad-root.ad-theme-acme, .ad-panel.ad-theme-acme { --ad-color-accent: #be123c; }` with `themePreset: 'acme'`. A preset must not change sizes that affect the 44 px targets.

CSS variables (set them on the element or the panel):

| Variable | Default | Meaning |
|---|---|---|
| `--ad-color-bg`, `--ad-color-surface`, `--ad-color-text`, `--ad-color-muted` | white, grey, dark grey | Background, raised surface, text, secondary text |
| `--ad-color-border`, `--ad-color-border-soft` | grey | Controls and zone border, separators |
| `--ad-color-accent`, `--ad-color-on-accent`, `--ad-color-hover` | blue, white | Accent, text on it, hover background |
| `--ad-color-success`, `--ad-color-error`, `--ad-color-warning` | green, red, amber | Status colours |
| `--ad-color-track`, `--ad-color-focus` | grey, blue | Progress track, focus ring |
| `--ad-radius`, `--ad-btn-radius` | `8px`, `var(--ad-radius)` | Corners of surfaces and of buttons |
| `--ad-gap`, `--ad-target`, `--ad-indent` | `12px`, `44px`, `20px` | Spacing, minimum tap target, indent per folder level |
| `--ad-font`, `--ad-font-size` | system fonts, `1rem` | Font family and base size (sizes inside scale from it) |
| `--ad-list-max-height` | `420px` | Height of the list before it scrolls |
| `--ad-border-width`, `--ad-border-style` | `2px`, `dashed` | Border of the drop zone |
| `--ad-shadow` | `none` | Shadow of the zone |
| `--ad-backdrop` | `none` | `backdrop-filter` of the zone |
| `--ad-icon-size`, `--ad-thumb-size` | `22px`, `40px` | Icons, thumbnail box of a row |

Classes added by the customisation options: `ad-layout-list`, `ad-layout-compact`, `ad-icon`, `ad-file-icon`, `ad-row-custom` (a row whose content a hook replaced), `ad-theme-<name>`. Action buttons carry `data-ad-action="<id>"`.

## Theming

Set CSS variables on the element, for example `#uploader { --ad-color-accent: #7c3aed; }` (the table is under [Customising the UI](#theme-presets-and-variables)). Dark mode follows `prefers-color-scheme`; force it with the `theme` option.

The preview template and the per-file classes use these names. Hooks (`data-ad-*`, filled in by the UI): `data-ad-thumbnail`, `data-ad-size`, `data-ad-name`, `data-ad-uploadprogress`, `data-ad-errormessage`, `data-ad-remove`. Classes: `ad-file-preview`, `ad-file-thumb`, `ad-file-details`, `ad-file-size`, `ad-file-name`, `ad-file-progress`, `ad-file-bar`, `ad-file-error-message`, `ad-file-success-mark`, `ad-file-error-mark`, `ad-file-remove`. State classes on the zone and on a preview: `ad-clickable`, `ad-drag-hover`, `ad-started`, `ad-disabled`, `ad-max-files-reached`, `ad-browser-not-supported`, `ad-processing`, `ad-complete`, `ad-success`, `ad-error`, `ad-canceled`, `ad-paused`, `ad-image-preview`, `ad-thumb-error`. A `.ad-fallback` element in the markup is removed while the UI runs. More are listed in [Customising the UI](https://vedratech.github.io/anydrop/guide/customising-ui).

## Mobile and iOS

44 px tap targets, safe-area padding, a layout that holds from 320 px, and a "files only" notice where there is no folder picker (iOS Safari has none). Use `capture: 'environment'` to open the camera. Details and limits: [Mobile and iOS](https://vedratech.github.io/anydrop/guide/mobile-ios).

## Documentation

Everything is on the website: **https://vedratech.github.io/anydrop/**

- [Guide](https://vedratech.github.io/anydrop/guide/introduction) and [quick start](https://vedratech.github.io/anydrop/guide/quick-start)
- [API reference](https://vedratech.github.io/anydrop/api/): [options](https://vedratech.github.io/anydrop/api/options), [methods](https://vedratech.github.io/anydrop/api/methods), [events](https://vedratech.github.io/anydrop/api/events), [error codes](https://vedratech.github.io/anydrop/api/error-codes), [types](https://vedratech.github.io/anydrop/api/types)
- [Backend contract](https://vedratech.github.io/anydrop/protocol), with [Express](https://vedratech.github.io/anydrop/backend/express) and [Laravel](https://vedratech.github.io/anydrop/backend/laravel) examples
- [Live demo](https://vedratech.github.io/anydrop/demo)
- [Size comparison](https://vedratech.github.io/anydrop/size-comparison)

## License

MIT © 2026 Vedra Tech.
