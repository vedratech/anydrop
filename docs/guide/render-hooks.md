---
title: "Render hooks: decorate or replace file rows, folders and toolbar"
description: "Use the AnyDrop render option to add a badge to a file row, build a custom row, or mount a React or Vue component. Context reference, view lifecycle and security notes."
---

# Render hooks

The `render` option lets you change the content of five parts of the interface. The list, keyboard use, virtualisation and accessibility stay with AnyDrop.

```js
new AnyDrop('#uploader', {
  url: '/upload',
  render: {
    file(ctx) {}, // one file row (or card)
    folder(ctx) {}, // one folder row
    toolbar(ctx) {}, // the toolbar
    message(ctx) {}, // the drop message (also the empty state)
    errorItem(ctx) {}, // one row of the error panel
  },
});
```

Each hook runs with `this` set to the AnyDrop instance and receives a context object. What it returns decides what happens:

| Return                            | Effect                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| nothing, `null`, `undefined`      | The default content stays. The hook may have **decorated** it through `ctx.parts`. No update or destroy calls.           |
| an `HTMLElement`                  | **Replaces** the default content. It is static: no update calls.                                                         |
| `{ el, update?, destroy? }`       | Replaces the default content with `el`, and gets `update` and `destroy` calls.                                           |
| `{ update?, destroy? }` (no `el`) | Keeps the default content (decorated) and gets `update` and `destroy` calls.                                             |
| a `string`                        | Shown as **plain text**, never as HTML.                                                                                  |

## The view object

```ts
interface AnyDropRenderView<C> {
  el?: HTMLElement | null; // replaces the default content
  update?(ctx: C): void; // the state changed: update `el` in place
  destroy?(): void; // called once, before the element leaves the DOM
}
```

### Lifecycle

| Hook             | Called first                                                                                                                                                                                                                                                                  | `update(ctx)`                                                                                                                     | `destroy()`                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `file`, `folder` | When the row is created: it scrolls into view, a structural change re-creates it, or the list is rebuilt. The default parts are already built and painted. The row is **not yet in the document**; measure inside `requestAnimationFrame` if you need sizes.                 | After each repaint of that row (status, progress, error, pause state, connection state, active row, labels), at most once per animation frame. | See below.                                                                 |
| `toolbar`        | When the panel is built.                                                                                                                                                                                                                                                      | When the counts, progress, summary text or `can` flags changed.                                                                   | The panel is dropped, a render or layout option changed, or `ad.destroy()`. |
| `message`        | When the message is built.                                                                                                                                                                                                                                                    | When its text, touch layout, drag state, disabled state, max-files state or has-files state changed.                              | `setOption('render')` or `ad.destroy()`.                                    |
| `errorItem`      | When an error row is created.                                                                                                                                                                                                                                                 | Never: entries are snapshots, and a changed list creates new rows.                                                                | The error row is removed.                                                  |

### Virtualisation

Only rows near the viewport exist. A row is created again when it scrolls back, so the hook runs again. `destroy()` is called **exactly once** for each hook call that returned a view with `destroy`, **before** the element is removed:

- the row scrolled out of the window;
- a structural change re-created it (files or folders added or removed, collapse, clear);
- an option that rebuilds the list changed (`render`, `rowActions`, `icons`, `layout`, `rowHeight`, `locale`, `previewTemplate`);
- `ad.destroy()`. Views are destroyed first, then the DOM is removed, so a framework can unmount cleanly.

Rules:

- **Undo every decoration in `destroy()`.** The default preview element is cached and re-used when a row is mounted again, so a decoration added at mount would otherwise be added twice.
- The row container (`.ad-row` or `.ad-error-row`) belongs to AnyDrop. Do not change its `role`, `id`, `aria-*`, `data-status`, `style.top` or `style.height`. A hook owns only what it returns or adds.
- Content must fit the row height (`rowHeight`, the card size, or `errorRowHeight`). Overflow is hidden.
- Errors are isolated: a hook, `update` or `destroy` that throws is reported to the console, like an event listener. A hook that throws falls back to the default content for that row.

### Accessibility

- The list stays one focus stop, and the arrow keys work whatever you render.
- A replacing hook must render readable text (the label), or set `ctx.row.setAttribute('aria-label', ...)` at mount and in `update`.
- Interactive elements must be a native `<button>` or `<a>` and at least 44 x 44 px. The classes `ad-btn` (text) and `ad-btn ad-icon-btn` (icon) have that size, or use [row actions](/guide/row-actions-icons).
- In the `message` hook, clicks on `button`, `a`, `input`, `select`, `textarea` or `[data-ad-action]` do not open the file picker.

## Text and HTML: a security note

File and folder names come from the user's disk. Putting one into markup with a template literal lets a crafted name run script:

```js
// UNSAFE: a file named  <img src=x onerror=alert(1)>  runs code
el.innerHTML = `<b>${ctx.file.name}</b>`;
```

So a returned `string` is shown as text, and the context has `ctx.html`, a tagged template that **escapes every `${}` value**:

```js
const el = ctx.html`<b>${ctx.file.name}</b>`; // safe
```

`ctx.html` turns each value into a string (`null` and `undefined` become an empty string), escapes `& < > " '`, and parses the result in an inert `<template>`. It returns the single top-level element, or a `<div>` that wraps several nodes. The static markup in the template is yours; only the values are escaped. For anything else use `textContent`, and never build HTML from `ctx.file.name`, `ctx.label` or `ctx.errorMessage` yourself.

Escaping makes a value safe as **text between tags** and inside a **quoted attribute**. It does not make every position safe. Follow these rules:

- **Always quote attributes.** In `title=${x}` a value with a space can add an attribute such as `onmouseover=...`. Write `title="${x}"`.
- **Validate URLs.** `href="${url}"` can still hold `javascript:...`. Allow only `http:`, `https:` or a relative URL, and otherwise leave it out.
- **Never put a value inside `<script>` or `<style>`**, or in an event attribute such as `onclick`. Escaping does not make those safe.

```js
// UNSAFE: unquoted attribute, unchecked URL, value inside a style
ctx.html`<a title=${ctx.label} href="${link}" style="color:${color}">open</a>`;

// SAFE: quoted attribute, checked URL, no value in the style
const safe = /^(https?:|\/|\.\/)/i.test(link) ? link : '#';
ctx.html`<a title="${ctx.label}" href="${safe}">open</a>`;
```

Setting properties after the element exists (`a.href = safe`, `el.textContent = ctx.label`) is the simplest way to stay safe.

## Context reference

Every context has these members, and a `kind` that names it (`'file'`, `'folder'`, `'toolbar'`, `'message'` or `'errorItem'`):

| Member          | Type                                         | Meaning                                                                                                                        |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `instance`      | `AnyDrop`                                    | The instance.                                                                                                                  |
| `layout`        | `'list' \| 'compact'` (a string for layouts added later) | The current layout.                                                                                                            |
| `t(key, vars?)` | `(key: keyof AnyDropTexts, vars?) => string` | The current text of a `dict*` option, with `{{name}}` placeholders filled. An unknown key returns the key.                     |
| `html`          | tagged template                              | Builds DOM from markup and escapes every value (see above).                                                                    |
| `icon(name)`    | `(name) => HTMLElement`                      | A `<span class="ad-icon" aria-hidden="true">` holding the configured [icon](/guide/row-actions-icons#icons).                   |

Contexts are new plain objects on each call. `ctx.file`, `ctx.folder` and `ctx.entry` are the live objects.

### `render.file`

| Member                                                   | Type                                       | Meaning                                                                    |
| -------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `kind`                                                   | `'file'`                                   |                                                                            |
| `file`                                                   | `AnyDropFile \| MockFile`                  | The file.                                                                  |
| `label`                                                  | `string`                                   | The shown name: the file name, or the relative path in the flat view.      |
| `sizeText`                                               | `string`                                   | The formatted size, plain text.                                            |
| `status`                                                 | `FileStatus`                               | `added`, `queued`, `uploading`, `paused`, `success`, `error` or `canceled`. |
| `statusText`                                             | `string`                                   | The badge text (includes "Waiting for connection").                        |
| `waiting`                                                | `boolean`                                  | Paused only by the system (offline or unreachable).                        |
| `progress`                                               | `number`                                   | 0 to 100 (100 on success).                                                 |
| `error`                                                  | `ErrorEntry \| null`                       | The error-list entry of the file.                                          |
| `errorMessage`                                           | `string`                                   | The error or canceled text, else `''`.                                     |
| `thumbnail`                                              | `string \| null`                           | The thumbnail data URL, once made.                                         |
| `depth`                                                  | `number`                                   | The tree level, 0 at the root.                                             |
| `active`                                                 | `boolean`                                  | This is the keyboard-active row.                                           |
| `row`                                                    | `HTMLElement`                              | The `.ad-row` container (owned by AnyDrop).                                |
| `parts`                                                  | `{ preview, badge, actions }`              | The default parts, already painted.                                        |
| `can`                                                    | `{ pause, resume, retry, cancel, remove }` | Whether each built-in action applies now.                                  |
| `pause()`, `resume()`, `retry()`, `cancel()`, `remove()` | `() => void`                               | Run the built-in action. A call that does not apply does nothing.          |

### `render.folder`

| Member                                                                   | Type                                 | Meaning                                                  |
| ------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------- |
| `kind`                                                                   | `'folder'`                           |                                                          |
| `folder`                                                                 | `FolderNode`                         |                                                          |
| `label`                                                                  | `string`                             | The folder name.                                           |
| `status`, `statusText`, `waiting`, `progress`, `depth`, `active`, `row` | as for files                         | `progress` is the folder progress.                       |
| `counts`                                                                 | `FolderNode['counts']`               |                                                          |
| `expanded`                                                               | `boolean`                            |                                                          |
| `toggle()`                                                               | `() => void`                         | Expand or collapse.                                      |
| `parts`                                                                  | `{ toggle, main, badge, actions }`   | `main` holds the icon, name, count and progress bar.     |
| `can`                                                                    | `{ pause, resume, retry, cancel }`   |                                                          |
| `pause()`, `resume()`, `retry()`, `cancel()`                             | `() => void`                         | `cancel()` cancels the whole folder.                     |

### `render.toolbar`

`el` (the `.ad-toolbar`, which keeps its `aria-label`), `parts: { info, actions }`, `counts` (root counts), `progress` (0 to 100, rounded), `summaryText`, `can: { pauseAll, resumeAll, retryFailed, clear }`, and the methods `pauseAll()`, `resumeAll()`, `retryFailed()` and `clear()`.

### `render.message`

The drop message, which is also the empty state. `el` (the `.ad-message`), `parts: { text }`, `text`, `touch` (tap layout), `dragging`, `disabled`, `maxFilesReached`, `hasFiles`, `canPickFolder`, `pickFiles()` and `pickFolder()`. The hook runs only when AnyDrop creates the message. A `.ad-message` element of your own in the page is used as is, and the hook is not called.

### `render.errorItem`

`entry` (`ErrorEntry`), `index`, `file` (`AnyDropFile | null`), `row` (the `.ad-error-row`), `parts: { text, retry }` (`retry` is `null` when the entry cannot be retried), and `retry()`, which does nothing when the entry is not retryable.

## Examples

### Decorate a row: a type badge

Keep the default row, add a tag, and remove it in `destroy()`:

```js
new AnyDrop('#uploader', {
  url: '/upload',
  render: {
    file(ctx) {
      const tag = ctx.html`<span class="my-type">${ctx.file.type || 'file'}</span>`;
      ctx.parts.preview.appendChild(tag);
      return { destroy: () => tag.remove() };
    },
  },
});
```

### A fully custom row

Replace the content, update it in place, and re-use the built-in action buttons:

```js
render: {
  file(ctx) {
    const el = ctx.html`<div class="my-row"><strong>${ctx.label}</strong> <span class="pct"></span></div>`;
    el.appendChild(ctx.parts.actions); // the built-in 44 px buttons, still painted by AnyDrop
    const pct = el.querySelector('.pct');
    const paint = (c) => {
      pct.textContent = c.status === 'error' ? c.errorMessage : Math.round(c.progress) + '%';
    };
    paint(ctx);
    return { el, update: paint };
  },
},
```

Because the element is updated in place, focus inside the row survives progress updates.

### Mount a React component

```jsx
import { createRoot } from 'react-dom/client';

render: {
  file(ctx) {
    const el = document.createElement('div');
    const root = createRoot(el);
    root.render(<FileRow ctx={ctx} />);
    return {
      el,
      update: (c) => root.render(<FileRow ctx={c} />),
      destroy: () => root.unmount(),
    };
  },
},
```

### Mount a Vue component

```js
import { createApp, h, shallowRef } from 'vue';

render: {
  file(ctx) {
    const current = shallowRef(ctx);
    const el = document.createElement('div');
    const app = createApp({ render: () => h(FileRow, { ctx: current.value }) });
    app.mount(el);
    return {
      el,
      update: (c) => (current.value = c),
      destroy: () => app.unmount(),
    };
  },
},
```

Angular maps the same way: `createComponent` with `hostElement: el`, `setInput('ctx', c)` in `update`, and `componentRef.destroy()` in `destroy`.

