const CACHE = 'yaocabinet-v7';
const BASE = self.location.pathname.replace(/\/sw\.js$/, '').replace(/\/$/, '') || '';
const ASSETS = [BASE+'/index.html', BASE+'/app.js', BASE+'/icon.svg', BASE+'/icon-192.png', BASE+'/icon-512.png', BASE+'/manifest.json'];
const CDN_ASSETS = ['https://cdn.tailwindcss.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Skip non-GET requests
  if (e.request.method !== 'GET') return;
  // Skip API calls (dashscope, etc.)
  if (e.request.url.includes('dashscope.aliyuncs.com') || e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful responses for our assets
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') return caches.match(BASE + '/index.html');
      });
    })
  );
});
