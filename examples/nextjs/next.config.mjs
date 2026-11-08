import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Uploads go to the same-origin path /upload, which app/upload/[[...path]]/route.ts proxies to the
// mock upload server (AD_PORT, default 3001).
/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace root, so Next resolves the linked @vedratech packages.
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
