// Small DOM helpers. Nothing here touches `document` at import time.
export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function setAttr(e: Element, k: string, v: Attrs[string]): void {
  if (v === false || v == null) e.removeAttribute(k);
  else e.setAttribute(k, v === true ? '' : String(v));
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  attrs?: Attrs,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const k in attrs) setAttr(e, k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

/** Resolves a selector or element; `scope` limits selector lookups (default: the document). */
export function resolve(ref: unknown, scope?: ParentNode): HTMLElement | null {
  if (typeof ref === 'string') return (scope || document).querySelector<HTMLElement>(ref);
  return ref && (ref as Node).nodeType === 1 ? (ref as HTMLElement) : null;
}

/** Toggles the state class `ad-<name>`. */
export function mark(e: Element, name: string, on: boolean): void {
  e.classList.toggle('ad-' + name, on);
}

export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** A button with an icon, an accessible label and a `data-ad-action` hook. */
export function iconBtn(action: string, icon: HTMLElement, label: string): HTMLButtonElement {
  const b = h('button', 'ad-btn ad-icon-btn', {
    type: 'button',
    'data-ad-action': action,
    'aria-label': label,
    title: label,
  });
  b.appendChild(icon);
  return b;
}

export function textBtn(action: string, label: string, cls = ''): HTMLButtonElement {
  return h('button', 'ad-btn ' + cls, { type: 'button', 'data-ad-action': action }, label);
}

/** Runs `fn` on the next frame (or soon after, where there are no frames). Returns a canceller. */
export function frame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const t = setTimeout(fn, 16);
  return () => clearTimeout(t);
}

/** Reports an error from user code without breaking the caller (like `window.onerror`). */
export function report(e: unknown): void {
  const g = globalThis as { reportError?: (e: unknown) => void };
  if (typeof g.reportError === 'function') g.reportError(e);
  else if (typeof console !== 'undefined') console.error(e);
}

/** Registry of DOM listeners that can be removed all at once. */
export class Listeners {
  private list: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];
  on(t: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
    t.addEventListener(type, fn as unknown as EventListener, opts);
    this.list.push([t, type, fn as unknown as EventListener, opts]);
  }
  clear(): void {
    for (const [t, type, fn, o] of this.list) t.removeEventListener(type, fn, o);
    this.list = [];
  }
}
