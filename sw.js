const CACHE = 'yaocabinet-v8';
const BASE = self.location.pathname.replace(/\/sw\.js$/, '').replace(/\/$/, '') || '';
const ASSETS = [BASE+'/index.html', BASE+'/app.js', BASE+'/icon.svg', BASE+'/icon-192.png', BASE+'/icon-512.png', BASE+'/manifest.json'];

// Install: pre-cache assets
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('dashscope.aliyuncs.com') || e.request.url.includes('/api/')) return;

  e.respondWith(
    // Network-first: always try network first for fresh content
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') return caches.match(BASE + '/index.html');
        });
      })
  );
});
