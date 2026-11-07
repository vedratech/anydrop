// Event rate helpers (0006): a per-key trailing throttle (folderprogress, 100 ms) and a
// microtask merge (errorlistchanged). Timers are created only when used, and `clear()` removes
// them (destroy()).

export class KeyedThrottle<K> {
  private timers = new Map<K, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ms: number,
    private readonly fire: (key: K) => void,
  ) {}

  /** Schedules `fire(key)` at the end of the window. `now: true` fires at once (progress 100). */
  request(key: K, now = false): void {
    const t = this.timers.get(key);
    if (now) {
      if (t !== undefined) {
        clearTimeout(t);
        this.timers.delete(key);
      }
      this.fire(key);
    } else if (t === undefined) {
      this.timers.set(
        key,
        setTimeout(() => {
          this.timers.delete(key);
          this.fire(key);
        }, this.ms),
      );
    }
  }

  /** Whether `fire(key)` is scheduled. */
  pending(key: K): boolean {
    return this.timers.has(key);
  }

  /** Drops every scheduled call. */
  clear(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }
}

/** Returns a function that runs `fn` once at the end of the current microtask, however often it is called. */
export function microtaskMerge(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    void Promise.resolve().then(() => {
      queued = false;
      fn();
    });
  };
}
