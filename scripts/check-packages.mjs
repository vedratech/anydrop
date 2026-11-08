#!/usr/bin/env node
// Packaging checks from the npm-release skill: publint and are-the-types-wrong for each package,
// plus a dry-run of what would be packed. Run after `pnpm build`.
//   core, ui   the package folder
//   react      the package folder (decision 0022)
//   angular    packages/angular/dist, the folder that is published (publishConfig.directory). The ng-packagr
//              output is ESM only and its .d.ts files import siblings without a .js extension (Angular
//              Package Format), so attw runs with the esm-only profile and without internal-resolution-error.
//              The dist manifest must also carry the root package's name and version (changesets writes the
//              version to packages/angular/package.json, the build copies it into dist), and neither
//              `tslib` nor a `files` list.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgs = ['core', 'ui', 'react'].map((n) => join(root, 'packages', n));
let failed = false;

function run(label, cmd, args, cwd) {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    failed = true;
    console.error(`FAILED: ${label}`);
  }
  return r.status === 0;
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

// Angular: the published folder.
const ngDir = join(root, 'packages', 'angular');
const ngDist = join(ngDir, 'dist');
if (!existsSync(join(ngDist, 'package.json'))) {
  console.error(`${ngDist} is missing. Run "pnpm build" first.`);
  process.exit(1);
}
{
  console.log('\n> angular dist manifest');
  const source = JSON.parse(readFileSync(join(ngDir, 'package.json'), 'utf8'));
  const dist = JSON.parse(readFileSync(join(ngDist, 'package.json'), 'utf8'));
  const problems = [];
  if (dist.name !== source.name) problems.push(`name ${dist.name} != ${source.name}`);
  if (dist.version !== source.version) {
    problems.push(
      `version ${dist.version} != ${source.version} (build again after \`changeset version\`)`,
    );
  }
  if ((dist.private === true) !== (source.private === true)) {
    problems.push(
      `private ${dist.private} != ${source.private} (build again after changing "private")`,
    );
  }
  if (dist.dependencies && Object.keys(dist.dependencies).length) {
    problems.push(
      `dist has dependencies: ${Object.keys(dist.dependencies).join(', ')} (no runtime dependencies, decision 0022)`,
    );
  }
  if (dist.files) problems.push('dist/package.json has a "files" list (it would hide the build)');
  if (problems.length) {
    failed = true;
    console.error(`FAILED: angular dist manifest:\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`ok: ${dist.name}@${dist.version}`);
  }
}
run(`publint ${ngDist}`, 'pnpm', ['exec', 'publint', '--strict'], ngDist);
const tmp = mkdtempSync(join(tmpdir(), 'anydrop-ng-pack-'));
try {
  const pack = spawnSync('npm', ['pack', '--pack-destination', tmp, '--json'], {
    cwd: ngDist,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (pack.status !== 0) {
    failed = true;
    console.error(`FAILED: npm pack of ${ngDist}\n${pack.stdout}${pack.stderr}`);
  } else {
    const info = JSON.parse(pack.stdout)[0];
    console.log(
      `\n> npm pack ${ngDist}: ${info.filename}, ${info.files.length} files, ${info.size} bytes`,
    );
    const bad = info.files
      .map((f) => f.path)
      .filter((p) => /(^|\/)(src|test)\//.test(p) || (p.endsWith('.ts') && !p.endsWith('.d.ts')));
    if (bad.length) {
      failed = true;
      console.error(`FAILED: the tarball has source files: ${bad.join(', ')}`);
    }
    run(
      `attw ${info.filename} (esm-only)`,
      'pnpm',
      [
        'exec',
        'attw',
        join(tmp, info.filename),
        '--profile',
        'esm-only',
        '--ignore-rules',
        'internal-resolution-error',
      ],
      join(root, 'packages', 'react'),
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
