// Minimal typings for the mock server, so Playwright tests can import it from TypeScript.
export interface MockConfig {
  port: number;
  host?: string;
  uploadDir: string;
  failRate: number;
  /** HTTP status of random failures (default 500; use 429 to test Retry-After). */
  failStatus: number;
  /** Seconds sent as Retry-After with random failures; 0 omits the header. */
  failRetryAfter: number;
  latencyMs: number;
  latencyJitterMs: number;
  seed: number;
  autoAssemble: boolean;
  maxFileBytes: number;
  maxBodyBytes: number;
  /** Reject chunks and finalize for an uploadId that is not in the session's latest manifest (0016). */
  strictManifest: boolean;
  log: boolean;
  failRules: Array<{
    where?: 'chunk' | 'status' | 'manifest' | 'finalize';
    relativePath?: string;
    uploadId?: string;
    chunkIndex?: number;
    status?: number;
    code?: string;
    /** Seconds for a Retry-After header (use with status 429 or 503). */
    retryAfter?: number;
    /** How many times the rule fires. Omit or null for every matching request. */
    times?: number | null;
  }>;
}

export type MockServerOptions = Partial<Omit<MockConfig, 'failRules'>>;

export interface MockServer {
  config: MockConfig;
  /** Starts listening. Resolves with the actual port (use `port: 0` for an ephemeral one). */
  start(): Promise<number>;
  close(): Promise<void>;
  /** Forget all uploads and the request log and wipe the storage directory. */
  reset(): Promise<void>;
  newSessionId(): string;
}

export const ROUTES: { upload: string; status: string; manifest: string; finalize: string };
export function createMockServer(opts?: MockServerOptions): MockServer;
export function cleanRelativePath(p: string): string;
export function parseMultipart(
  buf: Buffer,
  contentType: string,
): {
  fields: Record<string, string>;
  file: { name?: string; filename: string; data: Buffer } | null;
};
