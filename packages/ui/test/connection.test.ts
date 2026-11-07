import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyDrop } from '../src/index';
import { file, mount, settle } from './helpers';

type Fake = {
  state: { state: string; attempt: number; retryAt: number | null };
  reconnect: () => void;
};

/** A core that has the connection API (0017): the state is whatever the test sets. */
function fake(ad: AnyDrop): Fake {
  const f: Fake = { state: { state: 'online', attempt: 0, retryAt: null }, reconnect: vi.fn() };
  Object.assign(ad, { getConnectionState: () => f.state, reconnect: f.reconnect });
  return f;
}
const emit = (ad: AnyDrop, name: string, ...a: unknown[]) =>
  (ad as unknown as { emit(n: string, ...x: unknown[]): void }).emit(name, ...a);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('connection banner (0017)', () => {
  it('stays hidden and harmless while core has no connection API', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    expect(el.querySelector<HTMLElement>('.ad-banner')!.hidden).toBe(true);
    ad.destroy();
  });

  it('shows the offline text, then announces that the connection is back', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    const f = fake(ad);
    f.state = { state: 'offline', attempt: 0, retryAt: null };
    emit(ad, 'paused', { scope: 'all', reason: 'offline' });
    const banner = el.querySelector<HTMLElement>('.ad-banner')!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('You are offline');
    expect(banner.querySelector<HTMLElement>('[data-ad-action=retry-now]')!.hidden).toBe(true);
    expect(el.querySelector('[aria-live=polite]')!.textContent).toContain('You are offline');
    f.state = { state: 'online', attempt: 0, retryAt: null };
    emit(ad, 'resumed', { scope: 'all', reason: 'offline' });
    expect(banner.hidden).toBe(true);
    expect(el.querySelector('[aria-live=polite]')!.textContent).toContain('Connection restored');
    ad.destroy();
  });

  it('counts down once a second, announces only the change, and Retry now calls reconnect()', async () => {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'));
    await settle(ad);
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const f = fake(ad);
    f.state = { state: 'unreachable', attempt: 1, retryAt: 5000 };
    emit(ad, 'paused', { scope: 'all', reason: 'unreachable' });
    const text = el.querySelector('.ad-banner-text')!;
    const live = el.querySelector('[aria-live=polite]')!;
    expect(text.textContent).toContain('Retrying in 5 s');
    const said = live.textContent;
    vi.advanceTimersByTime(3000);
    expect(text.textContent).toContain('Retrying in 2 s');
    expect(live.textContent).toBe(said); // no announcement per tick
    const btn = el.querySelector<HTMLElement>('.ad-banner [data-ad-action=retry-now]')!;
    expect(btn.hidden).toBe(false);
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    expect(f.reconnect).toHaveBeenCalled();
    ad.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rows paused by the system say "Waiting for connection"; user pauses keep "Paused"', async () => {
    const { el, ad } = mount();
    const a = ad.addFile(file('a.txt'));
    const b = ad.addFile(file('b.txt'));
    await settle(ad);
    (a as { status: string }).status = 'paused';
    (b as { status: string }).status = 'paused';
    const f = fake(ad);
    emit(ad, 'paused', { scope: 'file', file: b, reason: 'user' });
    f.state = { state: 'unreachable', attempt: 1, retryAt: Date.now() + 4000 };
    emit(ad, 'paused', { scope: 'all', reason: 'unreachable' });
    await settle(ad);
    const badge = (n: string) =>
      Array.from(el.querySelectorAll('.ad-file-row'))
        .find((r) => r.textContent?.includes(n))!
        .querySelector('.ad-badge')!.textContent;
    expect(badge('a.txt')).toBe('Waiting for connection');
    expect(badge('b.txt')).toBe('Paused');
    ad.destroy();
  });

  it('reads the state on mount and uses dict strings', async () => {
    const { AnyDrop } = await import('../src/index');
    const proto = AnyDrop.prototype as unknown as Record<string, unknown>;
    proto.getConnectionState = () => ({ state: 'offline', attempt: 0, retryAt: null });
    try {
      const { el, ad } = mount({ dictOffline: 'Keine Verbindung', dictRetryNow: 'Jetzt' });
      const banner = el.querySelector<HTMLElement>('.ad-banner')!;
      expect(banner.hidden).toBe(false);
      expect(banner.textContent).toContain('Keine Verbindung');
      ad.destroy();
    } finally {
      delete proto.getConnectionState;
    }
  });
});

describe('pausing during an outage (0019)', () => {
  const vis = (el: HTMLElement, sel: string) => !el.querySelector<HTMLElement>(sel)!.hidden;
  async function outage() {
    const { el, ad } = mount();
    ad.addFile(file('a.txt'), 'Photos');
    await settle(ad);
    const f = fake(ad);
    const a = ad.files[0]!;
    f.state = { state: 'unreachable', attempt: 1, retryAt: 5000 };
    (a as { status: string }).status = 'paused';
    emit(ad, 'paused', { scope: 'all', reason: 'unreachable' });
    await settle(ad);
    return { el, ad, f, a };
  }

  it('offers Pause, not Resume, on waiting file and folder rows; Pause all stays enabled', async () => {
    const { el, ad } = await outage();
    expect(vis(el, '.ad-file-row [data-ad-action=pause]')).toBe(true);
    expect(vis(el, '.ad-file-row [data-ad-action=resume]')).toBe(false);
    expect(vis(el, '.ad-folder-row [data-ad-action=pause]')).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-ad-action=pause-all]')!.disabled).toBe(false);
    ad.destroy();
  });

  it('a user-paused file shows Resume and "Paused", and keeps it after the connection returns', async () => {
    const { el, ad, f, a } = await outage();
    emit(ad, 'paused', { scope: 'file', file: a, reason: 'user' });
    await settle(ad);
    expect(vis(el, '.ad-file-row [data-ad-action=pause]')).toBe(false);
    expect(vis(el, '.ad-file-row [data-ad-action=resume]')).toBe(true);
    expect(
      el.querySelector('.ad-file-row .ad-badge, .ad-file-row [class*=badge]')!.textContent,
    ).toBe('Paused');
    f.state = { state: 'online', attempt: 0, retryAt: null };
    emit(ad, 'resumed', { scope: 'all', reason: 'unreachable' });
    await settle(ad);
    expect(vis(el, '.ad-file-row [data-ad-action=resume]')).toBe(true);
    ad.destroy();
  });

  it('a user-paused folder shows Resume on its row and hides file Resume buttons', async () => {
    const { el, ad, a } = await outage();
    (a.folder as { userPaused: boolean }).userPaused = true;
    emit(ad, 'paused', { scope: 'folder', folder: a.folder, reason: 'user' });
    await settle(ad);
    expect(vis(el, '.ad-folder-row [data-ad-action=pause]')).toBe(false);
    expect(vis(el, '.ad-folder-row [data-ad-action=resume]')).toBe(true);
    expect(vis(el, '.ad-file-row [data-ad-action=resume]')).toBe(false);
    ad.destroy();
  });

  it('keeps the user pause-all when a system pause ends', async () => {
    const { el, ad, f } = await outage();
    emit(ad, 'paused', { scope: 'all', reason: 'user' });
    f.state = { state: 'online', attempt: 0, retryAt: null };
    emit(ad, 'resumed', { scope: 'all', reason: 'unreachable' });
    await settle(ad);
    expect((ad as unknown as { _uiUserAll: boolean })._uiUserAll).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('[data-ad-action=pause-all]')!.disabled).toBe(true);
    emit(ad, 'resumed', { scope: 'all', reason: 'user' });
    expect((ad as unknown as { _uiUserAll: boolean })._uiUserAll).toBe(false);
    ad.destroy();
  });
});
