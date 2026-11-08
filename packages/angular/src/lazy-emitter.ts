import { EventEmitter } from '@angular/core';
import type { Subscription } from 'rxjs';

/**
 * An `EventEmitter` that tells its owner when the first subscriber arrives and when the last one
 * leaves, so the core listener behind an output only exists while something listens.
 * Internal, not exported from the package.
 */
export class LazyEmitter<T> extends EventEmitter<T> {
  private count = 0;

  constructor(private readonly onActive: (active: boolean) => void) {
    super();
  }

  override subscribe(observerOrNext?: unknown, error?: unknown, complete?: unknown): Subscription {
    const sub = (super.subscribe as (a?: unknown, b?: unknown, c?: unknown) => Subscription).call(
      this,
      observerOrNext,
      error,
      complete,
    );
    this.count++;
    if (this.count === 1) this.onActive(true);
    let left = false;
    sub.add(() => {
      if (left) return;
      left = true;
      this.count--;
      if (this.count === 0) this.onActive(false);
    });
    return sub;
  }
}
