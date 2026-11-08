// Fails when the public API in the built .d.ts files has no entry in the hand-written overview pages.
//
//   options   every property of AnyDropCoreOptions and AnyDropUIOptions (and the deprecated aliases)
//             needs a table row in api/options.md (first cell, in backticks)
//   methods   every public instance member and static of AnyDropCore and AnyDrop needs a heading in
//             api/methods.md; every runtime export of the two packages needs one there too
//   events    every key of AnyDropEvents needs a heading in api/events.md
//   errors    every KnownErrorCode needs a table row in api/error-codes.md
//   types     every exported type needs a heading in api/types.md (or a heading in the other pages)
//
// It reads packages/*/dist/index.d.ts, so build the packages first (`pnpm build`).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreDts = resolve(root, 'packages/core/dist/index.d.ts');
const uiDts = resolve(root, 'packages/ui/dist/index.d.ts');
for (const f of [coreDts, uiDts]) {
  if (!existsSync(f)) {
    console.error(`check-api-coverage: ${f} is missing. Run "pnpm build" first.`);
    process.exit(1);
  }
}

const page = (name) => readFileSync(resolve(root, 'docs/api', name), 'utf8').replace(/\r\n/g, '\n');
const pages = {
  options: page('options.md'),
  methods: page('methods.md'),
  events: page('events.md'),
  errors: page('error-codes.md'),
  types: page('types.md'),
};

/** Names in backticks in the first cell of every table row. */
function rowNames(md) {
  const names = new Set();
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1] ?? '';
    for (const m of cell.matchAll(/`([A-Za-z_][\w.]*)/g)) names.add(m[1].split('.').pop());
  }
  return names;
}
/** Names in backticks in every heading. */
function headingNames(md) {
  const names = new Set();
  let fence = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    if (fence || !/^#{2,4}\s/.test(line)) continue;
    for (const m of line.matchAll(/`([A-Za-z_][\w.]*)/g)) names.add(m[1].split('.').pop());
  }
  return names;
}

const program = ts.createProgram([coreDts, uiDts], {
  target: ts.ScriptTarget.ES2019,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2019.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

function exportsOf(file) {
  const sf = program.getSourceFile(file);
  const mod = checker.getSymbolAtLocation(sf);
  return checker.getExportsOfModule(mod).map((s) => {
    const real = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
    return { name: s.name, symbol: real };
  });
}
const coreExports = exportsOf(coreDts);
const uiExports = exportsOf(uiDts);
const find = (list, name) => {
  const hit = list.find((e) => e.name === name);
  if (!hit)
    throw new Error(`check-api-coverage: ${name} is not exported any more. Update this script.`);
  return hit.symbol;
};

const isHidden = (sym) => {
  if (sym.name.startsWith('_') || sym.name === 'constructor' || sym.name === 'prototype')
    return true;
  return (sym.declarations ?? []).some(
    (d) => ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected),
  );
};
const props = (type) =>
  checker
    .getPropertiesOfType(type)
    .filter((p) => !isHidden(p))
    .map((p) => p.name);
const instanceMembers = (cls) => props(checker.getDeclaredTypeOfSymbol(cls));
const staticMembers = (cls) => props(checker.getTypeOfSymbol(cls));

const problems = [];
function need(kind, where, names, have) {
  for (const n of [...new Set(names)].sort()) {
    if (!have.has(n)) problems.push(`${kind}: "${n}" has no entry in ${where}`);
  }
}

// Events: the keys of AnyDropEvents, which is also what the typed handlers use.
const eventNames = props(checker.getDeclaredTypeOfSymbol(find(coreExports, 'AnyDropEvents')));

// Options: core options, UI options (including the dict* texts), and the deprecated aliases that
// AnyDropCoreConfig accepts. Event handler props are documented on the events page.
const coreOpts = props(checker.getDeclaredTypeOfSymbol(find(coreExports, 'AnyDropCoreOptions')));
const uiOpts = props(checker.getDeclaredTypeOfSymbol(find(uiExports, 'AnyDropUIOptions')));
const configProps = props(checker.getDeclaredTypeOfSymbol(find(uiExports, 'AnyDropFullOptions')));
const deprecated = ['acceptedMimeTypes', 'renameFilename'];
const known = new Set([...coreOpts, ...uiOpts, ...eventNames, ...deprecated]);
const unexpected = configProps.filter((p) => !known.has(p));
if (unexpected.length)
  problems.push(`options: unexpected props in AnyDropFullOptions: ${unexpected.join(', ')}`);
need(
  'option',
  'docs/api/options.md',
  [...coreOpts, ...uiOpts, ...deprecated],
  rowNames(pages.options),
);

// Methods and properties of the two classes, plus their statics.
const coreClass = find(coreExports, 'AnyDropCore');
const uiClass = find(uiExports, 'AnyDrop');
const methodHeads = headingNames(pages.methods);
const instance = [...instanceMembers(coreClass), ...instanceMembers(uiClass)];
const statics = [...staticMembers(coreClass), ...staticMembers(uiClass)];
need('method/property', 'docs/api/methods.md', instance, methodHeads);
need('static', 'docs/api/methods.md', statics, methodHeads);

// Runtime exports of both packages (constants, functions, classes).
const runtime = [...coreExports, ...uiExports]
  .filter(
    (e) =>
      !(e.symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) ||
      e.symbol.flags & ts.SymbolFlags.Value,
  )
  .map((e) => e.name);
need('export', 'docs/api/methods.md', runtime, methodHeads);

// Events.
need('event', 'docs/api/events.md', eventNames, headingNames(pages.events));

// Error codes.
const codeType = checker.getDeclaredTypeOfSymbol(find(coreExports, 'KnownErrorCode'));
const codes = codeType.isUnion() ? codeType.types.map((t) => t.value) : [];
if (codes.length < 18)
  problems.push(`errors: expected 18 known codes, the d.ts has ${codes.length}`);
need('error code', 'docs/api/error-codes.md', codes, rowNames(pages.errors));

// Types: every exported interface and type alias.
const typeNames = [...coreExports, ...uiExports]
  .filter((e) => e.symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))
  .map((e) => e.name);
const typeHeads = new Set([
  ...headingNames(pages.types),
  ...headingNames(pages.events),
  ...headingNames(pages.methods),
]);
need('type', 'docs/api/types.md', typeNames, typeHeads);

const total = {
  options: coreOpts.length + uiOpts.length + deprecated.length,
  methods: instance.length,
  statics: statics.length,
  events: eventNames.length,
  codes: codes.length,
  types: typeNames.length,
};
if (problems.length) {
  console.error('API coverage check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(
  `API coverage OK: ${total.options} options, ${total.methods} members, ${total.statics} statics, ${total.events} events, ${total.codes} error codes, ${total.types} types.`,
);
