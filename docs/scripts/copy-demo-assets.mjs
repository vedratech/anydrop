// Copies the built UI (the CDN/IIFE file and the stylesheet) into docs/public/demo so the live demo
// page runs the real library. Build the packages first (`pnpm build`).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
// Theme presets (dist/themes/*.css), used by the theme builder. Absent until the ui build makes them.
const themes = resolve(root, 'packages/ui/dist/themes');
if (existsSync(themes)) {
  mkdirSync(resolve(out, 'themes'), { recursive: true });
  for (const f of readdirSync(themes).filter((n) => n.endsWith('.css'))) {
    copyFileSync(resolve(themes, f), resolve(out, 'themes', f));
  }
}
console.log('Demo assets copied to docs/public/demo');
