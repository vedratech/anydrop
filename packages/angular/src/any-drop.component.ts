import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  type ElementRef,
  ErrorHandler,
  EventEmitter,
  Input,
  NgZone,
  Output,
  PLATFORM_ID,
  ViewChild,
  booleanAttribute,
  inject,
  isDevMode,
  type AfterContentChecked,
  type AfterViewInit,
  type EmbeddedViewRef,
  type OnChanges,
  type OnDestroy,
  type TemplateRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDrop, uiDefaults } from '@vedratech/anydrop-ui';
import type { AnyDropConfig, AnyDropRenderHooks, AnyDropRenderView } from '@vedratech/anydrop-ui';
import { LazyEmitter } from './lazy-emitter';
import { ANYDROP_DEFAULTS } from './provide';
import { toPayload, type AnyDropEventPayloads } from './shared/events-map';
import { createOptionSync } from './shared/options-sync';
import {
  AnyDropErrorItemTemplate,
  AnyDropFileTemplate,
  AnyDropFolderTemplate,
  AnyDropMessageTemplate,
  AnyDropToolbarTemplate,
  type AnyDropSlotContext,
} from './templates';
import type { AnyDropInstance } from './types';

/** The events that are outputs: every core event except the 7 DOM-colliding ones (decision 0022, 2.2). */
type OutputEvent = Exclude<
  keyof AnyDropEventPayloads,
  'drop' | 'dragstart' | 'dragend' | 'dragenter' | 'dragover' | 'dragleave' | 'paste'
>;

type SlotKind = 'file' | 'folder' | 'toolbar' | 'message' | 'errorItem';
type Bag = Record<string, unknown>;
type Tpl = TemplateRef<AnyDropSlotContext<unknown>> | null;

const SLOTS: SlotKind[] = ['file', 'folder', 'toolbar', 'message', 'errorItem'];

/**
 * The AnyDrop upload zone. Inputs are diffed into `setOption()`; outputs are the core events,
 * except the 7 drag and paste events, which reach `<any-drop>` as native DOM events.
 *
 * @example
 * <any-drop url="/upload" [options]="options" (success)="onSuccess($event)" />
 */
@Component({
  selector: 'any-drop',
  exportAs: 'anyDrop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #host></div>',
  host: { style: 'display: block' },
})
export class AnyDropComponent implements OnChanges, AfterContentChecked, AfterViewInit, OnDestroy {
  /** Upload endpoint. Overrides `options.url` when set. */
  @Input() url?: AnyDropConfig['url'];
  /** Language pack, or the code of a registered one. Overrides `options.locale` when set. */
  @Input() locale?: AnyDropConfig['locale'];
  /** Theme preset name. Overrides `options.themePreset` when set. */
  @Input() themePreset?: AnyDropConfig['themePreset'];
  /** Row layout. Overrides `options.layout` when set. */
  @Input() layout?: AnyDropConfig['layout'];
  /** Disables (true) or enables (false) the zone. */
  @Input({ transform: booleanAttribute }) disabled = false;
  /** The full configuration. Replace the object to change it; mutation is not detected. */
  @Input() options: AnyDropConfig | null = null;

  /** The live instance, or `null` on the server and before the view is initialised. */
  instance: AnyDropInstance | null = null;

  @ContentChild(AnyDropFileTemplate) private fileTpl?: AnyDropFileTemplate;
  @ContentChild(AnyDropFolderTemplate) private folderTpl?: AnyDropFolderTemplate;
  @ContentChild(AnyDropToolbarTemplate) private toolbarTpl?: AnyDropToolbarTemplate;
  @ContentChild(AnyDropMessageTemplate) private messageTpl?: AnyDropMessageTemplate;
  @ContentChild(AnyDropErrorItemTemplate) private errorItemTpl?: AnyDropErrorItemTemplate;

  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLElement>;

  private readonly zone = inject(NgZone);
  private readonly appRef = inject(ApplicationRef);
  private readonly errorHandler = inject(ErrorHandler);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly defaults = inject(ANYDROP_DEFAULTS, { optional: true });

  private destroyed = false;
  private lastEffective: Bag | null = null;
  private lastDisabled = false;
  private refs: Record<SlotKind, Tpl> = {
    file: null,
    folder: null,
    toolbar: null,
    message: null,
    errorItem: null,
  };
  private readonly hooks: Record<SlotKind, (ctx: unknown) => AnyDropRenderView<unknown> | null> = {
    file: (ctx) => this.mount('file', ctx),
    folder: (ctx) => this.mount('folder', ctx),
    toolbar: (ctx) => this.mount('toolbar', ctx),
    message: (ctx) => this.mount('message', ctx),
    errorItem: (ctx) => this.mount('errorItem', ctx),
  };
  private readonly emitters: Partial<Record<OutputEvent, LazyEmitter<unknown>>> = {};
  private readonly active = new Set<OutputEvent>();
  private readonly offs: Partial<Record<OutputEvent, () => void>> = {};

  private readonly sync = createOptionSync({
    latest: () => this.effective(),
    defaults: () => ({ ...defaultOptions(), ...uiDefaults() }) as Bag,
    warn: (m) => {
      if (isDevMode()) console.warn(m);
    },
  });

  /** Emitted once the instance exists (not a core event; Angular has no ref callback). */
  @Output() readonly ready = new EventEmitter<AnyDropInstance>();

  // One output per core event. Each one attaches its core listener only while it has a subscriber.
  @Output() readonly emptyfolder = this.out('emptyfolder');
  @Output() readonly addedfile = this.out('addedfile');
  @Output() readonly addedfiles = this.out('addedfiles');
  @Output() readonly removedfile = this.out('removedfile');
  @Output() readonly reset = this.out('reset');
  @Output() readonly thumbnail = this.out('thumbnail');
  @Output() readonly error = this.out('error');
  @Output() readonly errormultiple = this.out('errormultiple');
  @Output() readonly maxfilesexceeded = this.out('maxfilesexceeded');
  @Output() readonly maxfilesreached = this.out('maxfilesreached');
  @Output() readonly processing = this.out('processing');
  @Output() readonly processingmultiple = this.out('processingmultiple');
  @Output() readonly uploadprogress = this.out('uploadprogress');
  @Output() readonly totaluploadprogress = this.out('totaluploadprogress');
  @Output() readonly sending = this.out('sending');
  @Output() readonly sendingmultiple = this.out('sendingmultiple');
  @Output() readonly success = this.out('success');
  @Output() readonly successmultiple = this.out('successmultiple');
  @Output() readonly canceled = this.out('canceled');
  @Output() readonly canceledmultiple = this.out('canceledmultiple');
  @Output() readonly complete = this.out('complete');
  @Output() readonly completemultiple = this.out('completemultiple');
  @Output() readonly queuecomplete = this.out('queuecomplete');
  @Output() readonly addedfolder = this.out('addedfolder');
  @Output() readonly removedfolder = this.out('removedfolder');
  @Output() readonly folderprogress = this.out('folderprogress');
  @Output() readonly foldercomplete = this.out('foldercomplete');
  @Output() readonly paused = this.out('paused');
  @Output() readonly resumed = this.out('resumed');
  @Output() readonly offline = this.out('offline');
  @Output() readonly online = this.out('online');
  @Output() readonly reconnecting = this.out('reconnecting');
  @Output() readonly errorlistchanged = this.out('errorlistchanged');
  @Output() readonly actionclicked = this.out('actionclicked');

  ngOnChanges(): void {
    if (this.instance) this.apply(false);
  }

  ngAfterContentChecked(): void {
    const changed = this.readSlots();
    if (changed && this.instance) this.apply(true);
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || this.destroyed) return;
    this.readSlots();
    const effective = this.effective();
    const config = this.sync.initial(effective);
    const host = this.hostRef.nativeElement;
    let instance!: AnyDropInstance;
    // Every ui DOM listener, XHR callback, timer and animation frame is created outside the zone.
    this.zone.runOutsideAngular(() => {
      instance = new AnyDrop(host, config);
      if (this.disabled) instance.disable();
    });
    this.instance = instance;
    this.lastEffective = effective;
    this.lastDisabled = this.disabled;
    this.active.forEach((name) => this.listen(name));
    this.ready.emit(instance);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    (Object.keys(this.offs) as OutputEvent[]).forEach((name) => this.unlisten(name));
    const instance = this.instance;
    this.instance = null;
    if (instance) instance.destroy();
  }

  // ---- options -------------------------------------------------------------------------------

  /** `defaults < options < dedicated inputs`, with the slot hooks merged into `render`. */
  private effective(): Bag {
    const defaults = (this.defaults ?? {}) as Bag;
    const options = (this.options ?? {}) as Bag;
    const eff: Bag = { ...defaults, ...options };
    if (this.url !== undefined) eff['url'] = this.url;
    if (this.locale !== undefined) eff['locale'] = this.locale;
    if (this.themePreset !== undefined) eff['themePreset'] = this.themePreset;
    if (this.layout !== undefined) eff['layout'] = this.layout;
    const render: Bag = {
      ...((defaults['render'] as Bag | undefined) ?? {}),
      ...((options['render'] as Bag | undefined) ?? {}),
    };
    let any = Object.keys(render).length > 0;
    for (const kind of SLOTS) {
      if (this.refs[kind]) {
        render[kind] = this.hooks[kind];
        any = true;
      }
    }
    if (any) eff['render'] = render as AnyDropRenderHooks;
    return eff;
  }

  /** Copies the slot templates into `refs`. True when one appeared, vanished or changed identity. */
  private readSlots(): boolean {
    const next: Record<SlotKind, Tpl> = {
      file: (this.fileTpl?.template as Tpl | undefined) ?? null,
      folder: (this.folderTpl?.template as Tpl | undefined) ?? null,
      toolbar: (this.toolbarTpl?.template as Tpl | undefined) ?? null,
      message: (this.messageTpl?.template as Tpl | undefined) ?? null,
      errorItem: (this.errorItemTpl?.template as Tpl | undefined) ?? null,
    };
    let changed = false;
    for (const kind of SLOTS) {
      if (next[kind] !== this.refs[kind]) changed = true;
    }
    this.refs = next;
    return changed;
  }

  private apply(slotsChanged: boolean): void {
    const instance = this.instance;
    const prev = this.lastEffective;
    if (!instance || !prev) return;
    const next = this.effective();
    this.zone.runOutsideAngular(() => {
      const changes = this.sync.changes(prev, next);
      for (const [key, value] of changes) {
        (instance.setOption as (k: string, v: unknown) => void)(key, value);
      }
      // A template that changed identity (not just presence) must rebuild the rows.
      if (slotsChanged && next['render'] && !changes.some(([key]) => key === 'render')) {
        const render = this.sync.initial({ render: next['render'] })['render'];
        (instance.setOption as (k: string, v: unknown) => void)('render', render);
      }
      if (this.disabled !== this.lastDisabled) {
        if (this.disabled) instance.disable();
        else instance.enable();
      }
    });
    this.lastDisabled = this.disabled;
    this.lastEffective = next;
  }

  // ---- outputs -------------------------------------------------------------------------------

  private out<K extends OutputEvent>(name: K): EventEmitter<AnyDropEventPayloads[K]> {
    const emitter = new LazyEmitter<unknown>((on) => {
      if (on) {
        this.active.add(name);
        if (this.instance) this.listen(name);
      } else {
        this.active.delete(name);
        this.unlisten(name);
      }
    });
    this.emitters[name] = emitter;
    return emitter as unknown as EventEmitter<AnyDropEventPayloads[K]>;
  }

  private listen(name: OutputEvent): void {
    const instance = this.instance;
    if (!instance || this.offs[name]) return;
    this.offs[name] = (instance.on as (n: string, fn: (...args: unknown[]) => void) => () => void)(
      name,
      (...args: unknown[]) => {
        // Handlers run inside the zone, so state they change is rendered by zone.js.
        this.zone.run(() => this.emitters[name]?.emit(toPayload(name, args as never)));
      },
    );
  }

  private unlisten(name: OutputEvent): void {
    const off = this.offs[name];
    if (!off) return;
    delete this.offs[name];
    off();
  }

  // ---- render slots --------------------------------------------------------------------------

  /** Mounts an embedded view of the slot template into a new `<div data-ad-slot>`. */
  private mount(kind: SlotKind, ctx: unknown): AnyDropRenderView<unknown> | null {
    const tpl = this.refs[kind];
    if (!tpl) return null;
    const el = this.hostRef.nativeElement.ownerDocument.createElement('div');
    el.setAttribute('data-ad-slot', kind);
    let view: EmbeddedViewRef<AnyDropSlotContext<unknown>> | null = null;
    try {
      // Inside the zone: listeners added by the view then belong to Angular's zone.
      this.zone.run(() => {
        const v = tpl.createEmbeddedView({
          $implicit: ctx,
        });
        view = v;
        this.appRef.attachView(v);
        for (const node of v.rootNodes as Node[]) el.appendChild(node);
        v.detectChanges();
      });
    } catch (e) {
      this.report(e);
      this.destroyView(view);
      return null;
    }
    return {
      el,
      update: (next: unknown) => {
        try {
          if (!view) return;
          view.context.$implicit = next;
          view.detectChanges();
        } catch (e) {
          this.report(e);
        }
      },
      destroy: () => {
        this.destroyView(view);
        view = null;
      },
    } as AnyDropRenderView<unknown>;
  }

  private destroyView(view: EmbeddedViewRef<unknown> | null): void {
    if (!view) return;
    try {
      view.destroy();
    } catch (e) {
      this.report(e);
    }
  }

  private report(e: unknown): void {
    try {
      this.errorHandler.handleError(e);
    } catch {
      /* a failing error handler must not take the uploader down */
    }
  }
}

/** The component and its five slot directives, for a standalone component's `imports`. */
export const ANYDROP_IMPORTS = [
  AnyDropComponent,
  AnyDropFileTemplate,
  AnyDropFolderTemplate,
  AnyDropToolbarTemplate,
  AnyDropMessageTemplate,
  AnyDropErrorItemTemplate,
] as const;
