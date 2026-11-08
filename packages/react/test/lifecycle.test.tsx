import { Component, StrictMode, version, createRef, type ReactNode, type RefObject } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnyDrop as AnyDropUI } from '@vedratech/anydrop-ui';
import { AnyDrop, type AnyDropInstance } from '../src/index';
import { isDestroyed, listenerCount } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('lifecycle', () => {
  it('creates the instance after mount and destroys it on unmount', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { unmount, container } = render(<AnyDrop url="/upload" ref={ref} />);
    expect(ref.current).toBeInstanceOf(AnyDropUI);
    expect(AnyDropUI.instances).toHaveLength(1);
    // The instance lives in the inner div; the outer div belongs to React.
    const inner = container.firstElementChild!.firstElementChild!;
    expect(inner.classList.contains('ad-root')).toBe(true);
    const instance = ref.current!;
    unmount();
    expect(AnyDropUI.instances).toHaveLength(0);
    expect(listenerCount(instance)).toBe(0);
    expect(ref.current).toBeNull();
  });

  it('StrictMode: create A, destroy A, create B; never two live instances; no leaked listeners', () => {
    const created: AnyDropInstance[] = [];
    const push = AnyDropUI.instances.push.bind(AnyDropUI.instances);
    let maxLive = 0;
    vi.spyOn(AnyDropUI.instances, 'push').mockImplementation((...items) => {
      created.push(...items);
      const n = push(...items);
      maxLive = Math.max(maxLive, AnyDropUI.instances.length);
      return n;
    });
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const onSuccess = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <AnyDrop url="/upload" ref={ref} onSuccess={onSuccess} />
      </StrictMode>,
    );
    expect(created).toHaveLength(2);
    expect(maxLive).toBe(1);
    expect(AnyDropUI.instances).toHaveLength(1);
    expect(ref.current).toBe(created[1]);
    // A is dead: no listeners are left on it.
    expect(listenerCount(created[0]!)).toBe(0);
    expect(isDestroyed(created[0]!)).toBe(true);
    unmount();
    expect(AnyDropUI.instances).toHaveLength(0);
    expect(listenerCount(created[1]!)).toBe(0);
  });

  it('options.init runs twice in development StrictMode (documented)', () => {
    const init = vi.fn();
    render(
      <StrictMode>
        <AnyDrop url="/upload" options={{ init }} />
      </StrictMode>,
    );
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('does not spread unknown props onto the DOM and renders id, className and style on the outer div', () => {
    const { container } = render(
      <AnyDrop url="/upload" id="zone" className="mine" style={{ minHeight: 120 }} />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.id).toBe('zone');
    expect(outer.className).toBe('mine');
    expect(outer.style.minHeight).toBe('120px');
  });

  it('a class change on the outer div does not wipe the classes of the ui element', () => {
    const { container, rerender } = render(<AnyDrop url="/upload" className="a" />);
    const inner = container.firstElementChild!.firstElementChild!;
    const before = inner.className;
    rerender(<AnyDrop url="/upload" className="b" />);
    expect(inner.className).toBe(before);
    expect((container.firstElementChild as HTMLElement).className).toBe('b');
  });

  // React 18 dev mode also rethrows a caught error to the window (happy-dom reports it as a test failure).
  it.skipIf(version.startsWith('18'))(
    'a missing url is a developer error that reaches the nearest error boundary',
    () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const caught: unknown[] = [];
      class Boundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
        override state = { failed: false };
        static getDerivedStateFromError() {
          return { failed: true };
        }
        override componentDidCatch(e: unknown) {
          caught.push(e);
        }
        override render() {
          return this.state.failed ? 'failed' : this.props.children;
        }
      }
      const { container } = render(
        <Boundary>
          <AnyDrop />
        </Boundary>,
      );
      expect(container.textContent).toBe('failed');
      expect((caught[0] as Error).message).toBe('No URL provided.');
    },
  );
});
