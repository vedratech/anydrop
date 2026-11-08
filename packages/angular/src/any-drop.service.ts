import {
  Injectable,
  NgZone,
  PLATFORM_ID,
  computed,
  inject,
  isDevMode,
  signal,
  type OnDestroy,
  type Signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AnyDropCore, defaultOptions } from '@vedratech/anydrop-core';
import type { AnyDropCoreConfig, AnyDropEventName } from '@vedratech/anydrop-core';
import { Observable } from 'rxjs';
import { ANYDROP_DEFAULTS } from './provide';
import { toPayload, type AnyDropEventPayload } from './shared/events-map';
import { createOptionSync } from './shared/options-sync';
import {
  SERVER_STATE,
  createStateStore,
  type AnyDropState,
  type AnyDropStateStore,
} from './shared/state-store';

type Bag = Record<string, unknown>;

interface Attachment {
  attach(core: AnyDropCore): void;
  detach(): void;
}

/**
 * A headless AnyDrop (the core engine, no UI) with Observables and signals. Not `providedIn: 'root'`:
 * add it to a component's `providers`, which also ties the instance to that component's lifetime.
 *
 * The instance is created only in the browser. On the server `create()` returns `null` and the
 * signals keep their server values.
 */
@Injectable()
export class AnyDropService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly defaults = inject(ANYDROP_DEFAULTS, { optional: true });

  private core: AnyDropCore | null = null;
  private store: AnyDropStateStore | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private lastEffective: Bag | null = null;
  private latestEffective: Bag = {};
  private readonly attachments = new Set<Attachment>();

  private readonly instanceSignal = signal<AnyDropCore | null>(null);
  private readonly stateSignal = signal<AnyDropState>(SERVER_STATE);

  private readonly sync = createOptionSync({
    latest: () => this.latestEffective,
    defaults: () => defaultOptions() as unknown as Bag,
    warn: (m) => {
      if (isDevMode()) console.warn(m);
    },
  });

  /** The core instance, or `null` before `create()` and on the server. */
  readonly instance: Signal<AnyDropCore | null> = this.instanceSignal.asReadonly();
  /** Files, tree, errors, progress and connection, rebuilt at most once per animation frame. */
  readonly state: Signal<AnyDropState> = this.stateSignal.asReadonly();
  readonly files = computed(() => this.stateSignal().files);
  /** The live root of the folder tree: its identity does not change, so this signal always notifies. */
  readonly tree = computed(() => this.stateSignal().tree, { equal: () => false });
  readonly errors = computed(() => this.stateSignal().errors);
  readonly progress = computed(() => this.stateSignal().progress);
  readonly connection = computed(() => this.stateSignal().connection);

  /** Creates the instance (browser only; a previous one is destroyed). Returns it, or `null` on the server. */
  create(options: AnyDropCoreConfig = {}): AnyDropCore | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    this.teardown();
    const effective = { ...((this.defaults ?? {}) as Bag), ...(options as Bag) };
    this.latestEffective = effective;
    this.lastEffective = effective;
    const config = this.sync.initial(effective);
    let core!: AnyDropCore;
    this.zone.runOutsideAngular(() => {
      core = new AnyDropCore(config as AnyDropCoreConfig);
    });
    this.core = core;
    const store = createStateStore(core);
    this.store = store;
    // Signals are set inside the zone so that zone.js based apps render the change.
    this.unsubscribeStore = store.subscribe(() =>
      this.zone.run(() => this.stateSignal.set(store.getSnapshot())),
    );
    this.stateSignal.set(store.getSnapshot());
    this.instanceSignal.set(core);
    this.attachments.forEach((a) => a.attach(core));
    return core;
  }

  /** Applies changed options with `setOption()` (the same diff policy as `<any-drop>`). */
  setOptions(options: AnyDropCoreConfig): void {
    const core = this.core;
    const prev = this.lastEffective;
    if (!core || !prev) return;
    const next = { ...((this.defaults ?? {}) as Bag), ...(options as Bag) };
    this.latestEffective = next;
    this.zone.runOutsideAngular(() => {
      for (const [key, value] of this.sync.changes(prev, next)) {
        (core.setOption as (k: string, v: unknown) => void)(key, value);
      }
    });
    this.lastEffective = next;
  }

  /**
   * An Observable of one event. The core listener exists while there are subscribers; subscribing
   * before `create()` works and starts delivering once the instance exists. Emits inside the zone.
   */
  on$<K extends AnyDropEventName>(event: K): Observable<AnyDropEventPayload<K>> {
    return new Observable<AnyDropEventPayload<K>>((subscriber) => {
      let off: (() => void) | null = null;
      const attachment: Attachment = {
        attach: (core) => {
          if (off) return;
          off = (core.on as (n: string, fn: (...a: unknown[]) => void) => () => void)(
            event,
            (...args: unknown[]) =>
              this.zone.run(() => subscriber.next(toPayload(event, args as never))),
          );
        },
        detach: () => {
          if (off) off();
          off = null;
        },
      };
      this.attachments.add(attachment);
      if (this.core) attachment.attach(this.core);
      return () => {
        attachment.detach();
        this.attachments.delete(attachment);
      };
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  private teardown(): void {
    this.attachments.forEach((a) => a.detach());
    if (this.unsubscribeStore) this.unsubscribeStore();
    this.unsubscribeStore = null;
    if (this.store) this.store.destroy();
    this.store = null;
    const core = this.core;
    this.core = null;
    this.lastEffective = null;
    if (core) core.destroy();
    if (this.instanceSignal() !== null) {
      this.instanceSignal.set(null);
      this.stateSignal.set(SERVER_STATE);
    }
  }
}
