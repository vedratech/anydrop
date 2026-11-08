// Structural types for the browser input APIs the source readers use. Structural, so the
// readers work with any DOM lib version and with test mocks.

export interface FileEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath?: string;
  file(success: (file: File) => void, error?: (err: unknown) => void): void;
}

export interface DirectoryReaderLike {
  readEntries(success: (entries: EntryLike[]) => void, error?: (err: unknown) => void): void;
}

export interface DirectoryEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath?: string;
  createReader(): DirectoryReaderLike;
}

/** A `FileSystemEntry` (`FileSystemFileEntry` or `FileSystemDirectoryEntry`). */
export type EntryLike = FileEntryLike | DirectoryEntryLike;

/** What every entry has (the DOM `FileSystemEntry` type). The walker checks `isFile`/`isDirectory`. */
export interface BaseEntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath?: string;
}

export interface DataTransferItemLike {
  readonly kind?: string;
  getAsFile?(): File | null;
  webkitGetAsEntry?(): BaseEntryLike | null;
}

/** A `DataTransfer` (drop) or the `clipboardData` of a paste. */
export interface DataTransferLike {
  /** The drop items (used for folders through `webkitGetAsEntry`). */
  readonly items?: ArrayLike<DataTransferItemLike> | null;
  /** The plain file list, used when `items` is missing. */
  readonly files?: ArrayLike<File> | null;
}

/** What a source yields: a file with its normalised path, or a folder that would otherwise be lost. */
export type SourceItem =
  | {
      kind: 'file';
      file: File;
      /** Normalised relative path including the file name. */
      path: string;
      /** The file came from a folder (drop walk or `webkitdirectory`). */
      fromFolder: boolean;
    }
  | {
      kind: 'folder';
      path: string;
      /** The directory had no entries at all (the `emptyfolder` event). */
      raw: boolean;
    };

/** A top-level dropped item, snapshotted synchronously during the event. */
export type RootInput = { file: File } | { entry: EntryLike };

export interface ReadOptions {
  ignoreHiddenFiles: boolean;
  /** When false, dropped directories are skipped (no folder support). */
  folders: boolean;
  /** An entry or directory could not be read. The walk carries on. */
  onError?: (error: unknown, path: string) => void;
}
