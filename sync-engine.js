// sync-engine.js — Production-grade global realtime sync engine v1
// ─────────────────────────────────────────────────────────────────────────────
// Features:
//   • Cross-device onSnapshot listener on users/{uid} — instant remote merge
//   • Priority write queue: IMMEDIATE (0 ms) | FAST (600 ms) | NORMAL (handled by script.js)
//   • Conflict resolution via _syncVersion + _savedAt timestamps
//   • Global leaderboard XP sync (global_lb) after every XP change
//   • Offline queue — mutations during offline are stored and replayed on reconnect
//   • 30-second heartbeat keeps _lastSeen / _online fresh in Firestore
//   • Full sync logging under [SyncEngine] prefix
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const SyncEngine = (() => {

  // ── Priority constants ─────────────────────────────────────────────────────
  const PRIORITY = Object.freeze({ IMMEDIATE: 0, FAST: 1, NORMAL: 2 });
  const DELAYS   = [0, 600, 3000];

  // ── Internal state ─────────────────────────────────────────────────────────
  let _db            = null;
  let _uid           = null;
  let _getState      = null;   // () => currentState object
  let _onRemote      = null;   // (parsedState) => void — called when cloud is newer
  let _liveUnsub     = null;   // Firestore onSnapshot unsubscriber
  let _fastTimer     = null;   // debounce for FAST writes
  let _hbTimer       = null;   // heartbeat interval
  let _lbTimer       = null;   // global_lb debounce
  let _isOnline      = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let _offlineQueue  = [];     // queued mutations to replay after reconnect
  let _myLastVersion = 0;      // syncVersion of the last state we pushed to cloud
  let _started       = false;

  // ── Logging ────────────────────────────────────────────────────────────────
  const _log  = (m, ...a) => console.log(`[SyncEngine] ${m}`, ...a);
  const _warn = (m, ...a) => console.warn(`[SyncEngine] ${m}`, ...a);

  // ── Guards ─────────────────────────────────────────────────────────────────
  function _canWrite() {
    return !!(_db && _uid && _isOnline);
  }

  function _isStateMeaningful(s) {
    if (!s || !Array.isArray(s.subjects)) return false;
    if (s.subjects.length > 0) return true;
    if (s.xp && s.xp.total > 0) return true;
    if (s.focusStats && s.focusStats.totalMinutes > 0) return true;
    if (s.streak && s.streak.current > 0) return true;
    return false;
  }

  // ── Conflict resolution ────────────────────────────────────────────────────
  // Returns true only when the cloud snapshot is strictly newer than local state.
  function _cloudIsNewer(cloudData) {
    const cV = typeof cloudData._syncVersion === 'number' ? cloudData._syncVersion : 0;
    const cT = typeof cloudData._savedAt     === 'number' ? cloudData._savedAt     : 0;
    const st = _getState ? _getState() : null;
    if (!st) return false;
    const lV = typeof st._syncVersion === 'number' ? st._syncVersion : 0;
    const lT = typeof st._savedAt     === 'number' ? st._savedAt     : 0;
    if (cV > lV) return true;
    // Same version but cloud timestamp is meaningfully newer (> 10 s) — treat as newer
    if (cV === lV && cT > lT + 10000) return true;
    return false;
  }

  // ── Cross-device onSnapshot listener ──────────────────────────────────────
  function _startLiveSync() {
    if (_liveUnsub) { _liveUnsub(); _liveUnsub = null; }
    if (!_db || !_uid) return;
    _log('Live cross-device sync ON — uid:', _uid);

    _liveUnsub = _db.collection('users').doc(_uid)
      .onSnapshot({ includeMetadataChanges: true }, snap => {
        // Skip writes that are still pending locally — wait for server confirmation
        if (snap.metadata.hasPendingWrites) return;
        if (!snap.exists) return;
        const snapData = snap.data();
        if (!snapData || !snapData.data) return;

        let parsed;
        try { parsed = JSON.parse(snapData.data); } catch (_) { return; }
        if (!parsed || !Array.isArray(parsed.subjects)) return;

        const cloudV = typeof parsed._syncVersion === 'number' ? parsed._syncVersion : 0;

        // Skip if this is our own write — we already have this version locally
        if (cloudV <= _myLastVersion) {
          _log('Remote snapshot skipped — own write or same version (cloudV=%s, myLastV=%s)',
            cloudV, _myLastVersion);
          return;
        }

        // Full conflict check
        if (!_cloudIsNewer(parsed)) {
          const st = _getState ? _getState() : null;
          _log('Remote snapshot skipped — local is same/newer (localV=%s, cloudV=%s)',
            st ? (st._syncVersion || 0) : '?', cloudV);
          return;
        }

        _log('✓ Remote snapshot applied — cloudV=%s', cloudV);
        _myLastVersion = cloudV;
        if (_onRemote) _onRemote(parsed);

      }, err => {
        _warn('onSnapshot error:', err.message);
      });
  }

  function _stopLiveSync() {
    if (_liveUnsub) { _liveUnsub(); _liveUnsub = null; }
  }

  // ── Priority write ─────────────────────────────────────────────────────────
  function _writeNow(stateArg) {
    if (!_canWrite()) {
      _queueOffline('write');
      return;
    }

    const st = stateArg || (_getState ? _getState() : null);
    if (!st) return;

    // Never push empty/demo state when real cloud data is known to exist
    const guardFn = window._getUserHasCloudData;
    if (typeof guardFn === 'function' && guardFn() && !_isStateMeaningful(st)) {
      _warn('Priority write blocked — state not meaningful, cloud data exists');
      return;
    }

    // Never write during active cloud restore
    const restoreFn = window._isCloudRestoreInProgress;
    if (typeof restoreFn === 'function' && restoreFn()) {
      _warn('Priority write blocked — cloud restore in progress');
      return;
    }

    const syncVer = typeof st._syncVersion === 'number' ? st._syncVersion : 0;
    _myLastVersion = syncVer;   // mark so our own onSnapshot won't re-apply this version

    _db.collection('users').doc(_uid).set({
      data:         JSON.stringify(st),
      uid:          _uid,
      _syncVersion: syncVer,
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
      .then(() => { _log('Priority write OK — syncVersion:', syncVer); })
      .catch(e => {
        _warn('Priority write failed:', e.message);
        _queueOffline('write');
      });
  }

  // ── Public: schedule a write at a given priority tier ─────────────────────
  // NORMAL priority is handled by the existing _scheduledCloudSync in script.js.
  // FAST adds an additional faster write for critical mutations (task/XP).
  // IMMEDIATE writes synchronously without any delay.
  function schedulePush(priority) {
    if (priority === PRIORITY.NORMAL) return;
    clearTimeout(_fastTimer);
    if (priority === PRIORITY.IMMEDIATE) {
      _writeNow();
      return;
    }
    // FAST
    _fastTimer = setTimeout(_writeNow, DELAYS[1]);
  }

  // ── Global leaderboard XP sync ─────────────────────────────────────────────
  // Debounced (1.5 s) so bursts of XP (multiple task checks) batch into one write.
  function syncXPToLeaderboard(xpTotal) {
    if (!_db || !_uid) return;
    clearTimeout(_lbTimer);
    _lbTimer = setTimeout(() => {
      if (!_isOnline || !_db || !_uid) { return; }
      const st   = _getState ? _getState() : null;
      const name = (st && st.profile && st.profile.name)
        ? String(st.profile.name).trim() : '';
      if (!name) return;
      const xp = typeof xpTotal === 'number' ? xpTotal
        : (st && st.xp ? (st.xp.total || 0) : 0);
      _db.collection('global_lb').doc(_uid).set({
        xpTotal:   xp,
        name,
        nameLower: name.toLowerCase(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
        .then(() => { _log('global_lb XP synced — xpTotal:', xp); })
        .catch(e => _warn('global_lb XP sync failed:', e.message));
    }, 1500);
  }

  // ── Offline queue ──────────────────────────────────────────────────────────
  function _queueOffline(type) {
    _offlineQueue.push({ type, ts: Date.now() });
    try { localStorage.setItem('_se_queue', JSON.stringify(_offlineQueue)); } catch (_) {}
    _log('Queued offline action:', type, '| queue length:', _offlineQueue.length);
  }

  function _loadOfflineQueue() {
    try {
      const raw = localStorage.getItem('_se_queue');
      if (raw) _offlineQueue = JSON.parse(raw) || [];
    } catch (_) { _offlineQueue = []; }
  }

  function _replayOfflineQueue() {
    if (!_canWrite() || _offlineQueue.length === 0) return;
    _log('Replaying offline queue —', _offlineQueue.length, 'action(s)');
    // Clear the queue — current state already contains all pending mutations
    _offlineQueue = [];
    try { localStorage.removeItem('_se_queue'); } catch (_) {}
    // Push the latest local state to cloud
    _writeNow();
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  // Keeps _lastSeen + _online fresh in Firestore every 30 s.
  // Allows other clients to detect stale presence sessions.
  function _startHeartbeat() {
    if (_hbTimer) clearInterval(_hbTimer);
    _hbTimer = setInterval(() => {
      if (!_canWrite()) return;
      _db.collection('users').doc(_uid).set({
        _lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        _online:   true
      }, { merge: true }).catch(() => {});
    }, 30000);
  }

  function _stopHeartbeat() {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  }

  // ── Network event handlers ─────────────────────────────────────────────────
  function _onNetOnline() {
    _isOnline = true;
    _log('Network online — replaying offline queue');
    setTimeout(_replayOfflineQueue, 800);
  }

  function _onNetOffline() {
    _isOnline = false;
    _log('Network offline — future writes will queue');
  }

  // ── Public: start ──────────────────────────────────────────────────────────
  function start(db, uid, getStateFn, onRemoteFn) {
    if (_started) stop();
    _db       = db;
    _uid      = uid;
    _getState = getStateFn;
    _onRemote = onRemoteFn;
    _isOnline = navigator.onLine;
    _started  = true;
    _loadOfflineQueue();
    _startLiveSync();
    _startHeartbeat();
    window.addEventListener('online',  _onNetOnline);
    window.addEventListener('offline', _onNetOffline);
    _log('Started. uid:', uid, '| online:', _isOnline,
      '| queued:', _offlineQueue.length, 'action(s)');
    if (_offlineQueue.length > 0) setTimeout(_replayOfflineQueue, 1500);
  }

  // ── Public: stop ───────────────────────────────────────────────────────────
  function stop() {
    _stopLiveSync();
    _stopHeartbeat();
    clearTimeout(_fastTimer);
    clearTimeout(_lbTimer);
    window.removeEventListener('online',  _onNetOnline);
    window.removeEventListener('offline', _onNetOffline);
    _db = null; _uid = null; _getState = null; _onRemote = null;
    _started = false;
    _log('Stopped.');
  }

  return { start, stop, schedulePush, syncXPToLeaderboard, PRIORITY };
})();

window.SyncEngine = SyncEngine;
console.log('[SyncEngine] Module loaded.');
