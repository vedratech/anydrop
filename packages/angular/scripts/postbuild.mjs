// ng-packagr always adds `"dependencies": { "tslib": ... }` to dist/package.json, even though the
// compiled code imports no helper (importHelpers is off, checked below). Decision 0022 section 6
// allows no tslib dependency, so remove it here and fail if the code does import tslib.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

for (const dir of ['fesm2022', 'esm2022']) {
  for (const f of readdirSync(join(dist, dir))) {
    if (!f.endsWith('.mjs')) continue;
    if (/from ['"]tslib['"]/.test(readFileSync(join(dist, dir, f), 'utf8'))) {
      console.error(`${dir}/${f} imports tslib: the package cannot drop the dependency.`);
      process.exit(1);
    }
  }
}

const file = join(dist, 'package.json');
const pkg = JSON.parse(readFileSync(file, 'utf8'));
if (pkg.dependencies) {
  delete pkg.dependencies.tslib;
  if (!Object.keys(pkg.dependencies).length) delete pkg.dependencies;
}
// ng-packagr copies the source `files` whitelist (it names `dist`) and `publishConfig.directory`; both are
// wrong inside the published folder itself, where everything is published.
delete pkg.files;
if (pkg.publishConfig) {
  delete pkg.publishConfig.directory;
  if (!Object.keys(pkg.publishConfig).length) delete pkg.publishConfig;
}
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('postbuild: cleaned dist/package.json (no tslib dependency, no files whitelist)');
