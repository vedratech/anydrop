---
title: "Pause and resume uploads in the browser"
description: "Add pause and resume to browser uploads: pause everything, one folder or one file, choose what happens to the chunk in flight, and listen for pause events."
---

# Pause and resume uploads in the browser

Browsers give you no pause button for an `XMLHttpRequest`. To pause an upload you have to stop sending, remember what the server has, and send only the rest later. AnyDrop does that with chunked uploads and lets you pause at three levels.

## The calls

```js
import { AnyDrop } from '@vedratech/anydrop-ui';

const ad = new AnyDrop('#uploader', { url: '/upload', chunking: true, pauseMode: 'abort' });

ad.pause(); // everything
ad.pauseFolder('Photos/2024'); // every file under a folder, also files added to it later
ad.pauseFile(file); // one file (or its id)

ad.resume();
ad.resumeFolder('Photos/2024');
ad.resumeFile(file);
```

The UI already has **Pause all**, **Resume all** and a Pause or Resume button on every folder and file row.

## What a pause does

Each pause has its own flag, so they do not undo each other: a file in a paused folder stays paused until the folder is resumed. `resume()` clears the instance pause and the system pauses (offline, hidden tab, unreachable server), but not folder or file pauses.

`pauseMode` decides what happens to the chunk that is in flight:

- `'abort'` (default) stops the request at once and sends that chunk again in full on resume.
- `'finishChunk'` lets the chunk in flight finish and count, then pauses.

A paused file gives up its upload slot. When it resumes, only the chunks the server has not acknowledged are sent. Resuming from the last finished chunk needs `chunking: true`, so use it for large files.

## React to it

```js
ad.on('paused', (target) => console.log('paused', target.scope, target.reason));
ad.on('resumed', (target) => console.log('resumed', target.scope, target.reason));
ad.getPausedFiles(); // the paused files
```

`target.scope` is `'all'`, `'folder'` or `'file'`. For `'all'`, `reason` is `'user'`, `'offline'`, `'hidden'` or `'unreachable'`, so you can tell a user pause from an automatic one.

## Pausing across a reload

A pause lives in the page. If the user closes the tab, the upload stops, and when the same files are dropped again only the missing chunks are sent: see [Resume after reload](/guide/resume-after-reload).

## Safari note

In WebKit, aborting a request whose body was already sent does not always close the connection, so the server may still commit that chunk and receive it a second time on resume. Chunk writes are idempotent, so the file stays correct. Setting `chunkStatusUrl` lets the client ask the server what it has before resending.

## Related

- [Pause and resume guide](/guide/pause-resume) for the full rules.
- [Uploads that survive a lost connection](/use-cases/upload-lost-connection), where pauses happen automatically.
- [Chunked and resumable uploads](/use-cases/chunked-resumable-uploads)
