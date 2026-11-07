import { describe, expect, it } from 'vitest';
import { geometry, isImage } from '../src/image';

describe('image helpers', () => {
  it('crops to the target ratio', () => {
    expect(geometry(400, 200, 100, 100, 'crop')).toEqual({
      sx: 100,
      sy: 0,
      sw: 200,
      sh: 200,
      tw: 100,
      th: 100,
    });
  });
  it('contains inside the target', () => {
    expect(geometry(400, 200, 100, 100, 'contain')).toMatchObject({ tw: 100, th: 50 });
  });
  it('never upscales', () => {
    expect(geometry(50, 50, 100, 100, 'crop')).toMatchObject({ tw: 50, th: 50 });
  });
  it('treats HEIC with an empty MIME type as an image (iOS)', () => {
    expect(isImage({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(isImage({ name: 'a.pdf', type: 'application/pdf' })).toBe(false);
  });
});
