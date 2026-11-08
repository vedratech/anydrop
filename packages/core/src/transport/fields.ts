// Request building (upload-protocol sections 3, 5): the `ad*` upload fields, the user `params()`
// result merged over them, the form field name of the file, and the request headers.
import type { AnyDropCoreOptions } from '../options';
import type { AnyDropFile, ChunkInfo } from '../types';
import { sentRelativePath } from '../util/path';

type HeaderOptions = Pick<AnyDropCoreOptions, 'defaultHeaders' | 'headers'>;

const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/json',
  'Cache-Control': 'no-cache',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Headers for a request: the defaults (unless `defaultHeaders` is off), then `extra`, then the
 * `headers` option, so the option has the last word. Empty values stay; the transport skips them.
 */
export function headersFor(
  options: HeaderOptions,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    ...(options.defaultHeaders ? DEFAULT_HEADERS : null),
    ...extra,
    ...options.headers,
  };
}

/** Form field name of the file at index `n`: the `paramName` function's result, or `name[n]` with `uploadMultiple`. */
export function paramName(
  options: Pick<AnyDropCoreOptions, 'paramName' | 'uploadMultiple'>,
  n: number,
): string {
  const { paramName: name } = options;
  if (typeof name === 'function') return name(n);
  return options.uploadMultiple ? `${name}[${n}]` : name;
}

/**
 * The built-in form fields of one upload request. Chunked: the six chunk fields (`adUploadId`,
 * `adChunkIndex`, `adTotalSize`, `adChunkSize`, `adChunkCount`, `adChunkOffset`) plus
 * `adRelativePath` and `adSessionId`. Whole file: `adRelativePath`, `adSessionId`.
 * `uploadMultiple`: `adRelativePath[i]` and `adSessionId[i]` per file, no plain `adSessionId`: one
 * request can carry files of several batches (protocol v1.2).
 */
export function uploadFields(
  files: AnyDropFile[],
  sessionOf: (file: AnyDropFile) => string,
  chunkSize: number,
  multiple: boolean,
  chunk?: ChunkInfo,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const f = files[0] as AnyDropFile;
  if (chunk) {
    out.adUploadId = f.upload.uuid;
    out.adChunkIndex = chunk.index;
    out.adTotalSize = f.upload.total;
    out.adChunkSize = chunkSize;
    out.adChunkCount = f.upload.totalChunkCount;
    out.adChunkOffset = chunk.start;
  }
  if (multiple) {
    files.forEach((x, i) => {
      out[`adRelativePath[${i}]`] = sentRelativePath(x);
      out[`adSessionId[${i}]`] = sessionOf(x);
    });
  } else {
    out.adRelativePath = sentRelativePath(f);
    out.adSessionId = sessionOf(f);
  }
  return out;
}

/**
 * Appends fields to a form (an array value appends each item). `null` and
 * `undefined` values are skipped, so `params()` can drop or rename a built-in field.
 */
export function appendFields(fd: FormData, fields: Record<string, unknown>): void {
  for (const key in fields) {
    const value = fields[key];
    if (value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v as string | Blob);
  }
}
