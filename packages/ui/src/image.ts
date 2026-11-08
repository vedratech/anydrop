// Image helpers for thumbnails and the default `transformFile` (resize before upload).
// The behaviour is specified at the top of test/image.test.ts.

/** How an image is fitted into the target box. */
export type FitMode = 'crop' | 'contain';

/** The requested box: a side that is `null` is derived from the aspect ratio. */
export interface Box {
  width: number | null;
  height: number | null;
}

/** What to copy from the source image (`from`) and the size of the result (`to`). */
export interface ScalePlan {
  from: { x: number; y: number; w: number; h: number };
  to: { w: number; h: number };
}

/** Works out how to scale a `srcW` x `srcH` image into `box`. Pure; never enlarges. */
export function planScale(srcW: number, srcH: number, box: Box, mode: FitMode): ScalePlan {
  const aspect = srcW / srcH;
  let wantW: number;
  let wantH: number;
  if (box.width == null && box.height == null) {
    wantW = srcW;
    wantH = srcH;
  } else if (box.width == null) {
    wantH = box.height as number;
    wantW = wantH * aspect;
  } else if (box.height == null) {
    wantW = box.width;
    wantH = wantW / aspect;
  } else {
    wantW = box.width;
    wantH = box.height;
  }
  const boxW = Math.min(wantW, srcW);
  const boxH = Math.min(wantH, srcH);

  // Scale factors that make the image just cover, or just fit inside, the box.
  const kW = boxW / srcW;
  const kH = boxH / srcH;
  if (kW >= 1 && kH >= 1) {
    return {
      from: { x: 0, y: 0, w: srcW, h: srcH },
      to: { w: Math.round(srcW), h: Math.round(srcH) },
    };
  }
  if (mode === 'contain') {
    const k = Math.min(kW, kH);
    return {
      from: { x: 0, y: 0, w: srcW, h: srcH },
      to: { w: Math.round(srcW * k), h: Math.round(srcH * k) },
    };
  }
  const k = Math.max(kW, kH);
  const w = boxW / k;
  const h = boxH / k;
  return {
    from: { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h },
    to: { w: Math.round(boxW), h: Math.round(boxH) },
  };
}

/** Decodes an image. A Blob goes through an object URL that is revoked as soon as decoding ended. */
export function decodeImage(
  source: Blob | string,
  crossOrigin?: string | null,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blobUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
    const release = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => {
      release();
      resolve(img);
    };
    img.onerror = () => {
      release();
      reject(new Error('image'));
    };
    img.src = blobUrl ?? (source as string);
  });
}

/** Draws the image scaled into `box` on a new canvas. */
export function renderScaled(img: HTMLImageElement, box: Box, mode: FitMode): HTMLCanvasElement {
  const { from, to } = planScale(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    box,
    mode,
  );
  const canvas = document.createElement('canvas');
  canvas.width = to.w;
  canvas.height = to.h;
  canvas.getContext('2d')?.drawImage(img, from.x, from.y, from.w, from.h, 0, 0, to.w, to.h);
  return canvas;
}

const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif)$/i;

/** True for images. With an empty MIME type (iOS gives HEIC photos none) the extension decides. */
export function looksLikeImage(file: { name?: string; type?: string }): boolean {
  return file.type ? file.type.startsWith('image/') : IMAGE_EXTENSION.test(file.name ?? '');
}

/** The MIME type a thumbnail data URL is encoded in: PNG where transparency may matter, else JPEG. */
export function thumbMime(file: { type?: string }): string {
  return /png|gif|svg|webp/.test(file.type ?? '') ? 'image/png' : 'image/jpeg';
}

export interface ScaleOptions {
  resizeWidth: number | null;
  resizeHeight: number | null;
  resizeMethod: FitMode;
  resizeMimeType: string | null;
  resizeQuality: number;
}

/**
 * The default `transformFile`: scales an image down to `resizeWidth` x `resizeHeight` and re-encodes it.
 * Other files, and images that cannot be decoded or encoded, are passed on unchanged.
 */
export function scaleBlob(
  file: Blob & { name?: string },
  o: ScaleOptions,
  done: (b: Blob) => void,
): void {
  if (!(o.resizeWidth || o.resizeHeight) || !looksLikeImage(file)) return done(file);
  decodeImage(file).then(
    (img) => {
      const canvas = renderScaled(
        img,
        { width: o.resizeWidth, height: o.resizeHeight },
        o.resizeMethod,
      );
      canvas.toBlob(
        (b) => done(b ?? file),
        o.resizeMimeType || file.type || 'image/jpeg',
        o.resizeQuality,
      );
    },
    () => done(file),
  );
}
