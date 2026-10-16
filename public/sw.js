/* global self, caches, fetch, URL, Response */
const CACHE_NAME = 'will-do-it-offline-v2';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)));
  // Updates wait for existing windows to close so an editor is never reloaded.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('will-do-it-offline-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  // Only full-page navigations get a fallback. Never cache authenticated HTML,
  // Supabase requests, mutations, or Next.js router payloads.
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate'
      || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }));
});
