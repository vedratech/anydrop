// Copies wrappers-shared/*.ts into packages/react/src/shared and packages/angular/src/shared
// (decision 0022, section 1.3). The copies are committed. `--check` fails on any drift.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'wrappers-shared');
const targets = ['react', 'angular'].map((p) => join(root, 'packages', p, 'src', 'shared'));
const check = process.argv.includes('--check');

const norm = (s) => s.replace(/\r\n/g, '\n');
const files = readdirSync(source).filter((f) => f.endsWith('.ts'));
let drift = 0;

for (const dir of targets) {
  for (const file of files) {
    const header = `// GENERATED from wrappers-shared/${file} by scripts/sync-wrapper-shared.mjs. Do not edit.\n`;
    const expected = header + norm(readFileSync(join(source, file), 'utf8'));
    const target = join(dir, file);
    const current = existsSync(target) ? norm(readFileSync(target, 'utf8')) : null;
    if (current === expected) continue;
    if (check) {
      drift++;
      console.error(`drift: ${target} differs from wrappers-shared/${file}`);
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, expected);
      console.log(`wrote ${target}`);
    }
  }
}

if (check) {
  if (drift) {
    console.error('Run: node scripts/sync-wrapper-shared.mjs');
    process.exit(1);
  }
  console.log('wrapper-shared copies are in sync.');
}
