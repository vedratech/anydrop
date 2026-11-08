import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { diffTrees, walkTree } from '../fixtures/lib.mjs';
import { test, expect } from './support/mock';

// Proves the chain used by every later scenario: fixture generator -> upload protocol -> mock server
// storage -> tree report, with the same paths and SHA-256 and the empty folders kept.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'protocol tests are browser independent');
});

test('a generated nested folder uploaded in chunks arrives identical (paths, SHA-256, empty folders)', async ({
  request,
  mock,
}) => {
  const out = await mkdtemp(join(tmpdir(), 'anydrop-fx-'));
  try {
    execFileSync(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'generate.mjs'),
        ...['--files', '300', '--depth', '3', '--empty', '4', '--max-kb', '6', '--out', out],
      ],
      { stdio: 'pipe' },
    );
    const walked = await walkTree(out);
    const source = {
      files: walked.files.filter((f) => f.path.startsWith('tree/')),
      folders: walked.folders,
    };
    expect(source.files.length).toBeGreaterThanOrEqual(300);
    expect(source.folders.some((f) => f.includes('empty-'))).toBe(true);

    const sessionId = randomUUID();
    const folders = source.folders;
    const files = source.files.map((f) => ({
      uploadId: randomUUID(),
      relativePath: f.path,
      size: f.size,
    }));
    const manifest = await request.post(`${mock.url}/upload/manifest`, {
      data: { sessionId, roots: ['tree'], folders, files },
    });
    expect(manifest.status()).toBe(200);

    const chunkSize = 2048;
    for (const f of files) {
      const data = await readFile(join(out, f.relativePath));
      const total = Math.max(1, Math.ceil(data.length / chunkSize));
      for (let i = total - 1; i >= 0; i--) {
        // reverse order: the server must accept chunks in any order
        const res = await request.post(`${mock.url}/upload`, {
          multipart: {
            file: {
              name: 'blob',
              mimeType: 'application/octet-stream',
              buffer: data.subarray(i * chunkSize, (i + 1) * chunkSize),
            },
            adUploadId: f.uploadId,
            adChunkIndex: String(i),
            adChunkCount: String(total),
            adChunkSize: String(chunkSize),
            adChunkOffset: String(i * chunkSize),
            adTotalSize: String(data.length),
            adRelativePath: f.relativePath,
            adSessionId: sessionId,
          },
        });
        expect(res.status(), `${f.relativePath} #${i}`).toBe(200);
      }
    }

    const report = (await mock.report(sessionId)).sessions[sessionId]!;
    const received = { files: report.files, folders: report.folders };
    expect(diffTrees(source, received)).toEqual([]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
