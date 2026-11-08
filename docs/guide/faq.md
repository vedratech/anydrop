---
title: "FAQ and troubleshooting"
description: "Answers about AnyDrop: server needs, CORS, large files, resume after reload, iOS limits and fixes for common upload problems."
---

# FAQ and troubleshooting

## General

### Does it include a server?

No. AnyDrop is frontend only. Your backend implements the [upload contract](/backend/). There are [Express](/backend/express) and [Laravel](/backend/laravel) examples.

### How big is it?

The ready-made CDN file with the UI is 34.8 kB gzip (34.7 kB for the ui and core bundle plus 3.6 kB of CSS), and the headless core is 18.4 kB. Compared with Uppy and FilePond, measured the same way, see [Size comparison](/size-comparison).

### Which browsers are supported?

Current Chrome, Edge, Firefox and Safari, Safari on iOS and iPadOS, and Chrome on Android. See [Mobile and iOS](/guide/mobile-ios).

## Folders

### Folder upload does not work on my iPhone.

iOS Safari has no folder picker and no folder drag and drop. AnyDrop hides the folder button and shows a notice. Users select files from Photos or Files instead.

### Empty folders do not arrive on my server.

Browsers report empty folders only for **drops**, not for `<input webkitdirectory>`, and they reach the server only through the manifest. Set `sendManifest: true` and `manifestUrl`, and create every folder listed in the manifest on the server.

### My manifest request fails with 413.

A manifest lists every file of a batch. The default JSON body limit of many servers (100 kB in Express) rejects more than about 600 files. Raise the limit for the manifest route (the [Express example](/backend/express) uses 20 MB).

## Uploads

### Chunks reach the server but the file is never assembled.

Set `finalizeUrl` and implement the finalize endpoint, or assemble the file in your own `chunksUploaded` hook. Without either, the file is reported as succeeded after its last chunk, and nothing assembles it.

### Large uploads fail at the last chunk.

If assembling the file takes longer than the stall watchdog allows (`stallTimeout`, 30 s), the request is aborted and retried. Use `finalizeUrl`, so assembly runs in its own request, or raise `stallTimeout`.

### My server returns 400 INVALID_CHUNK.

The chunk length did not match what the server expected: `adChunkSize`, or the rest of the file for the last chunk. Check the field values your server reads, and that no proxy changes the body.

### Uploads work locally but fail on the live site (cross-origin).

When the page and the API are on different origins, answer the CORS preflight (`OPTIONS`) for the upload routes, allowing the methods `GET`, `POST` and `HEAD` and the headers the client sends (`X-Requested-With`, `Cache-Control`, `Content-Type` and your own). Set `withCredentials: true` if you use cookies, with a matching `Access-Control-Allow-Credentials`.

### Nothing is uploaded and no error is shown.

In the headless core, without a `url`, files stay `queued` (the UI constructor throws `No URL provided.`). Set `url`, or call `setOption('url', ...)`. Also check `autoProcessQueue`: with `false`, call `processQueue()`.

### `parallelUploads` and chunk parallelism confuse me.

`parallelUploads` counts files uploading at once. `parallelChunkUploads` is how many chunks one file sends at once. `maxChunksInFlight` caps all requests together. See [Chunked uploads](/guide/chunked-uploads#parallelism).

## Resume and connection

### Resume after a reload does not work.

The user has to add the same files again (a page cannot read files from disk by itself). Check that `persistState` is not `false`, that `persistKey` is the same as before, and that the browser allows IndexedDB (private mode and some iOS versions block it, and AnyDrop then keeps state in memory only). Setting `chunkStatusUrl` makes the server's knowledge decide.

### Files stay paused with "Waiting for connection".

The browser is offline, or the server is unreachable. Set `connectivityProbeUrl` so a working server is detected quickly, and use the **Retry now** button or `reconnect()`. See [Offline and connectivity](/guide/offline).

### I paused a folder and it did not resume after I came back online.

Pauses made by the user stay until you resume them. Only system pauses (offline, hidden tab, unreachable server) end by themselves.

## UI

### The UI looks unstyled.

Load the stylesheet: `import '@vedratech/anydrop-ui/style.css'`, or the `<link>` tag from the CDN. It is a separate file.

### My `success` handler renders the preview twice.

In the UI, handlers passed as options add to the built-in rendering instead of replacing it. Set `disablePreviews: true` to render everything yourself, or drop your handler.

### Paste does not add files.

Set `enablePaste: true`. It is off by default.

### It attaches to elements I did not ask for.

The CDN build attaches to every `.anydrop` element. Set `AnyDrop.autoDiscover = false` right after the script tag, or use other class names. The npm builds never do this.

### How do I translate it?

Every text is a `dict*` option. See [Customising the UI](/guide/customising-ui#texts-dict).

### How do I change the colours?

Set CSS variables such as `--ad-color-accent` on the element. See [CSS variables](/guide/customising-ui#css-variables).

## Frameworks

### `window is not defined` during server rendering.

Importing the packages is safe. Create the instance after your component mounted, in the browser only. See [SSR and frameworks](/guide/ssr-frameworks).

## Still stuck?

Search the [API reference](/api/), look at the [live demo](/demo), or [open an issue](https://github.com/vedratech/anydrop/issues).
