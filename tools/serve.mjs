import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = path.resolve(process.cwd(), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const relPath = urlPath === '/' ? '/index.html' : urlPath;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(ROOT, safePath);

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BREAKBEAT (AG From-Scratch Build) running at http://localhost:${PORT}`);
});
