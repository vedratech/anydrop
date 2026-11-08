---
title: "File upload that survives a lost connection"
description: "Keep browser uploads alive on bad networks: automatic pause when offline, probing with backoff, stall detection, retry and resume without losing finished chunks."
---

# File upload that survives a lost connection

People upload from trains, lifts, hotel Wi-Fi and captive portals. A plain upload fails and the user starts over. AnyDrop treats a lost connection as a pause, not as an error, and carries on when the server answers again.

## What it detects

| Situation | What AnyDrop does |
|---|---|
| The browser goes **offline** | Pauses (reason `'offline'`) and resumes when it is back online. |
| The page is **hidden** (iOS suspends background tabs) | Pauses on `pagehide`, or when a request fails while the page is hidden, and resumes when the page is visible. |
| The browser says it is online but the server **cannot be reached** (captive portal, DNS, outage) | After three failed requests in a row with no HTTP response, pauses as `'unreachable'` and probes with growing delays until the server answers. |
| A request **stalls** with no progress | Aborts it after `stallTimeout` (30 s by default) and retries it. |

A failure that happens while offline becomes a pause: it uses no retry and creates no error entry. Finished chunks are never sent again.

## Set it up

```js
import { AnyDrop } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

const ad = new AnyDrop('#uploader', {
  url: '/upload',
  chunking: true,
  chunkStatusUrl: '/upload/status',
  finalizeUrl: '/upload/finalize',
  connectivityProbeUrl: '/upload/ping', // answer HEAD with any status, Cache-Control: no-store
  stallTimeout: 30000, // ms without progress before a request is aborted
});

ad.on('reconnecting', (attempt, delayMs) => console.log('next probe in', delayMs, 'ms'));
document.querySelector('#retry-now').onclick = () => ad.reconnect();
```

Set `connectivityProbeUrl` so a dead network is noticed quickly. The probe waits `random(0.5, 1) x min(60 s, 2 s x 2^(n-1))` between attempts, with no attempt limit, and any HTTP response, whatever its status, ends the pause. `reconnect()` probes at once and keeps the pauses the user made.

## In the UI

A banner above the toolbar says "You are offline", or "Connection lost. Retrying in N s" with a **Retry now** button, and "Connection restored" when it is back. Files paused only by the system show "Waiting for connection". Try it in the [live demo](/demo) with the **Simulate offline** switch.

## What your backend needs

For the upload to continue exactly where it stopped, the server must accept chunks more than once and answer the chunk status request. A request that does not get an answer is retried; one that gets a 5xx, 429 or 408 uses its retries as usual and is not counted as a lost connection. See the [protocol](/protocol).

## Honest limits

- A web page cannot upload while the device has no network, and iOS can suspend a background tab. AnyDrop recovers when the page runs again, it cannot upload in the background.
- If the tab is closed, the user has to drop the same files again to resume ([Resume after reload](/guide/resume-after-reload)).
- Whole-file (non-chunked) uploads are never auto-retried, so use `chunking: true` for large files.

## Related

- [Offline and connectivity guide](/guide/offline)
- [Pause and resume uploads](/use-cases/pause-resume-uploads)
- [Upload large files (1 GB and more)](/use-cases/upload-large-files)
