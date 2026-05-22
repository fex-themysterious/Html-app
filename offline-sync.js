/**
 * offline-sync.js — Offline-First Sync Manager for Syllabus Tracker
 *
 * Responsibilities:
 *  1. Persist Pomodoro timer state so it survives page refresh / app close.
 *  2. Detect timer sessions that completed while the app was closed and credit them.
 *  3. Queue every completed focus session for idempotent Firestore sync.
 *  4. On reconnect: flush the queue, force cloud sync, re-trigger tournament scores.
 *  5. Show an offline/syncing indicator banner without touching the UI layout.
 */
(function () {
  'use strict';

  /* ── Storage keys ─────────────────────────────────────────────────────── */
  const K_TIMER   = '_pom_timer_state';    // running Pomodoro state
  const K_QUEUE   = '_pom_session_queue';  // completed-but-pending-sync sessions
  const K_SYNCED  = '_pom_synced_ids';     // IDs already confirmed synced (dedup)
  const MAX_Q     = 60;
  const MAX_SYNCED= 300;

  /* ── Tiny helpers ─────────────────────────────────────────────────────── */
  function uid9() {
    return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }
  function lsGet(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch (_) { return null; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function lsDel(k)    { try { localStorage.removeItem(k); } catch (_) {} }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /* ── Offline / Syncing indicator ──────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('_osync_styles')) return;
    const s = document.createElement('style');
    s.id = '_osync_styles';
    s.textContent = `
      #_osync_banner {
        position: fixed; bottom: 68px; left: 50%; transform: translateX(-50%);
        z-index: 99999; display: flex; align-items: center; gap: 8px;
        padding: 7px 16px; border-radius: 20px; font-size: 13px; font-weight: 600;
        pointer-events: none; opacity: 0; transition: opacity .3s;
        box-shadow: 0 4px 20px rgba(0,0,0,.35);
      }
      #_osync_banner.visible { opacity: 1; }
      #_osync_banner.offline { background: #1e1e2e; color: #f38ba8; border: 1px solid #f38ba855; }
      #_osync_banner.syncing { background: #1e1e2e; color: #a6e3a1; border: 1px solid #a6e3a155; }
      #_osync_banner .dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: currentColor; flex-shrink: 0;
      }
      #_osync_banner.syncing .dot {
        animation: _osync_pulse 1s infinite;
      }
      @keyframes _osync_pulse {
        0%,100% { opacity: 1; } 50% { opacity: .3; }
      }
    `;
    document.head.appendChild(s);
  }

  let _bannerEl = null;
  let _bannerTimer = null;

  function _getBanner() {
    if (!_bannerEl) {
      _injectStyles();
      _bannerEl = document.createElement('div');
      _bannerEl.id = '_osync_banner';
      document.body.appendChild(_bannerEl);
    }
    return _bannerEl;
  }

  function _showBanner(type, text, autoDismissMs) {
    const b = _getBanner();
    clearTimeout(_bannerTimer);
    b.className = `${type} visible`;
    b.innerHTML = `<span class="dot"></span>${text}`;
    if (autoDismissMs) {
      _bannerTimer = setTimeout(() => { b.classList.remove('visible'); }, autoDismissMs);
    }
  }

  function _hideBanner() {
    if (!_bannerEl) return;
    clearTimeout(_bannerTimer);
    _bannerEl.classList.remove('visible');
  }

  function setOfflineClass(offline) {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('app-offline', offline);
    if (offline) {
      _showBanner('offline', '📵 Offline — studying locally');
    } else {
      _hideBanner();
    }
  }

  function showSyncingBanner(text, ms) {
    _showBanner('syncing', text || '🔄 Syncing…', ms || 4000);
  }

  /* ── Session ID generator ─────────────────────────────────────────────── */
  function generateSessionId() {
    return 'sess_' + uid9();
  }

  /* ── Pomodoro Timer State Persistence ─────────────────────────────────── */
  /**
   * Called by script.js when the Pomodoro timer STARTS.
   * Saves everything needed to restore or credit the session later.
   */
  function onTimerStart(mode, startSeconds, sessionId, subjectId) {
    lsSet(K_TIMER, {
      running:      true,
      committed:    false,
      mode:         mode,
      startTime:    Date.now(),
      startSeconds: startSeconds,
      sessionId:    sessionId || generateSessionId(),
      subjectId:    subjectId || null,
      date:         todayKey(),
    });
  }

  /**
   * Called when the timer is manually cancelled/stopped (no session credit).
   */
  function onTimerStop() {
    lsDel(K_TIMER);
  }

  /**
   * Called when a Pomodoro work session COMPLETES normally (timer hits zero).
   * Queues the session for guaranteed Firebase sync.
   */
  function onSessionComplete(sessionData) {
    if (sessionData && sessionData.sessionId) {
      _queueSession(sessionData);
    }
    // Mark the persisted timer as committed so we don't double-credit on next load
    const saved = lsGet(K_TIMER);
    if (saved) {
      lsSet(K_TIMER, { ...saved, committed: true });
    }
  }

  /**
   * Called when script.js successfully wrote the session to Firestore.
   * Removes it from the pending queue.
   */
  function onSessionSynced(sessionId) {
    _markSynced(sessionId);
  }

  /* ── Session Queue ────────────────────────────────────────────────────── */
  function _queueSession(session) {
    if (!session || !session.sessionId) return;
    const synced = lsGet(K_SYNCED) || [];
    if (synced.includes(session.sessionId)) return; // already synced

    const queue = lsGet(K_QUEUE) || [];
    if (queue.some(s => s.sessionId === session.sessionId)) return; // already queued

    queue.push({ ...session, queuedAt: Date.now() });
    if (queue.length > MAX_Q) queue.splice(0, queue.length - MAX_Q);
    lsSet(K_QUEUE, queue);
  }

  function _markSynced(sessionId) {
    if (!sessionId) return;
    const synced = lsGet(K_SYNCED) || [];
    if (!synced.includes(sessionId)) {
      synced.push(sessionId);
      if (synced.length > MAX_SYNCED) synced.splice(0, synced.length - MAX_SYNCED);
      lsSet(K_SYNCED, synced);
    }
    const queue = (lsGet(K_QUEUE) || []).filter(s => s.sessionId !== sessionId);
    lsSet(K_QUEUE, queue);
  }

  function getPendingQueue() {
    return lsGet(K_QUEUE) || [];
  }

  /* ── Process pending queue (Firestore sync) ───────────────────────────── */
  function _processPendingQueue() {
    const queue = getPendingQueue();
    if (!queue.length) return;
    console.log(`[OfflineSync] Processing ${queue.length} pending session(s)`);

    const db  = window.appUI ? window.appUI.getDb()     : null;
    const uid = window.appUI ? window.appUI.getUserId() : null;
    if (!db || !uid || typeof firebase === 'undefined') return;

    const synced = lsGet(K_SYNCED) || [];

    queue.forEach(session => {
      if (synced.includes(session.sessionId)) {
        _markSynced(session.sessionId);
        return;
      }
      _syncOneSession(db, uid, session);
    });
  }

  function _syncOneSession(db, uid, session) {
    const sid = session.sessionId;
    // Sentinel doc — if this exists the log was already written
    const sentinelRef = db.collection('users').doc(uid)
      .collection('synced_sessions').doc(sid);

    sentinelRef.get().then(snap => {
      if (snap.exists) { _markSynced(sid); return; }

      // Write the log with a stable doc ID → idempotent even if retried
      return db.collection('users').doc(uid)
        .collection('syllabus_logs').doc(sid).set({
          sessionId:   sid,
          date:        session.date  || todayKey(),
          subjectId:   session.subjectId   || null,
          subjectName: session.subjectName || null,
          chapterId:   session.chapterId   || null,
          chapterName: session.chapterName || null,
          topicId:     session.topicId     || null,
          topicName:   session.topicName   || null,
          minutes:     session.minutes     || 0,
          seconds:     (session.minutes || 0) * 60,
          type:        session.type        || 'pomodoro',
          createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
        }).then(() => sentinelRef.set({ syncedAt: firebase.firestore.FieldValue.serverTimestamp() }))
          .then(() => {
            _markSynced(sid);
            console.log('[OfflineSync] Session synced:', sid);
          });
    }).catch(err => {
      console.warn('[OfflineSync] Session sync failed (will retry on reconnect):', sid, err.message);
    });
  }

  /* ── Interrupted timer check (called after auth + cloud restore) ──────── */
  /**
   * Detects whether the Pomodoro timer was running when the app was closed.
   *
   * Returns one of:
   *  { type: 'completed', minutes, sessionId, subjectId, date }  — timer expired offline
   *  { type: 'restore',   remainingSeconds, mode, sessionId, subjectId }  — timer still running
   *  null — no interrupted timer
   */
  function checkInterruptedTimer() {
    const saved = lsGet(K_TIMER);
    if (!saved || !saved.running) return null;

    const elapsedSec = Math.floor((Date.now() - saved.startTime) / 1000);

    if (saved.committed) {
      // State already has the session credited — just ensure Firebase sync fires
      lsDel(K_TIMER);
      return null;
    }

    if (elapsedSec >= saved.startSeconds) {
      // Timer completed while app was closed
      lsDel(K_TIMER);
      return {
        type:      'completed',
        minutes:   Math.floor(saved.startSeconds / 60),
        sessionId: saved.sessionId,
        subjectId: saved.subjectId,
        date:      saved.date || todayKey(),
      };
    }

    // Timer still has time left — return info so the app can restore it
    return {
      type:             'restore',
      mode:             saved.mode || 'work',
      remainingSeconds: saved.startSeconds - elapsedSec,
      sessionId:        saved.sessionId,
      subjectId:        saved.subjectId,
      date:             saved.date,
    };
  }

  /* ── Reconnect recovery ───────────────────────────────────────────────── */
  let _reconnectThrottle = 0;

  function onReconnect() {
    const now = Date.now();
    if (now - _reconnectThrottle < 5000) return; // debounce rapid online/offline cycles
    _reconnectThrottle = now;

    console.log('[OfflineSync] Reconnected — running recovery');
    showSyncingBanner('🔄 Back online — syncing…', 5000);

    // 1. Flush pending session queue to Firestore
    _processPendingQueue();

    // 2. Trigger immediate cloud state sync (bypass 3s debounce)
    if (typeof window._triggerImmediateCloudSync === 'function') {
      window._triggerImmediateCloudSync();
    }

    // 3. Re-sync tournament scores (XP + streak may have changed while offline)
    setTimeout(() => {
      try { if (window.DuelSystem && typeof window.DuelSystem.updateTournamentScore === 'function') {
        window.DuelSystem.updateTournamentScore();
      }} catch (_) {}
    }, 1500);

    // 4. Refresh global leaderboard
    setTimeout(() => {
      try { if (typeof window._updateGlobalLb === 'function') window._updateGlobalLb(); }
      catch (_) {}
    }, 2500);

    // 5. Re-render active tab so stats are fresh
    setTimeout(() => {
      try { if (typeof window._renderActiveTab === 'function') window._renderActiveTab(); }
      catch (_) {}
    }, 3000);
  }

  /* ── Network listeners ────────────────────────────────────────────────── */
  function _handleOnline() {
    setOfflineClass(false);
    onReconnect();
  }

  function _handleOffline() {
    setOfflineClass(true);
  }

  window.addEventListener('online',  _handleOnline);
  window.addEventListener('offline', _handleOffline);

  // Set initial state immediately (before DOMContentLoaded)
  if (!navigator.onLine) setOfflineClass(true);

  /* ── Public API ───────────────────────────────────────────────────────── */
  window.OfflineSync = {
    generateSessionId,
    onTimerStart,
    onTimerStop,
    onSessionComplete,
    onSessionSynced,
    checkInterruptedTimer,
    getPendingQueue,
    onReconnect,
    setOfflineClass,
    showSyncingBanner,
  };

  console.log('[OfflineSync] Module loaded. Queue:', (lsGet(K_QUEUE) || []).length, 'pending session(s)');
})();
