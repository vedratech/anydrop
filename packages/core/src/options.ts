// Core options. Dropzone options keep Dropzone 6.3.5's names, types and defaults (src/options.ts)
// unless noted; new options follow the dropzone-parity skill and decisions 0001-0012.
// UI-only Dropzone options (clickable, previewTemplate, thumbnails, ...) belong to @vedratech/anydrop-ui.
import type { AnyDropCore } from './AnyDropCore';
import type { AnyDropEventHandlers } from './events/events';
import type { Transport } from './transport/types';
import type { AcceptDone, AnyDropFile, ChunkInfo, DataBlock } from './types';
import type { FileSizeUnits } from './validate/dropzone-port';

/** `Self` is the type of `this` inside callbacks (the instance, as in Dropzone). */
export interface AnyDropCoreOptions<Self = AnyDropCore> {
  // Request (used from M2)
  /**
   * Upload URL, or a function of the files being sent and their data blocks (Dropzone 6.3.5).
   * Without it, `processQueue()` starts nothing.
   */
  url: string | ((this: Self, files: AnyDropFile[], dataBlocks: DataBlock[]) => string) | null;
  method: string | ((this: Self, files: AnyDropFile[], dataBlocks: DataBlock[]) => string);
  withCredentials: boolean;
  /** Request timeout in ms, or a function of the files; `null` = none (Dropzone 6 default). */
  timeout: number | null | ((this: Self, files: AnyDropFile[]) => number | null);
  headers: Record<string, string> | null;
  defaultHeaders: boolean;
  /**
   * Extra form fields, or a function returning them. Merged over the built-in `dz*`/`ad*`
   * fields; a `null` or `undefined` value drops a built-in field (to rename it).
   */
  params:
    | Record<string, unknown>
    | ((
        this: Self,
        files: AnyDropFile[],
        xhr: XMLHttpRequest | undefined,
        chunk: ChunkInfo | null,
      ) => Record<string, unknown> | null | undefined | void)
    | null;
  paramName: string | ((n: number) => string);
  /** Non-chunked only; throws together with `chunking` (0003). */
  uploadMultiple: boolean;
  binaryBody: boolean;
  /** Files uploading at once (Dropzone meaning, 0001). */
  parallelUploads: number;
  /** Optional instance-wide cap on upload POSTs in flight; `null` = no cap (0010). */
  maxChunksInFlight: number | null;
  // Chunking (used from M2)
  chunking: boolean;
  forceChunking: boolean;
  /** Bytes. Dropzone 6 default: 2 MiB. */
  chunkSize: number;
  /** Chunks of one file in flight: `false` = 1, `true` = `parallelUploads`, or a number (Dropzone 6.3.5). */
  parallelChunkUploads: boolean | number;
  /** Default `true` (Dropzone: `false`), see 0007. */
  retryChunks: boolean;
  retryChunksLimit: number;
  /**
   * Replaces the built-in finalize request (0003, 0011). `this` is the options object (Dropzone);
   * the instance is the third argument. `done()` succeeds; `done(error)` with an Error or a
   * non-empty string fails the file (`FINALIZE_FAILED`).
   */
  chunksUploaded:
    | ((
        this: AnyDropCoreOptions<Self>,
        file: AnyDropFile,
        done: (error?: unknown) => void,
        instance: Self,
      ) => void)
    | null;
  /**
   * Dropzone's `transformFile(file, done)`: called when the file starts processing; pass the blob
   * to upload to `done`. Chunk info is recomputed from it (0011).
   */
  transformFile: ((this: Self, file: AnyDropFile, done: (blob: Blob) => void) => void) | null;
  /** Sends the requests. `null` = the built-in XMLHttpRequest transport. */
  transport: Transport | null;
  // Validation
  /** MiB; falsy disables the check. */
  maxFilesize: number | null;
  filesizeBase: number;
  maxFiles: number | null;
  /** Comma-separated `.ext`, `type/*` and `type/subtype` list (the `accept` attribute syntax). */
  acceptedFiles: string | null;
  /** Your own check, called after the built-in ones: `done()` accepts, `done(message)` rejects. */
  accept: (this: Self, file: AnyDropFile, done: AcceptDone) => void;
  /** Skip files whose name starts with `.` inside dropped or picked folders. */
  ignoreHiddenFiles: boolean;
  /** Name sent to the server; changes only the last path segment (0002). */
  renameFile: ((this: Self, file: AnyDropFile) => string) | null;
  // Queue
  autoProcessQueue: boolean;
  autoQueue: boolean;
  // Folders (new)
  /** Accept folder drops (and, in the UI, show the folder picker where supported). */
  folders: boolean;
  /** Keep folders that hold no files, and send them in the manifest. */
  preserveEmptyFolders: boolean;
  sendManifest: boolean;
  manifestUrl: string | null;
  chunkStatusUrl: string | null;
  finalizeUrl: string | null;
  // Pause, resume, persistence (used from M3)
  pauseMode: 'abort' | 'finishChunk';
  persistState: boolean;
  /** Scope of resume records; `null` = `url` when it is a string, else `'default'` (0004). */
  persistKey: string | null;
  autoPauseOnHidden: boolean;
  /** Resume when the browser comes back online, and probe for a lost connection by itself (0017). */
  autoResumeOnReconnect: boolean;
  /**
   * A request with no progress for this long (ms) while its body is sent, or no response for four
   * times as long once it is sent, is aborted as `STALLED` and retried. `null` = off (0017).
   */
  stallTimeout: number | null;
  /** `HEAD` target that tells whether the server is reachable while the connection is lost (0017). */
  connectivityProbeUrl: string | null;
  // Messages (Dropzone dict*)
  dictFileTooBig: string;
  dictInvalidFileType: string;
  dictResponseError: string;
  dictUploadCanceled: string;
  dictMaxFilesExceeded: string;
  /** Error message for a file that can no longer be read (cloud placeholder, moved or deleted). */
  dictFileUnreadable: string;
  /** Error message for a path with a `..` segment. */
  dictInvalidPath: string;
  dictFileSizeUnits: FileSizeUnits;
}

/** What the constructor and `setOption` accept: options plus event handlers (Dropzone style). */
export type AnyDropCoreConfig<Self = AnyDropCore> = Partial<AnyDropCoreOptions<Self>> &
  AnyDropEventHandlers<Self> & {
    /** @internal Deterministic id generator for tests (0002). */
    _uuid?: () => string;
    /** @internal Seeded random for backoff jitter in tests (0007). */
    _random?: () => number;
    /** @deprecated Dropzone's old name of `acceptedFiles` (copied to it; setting both throws). */
    acceptedMimeTypes?: string | null;
    /** @deprecated Dropzone's old `renameFile`: `(name, file) => newName`. */
    renameFilename?: ((this: Self, name: string, file: AnyDropFile) => string) | null;
  };

/** Fresh defaults (a new object each call: instances share no state). */
export function defaultOptions(): AnyDropCoreOptions<unknown> {
  return {
    url: null,
    method: 'post',
    withCredentials: false,
    timeout: null,
    headers: null,
    defaultHeaders: true,
    params: null,
    paramName: 'file',
    uploadMultiple: false,
    binaryBody: false,
    parallelUploads: 2,
    maxChunksInFlight: null,
    chunking: false,
    forceChunking: false,
    chunkSize: 2 * 1024 * 1024,
    parallelChunkUploads: false,
    retryChunks: true,
    retryChunksLimit: 3,
    chunksUploaded: null,
    transformFile: null,
    transport: null,
    maxFilesize: 256,
    filesizeBase: 1000,
    maxFiles: null,
    acceptedFiles: null,
    accept: (_file, done) => done(),
    ignoreHiddenFiles: true,
    renameFile: null,
    autoProcessQueue: true,
    autoQueue: true,
    folders: true,
    preserveEmptyFolders: true,
    sendManifest: false,
    manifestUrl: null,
    chunkStatusUrl: null,
    finalizeUrl: null,
    pauseMode: 'abort',
    persistState: true,
    persistKey: null,
    autoPauseOnHidden: true,
    autoResumeOnReconnect: true,
    stallTimeout: 30000,
    connectivityProbeUrl: null,
    dictFileTooBig: 'File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.',
    dictInvalidFileType: "You can't upload files of this type.",
    dictResponseError: 'Server responded with {{statusCode}} code.',
    dictUploadCanceled: 'Upload canceled.',
    dictMaxFilesExceeded: 'You cannot upload any more files.',
    dictFileUnreadable: 'The file could not be read (not downloaded, moved or deleted).',
    dictInvalidPath: 'Invalid file path.',
    dictFileSizeUnits: { tb: 'TB', gb: 'GB', mb: 'MB', kb: 'KB', b: 'b' },
  };
}

/** Throws for option combinations Dropzone also rejects. */
export function assertValidOptions(
  o: Pick<AnyDropCoreOptions, 'uploadMultiple' | 'chunking' | 'binaryBody'>,
): void {
  if (o.uploadMultiple && o.chunking) {
    throw new Error('You cannot set both: uploadMultiple and chunking.');
  }
  if (o.binaryBody && o.uploadMultiple) {
    throw new Error('You cannot set both: binaryBody and uploadMultiple.');
  }
}
