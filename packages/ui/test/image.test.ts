import { describe, expect, it } from 'vitest';
import { looksLikeImage, planScale, thumbMime } from '../src/image';

/*
 * Specification of the image scaling (thumbnails and `resizeWidth`/`resizeHeight`).
 *
 * Input: a source size, a box (width and height, either may be null) and a mode.
 * 1. A null side of the box is derived from the source aspect ratio. Both null means the natural size.
 * 2. Never enlarge: each side of the box is limited to the source side. An image that already fits
 *    is copied whole at its natural size.
 * 3. `contain`: the whole image is scaled uniformly until it fits inside the box; the result keeps the
 *    aspect ratio and may be smaller than the box on one side.
 * 4. `crop`: the result is exactly the box. The image is scaled until it covers the box, and the
 *    part that sticks out is cut off equally on both sides (the centred region is used).
 * 5. Result sizes are rounded to whole pixels; the source rectangle is not.
 * 6. EXIF orientation is not handled here: the browser draws the image upright, and the re-encoded
 *    file carries no EXIF data.
 * 7. An empty MIME type is recognised as an image by its extension (iOS HEIC photos).
 *    Thumbnails are PNG for png/gif/svg/webp sources and JPEG otherwise.
 */
describe('planScale', () => {
  it('crop: centred region with the box aspect ratio', () => {
    expect(planScale(400, 200, { width: 100, height: 100 }, 'crop')).toEqual({
      from: { x: 100, y: 0, w: 200, h: 200 },
      to: { w: 100, h: 100 },
    });
    expect(planScale(200, 400, { width: 100, height: 100 }, 'crop')).toEqual({
      from: { x: 0, y: 100, w: 200, h: 200 },
      to: { w: 100, h: 100 },
    });
  });

  it('contain: whole image, aspect ratio kept', () => {
    expect(planScale(400, 200, { width: 100, height: 100 }, 'contain')).toEqual({
      from: { x: 0, y: 0, w: 400, h: 200 },
      to: { w: 100, h: 50 },
    });
    expect(planScale(200, 400, { width: 100, height: 100 }, 'contain').to).toEqual({
      w: 50,
      h: 100,
    });
  });

  it('derives a missing side from the aspect ratio', () => {
    expect(planScale(400, 200, { width: 100, height: null }, 'contain').to).toEqual({
      w: 100,
      h: 50,
    });
    expect(planScale(400, 200, { width: null, height: 50 }, 'contain').to).toEqual({
      w: 100,
      h: 50,
    });
    expect(planScale(400, 200, { width: 100, height: null }, 'crop').to).toEqual({ w: 100, h: 50 });
  });

  it('uses the natural size when both sides are null', () => {
    expect(planScale(400, 200, { width: null, height: null }, 'crop')).toEqual({
      from: { x: 0, y: 0, w: 400, h: 200 },
      to: { w: 400, h: 200 },
    });
  });

  it('never enlarges', () => {
    for (const mode of ['crop', 'contain'] as const) {
      expect(planScale(50, 50, { width: 100, height: 100 }, mode)).toEqual({
        from: { x: 0, y: 0, w: 50, h: 50 },
        to: { w: 50, h: 50 },
      });
    }
    expect(planScale(400, 200, { width: 800, height: null }, 'contain').to).toEqual({
      w: 400,
      h: 200,
    });
  });

  it('limits each side of the box to the source side, then crops to that box', () => {
    expect(planScale(400, 100, { width: 200, height: 300 }, 'crop')).toEqual({
      from: { x: 100, y: 0, w: 200, h: 100 },
      to: { w: 200, h: 100 },
    });
  });

  it('rounds the result size', () => {
    expect(planScale(300, 200, { width: 100, height: null }, 'contain').to).toEqual({
      w: 100,
      h: 67,
    });
  });
});

describe('image type detection', () => {
  it('treats HEIC with an empty MIME type as an image (iOS)', () => {
    expect(looksLikeImage({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'a.pdf', type: 'application/pdf' })).toBe(false);
    expect(looksLikeImage({ name: 'a.jpg', type: 'text/plain' })).toBe(false);
  });
  it('picks the thumbnail encoding', () => {
    expect(thumbMime({ type: 'image/png' })).toBe('image/png');
    expect(thumbMime({ type: 'image/jpeg' })).toBe('image/jpeg');
    expect(thumbMime({})).toBe('image/jpeg');
  });
});
