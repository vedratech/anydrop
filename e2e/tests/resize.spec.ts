// Pre-release review B6: the default `transformFile` scales images down with resizeWidth and
// resizeHeight. The server must receive the resized image (dimensions, size and MIME type as
// configured), and files that are not images must pass through unchanged.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './support/mock';
import { openDemo } from './support/ui';

/** Width and height of a JPEG, read from its first start-of-frame marker. */
function jpegSize(b: Buffer): { width: number; height: number } {
  expect(b.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // the JPEG signature
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) throw new Error(`bad JPEG marker at ${i}`);
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no start-of-frame marker');
}

test('an image is scaled to resizeWidth x resizeHeight and re-encoded as configured; other files pass through', async ({
  page,
  mock,
}) => {
  await openDemo(page, mock);
  const original = await page.evaluate(async (url) => {
    const AnyDrop = (
      window as unknown as {
        anydrop: {
          AnyDrop: new (el: string, o: Record<string, unknown>) => Record<string, unknown>;
        };
      }
    ).anydrop.AnyDrop;
    const el = document.createElement('div');
    el.id = 'resize-zone';
    document.body.appendChild(el);
    const zone = new AnyDrop('#resize-zone', {
      url: `${url}/upload`,
      resizeWidth: 200,
      resizeHeight: 150,
      resizeMimeType: 'image/jpeg',
      resizeQuality: 0.7,
      hiddenInputContainer: '#resize-zone',
    }) as unknown as {
      addFile(f: File): void;
      on(e: string, fn: (...a: unknown[]) => void): void;
    };
    // An 800 x 600 PNG with detail, so that scaling it down changes the byte size a lot.
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const g = c.getContext('2d')!;
    for (let y = 0; y < 600; y += 8) {
      for (let x = 0; x < 800; x += 8) {
        g.fillStyle = `hsl(${(x * 7 + y * 3) % 360} 70% ${30 + ((x ^ y) % 40)}%)`;
        g.fillRect(x, y, 8, 8);
      }
    }
    const png: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const done: string[] = [];
    zone.on('success', (f) => done.push((f as { name: string }).name));
    zone.addFile(new File([png], 'photo.png', { type: 'image/png' }));
    zone.addFile(new File(['not an image, left alone'], 'notes.txt', { type: 'text/plain' }));
    const t0 = Date.now();
    while (done.length < 2 && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 50));
    return { size: png.size, done: done.length };
  }, mock.url);
  expect(original.done).toBe(2);

  const report = await mock.report();
  const dir = (await readdir(mock.uploadDir, { withFileTypes: true })).find(
    (d) => d.isDirectory() && !d.name.startsWith('.'),
  )!.name;
  const received = report.merged.files;
  expect(received.map((f) => f.path).sort()).toEqual(['notes.txt', 'photo.png']);
  const photo = await readFile(join(mock.uploadDir, dir, 'photo.png'));
  // MIME as configured (a JPEG, even though the name says .png), scaled to the requested size, smaller.
  expect(jpegSize(photo)).toEqual({ width: 200, height: 150 });
  expect(photo.length).toBeLessThan(original.size);
  expect(received.find((f) => f.path === 'photo.png')!.size).toBe(photo.length);
  expect((await readFile(join(mock.uploadDir, dir, 'notes.txt'))).toString()).toBe(
    'not an image, left alone',
  );
});
