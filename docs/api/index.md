# API reference

AnyDrop has two packages. `@vedratech/anydrop-core` is the headless engine (class `AnyDropCore`). `@vedratech/anydrop-ui` adds the drop zone, the folder tree and the mobile layout (class `AnyDrop`, which extends `AnyDropCore`). Everything in the core also works in the UI.

## Start here

| Page | What is in it |
|---|---|
| [Options](/api/options) | Every option with type, default and description, grouped: request, chunking, validation, folders, pause and resume, connectivity, UI and texts. |
| [Methods](/api/methods) | Every public method, property and static, with its signature, a description and an example. |
| [Events](/api/events) | Every event with its arguments, when it fires, and an example. |
| [Error codes](/api/error-codes) | The 18 known error codes, what they mean and whether they are retried. |
| [Types](/api/types) | Every exported type: files, folders, errors, configuration, transport. |

## Generated reference

The pages below are generated from the TypeScript source and its TSDoc comments each time the site is built, so they always match the code. They list every member with its exact type.

| Package | Main pages |
|---|---|
| `@vedratech/anydrop-core` | [Package index](/api/generated/anydrop-core/), [`AnyDropCore`](/api/generated/anydrop-core/classes/AnyDropCore), [`AnyDropCoreOptions`](/api/generated/anydrop-core/interfaces/AnyDropCoreOptions), [`AnyDropEvents`](/api/generated/anydrop-core/interfaces/AnyDropEvents), [`AnyDropFile`](/api/generated/anydrop-core/interfaces/AnyDropFile), [`FolderNode`](/api/generated/anydrop-core/interfaces/FolderNode) |
| `@vedratech/anydrop-ui` | [Package index](/api/generated/anydrop-ui/), [`AnyDrop`](/api/generated/anydrop-ui/classes/AnyDrop), [`AnyDropUIOptions`](/api/generated/anydrop-ui/interfaces/AnyDropUIOptions), [`AnyDropDict`](/api/generated/anydrop-ui/interfaces/AnyDropDict) |

## Conventions

- Options are given to the constructor, and changed later with `setOption(name, value)`.
- Methods that return a list (`getErrors()`, `getQueuedFiles()`) return a copy. `getTree()` and the `FolderNode` objects are live: read them, do not change them.
- `on(event, handler)` returns a function that removes the handler. `destroy()` removes everything the instance added.
- Dropzone options and events keep Dropzone 6.3.5's names, argument order and defaults, except where [Migrating from Dropzone](/migrating-from-dropzone) lists a difference.
- Nothing touches `window` or `document` when you import a package, so both are safe to import during server-side rendering.
