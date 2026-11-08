import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Uploads go to the same-origin path /upload, proxied to the mock upload server (AD_PORT, default 3001).
// PORT is the port of the dev and preview server (the e2e run picks its own).
const mock = `http://localhost:${process.env.AD_PORT ?? 3001}`;
const port = Number(process.env.PORT ?? 5180);
const proxy = { '/upload': mock, '/__': mock };

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true, proxy },
  preview: { port, strictPort: true, proxy },
});
