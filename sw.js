const CACHE_NAME = 'syllabus-tracker-v86';
const STATIC = [
  '/',
  '/index.html',
  '/style.css?v=59',
  '/script.js?v=76',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/sounds/rain.mp3',
  '/sounds/soft.mp3',
  '/sounds/concentration.mp3',
  '/sounds/peaky-blinder.mp3',
  '/sounds/alarm-wake.mp3',
  '/sounds/aal-izz-well.m4a',
  '/sounds/believer.m4a',
  '/sounds/rasputin.m4a',
  '/sounds/enemy.m4a',
  '/sounds/give-me-sunshine.m4a',
  '/sounds/shape-of-you.m4a',
  '/sounds/hall-of-fame.m4a',
  '/sounds/summertime-sadness.m4a',
  '/sounds/focus-beta.wav',
  '/sounds/monk-mode.wav',
  '/sounds/void.wav',
  '/sounds/solfeggio-528.wav'
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
  // Never cache API calls — always fetch from network
  if (e.request.url.includes('/api/')) return;

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

  // HTML and JS files: network-first so code changes are always picked up immediately
  const url = e.request.url;
  const isHtmlOrJs = url.endsWith('.html') || url.includes('.js') || url === self.registration.scope || url.endsWith('/');
  if (isHtmlOrJs) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // All other static assets (CSS, images, etc.): cache-first, network fallback
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

// ── Notification click: open/focus the PWA window ──────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Push event: for future VAPID/server-sent push support ──────────────────
self.addEventListener('push', e => {
  let data = { title: 'Syllabus Tracker', body: '', tag: 'syllabus-push' };
  try { if (e.data) data = Object.assign(data, e.data.json()); } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url || './' },
      requireInteraction: false
    })
  );
});

// ── In-page notification scheduling via message ─────────────────────────────
let _swTimers = [];

function _swScheduleNext(schedule) {
  const [h, m] = schedule.time.split(':').map(Number);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  if (delay > 65 * 60 * 1000) return;
  const tid = setTimeout(() => {
    self.registration.showNotification(schedule.title, {
      body: schedule.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: schedule.type + '-' + schedule.time,
      data: { url: './' },
      requireInteraction: false
    });
  }, delay);
  _swTimers.push(tid);
}

self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'show-notification') {
    self.registration.showNotification(e.data.title, {
      ...e.data.options,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
    return;
  }

  if (e.data.type === 'schedule-notifications') {
    _swTimers.forEach(t => clearTimeout(t));
    _swTimers = [];
    const schedules = e.data.schedules || [];
    schedules.forEach(_swScheduleNext);
  }
});
