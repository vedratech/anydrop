// The one table of AnyDrop events for the framework wrappers (decision 0022, section 1).
// Framework-free: it imports only types from @vedratech/anydrop-core.
import type {
  AnyDropEventName,
  AnyDropEvents,
  AnyDropFile,
  ErrorEntry,
  FolderNode,
  PauseTarget,
} from '@vedratech/anydrop-core';

/**
 * What a wrapper hands to a handler per event: no argument = `void`, one argument = the value,
 * several arguments = a new plain object per emit keyed by the argument names.
 */
export interface AnyDropEventPayloads {
  drop: DragEvent;
  dragstart: DragEvent;
  dragend: DragEvent;
  dragenter: DragEvent;
  dragover: DragEvent;
  dragleave: DragEvent;
  paste: ClipboardEvent;
  emptyfolder: string;
  addedfile: AnyDropFile;
  addedfiles: AnyDropFile[];
  removedfile: AnyDropFile;
  reset: void;
  thumbnail: { file: AnyDropFile; dataUrl: string };
  error: { file: AnyDropFile; message: unknown; xhr?: XMLHttpRequest };
  errormultiple: { files: AnyDropFile[]; message: unknown; xhr?: XMLHttpRequest };
  maxfilesexceeded: AnyDropFile;
  maxfilesreached: AnyDropFile[];
  processing: AnyDropFile;
  processingmultiple: AnyDropFile[];
  uploadprogress: { file: AnyDropFile; progress: number; bytesSent: number };
  totaluploadprogress: { progress: number; totalBytes: number; totalBytesSent: number };
  sending: { file: AnyDropFile; xhr: XMLHttpRequest; formData?: FormData };
  sendingmultiple: { files: AnyDropFile[]; xhr: XMLHttpRequest; formData?: FormData };
  success: { file: AnyDropFile; response: unknown; progressEvent?: ProgressEvent | null };
  successmultiple: {
    files: AnyDropFile[];
    response: unknown;
    progressEvent?: ProgressEvent | null;
  };
  canceled: AnyDropFile;
  canceledmultiple: AnyDropFile[];
  complete: AnyDropFile;
  completemultiple: AnyDropFile[];
  queuecomplete: void;
  addedfolder: FolderNode;
  removedfolder: FolderNode;
  folderprogress: { folder: FolderNode; progress: number; bytesSent: number };
  foldercomplete: FolderNode;
  paused: PauseTarget;
  resumed: PauseTarget;
  offline: void;
  online: void;
  reconnecting: { attempt: number; delayMs: number };
  errorlistchanged: ErrorEntry[];
  actionclicked: { action: string; target: AnyDropFile | FolderNode };
}

/** The payload type of one event. */
export type AnyDropEventPayload<K extends AnyDropEventName> = AnyDropEventPayloads[K];

/** The argument names of every event, in order (an empty list means no argument). */
export const EVENT_ARGS = {
  drop: ['event'],
  dragstart: ['event'],
  dragend: ['event'],
  dragenter: ['event'],
  dragover: ['event'],
  dragleave: ['event'],
  paste: ['event'],
  emptyfolder: ['path'],
  addedfile: ['file'],
  addedfiles: ['files'],
  removedfile: ['file'],
  reset: [],
  thumbnail: ['file', 'dataUrl'],
  error: ['file', 'message', 'xhr'],
  errormultiple: ['files', 'message', 'xhr'],
  maxfilesexceeded: ['file'],
  maxfilesreached: ['files'],
  processing: ['file'],
  processingmultiple: ['files'],
  uploadprogress: ['file', 'progress', 'bytesSent'],
  totaluploadprogress: ['progress', 'totalBytes', 'totalBytesSent'],
  sending: ['file', 'xhr', 'formData'],
  sendingmultiple: ['files', 'xhr', 'formData'],
  success: ['file', 'response', 'progressEvent'],
  successmultiple: ['files', 'response', 'progressEvent'],
  canceled: ['file'],
  canceledmultiple: ['files'],
  complete: ['file'],
  completemultiple: ['files'],
  queuecomplete: [],
  addedfolder: ['folder'],
  removedfolder: ['folder'],
  folderprogress: ['folder', 'progress', 'bytesSent'],
  foldercomplete: ['folder'],
  paused: ['target'],
  resumed: ['target'],
  offline: [],
  online: [],
  reconnecting: ['attempt', 'delayMs'],
  errorlistchanged: ['errors'],
  actionclicked: ['action', 'target'],
} as const satisfies { readonly [K in AnyDropEventName]: readonly string[] };

/** Every event name. */
export const EVENT_LIST = Object.keys(EVENT_ARGS) as AnyDropEventName[];

/** Events that are also native DOM events: not Angular outputs (decision 0022, section 2.2). */
export const DOM_COLLIDING_EVENTS = [
  'drop',
  'dragstart',
  'dragend',
  'dragenter',
  'dragover',
  'dragleave',
  'paste',
] as const;

/** Turns the arguments of a core event into the payload of the table. */
export function toPayload<K extends AnyDropEventName>(
  name: K,
  args: AnyDropEvents[K],
): AnyDropEventPayloads[K] {
  const names = EVENT_ARGS[name] as readonly string[];
  const list = args as unknown as unknown[];
  if (names.length === 0) return undefined as AnyDropEventPayloads[K];
  if (names.length === 1) return list[0] as AnyDropEventPayloads[K];
  const out: Record<string, unknown> = {};
  for (let i = 0; i < names.length; i++) out[names[i] as string] = list[i];
  return out as AnyDropEventPayloads[K];
}

// ---- compile-time exhaustiveness: a new or changed core event fails the typecheck here ----
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** The number of arguments the payload object must have equals the tuple's maximum length. */
type ArgCountMatches = {
  [K in AnyDropEventName]: Equal<
    (typeof EVENT_ARGS)[K]['length'],
    Required<AnyDropEvents[K]>['length']
  >;
};
/** The payload matches the tuple: the value (1), void (0), or an object of the same element types. */
type PayloadMatches = {
  [K in AnyDropEventName]: Required<AnyDropEvents[K]>['length'] extends 0
    ? Equal<AnyDropEventPayloads[K], void>
    : Required<AnyDropEvents[K]>['length'] extends 1
      ? Equal<AnyDropEventPayloads[K], AnyDropEvents[K][0]>
      : Equal<
          Required<AnyDropEventPayloads[K]>[keyof AnyDropEventPayloads[K]],
          Required<AnyDropEvents[K]>[number]
        >;
};
type AllTrue<T extends Record<string, true>> = T;
export type _ArgCountsMatch = AllTrue<ArgCountMatches>;
export type _PayloadsMatch = AllTrue<PayloadMatches>;
// Keep the helper type used (and the check readable in editors).
export type _Exhaustive = Expect<Equal<keyof AnyDropEventPayloads, AnyDropEventName>>;
