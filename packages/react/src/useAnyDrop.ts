import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnyDropCore, defaultOptions, type AnyDropCoreConfig } from '@vedratech/anydrop-core';
import { createApplier } from './apply';
import { useIsoLayoutEffect } from './AnyDrop';
import {
  SERVER_STATE,
  createStateStore,
  type AnyDropState,
  type AnyDropStateStore,
} from './shared/state-store';

const noopSubscribe = () => () => {};
const getServerState = () => SERVER_STATE;

/**
 * Headless AnyDrop: creates a core instance after mount and returns its observable state.
 * The state is `SERVER_STATE` and `instance` is `null` on the server and before mount.
 * Options changes go to `setOption()`; the instance is never recreated by a prop change.
 */
export function useAnyDrop(
  options: AnyDropCoreConfig = {},
): AnyDropState & { instance: AnyDropCore | null } {
  const [live, setLive] = useState<{ instance: AnyDropCore; store: AnyDropStateStore } | null>(
    null,
  );
  const optionsRef = useRef(options);
  const applierRef = useRef<ReturnType<typeof createApplier> | null>(null);

  useIsoLayoutEffect(() => {
    optionsRef.current = options;
    const applier = createApplier(
      { ...options } as Record<string, unknown>,
      () => defaultOptions() as unknown as Record<string, unknown>,
    );
    const instance = new AnyDropCore(applier.initial() as AnyDropCoreConfig);
    applier.attach(instance);
    applierRef.current = applier;
    const store = createStateStore(instance);
    setLive({ instance, store });
    return () => {
      applierRef.current = null;
      store.destroy();
      instance.destroy();
      setLive(null);
    };
  }, []);

  useIsoLayoutEffect(() => {
    optionsRef.current = options;
    applierRef.current?.update({ ...options } as Record<string, unknown>);
  });

  const subscribe = useMemo(() => (live ? live.store.subscribe : noopSubscribe), [live]);
  const getSnapshot = useMemo(() => (live ? live.store.getSnapshot : getServerState), [live]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerState);
  return { ...state, instance: live ? live.instance : null };
}
