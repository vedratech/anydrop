# Third-party notices

AnyDrop includes or is derived from the third-party software listed below.
Each entry keeps the original copyright and licence notice.

## Dropzone

- Source: https://github.com/dropzone/dropzone (npm `dropzone`), version 6.3.5, `src/dropzone.ts` and `src/options.ts`
- Licence: MIT
- Used in: `packages/core/src/validate/dropzone-port.ts` and `packages/ui/src/image.ts` (both files keep the MIT header, as a `/*!` comment that survives into dist)
- What was ported: `Dropzone.isValidFile` (the `acceptedFiles` matcher), the size, type and `maxFiles` checks of `Dropzone.prototype.accept`, and `Dropzone.prototype.filesize`. The default option values and `dict*` message texts in `packages/core/src/options.ts` match Dropzone's `src/options.ts`.
- What changed: rewritten as pure functions that return a rejection code (`REJECTED_SIZE`, `REJECTED_TYPE`, `MAX_FILES`) next to the Dropzone message; when a file's MIME type is empty, `isValidFile` first guesses the type from the extension (iOS HEIC photos). Behaviour for files with a MIME type is unchanged and is checked against Dropzone 6.3.5 by `packages/core/test/dropzone-parity.test.ts`.
- Also: the directory walk in `packages/core/src/source/walk.ts` (`walkDir`, the `readEntries()` loop) has its structure adapted from Dropzone's `_addFilesFromItems` / `_addFilesFromDirectory` (src/dropzone.ts), rewritten as an async generator that yields batches, keeps empty folders and reports read errors.
- Also: request helpers in `packages/core/src/transport/` follow Dropzone 6.3.5 `src/dropzone.ts`: `parseBody` in `xhr.ts` (JSON only when `content-type` says so, and the "Invalid JSON response from server." message, from `_finished`/`_handleUploadError`), and `headersFor` and `paramName` in `fields.ts` (the default headers of `_uploadData` and `_getParamName`). Rewritten as small pure functions; behaviour unchanged.
- Also: `packages/ui/src/image.ts` (`geometry`) reproduces the crop/contain source-rectangle math of Dropzone's `resize()` (src/dropzone.ts, the `thumbnailMethod` and `resizeMethod` behaviour), rewritten as a pure function. The default preview template markup, the `data-dz-*` hook names, the `dz-*` class names, the default `dict*` texts and the `forceFallback` form in `packages/ui` follow Dropzone 6.3.5 (`src/options.ts`, `src/preview-template.html`) so a Dropzone configuration works unchanged; the code itself is new.

```
(The MIT License)

Copyright (c) 2026 Matias Simon <m@tias.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
