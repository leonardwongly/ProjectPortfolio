import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const workerPath = new URL('../../pwabuilder-sw.js', import.meta.url);
const workerSource = fs.readFileSync(workerPath, 'utf8');
const workerOrigin = 'https://portfolio.example';

function createWorkerHarness({
  preloadSupported = true,
  fetchImpl = async () => ({ kind: 'network' }),
  cacheAddAllImpl = async () => undefined,
  cacheMatchImpl = async () => undefined,
  cacheNames = [],
  cacheDeleteImpl = async () => true,
  cacheOpenImpl = async () => undefined,
  skipWaitingImpl = async () => undefined
} = {}) {
  const listeners = new Map();
  const calls = {
    cacheAddAll: [],
    cacheDelete: [],
    cacheMatch: [],
    cacheOpen: [],
    clientsClaim: 0,
    fetch: [],
    importedScripts: [],
    navigationPreloadEnable: 0,
    skipWaiting: 0,
    workboxConfig: []
  };

  const cache = {
    async addAll(resources) {
      calls.cacheAddAll.push(Array.from(resources));
      return cacheAddAllImpl(resources);
    },
    async match(resource) {
      calls.cacheMatch.push(resource);
      return cacheMatchImpl(resource);
    }
  };

  const sandbox = {
    Array,
    Response,
    URL,
    caches: {
      async keys() {
        return cacheNames;
      },
      async delete(name) {
        calls.cacheDelete.push(name);
        return cacheDeleteImpl(name);
      },
      async open(name) {
        calls.cacheOpen.push(name);
        await cacheOpenImpl(name);
        return cache;
      }
    },
    async fetch(request) {
      calls.fetch.push(request);
      return fetchImpl(request);
    },
    importScripts(...scripts) {
      calls.importedScripts.push(...scripts);
    },
    workbox: {
      navigationPreload: {
        enable() {
          calls.navigationPreloadEnable += 1;
        },
        isSupported() {
          return preloadSupported;
        }
      },
      setConfig(config) {
        calls.workboxConfig.push({ ...config });
      }
    }
  };

  sandbox.self = {
    location: new URL(`${workerOrigin}/pwabuilder-sw.js`),
    clients: {
      claim() {
        calls.clientsClaim += 1;
        return Promise.resolve();
      }
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    skipWaiting() {
      calls.skipWaiting += 1;
      return skipWaitingImpl();
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox, { filename: workerPath.pathname });

  return {
    calls,
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
    listeners
  };
}

function dispatchExtendableEvent(harness, type) {
  let lifetimePromise;
  let ownershipCount = 0;

  harness.dispatch(type, {
    waitUntil(value) {
      ownershipCount += 1;
      lifetimePromise = Promise.resolve(value);
    }
  });

  return { lifetimePromise, ownershipCount };
}

function dispatchMessage(harness, event) {
  let lifetimeValue;
  let lifetimePromise;
  let ownershipCount = 0;

  harness.dispatch('message', {
    ...event,
    waitUntil(value) {
      ownershipCount += 1;
      lifetimeValue = value;
      lifetimePromise = Promise.resolve(value);
    }
  });

  return { lifetimePromise, lifetimeValue, ownershipCount };
}

function dispatchFetch(harness, request, preloadResponse) {
  let responsePromise;
  let ownershipCount = 0;

  harness.dispatch('fetch', {
    preloadResponse,
    request,
    respondWith(value) {
      ownershipCount += 1;
      responsePromise = Promise.resolve(value);
    }
  });

  return { ownershipCount, responsePromise };
}

function validMessage(token = '0123456789abcdef') {
  return {
    data: { type: 'SKIP_WAITING', token },
    origin: workerOrigin,
    source: {
      type: 'window',
      url: `${workerOrigin}/index.html`
    }
  };
}

test('worker owns skipWaiting only for well-formed messages from same-origin windows', async () => {
  const skipWaitingPromise = Promise.resolve();
  const harness = createWorkerHarness({ skipWaitingImpl: () => skipWaitingPromise });
  const arrayPayload = [];
  arrayPayload.type = 'SKIP_WAITING';
  arrayPayload.token = '0123456789abcdef';

  const invalidCases = [
    ['null payload', { data: null }],
    ['array payload', { data: arrayPayload }],
    ['wrong event type', { data: { type: 'ACTIVATE', token: '0123456789abcdef' } }],
    ['missing token', { data: { type: 'SKIP_WAITING' } }],
    ['non-string token', { data: { type: 'SKIP_WAITING', token: 1234567890123456 } }],
    ['token below minimum length', { data: { type: 'SKIP_WAITING', token: 'a'.repeat(15) } }],
    ['token above maximum length', { data: { type: 'SKIP_WAITING', token: 'a'.repeat(65) } }],
    ['non-hex token', { data: { type: 'SKIP_WAITING', token: 'g'.repeat(16) } }],
    ['token with trailing line break', { data: { type: 'SKIP_WAITING', token: `${'a'.repeat(16)}\n` } }],
    ['missing message origin', { origin: undefined }],
    ['non-string message origin', { origin: new URL(workerOrigin) }],
    ['cross-origin message', { origin: 'https://attacker.example' }],
    ['origin with another protocol', { origin: 'http://portfolio.example' }],
    ['origin with another port', { origin: 'https://portfolio.example:444' }],
    ['missing source', { source: null }],
    ['non-window source', { source: { type: 'worker', url: `${workerOrigin}/worker.js` } }],
    ['non-string source URL', { source: { type: 'window', url: new URL(workerOrigin) } }],
    ['relative source URL', { source: { type: 'window', url: '/index.html' } }],
    ['malformed source URL', { source: { type: 'window', url: 'not a url' } }],
    ['cross-origin source', { source: { type: 'window', url: 'https://attacker.example/' } }],
    ['lookalike source host', { source: { type: 'window', url: 'https://portfolio.example.attacker.test/' } }],
    ['credential-spoofed source', { source: { type: 'window', url: 'https://portfolio.example@attacker.test/' } }]
  ];

  for (const [description, override] of invalidCases) {
    const message = { ...validMessage(), ...override };
    const rejected = dispatchMessage(harness, message);
    assert.equal(rejected.ownershipCount, 0, description);
    assert.equal(harness.calls.skipWaiting, 0, description);
  }

  const minimumBoundary = dispatchMessage(harness, validMessage('a'.repeat(16)));
  assert.equal(minimumBoundary.ownershipCount, 1);
  assert.equal(minimumBoundary.lifetimeValue, skipWaitingPromise);
  await minimumBoundary.lifetimePromise;

  const maximumBoundary = dispatchMessage(harness, validMessage('F'.repeat(64)));
  assert.equal(maximumBoundary.ownershipCount, 1);
  assert.equal(maximumBoundary.lifetimeValue, skipWaitingPromise);
  await maximumBoundary.lifetimePromise;

  assert.equal(harness.calls.skipWaiting, 2, 'both inclusive token-length boundaries should be valid');
});

test('install atomically stores the offline document and stylesheet and fails closed', async () => {
  const harness = createWorkerHarness();
  const installation = dispatchExtendableEvent(harness, 'install');

  assert.equal(installation.ownershipCount, 1);
  await installation.lifetimePromise;
  assert.deepEqual(harness.calls.cacheOpen, ['pwabuilder-offline-cache-v3']);
  assert.deepEqual(harness.calls.cacheAddAll, [['offline.html', '/css/offline.css']]);
  assert.deepEqual(harness.calls.importedScripts, ['js/vendor/workbox-sw.js']);
  assert.deepEqual(harness.calls.workboxConfig, [{ debug: false, modulePathPrefix: 'js/vendor/workbox' }]);

  const cacheError = new Error('cache quota exceeded');
  const failingHarness = createWorkerHarness({
    cacheAddAllImpl: async () => {
      throw cacheError;
    }
  });
  const failedInstallation = dispatchExtendableEvent(failingHarness, 'install');

  assert.equal(failedInstallation.ownershipCount, 1);
  await assert.rejects(failedInstallation.lifetimePromise, cacheError);
});

test('activation claims existing clients so an accepted update completes the reload flow', async () => {
  const harness = createWorkerHarness();
  const activation = dispatchExtendableEvent(harness, 'activate');

  assert.equal(activation.ownershipCount, 1);
  await activation.lifetimePromise;
  assert.equal(harness.calls.clientsClaim, 1);
});

test('activation removes only explicitly retired owned offline caches before claiming clients', async () => {
  let finishDeletion;
  const deletion = new Promise((resolve) => { finishDeletion = resolve; });
  const harness = createWorkerHarness({
    cacheNames: [
      'pwabuilder-offline-cache',
      'pwabuilder-offline-cache-v1',
      'pwabuilder-offline-cache-v2',
      'pwabuilder-offline-cache-v3',
      'pwabuilder-offline-cache-v4',
      'pwabuilder-offline-cache-v2-other-app',
      'other-app-cache'
    ],
    cacheDeleteImpl: () => deletion
  });
  const activation = dispatchExtendableEvent(harness, 'activate');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.calls.cacheDelete, [
    'pwabuilder-offline-cache', 'pwabuilder-offline-cache-v1', 'pwabuilder-offline-cache-v2'
  ]);
  assert.equal(harness.calls.clientsClaim, 0, 'claim must wait for owned cache cleanup');
  finishDeletion(true);
  await activation.lifetimePromise;
  assert.equal(harness.calls.clientsClaim, 1);
});

test('navigation response pipeline prefers preload, then network, then cached offline content', async () => {
  const preloadResponse = { kind: 'preload' };
  const preloadHarness = createWorkerHarness({
    fetchImpl: async () => {
      throw new Error('network must not run when preload succeeds');
    }
  });
  const preloaded = dispatchFetch(
    preloadHarness,
    { mode: 'navigate', url: `${workerOrigin}/work.html` },
    Promise.resolve(preloadResponse)
  );

  assert.equal(preloadHarness.calls.navigationPreloadEnable, 1);
  assert.equal(preloaded.ownershipCount, 1);
  assert.equal(await preloaded.responsePromise, preloadResponse);
  assert.deepEqual(preloadHarness.calls.fetch, []);
  assert.deepEqual(preloadHarness.calls.cacheOpen, []);

  const networkResponse = { kind: 'network' };
  const networkHarness = createWorkerHarness({ fetchImpl: async () => networkResponse });
  const networked = dispatchFetch(
    networkHarness,
    { mode: 'navigate', url: `${workerOrigin}/reading.html` },
    Promise.resolve(undefined)
  );

  assert.equal(networked.ownershipCount, 1);
  assert.equal(await networked.responsePromise, networkResponse);
  assert.deepEqual(networkHarness.calls.cacheOpen, []);
  assert.equal(networkHarness.calls.fetch.length, 1);

  const recoveredNetworkResponse = { kind: 'network-after-preload-failure' };
  const rejectedPreloadHarness = createWorkerHarness({
    fetchImpl: async () => recoveredNetworkResponse
  });
  const recoveredFromRejectedPreload = dispatchFetch(
    rejectedPreloadHarness,
    { mode: 'navigate', url: `${workerOrigin}/contact.html` },
    Promise.reject(new Error('navigation preload failed'))
  );

  assert.equal(recoveredFromRejectedPreload.ownershipCount, 1);
  assert.equal(await recoveredFromRejectedPreload.responsePromise, recoveredNetworkResponse);
  assert.equal(rejectedPreloadHarness.calls.fetch.length, 1);
  assert.deepEqual(rejectedPreloadHarness.calls.cacheOpen, []);

  const offlineResponse = { kind: 'offline-cache' };
  const offlineHarness = createWorkerHarness({
    fetchImpl: async () => {
      throw new Error('offline');
    },
    cacheMatchImpl: async () => offlineResponse
  });
  const offline = dispatchFetch(
    offlineHarness,
    { mode: 'navigate', url: `${workerOrigin}/unavailable` },
    Promise.resolve(undefined)
  );

  assert.equal(offline.ownershipCount, 1);
  assert.equal(await offline.responsePromise, offlineResponse);
  assert.deepEqual(offlineHarness.calls.cacheOpen, ['pwabuilder-offline-cache-v3']);
  assert.deepEqual(offlineHarness.calls.cacheMatch, ['offline.html']);

  const unsupportedHarness = createWorkerHarness({ preloadSupported: false });
  assert.equal(unsupportedHarness.calls.navigationPreloadEnable, 0);
});

test('offline navigation still returns a bounded response when cache state is corrupt', async () => {
  const corruptCacheCases = [
    ['missing entry', async () => undefined],
    ['unreadable cache', async () => {
      throw new Error('cache storage unavailable');
    }]
  ];

  for (const [description, cacheMatchImpl] of corruptCacheCases) {
    const harness = createWorkerHarness({
      fetchImpl: async () => {
        throw new Error('offline');
      },
      cacheMatchImpl
    });
    const navigation = dispatchFetch(
      harness,
      { mode: 'navigate', url: `${workerOrigin}/unavailable` },
      Promise.resolve(undefined)
    );

    assert.equal(navigation.ownershipCount, 1, description);
    const response = await navigation.responsePromise;
    assert.ok(response instanceof Response, description);
    assert.equal(response.status, 503, description);
    assert.equal(response.headers.get('cache-control'), 'no-store', description);
    const body = await response.text();
    assert.match(body, /offline/i, description);
    assert.ok(body.length <= 80, `${description}: emergency response should stay resource-bounded`);
  }
});

test('worker has one fetch listener and leaves unrelated non-navigation requests alone', () => {
  const harness = createWorkerHarness({
    fetchImpl: async () => {
      throw new Error('non-navigation requests must not be fetched by this worker');
    }
  });
  let ownershipCount = 0;
  const event = {
    get preloadResponse() {
      throw new Error('non-navigation preload must not be observed');
    },
    request: { mode: 'cors', url: `${workerOrigin}/css/style.css` },
    respondWith() {
      ownershipCount += 1;
    }
  };

  assert.equal(harness.listeners.get('fetch')?.length, 1);
  assert.doesNotThrow(() => harness.dispatch('fetch', event));
  assert.equal(ownershipCount, 0);
  assert.deepEqual(harness.calls.fetch, []);
  assert.deepEqual(harness.calls.cacheOpen, []);
});

test('offline stylesheet prefers network, then its owned cache, without caching arbitrary responses', async () => {
  const request = { method: 'GET', mode: 'no-cors', url: `${workerOrigin}/css/offline.css` };
  const networkResponse = { kind: 'network-css' };
  const networkHarness = createWorkerHarness({ fetchImpl: async () => networkResponse });
  const networked = dispatchFetch(networkHarness, request);
  assert.equal(networked.ownershipCount, 1);
  assert.equal(await networked.responsePromise, networkResponse);
  assert.deepEqual(networkHarness.calls.fetch, [request]);
  assert.deepEqual(networkHarness.calls.cacheOpen, []);

  const cachedResponse = { kind: 'cached-css' };
  const offlineHarness = createWorkerHarness({
    fetchImpl: async () => { throw new Error('offline'); },
    cacheMatchImpl: async () => cachedResponse
  });
  const offline = dispatchFetch(offlineHarness, request);
  assert.equal(await offline.responsePromise, cachedResponse);
  assert.deepEqual(offlineHarness.calls.cacheOpen, ['pwabuilder-offline-cache-v3']);
  assert.deepEqual(offlineHarness.calls.cacheMatch, ['/css/offline.css']);
  assert.deepEqual(offlineHarness.calls.cacheAddAll, []);
});

test('offline stylesheet cache failure returns a bounded non-HTML response', async () => {
  for (const cacheMatchImpl of [
    async () => undefined,
    async () => { throw new Error('cache storage unavailable'); }
  ]) {
    const harness = createWorkerHarness({
      fetchImpl: async () => { throw new Error('offline'); },
      cacheMatchImpl
    });
    const { responsePromise } = dispatchFetch(harness, {
      method: 'GET', mode: 'no-cors', url: `${workerOrigin}/css/offline.css`
    });
    const response = await responsePromise;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).length <= 80);
  }
});

test('offline asset interception rejects non-GET, other-origin, altered and malformed URLs', () => {
  const harness = createWorkerHarness();
  const invalidRequests = [
    { method: 'POST', url: `${workerOrigin}/css/offline.css` },
    { method: 'HEAD', url: `${workerOrigin}/css/offline.css` },
    { url: `${workerOrigin}/css/offline.css` },
    { method: 'GET', url: 'https://attacker.example/css/offline.css' },
    { method: 'GET', url: 'http://portfolio.example/css/offline.css' },
    { method: 'GET', url: 'https://portfolio.example:444/css/offline.css' },
    { method: 'GET', url: 'https://portfolio.example@attacker.example/css/offline.css' },
    { method: 'GET', url: `${workerOrigin}/css/offline.css?version=attacker` },
    { method: 'GET', url: `${workerOrigin}/css/offline.css#fragment` },
    { method: 'GET', url: `${workerOrigin}/css/%6fffline.css` },
    { method: 'GET', url: `${workerOrigin}/css/Offline.css` },
    { method: 'GET', url: `${workerOrigin}/css/custom.css` },
    { method: 'GET', url: '/css/offline.css' },
    { method: 'GET', url: 'not a url' }
  ];
  for (const request of invalidRequests) {
    assert.equal(dispatchFetch(harness, { mode: 'no-cors', ...request }).ownershipCount, 0, JSON.stringify(request));
  }
  assert.deepEqual(harness.calls.fetch, []);
  assert.deepEqual(harness.calls.cacheOpen, []);
});

test('cache-open failure rejects installation but navigation and CSS remain bounded', async () => {
  const failure = new Error('CacheStorage denied');
  const harness = createWorkerHarness({
    cacheOpenImpl: async () => { throw failure; },
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(dispatchExtendableEvent(harness, 'install').lifetimePromise, failure);
  for (const request of [
    { mode: 'navigate', method: 'GET', url: `${workerOrigin}/missing` },
    { mode: 'no-cors', method: 'GET', url: `${workerOrigin}/css/offline.css` }
  ]) {
    const response = await dispatchFetch(harness, request).responsePromise;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).length <= 80);
  }
});

test('navigation forwards the original request and preserves HTTP errors instead of offline fallback', async () => {
  for (const status of [200, 404, 503]) {
    const response = new Response(`network-${status}`, { status, headers: { 'x-proof': 'network' } });
    const request = { mode: 'navigate', method: 'GET', url: `${workerOrigin}/work.html?proof=preserved`, headers: { 'x-proof': 'request' } };
    const harness = createWorkerHarness({ fetchImpl: async () => response });
    const actual = await dispatchFetch(harness, request, Promise.resolve(undefined)).responsePromise;
    assert.equal(harness.calls.fetch[0], request);
    assert.equal(actual, response);
    assert.equal(actual.status, status);
    assert.equal(actual.headers.get('x-proof'), 'network');
    assert.equal(await actual.text(), `network-${status}`);
    assert.deepEqual(harness.calls.cacheOpen, []);
  }
});

test('an accepted message owns a rejected skipWaiting promise', async () => {
  const failure = new Error('activation unavailable');
  const harness = createWorkerHarness({ skipWaitingImpl: async () => { throw failure; } });
  const message = dispatchMessage(harness, validMessage());
  assert.equal(message.ownershipCount, 1);
  await assert.rejects(message.lifetimePromise, failure);
  assert.equal(harness.calls.skipWaiting, 1);
});
