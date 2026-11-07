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

/** Toggles both the Dropzone class (`dz-x`) and ours (`ad-x`). */
export function mark(e: Element, name: string, on: boolean): void {
  e.classList.toggle('dz-' + name, on);
  e.classList.toggle('ad-' + name, on);
}

export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
}

const PATHS: Record<string, string> = {
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  play: 'M8 5v14l11-7z',
  retry: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  close:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  caret: 'M9 5l8 7-8 7z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
};

const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name]}"/></svg>`;

/** A button with an icon, an accessible label and a `data-ad-action` hook. */
export function iconBtn(action: string, icon: string, label: string): HTMLButtonElement {
  const b = h('button', 'ad-btn ad-icon-btn', {
    type: 'button',
    'data-ad-action': action,
    'aria-label': label,
    title: label,
  });
  b.innerHTML = svg(icon);
  return b;
}

export function icon(name: string, cls: string): HTMLElement {
  const s = h('span', cls, { 'aria-hidden': 'true' });
  s.innerHTML = svg(name);
  return s;
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
