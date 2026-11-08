import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// AD_PKG=dist runs the demo against the built packages (what ships). The e2e suite sets it, so
// edits to package sources by other people or agents cannot reload the page in the middle of a test.
const dist = process.env.AD_PKG === 'dist';

// The demo may run against core's source, so inject the version as the core build does.
const { version } = JSON.parse(
  readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __ANYDROP_VERSION__: JSON.stringify(version) },
  resolve: {
    // Default: run against package sources so the demo needs no prior build and hot-reloads edits.
    alias: [
      {
        find: '@vedratech/anydrop-ui/style.css',
        replacement: src(dist ? '../packages/ui/dist/style.css' : '../packages/ui/src/style.css'),
      },
      {
        find: '@vedratech/anydrop-ui',
        replacement: src(dist ? '../packages/ui/dist/index.js' : '../packages/ui/src/index.ts'),
      },
      {
        find: '@vedratech/anydrop-core',
        // AD_CORE=dist runs against core's last build (while core's source is mid-change).
        replacement: src(
          dist || process.env.AD_CORE === 'dist'
            ? '../packages/core/dist/index.js'
            : '../packages/core/src/index.ts',
        ),
      },
    ],
  },
  server: {
    host: true,
    // No file watching and no hot reload under e2e: a test page must never reload by itself.
    ...(dist ? { hmr: false, watch: null } : {}),
  },
});
