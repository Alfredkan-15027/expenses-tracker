// Zero-dependency static server for local development: `npm run dev` → http://localhost:5173
// Binds to 127.0.0.1 only, serves files inside the project folder only.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/plain; charset=utf-8',
};
const BLOCKED = /(^|[\\/])(\.git|node_modules|\.claude|\.dev)([\\/]|$)/;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
    if (!path || path.endsWith(sep) || path.endsWith('/')) path = join(path, 'index.html');
    const file = resolve(ROOT, path);
    if (!file.startsWith(ROOT + sep) || BLOCKED.test(path)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(500).end('Server error');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Expenses Tracker dev server → http://localhost:${PORT}  (demo data: http://localhost:${PORT}/?demo=1)`);
});
