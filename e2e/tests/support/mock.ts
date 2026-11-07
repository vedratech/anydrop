import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from '@playwright/test';
import { createMockServer, type MockServerOptions } from '../../mock-server/server.mjs';

export interface IsolatedMock {
  /** e.g. http://localhost:51234 */
  url: string;
  uploadDir: string;
  /** GET /__report */
  report(session?: string): Promise<MockReport>;
  /** GET /__log */
  log(since?: number): Promise<MockLogEntry[]>;
  /** POST /__config (partial update, e.g. { failRate: 0.1 } or { failRules: [...] }). */
  configure(patch: Record<string, unknown>): Promise<void>;
  /** Stops listening and drops every connection (the browser then sees connection refused). */
  stop(): Promise<void>;
  /** Listens again on the same port; uploads, chunks and config are kept (a server restart). */
  restart(): Promise<void>;
}

export interface MockLogEntry {
  seq: number;
  method: string;
  path: string;
  status?: number;
  code?: string;
  uploadId?: string;
  chunkIndex?: number;
  relativePath?: string;
  bytes?: number;
  duplicate?: boolean;
  note?: string;
}

export interface MockReport {
  uploadDir: string;
  /** Union of all sessions by path (a resumed upload can span several sessions). */
  merged: { files: Array<{ path: string; size: number; sha256: string }>; folders: string[] };
  sessions: Record<
    string,
    {
      files: Array<{ path: string; size: number; sha256: string }>;
      folders: string[];
      manifestCalls: number;
    }
  >;
  uploads: Array<{
    uploadId: string;
    sessionIds: string[];
    relativePath: string;
    totalChunks: number;
    received: number[];
    writes: Record<string, number>;
    duplicateChunkWrites: number;
    finalizeCalls: number;
    complete: boolean;
    sha256: string | null;
  }>;
  stats: { inFlight: number; maxInFlight: number; injectedFailures: number; requests: number };
}

/**
 * Playwright test with an `mock` fixture: a fresh mock server on an ephemeral port, storing into a
 * temp directory, torn down after the test. Use it for any test that changes the mock configuration
 * (failures, latency) or needs exact request counts.
 */
export const test = base.extend<{ mock: IsolatedMock; mockOptions: MockServerOptions }>({
  mockOptions: [{}, { option: true }],
  mock: async ({ mockOptions }, use) => {
    const uploadDir = await mkdtemp(join(tmpdir(), 'anydrop-mock-'));
    const server = createMockServer({ port: 0, uploadDir, ...mockOptions });
    const port = await server.start();
    server.config.port = port; // a restart listens on the same port
    let running = true;
    const url = `http://localhost:${port}`;
    const get = async <T>(path: string): Promise<T> =>
      (await fetch(url + path)).json() as Promise<T>;
    await use({
      stop: async () => {
        if (running) await server.close();
        running = false;
      },
      restart: async () => {
        if (!running) await server.start();
        running = true;
      },
      url,
      uploadDir,
      report: (session) =>
        get(`/__report${session ? `?session=${encodeURIComponent(session)}` : ''}`),
      log: (since = 0) => get(`/__log?since=${since}`),
      configure: async (patch) => {
        await fetch(url + '/__config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      },
    });
    if (running) await server.close();
    // Requests the browser abandoned may still be finishing a write: retry the removal.
    await rm(uploadDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  },
});

export { expect } from '@playwright/test';
