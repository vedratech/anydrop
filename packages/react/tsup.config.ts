import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2019',
  platform: 'neutral',
  sourcemap: false,
  clean: false,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@vedratech/anydrop-core',
    '@vedratech/anydrop-ui',
  ],
  banner: { js: "'use client';" },
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
