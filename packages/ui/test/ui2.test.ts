import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnyDrop } from '../src/index';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
  AnyDrop.options = {};
  vi.restoreAllMocks();
});

/** Makes image decoding and canvas drawing work in happy-dom. */
function stubImages(): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 400;
    naturalHeight = 200;
    crossOrigin = '';
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  (URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:fake';
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
}

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('forms (B1, B3)', () => {
  it('adds each form field once per request, also with uploadMultiple', () => {
    document.body.innerHTML =
      '<form id="f"><input name="note" value="hi"><input type="checkbox" name="on" checked value="1">' +
      '<input type="checkbox" name="off" value="1"><select name="s" multiple><option value="a" selected>a</option><option value="b" selected>b</option></select></form>';
    const ad = new AnyDrop('#f', { url: '/u', uploadMultiple: true, autoProcessQueue: false });
    const fd = new FormData();
    (ad as unknown as { _addFormElementData(f: FormData): void })._addFormElementData(fd);
    expect(fd.getAll('note')).toEqual(['hi']);
    expect(fd.getAll('on')).toEqual(['1']);
    expect(fd.has('off')).toBe(false);
    expect(fd.getAll('s')).toEqual(['a', 'b']);
    // no `sending` listener of ours: the core hook is the only place fields are added
    expect(ad.hasListeners('sending')).toBe(false);
    ad.destroy();
  });

  it('removes the .fallback element of the Dropzone docs markup, and destroy() puts it back', () => {
    document.body.innerHTML =
      '<form action="/file-upload" class="dropzone" id="dz"><div class="fallback"><input name="file" type="file" multiple /></div></form>';
    const form = document.getElementById('dz')!;
    const ad = new AnyDrop('#dz');
    expect(form.querySelector('.fallback')).toBeNull();
    const fd = new FormData();
    (ad as unknown as { _addFormElementData(f: FormData): void })._addFormElementData(fd);
    expect(fd.has('file')).toBe(false);
    ad.destroy();
    expect(form.querySelector('.fallback input[name=file]')).not.toBeNull();
  });
});

describe('thumbnails (B4, H3)', () => {
  beforeEach(stubImages);

  it('a lazily rendered row gets its thumbnail with autoProcessQueue: false', async () => {
    const { el, ad } = mount();
    const seen = vi.fn();
    ad.on('thumbnail', seen);
    ad.addFile(file('p.png', 100, 'image/png'));
    await settle(ad);
    await wait();
    expect(el.querySelector<HTMLImageElement>('.dz-image img')!.getAttribute('src')).toMatch(
      /^data:image/,
    );
    expect(seen).toHaveBeenCalledTimes(1);
    ad.destroy();
  });

  it('fires thumbnail for every accepted image with disablePreviews, in add order, 2 at a time', async () => {
    const { ad } = mount({ disablePreviews: true });
    const names: string[] = [];
    ad.on('thumbnail', (f) => names.push(f.name));
    ad.addFiles([1, 2, 3, 4, 5].map((i) => file(`i${i}.png`, 10, 'image/png')));
    ad.addFile(file('x.txt'));
    await wait(300);
    expect(names).toEqual(['i1.png', 'i2.png', 'i3.png', 'i4.png', 'i5.png']);
    ad.destroy();
  });

  it('respects createImageThumbnails, maxThumbnailFilesize and non-images', async () => {
    const t = mount({ createImageThumbnails: false });
    t.ad.addFile(file('p.png', 10, 'image/png'));
    await settle(t.ad);
    await wait();
    expect(t.el.querySelector('.dz-image img')!.getAttribute('src')).toBeNull();
    t.ad.destroy();
    const u = mount({ maxThumbnailFilesize: 0.00001 });
    u.ad.addFile(file('big.png', 100, 'image/png'));
    await settle(u.ad);
    await wait();
    expect(u.el.querySelector('.dz-image img')!.getAttribute('src')).toBeNull();
    u.ad.destroy();
  });

  it('shows dictThumbnailError as text when the image cannot be decoded', async () => {
    class Broken {
      onerror: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal('Image', Broken);
    const { el, ad } = mount({ dictThumbnailError: 'No preview!' });
    ad.addFile(file('x.heic', 10, ''));
    await settle(ad);
    await wait();
    expect(el.querySelector('.dz-image')!.textContent).toBe('No preview!');
    expect(el.querySelector('.dz-preview')!.classList.contains('dz-thumb-error')).toBe(true);
    ad.destroy();
  });
});

describe('preview elements (H1, H2)', () => {
  it('an addedfile handler given as an option can use file.previewElement', () => {
    let el: HTMLElement | undefined;
    const { ad } = mount({
      addedfile(f) {
        el = f.previewElement;
      },
    });
    ad.addFile(file('a.txt'));
    expect(el).toBeInstanceOf(HTMLElement);
    ad.destroy();
  });

  it('keeps mounted rows across a rebuild and keeps elements user code has read', async () => {
    const { el, ad } = mount();
    const a = ad.addFile(file('a.txt'));
    await settle(ad);
    const row = el.querySelector('.ad-file-row');
    const mine = a.previewElement;
    ad.addFile(file('b.txt'));
    await settle(ad);
    expect(el.querySelector('.ad-file-row')).toBe(row);
    expect(a.previewElement).toBe(mine);
    ad.destroy();
  });
});

describe('zones (H4, H5)', () => {
  it('never styles document.body (the Bootstrap example)', () => {
    document.body.innerHTML = '<button class="fileinput-button">Add</button><div id="p"></div>';
    const ad = new AnyDrop(document.body, {
      url: '/u',
      previewsContainer: '#p',
      clickable: '.fileinput-button',
      autoQueue: false,
    });
    expect(document.body.classList.contains('ad-root')).toBe(false);
    expect(document.body.hasAttribute('role')).toBe(false);
    expect(document.querySelector('.dz-message')).toBeNull();
    expect(document.querySelector('.ad-actions')).toBeNull();
    expect(document.querySelector('.fileinput-button')!.classList.contains('dz-clickable')).toBe(
      true,
    );
    expect(document.querySelector('#p .ad-panel')).not.toBeNull();
    ad.destroy();
    expect(document.body.getAttribute('class')).toBeNull();
  });

  it('buttons only appear when the element itself is the clickable', () => {
    document.body.innerHTML = '<div id="z"></div><button id="b"></button>';
    const ad = new AnyDrop('#z', { url: '/u', clickable: '#b' });
    expect(document.querySelector('.ad-actions')).toBeNull();
    expect(document.querySelector('.dz-message')).toBeNull();
    ad.destroy();
  });

  it('previewsContainer: false means no previews; a bad selector throws', async () => {
    const { el, ad } = mount({ previewsContainer: false });
    const f = ad.addFile(file('a.txt'));
    await settle(ad);
    expect(f.previewElement).toBeUndefined();
    expect(el.querySelector('.ad-panel')).toBeNull();
    ad.destroy();
    document.body.innerHTML = '<div id="z"></div>';
    expect(() => new AnyDrop('#z', { url: '/u', previewsContainer: '#nope' })).toThrow(
      'Invalid `previewsContainer`',
    );
    expect(() => new AnyDrop('#z', { url: '/u', clickable: '.nothing' })).toThrow(
      'Invalid `clickable`',
    );
  });

  it('clickable selectors match every element, and setOption moves the classes', () => {
    document.body.innerHTML =
      '<div id="z"></div><i class="b"></i><i class="b"></i><i class="c"></i>';
    const ad = new AnyDrop('#z', { url: '/u', clickable: '.b' });
    expect(document.querySelectorAll('.b.dz-clickable').length).toBe(2);
    ad.setOption('clickable', '.c');
    expect(document.querySelectorAll('.b.dz-clickable').length).toBe(0);
    expect(document.querySelectorAll('.c.dz-clickable').length).toBe(1);
    ad.destroy();
  });
});

describe('keyboard (B5)', () => {
  it('keys pressed on a button inside a row are left to the button', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    const btn = el.querySelector<HTMLElement>('.ad-file-row [data-ad-action=cancel]')!;
    for (const key of ['Enter', ' ', 'Delete', 'p', 'r']) {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      btn.dispatchEvent(e);
      expect(e.defaultPrevented, key).toBe(false);
    }
    expect(ad.files.length).toBe(1);
    ad.destroy();
  });
});

describe('options and methods', () => {
  it('theme, rowHeight, errorPanel, pickerButtons, setOption(previewTemplate)', async () => {
    const { el, ad } = mount({
      theme: 'dark',
      rowHeight: 80,
      errorPanel: false,
      folders: false,
      pickerButtons: false,
    });
    expect(el.getAttribute('data-ad-theme')).toBe('dark');
    expect(el.querySelector('.ad-actions')).toBeNull();
    ad.addFile(file('a.txt'));
    await settle(ad);
    expect(el.querySelector<HTMLElement>('.ad-row')!.style.height).toBe('80px');
    expect(el.querySelector('.ad-errors')).toBeNull();
    ad.setOption('previewTemplate', '<div class="mine"><b data-dz-name></b></div>');
    await settle(ad);
    expect(el.querySelector('.ad-file-row .mine b')!.textContent).toBe('a.txt');
    ad.setOption('theme', 'light');
    expect(el.getAttribute('data-ad-theme')).toBe('light');
    ad.destroy();
    expect(el.hasAttribute('data-ad-theme')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('pastes files only when enablePaste is on', async () => {
    const paste = (el: HTMLElement) => {
      const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
        clipboardData?: unknown;
      };
      e.clipboardData = { items: [{ kind: 'file', getAsFile: () => file('p.txt') }], files: [] };
      el.dispatchEvent(e);
      return e;
    };
    const a = mount();
    expect(paste(a.el).defaultPrevented).toBe(false);
    a.ad.destroy();
    const b = mount({ enablePaste: true });
    expect(paste(b.el).defaultPrevented).toBe(true);
    b.ad.destroy();
  });

  it('copyErrors writes to the clipboard and downloadErrors cleans up its URL', async () => {
    const { ad } = mount({ acceptedFiles: '.png' });
    ad.addFile(file('a.txt'));
    await settle(ad);
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    expect(await ad.copyErrors()).toBe(true);
    expect(write).toHaveBeenCalled();
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    expect(await ad.copyErrors()).toBe(false);
    const revoke = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:1';
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revoke;
    ad.downloadErrors('json');
    ad.destroy();
    expect(revoke).toHaveBeenCalledWith('blob:1');
  });

  it('the Dropzone maxfilesexceeded pattern works (removeAllFiles + addFile)', async () => {
    const { ad } = mount({
      maxFiles: 1,
      init() {
        this.on('maxfilesexceeded', (f) => {
          this.removeAllFiles();
          this.addFile(f);
        });
      },
    });
    ad.addFile(file('a.txt'));
    await settle(ad);
    ad.addFile(file('b.txt'));
    await settle(ad);
    await settle(ad);
    expect(ad.files.map((f) => f.name)).toEqual(['b.txt']);
    ad.destroy();
  });

  it('statics: supportsFolderPicker, instances, hiddenFileInput, element aliases, confirm', () => {
    expect(typeof AnyDrop.supportsFolderPicker()).toBe('boolean');
    const { el, ad } = mount();
    expect(AnyDrop.instances).toContain(ad);
    expect(ad.hiddenFileInput).toBe(document.querySelector('input[data-ad-input=files]'));
    expect((el as unknown as { dropzone: unknown }).dropzone).toBe(ad);
    const ok = vi.fn();
    const no = vi.fn();
    vi.stubGlobal('confirm', () => false);
    (window as unknown as { confirm: () => boolean }).confirm = () => false;
    AnyDrop.confirm('?', ok, no);
    expect(no).toHaveBeenCalled();
    ad.destroy();
    expect(AnyDrop.instances).not.toContain(ad);
  });

  it('merges options deeply and uses a camelized id without lowercasing the first letter', () => {
    document.body.innerHTML = '<div id="My-zone" class="dropzone"></div>';
    AnyDrop.options.MyZone = { dictFileSizeUnits: { kb: 'Ko' } as never, url: '/u' };
    const ad = new AnyDrop('#My-zone');
    expect(ad.options.dictFileSizeUnits.kb).toBe('Ko');
    expect(ad.options.dictFileSizeUnits.mb).toBe('MB');
    ad.destroy();
  });

  it('removes a file with dictRemoveFileConfirmation only after the user agrees', async () => {
    const { el, ad } = mount({ addRemoveLinks: true, dictRemoveFileConfirmation: 'Sure?' });
    ad.addFile(file('a.txt'));
    await settle(ad);
    const ask = vi.spyOn(AnyDrop, 'confirm').mockImplementation(() => {});
    el.querySelector<HTMLElement>('[data-dz-remove]')!.click();
    expect(ask).toHaveBeenCalledWith('Sure?', expect.any(Function));
    expect(ad.files.length).toBe(1);
    ask.mockImplementation((_q, yes) => yes());
    el.querySelector<HTMLElement>('[data-dz-remove]')!.click();
    expect(ad.files.length).toBe(0);
    ad.destroy();
  });
});

describe('discover (0014)', () => {
  it('attaches to .dropzone and .anydrop elements, skips attached and false ones', () => {
    document.body.innerHTML =
      '<form id="a" class="dropzone" action="/a"></form><div id="b" class="anydrop" data-x></div><form id="c" class="dropzone" action="/c"></form><form id="d" class="dropzone" action="/d"></form><p class="dropzone-not"></p>';
    AnyDrop.options.b = { url: '/b' };
    AnyDrop.options.c = false;
    const manual = new AnyDrop('#d');
    const made = AnyDrop.discover();
    expect(made.map((m) => m.element.id).sort()).toEqual(['a', 'b']);
    expect(AnyDrop.discover()).toEqual([]);
    expect(AnyDrop.forElement('#d')).toBe(manual);
    expect(() => AnyDrop.forElement('#c')).toThrow();
    for (const m of [...made, manual]) m.destroy();
  });
});
