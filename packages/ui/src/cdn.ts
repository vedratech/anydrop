// Entry of the CDN build (`dist/index.global.js`), the only file with a top-level side effect (0014).
// `window.AnyDrop` is the class itself, as `window.Dropzone` is; the other exports are statics on it.
// The npm builds (`src/index.ts`) never run any of this.
import { AnyDropCore } from '@vedratech/anydrop-core';
import { AnyDrop } from './AnyDrop';
import { DEFAULT_TEMPLATE, uiDefaults } from './options';

const statics: Record<string, unknown> = {
  AnyDrop,
  AnyDropCore,
  VERSION: AnyDropCore.version,
  uiDefaults,
  DEFAULT_TEMPLATE,
};
const target = AnyDrop as unknown as Record<string, unknown>;
// An existing static is never overwritten.
for (const k in statics) if (!(k in target)) target[k] = statics[k];

if (typeof document !== 'undefined') {
  const discover = () => {
    if (AnyDrop.autoDiscover) AnyDrop.discover();
  };
  // A <script> right after ours can still set `AnyDrop.autoDiscover = false` or fill `AnyDrop.options`.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', discover);
  else setTimeout(discover, 0);
}

export default AnyDrop;
