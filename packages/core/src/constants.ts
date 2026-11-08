// File status constants.
import type { FileStatus } from './types';

/** Status `'added'`: accepted but not queued yet. */
export const ADDED = 'added' as const satisfies FileStatus;
/** Status `'queued'`: waiting for an upload slot. */
export const QUEUED = 'queued' as const satisfies FileStatus;
/** Alias of `QUEUED`. */
export const ACCEPTED = QUEUED;
/** Status `'uploading'`. */
export const UPLOADING = 'uploading' as const satisfies FileStatus;
/** Alias of `UPLOADING`. */
export const PROCESSING = UPLOADING;
/** Status `'paused'`. */
export const PAUSED = 'paused' as const satisfies FileStatus;
/** Status `'success'`: uploaded. */
export const SUCCESS = 'success' as const satisfies FileStatus;
/** Status `'error'`: rejected or failed. */
export const ERROR = 'error' as const satisfies FileStatus;
/** Status `'canceled'`. */
export const CANCELED = 'canceled' as const satisfies FileStatus;

/** Statuses after which a file does nothing more until retried. */
export function isTerminal(status: FileStatus): boolean {
  return status === SUCCESS || status === ERROR || status === CANCELED;
}
