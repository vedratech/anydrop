// A batch (0003): everything added by one user action, or by addFile()/addFiles() calls in the
// same tick. Each batch has its own sessionId and at most one manifest.
import type { FolderNodeImpl } from './tree/TreeStore';
import type { AnyDropFile } from './types';

export interface Batch {
  readonly sessionId: string;
  /** Every file added in this batch, accepted and rejected, in add order. */
  readonly files: AnyDropFile[];
  /** Every folder of the batch, ancestors included (manifest `folders`, M2). Root excluded. */
  readonly folders: Set<FolderNodeImpl>;
  /** Folders whose files went terminal while the batch was open (foldercomplete at close). */
  readonly terminalIn: Set<FolderNodeImpl>;
  /** Paths that could not be read during the walk. */
  readonly readErrors: string[];
  /** The walk (or the tick, for programmatic adds) is still running. */
  walking: boolean;
  /** `accept()` callbacks still pending. */
  pending: number;
  /** `addedfiles` has fired (or is about to); files may be queued. */
  closed: boolean;
  manifestState: 'pending' | 'sending' | 'sent' | 'failed';
  /**
   * processQueue() was called while the batch was open (0011), or while its manifest was being
   * sent: run it again when the batch closes or the manifest returns.
   */
  processRequested: boolean;
  /** enqueueFile() / processFile() calls made while the batch was open, applied when it closes (0011, 0012). */
  readonly deferred: { file: AnyDropFile; process: boolean }[];
  readonly promise: Promise<AnyDropFile[]>;
  resolve: (files: AnyDropFile[]) => void;
}

export function createBatch(sessionId: string): Batch {
  let resolve!: (files: AnyDropFile[]) => void;
  const promise = new Promise<AnyDropFile[]>((r) => (resolve = r));
  return {
    sessionId,
    files: [],
    folders: new Set(),
    terminalIn: new Set(),
    readErrors: [],
    walking: true,
    pending: 0,
    closed: false,
    manifestState: 'pending',
    processRequested: false,
    deferred: [],
    promise,
    resolve,
  };
}
