# @vedratech/anydrop-angular

## 1.0.0

### Major Changes

- First stable release (1.0.0). The public API (options, events, methods, protocol v2.0, React and Angular wrappers) now follows semver: breaking changes only in a new major version. React and Angular require core and ui `^1.0.0`.

### Patch Changes

- Package metadata: the author and copyright holder is now Vedra Tech.
- Updated dependencies
- Updated dependencies
- Updated dependencies [c495752]
  - @vedratech/anydrop-core@1.0.0
  - @vedratech/anydrop-ui@1.0.0

## 0.1.0

### Minor Changes

- bcb962d: First release of the Angular package. It has a standalone `<any-drop>` component with an output for every event (the drag, drop and paste events stay native DOM events) and `(ready)`, template slots (`anyDropFile`, `anyDropFolder`, `anyDropToolbar`, `anyDropMessage`, `anyDropErrorItem`), a headless `AnyDropService` with signals and `on$()`, and `provideAnyDrop()` for app-wide defaults. It works with Angular 18 and later, server rendering, hydration and zoneless mode.
