---
title: "Customising the upload UI: themes, texts and templates"
description: "Change the AnyDrop interface: CSS variables, dark mode, translated texts, the preview template, toolbar and error panel options, and rendering it yourself."
---

# Customising the UI

You can change the texts, the markup of a file row, and the colours.

## Texts (`dict*`)

Every text is an option, so it can be translated. Texts are rendered as plain text, not HTML. A `{{name}}` placeholder is replaced by the value of that name.

```js
new AnyDrop('#uploader', {
  url: '/upload',
  dictDefaultMessage: 'Dateien hierher ziehen',
  dictSelectFiles: 'Dateien wählen',
  dictSelectFolder: 'Ordner wählen',
  dictSummary: '{{done}} von {{total}} hochgeladen, {{failed}} fehlgeschlagen',
  dictFileTooBig: 'Die Datei ist zu groß ({{filesize}} MiB). Maximum: {{maxFilesize}} MiB.',
});
```

The full list, with defaults and where each text is shown, is in [Options, Texts](/api/options#texts). The screen-reader messages (`dictAnnounce*`) and accessible names (`dictRegionLabel`, `dictListLabel`, `dictToolbarLabel`) can be translated too.

To put markup in the drop message, put your own element in the page and it is used as is:

```html
<div id="uploader">
  <div class="ad-message"><strong>Drop</strong> your holiday photos here</div>
</div>
```

## Layout options

```js
new AnyDrop('#uploader', {
  url: '/upload',
  folderView: 'flat', // 'tree' (default) or 'flat'
  toolbar: false, // hide the toolbar
  errorPanel: true,
  pickerButtons: true, // the "Select files" and "Select folder" buttons
  previewsContainer: '#my-list', // put the list somewhere else
  rowHeight: 56, // px; use a larger value for a taller previewTemplate
  theme: 'auto', // 'light', 'dark' or 'auto' (follows prefers-color-scheme)
});
```

`clickable` accepts `true` (the element itself), `false`, a selector, an element or an array. `previewsContainer: false` means no previews.

## Preview template

`previewTemplate` is the markup of one file. These hooks are filled in:

| Attribute | Filled with |
|---|---|
| `data-ad-name` | The file name |
| `data-ad-size` | The size, as text |
| `data-ad-thumbnail` | An `<img>` that gets the thumbnail |
| `data-ad-uploadprogress` | An element whose width is the progress |
| `data-ad-errormessage` | The error message |
| `data-ad-remove` | A link or button that removes or cancels the file |

```js
new AnyDrop('#uploader', {
  url: '/upload',
  addRemoveLinks: true,
  previewTemplate: `
    <div class="my-row">
      <img data-ad-thumbnail alt="" />
      <span data-ad-name></span> <span data-ad-size></span>
      <span class="my-error" data-ad-errormessage></span>
    </div>`,
});
```

The default template uses the classes `ad-file-preview`, `ad-file-thumb`, `ad-file-details`, `ad-file-size`, `ad-file-name`, `ad-file-progress`, `ad-file-bar`, `ad-file-error-message`, `ad-file-success-mark`, `ad-file-error-mark` and `ad-file-remove`. Reuse them in your own template to keep the built-in styling, or use your own classes.

## CSS variables

Set them on the element, or any ancestor:

```css
#uploader {
  --ad-color-accent: #7c3aed;
  --ad-radius: 12px;
}
```

| Variable | Meaning |
|---|---|
| `--ad-color-bg`, `--ad-color-surface`, `--ad-color-text`, `--ad-color-muted` | Backgrounds and text |
| `--ad-color-border`, `--ad-color-border-soft` | Strong and soft borders |
| `--ad-color-accent`, `--ad-color-on-accent`, `--ad-color-hover` | Primary colour, text on it, hover background |
| `--ad-color-success`, `--ad-color-error`, `--ad-color-warning` | Status colours |
| `--ad-color-track`, `--ad-color-focus` | Progress track, focus ring |
| `--ad-radius`, `--ad-gap`, `--ad-target` | Corner radius, spacing, minimum tap target (44px) |
| `--ad-font`, `--ad-list-max-height`, `--ad-indent` | Font, list height (420px), tree indent per level (20px) |

## Dark mode

Dark mode follows `prefers-color-scheme`. Force it with the `theme` option, or with `data-ad-theme="light"` or `"dark"` on the element. To follow your own site's switch:

```js
const isDark = document.documentElement.classList.contains('dark'); // however your site marks dark mode
ad.setOption('theme', isDark ? 'dark' : 'light');
```

## CSS classes

State classes on the element: `ad-clickable`, `ad-started`, `ad-drag-hover`, `ad-max-files-reached`, `ad-disabled`, `ad-browser-not-supported`. State classes on a preview: `ad-processing`, `ad-success`, `ad-error`, `ad-complete`, `ad-canceled`, `ad-paused`, `ad-image-preview`, `ad-thumb-error`. An element with the class `ad-message` inside your element replaces the default drop message, and an element with the class `ad-fallback` is removed while the UI runs (use it for a plain `<form>` that only users without JavaScript see). Other hooks include `ad-root`, `ad-touch`, `ad-toolbar`, `ad-list`, `ad-row` (with `ad-folder-row` and `ad-file-row`), `ad-badge`, `ad-errors`, `ad-banner` and `ad-live`.

Buttons carry `data-ad-action` (`pick-files`, `pick-folder`, `pause-all`, `resume-all`, `retry-failed`, `clear`, `pause`, `resume`, `retry`, `cancel`, `toggle`, `export-json`, `export-csv`, `copy-errors`, `dismiss-errors`), which is handy for tests.

## Render everything yourself

Event handlers passed as options **add** to the built-in rendering; they do not replace it. To take over completely, set `disablePreviews: true` and use the [events](/api/events) and the [tree](/guide/folders).

## Accessibility

The list is one focus stop (`role="tree"`). Up, Down, Home, End, PageUp and PageDown move; Right and Left expand, collapse or move to the parent; Enter and Space toggle a folder; `p` pauses or resumes, `r` retries, Delete cancels or removes. Progress and errors are announced through a polite live region (progress every 10 %). Colours meet WCAG AA in the light and dark theme.
