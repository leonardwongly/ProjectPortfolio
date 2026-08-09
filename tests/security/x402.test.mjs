import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const functionSource = fs.readFileSync('functions/api/scan.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('x402 scan function uses the supported Hono middleware and server scheme', () => {
  assert.equal(packageJson.dependencies['@x402/hono'], '2.21.0');
  assert.equal(packageJson.dependencies['@x402/core'], '2.21.0');
  assert.equal(packageJson.dependencies['@x402/evm'], '2.21.0');
  assert.match(functionSource, /paymentMiddleware/);
  assert.match(functionSource, /HTTPFacilitatorClient/);
  assert.match(functionSource, /registerExactEvmScheme/);
});

test('x402 scan route requires a validated wallet and protects POST /api/scan', () => {
  assert.match(functionSource, /X402_PAY_TO/);
  assert.match(functionSource, /WALLET_PATTERN/);
  assert.match(functionSource, /'POST \/api\/scan'/);
  assert.match(functionSource, /app\.post\('\/api\/scan'/);
  assert.match(functionSource, /price: config\.price/);
  assert.match(functionSource, /network: config\.network/);
  assert.match(functionSource, /payTo: config\.payTo/);
});

test('x402 configuration defaults to the public facilitator and Base Sepolia', () => {
  assert.match(functionSource, /https:\/\/x402\.org\/facilitator/);
  assert.match(functionSource, /eip155:84532/);
  assert.match(functionSource, /503/);
});

test('unpaid scan requests receive x402 payment requirements', async () => {
  const { createScanApp } = await import('../../functions/api/scan.js');
  const facilitator = {
    async getSupported() {
      return {
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }]
      };
    }
  };
  const app = createScanApp(
    { X402_PAY_TO: '0x1111111111111111111111111111111111111111' },
    { facilitatorClient: facilitator }
  );
  const response = await app.request('https://example.test/api/scan', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' })
  });

  assert.equal(response.status, 402);
  const encodedRequirements = response.headers.get('payment-required');
  assert.ok(encodedRequirements, 'expected the v2 PAYMENT-REQUIRED header');
  const requirements = JSON.parse(Buffer.from(encodedRequirements, 'base64').toString('utf8'));
  assert.equal(requirements.x402Version, 2);
  assert.equal(requirements.accepts[0].network, 'eip155:84532');
  assert.equal(requirements.accepts[0].payTo, '0x1111111111111111111111111111111111111111');
});

test('missing wallet configuration fails closed before exposing the route', async () => {
  const { onRequest } = await import('../../functions/api/scan.js');
  const response = await onRequest({
    request: new Request('https://example.test/api/scan', { method: 'POST' }),
    env: { X402_PAY_TO: '' }
  });

  assert.equal(response.status, 503);
});

test('bounded JSON parsing rejects an oversized streamed body without Content-Length', async () => {
  const { readBoundedJson } = await import('../../functions/api/scan.js');
  const body = JSON.stringify({ url: 'https://example.com', padding: 'x'.repeat(16 * 1024) });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  const request = new Request('https://example.test/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half'
  });

  assert.equal(request.headers.get('content-length'), null);
  await assert.rejects(
    () => readBoundedJson({ header: (name) => request.headers.get(name), raw: request }),
    { name: 'RequestBodyTooLargeError', message: 'Request body is too large' }
  );
});

test('bounded JSON parsing counts multiple chunks toward the byte limit', async () => {
  const { readBoundedJson } = await import('../../functions/api/scan.js');
  const chunks = [
    new TextEncoder().encode('{"url":"https://example.com","padding":"'),
    new TextEncoder().encode('x'.repeat(16 * 1024)),
    new TextEncoder().encode('"}')
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  const request = new Request('https://example.test/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half'
  });

  await assert.rejects(
    () => readBoundedJson(request),
    { name: 'RequestBodyTooLargeError' }
  );
});

test('facilitator and scalar config values are bounded and host-allowlisted', async () => {
  const { getX402Config } = await import('../../functions/api/scan.js');
  const wallet = '0x1111111111111111111111111111111111111111';

  assert.throws(
    () => getX402Config({
      X402_PAY_TO: wallet,
      X402_FACILITATOR_URL: 'https://127.0.0.1/facilitator'
    }),
    /X402_FACILITATOR_URL must be an absolute HTTPS URL/
  );
  assert.throws(
    () => getX402Config({ X402_PAY_TO: wallet, X402_NETWORK: `eip155:${'9'.repeat(64)}` }),
    /X402_NETWORK must not exceed/
  );
  assert.throws(
    () => getX402Config({ X402_PAY_TO: wallet, X402_PRICE: `$${'9'.repeat(40)}` }),
    /X402_PRICE must not exceed/
  );
});
