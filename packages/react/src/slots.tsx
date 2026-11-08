import {
  Component,
  Fragment,
  createElement,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { AnyDropSlotProps } from './types';

export type SlotKind = 'file' | 'folder' | 'toolbar' | 'message' | 'errorItem';

export const SLOT_PROPS: Record<SlotKind, keyof AnyDropSlotProps> = {
  file: 'renderFile',
  folder: 'renderFolder',
  toolbar: 'renderToolbar',
  message: 'renderMessage',
  errorItem: 'renderErrorItem',
};
export const SLOT_KINDS = Object.keys(SLOT_PROPS) as SlotKind[];

export interface SlotEntry {
  id: number;
  kind: SlotKind;
  el: HTMLElement;
  ctx: unknown;
  version: number;
  listeners: Array<() => void>;
}

/** Mounted slot views (entries) of one `<AnyDrop>`. Changes reach React in one batched commit. */
export class SlotStore {
  private entries = new Map<number, SlotEntry>();
  private list: readonly SlotEntry[] = [];
  private listListeners: Array<() => void> = [];
  private dirty = new Set<SlotEntry>();
  private structure = false;
  private scheduled = false;
  private seq = 0;
  disposed = false;

  getList = () => this.list;
  subscribeList = (l: () => void) => {
    this.listListeners.push(l);
    return () => {
      const i = this.listListeners.indexOf(l);
      if (i >= 0) this.listListeners.splice(i, 1);
    };
  };

  /** The hook the ui calls to mount a view of `kind`. */
  hook(kind: SlotKind) {
    return (ctx: unknown) => {
      const el = document.createElement('div');
      el.setAttribute('data-ad-slot', kind);
      const entry: SlotEntry = { id: ++this.seq, kind, el, ctx, version: 0, listeners: [] };
      this.entries.set(entry.id, entry);
      this.structure = true;
      this.schedule();
      return {
        el,
        update: (next: unknown) => {
          if (!this.entries.has(entry.id)) return;
          entry.ctx = next;
          entry.version++;
          this.dirty.add(entry);
          this.schedule();
        },
        destroy: () => {
          if (!this.entries.delete(entry.id)) return;
          this.dirty.delete(entry);
          this.structure = true;
          this.schedule();
        },
      };
    };
  }

  private schedule() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    // After the ui's animation-frame paint callback and before the browser paints: one commit per batch.
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed) return;
      flushSync(() => this.notify());
    });
  }

  private notify() {
    if (this.structure) {
      this.structure = false;
      this.list = Array.from(this.entries.values());
      for (const l of this.listListeners.slice()) l();
    }
    const dirty = Array.from(this.dirty);
    this.dirty.clear();
    for (const e of dirty) for (const l of e.listeners.slice()) l();
  }

  /** Forget everything (unmount). Views are destroyed by the ui's own `destroy()`. */
  dispose() {
    this.disposed = true;
    this.entries.clear();
    this.dirty.clear();
    this.list = [];
    this.structure = false;
  }

  /** Allow flushing again (StrictMode runs the mount effect twice on the same component). */
  revive() {
    this.disposed = false;
  }
}

function report(error: unknown) {
  const g = globalThis as { reportError?: (e: unknown) => void };
  if (typeof g.reportError === 'function') g.reportError(error);
  else console.error(error);
}

/** One slot's own error boundary: a throwing row renders nothing and does not take the uploader down. */
class SlotBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo) {
    report(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function SlotContent({
  entry,
  render,
}: {
  entry: SlotEntry;
  render: ((ctx: never) => ReactNode) | undefined;
}) {
  useSyncExternalStore(
    (l) => {
      entry.listeners.push(l);
      return () => {
        const i = entry.listeners.indexOf(l);
        if (i >= 0) entry.listeners.splice(i, 1);
      };
    },
    () => entry.version,
    () => 0,
  );
  return (render ? render(entry.ctx as never) : null) ?? null;
}

const EMPTY: readonly SlotEntry[] = [];

/** Renders one portal per mounted slot view. Renders no DOM of its own. */
export function Slots({ store, props }: { store: SlotStore; props: AnyDropSlotProps }) {
  const list = useSyncExternalStore(store.subscribeList, store.getList, () => EMPTY);
  return createElement(
    Fragment,
    null,
    list.map((entry) =>
      createPortal(
        createElement(
          SlotBoundary,
          null,
          createElement(SlotContent, {
            entry,
            render: props[SLOT_PROPS[entry.kind]] as ((ctx: never) => ReactNode) | undefined,
          }),
        ),
        entry.el,
        String(entry.id),
      ),
    ),
  );
}
