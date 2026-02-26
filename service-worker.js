/* ══════════════════════════════════════════════
   Speed Runner Pro - service-worker.js
   Cache-First Strategy + Offline Mode
   ══════════════════════════════════════════════ */

const CACHE_NAME = 'speed-runner-pro-v1.0.0';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.json',
  // Assets
  './assets/player.png',
  './assets/obstacle.png',
  './assets/background.png',
  './assets/coin.png',
  './assets/powerup.png',
  // Icons
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Sounds
  './sounds/music.wav',
  './sounds/jump.wav',
  './sounds/slide.wav',
  './sounds/coin.wav',
  './sounds/crash.wav',
  './sounds/powerup.wav',
  './sounds/gameover.wav',
  './sounds/record.wav',
];

/* ── Install: cache all assets ───────────────── */
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache failed:', err))
  );
});

/* ── Activate: delete old caches ─────────────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache-First Strategy ─────────────── */
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Serve from cache
          return cached;
        }
        // Not in cache — fetch from network
        return fetch(event.request)
          .then(response => {
            // Cache valid responses
            if (response && response.status === 200 && response.type === 'basic') {
              const toCache = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, toCache));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback
            if (event.request.destination === 'document') {
              return caches.match('./index.html');
            }
          });
      })
  );
});

/* ── Message handler ────────────────────────── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
