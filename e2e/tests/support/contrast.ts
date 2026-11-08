// WCAG contrast helper for the theme-preset specs (decision 0021, section 13). No dependency: the page
// reports every colour already resolved to RGBA (through a canvas, so any CSS colour syntax the
// browser understands works, including color-mix() and the modern color() forms), and the maths runs
// in Node.
import type { Page } from '@playwright/test';

export type Rgba = [number, number, number, number]; // r, g, b 0..255, a 0..1

/** Source over destination, both RGBA; the result is opaque when `dst` is. */
export function over(src: Rgba, dst: Rgba): Rgba {
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i: 0 | 1 | 2) => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
export const luminance = (c: Rgba) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** WCAG 2 contrast ratio of two opaque colours (1 to 21). */
export function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flattens bottom-first layers over an opaque base. */
export const flatten = (layers: Rgba[], base: Rgba = [255, 255, 255, 1]): Rgba =>
  layers.reduce((acc, l) => over(l, acc), base);

export interface Sample {
  /** What was measured, for the failure message. */
  what: string;
  kind: 'text' | 'ui';
  fg: Rgba;
  /** Background layers from the page down to the element (bottom first). */
  bg: Rgba[];
}

export interface Measured extends Sample {
  ratio: number;
  min: number;
}

/**
 * Collects the text and control colours inside `root` as the user sees them: every visible element with
 * its own text (needs 4.5:1), every enabled icon button (3:1), the focus colour and the zone border
 * against the panel background (3:1).
 */
export async function collectSamples(page: Page, root: string): Promise<Sample[]> {
  return page.evaluate((sel) => {
    const rootEl = document.querySelector(sel);
    if (!rootEl) throw new Error('no element ' + sel);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (css: string): [number, number, number, number] => {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = css;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      const a = (d[3] as number) / 255;
      // getImageData returns premultiplied-then-rounded values: good enough for a 4.5 versus 4.49 call.
      return [d[0] as number, d[1] as number, d[2] as number, a];
    };
    const layers = (el: Element): [number, number, number, number][] => {
      const out: [number, number, number, number][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const v = rgba(c);
        if (v[3] > 0) out.unshift(v);
      }
      return out;
    };
    const opacity = (el: Element) => {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement)
        o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
      }
      return true;
    };
    const describe = (el: Element) =>
      el.tagName.toLowerCase() +
      (el.getAttribute('data-ad-action') ? `[${el.getAttribute('data-ad-action')}]` : '') +
      (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '');
    const out: {
      what: string;
      kind: 'text' | 'ui';
      fg: [number, number, number, number];
      bg: [number, number, number, number][];
    }[] = [];
    const all = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
    for (const el of all) {
      if (!visible(el)) continue;
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0,
      );
      const disabled = (el as HTMLButtonElement).disabled === true;
      if (own && !disabled) {
        const s = getComputedStyle(el);
        const fg = rgba(s.color);
        fg[3] *= opacity(el);
        out.push({
          what: `text "${(el.textContent || '').trim().slice(0, 30)}" in ${describe(el)}`,
          kind: 'text',
          fg,
          bg: layers(el),
        });
      }
      if (el.classList.contains('ad-icon-btn') && !disabled) {
        const fg = rgba(getComputedStyle(el).color);
        fg[3] *= opacity(el);
        out.push({ what: `icon ${describe(el)}`, kind: 'ui', fg, bg: layers(el) });
      }
    }
    // The focus ring colour and the zone border against the surface they sit on (the zone's own fill: a
    // dark zone on a light page is told apart by its fill, the border has to stand out inside it).
    const target = (rootEl.querySelector('.ad-panel') || rootEl) as Element;
    const s = getComputedStyle(target);
    const focus = s.getPropertyValue('--ad-color-focus').trim();
    if (focus) {
      out.push({ what: '--ad-color-focus', kind: 'ui', fg: rgba(focus), bg: layers(target) });
    }
    const zoneStyle = getComputedStyle(rootEl);
    if (zoneStyle.borderTopStyle !== 'none' && parseFloat(zoneStyle.borderTopWidth) > 0) {
      out.push({
        what: `zone border (${zoneStyle.borderTopStyle})`,
        kind: 'ui',
        fg: rgba(zoneStyle.borderTopColor),
        bg: layers(rootEl),
      });
    }
    return out;
  }, root);
}

export function measure(samples: Sample[], base: Rgba = [255, 255, 255, 1]): Measured[] {
  return samples.map((s) => {
    const bg = flatten(s.bg, base);
    const fg = over(s.fg, bg);
    return { ...s, ratio: ratio(fg, bg), min: s.kind === 'text' ? 4.5 : 3 };
  });
}

export const failures = (m: Measured[]) =>
  m
    .filter((x) => x.ratio < x.min)
    .map((x) => `${x.what}: ${x.ratio.toFixed(2)}:1 (needs ${x.min}:1)`);
