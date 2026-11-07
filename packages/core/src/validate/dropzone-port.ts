/*!
 * Portions of this file are ported from Dropzone 6.3.5 (https://github.com/dropzone/dropzone),
 * src/dropzone.ts: `Dropzone.isValidFile`, `Dropzone.prototype.accept` (size, type and maxFiles
 * checks) and `Dropzone.prototype.filesize`. Changes: split into pure functions that return a
 * rejection code, and an extension fallback for files whose MIME type is empty (iOS, HEIC).
 *
 * Copyright (c) 2026 Matias Simon <m@tias.me>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { mimeFromName } from './mime';

/** A client rejection code (protocol section 6). */
export type RejectionCode = 'REJECTED_SIZE' | 'REJECTED_TYPE' | 'MAX_FILES';

export interface Rejection {
  code: RejectionCode;
  message: string;
}

/** The options the built-in checks read. */
export interface ValidationOptions {
  maxFilesize: number | null;
  acceptedFiles: string | string[] | null;
  maxFiles: number | null;
  dictFileTooBig: string;
  dictInvalidFileType: string;
  dictMaxFilesExceeded: string;
}

/**
 * Whether `file` matches `acceptedFiles` (the `accept` attribute syntax: `.ext`, `type/*`,
 * `type/subtype`). Dropzone's algorithm; when `file.type` is empty the type is guessed from the
 * extension first (AnyDrop addition, so `image/*` accepts a HEIC photo from iOS).
 */
export function isValidFile(
  file: { name: string; type: string },
  acceptedFiles: string | string[] | null | undefined,
): boolean {
  if (!acceptedFiles) return true; // no accepted types: everything is OK
  const list = typeof acceptedFiles === 'string' ? acceptedFiles.split(',') : acceptedFiles;

  const mimeType = file.type || mimeFromName(file.name);
  const baseMimeType = mimeType.replace(/\/.*$/, '');

  for (let validType of list) {
    validType = validType.trim();
    if (validType.charAt(0) === '.') {
      if (
        file.name
          .toLowerCase()
          .indexOf(validType.toLowerCase(), file.name.length - validType.length) !== -1
      ) {
        return true;
      }
    } else if (/\/\*$/.test(validType)) {
      // something like image/*
      if (baseMimeType === validType.replace(/\/.*$/, '')) return true;
    } else if (mimeType === validType) {
      return true;
    }
  }
  return false;
}

/**
 * Dropzone's built-in checks, in Dropzone's order: size, then type, then maxFiles. Returns the
 * first rejection, or null when the file passes (the user `accept()` runs next).
 * `acceptedCount` is the number of files accepted so far (Dropzone: `getAcceptedFiles().length`).
 */
export function checkFile(
  file: { name: string; type: string; size: number },
  o: ValidationOptions,
  acceptedCount: number,
): Rejection | null {
  if (o.maxFilesize && file.size > o.maxFilesize * 1024 * 1024) {
    return {
      code: 'REJECTED_SIZE',
      message: o.dictFileTooBig
        .replace('{{filesize}}', String(Math.round(file.size / 1024 / 10.24) / 100))
        .replace('{{maxFilesize}}', String(o.maxFilesize)),
    };
  }
  if (!isValidFile(file, o.acceptedFiles)) {
    return { code: 'REJECTED_TYPE', message: o.dictInvalidFileType };
  }
  if (o.maxFiles != null && acceptedCount >= o.maxFiles) {
    return {
      code: 'MAX_FILES',
      message: o.dictMaxFilesExceeded.replace('{{maxFiles}}', String(o.maxFiles)),
    };
  }
  return null;
}

/** Size units used by `filesize()`. */
export interface FileSizeUnits {
  tb: string;
  gb: string;
  mb: string;
  kb: string;
  b: string;
}

/** Dropzone's `filesize()`: `'<strong>1.5</strong> MB'` (the markup is Dropzone's). */
export function filesize(size: number, base: number, units: FileSizeUnits): string {
  let selectedSize = 0;
  let selectedUnit: keyof FileSizeUnits = 'b';
  if (size > 0) {
    const names: (keyof FileSizeUnits)[] = ['tb', 'gb', 'mb', 'kb', 'b'];
    for (let i = 0; i < names.length; i++) {
      const cutoff = Math.pow(base, 4 - i) / 10;
      if (size >= cutoff) {
        selectedSize = size / Math.pow(base, 4 - i);
        selectedUnit = names[i] as keyof FileSizeUnits;
        break;
      }
    }
    selectedSize = Math.round(10 * selectedSize) / 10; // cut off digits
  }
  return `<strong>${selectedSize}</strong> ${units[selectedUnit]}`;
}
