// Service worker with offline fallback page

const CACHE = 'pwabuilder-offline-cache-v3';
const RETIRED_OFFLINE_CACHES = new Set([
  'pwabuilder-offline-cache',
  'pwabuilder-offline-cache-v1',
  'pwabuilder-offline-cache-v2'
]);

importScripts('js/vendor/workbox-sw.js');

workbox.setConfig({
  debug: false,
  modulePathPrefix: 'js/vendor/workbox'
});

const offlineFallbackPage = 'offline.html';
const offlineStylesheet = '/css/offline.css';
const SW_UPDATE_EVENT_TYPE = 'SKIP_WAITING';
const SW_UPDATE_TOKEN_PATTERN = /^[a-f0-9]{16,64}$/i;

function isTrustedWindowClient(source) {
  if (!source || source.type !== 'window' || typeof source.url !== 'string') {
    return false;
  }

  try {
    return new URL(source.url).origin === self.location.origin;
  } catch (error) {
    return false;
  }
}

function isTrustedMessageOrigin(event) {
  return event && typeof event.origin === 'string' && event.origin === self.location.origin;
}

function isSkipWaitingMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  if (data.type !== SW_UPDATE_EVENT_TYPE) {
    return false;
  }

  if (typeof data.token !== 'string' || !SW_UPDATE_TOKEN_PATTERN.test(data.token)) {
    return false;
  }

  return true;
}

function createEmergencyOfflineResponse() {
  return new Response('Offline content is temporarily unavailable.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}

function isOfflineStylesheetRequest(request) {
  if (request.method !== 'GET') {
    return false;
  }

  try {
    return new URL(request.url).href === new URL(offlineStylesheet, self.location.origin).href;
  } catch {
    return false;
  }
}

self.addEventListener('message', (event) => {
  if (!isSkipWaitingMessage(event.data)) {
    return;
  }

  if (!isTrustedMessageOrigin(event)) {
    return;
  }

  if (!isTrustedWindowClient(event.source)) {
    return;
  }

  event.waitUntil(self.skipWaiting());
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([offlineFallbackPage, offlineStylesheet]))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => RETIRED_OFFLINE_CACHES.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      let preloadResp;
      try {
        preloadResp = await event.preloadResponse;
      } catch {
        // A failed preload is equivalent to no preload; the network may still work.
      }

      if (preloadResp) {
        return preloadResp;
      }

      try {
        return await fetch(event.request);
      } catch {
        try {
          const cache = await caches.open(CACHE);
          const cachedResp = await cache.match(offlineFallbackPage);
          if (cachedResp) {
            return cachedResp;
          }
        } catch {
          // Cache storage can be unavailable or externally cleared.
        }

        return createEmergencyOfflineResponse();
      }
    })());
    return;
  }

  if (isOfflineStylesheetRequest(event.request)) {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch {
        try {
          const cache = await caches.open(CACHE);
          const cachedResponse = await cache.match(offlineStylesheet);
          if (cachedResponse) {
            return cachedResponse;
          }
        } catch {
          // Keep cache failures bounded without substituting HTML for CSS.
        }
        return createEmergencyOfflineResponse();
      }
    })());
  }
});
