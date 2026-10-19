import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const port = Number(process.env.PORT || 3333);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/bridge/requests') {
      const base = url.searchParams.get('base') || 'http://127.0.0.1:8080';
      let target;
      try { target = new URL('/api/requests' + (url.searchParams.has('id') ? `?id=${encodeURIComponent(url.searchParams.get('id'))}` : ''), base); }
      catch { return send(res, 400, { error: 'Enter a valid base URL, including http:// or https://' }); }
      if (!['http:', 'https:'].includes(target.protocol)) return send(res, 400, { error: 'Only HTTP and HTTPS base URLs are supported' });
      const headers = { Accept: 'application/json' };
      const apiKey = req.headers['x-strata-api-key'];
      const keyMode = req.headers['x-strata-key-mode'];
      if (apiKey) headers[keyMode === 'bearer' ? 'Authorization' : 'X-API-Key'] = keyMode === 'bearer' ? `Bearer ${apiKey}` : apiKey;
      const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(15000) });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(text);
    }
    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(publicDir, `.${requested}`);
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
    await stat(file);
    return send(res, 200, await readFile(file), mime[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return send(res, 504, { error: 'Strata API request timed out' });
    if (error.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return send(res, 502, { error: error.message || 'Unable to reach Strata API' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Strata Monitor UI listening at http://127.0.0.1:${port}`));
