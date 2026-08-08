import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  assertPublicDnsResolution,
  createPinnedLookup,
  fetchInjectedHttpsBytes,
  isBlockedIpAddress,
  normalizePublicHttpsUrl,
  requestPinnedHttpsBytes
} from '../../scripts/lib/network-safety.mjs';

const PUBLIC_RECORD = { address: '93.184.216.34', family: 4 };

function makeRequest({ body = '', headers = {}, status = 200, onOptions = () => {} } = {}) {
  return (_url, options, onResponse) => {
    onOptions(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => {
      options.lookup('public.example', { family: 4 }, (error, address, family) => {
        if (error) {
          request.emit('error', error);
          return;
        }
        assert.deepEqual({ address, family }, PUBLIC_RECORD);
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = status;
        response.statusMessage = status === 200 ? 'OK' : 'Error';
        response.headers = headers;
        onResponse(response);
      });
    };
    return request;
  };
}

test('DNS validation rejects empty, malformed, invalid, mismatched, and unsafe answers', async (t) => {
  const parsed = normalizePublicHttpsUrl('https://public.example/status');
  const cases = [
    { name: 'empty answer', records: [], pattern: /returned no addresses/ },
    { name: 'non-object record', records: ['93.184.216.34'], pattern: /malformed record at index 0/ },
    { name: 'invalid address', records: [{ address: 'not-an-ip', family: 4 }], pattern: /invalid IP address/ },
    { name: 'bracketed address', records: [{ address: '[2606:4700:4700::1111]', family: 6 }], pattern: /invalid IP address/ },
    { name: 'invalid family', records: [{ address: '93.184.216.34', family: 0 }], pattern: /invalid address family/ },
    { name: 'mismatched family', records: [{ address: '93.184.216.34', family: 6 }], pattern: /address\/family mismatch/ },
    { name: 'zone-scoped address', records: [{ address: '2606:4700:4700::1111%lo0', family: 6 }], pattern: /resolved to blocked address/ }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await assert.rejects(
        () => assertPublicDnsResolution(parsed, { lookupImpl: async () => fixture.records }),
        fixture.pattern
      );
    });
  }
});

test('IP policy blocks special-purpose ranges that are not globally reachable', () => {
  for (const address of [
    '192.88.99.0',
    '192.88.99.255'
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }

  for (const address of [
    'fec0::1',
    'feff:ffff::1',
    '2001:2::1',
    '2001:10::1',
    '2001:1f:ffff::1',
    '2001:20::1',
    '2001:2f:ffff::1',
    '3fff::1',
    '3fff:fff::1',
    '5f00::1',
    '5f00:ffff::1',
    '400::1',
    '800::1',
    '1000::1',
    '4000::1',
    '6000::1',
    'fe80::1%lo0',
    '2606:4700:4700::1111%lo0',
    '::93.184.216.34',
    '::ffff:127.0.0.1',
    '64:ff9b::127.0.0.1',
    '64:ff9b:1::7f00:1',
    '64:ff9b:1:ffff::1',
    '64:ff9b:0:ffff::1',
    '64:ff9b:2::1'
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }

  assert.equal(isBlockedIpAddress('192.88.98.255'), false);
  assert.equal(isBlockedIpAddress('192.88.100.0'), false);
  assert.equal(isBlockedIpAddress('2001:30::1'), false);
  assert.equal(isBlockedIpAddress('3fff:1000::1'), false);
  assert.equal(isBlockedIpAddress('::ffff:93.184.216.34'), false);
  assert.equal(isBlockedIpAddress('64:ff9b::93.184.216.34'), false);
  assert.equal(isBlockedIpAddress('2606:4700:4700::1111'), false);
});

test('injected HTTPS transport requires an explicit validated DNS seam', async () => {
  await assert.rejects(
    () => fetchInjectedHttpsBytes('https://public.example/file.js', {
      fetchImpl: async () => new Response('safe'),
      timeoutMs: 1000,
      maxBytes: 64
    }),
    /requires lookupImpl for DNS validation/
  );
});

test('pinned lookup refuses host substitution after DNS approval', async () => {
  const lookup = createPinnedLookup([PUBLIC_RECORD], 'public.example');
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      lookup('attacker.example', {}, (error) => error ? reject(error) : resolve());
    }),
    /refused unexpected hostname attacker\.example/
  );
});

test('pinned HTTPS request reuses the approved address without a second resolver call', async () => {
  let resolverCalls = 0;
  let pinnedLookupSeen = false;
  const result = await requestPinnedHttpsBytes('https://public.example/file.js', {
    lookupImpl: async () => {
      resolverCalls += 1;
      return [PUBLIC_RECORD];
    },
    requestImpl: makeRequest({
      body: 'safe bytes',
      onOptions: (options) => {
        pinnedLookupSeen = typeof options.lookup === 'function';
        assert.equal(options.agent, false);
        assert.equal(options.servername, 'public.example');
      }
    }),
    timeoutMs: 1000,
    maxBytes: 64
  });

  assert.equal(resolverCalls, 1);
  assert.equal(pinnedLookupSeen, true);
  assert.equal(result.bytes.toString('utf8'), 'safe bytes');
  assert.equal(result.status, 200);
});

test('pinned HTTPS request enforces declared and streamed byte limits', async (t) => {
  await t.test('declared Content-Length', async () => {
    await assert.rejects(
      () => requestPinnedHttpsBytes('https://public.example/file.js', {
        lookupImpl: async () => [PUBLIC_RECORD],
        requestImpl: makeRequest({ body: 'small', headers: { 'content-length': '65' } }),
        timeoutMs: 1000,
        maxBytes: 64
      }),
      /exceeds 64 byte limit/
    );
  });

  await t.test('chunked response', async () => {
    await assert.rejects(
      () => requestPinnedHttpsBytes('https://public.example/file.js', {
        lookupImpl: async () => [PUBLIC_RECORD],
        requestImpl: makeRequest({ body: 'x'.repeat(65) }),
        timeoutMs: 1000,
        maxBytes: 64
      }),
      /exceeds 64 byte limit/
    );
  });
});

test('pinned HTTPS wall timeout covers DNS, response headers, and body completion', { timeout: 2000 }, async (t) => {
  await t.test('DNS', async () => {
    await assert.rejects(
      () => requestPinnedHttpsBytes('https://public.example/file.js', {
        lookupImpl: async () => await new Promise(() => {}),
        requestImpl: () => assert.fail('request must not start while DNS is pending'),
        timeoutMs: 10,
        maxBytes: 64
      }),
      (error) => error.name === 'AbortError' && /after 10ms/.test(error.message)
    );
  });

  await t.test('headers', async () => {
    await assert.rejects(
      () => requestPinnedHttpsBytes('https://public.example/file.js', {
        lookupImpl: async () => [PUBLIC_RECORD],
        requestImpl: () => {
          const request = new EventEmitter();
          request.end = () => {};
          request.destroy = () => {};
          return request;
        },
        timeoutMs: 10,
        maxBytes: 64
      }),
      (error) => error.name === 'AbortError' && /after 10ms/.test(error.message)
    );
  });

  await t.test('body', async () => {
    await assert.rejects(
      () => requestPinnedHttpsBytes('https://public.example/file.js', {
        lookupImpl: async () => [PUBLIC_RECORD],
        requestImpl: (_url, _options, onResponse) => {
          const request = new EventEmitter();
          request.end = () => {
            const response = new EventEmitter();
            response.statusCode = 200;
            response.statusMessage = 'OK';
            response.headers = {};
            response.destroy = () => {};
            onResponse(response);
            response.emit('data', Buffer.from('partial'));
          };
          request.destroy = () => {};
          return request;
        },
        timeoutMs: 10,
        maxBytes: 64
      }),
      (error) => error.name === 'AbortError' && /after 10ms/.test(error.message)
    );
  });
});
