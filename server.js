// Zero-dependency static server: `node server.js`, then open the printed URL.
// Also exposes the local face dataset so the browser can load it without any
// upload step:  GET /api/dataset  ->  { men: [...names], women: [...names] }
//               GET /dataset/men/<file>, /dataset/women/<file>

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATASET = process.env.DATASET_DIR || path.join(ROOT, '..', 'man-woman-dataset', 'data');
const PORT = +(process.env.PORT || 4180);
const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const CLASSES = { men: 'men', women: 'women' };

function listClass(dir) {
  try { return fs.readdirSync(path.join(DATASET, dir)).filter((n) => IMAGE_RE.test(n)).sort(); }
  catch { return []; }
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// Resolve `rel` under `base`, refusing anything that escapes it.
function safeJoin(base, rel) {
  const full = path.resolve(base, '.' + path.sep + rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/dataset') {
    return send(res, 200, JSON.stringify({ men: listClass(CLASSES.men), women: listClass(CLASSES.women) }), MIME['.json']);
  }
  if (p.startsWith('/dataset/')) {
    const [, , cls, ...rest] = p.split('/');
    if (!CLASSES[cls] || !rest.length) return send(res, 404, 'not found');
    const file = safeJoin(path.join(DATASET, CLASSES[cls]), rest.join('/'));
    return file ? serveFile(res, file) : send(res, 403, 'forbidden');
  }
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const file = safeJoin(ROOT, rel);
  // never serve the server code, tests, or anything outside web/
  if (!file || rel.startsWith('test') || rel === 'server.js') return send(res, 404, 'not found');
  serveFile(res, file);
});

server.listen(PORT, () => {
  console.log(`fuitclassify web  ->  http://localhost:${PORT}`);
  console.log(`dataset: ${DATASET}  (men ${listClass('men').length}, women ${listClass('women').length})`);
});
