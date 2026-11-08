import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'e2e/fixtures/generated/**',
      'e2e/.uploads/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      'test-results/**',
      'playwright-report/**',
      '.claude/**',
      'docs/api/generated/**',
      'docs/public/demo/**',
      'docs/.vitepress/cache/**',
      'docs/.vitepress/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.es2021 } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Library source must stay SSR-safe and ESM only.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'require', message: 'Use ESM imports.' }],
    },
  },
  {
    // Node scripts, tooling configs, the mock server and e2e tests run under Node.
    files: [
      '**/*.mjs',
      '**/*.mts',
      '**/*.config.{js,ts,mjs}',
      'scripts/**',
      'e2e/**/*.ts',
      'packages/*/tsup.config.ts',
      'packages/*/vitest.config.ts',
      'demo/vite.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['e2e/tests/**/*.ts'],
    rules: {
      // Playwright fixtures use an empty destructuring pattern: ({}, testInfo).
      'no-empty-pattern': 'off',
    },
  },
  {
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // CommonJS scripts (they must also run on Node 18): require() is the point.
    files: ['scripts/**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
