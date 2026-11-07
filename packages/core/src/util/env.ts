// Runtime helpers. Globals are read when called, never at import time (SSR-safe).

/** Reports an error from user code (a listener or callback) without breaking the caller. */
export function reportError(error: unknown): void {
  const g = globalThis as { reportError?: (e: unknown) => void };
  if (typeof g.reportError === 'function') g.reportError(error);
  // Node and old browsers: log instead of rethrowing (an uncaught exception would end a Node process).
  else if (typeof console !== 'undefined') console.error(error);
}

/** `console.warn` where a console exists. */
export function warn(message: string, ...rest: unknown[]): void {
  if (typeof console !== 'undefined') console.warn('[anydrop] ' + message, ...rest);
}

/** Lets the browser render and handle input between two slices of work. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
