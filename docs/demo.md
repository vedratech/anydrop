---
title: Live demo
aside: false
---

<script setup>
import LiveDemo from './.vitepress/theme/components/LiveDemo.vue'
</script>

# Live demo

Try the real AnyDrop UI. Press **Add sample folder**, or drop your own files and folders on the zone. Then try the controls: pause and resume, a failing network, and the **Simulate offline** switch, which shows the connection banner and the automatic recovery.

<ClientOnly>
  <LiveDemo />
</ClientOnly>

## How it works

The page loads the same file you get from the CDN (`@vedratech/anydrop-ui`, the global `AnyDrop`) and creates an instance with a fake [`transport`](/guide/custom-transport). The transport is the public custom-transport API: it receives every request AnyDrop makes (uploads, the manifest, the finalize request, the connectivity probe) and answers it in the browser.

```js
const ad = new AnyDrop('#demo-uploader', {
  url: '/fake/upload', // never requested: the transport answers
  transport: fakeTransport, // simulates latency, progress, random errors and offline
  chunking: true,
  chunkSize: 512 * 1024,
  sendManifest: true,
  manifestUrl: '/fake/manifest',
  finalizeUrl: '/fake/finalize',
  connectivityProbeUrl: '/fake/ping',
  persistState: false, // there is no real server to resume against
});
```

The source of the demo component is in the repository under `docs/.vitepress/theme/components/LiveDemo.vue`. For a demo against a real server, see the [Express example](/backend/express).
