import { createRef, type RefObject } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_NAMES } from '../../core/src/events/events';
import { DOM_COLLIDING_EVENTS, EVENT_ARGS, EVENT_LIST } from '../src/shared/events-map';
import { AnyDrop, type AnyDropInstance } from '../src/index';
import { listenerCount } from './helpers';

afterEach(() => vi.restoreAllMocks());

const emit = (i: AnyDropInstance, name: string, ...args: unknown[]) =>
  (i.emit as (n: string, ...a: unknown[]) => void)(name, ...args);

describe('events', () => {
  it('EVENT_LIST is the 41 core events', () => {
    expect(EVENT_LIST).toHaveLength(41);
    expect([...EVENT_LIST].sort()).toEqual([...EVENT_NAMES].sort());
    for (const d of DOM_COLLIDING_EVENTS) expect(EVENT_LIST).toContain(d);
    expect(Object.keys(EVENT_ARGS)).toHaveLength(41);
  });

  it('delivers the value, void, or a named object', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const onAddedfile = vi.fn();
    const onReset = vi.fn();
    const onTotaluploadprogress = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(
      <AnyDrop
        ref={ref}
        url="/upload"
        onAddedfile={onAddedfile}
        onReset={onReset}
        onTotaluploadprogress={onTotaluploadprogress}
        onSuccess={onSuccess}
        onError={onError}
      />,
    );
    const f = { name: 'a' };
    emit(ref.current!, 'addedfile', f);
    expect(onAddedfile).toHaveBeenCalledWith(f);
    emit(ref.current!, 'reset');
    expect(onReset).toHaveBeenCalledWith(undefined);
    emit(ref.current!, 'totaluploadprogress', 10, 100, 10);
    expect(onTotaluploadprogress).toHaveBeenCalledWith({
      progress: 10,
      totalBytes: 100,
      totalBytesSent: 10,
    });
    emit(ref.current!, 'success', f, { ok: 1 });
    const payload = onSuccess.mock.calls[0]![0];
    expect(payload).toEqual({ file: f, response: { ok: 1 }, progressEvent: undefined });
    expect('progressEvent' in payload).toBe(true);
    emit(ref.current!, 'error', f, 'boom');
    expect(onError.mock.calls[0]![0]).toEqual({ file: f, message: 'boom', xhr: undefined });
    // A new object per emit.
    emit(ref.current!, 'success', f, 2);
    expect(onSuccess.mock.calls[1]![0]).not.toBe(payload);
  });

  it('changing a handler does not re-subscribe, and the latest handler runs', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(<AnyDrop ref={ref} url="/upload" onAddedfile={a} />);
    const on = vi.spyOn(ref.current!, 'on');
    const before = listenerCount(ref.current!);
    rerender(<AnyDrop ref={ref} url="/upload" onAddedfile={b} />);
    expect(on).not.toHaveBeenCalled();
    expect(listenerCount(ref.current!)).toBe(before);
    emit(ref.current!, 'addedfile', { name: 'x' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ name: 'x' });
  });

  it('listener count follows the defined on* props', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const { rerender } = render(<AnyDrop ref={ref} url="/upload" />);
    const base = listenerCount(ref.current!);
    const h = () => {};
    rerender(<AnyDrop ref={ref} url="/upload" onAddedfile={h} onSuccess={h} onDrop={h} />);
    expect(listenerCount(ref.current!)).toBe(base + 3);
    rerender(<AnyDrop ref={ref} url="/upload" onSuccess={h} />);
    expect(listenerCount(ref.current!)).toBe(base + 1);
    rerender(<AnyDrop ref={ref} url="/upload" />);
    expect(listenerCount(ref.current!)).toBe(base);
  });

  it('a handler passed in options.<event> still works through core', () => {
    const ref: RefObject<AnyDropInstance | null> = createRef();
    const queuecomplete = vi.fn();
    render(<AnyDrop ref={ref} url="/upload" options={{ queuecomplete }} />);
    emit(ref.current!, 'queuecomplete');
    expect(queuecomplete).toHaveBeenCalledTimes(1);
  });
});
