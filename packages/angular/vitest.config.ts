import { defineConfig } from 'vitest/config';

// Tests run the sources in JIT mode (decorators are transformed by Vite, templates are compiled
// by @angular/compiler at run time). The package build itself uses AOT partial compilation.
export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.ts'],
  },
});
