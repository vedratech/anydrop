---
'@vedratech/anydrop-ui': minor
---

Initial release of the vanilla-JavaScript UI on top of `@vedratech/anydrop-core`. `AnyDrop` takes Dropzone's options and `dz-*` classes (also as `ad-*`), so a Dropzone setup moves over with few changes.

- Drop zone and separate file and folder pickers (the folder button only where the browser supports it, a notice otherwise), and paste.
- A virtualized folder tree and flat list with per-row progress and pause, resume, retry and cancel; a toolbar for everything.
- A persistent error panel with JSON and CSV export.
- A connection banner with a countdown and a "Retry now" button while the browser is offline or the server cannot be reached.
- Lazy, capped thumbnails with HEIC photos recognised, `displayExistingFile()`, `previewTemplate` with the `data-dz-*` hooks, and every text translatable (`dict*`).
- Mobile friendly: touch layout with 44 px targets and safe areas. Accessible: keyboard navigation and a live region. CSS variables and dark mode.
- A CDN build that sets `window.AnyDrop` and attaches to `.dropzone` and `.anydrop` elements.
