import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type { AnyDropConfig } from '@vedratech/anydrop-ui';

/** The app-wide default options (see `provideAnyDrop`). */
export const ANYDROP_DEFAULTS = new InjectionToken<AnyDropConfig>('ANYDROP_DEFAULTS');

/**
 * Sets default options for every `<any-drop>` and every `AnyDropService` in the app. The options of
 * a component or service win over these defaults.
 *
 * @example
 * bootstrapApplication(App, { providers: [provideAnyDrop({ chunkSize: 4_000_000 })] });
 */
export function provideAnyDrop(defaults: AnyDropConfig): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: ANYDROP_DEFAULTS, useValue: defaults }]);
}
