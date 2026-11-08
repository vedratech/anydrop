// Copies the built package (packages/angular/dist) into ./vendor/anydrop-angular and maps
// `@vedratech/anydrop-angular` to it (tsconfig `paths`). Why: inside this workspace the package's own
// folder resolves `@angular/core` to the Angular 18 used to build it, and the app uses the latest
// Angular, so the copy makes the app resolve a single Angular. A real consumer needs none of this.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, '..', '..', 'packages', 'angular', 'dist');
if (!existsSync(join(dist, 'package.json'))) {
  console.error(
    'packages/angular/dist is missing: run `pnpm --filter @vedratech/anydrop-angular build` first.',
  );
  process.exit(1);
}
const target = join(root, 'vendor', 'anydrop-angular');
rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(dist, target, { recursive: true });
console.log('vendored packages/angular/dist -> examples/angular/vendor/anydrop-angular');
