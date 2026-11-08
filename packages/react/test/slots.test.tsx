import {
  Profiler,
  createContext,
  createRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyDropFileContext } from '@vedratech/anydrop-ui';
import { AnyDrop, type AnyDropInstance } from '../src/index';
import { file, isDestroyed, paint } from './helpers';

let reported: unknown[];
beforeEach(() => {
  reported = [];
  vi.stubGlobal('reportError', (e: unknown) => reported.push(e));
});
afterEach(() => vi.unstubAllGlobals());

const slotEls = (container: HTMLElement, kind = 'file') =>
  Array.from(container.querySelectorAll<HTMLElement>(`[data-ad-slot="${kind}"]`));

const base = { url: '/upload', options: { autoProcessQueue: false } };

const sendProgress = (i: AnyDropInstance, p: number) => {
  const f = i.files[0]!;
  f.upload.progress = p;
  (i.emit as (n: string, ...a: unknown[]) => void)('uploadprogress', f, p, p);
};

describe('render slots', () => {
  it('mounts one real React component per row, once, and reuses it on update', async () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const mounts = vi.fn();
    const unmounts = vi.fn();
    function Row({ ctx }: { ctx: AnyDropFileContext }) {
      const [id] = useState(() => Math.random());
      const taps = useRef(0);
      useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return (
        <button
          data-id={id}
          data-taps={taps.current}
          onClick={() => {
            taps.current++;
          }}
        >
          {ctx.label}:{Math.round(ctx.progress)}
        </button>
      );
    }
    const { container } = render(
      <AnyDrop ref={ref} {...base} renderFile={(ctx) => <Row ctx={ctx} />} />,
    );
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    const [el] = slotEls(container);
    expect(el).toBeDefined();
    expect(el!.className).toBe('');
    expect(el!.getAttribute('style')).toBeNull();
    const button = el!.querySelector('button')!;
    expect(button.textContent).toBe('a.txt:0');
    expect(mounts).toHaveBeenCalledTimes(1);
    const id = button.getAttribute('data-id');
    sendProgress(ref.current!, 40);
    await paint();
    // Same el, same DOM node, same component state; only the text changed.
    expect(slotEls(container)[0]).toBe(el);
    expect(el!.querySelector('button')).toBe(button);
    expect(button.getAttribute('data-id')).toBe(id);
    expect(button.textContent).toBe('a.txt:40');
    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();
  });

  it('destroy runs exactly once per view when the row goes away', async () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const mounts = vi.fn();
    const unmounts = vi.fn();
    function Row() {
      useEffect(() => {
        mounts();
        return unmounts;
      }, []);
      return <span>row</span>;
    }
    const { container, unmount } = render(
      <AnyDrop ref={ref} {...base} renderFile={() => <Row />} />,
    );
    await act(async () => {
      await ref.current!.addFiles([file('a.txt'), file('b.txt')]);
    });
    await paint();
    expect(mounts).toHaveBeenCalledTimes(2);
    await act(async () => {
      ref.current!.removeFile(ref.current!.files[0]!);
    });
    await paint();
    expect(slotEls(container)).toHaveLength(1);
    // The ui rebuilds its rows after a structural change: every view it drops is destroyed once,
    // so live views (mounts minus unmounts) always equal the rows on screen.
    expect(mounts.mock.calls.length - unmounts.mock.calls.length).toBe(1);
    unmount();
    expect(unmounts.mock.calls.length).toBe(mounts.mock.calls.length);
  });

  it('a context provider above <AnyDrop> is visible inside rows', async () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const Theme = createContext('none');
    function Row() {
      return <i>{useContext(Theme)}</i>;
    }
    const { container } = render(
      <Theme.Provider value="from-provider">
        <AnyDrop ref={ref} {...base} renderFile={() => <Row />} />
      </Theme.Provider>,
    );
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    expect(slotEls(container)[0]!.textContent).toBe('from-provider');
  });

  it('closures over parent state are never stale', async () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const ui = (n: number): ReactNode => (
      <AnyDrop ref={ref} {...base} renderFile={(ctx) => `${ctx.label}#${n}`} />
    );
    const { container, rerender } = render(ui(1));
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    expect(slotEls(container)[0]!.textContent).toBe('a.txt#1');
    rerender(ui(2));
    expect(slotEls(container)[0]!.textContent).toBe('a.txt#2');
  });

  it('all rows of one ui paint arrive in one React commit, with no React warnings', async () => {
    const error = vi.spyOn(console, 'error');
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const commits = vi.fn();
    const { container } = render(
      <Profiler id="p" onRender={commits}>
        <AnyDrop ref={ref} {...base} renderFile={(ctx) => <b>{ctx.label}</b>} />
      </Profiler>,
    );
    commits.mockClear();
    await act(async () => {
      await ref.current!.addFiles([file('a.txt'), file('b.txt'), file('c.txt')]);
    });
    await paint();
    expect(slotEls(container)).toHaveLength(3);
    const withRows = commits.mock.calls.length;
    // One commit mounts the three rows (act may add none, never one per row).
    expect(withRows).toBeLessThanOrEqual(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('a throwing row is isolated: the others render, the error is reported', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { container } = render(
      <AnyDrop
        ref={ref}
        {...base}
        renderFile={(ctx) => {
          if (ctx.label === 'bad.txt') throw new Error('row failed');
          return <b>{ctx.label}</b>;
        }}
      />,
    );
    await act(async () => {
      await ref.current!.addFiles([file('bad.txt'), file('ok.txt')]);
    });
    await paint();
    const els = slotEls(container);
    expect(els).toHaveLength(2);
    expect(els.map((e) => e.textContent).sort()).toEqual(['', 'ok.txt']);
    expect(reported.some((e) => (e as Error).message === 'row failed')).toBe(true);
    expect(AnyDropUiAlive(ref)).toBe(true);
  });

  it('a slot that appears or disappears rebuilds the panel (setOption render)', async () => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { container, rerender } = render(<AnyDrop ref={ref} {...base} />);
    const set = vi.spyOn(ref.current!, 'setOption');
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    expect(slotEls(container)).toHaveLength(0);
    rerender(<AnyDrop ref={ref} {...base} renderFile={() => <u>x</u>} />);
    expect(set.mock.calls.filter((c) => c[0] === 'render')).toHaveLength(1);
    await paint();
    expect(slotEls(container)).toHaveLength(1);
    // A new render function identity is not a change.
    rerender(<AnyDrop ref={ref} {...base} renderFile={() => <u>y</u>} />);
    expect(set.mock.calls.filter((c) => c[0] === 'render')).toHaveLength(1);
    rerender(<AnyDrop ref={ref} {...base} />);
    expect(set.mock.calls.filter((c) => c[0] === 'render')).toHaveLength(2);
    await paint();
    expect(slotEls(container)).toHaveLength(0);
    // No React warnings while a slot was added and removed at runtime.
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('the toolbar and message slots mount too, and slots override options.render', async () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const decorate = vi.fn();
    const { container } = render(
      <AnyDrop
        ref={ref}
        {...base}
        options={{ autoProcessQueue: false, render: { file: decorate } }}
        renderMessage={() => <p>drop here</p>}
        renderToolbar={() => <nav>tools</nav>}
        renderFile={() => <b>mine</b>}
      />,
    );
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    expect(slotEls(container, 'message')[0]?.textContent).toBe('drop here');
    expect(slotEls(container, 'toolbar')[0]?.textContent).toBe('tools');
    expect(slotEls(container)[0]?.textContent).toBe('mine');
    expect(decorate).not.toHaveBeenCalled();
  });

  it('survives StrictMode: no orphan rows after the double mount', async () => {
    const { StrictMode } = await import('react');
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { container } = render(
      <StrictMode>
        <AnyDrop ref={ref} {...base} renderFile={(ctx) => <b>{ctx.label}</b>} />
      </StrictMode>,
    );
    await act(async () => {
      await ref.current!.addFiles([file('a.txt')]);
    });
    await paint();
    expect(slotEls(container)).toHaveLength(1);
    expect(slotEls(container)[0]!.textContent).toBe('a.txt');
  });
});

function AnyDropUiAlive(ref: RefObject<AnyDropInstance | null>) {
  return !!ref.current && !isDestroyed(ref.current);
}
