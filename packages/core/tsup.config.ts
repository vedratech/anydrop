import { defineConfig } from 'tsup';

const shared = {
  entry: ['src/index.ts'],
  target: 'es2019' as const,
  platform: 'neutral' as const,
  sourcemap: false,
  treeshake: true,
  clean: false, // cleaned by the "build" script (the two configs run in parallel)
};

export default defineConfig([
  {
    // npm builds: readable ESM and CJS plus .d.ts / .d.cts.
    ...shared,
    format: ['esm', 'cjs'],
    // @internal members (_uuid, _random, tree, errors, ...) stay out of the public types.
    dts: { compilerOptions: { stripInternal: true } },
  },
  {
    // CDN build: minified IIFE. Global name differs from the UI package so both can share a page.
    ...shared,
    format: ['iife'],
    globalName: 'AnyDropCore',
    minify: true,
  },
]);
