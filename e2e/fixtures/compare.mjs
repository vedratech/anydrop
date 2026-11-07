#!/usr/bin/env node
/**
 * Compare two directory trees: same relative paths, sizes, SHA-256 and (empty) folders.
 *   pnpm compare <expectedDir> <actualDir>
 * Example: pnpm compare e2e/fixtures/generated/tree e2e/.uploads/<sessionId>/tree
 */
import { resolve } from 'node:path';
import { diffTrees, walkTree } from './lib.mjs';

const [expectedDir, actualDir] = process.argv.slice(2);
if (!expectedDir || !actualDir) {
  console.error('Usage: pnpm compare <expectedDir> <actualDir>');
  process.exit(2);
}
const [a, b] = await Promise.all([walkTree(resolve(expectedDir)), walkTree(resolve(actualDir))]);
const diffs = diffTrees(a, b);
if (diffs.length === 0) {
  console.log(
    `OK: ${a.files.length} files and ${a.folders.length} folders match (paths, sizes, SHA-256).`,
  );
} else {
  console.error(`FAIL: ${diffs.length} difference(s)`);
  for (const d of diffs.slice(0, 25)) console.error('  ' + d);
  if (diffs.length > 25) console.error(`  ... and ${diffs.length - 25} more`);
  process.exit(1);
}
