import { afterEach, describe, expect, it } from 'vitest';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const MARK = '<svg viewBox="0 0 4 4" id="mine"><path d="M0 0h4v4z"/></svg>';

describe('icons', () => {
  it('built-in icons are svg with fill=currentColor, wrapped in an aria-hidden .ad-icon', async () => {
    const { el, ad } = mount();
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const ic = el.querySelector(
      '.ad-file-row [data-ad-action=cancel] .ad-icon, .ad-file-row [data-ad-action=remove] .ad-icon',
    );
    expect(ic?.getAttribute('aria-hidden')).toBe('true');
    expect(ic?.innerHTML).toContain('fill="currentColor"');
    expect(el.querySelector('.ad-file-row .ad-file-icon svg')).not.toBeNull();
    expect(el.querySelector('.ad-file-success-mark svg')).not.toBeNull();
    ad.destroy();
  });

  it('a record replaces icons by name and falls back to the built-in for the rest', async () => {
    const { el, ad } = mount({ icons: { file: MARK } });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(el.querySelector('.ad-file-icon #mine')).not.toBeNull();
    expect(el.querySelector('.ad-folder-icon svg')).toBeNull(); // no folder yet
    expect(el.querySelector('[data-ad-action=pause] svg')).not.toBeNull();
    ad.destroy();
  });

  it('a function can return a string, an element or nothing', async () => {
    const calls: string[] = [];
    const { el, ad } = mount({
      icons: (name: string) => {
        calls.push(name);
        if (name === 'file') return MARK;
        if (name === 'success') {
          const s = document.createElement('i');
          s.id = 'el-icon';
          return s;
        }
        return null;
      },
    });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    expect(el.querySelector('.ad-file-icon #mine')).not.toBeNull();
    expect(el.querySelector('.ad-file-success-mark #el-icon')).not.toBeNull();
    expect(el.querySelector('[data-ad-action=retry] svg')).not.toBeNull();
    expect(calls).toContain('retry');
    ad.destroy();
  });

  it('is changeable at runtime and resets the previews', async () => {
    const { el, ad } = mount();
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    ad.setOption('icons', { file: MARK });
    await settle(ad);
    expect(el.querySelector('.ad-file-icon #mine')).not.toBeNull();
    ad.setOption('icons', null);
    await settle(ad);
    expect(el.querySelector('.ad-file-icon #mine')).toBeNull();
    expect(el.querySelector('.ad-file-icon svg')).not.toBeNull();
    ad.destroy();
  });
});

describe('icons: own properties only', () => {
  it('a name like constructor does not pick an inherited function', async () => {
    const { ad } = mount({ icons: { file: MARK } });
    const c = ad._uiBase();
    expect(c.icon('constructor').innerHTML).toBe('');
    expect(c.icon('toString').innerHTML).toBe('');
    ad.destroy();
  });
});
