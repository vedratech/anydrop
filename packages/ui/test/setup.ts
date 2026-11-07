import 'fake-indexeddb/auto';

// happy-dom has no drag and drop; pretend it does so the desktop layout is the default.
if (typeof HTMLElement !== 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'draggable', {
    value: false,
    configurable: true,
    writable: true,
  });
}
