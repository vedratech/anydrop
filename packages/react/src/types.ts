import type { CSSProperties, ReactNode } from 'react';
import type { AnyDropEventName } from '@vedratech/anydrop-core';
import type {
  AnyDrop,
  AnyDropConfig,
  AnyDropErrorItemContext,
  AnyDropFileContext,
  AnyDropFolderContext,
  AnyDropMessageContext,
  AnyDropToolbarContext,
} from '@vedratech/anydrop-ui';
import type { AnyDropEventPayloads } from './shared/events-map';

/** The ui instance (what the ref of `<AnyDrop>` holds). */
export type AnyDropInstance = AnyDrop;

/** One `on<Event>` prop per core event: `onAddedfile`, `onUploadprogress`, `onErrorlistchanged`, ... */
export type AnyDropEventProps = {
  [K in AnyDropEventName as `on${Capitalize<K>}`]?: (payload: AnyDropEventPayloads[K]) => void;
};

/** The render slots: each replaces the default content of its part and mounts real React components. */
export interface AnyDropSlotProps {
  /** One file row. */
  renderFile?: (ctx: AnyDropFileContext) => ReactNode;
  /** One folder row. */
  renderFolder?: (ctx: AnyDropFolderContext) => ReactNode;
  /** The toolbar. */
  renderToolbar?: (ctx: AnyDropToolbarContext) => ReactNode;
  /** The drop message (and empty state). */
  renderMessage?: (ctx: AnyDropMessageContext) => ReactNode;
  /** One row of the error panel. */
  renderErrorItem?: (ctx: AnyDropErrorItemContext) => ReactNode;
}

export interface AnyDropProps extends AnyDropEventProps, AnyDropSlotProps {
  /** The full config. Replace the object to change options; mutation is not detected. */
  options?: AnyDropConfig;
  /** Overrides `options.url` when not `undefined`. */
  url?: AnyDropConfig['url'];
  /** Overrides `options.locale` when not `undefined`. */
  locale?: AnyDropConfig['locale'];
  /** Overrides `options.themePreset` when not `undefined`. */
  themePreset?: AnyDropConfig['themePreset'];
  /** Overrides `options.layout` when not `undefined`. */
  layout?: AnyDropConfig['layout'];
  /** Calls `disable()` / `enable()`. */
  disabled?: boolean;
  /** `id` of the outer element. */
  id?: string;
  /** `className` of the outer element. */
  className?: string;
  /** `style` of the outer element. */
  style?: CSSProperties;
}
