---
title: "Row actions and icons: custom buttons, overrides and SVG icons"
description: "Choose the buttons on each AnyDrop row, add your own action, override a built-in one, listen to actionclicked, and replace every icon with your own SVGs or an icon set."
---

# Row actions and icons

## Row actions

The `rowActions` option chooses the buttons on a file row and a folder row.

```js
new AnyDrop('#uploader', {
  url: '/upload',
  rowActions: {
    file: ['pause', 'resume', 'retry', 'cancel', 'remove'], // the default
    folder: ['pause', 'resume', 'retry', 'cancel'], // the default
  },
});
```

It is merged per key: giving only `file` keeps the default `folder` list. An empty array shows no buttons. A button is shown only when its action applies to the row at that moment.

### Built-in actions

| Id       | For            | Shown when                                              | Label (text option) | Does                              |
| -------- | -------------- | ------------------------------------------------------- | ------------------- | --------------------------------- |
| `pause`  | file, folder   | the item can be paused                                  | `dictPause`         | pauses the file or folder         |
| `resume` | file, folder   | the item is paused                                      | `dictResume`        | resumes it                        |
| `retry`  | file, folder   | the item failed                                         | `dictRetry`         | retries the file or failed files  |
| `cancel` | file           | status is `added`, `queued`, `uploading` or `paused`    | `dictCancelUpload`  | cancels the upload                |
| `cancel` | folder         | the folder has unfinished files                         | `dictCancelUpload`  | cancels the folder                |
| `remove` | file           | status is `success`, `error` or `canceled`              | `dictRemoveFile`    | removes the file from the list    |

`cancel` and `remove` are two actions. At most one is visible at a time, so the default look is unchanged; code or tests that click `[data-ad-action=cancel]` on a finished row must use `remove`. A folder has no `remove` action.


### A custom action

```js
new AnyDrop('#uploader', {
  url: '/upload',
  icons: { external: '<svg viewBox="0 0 24 24" ...>...</svg>' },
  rowActions: {
    file: [
      'pause',
      'resume',
      'retry',
      'cancel',
      'remove',
      {
        id: 'open',
        label: 'Open in new tab',
        icon: 'external',
        when: (ctx) => ctx.status === 'success',
        onClick: (ctx) => window.open(ctx.file.upload.url),
      },
    ],
  },
});
```

An action object has these members:

| Member    | Type                                  | Meaning                                                                                                                                      |
| --------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string`                              | Lower-case kebab-case. Becomes `data-ad-action="<id>"`. `toggle` is reserved. A built-in id overrides that built-in. Ids are not validated. |
| `label`   | `string \| (ctx) => string`           | The accessible name and tooltip, shown as text. For a built-in id the default is its text option.                                            |
| `icon`    | `string`                              | An icon name (built-in, or a key of `icons`) or SVG markup. Without an icon the button shows the label as text.                              |
| `when`    | `(ctx) => boolean`                    | Shown when it returns true. Default: always (custom), or the built-in rule (built-in id; `when` is then combined with it).                   |
| `onClick` | `(ctx, event) => void`                | Runs on click, and on the keyboard shortcut of an overridden built-in. `event` is the click, or the real `KeyboardEvent` for a shortcut.                                                                       |

`ctx` is the same context as in [render hooks](/guide/render-hooks#context-reference) (file or folder). `label` and `when` are evaluated again on each repaint of the row.

AnyDrop builds the buttons: `<button type="button" class="ad-btn ad-icon-btn" data-ad-action="<id>" aria-label title>` with an icon, or `class="ad-btn"` with the label as text. They are 44 x 44 px at least. A hidden action gets the `hidden` attribute instead of being removed, so keyboard focus does not jump.

### Overriding a built-in action

An object whose `id` is a built-in id overrides it. `label`, `icon` and `when` default to the built-in's; `onClick` replaces what it does. `ctx.remove()` (and the other context methods) still run the real built-in.

```js
rowActions: {
  file: [
    'pause',
    'resume',
    'retry',
    'cancel',
    {
      id: 'remove',
      onClick(ctx) {
        if (window.confirm('Remove ' + ctx.label + '?')) ctx.remove();
      },
    },
  ],
},
```

### Keyboard shortcuts follow the configuration

`p` resumes when that applies, else pauses; `r` retries; Delete or Backspace cancels when that applies, else removes (a folder: cancel, after the confirmation). A shortcut does nothing when its action is not in `rowActions` for that kind of row. An override's `onClick` also runs for its shortcut.

### The `actionclicked` event

```js
ad.on('actionclicked', (action, target) => {
  console.log(action, target); // 'remove', the file (a MockFile from displayExistingFile for such rows) or the FolderNode
});
```

It fires for every action, built-in or custom, from a button or a shortcut, **before** the action runs. It cannot be cancelled; use an override to change or stop an action. It is also dispatched as the DOM event `anydrop:actionclicked`. See [Events](/api/events#actionclicked).

## Icons

The `icons` option replaces the built-in inline SVG icons. It takes a record, a function, or `null` (the default, the built-in icons).

| Name                       | Used for                                                          |
| -------------------------- | ----------------------------------------------------------------- |
| `folder`                   | The folder row.                   |
| `file`                     | The thumbnail box of a file that is not an image.                 |
| `toggle`                   | The expand and collapse button (turned when open).                |
| `pause`, `resume`, `retry` | Row actions.                                                      |
| `cancel`, `remove`         | Row actions.                                                      |
| `success`, `error`         | The success and error mark of the preview.  |

You can add your own names (`external` above) and use them in custom actions.

### A record of SVG strings

```js
new AnyDrop('#uploader', {
  url: '/upload',
  icons: {
    // Lucide-style: 24x24 viewBox, stroke-based, uses currentColor
    pause:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
    remove:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  },
});
```

A name you leave out uses the built-in icon. The styles only set the icon size (`--ad-icon-size`, 22 px by default) and do not force a fill, so stroke-based icons are drawn as designed. Every icon is wrapped in `<span class="ad-icon" aria-hidden="true">`, and buttons keep their `aria-label`.

### A function

The function gets the icon name. Return SVG markup as a string, an `HTMLElement` (return a new element on each call), or `null` or `undefined` for the built-in icon. This makes an icon set easy to plug in:

```js
import { createElement } from 'lucide';
import { Pause, Play, RotateCw, X, Trash2, Folder, File } from 'lucide';

const set = { pause: Pause, resume: Play, retry: RotateCw, cancel: X, remove: Trash2, folder: Folder, file: File };

new AnyDrop('#uploader', {
  url: '/upload',
  icons: (name) => (set[name] ? createElement(set[name]) : null),
});
```

(Use the API of your icon library; `createElement` above is the one from `lucide`.) You can also write `icons: (name) => mySvgStrings[name]`.

::: danger Icons are trusted input
Record values are inserted as HTML. Use SVG you wrote or took from your icon set, never text that came from a user or a server.
:::

Changing `icons` at runtime with `setOption('icons', ...)` rebuilds the list. Next: [Themes](/guide/themes).

