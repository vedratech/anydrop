import { defineConfig, type DefaultTheme, type HeadConfig } from 'vitepress';
import typedocSidebar from '../api/generated/typedoc-sidebar.json';

const REPO = 'https://github.com/vedratech/anydrop';
const SITE = 'https://vedratech.github.io/anydrop/';
const SITE_NAME = 'AnyDrop';
const SITE_DESCRIPTION =
  'Folder upload for the browser: drag and drop folders, chunked and resumable uploads, pause and resume, retry. A JavaScript and TypeScript library that works on phones.';
const OG_IMAGE = SITE + 'og-image.png';
const OG_IMAGE_ALT =
  'AnyDrop: folder upload for the browser, chunked and resumable, works on phones';

/** Absolute, canonical URL of a page (clean URLs, no .html). */
function canonicalUrl(relativePath: string): string {
  const path = relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1');
  return SITE + path;
}

const homeJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['SoftwareApplication', 'SoftwareSourceCode'],
  name: 'AnyDrop',
  alternateName: [
    '@vedratech/anydrop-ui',
    '@vedratech/anydrop-core',
    '@vedratech/anydrop-react',
    '@vedratech/anydrop-angular',
  ],
  description: SITE_DESCRIPTION,
  url: SITE,
  image: OG_IMAGE,
  codeRepository: REPO,
  programmingLanguage: ['TypeScript', 'JavaScript'],
  license: 'https://opensource.org/licenses/MIT',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web browser',
  author: {
    '@type': 'Organization',
    name: 'Vedra Tech',
    url: 'https://github.com/vedratech',
  },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

const useCases: DefaultTheme.SidebarItem = {
  text: 'Use cases',
  items: [
    { text: 'Upload a folder in JavaScript', link: '/use-cases/upload-folder-javascript' },
    { text: 'Chunked and resumable uploads', link: '/use-cases/chunked-resumable-uploads' },
    { text: 'Upload large files (1 GB+)', link: '/use-cases/upload-large-files' },
    { text: 'Pause and resume uploads', link: '/use-cases/pause-resume-uploads' },
    { text: 'Uploads that survive a lost connection', link: '/use-cases/upload-lost-connection' },
    {
      text: 'Folder upload in React, Angular, Vue',
      link: '/use-cases/folder-upload-react-angular-vue',
    },
    {
      text: 'Chunked backend (Express, Laravel, Python, Java)',
      link: '/use-cases/chunked-upload-backend',
    },
  ],
};

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
    text: 'Frameworks',
    items: [
      { text: 'React and Next.js', link: '/guide/react' },
      { text: 'Angular', link: '/guide/angular' },
      { text: 'Other frameworks and SSR', link: '/guide/ssr-frameworks' },
    ],
  },
  useCases,
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
      { text: 'Layouts', link: '/guide/layouts' },
      { text: 'Render hooks', link: '/guide/render-hooks' },
      { text: 'Row actions and icons', link: '/guide/row-actions-icons' },
      { text: 'Languages and RTL', link: '/guide/languages' },
      { text: 'Themes', link: '/guide/themes' },
      { text: 'Theme builder', link: '/theme-builder' },
      { text: 'Mobile and iOS', link: '/guide/mobile-ios' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Events cookbook', link: '/guide/events-cookbook' },
      { text: 'Custom transport', link: '/guide/custom-transport' },
    ],
  },
  {
    text: 'More',
    items: [
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
      { text: 'Protocol (v2.0)', link: '/protocol' },
      { text: 'Express example', link: '/backend/express' },
      { text: 'Laravel example', link: '/backend/laravel' },
      { text: 'Python (FastAPI) example', link: '/backend/python' },
      { text: 'Java (Spring Boot) example', link: '/backend/java' },
    ],
  },
];

export default defineConfig({
  lang: 'en-US',
  title: SITE_NAME,
  titleTemplate: ':title | AnyDrop',
  description: SITE_DESCRIPTION,
  base: '/anydrop/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md', 'scripts/**', 'node_modules/**'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/anydrop/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#1d4ed8' }],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'folder upload, file upload, drag and drop, chunked upload, resumable upload, pause and resume, large file upload, javascript, typescript, upload library, react file upload, react folder upload, angular file upload, angular folder upload, next.js upload, fastapi file upload, python chunked upload, spring boot chunked upload, spring boot file upload, express chunked upload, laravel chunked upload',
      },
    ],
    ['meta', { name: 'author', content: 'Vedra Tech' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: OG_IMAGE_ALT }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    ['meta', { name: 'twitter:image:alt', content: OG_IMAGE_ALT }],
  ],
  sitemap: { hostname: SITE },
  transformPageData(pageData) {
    // Pages without their own description (the generated API pages) get one built from the title.
    if (!pageData.frontmatter.description && pageData.relativePath !== 'index.md') {
      const title = (pageData.title || SITE_NAME).replace(/<.*>/, '');
      pageData.description = `${title}: reference for the AnyDrop folder upload library (chunked, resumable, folders).`;
    }
  },
  transformHead({ pageData }) {
    const url = canonicalUrl(pageData.relativePath);
    const isHome = pageData.relativePath === 'index.md';
    const title = isHome
      ? 'AnyDrop: folder upload, chunked and resumable uploads for the browser'
      : `${pageData.title} | ${SITE_NAME}`;
    const description = pageData.description || SITE_DESCRIPTION;
    const head: HeadConfig[] = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ];
    if (isHome) {
      head.push(['script', { type: 'application/ld+json' }, JSON.stringify(homeJsonLd)]);
    }
    return head;
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      {
        text: 'Guide',
        link: '/guide/introduction',
        activeMatch: '^/(guide/(?!react|angular|ssr-frameworks)|size|device|use-cases)',
      },
      {
        text: 'Frameworks',
        link: '/guide/react',
        activeMatch: '^/guide/(react|angular|ssr-frameworks)',
      },
      { text: 'API', link: '/api/', activeMatch: '^/api/' },
      { text: 'Backend', link: '/backend/', activeMatch: '^/(backend|protocol)' },
      { text: 'Demo', link: '/demo' },
      { text: 'Theme builder', link: '/theme-builder' },
      { text: 'GitHub', link: REPO },
    ],
    sidebar: {
      '/api/': api,
      '/backend/': backend,
      '/protocol': backend,
      '/use-cases/': guide,
      '/guide/': guide,
      '/theme-builder': guide,
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
      copyright: 'Copyright © 2026 Vedra Tech.',
    },
  },
});
