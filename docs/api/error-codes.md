---
title: "Error codes reference"
description: "The error codes AnyDrop reports for failed uploads, such as validation, network, stall and finalize failures, with what each means and how to react."
---

# Error codes

Every entry of the error list ([`getErrors()`](/api/methods#geterrors), [`ErrorEntry`](/api/types#errorentry)) has a `code`, a `message`, a `stage` and a `retryable` flag. The code is typed `ErrorCode`, which is `KnownErrorCode | (string & {})`: the 18 codes below autocomplete, and a backend may send any other string in its JSON error body (`{ "code": "...", "message": "..." }`).

The `stage` says which step failed: `validate`, `manifest`, `status`, `upload` or `finalize`.

| Code | Meaning | Retried automatically |
|---|---|---|
| `NETWORK` | No response. Also an abort that core did not start, for example your code calling `file.xhr.abort()`. | yes |
| `TIMEOUT` | The `timeout` option elapsed. | yes |
| `STALLED` | Aborted by the stall watchdog (`stallTimeout`). | yes |
| `SERVER_ERROR` | 5xx, 408 or 429 without a code in the body. | yes |
| `HTTP_ERROR` | Another 4xx without a code in the body. | no |
| `AUTH` | 401 or 403. The server's own `code` in the body wins if it sends one. | no |
| `TOO_LARGE` | Only when the server sends it in the response body (`code`). A 413 without a code becomes `HTTP_ERROR`. | no |
| `INVALID_PATH` | A path with a `..` segment (also when a server sends it). | no |
| `INVALID_CHUNK` | The server rejected a chunk (400). | no |
| `CHUNK_MISMATCH` | The server answered 409. Without `chunkStatusUrl` the file fails with it. | no |
| `REJECTED_SIZE` | Validation: larger than `maxFilesize`. | no |
| `REJECTED_TYPE` | Validation: does not match `acceptedFiles`. | no |
| `MAX_FILES` | Validation: over `maxFiles`. | no |
| `REJECTED` | Your `accept()` callback rejected the file. | no |
| `FINALIZE_FAILED` | `chunksUploaded` reported an error or threw. | no |
| `UNREADABLE` | The file can no longer be read, for example an iCloud placeholder that is not downloaded (shown with `dictFileUnreadable`). | no |
| `TRANSFORM_FAILED` | `transformFile` threw. | no |
| `REQUEST_SETUP_FAILED` | Something threw while a request was built or handed to the transport (your `url`, `method`, `timeout`, `params` or `paramName` function, `xhr.open`, `setRequestHeader`, a custom transport). It is reported with `reportError`, and `retryFailedOnly()` tries again. | no |

Retries use `retryChunks` and `retryChunksLimit`, with a delay of `random(0.5..1) x min(30 s, 1 s x 2^(n-1))` or the server's `Retry-After` (seconds, at most 60). Network errors, timeouts, 408, 429 and 5xx are retried; 401, 403 and other 4xx are not. Whole-file uploads (no chunking) are never retried automatically.

Offline, hidden-page and lost-connection (`unreachable`) failures never become entries: they pause the upload instead (see [Offline and connectivity](/guide/offline)). A 4xx or 5xx status is a response, so it never counts as a lost connection.

Your backend sends these codes in its error responses; see the [error table in the protocol](/protocol#_6-errors).
