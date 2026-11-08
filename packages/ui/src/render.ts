// Render hooks: the shared context helpers and the lifecycle of the views hooks return.
import type { AnyDrop } from './AnyDrop';
import { fmt, h, report } from './dom';
import { iconEl } from './icons';
import type { AnyDropRenderContext, AnyDropRenderHooks } from './types';

/** A mounted hook result: the element that replaced the default content (if any) and the user's view. */
export interface Mounted {
  el?: HTMLElement | null;
  view: { update?(ctx: never): void; destroy?(): void };
  dead?: boolean;
}

const esc = (v: unknown) =>
  String(v == null ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The members every context has. The values of `${}` in `html` are escaped, never parsed as markup. */
export function baseContext(ad: AnyDrop): AnyDropRenderContext {
  const o = ad.options;
  return {
    instance: ad,
    layout: o.layout,
    t: (key, vars) => {
      const v = (o as unknown as Record<string, unknown>)[key];
      return typeof v === 'string' ? fmt(v, vars || {}) : String(key);
    },
    html: (strings, ...values) => {
      const t = document.createElement('template');
      t.innerHTML = strings.reduce((a, s, i) => a + esc(values[i - 1]) + s).trim();
      const n = t.content;
      if (n.childNodes.length === 1 && n.children.length === 1) return n.children[0] as HTMLElement;
      const d = h('div');
      d.appendChild(n);
      return d;
    },
    icon: (name) => iconEl(o, name),
  };
}

/**
 * Runs the hook `name`. Returns what to keep (a view), or `null` for the default content. An error in the
 * hook is reported and gives `null`: the default content stays.
 */
export function runHook(ad: AnyDrop, name: keyof AnyDropRenderHooks, ctx: unknown): Mounted | null {
  const fn = (ad.options.render || {})[name] as
    ((this: AnyDrop, c: unknown) => unknown) | undefined;
  if (!fn) return null;
  try {
    const r = fn.call(ad, ctx) as
      | (Mounted['view'] & { nodeType?: number; el?: HTMLElement | null })
      | string
      | null
      | undefined;
    if (!r) return null;
    if (typeof r === 'string') return { el: h('span', '', undefined, r), view: {} };
    if (r.nodeType === 1) return { el: r as unknown as HTMLElement, view: {} };
    return { el: r.el || null, view: r };
  } catch (e) {
    report(e);
    return null;
  }
}

/** `update` of a view (errors are reported and ignored). */
export function updateView(m: Mounted | null | undefined, ctx: unknown): void {
  try {
    if (m && !m.dead && m.view.update) m.view.update(ctx as never);
  } catch (e) {
    report(e);
  }
}

/** `destroy` of a view, exactly once. */
export function destroyView(m: Mounted | null | undefined): void {
  if (!m || m.dead) return;
  m.dead = true;
  try {
    if (m.view.destroy) m.view.destroy();
  } catch (e) {
    report(e);
  }
}
