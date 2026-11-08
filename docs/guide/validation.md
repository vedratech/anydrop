---
title: "File validation: size, type, count and paths"
description: "Validate files before upload: maxFilesize, acceptedFiles, maxFiles, a custom accept function and hidden-file rules, with the error codes you get back."
---

# Validation

Files are checked when they are added, before anything is uploaded. A rejected file stays in the list with an error (`error` event, an entry in the [error list](/guide/errors-retry)) and is never sent.

## File type

```js
new AnyDrop('#uploader', {
  url: '/upload',
  acceptedFiles: 'image/*,.pdf', // the same syntax as the HTML accept attribute
});
```

The list is comma-separated: `.ext`, `type/*` or `type/subtype`. A non-matching file is rejected with code `REJECTED_TYPE` and the message `dictInvalidFileType`.

::: tip HEIC photos on iOS
iOS gives HEIC photos an empty MIME type, so Dropzone rejects them under `image/*`. AnyDrop guesses the type from the extension when the MIME type is empty. Files with a MIME type behave exactly as in Dropzone.
:::

## File size

```js
new AnyDrop('#uploader', {
  url: '/upload',
  maxFilesize: 2048, // MiB, default 256; null or 0 disables the check
  dictFileTooBig: 'File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.',
});
```

Too-large files fail with `REJECTED_SIZE`. `filesizeBase` (default `1000`) sets the base used by `filesize()`.

## Maximum number of files

```js
const ad = new AnyDrop('#uploader', { url: '/upload', maxFiles: 10 });

ad.on('maxfilesexceeded', (file) => ad.removeFile(file));
ad.on('maxfilesreached', () => console.log('limit reached'));
```

Extra files are rejected with `MAX_FILES` and emit `maxfilesexceeded`. The UI element also gets the class `dz-max-files-reached`.

## Your own check

```js
new AnyDrop('#uploader', {
  url: '/upload',
  accept(file, done) {
    if (file.size === 0) done('Empty file');
    else done();
  },
});
```

`accept` runs after the built-in checks. `done()` accepts and `done(message)` rejects the file with code `REJECTED`. It can be asynchronous: the batch waits for it.

## Hidden files and paths

- Files whose name starts with `.` are skipped inside dropped or picked folders (`ignoreHiddenFiles`, default `true`).
- A path with a `..` segment is rejected with `INVALID_PATH`, because it could escape the upload folder on a careless backend. The same applies to a `renameFile()` result that contains a separator.

## Renaming before upload

```js
new AnyDrop('#uploader', {
  url: '/upload',
  renameFile: (file) => file.name.toLowerCase(),
});
```

`renameFile` changes only the last segment of the sent path. `relativePath` and `fingerprint` keep the original name.

## Check on the server too

Client-side validation is a convenience, not security. Your backend must check type, size and path itself. See the [security checklist](/backend/#security-checklist).

## Reading rejections

```js
ad.on('error', (file, message) => {
  if (!file.accepted) console.log('rejected', file.name, message);
});
console.log(ad.getRejectedFiles().map((f) => f.name));
```
