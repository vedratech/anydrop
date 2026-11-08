# Image previews and resizing

The UI shows a thumbnail for image files, and can scale images down before they are uploaded. Both are designed so that thousands of photos do not exhaust the memory of a phone.

## Thumbnails

```js
new AnyDrop('#uploader', {
  url: '/upload',
  createImageThumbnails: true, // default
  thumbnailWidth: 120, // px, capped at 512
  thumbnailHeight: 120,
  thumbnailMethod: 'crop', // or 'contain'
  maxThumbnailFilesize: 10, // MiB; larger images get no thumbnail
});
```

Thumbnails are created lazily (only for rows on screen), at most two at a time, and capped at 512 px. Object URLs are revoked at once. HEIC and HEIF files are recognised by extension when the MIME type is empty. A browser that cannot decode the image shows `dictThumbnailError`. With both `thumbnailWidth` and `thumbnailHeight` set to `null`, the thumbnail has the natural size, still capped at 512 px.

Listen to the `thumbnail` event to use the image yourself:

```js
const img = document.querySelector('#my-preview'); // an <img id="my-preview">
ad.on('thumbnail', (file, dataUrl) => (img.src = dataUrl));
```

Set `createImageThumbnails: false` for none.

## Resize before upload

```js
new AnyDrop('#uploader', {
  url: '/upload',
  resizeWidth: 1600,
  resizeHeight: 1600,
  resizeMethod: 'contain', // or 'crop'
  resizeMimeType: 'image/jpeg', // null keeps the type
  resizeQuality: 0.8,
});
```

Images are scaled down in the browser before they are sent, which saves bandwidth. It is the default `transformFile`; your own `transformFile` wins.

::: warning Limits of resizing
- The resize re-encodes the image, so **EXIF data (orientation, GPS) is lost**. The pixels are drawn upright by the browser.
- A transform may produce different bytes on each run, so a resized file cannot be chunk-resumed after a reload. Finished files are still skipped.
- Dropzone's `resize(file, w, h, method)` override and `resizeTransparencyFill` are not supported.
:::

## Without previews

```js
new AnyDrop('#uploader', { url: '/upload', disablePreviews: true });
```

No preview elements, no list, no toolbar and no error panel. The zone and the pickers still work, and `thumbnail` events still fire for every accepted image, so you can draw everything yourself.

## Your own preview markup

`previewTemplate` is the markup of one file. The `data-dz-name`, `data-dz-size`, `data-dz-thumbnail`, `data-dz-uploadprogress`, `data-dz-errormessage` and `data-dz-remove` hooks are filled in. Dropzone's own default template works unchanged. See [Customising the UI](/guide/customising-ui).

## Existing files

To show a file that is already on the server:

```js
ad.displayExistingFile({ name: 'cover.jpg', size: 12345 }, '/files/cover.jpg');
```

It appears as a root row and is not added to `files`, the tree or a manifest.
