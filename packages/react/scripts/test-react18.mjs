// Runs the unit tests against React 18.3. The workspace has React 19, so React 18 and its
// Testing Library are installed once into node_modules/.react18 (not a dependency of the package).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(pkg, 'node_modules', '.react18');
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, {
    cwd: pkg,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });

if (!existsSync(join(dir, 'node_modules', 'react-dom'))) {
  const r = run('npm', [
    'install',
    '--no-save',
    '--no-package-lock',
    '--prefix',
    JSON.stringify(dir),
    'react@18.3.1',
    'react-dom@18.3.1',
    '@testing-library/react@16',
    '@testing-library/dom@10',
  ]);
  if (r.status) process.exit(r.status);
}
const t = run('npx', ['vitest', 'run', '--config', 'vitest.react18.config.ts'], {
  AD_REACT18_DIR: join(dir, 'node_modules'),
});
process.exit(t.status ?? 1);
