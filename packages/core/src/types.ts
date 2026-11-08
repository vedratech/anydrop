// Public types of @vedratech/anydrop-core. Types only, no runtime code.

/** Status of a file, and the rolled-up status of a folder. */
export type FileStatus =
  'added' | 'queued' | 'uploading' | 'paused' | 'success' | 'error' | 'canceled';

/** Upload bookkeeping on every file, Dropzone's `file.upload` plus our fields. */
export interface AnyDropUploadState {
  /** The protocol's uploadId (= `dzuuid`). Final by the time `addedfiles` fires. */
  uuid: string;
  /** Name sent to the server, after `renameFile()`. */
  filename: string;
  /** 0-100. */
  progress: number;
  /** Bytes. */
  total: number;
  /** Bytes of the request bodies sent so far. */
  bytesSent: number;
  /** Whether the file is sent in chunks. */
  chunked: boolean;
  /** Chunk size in bytes, fixed per file when its chunk layout is fixed (first start or restored record). */
  chunkSize: number;
  /** Number of chunks (1 for a whole file). */
  totalChunkCount: number;
  /** Chunk indexes acknowledged with 2xx by the server, never optimistically. */
  chunksDone: Set<number>;
  /** State came from IndexedDB or `chunkStatusUrl`. */
  resumed?: boolean;
  /** Completed in an earlier session, nothing was sent. */
  skipped?: boolean;
}

/**
 * The public file object: the native `File`, with properties added.
 * It can be passed to `FormData`, `FileReader` and `URL.createObjectURL` unchanged.
 */
export interface AnyDropFile extends File {
  /** UUID v4, created on add, never changes, unique per instance. */
  readonly id: string;
  /** Normalised path: `'Photos/2024/a.jpg'`, or `'a.jpg'` for a loose file. */
  readonly relativePath: string;
  /** Same as `relativePath`, but only defined when the file came from a folder (as in Dropzone). */
  readonly fullPath?: string;
  /** `relativePath|size|lastModified`. */
  readonly fingerprint: string;
  /** Parent folder node; the virtual root for loose files. */
  readonly folder: FolderNode;
  /** Current status; changes as the upload progresses. */
  status: FileStatus;
  /** Set after validation, as in Dropzone. `undefined` while validation is pending. */
  accepted?: boolean;
  /** Upload bookkeeping: uploadId, progress, bytes and chunk state. */
  upload: AnyDropUploadState;
  /** Last request; set only by the XHR transport (M2). */
  xhr?: XMLHttpRequest;
  /** Set by `@vedratech/anydrop-ui` only; core never touches it. */
  previewElement?: HTMLElement;
  /** Set by `@vedratech/anydrop-ui` only. */
  previewTemplate?: HTMLElement;
}

/** Per-status counters of every descendant file of a folder. */
export interface FolderCounts {
  /** Number of files in the folder and below. */
  readonly total: number;
  /** Files with status `added`. */
  readonly added: number;
  /** Files with status `queued`. */
  readonly queued: number;
  /** Files with status `uploading`. */
  readonly uploading: number;
  /** Files with status `paused`. */
  readonly paused: number;
  /** Files with status `success`. */
  readonly success: number;
  /** Files with status `error`. */
  readonly error: number;
  /** Files with status `canceled`. */
  readonly canceled: number;
}

/**
 * A folder in the tree. Nodes are live objects shared with events; do not change them.
 * `getTree()` returns the virtual root (`path: ''`).
 */
export interface FolderNode {
  /** `''` for the virtual root, otherwise `'Photos/2024'`. */
  readonly path: string;
  /** Last segment, `''` for the root. */
  readonly name: string;
  /** The parent folder, or `null` for the root. */
  readonly parent: FolderNode | null;
  /** Root = 0. */
  readonly depth: number;
  /** Subfolders, in insertion order. */
  readonly children: readonly FolderNode[];
  /** Direct files, in insertion order. */
  readonly files: readonly AnyDropFile[];
  /** Rolled-up status. */
  readonly status: FileStatus;
  /** 0-100, bytes-weighted over accepted, non-canceled descendant files. */
  readonly progress: number;
  /** Total bytes of the accepted files in the folder and below. */
  readonly bytesTotal: number;
  /** Bytes of the request bodies sent so far. */
  readonly bytesSent: number;
  /** Per-status file counters of the folder and below. */
  readonly counts: FolderCounts;
  /** `pauseFolder()` flag on this node itself (M3). */
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

/** The connection as `getConnectionState()` reports it. */
export interface ConnectionState {
  /** `'online'`, `'offline'` (the browser says so) or `'unreachable'` (the server cannot be reached). */
  state: 'online' | 'offline' | 'unreachable';
  /** Probe attempt number (0 when none). */
  attempt: number;
  /** Epoch ms of the next probe, or `null`. */
  retryAt: number | null;
}

/** One entry per file that is currently in `error`. */
export interface ErrorEntry {
  /** `null` only for a folder-level entry (an empty folder whose manifest failed). */
  fileId: string | null;
  /** Path of the failed file, for example `Photos/2024/a.jpg`. */
  relativePath: string;
  /** The uploadId of the file, when it had one. */
  uploadId: string | null;
  /** Server code, or a client code (protocol section 6). */
  code: ErrorCode;
  /** Human-readable reason. */
  message: string;
  /** HTTP status of the failing response, when there was one. */
  httpStatus?: number;
  /** Which step failed. */
  stage: 'validate' | 'manifest' | 'status' | 'upload' | 'finalize';
  /** Index of the failing chunk, for chunk uploads. */
  chunkIndex?: number;
  /** Attempts made for the failing request (0 for validation). */
  attempt: number;
  /** `false` only for stage `validate`. */
  retryable: boolean;
  /** Epoch ms. */
  at: number;
}

export type PauseReason = 'user' | 'offline' | 'hidden' | 'unreachable';

/** Payload of the `paused` and `resumed` events. */
export type PauseTarget =
  | { scope: 'all'; reason: PauseReason }
  | { scope: 'folder'; folder: FolderNode; reason: 'user' }
  | { scope: 'file'; file: AnyDropFile; reason: 'user' };

/** A chunk of a file, passed to `params(files, xhr, chunk)` (like Dropzone's, with `file` and `index`). */
export interface ChunkInfo {
  /** The file this chunk belongs to. */
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
  /** Name sent to the server (after `renameFile`). */
  filename: string;
  /** Set for chunks. */
  chunkIndex?: number;
}

/** Callback passed to `accept()`: call with no argument to accept, or with a message to reject. */
export type AcceptDone = (error?: unknown) => void;
