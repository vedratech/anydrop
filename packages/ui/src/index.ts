/**
 * The plain-JavaScript AnyDrop UI: drop zone, folder tree and mobile layout on top of the core.
 *
 * @module anydrop-ui
 */
// Public API of @vedratech/anydrop-ui. Nothing here may touch `window` or `document` at import time.
export { VERSION } from '@vedratech/anydrop-core';
export { AnyDrop } from './AnyDrop';
export { uiDefaults, DEFAULT_TEMPLATE } from './options';
export type {
  AnyDropConfig,
  AnyDropDict,
  AnyDropFullOptions,
  AnyDropUIOptions,
  ElementRef,
} from './options';
export type { MockFile } from './preview';
