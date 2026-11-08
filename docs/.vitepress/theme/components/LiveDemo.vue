<script setup lang="ts">
// The real @vedratech/anydrop-ui build (copied to /demo at build time) driven by a fake `transport`.
// Nothing here talks to a server: the transport simulates latency, progress, random failures and
// an offline network, which is also what the "Custom transport" guide describes.
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useData } from 'vitepress';
import { addSampleFolderTo, createFakeTransport, loadAnyDrop } from './fakeTransport';

const { isDark } = useData();

const host = ref<HTMLElement | null>(null);
const ready = ref(false);
const failed = ref('');
const log = ref<{ id: number; time: string; text: string }[]>([]);
const counts = reactive({ requests: 0, failures: 0 });
const ui = reactive({ failRate: 0.15, speed: 2, offline: false, folders: 0 });

// Read by the fake transport on every request, so changing a control takes effect at once.
const sim = { failRate: 0.15, speed: 2, offline: false };
watch(
  () => [ui.failRate, ui.speed, ui.offline],
  () => {
    sim.failRate = Number(ui.failRate);
    sim.speed = Number(ui.speed);
    sim.offline = ui.offline;
  },
);

let ad: any = null;
let seq = 0;

function say(text: string) {
  const d = new Date();
  const time = d.toTimeString().slice(0, 8);
  log.value.unshift({ id: ++seq, time, text });
  if (log.value.length > 150) log.value.length = 150;
}

const transport = createFakeTransport(sim, {
  onRequest: () => counts.requests++,
  onFailure: () => counts.failures++,
});

function addSampleFolder() {
  if (!ad) return;
  addSampleFolderTo(ad, ++ui.folders);
}

const pause = () => ad?.pause();
const resume = () => ad?.resume();
const retry = () => say('Retry failed: ' + (ad?.retryFailedOnly() ?? 0) + ' file(s) re-queued');
const clearAll = () => ad?.removeAllFiles(true);
const clearLog = () => (log.value = []);

onMounted(async () => {
  try {
    await loadAnyDrop();
  } catch (e) {
    failed.value = (e as Error).message;
    return;
  }
  const AnyDrop = (window as any).AnyDrop;
  ad = new AnyDrop(host.value, {
    url: '/fake/upload', // never requested: the transport answers
    transport,
    chunking: true,
    chunkSize: 512 * 1024,
    parallelUploads: 2,
    sendManifest: true,
    manifestUrl: '/fake/manifest',
    finalizeUrl: '/fake/finalize',
    connectivityProbeUrl: '/fake/ping',
    persistState: false, // there is no real server to resume against
    theme: isDark.value ? 'dark' : 'light',
  });
  const on = (name: string, fn: (...a: any[]) => string | void) =>
    ad.on(name, (...a: any[]) => {
      const text = fn(...a);
      if (text) say(text);
    });
  on('addedfolder', (f) => `addedfolder  ${f.path}`);
  on('addedfiles', (files) => `addedfiles   ${files.length} file(s) in this batch`);
  on('processing', (f) => `processing   ${f.relativePath}`);
  on('success', (f) => `success      ${f.relativePath}`);
  on(
    'error',
    (f, m) => `error        ${f.relativePath}: ${typeof m === 'string' ? m : JSON.stringify(m)}`,
  );
  on('foldercomplete', (f) => `foldercomplete ${f.path}`);
  on('paused', (t) => `paused       ${t.scope} (${t.reason})`);
  on('resumed', (t) => `resumed      ${t.scope} (${t.reason})`);
  on(
    'reconnecting',
    (n, ms) => `reconnecting attempt ${n}, next probe in ${Math.round(ms / 1000)} s`,
  );
  on('errorlistchanged', (e) => `errorlist   ${e.length} failed`);
  on('queuecomplete', () => `queuecomplete (${ad.getErrors().length} failed)`);
  on('reset', () => 'reset');
  ready.value = true;
  say('Ready. Press "Add sample folder", or drop your own files and folders on the zone.');
});

watch(isDark, (dark) => ad?.setOption('theme', dark ? 'dark' : 'light'));

onBeforeUnmount(() => {
  ad?.destroy();
  ad = null;
});
</script>

<template>
  <div class="live-demo">
    <p class="note">
      <strong>This demo is simulated.</strong> GitHub Pages has no backend, so the real AnyDrop UI
      runs with a fake <code>transport</code> that simulates latency, progress, random server errors
      and a lost connection. Nothing you drop leaves your browser.
    </p>

    <div class="controls" role="group" aria-label="Demo controls">
      <button type="button" class="primary" :disabled="!ready" @click="addSampleFolder">
        Add sample folder
      </button>
      <button type="button" :disabled="!ready" @click="pause">Pause</button>
      <button type="button" :disabled="!ready" @click="resume">Resume</button>
      <button type="button" :disabled="!ready" @click="retry">Retry failed</button>
      <button type="button" :disabled="!ready" @click="clearAll">Remove all</button>
    </div>

    <div class="controls sim" role="group" aria-label="Network simulation">
      <label>
        Speed
        <select v-model.number="ui.speed">
          <option :value="0.5">Slow (0.5 MB/s)</option>
          <option :value="2">Normal (2 MB/s)</option>
          <option :value="10">Fast (10 MB/s)</option>
        </select>
      </label>
      <label>
        Random failures
        <select v-model.number="ui.failRate">
          <option :value="0">None</option>
          <option :value="0.15">15% of requests</option>
          <option :value="0.4">40% of requests</option>
        </select>
      </label>
      <label class="check">
        <input v-model="ui.offline" type="checkbox" />
        Simulate offline
      </label>
      <span class="stats"
        >{{ counts.requests }} requests, {{ counts.failures }} simulated errors</span
      >
    </div>

    <p v-if="failed" class="error">{{ failed }}</p>
    <div ref="host" id="demo-uploader" class="host" />

    <h3>Event log</h3>
    <div class="log-head">
      <span>Newest first</span>
      <button type="button" @click="clearLog">Clear log</button>
    </div>
    <ol class="log" aria-live="off" data-testid="event-log">
      <li v-if="!log.length" class="empty">No events yet.</li>
      <li v-for="line in log" :key="line.id">
        <time>{{ line.time }}</time> <code>{{ line.text }}</code>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.note {
  padding: 10px 14px;
  border-left: 4px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 6px;
  font-size: 14px;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin: 12px 0;
}
button,
select {
  font: inherit;
  font-size: 14px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
select {
  padding: 0 8px;
  margin-left: 6px;
}
button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
button.primary {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-button-brand-text, #fff);
  font-weight: 600;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
label {
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
}
.stats {
  margin-left: auto;
  font-size: 13px;
  color: var(--vp-c-text-3);
}
.host {
  margin: 12px 0;
}
.error {
  color: var(--vp-c-danger-1);
}
h3 {
  margin: 28px 0 8px;
}
.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-bottom: 6px;
}
.log-head button {
  min-height: 28px;
  font-size: 12px;
}
.log {
  list-style: none;
  margin: 0;
  padding: 8px 12px;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  font-size: 12.5px;
  line-height: 1.7;
}
.log li {
  margin: 0;
  white-space: pre;
}
.log time {
  color: var(--vp-c-text-3);
}
.log code {
  background: none;
  padding: 0;
  color: var(--vp-c-text-1);
}
.empty {
  color: var(--vp-c-text-3);
}
</style>
