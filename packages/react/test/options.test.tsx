import { createRef, type RefObject } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDrop as AnyDropUI, type AnyDropConfig } from '@vedratech/anydrop-ui';
import { AnyDrop, type AnyDropInstance } from '../src/index';

afterEach(() => vi.restoreAllMocks());

const spy = () => vi.spyOn(AnyDropUI.prototype, 'setOption');

describe('option diff', () => {
  it('inline functions, handlers and rowActions never call setOption', () => {
    const set = spy();
    const ui = (n: number) => (
      <AnyDrop
        url="/upload"
        options={{
          parallelUploads: 2,
          params: () => ({ n }),
          success: () => n,
          rowActions: { file: ['pause', { id: 'open', onClick: () => n }] },
          render: { file: () => null },
        }}
      />
    );
    const { rerender } = render(ui(1));
    set.mockClear();
    rerender(ui(2));
    rerender(ui(3));
    expect(set).not.toHaveBeenCalled();
  });

  it('a stale closure is never called: the latest function runs', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const ui = (n: number) => (
      <AnyDrop ref={ref} url="/upload" options={{ params: () => ({ n }) }} />
    );
    const { rerender } = render(ui(1));
    rerender(ui(2));
    const params = ref.current!.options.params as unknown as () => { n: number };
    expect(params()).toEqual({ n: 2 });
  });

  it('a data change calls setOption once for that key, a changed nested value sends a fresh clone', () => {
    const set = spy();
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const ui = (options: AnyDropConfig) => <AnyDrop ref={ref} url="/upload" options={options} />;
    const { rerender } = render(ui({ parallelUploads: 2, rowActions: { file: ['pause'] } }));
    set.mockClear();
    rerender(ui({ parallelUploads: 4, rowActions: { file: ['pause'] } }));
    expect(set.mock.calls.map((c) => c[0])).toEqual(['parallelUploads']);
    expect(ref.current!.options.parallelUploads).toBe(4);
    set.mockClear();
    rerender(ui({ parallelUploads: 4, rowActions: { file: ['pause', 'retry'] } }));
    expect(set.mock.calls.map((c) => c[0])).toEqual(['rowActions']);
  });

  it('a removed key is reset to its default, a removed handler key to null', () => {
    const set = spy();
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const ui = (options: AnyDropConfig) => <AnyDrop ref={ref} url="/upload" options={options} />;
    const { rerender } = render(ui({ parallelUploads: 5, success: () => {} }));
    set.mockClear();
    rerender(ui({}));
    const calls = Object.fromEntries(set.mock.calls.map((c) => [c[0], c[1]]));
    expect(calls.parallelUploads).toBe(defaultOptions().parallelUploads);
    expect(calls.success).toBeNull();
    expect(ref.current!.options.parallelUploads).toBe(defaultOptions().parallelUploads);
  });

  it('construction-only keys are ignored and warn once in development', () => {
    const set = spy();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ui = (forceFallback: boolean) => <AnyDrop url="/upload" options={{ forceFallback }} />;
    const { rerender } = render(ui(false));
    rerender(ui(true));
    rerender(ui(false));
    rerender(ui(true));
    expect(set.mock.calls.filter((c) => c[0] === 'forceFallback')).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      '[anydrop] option "forceFallback" is only read when the instance is created; the change was ignored. Remount the component to apply it.',
    );
    expect(AnyDropUI.instances).toHaveLength(1);
  });

  it('dedicated props override options, and apply at runtime', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { rerender } = render(
      <AnyDrop
        ref={ref}
        url="/upload"
        layout="compact"
        locale="en"
        options={{ layout: 'list', url: '/other' }}
      />,
    );
    expect(ref.current!.options.layout).toBe('compact');
    expect(ref.current!.options.url).toBe('/upload');
    rerender(<AnyDrop ref={ref} url="/two" layout="list" options={{ layout: 'compact' }} />);
    expect(ref.current!.options.layout).toBe('list');
    expect(ref.current!.options.url).toBe('/two');
  });

  it('disabled calls disable() and enable(), also at creation', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { rerender } = render(<AnyDrop ref={ref} url="/upload" disabled />);
    expect(ref.current!.disabled).toBe(true);
    rerender(<AnyDrop ref={ref} url="/upload" disabled={false} />);
    expect(ref.current!.disabled).toBe(false);
    rerender(<AnyDrop ref={ref} url="/upload" disabled />);
    expect(ref.current!.disabled).toBe(true);
  });

  it('transport is compared and passed by identity', () => {
    const set = spy();
    class T {
      send() {
        return { abort() {} };
      }
    }
    const transport = new T() as never;
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { rerender } = render(<AnyDrop ref={ref} url="/upload" options={{ transport }} />);
    expect(ref.current!.options.transport).toBe(transport);
    set.mockClear();
    rerender(<AnyDrop ref={ref} url="/upload" options={{ transport }} />);
    expect(set).not.toHaveBeenCalled();
    const next = new T() as never;
    rerender(<AnyDrop ref={ref} url="/upload" options={{ transport: next }} />);
    expect(ref.current!.options.transport).toBe(next);
  });

  it('never recreates the instance for a prop change', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { rerender } = render(<AnyDrop ref={ref} url="/a" />);
    const first = ref.current;
    rerender(<AnyDrop ref={ref} url="/b" options={{ chunkSize: 1000 }} />);
    expect(ref.current).toBe(first);
  });
});
