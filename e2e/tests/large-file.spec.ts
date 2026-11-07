// verify-upload scenario 7: a large sparse file goes through the demo UI in chunks, the server's
// copy has the same SHA-256, memory stays flat, and the file is only ever read with Blob.slice().
//
// Size: AD_LARGE_MB (default 1024 on Chromium, 256 on Firefox, 64 on the mobile projects and WebKit).
// The file comes from `<input type=file>` (a path, never read by Playwright). Exception, WebKit: in
// Playwright's WebKit build a Blob.slice() of a path-backed picked File is posted as an EMPTY body
// (reproduced without AnyDrop, plain fetch and XHR with FormData; whole-file posts work), so there the
// file is built in the page from in-memory parts instead. Whether real iOS Safari does this is on the
// device checklist (docs/device-checks.md). The file is generated sparse by fixtures/generate.mjs (never committed).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/mock';
import { FIXTURE_GENERATOR, isMobile, openDemo } from './support/ui';

const ZONE = '#tree-zone';
const CHUNK = Number(process.env.AD_LARGE_CHUNK_MB ?? 8) * 1024 * 1024;

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

interface Spy {
  slices: number;
  maxSlice: number;
  bigReads: string[];
  heapMax: number;
  heapBase: number;
}

/** Spies installed before the page's scripts: every whole-file read and every Blob.slice call. */
async function installSpies(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy: Spy = { slices: 0, maxSlice: 0, bigReads: [], heapMax: 0, heapBase: 0 };
    (window as unknown as { __spy: Spy }).__spy = spy;
    const LIMIT = 16 * 1024 * 1024; // a read of a Blob above this is a "whole file" read
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, ...a: [number?, number?, string?]) {
      const out = slice.apply(this, a);
      spy.slices++;
      spy.maxSlice = Math.max(spy.maxSlice, out.size);
      return out;
    };
    for (const m of ['arrayBuffer', 'text', 'stream'] as const) {
      const real = Blob.prototype[m] as (this: Blob) => unknown;
      (Blob.prototype as unknown as Record<string, unknown>)[m] = function (this: Blob) {
        if (this.size > LIMIT) spy.bigReads.push(`Blob.${m}(${this.size})`);
        return real.call(this);
      };
    }
    for (const m of [
      'readAsArrayBuffer',
      'readAsDataURL',
      'readAsText',
      'readAsBinaryString',
    ] as const) {
      const real = FileReader.prototype[m] as (this: FileReader, b: Blob) => void;
      (FileReader.prototype as unknown as Record<string, unknown>)[m] = function (
        this: FileReader,
        b: Blob,
      ) {
        if (b.size > LIMIT) spy.bigReads.push(`FileReader.${m}(${b.size})`);
        return real.call(this, b);
      };
    }
    // JS heap sampling (Chromium only: performance.memory).
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
    if (perf.memory) {
      spy.heapBase = perf.memory.usedJSHeapSize;
      setInterval(() => {
        spy.heapMax = Math.max(spy.heapMax, perf.memory!.usedJSHeapSize);
      }, 50);
    }
  });
}

test('a large file uploads in chunks with flat memory, Blob.slice only, and a matching SHA-256', async ({
  page,
  mock,
  browserName,
}, testInfo) => {
  const inMemory = browserName === 'webkit';
  const mb = Number(
    process.env.AD_LARGE_MB ??
      (inMemory || isMobile(testInfo.project.name) ? 64 : browserName === 'chromium' ? 1024 : 256),
  );
  test.setTimeout(Math.max(180_000, mb * 1500));
  const out = await mkdtemp(join(tmpdir(), 'anydrop-large-'));
  try {
    await installSpies(page);
    await openDemo(page, mock);
    await page.evaluate(
      ([chunk, max]) => {
        const t = (
          window as unknown as {
            anydrop: { tree: { setOption(n: string, v: unknown): void } };
          }
        ).anydrop.tree;
        t.setOption('chunkSize', chunk);
        t.setOption('maxFilesize', max);
        t.setOption('forceChunking', true);
      },
      [CHUNK, 4096] as const,
    );
    const size = mb * 1024 * 1024;
    let expectedSha: string | null = null;
    if (!inMemory) {
      execFileSync(
        process.execPath,
        [
          FIXTURE_GENERATOR,
          '--out',
          out,
          '--files',
          '1',
          '--wide',
          '0',
          '--depth',
          '1',
          '--empty',
          '0',
          '--large',
          '1',
          '--large-mb',
          String(mb),
        ],
        { stdio: 'pipe' },
      );
      const file = join(out, 'large', 'large-0.bin');
      expect((await stat(file)).size).toBe(size);
      expectedSha = await sha256File(file);
      await page.locator(`${ZONE} input[data-ad-input=files]`).setInputFiles(file);
    } else {
      await page.evaluate(
        ([n]) => {
          const parts: Uint8Array[] = [];
          for (let i = 0; i < n; i++) {
            const a = new Uint8Array(1048576);
            for (let j = 0; j < a.length; j += 4093) a[j] = (i * 31 + j) & 255; // a distinct pattern per MiB
            parts.push(a);
          }
          const file = new File(parts as BlobPart[], 'large-0.bin', {
            type: 'application/octet-stream',
          });
          (
            window as unknown as { anydrop: { tree: { addFiles(f: File[]): void } } }
          ).anydrop.tree.addFiles([file]);
          (window as unknown as { __bigFile: File }).__bigFile = file;
        },
        [mb] as const,
      );
    }
    await expect(page.locator(`${ZONE} .ad-summary`)).toContainText('1 of 1 uploaded, 0 failed', {
      timeout: Math.max(150_000, mb * 1200),
    });

    // The spies first: computing the expected hash in the page (WebKit) reads the file on purpose.
    const spy = await page.evaluate(() => (window as unknown as { __spy: Spy }).__spy);
    if (inMemory) {
      expectedSha = await page.evaluate(async () => {
        const f = (window as unknown as { __bigFile: File }).__bigFile;
        const d = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
        return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
      });
    }

    const report = await mock.report();
    expect(report.uploads).toHaveLength(1);
    const u = report.uploads[0]!;
    expect(u.totalChunks).toBe(Math.ceil(size / CHUNK)); // chunked for real
    expect(u.duplicateChunkWrites).toBe(0);
    const served = report.merged.files.find((f) => f.path === 'large-0.bin');
    expect(served?.size).toBe(size);
    expect(served?.sha256).toBe(expectedSha);

    // Only slices of at most one chunk, and no read of the whole file.
    expect(spy.bigReads).toEqual([]);
    expect(spy.slices).toBeGreaterThanOrEqual(u.totalChunks);
    expect(spy.maxSlice).toBeLessThanOrEqual(CHUNK);
    if (browserName === 'chromium' && spy.heapMax > 0) {
      const growthMb = (spy.heapMax - spy.heapBase) / 1048576;
      testInfo.annotations.push({ type: 'js-heap-growth-mb', description: growthMb.toFixed(1) });
      // The file is `mb` MB: reading it into JS memory would cost at least that.
      expect(growthMb).toBeLessThan(Math.min(64, mb / 4));
    }
    testInfo.annotations.push({
      type: 'large-file',
      description: `${mb} MB ${inMemory ? 'built in the page' : 'from a picked path'} in ${u.totalChunks} chunks of ${CHUNK / 1048576} MiB, ${spy.slices} slices`,
    });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
