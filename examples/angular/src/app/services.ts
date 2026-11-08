import { Injectable, signal } from '@angular/core';

/** A value only a service can provide: shown inside the custom rows to prove DI reaches them. */
@Injectable({ providedIn: 'root' })
export class RowTheme {
  readonly label = 'from-injected-service';
}

/** Counts custom row views, for leak checks (mounts must equal destroys once rows are gone). */
@Injectable({ providedIn: 'root' })
export class SlotCounter {
  readonly mounted = signal(0);
  readonly destroyed = signal(0);
}
