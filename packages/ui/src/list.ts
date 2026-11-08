// The virtualized tree / flat list: rows are derived from the core tree and file states, only the
// rows near the viewport exist in the DOM, and changes are painted in batches.
import type { AnyDropFile, FolderNode } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';
import { fmt, h, iconBtn, Listeners, report, textBtn } from './dom';
import { iconEl } from './icons';
import { destroyView, type Mounted, runHook, updateView } from './render';
import type { Item, MockFile } from './preview';
import type { AnyDropFileContext, AnyDropFolderContext, AnyDropRowAction } from './types';
import { VirtualList } from './virtual';

const KEEP = 400; // above this many rows, preview elements of rows that left the window are dropped
const ACTIVE = /^(added|queued|uploading|paused)$/;

const BUILTIN = {
  file: ['pause', 'resume', 'retry', 'cancel', 'remove'],
  folder: ['pause', 'resume', 'retry', 'cancel'],
};
const LABEL: Record<string, string> = {
  pause: 'dictPause',
  resume: 'dictResume',
  retry: 'dictRetry',
  cancel: 'dictCancelUpload',
  remove: 'dictRemoveFile',
};

type Ctx = AnyDropFileContext | AnyDropFolderContext;
type Act = Partial<AnyDropRowAction<Ctx>> & { id: string; builtin: boolean };

export const isFolder = (x: unknown): x is FolderNode => Array.isArray((x as FolderNode).children);

interface RowRefs {
  acts: Act[];
  actions: HTMLElement;
  badge: HTMLElement;
  name?: HTMLElement;
  count?: HTMLElement;
  bar?: HTMLElement;
  caret?: HTMLElement;
  main?: HTMLElement;
  b: Record<string, HTMLButtonElement>;
  view?: Mounted | null;
}

let seq = 0;

export class RowList {
  readonly v: VirtualList;
  readonly uid = 'ad' + ++seq;
  rows: (FolderNode | Item)[] = [];
  depths: number[] = [];
  private index = new Map<object, number>();
  private collapsed = new Set<string>();
  /** Folders that were still shown when the user pressed Clear and hold no files (core keeps empty folder nodes). */
  private ghosts = new WeakSet<object>();
  private active: object | null = null;
  private dirty = new Set<object>();
  private structure = true;
  private items = new WeakMap<HTMLElement, FolderNode | Item>();
  private refs = new WeakMap<HTMLElement, RowRefs>();
  private dom = new Listeners();

  constructor(private ad: AnyDrop) {
    this.v = new VirtualList('ad-list', {
      render: (i) => this.render(i),
      itemAt: (i) => this.rows[i],
      updated: () => this.describe(),
      release: (_i, row) => {
        // The view goes first, while its element is still in the document.
        destroyView((this.refs.get(row) as RowRefs).view);
        const it = this.items.get(row);
        if (it && !isFolder(it) && this.rows.length > KEEP) ad._uiPreviews.release(it);
      },
    });
    const el = this.v.el;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'tree');
    this.dom.on(el, 'click', (e: MouseEvent) => this.click(e));
    this.dom.on(el, 'keydown', (e: KeyboardEvent) => this.key(e));
    // The first focus gives the list an active row, so screen readers have something to read.
    this.dom.on(el, 'focus', () => {
      if (this.active == null && this.rows.length) this.setActive(0, false);
    });
    this.labels();
  }

  labels(): void {
    this.v.el.setAttribute('aria-label', this.ad.options.dictListLabel);
  }

  /** The rows changed (files or folders added or removed, view changed). */
  invalidate(hard = false): void {
    this.structure = true;
    // Hard: every row must be rebuilt (labels, template, row height), not just repainted.
    if (hard) this.v.reset();
  }

  /** After "Clear": folders that survive without files stay hidden until files come back. */
  hideEmpty(): void {
    const walk = (n: FolderNode) => {
      for (const c of n.children) {
        this.ghosts.add(c);
        walk(c);
      }
    };
    walk(this.ad.getTree());
    this.invalidate();
  }

  /** The state of an item changed: repaint it (and its ancestor folders) on the next flush. */
  touch(item: object): void {
    if (!this.index.size && !this.structure) return;
    this.dirty.add(item);
    if (this.ad.options.folderView === 'tree' && !isFolder(item)) {
      for (let n = (item as AnyDropFile).folder; n; n = n.parent as FolderNode) this.dirty.add(n);
    } else if (isFolder(item)) {
      for (let n = item.parent; n; n = n.parent as FolderNode) this.dirty.add(n);
    }
  }

  touchAll(): void {
    this.v.mounted.forEach((row) => {
      const it = this.items.get(row);
      if (it) this.dirty.add(it);
    });
  }

  flush(): void {
    if (this.structure) {
      this.structure = false;
      this.dirty.clear();
      this.rebuild();
      return;
    }
    this.dirty.forEach((it) => {
      const i = this.index.get(it);
      const row = i == null ? undefined : this.v.mounted.get(i);
      if (row) this.paint(row, it as FolderNode | Item);
    });
    this.dirty.clear();
  }

  private rebuild(): void {
    const { ad } = this;
    const rows: (FolderNode | Item)[] = ad._uiExtras.slice();
    const depths: number[] = rows.map(() => 0);
    if (ad.options.folderView === 'flat') {
      for (const f of ad.files) {
        rows.push(f);
        depths.push(0);
      }
    } else {
      const walk = (n: FolderNode, d: number) => {
        for (const c of n.children) {
          if (this.ghosts.has(c) && !c.counts.total) continue;
          rows.push(c);
          depths.push(d);
          if (!this.collapsed.has(c.path)) walk(c, d + 1);
        }
        for (const f of n.files) {
          rows.push(f);
          depths.push(d);
        }
      };
      walk(ad.getTree(), 0);
    }
    this.rows = rows;
    this.depths = depths;
    this.index.clear();
    rows.forEach((r, i) => this.index.set(r, i));
    const had = this.v.el.contains(document.activeElement) && document.activeElement !== this.v.el;
    this.v.setCount(
      rows.length,
      ad.options.rowHeight ?? (ad.options.layout === 'compact' ? 48 : 56),
    );
    this.v.mounted.forEach((row, i) => {
      const it = this.rows[i];
      if (it) this.paint(row, it);
    });
    // A removed row must not drop keyboard focus to the page body.
    if (had && !this.v.el.contains(document.activeElement)) this.v.el.focus();
    this.describe();
  }

  private describe(): void {
    const i = this.active == null ? undefined : this.index.get(this.active);
    const row = i == null ? undefined : this.v.mounted.get(i);
    if (row) this.v.el.setAttribute('aria-activedescendant', row.id);
    else this.v.el.removeAttribute('aria-activedescendant');
  }

  // ------------------------------------------------------------ rows

  /** Position and size inside the sibling group (tree levels), or in the whole list (flat view). */
  private place(i: number): [number, number] {
    const it = this.rows[i] as FolderNode | Item;
    const flat = this.ad.options.folderView === 'flat' || i < this.ad._uiExtras.length;
    if (flat) return [i + 1, this.rows.length];
    const parent = (isFolder(it) ? it.parent : (it as AnyDropFile).folder) as FolderNode | null;
    if (!parent) return [i + 1, this.rows.length];
    const size = parent.children.length + parent.files.length;
    return isFolder(it)
      ? [parent.children.indexOf(it) + 1, size]
      : [parent.children.length + parent.files.indexOf(it as AnyDropFile) + 1, size];
  }

  private render(i: number): HTMLElement {
    const { ad } = this;
    const o = ad.options;
    const item = this.rows[i] as FolderNode | Item;
    const folder = isFolder(item);
    const row = h('div', 'ad-row ' + (folder ? 'ad-folder-row' : 'ad-file-row'), {
      role: 'treeitem',
      id: `${this.uid}-${i}`,
      'aria-level': (this.depths[i] || 0) + 1,
    });
    const [pos, size] = this.place(i);
    row.setAttribute('aria-posinset', String(pos));
    row.setAttribute('aria-setsize', String(size));
    row.style.setProperty('--ad-depth', String(this.depths[i] || 0));
    this.items.set(row, item);
    const acts = h('div', 'ad-row-actions');
    const r: RowRefs = {
      badge: h('span', 'ad-badge'),
      b: {},
      actions: acts,
      acts: this.acts(folder),
    };
    if (folder) {
      const caret = iconBtn('toggle', iconEl(o, 'toggle'), o.dictCollapse);
      caret.classList.add('ad-caret');
      r.caret = caret;
      const main = h('div', 'ad-folder-main');
      r.name = h('span', 'ad-folder-name');
      r.count = h('span', 'ad-count');
      r.bar = h('span', 'ad-bar');
      const prog = h('div', 'ad-progress ad-folder-progress', { role: 'progressbar' });
      prog.appendChild(r.bar);
      const top = h('div', 'ad-folder-top');
      top.append(iconEl(o, 'folder', 'ad-folder-icon'), r.name, r.count);
      main.append(top, prog);
      r.main = main;
      row.append(caret, main);
    } else {
      row.appendChild(ad._uiPreviews.get(item as Item));
    }
    row.appendChild(r.badge);
    for (const a of r.acts) {
      acts.appendChild(
        (r.b[a.id] =
          a.icon || a.builtin ? iconBtn(a.id, iconEl(o, a.icon || a.id), '') : textBtn(a.id, '')),
      );
    }
    row.appendChild(acts);
    this.refs.set(row, r);
    this.paint(row, item);
    // The hook sees the default parts, already painted; the row is not in the document yet.
    const m = (r.view = runHook(ad, folder ? 'folder' : 'file', this.context(row, item, r)));
    if (m && m.el) {
      row.textContent = '';
      row.appendChild(m.el);
      row.classList.add('ad-row-custom');
    }
    return row;
  }

  /** The configured actions of a row kind: built-in ids and custom objects, as one list. */
  private acts(folder: boolean): Act[] {
    const kind = folder ? 'folder' : 'file';
    const list = (this.ad.options.rowActions || {})[kind] || BUILTIN[kind];
    return (list as (string | (Partial<AnyDropRowAction<Ctx>> & { id: string }))[]).map((a) => {
      const x = typeof a === 'string' ? { id: a } : a;
      return { ...x, builtin: BUILTIN[kind].indexOf(x.id) >= 0 };
    });
  }

  /** The render context of a row: its state, the default parts and the built-in actions. */
  private context(row: HTMLElement, item: FolderNode | Item, r: RowRefs): Ctx {
    const { ad } = this;
    const o = ad.options;
    const at = this.index.get(item);
    const depth = at == null ? 0 : this.depths[at] || 0;
    const folder = isFolder(item);
    const f = item as AnyDropFile;
    const st = (folder ? item.status : f.status) || 'success';
    let can: Record<string, boolean>;
    let waiting: boolean;
    if (folder) {
      const c = item.counts;
      const live = c.queued + c.uploading + c.added;
      can = {
        pause: !item.userPaused && (live > 0 || (ad._uiConn !== 'online' && c.paused > 0)),
        resume: !!item.userPaused,
        retry: c.error > 0,
        cancel: live + c.paused > 0,
      };
      waiting = !item.userPaused;
    } else {
      const own = ad._uiUserFiles.has(f);
      const held = ad._uiUserAll || this.ancestorPaused(f);
      can = {
        pause:
          !own &&
          (st === 'queued' ||
            st === 'uploading' ||
            st === 'added' ||
            (st === 'paused' && ad._uiConn !== 'online' && !held)),
        resume: st === 'paused' && own && !held,
        retry: st === 'error' && !!ad._uiErrors.get(f.id)?.retryable,
        cancel: ACTIVE.test(st),
        remove: !ACTIVE.test(st),
      };
      waiting = !own && !this.ancestorPaused(f);
    }
    // Paused only by the system (offline, unreachable): "Waiting for connection", not "Paused".
    waiting = st === 'paused' && ad._uiConn !== 'online' && !ad._uiUserAll && waiting;
    const run = (id: string) => () => {
      if (can[id]) ad._uiRun(id, item);
    };
    const c = Object.assign(ad._uiBase(), {
      kind: folder ? 'folder' : 'file',
      status: st,
      statusText: waiting
        ? o.dictWaitingForConnection
        : (o as unknown as Record<string, string>)[
            'dictStatus' + st.charAt(0).toUpperCase() + st.slice(1)
          ] || st,
      waiting,
      depth,
      active: item === this.active,
      row,
      can,
      pause: run('pause'),
      resume: run('resume'),
      retry: run('retry'),
      cancel: run('cancel'),
      remove: run('remove'),
    }) as unknown as Ctx;
    if (isFolder(item)) {
      const k = c as AnyDropFolderContext;
      k.folder = item;
      k.label = item.name;
      k.progress = item.progress;
      k.counts = item.counts;
      k.expanded = !this.collapsed.has(item.path);
      k.toggle = () => this.toggle(item);
      k.parts = {
        toggle: r.caret as HTMLButtonElement,
        main: r.main as HTMLElement,
        badge: r.badge,
        actions: r.actions,
      };
    } else {
      const k = c as AnyDropFileContext;
      const pv = ad._uiPreviews;
      k.file = f;
      k.label = o.folderView === 'flat' && f.relativePath ? f.relativePath : f.name;
      k.sizeText = ad.filesize(f.size).replace(/<[^>]*>/g, '');
      k.progress = st === 'success' ? 100 : f.upload?.progress || 0;
      k.error = ad._uiErrors.get(f.id) || null;
      k.errorMessage = st === 'error' || st === 'canceled' ? pv.msgs.get(f) || '' : '';
      k.thumbnail = pv.thumb(f);
      k.parts = { preview: pv.get(f), badge: r.badge, actions: r.actions };
    }
    return c;
  }

  private paint(row: HTMLElement, item: FolderNode | Item): void {
    const { ad } = this;
    const o = ad.options;
    const r = this.refs.get(row) as RowRefs;
    const c = this.context(row, item, r);
    row.style.setProperty('--ad-depth', String(c.depth));
    row.setAttribute('aria-level', String(c.depth + 1));
    row.classList.toggle('ad-row-active', c.active);
    row.setAttribute('aria-selected', String(c.active));
    if (c.kind === 'folder') {
      const n = c.counts;
      (r.name as HTMLElement).textContent = c.label;
      (r.count as HTMLElement).textContent = fmt(o.dictFolderCount, {
        done: n.success,
        total: n.total,
      });
      (r.bar as HTMLElement).style.width = c.progress + '%';
      const p = (r.bar as HTMLElement).parentElement as HTMLElement;
      p.setAttribute('aria-valuenow', String(Math.round(c.progress)));
      p.setAttribute('aria-label', c.label);
      row.setAttribute('aria-expanded', String(c.expanded));
      const caret = r.caret as HTMLElement;
      caret.classList.toggle('ad-open', c.expanded);
      caret.setAttribute('aria-expanded', String(c.expanded));
      const cap = c.expanded ? o.dictCollapse : o.dictExpand;
      caret.title = cap;
      caret.setAttribute('aria-label', cap);
    } else {
      ad._uiPreviews.sync(c.file as AnyDropFile, c.label);
      const e = c.parts.preview;
      if (!(r.view && r.view.el) && e.parentElement !== row) row.insertBefore(e, r.badge);
    }
    r.badge.textContent = c.statusText;
    row.setAttribute('data-status', c.status);
    row.className = row.className.replace(/ ad-s-\w+/, '') + ' ad-s-' + c.status;
    const fa = document.activeElement as HTMLElement | null; // read before a button is hidden
    for (const a of r.acts) {
      const b = r.b[a.id] as HTMLButtonElement;
      let show = !a.builtin || (c.can as Record<string, boolean>)[a.id];
      try {
        if (show && a.when) show = !!a.when(c);
      } catch (e) {
        report(e);
        show = false;
      }
      b.hidden = !show;
      let text = a.label;
      try {
        if (typeof text === 'function') text = text(c);
      } catch (e) {
        report(e);
        text = '';
      }
      text = text || (a.builtin ? (o[LABEL[a.id] as 'dictPause'] as string) : a.id);
      if (b.classList.contains('ad-icon-btn')) {
        b.title = text;
        b.setAttribute('aria-label', text);
      } else b.textContent = text;
    }
    // The focused button may have just been hidden (cancel gives way to remove): keep the focus in the row.
    if (fa && fa.hidden && row.contains(fa)) {
      (r.actions.querySelector<HTMLElement>('[data-ad-action]:not([hidden])') || this.v.el).focus();
    }
    updateView(r.view, c);
  }

  private ancestorPaused(f: AnyDropFile): boolean {
    for (let n: FolderNode | null = f.folder; n; n = n.parent) if (n.userPaused) return true;
    return false;
  }

  // ------------------------------------------------------------ input

  private toggle(f: FolderNode): void {
    if (this.collapsed.has(f.path)) this.collapsed.delete(f.path);
    else this.collapsed.add(f.path);
    this.active = f;
    this.rebuild();
    this.v.el.focus();
  }

  private click(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.ad-row');
    const item = row && this.items.get(row);
    if (!row || !item) return;
    const btn = t.closest<HTMLElement>('[data-ad-action]');
    const action = btn?.getAttribute('data-ad-action');
    if (action === 'toggle' && isFolder(item)) return this.toggle(item);
    if (action) return this.fire(action, row, item, e);
    if (t.closest('[data-ad-remove]')) {
      e.preventDefault();
      e.stopPropagation();
      return this.ad._uiRemoveLink(item as Item);
    }
    this.setActive(this.index.get(item) as number, false);
    if (isFolder(item)) this.toggle(item);
  }

  private setActive(i: number, reveal = true): void {
    const item = this.rows[i];
    if (!item) return;
    this.active = item;
    if (reveal) this.v.reveal(i);
    this.v.mounted.forEach((row) => {
      const it = this.items.get(row);
      if (it) this.paint(row, it);
    });
    this.describe();
  }

  private key(e: KeyboardEvent): void {
    // Keys pressed on a button inside a row belong to that button (Enter, Space, Tab).
    if (e.target !== this.v.el) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const n = this.rows.length;
    if (!n) return;
    const cur = this.active == null ? -1 : (this.index.get(this.active) ?? -1);
    const item = this.rows[cur];
    let to = -2;
    let k = e.key;
    // Left and Right swap in right-to-left text.
    if (
      (k === 'ArrowLeft' || k === 'ArrowRight') &&
      getComputedStyle(this.v.el).direction === 'rtl'
    ) {
      k = k === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    }
    switch (k) {
      case 'ArrowDown':
        to = Math.min(n - 1, cur + 1);
        break;
      case 'ArrowUp':
        to = Math.max(0, cur - 1);
        break;
      case 'PageDown':
        to = Math.min(n - 1, cur + 10);
        break;
      case 'PageUp':
        to = Math.max(0, cur - 10);
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = n - 1;
        break;
      case 'ArrowRight':
        if (item && isFolder(item)) {
          if (this.collapsed.has(item.path)) return this.stop(e, () => this.toggle(item));
          to = Math.min(n - 1, cur + 1);
        }
        break;
      case 'ArrowLeft':
        if (item && isFolder(item) && !this.collapsed.has(item.path)) {
          return this.stop(e, () => this.toggle(item));
        }
        for (let i = cur - 1, d = this.depths[cur] || 0; i >= 0 && d > 0; i--) {
          if ((this.depths[i] as number) < d && isFolder(this.rows[i])) {
            to = i;
            break;
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (item && isFolder(item)) return this.stop(e, () => this.toggle(item));
        return this.stop(e, () => {});
      case 'Delete':
      case 'Backspace':
        return this.shortcut(e, cur, ['cancel', 'remove']);
      case 'p':
      case 'P':
        return this.shortcut(e, cur, ['resume', 'pause']);
      case 'r':
      case 'R':
        return this.shortcut(e, cur, ['retry']);
      default:
        return;
    }
    if (to === -2) return;
    e.preventDefault();
    this.setActive(Math.max(0, to));
  }

  /** Runs the first of `ids` that is configured for the row and applies now (its button is shown). */
  private shortcut(e: KeyboardEvent, at: number, ids: string[]): void {
    const row = this.v.mounted.get(at);
    const item = this.rows[at];
    const r = row && this.refs.get(row);
    if (!row || !item || !r) return;
    for (const id of ids) {
      const b = r.b[id];
      if (!b || b.hidden) continue;
      e.preventDefault();
      // A folder cancel is asked about first.
      if (id === 'cancel' && isFolder(item) && typeof window !== 'undefined') {
        return (this.ad.constructor as typeof AnyDrop).confirm(
          this.ad.options.dictCancelUploadConfirmation,
          () => this.fire(id, row, item, e),
        );
      }
      return this.fire(id, row, item, e);
    }
  }

  /** A row action (button or shortcut): announced with `actionclicked`, then run (an override or the built-in). */
  private fire(id: string, row: HTMLElement, item: FolderNode | Item, ev: Event): void {
    const r = this.refs.get(row);
    const a = r && r.acts.filter((x) => x.id === id)[0];
    if (!r || !a) return;
    this.ad.emit('actionclicked', id, item as AnyDropFile | FolderNode);
    const c = this.context(row, item, r);
    try {
      if (a.onClick) a.onClick(c, ev as Event);
      else if (a.builtin) (c as unknown as Record<string, () => void>)[id]?.();
    } catch (err) {
      report(err);
    }
    this.ad._uiSchedule();
  }

  private stop(e: Event, fn: () => void): void {
    e.preventDefault();
    fn();
  }

  indexOf(item: object): number | undefined {
    return this.index.get(item);
  }

  destroy(): void {
    this.dom.clear();
    this.v.destroy();
    this.rows = [];
    this.index.clear();
  }
}

export type { MockFile };
