// Cache-first app shell, so the game works with no signal.
const CACHE = 'lesudoku-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'src/game.js',
  'src/puzzle.js',
  'data/levels.json',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) {
        // Refresh in the background for the next launch.
        fetch(event.request)
          .then((fresh) => caches.open(CACHE).then((cache) => cache.put(event.request, fresh)))
          .catch(() => {});
        return hit;
      }
      return fetch(event.request).catch(() => caches.match('index.html'));
    })
  );
});
