---
title: "React and Next.js file and folder upload"
description: "AnyDrop for React and Next.js: an <AnyDrop> component with on<Event> props, custom row components through render props, a headless useAnyDrop hook, StrictMode and server rendering."
---

# React and Next.js

`@vedratech/anydrop-react` wraps the AnyDrop UI in a React component and the headless core in a hook. It works with React 18 and 19, in StrictMode, and in the Next.js App Router. Everything the [UI](/guide/quick-start) does is available: folders, chunked uploads, pause and resume, the error list, themes and languages.

## Install

```sh
npm install @vedratech/anydrop-react @vedratech/anydrop-ui @vedratech/anydrop-core
```

`react` and `react-dom` (18 or newer), `@vedratech/anydrop-ui` and `@vedratech/anydrop-core` are peer dependencies, so you install them yourself and your app has one copy of each. Import the stylesheet once, in your app entry (or in the root `layout.tsx` for Next.js):

```tsx
import '@vedratech/anydrop-ui/style.css';
```

## Your first uploader

```tsx
import { AnyDrop } from '@vedratech/anydrop-react';
import '@vedratech/anydrop-ui/style.css';

export function Uploader() {
  return (
    <AnyDrop
      url="/upload"
      options={{ chunking: true, sendManifest: true, manifestUrl: '/upload/manifest' }}
      onSuccess={({ file }) => console.log('uploaded', file.name)}
      onQueuecomplete={() => console.log('all done')}
    />
  );
}
```

`url` is required, either as the prop or as `options.url`. Without one, the constructor of the UI throws `No URL provided.`, and the error goes to the nearest error boundary.

## `<AnyDrop>` props

| Prop | Type | Description |
|---|---|---|
| `options` | `AnyDropConfig` | The full configuration: every [UI and core option](/api/options). Replace the object to change an option. Mutating it is not detected. |
| `url` | `AnyDropConfig['url']` (string or function) | Overrides `options.url` when it is not `undefined`. |
| `locale` | `AnyDropConfig['locale']` | Overrides `options.locale`. A language pack object or the code of a registered one. See [Languages](/guide/languages). |
| `themePreset` | `AnyDropConfig['themePreset']` | Overrides `options.themePreset`. See [Themes](/guide/themes). |
| `layout` | `AnyDropConfig['layout']` | Overrides `options.layout`. See [Layouts](/guide/layouts). |
| `disabled` | `boolean` | `true` calls `disable()`, `false` calls `enable()`. If it is `true` on the first render, the zone starts disabled. |
| `id`, `className`, `style` | `string`, `string`, `CSSProperties` | Set on the outer element of the component. |
| `renderFile`, `renderFolder`, `renderToolbar`, `renderMessage`, `renderErrorItem` | `(ctx) => ReactNode` | Render slots. See [Render slots](#render-slots). |
| `on<Event>` | `(payload) => void` | One prop for each of the 41 events. See [Event props](#event-props). |
| `ref` | `Ref<AnyDropInstance \| null>` | The live instance. See [The ref](#the-ref). |

The dedicated props (`url`, `locale`, `themePreset`, `layout`) win over the same key in `options`, but only when they are not `undefined`. The component does not accept `children` and does not pass unknown props to the DOM: the library owns everything inside its element. A DOM-style prop such as `onDragOver` is a type error, not a silent no-op.

### Changing props later

The instance is created once, after mount, and is never recreated because a prop changed. Changed values go to `setOption()` after each commit:

- **Inline objects and functions are fine.** You do not need `useMemo` or `useCallback`. Functions in `options` (for example `accept`, `renameFile`, or the `onClick` of a row action) are called through a stable wrapper that always runs your latest function. Plain data (arrays and plain objects, up to six levels deep) is compared by value, so a `rowActions` object written inline in the JSX does not rebuild the panel on every render.
- **A removed option goes back to its default.** If a key was in `options` and is missing (or `undefined`) on a later render, it is reset.
- **Some options are read only when the instance is created:** `init`, `fallback` and `forceFallback`. Changing them later is ignored, and in development the console says so once: `[anydrop] option "init" is only read when the instance is created; the change was ignored. Remount the component to apply it.` To apply a change, remount the component with a new `key`. The wrapper does not recreate the instance by itself, because that would stop uploads in progress and drop the file list.
- **Changes in the middle of an upload** behave as they do in the UI: for example a new `url` applies to the next request, and `render` or `layout` rebuild the panel (the scroll position is lost).
- `transport` is passed by identity and never cloned by the wrapper. In ui 0.1.x, though, a plain-object `transport` passed when the instance is created is copied by the UI, and its methods run with `this` bound to the copy. For a transport with state, use a class instance, keep the state in a closure, or pass it later with `setOption`.

## Event props

Every core event is a prop named `on` plus the event name with its first letter in upper case: `onAddedfile`, `onUploadprogress`, `onErrorlistchanged`, `onQueuecomplete`. The names are not split into words, so a prop is always one search away from the name in the [events reference](/api/events).

The payload rule:

- An event with no arguments gives a handler with no argument: `onReset={() => ...}`.
- An event with one argument passes that value: `onAddedfile={(file) => ...}`.
- An event with several arguments passes one object with named keys: `onSuccess={({ file, response }) => ...}`. An optional argument is an optional key, and the key is always present.

Handlers run synchronously, like core listeners, and outside React's event system. They are not inside an error boundary: an exception is reported by core and the other listeners still run. You can swap a handler on every render (inline arrows are fine): the component subscribes once per `on*` prop that is defined and always calls the latest function. A prop that goes from defined to `undefined` unsubscribes.

| Prop | Payload |
|---|---|
| `onAddedfile` | `AnyDropFile` |
| `onAddedfiles` | `AnyDropFile[]` |
| `onRemovedfile` | `AnyDropFile` |
| `onReset` | none |
| `onEmptyfolder` | `string` (the folder path) |
| `onAddedfolder`, `onRemovedfolder`, `onFoldercomplete` | `FolderNode` |
| `onFolderprogress` | `{ folder: FolderNode; progress: number; bytesSent: number }` |
| `onThumbnail` | `{ file: AnyDropFile; dataUrl: string }` |
| `onProcessing`, `onCanceled`, `onComplete`, `onMaxfilesexceeded` | `AnyDropFile` |
| `onProcessingmultiple`, `onCanceledmultiple`, `onCompletemultiple`, `onMaxfilesreached` | `AnyDropFile[]` |
| `onUploadprogress` | `{ file: AnyDropFile; progress: number; bytesSent: number }` |
| `onTotaluploadprogress` | `{ progress: number; totalBytes: number; totalBytesSent: number }` |
| `onSending` | `{ file: AnyDropFile; xhr: XMLHttpRequest; formData?: FormData }` |
| `onSendingmultiple` | `{ files: AnyDropFile[]; xhr: XMLHttpRequest; formData?: FormData }` |
| `onSuccess` | `{ file: AnyDropFile; response: unknown; progressEvent?: ProgressEvent \| null }` |
| `onSuccessmultiple` | `{ files: AnyDropFile[]; response: unknown; progressEvent?: ProgressEvent \| null }` |
| `onError` | `{ file: AnyDropFile; message: unknown; xhr?: XMLHttpRequest }` |
| `onErrormultiple` | `{ files: AnyDropFile[]; message: unknown; xhr?: XMLHttpRequest }` |
| `onQueuecomplete` | none |
| `onPaused`, `onResumed` | `PauseTarget` |
| `onOffline`, `onOnline` | none |
| `onReconnecting` | `{ attempt: number; delayMs: number }` |
| `onErrorlistchanged` | `ErrorEntry[]` |
| `onActionclicked` | `{ action: string; target: AnyDropFile \| FolderNode }` |
| `onDrop`, `onDragstart`, `onDragend`, `onDragenter`, `onDragover`, `onDragleave` | `DragEvent` |
| `onPaste` | `ClipboardEvent` |

`onSuccess` and `onSuccessmultiple` name the third value `progressEvent` (it is the argument `e` in core). Files and folders are the live objects of core, not copies. The payload types are exported: `AnyDropEventPayloads` is the map of all payloads, and `AnyDropEventPayload<'success'>` is one of them.

```tsx
import type { AnyDropEventPayload } from '@vedratech/anydrop-react';

function onSuccess({ file, response }: AnyDropEventPayload<'success'>) {
  console.log(file.relativePath, response);
}
```

## The ref

The ref holds the UI instance (`AnyDropInstance`, the `AnyDrop` class of `@vedratech/anydrop-ui`), so every [method](/api/methods) is available: `pause()`, `resume()`, `retryFailedOnly()`, `getErrors()`, `addFile()` and so on.

```tsx
import { useRef } from 'react';
import { AnyDrop, type AnyDropInstance } from '@vedratech/anydrop-react';

export function Uploader() {
  const ref = useRef<AnyDropInstance | null>(null);
  return (
    <>
      <AnyDrop ref={ref} url="/upload" />
      <button type="button" onClick={() => ref.current?.pause()}>Pause all</button>
    </>
  );
}
```

`ref.current` is `null` during server rendering and before the first mount. It follows the live instance, so it is never a destroyed one.

## Render slots

A render prop replaces the default content of one part of the UI with real React components. There are five, one for each [render hook](/guide/render-hooks):

| Prop | Context type | Replaces |
|---|---|---|
| `renderFile` | `AnyDropFileContext` | The content of a file row |
| `renderFolder` | `AnyDropFolderContext` | The content of a folder row |
| `renderToolbar` | `AnyDropToolbarContext` | The toolbar |
| `renderMessage` | `AnyDropMessageContext` | The drop message and the empty state |
| `renderErrorItem` | `AnyDropErrorItemContext` | A row of the error panel |

The context types are exported by `@vedratech/anydrop-ui`. Their fields are listed in [Render hooks](/guide/render-hooks): for a file row, for example, `label`, `sizeText`, `status`, `progress`, `errorMessage`, `can.pause`, and the methods `pause()`, `resume()`, `retry()` and `cancel()`.

```tsx
import { AnyDrop } from '@vedratech/anydrop-react';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';

function FileRow({ ctx }: { ctx: AnyDropFileContext }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: '100%' }}>
      <strong style={{ flex: 1 }}>{ctx.label}</strong>
      <span>{Math.round(ctx.progress)}%</span>
      {ctx.can.pause && <button type="button" onClick={() => ctx.pause()}>Pause</button>}
      {ctx.can.resume && <button type="button" onClick={() => ctx.resume()}>Resume</button>}
    </div>
  );
}

<AnyDrop url="/upload" renderFile={(ctx) => <FileRow ctx={ctx} />} />;
```

How slots behave:

- **They are rendered inside your React tree, through a portal.** Context providers above `<AnyDrop>` (theme, i18n, router, query client, Redux) work inside rows, and DevTools show the rows under `<AnyDrop>`.
- **A row is mounted once and updated in place.** On every progress update the same component gets a new `ctx` and re-renders. Its state and focus survive, so a menu or a text field in a row does not reset while the file uploads. The error panel rows are shown once and never updated.
- **Rows are mounted before the next paint.** All rows created in one UI paint are committed together, so rows do not flash empty while scrolling.
- **A row lives as long as its row on screen, not as long as its file.** Progress and status changes update the same component. A structural change unmounts it and mounts a new one: files or folders added or removed, a folder expanded or collapsed, a row scrolled out of the virtualised list, or a `render` or `layout` rebuild. State that must survive (open details, typed text) belongs outside the row, in context or a store, keyed by `ctx.file.id`.
- **Use hooks in your own row component**, as in `FileRow` above, not in the render function: `renderFile` is called by the wrapper while it renders, and is not a component.
- **A slot is a replace.** While a slot is present it replaces the default content, and `renderFile` returning `null` shows an empty row, not the default. To keep the default and add to it, use the `render` option instead (decorate mode, see [Render hooks](/guide/render-hooks)). A slot prop overrides the same key of `options.render`.
- **A slot that appears or disappears rebuilds the panel.** Only the presence of a render prop counts. A new function identity on each render does not.
- **A throwing row does not take down the uploader.** Each slot has its own error boundary that renders nothing for that slot and reports the error (`reportError`, or `console.error` where it does not exist).
- Keep the content inside the row height (`rowHeight`, `errorRowHeight`) and make interactive elements real buttons of at least 44 by 44 px.

## Headless: `useAnyDrop`

`useAnyDrop(options)` creates a headless `AnyDropCore` (no UI) after mount and returns its state, for when you build your own interface:

```tsx
import { useAnyDrop } from '@vedratech/anydrop-react';

export function MyUploader() {
  const { instance, files, errors, progress, connection } = useAnyDrop({
    url: '/upload',
    chunking: true,
    autoProcessQueue: true,
  });

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        instance?.drop(e.nativeEvent); // call it synchronously
      }}
    >
      <p>{files.length} files, {Math.round(progress.progress)}%</p>
      <p>{errors.length} failed, connection {connection.state}</p>
    </div>
  );
}
```

The return value is the state plus `instance`:

| Field | Type | Description |
|---|---|---|
| `files` | `readonly AnyDropFile[]` | A copy of `instance.files` |
| `tree` | `FolderNode \| null` | The live root of the folder tree. Its identity does not change, so read it during render and do not use it as a dependency |
| `errors` | `readonly ErrorEntry[]` | The error list (the same data as `onErrorlistchanged`) |
| `progress` | `{ progress: number; totalBytes: number; totalBytesSent: number }` | Overall progress, 0 to 100 |
| `connection` | `ConnectionState` | `{ state: 'online' \| 'offline' \| 'unreachable', attempt, retryAt }` |
| `instance` | `AnyDropCore \| null` | The headless instance |

The state is rebuilt at most once per animation frame, so a progress event for each chunk does not re-render your component each time. On the server and before mount, `instance` is `null` and the state is empty (`files: []`, `tree: null`, `errors: []`, zero progress, `online`). Options changes go to `setOption()` with the same rules as for the component. See [Headless core](/guide/headless-core) for the instance.

## StrictMode

In development, `<StrictMode>` mounts, unmounts and mounts every component again. AnyDrop follows the React rule that setup and cleanup are symmetric: the instance is created in the effect and destroyed in its cleanup, so in development you see create, destroy, create. At no moment are two instances alive, every cleanup leaves zero listeners, and `ref.current` points to the live one.

The consequence: **`options.init` runs twice in development.** Make it safe to repeat, or do not rely on it, and use `onAddedfile` and the other event props instead.

`<Activity mode="hidden">` (React 19.2 and later) runs effect cleanups, so hiding an uploader with it destroys the instance just like an unmount: uploads in progress stop, and the progress records survive only if you set `persistState` (see [Resume after reload](/guide/resume-after-reload)). To keep an uploader running while it is out of sight, keep it mounted and hide it with CSS, or lift the state up with `useAnyDrop`.

## Next.js and server rendering

Nothing touches `window` or `document` when the package is imported or while React renders on the server. On the server and during hydration, the component renders two empty `div` elements, and the instance is created in the browser, right after mount. The server and the first client render match, so there is no hydration warning. The uploader appears one layout pass after hydration. If a layout shift matters, give the outer element a height with `className` or `style`:

```tsx
<AnyDrop url="/upload" style={{ minHeight: 220 }} />
```

The package is marked `'use client'`, so you can import it in the App Router. A Server Component may render `<AnyDrop>` with props that can be serialised (strings, numbers, plain data). Handlers, render props and function options cannot cross from a Server Component, so put them in a small Client Component of your own:

```tsx
// app/uploader.tsx
'use client';

import { AnyDrop } from '@vedratech/anydrop-react';

export function Uploader() {
  return (
    <AnyDrop
      url="/api/upload"
      options={{ chunking: true }}
      onQueuecomplete={() => console.log('done')}
    />
  );
}
```

```tsx
// app/layout.tsx (a Server Component)
import '@vedratech/anydrop-ui/style.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx (a Server Component)
import { Uploader } from './uploader';

export default function Page() {
  return <Uploader />;
}
```

### The upload proxy pattern

Upload requests come from the browser, so they must reach your upload backend. The simplest way is to keep the browser on one origin and forward `/upload` to the backend. This avoids CORS, and the backend does not need to be public. In the App Router a route handler does it:

```ts
// app/upload/[[...path]]/route.ts
export const dynamic = 'force-dynamic';

const BACKEND = process.env.UPLOAD_BACKEND_URL ?? 'http://localhost:3001';
const HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'];

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of HOP) headers.delete(h);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(BACKEND + url.pathname + url.search, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });
  const out = new Headers(upstream.headers);
  for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) {
    out.delete(h);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as OPTIONS };
```

The handler reads each chunk into memory before it forwards it, so turn on `chunking` and keep `chunkSize` modest (the default is 2 MiB). Platforms that cap the body of a function request (many serverless hosts do) need a chunk size below that cap, or a rewrite to the backend instead (`rewrites` in `next.config.js`, which needs the backend URL at build time). Either way, the backend must implement the [upload contract](/protocol): the options `manifestUrl`, `chunkStatusUrl` and `finalizeUrl` are paths on that same origin.

A complete working app is in `examples/nextjs` in the repository. The React and Vite example is in `examples/react-vite`.

## Recipes

### Pause and resume buttons

```tsx
import { useRef } from 'react';
import { AnyDrop, type AnyDropInstance } from '@vedratech/anydrop-react';

export function Uploader() {
  const ref = useRef<AnyDropInstance | null>(null);
  return (
    <>
      <AnyDrop ref={ref} url="/upload" options={{ chunking: true }} />
      <button type="button" onClick={() => ref.current?.pause()}>Pause all</button>
      <button type="button" onClick={() => ref.current?.resume()}>Resume all</button>
    </>
  );
}
```

`pause()` and `resume()` act on everything. For one folder or one file use `pauseFolder(path)` and `pauseFile(file)`. See [Pause and resume](/guide/pause-resume).

### Your own error list

`onErrorlistchanged` gives the whole list each time it changes. Keep it in state and render it anywhere:

```tsx
import { useRef, useState } from 'react';
import { AnyDrop, type AnyDropInstance } from '@vedratech/anydrop-react';
import type { ErrorEntry } from '@vedratech/anydrop-core';

export function UploaderWithErrors() {
  const ref = useRef<AnyDropInstance | null>(null);
  const [errors, setErrors] = useState<readonly ErrorEntry[]>([]);

  return (
    <>
      <AnyDrop ref={ref} url="/upload" onErrorlistchanged={setErrors} />
      <h2>Failed uploads ({errors.length})</h2>
      <button
        type="button"
        disabled={errors.length === 0}
        onClick={() => ref.current?.retryFailedOnly()}
      >
        Retry failed
      </button>
      <ul>
        {errors.map((e) => (
          <li key={e.fileId ?? e.relativePath}>
            {e.relativePath}: {e.code} ({e.message})
          </li>
        ))}
      </ul>
    </>
  );
}
```

The built-in error panel is still shown. Turn it off with the `errorPanel` option if you only want your own list. See [Errors and retry](/guide/errors-retry).

### A custom row with context

A row is a normal component, so it can read context and use hooks:

```tsx
import { createContext, useContext } from 'react';
import { AnyDrop } from '@vedratech/anydrop-react';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';

const Currency = createContext('USD');

function PricedRow({ ctx }: { ctx: AnyDropFileContext }) {
  const currency = useContext(Currency); // works: rows are in your React tree
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: '100%' }}>
      <span style={{ flex: 1 }}>{ctx.label} ({ctx.sizeText})</span>
      <span>{currency}</span>
      <progress max={100} value={ctx.progress} />
      {ctx.status === 'error' && (
        <button type="button" onClick={() => ctx.retry()}>
          Retry
        </button>
      )}
    </div>
  );
}

export const Uploader = () => (
  <Currency.Provider value="EUR">
    <AnyDrop url="/upload" renderFile={(ctx) => <PricedRow ctx={ctx} />} />
  </Currency.Provider>
);
```

For small changes (an extra button, a badge) you do not need a slot: `rowActions` and `render` add to the default row. See [Row actions and icons](/guide/row-actions-icons).

### Themes and languages at runtime

```tsx
import { AnyDrop } from '@vedratech/anydrop-react';
import { de } from '@vedratech/anydrop-ui/locales/de';
import '@vedratech/anydrop-ui/themes/rounded.css';

<AnyDrop url="/upload" locale={de} themePreset="rounded" layout="compact" />;
```

Changing `locale`, `themePreset` or `layout` later calls `setOption()`, and the uploader updates without being recreated.

## Sizes

The React wrapper is about 3.4 kB gzip on top of AnyDrop, without React. See the [size comparison](/size-comparison) for the numbers of core and ui.

## Exported types

| Type | What it describes |
|---|---|
| `AnyDropProps` | All props of `<AnyDrop>` (options, convenience props, event props, render slots). |
| `AnyDropEventProps` | The `on<Event>` props, one per core event, with typed payloads. |
| `AnyDropSlotProps` | The `render*` slot props. |
| `AnyDropEventPayloads` / `AnyDropEventPayload<K>` | Payload of every event, by event name. |
| `AnyDropState` | The live state returned by `useAnyDrop()`. |
| `AnyDropProgress` | The `progress` part of that state. |
| `AnyDropInstance` | The instance type exposed through `ref`. |
