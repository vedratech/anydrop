# Contributing to AnyDrop

Thanks for your interest. Bug reports, docs fixes, backend examples and code are all welcome.

## Reporting bugs and ideas
Open an issue with the bug report or feature request form. For bugs, include:
- the package and version;
- your browser and device;
- the options you used;
- a small reproduction, if you can.

## Setup
You need Node 18 or newer and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm build
pnpm test        # unit tests (Vitest)
pnpm test:e2e    # browser tests (Playwright); run `pnpm exec playwright install` once first
pnpm dev         # demo page with the local mock upload server
pnpm docs:dev    # docs site
```

## Repo layout
- **packages:**
  - `packages/core`: the upload engine (no dependencies)
  - `packages/ui`: the plain JS UI
  - `packages/react`: the React wrapper
  - `packages/angular`: the Angular wrapper
- **examples:**
  - `examples/`: React (Vite), Next.js and Angular apps used by the browser tests
- **tests and tooling:**
  - `e2e/`: Playwright tests
  - `e2e/mock-server`: a test server that implements the upload protocol
- **docs:**
  - `docs/`: the documentation site
  - `docs/protocol.md`: the HTTP contract backends implement

## Pull requests
- Keep each pull request to one change, and add or update tests for it.
- Run these before opening a pull request:
  ```sh
  pnpm lint && pnpm typecheck && pnpm test && pnpm size
  ```
- New public options, events or methods need docs and a test.
- If your change affects users, add a changeset with `pnpm changeset`, choosing a patch for fixes or a minor for new features.
- Feature-detect browser capabilities; never check the user agent.
- Read files with `Blob.slice()`; never load a whole file into memory.

## License
By contributing, you agree that your contribution is licensed under the MIT license of this project.
