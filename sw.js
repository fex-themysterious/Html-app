const CACHE_NAME = 'syllabus-tracker-v23';
const STATIC = [
  '/',
  '/index.html',
  '/style.css?v=18',
  '/script.js?v=18',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/sounds/rain.mp3',
  '/sounds/soft.mp3',
  '/sounds/concentration.mp3',
  '/sounds/peaky-blinder.mp3',
  '/sounds/aal-izz-well.m4a',
  '/sounds/believer.m4a',
  '/sounds/rasputin.m4a',
  '/sounds/enemy.m4a',
  '/sounds/give-me-sunshine.m4a',
  '/sounds/shape-of-you.m4a',
  '/sounds/hall-of-fame.m4a',
  '/sounds/summertime-sadness.m4a',
  '/sounds/focus-beta.wav'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).catch(err => {
      console.warn('[SW] Pre-cache failed:', err);
    })
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
  if (e.request.url.includes('noembed.com') || e.request.url.includes('youtube.com')) return;

  // Audio files: cache-first with Range request support for mobile browsers
  if (e.request.url.includes('/sounds/')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const plainUrl = e.request.url.split('?')[0];
        const cached = await cache.match(plainUrl);

        if (cached) {
          const rangeHeader = e.request.headers.get('range');
          if (rangeHeader) {
            try {
              const ab = await cached.clone().arrayBuffer();
              const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
              const start = match && match[1] !== '' ? parseInt(match[1], 10) : 0;
              const end = match && match[2] !== '' ? parseInt(match[2], 10) : ab.byteLength - 1;
              const slice = ab.slice(start, end + 1);
              const ext = plainUrl.split('.').pop().toLowerCase();
              const mime = ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
              return new Response(slice, {
                status: 206,
                statusText: 'Partial Content',
                headers: {
                  'Content-Type': mime,
                  'Content-Range': `bytes ${start}-${end}/${ab.byteLength}`,
                  'Content-Length': String(slice.byteLength),
                  'Accept-Ranges': 'bytes'
                }
              });
            } catch (err) {
              console.warn('[SW] Range slice failed, serving full cached file:', err);
              return cached;
            }
          }
          return cached;
        }

        try {
          const response = await fetch(plainUrl);
          if (response.ok) cache.put(plainUrl, response.clone());
          return response;
        } catch (err) {
          console.error('[SW] Audio fetch failed, no cache:', plainUrl, err);
          return new Response('Audio unavailable offline', { status: 503 });
        }
      })
    );
    return;
  }

  // All other static assets: cache-first, network fallback
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
