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
  cacheAddImpl = async () => undefined,
  cacheMatchImpl = async () => undefined,
  skipWaitingImpl = async () => undefined
} = {}) {
  const listeners = new Map();
  const calls = {
    cacheAdd: [],
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
    async add(resource) {
      calls.cacheAdd.push(resource);
      return cacheAddImpl(resource);
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
      async open(name) {
        calls.cacheOpen.push(name);
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

test('install stores the offline page and fails closed when cache population fails', async () => {
  const harness = createWorkerHarness();
  const installation = dispatchExtendableEvent(harness, 'install');

  assert.equal(installation.ownershipCount, 1);
  await installation.lifetimePromise;
  assert.deepEqual(harness.calls.cacheOpen, ['pwabuilder-offline-cache-v2']);
  assert.deepEqual(harness.calls.cacheAdd, ['offline.html']);
  assert.deepEqual(harness.calls.importedScripts, ['js/vendor/workbox-sw.js']);
  assert.deepEqual(harness.calls.workboxConfig, [{ modulePathPrefix: 'js/vendor/workbox' }]);

  const cacheError = new Error('cache quota exceeded');
  const failingHarness = createWorkerHarness({
    cacheAddImpl: async () => {
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
  assert.deepEqual(offlineHarness.calls.cacheOpen, ['pwabuilder-offline-cache-v2']);
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

test('worker has one fetch listener and never claims non-navigation requests', () => {
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
