import { join } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Same tests against React 18.3: `scripts/test-react18.mjs` installs it and sets AD_REACT18_DIR.
const dir = process.env.AD_REACT18_DIR;
if (!dir) throw new Error('Run this config with `pnpm test:react18` (it installs React 18).');
const at = (name: string) => join(dir, name);

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        { find: /^react\/(.*)$/, replacement: `${at('react')}/$1` },
        { find: /^react$/, replacement: at('react') },
        { find: /^react-dom\/(.*)$/, replacement: `${at('react-dom')}/$1` },
        { find: /^react-dom$/, replacement: at('react-dom') },
        { find: /^@testing-library\/react$/, replacement: at('@testing-library/react') },
        { find: /^@testing-library\/dom$/, replacement: at('@testing-library/dom') },
      ],
    },
  }),
);
