// Error registry: one entry per file currently in `error` (or per empty folder whose
// manifest failed), in insertion order. In memory only. `onChange` is called after every change;
// the caller merges it per microtask into `errorlistchanged`.
import type { ErrorEntry } from '../types';

export class ErrorRegistry {
  private entries = new Map<string, ErrorEntry>();

  constructor(private readonly onChange: () => void) {}

  /** Adds or replaces the entry of a file (or of a folder when `fileId` is null). */
  set(entry: ErrorEntry): void {
    const key = keyOf(entry.fileId, entry.relativePath);
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.onChange();
  }

  /** Removes the entry of a file id, or of a folder path when `fileId` is null. */
  remove(fileId: string | null, folderPath = ''): boolean {
    const removed = this.entries.delete(keyOf(fileId, folderPath));
    if (removed) this.onChange();
    return removed;
  }

  has(fileId: string): boolean {
    return this.entries.has(fileId);
  }

  clear(): void {
    if (!this.entries.size) return;
    this.entries.clear();
    this.onChange();
  }

  get size(): number {
    return this.entries.size;
  }

  /** A copy: new array, new entry objects. */
  list(): ErrorEntry[] {
    const out: ErrorEntry[] = [];
    this.entries.forEach((e) => out.push({ ...e }));
    return out;
  }
}

function keyOf(fileId: string | null, folderPath: string): string {
  return fileId === null ? '\0folder:' + folderPath : fileId;
}

/** Column order of `exportErrors('csv')`. */
const CSV_COLUMNS: (keyof ErrorEntry)[] = [
  'fileId',
  'relativePath',
  'uploadId',
  'code',
  'message',
  'httpStatus',
  'stage',
  'chunkIndex',
  'attempt',
  'retryable',
  'at',
];

/** `'json'`: pretty-printed array. `'csv'`: header row plus one row per entry, RFC 4180 quoting, CRLF, formula-like text prefixed with `'`. */
export function exportErrors(entries: ErrorEntry[], format: 'json' | 'csv'): string {
  if (format === 'json') return JSON.stringify(entries, null, 2);
  if (format !== 'csv') throw new Error(`Unknown export format: ${String(format)}`);
  const rows = [CSV_COLUMNS.join(',')];
  for (const e of entries) rows.push(CSV_COLUMNS.map((c) => csvField(e[c])).join(','));
  return rows.join('\r\n') + '\r\n';
}

/**
 * One cell. Text that a spreadsheet would run as a formula (`= + - @`, tab, CR first) gets a `'`
 * prefix (CSV injection); numbers (httpStatus, chunkIndex, attempt, at) are never touched.
 */
function csvField(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
