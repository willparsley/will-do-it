/* global self, caches, fetch, URL, Response */
const CACHE_NAME = 'will-do-it-offline-v6';
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

// Push never caches private workspace data or includes card titles.
self.addEventListener('push', (event) => {
  let tag = 'will-do-it-reminder';
  try { tag = event.data?.json()?.tag || tag; } catch { /* Always show received pushes. */ }
  event.waitUntil(self.registration.showNotification('Will Do It', {
    body: 'A card is ready for your attention. Open your workspace to see it.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const workspace = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
    if (workspace) return workspace.focus();
    return self.clients.openWindow('/');
  })());
});
