---
title: "Upload events cookbook"
description: "Recipes for AnyDrop events: progress bars, completion, errors, folder events, pause and resume events and DOM events, with copy-paste code."
---

# Events cookbook

Short recipes for common tasks. In all of them `ad` is an instance, created as `new AnyDrop('#uploader', { url: '/upload' })` (or `new AnyDropCore(...)`). See [Events](/api/events) for the full list.

## Show overall progress

```js
const bar = document.querySelector('#total-bar'); // a <progress id="total-bar" max="100">
ad.on('totaluploadprogress', (percent) => (bar.value = percent));
```

## Do something when everything is done

```js
ad.on('queuecomplete', () => {
  const failed = ad.getErrors();
  if (failed.length === 0) window.location.href = '/done';
  else console.warn(failed.length + ' files failed');
});
```

## Send extra fields with every request

```js
ad.on('sending', (file, xhr, formData) => {
  formData.append('albumId', '42');
});
```

Or without an event, with the `params` option (merged over the built-in fields):

```js
ad.setOption('params', { albumId: '42' });
```

## Add an auth header

```js
ad.setOption('headers', { Authorization: 'Bearer ' + token });
```

`headers` is used by every request (uploads, manifest, status, finalize). Headers set inside `sending` reach uploads only.

## Use the server's response

```js
ad.on('success', (file, response) => {
  console.log(file.relativePath, 'stored as', response.path); // the finalize response, else the last upload response
});
```

## Log every event while developing

```js
const names = ['addedfile', 'addedfolder', 'processing', 'success', 'error', 'paused', 'resumed', 'queuecomplete'];
for (const name of names) ad.on(name, (...args) => console.log(name, ...args));
```

## Count files per status

```js
ad.on('totaluploadprogress', () => {
  const tree = ad.getTree();
  console.log(tree.counts); // { total, added, queued, uploading, paused, success, error, canceled }
});
```

## Warn before leaving the page

```js
window.addEventListener('beforeunload', (e) => {
  if (ad.getActiveFiles().length > 0) e.preventDefault();
});
```

## Remove finished files automatically

```js
ad.on('queuecomplete', () => ad.removeAllFiles());
```

## Retry when the connection comes back

AnyDrop already resumes by itself. To react to it:

```js
ad.on('paused', (t) => t.scope === 'all' && t.reason !== 'user' && console.log('waiting:', t.reason));
ad.on('resumed', (t) => t.scope === 'all' && console.log('resumed after', t.reason));
```

## React to a folder

```js
ad.on('foldercomplete', (folder) => {
  console.log(folder.path, 'finished with', folder.counts.error, 'errors');
});
```

## Unsubscribe

```js
const off = ad.on('success', handler);
off(); // removes this one listener
ad.off('success'); // removes every success listener
ad.off(); // removes every listener
ad.once('queuecomplete', () => console.log('only the first time'));
```

## DOM events (UI)

The UI dispatches a `CustomEvent` named `anydrop:<event>` on the element, with the arguments in `detail`:

```js
document.querySelector('#uploader').addEventListener('anydrop:success', (e) => {
  const [file, response] = e.detail;
  console.log(file.name, response);
});
```

## Handlers as options

```js
new AnyDrop('#uploader', {
  url: '/upload',
  success(file, response) {
    console.log('this is the instance:', this === AnyDrop.forElement('#uploader'));
  },
});
```

In the UI, handlers given as options run in addition to the built-in rendering.
