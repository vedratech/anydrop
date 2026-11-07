---
'@vedratech/anydrop-ui': minor
---

M4: the plain-JavaScript UI. `AnyDrop` extends `AnyDropCore` and takes Dropzone's UI options (`clickable`, `previewTemplate` with the `data-dz-*` hooks, `previewsContainer`, `hiddenInputContainer`, `addRemoveLinks`, `capture`, thumbnails and `resize*`, `disablePreviews`, `forceFallback`, `init`, all `dict*` texts) and Dropzone's `dz-*` classes (also as `ad-*`). New: separate file and folder pickers (the folder button only where `webkitdirectory` exists, a notice otherwise), paste, a virtualized tree and flat view with per-row progress and pause, resume, retry and cancel, a toolbar, an error panel with JSON and CSV export, lazy capped thumbnails with HEIC handling, `displayExistingFile()`, a touch layout with 44px targets and safe areas, an ARIA live region and keyboard navigation, CSS variables and dark mode.
