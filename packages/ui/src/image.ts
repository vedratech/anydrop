/*!
 * The crop/contain geometry in `geometry()` is ported from Dropzone 6.3.5
 * (https://github.com/dropzone/dropzone), src/dropzone.ts `resize()`. Changes: a pure function
 * that returns the source rectangle and target size.
 *
 * Copyright (c) 2026 Matias Simon <m@tias.me>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
// Image helpers: thumbnails and the default `transformFile` resize.
// The crop/contain geometry follows Dropzone 6.3.5 `resize()` (MIT, see THIRD_PARTY_NOTICES.md),
// rewritten as a pure function.
export type Fit = 'crop' | 'contain';

export interface Geometry {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  tw: number;
  th: number;
}

/** Source rectangle and target size for scaling a `w` x `h` image into `tw` x `th`. */
export function geometry(
  w: number,
  h: number,
  tw: number | null,
  th: number | null,
  method: Fit,
): Geometry {
  const ratio = w / h;
  if (tw == null && th == null) {
    tw = w;
    th = h;
  } else if (tw == null) tw = (th as number) * ratio;
  else if (th == null) th = tw / ratio;
  tw = Math.min(tw as number, w);
  th = Math.min(th as number, h);
  let sw = w;
  let sh = h;
  if (w > tw || h > th) {
    const target = tw / th;
    if (method === 'crop') {
      if (ratio > target) sw = sh * target;
      else sh = sw / target;
    } else if (ratio > target) th = tw / ratio;
    else tw = th * ratio;
  }
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, tw: Math.round(tw), th: Math.round(th) };
}

/** Decodes an image. A Blob is read through a short-lived object URL, revoked as soon as it loaded. */
export function loadImage(
  src: Blob | string,
  crossOrigin?: string | null,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const done = () => {
      if (url !== src) URL.revokeObjectURL(url);
    };
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => {
      done();
      resolve(img);
    };
    img.onerror = () => {
      done();
      reject(new Error('image'));
    };
    img.src = url;
  });
}

export function drawImage(
  img: HTMLImageElement,
  tw: number | null,
  th: number | null,
  method: Fit,
): HTMLCanvasElement {
  const g = geometry(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    tw,
    th,
    method,
  );
  const c = document.createElement('canvas');
  c.width = g.tw;
  c.height = g.th;
  const ctx = c.getContext('2d');
  if (ctx) ctx.drawImage(img, g.sx, g.sy, g.sw, g.sh, 0, 0, g.tw, g.th);
  return c;
}

/** Extension fallback: iOS gives HEIC photos an empty MIME type. */
export function isImage(f: { name?: string; type?: string }): boolean {
  return f.type
    ? /^image\//.test(f.type)
    : /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif)$/i.test(f.name || '');
}

export function thumbType(f: { type?: string }): string {
  return /png|gif|svg|webp/.test(f.type || '') ? 'image/png' : 'image/jpeg';
}

/** Default `transformFile`: scales images down (resizeWidth/resizeHeight), passes everything else. */
export function resizeFile(
  file: Blob & { name?: string },
  o: {
    resizeWidth: number | null;
    resizeHeight: number | null;
    resizeMethod: Fit;
    resizeMimeType: string | null;
    resizeQuality: number;
  },
  done: (b: Blob) => void,
): void {
  if (!(o.resizeWidth || o.resizeHeight) || !isImage(file)) return done(file);
  loadImage(file).then(
    (img) =>
      drawImage(img, o.resizeWidth, o.resizeHeight, o.resizeMethod).toBlob(
        (b) => done(b || file),
        o.resizeMimeType || file.type || 'image/jpeg',
        o.resizeQuality,
      ),
    () => done(file),
  );
}
