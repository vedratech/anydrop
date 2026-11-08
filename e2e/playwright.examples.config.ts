import { defineConfig, devices } from '@playwright/test';

// E2E of the three example apps (decision 0022 section 8.4): examples/react-vite, examples/nextjs and
// examples/angular, all PRODUCTION builds, all proxying /upload to one shared mock server.
//
//   pnpm build && pnpm examples:build        (builds the wrappers, then the three example apps)
//   pnpm test:e2e:examples [--project=chromium]
//
// Like the main config: a per-run output folder and per-run ports (decision 0015). The ports of one run
// are chosen once here and inherited by the workers through process.env.
const isCI = !!process.env.CI;
process.env.AD_E2E_RUN ??= `${Date.now()}-${process.pid}`;
const RUN = process.env.AD_E2E_RUN;
const pick = (base: number, span: number) => base + Math.floor(Math.random() * span);
process.env.AD_PORT ??= String(pick(4100, 800));
process.env.EX_REACT_PORT ??= String(pick(6100, 300));
process.env.EX_NEXT_PORT ??= String(pick(6400, 300));
process.env.EX_NG_PORT ??= String(pick(6700, 300));
const AD_PORT = String(process.env.AD_PORT);
const EX_REACT_PORT = String(process.env.EX_REACT_PORT);
const EX_NEXT_PORT = String(process.env.EX_NEXT_PORT);
const EX_NG_PORT = String(process.env.EX_NG_PORT);
const reuse = !isCI && !!process.env.AD_E2E_REUSE;

export default defineConfig({
  testDir: './examples',
  outputDir: `./test-results/${RUN}-examples`,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: `./playwright-report/${RUN}-examples` }]]
    : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WEBKIT-FLAKE-1 (decision 0019): retries for the two WebKit projects only, reported as "flaky".
    { name: 'webkit', retries: 2, use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', retries: 2, use: { ...devices['iPhone 14'] } },
  ],
  webServer: [
    {
      command: 'node mock-server/server.mjs',
      cwd: '.',
      url: `http://localhost:${AD_PORT}/__health`,
      reuseExistingServer: reuse,
      env: { AD_PORT, AD_LOG: '0' },
      timeout: 30_000,
    },
    {
      // Vite production preview of examples/react-vite/dist (run `pnpm examples:build` first).
      command: 'pnpm --filter @vedratech/anydrop-example-react-vite exec vite preview',
      cwd: '..',
      url: `http://localhost:${EX_REACT_PORT}`,
      reuseExistingServer: reuse,
      env: { PORT: EX_REACT_PORT, AD_PORT },
      timeout: 60_000,
    },
    {
      // `next start` of the production build in examples/nextjs/.next. The /upload route handler reads
      // AD_PORT on every request.
      command: `pnpm --filter @vedratech/anydrop-example-nextjs exec next start -p ${EX_NEXT_PORT}`,
      cwd: '..',
      url: `http://localhost:${EX_NEXT_PORT}`,
      reuseExistingServer: reuse,
      env: { AD_PORT },
      timeout: 60_000,
    },
    {
      // The Angular SSR server (Express) of examples/angular/dist.
      command: 'node dist/anydrop-example-angular/server/server.mjs',
      cwd: '../examples/angular',
      url: `http://localhost:${EX_NG_PORT}`,
      reuseExistingServer: reuse,
      env: { PORT: EX_NG_PORT, AD_PORT },
      timeout: 60_000,
    },
  ],
});
