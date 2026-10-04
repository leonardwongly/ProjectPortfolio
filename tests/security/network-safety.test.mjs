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

test('every DNS answer is validated before either transport starts', async () => {
  for (const records of [[PUBLIC_RECORD, { address: '127.0.0.1', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }, PUBLIC_RECORD], [PUBLIC_RECORD, { address: 'bad', family: 4 }]]) {
    let calls = 0;
    const transport = () => { calls += 1; assert.fail('denied DNS must not start transport'); };
    await assert.rejects(() => requestPinnedHttpsBytes('https://public.example/', {
      lookupImpl: async () => records, requestImpl: transport
    }), /blocked address|invalid IP/);
    await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', {
      lookupImpl: async () => records, fetchImpl: transport
    }), /blocked address|invalid IP/);
    assert.equal(calls, 0);
  }
  const records = [PUBLIC_RECORD, { address: '2606:4700:4700::1111', family: 6 }];
  assert.deepEqual(await assertPublicDnsResolution(new URL('https://public.example/'), {
    lookupImpl: async () => records
  }), records);
});

test('pinned byte accounting is cumulative and destroys both streams on overflow', async () => {
  for (const { chunks, headers, overflow } of [
    { chunks: [Buffer.alloc(32, 'a'), Buffer.alloc(32, 'b')], headers: { 'content-length': '64' }, overflow: false },
    { chunks: [Buffer.alloc(32, 'a'), Buffer.alloc(33, 'b')], headers: {}, overflow: true },
    { chunks: [Buffer.from('small')], headers: { 'content-length': '65' }, overflow: true }
  ]) {
    let requestDestroyed = 0;
    let responseDestroyed = 0;
    const operation = requestPinnedHttpsBytes('https://public.example/', {
      lookupImpl: async () => [PUBLIC_RECORD], maxBytes: 64, timeoutMs: 1000,
      requestImpl: (_url, _options, onResponse) => {
        const request = new EventEmitter();
        request.destroy = () => { requestDestroyed += 1; };
        request.end = () => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = headers;
          response.destroy = () => { responseDestroyed += 1; };
          onResponse(response);
          for (const chunk of chunks) response.emit('data', chunk);
          response.emit('end');
        };
        return request;
      }
    });
    if (overflow) {
      await assert.rejects(() => operation, /exceeds 64 byte limit/);
      assert.equal(requestDestroyed, 1);
      assert.equal(responseDestroyed, 1);
    } else {
      assert.deepEqual((await operation).bytes, Buffer.concat(chunks));
      assert.equal(requestDestroyed, 0);
      assert.equal(responseDestroyed, 0);
    }
  }
});

test('timeouts prevent late DNS transport and destroy late headers and pending bodies', { timeout: 2000 }, async () => {
  for (const injected of [false, true]) {
    let resolveDns;
    let calls = 0;
    const options = { timeoutMs: 10, lookupImpl: () => new Promise((resolve) => { resolveDns = resolve; }) };
    const operation = injected
      ? fetchInjectedHttpsBytes('https://public.example/', { ...options, fetchImpl: async () => { calls += 1; return new Response('late'); } })
      : requestPinnedHttpsBytes('https://public.example/', { ...options, requestImpl: () => { calls += 1; assert.fail('late DNS'); } });
    await assert.rejects(() => operation, { name: 'AbortError' });
    resolveDns([PUBLIC_RECORD]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0, `late DNS transport injected=${injected}`);
  }
  for (const earlyBody of [false, true]) {
    let deliver;
    let requestsDestroyed = 0;
    let responsesDestroyed = 0;
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = {};
    response.destroy = () => { responsesDestroyed += 1; };
    await assert.rejects(() => requestPinnedHttpsBytes('https://public.example/', {
      timeoutMs: 10, lookupImpl: async () => [PUBLIC_RECORD],
      requestImpl: (_url, _options, onResponse) => {
        deliver = onResponse;
        const request = new EventEmitter();
        request.destroy = () => { requestsDestroyed += 1; };
        request.end = () => { if (earlyBody) { onResponse(response); response.emit('data', Buffer.from('partial')); } };
        return request;
      }
    }), { name: 'AbortError' });
    assert.equal(requestsDestroyed, 1);
    if (!earlyBody) deliver(response);
    assert.equal(responsesDestroyed, 1);
  }
});

test('injected HTTPS preserves bytes, options and transport failures with bounded reader cleanup', async () => {
  const bytes = Buffer.from([0xff, 0x00, 0x61]);
  const base = { lookupImpl: async () => [PUBLIC_RECORD], maxBytes: 64, timeoutMs: 1000 };
  const result = await fetchInjectedHttpsBytes('https://public.example/file', { ...base, method: 'POST', headers: { accept: 'application/octet-stream' },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://public.example/file');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.accept, 'application/octet-stream');
      assert.equal(options.signal.aborted, false);
      return new Response(bytes, { status: 201 });
    }
  });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.status, 201);
  for (const [length, pattern] of [['65', /exceeds 64 byte limit/], ['invalid', /malformed Content-Length/]]) {
    await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', { ...base,
      fetchImpl: async () => new Response('small', { headers: { 'content-length': length } })
    }), pattern);
  }
  const cause = Object.assign(new Error('transport failed'), { code: 'ECONNRESET' });
  await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', {
    ...base, fetchImpl: async () => { throw cause; }
  }), (error) => error.cause === cause && error.code === 'ECONNRESET' && error.networkTransportError === true);
  for (const overflow of [false, true]) {
    let cancelled = 0;
    let released = 0;
    let reads = 0;
    let signal;
    const bounded = await fetchInjectedHttpsBytes('https://public.example/', { ...base,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return { status: 200, headers: new Headers(), body: { getReader: () => ({
          read: async () => reads++ < 2 ? { value: Buffer.alloc(reads === 2 && overflow ? 33 : 32), done: false } : { done: true },
          cancel: async () => { cancelled += 1; }, releaseLock: () => { released += 1; }
        }) } };
      }
    }).then((value) => value, (error) => error);
    assert.equal(released, 1);
    assert.equal(cancelled, overflow ? 1 : 0);
    assert.equal(signal.aborted, overflow);
    if (overflow) assert.match(bounded.message, /exceeds 64 byte limit/);
    else assert.equal(bounded.bytes.length, 64);
  }
  let deliver;
  let cancelled = 0;
  let reads = 0;
  await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', { ...base, timeoutMs: 10,
    fetchImpl: () => new Promise((resolve) => { deliver = resolve; })
  }), { name: 'AbortError' });
  deliver({ status: 200, headers: new Headers(), body: {
    cancel: async () => { cancelled += 1; }, getReader: () => { reads += 1; assert.fail('late response must not be read'); }
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.equal(reads, 0);
  let activeCancelled = 0;
  let activeReleased = 0;
  let activeSignal;
  await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', { ...base, timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      activeSignal = options.signal;
      return { status: 200, headers: new Headers(), body: { getReader: () => ({
        read: () => new Promise(() => {}), cancel: async (reason) => {
          assert.equal(reason, activeSignal.reason);
          activeCancelled += 1;
        }, releaseLock: () => { activeReleased += 1; }
      }) } };
    }
  }), { name: 'AbortError' });
  assert.equal(activeCancelled, 1);
  assert.equal(activeReleased, 1);
  assert.equal(activeSignal.reason.name, 'AbortError');
  for (const options of [{ maxBytes: 0 }, { timeoutMs: 0 }]) {
    await assert.rejects(() => fetchInjectedHttpsBytes('https://public.example/', { ...base, ...options,
      fetchImpl: () => assert.fail('invalid options must not fetch')
    }), /positive safe integer/);
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
