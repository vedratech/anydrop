// Public API of @vedratech/anydrop-core. Nothing here may touch `window` or `document` at import time.
export { VERSION } from './version';
export { AnyDropCore, type AnyDropOptions } from './AnyDropCore';
export {
  ADDED,
  QUEUED,
  ACCEPTED,
  UPLOADING,
  PROCESSING,
  PAUSED,
  SUCCESS,
  ERROR,
  CANCELED,
} from './constants';
export { defaultOptions, type AnyDropCoreOptions, type AnyDropCoreConfig } from './options';
export { isValidFile } from './validate/dropzone-port';
export { uuidv4 } from './util/uuid';
export { xhrTransport } from './transport/xhr';
export type {
  Transport,
  TransportHandle,
  TransportRequest,
  TransportResponse,
} from './transport/types';
export type { AnyDropEvents, AnyDropEventName, AnyDropEventHandlers } from './events/events';
export type { Listener, Unsubscribe } from './events/emitter';
export type {
  AcceptDone,
  AnyDropFile,
  AnyDropUploadState,
  ChunkInfo,
  ConnectionState,
  DataBlock,
  ErrorCode,
  ErrorEntry,
  FileStatus,
  FolderCounts,
  FolderNode,
  KnownErrorCode,
  PauseReason,
  PauseTarget,
} from './types';
export type { DataTransferLike, EntryLike } from './source/types';
