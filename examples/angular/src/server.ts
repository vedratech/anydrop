import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { request } from 'node:http';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Same-origin proxy to the upload server (e2e/mock-server): /upload/* (chunks, manifest, status,
 * finalize) and /__config. The port comes from AD_PORT, like the e2e runs (decision 0015).
 */
app.use(['/upload', '/__config'], (req, res) => {
  const upstream = request(
    {
      host: '127.0.0.1',
      port: Number(process.env['AD_PORT'] || 3100),
      method: req.method,
      path: req.originalUrl,
      headers: { ...req.headers, host: `127.0.0.1:${process.env['AD_PORT'] || 3100}` },
    },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('upload server not reachable');
  });
  req.pipe(upstream);
});

/** Serve static files from /browser. */
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

/** Handle all other requests by rendering the Angular application. */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/** Starts the server when this module is the entry point. PORT defaults to 4000. */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/** Request handler used by the Angular CLI (dev server and build). */
export const reqHandler = createNodeRequestHandler(app);
