# Offline and connectivity

Uploads often happen on bad connections: a train, a phone in a lift, a captive portal. AnyDrop handles this without losing work. It pauses by itself, probes the connection with growing delays, and carries on when it returns.

## What triggers a pause

| Situation | What AnyDrop does |
|---|---|
| The browser goes **offline** | Pauses with reason `'offline'`, resumes when it is back online (`autoResumeOnReconnect`). |
| The page is **hidden** (iOS suspends background tabs) | `pagehide` pauses at once. If a request fails with a network error while the page is hidden, the upload pauses instead of using up retries, and resumes when the page is visible again (`autoPauseOnHidden`). A hidden desktop tab keeps uploading. |
| The browser says it is online, but the server **cannot be reached** ("lie-fi": captive portal, DNS, outage) | After three failed requests in a row with no HTTP response, pauses as `'unreachable'` and probes with growing delays until the server answers. |
| A request **stalls** (no progress) | Aborted after `stallTimeout` (30 s by default) and retried as `STALLED`. |

A failure that happens while offline becomes a pause, uses no retry and creates no error entry. Nothing is lost.

## Probing

While the server is unreachable, AnyDrop probes at `random(0.5, 1) x min(60 s, 2 s x 2^(n-1))` intervals, with no attempt limit. It uses `HEAD connectivityProbeUrl`, else `GET chunkStatusUrl` for the failed file, else the failed request itself. Any HTTP response, of any status, ends the pause. A 5xx, 429 or 408 is a response too: it uses retries as usual and never counts as a lost connection.

Set a probe URL so a dead network is detected quickly:

```js
new AnyDrop('#uploader', {
  url: '/upload',
  connectivityProbeUrl: '/upload/ping', // answer HEAD with any status, Cache-Control: no-store
  stallTimeout: 30000, // ms without progress; null turns the watchdog off
  autoPauseOnHidden: true,
  autoResumeOnReconnect: true,
});
```

When the page and API are on different origins, enable CORS for the probe route. Without `connectivityProbeUrl`, the probe is the failed request itself, which keeps the instance waiting while that request cannot succeed, so set it.

## Retry now

`online`, the page becoming visible and `reconnect()` probe at once.

```js
document.querySelector('#retry-now').onclick = () => ad.reconnect();
```

`reconnect()` does nothing when online, and unlike `resume()` it keeps the pauses the user made.

## Read the state

```js
const { state, attempt, retryAt } = ad.getConnectionState();
// state: 'online' | 'offline' | 'unreachable'
// attempt: probe number (0 when online); retryAt: Date.now() time of the next probe, or null

ad.on('reconnecting', (attempt, delayMs) => console.log('next probe in', delayMs, 'ms'));
ad.on('paused', (t) => t.scope === 'all' && console.log('paused because', t.reason));
ad.on('resumed', (t) => t.scope === 'all' && console.log('resumed after', t.reason));
```

## In the UI

The UI shows a banner above the toolbar: "You are offline" (`dictOffline`) or "Connection lost. Retrying in N s" (`dictReconnecting`) with a **Retry now** button (`dictRetryNow`). When the connection returns the banner hides and "Connection restored" is announced to screen readers. Files paused only by the system show "Waiting for connection" instead of "Paused". To test it, use the browser DevTools (Network, Offline) or the "Simulate offline" switch in the [live demo](/demo).

## Stalls and big final chunks

The stall watchdog compares timestamps, so a throttled background tab cannot hide a stall. A request with no upload progress for `stallTimeout`, or with no response four times `stallTimeout` after its body was sent, is aborted. A backend that assembles a very large file on the last chunk should use `finalizeUrl`, or a higher `stallTimeout`. Custom transports must call `onProgress`.

## Starting offline

If `processQueue()` runs while `navigator.onLine` is `false`, the instance pauses as `offline` at once (a `paused` event, no `offline` event).
