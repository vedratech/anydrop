import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Core and ui run from source so `pnpm test` needs no build. The version is injected as the builds do.
const { version } = JSON.parse(readFileSync('../core/package.json', 'utf8')) as { version: string };
const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  define: { __ANYDROP_VERSION__: JSON.stringify(version) },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@vedratech/anydrop-core': src('../core/src/index.ts'),
      '@vedratech/anydrop-ui': src('../ui/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
