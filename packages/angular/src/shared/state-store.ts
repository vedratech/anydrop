// GENERATED from wrappers-shared/state-store.ts by scripts/sync-wrapper-shared.mjs. Do not edit.
// Observable state of one instance for the headless wrappers (decision 0022, section 4.4).
// Framework-free: it imports only types from @vedratech/anydrop-core.
import type {
  AnyDropCore,
  AnyDropEventName,
  AnyDropFile,
  ConnectionState,
  ErrorEntry,
  FolderNode,
} from '@vedratech/anydrop-core';

/** Overall progress, as in `totaluploadprogress`. */
export interface AnyDropProgress {
  progress: number;
  totalBytes: number;
  totalBytesSent: number;
}

/** What `useAnyDrop()` and `AnyDropService` expose. A new object is built at most once per frame. */
export interface AnyDropState {
  files: readonly AnyDropFile[];
  /** The live root of the folder tree (its identity does not change). */
  tree: FolderNode | null;
  errors: readonly ErrorEntry[];
  progress: AnyDropProgress;
  connection: ConnectionState;
}

/** The state on the server and before the instance exists. */
export const SERVER_STATE: AnyDropState = {
  files: [],
  tree: null,
  errors: [],
  progress: { progress: 0, totalBytes: 0, totalBytesSent: 0 },
  connection: { state: 'online', attempt: 0, retryAt: null },
};

export interface AnyDropStateStore {
  getSnapshot(): AnyDropState;
  subscribe(listener: () => void): () => void;
  destroy(): void;
}

const WATCHED: AnyDropEventName[] = [
  'addedfile',
  'addedfiles',
  'removedfile',
  'reset',
  'processing',
  'uploadprogress',
  'totaluploadprogress',
  'success',
  'error',
  'canceled',
  'complete',
  'paused',
  'resumed',
  'addedfolder',
  'removedfolder',
  'folderprogress',
  'foldercomplete',
  'errorlistchanged',
  'offline',
  'online',
  'reconnecting',
  'queuecomplete',
];

export function createStateStore(instance: AnyDropCore): AnyDropStateStore {
  let errors: readonly ErrorEntry[] = instance.getErrors();
  let progress: AnyDropProgress = { progress: 0, totalBytes: 0, totalBytesSent: 0 };
  const listeners: Array<() => void> = [];
  let frame: { cancel(): void } | null = null;
  let dead = false;

  const build = (): AnyDropState => ({
    files: instance.files.slice(),
    tree: instance.getTree(),
    errors,
    progress,
    connection: instance.getConnectionState(),
  });
  let snapshot = build();

  const schedule = () => {
    if (dead || frame) return;
    const run = () => {
      frame = null;
      if (dead) return;
      snapshot = build();
      for (const l of listeners.slice()) l();
    };
    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(run);
      frame = { cancel: () => cancelAnimationFrame(id) };
    } else {
      const id = setTimeout(run, 16);
      frame = { cancel: () => clearTimeout(id) };
    }
  };

  const offs = WATCHED.map((name) =>
    (instance.on as (n: string, fn: (...a: unknown[]) => void) => () => void)(
      name,
      (...args: unknown[]) => {
        if (name === 'errorlistchanged') errors = args[0] as ErrorEntry[];
        else if (name === 'totaluploadprogress') {
          progress = {
            progress: args[0] as number,
            totalBytes: args[1] as number,
            totalBytesSent: args[2] as number,
          };
        }
        schedule();
      },
    ),
  );

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    destroy() {
      dead = true;
      if (frame) frame.cancel();
      frame = null;
      for (const off of offs) off();
      listeners.length = 0;
    },
  };
}
