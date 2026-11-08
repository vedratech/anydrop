# @vedratech/anydrop-react

## 1.0.0

### Major Changes

- First stable release (1.0.0). The public API (options, events, methods, protocol v2.0, React and Angular wrappers) now follows semver: breaking changes only in a new major version. React and Angular require core and ui `^1.0.0`.

### Patch Changes

- Package metadata: the author and copyright holder is now Vedra Tech.
- c495752: README: note for TypeScript 6 Vite apps about the `vite/client` types reference needed for the CSS import.
- Updated dependencies
- Updated dependencies
- Updated dependencies [c495752]
  - @vedratech/anydrop-core@1.0.0
  - @vedratech/anydrop-ui@1.0.0

## 0.1.0

### Minor Changes

- bcb962d: First release of the React package. It has an `<AnyDrop>` component with an `on<Event>` prop for every event, render props (`renderFile`, `renderFolder`, `renderToolbar`, `renderMessage`, `renderErrorItem`) that mount real React components in your tree, a ref to the instance, and a headless `useAnyDrop` hook with state. It works with React 18 and 19, StrictMode and the Next.js App Router.
