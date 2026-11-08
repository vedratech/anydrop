// Option diff policy of the framework wrappers (decision 0022, section 3). Framework-free.
import { EVENT_LIST } from './events-map';

type Bag = Record<string, unknown>;
type Path = readonly (string | number)[];

/** Keys read only by the constructor: a later change is ignored (and warned about in development). */
const CONSTRUCTION_ONLY = ['init', 'fallback', 'forceFallback', '_uuid', '_random'];
/** Compared and passed by identity, never cloned. */
const IDENTITY_KEYS = ['transport'];
const MAX_DEPTH = 6;

const isPlain = (v: unknown): v is Bag | unknown[] => {
  if (Array.isArray(v)) return true;
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

/** Structural comparison: functions compare equal, plain data compares by value up to depth 6. */
function same(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (depth >= MAX_DEPTH || !isPlain(a) || !isPlain(b)) return false;
  const aa = Array.isArray(a);
  if (aa !== Array.isArray(b)) return false;
  if (aa) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!same(x[i], y[i], depth + 1)) return false;
    return true;
  }
  const x = a as Bag;
  const y = b as Bag;
  const kx = Object.keys(x);
  if (kx.length !== Object.keys(y).length) return false;
  for (const k of kx) {
    if (!Object.prototype.hasOwnProperty.call(y, k) || !same(x[k], y[k], depth + 1)) return false;
  }
  return true;
}

export interface OptionSync {
  /** The config for the constructor: functions become trampolines, plain data is cloned. */
  initial(config: Bag): Bag;
  /** `[key, value]` pairs for `setOption`, to go from `prev` to `next` (both effective configs). */
  changes(prev: Bag, next: Bag): Array<[string, unknown]>;
}

export function createOptionSync(opts: {
  /** The latest effective config (read when a trampoline runs). */
  latest: () => Record<string, unknown>;
  /** Default option values, to reset a removed key. */
  defaults: () => Record<string, unknown>;
  warn: (message: string) => void;
}): OptionSync {
  const warned: Record<string, true> = {};

  const lookup = (path: Path): unknown => {
    let v: unknown = opts.latest();
    for (const k of path) {
      if (v === null || typeof v !== 'object') return undefined;
      v = (v as Bag)[k as string];
    }
    return v;
  };

  const trampoline = (path: Path) =>
    function (this: unknown, ...args: unknown[]) {
      const f = lookup(path);
      return typeof f === 'function'
        ? (f as (...a: unknown[]) => unknown).apply(this, args)
        : undefined;
    };

  /** A copy that never goes stale: functions look up the same path in the latest config. */
  const stable = (value: unknown, path: Path, depth: number): unknown => {
    if (typeof value === 'function') return trampoline(path);
    if (depth >= MAX_DEPTH || !isPlain(value)) return value;
    if (Array.isArray(value)) return value.map((v, i) => stable(v, path.concat(i), depth + 1));
    const out: Bag = {};
    for (const k of Object.keys(value))
      out[k] = stable((value as Bag)[k], path.concat(k), depth + 1);
    return out;
  };

  const stableKey = (key: string, value: unknown) =>
    IDENTITY_KEYS.indexOf(key) >= 0 ? value : stable(value, [key], 0);

  const warnOnce = (key: string) => {
    if (warned[key]) return;
    warned[key] = true;
    opts.warn(
      `[anydrop] option "${key}" is only read when the instance is created; the change was ignored. Remount the component to apply it.`,
    );
  };

  return {
    initial(config) {
      const out: Bag = {};
      for (const k of Object.keys(config)) {
        if (config[k] !== undefined) out[k] = stableKey(k, config[k]);
      }
      return out;
    },

    changes(prev, next) {
      const out: Array<[string, unknown]> = [];
      for (const key of Object.keys(next)) {
        const value = next[key];
        if (value === undefined) continue;
        const before = prev[key];
        const unchanged =
          IDENTITY_KEYS.indexOf(key) >= 0 ? Object.is(before, value) : same(before, value, 0);
        if (unchanged) continue;
        if (CONSTRUCTION_ONLY.indexOf(key) >= 0) {
          warnOnce(key);
          continue;
        }
        out.push([key, stableKey(key, value)]);
      }
      let defaults: Bag | null = null;
      for (const key of Object.keys(prev)) {
        if (prev[key] === undefined || next[key] !== undefined) continue;
        if (CONSTRUCTION_ONLY.indexOf(key) >= 0) {
          warnOnce(key);
          continue;
        }
        if ((EVENT_LIST as string[]).indexOf(key) >= 0) {
          out.push([key, null]);
        } else {
          defaults = defaults || opts.defaults();
          out.push([key, defaults[key]]);
        }
      }
      return out;
    },
  };
}
