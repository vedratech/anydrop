# Types

Every exported type of both packages, with a short description and where it is used. The complete generated definitions are in the [core reference](/api/generated/anydrop-core/) and the [UI reference](/api/generated/anydrop-ui/). All types are exported by name, for example `import type { AnyDropFile } from '@vedratech/anydrop-core'`.

Jump to: [Files and folders](#files-and-folders) / [Pause and connection](#pause-and-connection) / [Errors](#errors) / [Options and configuration](#options-and-configuration) / [Events](#events) / [Transport](#transport) / [Input helpers](#input-helpers) / [UI types](#ui-types)

## Files and folders

### `FileStatus`

```ts
type FileStatus = 'added' | 'queued' | 'uploading' | 'paused' | 'success' | 'error' | 'canceled';
```

The status of a file, and the rolled-up status of a folder.

### `AnyDropFile`

The native `File` with properties added, exactly like Dropzone's file. You can pass it to `FormData`, `FileReader` or `URL.createObjectURL`.

```ts
interface AnyDropFile extends File {
  readonly id: string; // UUID v4, never changes
  readonly relativePath: string; // 'Photos/2024/a.jpg', or 'a.jpg' for a loose file
  readonly fullPath?: string; // only for files that came from a folder
  readonly fingerprint: string; // 'relativePath|size|lastModified'
  readonly folder: FolderNode; // the parent folder (the root for loose files)
  status: FileStatus;
  accepted?: boolean; // set after validation
  upload: AnyDropUploadState;
  xhr?: XMLHttpRequest; // last request, set by the built-in transport
  previewElement?: HTMLElement; // UI only
  previewTemplate?: HTMLElement; // UI only
}
```

### `AnyDropUploadState`

The `file.upload` object: Dropzone's fields plus ours.

```ts
interface AnyDropUploadState {
  uuid: string; // the uploadId (dzuuid on the wire)
  filename: string; // name sent to the server, after renameFile
  progress: number; // 0-100
  total: number; // bytes
  bytesSent: number;
  chunked: boolean;
  chunkSize: number; // fixed per file when its chunk layout is decided
  totalChunkCount: number;
  chunksDone: Set<number>; // chunk indexes the server acknowledged with 2xx
  resumed?: boolean; // state came from IndexedDB or chunkStatusUrl
  skipped?: boolean; // finished in an earlier session, nothing was sent
}
```

### `FolderNode`

A folder in the tree. Nodes are live objects shared with events: read them, do not change them. [`getTree()`](/api/methods#gettree) returns the virtual root.

```ts
interface FolderNode {
  readonly path: string; // '' for the root, otherwise 'Photos/2024'
  readonly name: string; // last segment
  readonly parent: FolderNode | null;
  readonly depth: number; // root = 0
  readonly children: readonly FolderNode[];
  readonly files: readonly AnyDropFile[]; // direct files
  readonly status: FileStatus; // rolled up from the files below
  readonly progress: number; // 0-100, bytes-weighted
  readonly bytesTotal: number;
  readonly bytesSent: number;
  readonly counts: FolderCounts;
  readonly userPaused: boolean; // pauseFolder() flag on this node
}
```

The folder status rolls up like this. When every file below is finished, the folder is `error` if any failed, else `canceled` if all were canceled, else `success`. Otherwise it is `uploading` if any file uploads, `paused` if the folder (or an ancestor, or everything) is paused or every unfinished file is paused, `queued` if any is queued, else `added`. An empty folder is `queued` until its batch is processed, then `success` (or `error` if its manifest fails). Rejected files stay in the tree as `error` but do not count in `bytesTotal`.

### `FolderCounts`

```ts
interface FolderCounts {
  readonly total: number;
  readonly added: number;
  readonly queued: number;
  readonly uploading: number;
  readonly paused: number;
  readonly success: number;
  readonly error: number;
  readonly canceled: number;
}
```

Per-status counters of every descendant file of a folder.

## Pause and connection

### `PauseReason`

```ts
type PauseReason = 'user' | 'offline' | 'hidden' | 'unreachable';
```

### `PauseTarget`

The argument of the `paused` and `resumed` events.

```ts
type PauseTarget =
  | { scope: 'all'; reason: PauseReason }
  | { scope: 'folder'; folder: FolderNode; reason: 'user' }
  | { scope: 'file'; file: AnyDropFile; reason: 'user' };
```

### `ConnectionState`

What [`getConnectionState()`](/api/methods#getconnectionstate) returns.

```ts
interface ConnectionState {
  state: 'online' | 'offline' | 'unreachable';
  attempt: number; // probe number, 0 when online
  retryAt: number | null; // Date.now() time of the next probe
}
```

## Errors

### `ErrorEntry`

One entry per file that is currently in `error`.

```ts
interface ErrorEntry {
  fileId: string | null; // null only for a folder-level entry (an empty folder whose manifest failed)
  relativePath: string;
  uploadId: string | null;
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  stage: 'validate' | 'manifest' | 'status' | 'upload' | 'finalize';
  chunkIndex?: number;
  attempt: number; // attempts made for the failing request (0 for validation)
  retryable: boolean; // false only for stage 'validate'
  at: number; // epoch ms
}
```

### `ErrorCode`

`KnownErrorCode | (string & {})`. The known codes autocomplete, and a backend may send any other string.

### `KnownErrorCode`

The 18 codes core itself creates or the protocol defines. See [Error codes](/api/error-codes).

## Options and configuration

### `AnyDropCoreOptions`

The core options, with their types. See [Options](/api/options). `Self` is the type of `this` inside callbacks.

### `AnyDropOptions`

`AnyDropCoreOptions` plus the event handlers, for a core instance (`instance.options`).

### `AnyDropCoreConfig`

What the core constructor and `setOption` accept: `Partial<AnyDropCoreOptions>` plus event handlers, and the deprecated `acceptedMimeTypes` and `renameFilename`.

### `AnyDropUIOptions`

The UI options (and, through `AnyDropDict`, the texts).

### `AnyDropDict`

Every `dict*` text of the UI. Every user-visible string is one of these, so it can be translated.

### `AnyDropFullOptions`

Core options, UI options and event handlers together (`ad.options`).

### `AnyDropConfig`

What the UI constructor and `setOption` accept.

```ts
import type { AnyDropConfig } from '@vedratech/anydrop-ui';
const config: AnyDropConfig = { url: '/upload', chunking: true, folderView: 'tree' };
```

### `AcceptDone`

`(error?: unknown) => void`. The callback passed to `accept()`: call it with no argument to accept, or with a message to reject.

### `ChunkInfo`

Passed to `params(files, xhr, chunk)`.

```ts
interface ChunkInfo {
  file: AnyDropFile;
  index: number; // 0-based chunk index
  start: number; // byte offset of the chunk (dzchunkbyteoffset)
  end: number; // end offset, exclusive
  retries: number; // failed attempts of this chunk so far
}
```

### `DataBlock`

One blob of a request, passed to `url(files, dataBlocks)` and `method(files, dataBlocks)`.

```ts
interface DataBlock {
  name: string; // form field name (paramName)
  data: Blob; // the chunk slice, or the whole (transformed) file
  filename: string;
  chunkIndex?: number; // set for chunks
}
```

### `ElementRef`

`string | HTMLElement`. A selector or an element, used by `clickable`, `previewsContainer` and `hiddenInputContainer`.

## Events

### `AnyDropEvents`

An interface that maps every event name to the tuple of its arguments. See [Events](/api/events).

### `AnyDropEventName`

`keyof AnyDropEvents`: the union of all event names.

### `AnyDropEventHandlers`

The optional handler for each event, as accepted in the options (`{ success(file, response) { ... } }`).

### `Listener`

`(...args) => void`. A function that handles an event.

### `Unsubscribe`

What `on()` and `once()` return: a function that removes the listener, with `on` and `once` attached so calls can be chained.

## Transport

The [custom transport](/guide/custom-transport) interface. Core hands every request to `transport.send()`.

### `Transport`

```ts
interface Transport {
  send(request: TransportRequest): TransportHandle;
}
```

### `TransportRequest`

```ts
interface TransportRequest {
  method: string; // upper case
  url: string;
  headers: Record<string, string>; // empty values are skipped
  body: FormData | Blob | string | null; // upload, raw body, JSON string, or none
  timeout: number | null; // ms; null or 0 means none
  withCredentials: boolean;
  beforeSend?: (native?: unknown) => void; // present on upload requests only
}
```

### `TransportHandle`

```ts
interface TransportHandle {
  abort(): void; // the promise then resolves with error 'abort'
  onProgress?: (loaded: number, total: number) => void; // assigned by core after send() returns
  promise: Promise<TransportResponse>; // always resolves, never rejects
}
```

### `TransportResponse`

```ts
interface TransportResponse {
  status: number; // HTTP status; 0 when no response arrived
  body: unknown; // parsed JSON for JSON responses, else the text
  header: (name: string) => string | null;
  error?: 'network' | 'timeout' | 'abort' | 'stalled';
  xhr?: XMLHttpRequest; // the built-in transport's request object
}
```

## Input helpers

### `DataTransferLike`

What `addDataTransfer()` accepts: a `DataTransfer` (drop) or the `clipboardData` of a paste. It only needs `items` (read with `webkitGetAsEntry`) or `files`.

### `EntryLike`

A `FileSystemEntry` (file or directory) as the folder walker sees it. Browser objects satisfy it, and so do the plain objects of a test.

## UI types

### `MockFile`

The object that `displayExistingFile()` takes.

```ts
interface MockFile {
  name: string;
  size: number;
  type?: string;
  status?: string;
  previewElement?: HTMLElement;
  [key: string]: unknown;
}
```
