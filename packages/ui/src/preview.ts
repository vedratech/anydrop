// Preview elements (the previewTemplate and its `data-ad-*` hooks) and lazy, capped thumbnails.
// A preview element is created the first time something asks for it (a row scrolling into view, or
// user code reading `file.previewElement`) and is rebuilt from the file's state, so 5,000 files do not
// mean 5,000 DOM subtrees.
import type { AnyDropFile } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';
import { DEFAULT_TEMPLATE } from './options';
import { h, mark } from './dom';
import { decodeImage, looksLikeImage, renderScaled, thumbMime } from './image';

/** A file-like object for `displayExistingFile()`: not part of the tree or the upload queue. */
export interface MockFile {
  /** File name shown in the row. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** MIME type. */
  type?: string;
  /** Status text, for example `success`. */
  status?: string;
  /** The row element, set by the UI. */
  previewElement?: HTMLElement;
  [key: string]: unknown;
}
export type Item = AnyDropFile | MockFile;

interface Refs {
  name: HTMLElement[];
  size: HTMLElement[];
  bar: HTMLElement[];
  err: HTMLElement[];
  thumb: HTMLImageElement[];
  remove: HTMLElement[];
  auto: HTMLElement | null;
}

const all = (e: HTMLElement, attr: string) =>
  Array.prototype.slice.call(e.querySelectorAll(`[${attr}]`)) as HTMLElement[];
const MAX_THUMB = 512;
const CACHE = 300;
const TERMINAL = /^(success|error|canceled)$/;

export class Previews {
  /** Message shown in `data-ad-errormessage` (upload error, rejection, or "canceled"). */
  readonly msgs = new WeakMap<object, string>();
  /** Preview element to its file (for `data-ad-remove` clicks). */
  readonly owner = new WeakMap<HTMLElement, Item>();
  private els = new WeakMap<object, HTMLElement>();
  private refs = new WeakMap<HTMLElement, Refs>();
  private proto: HTMLElement | null = null;
  private cache = new Map<object, string>();
  private queue: AnyDropFile[] = [];
  private tried = new WeakSet<object>();
  /** Files whose preview element user code has read or assigned: never dropped. */
  readonly touched = new WeakSet<object>();
  /** Files queued for a thumbnail without a visible row (thumbnail listeners, no previews). */
  private eagerSet = new WeakSet<object>();
  private busy = 0;
  private dead = false;

  constructor(private ad: AnyDrop) {}

  /** Parses `previewTemplate` again (after `setOption('previewTemplate')`). */
  reset(): void {
    this.proto = null;
    this.els = new WeakMap();
    this.refs = new WeakMap();
    this.tried = new WeakSet();
  }

  private template(): HTMLElement {
    return (
      this.proto ||
      (this.proto =
        parseTemplate(this.ad.options.previewTemplate) || parseTemplate(DEFAULT_TEMPLATE))
    );
  }

  has(f: Item): boolean {
    return this.els.has(f);
  }

  get(f: Item): HTMLElement {
    let e = this.els.get(f);
    if (!e) {
      e = this.template().cloneNode(true) as HTMLElement;
      this.use(f, e);
      const r = this.refs.get(e) as Refs;
      if (this.ad.options.addRemoveLinks && !r.remove.length) {
        r.auto = h('button', 'ad-file-remove ad-link-btn', {
          type: 'button',
          'data-ad-remove': '',
        });
        r.remove.push(r.auto);
        e.appendChild(r.auto);
      }
      const url = this.cache.get(f);
      if (url) this.show(f, url);
      else if ((f as MockFile).dataURL) this.show(f, (f as MockFile).dataURL as string);
    }
    return e;
  }

  /** Adopts an element made by user code (`file.previewElement = el`). */
  use(f: Item, e: HTMLElement): void {
    this.els.set(f, e);
    this.owner.set(e, f);
    this.refs.set(e, {
      name: all(e, 'data-ad-name'),
      size: all(e, 'data-ad-size'),
      bar: all(e, 'data-ad-uploadprogress'),
      err: all(e, 'data-ad-errormessage'),
      thumb: all(e, 'data-ad-thumbnail') as HTMLImageElement[],
      remove: all(e, 'data-ad-remove'),
      auto: null,
    });
    const r = this.refs.get(e) as Refs;
    for (const n of r.size) n.innerHTML = this.ad.filesize(f.size);
  }

  /** Writes the file's current state into its preview element, if one exists. */
  sync(f: Item, label: string): void {
    const e = this.els.get(f);
    const r = e && this.refs.get(e);
    if (!e || !r) return;
    const st = f.status || 'success';
    const o = this.ad.options;
    mark(e, 'processing', st === 'uploading');
    mark(e, 'success', st === 'success');
    mark(e, 'error', st === 'error');
    mark(e, 'canceled', st === 'canceled');
    mark(e, 'paused', st === 'paused');
    mark(e, 'complete', TERMINAL.test(st));
    const pct = st === 'success' ? 100 : (f as AnyDropFile).upload?.progress || 0;
    for (const n of r.name) n.textContent = label;
    for (const b of r.bar) {
      if (b.nodeName === 'PROGRESS') (b as HTMLProgressElement).value = pct;
      else b.style.width = pct + '%';
      const p = b.parentElement;
      if (p && p !== e) {
        p.setAttribute('role', 'progressbar');
        p.setAttribute('aria-valuemin', '0');
        p.setAttribute('aria-valuemax', '100');
        p.setAttribute('aria-valuenow', String(Math.round(pct)));
        p.setAttribute('aria-label', f.name);
      }
    }
    const msg = st === 'error' || st === 'canceled' ? this.msgs.get(f) || '' : '';
    for (const n of r.err) n.textContent = msg;
    if (r.auto) {
      r.auto.textContent = st === 'uploading' ? o.dictCancelUpload : o.dictRemoveFile;
    }
    this.thumbnail(f);
  }

  /** Drops the element of a row that left the window of a large list (its thumbnail stays cached). */
  release(f: Item): void {
    if (!this.touched.has(f)) this.els.delete(f);
  }

  // ------------------------------------------------------------ thumbnails

  private wanted(f: Item): boolean {
    const o = this.ad.options;
    return (
      o.createImageThumbnails &&
      f instanceof Blob &&
      looksLikeImage(f) &&
      f.size <= o.maxThumbnailFilesize * 1048576
    );
  }

  private thumbnail(f: Item): void {
    if (!this.wanted(f) || this.tried.has(f)) return;
    const url = this.cache.get(f);
    if (url) return this.show(f, url);
    this.tried.add(f);
    this.queue.push(f as AnyDropFile);
    this.soon();
  }

  /** A thumbnail for every accepted image, in add order, even without a visible row. */
  eager(f: Item): void {
    if (!this.wanted(f) || this.tried.has(f)) return;
    this.tried.add(f);
    this.eagerSet.add(f);
    this.queue.push(f as AnyDropFile);
    this.soon();
  }

  /** Rows are attached right after they render, so the check for a visible row runs a microtask later. */
  private soon(): void {
    void Promise.resolve().then(() => this.pump());
  }

  private pump(): void {
    while (!this.dead && this.busy < 2 && this.queue.length) {
      const f = this.queue.shift() as AnyDropFile;
      const e = this.els.get(f);
      // Only rows that are still on screen get a thumbnail.
      if (!this.eagerSet.has(f) && (!e || !e.isConnected)) {
        this.tried.delete(f);
        continue;
      }
      this.busy++;
      this.make(f).then(() => {
        this.busy--;
        this.pump();
      });
    }
  }

  private async make(f: AnyDropFile): Promise<void> {
    const o = this.ad.options;
    // Both null = full size, but never above MAX_THUMB: big images crash iOS Safari.
    const none = !o.thumbnailWidth && !o.thumbnailHeight;
    const w = none ? MAX_THUMB : o.thumbnailWidth && Math.min(o.thumbnailWidth, MAX_THUMB);
    const t = none ? MAX_THUMB : o.thumbnailHeight && Math.min(o.thumbnailHeight, MAX_THUMB);
    try {
      const img = await decodeImage(f);
      if (this.dead) return;
      const c = renderScaled(
        img,
        { width: w || null, height: t || null },
        none ? 'contain' : o.thumbnailMethod,
      );
      this.thumbReady(f, c.toDataURL(thumbMime(f)));
    } catch {
      if (!this.dead) this.fail(f);
    }
  }

  /** Thumbnail from a URL, for `displayExistingFile`. */
  async fromUrl(f: MockFile, src: string, cors?: string | null): Promise<void> {
    const o = this.ad.options;
    try {
      const img = await decodeImage(src, cors);
      if (this.dead) return;
      const c = renderScaled(
        img,
        { width: o.thumbnailWidth, height: o.thumbnailHeight },
        o.thumbnailMethod,
      );
      this.thumbReady(f, c.toDataURL(thumbMime(f)));
    } catch {
      if (!this.dead) this.fail(f);
    }
  }

  /** Stores, shows and announces a thumbnail (the `thumbnail` event). */
  thumbReady(f: Item, url: string): void {
    this.cache.set(f, url);
    if (this.cache.size > CACHE) {
      const old = this.cache.keys().next().value as object;
      this.cache.delete(old);
      this.tried.delete(old);
    }
    this.show(f, url);
    this.ad.emit('thumbnail', f as AnyDropFile, url);
  }

  show(f: Item, url: string): void {
    const e = this.els.get(f);
    const r = e && this.refs.get(e);
    if (!e || !r) return;
    for (const i of r.thumb) {
      i.alt = f.name;
      i.src = url;
    }
    mark(e, 'image-preview', true);
    mark(e, 'thumb-error', false);
  }

  private fail(f: Item): void {
    const e = this.els.get(f);
    if (!e) return;
    mark(e, 'thumb-error', true);
    const box = e.querySelector('.ad-file-thumb') || e;
    const msg = this.ad.options.dictThumbnailError;
    box.setAttribute('title', msg);
    // Visible to screen readers too, not only as a tooltip.
    if (!box.querySelector('.ad-thumb-error-text')) {
      box.appendChild(h('span', 'ad-thumb-error-text ad-sr-only', undefined, msg));
    }
  }

  destroy(): void {
    this.dead = true;
    this.queue.length = 0;
    this.cache.clear();
  }
}

/** Parses a preview template into its root element. */
export function parseTemplate(html: string): HTMLElement {
  const d = h('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}
