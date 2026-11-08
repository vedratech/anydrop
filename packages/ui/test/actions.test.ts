import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyDropFile } from '@vedratech/anydrop-core';
import { file, mount, settle } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

type T = ReturnType<typeof mount>;

/** Gives a file a status and repaints its row. */
const setStatus = async (t: T, f: AnyDropFile, status: string) => {
  (f as { status: string }).status = status;
  t.ad.emit('complete', f);
  await settle(t.ad);
};
const shown = (el: HTMLElement, row = '.ad-file-row') =>
  Array.from(el.querySelectorAll<HTMLElement>(`${row} [data-ad-action]`))
    .filter((b) => !b.hidden && b.getAttribute('data-ad-action') !== 'toggle')
    .map((b) => b.getAttribute('data-ad-action'));
const press = (el: HTMLElement, k: string) => {
  const list = el.querySelector<HTMLElement>('.ad-list')!;
  list.dispatchEvent(new Event('focus'));
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  list.dispatchEvent(e);
  return e;
};

describe('row actions: defaults', () => {
  it('shows the same buttons per status as before, with remove on finished rows', async () => {
    const t = mount();
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const f = t.ad.files[0] as AnyDropFile;
    const cases: [string, string[]][] = [
      ['queued', ['pause', 'cancel']],
      ['uploading', ['pause', 'cancel']],
      ['success', ['remove']],
      ['canceled', ['remove']],
    ];
    for (const [st, want] of cases) {
      await setStatus(t, f, st);
      expect(shown(t.el), st).toEqual(want);
    }
    t.ad.destroy();
  });

  it('labels: cancel says Cancel upload, remove says Remove file', async () => {
    const t = mount();
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const f = t.ad.files[0] as AnyDropFile;
    const b = (id: string) =>
      t.el.querySelector<HTMLElement>(`.ad-file-row [data-ad-action=${id}]`)!;
    expect(b('cancel').getAttribute('aria-label')).toBe('Cancel upload');
    await setStatus(t, f, 'success');
    expect(b('remove').getAttribute('aria-label')).toBe('Remove file');
    expect(b('remove').title).toBe('Remove file');
    t.ad.destroy();
  });

  it('remove removes a finished file and cancel cancels an active one', async () => {
    const t = mount();
    await t.ad.addFiles([file('a.txt'), file('b.txt')]);
    await settle(t.ad);
    const [a, b] = t.ad.files as AnyDropFile[];
    const spy = vi.spyOn(t.ad, 'cancelUpload');
    t.el.querySelectorAll<HTMLElement>('.ad-file-row [data-ad-action=cancel]')[0]!.click();
    expect(spy).toHaveBeenCalled();
    await setStatus(t, b as AnyDropFile, 'success');
    const row = Array.from(t.el.querySelectorAll('.ad-file-row')).find((r) =>
      r.textContent?.includes('b.txt'),
    )!;
    (row.querySelector('[data-ad-action=remove]') as HTMLElement).click();
    await settle(t.ad);
    expect(t.ad.files).not.toContain(b);
    expect(t.ad.files).toContain(a);
    t.ad.destroy();
  });
});

describe('row actions: configuration', () => {
  it('a built-in subset creates only those buttons; an empty list creates none', async () => {
    const t = mount({ rowActions: { file: ['cancel', 'remove'] } });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    expect(t.el.querySelector('.ad-file-row [data-ad-action=pause]')).toBeNull();
    expect(shown(t.el)).toEqual(['cancel']);
    t.ad.setOption('rowActions', { file: [] });
    await settle(t.ad);
    expect(t.el.querySelectorAll('.ad-file-row [data-ad-action]').length).toBe(0);
    t.ad.destroy();
  });

  it('rowActions keeps the default list of a kind that is not given (per key)', async () => {
    const t = mount({ rowActions: { file: ['remove'] } });
    await t.ad.addFile(file('a.txt'), 'D');
    await settle(t.ad);
    expect(shown(t.el, '.ad-folder-row')).toEqual(['pause', 'cancel']);
    t.ad.setOption('rowActions', { file: ['remove'] });
    await settle(t.ad);
    expect(shown(t.el, '.ad-folder-row')).toEqual(['pause', 'cancel']);
    t.ad.destroy();
  });

  it('a custom action: when, label function, icon, text button, onClick with the context', async () => {
    const onClick = vi.fn();
    const t = mount({
      icons: { star: '<svg id="star"><path d="M0 0"/></svg>' },
      rowActions: {
        file: [
          {
            id: 'open',
            label: (c) => `Open ${c.label}`,
            icon: 'star',
            when: (c) => c.status === 'success',
            onClick,
          },
          { id: 'say-hi', label: 'Hi there' },
        ],
      },
    });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    expect(shown(t.el)).toEqual(['say-hi']);
    const hi = t.el.querySelector<HTMLElement>('[data-ad-action=say-hi]')!;
    expect(hi.textContent).toBe('Hi there');
    expect(hi.classList.contains('ad-icon-btn')).toBe(false);
    await setStatus(t, t.ad.files[0] as AnyDropFile, 'success');
    expect(shown(t.el)).toEqual(['open', 'say-hi']);
    const open = t.el.querySelector<HTMLElement>('[data-ad-action=open]')!;
    expect(open.getAttribute('aria-label')).toBe('Open a.txt');
    expect(open.querySelector('#star')).not.toBeNull();
    open.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    const ctx = onClick.mock.calls[0]![0];
    expect(ctx.kind).toBe('file');
    expect(ctx.file).toBe(t.ad.files[0]);
    expect(onClick.mock.calls[0]![1]).toBeInstanceOf(Event);
    t.ad.destroy();
  });

  it('a custom action can use SVG markup as its icon', async () => {
    const t = mount({
      rowActions: { file: [{ id: 'x', label: 'X', icon: '<svg id="inline"></svg>' }] },
    });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    expect(t.el.querySelector('[data-ad-action=x] #inline')).not.toBeNull();
    t.ad.destroy();
  });

  it('overriding a built-in keeps its label, icon and rule; ctx.remove() still runs the real one', async () => {
    const confirmed = vi.fn(() => true);
    const t = mount({
      rowActions: {
        file: [
          'cancel',
          {
            id: 'remove',
            onClick(ctx) {
              if (confirmed()) ctx.remove();
            },
          },
        ],
      },
    });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const f = t.ad.files[0] as AnyDropFile;
    expect(shown(t.el)).toEqual(['cancel']);
    await setStatus(t, f, 'success');
    expect(shown(t.el)).toEqual(['remove']);
    expect(t.el.querySelector('[data-ad-action=remove]')!.getAttribute('aria-label')).toBe(
      'Remove file',
    );
    t.el.querySelector<HTMLElement>('[data-ad-action=remove]')!.click();
    expect(confirmed).toHaveBeenCalled();
    expect(t.ad.files).not.toContain(f);
    t.ad.destroy();
  });

  it('an override that does not call the built-in leaves the file alone', async () => {
    const onClick = vi.fn();
    const t = mount({ rowActions: { file: [{ id: 'remove', onClick }] } });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    await setStatus(t, t.ad.files[0] as AnyDropFile, 'success');
    t.el.querySelector<HTMLElement>('[data-ad-action=remove]')!.click();
    expect(onClick).toHaveBeenCalled();
    expect(t.ad.files.length).toBe(1);
    t.ad.destroy();
  });

  it('an error in onClick, when or label is reported and does not break the row', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = mount({
      rowActions: {
        file: [
          {
            id: 'bad',
            label: () => {
              throw new Error('label');
            },
            when: () => true,
            onClick: () => {
              throw new Error('click');
            },
          },
          {
            id: 'never',
            when: () => {
              throw new Error('when');
            },
          },
        ],
      },
    });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    expect(shown(t.el)).toEqual(['bad']);
    t.el.querySelector<HTMLElement>('[data-ad-action=bad]')!.click();
    expect(err).toHaveBeenCalled();
    t.ad.destroy();
    err.mockRestore();
  });
});

describe('actionclicked', () => {
  it('fires before the action runs, for buttons, custom actions and shortcuts', async () => {
    const order: string[] = [];
    const t = mount({
      rowActions: {
        file: ['cancel', 'remove', { id: 'open', onClick: () => order.push('open-ran') }],
      },
    });
    t.ad.on('actionclicked', (id, target) =>
      order.push(`event:${id}:${(target as AnyDropFile).name}`),
    );
    const domEvent = vi.fn();
    t.el.addEventListener('anydrop:actionclicked', domEvent);
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    vi.spyOn(t.ad, 'cancelUpload').mockImplementation(() => {
      order.push('cancel-ran');
    });
    t.el.querySelector<HTMLElement>('[data-ad-action=cancel]')!.click();
    t.el.querySelector<HTMLElement>('[data-ad-action=open]')!.click();
    press(t.el, 'Delete');
    expect(order).toEqual([
      'event:cancel:a.txt',
      'cancel-ran',
      'event:open:a.txt',
      'open-ran',
      'event:cancel:a.txt',
      'cancel-ran',
    ]);
    expect(domEvent).toHaveBeenCalledTimes(3);
    expect((domEvent.mock.calls[0]![0] as CustomEvent).detail.args[0]).toBe('cancel');
    t.ad.destroy();
  });

  it('is passed the folder for folder actions', async () => {
    const t = mount();
    const seen = vi.fn();
    t.ad.on('actionclicked', seen);
    await t.ad.addFile(file('a.txt'), 'Photos');
    await settle(t.ad);
    (t.ad as unknown as { cancelFolder: () => void }).cancelFolder = vi.fn();
    t.el.querySelector<HTMLElement>('.ad-folder-row [data-ad-action=cancel]')!.click();
    expect(seen).toHaveBeenCalledWith('cancel', t.ad.getFolder('Photos'));
    t.ad.destroy();
  });
});

describe('keyboard shortcuts follow the configuration', () => {
  it('Delete cancels an active file and removes a finished one', async () => {
    const t = mount();
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const f = t.ad.files[0] as AnyDropFile;
    const cancel = vi.spyOn(t.ad, 'cancelUpload');
    press(t.el, 'Delete');
    expect(cancel).toHaveBeenCalled();
    await setStatus(t, f, 'success');
    press(t.el, 'Delete');
    expect(t.ad.files).not.toContain(f);
    t.ad.destroy();
  });

  it('does nothing when the action is not configured', async () => {
    const t = mount({ rowActions: { file: ['pause'] } });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const cancel = vi.spyOn(t.ad, 'cancelUpload');
    press(t.el, 'Delete');
    expect(cancel).not.toHaveBeenCalled();
    expect(press(t.el, 'r').defaultPrevented).toBe(false);
    t.ad.destroy();
  });

  it('an override runs for its shortcut too', async () => {
    const onClick = vi.fn();
    const t = mount({ rowActions: { file: ['cancel', { id: 'remove', onClick }] } });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    await setStatus(t, t.ad.files[0] as AnyDropFile, 'error');
    press(t.el, 'Delete');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(t.ad.files.length).toBe(1);
    t.ad.destroy();
  });
});

describe('focus', () => {
  it('when cancel gives way to remove, the focus moves to the shown button', async () => {
    const t = mount();
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    const cancel = t.el.querySelector<HTMLElement>('.ad-file-row [data-ad-action=cancel]')!;
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    await setStatus(t, t.ad.files[0] as AnyDropFile, 'canceled');
    expect(cancel.hidden).toBe(true);
    expect(document.activeElement).toBe(t.el.querySelector('.ad-file-row [data-ad-action=remove]'));
    t.ad.destroy();
  });
});

describe('onClick event and context kinds', () => {
  it('a shortcut passes the real KeyboardEvent', async () => {
    const onClick = vi.fn();
    const t = mount({ rowActions: { file: [{ id: 'cancel', onClick }] } });
    await t.ad.addFiles([file('a.txt')]);
    await settle(t.ad);
    press(t.el, 'Delete');
    expect(onClick.mock.calls[0]![1]).toBeInstanceOf(KeyboardEvent);
    t.ad.destroy();
  });

  it('every context has its kind', async () => {
    const kinds: string[] = [];
    const rec = (c: { kind: string }) => void kinds.push(c.kind);
    const t = mount({
      acceptedFiles: 'image/*',
      render: { file: rec, folder: rec, toolbar: rec, message: rec, errorItem: rec },
    });
    await t.ad.addFile(file('a.txt'), 'D');
    await t.ad.addFile(file('b.png', 5, 'image/png'), 'D');
    await settle(t.ad);
    for (const k of ['file', 'folder', 'toolbar', 'message', 'errorItem'])
      expect(kinds).toContain(k);
    t.ad.destroy();
  });
});
