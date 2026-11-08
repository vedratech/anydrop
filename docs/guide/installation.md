# Installation

## npm

```sh
npm install @vedratech/anydrop-ui @vedratech/anydrop-core   # drop zone and UI
npm install @vedratech/anydrop-core                          # headless engine only
```

The UI package depends on the core, so install both. With pnpm or yarn use `pnpm add` or `yarn add`.

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css'; // the stylesheet is a separate file
```

Both packages ship ESM, CommonJS and TypeScript types, and have no side effects on import except the CSS.

## CDN

Pin the minor version. The UI build includes the core and sets `window.AnyDrop` to the class, as Dropzone does:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1/dist/style.css" />
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-ui@0.1"></script>

<div id="uploader"></div>
<script>
  new AnyDrop('#uploader', { url: '/upload' });
</script>
```

The CDN build also attaches to every element with the class `dropzone` or `anydrop` after the page loads. Set `AnyDrop.autoDiscover = false` right after the script tag to stop that. The npm builds never do this on import; call `AnyDrop.discover()` yourself.

The headless core alone: `https://cdn.jsdelivr.net/npm/@vedratech/anydrop-core@0.1`, global `AnyDropCore`:

```html
<script src="https://cdn.jsdelivr.net/npm/@vedratech/anydrop-core@0.1"></script>
<script>
  const core = new AnyDropCore.AnyDropCore({ url: '/upload' });
</script>
```

## Frameworks

There are no framework wrappers yet. The API is driven only by options, methods and events, so it works in any framework: create the instance when the component mounts and call `destroy()` when it unmounts. See [SSR and frameworks](/guide/ssr-frameworks).

## Requirements

- Browsers: current Chrome, Edge, Firefox and Safari, and Safari on iOS and iPadOS. The code targets ES2019 and ships no polyfills. See [Mobile and iOS](/guide/mobile-ios) for the browser table.
- Node 18 or later for importing the packages in a server-side build (they only import; nothing runs on the server).
- A backend that implements the [upload contract](/backend/).
