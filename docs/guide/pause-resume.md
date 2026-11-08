# Pause and resume

Uploads can be paused at three levels: the whole instance, one folder, or one file. Each pause has its own flag, so they do not undo each other.

```js
ad.pause(); // everything
ad.pauseFolder('Photos/2024'); // every file under a folder, also files added to it later
ad.pauseFile(file); // one file (or its id)

ad.resume();
ad.resumeFolder('Photos/2024');
ad.resumeFile(file);
```

In the UI, the toolbar has **Pause all** and **Resume all**, and every folder row and file row has its own Pause and Resume button.

## How the flags combine

`resume*()` clears only its own flag. A file in a paused folder stays paused until the folder is resumed, and a file stays paused while the instance is paused. `resume()` clears the instance pause and every system reason (offline, hidden tab, unreachable server), but not folder or file pauses.

Offline and hidden-page pauses are separate **system** flags. Coming back online never undoes a pause the user made. See [Offline and connectivity](/guide/offline).

## What a pause does to requests in flight

```js
new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  pauseMode: 'abort', // default
});
```

- `'abort'` stops the requests at once. The chunk that was in flight is sent again in full when the upload resumes.
- `'finishChunk'` lets the chunk in flight finish and count, and pauses after it. For a whole (non-chunked) file the file then finishes.

A paused file gives up its upload slot, keeps its place in the add order, and when it resumes it sends only the chunks the server has not acknowledged.

::: info WebKit
In WebKit (Safari), aborting a request whose body was already sent does not always close the connection, so the server may still commit that chunk. With `pauseMode: 'abort'` the resent chunk is then a second, identical write. Because chunk writes are idempotent the file stays correct. Set `chunkStatusUrl` so the client asks the server what it has before resending.
:::

## Events

```js
ad.on('paused', (target) => console.log('paused', target.scope, target.reason));
ad.on('resumed', (target) => console.log('resumed', target.scope, target.reason));
```

`target` is `{ scope: 'all', reason }` (reason `'user'`, `'offline'`, `'hidden'` or `'unreachable'`), `{ scope: 'folder', folder, reason: 'user' }` or `{ scope: 'file', file, reason: 'user' }`. Each event fires once per call.

A paused file has the status `paused` (not `uploading`), and `getActiveFiles()` includes it. `getPausedFiles()` lists them.

## Pausing during an outage

While the browser is offline or the server is unreachable, files are paused by the system. The Pause buttons stay available: a pause the user makes then survives the reconnect, while the system pause ends by itself.

## Also see

- [Resume after reload](/guide/resume-after-reload) for continuing after the page was closed.
- [`pause()`, `resume()`, `pauseFolder()`](/api/methods#pause-and-resume) in the method reference.
