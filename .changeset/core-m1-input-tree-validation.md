---
'@vedratech/anydrop-core': minor
---

M1: `AnyDropCore` reads drops (files and folders through `webkitGetAsEntry`), pastes, and file and folder inputs; validates files like Dropzone 6.3.5 (`acceptedFiles` with an extension fallback for empty MIME types, `maxFilesize`, `maxFiles`, `ignoreHiddenFiles`, `accept()`); builds a live folder tree with incremental status and progress roll-up; keeps an error list (`getErrors`, `clearErrors`, `exportErrors`); and emits `addedfile`, `addedfiles`, `addedfolder`, `emptyfolder`, `error`, `complete`, `maxfilesexceeded`, `maxfilesreached`, `foldercomplete`, `canceled`, `removedfile`, `reset` and `errorlistchanged`. Uploading comes in M2.
