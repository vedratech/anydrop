import { afterEach, describe, expect, it } from 'vitest';
import { AnyDrop } from '../src/index';

afterEach(() => {
  document.body.innerHTML = '';
  AnyDrop.options = {};
});

function host(id = ''): HTMLElement {
  const el = document.createElement('div');
  if (id) el.id = id;
  document.body.appendChild(el);
  return el;
}

describe('transport option keeps its identity', () => {
  it('a plain-object transport passed to the constructor is not copied', () => {
    const transport = { state: { sent: 0 }, send() {} };
    const a = new AnyDrop(host(), { url: '/u', transport: transport as never });
    expect(a.options.transport).toBe(transport);
    a.destroy();
  });

  it('a plain-object transport from AnyDrop.options is not copied', () => {
    const transport = { send() {} };
    AnyDrop.options.box = { url: '/u', transport: transport as never };
    const a = new AnyDrop(host('box'), {});
    expect(a.options.transport).toBe(transport);
    a.destroy();
  });

  it('the constructor transport wins over AnyDrop.options', () => {
    const fromPreset = { send() {} };
    const fromConfig = { send() {} };
    AnyDrop.options.box2 = { url: '/u', transport: fromPreset as never };
    const a = new AnyDrop(host('box2'), { transport: fromConfig as never });
    expect(a.options.transport).toBe(fromConfig);
    a.destroy();
  });

  it('no transport keeps the default (null)', () => {
    const a = new AnyDrop(host(), { url: '/u' });
    expect(a.options.transport).toBeNull();
    a.destroy();
  });
});
