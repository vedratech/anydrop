// AnyDropCore: the headless engine. Input reading, validation, the tree, the error list and the
// events (M1); the upload engine: queue, two concurrency limits, chunks, retry, manifest and
// finalize (M2); pause at three levels, resume records, lifecycle auto-pause and retrying failed
// files (M3).
// Nothing here runs at import time; browser globals are only read inside methods.
import { createBatch, type Batch } from './batch';
import { chunkAt, doneBytes, nextChunk, planChunks } from './chunker/chunker';
import {
  ACCEPTED,
  ADDED,
  CANCELED,
  ERROR,
  PAUSED,
  PROCESSING,
  QUEUED,
  SUCCESS,
  UPLOADING,
  isTerminal,
} from './constants';
import { ErrorRegistry, exportErrors } from './errors/registry';
import { Emitter, type Listener, type Unsubscribe } from './events/emitter';
import {
  EVENT_NAMES,
  isEventName,
  type AnyDropEventHandlers,
  type AnyDropEventName,
  type AnyDropEvents,
} from './events/events';
import { KeyedThrottle, microtaskMerge } from './events/throttle';
import { augmentFile } from './file';
import { attach, isOffline } from './lifecycle/attach';
import {
  assertValidOptions,
  defaultOptions,
  type AnyDropCoreConfig,
  type AnyDropCoreOptions,
} from './options';
import { PauseFlags } from './pause/flags';
// The one import of the resume store: a later opt-out entry only has to change this line.
import { createResumeStore, type ResumeStore } from './resume/store';
import { backoff, classify, unreadable, type Failure } from './scheduler/retry';
import { OrderedQueue, fillRoundRobin, perFileLimit, requestCap } from './scheduler/scheduler';
import { pathOfPickedFile, readFileList, snapshotFiles } from './source/fileList';
import type { DataTransferLike, RootInput, SourceItem } from './source/types';
import { snapshotDataTransfer, walkRoots } from './source/walk';
import { appendFields, headersFor, paramName, uploadFields } from './transport/fields';
import type { TransportHandle, TransportRequest, TransportResponse } from './transport/types';
import { xhrTransport } from './transport/xhr';
import { TreeStore, type FolderNodeImpl } from './tree/TreeStore';
import type {
  AcceptDone,
  AnyDropFile,
  ConnectionState,
  DataBlock,
  ErrorEntry,
  FileStatus,
  FolderNode,
  PauseReason,
  PauseTarget,
} from './types';
import { reportError, warn, yieldToMain } from './util/env';
import { dirname, joinPath, normalizePath, sentRelativePath } from './util/path';
import { uuidv4 } from './util/uuid';
import { checkFile, filesize, isValidFile } from './validate/dropzone-port';
import { VERSION } from './version';

/** Files processed per slice when reading a large file input (the page stays responsive). */
const INPUT_SLICE = 500;
/** Chrome fires an XHR network error before `offline`: wait this long (ms) before judging it. Fixed at 1 s, not an option. */
const OFFLINE_GRACE = 1000;
/** Consecutive no-response failures after which the connection counts as lost (`unreachable`). */
const STREAK = 3;
/** How often the stall watchdog looks (ms); it compares timestamps, so a throttled timer only delays it. */
const STALL_TICK = 5000;
/** A connectivity probe that gets no answer for this long (ms) counts as failed. Fixed at 10 s, not an option; raise only if device checks show a probe timing out on a working link. */
const PROBE_TIMEOUT = 10000;

export type AnyDropOptions = AnyDropCoreOptions<AnyDropCore> & AnyDropEventHandlers<AnyDropCore>;

/** One upload POST in flight (`h` set), or a chunk waiting for its retry (`wait`). */
interface Req {
  h?: TransportHandle;
  /** Fraction (0-1) of the request body sent. */
  loaded: number;
  wait?: boolean;
}

/** A file being processed (several with `uploadMultiple`). Holds a file slot until it ends. */
interface Job {
  files: AnyDropFile[];
  /** Chunk size in bytes (`upload.chunkSize`), fixed when processing starts. */
  size: number;
  /** Requests by chunk index (0 for a whole-file request). */
  busy: Map<number, Req>;
  /** Failed attempts per chunk index. */
  tries: Map<number, number>;
  doneBytes: number;
  mismatches: number;
  /** Finalize, `chunksUploaded` or a chunk-status request is running: no new chunk starts. */
  finishing: boolean;
  /** The running JSON request (finalize, status), aborted on cancel. */
  aux?: TransportHandle;
  /** A chunk-status request is running (one at a time per job). */
  st?: boolean;
  response?: unknown;
  dead?: boolean;
}

const isActive = (s: FileStatus): boolean => s === QUEUED || s === UPLOADING || s === PAUSED;
/** Whether `path` is `folder` or inside it (`''` = everything). */
const under = (path: string, folder: string): boolean =>
  !folder || path === folder || path.indexOf(folder + '/') === 0;
type PauseMode = AnyDropOptions['pauseMode'];

/** A JSON request's outcome: the response, how it failed (if so), and the attempts used. */
type Called = [TransportResponse, Failure | null, number];

/** A failed upload request, as stored and emitted. */
interface FailInfo {
  code: string;
  message: unknown;
  stage: ErrorEntry['stage'];
  attempt: number;
  res?: TransportResponse;
  chunkIndex?: number;
}

/**
 * The headless upload engine: reads dropped and picked files and folders, validates them, builds the
 * folder tree and uploads in chunks, with pause, resume and retry. Configure it like Dropzone.
 *
 * @example
 * ```ts
 * const core = new AnyDropCore({ url: '/upload', chunking: true });
 * core.on('queuecomplete', () => console.log(core.getErrors()));
 * const area = document.querySelector('#upload-area')!;
 * area.addEventListener('dragover', (e) => e.preventDefault());
 * area.addEventListener('drop', (e) => { e.preventDefault(); core.drop(e); });
 * ```
 */
export class AnyDropCore extends Emitter<AnyDropEvents> {
  /** Library version. */
  static readonly version = VERSION;
  /** Status constant `'added'`. */
  static readonly ADDED = ADDED;
  /** Status constant `'queued'`. */
  static readonly QUEUED = QUEUED;
  /** Dropzone alias of `QUEUED`. */
  static readonly ACCEPTED = ACCEPTED;
  /** Status constant `'uploading'`. */
  static readonly UPLOADING = UPLOADING;
  /** Dropzone alias of `UPLOADING`. */
  static readonly PROCESSING = PROCESSING;
  /** Status constant `'paused'`. */
  static readonly PAUSED = PAUSED;
  /** Status constant `'success'`. */
  static readonly SUCCESS = SUCCESS;
  /** Status constant `'error'`. */
  static readonly ERROR = ERROR;
  /** Status constant `'canceled'`. */
  static readonly CANCELED = CANCELED;
  /** Dropzone's `Dropzone.isValidFile(file, acceptedFiles)`, with the empty-MIME fallback. */
  static readonly isValidFile = isValidFile;
  /** Creates a UUID version 4. */
  static readonly uuidv4 = uuidv4;

  /** Resolved options (defaults merged with yours). Change them with `setOption()`. */
  readonly options: AnyDropOptions;
  /** Every file added and not removed, in add order (Dropzone's `files`). Do not modify. */
  readonly files: AnyDropFile[] = [];
  /** Set by `disable()`, cleared by `enable()` (Dropzone). */
  disabled = false;

  /** Pause flags. */
  private readonly flags = new PauseFlags();
  /** The folder tree. Protected so subclasses (`@vedratech/anydrop-ui`) can read it; do not shadow it. */
  protected readonly tree = new TreeStore(() => this.flags.any());
  /** The error list. Protected so subclasses can read it; do not shadow it. */
  protected readonly errors: ErrorRegistry;
  private readonly uuid: () => string;
  private readonly random: () => number;
  private readonly handlers = new Map<AnyDropEventName, Listener<unknown[]>>();
  private readonly openBatches = new Set<Batch>();
  private readonly batchOf = new WeakMap<AnyDropFile, Batch>();
  private readonly seqOf = new WeakMap<AnyDropFile, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Queued files in add order; entries that are no longer `queued` are dropped lazily. */
  private readonly queue = new OrderedQueue<AnyDropFile>((f) => this.seqOf.get(f) || 0);
  private readonly jobs: Job[] = [];
  /** Every request in flight (aborted by `destroy()`). */
  private readonly handles = new Set<TransportHandle>();
  /** Closed batches whose manifest may still be due although they have no file to upload. */
  private readonly manifestBatches = new Set<Batch>();
  private readonly folderThrottle = new KeyedThrottle<FolderNodeImpl>(100, (n) => {
    if (this.tree.getFolder(n.path) === n) this.emit('folderprogress', n, n.progress, n.bytesSent);
  });
  private tickBatch: Batch | null = null;
  private acceptedCount = 0;
  private seq = 0;
  /** Bytes of the files in `queued`, `uploading` or `paused` (Dropzone's `totaluploadprogress`). */
  private activeTotal = 0;
  private activeSent = 0;
  private manifestsInFlight = 0;
  /** Round-robin cursor over `jobs`. */
  private rr = 0;
  /** Files given to `processFile(s)`: they start now, beyond `parallelUploads`. */
  private readonly forced = new Set<AnyDropFile>();
  /** Blobs returned by `transformFile`, kept for the session. */
  private readonly blobs = new WeakMap<AnyDropFile, Blob>();
  private queueCompleteDue = false;
  /** A run: from a file entering `processing` to `queuecomplete`. */
  private run = false;
  private destroyed = false;
  /** Handles core aborts itself (`ABORTED`); any other abort counts as `NETWORK`. */
  private readonly own = new WeakSet<TransportHandle>();
  /** Responses of requests that threw while being built (`REQUEST_SETUP_FAILED`). */
  private readonly setupFailed = new WeakSet<TransportResponse>();
  private warned = false;
  // M3 state: resume records, lifecycle, retries.
  private rs: ResumeStore | null = null;
  /** Record key -> the one active file that owns it. */
  private readonly claims = new Map<string, AnyDropFile>();
  private readonly keys = new WeakMap<AnyDropFile, string>();
  /** Files with a `completed` record: skipped (after the server confirms, with `chunkStatusUrl`). */
  private readonly toSkip = new WeakSet<AnyDropFile>();
  /** Files that sent a chunk: their layout is fixed, and a new start asks `chunkStatusUrl`. */
  private readonly sent = new WeakSet<AnyDropFile>();
  /** Files whose new uploadId is not in a manifest the server got yet. */
  private readonly stale = new WeakSet<AnyDropFile>();
  /** Manifest resends per batch: the one in flight and the next one collecting changes. */
  private readonly resends = new WeakMap<
    Batch,
    { cur?: Promise<unknown>; next?: Promise<FailInfo | null> }
  >();
  /** Files whose chunk state came from a stored record (dropped if a transform changes the bytes). */
  private readonly restored = new WeakSet<AnyDropFile>();
  private readonly failedBatches = new Set<Batch>();
  private detach: (() => void) | null = null;
  /** The page is hidden (`visibilitychange`): a network failure becomes a pause. */
  private hidden = false;
  /** Requests waiting for the instance to run again (a manifest that failed offline). */
  private waiters: (() => void)[] = [];
  // Connectivity. `streak` counts no-response failures; only a response resets it.
  private streak = 0;
  private attempt = 0;
  private retryAt: number | null = null;
  /** The next probe's timer. */
  private pt: ReturnType<typeof setTimeout> | undefined;
  private probing = false;
  /** The pause is lifted so the oldest failed request can be the probe (no URL to probe). */
  private lifted = false;
  /** The file of the latest no-response failure: its uploadId goes to `chunkStatusUrl` as the probe. */
  private victim: AnyDropFile | undefined;
  /** Requests in flight, for the stall watchdog: last progress, and whether the body is sent. */
  private readonly live = new Map<TransportHandle, { at: number; body: boolean }>();
  private readonly stalled = new WeakSet<TransportHandle>();
  /** Failed attempts per chunk index, kept across the file's jobs: a pause is not a new start. */
  private readonly attempts = new WeakMap<AnyDropFile, Map<number, number>>();
  private wd: ReturnType<typeof setTimeout> | undefined;

  /** Creates an instance. Nothing touches `window` or `document` until files are added. */
  constructor(config: AnyDropCoreConfig = {}) {
    super();
    const { _uuid, _random, acceptedMimeTypes, renameFilename, ...rest } = config;
    this.uuid = _uuid || uuidv4;
    this.random = _random || Math.random;
    const options = defaultOptions() as AnyDropOptions;
    const units = options.dictFileSizeUnits;
    for (const key of Object.keys(rest) as (keyof typeof rest)[]) {
      const value = rest[key];
      if (value !== undefined) (options as unknown as Record<string, unknown>)[key] = value;
    }
    options.dictFileSizeUnits = { ...units, ...options.dictFileSizeUnits };
    // Deprecated Dropzone options, mapped as Dropzone 6.3.5 does.
    if (acceptedMimeTypes) {
      if (options.acceptedFiles) {
        throw new Error(
          "You can't provide both 'acceptedFiles' and 'acceptedMimeTypes'. 'acceptedMimeTypes' is deprecated.",
        );
      }
      options.acceptedFiles = acceptedMimeTypes;
    }
    if (renameFilename != null) {
      options.renameFile = (file) => renameFilename.call(this, file.name, file);
    }
    assertValidOptions(options);
    // Dropzone upper-cases a string method at construction.
    if (typeof options.method === 'string') options.method = options.method.toUpperCase();
    this.options = options;
    this.errors = new ErrorRegistry(
      microtaskMerge(() => {
        if (!this.destroyed) this.emit('errorlistchanged', this.errors.list());
      }),
    );
    // Event handlers given as options are listeners, as in Dropzone.
    for (const name of EVENT_NAMES) this.setHandler(name, options[name]);
  }

  // ---------------------------------------------------------------- options

  /** Changes an option (or an event handler given as an option) at runtime. */
  setOption<K extends keyof AnyDropCoreConfig>(name: K, value: AnyDropCoreConfig[K]): void {
    if (this.destroyed || name === '_uuid' || name === '_random') return;
    const options = this.options as unknown as Record<string, unknown>;
    if (isEventName(name)) {
      this.setHandler(name, value);
    } else {
      assertValidOptions({ ...this.options, [name]: value });
      if (name === 'dictFileSizeUnits') {
        value = { ...this.options.dictFileSizeUnits, ...(value as object) } as typeof value;
      }
    }
    options[name] = value;
    if (name === 'method' && typeof value === 'string') options.method = value.toUpperCase();
    // New limits (or a URL at last) only affect which requests start next; nothing is aborted.
    if (/^(url|parallelUploads|maxChunksInFlight|parallelChunkUploads)$/.test(name)) {
      this.later(() => this.next());
    }
  }

  /** Adds a listener; returns a function that removes it (chainable: `.on()`, `.once()`). No-op after `destroy()`. */
  override on<K extends AnyDropEventName>(
    event: K,
    fn: Listener<AnyDropEvents[K]>,
  ): Unsubscribe<this> {
    return this.destroyed ? this.unsubscribe(event, fn) : super.on(event, fn);
  }

  override once<K extends AnyDropEventName>(
    event: K,
    fn: Listener<AnyDropEvents[K]>,
  ): Unsubscribe<this> {
    return this.destroyed ? this.unsubscribe(event, fn) : super.once(event, fn);
  }

  /** Dropzone's `resolveOption`: calls a function option with `this` = the instance, else returns it. */
  resolveOption<T>(option: T | ((...args: never[]) => T), ...args: unknown[]): T {
    return typeof option === 'function'
      ? (option as (...a: unknown[]) => T).apply(this, args)
      : option;
  }

  /**
   * Hook for subclasses (Dropzone's `_addFormElementData`): adds fields to an upload's form data,
   * after `sending` and before the file blobs. `@vedratech/anydrop-ui` adds the inputs of a `<form>` element.
   */
  protected _addFormElementData(formData: FormData): void {
    void formData;
  }

  /**
   * Hook for subclasses: emits `complete` for a file outside the queue (a `displayExistingFile`
   * mock file, which is in neither `files` nor the tree), then re-checks `queuecomplete` while a
   * run is open, so it can never fire an extra `queuecomplete` when idle.
   */
  protected _completeExternal(file: AnyDropFile): void {
    this.emit('complete', file);
    if (this.run) this.checkQueueComplete();
  }

  /** Dropzone's `disable()`: sets `disabled` and cancels every file. Adding files still works. */
  disable(): void {
    this.disabled = true;
    // Files not uploading first, so canceling an uploading file never starts a queued one.
    const files = this.files.filter((f) => f.status !== UPLOADING);
    for (const f of files.concat(this.getUploadingFiles())) this.cancel(f);
    this.kick();
  }

  /** Clears `disabled`. */
  enable(): void {
    this.disabled = false;
  }

  /** Reads the current value of an option. */
  getOption<K extends keyof AnyDropOptions>(name: K): AnyDropOptions[K] {
    return this.options[name];
  }

  private setHandler(name: AnyDropEventName, fn: unknown): void {
    const old = this.handlers.get(name);
    if (old) this.off(name, old as Listener<AnyDropEvents[typeof name]>);
    this.handlers.delete(name);
    if (typeof fn === 'function') {
      const listener = fn as Listener<unknown[]>;
      this.handlers.set(name, listener);
      this.on(name, listener as Listener<AnyDropEvents[typeof name]>);
    }
  }

  // ---------------------------------------------------------------- input

  /**
   * Handles a `drop` event (Dropzone's `drop(e)`): emits `drop`, reads files and folders
   * (folders through `webkitGetAsEntry`), and resolves with the batch's files after `addedfiles`.
   * Call it synchronously from the event listener: the browser clears the items afterwards.
   */
  drop(event: { dataTransfer?: DataTransferLike | null }): Promise<AnyDropFile[]> {
    if (this.destroyed || !event || !event.dataTransfer) return Promise.resolve([]);
    this.emit('drop', event as DragEvent);
    return this.ingestRoots(snapshotDataTransfer(event.dataTransfer));
  }

  /** Handles a `paste` event (Dropzone's `paste(e)`). Text-only pastes add nothing. */
  paste(event: { clipboardData?: DataTransferLike | null }): Promise<AnyDropFile[]> {
    const data = event && event.clipboardData;
    if (this.destroyed || !data || data.items == null) return Promise.resolve([]);
    this.emit('paste', event as ClipboardEvent);
    const roots = snapshotDataTransfer(data);
    return roots.length ? this.ingestRoots(roots) : Promise.resolve([]);
  }

  /** Adds the contents of a `DataTransfer` (files and folders) as one batch, without a `drop` event. */
  addDataTransfer(dataTransfer: DataTransferLike): Promise<AnyDropFile[]> {
    if (this.destroyed) return Promise.resolve([]);
    return this.ingestRoots(snapshotDataTransfer(dataTransfer));
  }

  /**
   * Adds the files of a file or folder input (`<input type=file>`, `<input webkitdirectory>`),
   * or a `FileList`, as one batch. Folder paths come from `webkitRelativePath`.
   */
  addFromInput(
    input: { files?: ArrayLike<File> | null } | ArrayLike<File>,
  ): Promise<AnyDropFile[]> {
    if (this.destroyed) return Promise.resolve([]);
    const items = readFileList(snapshotFiles(input), this.options);
    return this.runBatch(() => slices(items));
  }

  /**
   * Adds one file (Dropzone's `addFile`). `folderPath` places it in a folder (`'Photos/2024'`);
   * without it, a non-empty `webkitRelativePath` is used, else the file is loose.
   * Calls in the same tick form one batch. Returns the file with its properties added.
   */
  addFile(file: File, folderPath?: string): AnyDropFile {
    if (this.destroyed) throw new Error('This AnyDropCore instance was destroyed.');
    const known = this.tree.getFile((file as Partial<AnyDropFile>).id || '');
    if (known === file) return known;
    let path: string;
    let fromFolder: boolean;
    if (folderPath != null) {
      const dir = normalizePath(folderPath);
      path = joinPath(dir, file.name);
      fromFolder = !!dir;
    } else {
      ({ path, fromFolder } = pathOfPickedFile(file));
    }
    return this.ingestFile(this.currentTickBatch(), file, path, fromFolder);
  }

  /** Adds several files as one batch (see `addFile`). */
  addFiles(files: ArrayLike<File> | Iterable<File>): AnyDropFile[] {
    return Array.from(files as ArrayLike<File>, (f) => this.addFile(f));
  }

  // ---------------------------------------------------------------- lookups

  /** The virtual root folder (`path: ''`): top-level folders and loose files. Live object. */
  getTree(): FolderNode {
    return this.tree.root;
  }

  /** A folder node by path, for example `getFolder('Photos/2024')`. */
  getFolder(path: string): FolderNode | undefined {
    return this.tree.getFolder(path);
  }

  /** A file by its `id`. */
  getFile(id: string): AnyDropFile | undefined {
    return this.tree.getFile(id);
  }

  /** Files accepted by validation. */
  getAcceptedFiles(): AnyDropFile[] {
    return this.files.filter((f) => f.accepted);
  }

  /** Files rejected by validation. */
  getRejectedFiles(): AnyDropFile[] {
    return this.files.filter((f) => !f.accepted);
  }

  /** Files with the given status. */
  getFilesWithStatus(status: FileStatus): AnyDropFile[] {
    return this.files.filter((f) => f.status === status);
  }

  /** Files with status `added`. */
  getAddedFiles(): AnyDropFile[] {
    return this.getFilesWithStatus(ADDED);
  }

  /** Files with status `queued`. */
  getQueuedFiles(): AnyDropFile[] {
    return this.getFilesWithStatus(QUEUED);
  }

  /** Files in `uploading` (paused files are not included). */
  getUploadingFiles(): AnyDropFile[] {
    return this.getFilesWithStatus(UPLOADING);
  }

  /** Files with status `paused`. */
  getPausedFiles(): AnyDropFile[] {
    return this.getFilesWithStatus(PAUSED);
  }

  /** Files in `queued`, `uploading` or `paused`. */
  getActiveFiles(): AnyDropFile[] {
    return this.files.filter(
      (f) => f.status === QUEUED || f.status === UPLOADING || f.status === PAUSED,
    );
  }

  /** Dropzone's `filesize(bytes)`: `'<strong>1.5</strong> MB'`. */
  filesize(size: number): string {
    return filesize(size, this.options.filesizeBase, this.options.dictFileSizeUnits);
  }

  // ---------------------------------------------------------------- errors

  /** A copy of the error list: one entry per file currently in `error`. */
  getErrors(): ErrorEntry[] {
    return this.errors.list();
  }

  /** Empties the error list. The files stay in `error`. */
  clearErrors(): void {
    this.errors.clear();
  }

  /** The error list as JSON or CSV (RFC 4180). */
  exportErrors(format: 'json' | 'csv' = 'json'): string {
    return exportErrors(this.errors.list(), format);
  }

  /**
   * Re-queues the files in `error` (under `folderPath`, or all) that can be retried: everything but
   * validation rejections. Done chunks are kept; `chunkStatusUrl` is asked first when set; a
   * failed batch manifest is sent again (same `sessionId`). Returns the number of files re-queued.
   */
  retryFailedOnly(folderPath?: string): number {
    if (this.destroyed) return 0;
    const p = normalizePath(folderPath || '');
    let n = 0;
    for (const f of this.files) if (under(f.relativePath, p) && this.requeue(f)) n++;
    // Empty folders whose manifest failed: send the manifest again.
    this.failedBatches.forEach((b) => {
      b.folders.forEach((node) => {
        if (
          node._empty === ERROR &&
          under(node.path, p) &&
          this.tree.getFolder(node.path) === node
        ) {
          this.errors.remove(null, node.path);
          this.tree.setEmptyStatus(node, QUEUED);
          b.manifestState = 'pending';
        }
      });
      if (b.manifestState === 'pending') {
        this.failedBatches.delete(b);
        this.manifestBatches.add(b);
      }
    });
    if (this.options.autoProcessQueue) this.processQueue();
    return n;
  }

  /** Re-queues one failed file (the file or its `id`) like `retryFailedOnly`. Returns whether it was re-queued. */
  retryFile(file: AnyDropFile | string): boolean {
    const f = this.fileOf(file);
    const ok = !!f && !this.destroyed && this.requeue(f);
    if (ok && this.options.autoProcessQueue) this.processQueue();
    return ok;
  }

  /** A retryable file in `error` goes back to the queue; a failed batch manifest is due again. */
  private requeue(f: AnyDropFile): boolean {
    if (f.status !== ERROR || f.accepted !== true) return false;
    const b = this.batchOf.get(f);
    if (b && b.manifestState === 'failed') b.manifestState = 'pending';
    this.errors.remove(f.id);
    this.attempts.delete(f);
    this.setStatus(f, QUEUED);
    return true;
  }

  // ---------------------------------------------------------------- pause

  /** Pauses every file (`paused({ scope: 'all', reason: 'user' })`). */
  pause(): void {
    this.flags.all = true;
    this.changed('paused', { scope: 'all', reason: 'user' });
  }

  /** Clears the instance pause and every system reason (offline, hidden). Folder and file pauses stay. */
  resume(): void {
    this.flags.all = false;
    this.flags.sys.clear();
    this.stopProbing();
    this.changed('resumed', { scope: 'all', reason: 'user' });
  }

  /** Pauses every file under a folder, also files added to it later. Unknown paths are ignored. */
  pauseFolder(path: string): void {
    const folder = this.tree.getFolder(normalizePath(path));
    if (folder) {
      folder.userPaused = true;
      this.changed('paused', { scope: 'folder', folder, reason: 'user' });
    }
  }

  /** Clears a folder's own pause. Files stay paused while an ancestor, the instance or the file itself is paused. */
  resumeFolder(path: string): void {
    const folder = this.tree.getFolder(normalizePath(path));
    if (folder) {
      folder.userPaused = false;
      this.changed('resumed', { scope: 'folder', folder, reason: 'user' });
    }
  }

  /** Pauses one file (the file or its `id`). */
  pauseFile(file: AnyDropFile | string): void {
    const f = this.fileOf(file);
    if (f) {
      this.flags.files.add(f);
      this.changed('paused', { scope: 'file', file: f, reason: 'user' });
    }
  }

  /** Clears a file's own pause (a paused folder or instance still holds it). */
  resumeFile(file: AnyDropFile | string): void {
    const f = this.fileOf(file);
    if (f) {
      this.flags.files.delete(f);
      this.changed('resumed', { scope: 'file', file: f, reason: 'user' });
    }
  }

  /**
   * Cancels every unfinished file under a folder (`cancelUpload` per file: `canceled`, `complete`),
   * then `foldercomplete` fires. The files keep their tree rows.
   */
  cancelFolder(path: string): void {
    const p = normalizePath(path);
    for (const f of this.files.slice()) {
      if ((f.status === ADDED || isActive(f.status)) && under(f.relativePath, p)) this.cancel(f);
    }
    this.kick();
  }

  /**
   * Deletes this `persistKey`'s resume records (a "start over" button), and the claims of the
   * files in the list, so they stop writing records. Does nothing when `persistState` is false.
   */
  clearPersistedState(): Promise<void> {
    if (!this.options.persistState) return Promise.resolve();
    const prefix = this.scope() + '::';
    this.claims.forEach((_, k) => {
      if (!k.indexOf(prefix)) this.claims.delete(k);
    });
    return this.store().clear(prefix);
  }

  private fileOf(x: AnyDropFile | string): AnyDropFile | undefined {
    const f = typeof x === 'string' ? this.tree.getFile(x) : x;
    return f && this.tree.has(f) ? f : undefined;
  }

  /** After a flag change: refresh folder statuses, apply the flags, emit, continue. */
  private changed(
    event: 'paused' | 'resumed',
    target: PauseTarget,
    mode: PauseMode = this.options.pauseMode,
    silent = false,
  ): void {
    if (this.destroyed) return;
    if (target.scope !== 'file') {
      this.tree.refreshSubtree(
        (target.scope === 'folder' ? target.folder : this.tree.root) as FolderNodeImpl,
      );
    }
    this.apply(mode);
    if (!silent) this.emit(event, target);
    if (!this.flags.any()) this.waiters.splice(0).forEach((w) => w());
    this.next();
  }

  /**
   * Applies the flags to every file: a blocked `queued`/`uploading` file becomes `paused` (with
   * `abort`, its requests are aborted and it gives up its slot; with `finishChunk` it gives it up
   * once nothing of it is in flight); an unblocked `paused` file goes back to work.
   */
  private apply(mode: PauseMode): void {
    const stop = new Set<Job>();
    for (const f of this.files) {
      const s = f.status;
      const job = isActive(s) ? this.jobOf(f) : undefined;
      if (!this.flags.blocks(f)) {
        if (s === PAUSED) this.setStatus(f, job ? UPLOADING : QUEUED);
      } else if (s === QUEUED || s === UPLOADING) {
        if (job) stop.add(job);
        this.setStatus(f, PAUSED);
      }
    }
    if (mode === 'abort') stop.forEach((j) => this.stopJob(j));
  }

  /**
   * A system pause: `offline`, `hidden` or `unreachable`. A repeat only applies the
   * flags again; the return from a lifted `unreachable` pause emits no new `paused` event.
   */
  private sysPause(reason: PauseReason, mode: PauseMode = this.options.pauseMode): void {
    const lost = reason === 'unreachable';
    const quiet = lost && this.lifted;
    if (lost) this.lifted = false;
    const had = this.flags.sys.has(reason);
    this.flags.sys.add(reason);
    if (had) {
      this.apply(mode);
      this.next();
    } else this.changed('paused', { scope: 'all', reason }, mode, quiet);
    if (lost) {
      this.flush();
      if (!this.pt && !this.probing) this.reprobe();
    }
  }

  private sysResume(reason: PauseReason): void {
    if (this.flags.sys.delete(reason)) this.changed('resumed', { scope: 'all', reason });
  }

  /**
   * Why a failed request is a pause instead of a retry or an error, or `''`.
   * A failure without any response (network, timeout, stall) while offline pauses `offline`; the
   * third in a row since the last response (any status, `send()` resets the streak) pauses
   * `unreachable`, and so does every later one. None of them uses a retry or makes an error entry.
   */
  private netPause(fail: Failure | null, file?: AnyDropFile): PauseReason | '' {
    if (!fail || !/^(NETWORK|TIMEOUT|STALLED)$/.test(fail.code)) return '';
    this.victim = file;
    if (isOffline() || this.flags.sys.has('offline')) return 'offline';
    if (++this.streak >= STREAK || this.flags.sys.has('unreachable')) return 'unreachable';
    return this.hidden && this.options.autoPauseOnHidden ? 'hidden' : '';
  }

  /** The connection as seen by the lifecycle code: browser offline, no answer from the server, or fine. */
  getConnectionState(): ConnectionState {
    const state = this.flags.sys.has('offline')
      ? 'offline'
      : this.flags.sys.has('unreachable') || this.lifted
        ? 'unreachable'
        : 'online';
    return { state, attempt: this.attempt, retryAt: state === 'unreachable' ? this.retryAt : null };
  }

  /**
   * "Retry now": probes at once while the state is `unreachable`, and clears an `offline` pause the
   * browser no longer reports. Does nothing when online. Unlike `resume()`, user pauses stay.
   */
  reconnect(): void {
    if (!isOffline()) this.sysResume('offline');
    this.probeNow();
  }

  /** The next probe is due after `random(0.5, 1) × min(60 s, 2 s × 2^(n-1))`. */
  private reprobe(): void {
    if (!this.options.autoResumeOnReconnect || this.destroyed) return;
    const n = ++this.attempt;
    const ms = (0.5 + this.random() * 0.5) * Math.min(60000, 2000 * 2 ** (n - 1));
    this.retryAt = Date.now() + ms;
    this.emit('reconnecting', n, ms);
    this.pt = this.later(() => void this.probe(), ms);
  }

  /** Probes now instead of waiting (`online`, visible, `reconnect()`). */
  private probeNow(): void {
    if (!this.flags.sys.has('unreachable') || this.probing) return;
    this.unlater(this.pt);
    this.pt = undefined;
    void this.probe();
  }

  /**
   * One probe: `HEAD connectivityProbeUrl`, else `GET chunkStatusUrl` for the failed file, else the
   * failed requests themselves (the pause is lifted). A response of any status ends the state
   * (`send()` calls `reachable()`); no response schedules the next probe. Never an error entry.
   */
  private async probe(): Promise<void> {
    this.pt = undefined;
    const o = this.options;
    const head = o.connectivityProbeUrl;
    const id = this.victim && this.victim.upload.uuid;
    const url = head || (id && o.chunkStatusUrl && statusUrl(o.chunkStatusUrl, id));
    if (!this.flags.sys.has('unreachable') && !this.lifted) return;
    if (!url) {
      // The oldest failed request is the probe: run again silently; a failure pauses again.
      this.lifted = true;
      this.flags.sys.delete('unreachable');
      this.reprobe();
      return this.changed('resumed', { scope: 'all', reason: 'unreachable' }, undefined, true);
    }
    this.probing = true;
    const r = await this.send(() => ({
      method: head ? 'HEAD' : 'GET',
      url,
      headers: headersFor(o),
      body: null,
      timeout: PROBE_TIMEOUT,
      withCredentials: !!o.withCredentials,
    })).promise;
    this.probing = false;
    if (!this.destroyed && (r.error || !r.status) && this.flags.sys.has('unreachable'))
      this.reprobe();
  }

  /** A response arrived (any status): the streak ends, and so does the `unreachable` state. */
  private reachable(): void {
    this.streak = 0;
    if (!this.flags.sys.has('unreachable') && !this.lifted) return;
    this.flags.sys.delete('unreachable');
    this.stopProbing();
    this.changed('resumed', { scope: 'all', reason: 'unreachable' });
  }

  private stopProbing(): void {
    this.unlater(this.pt);
    this.pt = undefined;
    this.attempt = 0;
    this.retryAt = null;
    this.lifted = false;
  }

  /** Aborts requests without progress for too long. Compares timestamps, not counted ticks. */
  private check(): void {
    const stall = this.options.stallTimeout;
    if (!stall) return;
    const now = Date.now();
    this.live.forEach((l, h) => {
      if (now - l.at > (l.body ? 4 : 1) * stall) {
        this.stalled.add(h);
        this.abort(h);
      }
    });
  }

  private tick(): void {
    this.wd = this.later(() => {
      this.wd = undefined;
      this.check();
      if (this.live.size) this.tick();
    }, STALL_TICK);
  }

  /**
   * Chrome fires the XHR error of a lost connection before `offline`, while `navigator.onLine` is
   * still true: a network error waits briefly for that event, so it pauses instead of using a retry.
   */
  private grace(fail: Failure | null): Promise<void> {
    return fail && fail.code === 'NETWORK' && !isOffline() && !this.flags.sys.size
      ? new Promise((resolve) => this.later(resolve, OFFLINE_GRACE))
      : Promise.resolve();
  }

  /** Adds the lifecycle listeners (first `processQueue`); `destroy()` removes them. */
  private watch(): void {
    if (this.detach || this.destroyed) return;
    this.hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.detach = attach({
      online: () => {
        this.emit('online');
        this.check();
        if (this.options.autoResumeOnReconnect) {
          this.sysResume('offline');
          this.probeNow();
        }
      },
      offline: () => {
        this.emit('offline');
        this.sysPause('offline');
      },
      // Hidden: flush and watch; only a request that then fails pauses (iOS suspension).
      visibility: (hidden) => {
        this.flush();
        this.hidden = hidden;
        if (!hidden) {
          this.sysResume('hidden');
          this.check();
          if (this.options.autoResumeOnReconnect) this.probeNow();
        }
      },
      pagehide: () => {
        this.flush();
        if (this.options.autoPauseOnHidden) this.sysPause('hidden', 'abort');
      },
      pageshow: () => this.sysResume('hidden'),
    });
  }

  // ---------------------------------------------------------------- resume records

  private store(): ResumeStore {
    return this.rs || (this.rs = createResumeStore());
  }

  private flush(): void {
    if (this.rs) this.rs.flush();
  }

  /** `persistKey`, else `url` when it is a string, else `'default'`. */
  private scope(): string {
    const o = this.options;
    // Encoded, so a key containing `::` can neither collide with another scope nor match its prefix.
    return encodeURIComponent(
      o.persistKey != null ? o.persistKey : typeof o.url === 'string' ? o.url : 'default',
    );
  }

  /** The record key of a file, while it owns it. */
  private keyOf(f: AnyDropFile): string | undefined {
    const k = this.keys.get(f);
    return this.options.persistState && k && this.claims.get(k) === f ? k : undefined;
  }

  /**
   * Writes a file's record (batched). Chunk records only after a 2xx, and none when `transformFile`
   * returned a different blob (its bytes may differ next time).
   */
  private persist(f: AnyDropFile, completed: boolean): void {
    const k = this.keyOf(f);
    if (!k || (!completed && (this.blobs.get(f) || f) !== f)) return;
    const u = f.upload;
    this.store().put({
      key: k,
      uploadId: u.uuid,
      chunkSize: u.chunkSize,
      totalChunks: u.totalChunkCount,
      chunksDone: Array.from(u.chunksDone),
      completed,
      updatedAt: Date.now(),
    });
  }

  private unpersist(f: AnyDropFile): void {
    const k = this.keyOf(f);
    if (k) this.store().del(k);
  }

  // ---------------------------------------------------------------- queue

  /** Queues an added, accepted file (Dropzone's `enqueueFile`). */
  enqueueFile(file: AnyDropFile): void {
    const b = this.batchOf.get(file);
    // In an open batch the file is not validated yet: apply the call when the batch closes.
    if (b && !b.closed && this.tree.has(file)) {
      b.deferred.push({ file, process: false });
    } else if (file.status === ADDED && file.accepted === true) {
      this.setStatus(file, QUEUED);
      if (this.options.autoProcessQueue) this.later(() => this.processQueue());
    } else {
      throw new Error(
        "This file can't be queued because it has already been processed or was rejected.",
      );
    }
  }

  /** Queues several added, accepted files (with `autoQueue: false`). */
  enqueueFiles(files: AnyDropFile[]): void {
    for (const file of files) this.enqueueFile(file);
  }

  /**
   * Starts queued files until `parallelUploads` files are uploading (Dropzone's `processQueue`).
   * Files start in add order; a batch's manifest is sent before its first file. Without a
   * `url`, nothing starts. Called while a batch is still being read, it also runs when that
   * batch closes, so its files are included.
   */
  processQueue(): void {
    if (this.destroyed) return;
    this.watch();
    this.offlineStart();
    this.openBatches.forEach((b) => {
      if (!b.closed) b.processRequested = true;
    });
    this.startFiles();
    this.fill();
  }

  /**
   * Starts these `queued` files now, even beyond `parallelUploads` (Dropzone's `processFiles`).
   * Files of a batch that is still open start when it closes. With `uploadMultiple`, the files
   * of one batch share one request.
   */
  processFiles(files: AnyDropFile[]): void {
    if (this.destroyed) return;
    this.watch();
    for (const f of files) {
      const b = this.batchOf.get(f);
      if (b && !b.closed) b.deferred.push({ file: f, process: true });
      else if (f.status === QUEUED) this.forced.add(f);
      else warn('processFile: the file is not queued:', f.relativePath, f.status);
    }
    this.offlineStart();
    this.startForced();
    this.fill();
  }

  /** Starting while the browser is offline pauses `offline` at once, without an `offline` event. */
  private offlineStart(): void {
    if (isOffline() && !this.flags.sys.has('offline') && this.tree.root.counts.queued) {
      this.sysPause('offline');
    }
  }

  /** Starts one queued file now, even beyond `parallelUploads`. */
  processFile(file: AnyDropFile): void {
    this.processFiles([file]);
  }

  /** Alias of `processFile` (Dropzone). Overriding it changes nothing: use `transport` instead. */
  uploadFile(file: AnyDropFile): void {
    this.processFiles([file]);
  }

  /** Alias of `processFiles` (Dropzone). */
  uploadFiles(files: AnyDropFile[]): void {
    this.processFiles(files);
  }

  /**
   * Cancels a file (Dropzone's `cancelUpload`): aborts its requests, status `canceled`, then
   * `canceled` and `complete`. With `uploadMultiple`, every file sharing its request is canceled.
   */
  cancelUpload(file: AnyDropFile): void {
    if (!this.tree.has(file)) return;
    this.cancel(file);
    this.kick();
  }

  /** Cancels without restarting the queue; deletes the resume records. */
  private cancel(file: AnyDropFile): void {
    if (!this.tree.has(file)) return;
    const job = this.jobOf(file);
    const files = job ? job.files : [file];
    if (job) this.endJob(job);
    const canceled = files.filter((f) => f.status === ADDED || isActive(f.status));
    for (const f of canceled) {
      this.unpersist(f);
      this.setStatus(f, CANCELED);
    }
    for (const f of canceled) {
      this.emit('canceled', f);
      this.completed(f);
    }
    if (canceled.length && this.options.uploadMultiple) this.emit('canceledmultiple', canceled);
  }

  private kick(): void {
    if (this.options.autoProcessQueue) this.processQueue();
    else this.next();
  }

  private jobOf(file: AnyDropFile): Job | undefined {
    return this.jobs.find((j) => j.files.indexOf(file) >= 0);
  }

  /** Removes a file (Dropzone's `removeFile`); cancels it first when it is uploading. */
  removeFile(file: AnyDropFile): void {
    if (!this.tree.has(file)) return;
    if (file.status === UPLOADING || this.jobOf(file)) this.cancelUpload(file);
    const i = this.files.lastIndexOf(file);
    if (i >= 0) this.files.splice(i, 1);
    this.removed(file, file.status, this.forget(file));
    if (this.files.length === 0) this.emit('reset');
  }

  /**
   * After a removal: `removedfile`, `removedfolder` (deepest first). Completion is re-checked only
   * when the file was unfinished and a run is open, so `queuecomplete() {
   * this.removeAllFiles() }` fires once.
   */
  private removed(file: AnyDropFile, status: FileStatus, folders: FolderNode[]): void {
    this.emit('removedfile', file);
    for (const n of folders) this.emit('removedfolder', n);
    this.emitTotal();
    this.checkMaxFilesReached();
    if (this.run && (status === ADDED || status === QUEUED || status === PAUSED)) {
      this.foldersCompletedBy(file);
      this.checkQueueComplete();
    }
  }

  /**
   * Removes every file that is not uploading, or every file when `cancelIfNecessary` is true
   * (Dropzone's `removeAllFiles`). Emits `removedfile` per file, `removedfolder` for every folder
   * left without files (also folders dropped empty), then `reset`.
   */
  removeAllFiles(cancelIfNecessary = false): void {
    const removed = this.files.filter((f) => f.status !== UPLOADING || cancelIfNecessary);
    for (const f of removed) if (f.status === UPLOADING || this.jobOf(f)) this.cancelUpload(f);
    const statuses = removed.map((f) => f.status);
    // Reverse add order: each file is at the end of its arrays, so removal is O(1) per file.
    const pruned: FolderNode[][] = [];
    for (let i = removed.length - 1; i >= 0; i--)
      pruned[i] = this.forget(removed[i] as AnyDropFile);
    const keep = this.files.filter((f) => this.tree.has(f));
    this.files.length = 0;
    this.files.push(...keep);
    removed.forEach((f, i) =>
      this.removed(f, statuses[i] as FileStatus, pruned[i] as FolderNode[]),
    );
    // Clearing also drops folders left without files, including ones dropped empty.
    for (const n of this.tree.pruneEmpty()) {
      this.errors.remove(null, n.path);
      this.emit('removedfolder', n);
    }
    if (removed.length && this.files.length === 0) this.emit('reset');
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Aborts every request, removes every listener and timer. The instance cannot be used again.
   * Unlike Dropzone, no `removedfile` events are emitted.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rs) this.rs.close();
    if (this.detach) this.detach();
    this.detach = null;
    this.waiters.length = 0;
    for (const job of this.jobs) job.dead = true;
    this.jobs.length = 0;
    this.handles.forEach((h) => this.abort(h));
    this.handles.clear();
    this.folderThrottle.clear();
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.live.clear();
    this.queue.clear();
    this.manifestBatches.clear();
    this.claims.clear();
    this.forced.clear();
    this.openBatches.forEach((b) => this.finishBatch(b));
    this.tickBatch = null;
    this.off();
    this.handlers.clear();
    this.errors.clear();
    this.tree.clear();
    this.files.length = 0;
    this.acceptedCount = 0;
  }

  /** Whether `destroy()` was called. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ---------------------------------------------------------------- internals: batches

  private ingestRoots(roots: RootInput[]): Promise<AnyDropFile[]> {
    return this.runBatch((batch) =>
      walkRoots(roots, {
        ignoreHiddenFiles: this.options.ignoreHiddenFiles,
        folders: this.options.folders,
        onError: (_error, path) => batch.readErrors.push(path),
      }),
    );
  }

  /** Runs a new batch over an async source of items; resolves after `addedfiles`. */
  private runBatch(source: (batch: Batch) => AsyncIterable<SourceItem[]>): Promise<AnyDropFile[]> {
    const batch = this.newBatch();
    void (async () => {
      try {
        for await (const items of source(batch)) {
          if (this.destroyed) break;
          for (const item of items) this.ingestItem(batch, item);
        }
      } catch (error) {
        reportError(error);
      }
      batch.walking = false;
      this.maybeCloseBatch(batch);
    })();
    return batch.promise;
  }

  private newBatch(): Batch {
    const batch = createBatch(this.uuid());
    this.openBatches.add(batch);
    return batch;
  }

  /** The batch of programmatic adds in this tick; closed on a microtask. */
  private currentTickBatch(): Batch {
    let batch = this.tickBatch;
    if (!batch) {
      const b = (batch = this.tickBatch = this.newBatch());
      void Promise.resolve().then(() => {
        if (this.tickBatch === b) this.tickBatch = null;
        b.walking = false;
        this.maybeCloseBatch(b);
      });
    }
    return batch;
  }

  private ingestItem(batch: Batch, item: SourceItem): void {
    if (item.kind === 'file') {
      this.ingestFile(batch, item.file, item.path, item.fromFolder);
      return;
    }
    if (this.options.preserveEmptyFolders) this.folderFor(batch, item.path)._keep = true;
    if (item.raw) this.emit('emptyfolder', item.path);
  }

  /** The folder node at `path` (created with `addedfolder` events), recorded in the batch. */
  private folderFor(batch: Batch, path: string): FolderNodeImpl {
    const node = path ? this.tree.ensureFolder(path, this.onFolderCreated) : this.tree.root;
    for (
      let n: FolderNodeImpl | null = node;
      n && n.parent && !batch.folders.has(n);
      n = n.parent
    ) {
      batch.folders.add(n);
    }
    return node;
  }

  private readonly onFolderCreated = (node: FolderNodeImpl): void => {
    // A folder added under a paused folder needs no flag: pause is checked along each file's path.
    this.emit('addedfolder', node);
  };

  private ingestFile(batch: Batch, file: File, path: string, fromFolder: boolean): AnyDropFile {
    const o = this.options;
    const folder = this.folderFor(batch, dirname(path));
    const f = augmentFile(file, {
      id: this.uuid(),
      uploadId: this.uuid(),
      relativePath: path,
      fromFolder,
      folder,
      chunking: o.chunking,
      forceChunking: o.forceChunking,
      chunkSize: o.chunkSize,
      rename: (af) => this.renameFile(af),
    });
    this.files.push(f);
    this.tree.addFile(f);
    batch.files.push(f);
    this.batchOf.set(f, batch);
    this.seqOf.set(f, this.seq++);
    this.emit('addedfile', f);
    this.validate(batch, f);
    return f;
  }

  private renameFile(file: AnyDropFile): string {
    const rename = this.options.renameFile;
    if (typeof rename !== 'function') return file.name;
    try {
      return String(rename.call(this, file));
    } catch (error) {
      reportError(error);
      return file.name;
    }
  }

  /** Dropzone's accept chain: size, type, maxFiles, then the user `accept()` (may be async). */
  private validate(batch: Batch, file: AnyDropFile): void {
    batch.pending++;
    let settled = false;
    const settle = (error: unknown, code: string): void => {
      if (settled) return;
      settled = true;
      batch.pending--;
      this.onValidated(batch, file, error, code);
      this.maybeCloseBatch(batch);
    };
    const o = this.options;
    // A `..` segment could escape the upload folder on a careless backend; so could a separator
    // or a dot name returned by `renameFile()` (it replaces the last segment that is sent).
    const name = file.upload.filename;
    const rejection =
      file.relativePath.split('/').indexOf('..') >= 0 || /[\\/]|^\.\.?$/.test(name)
        ? { message: o.dictInvalidPath, code: 'INVALID_PATH' }
        : checkFile(file, o, this.acceptedCount);
    if (rejection) {
      settle(rejection.message, rejection.code);
      if (rejection.code === 'MAX_FILES') this.emit('maxfilesexceeded', file);
      return;
    }
    const done: AcceptDone = (error) => settle(error, 'REJECTED');
    try {
      o.accept.call(this, file, done);
    } catch (error) {
      reportError(error);
      settle(error instanceof Error ? error.message : String(error), 'REJECTED');
    }
  }

  private onValidated(batch: Batch, file: AnyDropFile, error: unknown, code: string): void {
    if (this.destroyed || !this.tree.has(file)) return;
    if (error) {
      file.accepted = false;
      this.setStatus(file, ERROR);
      this.errors.set({
        fileId: file.id,
        relativePath: file.relativePath,
        uploadId: null,
        code,
        message: messageOf(error),
        stage: 'validate',
        attempt: 0,
        retryable: false,
        at: Date.now(),
      });
      this.emit('error', file, error);
      this.emit('complete', file);
      if (this.options.uploadMultiple) {
        this.emit('errormultiple', [file], error);
        this.emit('completemultiple', [file]);
      }
      if (batch.closed) this.foldersCompletedBy(file);
      else batch.terminalIn.add(file.folder as FolderNodeImpl);
      this.checkQueueComplete();
      if (this.options.autoProcessQueue) this.processQueue();
    } else {
      file.accepted = true;
      this.acceptedCount++;
      this.tree.update(file);
    }
    this.checkMaxFilesReached();
  }

  /** Dropzone emits `maxfilesreached` whenever a check finds exactly `maxFiles` accepted files. */
  private checkMaxFilesReached(): void {
    const max = this.options.maxFiles;
    if (max != null && this.acceptedCount === max) this.emit('maxfilesreached', this.files);
  }

  private maybeCloseBatch(batch: Batch): void {
    if (batch.closed || batch.walking || batch.pending > 0) return;
    batch.closed = true;
    void this.closeBatch(batch);
  }

  /** Steps 3 and 4 of the batch pipeline. */
  private async closeBatch(batch: Batch): Promise<void> {
    if (batch.readErrors.length) {
      warn(`${batch.readErrors.length} dropped item(s) could not be read:`, batch.readErrors);
    }
    try {
      await this.prepareBatch(batch);
    } catch (error) {
      reportError(error);
    }
    if (this.destroyed) return;
    const o = this.options;
    const files = batch.files.filter((f) => this.tree.has(f));
    this.emit('addedfiles', files);
    // Finished in an earlier session: skipped now, or once the server confirms it.
    for (const f of files) {
      if (this.toSkip.has(f) && !o.chunkStatusUrl && this.tree.has(f)) this.skip(f);
    }
    if (o.autoQueue) {
      for (const f of files)
        if (f.status === ADDED && f.accepted === true) this.setStatus(f, QUEUED);
    }
    // Empty folders: without a manifest there is nothing to send, so they are done.
    const completed = new Set(this.manifestDue() ? [] : this.settleEmpty(batch, SUCCESS));
    batch.terminalIn.forEach((n) => {
      for (let p: FolderNodeImpl | null = n; p && p.parent; p = p.parent) {
        if (!p._fc && this.tree.isComplete(p) && this.tree.getFolder(p.path) === p)
          completed.add(p);
      }
    });
    this.foldersComplete(Array.from(completed));
    this.finishBatch(batch);
    if (this.manifestDue()) this.manifestBatches.add(batch);
    // enqueueFile() / processFile() calls made while the batch was open.
    for (const { file: f, process } of batch.deferred) {
      if (!this.tree.has(f)) continue;
      if (f.accepted !== true) {
        warn('rejected, not queued:', f.relativePath);
        continue;
      }
      if (f.status === ADDED) this.setStatus(f, QUEUED);
      if (process) this.forced.add(f);
    }
    // A processQueue() call made while this batch was open runs now.
    if (o.autoProcessQueue || batch.processRequested) {
      batch.processRequested = false;
      this.processQueue();
    }
    this.startForced();
    this.fill();
    if (files.length) this.checkQueueComplete();
  }

  /** Emits `foldercomplete` for each folder, innermost first. */
  private foldersComplete(list: FolderNodeImpl[]): void {
    list.sort((a, b) => b.depth - a.depth);
    for (const n of list) {
      n._fc = true;
      this.emit('foldercomplete', n);
    }
  }

  /**
   * Sets the batch's still-`queued` empty folders to `status` and returns them.
   * With `error`, each gets a folder-level error entry.
   */
  private settleEmpty(batch: Batch, status: FileStatus, entry?: ErrorEntry): FolderNodeImpl[] {
    const out: FolderNodeImpl[] = [];
    batch.folders.forEach((n) => {
      if (n.counts.total === 0 && n._empty === QUEUED && this.tree.getFolder(n.path) === n) {
        this.tree.setEmptyStatus(n, status);
        if (entry)
          this.errors.set({ ...entry, fileId: null, uploadId: null, relativePath: n.path });
        out.push(n);
      }
    });
    return out;
  }

  /**
   * Resume lookup, before `addedfiles`: one store read for the batch's accepted files. Each
   * file claims its record key unless another unfinished file holds it. A partial record is adopted
   * when the chunk layout matches (and no `transformFile` is set); a `completed` one marks
   * the file to be skipped.
   */
  private async prepareBatch(batch: Batch): Promise<void> {
    const o = this.options;
    if (!o.persistState) return;
    const mine: AnyDropFile[] = [];
    const scope = this.scope() + '::';
    for (const f of batch.files) {
      if (f.accepted !== true || !this.tree.has(f)) continue;
      const k = scope + f.fingerprint;
      const owner = this.claims.get(k);
      if (owner && owner !== f && this.tree.has(owner) && !isTerminal(owner.status)) continue;
      this.claims.set(k, f);
      this.keys.set(f, k);
      mine.push(f);
    }
    if (!mine.length) return;
    const store = this.store();
    const recs = await store.get(
      scope,
      mine.map((f) => this.keys.get(f) as string),
    );
    mine.forEach((f, i) => {
      const r = recs[i];
      const u = f.upload;
      if (!r || !this.tree.has(f)) return;
      if (r.completed) {
        u.uuid = r.uploadId;
        u.resumed = true;
        this.toSkip.add(f);
      } else if (
        o.chunking &&
        r.chunkSize === Number(o.chunkSize) &&
        r.totalChunks === Math.max(1, Math.ceil(f.size / r.chunkSize))
      ) {
        u.uuid = r.uploadId;
        u.chunked = u.resumed = true;
        u.chunkSize = r.chunkSize;
        u.totalChunkCount = r.totalChunks;
        u.chunksDone = new Set(validIndexes(r.chunksDone, r.totalChunks));
        this.restored.add(f);
      } else {
        store.del(r.key);
      }
    });
  }

  /** A file finished in an earlier session: `success` without sending anything. */
  private skip(f: AnyDropFile): void {
    const u = f.upload;
    this.toSkip.delete(f);
    u.skipped = u.resumed = true;
    this.setSent(f, u.total, true);
    this.setStatus(f, SUCCESS);
    this.persist(f, true);
    this.emit('success', f, { skipped: true, uploadId: u.uuid }, null);
    this.completed(f);
  }

  private finishBatch(batch: Batch): void {
    batch.closed = true;
    this.openBatches.delete(batch);
    batch.resolve(batch.files.filter((f) => this.tree.has(f)));
  }

  // ---------------------------------------------------------------- internals: files

  private setStatus(file: AnyDropFile, status: FileStatus): void {
    // A file that would be queued while it, a folder above it or the instance is paused waits paused.
    if (status === QUEUED && this.flags.blocks(file)) status = PAUSED;
    const was = isActive(file.status);
    if (was !== isActive(status)) {
      const k = was ? -1 : 1;
      this.activeTotal += k * file.upload.total;
      this.activeSent += k * file.upload.bytesSent;
    }
    file.status = status;
    this.tree.update(file);
    if (status === QUEUED) this.queue.add(file);
  }

  /** Emits `complete`, then `foldercomplete` where due, and checks for `queuecomplete`. */
  private completed(file: AnyDropFile): void {
    this.emit('complete', file);
    this.foldersCompletedBy(file);
    this.checkQueueComplete();
  }

  /**
   * Dropzone's rule: `queuecomplete` is deferred (setTimeout 0) after a `complete`, and fires when
   * no file is added, queued, uploading (or paused). Open batches hold it back; they check again
   * when they close, so an all-rejected drop fires it too.
   */
  private checkQueueComplete(): void {
    if (this.queueCompleteDue) return;
    this.queueCompleteDue = true;
    this.later(() => {
      this.queueCompleteDue = false;
      const c = this.tree.root.counts;
      if (!c.added && !c.queued && !c.uploading && !c.paused && !this.jobs.length) {
        if (!this.openBatches.size && !this.manifestsInFlight) {
          this.run = false;
          this.emit('queuecomplete');
        }
      }
    });
  }

  /** Emits `foldercomplete` for every ancestor that this terminal file completed, innermost first. */
  private foldersCompletedBy(file: AnyDropFile): void {
    const batch = this.batchOf.get(file);
    if (batch && !batch.closed) {
      batch.terminalIn.add(file.folder as FolderNodeImpl);
      return;
    }
    // Also after a removal: pruned folders are skipped, surviving ancestors are checked.
    const done: FolderNodeImpl[] = [];
    for (let p = file.folder as FolderNodeImpl; p.parent; p = p.parent) {
      if (!p._fc && this.tree.isComplete(p) && this.tree.getFolder(p.path) === p) done.push(p);
    }
    this.foldersComplete(done);
  }

  /** Drops a file from the tree, the counters and the error list (no events). Returns the pruned folders. */
  private forget(file: AnyDropFile): FolderNode[] {
    if (file.accepted === true) this.acceptedCount--;
    if (isActive(file.status)) {
      this.activeTotal -= file.upload.total;
      this.activeSent -= file.upload.bytesSent;
    }
    this.forced.delete(file);
    this.flags.files.delete(file);
    // removeFile deletes the resume record.
    this.unpersist(file);
    const k = this.keys.get(file);
    if (k && this.claims.get(k) === file) this.claims.delete(k);
    const pruned = this.tree.removeFile(file);
    this.errors.remove(file.id);
    const batch = this.batchOf.get(file);
    if (batch && !batch.closed) {
      const i = batch.files.lastIndexOf(file);
      if (i >= 0) batch.files.splice(i, 1);
    }
    return pruned;
  }

  // ---------------------------------------------------------------- internals: upload engine

  /**
   * After any request ends: paused jobs with nothing in flight give up their file slot, then
   * files start (with `autoProcessQueue`) and request slots are filled.
   */
  private next(): void {
    if (this.destroyed) return;
    for (const j of this.jobs.slice()) {
      let busy = 0;
      j.busy.forEach((r) => (busy += r.wait ? 0 : 1));
      if (!busy && !j.finishing && j.files.every((x) => x.status === PAUSED)) {
        this.endJob(j);
        this.progress(j);
      }
    }
    if (this.options.autoProcessQueue) this.startFiles();
    this.fill();
  }

  /** Whether a manifest is sent: it needs `sendManifest` and `manifestUrl` (else one warning). */
  private manifestDue(): boolean {
    const o = this.options;
    if (o.sendManifest && !o.manifestUrl && !this.warned) {
      this.warned = true;
      warn('sendManifest is set but manifestUrl is not: no manifest is sent.');
    }
    return !!o.sendManifest && !!o.manifestUrl;
  }

  /** Whether the batch's files may start; sends the manifest when it is due. */
  private manifestOk(b: Batch): boolean {
    if (!this.manifestDue() || b.manifestState === 'sent') return true;
    if (b.manifestState === 'pending') void this.sendManifest(b);
    return false;
  }

  /** Starts the files given to `processFiles()`, beyond `parallelUploads`. */
  private startForced(): void {
    if (!this.options.url || this.destroyed) return;
    this.forced.forEach((f) => {
      if (f.status !== QUEUED || !this.tree.has(f)) return void this.forced.delete(f);
      if (!this.manifestOk(this.batchOf.get(f) as Batch)) return;
      const files: AnyDropFile[] = [];
      this.forced.forEach((g) => {
        if (
          (g === f || this.options.uploadMultiple) &&
          g.status === QUEUED &&
          this.manifestOk(this.batchOf.get(g) as Batch)
        ) {
          files.push(g);
          this.forced.delete(g);
        }
      });
      this.startJob(files);
    });
  }

  /** Starts queued files, oldest first, while fewer than `parallelUploads` files are uploading. */
  private startFiles(): void {
    const o = this.options;
    if (!o.url) return;
    // Batches with nothing to upload still send their manifest (empty folders).
    this.manifestBatches.forEach((b) => {
      this.manifestBatches.delete(b);
      if (b.manifestState !== 'pending') return;
      if (b.files.some((f) => this.tree.has(f) && (f.status === QUEUED || f.status === ADDED)))
        return;
      if (this.settleEmpty(b, QUEUED).length) void this.sendManifest(b);
      else b.manifestState = 'sent';
    });
    let free = o.parallelUploads - this.jobs.reduce((n, j) => n + j.files.length, 0);
    const q = this.queue.items;
    for (let i = 0; free > 0 && i < q.length;) {
      const f = q[i] as AnyDropFile;
      if (f.status !== QUEUED || !this.tree.has(f)) {
        this.queue.remove(i);
        continue;
      }
      const batch = this.batchOf.get(f) as Batch;
      if (!this.manifestOk(batch)) {
        batch.processRequested = true; // continued when the manifest returns
        i++;
        continue;
      }
      this.queue.remove(i);
      const files = [f];
      // uploadMultiple: queued files of any batch whose manifest is done or not needed.
      for (let j = i; o.uploadMultiple && files.length < free && j < q.length;) {
        const g = q[j] as AnyDropFile;
        if (
          g.status === QUEUED &&
          this.tree.has(g) &&
          this.manifestOk(this.batchOf.get(g) as Batch)
        ) {
          files.push(g);
          this.queue.remove(j);
        } else j++;
      }
      free -= files.length;
      this.startJob(files);
    }
  }

  private startJob(files: AnyDropFile[]): void {
    const o = this.options;
    const f = files[0] as AnyDropFile;
    let tries = this.attempts.get(f);
    if (!tries) this.attempts.set(f, (tries = new Map()));
    const job: Job = {
      files,
      size: 0,
      busy: new Map(),
      tries,
      doneBytes: 0,
      mismatches: 0,
      // Nothing is sent until the chunk layout is known (after transformFile).
      finishing: true,
    };
    this.jobs.push(job);
    this.run = true;
    for (const x of files) {
      this.setStatus(x, UPLOADING);
      this.emit('processing', x);
    }
    if (o.uploadMultiple) this.emit('processingmultiple', files);
    // The chunk layout is decided now, from the blob to send and the current options.
    const ready = (): void => {
      if (job.dead) return;
      for (const x of files) {
        const blob = this.blobs.get(x) || x;
        const u = x.upload;
        // A restored chunk state only holds for the original bytes: a transform that changed the
        // blob starts fresh under a new uploadId; one that passed the file through keeps it.
        if (blob !== x && this.restored.has(x)) {
          this.renew(x);
          u.resumed = false;
        }
        this.restored.delete(x);
        const before = u.total;
        job.size = planChunks(x, blob.size, o, this.sent.has(x) || u.chunksDone.size > 0);
        this.activeTotal += u.total - before;
        this.tree.update(x);
      }
      job.doneBytes = doneBytes(f, job.size);
      this.progress(job);
      // A file with chunks sent (paused, retried) or restored asks chunkStatusUrl what the server
      // has; a fresh file never does.
      const ask = !!o.chunkStatusUrl && files.length < 2 && (f.upload.resumed || this.sent.has(f));
      const go = (): void => {
        job.finishing = false;
        if (ask) void this.refreshStatus(job);
        else if (f.upload.chunked && nextChunk(f, job.busy) < 0) void this.finishChunks(job);
        // Started synchronously: the caller fills the request slots once for every started file,
        // so they are shared round-robin.
        else if (!sync) this.next();
      };
      // A new uploadId the server has not been told yet (a retry after a failed resend) is
      // announced first; the status path does it itself.
      if (!ask && files.some((x) => this.stale.has(x))) {
        void this.announce(job).then((ok) => ok && go());
      } else go();
    };
    const transform = o.transformFile;
    let left = files.length;
    let sync = true;
    for (const x of files) {
      // A transformed blob is kept for the session: retries send the same bytes.
      if (!transform || this.blobs.has(x)) {
        if (!--left) ready();
        continue;
      }
      let once = false;
      try {
        transform.call(this, x, (blob) => {
          if (once) return;
          once = true;
          this.blobs.set(x, blob || x);
          if (!--left) ready();
        });
      } catch (error) {
        reportError(error);
        return this.failJob(job, {
          code: 'TRANSFORM_FAILED',
          message: messageOf(error),
          stage: 'upload',
          attempt: 1,
        });
      }
    }
    sync = false;
  }

  /** Starts upload POSTs round-robin across uploading files, within both limits. */
  private fill(): void {
    const o = this.options;
    const cap = requestCap(o);
    const per = perFileLimit(o);
    let active = 0;
    for (const j of this.jobs) j.busy.forEach((r) => (active += r.wait ? 0 : 1));
    this.rr = fillRoundRobin(
      this.jobs,
      this.rr,
      () => active < cap,
      (job) => {
        const f = job.files[0] as AnyDropFile;
        if (job.finishing || job.busy.size >= per || f.status === PAUSED) return false;
        const i = f.upload.chunked ? nextChunk(f, job.busy) : job.busy.size ? -1 : 0;
        if (i < 0) return false;
        active++;
        this.sendUpload(job, i);
        return true;
      },
    );
  }

  /** Sends one chunk, one whole file, or (`uploadMultiple`) several files. */
  private sendUpload(job: Job, index: number): void {
    const o = this.options;
    const files = job.files;
    const f = files[0] as AnyDropFile;
    const chunk = f.upload.chunked ? chunkAt(f, index, job.size, job.tries.get(index) || 0) : null;
    if (chunk) this.sent.add(f); // the layout is fixed from the first chunk sent, acknowledged or not
    const req: Req = { loaded: 0 };
    job.busy.set(index, req);
    const h = this.send(() => {
      // Dropzone's data blocks. Never a whole file read: one Blob.slice() per chunk.
      const blocks: DataBlock[] = chunk
        ? [
            {
              name: paramName(o, 0),
              data: (this.blobs.get(f) || f).slice(chunk.start, chunk.end),
              filename: f.upload.filename,
              chunkIndex: index,
            },
          ]
        : files.map((x, i) => ({
            name: paramName(o, i),
            data: this.blobs.get(x) || x,
            filename: x.upload.filename,
          }));
      const fd = o.binaryBody ? null : new FormData();
      return {
        method: String(this.resolveOption(o.method, files, blocks)).toUpperCase(),
        url: String(this.resolveOption(o.url, files, blocks)),
        headers: headersFor(o, o.binaryBody ? { 'Content-Type': f.type } : undefined),
        body: fd || (blocks[0] as DataBlock).data,
        timeout: this.resolveOption(o.timeout, files),
        withCredentials: !!o.withCredentials,
        beforeSend: (native) => {
          // Dropzone's order: params(), `sending`, form element data, then the blobs last (S3).
          const xhr = native as XMLHttpRequest;
          if (xhr) for (const x of files) x.xhr = xhr;
          const p = o.params;
          if (fd) {
            const sid = (x: AnyDropFile) => (this.batchOf.get(x) as Batch).sessionId;
            const fields = uploadFields(files, sid, job.size, o.uploadMultiple, chunk || undefined);
            appendFields(
              fd,
              Object.assign(fields, typeof p === 'function' ? p.call(this, files, xhr, chunk) : p),
            );
          }
          for (const x of files) this.emit('sending', x, xhr, fd || undefined);
          if (o.uploadMultiple) this.emit('sendingmultiple', files, xhr, fd || undefined);
          if (fd) {
            this._addFormElementData(fd);
            for (const b of blocks) fd.append(b.name, b.data, b.filename);
          }
        },
      };
    });
    req.h = h;
    if (job.dead) return this.abort(h);
    h.onProgress = (loaded, total) => {
      const l = this.live.get(h);
      if (l) {
        l.at = Date.now();
        if (total > 0 && loaded >= total) l.body = true;
      }
      if (job.busy.get(index) !== req) return;
      req.loaded = total > 0 ? Math.min(1, loaded / total) : 0;
      this.progress(job);
    };
    void h.promise.then((res) => this.uploaded(job, index, req, res));
  }

  private uploaded(job: Job, index: number, req: Req, res: TransportResponse): void {
    if (job.dead || job.busy.get(index) !== req) return;
    job.busy.delete(index);
    const fail = this.classify(res);
    if (fail) return void this.failed(job, index, fail, res);
    job.response = res.body;
    const f = job.files[0] as AnyDropFile;
    if (!f.upload.chunked) return this.succeed(job);
    f.upload.chunksDone.add(index);
    job.tries.delete(index);
    job.doneBytes += chunkAt(f, index, job.size, 0).end - index * job.size;
    this.progress(job);
    // Recorded only after the 2xx.
    this.persist(f, false);
    if (nextChunk(f, job.busy) < 0 && !job.busy.size) void this.finishChunks(job);
    else this.next();
  }

  /** `classify`, plus requests that threw while being built. */
  private classify(res: TransportResponse): Failure | null {
    return this.setupFailed.has(res)
      ? { code: 'REQUEST_SETUP_FAILED', retry: false, mismatch: false }
      : classify(res);
  }

  /** A failed upload POST: pause, unreadable file, chunk mismatch, retry with backoff, or error. */
  private async failed(job: Job, index: number, fail: Failure, res: TransportResponse) {
    const o = this.options;
    const f = job.files[0] as AnyDropFile;
    // The chunk holds its place in the file (sequential chunks stay sequential) but frees its request slot.
    const wait: Req = { loaded: 0, wait: true };
    job.busy.set(index, wait);
    await this.grace(fail);
    if (job.dead || job.busy.get(index) !== wait) return;
    // Offline, or hidden (iOS suspension): a pause that uses no retry and makes no entry.
    const why = this.netPause(fail, f);
    if (why) {
      job.busy.delete(index);
      return this.sysPause(why, why === 'unreachable' ? undefined : 'abort');
    }
    const n = (job.tries.get(index) || 0) + 1;
    job.tries.set(index, n);
    this.progress(job);
    this.next();
    // A paused job gave up its slot: the chunk is sent again on resume.
    if (job.dead) return;
    if (fail.code === 'NETWORK') {
      const gone = await Promise.all(job.files.map((x) => unreadable(this.blobs.get(x) || x)));
      if (job.dead) return;
      const bad = job.files.filter((_, i) => gone[i]);
      if (bad.length) {
        // uploadMultiple: only the unreadable files are UNREADABLE.
        this.endJob(job);
        const rest = job.files.filter((x) => bad.indexOf(x) < 0);
        this.failFiles(bad, {
          code: 'UNREADABLE',
          message: o.dictFileUnreadable,
          stage: 'upload',
          attempt: n,
          chunkIndex: index,
        });
        if (rest.length) this.failFiles(rest, this.failInfo(fail, res, 'upload', n));
        return;
      }
    }
    const chunked = f.upload.chunked;
    if (chunked && fail.mismatch && o.chunkStatusUrl && job.mismatches++ < 3) {
      job.busy.delete(index);
      return this.refreshStatus(job);
    }
    // A whole-file upload is never retried automatically.
    if (chunked && fail.retry && o.retryChunks && n <= o.retryChunksLimit) {
      return this.later(
        () => {
          if (job.busy.get(index) !== wait) return;
          job.busy.delete(index);
          this.next();
        },
        fail.wait != null ? fail.wait : backoff(n, this.random),
      );
    }
    this.failJob(job, this.failInfo(fail, res, 'upload', n, chunked ? index : undefined));
  }

  /** All chunks acknowledged: `chunksUploaded` (replaces finalize), finalize, or done. */
  private async finishChunks(job: Job): Promise<void> {
    job.finishing = true;
    const o = this.options;
    const f = job.files[0] as AnyDropFile;
    const hook = o.chunksUploaded;
    if (typeof hook === 'function') {
      // 0011: `this` = options, the instance is the third argument, the first call wins, and only
      // an Error or a non-empty string fails the file. Not retried automatically (user code).
      let called = false;
      const done = (error?: unknown): void => {
        if (called || job.dead) return;
        called = true;
        if (!(error instanceof Error || (typeof error === 'string' && error)))
          return this.succeed(job);
        this.failJob(job, {
          code: 'FINALIZE_FAILED',
          message: messageOf(error),
          stage: 'finalize',
          attempt: 1,
        });
      };
      try {
        hook.call(o, f, done, this);
      } catch (error) {
        reportError(error);
        done(error instanceof Error ? error : Error(String(error)));
      }
      return;
    }
    if (!o.finalizeUrl) return this.succeed(job);
    const body = {
      uploadId: f.upload.uuid,
      relativePath: sentRelativePath(f),
      totalSize: f.upload.total,
      totalChunks: f.upload.totalChunkCount,
    };
    const [res, fail, n] = await this.call(job, 'POST', o.finalizeUrl, JSON.stringify(body));
    if (job.dead) return;
    if (!fail) {
      job.response = res.body;
      return this.succeed(job);
    }
    if (fail.mismatch && o.chunkStatusUrl && job.mismatches++ < 3) return this.refreshStatus(job);
    this.failJob(job, this.failInfo(fail, res, 'finalize', n));
  }

  /**
   * Asks `chunkStatusUrl` what the server has; it wins. One at a time per job, and the job's
   * requests in flight are aborted first, so nothing under the old state lands afterwards. `404`
   * restarts with a new uploadId (announced in a resent manifest first); `complete: true`
   * skips a file finished in an earlier session, and a record the server does not confirm as
   * complete starts fresh the same way (its old chunk layout is unknown).
   */
  private async refreshStatus(job: Job): Promise<void> {
    if (job.st) return;
    job.st = job.finishing = true;
    job.busy.forEach((r) => r.h && this.abort(r.h));
    job.busy.clear();
    const url = this.options.chunkStatusUrl as string;
    const f = job.files[0] as AnyDropFile;
    const u = f.upload;
    const [res, fail, n] = await this.call(job, 'GET', statusUrl(url, u.uuid), null);
    job.st = false;
    if (job.dead) return;
    const body = (res.body || {}) as { received?: unknown; complete?: unknown };
    const skipping = this.toSkip.has(f);
    if (res.status === 404 || (!fail && skipping && body.complete !== true)) {
      this.renew(f);
    } else if (fail) {
      return this.failJob(job, this.failInfo(fail, res, 'status', n));
    } else if (body.complete === true && skipping) {
      this.endJob(job);
      this.skip(f);
      return this.next();
    } else if (u.chunked) {
      u.chunksDone = new Set(validIndexes(body.received, u.totalChunkCount));
      u.resumed = true;
    }
    this.toSkip.delete(f);
    job.doneBytes = doneBytes(f, job.size);
    this.progress(job);
    // A new uploadId is announced before any chunk is sent under it.
    if (!(await this.announce(job))) return;
    job.finishing = false;
    if (u.chunked && nextChunk(f, job.busy) < 0) void this.finishChunks(job);
    else this.next();
  }

  /** Posts the batch's manifest with every file's current uploadId, retried like a chunk. */
  private postManifest(b: Batch): Promise<Called> {
    const files = b.files.filter(
      (f) => f.accepted && f.status !== CANCELED && !f.upload.skipped && this.tree.has(f),
    );
    const folders: string[] = [];
    const roots: string[] = [];
    b.folders.forEach((n) => {
      if (this.tree.getFolder(n.path) !== n) return;
      folders.push(n.path);
      if (n.depth === 1) roots.push(n.name);
    });
    const manifest = {
      sessionId: b.sessionId,
      roots,
      folders: folders.sort(),
      files: files.map((f) => ({
        uploadId: f.upload.uuid,
        relativePath: sentRelativePath(f),
        size: f.size,
        lastModified: f.lastModified,
        type: f.type,
      })),
    };
    return this.call(null, 'POST', this.options.manifestUrl as string, JSON.stringify(manifest));
  }

  /** Sends the batch's manifest: retried like a chunk; on failure the batch's files fail. */
  private async sendManifest(b: Batch): Promise<void> {
    b.manifestState = 'sending';
    this.manifestsInFlight++;
    const [res, fail, n] = await this.postManifest(b);
    this.manifestsInFlight--;
    if (this.destroyed) return;
    b.manifestState = fail ? 'failed' : 'sent';
    if (!fail) b.files.forEach((f) => this.stale.delete(f)); // every current id is announced
    if (fail) {
      this.failedBatches.add(b);
      const info = this.failInfo(fail, res, 'manifest', n);
      // Files with a job keep running (a resend after a new uploadId can fail while others upload).
      const pending = b.files.filter(
        (f) => f.accepted && !isTerminal(f.status) && this.tree.has(f) && !this.jobOf(f),
      );
      if (pending.length) this.failFiles(pending, info);
      this.foldersComplete(this.settleEmpty(b, ERROR, this.entry(null, info)));
    } else {
      this.foldersComplete(this.settleEmpty(b, SUCCESS));
    }
    // Continue the processQueue() / processFiles() calls that waited for this manifest.
    this.startForced();
    if (b.processRequested || this.options.autoProcessQueue) {
      b.processRequested = false;
      this.startFiles();
    }
    this.fill();
    this.checkQueueComplete();
  }

  /**
   * A file gets a new uploadId (a `404` from chunk status, a changed transform, a record the server
   * does not confirm): its record is rewritten, and a manifest already sent no longer lists it.
   */
  private renew(f: AnyDropFile): void {
    const u = f.upload;
    this.unpersist(f);
    u.uuid = this.uuid();
    u.chunksDone = new Set();
    this.stale.add(f);
    this.persist(f, false);
  }

  /**
   * Before the job's files send anything under a new uploadId, the server must have it: the
   * batch manifest is sent again when it already got one. True when the job may go on; otherwise the
   * job's files failed with `stage: 'manifest'` (`retryFailedOnly` announces again first).
   */
  private async announce(job: Job): Promise<boolean> {
    const stale = job.files.filter((x) => this.stale.has(x));
    if (!stale.length) return true;
    const out = await Promise.all(
      Array.from(new Set(stale.map((x) => this.batchOf.get(x) as Batch)), (b) => this.resend(b)),
    );
    const bad = out.find((e) => e);
    if (!bad) stale.forEach((x) => this.stale.delete(x));
    if (job.dead) return false;
    if (bad) this.failJob(job, bad);
    return !bad;
  }

  /**
   * Sends a batch's manifest again, once its first send got a 2xx (before that it carries current
   * ids; without `sendManifest` there is none). Callers in the same tick share one request; one that
   * comes while a resend is in flight waits for it and gets one more. Resolves to the failure, if any.
   */
  private resend(b: Batch): Promise<FailInfo | null> {
    if (b.manifestState !== 'sent' || !this.manifestDue()) return Promise.resolve(null);
    let r = this.resends.get(b);
    if (!r) this.resends.set(b, (r = {}));
    const state = r;
    return (state.next ||= (async () => {
      await state.cur;
      await new Promise<void>((resolve) => this.later(resolve));
      state.next = undefined;
      const run = this.postManifest(b).then(([res, fail, n]) =>
        fail ? this.failInfo(fail, res, 'manifest', n) : null,
      );
      state.cur = run;
      return run;
    })());
  }

  /** A JSON request (manifest, finalize, chunk status), retried with backoff. */
  private async call(
    job: Job | null,
    method: string,
    url: string,
    body: string | null,
  ): Promise<Called> {
    const o = this.options;
    for (let n = 1; ; n++) {
      const h = this.send(() => ({
        method,
        url,
        body,
        headers: headersFor(o, body ? { 'Content-Type': 'application/json' } : undefined),
        timeout: this.resolveOption(o.timeout, job ? job.files : []),
        withCredentials: !!o.withCredentials,
      }));
      if (job) job.aux = h;
      const res = await h.promise;
      const fail = this.classify(res);
      await this.grace(fail);
      const why = this.netPause(fail, job ? job.files[0] : undefined);
      if (why && !(job && job.dead) && !this.destroyed) {
        // Offline or hidden: pause instead of using up retries. A job's request ends with
        // its job; a manifest waits until the instance runs again, then is sent again.
        this.sysPause(why, why === 'unreachable' ? undefined : 'abort');
        if (job) {
          if (!job.dead) this.stopJob(job);
          return [res, fail, n];
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        n--;
        continue;
      }
      if (!fail || !fail.retry || !o.retryChunks || n > o.retryChunksLimit || (job && job.dead)) {
        return [res, fail, n];
      }
      const ms = fail.wait != null ? fail.wait : backoff(n, this.random);
      await new Promise<void>((resolve) => this.later(resolve, ms));
      if (job && job.dead) return [res, fail, n];
    }
  }

  /**
   * Hands a request to the transport. Never throws: anything thrown while the request is built or
   * sent (user `url`/`method`/`timeout`/`params`/`paramName`, `xhr.open`, `setRequestHeader`, a
   * custom transport) is reported and fails it with `REQUEST_SETUP_FAILED`, not retried.
   */
  private send(build: () => TransportRequest): TransportHandle {
    let h: TransportHandle;
    let body = true;
    try {
      const req = build();
      // A Blob or FormData body is being sent until its last progress event.
      body = !req.body || typeof req.body === 'string';
      h = (this.options.transport || xhrTransport).send(req);
    } catch (error) {
      reportError(error);
      const res: TransportResponse = { status: 0, body: messageOf(error), header: () => null };
      this.setupFailed.add(res);
      h = { abort() {}, promise: Promise.resolve(res) };
    }
    const handle = h;
    this.handles.add(handle);
    this.live.set(handle, { at: Date.now(), body });
    if (this.options.stallTimeout && !this.wd) this.tick();
    void handle.promise.then((r) => {
      this.handles.delete(handle);
      this.live.delete(handle);
      if (!this.live.size) {
        this.unlater(this.wd);
        this.wd = undefined;
      }
      // Only aborts core starts itself are ABORTED; any other abort is a network failure.
      // A stall abort is STALLED. Any other answer is a response: the server is reachable.
      if (r.error === 'abort') {
        if (this.stalled.has(handle)) r.error = 'stalled';
        else if (!this.own.has(handle)) r.error = 'network';
      } else if (!r.error && r.status) this.reachable();
    });
    return handle;
  }

  private abort(h: TransportHandle): void {
    this.own.add(h);
    h.abort();
  }

  /** Recomputes the bytes sent of the job's files from acknowledged and in-flight requests. */
  private progress(job: Job): void {
    const f = job.files[0] as AnyDropFile;
    if (f.upload.chunked) {
      let n = job.doneBytes;
      job.busy.forEach((r, i) => (n += r.loaded * (chunkAt(f, i, job.size, 0).end - i * job.size)));
      this.setSent(f, n);
    } else {
      const r = job.busy.get(0);
      for (const x of job.files) this.setSent(x, (r ? r.loaded : 0) * x.upload.total);
    }
  }

  /** Sets `upload.bytesSent`/`progress` and emits `uploadprogress`, `totaluploadprogress`, `folderprogress`. */
  private setSent(file: AnyDropFile, bytes: number, done = false): void {
    const u = file.upload;
    const progress = done ? 100 : u.total ? (bytes / u.total) * 100 : 0;
    if (bytes === u.bytesSent && progress === u.progress) return;
    if (isActive(file.status)) this.activeSent += bytes - u.bytesSent;
    u.bytesSent = bytes;
    u.progress = progress;
    this.tree.update(file);
    this.emit('uploadprogress', file, progress, bytes);
    this.emitTotal();
    if (this.hasListeners('folderprogress')) {
      for (let p = file.folder as FolderNodeImpl; p.parent; p = p.parent) {
        this.folderThrottle.request(p, p.progress >= 100);
      }
    }
  }

  private emitTotal(): void {
    const t = this.activeTotal;
    this.emit('totaluploadprogress', t ? (100 * this.activeSent) / t : 100, t, this.activeSent);
  }

  /** Ends a job: frees its file slot and aborts whatever it still has in flight. */
  private endJob(job: Job): void {
    job.dead = true;
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    job.busy.forEach((r) => r.h && this.abort(r.h));
    job.busy.clear();
    if (job.aux) this.abort(job.aux);
  }

  /** Pause with `abort`: aborted chunks are not done; the slot is freed; unpaused files requeue. */
  private stopJob(job: Job): void {
    this.endJob(job);
    this.progress(job);
    for (const x of job.files) if (x.status === UPLOADING) this.setStatus(x, QUEUED);
  }

  private succeed(job: Job): void {
    this.endJob(job);
    const files = job.files;
    for (const x of files) {
      this.setSent(x, x.upload.total, true);
      this.setStatus(x, SUCCESS);
      this.persist(x, true);
      this.emit('success', x, job.response, null);
      this.completed(x);
    }
    if (this.options.uploadMultiple) {
      this.emit('successmultiple', files, job.response, null);
      this.emit('completemultiple', files);
    }
    this.next();
  }

  private failJob(job: Job, info: FailInfo): void {
    this.endJob(job);
    this.failFiles(job.files, info);
  }

  private failInfo(
    fail: Failure,
    res: TransportResponse,
    stage: ErrorEntry['stage'],
    attempt: number,
    chunkIndex?: number,
  ): FailInfo {
    const o = this.options;
    const b = res.body;
    // Dropzone: the response body, else a timeout or status message.
    const message =
      b != null && b !== ''
        ? b
        : res.error === 'timeout'
          ? `Request timedout after ${(Number(this.resolveOption(o.timeout, [])) || 0) / 1000} seconds`
          : o.dictResponseError.replace('{{statusCode}}', String(res.status));
    return { code: fail.code, message, stage, attempt, res, chunkIndex };
  }

  private entry(file: AnyDropFile | null, info: FailInfo): ErrorEntry {
    return {
      fileId: file && file.id,
      relativePath: file ? file.relativePath : '',
      uploadId: file && file.upload.uuid,
      code: info.code,
      message: messageOf(info.message),
      httpStatus: (info.res && info.res.status) || undefined,
      stage: info.stage,
      chunkIndex: info.chunkIndex,
      attempt: info.attempt,
      retryable: true,
      at: Date.now(),
    };
  }

  /** Files go to `error`: one error entry each, then `error` and `complete` (Dropzone's `_errorProcessing`). */
  private failFiles(files: AnyDropFile[], info: FailInfo): void {
    const xhr = info.res && info.res.xhr;
    for (const x of files) {
      this.setStatus(x, ERROR);
      this.errors.set(this.entry(x, info));
      this.emit('error', x, info.message, xhr);
      this.completed(x);
    }
    if (this.options.uploadMultiple) {
      this.emit('errormultiple', files, info.message, xhr);
      this.emit('completemultiple', files);
    }
    this.next();
  }

  private later(fn: () => void, ms = 0): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private unlater(t: ReturnType<typeof setTimeout> | undefined): void {
    clearTimeout(t);
    if (t) this.timers.delete(t);
  }
}

/** `chunkStatusUrl` with the `uploadId` query. */
function statusUrl(url: string, uploadId: string): string {
  return url + (url.indexOf('?') < 0 ? '?' : '&') + 'uploadId=' + encodeURIComponent(uploadId);
}

/** The integers of `list` that are chunk indexes below `count` (a stored record or a server answer). */
function validIndexes(list: unknown, count: number): number[] {
  return (Array.isArray(list) ? list : []).filter(
    (i): i is number => Number.isInteger(i) && i >= 0 && i < count,
  );
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Yields a list in slices, letting the browser breathe between slices. */
async function* slices(items: SourceItem[]): AsyncGenerator<SourceItem[], void, undefined> {
  for (let i = 0; i < items.length; i += INPUT_SLICE) {
    if (i) await yieldToMain();
    yield items.slice(i, i + INPUT_SLICE);
  }
}
