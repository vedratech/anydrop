import { afterEach, describe, expect, it } from 'vitest';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const files = (n: number) => Array.from({ length: n }, (_, i) => file(`f${i}.txt`));
const height = (el: HTMLElement, sel = '.ad-file-row') =>
  el.querySelector<HTMLElement>(sel)!.style.height;

describe('layout and rowHeight', () => {
  it('rowHeight defaults to null, which is 56 px in the list', async () => {
    const { el, ad } = mount();
    expect(ad.options.rowHeight).toBeNull();
    expect(ad.options.layout).toBe('list');
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(height(el)).toBe('56px');
    expect(el.querySelector('.ad-panel')!.classList.contains('ad-layout-list')).toBe(true);
    ad.destroy();
  });

  it('compact rows are 48 px high and the panel has ad-layout-compact', async () => {
    const { el, ad } = mount({ layout: 'compact' });
    await ad.addFile(file('a.txt'), 'Dir');
    await settle(ad);
    expect(el.querySelector('.ad-panel')!.classList.contains('ad-layout-compact')).toBe(true);
    expect(height(el)).toBe('48px');
    expect(height(el, '.ad-folder-row')).toBe('48px');
    ad.destroy();
  });

  it('a number rowHeight overrides the layout default', async () => {
    const { el, ad } = mount({ layout: 'compact', rowHeight: 70 });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(height(el)).toBe('70px');
    ad.setOption('rowHeight', null);
    await settle(ad);
    expect(height(el)).toBe('48px');
    ad.destroy();
  });

  it('layout changes at runtime and keeps the files', async () => {
    const { el, ad } = mount();
    await ad.addFiles(files(3));
    await settle(ad);
    ad.setOption('layout', 'compact');
    await settle(ad);
    expect(el.querySelectorAll('.ad-file-row').length).toBe(3);
    expect(height(el)).toBe('48px');
    expect(el.querySelector('.ad-panel')!.classList.contains('ad-layout-list')).toBe(false);
    ad.setOption('layout', 'list');
    await settle(ad);
    expect(height(el)).toBe('56px');
    ad.destroy();
  });

  it('compact keeps the buttons and virtualises 10,000 rows', async () => {
    const { el, ad } = mount({ layout: 'compact', folders: false });
    await ad.addFiles(files(10000));
    await settle(ad);
    expect(el.querySelectorAll('.ad-file-row').length).toBeLessThan(60);
    expect(el.querySelector('.ad-spacer')!.getAttribute('style')).toContain(`${10000 * 48}px`);
    expect(el.querySelector('.ad-file-row [data-ad-action=pause]')).not.toBeNull();
    ad.destroy();
  });
});

describe('keyboard in right-to-left text', () => {
  const key = (el: HTMLElement, k: string) =>
    el
      .querySelector('.ad-list')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  it('ArrowLeft expands and ArrowRight collapses when the direction is rtl', async () => {
    const { el, ad } = mount();
    await ad.addFile(file('a.txt'), 'dir');
    await settle(ad);
    const list = el.querySelector<HTMLElement>('.ad-list')!;
    list.style.direction = 'rtl';
    expect(getComputedStyle(list).direction).toBe('rtl');
    key(el, 'ArrowDown'); // on the folder
    key(el, 'ArrowRight'); // rtl: collapses
    expect(el.querySelectorAll('.ad-row').length).toBe(1);
    key(el, 'ArrowLeft'); // rtl: expands
    expect(el.querySelectorAll('.ad-row').length).toBe(2);
    list.style.direction = 'ltr';
    key(el, 'ArrowLeft'); // ltr: collapses
    expect(el.querySelectorAll('.ad-row').length).toBe(1);
    ad.destroy();
  });

  it('a locale with dir rtl sets the attribute the CSS direction comes from', async () => {
    const { el, ad } = mount({ locale: { code: 'ar', dir: 'rtl', dict: {} } });
    await ad.addFile(file('a.txt'), 'dir');
    await settle(ad);
    expect(el.querySelector('.ad-panel')!.getAttribute('dir')).toBe('rtl');
    ad.destroy();
  });
});

describe('new options at runtime', () => {
  it('setOption works for every customisation option', async () => {
    const { el, ad } = mount();
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const before = el.querySelector('.ad-panel');
    ad.setOption('render', { file: () => 'x' });
    ad.setOption('rowActions', { file: ['cancel'] });
    ad.setOption('icons', { file: '<svg></svg>' });
    ad.setOption('layout', 'compact');
    ad.setOption('errorRowHeight', 80);
    ad.setOption('rowHeight', 60);
    ad.setOption('themePreset', 'glass');
    ad.setOption('locale', null);
    ad.setOption('dir', 'auto');
    await settle(ad);
    expect(el.querySelector('.ad-panel')).not.toBe(before);
    expect(el.querySelector('.ad-file-row')!.textContent).toContain('x');
    expect(ad.getOption('layout')).toBe('compact');
    expect(ad.getOption('errorRowHeight')).toBe(80);
    ad.destroy();
  });
});
