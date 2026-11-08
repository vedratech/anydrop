import { defineConfig, type DefaultTheme } from 'vitepress';
import typedocSidebar from '../api/generated/typedoc-sidebar.json';

const REPO = 'https://github.com/vedratech/anydrop';

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'Introduction', link: '/guide/introduction' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Quick start (UI)', link: '/guide/quick-start' },
      { text: 'Headless core', link: '/guide/headless-core' },
    ],
  },
  {
    text: 'Uploading',
    items: [
      { text: 'Folders and the tree', link: '/guide/folders' },
      { text: 'Chunked uploads', link: '/guide/chunked-uploads' },
      { text: 'Pause and resume', link: '/guide/pause-resume' },
      { text: 'Resume after reload', link: '/guide/resume-after-reload' },
      { text: 'Offline and connectivity', link: '/guide/offline' },
      { text: 'Errors and retry', link: '/guide/errors-retry' },
      { text: 'Validation', link: '/guide/validation' },
    ],
  },
  {
    text: 'The user interface',
    items: [
      { text: 'Image previews and resizing', link: '/guide/previews' },
      { text: 'Customising the UI', link: '/guide/customising-ui' },
      { text: 'Mobile and iOS', link: '/guide/mobile-ios' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Events cookbook', link: '/guide/events-cookbook' },
      { text: 'Custom transport', link: '/guide/custom-transport' },
      { text: 'SSR and frameworks', link: '/guide/ssr-frameworks' },
    ],
  },
  {
    text: 'More',
    items: [
      { text: 'Migrating from Dropzone', link: '/migrating-from-dropzone' },
      { text: 'Size comparison', link: '/size-comparison' },
      { text: 'FAQ and troubleshooting', link: '/guide/faq' },
    ],
  },
  {
    text: 'Contributing / Testing',
    items: [{ text: 'Real-device checks', link: '/device-checks' }],
  },
];

const api: DefaultTheme.SidebarItem[] = [
  {
    text: 'Reference',
    items: [
      { text: 'Overview', link: '/api/' },
      { text: 'Options', link: '/api/options' },
      { text: 'Methods', link: '/api/methods' },
      { text: 'Events', link: '/api/events' },
      { text: 'Error codes', link: '/api/error-codes' },
      { text: 'Types', link: '/api/types' },
    ],
  },
  {
    text: 'Generated from the source',
    collapsed: false,
    items: typedocSidebar as DefaultTheme.SidebarItem[],
  },
];

const backend: DefaultTheme.SidebarItem[] = [
  {
    text: 'Backend',
    items: [
      { text: 'Overview', link: '/backend/' },
      { text: 'Protocol (v1.4)', link: '/protocol' },
      { text: 'Express example', link: '/backend/express' },
      { text: 'Laravel example', link: '/backend/laravel' },
    ],
  },
];

export default defineConfig({
  lang: 'en-US',
  title: 'AnyDrop',
  description:
    'Folder-first file uploads for the browser, configured like Dropzone. Chunked, resumable, works on phones.',
  base: '/anydrop/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md', 'scripts/**', 'node_modules/**'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/anydrop/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#1d4ed8' }],
    ['meta', { property: 'og:title', content: 'AnyDrop' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Folder-first file uploads for the browser, configured like Dropzone.',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      {
        text: 'Guide',
        link: '/guide/introduction',
        activeMatch: '^/(guide|migrating|size|device)',
      },
      { text: 'API', link: '/api/', activeMatch: '^/api/' },
      { text: 'Backend', link: '/backend/', activeMatch: '^/(backend|protocol)' },
      { text: 'Demo', link: '/demo' },
      { text: 'GitHub', link: REPO },
    ],
    sidebar: {
      '/api/': api,
      '/backend/': backend,
      '/protocol': backend,
      '/guide/': guide,
      '/migrating-from-dropzone': guide,
      '/size-comparison': guide,
      '/device-checks': guide,
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    lastUpdated: { text: 'Last updated' },
    outline: { level: [2, 3] },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Jayesh Gupta. Parts adapted from Dropzone (MIT).',
    },
  },
});
