// The one typed map of every event AnyDrop emits (0006). Dropzone events keep Dropzone's
// arguments; the new events follow decision 0006. Events marked (ui) are typed here so
// wrappers get one map, and are emitted by @vedratech/anydrop-ui.
import type { AnyDropFile, ErrorEntry, FolderNode, PauseTarget } from '../types';

export interface AnyDropEvents {
  // Dropzone: input (drag events are emitted by @vedratech/anydrop-ui)
  drop: [event: DragEvent];
  dragstart: [event: DragEvent];
  dragend: [event: DragEvent];
  dragenter: [event: DragEvent];
  dragover: [event: DragEvent];
  dragleave: [event: DragEvent];
  paste: [event: ClipboardEvent];
  /** Dropzone 6.3: a dropped directory with no entries at all. Path without leading slash. */
  emptyfolder: [path: string];
  // Dropzone: files
  addedfile: [file: AnyDropFile];
  /** Once per batch, after the walk and validation, with every file of the batch (0003, 0006). */
  addedfiles: [files: AnyDropFile[]];
  removedfile: [file: AnyDropFile];
  reset: [];
  /** (ui) */
  thumbnail: [file: AnyDropFile, dataUrl: string];
  /** `message` is the rejection message, the parsed JSON error body, or a string. */
  error: [file: AnyDropFile, message: unknown, xhr?: XMLHttpRequest];
  errormultiple: [files: AnyDropFile[], message: unknown, xhr?: XMLHttpRequest];
  maxfilesexceeded: [file: AnyDropFile];
  maxfilesreached: [files: AnyDropFile[]];
  // Dropzone: upload
  processing: [file: AnyDropFile];
  processingmultiple: [files: AnyDropFile[]];
  uploadprogress: [file: AnyDropFile, progress: number, bytesSent: number];
  totaluploadprogress: [progress: number, totalBytes: number, totalBytesSent: number];
  /** `formData` is absent with `binaryBody`. `xhr` is the native request of the transport (an XMLHttpRequest for the built-in one). */
  sending: [file: AnyDropFile, xhr: XMLHttpRequest, formData?: FormData];
  sendingmultiple: [files: AnyDropFile[], xhr: XMLHttpRequest, formData?: FormData];
  /** `response`: the finalize response when one was sent, else the last upload response (0003). */
  success: [file: AnyDropFile, response: unknown, e?: ProgressEvent | null];
  successmultiple: [files: AnyDropFile[], response: unknown, e?: ProgressEvent | null];
  canceled: [file: AnyDropFile];
  canceledmultiple: [files: AnyDropFile[]];
  complete: [file: AnyDropFile];
  completemultiple: [files: AnyDropFile[]];
  queuecomplete: [];
  // New in AnyDrop (0006)
  /** Once per new folder node, parent before children, before the folder's first `addedfile`. */
  addedfolder: [folder: FolderNode];
  /** A folder node was pruned from the tree, deepest first, after the causing removedfile (0012). */
  removedfolder: [folder: FolderNode];
  /** Throttled per folder to one event per 100 ms, always sent at 100. */
  folderprogress: [folder: FolderNode, progress: number, bytesSent: number];
  /** When every descendant file is terminal, innermost folder first. Can fire again. */
  foldercomplete: [folder: FolderNode];
  /** Once per pause call or automatic pause (0006, 0008). */
  paused: [target: PauseTarget];
  /** Once per resume call or automatic resume. */
  resumed: [target: PauseTarget];
  /** The browser `offline` event (after the first `processQueue`). */
  offline: [];
  /** The browser `online` event. */
  online: [];
  /** Before each wait while the connection is lost (`unreachable`): attempt number and delay in ms (0017). */
  reconnecting: [attempt: number, delayMs: number];
  /** A copy of the full error list, merged to at most once per microtask. */
  errorlistchanged: [errors: ErrorEntry[]];
}

export type AnyDropEventName = keyof AnyDropEvents;

/** Every event name. `events.test.ts` checks that the list matches the `AnyDropEvents` map. */
export const EVENT_NAMES =
  'drop dragstart dragend dragenter dragover dragleave paste emptyfolder addedfile addedfiles removedfile reset thumbnail error errormultiple maxfilesexceeded maxfilesreached processing processingmultiple uploadprogress totaluploadprogress sending sendingmultiple success successmultiple canceled canceledmultiple complete completemultiple queuecomplete addedfolder removedfolder folderprogress foldercomplete paused resumed offline online reconnecting errorlistchanged'.split(
    ' ',
  ) as AnyDropEventName[];

export function isEventName(name: unknown): name is AnyDropEventName {
  return EVENT_NAMES.indexOf(name as AnyDropEventName) >= 0;
}

/** Event handlers that can be passed as options, as in Dropzone (`{ success(file, res) {} }`). */
export type AnyDropEventHandlers<Self = unknown> = {
  [K in AnyDropEventName]?: ((this: Self, ...args: AnyDropEvents[K]) => void) | null;
};
