// Response classification and backoff (decision 0007, upload-protocol section 6).
import type { TransportResponse } from '../transport/types';

export interface Failure {
  /** Server code from the JSON body, or the client fallback code. */
  code: string;
  /** Retried automatically (when the request kind allows it). */
  retry: boolean;
  /** 409 `CHUNK_MISMATCH`: refetch the chunk status and resend what is missing. */
  mismatch: boolean;
  /** `Retry-After` in ms (capped at 60 s), when the response had one. */
  wait?: number;
  httpStatus?: number;
}

/** `null` for a 2xx response, otherwise how to treat the failure. */
export function classify(res: TransportResponse): Failure | null {
  const s = res.status;
  if (!res.error && s >= 200 && s < 300) return null;
  const b = res.body as { code?: unknown } | null | undefined;
  const bodyCode = b && typeof b === 'object' && typeof b.code === 'string' ? b.code : '';
  // Retried: no response at all (except an abort), 408, 429 and 5xx.
  const retry = res.error ? res.error !== 'abort' : !s || s === 408 || s === 429 || s >= 500;
  const code =
    res.error === 'abort'
      ? 'ABORTED'
      : res.error === 'timeout'
        ? 'TIMEOUT'
        : res.error === 'stalled'
          ? 'STALLED'
          : res.error || !s
            ? 'NETWORK'
            : bodyCode || (retry ? 'SERVER_ERROR' : s === 401 || s === 403 ? 'AUTH' : 'HTTP_ERROR');
  return {
    code,
    retry,
    mismatch: s === 409 && code === 'CHUNK_MISMATCH',
    wait: retry ? retryAfter(res.header('Retry-After')) : undefined,
    httpStatus: s || undefined,
  };
}

/** `Retry-After` in seconds (protocol section 6) as ms, capped at 60 s. */
export function retryAfter(value: string | null): number | undefined {
  const ms = value ? Number(value) * 1000 : NaN;
  return ms >= 0 ? Math.min(60000, ms) : undefined;
}

/** Delay before retry `n` (n >= 1): `random(0.5, 1) × min(30 s, 1 s × 2^(n-1))`. */
export function backoff(n: number, random: () => number): number {
  return (0.5 + random() * 0.5) * Math.min(30000, 1000 * 2 ** (n - 1));
}

/**
 * Whether a file can no longer be read: an iCloud or OneDrive placeholder that is not downloaded,
 * or a file moved or deleted after it was picked. Reads one byte, only after a network failure.
 */
export function unreadable(blob: Blob): Promise<boolean> {
  // Blob.arrayBuffer: every supported browser (Safari 14+). One byte only, never the whole file.
  return blob
    .slice(0, 1)
    .arrayBuffer()
    .then(
      () => false,
      () => true,
    );
}
