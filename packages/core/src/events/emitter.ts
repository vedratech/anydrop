// Typed event emitter. Listeners run with `this` bound to the instance, `emit` iterates over a
// snapshot, and `off()` / `off(name)` / `off(name, fn)` remove listeners. `on()` returns an
// unsubscribe function that also carries `on` and `once` for chaining, and a listener that
// throws is reported without stopping the other listeners.
import { reportError } from '../util/env';

export type Listener<A extends unknown[]> = (...args: A) => void;

/** Returned by `on()` / `once()`: call it to remove the listener, or chain `.on()` / `.once()`. */
export interface Unsubscribe<Self> {
  (): void;
  /** Adds another listener and returns the same kind of function (chaining). */
  on: Self extends { on: infer F } ? F : never;
  /** Adds a listener that runs once and returns the same kind of function (chaining). */
  once: Self extends { once: infer F } ? F : never;
}

type Stored = Listener<unknown[]> & { _fn?: unknown };

export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private _callbacks: { [K in keyof E]?: Stored[] } = {};

  /** Adds a listener. Returns a function that removes it (and chains `.on()` / `.once()`). */
  on<K extends keyof E>(event: K, fn: Listener<E[K]>): Unsubscribe<this> {
    (this._callbacks[event] || (this._callbacks[event] = [])).push(fn as Stored);
    return this.unsubscribe(event, fn);
  }

  /** Adds a listener that runs once. Returns a function that removes it. */
  once<K extends keyof E>(event: K, fn: Listener<E[K]>): Unsubscribe<this> {
    const off = () => this.off(event, fn);
    const wrapper = function (this: unknown, ...args: E[K]) {
      off();
      fn.apply(this, args);
    } as Stored;
    wrapper._fn = fn;
    (this._callbacks[event] || (this._callbacks[event] = [])).push(wrapper);
    return this.unsubscribe(event, fn);
  }

  /** `off()` removes every listener, `off(event)` every listener of one event. Also matches `once()` listeners. */
  off<K extends keyof E>(event?: K, fn?: Listener<E[K]>): this {
    if (event === undefined) {
      this._callbacks = {};
    } else if (fn === undefined) {
      delete this._callbacks[event];
    } else {
      const list = this._callbacks[event] || [];
      for (let i = 0; i < list.length; i++) {
        const l = list[i] as Stored;
        if (l === fn || l._fn === fn) {
          list.splice(i, 1);
          break;
        }
      }
    }
    return this;
  }

  /** Emits an event; every listener runs with `this` set to the instance. Returns the instance. */
  emit<K extends keyof E>(event: K, ...args: E[K]): this {
    const list = this._callbacks[event];
    if (list && list.length) {
      for (const fn of list.slice()) {
        try {
          fn.apply(this, args);
        } catch (error) {
          this.onListenerError(error);
        }
      }
    }
    return this;
  }

  /** Whether anyone listens to `event` (lets hot paths skip building payloads). */
  hasListeners<K extends keyof E>(event: K): boolean {
    const list = this._callbacks[event];
    return !!list && list.length > 0;
  }

  /** Called when a listener throws. Overridable (tests). */
  protected onListenerError(error: unknown): void {
    reportError(error);
  }

  /** Builds the function returned by `on()`/`once()`. Protected for subclasses; do not shadow it. */
  protected unsubscribe<K extends keyof E>(event: K, fn: Listener<E[K]>): Unsubscribe<this> {
    const u = (() => {
      this.off(event, fn);
    }) as Unsubscribe<this>;
    u.on = this.on.bind(this) as Unsubscribe<this>['on'];
    u.once = this.once.bind(this) as Unsubscribe<this>['once'];
    return u;
  }
}
