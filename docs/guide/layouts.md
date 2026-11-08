---
title: "Layouts: list and compact"
description: "Choose how AnyDrop shows files: a list with thumbnails or a compact row. Row heights, folders, keyboard use and mobile behaviour."
---

# Layouts

The `layout` option chooses how files are shown. The same file and folder parts (preview, status badge, action buttons) are used in every layout, so [render hooks](/guide/render-hooks), [row actions](/guide/row-actions-icons) and `previewTemplate` work in all of them.

```js
new AnyDrop('#uploader', { url: '/upload', layout: 'compact' });
ad.setOption('layout', 'list'); // can be changed at runtime
```

| Layout           | Look                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list` (default) | One row per file with a thumbnail. A file that is not an image shows the `file` icon in the thumbnail box.                                                                                                        |
| `compact`        | 48 px rows, no thumbnail. The size is on the same line as the name (the error message replaces it when a file failed) and the badge is smaller. Buttons stay 44 x 44 px, which is why a row is not lower than 48 px. |

The panel gets the class `ad-layout-list` or `ad-layout-compact`. A grid layout of cards is planned for a later release.

## Row height

`rowHeight` is `null` by default, which means the height of the layout: 56 px for `list`, 48 px for `compact`. A number overrides it in every layout. Use a larger number for a taller custom row or `previewTemplate`. Content must fit its row; overflow is hidden. The rows of the error panel have their own height, `errorRowHeight` (default 64).

```js
new AnyDrop('#uploader', { url: '/upload', layout: 'compact', rowHeight: 52 });
```

## Folders

In both layouts the tree works as in [Folders and the tree](/guide/folders): a folder row, indented per level, with its subfolders first and then its files. `folderView: 'flat'` shows every file with its path instead.

## Many files

Rows are virtualised: only the rows near the viewport exist, so 10,000 files keep the page light in both layouts.

## Keyboard

The list is one focus stop. The keys are listed in [Customising the UI](/guide/customising-ui#accessibility). When the text direction is right-to-left, Left and Right swap meaning. See [Languages and RTL](/guide/languages).

## Mobile

Both layouts keep 44 x 44 px targets and hold from a 320 px screen. `compact` fits more rows on a small screen. See [Mobile and iOS](/guide/mobile-ios).

Next: [Render hooks](/guide/render-hooks), [Themes](/guide/themes).
