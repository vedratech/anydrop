import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against core source so `pnpm test` does not need core to be built first.
    alias: {
      // AD_CORE=dist tests against core's last build (useful while core's source is mid-change).
      '@vedratech/anydrop-core': fileURLToPath(
        new URL(
          process.env.AD_CORE === 'dist' ? '../core/dist/index.js' : '../core/src/index.ts',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
