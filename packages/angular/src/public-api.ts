// Public API of @vedratech/anydrop-angular. Nothing here may touch `window` or `document` at import time.
export { AnyDropComponent, ANYDROP_IMPORTS } from './any-drop.component';
export {
  AnyDropFileTemplate,
  AnyDropFolderTemplate,
  AnyDropToolbarTemplate,
  AnyDropMessageTemplate,
  AnyDropErrorItemTemplate,
  type AnyDropSlotContext,
} from './templates';
export { AnyDropService } from './any-drop.service';
export { provideAnyDrop, ANYDROP_DEFAULTS } from './provide';
export type { AnyDropInstance } from './types';
export type { AnyDropEventPayloads, AnyDropEventPayload } from './shared/events-map';
export type { AnyDropState, AnyDropProgress } from './shared/state-store';
