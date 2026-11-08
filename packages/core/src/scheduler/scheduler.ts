// Scheduling helpers: the file queue in add order, the per-file chunk
// limit, the instance-wide request cap, and the round-robin fill across uploading files.
import type { AnyDropCoreOptions } from '../options';

/**
 * Items kept sorted by a sequence number (add order). Appending in order is O(1). An item is held
 * once: a file paused and resumed before it was reached keeps its place.
 */
export class OrderedQueue<T> {
  readonly items: T[] = [];
  private readonly held = new Set<T>();

  constructor(private readonly seq: (item: T) => number) {}

  add(item: T): void {
    if (this.held.has(item)) return;
    this.held.add(item);
    const a = this.items;
    const s = this.seq(item);
    let i = a.length;
    while (i > 0 && this.seq(a[i - 1] as T) > s) i--;
    a.splice(i, 0, item);
  }

  remove(index: number): void {
    this.held.delete(this.items.splice(index, 1)[0] as T);
  }

  clear(): void {
    this.items.length = 0;
    this.held.clear();
  }
}

type Limits = Pick<
  AnyDropCoreOptions,
  'parallelUploads' | 'maxChunksInFlight' | 'parallelChunkUploads'
>;

/** Upload POSTs one file may have in flight (Dropzone 6.3.5: false = 1, true = `parallelUploads`, n = max(1, n)). */
export function perFileLimit(o: Limits): number {
  const p = o.parallelChunkUploads;
  return Math.max(1, p === true ? o.parallelUploads : Number(p) || 1);
}

/** Instance-wide cap on upload POSTs in flight: `maxChunksInFlight`, or none when null. */
export function requestCap(o: Limits): number {
  return o.maxChunksInFlight != null ? Math.max(1, o.maxChunksInFlight) : Infinity;
}

/**
 * Gives free request slots round-robin across `jobs` (in start order): one request per job per
 * pass, starting at index `from` (after the job served last), until `free()` is false or no job can
 * start anything. Returns where the next fill starts.
 */
export function fillRoundRobin<J>(
  jobs: J[],
  from: number,
  free: () => boolean,
  start: (job: J) => boolean,
): number {
  const n = jobs.length;
  for (let started = true; started && n;) {
    started = false;
    for (let k = 0; k < n; k++, from++) {
      if (!free()) return from % n;
      if (start(jobs[from % n] as J)) started = true;
    }
  }
  return n ? from % n : 0;
}
