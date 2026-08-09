import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function readOpenApi(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function payableOperations(document) {
  return Object.entries(document.paths ?? {}).flatMap(([pathName, pathItem]) =>
    Object.entries(pathItem ?? {})
      .filter(([method, operation]) => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method) && operation?.['x-payment-info'])
      .map(([method, operation]) => ({ pathName, method, payment: operation['x-payment-info'] }))
  );
}

test('MPP OpenAPI discovery does not advertise unimplemented payable operations', () => {
  const source = readOpenApi('src/openapi.json');
  const generated = readOpenApi('openapi.json');

  assert.deepEqual(generated, source);
  assert.equal(generated.openapi, '3.1.0');
  assert.ok(generated.info?.title);

  const operations = payableOperations(generated);
  assert.deepEqual(operations, []);
  assert.ok(generated.paths?.['/api/scan']?.post, 'the implemented x402 scan route must remain discoverable');
  assert.deepEqual(generated.paths['/api/scan'].post['x-x402-payment'], {
    scheme: 'exact',
    network: 'eip155:84532',
    price: '$0.01',
    recipient: 'server-configured'
  });
  assert.equal(Object.hasOwn(generated.paths, '/api/portfolio-review'), false);

  assert.ok(Array.isArray(generated['x-service-info']?.categories));
  assert.ok(generated['x-service-info'].categories.length > 0);

  const headers = fs.readFileSync(path.join(projectRoot, '_headers'), 'utf8');
  const block = headers.slice(headers.indexOf('/openapi.json'));
  assert.match(block, /Content-Type: application\/json; charset=utf-8/);
  assert.match(block, /Access-Control-Allow-Origin: \*/);
});
