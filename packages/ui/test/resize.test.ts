import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scaleBlob } from '../src/image';
import { file, mount } from './helpers';

let canvas: { width: number; height: number; type?: string; quality?: number };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 400;
      naturalHeight = 200;
      onload: (() => void) | null = null;
      set src(_: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    canvas = { width: this.width, height: this.height, type, quality: quality as number };
    cb(new Blob(['x'], { type }));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('resize options', () => {
  it('installs the default transformFile only when a resize option is set', () => {
    const a = mount();
    expect(a.ad.options.transformFile).toBeNull();
    a.ad.setOption('resizeWidth', 100);
    expect(typeof a.ad.options.transformFile).toBe('function');
    a.ad.setOption('resizeWidth', null);
    expect(a.ad.options.transformFile).toBeNull();
    a.ad.destroy();
    const b = mount({ resizeHeight: 50 });
    expect(typeof b.ad.options.transformFile).toBe('function');
    b.ad.destroy();
  });

  it('lets a user transformFile win', () => {
    const mine = vi.fn();
    const a = mount({ resizeWidth: 100, transformFile: mine as never });
    expect(a.ad.options.transformFile).toBe(mine);
    a.ad.setOption('resizeHeight', 50);
    expect(a.ad.options.transformFile).toBe(mine);
    a.ad.destroy();
  });

  it('scales to the requested size and MIME type', async () => {
    const a = mount({ resizeWidth: 100, resizeMimeType: 'image/webp', resizeQuality: 0.5 });
    const out = await new Promise<Blob>((r) =>
      (a.ad.options.transformFile as never as (f: Blob, d: (b: Blob) => void) => void)(
        file('p.png', 10, 'image/png'),
        r,
      ),
    );
    expect(canvas).toEqual({ width: 100, height: 50, type: 'image/webp', quality: 0.5 });
    expect(out.type).toBe('image/webp');
    a.ad.destroy();
  });

  it('keeps the file type by default, never enlarges, and passes non-images through', async () => {
    const o = {
      resizeWidth: 800,
      resizeHeight: null,
      resizeMethod: 'contain' as const,
      resizeMimeType: null,
      resizeQuality: 0.8,
    };
    await new Promise<Blob>((r) => scaleBlob(file('p.jpg', 10, 'image/jpeg'), o, r));
    expect(canvas).toMatchObject({ width: 400, height: 200, type: 'image/jpeg' });
    const txt = file('a.txt');
    const same = await new Promise<Blob>((r) => scaleBlob(txt, o, r));
    expect(same).toBe(txt);
  });
});
