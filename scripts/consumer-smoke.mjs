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
import '@vedratech/anydrop-ui/style.css';
const mock = new URLSearchParams(location.search).get('mock');
window.__version = VERSION;
const zone = new AnyDrop('#zone', { url: mock + '/upload', chunking: true, chunkSize: 4096, forceChunking: true, hiddenInputContainer: '#zone' });
window.__uploaded = [];
zone.on('success', (f) => window.__uploaded.push(f.name));
`,
  );
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--silent', ...tarballs.map((t) => t), 'vite'],
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
