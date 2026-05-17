// ── Firebase Cloud Messaging Service Worker ────────────────────────────────
// Handles background push notifications when app is minimised or closed.
// Must be served from the root path /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCRg1W9ueQp80kfDbS-o5VdDZmW7I9AbMQ',
  authDomain:        'study-hub-app-f3431.firebaseapp.com',
  projectId:         'study-hub-app-f3431',
  storageBucket:     'study-hub-app-f3431.firebasestorage.app',
  messagingSenderId: '18536531099',
  appId:             '1:18536531099:web:6b691f03283530c927f23e'
};

firebase.initializeApp(FIREBASE_CONFIG);
const messaging = firebase.messaging();

// ── Notification icon / badge ──────────────────────────────────────────────
const ICON  = '/icon-192.png';
const BADGE = '/icon-192.png';

// ── Action buttons per notification type ──────────────────────────────────
function _getActions(type) {
  switch (type) {
    case 'study':       return [{ action: 'open', title: '📖 Open App' }];
    case 'pomodoro':    return [{ action: 'open', title: '⏱️ View Timer' }];
    case 'social':      return [{ action: 'open', title: '👥 View' }];
    case 'challenge':   return [{ action: 'accept', title: '✅ Accept' }, { action: 'decline', title: '❌ Decline' }];
    case 'duel':        return [{ action: 'open', title: '⚔️ View Duel' }];
    case 'groupInvite': return [{ action: 'open', title: '👥 Join Group' }];
    case 'liveInvite':  return [{ action: 'open', title: '🟢 Join Live' }];
    case 'streak':      return [{ action: 'open', title: '🔥 Keep Streak' }];
    case 'achievement': return [{ action: 'open', title: '🏆 View Badge' }];
    case 'xp':          return [{ action: 'open', title: '⚡ View XP' }];
    default:            return [{ action: 'open', title: '📚 Open' }];
  }
}

// ── Deep-link URL per notification type ───────────────────────────────────
function _getUrl(data) {
  if (data && data.url) return data.url;
  const tabMap = {
    study: '/?tab=home', pomodoro: '/?tab=focus', social: '/?tab=social',
    challenge: '/?tab=social', duel: '/?tab=social', groupInvite: '/?tab=social',
    liveInvite: '/?tab=social', streak: '/?tab=home', achievement: '/?tab=stats',
    xp: '/?tab=home', dailyGoal: '/?tab=home', taskDeadline: '/?tab=dashboard',
  };
  return (data && data.type && tabMap[data.type]) || '/';
}

// ── Background message handler (app closed / minimised) ───────────────────
messaging.onBackgroundMessage(payload => {
  const { notification, data } = payload;

  const title    = (notification && notification.title) || 'Study Hub';
  const body     = (notification && notification.body)  || '';
  const type     = (data && data.type) || 'default';
  const tag      = (data && data.tag)  || `fcm-${type}-${Date.now()}`;
  const targetUrl = _getUrl(data);
  const requireInteraction = type === 'challenge' || type === 'duel';

  return self.registration.showNotification(title, {
    body,
    icon:     ICON,
    badge:    BADGE,
    tag,
    renotify: true,
    vibrate:  [200, 100, 200],
    requireInteraction,
    actions:  _getActions(type),
    data:     { url: targetUrl, type, ...(data || {}) },
  });
});

// ── Notification click: open / focus the PWA and navigate ─────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const notifData = e.notification.data || {};
  const targetUrl = notifData.url || '/';
  const action    = e.action;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          // Tell the open app to navigate to the right section
          client.postMessage({ type: 'fcm-navigate', data: notifData, action });
          return client.focus();
        }
      }
      // App not open — launch it at the target URL
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Notification dismiss handler ─────────────────────────────────────────
self.addEventListener('notificationclose', () => {
  // Reserved for analytics / dismissal tracking
});
