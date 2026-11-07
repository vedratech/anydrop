// MIME type guessed from the file extension, used only when `File.type` is empty (iOS gives an
// empty type for HEIC/HEIF photos; Windows for unregistered extensions). Kept small on purpose:
// the formats phones produce, plus a few common documents.

const TABLE =
  'heic:image/heic,heics:image/heic-sequence,heif:image/heif,heifs:image/heif-sequence,' +
  'avif:image/avif,webp:image/webp,jpg:image/jpeg,jpeg:image/jpeg,png:image/png,gif:image/gif,' +
  'bmp:image/bmp,tif:image/tiff,tiff:image/tiff,svg:image/svg+xml,dng:image/x-adobe-dng,' +
  'mov:video/quicktime,mp4:video/mp4,m4v:video/x-m4v,3gp:video/3gpp,webm:video/webm,' +
  'mp3:audio/mpeg,m4a:audio/mp4,aac:audio/aac,wav:audio/wav,pdf:application/pdf,' +
  'txt:text/plain,csv:text/csv,json:application/json,zip:application/zip';

let map: Map<string, string> | undefined;

/** `'IMG_0001.HEIC'` → `'image/heic'`; `''` when unknown. */
export function mimeFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  if (!map) {
    map = new Map();
    for (const pair of TABLE.split(',')) {
      const i = pair.indexOf(':');
      map.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  return map.get(name.slice(dot + 1).toLowerCase()) || '';
}
