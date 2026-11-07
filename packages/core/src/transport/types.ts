// The pluggable transport interface (IMPLEMENTATION.md, transport/): one request in, a handle out.
// The built-in transport uses XMLHttpRequest because `fetch` has no upload progress. Adapters
// (S3, tus, a fetch-based one) implement the same `send()`.

export interface TransportRequest {
  /** Upper-case HTTP method. */
  method: string;
  url: string;
  /** Headers to set; empty values are skipped. */
  headers: Record<string, string>;
  /** `FormData` (uploads), a `Blob` (`binaryBody`), a JSON string (manifest, finalize) or `null`. */
  body: FormData | Blob | string | null;
  /** Milliseconds; `null` or `0` = none. */
  timeout: number | null;
  withCredentials: boolean;
  /**
   * Must be called once, right before the body is sent, with the native request object (the
   * `XMLHttpRequest` for the built-in transport) or `undefined`. Core uses it to run `params()`,
   * emit `sending` and append the file blob last, exactly as Dropzone does.
   */
  beforeSend?: (native?: unknown) => void;
}

export interface TransportResponse {
  /** HTTP status; `0` when no response arrived (`error` is then set). */
  status: number;
  /** Parsed JSON when the response is JSON (Dropzone rule: `content-type` contains `application/json`), else the text. */
  body: unknown;
  /** Response header lookup (`Retry-After`). */
  header: (name: string) => string | null;
  /** Set when no HTTP response arrived (`'stalled'` is set by core for a request it aborted, 0017). */
  error?: 'network' | 'timeout' | 'abort' | 'stalled';
  /** The built-in transport's request object (passed to the `error` event). */
  xhr?: XMLHttpRequest;
}

export interface TransportHandle {
  /** Aborts the request. The promise then resolves with `error: 'abort'`. */
  abort(): void;
  /** Assigned by core after `send()` returns: upload progress of the request body. */
  onProgress?: (loaded: number, total: number) => void;
  /** Always resolves (never rejects), also for network errors, timeouts and aborts. */
  promise: Promise<TransportResponse>;
}

export interface Transport {
  send(request: TransportRequest): TransportHandle;
}
