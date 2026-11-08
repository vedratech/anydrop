import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The CDN bundle compiles core's source, so core's version is injected here too (it is the
// version of AnyDrop.VERSION; core and ui are released together).
const { version } = JSON.parse(readFileSync('../core/package.json', 'utf8')) as { version: string };

const shared = {
  define: { __ANYDROP_VERSION__: JSON.stringify(version) },
  entry: ['src/index.ts'],
  target: 'es2019' as const,
  platform: 'browser' as const,
  sourcemap: false,
  treeshake: true,
};

export default defineConfig([
  {
    // npm builds: @vedratech/anydrop-core stays external (regular dependency).
    ...shared,
    format: ['esm', 'cjs'],
    dts: true,
    clean: false, // cleaned by the "build" script (the two configs run in parallel)
    async onSuccess() {
      // The stylesheet ships as a separate file: `@vedratech/anydrop-ui/style.css`.
      mkdirSync('dist', { recursive: true });
      copyFileSync('src/style.css', 'dist/style.css');
    },
  },
  {
    // CDN build: bundles core so a single <script> is enough. Global name: AnyDrop.
    ...shared,
    // The entry is cdn.ts (class global + auto-discover), emitted as dist/index.global.js.
    entry: { index: 'src/cdn.ts' },
    format: ['iife'],
    globalName: 'AnyDrop',
    // cdn.ts has only a default export, so the IIFE global is the class itself (decision 0014).
    // Do not add named exports to cdn.ts: they would turn the global into a namespace again.
    noExternal: ['@vedratech/anydrop-core'],
    minify: true,
    clean: false,
  },
]);
