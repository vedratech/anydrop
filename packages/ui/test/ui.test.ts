import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnyDrop } from '../src/index';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('construction', () => {
  it('throws without an element or a url', () => {
    document.body.innerHTML = '<div id="z"></div>';
    expect(() => new AnyDrop('#nope', { url: '/u' })).toThrow('Invalid');
    expect(() => new AnyDrop('#z')).toThrow('No URL provided.');
  });

  it('reads the url from a form action and rejects a second attach', () => {
    document.body.innerHTML = '<form id="f" action="/post"></form>';
    const ad = new AnyDrop('#f');
    expect(ad.options.url).toBe('/post');
    expect(AnyDrop.forElement('#f')).toBe(ad);
    expect(() => new AnyDrop('#f')).toThrow('already');
    ad.destroy();
  });

  it('builds the message, buttons and ad-* classes', () => {
    const { el, ad } = mount();
    expect(el.classList.contains('ad-root')).toBe(true);
    expect(el.classList.contains('ad-clickable')).toBe(true);
    expect(el.querySelector('.ad-message')?.textContent).toContain('Drop files');
    expect(el.querySelector('[data-ad-action=pick-files]')?.textContent).toBe('Select files');
    ad.destroy();
  });

  it('shows the folder button only where webkitdirectory exists, else the notice', () => {
    const proto = HTMLInputElement.prototype as unknown as Record<string, unknown>;
    const had = 'webkitdirectory' in document.createElement('input');
    if (!had) {
      let t = mount();
      expect(t.el.querySelector('[data-ad-action=pick-folder]')).toBeNull();
      expect(t.el.querySelector('.ad-notice')?.textContent).toContain('only select files');
      t.ad.destroy();
      proto.webkitdirectory = false;
      t = mount();
      expect(t.el.querySelector('[data-ad-action=pick-folder]')).not.toBeNull();
      expect(t.el.querySelector('.ad-notice')).toBeNull();
      t.ad.destroy();
      delete proto.webkitdirectory;
    } else {
      const t = mount();
      expect(t.el.querySelector('[data-ad-action=pick-folder]')).not.toBeNull();
      t.ad.destroy();
    }
  });

  it('every visible string is a dict option', () => {
    const { el, ad } = mount({ dictDefaultMessage: 'Ablegen', dictSelectFiles: 'Dateien' });
    expect(el.querySelector('.ad-message-text')?.textContent).toBe('Ablegen');
    expect(el.querySelector('.ad-btn-primary')?.textContent).toBe('Dateien');
    ad.setOption('dictSelectFiles', 'Files!');
    expect(el.querySelector('.ad-btn-primary')?.textContent).toBe('Files!');
    ad.destroy();
  });
});

describe('drop zone', () => {
  it('toggles ad-drag-hover with nested enter/leave and forwards drop to core', () => {
    const { el, ad } = mount();
    const drop = vi.spyOn(ad, 'drop');
    const ev = (type: string) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        dataTransfer?: unknown;
      };
      e.dataTransfer = { types: ['Files'], files: [], items: [] };
      return e;
    };
    el.dispatchEvent(ev('dragenter'));
    el.dispatchEvent(ev('dragenter'));
    expect(el.classList.contains('ad-drag-hover')).toBe(true);
    el.dispatchEvent(ev('dragleave'));
    expect(el.classList.contains('ad-drag-hover')).toBe(true);
    el.dispatchEvent(ev('dragleave'));
    expect(el.classList.contains('ad-drag-hover')).toBe(false);
    el.dispatchEvent(ev('dragenter'));
    const d = ev('drop');
    el.dispatchEvent(d);
    expect(d.defaultPrevented).toBe(true);
    expect(drop).toHaveBeenCalled();
    expect(el.classList.contains('ad-drag-hover')).toBe(false);
    ad.destroy();
  });

  it('opens the file dialog when the element or its message is clicked', () => {
    const { el, ad } = mount();
    const input = document.querySelector<HTMLInputElement>('input[data-ad-input=files]')!;
    const click = vi.spyOn(input, 'click');
    el.querySelector<HTMLElement>('.ad-message')!.click();
    el.click();
    expect(click).toHaveBeenCalledTimes(2);
    ad.destroy();
  });

  it('adds picked files through the hidden input', async () => {
    const { ad } = mount();
    const input = document.querySelector<HTMLInputElement>('input[data-ad-input=files]')!;
    Object.defineProperty(input, 'files', {
      value: [file('a.txt'), file('b.txt')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle(ad);
    expect(ad.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    ad.destroy();
  });

  it('applies accept, capture, multiple and hiddenInputContainer', () => {
    const { ad, el } = mount({
      acceptedFiles: 'image/*',
      capture: 'environment',
      maxFiles: 1,
      hiddenInputContainer: '#z',
    });
    const input = el.querySelector<HTMLInputElement>('input[data-ad-input=files]')!;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.multiple).toBe(false);
    ad.destroy();
    expect(el.querySelector('input')).toBeNull();
  });
});

describe('previews', () => {
  it('creates ad-started and a lazy previewElement with data-ad hooks', async () => {
    const { el, ad } = mount();
    ad.addFile(file('hello.txt', 2048));
    expect(el.classList.contains('ad-started')).toBe(true);
    const p = ad.files[0]!.previewElement!;
    expect(p.querySelector('[data-ad-name]')).not.toBeNull();
    await settle(ad);
    expect(p.querySelector('[data-ad-name]')!.textContent).toBe('hello.txt');
    expect(p.querySelector('[data-ad-size]')!.innerHTML).toContain('<strong>');
    ad.destroy();
  });

  it('honours a custom previewTemplate and addRemoveLinks', async () => {
    const tpl =
      '<div class="my-preview"><span data-ad-name></span><progress data-ad-uploadprogress max="100"></progress><span data-ad-errormessage></span></div>';
    const { ad } = mount({ previewTemplate: tpl, addRemoveLinks: true });
    ad.addFile(file('x.txt'));
    await settle(ad);
    const p = ad.files[0]!.previewElement!;
    expect(p.className).toContain('my-preview');
    expect(p.querySelector('[data-ad-name]')!.textContent).toBe('x.txt');
    expect(p.querySelector('.ad-file-remove')!.textContent).toBe('Remove file');
    ad.destroy();
  });

  it('disablePreviews creates no previews and no panel', async () => {
    const t = mount({ disablePreviews: true });
    t.ad.addFile(file('y.txt'));
    await settle(t.ad);
    expect(t.ad.files[0]!.previewElement).toBeUndefined();
    expect(t.el.querySelector('.ad-panel')).toBeNull();
    t.ad.destroy();
  });

  it('data-ad-remove removes the file', async () => {
    const { el, ad } = mount({ addRemoveLinks: true });
    ad.addFile(file('x.txt'));
    await settle(ad);
    el.querySelector<HTMLElement>('[data-ad-remove]')!.click();
    expect(ad.files.length).toBe(0);
    expect(el.classList.contains('ad-started')).toBe(false);
    ad.destroy();
  });

  it('displayExistingFile shows a root row without touching files or the tree', async () => {
    const { el, ad } = mount();
    const done = vi.fn();
    ad.on('addedfile', done);
    ad.displayExistingFile(
      { name: 'old.png', size: 1234 },
      'data:image/png;base64,',
      undefined,
      undefined,
      false,
    );
    await settle(ad);
    expect(done).toHaveBeenCalled();
    expect(ad.files.length).toBe(0);
    expect(ad.getTree().counts.total).toBe(0);
    expect(el.querySelector('.ad-row [data-ad-name]')!.textContent).toBe('old.png');
    ad.destroy();
  });
});

describe('tree and flat views', () => {
  it('renders folders and files, collapses, and switches to flat', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'), 'Photos/2024');
    ad.addFile(file('b.txt'), 'Photos');
    await settle(ad);
    const rows = () => Array.from(el.querySelectorAll('.ad-row'));
    expect(rows().map((r) => r.className.includes('ad-folder-row'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    el.querySelector<HTMLElement>('.ad-folder-row .ad-caret')!.click();
    expect(rows().length).toBe(1);
    ad.setOption('folderView', 'flat');
    await settle(ad);
    expect(rows().length).toBe(2);
    expect(el.querySelector('.ad-folder-row')).toBeNull();
    ad.destroy();
  });

  it('virtualizes 5,000 files', async () => {
    const { el, ad } = mount();
    ad.addFiles(Array.from({ length: 5000 }, (_, i) => file(`f${i}.txt`, 1)));
    await settle(ad);
    const mounted = el.querySelectorAll('.ad-row').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);
    expect(el.querySelector('.ad-list')!.getAttribute('role')).toBe('tree');
    expect(el.querySelector('.ad-spacer')!.getAttribute('style')).toContain(`${5000 * 56}px`);
    ad.destroy();
  });

  it('supports keyboard navigation with aria-activedescendant', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'), 'dir');
    await settle(ad);
    const list = el.querySelector<HTMLElement>('.ad-list')!;
    const key = (k: string) =>
      list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowDown');
    const id = list.getAttribute('aria-activedescendant')!;
    expect(el.querySelector('#' + id)!.className).toContain('ad-folder-row');
    key('ArrowLeft');
    expect(el.querySelectorAll('.ad-row').length).toBe(1);
    key('ArrowRight');
    expect(el.querySelectorAll('.ad-row').length).toBe(2);
    ad.destroy();
  });
});

describe('toolbar and error panel', () => {
  it('toolbar buttons do not crash when core lacks the M3 methods', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    for (const a of ['pause-all', 'resume-all', 'retry-failed']) {
      el.querySelector<HTMLElement>(`.ad-toolbar [data-ad-action=${a}]`)!.click();
    }
    el.querySelector<HTMLElement>('[data-ad-action=clear]')!.click();
    expect(ad.files.length).toBe(0);
    ad.destroy();
  });

  it('lists rejected files with a reason and exports them', async () => {
    const { el, ad } = mount({ acceptedFiles: '.png' });
    ad.addFile(file('a.txt'));
    ad.addFile(file('b.txt'));
    await settle(ad);
    const panel = el.querySelector<HTMLElement>('.ad-errors')!;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('.ad-errors-title')!.textContent).toBe('2 failed');
    expect(panel.querySelectorAll('.ad-error-row').length).toBe(2);
    expect(panel.querySelector('.ad-error-reason')!.textContent).toContain('REJECTED_TYPE');
    expect(ad.exportErrors('csv')).toContain('a.txt');
    const url = vi.fn(() => 'blob:x');
    (URL as unknown as Record<string, unknown>).createObjectURL = url;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
    panel.querySelector<HTMLElement>('[data-ad-action=export-csv]')!.click();
    expect(url).toHaveBeenCalled();
    panel.querySelector<HTMLElement>('[data-ad-action=dismiss-errors]')!.click();
    await settle(ad);
    expect(panel.hidden).toBe(true);
    ad.destroy();
  });

  it('announces in the live region', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    expect(el.querySelector('[aria-live=polite]')!.textContent).toContain('1 files added');
    ad.destroy();
  });
});

describe('lifecycle', () => {
  it('disable() detaches listeners and enable() restores them', () => {
    const { el, ad } = mount();
    ad.disable();
    expect(el.classList.contains('ad-disabled')).toBe(true);
    expect(el.classList.contains('ad-clickable')).toBe(false);
    const input = document.querySelector<HTMLInputElement>('input[data-ad-input=files]')!;
    const click = vi.spyOn(input, 'click');
    el.click();
    expect(click).not.toHaveBeenCalled();
    ad.enable();
    el.click();
    expect(click).toHaveBeenCalled();
    ad.destroy();
  });

  it('destroy() removes all DOM, classes and the instance; two instances coexist', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const a = new AnyDrop('#a', { url: '/u' });
    const b = new AnyDrop('#b', { url: '/u' });
    expect(document.querySelectorAll('input[data-ad-input=files]').length).toBe(2);
    a.destroy();
    expect(document.querySelectorAll('input[data-ad-input=files]').length).toBe(1);
    const el = document.getElementById('a')!;
    expect(el.innerHTML).toBe('');
    expect(el.className).toBe('');
    expect(() => AnyDrop.forElement('#a')).toThrow();
    b.destroy();
    expect(document.body.querySelectorAll('input').length).toBe(0);
  });

  it('dispatches anydrop:<event> DOM events', () => {
    const { el, ad } = mount();
    const seen = vi.fn();
    el.addEventListener('anydrop:addedfile', seen);
    ad.addFile(file('a.txt'));
    expect(seen).toHaveBeenCalled();
    ad.destroy();
  });

  it('forceFallback renders the plain form', () => {
    const { el, ad } = mount({ forceFallback: true });
    expect(el.querySelector('.ad-fallback input[type=file]')).not.toBeNull();
    expect(el.classList.contains('ad-browser-not-supported')).toBe(true);
    ad.destroy();
  });

  it('canceled shows dictUploadCanceled without an error event', async () => {
    const { el, ad } = mount();
    const err = vi.fn();
    ad.on('error', err);
    const f = ad.addFile(file('a.txt'));
    await settle(ad);
    ad.cancelUpload(f);
    await settle(ad);
    expect(err).not.toHaveBeenCalled();
    expect(el.querySelector('[data-ad-errormessage]')!.textContent).toBe('Upload canceled.');
    ad.destroy();
  });
});

describe('Configuration, preview template and presets', () => {
  // A custom preview template that uses every hook.
  const template = `<div class="ad-file-preview">
  <div class="ad-file-thumb"><img data-ad-thumbnail draggable="false" /></div>
  <div class="ad-file-details">
    <div class="ad-file-size"><span data-ad-size></span></div>
    <div class="ad-file-name"><span data-ad-name></span></div>
  </div>
  <div class="ad-file-progress">
    <span class="ad-file-bar" data-ad-uploadprogress></span>
  </div>
  <div class="ad-error-message"><span data-ad-errormessage></span></div>
  <div class="ad-file-success-mark"><svg width="54" height="54"><path d="M0 0"/></svg></div>
  <div class="ad-error-mark"><svg width="54" height="54"><path d="M0 0"/></svg></div>
</div>`;

  it('AnyDrop.options.<id> + a form action', async () => {
    document.body.innerHTML =
      '<form action="/file/post" class="anydrop" id="my-awesome-zone"></form>';
    AnyDrop.options.myAwesomeZone = {
      paramName: 'file',
      maxFilesize: 2,
      autoProcessQueue: false,
      accept: function (file, done) {
        if (file.name === 'justinbieber.jpg') {
          done("Naha, you don't.");
        } else {
          done();
        }
      },
    };
    const ad = new AnyDrop('#my-awesome-zone');
    const rejected = vi.fn();
    ad.on('error', rejected);
    ad.addFile(file('justinbieber.jpg', 4, 'image/jpeg'));
    ad.addFile(file('ok.txt'));
    await settle(ad);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected.mock.calls[0]![1]).toBe("Naha, you don't.");
    const [bad, good] = ad.files;
    expect(bad!.previewElement!.classList.contains('ad-error')).toBe(true);
    expect(bad!.previewElement!.querySelector('[data-ad-errormessage]')!.textContent).toBe(
      "Naha, you don't.",
    );
    expect(good!.accepted).toBe(true);
    ad.destroy();
    AnyDrop.options = {};
  });

  it('options, init(), previewTemplate, clickable, previewsContainer and on() chaining', async () => {
    document.body.innerHTML =
      '<div id="myId"></div><button id="pick">Pick</button><div id="previews"></div>';
    const added = vi.fn();
    const zone = new AnyDrop('div#myId', {
      url: '/file/post',
      autoProcessQueue: false,
      clickable: '#pick',
      previewsContainer: '#previews',
      previewTemplate: template,
      thumbnailWidth: 80,
      thumbnailHeight: 80,
      maxFiles: 3,
      dictDefaultMessage: 'Drop it',
      dictRemoveFile: 'Delete',
      addRemoveLinks: true,
      init() {
        this.on('addedfile', function (f) {
          added(f.name);
        });
      },
    });
    zone.on('addedfile', (f) => added('x' + f.name)).on('removedfile', () => added('removed'));
    expect(document.getElementById('pick')!.classList.contains('ad-clickable')).toBe(true);
    const input = document.querySelector<HTMLInputElement>('input[data-ad-input=files]')!;
    const click = vi.spyOn(input, 'click');
    document.getElementById('pick')!.click();
    expect(click).toHaveBeenCalled();
    zone.addFile(file('a.txt'));
    await settle(zone);
    expect(added).toHaveBeenCalledWith('a.txt');
    expect(added).toHaveBeenCalledWith('xa.txt');
    expect(document.querySelectorAll('#previews .ad-file-preview').length).toBe(1);
    expect(document.querySelector('#previews [data-ad-name]')!.textContent).toBe('a.txt');
    expect(document.querySelector('#previews .ad-file-remove')!.textContent).toBe('Delete');
    zone.removeFile(zone.files[0]!);
    expect(added).toHaveBeenCalledWith('removed');
    zone.destroy();
  });

  it('adds ad-max-files-reached', async () => {
    const { el, ad } = mount({ maxFiles: 1 });
    ad.addFile(file('a.txt'));
    await settle(ad);
    expect(el.classList.contains('ad-max-files-reached')).toBe(true);
    ad.destroy();
  });
});

describe('touch layout', () => {
  it('gets ad-touch and a tap-to-upload button when the pointer is coarse', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: /coarse/.test(q),
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { el, ad } = mount();
    expect(el.classList.contains('ad-touch')).toBe(true);
    expect(el.querySelector('.ad-btn-primary')!.textContent).toBe('Tap to upload');
    ad.destroy();
    window.matchMedia = real;
  });
});

describe('M3 controls (called when core provides them)', () => {
  it('routes toolbar, folder and file buttons to the pause, retry and cancel methods', async () => {
    const { el, ad } = mount();
    const m = {
      pause: vi.fn(),
      resume: vi.fn(),
      pauseFolder: vi.fn(),
      resumeFolder: vi.fn(),
      pauseFile: vi.fn(),
      cancelFolder: vi.fn(),
      retryFailedOnly: vi.fn(() => 0),
    };
    Object.assign(ad, m);
    ad.addFile(file('a.txt'), 'Photos/2024');
    await settle(ad);
    const click = (sel: string) => el.querySelector<HTMLElement>(sel)!.click();
    click('.ad-toolbar [data-ad-action=pause-all]');
    expect(m.pause).toHaveBeenCalled();
    ad.emit('paused', { scope: 'all', reason: 'user' });
    await settle(ad);
    click('.ad-toolbar [data-ad-action=resume-all]');
    expect(m.resume).toHaveBeenCalled();
    ad.emit('resumed', { scope: 'all', reason: 'user' });
    await settle(ad);
    click('.ad-folder-row [data-ad-action=pause]');
    expect(m.pauseFolder).toHaveBeenCalledWith('Photos');
    click('.ad-folder-row [data-ad-action=cancel]');
    expect(m.cancelFolder).toHaveBeenCalledWith('Photos');
    click('.ad-file-row [data-ad-action=pause]');
    expect(m.pauseFile).toHaveBeenCalledWith(ad.files[0]);
    ad.destroy();
  });

  it('repaints file rows when a folder is paused or resumed (BUG-UI-1)', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'), 'Photos/2024');
    await settle(ad);
    const f = ad.files[0]!;
    const row = () => el.querySelector<HTMLElement>('.ad-file-row')!;
    (f as { status: string }).status = 'paused';
    ad.emit('paused', { scope: 'folder', folder: f.folder!, reason: 'user' } as never);
    await settle(ad);
    expect(row().dataset.status).toBe('paused');
    (f as { status: string }).status = 'queued';
    ad.emit('resumed', { scope: 'folder', folder: f.folder!, reason: 'user' } as never);
    await settle(ad);
    expect(row().dataset.status).toBe('queued');
    ad.destroy();
  });
});
