# Quick start (UI)

The UI package gives you a drop zone, a folder tree, a toolbar and an error panel in a few lines.

## 1. Add an element

```html
<div id="uploader"></div>
```

## 2. Create the instance

With a bundler (Vite, webpack, esbuild, ...):

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkSize: 5 * 1024 * 1024,
  sendManifest: true, // send the folder structure, including empty folders
  manifestUrl: '/upload/manifest',
  chunkStatusUrl: '/upload/status', // resume: ask the server which chunks it has
  finalizeUrl: '/upload/finalize', // assemble the file after the last chunk
});

ad.on('queuecomplete', () => console.log('done', ad.getErrors()));
```

Without a bundler, load the [CDN build](/guide/installation#cdn); then `new AnyDrop('#uploader', { ... })` works the same way and needs no imports.

## 3. Implement the backend

Your server answers the requests described in the [backend overview](/backend/). The [Express example](/backend/express) is a complete working server.

Only `url` is required. Without `sendManifest`, `chunkStatusUrl` and `finalizeUrl` the UI still uploads folders and files: each file is sent with its relative path in the `adRelativePath` field.

## What you get

- **Drop zone.** Drag states, drops of files and folders, paste (with `enablePaste`), click to open the file dialog.
- **Pickers.** A "Select files" and a "Select folder" button. The folder button exists only where the browser supports it; on iOS a notice explains that only files can be selected.
- **List.** A collapsible tree (or a flat list with `folderView: 'flat'`) with progress, status and pause, resume, retry and cancel buttons per folder and file. It is virtualised, so thousands of files stay smooth.
- **Toolbar.** A summary, total progress, Pause all, Resume all, Retry failed and Clear.
- **Error panel.** One row per failed file with its reason, Retry failed, Export JSON, Export CSV, Copy list and Dismiss.
- **Connection banner.** Shown while the browser is offline or the server cannot be reached, with a "Retry now" button.

## Use a form

A `<form>` can be the element. Its `action` becomes the `url`, and every named field of the form is added once per request:

```html
<form action="/upload" id="my-form" class="anydrop">
  <input type="hidden" name="albumId" value="42" />
</form>
```

## Change options at runtime

```js
ad.setOption('folderView', 'flat');
ad.setOption('maxFiles', 20);
```

## Clean up

```js
ad.destroy(); // removes the DOM, listeners and timers it added
```

## Next steps

- [Folders and the tree](/guide/folders) and [Chunked uploads](/guide/chunked-uploads)
- [Customising the UI](/guide/customising-ui) for texts, templates and colours
- [Options](/api/options) for everything you can configure
