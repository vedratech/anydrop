// Public types of @vedratech/anydrop-core (decisions 0002, 0005, 0006, 0007). Types only, no runtime code.

/** Status of a file, and the rolled-up status of a folder (0002, 0005). */
export type FileStatus =
  'added' | 'queued' | 'uploading' | 'paused' | 'success' | 'error' | 'canceled';

/** Upload bookkeeping on every file, Dropzone's `file.upload` plus our fields (0002). */
export interface AnyDropUploadState {
  /** The protocol's uploadId (= `dzuuid`). Final by the time `addedfiles` fires. */
  uuid: string;
  /** Name sent to the server, after `renameFile()`. */
  filename: string;
  /** 0-100. */
  progress: number;
  /** Bytes. */
  total: number;
  bytesSent: number;
  chunked: boolean;
  /** Chunk size in bytes, fixed per file when its chunk layout is fixed (first start or restored record). */
  chunkSize: number;
  totalChunkCount: number;
  /** Chunk indexes acknowledged with 2xx by the server, never optimistically. */
  chunksDone: Set<number>;
  /** State came from IndexedDB or `chunkStatusUrl` (0004). */
  resumed?: boolean;
  /** Completed in an earlier session, nothing was sent (0004). */
  skipped?: boolean;
}

/**
 * The public file object: the native `File`, with properties added (0002).
 * It can be passed to `FormData`, `FileReader` and `URL.createObjectURL` unchanged.
 */
export interface AnyDropFile extends File {
  /** UUID v4, created on add, never changes, unique per instance. */
  readonly id: string;
  /** Normalised path: `'Photos/2024/a.jpg'`, or `'a.jpg'` for a loose file. */
  readonly relativePath: string;
  /** Same as `relativePath`, but only defined when the file came from a folder (as in Dropzone). */
  readonly fullPath?: string;
  /** `relativePath|size|lastModified` (0004). */
  readonly fingerprint: string;
  /** Parent folder node; the virtual root for loose files (0005). */
  readonly folder: FolderNode;
  status: FileStatus;
  /** Set after validation, as in Dropzone. `undefined` while validation is pending. */
  accepted?: boolean;
  upload: AnyDropUploadState;
  /** Last request; set only by the XHR transport (M2). */
  xhr?: XMLHttpRequest;
  /** Set by `@vedratech/anydrop-ui` only; core never touches it. */
  previewElement?: HTMLElement;
  /** Set by `@vedratech/anydrop-ui` only. */
  previewTemplate?: HTMLElement;
}

/** Per-status counters of every descendant file of a folder (0005). */
export interface FolderCounts {
  readonly total: number;
  readonly added: number;
  readonly queued: number;
  readonly uploading: number;
  readonly paused: number;
  readonly success: number;
  readonly error: number;
  readonly canceled: number;
}

/**
 * A folder in the tree (0005). Nodes are live objects shared with events; do not change them.
 * `getTree()` returns the virtual root (`path: ''`).
 */
export interface FolderNode {
  /** `''` for the virtual root, otherwise `'Photos/2024'`. */
  readonly path: string;
  /** Last segment, `''` for the root. */
  readonly name: string;
  readonly parent: FolderNode | null;
  /** Root = 0. */
  readonly depth: number;
  /** Subfolders, in insertion order. */
  readonly children: readonly FolderNode[];
  /** Direct files, in insertion order. */
  readonly files: readonly AnyDropFile[];
  /** Rolled-up status (0005 rules). */
  readonly status: FileStatus;
  /** 0-100, bytes-weighted over accepted, non-canceled descendant files. */
  readonly progress: number;
  readonly bytesTotal: number;
  readonly bytesSent: number;
  readonly counts: FolderCounts;
  /** `pauseFolder()` flag on this node itself (M3, 0008). */
  readonly userPaused: boolean;
}

/** Codes core itself creates or the protocol defines (protocol section 6). A backend may send others. */
export type KnownErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'STALLED'
  | 'HTTP_ERROR'
  | 'SERVER_ERROR'
  | 'AUTH'
  | 'TOO_LARGE'
  | 'INVALID_PATH'
  | 'INVALID_CHUNK'
  | 'CHUNK_MISMATCH'
  | 'REJECTED'
  | 'REJECTED_TYPE'
  | 'REJECTED_SIZE'
  | 'MAX_FILES'
  | 'FINALIZE_FAILED'
  | 'UNREADABLE'
  | 'TRANSFORM_FAILED'
  | 'REQUEST_SETUP_FAILED';

/** A known code (autocomplete) or any string a backend sends. */
export type ErrorCode = KnownErrorCode | (string & {});

/** The connection as `getConnectionState()` reports it (0017). */
export interface ConnectionState {
  state: 'online' | 'offline' | 'unreachable';
  /** Probe attempt number (0 when none). */
  attempt: number;
  /** Epoch ms of the next probe, or `null`. */
  retryAt: number | null;
}

/** One entry per file that is currently in `error` (0007). */
export interface ErrorEntry {
  /** `null` only for a folder-level entry (an empty folder whose manifest failed). */
  fileId: string | null;
  relativePath: string;
  uploadId: string | null;
  /** Server code, or a client code (protocol section 6). */
  code: ErrorCode;
  message: string;
  httpStatus?: number;
  stage: 'validate' | 'manifest' | 'status' | 'upload' | 'finalize';
  chunkIndex?: number;
  /** Attempts made for the failing request (0 for validation). */
  attempt: number;
  /** `false` only for stage `validate`. */
  retryable: boolean;
  /** Epoch ms. */
  at: number;
}

export type PauseReason = 'user' | 'offline' | 'hidden' | 'unreachable';

/** Payload of the `paused` and `resumed` events (0006). */
export type PauseTarget =
  | { scope: 'all'; reason: PauseReason }
  | { scope: 'folder'; folder: FolderNode; reason: 'user' }
  | { scope: 'file'; file: AnyDropFile; reason: 'user' };

/** A chunk of a file, passed to `params(files, xhr, chunk)` (like Dropzone's, with `file` and `index`). */
export interface ChunkInfo {
  file: AnyDropFile;
  /** 0-based chunk index. */
  index: number;
  /** Byte offset of the chunk (`dzchunkbyteoffset`). */
  start: number;
  /** End offset, exclusive. */
  end: number;
  /** Failed attempts of this chunk so far. */
  retries: number;
}

/** One blob of a request, passed to `url(files, dataBlocks)` and `method(files, dataBlocks)` (Dropzone 6.3.5). */
export interface DataBlock {
  /** Form field name (`paramName`). */
  name: string;
  /** The chunk slice, or the whole (transformed) file. */
  data: Blob;
  filename: string;
  /** Set for chunks. */
  chunkIndex?: number;
}

/** Callback passed to `accept()`: call with no argument to accept, or with a message to reject. */
export type AcceptDone = (error?: unknown) => void;
