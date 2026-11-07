#!/usr/bin/env node
// SSR import smoke test: the built packages must import in Node with no window and no document, as
// ESM and as CJS, without throwing, and must not create DOM globals. Runs on Node 18 and later
// (both packages declare engines.node >=18). Run after `pnpm build`.
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
assert.strictEqual(typeof window, 'undefined');
assert.strictEqual(typeof document, 'undefined');

(async () => {
  for (const pkg of ['core', 'ui']) {
    const dist = path.join(root, 'packages', pkg, 'dist');
    const esm = await import(pathToFileURL(path.join(dist, 'index.js')).href);
    const cjs = require(path.join(dist, 'index.cjs'));
    for (const [kind, m] of [
      ['esm', esm],
      ['cjs', cjs],
    ]) {
      assert.strictEqual(typeof m.VERSION, 'string', `${pkg} ${kind}: VERSION`);
      assert.ok(
        typeof m.AnyDropCore === 'function' || typeof m.AnyDrop === 'function',
        `${pkg} ${kind}: class export`,
      );
    }
    assert.strictEqual(typeof window, 'undefined', `${pkg}: no window created by the import`);
    assert.strictEqual(typeof document, 'undefined', `${pkg}: no document created by the import`);
  }
  console.log(`ssr-smoke ok on Node ${process.versions.node}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
