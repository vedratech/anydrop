#!/usr/bin/env node
// Fresh-consumer check for the framework wrappers (decision 0022 section 8.4; M7). Sibling of
// consumer-smoke.mjs. Never publishes anything.
//
//   node scripts/consumer-wrappers.mjs --app react-vite|nextjs|angular [--next 14] [--angular 18] [--keep]
//
//   1. Packs @vedratech/anydrop-core, -ui and -react with `pnpm pack`, and -angular with `npm pack` of
//      packages/angular/dist (the folder that is published, `publishConfig.directory`), into a temp
//      directory OUTSIDE the repo.
//   2. Writes a small app of the chosen framework in another temp directory and installs the tarballs
//      with npm (peer dependencies must resolve on their own, no --legacy-peer-deps), then builds it:
//        react-vite   Vite + latest React, TypeScript checked, Node ESM and CJS import of the package
//        nextjs       latest Next (App Router, server component + client component); --next 14 pins
//                     Next 14 + React 18 and builds the repo's examples/nextjs/app sources instead
//        angular      latest Angular, standalone, AnyDropComponent + slot template + AnyDropService;
//                     --angular 18 pins Angular 18 (partial declarations compiled by 18 must link on 18)
//      The apps are written by hand (what `npm create vite`, `create-next-app` and `ng new` generate,
//      trimmed to what is needed) so the check needs no interactive scaffolding and does not change with
//      the templates of the generators. The framework versions are npm's `latest` (or the pinned major).
//   3. Serves the build and runs it in Chromium against the test mock server: a file is picked, uploaded
//      in chunks, and the mock must hold it with the right SHA-256; the custom row slot is on screen;
//      no console errors. Next is also fetched without a browser: the server HTML must contain the host.
//
// Usage (after `pnpm build`): the packages must be built, packages/angular/dist included.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const app = arg('app');
const keep = argv.includes('--keep');
const nextMajor = arg('next'); // e.g. 14
const ngMajor = arg('angular'); // e.g. 18
if (!['react-vite', 'nextjs', 'angular'].includes(app ?? '')) {
  console.error(
    'usage: node scripts/consumer-wrappers.mjs --app react-vite|nextjs|angular [--next 14] [--angular 18] [--keep]',
  );
  process.exit(2);
}
const label = `${app}${nextMajor ? ` (Next ${nextMajor} + React 18)` : ''}${ngMajor ? ` (Angular ${ngMajor})` : ''}`;
const requireFromRoot = createRequire(join(ROOT, 'package.json'));
const log = (m) => console.log(`[consumer-wrappers] ${m}`);
const win = process.platform === 'win32';

function run(cmd, args, cwd, extra = {}) {
  log(`$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: win,
    maxBuffer: 64 * 1024 * 1024,
    ...extra,
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${r.status}`);
  }
  return r.stdout;
}
const runNode = (args, cwd) => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(`node ${args.slice(0, 2).join(' ')} failed: ${(r.stdout + r.stderr).trim()}`);
  return r.stdout.trim();
};

for (const p of ['core', 'ui', 'react']) {
  if (!existsSync(join(ROOT, 'packages', p, 'dist', 'index.js'))) {
    throw new Error(`packages/${p}/dist is missing. Run "pnpm build" first.`);
  }
}
if (!existsSync(join(ROOT, 'packages', 'angular', 'dist', 'package.json'))) {
  throw new Error('packages/angular/dist is missing. Run "pnpm build" first.');
}

const write = async (dir, files) => {
  for (const [name, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
};

// ----------------------------------------------------------------------------------------- apps

/** React code shared by the Vite and the Next app: the client component. */
const REACT_CLIENT = `import { useEffect, useState } from 'react';
import { AnyDrop, useAnyDrop, type AnyDropEventPayload } from '@vedratech/anydrop-react';

type W = { __uploaded: string[]; __rows: number };

export function Uploader() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as W).__uploaded = [];
    setUrl(new URLSearchParams(location.search).get('mock') + '/upload');
  }, []);
  const state = useAnyDrop({ url: url ?? '/unused' });
  void state.files.length;
  const onSuccess = ({ file }: AnyDropEventPayload<'success'>) => {
    (window as unknown as W).__uploaded.push(file.name);
  };
  return url ? (
    <AnyDrop
      id="uploader"
      url={url}
      options={{ chunking: true, chunkSize: 4096, forceChunking: true, hiddenInputContainer: '#uploader' }}
      onSuccess={onSuccess}
      renderFile={(ctx) => <span data-testid="row">{ctx.label}</span>}
    />
  ) : null;
}
`;

const apps = {
  'react-vite': {
    files: () => ({
      'package.json': JSON.stringify(
        {
          name: 'consumer-react-vite',
          private: true,
          type: 'module',
          scripts: { build: 'tsc --noEmit && vite build' },
        },
        null,
        2,
      ),
      'index.html':
        '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'vite.config.ts':
        "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react()] });\n",
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022', 'DOM'],
            module: 'ESNext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: [],
          },
          include: ['src'],
        },
        null,
        2,
      ),
      'src/main.tsx':
        "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport '@vedratech/anydrop-ui/style.css';\nimport { Uploader } from './Uploader';\ncreateRoot(document.getElementById('root')!).render(<StrictMode><Uploader /></StrictMode>);\n",
      'src/Uploader.tsx': REACT_CLIENT,
      // What `npm create vite` adds: types for CSS imports (TypeScript 6 checks side-effect imports).
      'src/vite-env.d.ts': '/// <reference types="vite/client" />\n',
    }),
    deps: () => [
      'react',
      'react-dom',
      '@types/react',
      '@types/react-dom',
      'vite',
      '@vitejs/plugin-react',
      'typescript',
    ],
    tarballs: ['core', 'ui', 'react'],
    build: (dir) =>
      run('npx', ['--no-install', 'vite', 'build'], dir) &&
      run('npx', ['--no-install', 'tsc', '--noEmit'], dir),
    serve: 'static:dist',
    ssrHtml: null,
  },
  nextjs: {
    files: () => ({
      'package.json': JSON.stringify(
        {
          name: 'consumer-next',
          private: true,
          scripts: { build: 'next build', start: 'next start' },
        },
        null,
        2,
      ),
      'next.config.mjs': 'export default {};\n',
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'preserve',
            incremental: true,
            plugins: [{ name: 'next' }],
          },
          include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2,
      ),
      'app/layout.tsx':
        "import type { ReactNode } from 'react';\nimport '@vedratech/anydrop-ui/style.css';\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (<html lang=\"en\"><body>{children}</body></html>);\n}\n",
      // A Server Component rendering <AnyDrop> with serialisable props (the host is in the server HTML),
      // and a client component for everything with functions.
      'app/page.tsx':
        'import { AnyDrop } from \'@vedratech/anydrop-react\';\nimport { Uploader } from \'./Uploader\';\nexport default function Page() {\n  return (<><AnyDrop url="/upload" id="ssr-check" /><Uploader /></>);\n}\n',
      'app/Uploader.tsx': `'use client';\n${REACT_CLIENT}`,
    }),
    deps: () => [
      'next',
      'react',
      'react-dom',
      '@types/react',
      '@types/react-dom',
      '@types/node',
      'typescript',
    ],
    tarballs: ['core', 'ui', 'react'],
    build: (dir) =>
      run('npx', ['--no-install', 'next', 'build'], dir, {
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      }),
    serve: 'next',
    ssrHtml: ['<div id="ssr-check"><div></div></div>'],
  },
  angular: {
    files: (v) => {
      const zone = v.zoneJs;
      return {
        'package.json': JSON.stringify(
          { name: 'consumer-angular', private: true, scripts: { build: 'ng build' } },
          null,
          2,
        ),
        'angular.json': JSON.stringify(
          {
            $schema: './node_modules/@angular/cli/lib/config/schema.json',
            version: 1,
            cli: { analytics: false },
            projects: {
              app: {
                projectType: 'application',
                root: '',
                sourceRoot: 'src',
                prefix: 'app',
                architect: {
                  build: {
                    builder: '@angular/build:application',
                    options: {
                      outputPath: 'dist/app',
                      index: 'src/index.html',
                      browser: 'src/main.ts',
                      tsConfig: 'tsconfig.app.json',
                      polyfills: zone ? ['zone.js'] : [],
                      styles: ['src/styles.css'],
                    },
                    configurations: { production: { outputHashing: 'all' } },
                    defaultConfiguration: 'production',
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        'tsconfig.json': JSON.stringify(
          {
            compileOnSave: false,
            compilerOptions: {
              strict: true,
              skipLibCheck: false,
              isolatedModules: true,
              experimentalDecorators: true,
              importHelpers: false,
              target: 'ES2022',
              module: 'ES2022',
              moduleResolution: 'bundler',
              lib: ['ES2022', 'dom'],
            },
            angularCompilerOptions: {
              strictInjectionParameters: true,
              strictInputAccessModifiers: true,
              strictTemplates: true,
            },
          },
          null,
          2,
        ),
        'tsconfig.app.json': JSON.stringify(
          {
            extends: './tsconfig.json',
            compilerOptions: { outDir: './out-tsc/app', types: [] },
            files: ['src/main.ts'],
            include: ['src/**/*.d.ts'],
          },
          null,
          2,
        ),
        'src/index.html':
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="/"><title>consumer</title></head><body><app-root></app-root></body></html>',
        'src/styles.css': "@import '@vedratech/anydrop-ui/style.css';\n",
        'src/main.ts':
          "import { bootstrapApplication } from '@angular/platform-browser';\nimport { provideAnyDrop } from '@vedratech/anydrop-angular';\nimport { App } from './app';\nbootstrapApplication(App, { providers: [provideAnyDrop({ chunking: true, chunkSize: 4096, forceChunking: true })] }).catch((e) => console.error(e));\n",
        'src/app.ts': `import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ANYDROP_IMPORTS, AnyDropService, type AnyDropEventPayload } from '@vedratech/anydrop-angular';

type W = { __uploaded: string[] };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ANYDROP_IMPORTS],
  providers: [AnyDropService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <any-drop id="zone" [url]="url" (success)="onSuccess($event)">
      <ng-template anyDropFile let-ctx><span data-testid="row">{{ ctx.label }}</span></ng-template>
    </any-drop>
    <p data-testid="files">{{ service.files().length }}</p>
  \`,
})
export class App {
  protected readonly service = inject(AnyDropService);
  protected readonly url = new URLSearchParams(location.search).get('mock') + '/upload';
  constructor() {
    (window as unknown as W).__uploaded = [];
  }
  protected onSuccess(e: AnyDropEventPayload<'success'>): void {
    (window as unknown as W).__uploaded.push(e.file.name);
  }
}
`,
      };
    },
    deps: (v) => {
      const m = ngMajor ? `@${ngMajor}` : '';
      const base = [
        'core',
        'common',
        'compiler',
        'platform-browser',
        'compiler-cli',
        'cli',
        'build',
      ].map((n) => `@angular/${n}${m}`);
      return [
        ...base,
        'rxjs@7',
        ...(v.zoneJs ? ['zone.js'] : []),
        ...(ngMajor ? ['typescript@~5.5'] : []),
      ];
    },
    tarballs: ['core', 'ui', 'angular'],
    build: (dir) =>
      run('npx', ['--no-install', 'ng', 'build'], dir, {
        env: { ...process.env, NG_CLI_ANALYTICS: 'false' },
      }),
    serve: 'static:dist/app/browser',
    ssrHtml: null,
  },
};

// ------------------------------------------------------------------------------------------ main

const work = await mkdtemp(join(tmpdir(), 'anydrop-consumer-w-'));
const results = [];
let failed = false;
const servers = [];
const children = [];
try {
  // 1. Tarballs.
  const tarDir = join(work, 'tarballs');
  await mkdir(tarDir);
  const spec = apps[app];
  for (const p of spec.tarballs) {
    if (p === 'angular') {
      // The published folder: ng-packagr output with its own package.json.
      run('npm', ['pack', '--pack-destination', tarDir], join(ROOT, 'packages', 'angular', 'dist'));
    } else {
      run('pnpm', ['pack', '--pack-destination', tarDir], join(ROOT, 'packages', p));
    }
  }
  const tarballs = (await readdir(tarDir))
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => join(tarDir, f));
  if (tarballs.length !== spec.tarballs.length)
    throw new Error(`expected ${spec.tarballs.length} tarballs, got ${tarballs.length}`);
  log(`packed: ${tarballs.map((t) => t.split(/[\\/]/).pop()).join(', ')}`);

  // 2. The app.
  const dir = join(work, 'app');
  await mkdir(dir);
  const v = { zoneJs: Boolean(ngMajor) && Number(ngMajor) < 21 };
  let files = spec.files(v);
  let deps = spec.deps(v);
  if (app === 'nextjs' && nextMajor) {
    // Next 14 builds the repo's own example sources (App Router: server page + client scenario, and the
    // /upload route handler) with Next 14 and React 18 (decision 0022 section 6).
    deps = [
      'next@' + nextMajor,
      'react@18',
      'react-dom@18',
      '@types/react@18',
      '@types/react-dom@18',
      '@types/node@20',
      'typescript@5',
    ];
    files = Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith('app/')));
  }
  await write(dir, files);
  if (app === 'nextjs' && nextMajor) {
    await cp(join(ROOT, 'examples', 'nextjs', 'app'), join(dir, 'app'), { recursive: true });
  }
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', ...tarballs, ...deps], dir);
  const installed = (name) => {
    try {
      return JSON.parse(
        spawnSync(
          process.execPath,
          ['-p', `JSON.stringify(require('${name}/package.json').version)`],
          { cwd: dir, encoding: 'utf8' },
        ).stdout.trim(),
      );
    } catch {
      return '?';
    }
  };
  const fw =
    app === 'angular'
      ? `Angular ${installed('@angular/core')}`
      : app === 'nextjs'
        ? `Next ${installed('next')}, React ${installed('react')}`
        : `React ${installed('react')}, Vite ${installed('vite')}`;
  log(`installed: ${fw}`);
  spec.build(dir);

  if (app === 'react-vite') {
    // Server-side imports of the built package (Node without a DOM), ESM and CJS.
    runNode(
      [
        '--input-type=module',
        '-e',
        "const m = await import('@vedratech/anydrop-react'); if (typeof m.AnyDrop !== 'object' && typeof m.AnyDrop !== 'function') throw new Error('no AnyDrop'); if (typeof m.useAnyDrop !== 'function') throw new Error('no useAnyDrop')",
      ],
      dir,
    );
    runNode(
      [
        '-e',
        "const m = require('@vedratech/anydrop-react'); if (!m.AnyDrop || !m.useAnyDrop) throw new Error('bad cjs')",
      ],
      dir,
    );
    results.push('PASS node: ESM import and CJS require of @vedratech/anydrop-react (no DOM)');
  }

  // 3. Serve and run in Chromium.
  const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.ico': 'image/x-icon',
  };
  const serveDir = (root) =>
    new Promise((resolve) => {
      const s = createServer(async (req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = join(root, p);
        if (!file.startsWith(root) || !existsSync(file) || !(await stat(file)).isFile()) {
          res.writeHead(404).end('not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
      });
      s.listen(0, () => resolve(s));
      servers.push(s);
    });
  let base;
  if (spec.serve.startsWith('static:')) {
    const s = await serveDir(join(dir, spec.serve.slice('static:'.length)));
    base = `http://localhost:${s.address().port}`;
  } else {
    const port = await new Promise((resolve) => {
      const s = createServer().listen(0, () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    const nextBin = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
      cwd: dir,
      stdio: 'ignore',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    children.push(child);
    base = `http://localhost:${port}`;
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base)).ok) break;
      } catch {
        /* not up yet */
      }
      if (i > 120) throw new Error('next start did not come up');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const { createMockServer } = await import(
    pathToFileURL(join(ROOT, 'e2e', 'mock-server', 'server.mjs')).href
  );
  const uploadDir = await mkdtemp(join(tmpdir(), 'anydrop-consumer-w-up-'));
  const mockServer = createMockServer({ port: 0, uploadDir, log: false });
  const mockPort = await mockServer.start();
  servers.push({ close: (cb) => mockServer.close().then(cb) });
  const mockUrl = `http://localhost:${mockPort}`;

  if (spec.ssrHtml) {
    const html = await (await fetch(base)).text();
    const needles = nextMajor
      ? ['<div id="server-rendered"><div></div></div>', '<div id="uploader"><div></div></div>']
      : spec.ssrHtml;
    for (const needle of needles) {
      if (!html.includes(needle)) throw new Error(`server HTML lacks ${needle}`);
    }
    if (html.includes('ad-root')) throw new Error('server HTML contains an instance (ad-root)');
    results.push(`PASS ${label}: server HTML has the empty host divs and no instance`);
  }

  const { chromium } = requireFromRoot('@playwright/test');
  const browser = await chromium.launch();
  try {
    const payload = Buffer.from('consumer wrapper smoke '.repeat(800)); // ~18 kB: 5 chunks of 4096
    const sha = createHash('sha256').update(payload).digest('hex');
    const fileName = `${app}.bin`;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on(
      'console',
      (m) =>
        (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`),
    );
    try {
      if (nextMajor) {
        // The example page uses its own proxy path and has no ?mock= hook: only check it renders.
        await page.goto(base);
        await page.locator('#uploader > div.ad-root').waitFor({ timeout: 15_000 });
        await page.waitForTimeout(800);
        if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
        results.push(`PASS ${label}: built, hydrated, uploader mounted (${fw})`);
      } else {
        await page.goto(`${base}/?mock=${encodeURIComponent(mockUrl)}`);
        const input = page
          .locator(
            app === 'angular'
              ? 'input[data-ad-input=files]'
              : '#uploader input[data-ad-input=files]',
          )
          .first();
        await input.waitFor({ state: 'attached', timeout: 15_000 });
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
        await page.locator('[data-testid=row]').first().waitFor({ timeout: 5_000 });
        const report = await (await fetch(`${mockUrl}/__report`)).json();
        const f = report.merged.files.find((x) => x.path === fileName);
        if (!f || f.sha256 !== sha || f.size !== payload.length)
          throw new Error(`server copy of ${fileName} differs: ${JSON.stringify(f)}`);
        const up = report.uploads.find((u) => u.relativePath === fileName);
        if (!up || up.totalChunks < 2)
          throw new Error(`file was not sent in chunks: ${JSON.stringify(up)}`);
        if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
        results.push(
          `PASS ${label}: installed from tarballs, built, uploaded ${up.totalChunks} chunks, SHA-256 matches, custom row rendered (${fw})`,
        );
      }
    } catch (e) {
      failed = true;
      results.push(`FAIL ${label}: ${e.message}`);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await rm(uploadDir, { recursive: true, force: true });
  }
} catch (e) {
  failed = true;
  results.push(`FAIL setup (${label}): ${e.message}`);
} finally {
  for (const c of children) {
    if (win) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill();
  }
  for (const s of servers) await new Promise((r) => s.close(r));
  if (!keep) await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else log(`kept ${work}`);
}
console.log('\n' + results.join('\n'));
process.exit(failed ? 1 : 0);
