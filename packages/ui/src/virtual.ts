// A minimal fixed-row-height virtual list: only the rows in (or near) the viewport exist in the DOM.
import { h, Listeners } from './dom';

const OVERSCAN = 6;

export interface VirtualHooks {
  /** Builds the element of row `i` (position and ARIA indexes are set by the list). */
  render(i: number): HTMLElement;
  /** Called when a row leaves the window. */
  release?(i: number, el: HTMLElement): void;
  /** The item shown at row `i`: a mounted row is kept when its item stays at the same index. */
  itemAt?(i: number): unknown;
  /** Called after every update of the window (mounting or scrolling). */
  updated?(): void;
}

export class VirtualList {
  readonly el: HTMLElement;
  readonly mounted = new Map<number, HTMLElement>();
  private items = new Map<number, unknown>();
  count = 0;
  rowHeight = 56;
  private spacer: HTMLElement;
  private dom = new Listeners();

  constructor(
    cls: string,
    private hooks: VirtualHooks,
  ) {
    this.el = h('div', cls);
    this.spacer = h('div', 'ad-spacer');
    this.el.appendChild(this.spacer);
    this.dom.on(this.el, 'scroll', () => this.update(), { passive: true });
  }

  /** New row count or height: drops every mounted row and renders the window again. */
  setCount(count: number, rowHeight: number): void {
    this.count = count;
    this.rowHeight = rowHeight;
    this.spacer.style.height = count * rowHeight + 'px';
    this.refresh();
  }

  /** Drops every mounted row (the next update renders them again). */
  reset(): void {
    this.mounted.forEach((row, i) => this.unmount(i, row));
  }

  /** Re-renders the window, keeping the rows whose item is unchanged (so focus and previews survive). */
  refresh(): void {
    const at = this.hooks.itemAt;
    this.mounted.forEach((row, i) => {
      if (at && i < this.count && at(i) === this.items.get(i)) {
        row.style.top = i * this.rowHeight + 'px';
        row.style.height = this.rowHeight + 'px';
      } else this.unmount(i, row);
    });
    this.update();
  }

  update(): void {
    const { el, rowHeight: rh, count } = this;
    const view = el.clientHeight || rh * 10;
    const first = Math.max(0, Math.floor(el.scrollTop / rh) - OVERSCAN);
    const last = Math.min(count - 1, Math.ceil((el.scrollTop + view) / rh) + OVERSCAN);
    this.mounted.forEach((row, i) => {
      if (i < first || i > last) this.unmount(i, row);
    });
    for (let i = first; i <= last; i++) {
      if (this.mounted.has(i)) continue;
      const row = this.hooks.render(i);
      row.style.top = i * rh + 'px';
      row.style.height = rh + 'px';
      this.spacer.appendChild(row);
      this.mounted.set(i, row);
      this.items.set(i, this.hooks.itemAt?.(i));
    }
    this.hooks.updated?.();
  }

  /** Scrolls so that row `i` is fully visible. */
  reveal(i: number): void {
    const { el, rowHeight: rh } = this;
    const top = i * rh;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rh > el.scrollTop + el.clientHeight) el.scrollTop = top + rh - el.clientHeight;
    this.update();
  }

  private unmount(i: number, row: HTMLElement): void {
    this.hooks.release?.(i, row);
    row.remove();
    this.mounted.delete(i);
    this.items.delete(i);
  }

  destroy(): void {
    this.dom.clear();
    this.mounted.forEach((el, i) => this.unmount(i, el));
    this.el.remove();
  }
}
