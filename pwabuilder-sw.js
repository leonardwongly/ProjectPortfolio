// Service worker with offline fallback page

const CACHE = 'pwabuilder-offline-cache-v2';

importScripts('js/vendor/workbox-sw.js');

workbox.setConfig({
  modulePathPrefix: 'js/vendor/workbox'
});

const offlineFallbackPage = 'offline.html';
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

function isSkipWaitingMessage(data) {
  if (!data || typeof data !== 'object') {
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

self.addEventListener('message', (event) => {
  if (!isSkipWaitingMessage(event.data)) {
    return;
  }

  if (!isTrustedWindowClient(event.source)) {
    return;
  }

  self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(offlineFallbackPage))
      .catch((error) => {
        console.error('[SW] Failed to cache offline fallback:', error);
        // Continue installation even if caching fails
        // The offline fallback won't be available, but SW will still activate
      })
  );
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

workbox.routing.registerRoute(
  ({ request }) => request.mode === 'navigate',
  new workbox.strategies.NetworkFirst({
    cacheName: CACHE,
    networkTimeoutSeconds: 4
  })
);

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;
        if (preloadResp) {
          return preloadResp;
        }
        const networkResp = await fetch(event.request);
        return networkResp;
      } catch (error) {
        console.warn('[SW] Network fetch failed, serving offline fallback:', error.message);
        try {
          const cache = await caches.open(CACHE);
          const cachedResp = await cache.match(offlineFallbackPage);
          if (cachedResp) {
            return cachedResp;
          }
          // If offline page is not cached, return a minimal error response
          console.error('[SW] Offline fallback page not found in cache');
          return new Response('Offline - Network unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        } catch (cacheError) {
          console.error('[SW] Failed to access cache:', cacheError);
          return new Response('Service worker error', {
            status: 503,
            statusText: 'Service Worker Error',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        }
      }
    })());
  }
});
