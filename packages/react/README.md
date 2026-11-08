# @vedratech/anydrop-react

**React and Next.js component for folder upload: drag and drop folders, chunked and resumable uploads, pause and resume, retry. Part of [AnyDrop](https://github.com/vedratech/anydrop).**

[![npm version](https://img.shields.io/npm/v/@vedratech/anydrop-react.svg)](https://www.npmjs.com/package/@vedratech/anydrop-react)
[![npm downloads](https://img.shields.io/npm/dm/@vedratech/anydrop-react.svg)](https://www.npmjs.com/package/@vedratech/anydrop-react)
[![bundle size](https://deno.bundlejs.com/badge?q=@vedratech/anydrop-react)](https://bundlejs.com/?q=@vedratech/anydrop-react)
[![CI](https://github.com/vedratech/anydrop/actions/workflows/ci.yml/badge.svg)](https://github.com/vedratech/anydrop/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/@vedratech/anydrop-react.svg)](https://github.com/vedratech/anydrop/blob/main/LICENSE)
[![docs](https://img.shields.io/badge/docs-vedratech.github.io%2Fanydrop-1d4ed8.svg)](https://vedratech.github.io/anydrop/)

An `<AnyDrop>` component for React 18 and 19, with an `on<Event>` prop for every event, custom row components through render props (they render inside your React tree, so context works), and a headless `useAnyDrop` hook. It works in StrictMode and in the Next.js App Router, and it is safe to import during server rendering.

**Documentation: https://vedratech.github.io/anydrop/guide/react** ([API reference](https://vedratech.github.io/anydrop/api/), [backend contract](https://vedratech.github.io/anydrop/protocol), [live demo](https://vedratech.github.io/anydrop/demo))

## Install

```sh
npm install @vedratech/anydrop-react @vedratech/anydrop-ui @vedratech/anydrop-core
```

`react`, `react-dom` (18 or newer), `@vedratech/anydrop-ui` and `@vedratech/anydrop-core` are peer dependencies.

## Quick start

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

Using TypeScript 6 in a new Vite app? Keep `/// <reference types="vite/client" />` (Vite templates have it in `src/vite-env.d.ts`) so the CSS import type-checks.

## Props

| Prop | Description |
|---|---|
| `options` | The full configuration (every UI and core option). Replace the object to change it. |
| `url`, `locale`, `themePreset`, `layout` | Override the same key of `options` when not `undefined` |
| `disabled` | Calls `disable()` or `enable()` |
| `id`, `className`, `style` | Set on the outer element |
| `renderFile`, `renderFolder`, `renderToolbar`, `renderMessage`, `renderErrorItem` | Render slots: `(ctx) => ReactNode` replaces that part of the UI |
| `on<Event>` | One prop for each of the 41 events: `onAddedfile`, `onUploadprogress`, `onErrorlistchanged`, ... A single argument is passed as is, several arguments as one object |
| `ref` | The live UI instance (`pause()`, `resume()`, `retryFailedOnly()`, ...), or `null` on the server |

Inline objects and functions are fine: functions are called through a stable wrapper, and plain data is compared by value, so nothing rebuilds on each render. The instance is created after mount and destroyed on unmount, and a prop change never recreates it. `init`, `fallback` and `forceFallback` are read only at creation.

## Custom rows

```tsx
import { AnyDrop } from '@vedratech/anydrop-react';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';

function FileRow({ ctx }: { ctx: AnyDropFileContext }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: '100%' }}>
      <strong style={{ flex: 1 }}>{ctx.label}</strong>
      <span>{Math.round(ctx.progress)}%</span>
      {ctx.can.pause && <button type="button" onClick={() => ctx.pause()}>Pause</button>}
    </div>
  );
}

<AnyDrop url="/upload" renderFile={(ctx) => <FileRow ctx={ctx} />} />;
```

A row is mounted once and updated in place, so its state and focus survive progress updates.

## Headless

```tsx
import { useAnyDrop } from '@vedratech/anydrop-react';

const { instance, files, tree, errors, progress, connection } = useAnyDrop({ url: '/upload' });
```

`useAnyDrop` creates a headless core instance after mount and returns its state, updated at most once per animation frame.

## Next.js

The package is marked `'use client'`. A Server Component may render `<AnyDrop url="/upload" />` with plain props. Handlers, render props and function options need a small Client Component of your own. The guide has the pattern, and a route handler that forwards `/upload` to your backend.

## Size

About 3.4 kB gzip on top of AnyDrop, without React. Sizes of core and ui: [size comparison](https://vedratech.github.io/anydrop/size-comparison).

## Browser support and iOS

The same as the UI package: [Mobile and iOS](https://vedratech.github.io/anydrop/guide/mobile-ios).

## Licence

MIT. Created and maintained by **Jayesh Gupta**.
