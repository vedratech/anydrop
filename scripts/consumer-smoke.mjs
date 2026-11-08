#!/usr/bin/env node
// Fresh-consumer smoke test (M6 done-when, "a fresh Vite app and a plain HTML page using the CDN
// both install and work"). Never publishes anything.
//
//   1. `pnpm pack` @vedratech/anydrop-core and @vedratech/anydrop-ui into a temp directory OUTSIDE the repo.
//   2. A minimal Vite app (also outside the repo) installs the two tarballs with npm, imports
//      `@vedratech/anydrop-ui` + `@vedratech/anydrop-ui/style.css`, is built with `vite build` and served with `vite preview`.
//   3. A plain HTML page loads the IIFE (`dist/index.global.js`, what unpkg/jsDelivr would serve) from the
//      installed tarball with a <script> tag and the CSS with a <link>, using the documented `.anydrop` markup.
//   4. Both pages run in Chromium (Playwright from this repo) against the test mock server: a file is
//      picked, uploaded, and the mock server must hold it with the right SHA-256.
//
//   5. Decision 0021 (customisation): the Vite app also imports a locale (`locales/hi`) and a theme file
//      (`themes/glass.css`) from the tarball and uses them; Node imports and requires a locale; the
//      theme CSS path resolves; and TypeScript (5.x from npm, and the repo's) resolves the types of
//      `@vedratech/anydrop-ui/locales/hi` with moduleResolution bundler, node16 (ESM and CJS) and node10.
//      node10 ignores `exports`; if it fails, the smoke test tries the `typesVersions` snippet in the temp
//      copy and prints it (package.json itself is never changed by this script).
//
// Usage (after `pnpm build`): node scripts/consumer-smoke.mjs [--keep]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const requireFromRoot = createRequire(join(ROOT, 'package.json'));
const log = (m) => console.log(`[consumer-smoke] ${m}`);
const win = process.platform === 'win32';

function run(cmd, args, cwd, extra = {}) {
  log(`$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: win,
    ...extra,
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${r.status}`);
  }
  return r.stdout;
}

// Runs node itself without a shell (a path with spaces, and quotes inside -e code, survive on Windows).
function runNode(args, cwd) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `node ${args.slice(0, 2).join(' ')} ... failed: ${(r.stdout + r.stderr).trim()}`,
    );
  }
  return r.stdout;
}

for (const p of ['core', 'ui']) {
  if (!existsSync(join(ROOT, 'packages', p, 'dist', 'index.js'))) {
    throw new Error(`packages/${p}/dist is missing. Run "pnpm build" first.`);
  }
}

const work = await mkdtemp(join(tmpdir(), 'anydrop-consumer-'));
const results = [];
let failed = false;
const servers = [];
try {
  // 1. Tarballs, exactly what would be published.
  const tarDir = join(work, 'tarballs');
  await mkdir(tarDir);
  for (const p of ['core', 'ui']) {
    run('pnpm', ['pack', '--pack-destination', tarDir], join(ROOT, 'packages', p));
  }
  const tarballs = (await readdir(tarDir))
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => join(tarDir, f));
  if (tarballs.length !== 2) throw new Error(`expected 2 tarballs, got ${tarballs.length}`);
  log(`packed: ${tarballs.map((t) => t.split(/[\\/]/).pop()).join(', ')}`);

  // 2. Vite app.
  const app = join(work, 'vite-app');
  await mkdir(join(app, 'src'), { recursive: true });
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'consumer-vite-app',
        private: true,
        type: 'module',
        scripts: { build: 'vite build' },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(app, 'index.html'),
    `<!doctype html><html><body><div id="zone"></div><script type="module" src="/src/main.js"></script></body></html>`,
  );
  await writeFile(
    join(app, 'src', 'main.js'),
    `import { AnyDrop, VERSION } from '@vedratech/anydrop-ui';
import { hi } from '@vedratech/anydrop-ui/locales/hi';
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/glass.css';
const mock = new URLSearchParams(location.search).get('mock');
window.__version = VERSION;
const zone = new AnyDrop('#zone', { url: mock + '/upload', chunking: true, chunkSize: 4096, forceChunking: true, hiddenInputContainer: '#zone', locale: hi, themePreset: 'glass' });
window.__custom = () => {
  const z = document.querySelector('#zone');
  return { lang: z.getAttribute('lang'), glass: z.classList.contains('ad-theme-glass'), backdrop: getComputedStyle(z).getPropertyValue('--ad-backdrop').trim(), message: z.querySelector('.ad-message')?.textContent, hi: hi.dict.dictDefaultMessage };
};
window.__uploaded = [];
zone.on('success', (f) => window.__uploaded.push(f.name));
`,
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--silent',
      ...tarballs.map((t) => t),
      'vite',
      'typescript@5',
    ],
    app,
  );
  run('npx', ['vite', 'build'], app);

  // 3. Plain HTML page with the CDN file from the installed package.
  const plain = join(work, 'plain');
  await mkdir(plain);
  const uiDist = join(app, 'node_modules', '@vedratech', 'anydrop-ui', 'dist');
  await cp(join(uiDist, 'index.global.js'), join(plain, 'anydrop.js'));
  await cp(join(uiDist, 'style.css'), join(plain, 'anydrop.css'));
  await writeFile(
    join(plain, 'index.html'),
    `<!doctype html><html><head><link rel="stylesheet" href="anydrop.css"></head><body>
<form id="smoke-zone" class="anydrop"></form>
<script src="anydrop.js"></script>
<script>
  // The documented markup and an options preset by element id, nothing else.
  var mock = new URLSearchParams(location.search).get('mock');
  document.getElementById('smoke-zone').action = mock + '/upload';
  AnyDrop.options.smokeZone = { paramName: 'file', maxFilesize: 2 };
  window.__uploaded = [];
  AnyDrop.discover()[0].on('success', function (f) { window.__uploaded.push(f.name); });
</script></body></html>`,
  );

  // 4. Serve both, run in Chromium against the mock server.
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
  };
  const serveDir = (dir) =>
    new Promise((resolve) => {
      const s = createServer(async (req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = join(dir, p);
        if (!file.startsWith(dir) || !existsSync(file) || !(await stat(file)).isFile()) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
      });
      s.listen(0, () => resolve(s));
      servers.push(s);
    });
  const viteServer = await serveDir(join(app, 'dist'));
  const plainServer = await serveDir(plain);

  const { createMockServer } = await import(
    pathToFileURL(join(ROOT, 'e2e', 'mock-server', 'server.mjs')).href
  );
  const uploadDir = await mkdtemp(join(tmpdir(), 'anydrop-consumer-up-'));
  const mockServer = createMockServer({ port: 0, uploadDir, log: false });
  const mockPort = await mockServer.start();
  servers.push({ close: (cb) => mockServer.close().then(cb) });
  const mockUrl = `http://localhost:${mockPort}`;

  const { chromium } = requireFromRoot('@playwright/test');
  const browser = await chromium.launch();
  try {
    const payload = Buffer.from('consumer smoke '.repeat(1000)); // 15,000 bytes: 4 chunks in the Vite app
    const sha = createHash('sha256').update(payload).digest('hex');
    const cases = [
      [
        'vite-app (npm tarballs, vite build)',
        viteServer,
        'body > input[data-ad-input=files], #zone input[data-ad-input=files]',
        'vite.bin',
      ],
      [
        'plain html (IIFE via <script>)',
        plainServer,
        'body > input[data-ad-input=files], form input[data-ad-input=files]',
        'plain.bin',
      ],
    ];
    for (const [name, server, inputSel, fileName] of cases) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      try {
        await page.goto(
          `http://localhost:${server.address().port}/?mock=${encodeURIComponent(mockUrl)}`,
        );
        const input = page.locator(inputSel).first();
        await input.waitFor({ state: 'attached', timeout: 10_000 });
        await input.setInputFiles({
          name: fileName,
          mimeType: 'application/octet-stream',
          buffer: payload,
        });
        await page.waitForFunction(
          (n) => window.__uploaded && window.__uploaded.includes(n),
          fileName,
          { timeout: 30_000 },
        );
        const report = await (await fetch(`${mockUrl}/__report`)).json();
        const f = report.merged.files.find((x) => x.path === fileName);
        if (!f || f.sha256 !== sha || f.size !== payload.length)
          throw new Error(`server copy of ${fileName} differs: ${JSON.stringify(f)}`);
        if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
        if (name.startsWith('vite')) {
          // Decision 0021: a locale module and a theme file from the tarball, bundled by Vite.
          const c = await page.evaluate(() => window.__custom());
          if (c.lang !== 'hi' || !c.glass || !c.backdrop.includes('blur') || c.message !== c.hi) {
            throw new Error(`locale/theme from the tarball not applied: ${JSON.stringify(c)}`);
          }
        }
        const extra = name.startsWith('vite')
          ? ` (VERSION ${await page.evaluate(() => window.__version)})`
          : '';
        results.push(`PASS ${name}${extra}`);
      } catch (e) {
        failed = true;
        results.push(`FAIL ${name}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await rm(uploadDir, { recursive: true, force: true });
  }

  // 5. Locale and theme entry points, from Node and from TypeScript (decision 0021).
  const step = async (name, fn) => {
    try {
      const extra = await fn();
      results.push(`PASS ${name}${extra ? ` (${extra})` : ''}`);
    } catch (e) {
      failed = true;
      results.push(`FAIL ${name}: ${e.message}`);
    }
  };
  const nodeIn = (args) => runNode(args, app).trim().split(/\r?\n/).pop();
  await step('node: ESM import of @vedratech/anydrop-ui/locales/ar and pt-BR', () =>
    nodeIn([
      '--input-type=module',
      '-e',
      "const m = await import('@vedratech/anydrop-ui/locales/ar'); const d = (await import('@vedratech/anydrop-ui/locales/pt-BR')).default; if (m.ar.code !== 'ar' || m.ar.dir !== 'rtl' || m.default !== m.ar || d.code !== 'pt-BR') throw new Error('bad locale'); console.log(m.ar.code + '/' + m.ar.dir)",
    ]),
  );
  await step('node: CJS require of @vedratech/anydrop-ui/locales/ar', () =>
    nodeIn([
      '-e',
      "const m = require('@vedratech/anydrop-ui/locales/ar'); if (m.ar.code !== 'ar' || m.ar.dir !== 'rtl') throw new Error('bad locale'); console.log(m.ar.code + '/' + m.ar.dir)",
    ]),
  );
  await step('node: themes/*.css and style.css resolve through exports', () =>
    nodeIn([
      '-e',
      "const fs = require('fs'); const q = require.resolve('@vedratech/anydrop-ui/style.css'); if (!q.endsWith('style.css')) throw new Error(q); for (const n of ['minimal','rounded','enterprise','glass']) { const p = require.resolve('@vedratech/anydrop-ui/themes/' + n + '.css'); if (!fs.readFileSync(p, 'utf8').includes('ad-theme-' + n)) throw new Error('not the ' + n + ' file'); } console.log('4 presets')",
    ]),
  );

  // TypeScript: resolve the locale types with each moduleResolution mode.
  const tsDir = join(app, 'types-check');
  await mkdir(tsDir, { recursive: true });
  const checkTs = `import { AnyDrop, type AnyDropLocale } from '@vedratech/anydrop-ui';
import { hi } from '@vedratech/anydrop-ui/locales/hi';
import ptBR, { ptBR as named } from '@vedratech/anydrop-ui/locales/pt-BR';
const code: string = hi.code;
const dir: 'ltr' | 'rtl' = ptBR.dir;
const same: AnyDropLocale = named;
const pause: string | undefined = hi.dict.dictPause;
const ui = new AnyDrop('#x', { url: '/u', locale: hi, themePreset: 'glass', layout: 'compact' });
void [ui, code, dir, same, pause];
`;
  await writeFile(join(tsDir, 'check.ts'), checkTs);
  await writeFile(join(tsDir, 'check.cts'), checkTs);
  const tscJs = join(app, 'node_modules', 'typescript', 'bin', 'tsc');
  const tsVersion = runNode([tscJs, '--version'], app).trim();
  const tscRepo = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const tsc = async (label, compilerOptions, files, tscPath = tscJs) => {
    const cfg = join(tsDir, `tsconfig.${label.replace(/\W+/g, '-')}.json`);
    await writeFile(
      cfg,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'es2022',
          lib: ['es2022', 'dom'],
          types: [],
          ...compilerOptions,
        },
        files,
      }),
    );
    const r = spawnSync(process.execPath, [tscPath, '-p', cfg], { cwd: tsDir, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
  };
  const modes = [
    ['bundler', { module: 'esnext', moduleResolution: 'bundler' }, ['check.ts']],
    ['node16 (ESM file)', { module: 'node16', moduleResolution: 'node16' }, ['check.ts']],
    [
      'node16 (CJS file, require condition)',
      { module: 'node16', moduleResolution: 'node16' },
      ['check.cts'],
    ],
  ];
  for (const [label, opts, files] of modes) {
    await step(`typescript ${tsVersion}: locales/hi types, moduleResolution ${label}`, async () => {
      const r = await tsc(label, opts, files);
      if (!r.ok) throw new Error(r.out);
    });
  }
  // node10 ignores `exports`: it looks for locales/hi.d.ts at the package root unless typesVersions maps it.
  const pkgJsonPath = join(app, 'node_modules', '@vedratech', 'anydrop-ui', 'package.json');
  const SNIPPET = { '*': { 'locales/*': ['./dist/locales/*.d.ts'] } };
  const node10 = { module: 'commonjs', moduleResolution: 'node10' };
  const before = await tsc('node10', node10, ['check.ts']);
  if (before.ok) {
    results.push(
      `PASS typescript ${tsVersion}: locales/hi types, moduleResolution node10 (no typesVersions needed)`,
    );
  } else {
    // Prove the fix in the temp copy only: the repo's package.json is not touched.
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    pkg.typesVersions = SNIPPET;
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2));
    const after = await tsc('node10-typesVersions', node10, ['check.ts']);
    failed = true;
    results.push(
      `FAIL typescript ${tsVersion}: locales/hi types, moduleResolution node10 (ignores "exports"):\n      ${before.out.split('\n').slice(0, 3).join('\n      ')}\n    With this snippet in the temp copy of the package.json it ${after.ok ? 'PASSES' : 'STILL FAILS: ' + after.out}. Add to packages/ui/package.json:\n      "typesVersions": ${JSON.stringify(SNIPPET)}`,
    );
  }
  if (existsSync(tscRepo)) {
    const r = await tsc('repo-ts-bundler', modes[0][1], ['check.ts'], tscRepo);
    const v = runNode([tscRepo, '--version'], app).trim();
    results.push(
      `${r.ok ? 'PASS' : 'FAIL'} typescript (repo, ${v}): locales/hi types, moduleResolution bundler${r.ok ? '' : ': ' + r.out}`,
    );
    if (!r.ok) failed = true;
  }
} catch (e) {
  failed = true;
  results.push(`FAIL setup: ${e.message}`);
} finally {
  for (const s of servers) await new Promise((r) => s.close(r));
  if (!keep) await rm(work, { recursive: true, force: true });
  else log(`kept ${work}`);
}
console.log('\n' + results.join('\n'));
process.exit(failed ? 1 : 0);
