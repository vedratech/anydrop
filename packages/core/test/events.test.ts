import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Emitter } from '../src/events/emitter';
import { AnyDropCore, type AnyDropEvents, type AnyDropFile, type FolderNode } from '../src/index';
import { EVENT_NAMES, isEventName } from '../src/events/events';
import { KeyedThrottle, microtaskMerge } from '../src/events/throttle';

type Map1 = { a: [n: number]; b: [] };

class TestEmitter extends Emitter<Map1> {
  errors: unknown[] = [];
  protected override onListenerError(error: unknown): void {
    this.errors.push(error);
  }
}

afterEach(() => vi.useRealTimers());

describe('Emitter', () => {
  it('binds this to the emitter and snapshots listeners during emit', () => {
    const e = new TestEmitter();
    const order: string[] = [];
    const contexts: unknown[] = [];
    const off1 = e.on('a', function (this: unknown) {
      contexts.push(this);
      order.push('1');
      off1();
    });
    e.on('a', () => {
      order.push('2');
      e.on('a', () => order.push('late'));
    });
    e.emit('a', 1);
    expect(order).toEqual(['1', '2']); // removing itself does not skip the next; added ones wait
    expect(contexts).toEqual([e]);
  });

  it('off(event, fn) removes one registration; off(event) and off() remove more', () => {
    const e = new TestEmitter();
    const fn = vi.fn();
    e.on('a', fn);
    e.on('a', fn);
    e.off('a', fn);
    e.emit('a', 1);
    expect(fn).toHaveBeenCalledTimes(1);
    e.on('b', fn);
    e.off();
    e.emit('a', 1);
    e.emit('b');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(e.off('a')).toBe(e);
  });

  it('routes listener errors to onListenerError and keeps going', () => {
    const e = new TestEmitter();
    const after = vi.fn();
    e.on('a', () => {
      throw new Error('x');
    });
    e.on('a', after);
    e.emit('a', 1);
    expect(after).toHaveBeenCalledWith(1);
    expect(e.errors).toHaveLength(1);
  });
});

describe('event names', () => {
  it('lists every event', () => {
    const base = [
      'drop',
      'dragstart',
      'dragend',
      'dragenter',
      'dragover',
      'dragleave',
      'addedfile',
      'addedfiles',
      'removedfile',
      'thumbnail',
      'error',
      'errormultiple',
      'processing',
      'processingmultiple',
      'uploadprogress',
      'totaluploadprogress',
      'sending',
      'sendingmultiple',
      'success',
      'successmultiple',
      'canceled',
      'canceledmultiple',
      'complete',
      'completemultiple',
      'reset',
      'maxfilesexceeded',
      'maxfilesreached',
      'queuecomplete',
      'emptyfolder',
      'paste',
    ];
    const added = [
      'addedfolder',
      'removedfolder',
      'folderprogress',
      'foldercomplete',
      'paused',
      'resumed',
      'offline',
      'online',
      'reconnecting',
      'errorlistchanged',
      'actionclicked',
    ];
    expect([...EVENT_NAMES].sort()).toEqual([...base, ...added].sort());
    expect(isEventName('addedfile')).toBe(true);
    expect(isEventName('toString')).toBe(false);
    expect(isEventName('url')).toBe(false);
  });
});

describe('actionclicked (declared in core, emitted by the ui)', () => {
  it('is typed as (action, file | folder) in the event map and in option handlers', () => {
    expectTypeOf<AnyDropEvents['actionclicked']>().toEqualTypeOf<
      [action: string, target: AnyDropFile | FolderNode]
    >();
    const handler = vi.fn();
    const core = new AnyDropCore({ url: '/upload', actionclicked: handler });
    core.on('actionclicked', (action, target) => {
      expectTypeOf(action).toEqualTypeOf<string>();
      expectTypeOf(target).toEqualTypeOf<AnyDropFile | FolderNode>();
    });
    core.destroy();
  });

  it('reaches listeners and option handlers with this = the instance, and off() removes it', () => {
    const seen: unknown[][] = [];
    const core = new AnyDropCore({ url: '/upload' });
    const off = core.on('actionclicked', function (this: unknown, action, target) {
      seen.push([this, action, target]);
    });
    const file = { name: 'a.txt' } as unknown as AnyDropFile;
    const folder = { path: 'a' } as unknown as FolderNode;
    core.emit('actionclicked', 'remove', file);
    core.emit('actionclicked', 'open', folder);
    expect(seen).toEqual([
      [core, 'remove', file],
      [core, 'open', folder],
    ]);
    off();
    core.emit('actionclicked', 'pause', file);
    expect(seen).toHaveLength(2);
    core.destroy();
  });

  it('is accepted as an option handler', () => {
    const handler = vi.fn();
    const core = new AnyDropCore({ url: '/upload', actionclicked: handler });
    const file = { name: 'a.txt' } as unknown as AnyDropFile;
    core.emit('actionclicked', 'retry', file);
    expect(handler).toHaveBeenCalledWith('retry', file);
    expect(handler.mock.contexts[0]).toBe(core);
    core.destroy();
  });
});

describe('KeyedThrottle (folderprogress, 100 ms trailing)', () => {
  it('fires once per key at the end of the window, and at once when forced', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const t = new KeyedThrottle<string>(100, (k) => fired.push(k));
    t.request('A');
    t.request('A');
    t.request('B');
    vi.advanceTimersByTime(99);
    expect(fired).toEqual([]);
    expect(t.pending('A')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(['A', 'B']);
    t.request('A');
    t.request('A', true); // progress reached 100
    expect(fired).toEqual(['A', 'B', 'A']);
    vi.advanceTimersByTime(200);
    expect(fired).toEqual(['A', 'B', 'A']); // the trailing call was replaced
  });

  it('clear() drops every pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = new KeyedThrottle<number>(100, fn);
    t.request(1);
    t.request(2);
    t.clear();
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('microtaskMerge (errorlistchanged)', () => {
  it('runs once per microtask however often it is requested', async () => {
    const fn = vi.fn();
    const request = microtaskMerge(fn);
    for (let i = 0; i < 5000; i++) request();
    expect(fn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    request();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
