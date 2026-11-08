import { EVENT_ARGS, EVENT_LIST, DOM_COLLIDING_EVENTS, toPayload } from '../src/shared/events-map';

const NAMES = [
  'drop',
  'dragstart',
  'dragend',
  'dragenter',
  'dragover',
  'dragleave',
  'paste',
  'emptyfolder',
  'addedfile',
  'addedfiles',
  'removedfile',
  'reset',
  'thumbnail',
  'error',
  'errormultiple',
  'maxfilesexceeded',
  'maxfilesreached',
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
  'queuecomplete',
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

describe('event map', () => {
  it('has the 41 events of core', () => {
    expect([...EVENT_LIST].sort()).toEqual([...NAMES].sort());
    expect(EVENT_LIST.length).toBe(41);
  });

  it('leaves 34 events as outputs (41 minus the 7 DOM-colliding ones)', () => {
    expect(DOM_COLLIDING_EVENTS.length).toBe(7);
    const outputs = EVENT_LIST.filter(
      (e) => !(DOM_COLLIDING_EVENTS as readonly string[]).includes(e),
    );
    expect(outputs.length).toBe(34);
  });

  it('builds payloads: void, the value itself, or a named object', () => {
    expect(EVENT_ARGS.reset.length).toBe(0);
    expect(toPayload('reset', [])).toBeUndefined();
    expect(toPayload('emptyfolder', ['a/b'])).toBe('a/b');
    expect(toPayload('reconnecting', [2, 500])).toEqual({ attempt: 2, delayMs: 500 });
    const p = toPayload('success', [{ name: 'f' } as never, 'ok', undefined]);
    expect(p).toEqual({ file: { name: 'f' }, response: 'ok', progressEvent: undefined });
    expect('progressEvent' in p).toBe(true);
  });
});
