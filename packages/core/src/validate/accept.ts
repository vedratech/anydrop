// File validation run when a file is added: type list matching, the size, type and count checks,
// and the human-readable size text. Pure functions, no DOM.
import { mimeFromName } from './mime';

/** Labels for `filesize()`, one per unit. */
export interface FileSizeUnits {
  tb: string;
  gb: string;
  mb: string;
  kb: string;
  b: string;
}

/** The part of a file that the type list looks at. */
export interface TypedName {
  name: string;
  type: string;
}

/** Why a file was refused. `code` is one of the client codes `REJECTED_SIZE`, `REJECTED_TYPE`, `MAX_FILES`. */
export interface Rejection {
  code: string;
  message: string;
}

/** The options `checkFile()` reads. */
export interface CheckOptions {
  maxFilesize: number | null;
  acceptedFiles: string | string[] | null;
  maxFiles: number | null;
  dictFileTooBig: string;
  dictInvalidFileType: string;
  dictMaxFilesExceeded: string;
}

const BYTES_PER_MIB = 1024 * 1024;

/** Splits a type list into trimmed entries. */
function entriesOf(list: string | readonly string[]): string[] {
  const raw = typeof list === 'string' ? list.split(',') : Array.from(list);
  return raw.map((entry) => entry.trim());
}

/** The part before the first `/`. */
function family(type: string): string {
  const slash = type.indexOf('/');
  return slash < 0 ? type : type.slice(0, slash);
}

function entryMatches(entry: string, name: string, type: string): boolean {
  if (entry.startsWith('.')) return name.toLowerCase().endsWith(entry.toLowerCase());
  if (entry.endsWith('/*')) return family(entry) === family(type);
  return entry === type;
}

/**
 * Whether a file passes a type list such as `'image/*,.pdf'` (the syntax of the HTML `accept`
 * attribute). An empty list accepts everything. A file with an empty MIME type is judged by
 * the type its extension suggests.
 */
export function isValidFile(
  file: TypedName,
  acceptedFiles: string | readonly string[] | null | undefined,
): boolean {
  if (!acceptedFiles) return true;
  const type = file.type || mimeFromName(file.name);
  return entriesOf(acceptedFiles).some((entry) => entryMatches(entry, file.name, type));
}

/**
 * The checks every added file goes through, in this order: size, type, count. Returns the first
 * failure, or `null` when the file passes. `acceptedCount` is the number of files accepted so far.
 */
export function checkFile(
  file: TypedName & { size: number },
  options: CheckOptions,
  acceptedCount: number,
): Rejection | null {
  const { maxFilesize, maxFiles } = options;
  if (maxFilesize && file.size > maxFilesize * BYTES_PER_MIB) {
    const mib = Math.round((file.size / BYTES_PER_MIB) * 100) / 100;
    return {
      code: 'REJECTED_SIZE',
      message: options.dictFileTooBig
        .replace('{{filesize}}', String(mib))
        .replace('{{maxFilesize}}', String(maxFilesize)),
    };
  }
  if (!isValidFile(file, options.acceptedFiles)) {
    return { code: 'REJECTED_TYPE', message: options.dictInvalidFileType };
  }
  if (maxFiles != null && acceptedCount >= maxFiles) {
    return {
      code: 'MAX_FILES',
      message: options.dictMaxFilesExceeded.replace('{{maxFiles}}', String(maxFiles)),
    };
  }
  return null;
}

/** Ladder of units, largest first, with the power of the base each one stands for. */
const LADDER = [
  ['tb', 4],
  ['gb', 3],
  ['mb', 2],
  ['kb', 1],
  ['b', 0],
] as const;

/**
 * Size text such as `'<strong>1.5</strong> MB'`. A unit is used from a tenth of its size on
 * (with base 1000, 100 bytes is `0.1 KB`), the number is rounded to one decimal.
 */
export function filesize(bytes: number, base: number, units: FileSizeUnits): string {
  let amount = 0;
  let label = units.b;
  if (bytes > 0) {
    for (const [key, power] of LADDER) {
      const unitSize = base ** power;
      if (bytes >= unitSize / 10) {
        amount = bytes / unitSize;
        label = units[key];
        break;
      }
    }
    amount = Math.round(amount * 10) / 10;
  }
  return `<strong>${amount}</strong> ${label}`;
}
