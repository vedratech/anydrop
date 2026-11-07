import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
// Every run gets its own output and report directory (decision 0015), so concurrent runs by
// different agents never delete each other's traces. Worker processes load this config again and
// inherit the same value through process.env. `--output <dir>` still overrides the output folder.
process.env.AD_E2E_RUN ??= `${Date.now()}-${process.pid}`;
const RUN = process.env.AD_E2E_RUN;
// Each run also starts its own demo and shared mock server on their own ports, so one run never
// reuses (or is reloaded by) another run's server. Set AD_PORT / DEMO_PORT to pin them, and
// AD_E2E_REUSE=1 to reuse servers you started yourself.
const pick = (base: number) => base + Math.floor(Math.random() * 800);
process.env.AD_PORT ??= String(pick(3100));
process.env.DEMO_PORT ??= String(pick(5200));
const MOCK_PORT = Number(process.env.AD_PORT);
const DEMO_PORT = Number(process.env.DEMO_PORT);
const reuse = !isCI && !!process.env.AD_E2E_REUSE;

export default defineConfig({
  testDir: './tests',
  outputDir: `./test-results/${RUN}`,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests that need a special mock configuration start their own isolated mock server
  // (see tests/support/mock.ts), so tests may run in parallel.
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: `./playwright-report/${RUN}` }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WEBKIT-FLAKE-1 (decision 0019): in Playwright's WebKit builds, under load, a chunk now and then
    // reaches the server with an empty body. Retries (reported as "flaky") for the two WebKit projects only.
    { name: 'webkit', retries: 2, use: { ...devices['Desktop Safari'] } },
    // Project names are short so `--project=iphone --project=pixel` works (see verify-upload skill).
    { name: 'iphone', retries: 2, use: { ...devices['iPhone 14'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Shared mock server for the demo. Isolated per-test instances use ephemeral ports instead.
      command: 'node mock-server/server.mjs',
      cwd: '.',
      url: `http://localhost:${MOCK_PORT}/__health`,
      reuseExistingServer: reuse,
      env: { AD_PORT: String(MOCK_PORT), AD_LOG: '0' },
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @vedratech/anydrop-demo exec vite --port ${DEMO_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${DEMO_PORT}`,
      reuseExistingServer: reuse,
      // The demo runs against the built packages (see demo/vite.config.ts): run `pnpm build` first.
      env: { VITE_MOCK_URL: `http://localhost:${MOCK_PORT}`, AD_PKG: 'dist' },
      timeout: 60_000,
    },
  ],
});
