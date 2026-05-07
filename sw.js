const CACHE_NAME = 'syllabus-tracker-v38';
const STATIC = [
  '/',
  '/index.html',
  '/style.css?v=31',
  '/script.js?v=31',
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

// ── IndexedDB helpers (persistent schedule — survives browser restarts) ──────
const _IDB_NAME  = 'syllabus-tracker-db';
const _IDB_VER   = 1;
const _IDB_STORE = 'config';

function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VER);
    req.onupgradeneeded = ev => {
      if (!ev.target.result.objectStoreNames.contains(_IDB_STORE)) {
        ev.target.result.createObjectStore(_IDB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = ev => resolve(ev.target.result);
    req.onerror   = ev => reject(ev.target.error);
  });
}
async function _idbGet(key) {
  try {
    const db  = await _openIDB();
    const rec = await new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readonly');
      const r  = tx.objectStore(_IDB_STORE).get(key);
      r.onsuccess = ev => res(ev.target.result);
      r.onerror   = ev => rej(ev.target.error);
    });
    return rec ? rec.value : null;
  } catch (_) { return null; }
}
async function _idbSet(key, value) {
  try {
    const db = await _openIDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put({ key, value });
      tx.oncomplete = res;
      tx.onerror    = ev => rej(ev.target.error);
    });
  } catch (_) {}
}

// ── SW-side close-range notification scheduler ─────────────────────────────
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

// ── Message handler ─────────────────────────────────────────────────────────
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
    // Persist to IDB so PBS/Sync can recover without an open page
    _idbSet('notif_schedule', schedules);
  }
});

// ── Periodic Background Sync: auto-recover schedule after browser restart ───
// Fires every ~12 h on supported Chromium browsers (requires PBS permission).
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'reschedule-notifications') return;
  e.waitUntil((async () => {
    // If page is open, let it handle its own precision timers
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length) {
      clients.forEach(c => c.postMessage({ type: 'periodic-sync-wake' }));
      return;
    }
    // No page open — schedule close-range notifications directly from IDB
    const schedules = await _idbGet('notif_schedule');
    if (!Array.isArray(schedules) || !schedules.length) return;
    _swTimers.forEach(t => clearTimeout(t));
    _swTimers = [];
    schedules.forEach(_swScheduleNext);
  })());
});

// ── Background Sync fallback (fires once on reconnect — wider support) ──────
// Used as a one-shot recovery on browsers that lack Periodic Background Sync.
self.addEventListener('sync', e => {
  if (e.tag !== 'reschedule-notifications') return;
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length) {
      clients.forEach(c => c.postMessage({ type: 'periodic-sync-wake' }));
      return;
    }
    const schedules = await _idbGet('notif_schedule');
    if (!Array.isArray(schedules) || !schedules.length) return;
    _swTimers.forEach(t => clearTimeout(t));
    _swTimers = [];
    schedules.forEach(_swScheduleNext);
  })());
});
