import { createHash, randomUUID } from 'node:crypto';
import { test, expect } from './support/mock';

// Protocol conformance of the mock server itself (upload-protocol skill, v1).
// It does not depend on a browser, so it runs once, in the chromium project.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'protocol tests are browser independent');
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function chunkForm(opts: {
  sessionId: string;
  uploadId: string;
  relativePath: string;
  index: number;
  total: number;
  chunkSize: number;
  totalSize: number;
  data: Buffer;
}) {
  return {
    file: { name: 'blob', mimeType: 'application/octet-stream', buffer: opts.data },
    dzuuid: opts.uploadId,
    dzchunkindex: String(opts.index),
    dztotalchunkcount: String(opts.total),
    dzchunksize: String(opts.chunkSize),
    dzchunkbyteoffset: String(opts.index * opts.chunkSize),
    dztotalfilesize: String(opts.totalSize),
    adRelativePath: opts.relativePath,
    adSessionId: opts.sessionId,
  };
}

test('manifest creates empty folders; chunks in any order, twice; status; finalize', async ({
  request,
  mock,
}) => {
  const sessionId = randomUUID();
  const uploadId = randomUUID();
  const relativePath = 'Root/sub/data.bin';
  const content = Buffer.from(Array.from({ length: 25 }, (_, i) => i * 7));
  const chunkSize = 10;
  const slices = [content.subarray(0, 10), content.subarray(10, 20), content.subarray(20)];

  const manifest = await request.post(`${mock.url}/upload/manifest`, {
    data: {
      sessionId,
      roots: ['Root'],
      folders: ['Root', 'Root/sub', 'Root/empty'],
      files: [{ uploadId, relativePath, size: 25, lastModified: 1, type: '' }],
    },
  });
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toEqual({ ok: true });

  const send = (index: number) =>
    request.post(`${mock.url}/upload`, {
      multipart: chunkForm({
        sessionId,
        uploadId,
        relativePath,
        index,
        total: 3,
        chunkSize,
        totalSize: 25,
        data: slices[index]!,
      }),
    });

  expect((await send(2)).status()).toBe(200);
  expect((await send(0)).status()).toBe(200);
  expect((await send(0)).status()).toBe(200); // duplicate: idempotent

  const status = await request.get(`${mock.url}/upload/status?uploadId=${uploadId}`);
  expect(status.status()).toBe(200);
  expect((await status.json()).received).toEqual([0, 2]);

  // Still incomplete, so finalize answers 409 with the missing chunk.
  const early = await request.post(`${mock.url}/upload/finalize`, {
    data: { uploadId, relativePath, totalSize: 25, totalChunks: 3 },
  });
  expect(early.status()).toBe(409);
  expect((await early.json()).code).toBe('CHUNK_MISMATCH');

  expect((await send(1)).status()).toBe(200);
  const fin = await request.post(`${mock.url}/upload/finalize`, {
    data: { uploadId, relativePath, totalSize: 25, totalChunks: 3 },
  });
  expect(fin.status()).toBe(200);
  expect((await fin.json()).ok).toBe(true);

  const report = await mock.report(sessionId);
  const s = report.sessions[sessionId]!;
  expect(s.files).toEqual([{ path: relativePath, size: 25, sha256: sha(content) }]);
  expect(s.folders).toEqual(['Root', 'Root/empty', 'Root/sub']);
  const up = report.uploads.find((u) => u.uploadId === uploadId)!;
  expect(up.complete).toBe(true);
  expect(up.writes['0']).toBe(2); // the duplicate is visible to tests
  expect(up.duplicateChunkWrites).toBe(1);
  expect(report.stats.maxInFlight).toBeGreaterThanOrEqual(1);
});

test('unknown uploadId: status 404; bad paths 400 INVALID_PATH; bad chunk 400 INVALID_CHUNK', async ({
  request,
  mock,
}) => {
  const unknown = await request.get(`${mock.url}/upload/status?uploadId=${randomUUID()}`);
  expect(unknown.status()).toBe(404);

  const base = {
    sessionId: randomUUID(),
    uploadId: randomUUID(),
    index: 0,
    total: 1,
    chunkSize: 4,
    totalSize: 4,
    data: Buffer.from('abcd'),
  };
  for (const relativePath of [
    '../evil.txt',
    '/abs.txt',
    'a/../../b.txt',
    String.raw`a\b.txt`,
    'tab\t.txt',
  ]) {
    const r = await request.post(`${mock.url}/upload`, {
      multipart: chunkForm({ ...base, relativePath }),
    });
    expect(r.status(), relativePath).toBe(400);
    expect((await r.json()).code).toBe('INVALID_PATH');
  }
  const wrongSize = await request.post(`${mock.url}/upload`, {
    multipart: chunkForm({ ...base, relativePath: 'ok.txt', data: Buffer.from('abc') }),
  });
  expect(wrongSize.status()).toBe(400);
  expect((await wrongSize.json()).code).toBe('INVALID_CHUNK');
});

test('forced failure rule: 500 once, the chunk is not stored, the retry succeeds', async ({
  request,
  mock,
}) => {
  const sessionId = randomUUID();
  const uploadId = randomUUID();
  await mock.configure({
    failRules: [{ relativePath: 'f.bin', chunkIndex: 0, status: 500, times: 1 }],
  });
  const form = chunkForm({
    sessionId,
    uploadId,
    relativePath: 'f.bin',
    index: 0,
    total: 1,
    chunkSize: 4,
    totalSize: 4,
    data: Buffer.from('abcd'),
  });
  const first = await request.post(`${mock.url}/upload`, { multipart: form });
  expect(first.status()).toBe(500);
  expect((await first.json()).code).toBe('SERVER_ERROR');
  expect((await request.get(`${mock.url}/upload/status?uploadId=${uploadId}`)).status()).toBe(404);

  const second = await request.post(`${mock.url}/upload`, { multipart: form });
  expect(second.status()).toBe(200);
  expect((await mock.report(sessionId)).stats.injectedFailures).toBe(1);
});

test('CORS preflight and headers', async ({ request, mock }) => {
  const res = await request.fetch(`${mock.url}/upload`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-custom, content-type',
    },
  });
  expect(res.status()).toBe(204);
  expect(res.headers()['access-control-allow-origin']).toBe('http://localhost:5173');
  expect(res.headers()['access-control-allow-headers']).toContain('x-custom');
});

test('without finalizeUrl, the file is assembled when the last chunk arrives (Dropzone backend style)', async ({
  request,
  mock,
}) => {
  const sessionId = randomUUID();
  const data = Buffer.from('hello world');
  const r = await request.post(`${mock.url}/upload`, {
    multipart: {
      file: { name: 'hello.txt', mimeType: 'text/plain', buffer: data },
      adSessionId: sessionId,
      adRelativePath: 'hello.txt',
    },
  }); // not chunked: no dz* fields
  expect(r.status()).toBe(200);
  const rep = await mock.report(sessionId);
  expect(rep.sessions[sessionId]!.files).toEqual([
    { path: 'hello.txt', size: 11, sha256: sha(data) },
  ]);
});

test('protocol v1.1: repeated manifest, resumed uploadId under a new session, idempotent finalize, complete flag', async ({
  request,
  mock,
}) => {
  const uploadId = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const relativePath = 'R/f.bin';
  const content = Buffer.from('0123456789abcdefghij');
  const manifest = {
    roots: ['R'],
    folders: ['R', 'R/e'],
    files: [{ uploadId, relativePath, size: 20 }],
  };
  for (let i = 0; i < 2; i++) {
    const r = await request.post(`${mock.url}/upload/manifest`, {
      data: { sessionId: sessionA, ...manifest },
    });
    expect(r.status()).toBe(200); // the same manifest twice is fine
  }
  const chunk = (sessionId: string, index: number) =>
    request.post(`${mock.url}/upload`, {
      multipart: chunkForm({
        sessionId,
        uploadId,
        relativePath,
        index,
        total: 2,
        chunkSize: 10,
        totalSize: 20,
        data: content.subarray(index * 10, index * 10 + 10),
      }),
    });
  expect((await chunk(sessionA, 0)).status()).toBe(200);
  // "reload": a new session continues the same upload
  expect(
    (
      await request.post(`${mock.url}/upload/manifest`, {
        data: { sessionId: sessionB, ...manifest },
      })
    ).status(),
  ).toBe(200);
  const mid = await (await request.get(`${mock.url}/upload/status?uploadId=${uploadId}`)).json();
  expect(mid).toMatchObject({ received: [0], complete: false });
  expect((await chunk(sessionB, 1)).status()).toBe(200);

  const done = await (await request.get(`${mock.url}/upload/status?uploadId=${uploadId}`)).json();
  expect(done).toMatchObject({ received: [0, 1], complete: true });
  const fin = { uploadId, relativePath, totalSize: 20, totalChunks: 2 };
  for (let i = 0; i < 2; i++) {
    expect((await request.post(`${mock.url}/upload/finalize`, { data: fin })).status()).toBe(200);
  }
  const report = await mock.report();
  expect(report.merged.files).toEqual([{ path: relativePath, size: 20, sha256: sha(content) }]);
  expect(report.merged.folders).toEqual(['R', 'R/e']);
  expect(report.uploads[0]!.sessionIds.sort()).toEqual([sessionA, sessionB].sort());
});

test('fault mode: 429 with Retry-After, by rule and by AD_FAIL_STATUS', async ({
  request,
  mock,
}) => {
  const form = (uploadId: string) =>
    chunkForm({
      sessionId: randomUUID(),
      uploadId,
      relativePath: 'x.bin',
      index: 0,
      total: 1,
      chunkSize: 2,
      totalSize: 2,
      data: Buffer.from('hi'),
    });
  await mock.configure({ failRules: [{ chunkIndex: 0, status: 429, retryAfter: 3, times: 1 }] });
  const a = await request.post(`${mock.url}/upload`, { multipart: form(randomUUID()) });
  expect(a.status()).toBe(429);
  expect(a.headers()['retry-after']).toBe('3');
  expect((await a.json()).code).toBe('RATE_LIMITED');

  await mock.configure({ failRules: [], failRate: 1, failStatus: 429, failRetryAfter: 1 });
  const b = await request.post(`${mock.url}/upload`, { multipart: form(randomUUID()) });
  expect(b.status()).toBe(429);
  expect(b.headers()['retry-after']).toBe('1');
});

test('uploadMultiple: several files in one non-chunked request (file[0], adRelativePath[0], ...)', async ({
  request,
  mock,
}) => {
  const sessionId = randomUUID();
  const r = await request.post(`${mock.url}/upload`, {
    multipart: {
      'file[0]': { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('AAA') },
      'adRelativePath[0]': 'D/a.txt',
      'file[1]': { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('BB') },
      'adRelativePath[1]': 'D/b.txt',
      adSessionId: sessionId,
    },
  });
  expect(r.status()).toBe(200);
  const rep = await mock.report(sessionId);
  expect(rep.sessions[sessionId]!.files.map((f) => [f.path, f.size])).toEqual([
    ['D/a.txt', 3],
    ['D/b.txt', 2],
  ]);
});

test.describe('strict manifest mode (AD_STRICT_MANIFEST, protocol v1.3, decision 0016)', () => {
  test.use({ mockOptions: { strictManifest: true } });

  test('chunks and finalize need an uploadId from the latest manifest of the session', async ({
    request,
    mock,
  }) => {
    const sessionId = randomUUID();
    const oldId = randomUUID();
    const newId = randomUUID();
    const relativePath = 'Strict/a.bin';
    const data = Buffer.from('0123456789');
    const chunk = (uploadId: string) =>
      request.post(`${mock.url}/upload`, {
        multipart: chunkForm({
          sessionId,
          uploadId,
          relativePath,
          index: 0,
          total: 1,
          chunkSize: 10,
          totalSize: 10,
          data,
        }),
      });
    const manifest = (uploadId: string) =>
      request.post(`${mock.url}/upload/manifest`, {
        data: {
          sessionId,
          roots: ['Strict'],
          folders: ['Strict'],
          files: [{ uploadId, relativePath, size: 10, lastModified: 1, type: '' }],
        },
      });
    const finalize = (uploadId: string) =>
      request.post(`${mock.url}/upload/finalize`, {
        data: { uploadId, relativePath, totalSize: 10, totalChunks: 1 },
      });

    // No manifest yet: the upload is not announced.
    const early = await chunk(oldId);
    expect(early.status()).toBe(400);
    expect((await early.json()).code).toBe('INVALID_CHUNK');

    expect((await manifest(oldId)).status()).toBe(200);
    // A repeated manifest with a new uploadId replaces the entry: the old id is no longer accepted.
    expect((await manifest(newId)).status()).toBe(200);
    const stale = await chunk(oldId);
    expect(stale.status()).toBe(400);
    expect((await stale.json()).code).toBe('INVALID_CHUNK');
    expect((await finalize(oldId)).status()).toBe(404); // never stored: unknown

    expect((await chunk(newId)).status()).toBe(200);
    expect((await finalize(newId)).status()).toBe(200);
    expect((await mock.report()).merged.files.find((f) => f.path === relativePath)?.sha256).toBe(
      sha(data),
    );

    // The same upload under a session that never announced it is rejected on chunk and finalize.
    const other = await request.post(`${mock.url}/upload`, {
      multipart: chunkForm({
        sessionId: randomUUID(),
        uploadId: newId,
        relativePath,
        index: 0,
        total: 1,
        chunkSize: 10,
        totalSize: 10,
        data,
      }),
    });
    expect(other.status()).toBe(400);
  });
});
