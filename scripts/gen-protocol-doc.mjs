// Generates docs/protocol.md from .claude/skills/upload-protocol/SKILL.md (the single source of
// truth). Run: node scripts/gen-protocol-doc.mjs
// Removes the skill front matter and internal decision numbers, which do not belong in published docs.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('.claude/skills/upload-protocol/SKILL.md', 'utf8').replace(/\r\n/g, '\n');
let body = src.replace(/^---\n[\s\S]*?\n---\n/, '');

// Replace the maintainers' section with a note for readers.
body = body.replace(/## Changing the protocol[\s\S]*?(?=## Changelog)/, '');

// Decision references: "(Decisions 0003, 0004.)", "(v1.3, decision 0016.)", "; decision 0013", ", decision 0019".
body = body
  .replace(/ \((?:v[\d.]+, )?[Dd]ecisions? [\d, and]+\.?\)/g, '')
  .replace(/\((v[\d.]+(?: addendum)?), [Dd]ecisions? [\d, and]+\)/g, '($1)')
  .replace(/[;,] [Dd]ecisions? [\d, and]+(?=[).,;])/g, '')
  .replace(/ ?\([Dd]ecision \d{4}\)/g, '')
  .replace(/ Decisions? \d{4}(?:, \d{4})*\.?/g, '')
  .replace(/\(([^()]*?), ?decision \d{4}\)/g, '($1)')
  .replace(/\(decision \d{4}; /g, '(');

// Changelog lines: drop the author and the day, keep the version and the text.
body = body.replace(/^- \*\*(v[\d.]+(?: addendum)?) \([^)]*\):\*\*/gm, '- **$1:**');

const left = body.match(/[Dd]ecisions? \d{4}/g);
if (left) throw new Error('decision references left: ' + left.join(', '));

const head = `# AnyDrop backend contract (protocol v1.4)

> This page is generated from the project's protocol specification. AnyDrop ships no server: you implement this contract in your own backend ([Express](/backend/express) and [Laravel](/backend/laravel) examples, and a [backend overview](/backend/)). Client packages: \`@vedratech/anydrop-core\` ([guide](/guide/headless-core)) and \`@vedratech/anydrop-ui\` ([guide](/guide/quick-start)).

`;
body = body.replace(
  /^\s*# anydrop wire protocol \(v1\.4\)\n\n> Frontend-only project:[^\n]*\n\n/,
  '',
);
if (/Frontend-only project/.test(body)) throw new Error('intro not removed');
writeFileSync('docs/protocol.md', head + body.replace(/\n{3,}/g, '\n\n'));
console.log('docs/protocol.md written');
