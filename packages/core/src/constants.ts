// File status constants, matching Dropzone's static constants (0002).
import type { FileStatus } from './types';

export const ADDED = 'added' as const satisfies FileStatus;
export const QUEUED = 'queued' as const satisfies FileStatus;
/** Dropzone alias: an accepted file is queued or uploading. */
export const ACCEPTED = QUEUED;
export const UPLOADING = 'uploading' as const satisfies FileStatus;
/** Dropzone alias of `UPLOADING`. */
export const PROCESSING = UPLOADING;
export const PAUSED = 'paused' as const satisfies FileStatus;
export const SUCCESS = 'success' as const satisfies FileStatus;
export const ERROR = 'error' as const satisfies FileStatus;
export const CANCELED = 'canceled' as const satisfies FileStatus;

/** Statuses after which a file does nothing more until retried. */
export function isTerminal(status: FileStatus): boolean {
  return status === SUCCESS || status === ERROR || status === CANCELED;
}
