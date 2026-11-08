// augmentFile: turns the native File into the public file object by adding properties.
// Read-only fields use Object.defineProperty (configurable, so a File can be re-added after
// removal). The File itself is untouched otherwise: FormData, FileReader and instanceof keep working.
import type { AnyDropFile, FolderNode } from './types';

export interface AugmentInit {
  id: string;
  uploadId: string;
  relativePath: string;
  fromFolder: boolean;
  folder: FolderNode;
  chunking: boolean;
  forceChunking: boolean;
  chunkSize: number;
  /** Dropzone's `renameFile`; called last, so it can read `relativePath` and `upload`. */
  rename: (file: AnyDropFile) => string;
}

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: false,
  });
}

export function augmentFile(file: File, init: AugmentInit): AnyDropFile {
  const f = file as AnyDropFile;
  define(f, 'id', init.id);
  define(f, 'relativePath', init.relativePath);
  define(f, 'fingerprint', `${init.relativePath}|${file.size}|${file.lastModified}`);
  define(f, 'folder', init.folder);
  if (init.fromFolder) {
    Object.defineProperty(f, 'fullPath', {
      get(this: AnyDropFile) {
        return this.relativePath;
      },
      enumerable: true,
      configurable: true,
    });
  }
  f.status = 'added';
  f.accepted = undefined;
  const chunked = init.chunking && (init.forceChunking || file.size > init.chunkSize);
  f.upload = {
    uuid: init.uploadId,
    filename: file.name,
    progress: 0,
    total: file.size,
    bytesSent: 0,
    chunked,
    chunkSize: init.chunkSize,
    totalChunkCount: chunked ? Math.max(1, Math.ceil(file.size / init.chunkSize)) : 1,
    chunksDone: new Set(),
  };
  f.upload.filename = init.rename(f);
  return f;
}
