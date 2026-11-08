import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDrop, uiDefaults } from '../src/index';
import ar from '../src/locales/ar';
import de from '../src/locales/de';
import en from '../src/locales/en';
import es from '../src/locales/es';
import fr from '../src/locales/fr';
import hi from '../src/locales/hi';
import ja from '../src/locales/ja';
import ptBR from '../src/locales/pt-BR';
import zhCN from '../src/locales/zh-CN';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
  AnyDrop.locales = {};
  vi.restoreAllMocks();
});

const all = { en, hi, es, fr, de, 'pt-BR': ptBR, ja, 'zh-CN': zhCN, ar };
/** Every translatable text: ui and core, English. */
const english = (): Record<string, unknown> => {
  const d = Object.assign(defaultOptions(), uiDefaults()) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k in d) if (/^dict/.test(k) && k !== 'dictRemoveFileConfirmation') out[k] = d[k];
  return out;
};
const holes = (s: unknown) =>
  typeof s === 'string' ? (s.match(/\{\{\w+\}\}/g) || []).sort().join() : JSON.stringify(s);

describe('language packs', () => {
  it('en holds exactly the default texts', () => {
    expect(en.dict).toEqual(english());
    expect(en.code).toBe('en');
  });

  for (const [code, pack] of Object.entries(all)) {
    it(`${code} has every key and the same placeholders`, () => {
      const base = english();
      expect(pack.code).toBe(code);
      expect(Object.keys(pack.dict).sort()).toEqual(Object.keys(base).sort());
      for (const k in base) {
        if (k === 'dictFileSizeUnits') {
          expect(Object.keys((pack.dict as Record<string, object>)[k]!).sort()).toEqual(
            Object.keys(base[k] as object).sort(),
          );
        } else {
          expect(holes((pack.dict as Record<string, unknown>)[k]), `${code}.${k}`).toBe(
            holes(base[k]),
          );
        }
      }
    });
  }

  it('only ar is right-to-left', () => {
    for (const [code, pack] of Object.entries(all)) {
      expect(pack.dir, code).toBe(code === 'ar' ? 'rtl' : 'ltr');
    }
  });
});

describe('locale option', () => {
  const custom = {
    code: 'xx',
    dir: 'ltr' as const,
    dict: { dictSelectFiles: 'Pick XX', dictPause: 'Pause XX', dictDefaultMessage: 'Drop XX' },
  };

  it('precedence: English < locale < explicit dict options', () => {
    const { el, ad } = mount({ locale: custom, dictPause: 'My pause' });
    expect(ad.options.dictSelectFiles).toBe('Pick XX');
    expect(ad.options.dictPause).toBe('My pause');
    expect(ad.options.dictResume).toBe('Resume'); // not in the pack: English
    expect(el.querySelector('.ad-message-text')?.textContent).toBe('Drop XX');
    ad.destroy();
  });

  it('a preset from AnyDrop.options counts as explicit', () => {
    document.body.innerHTML = '<div id="myZone"></div>';
    AnyDrop.options.myZone = { dictPause: 'Preset pause' };
    const ad = new AnyDrop('#myZone', { url: '/u', locale: custom });
    expect(ad.options.dictPause).toBe('Preset pause');
    expect(ad.options.dictSelectFiles).toBe('Pick XX');
    ad.destroy();
    delete AnyDrop.options.myZone;
  });

  it('a registered code and en work; an unknown code warns and uses English', () => {
    AnyDrop.locales.xx = custom;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let t = mount({ locale: 'xx' });
    expect(t.ad.options.dictSelectFiles).toBe('Pick XX');
    t.ad.destroy();
    t = mount({ locale: 'en' });
    expect(t.ad.options.dictSelectFiles).toBe('Select files');
    expect(t.el.hasAttribute('lang')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    t.ad.destroy();
    t = mount({ locale: 'nope' });
    expect(t.ad.options.dictSelectFiles).toBe('Select files');
    expect(String(warn.mock.calls[0]![0])).toContain('[anydrop]');
    t.ad.destroy();
  });

  it('switching at runtime rewrites the texts, keeps the explicit ones, and refreshes the labels', async () => {
    const { el, ad } = mount({ dictClear: 'Wipe' });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    ad.setOption('dictPause', 'Mine');
    ad.setOption('locale', custom);
    await settle(ad);
    expect(ad.options.dictSelectFiles).toBe('Pick XX');
    expect(ad.options.dictPause).toBe('Mine');
    expect(ad.options.dictClear).toBe('Wipe');
    expect(el.querySelector('.ad-btn-primary')?.textContent).toBe('Pick XX');
    ad.setOption('locale', null);
    await settle(ad);
    expect(ad.options.dictSelectFiles).toBe('Select files');
    expect(ad.options.dictPause).toBe('Mine');
    expect(ad.options.dictClear).toBe('Wipe');
    expect(el.querySelector('.ad-btn-primary')?.textContent).toBe('Select files');
    ad.destroy();
  });

  it('core texts and file size units come from the pack too', () => {
    const { ad } = mount({
      locale: {
        code: 'xx',
        dir: 'ltr',
        dict: { dictUploadCanceled: 'Stopp', dictFileSizeUnits: { kb: 'Ko' } },
      },
    });
    expect(ad.options.dictUploadCanceled).toBe('Stopp');
    expect(ad.options.dictFileSizeUnits.kb).toBe('Ko');
    expect(ad.options.dictFileSizeUnits.mb).toBe('MB');
    ad.destroy();
  });

  it('spreading a pack works without lang or dir', () => {
    const { el, ad } = mount({ ...ar.dict });
    expect(ad.options.dictSelectFiles).toBe(ar.dict.dictSelectFiles);
    expect(el.hasAttribute('dir')).toBe(false);
    ad.destroy();
  });
});

describe('lang and dir', () => {
  it('a locale sets lang and dir on the element and the panel', async () => {
    const { el, ad } = mount({ locale: ar });
    await ad.addFiles([file('a.txt')]);
    await settle(ad);
    const panel = el.querySelector('.ad-panel')!;
    expect(el.getAttribute('lang')).toBe('ar');
    expect(el.getAttribute('dir')).toBe('rtl');
    expect(panel.getAttribute('lang')).toBe('ar');
    expect(panel.getAttribute('dir')).toBe('rtl');
    expect(document.body.hasAttribute('dir')).toBe(false);
    ad.destroy();
  });

  it('destroy puts the element back as it was', () => {
    document.body.innerHTML = '<div id="z" lang="en-GB"></div>';
    const el = document.getElementById('z')!;
    const ad = new AnyDrop(el, { url: '/u', locale: ar });
    expect(el.getAttribute('lang')).toBe('ar');
    ad.destroy();
    expect(el.getAttribute('lang')).toBe('en-GB');
    expect(el.hasAttribute('dir')).toBe(false);
    expect(el.hasAttribute('class')).toBe(false);
  });

  it('dir overrides the locale; auto follows it; switching to null restores', () => {
    document.body.innerHTML = '<div id="z" dir="ltr"></div>';
    const el = document.getElementById('z')!;
    const ad = new AnyDrop(el, { url: '/u', locale: ar, dir: 'ltr' });
    expect(el.getAttribute('dir')).toBe('ltr');
    ad.setOption('dir', 'auto');
    expect(el.getAttribute('dir')).toBe('rtl');
    ad.setOption('locale', null);
    expect(el.getAttribute('dir')).toBe('ltr'); // the page's own value
    expect(el.hasAttribute('lang')).toBe(false);
    ad.setOption('dir', 'rtl');
    expect(el.getAttribute('dir')).toBe('rtl');
    ad.destroy();
    expect(el.getAttribute('dir')).toBe('ltr');
  });

  it('a new panel (setOption) gets lang and dir', async () => {
    const { el, ad } = mount({ locale: ar });
    await ad.addFiles([file('a.txt')]);
    ad.setOption('layout', 'compact');
    await settle(ad);
    expect(el.querySelector('.ad-panel')!.getAttribute('dir')).toBe('rtl');
    ad.destroy();
  });

  it('every new option is changeable at runtime', () => {
    const { ad } = mount();
    ad.setOption('locale', ar);
    ad.setOption('dir', 'rtl');
    expect(ad.getOption('locale')).toBe(ar);
    expect(ad.getOption('dir')).toBe('rtl');
    ad.destroy();
  });
});
