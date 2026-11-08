// Core options. Dropzone options keep Dropzone 6.3.5's names, types and defaults (src/options.ts)
// unless noted; new options follow the dropzone-parity skill.
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
  /** HTTP method of upload requests, upper-cased. A function gets the files and data blocks. Default `'post'`. */
  method: string | ((this: Self, files: AnyDropFile[], dataBlocks: DataBlock[]) => string);
  /** Send cookies and credentials on cross-origin requests. Default `false`. */
  withCredentials: boolean;
  /** Request timeout in ms, or a function of the files; `null` = none (Dropzone 6 default). */
  timeout: number | null | ((this: Self, files: AnyDropFile[]) => number | null);
  /** Extra headers sent with every request (uploads, manifest, chunk status, finalize). Empty values are not sent. Default `null`. */
  headers: Record<string, string> | null;
  /** Send Dropzone's `Accept`, `Cache-Control` and `X-Requested-With` headers. Default `true`. */
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
  /** Form field name of the file; a function gets the file index (`file[0]`, `file[1]`, ... with `uploadMultiple`). Default `'file'`. */
  paramName: string | ((n: number) => string);
  /** Non-chunked only; throws together with `chunking`. */
  uploadMultiple: boolean;
  /** Send the file (or chunk) as the raw request body, with no form fields. Not with `uploadMultiple`. Default `false`. */
  binaryBody: boolean;
  /** Files uploading at once (Dropzone meaning). */
  parallelUploads: number;
  /** Optional instance-wide cap on upload POSTs in flight; `null` = no cap. */
  maxChunksInFlight: number | null;
  // Chunking (used from M2)
  /** Split files larger than `chunkSize` into chunks. Default `false`. */
  chunking: boolean;
  /** Chunk files smaller than `chunkSize` too. Default `false`. */
  forceChunking: boolean;
  /** Bytes. Dropzone 6 default: 2 MiB. */
  chunkSize: number;
  /** Chunks of one file in flight: `false` = 1, `true` = `parallelUploads`, or a number (Dropzone 6.3.5). */
  parallelChunkUploads: boolean | number;
  /** Default `true` (Dropzone: `false`). */
  retryChunks: boolean;
  /** How many times a failed request is retried, so at most this plus one attempts. Default `3`. */
  retryChunksLimit: number;
  /**
   * Replaces the built-in finalize request. `this` is the options object (Dropzone);
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
   * to upload to `done`. Chunk info is recomputed from it.
   */
  transformFile: ((this: Self, file: AnyDropFile, done: (blob: Blob) => void) => void) | null;
  /** Sends the requests. `null` = the built-in XMLHttpRequest transport. */
  transport: Transport | null;
  // Validation
  /** MiB; falsy disables the check. */
  maxFilesize: number | null;
  /** Base used by `filesize()`: `1000` or `1024`. Default `1000`. */
  filesizeBase: number;
  /** Maximum number of accepted files; extra files are rejected (`MAX_FILES`) and emit `maxfilesexceeded`. Default `null`. */
  maxFiles: number | null;
  /** Comma-separated `.ext`, `type/*` and `type/subtype` list (the `accept` attribute syntax). */
  acceptedFiles: string | null;
  /** Your own check, called after the built-in ones: `done()` accepts, `done(message)` rejects. */
  accept: (this: Self, file: AnyDropFile, done: AcceptDone) => void;
  /** Skip files whose name starts with `.` inside dropped or picked folders. */
  ignoreHiddenFiles: boolean;
  /** Name sent to the server; changes only the last path segment. */
  renameFile: ((this: Self, file: AnyDropFile) => string) | null;
  // Queue
  /** Start uploading as soon as files are queued. With `false`, call `processQueue()`. Default `true`. */
  autoProcessQueue: boolean;
  /** Queue accepted files when their batch closes. With `false`, call `enqueueFile()`. Default `true`. */
  autoQueue: boolean;
  // Folders (new)
  /** Accept folder drops (and, in the UI, show the folder picker where supported). */
  folders: boolean;
  /** Keep folders that hold no files, and send them in the manifest. */
  preserveEmptyFolders: boolean;
  /** Send the folder manifest (needs `manifestUrl`) before the first file of each batch. Default `false`. */
  sendManifest: boolean;
  /** `POST` target of the folder manifest. Default `null`. */
  manifestUrl: string | null;
  /** `GET ?uploadId=` target that returns the chunks the server already has; used to resume. Default `null`. */
  chunkStatusUrl: string | null;
  /** `POST` target that assembles a chunked file after its last chunk. Default `null`. */
  finalizeUrl: string | null;
  // Pause, resume, persistence (used from M3)
  /** What a pause does to requests in flight: `'abort'` stops them (the chunk is sent again later), `'finishChunk'` lets them finish. Default `'abort'`. */
  pauseMode: 'abort' | 'finishChunk';
  /** Save acknowledged chunks in IndexedDB so an upload can resume after a reload. Default `true`. */
  persistState: boolean;
  /** Scope of resume records; `null` = `url` when it is a string, else `'default'`. */
  persistKey: string | null;
  /** Pause on `pagehide`, and when a request fails while the page is hidden (iOS suspension). Default `true`. */
  autoPauseOnHidden: boolean;
  /** Resume when the browser comes back online, and probe for a lost connection by itself. */
  autoResumeOnReconnect: boolean;
  /**
   * A request with no progress for this long (ms) while its body is sent, or no response for four
   * times as long once it is sent, is aborted as `STALLED` and retried. `null` = off.
   */
  stallTimeout: number | null;
  /** `HEAD` target that tells whether the server is reachable while the connection is lost. */
  connectivityProbeUrl: string | null;
  // Messages (Dropzone dict*)
  /** Message when a file exceeds `maxFilesize`; `{{filesize}}` and `{{maxFilesize}}` are replaced. */
  dictFileTooBig: string;
  /** Message when a file does not match `acceptedFiles`. */
  dictInvalidFileType: string;
  /** Message when the server answers with an error and no body; `{{statusCode}}` is replaced. */
  dictResponseError: string;
  /** Text for a canceled upload (shown by the UI). */
  dictUploadCanceled: string;
  /** Message when a file is rejected because of `maxFiles`. */
  dictMaxFilesExceeded: string;
  /** Error message for a file that can no longer be read (cloud placeholder, moved or deleted). */
  dictFileUnreadable: string;
  /** Error message for a path with a `..` segment. */
  dictInvalidPath: string;
  /** Unit labels used by `filesize()`; a partial object is merged with the defaults. */
  dictFileSizeUnits: FileSizeUnits;
}

/** What the constructor and `setOption` accept: options plus event handlers (Dropzone style). */
export type AnyDropCoreConfig<Self = AnyDropCore> = Partial<AnyDropCoreOptions<Self>> &
  AnyDropEventHandlers<Self> & {
    /** @internal Deterministic id generator for tests. */
    _uuid?: () => string;
    /** @internal Seeded random for backoff jitter in tests. */
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
