import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorRegistry, exportErrors } from '../src/errors/registry';
import type { ErrorEntry } from '../src/types';
import { basename, dirname, joinPath, normalizePath, sentRelativePath } from '../src/util/path';
import { uuidv4 } from '../src/util/uuid';
import { mimeFromName } from '../src/validate/mime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('paths (0002)', () => {
  it('normalises separators, leading slashes, ./ and duplicate slashes, keeping Unicode as is', () => {
    expect(normalizePath('/Photos//2024/./a.jpg')).toBe('Photos/2024/a.jpg');
    expect(normalizePath('Photos\\2024\\a.jpg')).toBe('Photos/2024/a.jpg');
    expect(normalizePath('./a/')).toBe('a');
    expect(normalizePath('')).toBe('');
    const nfd = 'Café/x';
    expect(normalizePath(nfd)).toBe(nfd);
  });

  it('splits and joins', () => {
    expect(dirname('a/b/c')).toBe('a/b');
    expect(dirname('c')).toBe('');
    expect(basename('a/b/c')).toBe('c');
    expect(joinPath('', 'x')).toBe('x');
    expect(joinPath('a', '')).toBe('a');
    expect(joinPath('a', 'x')).toBe('a/x');
    expect(sentRelativePath({ relativePath: 'a/b.txt', upload: { filename: 'c.txt' } })).toBe(
      'a/c.txt',
    );
    expect(sentRelativePath({ relativePath: 'b.txt', upload: { filename: 'c.txt' } })).toBe(
      'c.txt',
    );
  });
});

describe('uuidv4', () => {
  it('creates RFC 4122 v4 ids with crypto.getRandomValues', () => {
    const ids = new Set(Array.from({ length: 1000 }, uuidv4));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it('falls back to Math.random without crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(uuidv4()).toMatch(UUID);
  });
});

describe('mimeFromName (empty MIME fallback)', () => {
  it('maps phone formats case-insensitively and returns empty for unknown names', () => {
    expect(mimeFromName('IMG_0001.HEIC')).toBe('image/heic');
    expect(mimeFromName('a.heif')).toBe('image/heif');
    expect(mimeFromName('clip.MOV')).toBe('video/quicktime');
    expect(mimeFromName('noext')).toBe('');
    expect(mimeFromName('a.constructor')).toBe('');
    expect(mimeFromName('a.')).toBe('');
  });
});

describe('ErrorRegistry (0007)', () => {
  const entry = (fileId: string | null, path: string): ErrorEntry => ({
    fileId,
    relativePath: path,
    uploadId: null,
    code: 'X',
    message: 'm',
    stage: 'validate',
    attempt: 0,
    retryable: false,
    at: 1,
  });

  it('keeps one entry per file (replacing it), folder entries apart, and returns copies', () => {
    const changes = vi.fn();
    const r = new ErrorRegistry(changes);
    r.set(entry('f1', 'a'));
    r.set({ ...entry('f1', 'a'), code: 'Y' });
    r.set(entry(null, 'Empty'));
    expect(r.size).toBe(2);
    const list = r.list();
    expect(list.map((e) => e.code)).toEqual(['Y', 'X']); // f1 replaced, then the folder entry
    list[0]!.code = 'mutated';
    expect(r.list()[0]!.code).toBe('Y');
    expect(r.remove('nope')).toBe(false);
    expect(r.remove(null, 'Empty')).toBe(true);
    expect(r.has('f1')).toBe(true);
    r.clear();
    r.clear();
    expect(changes).toHaveBeenCalledTimes(5); // set, set, set, remove, clear
  });

  it('exports CSV with RFC 4180 quoting and JSON', () => {
    const e = { ...entry('id', 'a,"b"\nc'), httpStatus: 500, chunkIndex: 3 };
    const csv = exportErrors([e], 'csv');
    const header = csv.split('\r\n')[0]!;
    expect(header).toBe(
      'fileId,relativePath,uploadId,code,message,httpStatus,stage,chunkIndex,attempt,retryable,at',
    );
    expect(csv).toBe(header + '\r\nid,"a,""b""\nc",,X,m,500,validate,3,0,false,1\r\n');
    expect(JSON.parse(exportErrors([e], 'json'))).toEqual([e]);
    expect(exportErrors([], 'csv')).toBe(header + '\r\n');
    expect(() => exportErrors([], 'xml' as never)).toThrow(/Unknown export format/);
  });

  it('csv: text a spreadsheet would run as a formula gets a quote prefix (CSV injection)', () => {
    const e = (text: string) => ({ ...entry('id', text), httpStatus: 500, chunkIndex: 0 });
    const cell = (text: string) =>
      exportErrors([e(text)], 'csv')
        .split('\r\n')[1]!
        .split(',')[1]!;
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(cell('+1')).toBe("'+1");
    expect(cell('-1')).toBe("'-1");
    expect(cell('@x')).toBe("'@x");
    expect(cell('\tx')).toBe("'\tx");
    expect(cell('a=b')).toBe('a=b');
    // Quoted when it also has a separator; numbers are never prefixed.
    expect(exportErrors([e('=a,b')], 'csv')).toContain('"\'=a,b"');
    const row = exportErrors([{ ...e('m'), attempt: -1, at: -5 }], 'csv').split('\r\n')[1]!;
    expect(row).toBe('id,m,,X,m,500,validate,0,-1,false,-5');
  });
});
