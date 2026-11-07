#!/usr/bin/env node
// Packaging checks from the npm-release skill: publint and are-the-types-wrong for each package,
// plus a dry-run of what would be packed. Run after `pnpm build`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgs = ['core', 'ui'].map((n) => join(root, 'packages', n));
let failed = false;

function run(label, cmd, args, cwd) {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    failed = true;
    console.error(`FAILED: ${label}`);
  }
}

for (const dir of pkgs) {
  if (!existsSync(join(dir, 'dist'))) {
    console.error(`${dir}/dist is missing. Run "pnpm build" first.`);
    process.exit(1);
  }
  run(`publint ${dir}`, 'pnpm', ['exec', 'publint', '--strict'], dir);
  // The CSS subpath is not a JS entry point, so attw cannot resolve it: exclude it.
  const attwArgs = ['exec', 'attw', '--pack', '.', '--profile', 'node16'];
  if (dir.endsWith('ui')) attwArgs.push('--exclude-entrypoints', './style.css');
  run(`attw ${dir}`, 'pnpm', attwArgs, dir);
  run(`npm pack --dry-run ${dir}`, 'npm', ['pack', '--dry-run'], dir);
}
process.exit(failed ? 1 : 0);
