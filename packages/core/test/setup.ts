// Provides IndexedDB in the happy-dom test environment (the resume store, M3). Every test gets a
// fresh, empty database, so resume records never leak from one test into another.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach } from 'vitest';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
