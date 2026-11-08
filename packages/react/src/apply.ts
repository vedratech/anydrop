import { createOptionSync, type OptionSync } from './shared/options-sync';

declare const process: { env: { NODE_ENV?: string } };

/** Development only: construction-only options changed later. */
export function warnDev(message: string): void {
  if (process.env.NODE_ENV !== 'production' && typeof console !== 'undefined') {
    console.warn(message);
  }
}

interface Target {
  setOption(key: never, value: never): void;
}

/** Keeps one instance in line with the latest config (decision 0022, section 3). */
export function createApplier(
  config: Record<string, unknown>,
  defaults: () => Record<string, unknown>,
) {
  let latest = config;
  let applied = config;
  let target: Target | null = null;
  const sync: OptionSync = createOptionSync({ latest: () => latest, defaults, warn: warnDev });
  return {
    /** The config for the constructor. */
    initial: () => sync.initial(config),
    attach(t: unknown) {
      target = t as Target;
    },
    update(next: Record<string, unknown>) {
      latest = next;
      if (!target) return;
      for (const [key, value] of sync.changes(applied, next)) {
        target.setOption(key as never, value as never);
      }
      applied = next;
    },
  };
}
