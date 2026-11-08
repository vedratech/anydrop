import 'zone.js';
import 'zone.js/plugins/sync-test';
import 'zone.js/plugins/proxy';
import 'zone.js/testing';

// Run every test and hook body in a ProxyZone, as Angular's TestBed (fakeAsync, waitForAsync) expects.
type Fn = (...args: unknown[]) => unknown;
const g = globalThis as unknown as Record<string, Fn> & {
  Zone: { current: { fork(s: unknown): { run: Fn } }; ProxyZoneSpec: new () => unknown };
};
const proxy = g.Zone.current.fork(new g.Zone.ProxyZoneSpec());
const wrap = (fn: unknown): unknown =>
  typeof fn === 'function'
    ? function (this: unknown, ...args: unknown[]) {
        return (proxy.run as unknown as (f: Fn, t: unknown, a: unknown[]) => unknown)(
          fn as Fn,
          this,
          args,
        );
      }
    : fn;
for (const name of ['it', 'test', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
  const original = g[name] as Fn & Record<string, unknown>;
  const patched = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args.map(wrap));
  } as Fn & Record<string, unknown>;
  Object.assign(patched, original);
  g[name] = patched;
}
