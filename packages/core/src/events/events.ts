// The one typed map of every event AnyDrop emits. Events marked (ui) are typed here so
// wrappers get one map, and are emitted by @vedratech/anydrop-ui.
import type { AnyDropFile, ErrorEntry, FolderNode, PauseTarget } from '../types';

/** Every event with its arguments. Events marked (ui) are emitted by `@vedratech/anydrop-ui`. */
export interface AnyDropEvents {
  // Input (drag events are emitted by @vedratech/anydrop-ui)
  /** A drop was handled with `drop(event)`. */
  drop: [event: DragEvent];
  /** (ui) A drag started over the element. */
  dragstart: [event: DragEvent];
  /** (ui) A drag ended. */
  dragend: [event: DragEvent];
  /** (ui) A drag entered the element. */
  dragenter: [event: DragEvent];
  /** (ui) A drag is over the element. */
  dragover: [event: DragEvent];
  /** (ui) A drag left the element. */
  dragleave: [event: DragEvent];
  /** A paste was handled with `paste(event)`. */
  paste: [event: ClipboardEvent];
  /** A dropped directory with no entries at all. Path without leading slash. */
  emptyfolder: [path: string];
  // Files
  /** A file was added; validation may still be running. */
  addedfile: [file: AnyDropFile];
  /** Once per batch, after the walk and validation, with every file of the batch. */
  addedfiles: [files: AnyDropFile[]];
  /** A file was removed with `removeFile()` or `removeAllFiles()`. */
  removedfile: [file: AnyDropFile];
  /** The last file was removed. */
  reset: [];
  /** (ui) */
  thumbnail: [file: AnyDropFile, dataUrl: string];
  /** `message` is the rejection message, the parsed JSON error body, or a string. */
  error: [file: AnyDropFile, message: unknown, xhr?: XMLHttpRequest];
  /** Only with `uploadMultiple`: once per failed request. */
  errormultiple: [files: AnyDropFile[], message: unknown, xhr?: XMLHttpRequest];
  /** A file was rejected because of `maxFiles`. */
  maxfilesexceeded: [file: AnyDropFile];
  /** The number of accepted files reached `maxFiles`. */
  maxfilesreached: [files: AnyDropFile[]];
  // Upload
  /** A file started uploading. */
  processing: [file: AnyDropFile];
  /** Only with `uploadMultiple`: a request with these files started. */
  processingmultiple: [files: AnyDropFile[]];
  /** Upload progress of one file (0 to 100) and the bytes sent. */
  uploadprogress: [file: AnyDropFile, progress: number, bytesSent: number];
  /** Overall progress (0 to 100) over the files that are queued, uploading or paused. */
  totaluploadprogress: [progress: number, totalBytes: number, totalBytesSent: number];
  /** `formData` is absent with `binaryBody`. `xhr` is the native request of the transport (an XMLHttpRequest for the built-in one). */
  sending: [file: AnyDropFile, xhr: XMLHttpRequest, formData?: FormData];
  /** Only with `uploadMultiple`: before a request body is sent. */
  sendingmultiple: [files: AnyDropFile[], xhr: XMLHttpRequest, formData?: FormData];
  /** `response`: the finalize response when one was sent, else the last upload response. */
  success: [file: AnyDropFile, response: unknown, e?: ProgressEvent | null];
  /** Only with `uploadMultiple`: once per successful request. */
  successmultiple: [files: AnyDropFile[], response: unknown, e?: ProgressEvent | null];
  /** A file was canceled with `cancelUpload()`; no `error` follows. */
  canceled: [file: AnyDropFile];
  /** Only with `uploadMultiple`: the files of a canceled request. */
  canceledmultiple: [files: AnyDropFile[]];
  /** A file is finished: uploaded, failed, rejected or canceled. */
  complete: [file: AnyDropFile];
  /** Only with `uploadMultiple`: once per finished request. */
  completemultiple: [files: AnyDropFile[]];
  /** Nothing is left to do: no file is added, queued, uploading or paused. */
  queuecomplete: [];
  // New in AnyDrop
  /** Once per new folder node, parent before children, before the folder's first `addedfile`. */
  addedfolder: [folder: FolderNode];
  /** A folder node was pruned from the tree, deepest first, after the causing removedfile. */
  removedfolder: [folder: FolderNode];
  /** Throttled per folder to one event per 100 ms, always sent at 100. */
  folderprogress: [folder: FolderNode, progress: number, bytesSent: number];
  /** When every descendant file is terminal, innermost folder first. Can fire again. */
  foldercomplete: [folder: FolderNode];
  /** Once per pause call or automatic pause. */
  paused: [target: PauseTarget];
  /** Once per resume call or automatic resume. */
  resumed: [target: PauseTarget];
  /** The browser `offline` event (after the first `processQueue`). */
  offline: [];
  /** The browser `online` event. */
  online: [];
  /** Before each wait while the connection is lost (`unreachable`): attempt number and delay in ms. */
  reconnecting: [attempt: number, delayMs: number];
  /** A copy of the full error list, merged to at most once per microtask. */
  errorlistchanged: [errors: ErrorEntry[]];
  /**
   * (ui) A row action was triggered, by button or keyboard shortcut, built-in (`pause`, `resume`,
   * `retry`, `cancel`, `remove`) or custom. Emitted before the action runs and not cancellable.
   * `action` is the action id; `target` is the file (also a `displayExistingFile()` mock) or the
   * folder of the row. Core only declares it, so `on('actionclicked', ...)` is typed.
   */
  actionclicked: [action: string, target: AnyDropFile | FolderNode];
}

export type AnyDropEventName = keyof AnyDropEvents;

/** Every event name. `events.test.ts` checks that the list matches the `AnyDropEvents` map. */
export const EVENT_NAMES =
  'drop dragstart dragend dragenter dragover dragleave paste emptyfolder addedfile addedfiles removedfile reset thumbnail error errormultiple maxfilesexceeded maxfilesreached processing processingmultiple uploadprogress totaluploadprogress sending sendingmultiple success successmultiple canceled canceledmultiple complete completemultiple queuecomplete addedfolder removedfolder folderprogress foldercomplete paused resumed offline online reconnecting errorlistchanged actionclicked'.split(
    ' ',
  ) as AnyDropEventName[];

export function isEventName(name: unknown): name is AnyDropEventName {
  return EVENT_NAMES.indexOf(name as AnyDropEventName) >= 0;
}

/** Event handlers that can be passed as options, (`{ success(file, res) {} }`). */
export type AnyDropEventHandlers<Self = unknown> = {
  [K in AnyDropEventName]?: ((this: Self, ...args: AnyDropEvents[K]) => void) | null;
};
