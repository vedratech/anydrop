import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// The SSR test runs in the node environment, where there is no DOM at all.
if (typeof HTMLElement !== 'undefined') {
  // happy-dom has no drag and drop; pretend it does so the desktop layout is the default.
  Object.defineProperty(HTMLElement.prototype, 'draggable', {
    value: false,
    configurable: true,
    writable: true,
  });
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    document.body.innerHTML = '';
  });
}
