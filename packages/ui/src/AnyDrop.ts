// AnyDrop: the UI on top of AnyDropCore. It listens to core events and calls core
// methods; it never reimplements engine logic. All UI-only state lives in `_ui*` fields so nothing
// can collide with core members.
import {
  AnyDropCore,
  defaultOptions,
  type AnyDropEventName,
  type AnyDropEvents,
  type AnyDropFile,
  type AnyDropCoreConfig,
  type AnyDropOptions,
  type ErrorEntry,
  type FolderNode,
} from '@vedratech/anydrop-core';
import { fmt, frame, h, Listeners, mark, resolve, textBtn } from './dom';
import { scaleBlob } from './image';
import { isFolder, RowList } from './list';
import {
  type AnyDropConfig,
  type AnyDropFullOptions,
  type AnyDropUIOptions,
  type ElementRef,
  uiDefaults,
} from './options';
import { Banner, type Conn, ErrorPanel, Toolbar } from './panels';
import type { AnyDropLocale, AnyDropMessageContext } from './types';
import { type Item, type MockFile, Previews } from './preview';
import { baseContext, destroyView, type Mounted, runHook, updateView } from './render';

/** Methods that arrive with core M3. Called only when present. */
interface Later {
  pause?(): void;
  resume?(): void;
  pauseFolder?(path: string): void;
  resumeFolder?(path: string): void;
  pauseFile?(file: AnyDropFile): void;
  resumeFile?(file: AnyDropFile): void;
  cancelFolder?(path: string): void;
  retryFailedOnly?(path?: string): number;
  retryFile?(file: AnyDropFile): void;
  reconnect?(): void;
}

type Target = FolderNode | Item;
const msgKey = (c: AnyDropMessageContext) =>
  JSON.stringify([c.text, c.touch, c.dragging, c.disabled, c.maxFilesReached, c.hasFiles]);
const ACTIVE = /^(added|queued|uploading|paused)$/;

const camelize = (str: string) => str.replace(/[-_](\w)/g, (m) => m.charAt(1).toUpperCase());
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Deep merge: nested plain objects are merged, everything else is replaced. */
function merge(into: Record<string, unknown>, from: unknown): void {
  if (!from) return;
  for (const k in from as object) {
    const v = (from as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (plain(v) && plain(into[k])) merge(into[k] as Record<string, unknown>, v);
    else if (plain(v)) {
      const c: Record<string, unknown> = {};
      merge(c, v);
      into[k] = c;
    } else into[k] = v;
  }
}

/** The language pack an option value stands for: an object, or a registered code (`null` and `en` = English). */
function pickLocale(v: unknown, warn = false): AnyDropLocale | null {
  if (!v || v === 'en') return null;
  if (typeof v !== 'string') return v as AnyDropLocale;
  const l = AnyDrop.locales[v];
  if (!l && warn && typeof console !== 'undefined') {
    console.warn(`[anydrop] Unknown locale "${v}": using English. Load or register it first.`);
  }
  return l || null;
}

/** Options registered for an element id with `AnyDrop.options`; `false` disables auto-discovery. */
function presetFor(el: HTMLElement): AnyDropConfig | false | undefined {
  return el.id ? AnyDrop.options[camelize(el.id)] : undefined;
}

function prepare(element: string | HTMLElement, config: AnyDropConfig): AnyDropConfig {
  const el = resolve(element);
  if (!el) throw new Error('Invalid AnyDrop element.');
  if ((el as { anydrop?: unknown }).anydrop)
    throw new Error('AnyDrop is already attached to this element.');
  const out: Record<string, unknown> = {};
  const own: Record<string, unknown> = {};
  merge(own, presetFor(el) || undefined);
  merge(own, config);
  // English, then the language pack, then the texts the developer set.
  merge(out, uiDefaults());
  merge(out, pickLocale(own.locale, true)?.dict);
  merge(out, own);
  // A transport keeps its identity (it may hold state), even when it is a plain object.
  const preset = presetFor(el) || undefined;
  const transport = config.transport !== undefined ? config.transport : preset?.transport;
  if (transport !== undefined) out.transport = transport;
  const pc = out.previewsContainer;
  if (typeof pc === 'string' && !resolve(pc))
    throw new Error('Invalid `previewsContainer` option provided.');
  const cl = out.clickable;
  if (
    cl !== true &&
    cl !== false &&
    cl != null &&
    !clickables(el, cl as AnyDropUIOptions['clickable']).length
  ) {
    throw new Error(
      'Invalid `clickable` option provided. Please set it to true, a selector or an element.',
    );
  }
  // The url comes from a <form action> when not given (the check itself comes later).
  if (!out.url) out.url = el.getAttribute('action');
  return out as AnyDropConfig;
}

/** The elements a `clickable` option stands for (selectors use `querySelectorAll`). */
function clickables(el: HTMLElement, c: AnyDropUIOptions['clickable']): HTMLElement[] {
  if (c === false) return [];
  const out: HTMLElement[] = [];
  for (const r of c === true ? [el] : Array.isArray(c) ? c : [c as ElementRef]) {
    if (typeof r === 'string') {
      document.querySelectorAll<HTMLElement>(r).forEach((x) => out.push(x));
    } else if (r && r.nodeType === 1) out.push(r);
  }
  return out;
}

/**
 * The AnyDrop UI: a drop zone with file and folder pickers, a folder tree, a toolbar, an error panel,
 * thumbnails and a mobile layout. It extends `AnyDropCore`, so every core option, method and event works.
 *
 * @example
 * ```ts
 * const ad = new AnyDrop('#uploader', { url: '/upload', chunking: true });
 * ad.on('queuecomplete', () => console.log(ad.getErrors()));
 * ```
 */
export class AnyDrop extends AnyDropCore {
  /** Options per element id (camelCased), used when an element is attached: `AnyDrop.options.myId = { ... }`. */
  static options: Record<string, AnyDropConfig | false> = {};
  /** Every live instance (removed again by `destroy()`). */
  static instances: AnyDrop[] = [];
  /** Language packs by code. The CDN files `dist/locales/<code>.global.js` fill it; you can register your own. */
  static locales: Record<string, AnyDropLocale> = {};
  /** Read by the CDN build only: set it to `false` right after the script tag to stop auto-discovery. */
  static autoDiscover = true;

  /**
   * Attaches an instance to every `.anydrop` element
   * that has none and whose `AnyDrop.options[id]` is not `false`. Returns the new instances. It only
   * runs when called; the npm builds never call it by themselves.
   */
  static discover(root: ParentNode = document): AnyDrop[] {
    const made: AnyDrop[] = [];
    root.querySelectorAll<HTMLElement>('.anydrop').forEach((el) => {
      if ((el as { anydrop?: unknown }).anydrop || presetFor(el) === false) return;
      made.push(new AnyDrop(el));
    });
    return made;
  }

  /** Asks a question: `window.confirm`, overridable (for example with a dialog). */
  static confirm(question: string, accepted: () => void, rejected?: () => void): void {
    if (window.confirm(question)) accepted();
    else if (rejected) rejected();
  }

  /** The instance attached to an element. */
  static forElement(element: string | HTMLElement): AnyDrop {
    const e = resolve(element) as (HTMLElement & { anydrop?: AnyDrop }) | null;
    if (!e || !e.anydrop) throw new Error('No AnyDrop found for given element.');
    return e.anydrop;
  }

  /** Whether the APIs the UI needs exist. */
  static isBrowserSupported(): boolean {
    const w = globalThis as unknown as Record<string, unknown>;
    return !!(
      w.File &&
      w.FileReader &&
      w.FileList &&
      w.Blob &&
      w.FormData &&
      w.document &&
      'classList' in document.createElement('a') &&
      document.querySelector
    );
  }

  /** Feature detection for the folder picker (no user-agent sniffing). */
  static supportsFolderPicker(): boolean {
    return typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');
  }

  declare readonly options: AnyDropFullOptions & AnyDropOptions;
  /** The element the instance is attached to. */
  readonly element: HTMLElement;

  /** @internal */ readonly _uiPreviews: Previews;
  /** @internal */ readonly _uiExtras: MockFile[] = [];
  /** @internal */ readonly _uiErrors = new Map<string, ErrorEntry>();
  /** @internal */ _uiPausedAll = false;
  /** @internal */ _uiTotal = 0;
  /** @internal Connection state of core (`online` where core has no connectivity API yet). */
  _uiConn = 'online';
  /** @internal Paused by `pause()` (user reason), not by the system. */
  _uiUserAll = false;
  /** @internal Files paused by `pauseFile()`. */
  readonly _uiUserFiles = new WeakSet<object>();
  private _uiBanner: Banner | null = null;
  private _uiList: RowList | null = null;
  private _uiToolbar: Toolbar | null = null;
  private _uiErrorPanel: ErrorPanel | null = null;
  private _uiPanel: HTMLElement | null = null;
  private _uiLive: HTMLElement | null = null;
  private _uiMsg: HTMLElement | null = null;
  private _uiMsgText: HTMLElement | null = null;
  private _uiMsgView: Mounted | null = null;
  private _uiMsgKey = '';
  private _uiOwn: HTMLElement[] = [];
  /** Nodes taken out of the page while the UI runs (a `.fallback`), put back by `destroy()`. */
  private _uiRemoved: [Node, Node | null, Node][] = [];
  private _uiAttrs: string[] = [];
  private _uiClicked: HTMLElement[] = [];
  private _uiUrls = new Set<string>();
  private _uiActions: HTMLElement | null = null;
  private _uiFileBtn: HTMLElement | null = null;
  private _uiInputs: HTMLInputElement[] = [];
  private _uiFileInput: HTMLInputElement | null = null;
  private _uiFolderInput: HTMLInputElement | null = null;
  private _uiStatic = new Listeners();
  private _uiDom = new Listeners();
  private _uiAttached = false;
  private _uiDepth = 0;
  private _uiTouch = false;
  private _uiCancel: (() => void) | null = null;
  private _uiTimers = new Set<ReturnType<typeof setTimeout>>();
  private _uiTransform: AnyDropFullOptions['transformFile'] = null;
  private _uiSteps = -1;
  private _uiErrCount = 0;
  private _uiFlip = false;
  private _uiLoc: AnyDropLocale | null = null;
  private _uiPreset: string | null = null;
  /** `dict*` options the developer set: a language switch never overwrites them. */
  private _uiExplicit = new Set<string>();
  /** `lang` and `dir` of the element before they were set (put back by `destroy()`). */
  private _uiSaved: Record<string, string | null> = {};

  /** Attaches to an element (or a selector). Throws when there is no URL or the selector matches nothing. */
  constructor(element: string | HTMLElement, config: AnyDropConfig = {}) {
    super(prepare(element, config) as unknown as AnyDropCoreConfig);
    const el = resolve(element) as HTMLElement;
    this.element = el;
    this._uiPreviews = new Previews(this);
    const o = this.options;
    for (const k of Object.keys(Object.assign({}, presetFor(el) || {}, config))) {
      if (/^dict/.test(k)) this._uiExplicit.add(k);
    }
    this._uiLoc = pickLocale(o.locale);
    if (o.forceFallback || !AnyDrop.isBrowserSupported()) {
      this._uiAttach2(el);
      (o.fallback || this._uiFallback).call(this);
      return;
    }
    if (!o.url) throw new Error('No URL provided.');
    this._uiAttach2(el);
    if (el.tagName === 'FORM') el.setAttribute('enctype', 'multipart/form-data');
    this._uiBuild();
    this._uiEvents();
    this._uiResizeTransform();
    if (o.init) o.init.call(this);
  }

  /** The hidden `<input type=file>` the file picker opens. */
  get hiddenFileInput(): HTMLInputElement | null {
    return this._uiFileInput;
  }

  private _uiAttach2(el: HTMLElement): void {
    (el as { anydrop?: AnyDrop }).anydrop = this;
    AnyDrop.instances.push(this);
    if (el !== document.body) el.classList.add('ad-root');
  }

  /** The fields of a `<form>` element go with every request, once. */
  protected override _addFormElementData(formData: FormData): void {
    const el = this.element;
    if (!el || el.tagName !== 'FORM') return;
    el.querySelectorAll<HTMLInputElement>('input, textarea, select, button').forEach((inp) => {
      const name = inp.getAttribute('name');
      const type = (inp.getAttribute('type') || '').toLowerCase();
      if (!name) return;
      if (inp.tagName === 'SELECT' && inp.hasAttribute('multiple')) {
        Array.prototype.forEach.call(
          (inp as unknown as HTMLSelectElement).options,
          (op: HTMLOptionElement) => {
            if (op.selected) formData.append(name, op.value);
          },
        );
      } else if ((type !== 'checkbox' && type !== 'radio') || inp.checked) {
        formData.append(name, inp.value);
      }
    });
  }

  /** Previews are off with `disablePreviews` or `previewsContainer: false`. */
  private _uiNoPreviews(): boolean {
    return this.options.disablePreviews || this.options.previewsContainer === false;
  }

  // ------------------------------------------------------------ public methods

  /** Dispatches `anydrop:<event>` on the element too (`detail: { args }`). */
  override emit<K extends AnyDropEventName>(event: K, ...args: AnyDropEvents[K]): this {
    // Option handlers run before ours: `file.previewElement` has to exist for them.
    if (event === 'addedfile' && this._uiPreviews) this._uiDefine(args[0] as Item);
    super.emit(event, ...args);
    const el = this.element;
    if (el && !this.isDestroyed && typeof CustomEvent === 'function') {
      el.dispatchEvent(
        new CustomEvent('anydrop:' + event, { bubbles: true, cancelable: true, detail: { args } }),
      );
    }
    return this;
  }

  override getOption<K extends keyof AnyDropOptions>(name: K): AnyDropOptions[K];
  override getOption<K extends keyof AnyDropUIOptions>(name: K): AnyDropUIOptions[K];
  override getOption(name: string): unknown {
    return super.getOption(name as never);
  }

  override setOption<K extends keyof AnyDropCoreConfig>(name: K, value: AnyDropCoreConfig[K]): void;
  override setOption<K extends keyof AnyDropUIOptions>(name: K, value: AnyDropUIOptions[K]): void;
  override setOption(name: string, value: unknown): void {
    super.setOption(name as never, value as never);
    if (this.isDestroyed) return;
    if (/^dict/.test(name)) this._uiExplicit.add(name);
    this._uiApply(name);
  }

  /**
   * Shows a file that is already on the server . The mock file is
   * not added to `files`, the tree, the queue or a manifest.
   */
  displayExistingFile(
    mock: MockFile,
    imageUrl: string,
    callback?: (() => void) | null,
    crossOrigin?: string | null,
    resizeThumbnail = true,
  ): void {
    this._uiExtras.push(mock);
    this.emit('addedfile', mock as unknown as AnyDropFile);
    this._completeExternal(mock as unknown as AnyDropFile);
    if (resizeThumbnail) {
      mock.dataURL = imageUrl;
      void this._uiPreviews.fromUrl(mock, imageUrl, crossOrigin).then(() => callback?.());
    } else {
      this._uiPreviews.thumbReady(mock, imageUrl);
      callback?.();
    }
  }

  override removeFile(file: AnyDropFile): void {
    const i = this._uiExtras.indexOf(file as unknown as MockFile);
    if (i < 0) return super.removeFile(file);
    this._uiExtras.splice(i, 1);
    const j = this.files.indexOf(file);
    if (j >= 0) this.files.splice(j, 1);
    this._uiPreviews.release(file as unknown as MockFile);
    this._uiList?.invalidate();
    this.emit('removedfile', file);
    if (!this.files.length && !this._uiExtras.length) this.emit('reset');
    this._uiSchedule();
  }

  override disable(): void {
    this._uiDetach();
    this._uiState(true);
    super.disable();
  }

  override enable(): void {
    super.enable();
    this._uiAttach();
    this._uiState(false);
  }

  /** Downloads the error list as a file (`anydrop-errors.json` or `.csv`). */
  downloadErrors(format: 'json' | 'csv' = 'json'): void {
    const url = URL.createObjectURL(
      new Blob([this.exportErrors(format)], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      }),
    );
    const a = h('a', 'ad-sr-only', { href: url, download: `anydrop-errors.${format}` });
    this._uiUrls.add(url);
    this.element.appendChild(a);
    a.click();
    a.remove();
    this._uiLater(() => {
      this._uiUrls.delete(url);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /** Copies the error list (JSON) to the clipboard. Resolves `false` when the browser refuses. */
  async copyErrors(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.exportErrors('json'));
      this._uiSay(this.options.dictCopied);
      return true;
    } catch {
      this._uiSay(this.options.dictCopyFailed);
      return false;
    }
  }

  override destroy(): void {
    if (this.isDestroyed) return;
    super.destroy();
    destroyView(this._uiMsgView);
    this._uiCancel?.();
    this._uiTimers.forEach((t) => clearTimeout(t));
    this._uiTimers.clear();
    this._uiUrls.forEach((u) => URL.revokeObjectURL(u));
    this._uiUrls.clear();
    this._uiDom.clear();
    this._uiStatic.clear();
    this._uiList?.destroy();
    this._uiToolbar?.destroy();
    this._uiBanner?.destroy();
    this._uiErrorPanel?.destroy();
    this._uiPreviews.destroy();
    for (const n of this._uiOwn) n.remove();
    for (const i of this._uiInputs) i.remove();
    this._uiPanel?.remove();
    this._uiLive?.remove();
    this._uiActions?.remove();
    for (const [parent, next, node] of this._uiRemoved.reverse()) {
      parent.insertBefore(node, next && next.parentNode === parent ? next : null);
    }
    this._uiRemoved = [];
    this._uiLang(true);
    const el = this.element;
    Array.from(el.classList).forEach((c) => {
      if (/^ad-/.test(c)) el.classList.remove(c);
    });
    for (const c of this._uiClicked) c.classList.remove('ad-clickable');
    if (!el.getAttribute('class')) el.removeAttribute('class');
    for (const k of this._uiAttrs) el.removeAttribute(k);
    delete (el as { anydrop?: AnyDrop }).anydrop;
    const i = AnyDrop.instances.indexOf(this);
    if (i >= 0) AnyDrop.instances.splice(i, 1);
  }

  // ------------------------------------------------------------ build

  private _uiBuild(): void {
    const el = this.element;
    const o = this.options;
    const body = el === document.body;
    const attr = (k: string, v: string) => {
      el.setAttribute(k, v);
      this._uiAttrs.push(k);
    };
    if (o.theme !== 'auto' && !body) attr('data-ad-theme', o.theme);
    if (!body && !el.hasAttribute('role')) attr('role', 'group');
    if (!body && !el.hasAttribute('aria-label')) attr('aria-label', o.dictRegionLabel);
    // A fallback form is not needed when the browser is supported.
    el.querySelectorAll('.ad-fallback').forEach((n) => {
      if (n.parentNode) this._uiRemoved.push([n.parentNode, n.nextSibling, n]);
      n.remove();
    });
    let msg = el.querySelector<HTMLElement>('.ad-message');
    // Our default message and buttons only go into an element that is itself the zone.
    if (!msg && !body && o.clickable === true) {
      msg = h('div', 'ad-message');
      el.appendChild(msg);
      this._uiOwn.push(msg);
    }
    this._uiMsg = msg;
    this._uiLive = h('div', 'ad-live ad-sr-only', { role: 'status', 'aria-live': 'polite' });
    el.appendChild(this._uiLive);
    this._uiPickers();
    this._uiMessage();
    if (!this._uiNoPreviews()) this._uiBuildPanel();
    this._uiLang();
    const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    const touch = () => {
      const d = h('div');
      this._uiTouch =
        !!(mq && mq.matches) || !('draggable' in d || ('ondragstart' in d && 'ondrop' in d));
      el.classList.toggle('ad-touch', this._uiTouch && !body);
      this._uiRelabel();
    };
    if (mq) this._uiStatic.on(mq, 'change', touch);
    touch();
    this._uiAttach();
  }

  /** File and folder buttons, the iOS notice and the hidden inputs. */
  private _uiPickers(): void {
    const o = this.options;
    for (const i of this._uiInputs) i.remove();
    this._uiInputs = [];
    this._uiActions?.remove();
    this._uiActions = null;
    this._uiFileInput = this._uiFolderInput = null;
    const box = resolve(o.hiddenInputContainer) || document.body;
    const make = (folder: boolean) => {
      const i = h('input', `ad-input ad-input-${folder ? 'folder' : 'files'}`, {
        type: 'file',
        tabindex: -1,
        'aria-hidden': 'true',
        'data-ad-input': folder ? 'folder' : 'files',
        style:
          'visibility:hidden;position:absolute;top:0;left:0;height:0;width:0;overflow:hidden;max-width:0',
      });
      i.multiple = true;
      if (folder) {
        i.setAttribute('webkitdirectory', '');
        i.setAttribute('directory', '');
      } else {
        if (o.acceptedFiles) i.accept = o.acceptedFiles;
        if (o.capture) i.setAttribute('capture', o.capture);
        i.multiple = o.maxFiles == null || o.maxFiles > 1;
      }
      this._uiStatic.on(i, 'change', () => {
        const files = Array.prototype.slice.call(i.files || []) as File[];
        i.value = '';
        if (files.length) void this.addFromInput(files);
      });
      box.appendChild(i);
      this._uiInputs.push(i);
      return i;
    };
    this._uiFileInput = make(false);
    const folders = o.folders && AnyDrop.supportsFolderPicker();
    if (folders) this._uiFolderInput = make(true);
    // Buttons only when the element itself is the clickable zone (not for a `clickable: '.btn'` setup).
    const zone = o.clickable === true && this.element !== document.body;
    const notice = o.folders && !folders && zone;
    if (!(o.pickerButtons && zone) && !notice) return;
    const a = h('div', 'ad-actions');
    if (o.pickerButtons) {
      this._uiFileBtn = textBtn('pick-files', '', 'ad-btn-primary');
      a.appendChild(this._uiFileBtn);
      if (folders) a.appendChild(textBtn('pick-folder', o.dictSelectFolder));
    }
    if (notice) a.appendChild(h('p', 'ad-notice', { role: 'note' }, o.dictNoFolderSupport));
    this.element.appendChild(a);
    this._uiActions = a;
    this._uiStatic.on(a, 'click', (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest('[data-ad-action]');
      if (b) this._uiRun(b.getAttribute('data-ad-action') as string);
    });
  }

  /** (Re)builds the drop message that the library owns: the default text, or what `render.message` returns. */
  private _uiMessage(): void {
    const msg = this._uiMsg;
    destroyView(this._uiMsgView);
    this._uiMsgView = null;
    if (!msg || this._uiOwn.indexOf(msg) < 0) return;
    msg.textContent = '';
    this._uiMsgText = h('span', 'ad-message-text', undefined, this.options.dictDefaultMessage);
    msg.appendChild(this._uiMsgText);
    const c = this._uiMsgCtx();
    this._uiMsgKey = msgKey(c);
    const v = (this._uiMsgView = runHook(this, 'message', c));
    if (v && v.el) {
      msg.textContent = '';
      msg.appendChild(v.el);
    }
  }

  private _uiMsgCtx(): AnyDropMessageContext {
    const el = this.element;
    const max = this.options.maxFiles;
    return Object.assign(this._uiBase(), {
      kind: 'message' as const,
      el: this._uiMsg as HTMLElement,
      parts: { text: this._uiMsgText as HTMLElement },
      text: this.options.dictDefaultMessage,
      touch: this._uiTouch,
      dragging: el.classList.contains('ad-drag-hover'),
      disabled: this.disabled,
      maxFilesReached: max != null && this.getAcceptedFiles().length >= max,
      hasFiles: !!(this.files.length || this._uiExtras.length),
      canPickFolder: !!this._uiFolderInput,
      pickFiles: () => this._uiPick(false),
      pickFolder: () => this._uiPick(true),
    });
  }

  private _uiBuildPanel(): void {
    const o = this.options;
    const box = resolve(o.previewsContainer) || this.element;
    const panel = h('div', 'ad-panel ad-root ad-layout-' + o.layout, { hidden: true });
    if (o.theme !== 'auto') panel.setAttribute('data-ad-theme', o.theme);
    this._uiList = new RowList(this);
    panel.appendChild((this._uiBanner = new Banner(this)).el);
    if (o.toolbar) panel.appendChild((this._uiToolbar = new Toolbar(this)).el);
    panel.appendChild(this._uiList.v.el);
    if (o.errorPanel) {
      panel.appendChild((this._uiErrorPanel = new ErrorPanel(this)).el);
      this._uiErrorPanel.set(this.getErrors());
    }
    box.appendChild(panel);
    this._uiPanel = panel;
    this._uiLang();
    for (const f of this.files) this._uiDefine(f);
    this._uiList.invalidate();
    this._uiConnect(true);
    this._uiSchedule();
  }

  /** Panel rebuilt: every view gets `destroy()`, then the rows mount again. */
  private _uiRebuild(): void {
    this._uiDropPanel();
    if (!this._uiNoPreviews()) this._uiBuildPanel();
  }

  private _uiDropPanel(): void {
    this._uiList?.destroy();
    this._uiToolbar?.destroy();
    this._uiBanner?.destroy();
    this._uiErrorPanel?.destroy();
    this._uiPanel?.remove();
    this._uiBanner = null;
    this._uiList = null;
    this._uiToolbar = null;
    this._uiErrorPanel = null;
    this._uiPanel = null;
  }

  /** Lazy `file.previewElement` (created when first read or first shown). */
  private _uiDefine(f: Item): void {
    if (this._uiNoPreviews()) return;
    const pv = this._uiPreviews;
    // Reading or assigning it marks the element as the user's: it is then never dropped.
    const read = () => {
      pv.touched.add(f);
      return pv.get(f);
    };
    Object.defineProperty(f, 'previewElement', {
      configurable: true,
      enumerable: false,
      get: read,
      set: (e: HTMLElement | undefined) => {
        if (!e) return;
        pv.touched.add(f);
        pv.use(f, e);
      },
    });
  }

  private _uiFallback(this: AnyDrop): void {
    const el = this.element;
    const o = this.options;
    el.classList.add('ad-browser-not-supported');
    let msg = el.querySelector('.ad-message');
    if (!msg) el.appendChild((msg = h('div', 'ad-message')));
    msg.textContent = o.dictFallbackMessage;
    if (el.querySelector('.ad-fallback')) return;
    const url = this.resolveOption(o.url as string, []);
    const f = h('div', 'ad-fallback');
    const name = typeof o.paramName === 'function' ? o.paramName(0) : o.paramName;
    const multiple = o.uploadMultiple || o.maxFiles == null || o.maxFiles > 1;
    const fields = [
      h('input', '', { type: 'file', name: name + (o.uploadMultiple ? '[]' : ''), multiple }),
      h('input', '', { type: 'submit', value: o.dictFallbackUpload }),
    ];
    f.appendChild(h('p', '', undefined, o.dictFallbackText));
    if (el.tagName === 'FORM') {
      // A form element is the fallback form itself: its own fields stay.
      el.setAttribute('enctype', 'multipart/form-data');
      f.append(...fields);
    } else {
      const form = h('form', '', {
        action: url,
        method: String(this.resolveOption(o.method as string, [])),
        enctype: 'multipart/form-data',
      });
      form.append(...fields);
      f.appendChild(form);
    }
    el.appendChild(f);
  }

  // ------------------------------------------------------------ DOM listeners (removed by disable())

  private _uiClickables(): HTMLElement[] {
    return clickables(this.element, this.options.clickable);
  }

  private _uiAttach(): void {
    if (this._uiAttached) return;
    this._uiAttached = true;
    const el = this.element;
    const L = this._uiDom;
    const hasFiles = (e: DragEvent) => {
      const t = e.dataTransfer && e.dataTransfer.types;
      return !t || Array.prototype.indexOf.call(t, 'Files') >= 0;
    };
    const hover = (on: boolean) => {
      mark(el, 'drag-hover', on);
      this._uiSchedule();
    };
    L.on(el, 'dragenter', (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this._uiDepth++;
      hover(true);
      this.emit('dragenter', e);
    });
    L.on(el, 'dragover', (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      try {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* some browsers throw while reading effectAllowed */
      }
      hover(true);
      this.emit('dragover', e);
    });
    L.on(el, 'dragleave', (e: DragEvent) => {
      if (!hasFiles(e)) return;
      this._uiDepth = Math.max(0, this._uiDepth - 1);
      if (!this._uiDepth) hover(false);
      this.emit('dragleave', e);
    });
    L.on(el, 'drop', (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      this._uiDepth = 0;
      hover(false);
      void this.drop(e);
    });
    L.on(el, 'dragstart', (e: DragEvent) => this.emit('dragstart', e));
    L.on(el, 'dragend', (e: DragEvent) => this.emit('dragend', e));
    if (this.options.enablePaste) {
      L.on(el, 'paste', (e: ClipboardEvent) => {
        const items = e.clipboardData && e.clipboardData.items;
        for (let i = 0; items && i < items.length; i++) {
          if ((items[i] as DataTransferItem).kind === 'file') {
            e.preventDefault();
            void this.paste(e);
            return;
          }
        }
      });
    }
    this._uiClicked = this._uiClickables();
    for (const c of this._uiClicked) {
      mark(c, 'clickable', true);
      L.on(c, 'click', (e: MouseEvent) => {
        const t = e.target as Node;
        if (this._uiInputs.indexOf(t as HTMLInputElement) >= 0) return;
        // Controls inside the message (a custom one) do their own job.
        if (
          this._uiMsg &&
          this._uiMsg.contains(t) &&
          (t as Element).closest &&
          (t as Element).closest('button,a,input,select,textarea,[data-ad-action]')
        ) {
          return;
        }
        if (c !== el || t === el || (this._uiMsg && this._uiMsg.contains(t))) this._uiPick(false);
      });
    }
  }

  private _uiDetach(): void {
    this._uiAttached = false;
    this._uiDom.clear();
    this._uiDepth = 0;
    for (const c of this._uiClicked) mark(c, 'clickable', false);
    this._uiClicked = [];
    mark(this.element, 'drag-hover', false);
  }

  private _uiState(disabled: boolean): void {
    mark(this.element, 'disabled', disabled);
    this._uiSchedule();
    this.element.querySelectorAll<HTMLButtonElement>('.ad-actions .ad-btn').forEach((b) => {
      b.disabled = disabled;
    });
  }

  private _uiPick(folder: boolean): void {
    if (this.disabled) return;
    (folder ? this._uiFolderInput : this._uiFileInput)?.click();
  }

  // ------------------------------------------------------------ core events to DOM

  private _uiEvents(): void {
    const el = this.element;
    const pv = this._uiPreviews;
    const touch = (...a: unknown[]) => {
      this._uiList?.touch(a[0] as object);
      this._uiSchedule();
    };
    this.on('addedfile', (f) => {
      mark(el, 'started', true);
      void f;
      this._uiList?.invalidate();
      this._uiSchedule();
    });
    this.on('addedfiles', (files) => {
      // Without visible rows, or with `thumbnail` listeners, every accepted image gets a thumbnail.
      if (this._uiNoPreviews() || this.hasListeners('thumbnail')) {
        for (const f of files) if (f.accepted) pv.eager(f);
      }
      if (files.length) this._uiSay(fmt(this.options.dictAnnounceAdded, { count: files.length }));
    });
    const struct = () => {
      this._uiList?.invalidate();
      this._uiSchedule();
    };
    this.on('addedfolder', struct);
    this.on('removedfolder', struct);
    this.on('removedfile', (f) => {
      pv.release(f as unknown as MockFile);
      struct();
    });
    this.on('reset', () => {
      mark(el, 'started', false);
      this._uiList?.invalidate();
      this._uiSchedule();
    });
    for (const n of ['processing', 'uploadprogress', 'success', 'complete'] as const) {
      this.on(n, touch);
    }
    this.on('canceled', (f) => {
      pv.msgs.set(f, this.options.dictUploadCanceled);
      touch(f);
    });
    this.on('error', (f, message) => {
      let m = message as string | { error?: string; message?: string };
      if (m && typeof m !== 'string') m = m.error || m.message || JSON.stringify(m);
      pv.msgs.set(f, String(m));
      touch(f);
    });
    this.on('folderprogress', touch);
    this.on('foldercomplete', touch);
    this.on('maxfilesreached', () => this._uiSchedule());
    this.on('maxfilesexceeded', () => this._uiSchedule());
    this.on('errorlistchanged', (list) => {
      this._uiErrors.clear();
      for (const e of list) {
        if (!e.fileId) continue;
        this._uiErrors.set(e.fileId, e);
        const f = this.getFile(e.fileId);
        if (f) this._uiList?.touch(f);
      }
      this._uiErrorPanel?.set(list);
      if (list.length > this._uiErrCount) {
        this._uiSay(fmt(this.options.dictAnnounceErrors, { count: list.length }));
      }
      this._uiErrCount = list.length;
      this._uiSchedule();
    });
    this.on('totaluploadprogress', (p) => {
      this._uiTotal = p;
      const step = Math.floor(p / 10);
      if (p > 0 && p < 100 && step !== this._uiSteps) {
        this._uiSteps = step;
        this._uiSay(fmt(this.options.dictAnnounceProgress, { percent: step * 10 }));
      }
      this._uiSchedule();
    });
    this.on('queuecomplete', () => {
      this._uiSteps = -1;
      this._uiSay(this.options.dictAnnounceComplete);
    });
    const paused = (on: boolean) => (t: AnyDropEvents['paused'][0]) => {
      if (t.scope === 'all') {
        this._uiPausedAll = on;
        if (t.reason === 'user') this._uiUserAll = on;
        // Connection changes are announced by `_uiConnect`, not as a plain pause.
        if (t.reason !== 'offline' && (t.reason as string) !== 'unreachable') {
          this._uiSay(on ? this.options.dictAnnouncePaused : this.options.dictAnnounceResumed);
        }
        this._uiConnect();
        this._uiList?.touchAll();
      } else {
        if (t.scope === 'file') {
          if (on) this._uiUserFiles.add(t.file);
          else this._uiUserFiles.delete(t.file);
          touch(t.file);
        } else {
          // Folder scope changes every file below it, so repaint all mounted rows.
          touch(t.folder);
          this._uiList?.touchAll();
        }
      }
      this._uiSchedule();
    };
    this.on('paused', paused(true));
    this.on('resumed', paused(false));
    // Connection API of core: guarded, so it does nothing until core has it.
    this.on('reconnecting' as AnyDropEventName, () => this._uiConnect());
    this.on('online', () => this._uiConnect());
    this.on('offline', () => this._uiConnect());
    this._uiConnect(true);
  }

  /** Reads core's connection state, shows the banner and announces real changes (never ticks). */
  private _uiConnect(quiet = false): void {
    const c: Conn = this.getConnectionState();
    const was = this._uiConn;
    this._uiConn = c.state;
    this._uiBanner?.set(c);
    if (c.state !== was) {
      const o = this.options;
      if (!quiet) {
        this._uiSay(
          c.state === 'online'
            ? o.dictConnectionRestored
            : c.state === 'offline'
              ? o.dictOffline
              : fmt(o.dictReconnecting, { seconds: this._uiBanner?.seconds() || 0 }),
        );
      }
      this._uiList?.touchAll();
    }
  }

  // ------------------------------------------------------------ painting

  /** @internal Paints pending changes on the next frame. */
  _uiSchedule(): void {
    if (this._uiCancel || this.isDestroyed) return;
    this._uiCancel = frame(() => {
      this._uiCancel = null;
      this._uiFlush();
    });
  }

  /** @internal */
  _uiFlush(): void {
    if (this.isDestroyed) return;
    // Shown first, so the list is laid out (and measurable) when it flushes.
    if (this._uiPanel) {
      this._uiPanel.hidden = !(this.files.length || this._uiExtras.length);
    }
    this._uiList?.flush();
    this._uiToolbar?.update();
    if (this._uiMsgView) {
      const c = this._uiMsgCtx();
      const k = msgKey(c);
      if (k !== this._uiMsgKey) {
        this._uiMsgKey = k;
        updateView(this._uiMsgView, c);
      }
    }
    const max = this.options.maxFiles;
    mark(this.element, 'max-files-reached', max != null && this.getAcceptedFiles().length >= max);
  }

  private _uiRelabel(): void {
    const o = this.options;
    const t = this._uiMsgText;
    if (t) t.textContent = o.dictDefaultMessage;
    if (this._uiFileBtn) {
      this._uiFileBtn.textContent = this._uiTouch ? o.dictTapToUpload : o.dictSelectFiles;
    }
    const fb = this._uiActions && this._uiActions.querySelector('[data-ad-action=pick-folder]');
    if (fb) fb.textContent = o.dictSelectFolder;
    const n = this._uiActions && this._uiActions.querySelector('.ad-notice');
    if (n) n.textContent = o.dictNoFolderSupport;
    this._uiToolbar?.labels();
    this._uiErrorPanel?.labels();
    this._uiList?.labels();
    this._uiConnect(true);
    this._uiList?.invalidate(true);
    this._uiSchedule();
  }

  /** Rewrites every text from the language pack (or English); the texts the developer set stay. */
  private _uiTexts(): void {
    const en = Object.assign(defaultOptions(), uiDefaults()) as unknown as Record<string, unknown>;
    const loc = (this._uiLoc ? this._uiLoc.dict : {}) as Record<string, unknown>;
    const opts = this.options as unknown as Record<string, unknown>;
    for (const k in en) {
      if (!/^dict/.test(k) || k === 'dictRemoveFileConfirmation' || this._uiExplicit.has(k))
        continue;
      opts[k] =
        k === 'dictFileSizeUnits' ? Object.assign({}, en[k], loc[k]) : k in loc ? loc[k] : en[k];
    }
    this._uiRelabel();
  }

  /** `lang`, `dir` and the `ad-theme-<name>` class on the element and the panel (`off`: put everything back). */
  private _uiLang(off = false): void {
    const loc = off ? null : this._uiLoc;
    const o = this.options;
    const preset = off ? null : o.themePreset;
    for (const n of [this.element, this._uiPanel]) {
      if (!n || n === document.body) continue;
      if (this._uiPreset) n.classList.remove('ad-theme-' + this._uiPreset);
      if (preset) n.classList.add('ad-theme-' + preset);
    }
    this._uiPreset = preset;
    const dir = off ? null : o.dir !== 'auto' ? o.dir : loc ? loc.dir : null;
    const vals: [string, string | null][] = [
      ['lang', loc ? loc.code : null],
      ['dir', dir],
    ];
    const saved = this._uiSaved;
    for (const [k, v] of vals) {
      if (this._uiPanel) {
        if (v == null) this._uiPanel.removeAttribute(k);
        else this._uiPanel.setAttribute(k, v);
      }
      const el = this.element;
      if (el === document.body) continue;
      if (v != null) {
        if (!(k in saved)) saved[k] = el.getAttribute(k);
        el.setAttribute(k, v);
      } else if (k in saved) {
        const was = saved[k];
        if (was == null) el.removeAttribute(k);
        else el.setAttribute(k, was);
        delete saved[k];
      }
    }
  }

  private _uiApply(name: string): void {
    const o = this.options;
    if (/^dict/.test(name)) return this._uiRelabel();
    switch (name) {
      case 'previewTemplate':
      case 'addRemoveLinks':
      case 'createImageThumbnails':
      case 'thumbnailWidth':
      case 'thumbnailHeight':
      case 'thumbnailMethod':
      case 'maxThumbnailFilesize':
        this._uiPreviews.reset();
        this._uiList?.invalidate(true);
        break;
      case 'folderView':
      case 'rowHeight':
        this._uiList?.invalidate(true);
        break;
      case 'icons':
        this._uiPreviews.reset();
        this._uiMessage();
        this._uiRebuild();
        break;
      case 'render':
        this._uiMessage();
        this._uiRebuild();
        break;
      case 'rowActions':
      case 'errorRowHeight':
      case 'layout':
      case 'disablePreviews':
      case 'toolbar':
      case 'errorPanel':
      case 'previewsContainer':
        this._uiRebuild();
        break;
      case 'folders':
      case 'pickerButtons':
      case 'acceptedFiles':
      case 'maxFiles':
      case 'capture':
      case 'hiddenInputContainer':
        this._uiPickers();
        this._uiRelabel();
        break;
      case 'clickable':
      case 'enablePaste':
        this._uiDetach();
        if (!this.disabled) this._uiAttach();
        break;
      case 'locale':
        this._uiLoc = pickLocale(o.locale, true);
        this._uiTexts();
        this._uiLang();
        break;
      case 'dir':
      case 'themePreset':
        this._uiLang();
        break;
      case 'theme':
        for (const n of [this.element, this._uiPanel]) {
          if (!n) continue;
          if (o.theme === 'auto') n.removeAttribute('data-ad-theme');
          else n.setAttribute('data-ad-theme', o.theme);
        }
        break;
      case 'resizeWidth':
      case 'resizeHeight':
      case 'transformFile':
        this._uiResizeTransform();
        break;
    }
    this._uiSchedule();
  }

  /** The `resize*` options act as the default `transformFile`, installed only when needed. */
  private _uiResizeTransform(): void {
    const o = this.options;
    const wanted = !!(o.resizeWidth || o.resizeHeight);
    const ours = this._uiTransform;
    if (o.transformFile && (o.transformFile as unknown) !== ours) {
      this._uiTransform = null; // the user's own hook wins
      return;
    }
    if (wanted && !ours) {
      const fn = (file: Blob, done: (b: Blob) => void) => scaleBlob(file, this.options, done);
      this._uiTransform = fn as AnyDropFullOptions['transformFile'];
      this.options.transformFile = this._uiTransform as AnyDropOptions['transformFile'];
    } else if (!wanted && ours) {
      this.options.transformFile = null;
      this._uiTransform = null;
    }
  }

  // ------------------------------------------------------------ actions

  /** @internal Handles every button of the UI. */
  _uiRun(action: string, item?: Target, entry?: ErrorEntry): void {
    const m = this as unknown as Later;
    const folder = item && isFolder(item) ? item : null;
    const file = item && !folder ? (item as AnyDropFile) : null;
    switch (action) {
      case 'pick-files':
        return this._uiPick(false);
      case 'pick-folder':
        return this._uiPick(true);
      case 'retry-now':
        m.reconnect?.();
        break;
      case 'pause-all':
        m.pause?.();
        break;
      case 'resume-all':
        m.resume?.();
        break;
      case 'retry-failed':
        m.retryFailedOnly?.();
        break;
      case 'clear':
        for (const x of this._uiExtras.slice()) this.removeFile(x as unknown as AnyDropFile);
        this.removeAllFiles(true);
        this._uiList?.hideEmpty();
        break;
      case 'pause':
        if (folder) m.pauseFolder?.(folder.path);
        else if (file) m.pauseFile?.(file);
        break;
      case 'resume':
        if (folder) m.resumeFolder?.(folder.path);
        else if (file) m.resumeFile?.(file);
        break;
      case 'retry':
        if (folder) m.retryFailedOnly?.(folder.path || undefined);
        else if (file) this._uiRetryFile(file);
        break;
      case 'retry-entry': {
        const f = entry && entry.fileId ? this.getFile(entry.fileId) : undefined;
        if (f) this._uiRetryFile(f);
        else if (entry) m.retryFailedOnly?.();
        break;
      }
      case 'cancel':
        if (folder) m.cancelFolder?.(folder.path);
        else if (file && ACTIVE.test(file.status || '') && this.getFile(file.id))
          this.cancelUpload(file);
        break;
      case 'remove':
        if (file) this.removeFile(file);
        break;
      case 'export-json':
        return this.downloadErrors('json');
      case 'export-csv':
        return this.downloadErrors('csv');
      case 'copy-errors':
        void this.copyErrors();
        return;
      case 'dismiss-errors':
        this.clearErrors();
        return;
    }
    if (item) this._uiList?.touch(item);
    this._uiSchedule();
  }

  /** One file: `retryFile` when core has it, else the failed files of its folder (core change request). */
  private _uiRetryFile(f: AnyDropFile): void {
    const m = this as unknown as Later;
    if (m.retryFile) m.retryFile(f);
    else m.retryFailedOnly?.(f.folder.path || undefined);
  }

  /** @internal The `data-ad-remove` link: ask before dropping an upload in progress. */
  _uiRemoveLink(item: Item): void {
    const o = this.options;
    const remove = () => this.removeFile(item as AnyDropFile);
    if (item.status === 'uploading') AnyDrop.confirm(o.dictCancelUploadConfirmation, remove);
    else if (o.dictRemoveFileConfirmation) AnyDrop.confirm(o.dictRemoveFileConfirmation, remove);
    else remove();
  }

  /** @internal The members every render context has. */
  _uiBase() {
    return baseContext(this);
  }

  private _uiSay(text: string): void {
    const l = this._uiLive;
    this._uiFlip = !this._uiFlip;
    if (l) l.textContent = text + (this._uiFlip ? '' : ' ');
  }

  private _uiLater(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this._uiTimers.delete(t);
      fn();
    }, ms);
    this._uiTimers.add(t);
  }
}
