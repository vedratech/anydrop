import { act } from '@testing-library/react';
import type { AnyDropCore } from '@vedratech/anydrop-core';

export const file = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'text/plain' });

/** Lets the ui paint its frame and React flush the batched slot commit. */
export const paint = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });

/** Total core listeners of an instance (every event). */
export const listenerCount = (instance: AnyDropCore): number => {
  const cb = (instance as unknown as { _callbacks: Record<string, unknown[]> })._callbacks;
  return Object.values(cb).reduce((n, l) => n + l.length, 0);
};

/** `destroyed` is private in core; tests read it anyway. */
export const isDestroyed = (instance: AnyDropCore): boolean =>
  (instance as unknown as { destroyed: boolean }).destroyed;
