import { AnyDropCore } from '@vedratech/anydrop-core';
import { AnyDrop, VERSION } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';

// Test-only mock server (e2e/mock-server). Override with VITE_MOCK_URL=http://host:port, or per page
// with ?mock=http://host:port (the e2e tests use it to point the demo at an isolated mock).
export const MOCK_URL: string =
  new URLSearchParams(location.search).get('mock') ??
  import.meta.env.VITE_MOCK_URL ??
  'http://localhost:3001';

const text = (sel: string, value: string) => {
  const el = document.querySelector(sel);
  if (el) el.textContent = value;
};
text('#version', VERSION);
text('#mock-url', MOCK_URL);

const post = (path: string, body: unknown) =>
  fetch(MOCK_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// 1. Basic: options preset by element id (AnyDrop.options.basicZone). The form's action is the url.
const form = document.querySelector<HTMLFormElement>('#basic-zone');
if (form) form.action = `${MOCK_URL}/upload`;
AnyDrop.options.basicZone = {
  paramName: 'file', // The name that will be used to transfer the file
  maxFilesize: 2, // MB
  addRemoveLinks: true,
  accept: function (file, done) {
    if (file.name === 'justinbieber.jpg') {
      done("Naha, you don't.");
    } else {
      done();
    }
  },
};
const basic = new AnyDrop('#basic-zone');

// 2. Folder tree: chunked, manifest, finalize.
const tree = new AnyDrop('#tree-zone', {
  url: `${MOCK_URL}/upload`,
  chunking: true,
  chunkSize: 64 * 1024,
  forceChunking: true,
  parallelUploads: 2,
  folders: true,
  preserveEmptyFolders: true,
  folderView: 'tree',
  hiddenInputContainer: '#tree-zone',
  sendManifest: true,
  manifestUrl: `${MOCK_URL}/upload/manifest`,
  chunkStatusUrl: `${MOCK_URL}/upload/status`,
  finalizeUrl: `${MOCK_URL}/upload/finalize`,
  maxFilesize: 64,
});
document.querySelector('#tree-view-flat')?.addEventListener('click', () => {
  tree.setOption('folderView', 'flat');
});
document.querySelector('#tree-view-tree')?.addEventListener('click', () => {
  tree.setOption('folderView', 'tree');
});
document.querySelector('#tree-slow')?.addEventListener('click', () => {
  void post('/__config', { latencyMs: 300 });
});

// 3. Headless: the core without the UI package.
const log = document.querySelector<HTMLElement>('#headless-log');
const say = (line: string) => {
  if (log) log.textContent += line + '\n';
};
const headless = new AnyDropCore({
  url: `${MOCK_URL}/upload`,
  chunking: true,
  chunkSize: 64 * 1024,
  sendManifest: true,
  manifestUrl: `${MOCK_URL}/upload/manifest`,
  finalizeUrl: `${MOCK_URL}/upload/finalize`,
});
headless.on('addedfolder', (f) => say(`folder ${f.path}`));
headless.on('success', (f) => say(`done ${f.relativePath}`));
headless.on('error', (f, m) => say(`failed ${f.relativePath}: ${String(m)}`));
headless.on('queuecomplete', () => say('queue complete'));
const input = document.querySelector<HTMLInputElement>('#headless-input');
input?.addEventListener('change', () => {
  const files = Array.prototype.slice.call(input.files || []) as File[];
  input.value = '';
  void headless.addFromInput(files);
});

// 4. Mobile: the same component in a narrow column; touch devices get the tap-to-upload layout.
const mobile = new AnyDrop('#mobile-zone', {
  url: `${MOCK_URL}/upload`,
  chunking: true,
  chunkSize: 256 * 1024,
  parallelUploads: 2,
  acceptedFiles: 'image/*,.heic,.heif,.pdf',
  thumbnailWidth: 80,
  thumbnailHeight: 80,
  maxThumbnailFilesize: 8,
  hiddenInputContainer: '#mobile-zone',
  folders: true,
});

// 5. Errors and retry.
const errors = new AnyDrop('#errors-zone', {
  url: `${MOCK_URL}/upload`,
  chunking: true,
  chunkSize: 32 * 1024,
  forceChunking: true,
  retryChunks: true,
  retryChunksLimit: 1,
  acceptedFiles: '.txt,.bin',
  maxFilesize: 1,
  hiddenInputContainer: '#errors-zone',
  folders: true,
});
document.querySelector('#errors-fail')?.addEventListener('click', () => {
  void post('/__config', { failRate: 1 });
});
document.querySelector('#errors-heal')?.addEventListener('click', () => {
  void post('/__config', { failRate: 0 });
});

// 6. Offline and network: the url is a function, so "Simulate outage" can point uploads at a dead
// address (connection refused: no HTTP response at all, like lie-fi).
let outage = false;
const network = new AnyDrop('#network-zone', {
  url: () => (outage ? 'http://127.0.0.1:9/upload' : `${MOCK_URL}/upload`),
  chunking: true,
  chunkSize: 32 * 1024,
  forceChunking: true,
  hiddenInputContainer: '#network-zone',
  folders: true,
});
document.querySelector('#network-outage')?.addEventListener('click', () => {
  outage = true;
});
document.querySelector('#network-restore')?.addEventListener('click', () => {
  outage = false;
});

// Handy for manual checks and the Playwright tests.
(window as unknown as { anydrop: Record<string, unknown> }).anydrop = {
  basic,
  tree,
  headless,
  mobile,
  errors,
  network,
  AnyDrop,
};
