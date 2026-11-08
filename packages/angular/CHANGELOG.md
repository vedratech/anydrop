# @vedratech/anydrop-angular

## 0.1.0

### Minor Changes

- bcb962d: First release of the Angular package. It has a standalone `<any-drop>` component with an output for every event (the drag, drop and paste events stay native DOM events) and `(ready)`, template slots (`anyDropFile`, `anyDropFolder`, `anyDropToolbar`, `anyDropMessage`, `anyDropErrorItem`), a headless `AnyDropService` with signals and `on$()`, and `provideAnyDrop()` for app-wide defaults. It works with Angular 18 and later, server rendering, hydration and zoneless mode.
