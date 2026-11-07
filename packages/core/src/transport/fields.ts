// Portions adapted from Dropzone (MIT, (c) Matias Meno), see THIRD_PARTY_NOTICES.md.
// Request building (upload-protocol sections 3, 5): Dropzone's `dz*` chunk fields, our `ad*`
// fields, the user `params()` result merged over them, and the request headers.
import type { AnyDropCoreOptions } from '../options';
import type { AnyDropFile, ChunkInfo } from '../types';
import { sentRelativePath } from '../util/path';

/**
 * The built-in form fields of one upload request. Chunked: the six `dz*` fields plus
 * `adRelativePath` and `adSessionId`. Whole file: `adRelativePath`, `adSessionId`.
 * `uploadMultiple`: `adRelativePath[i]` and `adSessionId[i]` per file, no plain `adSessionId`: one
 * request can carry files of several batches (protocol v1.2, decision 0013).
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
    out.dzuuid = f.upload.uuid;
    out.dzchunkindex = chunk.index;
    out.dztotalfilesize = f.upload.total;
    out.dzchunksize = chunkSize;
    out.dztotalchunkcount = f.upload.totalChunkCount;
    out.dzchunkbyteoffset = chunk.start;
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
 * Appends fields like Dropzone does for `params` (an array value appends each item). `null` and
 * `undefined` values are skipped, so `params()` can drop or rename a built-in field.
 */
export function appendFields(fd: FormData, fields: Record<string, unknown>): void {
  for (const key in fields) {
    const value = fields[key];
    if (value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v as string | Blob);
  }
}

/** Dropzone's default headers (when `defaultHeaders`), then `extra`, then the `headers` option. */
export function headersFor(
  o: Pick<AnyDropCoreOptions, 'defaultHeaders' | 'headers'>,
  extra?: Record<string, string>,
): Record<string, string> {
  return Object.assign(
    o.defaultHeaders
      ? {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'X-Requested-With': 'XMLHttpRequest',
        }
      : {},
    extra,
    o.headers,
  );
}

/** Dropzone's `_getParamName(n)`. */
export function paramName(o: Pick<AnyDropCoreOptions, 'paramName' | 'uploadMultiple'>, n: number) {
  return typeof o.paramName === 'function'
    ? o.paramName(n)
    : o.paramName + (o.uploadMultiple ? `[${n}]` : '');
}
