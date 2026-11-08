// Copies the built UI (the CDN/IIFE file and the stylesheet) into docs/public/demo so the live demo
// page runs the real library. Build the packages first (`pnpm build`).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(root, 'docs/public/demo');
const files = [
  ['packages/ui/dist/index.global.js', 'anydrop-ui.js'],
  ['packages/ui/dist/style.css', 'anydrop-ui.css'],
];
mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.error(`copy-demo-assets: ${src} is missing. Run "pnpm build" first.`);
    process.exit(1);
  }
  copyFileSync(src, resolve(out, to));
}
console.log('Demo assets copied to docs/public/demo');
