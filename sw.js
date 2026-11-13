// Service worker: saves the app's files so it works offline.
// Bump CACHE when you want old saved files thrown away.

const CACHE = 'budget-v20';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'lock.js', 'savings.js', 'forecast.js', 'tips.js', 'bank.js', 'backups.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

// Remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
  ));
  self.clients.claim();
});

// Try the network first so updates show up; use the saved copy when offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // always check the server for a newer file
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
