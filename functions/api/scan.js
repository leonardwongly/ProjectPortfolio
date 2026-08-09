import { Hono } from 'hono';
import { paymentMiddleware } from '@x402/hono';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';

const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';
const DEFAULT_NETWORK = 'eip155:84532';
const DEFAULT_PRICE = '$0.01';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_NETWORK_LENGTH = 64;
const MAX_PRICE_LENGTH = 32;
const MAX_FACILITATOR_URL_LENGTH = 2048;
const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/u;
const NETWORK_PATTERN = /^eip155:\d+$/u;
const FACILITATOR_HOST_ALLOWLIST = new Set(['x402.org']);

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

function runtimeEnv(env = {}) {
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};
  return {
    ...processEnv,
    ...env
  };
}

function httpsUrl(value, fieldName) {
  if (value.length > MAX_FACILITATOR_URL_LENGTH) {
    throw new Error(`${fieldName} must not exceed ${MAX_FACILITATOR_URL_LENGTH} characters`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be an absolute HTTPS URL`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, '');
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.port ||
    !FACILITATOR_HOST_ALLOWLIST.has(hostname)
  ) {
    throw new Error(`${fieldName} must be an absolute HTTPS URL`);
  }

  return parsed.toString().replace(/\/$/u, '');
}

export function getX402Config(env = {}) {
  const values = runtimeEnv(env);
  const payTo = typeof values.X402_PAY_TO === 'string' ? values.X402_PAY_TO.trim() : '';
  if (!WALLET_PATTERN.test(payTo)) {
    throw new Error('X402_PAY_TO must be a valid EVM wallet address');
  }

  const network = typeof values.X402_NETWORK === 'string' && values.X402_NETWORK.trim()
    ? values.X402_NETWORK.trim()
    : DEFAULT_NETWORK;
  if (!NETWORK_PATTERN.test(network)) {
    throw new Error('X402_NETWORK must be a CAIP-2 EVM network such as eip155:84532');
  }
  if (network.length > MAX_NETWORK_LENGTH) {
    throw new Error(`X402_NETWORK must not exceed ${MAX_NETWORK_LENGTH} characters`);
  }

  const price = typeof values.X402_PRICE === 'string' && values.X402_PRICE.trim()
    ? values.X402_PRICE.trim()
    : DEFAULT_PRICE;
  if (!/^\$\d+(?:\.\d{1,6})?$/u.test(price)) {
    throw new Error('X402_PRICE must be a dollar amount such as $0.01');
  }
  if (price.length > MAX_PRICE_LENGTH) {
    throw new Error(`X402_PRICE must not exceed ${MAX_PRICE_LENGTH} characters`);
  }

  return {
    facilitatorUrl: httpsUrl(
      typeof values.X402_FACILITATOR_URL === 'string' && values.X402_FACILITATOR_URL.trim()
        ? values.X402_FACILITATOR_URL.trim()
        : DEFAULT_FACILITATOR_URL,
      'X402_FACILITATOR_URL'
    ),
    network,
    payTo,
    price
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function createResourceServer(config, facilitatorClient) {
  const client = facilitatorClient ?? new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const server = new x402ResourceServer(client);
  return registerExactEvmScheme(server, { networks: [config.network] });
}

/**
 * Parse a JSON request body while retaining at most MAX_BODY_BYTES in memory.
 * Content-Length is only an optimization: streamed/chunked requests are
 * counted as bytes arrive and are rejected as soon as the limit is crossed.
 */
export async function readBoundedJson(request) {
  const header = typeof request.header === 'function'
    ? request.header.bind(request)
    : (name) => request.headers?.get(name);
  const declaredLength = header('content-length');
  if (/^\s*\d+\s*$/u.test(declaredLength ?? '') && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }

  const body = (request.raw ?? request)?.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Request body must be valid JSON');
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(chunk);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original parsing/size error is the actionable response.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Request body must be valid JSON');
  }
  return JSON.parse(text);
}

export function createScanApp(env = {}, { facilitatorClient, server } = {}) {
  const config = getX402Config(env);
  const resourceServer = server ?? createResourceServer(config, facilitatorClient);
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
    await next();
  });

  app.use(
    '*',
    paymentMiddleware(
      {
        'POST /api/scan': {
          accepts: {
            scheme: 'exact',
            price: config.price,
            network: config.network,
            payTo: config.payTo,
            maxTimeoutSeconds: 300
          },
          description: 'Validate an AgentReady scan request for a public HTTPS site; target analysis is not yet performed',
          mimeType: 'application/json'
        }
      },
      resourceServer
    )
  );

  app.options('/api/scan', (c) => new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type, Payment-Signature, X-Payment',
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  }));

  app.post('/api/scan', async (c) => {
    let payload;
    try {
      payload = await readBoundedJson(c.req);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return jsonError('Request body is too large', 413);
      }
      return jsonError('Request body must be valid JSON', 400);
    }

    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return jsonError('url must be an absolute HTTPS URL', 400);
    }

    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
      return jsonError('url must be an absolute HTTPS URL', 400);
    }

    return c.json({
      ok: true,
      service: 'agent-ready-scan',
      url: parsedUrl.toString(),
      payment: {
        network: config.network,
        price: config.price,
        protocol: 'x402'
      }
    }, 200, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
  });

  return app;
}

const apps = new Map();

function appFor(env) {
  const config = getX402Config(env);
  const key = `${config.facilitatorUrl}|${config.network}|${config.payTo}|${config.price}`;
  let app = apps.get(key);
  if (!app) {
    app = createScanApp(env);
    apps.set(key, app);
  }
  return app;
}

export async function onRequest({ request, env, ctx }) {
  try {
    return await appFor(env).fetch(request, env, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'x402 configuration is invalid';
    if (message.startsWith('X402_')) {
      return jsonError('x402 payment configuration is unavailable', 503);
    }
    throw error;
  }
}

export { DEFAULT_FACILITATOR_URL, DEFAULT_NETWORK, DEFAULT_PRICE };
