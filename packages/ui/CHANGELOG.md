# @vedratech/anydrop-ui

## 1.0.0

### Major Changes

- First stable release (1.0.0). The public API (options, events, methods, protocol v2.0, React and Angular wrappers) now follows semver: breaking changes only in a new major version. React and Angular require core and ui `^1.0.0`.

### Patch Changes

- Package metadata: the author and copyright holder is now Vedra Tech.
- c495752: A plain-object `transport` passed to the constructor (or through `AnyDrop.options`) is now used as is instead of being copied, so a transport that keeps state works the same as a class instance.
- Updated dependencies
- Updated dependencies
  - @vedratech/anydrop-core@1.0.0

## 0.1.0

### Minor Changes

- 14b8838: Initial release of the vanilla-JavaScript UI on top of `@vedratech/anydrop-core`. `AnyDrop` is configured with a plain options object (or `AnyDrop.options.<id>` presets by element id) and styled with `ad-*` classes.
  
  - Drop zone and separate file and folder pickers (the folder button only where the browser supports it, a notice otherwise), and paste.
  - A virtualized folder tree and flat list with per-row progress and pause, resume, retry and cancel; a toolbar for everything.
  - A persistent error panel with JSON and CSV export.
  - A connection banner with a countdown and a "Retry now" button while the browser is offline or the server cannot be reached.
  - Lazy, capped thumbnails with HEIC photos recognised, `displayExistingFile()`, `previewTemplate` with the `data-ad-*` hooks, and every text translatable (`dict*`).
  - Mobile friendly: touch layout with 44 px targets and safe areas. Accessible: keyboard navigation and a live region. CSS variables and dark mode.
  - A CDN build that sets `window.AnyDrop` and attaches to `.anydrop` elements.
- fc3c562: Customise the UI without forking it. New options: `render` hooks (`file`, `folder`, `toolbar`, `message`, `errorItem`) that decorate or replace a part and can return a view with `update` and `destroy`; `layout` (`list` or `compact`) with `rowHeight` now defaulting to `null` (the layout's height) and `errorRowHeight`; `rowActions` (choose, add and override row buttons, plus the `actionclicked` event); `icons` (a record or a function); `locale` and `dir` with nine language entry points (`@vedratech/anydrop-ui/locales/<code>`: English plus draft packs for hi, es, fr, de, pt-BR, ja, zh-CN and ar) and right-to-left support; `themePreset` with four stylesheets (`@vedratech/anydrop-ui/themes/<name>.css`: minimal, rounded, enterprise, glass); eight new `--ad-*` variables (28 in total); `getOption()` for UI options. A row has two separate buttons: `cancel` stops an active upload and `remove` clears a finished row. A theme builder on the docs site previews the result.

### Patch Changes

- 80f081b: Documentation website at https://vedratech.github.io/anydrop/ (guide, API reference generated from the source, backend contract, live demo). The READMEs are shorter and link to it. Public types, options and events now have TSDoc comments; no behaviour change.
- 06e0654: Better package metadata for discovery: keyword-rich descriptions and more npm keywords, `homepage` points to the documentation site, and the READMEs have badges and a short size comparison with other upload libraries. No behaviour change.
- Updated dependencies [fc3c562]
- Updated dependencies [80f081b]
- Updated dependencies [14b8838]
- Updated dependencies [06e0654]
  - @vedratech/anydrop-core@0.1.0
