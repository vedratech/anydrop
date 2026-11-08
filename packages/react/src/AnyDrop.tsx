import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  createElement,
  Fragment,
} from 'react';
import { defaultOptions } from '@vedratech/anydrop-core';
import { AnyDrop as AnyDropUI, uiDefaults } from '@vedratech/anydrop-ui';
import { createApplier } from './apply';
import { EVENT_LIST, toPayload } from './shared/events-map';
import { SLOT_KINDS, SLOT_PROPS, SlotStore, Slots } from './slots';
import type { AnyDropInstance, AnyDropProps } from './types';

type Bag = Record<string, unknown>;

/** `useLayoutEffect` in the browser, `useEffect` on the server (no React 18 server warning). */
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const DEDICATED = ['url', 'locale', 'themePreset', 'layout'] as const;
const PROP_NAME: Record<string, string> = {};
for (const name of EVENT_LIST)
  PROP_NAME[name] = 'on' + name.charAt(0).toUpperCase() + name.slice(1);

const defaults = (): Bag => ({ ...defaultOptions(), ...uiDefaults() }) as Bag;

interface Live {
  instance: AnyDropInstance;
  applier: ReturnType<typeof createApplier>;
  subs: Record<string, () => void>;
  disabled: boolean;
}

/**
 * Folder upload zone. The instance is created after mount and destroyed on unmount; prop changes
 * go to `setOption()` and never recreate it. The ref holds the instance (`null` on the server).
 */
export const AnyDrop = forwardRef<AnyDropInstance | null, AnyDropProps>(
  function AnyDrop(props, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef(props);
    const liveRef = useRef<Live | null>(null);
    const [store] = useState(() => new SlotStore());

    /** The effective config of decision 0022, section 3.1. */
    const compose = (p: AnyDropProps): Bag => {
      const config: Bag = { ...(p.options as Bag | undefined) };
      for (const k of DEDICATED) if (p[k] !== undefined) config[k] = p[k];
      let render: Bag | null = null;
      for (const kind of SLOT_KINDS) {
        if (p[SLOT_PROPS[kind]] === undefined) continue;
        render = render || { ...(config.render as Bag | undefined) };
        render[kind] = hooks[kind];
      }
      if (render) config.render = render;
      return config;
    };
    // Stable hook functions: the same identity on every render, so only presence changes the config.
    const [hooks] = useState(() => {
      const h = {} as Record<(typeof SLOT_KINDS)[number], (ctx: unknown) => unknown>;
      for (const kind of SLOT_KINDS) h[kind] = store.hook(kind);
      return h;
    });

    /** One core listener per `on*` prop that is defined; the handler is read from `propsRef`. */
    const syncEvents = (live: Live) => {
      for (const name of EVENT_LIST) {
        const wanted = typeof (propsRef.current as Bag)[PROP_NAME[name] as string] === 'function';
        const has = !!live.subs[name];
        if (wanted && !has) {
          live.subs[name] = (
            live.instance.on as (n: string, f: (...a: unknown[]) => void) => () => void
          )(name, (...args) => {
            const f = (propsRef.current as Bag)[PROP_NAME[name] as string];
            if (typeof f === 'function') {
              (f as (p: unknown) => void)(
                (toPayload as (n: string, a: unknown) => unknown)(name, args),
              );
            }
          });
        } else if (!wanted && has) {
          (live.subs[name] as () => void)();
          delete live.subs[name];
        }
      }
    };

    // Mount: create the instance; cleanup: destroy it. StrictMode: create A, destroy A, create B.
    useIsoLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      store.revive();
      propsRef.current = props;
      const applier = createApplier(compose(props), defaults);
      const instance = new AnyDropUI(host, applier.initial() as never);
      applier.attach(instance);
      const live: Live = { instance, applier, subs: {}, disabled: false };
      liveRef.current = live;
      if (props.disabled) {
        instance.disable();
        live.disabled = true;
      }
      syncEvents(live);
      return () => {
        liveRef.current = null;
        for (const off of Object.values(live.subs)) off();
        live.subs = {};
        instance.destroy();
        store.dispose();
      };
    }, []);

    useImperativeHandle(ref, () => liveRef.current?.instance as AnyDropInstance, []);

    // After every commit: diff the effective config and apply what changed.
    useIsoLayoutEffect(() => {
      propsRef.current = props;
      const live = liveRef.current;
      if (!live) return;
      live.applier.update(compose(props));
      const disabled = !!props.disabled;
      if (disabled !== live.disabled) {
        if (disabled) live.instance.disable();
        else live.instance.enable();
        live.disabled = disabled;
      }
      syncEvents(live);
    });

    return createElement(
      Fragment,
      null,
      createElement(
        'div',
        { id: props.id, className: props.className, style: props.style },
        createElement('div', { ref: hostRef }),
      ),
      createElement(Slots, { store, props }),
    );
  },
);
