// Same-origin proxy from /upload/* to the mock upload server. A route handler (not `rewrites`, which
// Next bakes in at build time) so the mock port, AD_PORT, is read on every request.
// In a real app, /upload is your own backend (see docs/protocol.md).
export const dynamic = 'force-dynamic';

const HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'];

async function proxy(request: Request): Promise<Response> {
  const mock = `http://localhost:${process.env.AD_PORT ?? 3001}`;
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const h of HOP) headers.delete(h);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(mock + url.pathname + url.search, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });
  const out = new Headers(upstream.headers);
  for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) {
    out.delete(h);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
