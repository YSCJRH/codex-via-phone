// Mobile Codex no longer uses a PWA cache layer.
// This service worker immediately removes old caches and unregisters itself
// so Safari does not keep serving stale app shells after rebuilds.

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await clearAllCaches();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await clearAllCaches();
    await self.clients.claim();
    await self.registration.unregister();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'service-worker-disabled' });
    }
  })());
});

self.addEventListener('fetch', () => {
  // No-op: allow the network to handle requests directly.
});
