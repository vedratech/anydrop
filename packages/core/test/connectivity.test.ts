// Connectivity (decision 0017): the stall watchdog, the no-response streak and the `unreachable`
// pause, probing with backoff, `reconnect()`, offline at start, and manifest/finalize pausing.
// All with fake timers and a fixed random (0.5), so delays are exact.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PauseTarget } from '../src/index';
import { URLS, bytesFile, mk, openUploads, sentChunks } from './helpers/m3';
import { okAll, type Call, type FakeTransport } from './helpers/transport';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const BASE = { persistState: false, retryChunksLimit: 2, forceChunking: true, stallTimeout: null };
const PROBE = '/probe';
const ms = (n: number) => vi.advanceTimersByTimeAsync(n);
const heads = (t: FakeTransport) => t.calls.filter((c) => c.req.method === 'HEAD');
const ofKind = (t: FakeTransport, kind: Call['kind']) => t.calls.filter((c) => c.kind === kind);
/** The delay of probe attempt n with the random fixed at 0.5. */
const delay = (n: number) => 0.75 * Math.min(60000, 2000 * 2 ** (n - 1));

function watch(core: ReturnType<typeof mk>['core']) {
  const log: string[] = [];
  const tag = (t: PauseTarget) => (t.scope === 'all' ? t.reason : t.scope);
  core.on('paused', (t) => log.push('paused:' + tag(t)));
  core.on('resumed', (t) => log.push('resumed:' + tag(t)));
  core.on('offline', () => log.push('offline'));
  const re: [number, number][] = [];
  core.on('reconnecting', (a, d) => re.push([a, d]));
  return { log, re };
}

/** Fails every upload request with 'network' while `down.on`; probes and others answer by `onOther`. */
function link(onOther: (c: Call, t: FakeTransport) => void = okAll) {
  const down = { on: true };
  const auto = (c: Call, t: FakeTransport) => {
    if (c.req.method === 'HEAD') return down.on ? c.fail('network') : c.reply(204, '');
    if (c.kind === 'upload' && down.on) return c.fail('network');
    onOther(c, t);
  };
  return { down, auto };
}

describe('stall watchdog', () => {
  it('aborts a request without upload progress for stallTimeout, as STALLED', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...BASE, chunking: false, stallTimeout: 2000 }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await ms(0);
    const c = openUploads(t)[0]!;
    await ms(4900);
    expect(c.aborted).toBe(false); // the check runs about every 5 s
    await ms(200);
    expect(c.aborted).toBe(true);
    expect(f.status).toBe('error'); // a whole file is not retried
    expect(core.getErrors()[0]).toMatchObject({ code: 'STALLED', stage: 'upload' });
    core.destroy();
  });

  it('upload progress resets the clock; a fully sent body may wait 4 x stallTimeout for the response', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...BASE, chunking: false, stallTimeout: 2000 }, null);
    core.addFile(bytesFile('a.bin', 20));
    await ms(0);
    const c = openUploads(t)[0]!;
    await ms(4000);
    c.progress(5, 20);
    await ms(1000); // tick at 5 s: 1 s since the last progress
    expect(c.aborted).toBe(false);
    c.progress(20, 20); // body sent at 5 s: waits up to 8 s for the response
    await ms(5000); // tick at 10 s: 5 s
    expect(c.aborted).toBe(false);
    await ms(5000); // tick at 15 s: 10 s > 8 s
    expect(c.aborted).toBe(true);
    core.destroy();
  });

  it('a stalled chunk is retried like a network failure', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...BASE, stallTimeout: 2000 }, null);
    const f = core.addFile(bytesFile('a.bin', 20));
    await ms(0);
    await ms(5100); // stalled at the tick
    await ms(3000); // backoff
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0]);
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('stallTimeout: null turns it off, and the timer runs only while requests are in flight', async () => {
    vi.useFakeTimers();
    const off = mk({ ...BASE, chunking: false, stallTimeout: null }, null);
    off.core.addFile(bytesFile('a.bin', 20));
    await ms(0);
    await ms(300000);
    expect(openUploads(off.t)[0]!.aborted).toBe(false);
    off.core.destroy();

    const on = mk({ ...BASE, chunking: false, stallTimeout: 2000 });
    const f = on.core.addFile(bytesFile('a.bin', 20));
    await ms(10);
    expect(f.status).toBe('success');
    expect(vi.getTimerCount()).toBe(0); // idle: no watchdog timer
    on.core.destroy();
  });

  it('checks at once when the page becomes visible', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...BASE, chunking: false, stallTimeout: 2000 }, null);
    core.addFile(bytesFile('a.bin', 20));
    await ms(0);
    const c = openUploads(t)[0]!;
    vi.setSystemTime(Date.now() + 60000); // a throttled or suspended page: the timer did not run
    document.dispatchEvent(new Event('visibilitychange'));
    expect(c.aborted).toBe(true);
    core.destroy();
  });
});

describe('unreachable (lie-fi)', () => {
  it('the first two failures retry; the third pauses with no retry used and no error entry', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, retryChunksLimit: 2, chunking: true }, l.auto);
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10)); // one chunk
    await ms(3000); // fail, retry after the backoff
    await ms(3000);
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0, 0]); // 1st + 2 retries
    expect(w.log).toEqual(['paused:unreachable']);
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    expect(core.getConnectionState()).toMatchObject({ state: 'unreachable', attempt: 1 });
    expect(w.re).toEqual([[1, delay(1)]]);

    // The probe is the failed request itself (no probe url): it is sent again, and a response ends it.
    l.down.on = false;
    await ms(delay(1) + 10);
    expect(f.status).toBe('success');
    expect(w.log).toEqual(['paused:unreachable', 'resumed:unreachable']);
    expect(core.getConnectionState()).toEqual({ state: 'online', attempt: 0, retryAt: null });
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('server errors (5xx, 429) are responses: they never count, and they reset the streak', async () => {
    vi.useFakeTimers();
    const { core, t } = mk({ ...BASE, retryChunksLimit: 9, chunking: true }, null);
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(0);
    const step = async (fn: (c: Call) => void) => {
      fn(openUploads(t)[0]!);
      await ms(30000);
    };
    await step((c) => c.fail('network'));
    await step((c) => c.fail('network'));
    await step((c) => c.reply(500, { code: 'BOOM' })); // a response: the streak starts again
    await step((c) => c.fail('network'));
    await step((c) => c.fail('network'));
    await step((c) => c.reply(429, {}, { 'Retry-After': '1' }));
    await step((c) => c.reply(503, {}));
    expect(w.log).toEqual([]);
    expect(core.getConnectionState().state).toBe('online');
    openUploads(t)[0]!.reply();
    await ms(10);
    expect(f.status).toBe('success');
    core.destroy();
  });

  it('probe order: HEAD connectivityProbeUrl first', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk(
      { ...BASE, connectivityProbeUrl: PROBE, chunkStatusUrl: URLS.chunkStatusUrl },
      l.auto,
    );
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    expect(heads(t)).toHaveLength(0); // not before the delay
    await ms(700);
    expect(heads(t)).toHaveLength(1);
    expect(heads(t)[0]!.req.url).toBe(PROBE);
    expect(heads(t)[0]!.req.withCredentials).toBe(false);
    expect(ofKind(t, 'status')).toHaveLength(0);
    l.down.on = false;
    await ms(delay(2) + 100);
    expect(f.status).toBe('success');
    core.destroy();
  });

  it('probe order: GET chunkStatusUrl for the failed file when there is no probe url', async () => {
    vi.useFakeTimers();
    const l = link((c) => (c.kind === 'status' ? c.reply(404, {}) : okAll(c)));
    const { core, t } = mk({ ...BASE, chunkStatusUrl: URLS.chunkStatusUrl }, l.auto);
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    expect(core.getConnectionState().state).toBe('unreachable');
    const id = f.upload.uuid;
    l.down.on = false;
    await ms(delay(1));
    const status = ofKind(t, 'status')[0]!;
    expect(status.req.method).toBe('GET');
    expect(status.req.url).toBe(`${URLS.chunkStatusUrl}?uploadId=${id}`);
    await ms(100);
    expect(f.status).toBe('success'); // a 404 is a response: reachable
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('probe backoff: random(0.5, 1) x min(60 s, 2 s x 2^(n-1)); reconnecting before each wait; no attempt limit', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, connectivityProbeUrl: PROBE }, l.auto);
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    // A long outage: more than 2 minutes of failing probes.
    await ms(240000);
    expect(w.re.slice(0, 7).map(([, d]) => d)).toEqual([1, 2, 3, 4, 5, 6, 7].map(delay));
    expect(w.re.map(([a]) => a)).toEqual(w.re.map((_, i) => i + 1));
    expect(delay(7)).toBe(45000); // the cap
    expect(heads(t).length).toBeGreaterThanOrEqual(7);
    expect(core.getConnectionState().retryAt).toBeGreaterThan(Date.now());
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    expect(w.log).toEqual(['paused:unreachable']); // no resumed and no extra paused

    l.down.on = false;
    await ms(60000);
    expect(f.status).toBe('success');
    expect(w.log).toEqual(['paused:unreachable', 'resumed:unreachable']);
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('reconnect() probes at once; online and visible do too; it does nothing when online', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, connectivityProbeUrl: PROBE }, l.auto);
    core.reconnect();
    await ms(0);
    expect(t.calls).toHaveLength(0); // online: nothing happens
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    expect(heads(t)).toHaveLength(0);
    core.reconnect();
    expect(heads(t)).toHaveLength(1); // at once, not after the delay
    await ms(10);
    window.dispatchEvent(new Event('online'));
    expect(heads(t)).toHaveLength(2);
    await ms(10);
    l.down.on = false;
    core.reconnect();
    await ms(100);
    expect(f.status).toBe('success');
    core.destroy();
  });

  it('"Retry now" resumes the others and leaves a folder the user paused', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core } = mk({ ...BASE, connectivityProbeUrl: PROBE, parallelUploads: 2 }, l.auto);
    const a = core.addFile(bytesFile('a.bin', 10), 'A');
    const b = core.addFile(bytesFile('b.bin', 10), 'B');
    await ms(6100);
    expect(core.getConnectionState().state).toBe('unreachable');
    core.pauseFolder('B');
    l.down.on = false;
    core.reconnect();
    await ms(100);
    expect(a.status).toBe('success');
    expect(b.status).toBe('paused');
    core.destroy();
  });

  it('a file and a folder the user pauses during the outage stay paused after the probe succeeds and after reconnect() (0019)', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, connectivityProbeUrl: PROBE, parallelUploads: 5 }, l.auto);
    const w = watch(core);
    const a = core.addFile(bytesFile('a.bin', 10), 'A');
    const b = core.addFile(bytesFile('b.bin', 10), 'B');
    const c = core.addFile(bytesFile('c.bin', 10), 'C');
    const d = core.addFile(bytesFile('d.bin', 10), 'D');
    await ms(6100);
    expect(core.getConnectionState().state).toBe('unreachable');
    expect([a, b, c, d].map((f) => f.status)).toEqual(['paused', 'paused', 'paused', 'paused']);

    core.pauseFile(a);
    core.pauseFolder('B');
    const sent = (f: { upload: { uuid: string } }) => sentChunks(t, f.upload.uuid).length;
    const before = [a, b].map(sent);

    // "Retry now" while the link is still down: the probe fails and nothing changes.
    core.reconnect();
    await ms(10);
    expect(core.getConnectionState().state).toBe('unreachable');
    expect([a, b].map(sent)).toEqual(before);

    // The link returns and "Retry now" goes through: the others finish, the user pauses stay.
    l.down.on = false;
    core.reconnect();
    await ms(200);
    expect(core.getConnectionState().state).toBe('online');
    expect(w.log).toContain('resumed:unreachable');
    expect(c.status).toBe('success');
    expect(d.status).toBe('success');
    expect(a.status).toBe('paused');
    expect(b.status).toBe('paused');
    expect([a, b].map(sent)).toEqual(before); // no request for them
    core.reconnect(); // online: does nothing, and never clears a user pause
    await ms(100);
    expect([a.status, b.status]).toEqual(['paused', 'paused']);
    expect([a, b].map(sent)).toEqual(before);
    expect(core.getErrors()).toEqual([]);

    // Only the user lifts them.
    core.resumeFile(a);
    core.resumeFolder('B');
    await ms(200);
    expect([a.status, b.status]).toEqual(['success', 'success']);
    core.destroy();
  });

  it('a file and a folder the user pauses during the outage stay paused when the timed probe succeeds (0019)', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, connectivityProbeUrl: PROBE, parallelUploads: 5 }, l.auto);
    const a = core.addFile(bytesFile('a.bin', 10), 'A');
    const b = core.addFile(bytesFile('b.bin', 10), 'B');
    const c = core.addFile(bytesFile('c.bin', 10), 'C');
    await ms(6100);
    expect(core.getConnectionState().state).toBe('unreachable');
    core.pauseFile(a);
    core.pauseFolder('B');
    const before = [a, b].map((f) => sentChunks(t, f.upload.uuid).length);
    l.down.on = false;
    await ms(delay(3) + 200); // the scheduled probe (the third, three files failed at once), not reconnect()
    expect(core.getConnectionState().state).toBe('online');
    expect(c.status).toBe('success');
    expect([a.status, b.status]).toEqual(['paused', 'paused']);
    expect([a, b].map((f) => sentChunks(t, f.upload.uuid).length)).toEqual(before);
    core.destroy();
  });

  it('autoResumeOnReconnect: false never probes by itself; reconnect() still does', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk(
      { ...BASE, connectivityProbeUrl: PROBE, autoResumeOnReconnect: false },
      l.auto,
    );
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    await ms(120000);
    expect(heads(t)).toHaveLength(0);
    expect(w.re).toEqual([]);
    expect(f.status).toBe('paused');
    l.down.on = false;
    core.reconnect();
    await ms(100);
    expect(f.status).toBe('success');
    core.destroy();
  });

  it('a user resume() clears the state and sends at once; a failure right after pauses again with no retry used', async () => {
    vi.useFakeTimers();
    const l = link();
    const { core, t } = mk({ ...BASE, connectivityProbeUrl: PROBE }, l.auto);
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10));
    await ms(6100);
    core.resume();
    expect(core.getConnectionState().state).toBe('online');
    await ms(1100); // the grace period, then the failure goes straight back to unreachable
    expect(f.status).toBe('paused');
    expect(core.getErrors()).toEqual([]);
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 0, 0, 0]);
    expect(w.log).toEqual(['paused:unreachable', 'resumed:user', 'paused:unreachable']);
    core.destroy();
  });

  it('a request that can never succeed while the server answers ends in error; the others finish', async () => {
    vi.useFakeTimers();
    const { core } = mk(
      { ...BASE, retryChunksLimit: 2, connectivityProbeUrl: PROBE, parallelUploads: 2 },
      (c) => {
        if (c.req.method === 'HEAD') return c.reply(204, '');
        if (c.kind === 'upload' && c.field('adRelativePath') === 'bad.bin')
          return c.fail('network');
        okAll(c);
      },
    );
    const bad = core.addFile(bytesFile('bad.bin', 10));
    const good = core.addFile(bytesFile('good.bin', 10));
    await ms(120000);
    expect(good.status).toBe('success');
    expect(bad.status).toBe('error');
    expect(core.getErrors().map((e) => [e.relativePath, e.code])).toEqual([['bad.bin', 'NETWORK']]);
    expect(core.getConnectionState().state).toBe('online');
    core.destroy();
  });
});

describe('offline at start', () => {
  it('processQueue() while navigator.onLine is false pauses at once: paused event, no offline event, nothing sent', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { core, t } = mk(BASE);
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 20));
    await ms(100);
    expect(w.log).toEqual(['paused:offline']);
    expect(f.status).toBe('paused');
    expect(t.calls).toHaveLength(0);
    expect(core.getErrors()).toEqual([]);
    expect(core.getConnectionState().state).toBe('offline');
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await ms(100);
    expect(f.status).toBe('success');
    expect(w.log).toEqual(['paused:offline', 'resumed:offline']);
    core.destroy();
  });
});

describe('manifest, status and finalize', () => {
  it('a manifest that fails offline waits and is sent again; the batch never fails', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { core, t } = mk(
      { ...BASE, sendManifest: true, manifestUrl: URLS.manifestUrl, retryChunksLimit: 0 },
      null,
    );
    const f = core.addFile(bytesFile('a.bin', 10), 'D');
    await ms(0);
    expect(ofKind(t, 'manifest')).toHaveLength(1);
    online.mockReturnValue(false);
    ofKind(t, 'manifest')[0]!.fail('network');
    await ms(5000);
    expect(core.getErrors()).toEqual([]);
    expect(ofKind(t, 'manifest')).toHaveLength(1);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await ms(10);
    expect(ofKind(t, 'manifest')).toHaveLength(2); // same attempt count (limit 0 would have failed)
    ofKind(t, 'manifest')[1]!.reply();
    await ms(10);
    openUploads(t)[0]!.reply();
    await ms(10);
    expect(f.status).toBe('success');
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });

  it('a manifest in a lost connection (unreachable) pauses and is sent again with the same attempt count', async () => {
    vi.useFakeTimers();
    let manifests = 0;
    const { core, t } = mk(
      { ...BASE, sendManifest: true, manifestUrl: URLS.manifestUrl, retryChunksLimit: 2 },
      (c) => {
        if (c.kind === 'manifest' && ++manifests <= 3) return c.fail('network');
        okAll(c);
      },
    );
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 10), 'D');
    await ms(20000);
    expect(w.log).toEqual(['paused:unreachable', 'resumed:unreachable']);
    expect(f.status).toBe('success');
    expect(core.getErrors()).toEqual([]);
    expect(ofKind(t, 'manifest').length).toBe(4);
    core.destroy();
  });

  it('a finalize in a lost connection pauses the file until it goes through', async () => {
    vi.useFakeTimers();
    let finalizes = 0;
    const { core, t } = mk({ ...BASE, finalizeUrl: URLS.finalizeUrl, retryChunksLimit: 2 }, (c) => {
      if (c.kind === 'finalize' && ++finalizes <= 3) return c.fail('network');
      okAll(c);
    });
    const w = watch(core);
    const f = core.addFile(bytesFile('a.bin', 20));
    await ms(6000);
    expect(f.status).toBe('paused');
    expect(w.log).toEqual(['paused:unreachable']);
    expect(core.getErrors()).toEqual([]);
    await ms(delay(1));
    expect(f.status).toBe('success');
    expect(sentChunks(t, f.upload.uuid)).toEqual([0, 1]); // no chunk was sent again
    expect(core.getErrors()).toEqual([]);
    core.destroy();
  });
});
