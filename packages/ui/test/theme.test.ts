import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('themePreset', () => {
  it('adds ad-theme-<name> to the element and the panel, and removes it on destroy', async () => {
    const { el, ad } = mount({ themePreset: 'glass' });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const panel = el.querySelector('.ad-panel')!;
    expect(el.classList.contains('ad-theme-glass')).toBe(true);
    expect(panel.classList.contains('ad-theme-glass')).toBe(true);
    ad.destroy();
    expect(el.hasAttribute('class')).toBe(false);
  });

  it('is swapped at runtime and works with a panel in another container', async () => {
    document.body.innerHTML = '<div id="z"></div><div id="out"></div>';
    const { AnyDrop } = await import('../src/index');
    const el = document.getElementById('z')!;
    const ad = new AnyDrop(el, {
      url: '/u',
      autoProcessQueue: false,
      previewsContainer: '#out',
      themePreset: 'rounded',
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const panel = document.querySelector('#out .ad-panel')!;
    expect(panel.classList.contains('ad-theme-rounded')).toBe(true);
    ad.setOption('themePreset', 'acme');
    expect(el.classList.contains('ad-theme-rounded')).toBe(false);
    expect(el.classList.contains('ad-theme-acme')).toBe(true);
    expect(panel.classList.contains('ad-theme-rounded')).toBe(false);
    expect(panel.classList.contains('ad-theme-acme')).toBe(true);
    ad.setOption('themePreset', null);
    expect(el.className).not.toContain('ad-theme');
    expect(panel.className).not.toContain('ad-theme');
    ad.destroy();
  });

  it('combines with theme (colour scheme) and survives a panel rebuild', async () => {
    const { el, ad } = mount({ themePreset: 'minimal', theme: 'dark' });
    await ad.addFiles([file('a.txt')]);
    ad.setOption('layout', 'compact');
    await settle(ad);
    const panel = el.querySelector('.ad-panel')!;
    expect(panel.classList.contains('ad-theme-minimal')).toBe(true);
    expect(panel.getAttribute('data-ad-theme')).toBe('dark');
    ad.destroy();
  });
});

describe('preset files and variables', () => {
  const css = (f: string) => readFileSync(`src/${f}`, 'utf8'); // vitest runs in packages/ui
  it('each preset file scopes its rules to its own class, light and dark', () => {
    for (const n of ['minimal', 'rounded', 'enterprise', 'glass']) {
      const c = css(`themes/${n}.css`);
      expect(c).toContain(`.ad-root.ad-theme-${n}`);
      expect(c).toContain(`.ad-panel.ad-theme-${n}`);
      expect(c).toContain('prefers-color-scheme: dark');
      expect(c).toContain(`[data-ad-theme='dark']`);
      expect(c.match(/--ad-color-bg/g)!.length).toBeGreaterThanOrEqual(3);
    }
    expect(css('themes/glass.css')).toContain('@supports not');
  });

  it('style.css defines the eight new variables with the old look as default', () => {
    const c = css('style.css');
    for (const v of [
      '--ad-border-width: 2px',
      '--ad-border-style: dashed',
      '--ad-btn-radius: var(--ad-radius)',
      '--ad-shadow: none',
      '--ad-font-size: 1rem',
      '--ad-icon-size: 22px',
      '--ad-thumb-size: 40px',
      '--ad-backdrop: none',
    ]) {
      expect(c).toContain(v);
    }
  });
});
