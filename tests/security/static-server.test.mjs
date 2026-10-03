import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import safeInput from '../../scripts/lib/safe-input.cjs';
import { createStaticServer, parseServerPort } from '../../scripts/serve-static.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-server-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(root, 'work.html'), '<h1>Work</h1>');
  fs.mkdirSync(path.join(root, 'css'));
  fs.writeFileSync(path.join(root, 'css', 'offline.css'), 'html { color: black; }');
  const server = createStaticServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    request(target, method = 'GET') {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: target, method }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.end();
      });
    }
  };
}

test('static server serves deployment bytes, clean URLs, MIME types and HEAD reliably', async (t) => {
  const { root, request } = await fixture(t);
  fs.writeFileSync(path.join(root, 'asset.bin'), 'binary');
  fs.mkdirSync(path.join(root, 'guides'));
  fs.writeFileSync(path.join(root, 'guides', 'intro.html'), '<h1>Nested guide</h1>');
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.equal(home.body, '<h1>Home</h1>');
  assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(home.headers['cache-control'], 'no-store');
  assert.equal((await request('/work?query=1')).body, '<h1>Work</h1>');
  assert.equal((await request('/guides/intro?query=1')).body, '<h1>Nested guide</h1>');
  assert.equal((await request('/css/offline.css')).body, 'html { color: black; }');
  assert.equal((await request('/css/offline.css')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await request('/asset.bin')).headers['content-type'], 'application/octet-stream');
  const head = await request('/index.html', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], String(Buffer.byteLength(home.body)));
  const responses = await Promise.all(Array.from({ length: 100 }, () => request('/index.html')));
  assert.ok(responses.every((response) => response.status === 200 && response.body === home.body));
});

test('static server rejects absolute URL paths and prefix siblings before entering the file reader', async (t) => {
  const { root, request } = await fixture(t);
  const sibling = `${root}-sibling`;
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'private.html'), 'outside-root canary');
  t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  const siblingFile = path.join(fs.realpathSync(sibling), 'private.html');
  const originalRead = safeInput.readStableFileNoFollow;
  const reader = t.mock.method(safeInput, 'readStableFileNoFollow', (...args) => originalRead(...args));

  for (const target of [
    '//index.html',
    '///index.html',
    '/%2findex.html',
    '/%2Findex.html',
    '/%2f%2findex.html',
    `/${siblingFile}`,
    `/%2f${siblingFile.slice(1).replaceAll('/', '%2f')}`,
    `/../${path.basename(sibling)}/private.html`,
    `/%2e%2e/${path.basename(sibling)}/private.html`
  ]) {
    const response = await request(target);
    assert.equal(response.status, 404, target);
    assert.equal(response.body, '', 'the outside canary is never served');
    assert.equal(reader.mock.callCount(), 0, `${target} is rejected before reader entry`);
  }

  assert.equal((await request('/work')).body, '<h1>Work</h1>');
  assert.equal((await request('/css/offline.css')).body, 'html { color: black; }');
  assert.equal(reader.mock.callCount(), 2, 'normal routes still enter the guarded reader');
});

test('static server supports the filesystem root without constructing a double-separator prefix', (t) => {
  const filesystemRoot = path.parse(process.cwd()).root;
  const reader = t.mock.method(safeInput, 'readStableFileNoFollow', () => Buffer.from('fixture stylesheet'));
  const server = createStaticServer(filesystemRoot);
  let status;
  let body;
  server.emit('request', { method: 'GET', url: '/nested/asset.css' }, {
    writeHead(code) { status = code; },
    end(bytes) { body = bytes.toString(); }
  });
  assert.equal(status, 200);
  assert.equal(body, 'fixture stylesheet');
  assert.equal(reader.mock.callCount(), 1);
  assert.equal(reader.mock.calls[0].arguments[0], path.join(filesystemRoot, 'nested', 'asset.css'));
  assert.equal(reader.mock.calls[0].arguments[1].rootDir, filesystemRoot);
});

test('static server rejects traversal, hidden paths, symlink escapes and non-regular files', async (t) => {
  const { root, request } = await fixture(t);
  fs.writeFileSync(path.join(root, '.secret'), 'private');
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'linked.html'));
  fs.symlinkSync(path.join(root, 'css'), path.join(root, 'linked-css'));
  for (const target of ['/../index.html', '/%2e%2e/index.html', '/%2e/secret', '/.secret', '/%00.html', '/%5cindex.html', '/bad%zz', '/missing.html', '/linked.html', '/linked-css/offline.css', '/css/']) {
    assert.equal((await request(target)).status, 404, target);
  }
  const post = await request('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('static server bounds reads and validates configured roots and listener ports', async (t) => {
  const { root, request } = await fixture(t);
  const fd = fs.openSync(path.join(root, 'huge.bin'), 'w');
  fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1);
  fs.closeSync(fd);
  assert.equal((await request('/huge.bin')).status, 404);
  assert.throws(() => createStaticServer(path.join(root, 'index.html')), /must be a directory/);
  assert.equal(parseServerPort('4173'), 4173);
  for (const value of ['', undefined, '0', '65536', '1.5', ' 4173', '4173;command']) {
    assert.throws(() => parseServerPort(value), /range 1\.\.65535/);
  }
});
