// Chunk math. Files are only ever read through Blob.slice(), one chunk per request.
// Byte counts use `upload.total`: the size of what is sent (a `transformFile` result can differ
// from `file.size`).
import type { AnyDropCoreOptions } from '../options';
import type { AnyDropFile, ChunkInfo } from '../types';

/**
 * Decides `upload.total`, `upload.chunked` and `upload.totalChunkCount` when the file starts
 * processing (not when it is added), from the blob to send and the current options, like
 * Dropzone's `uploadFiles` (0011). A file whose layout is `fixed` (a chunk was sent, or chunks are
 * restored or acknowledged) keeps it, including `upload.chunkSize`: a later `setOption('chunkSize')`
 * must not move its offsets, because the server may already hold an aborted chunk of the old layout.
 * Returns the file's chunk size in bytes.
 */
export function planChunks(
  file: AnyDropFile,
  bytes: number,
  o: Pick<AnyDropCoreOptions, 'chunking' | 'forceChunking' | 'chunkSize'>,
  fixed: boolean,
): number {
  // `chunkSize` may arrive as a string from markup (Dropzone #1988).
  const size = Number(o.chunkSize);
  const u = file.upload;
  if (!fixed && !u.chunksDone.size) {
    u.chunkSize = size;
    u.total = bytes;
    u.chunked = !!o.chunking && (o.forceChunking || bytes > size);
    // A zero-byte file is still one (empty) chunk, otherwise it would never finish (Dropzone #1982).
    u.totalChunkCount = u.chunked ? Math.max(1, Math.ceil(bytes / size)) : 1;
  }
  return u.chunkSize;
}

/** The chunk at `index`: byte range and retry counter. The blob is cut with `slice()` when sent. */
export function chunkAt(
  file: AnyDropFile,
  index: number,
  size: number,
  retries: number,
): ChunkInfo {
  const start = index * size;
  return { file, index, start, end: Math.min(start + size, file.upload.total), retries };
}

/** First chunk index that is neither acknowledged nor busy, or -1. */
export function nextChunk(file: AnyDropFile, busy: { has(i: number): boolean }): number {
  const u = file.upload;
  for (let i = 0; i < u.totalChunkCount; i++) if (!u.chunksDone.has(i) && !busy.has(i)) return i;
  return -1;
}

/** Bytes of the acknowledged chunks. */
export function doneBytes(file: AnyDropFile, size: number): number {
  let n = 0;
  const total = file.upload.total;
  file.upload.chunksDone.forEach((i) => (n += Math.max(0, Math.min(size, total - i * size))));
  return n;
}
