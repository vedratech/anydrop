// The virtualized tree / flat list: rows are derived from the core tree and file states, only the
// rows near the viewport exist in the DOM, and changes are painted in batches.
import type { AnyDropFile, FolderNode } from '@vedratech/anydrop-core';
import type { AnyDrop } from './AnyDrop';
import { fmt, h, icon, iconBtn, Listeners } from './dom';
import type { Item, MockFile } from './preview';
import { VirtualList } from './virtual';

const KEEP = 400; // above this many rows, preview elements of rows that left the window are dropped
const ACTIVE = /^(added|queued|uploading|paused)$/;

export const isFolder = (x: unknown): x is FolderNode => Array.isArray((x as FolderNode).children);

interface RowRefs {
  badge: HTMLElement;
  name?: HTMLElement;
  count?: HTMLElement;
  bar?: HTMLElement;
  caret?: HTMLElement;
  b: Record<string, HTMLButtonElement>;
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
    this.v.setCount(rows.length, ad.options.rowHeight);
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
    const r: RowRefs = { badge: h('span', 'ad-badge'), b: {} };
    if (folder) {
      const caret = iconBtn('toggle', 'caret', o.dictCollapse);
      caret.classList.add('ad-caret');
      r.caret = caret;
      const main = h('div', 'ad-folder-main');
      r.name = h('span', 'ad-folder-name');
      r.count = h('span', 'ad-count');
      r.bar = h('span', 'ad-bar');
      const prog = h('div', 'ad-progress ad-folder-progress', { role: 'progressbar' });
      prog.appendChild(r.bar);
      const top = h('div', 'ad-folder-top');
      top.append(icon('folder', 'ad-folder-icon'), r.name, r.count);
      main.append(top, prog);
      row.append(caret, main);
    } else {
      row.appendChild(ad._uiPreviews.get(item as Item));
    }
    row.appendChild(r.badge);
    const acts = h('div', 'ad-row-actions');
    for (const [a, ic, label] of [
      ['pause', 'pause', o.dictPause],
      ['resume', 'play', o.dictResume],
      ['retry', 'retry', o.dictRetry],
      ['cancel', 'close', o.dictCancelUpload],
    ] as const) {
      acts.appendChild((r.b[a] = iconBtn(a, ic, label)));
    }
    row.appendChild(acts);
    this.refs.set(row, r);
    this.paint(row, item);
    return row;
  }

  private paint(row: HTMLElement, item: FolderNode | Item): void {
    const { ad } = this;
    const o = ad.options;
    const r = this.refs.get(row) as RowRefs;
    const at = this.index.get(item);
    if (at != null) {
      const d = this.depths[at] || 0;
      row.style.setProperty('--ad-depth', String(d));
      row.setAttribute('aria-level', String(d + 1));
    }
    row.classList.toggle('ad-row-active', item === this.active);
    row.setAttribute('aria-selected', String(item === this.active));
    let st: string;
    let canPause: boolean;
    let canResume: boolean;
    let canRetry: boolean;
    let canCancel: boolean;
    if (isFolder(item)) {
      const c = item.counts;
      st = item.status;
      const open = !this.collapsed.has(item.path);
      (r.name as HTMLElement).textContent = item.name;
      (r.count as HTMLElement).textContent = fmt(o.dictFolderCount, {
        done: c.success,
        total: c.total,
      });
      (r.bar as HTMLElement).style.width = item.progress + '%';
      const p = (r.bar as HTMLElement).parentElement as HTMLElement;
      p.setAttribute('aria-valuenow', String(Math.round(item.progress)));
      p.setAttribute('aria-label', item.name);
      row.setAttribute('aria-expanded', String(open));
      (r.caret as HTMLElement).classList.toggle('ad-open', open);
      (r.caret as HTMLElement).setAttribute('aria-expanded', String(open));
      const cap = open ? o.dictCollapse : o.dictExpand;
      (r.caret as HTMLElement).title = cap;
      (r.caret as HTMLElement).setAttribute('aria-label', cap);
      const live = c.queued + c.uploading + c.added;
      canPause = !item.userPaused && (live > 0 || (ad._uiConn !== 'online' && c.paused > 0));
      canResume = !!item.userPaused;
      canRetry = c.error > 0;
      canCancel = live + c.paused > 0;
    } else {
      const f = item as AnyDropFile;
      st = f.status || 'success';
      const label = o.folderView === 'flat' && f.relativePath ? f.relativePath : f.name;
      ad._uiPreviews.sync(f, label);
      const e = ad._uiPreviews.has(f) ? ad._uiPreviews.get(f) : null;
      if (e && e.parentElement !== row) row.insertBefore(e, r.badge);
      const own = ad._uiUserFiles.has(f);
      const held = ad._uiUserAll || this.ancestorPaused(f);
      canPause =
        !own &&
        (st === 'queued' ||
          st === 'uploading' ||
          st === 'added' ||
          (st === 'paused' && ad._uiConn !== 'online' && !held));
      canResume = st === 'paused' && own && !held;
      canRetry = st === 'error' && !!ad._uiErrors.get(f.id)?.retryable;
      canCancel = true;
      const cancel = r.b.cancel as HTMLButtonElement;
      const text = ACTIVE.test(st) ? o.dictCancelUpload : o.dictRemoveFile;
      cancel.title = text;
      cancel.setAttribute('aria-label', text);
    }
    // Paused only by the system (offline, unreachable): "Waiting for connection", not "Paused".
    const waiting =
      st === 'paused' &&
      ad._uiConn !== 'online' &&
      !ad._uiUserAll &&
      (isFolder(item)
        ? !item.userPaused
        : !ad._uiUserFiles.has(item) && !this.ancestorPaused(item as AnyDropFile));
    r.badge.textContent = waiting
      ? o.dictWaitingForConnection
      : (o as unknown as Record<string, string>)[
          'dictStatus' + st.charAt(0).toUpperCase() + st.slice(1)
        ] || st;
    row.setAttribute('data-status', st);
    row.className = row.className.replace(/ ad-s-\w+/, '') + ' ad-s-' + st;
    (r.b.pause as HTMLElement).hidden = !canPause;
    (r.b.resume as HTMLElement).hidden = !canResume;
    (r.b.retry as HTMLElement).hidden = !canRetry;
    (r.b.cancel as HTMLElement).hidden = !canCancel;
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
    if (action) return this.ad._uiRun(action, item);
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
    switch (e.key) {
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
        if (item) return this.stop(e, () => this.ad._uiRun('cancel-key', item));
        return;
      case 'p':
      case 'P':
        if (item) {
          const r = this.refs.get(this.v.mounted.get(cur) as HTMLElement);
          const a = r && !r.b.resume?.hidden ? 'resume' : 'pause';
          return this.stop(e, () => this.ad._uiRun(a, item));
        }
        return;
      case 'r':
      case 'R':
        if (item) return this.stop(e, () => this.ad._uiRun('retry', item));
        return;
      default:
        return;
    }
    if (to === -2) return;
    e.preventDefault();
    this.setActive(Math.max(0, to));
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
