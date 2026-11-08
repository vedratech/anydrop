// Behaviour spec for src/validate/accept.ts. The expected values below are fixed; they come from
// the documented options (docs/api, docs/guide/validation.md) and from the results the previous
// implementation produced for the same inputs.
//
// isValidFile(file: { name; type }, acceptedFiles: string | string[] | null | undefined): boolean
//   - null, undefined and '' mean "no restriction": every file is valid.
//   - A string is split at commas; an array is taken as the list of entries. Every entry is
//     trimmed. An empty array has no entry that can match, so no file is valid.
//   - The file's type is `file.type`. When it is empty, the type is guessed from the extension
//     (mimeFromName), so an iOS HEIC photo with an empty type matches `image/*`.
//   - An entry that starts with '.' matches when the file name ends with it, ignoring case.
//     `.png` matches `a.png`, `A.PNG` and `.png`, not `png`; `.tar.gz` matches `a.tar.gz`.
//   - An entry that ends with '/*' matches when the part of the type before its first '/' equals
//     the part of the entry before its first '/'. This comparison is case-sensitive. `*/*` is
//     such an entry, with the base `*`, so it matches no real type.
//   - Any other entry matches when it equals the type exactly (case-sensitive), so `image` and
//     `image/` and `image/png;q=1` match nothing. An empty entry (a trailing comma, a list of
//     only blanks) equals the empty type, so it matches files whose type is still unknown.
//   - The file is valid when at least one entry matches.
//
// checkFile(file: { name; size; type }, options, acceptedCount): null | { code, message }
//   Checks run in this order and stop at the first failure.
//   1. Size. When maxFilesize is set (not null, not 0) and file.size > maxFilesize * 1024 * 1024
//      (maxFilesize is in MiB): code REJECTED_SIZE; message dictFileTooBig with the first
//      `{{filesize}}` replaced by the file size in MiB rounded to 2 decimals (no unit text) and
//      the first `{{maxFilesize}}` replaced by the option value. A file of exactly the limit passes.
//   2. Type. When acceptedFiles is set and isValidFile() is false: code REJECTED_TYPE; message
//      dictInvalidFileType as is.
//   3. Count. When maxFiles is not null/undefined and acceptedCount >= maxFiles: code MAX_FILES;
//      message dictMaxFilesExceeded with the first `{{maxFiles}}` replaced by the option value.
//      maxFiles 0 therefore rejects every file.
//   Otherwise it returns null.
//
// filesize(bytes, base, units): string
//   - Units from the largest: tb = base^4, gb = base^3, mb = base^2, kb = base, b = 1.
//   - A size that is not above 0 (zero, negative, NaN) is `<strong>0</strong> ` + units.b.
//   - Otherwise the unit is the largest one whose size is at most ten times the byte count, that
//     is, bytes >= unit size / 10 (so with base 1000, 100 bytes is "0.1 KB" and 99 bytes is "99 b";
//     99999 bytes is "100 KB"; below 0.1 byte the result is 0 b). The number is bytes / unit size rounded to 1 decimal, printed
//     with plain JavaScript number formatting (1 not 1.0).
//   - Result: `<strong>` + number + `</strong> ` + units[unit].
import { describe, expect, it } from 'vitest';
import { defaultOptions } from '../src/options';
import { checkFile, filesize, isValidFile } from '../src/validate/accept';
import { mimeFromName } from '../src/validate/mime';

const MiB = 1024 * 1024;
const png = { name: 'a.png', type: 'image/png' };

describe('isValidFile: no restriction', () => {
  it.each([null, undefined, ''])('accepts everything for %j', (list) => {
    expect(isValidFile(png, list)).toBe(true);
    expect(isValidFile({ name: 'x', type: '' }, list)).toBe(true);
  });
});

describe('isValidFile: entries', () => {
  // [list, name, type, valid]
  const rows: [string | string[], string, string, boolean][] = [
    ['image/*', 'a.png', 'image/png', true],
    ['image/*', 'a.txt', 'text/plain', false],
    ['image/*', 'v.mov', 'video/quicktime', false],
    ['text/*', 'a.png', 'text/plain', true],
    ['image/png', 'a.png', 'image/png', true],
    ['image/png', 'a.jpg', 'image/jpeg', false],
    ['image/png', 'a.png', 'Image/PNG', false], // types are compared case-sensitively
    ['IMAGE/*', 'a.png', 'image/png', false],
    ['image/*', 'a.png', 'Image/PNG', false],
    ['.png', 'a.png', 'text/plain', true], // an extension ignores the type
    ['.png', 'A.PNG', 'image/png', true],
    ['.PNG', 'a.png', 'image/png', true],
    ['.png', '.png', 'image/png', true],
    ['.png', 'png', 'image/png', false],
    ['.png', 'a.png.txt', 'image/png', false],
    ['.png,.pdf', 'archive.PdF', 'text/plain', true],
    ['.png,.pdf', 'a.txt', 'text/plain', false],
    ['.tar.gz', 'a.tar.gz', 'application/gzip', true],
    ['.tar.gz', 'a.gz', 'application/gzip', false],
    ['.', 'a.png', 'image/png', false],
    [' image/* , application/pdf ', 'a.pdf', 'application/pdf', true], // entries are trimmed
    [' image/* , application/pdf ', 'a.png', 'image/png', true],
    [' image/* , application/pdf ', 'a.txt', 'text/plain', false],
    ['video/*,.gz', 'a.gz', 'application/gzip', true],
    ['video/*,.gz', 'v.mov', 'video/quicktime', true],
    ['*/*', 'a.png', 'image/png', false],
    ['*', 'a.png', 'image/png', false],
    ['image', 'a.png', 'image/png', false],
    ['image/', 'a.png', 'image/png', false],
    ['image/png;q=1', 'a.png', 'image/png', false],
    [['.jpg', 'image/*'], 'a.png', 'image/png', true],
    [['.jpg', 'image/*'], 'b.jpg', 'text/plain', true],
    [['.jpg', 'image/*'], 'a.txt', 'text/plain', false],
    [[' .jpg '], 'b.jpg', '', true],
    [[], 'a.png', 'image/png', false],
  ];
  it.each(rows)('%j: %s (%s) -> %s', (list, name, type, expected) => {
    expect(isValidFile({ name, type }, list)).toBe(expected);
  });

  it('an empty entry matches only a file whose type is unknown', () => {
    expect(isValidFile({ name: 'x', type: '' }, ' ')).toBe(true);
    expect(isValidFile({ name: 'a.tar.gz', type: '' }, ',')).toBe(true);
    expect(isValidFile({ name: 'x', type: '' }, 'image/*,')).toBe(true);
    expect(isValidFile({ name: 'x', type: '' }, ',.png')).toBe(true);
    expect(isValidFile(png, ' ')).toBe(false);
    expect(isValidFile(png, 'image/*,')).toBe(true); // by its first entry
    expect(isValidFile({ name: 'a.txt', type: 'text/plain' }, 'image/*,')).toBe(false);
  });
});

describe('isValidFile: empty MIME type', () => {
  it('guesses the type from the extension', () => {
    expect(isValidFile({ name: 'IMG_0001.HEIC', type: '' }, 'image/*')).toBe(true);
    expect(isValidFile({ name: 'scan.heif', type: '' }, 'image/heif')).toBe(true);
    expect(isValidFile({ name: 'a.png', type: '' }, 'image/*')).toBe(true);
    expect(isValidFile({ name: '.png', type: '' }, 'image/png')).toBe(true);
    expect(isValidFile({ name: 'v.mov', type: '' }, 'image/*')).toBe(false);
    expect(isValidFile({ name: 'v.mov', type: '' }, 'video/*')).toBe(true);
    expect(isValidFile({ name: 'unknown.xyz', type: '' }, 'image/*')).toBe(false);
    expect(isValidFile({ name: 'png', type: '' }, 'image/*')).toBe(false);
  });
  it('the guess agrees with mimeFromName', () => {
    for (const name of ['a.png', 'IMG_1.HEIC', 'v.mov', 'x', 'a.tar.gz']) {
      const guessed = mimeFromName(name);
      for (const list of ['image/*', 'video/*', 'image/heic', '.png', ' ']) {
        expect(isValidFile({ name, type: '' }, list)).toBe(
          isValidFile({ name, type: guessed }, list),
        );
      }
    }
  });
});

describe('checkFile', () => {
  const o = defaultOptions();
  const file = (size: number, name = 'a.png', type = 'image/png') => ({ name, type, size });

  it('returns null when nothing is violated (defaults: 256 MiB, no type list, no count limit)', () => {
    expect(checkFile(file(1), o, 0)).toBeNull();
    expect(checkFile(file(256 * MiB), o, 1000)).toBeNull();
  });

  it('rejects a file above maxFilesize, with the size in MiB in the message', () => {
    const opts = { ...o, maxFilesize: 1 };
    expect(checkFile(file(MiB), opts, 0)).toBeNull(); // exactly the limit
    expect(checkFile(file(MiB + 1), opts, 0)).toEqual({
      code: 'REJECTED_SIZE',
      message: 'File is too big (1MiB). Max filesize: 1MiB.',
    });
    expect(checkFile(file(3 * MiB + 12345), opts, 0)?.message).toBe(
      'File is too big (3.01MiB). Max filesize: 1MiB.',
    );
    expect(checkFile(file(5_000_000), { ...o, maxFilesize: 2 }, 0)?.message).toBe(
      'File is too big (4.77MiB). Max filesize: 2MiB.',
    );
  });

  it('takes a fractional limit and treats null and 0 as no limit', () => {
    expect(checkFile(file(1_500_000), { ...o, maxFilesize: 1.5 }, 0)).toBeNull();
    expect(checkFile(file(10 * MiB), { ...o, maxFilesize: 0 }, 0)).toBeNull();
    expect(checkFile(file(10 * MiB), { ...o, maxFilesize: null }, 0)).toBeNull();
    expect(checkFile(file(100), { ...o, maxFilesize: -1 }, 0)?.code).toBe('REJECTED_SIZE');
  });

  it('replaces only the first placeholder of each name', () => {
    const opts = {
      ...o,
      maxFilesize: 1,
      dictFileTooBig: '{{filesize}}/{{maxFilesize}}/{{filesize}}',
    };
    expect(checkFile(file(2 * MiB), opts, 0)?.message).toBe('2/1/{{filesize}}');
  });

  it('rejects a type that is not in acceptedFiles, with the message unchanged', () => {
    const opts = { ...o, acceptedFiles: 'image/*', dictInvalidFileType: 'Nope {{x}}' };
    expect(checkFile(file(1, 'b.txt', 'text/plain'), opts, 0)).toEqual({
      code: 'REJECTED_TYPE',
      message: 'Nope {{x}}',
    });
    expect(checkFile(file(1), opts, 0)).toBeNull();
    expect(checkFile(file(1, 'a.heic', ''), opts, 0)).toBeNull(); // guessed from the extension
  });

  it('rejects when acceptedCount has reached maxFiles', () => {
    const opts = { ...o, maxFiles: 1, dictMaxFilesExceeded: 'Max {{maxFiles}} files' };
    expect(checkFile(file(1), opts, 0)).toBeNull();
    expect(checkFile(file(1), opts, 1)).toEqual({ code: 'MAX_FILES', message: 'Max 1 files' });
    expect(checkFile(file(1), opts, 2)?.code).toBe('MAX_FILES');
    expect(checkFile(file(1), { ...opts, maxFiles: 0 }, 0)?.message).toBe('Max 0 files');
    expect(checkFile(file(1), { ...opts, maxFiles: null }, 5)).toBeNull();
    expect(checkFile(file(1), { ...opts, maxFiles: undefined } as never, 5)).toBeNull();
  });

  it('uses the default messages', () => {
    expect(checkFile(file(1), { ...o, acceptedFiles: '.pdf' }, 0)?.message).toBe(
      "You can't upload files of this type.",
    );
    expect(checkFile(file(1), { ...o, maxFiles: 0 }, 0)?.message).toBe(
      'You cannot upload any more files.',
    );
  });

  it('checks size first, then type, then count', () => {
    const big = file(2 * MiB, 'b.txt', 'text/plain');
    const all = { ...o, maxFilesize: 1, acceptedFiles: 'image/*', maxFiles: 0 };
    expect(checkFile(big, all, 5)?.code).toBe('REJECTED_SIZE');
    expect(checkFile(file(1, 'b.txt', 'text/plain'), all, 5)?.code).toBe('REJECTED_TYPE');
    expect(checkFile(file(1), all, 5)?.code).toBe('MAX_FILES');
  });
});

describe('filesize', () => {
  const units = { tb: 'TB', gb: 'GB', mb: 'MB', kb: 'KB', b: 'b' };
  const strong = (n: string, u: string) => `<strong>${n}</strong> ${u}`;

  it('uses base 1000', () => {
    const rows: [number, string, string][] = [
      [0, '0', 'b'],
      [1, '1', 'b'],
      [99, '99', 'b'],
      [100, '0.1', 'KB'],
      [999, '1', 'KB'],
      [1000, '1', 'KB'],
      [1234, '1.2', 'KB'],
      [99_999, '100', 'KB'],
      [100_000, '0.1', 'MB'],
      [1_500_000, '1.5', 'MB'],
      [12_345_678, '12.3', 'MB'],
      [1_073_741_824, '1.1', 'GB'],
      [2.5e9, '2.5', 'GB'],
      [7.25e12, '7.3', 'TB'],
      [5e15, '5000', 'TB'],
      [1.5, '1.5', 'b'],
      [0.5, '0.5', 'b'],
      [0.05, '0', 'b'], // below a tenth of a byte
      [-5, '0', 'b'],
      [NaN, '0', 'b'],
    ];
    for (const [bytes, n, u] of rows)
      expect([bytes, filesize(bytes, 1000, units)]).toEqual([bytes, strong(n, u)]);
  });

  it('uses base 1024', () => {
    const rows: [number, string, string][] = [
      [0, '0', 'b'],
      [99, '99', 'b'],
      [100, '100', 'b'],
      [999, '1', 'KB'],
      [1024, '1', 'KB'],
      [1234, '1.2', 'KB'],
      [100_000, '97.7', 'KB'],
      [1_500_000, '1.4', 'MB'],
      [1_048_576, '1', 'MB'],
      [12_345_678, '11.8', 'MB'],
      [1_073_741_824, '1', 'GB'],
      [2.5e9, '2.3', 'GB'],
      [7.25e12, '6.6', 'TB'],
      [5e15, '4547.5', 'TB'],
    ];
    for (const [bytes, n, u] of rows)
      expect([bytes, filesize(bytes, 1024, units)]).toEqual([bytes, strong(n, u)]);
  });

  it('takes the unit labels from the units object', () => {
    expect(filesize(1_500_000, 1000, { tb: 'To', gb: 'Go', mb: 'Mo', kb: 'Ko', b: 'o' })).toBe(
      '<strong>1.5</strong> Mo',
    );
    expect(filesize(0, 1000, { tb: 'To', gb: 'Go', mb: 'Mo', kb: 'Ko', b: 'o' })).toBe(
      '<strong>0</strong> o',
    );
  });
});
