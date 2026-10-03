import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import safeInput from './lib/safe-input.cjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

function parseServerPort(value) {
  const text = String(value ?? '');
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Static server port must be an integer in the range 1..65535');
  }
  return port;
}

function createStaticServer(rootDir) {
  const root = fs.realpathSync(rootDir);
  if (!fs.statSync(root).isDirectory()) throw new Error('Static server root must be a directory');
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      // Decode the raw request target before resolving it. URL normalization
      // would erase traversal segments before we could reject them.
      const pathname = decodeURIComponent(request.url.split(/[?#]/, 1)[0]);
      if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(pathname) ||
          pathname.split('/').some((segment) => segment.startsWith('.'))) {
        throw new Error('Invalid static path');
      }
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filename = path.extname(relativePath) ? relativePath : `${relativePath}.html`;
      const target = path.resolve(root, filename);
      // Reject outside targets here as well as in the shared no-follow reader.
      if (!target.startsWith(rootPrefix)) throw new Error('Invalid static path');
      const bytes = safeInput.readStableFileNoFollow(target, {
        rootDir: root,
        maxBytes: 32 * 1024 * 1024,
        minBytes: 0
      });
      response.writeHead(200, {
        'Content-Type': TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createStaticServer(process.argv[2]);
  server.listen(parseServerPort(process.argv[3]), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close());
  }
}

export { createStaticServer, parseServerPort };
