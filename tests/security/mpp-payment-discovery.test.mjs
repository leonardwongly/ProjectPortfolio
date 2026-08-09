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

test('MPP OpenAPI discovery is published and generated from the source document', () => {
  const source = readOpenApi('src/openapi.json');
  const generated = readOpenApi('openapi.json');

  assert.deepEqual(generated, source);
  assert.equal(generated.openapi, '3.1.0');
  assert.ok(generated.info?.title);

  const operations = payableOperations(generated);
  assert.ok(operations.length > 0, 'expected at least one payable operation');

  const intents = new Set(['charge', 'session']);
  const methods = new Set(['tempo', 'stripe', 'lightning', 'card']);
  operations.forEach(({ pathName, method, payment }) => {
    assert.ok(intents.has(payment.intent), `${method.toUpperCase()} ${pathName} has an unsupported payment intent`);
    assert.ok(methods.has(payment.method), `${method.toUpperCase()} ${pathName} has an unsupported payment method`);
    assert.equal(typeof payment.amount, 'number', `${method.toUpperCase()} ${pathName} must declare a numeric amount`);
    assert.ok(Number.isFinite(payment.amount) && payment.amount > 0, `${method.toUpperCase()} ${pathName} must declare a positive amount`);
  });

  assert.ok(Array.isArray(generated['x-service-info']?.categories));
  assert.ok(generated['x-service-info'].categories.length > 0);
});
