# Mobile and iOS

AnyDrop is built for phones as well as desktops. It feature-detects what it needs and never sniffs the user agent.

## What the UI does on a phone

- On a coarse pointer (or without drag and drop) the zone becomes one full-width **tap to upload** button.
- 44 px minimum tap targets and no hover-only controls.
- A layout that holds from 320 px, `env(safe-area-inset-*)` padding, inputs at 16 px or more, and `touch-action` tuned so that scrolling the list never triggers a tap.
- Lazy and capped thumbnails, and a low default concurrency (`parallelUploads: 2`).

Use `capture` to open the camera directly:

```js
new AnyDrop('#uploader', { url: '/upload', capture: 'environment' }); // 'user' for the front camera
```

## Browser support

AnyDrop targets ES2019 and ships no polyfills.

| Browser | Files | Folder drop | Folder picker | Resume after reload | Notes |
|---|---|---|---|---|---|
| Chrome, Edge (desktop) | yes | yes | yes | yes | |
| Firefox (desktop) | yes | yes | yes | yes | |
| Safari (desktop) | yes | yes | yes | yes | |
| Safari on iOS and iPadOS | yes | no | no (a notice is shown) | yes (in memory only if IndexedDB is blocked) | see below |
| Chrome on Android | yes | n/a | where the browser offers it | yes | |

The automated end-to-end suite runs on Chromium, Firefox and WebKit plus iPhone and Pixel emulation. Playwright's WebKit is not iOS Safari: see [Real-device checks](/device-checks) for what has been checked on real phones.

## iOS limits

- **No folders.** iOS Safari has no folder picker and no folder drag and drop. AnyDrop detects this, hides the folder button and shows a notice (`dictNoFolderSupport`). Users select files from Photos, Files or the camera. Folder paths appear only where the browser provides them.
- **Background tabs are suspended.** When the tab goes to the background or the screen locks, iOS can stop the page. AnyDrop pauses on `pagehide`, pauses when a request fails while the page is hidden, and resumes from the last finished chunk when the page is visible again. Keep the page open while uploading large files.
- **Memory.** Files are only read in chunks, thumbnails are lazy and capped, and the default concurrency is low.
- **IndexedDB may be blocked.** In private browsing and some iOS versions, resume after a reload does not work. AnyDrop warns once and keeps the state in memory.
- **HEIC photos** have an empty MIME type. AnyDrop guesses the type from the extension, so `acceptedFiles: 'image/*'` accepts them.
- **iCloud placeholders** (photos not downloaded to the device) can fail to read. The file fails with `UNREADABLE` and the message `dictFileUnreadable`.

## Feature detection

```js
AnyDrop.supportsFolderPicker(); // false on iOS Safari
AnyDrop.isBrowserSupported(); // the APIs the UI needs exist
```

## Testing on a device

Use DevTools device emulation for layout, but check real behaviour on a real iPhone and Android phone. [Real-device checks](/device-checks) is the checklist.
