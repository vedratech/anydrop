// UUID v4 (0002). Uses crypto.getRandomValues, which also works in insecure contexts
// (crypto.randomUUID needs https). Falls back to Math.random when crypto is missing.
// Globals are read at call time, never at import time.

export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += ((bytes[i] ?? 0) + 0x100).toString(16).slice(1);
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
  }
  return s;
}
