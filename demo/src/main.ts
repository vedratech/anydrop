import { AnyDropCore } from '@vedratech/anydrop-core';
import { AnyDrop, VERSION } from '@vedratech/anydrop-ui';
import '@vedratech/anydrop-ui/style.css';
import '@vedratech/anydrop-ui/themes/minimal.css';
import '@vedratech/anydrop-ui/themes/rounded.css';
import '@vedratech/anydrop-ui/themes/enterprise.css';
import '@vedratech/anydrop-ui/themes/glass.css';
import { ar } from '@vedratech/anydrop-ui/locales/ar';
import { de } from '@vedratech/anydrop-ui/locales/de';
import { es } from '@vedratech/anydrop-ui/locales/es';
import { fr } from '@vedratech/anydrop-ui/locales/fr';
import { hi } from '@vedratech/anydrop-ui/locales/hi';
import { ja } from '@vedratech/anydrop-ui/locales/ja';
import { ptBR } from '@vedratech/anydrop-ui/locales/pt-BR';
import { zhCN } from '@vedratech/anydrop-ui/locales/zh-CN';

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

// 7. Customisation (decision 0021): layout, a render hook, a custom row action, icons, locales, presets.
AnyDrop.locales = { ar, de, es, fr, hi, ja, 'pt-BR': ptBR, 'zh-CN': zhCN };
const stroke = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const outline: Record<string, string> = {
  pause: stroke('M8 5v14M16 5v14'),
  resume: stroke('M7 4l12 8-12 8z'),
  retry: stroke('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5'),
  cancel: stroke('M6 6l12 12M18 6L6 18'),
  remove: stroke('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  folder: stroke('M3 6h6l2 2h10v11H3z'),
  file: stroke('M6 3h8l5 5v13H6zM14 3v5h5'),
  toggle: stroke('M9 6l6 6-6 6'),
  success: stroke('M5 12l5 5 9-10'),
  error: stroke('M12 7v6M12 17v.5'),
  copy: stroke('M9 9h11v11H9zM5 15V4h11'),
};
let liveViews = 0; // views mounted by the render hook and not yet destroyed (a leak counter)
const custom = new AnyDrop('#custom-zone', {
  url: `${MOCK_URL}/upload`,
  autoProcessQueue: false,
  chunking: true,
  chunkSize: 32 * 1024,
  forceChunking: true,
  hiddenInputContainer: '#custom-zone',
  folders: true,
  icons: { copy: outline.copy as string },
});
const customLog = document.querySelector<HTMLElement>('#custom-log');
custom.on('actionclicked', (id, target) => {
  if (customLog) customLog.textContent = `Action "${id}" on ${(target as { name: string }).name}`;
});
const pressed = (id: string, on: boolean) =>
  document.querySelector(id)?.setAttribute('aria-pressed', String(on));
const setLayout = (layout: 'list' | 'compact') => {
  custom.setOption('layout', layout);
  pressed('#custom-layout-list', layout === 'list');
  pressed('#custom-layout-compact', layout === 'compact');
};
document.querySelector('#custom-layout-list')?.addEventListener('click', () => setLayout('list'));
document
  .querySelector('#custom-layout-compact')
  ?.addEventListener('click', () => setLayout('compact'));
// A render hook that decorates the default row: a tag next to the name, undone in destroy().
let tagged = false;
document.querySelector('#custom-hook')?.addEventListener('click', () => {
  tagged = !tagged;
  pressed('#custom-hook', tagged);
  custom.setOption(
    'render',
    tagged
      ? {
          file(ctx) {
            const kind = (ctx.file.type || 'file').split('/')[0];
            const tag = ctx.html`<b class="my-tag">${kind}</b>`;
            ctx.parts.preview.querySelector('.ad-file-name')?.appendChild(tag);
            liveViews++;
            return {
              destroy() {
                tag.remove();
                liveViews--;
              },
            };
          },
        }
      : {},
  );
});
// A custom action (copy the name) and an override of the built-in "remove".
let withAction = false;
document.querySelector('#custom-action')?.addEventListener('click', () => {
  withAction = !withAction;
  pressed('#custom-action', withAction);
  custom.setOption('rowActions', {
    file: withAction
      ? [
          'pause',
          'resume',
          'retry',
          'cancel',
          {
            id: 'copy-name',
            label: 'Copy file name',
            icon: 'copy',
            when: (ctx) => ctx.status !== 'added',
            onClick: (ctx) => void navigator.clipboard?.writeText(ctx.file.name).catch(() => {}),
          },
          { id: 'remove', onClick: (ctx) => ctx.remove() },
        ]
      : ['pause', 'resume', 'retry', 'cancel', 'remove'],
  });
});
// An icon set as a function: one outline per name (null = the built-in icon).
let outlined = false;
document.querySelector('#custom-icons')?.addEventListener('click', () => {
  outlined = !outlined;
  pressed('#custom-icons', outlined);
  custom.setOption(
    'icons',
    outlined ? (name: string) => outline[name] ?? null : { copy: outline.copy },
  );
});
document.querySelector<HTMLSelectElement>('#custom-locale')?.addEventListener('change', (e) => {
  custom.setOption('locale', (e.target as HTMLSelectElement).value || null);
});
document.querySelector<HTMLSelectElement>('#custom-preset')?.addEventListener('change', (e) => {
  custom.setOption('themePreset', (e.target as HTMLSelectElement).value || null);
});
document.querySelector<HTMLSelectElement>('#custom-scheme')?.addEventListener('change', (e) => {
  custom.setOption('theme', (e.target as HTMLSelectElement).value as 'auto' | 'light' | 'dark');
});
const sample = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1700000000000 });
document.querySelector('#custom-add')?.addEventListener('click', () => {
  void custom.addFiles([
    sample('notes.txt', 'text/plain', 1200),
    sample('report.pdf', 'application/pdf', 52000),
  ]);
  void custom.addFile(sample('beach.jpg', 'image/jpeg', 800000), 'Holiday/Photos');
  void custom.addFile(sample('map.png', 'image/png', 120000), 'Holiday/Photos');
  void custom.addFile(sample('tickets.pdf', 'application/pdf', 64000), 'Holiday');
});
document.querySelector('#custom-start')?.addEventListener('click', () => {
  custom.setOption('autoProcessQueue', true);
  custom.processQueue();
});
document.querySelector('#custom-clear')?.addEventListener('click', () => {
  custom.removeAllFiles(true);
});

// Handy for manual checks and the Playwright tests.
(window as unknown as { anydrop: Record<string, unknown> }).anydrop = {
  basic,
  tree,
  headless,
  mobile,
  errors,
  network,
  custom,
  liveViews: () => liveViews,
  AnyDrop,
};
