import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
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

// One entry per language pack in src/locales/<code>.ts (the code is the file name, for example pt-BR).
const locales = readdirSync('src/locales')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.slice(0, -3));
const localeEntries = Object.fromEntries(
  locales.map((l) => [`locales/${l}`, `src/locales/${l}.ts`]),
);

/**
 * The CDN file of a language pack: the same source plus one line that registers it as
 * `AnyDrop.locales['<code>']` (the exported name is the code without the hyphen: pt-BR -> ptBR).
 */
const registerLocale = {
  name: 'register-locale',
  setup(build: {
    onLoad(
      opts: { filter: RegExp },
      cb: (a: { path: string }) => Promise<{ contents: string; loader: 'ts' }>,
    ): void;
  }) {
    build.onLoad({ filter: /[\\/]locales[\\/][^\\/]+\.ts$/ }, async ({ path }) => {
      const code = basename(path, '.ts');
      const source = readFileSync(path, 'utf8');
      return {
        loader: 'ts',
        contents:
          source +
          `
(function (g) {
  if (!g.AnyDrop) throw new Error('Load AnyDrop before its locale files.');
  g.AnyDrop.locales[${JSON.stringify(code)}] = ${code.replace(/-/g, '')};
})(typeof window !== 'undefined' ? window : globalThis);
`,
      };
    });
  },
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
      // Theme presets: `@vedratech/anydrop-ui/themes/<name>.css`.
      mkdirSync('dist/themes', { recursive: true });
      for (const f of readdirSync('src/themes'))
        copyFileSync(`src/themes/${f}`, `dist/themes/${f}`);
    },
  },
  {
    // Language packs for npm: dist/locales/<code>.js, .cjs and types. No runtime imports.
    ...shared,
    entry: localeEntries,
    format: ['esm', 'cjs'],
    dts: false,
    clean: false,
    async onSuccess() {
      // The types are one line each, taken from the main entry (no shared chunk to re-export).
      for (const l of locales) {
        const id = l.replace(/-/g, '');
        for (const [ext, from] of [
          ['d.ts', 'index.js'],
          ['d.cts', 'index.cjs'],
        ]) {
          writeFileSync(
            `dist/locales/${l}.${ext}`,
            `import type { AnyDropLocale } from '../${from}';
declare const ${id}: AnyDropLocale;
export { ${id}, ${id} as default };
`,
          );
        }
      }
    },
  },
  {
    // Language packs for the CDN: dist/locales/<code>.global.js (load after the main script).
    ...shared,
    entry: localeEntries,
    format: ['iife'],
    minify: true,
    clean: false,
    esbuildPlugins: [registerLocale],
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
