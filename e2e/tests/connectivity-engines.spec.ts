// Decision 0017, "Uncertainty": what each engine really does when the network fails. The numbers go
// into the test annotations (and the report) and the assertions only pin what the connectivity logic
// relies on: a request that cannot reach the server ends with an `error` and status 0, and a held
// request never produces any event by itself.
//
// Recorded per engine (mock server and page share the origin, so no CORS preflight is involved):
//   refused    the server stopped listening (connection refused)
//   dns        a host name that does not resolve
//   routeAbort page.route abort('internetdisconnected'), the "lie-fi" used by connectivity.spec.ts
//   held       a request nobody answers (the stall case): no event within 3 s
//   progress   xhr.upload `progress` events for small bodies, and when `load` fires relative to the response
import { test, expect } from './support/mock';

test('what XHR does on refused connections, DNS failures, aborts, held requests, and small uploads', async ({
  page,
  mock,
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto(`${mock.url}/__health`);
  await mock.configure({ latencyMs: 300 });

  const probe = (url: string, opts: { body?: number; waitMs?: number } = {}) =>
    page.evaluate(
      ({ url, body, waitMs }) =>
        new Promise<{
          events: string[];
          status: number;
          ms: number;
          uploadProgress: number;
          uploadLoadBeforeResponse: boolean | null;
        }>((resolve) => {
          const xhr = new XMLHttpRequest();
          const t0 = performance.now();
          const events: string[] = [];
          let uploadProgress = 0;
          let uploadLoadAt = -1;
          let responseAt = -1;
          const done = () =>
            resolve({
              events,
              status: xhr.status,
              ms: Math.round(performance.now() - t0),
              uploadProgress,
              uploadLoadBeforeResponse:
                uploadLoadAt < 0 || responseAt < 0 ? null : uploadLoadAt <= responseAt,
            });
          for (const e of ['error', 'timeout', 'abort', 'load']) {
            xhr.addEventListener(e, () => {
              events.push(e);
              if (e === 'load') responseAt = performance.now();
            });
          }
          xhr.addEventListener('loadend', () => {
            events.push('loadend');
            done();
          });
          xhr.upload.addEventListener('progress', () => uploadProgress++);
          xhr.upload.addEventListener('load', () => (uploadLoadAt = performance.now()));
          xhr.open('POST', url);
          const fd = new FormData();
          fd.append('adRelativePath', `probe-${Math.random().toString(36).slice(2)}.bin`);
          fd.append('file', new Blob([new Uint8Array(body)]), 'probe.bin');
          xhr.send(fd);
          if (waitMs) {
            // A held request: give it `waitMs` to produce any event, then report what happened.
            setTimeout(() => {
              if (!events.includes('loadend')) {
                const r = {
                  events: [...events],
                  status: xhr.status,
                  ms: waitMs,
                  uploadProgress,
                  uploadLoadBeforeResponse: null,
                };
                resolve(r); // before abort(): its events resolve the probe too
                xhr.abort();
              }
            }, waitMs);
          }
        }),
      { url, body: opts.body ?? 1024, waitMs: opts.waitMs ?? 0 },
    );

  // Small uploads to a live server: do `upload.progress` events fire, and does `upload.load` come first?
  const small = await probe(`${mock.url}/upload`, { body: 4 * 1024 });
  const medium = await probe(`${mock.url}/upload`, { body: 1024 * 1024 });

  // Lie-fi through the network layer.
  await page.route(`${mock.url}/__abort`, (r) => r.abort('internetdisconnected'));
  const routeAbort = await probe(`${mock.url}/__abort`);
  await page.unroute(`${mock.url}/__abort`);

  // A request nobody answers.
  await page.route(`${mock.url}/__hold`, () => undefined);
  const held = await probe(`${mock.url}/__hold`, { waitMs: 3000 });
  await page.unroute(`${mock.url}/__hold`);

  // DNS failure (an `.invalid` name never resolves, RFC 2606).
  const dns = await probe('http://anydrop-no-such-host.invalid/x');

  // Connection refused: stop the server, same port.
  await mock.stop();
  const refused = await probe(`${mock.url}/upload`);
  await mock.restart();

  const all = { small, medium, routeAbort, held, dns, refused };
  console.log(`ENGINE ${browserName} ${JSON.stringify(all)}`);
  testInfo.annotations.push({
    type: `network-behaviour-${testInfo.project.name}`,
    description: JSON.stringify(
      Object.fromEntries(
        Object.entries(all).map(([k, v]) => [
          k,
          `${v.events.join('>') || 'no event'} status=${v.status} ${v.ms}ms upProgress=${v.uploadProgress} upLoadFirst=${v.uploadLoadBeforeResponse}`,
        ]),
      ),
    ),
  });

  // What the connectivity logic relies on.
  for (const [name, p] of Object.entries({ routeAbort, dns, refused })) {
    expect(p.events, `${name} must end in error`).toContain('error');
    expect(p.status, `${name} has no HTTP status`).toBe(0);
  }
  expect(held.events, 'a held request raises no event by itself').toEqual([]);
  expect(small.events).toContain('load');
  expect(small.status).toBe(200);
  expect(medium.status).toBe(200);
  // Not asserted, only recorded: small.uploadProgress, medium.uploadProgress, upLoadFirst, timings.
});
