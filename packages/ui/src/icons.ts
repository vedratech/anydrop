// Built-in icons and the `icons` option (a record of SVG strings or a resolver function).
import type { AnyDropIcons } from './types';
import { h } from './dom';

const X =
  'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

const PATHS: Record<string, string> = {
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  resume: 'M8 5v14l11-7z',
  retry: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
  cancel: X,
  remove: X,
  toggle: 'M9 5l8 7-8 7z',
  folder: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
  success: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z',
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z',
};

const builtin = (name: string) =>
  Object.prototype.hasOwnProperty.call(PATHS, name)
    ? `<svg viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d="${PATHS[name]}"/></svg>`
    : '';

/**
 * `<span class="ad-icon" aria-hidden="true">` holding the icon `name`: the `icons` option first, then the
 * built-in one. A name that starts with `<` is SVG markup. Icons are trusted developer input, never user data.
 */
export function iconEl(o: { icons?: AnyDropIcons }, name: string, cls = ''): HTMLElement {
  const s = h('span', ('ad-icon ' + cls).trim(), { 'aria-hidden': 'true' });
  const ic = o.icons;
  const v =
    name.charAt(0) === '<'
      ? name
      : typeof ic === 'function'
        ? ic(name)
        : ic && Object.prototype.hasOwnProperty.call(ic, name) && ic[name];
  if (v && typeof v !== 'string') s.appendChild(v);
  else s.innerHTML = v || builtin(name);
  return s;
}
