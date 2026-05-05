const CACHE_NAME = 'syllabus-tracker-v5';
const STATIC = [
  '/',
  '/index.html',
  '/style.css?v=5',
  '/script.js?v=5',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

let deferredPrompt = null;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/sounds/')) return;
  if (e.request.url.includes('noembed.com') || e.request.url.includes('youtube.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'show-notification') {
    self.registration.showNotification(e.data.title, {
      ...e.data.options,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
  }
});
