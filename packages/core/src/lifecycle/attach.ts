// Browser lifecycle (0008). Every browser listener of core is added here, through one attach()
// that returns its detach(), which destroy() calls (0009). Globals are read only when called,
// never at import time (SSR-safe); without `window`/`document` nothing is attached.

export interface LifecycleHandlers {
  online(): void;
  offline(): void;
  /** `visibilitychange`, with whether the page is now hidden. */
  visibility(hidden: boolean): void;
  pagehide(): void;
  /** `pageshow`, also when the page comes back from the bfcache. */
  pageshow(): void;
}

type Target = { addEventListener?: EventTarget['addEventListener'] } & Partial<EventTarget>;

export function attach(h: LifecycleHandlers): () => void {
  const w = (typeof window !== 'undefined' ? window : null) as Target | null;
  const d = typeof document !== 'undefined' ? document : null;
  const list: [Target | null, string, () => void][] = [
    [w, 'online', h.online],
    [w, 'offline', h.offline],
    [w, 'pagehide', h.pagehide],
    [w, 'pageshow', h.pageshow],
    [d, 'visibilitychange', () => h.visibility(!!d && d.visibilityState === 'hidden')],
  ];
  const each = (add: boolean): void =>
    list.forEach(([t, name, fn]) => {
      if (t && t.addEventListener && t.removeEventListener) {
        if (add) t.addEventListener(name, fn);
        else t.removeEventListener(name, fn);
      }
    });
  each(true);
  return () => each(false);
}

/** `navigator.onLine === false` (feature-detected; `true` is not trusted, only `false` is). */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
