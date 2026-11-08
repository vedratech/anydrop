/**
 * Replaced at build time with the `version` of packages/core/package.json (tsup `define` in core
 * and ui, `define` in the vitest and demo configs), so a release bump cannot leave it stale.
 */
declare const __ANYDROP_VERSION__: string | undefined;

/** Library version, equal to the `version` in packages/core/package.json. */
export const VERSION: string =
  typeof __ANYDROP_VERSION__ === 'string' ? __ANYDROP_VERSION__ : '0.0.0-dev';
