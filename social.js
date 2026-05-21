// social.js — Study Community System v2
// Rooms tab: Group Discovery Feed (YPT-inspired, international)
// Uses: window.appUI (set by script.js bridge), localStorage sc_v1

(() => {
  'use strict';

  const SC_KEY  = 'sc_v1';
  const genId   = () => Math.random().toString(36).slice(2, 10);
  const genCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  };

  // ── UI bridge ────────────────────────────────────────────────────────────
  const ui          = () => window.appUI || {};
  const toast       = (m, t, d)  => { try { ui().toast?.(m, t, d); } catch(_) {} };
  const openModal   = (h, cb)    => { try { ui().openModal?.(h, cb); } catch(_) {} };
  const closeModal  = ()         => { try { ui().closeModal?.(); } catch(_) {} };
  const confirmModal= (m, cb, o) => { try { ui().confirmModal?.(m, cb, o); } catch(_) {} };
  const esc = (s) => {
    try { return ui().html?.(String(s)) ?? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    catch(_) { return String(s ?? ''); }
  };
  const minsToHrs = (m) => {
    try { return ui().minsToHrs?.(m) ?? (m < 60 ? m + 'm' : Math.floor(m/60) + 'h ' + (m%60 ? m%60+'m' : '')).trim(); }
    catch(_) { return m + 'm'; }
  };
  const todayKey     = () => { try { return ui().todayKey?.() ?? new Date().toISOString().slice(0,10); } catch(_) { return new Date().toISOString().slice(0,10); } };
  const getMainState = () => { try { return ui().state?.() ?? {}; } catch(_) { return {}; } };
  const getDb        = () => { try { return ui().getDb?.()     ?? null; } catch(_) { return null; } };
  const getUserId    = () => { try { return ui().getUserId?.() ?? null; } catch(_) { return null; } };
  const getFb        = () => { try { return window.firebase    ?? null; } catch(_) { return null; } };

  // ── Display name helper ───────────────────────────────────────────────────
  // Priority: 1) saved nickname, 2) Firebase auth displayName, 3) email-derived name
  // Never returns "You". Saves derived name to Firestore as displayNameAuto.
  function _getUserDisplayName() {
    const ms = getMainState();
    // Priority 1: explicit nickname (not "You" placeholder)
    if (ms.profile?.name && ms.profile.name !== 'You' && ms.profile.name.trim()) {
      return ms.profile.name.trim();
    }
    // Priority 2: Firebase auth displayName
    const fb = getFb();
    const fbUser = fb?.auth?.()?.currentUser;
    if (fbUser?.displayName && fbUser.displayName.trim()) {
      return fbUser.displayName.trim();
    }
    // Priority 3: derive from email (e.g. tajwarhossain@gmail.com → Tajwarhossain)
    const email = fbUser?.email || ms.profile?.email || '';
    if (email) {
      const local = email.split('@')[0] || '';
      if (local) {
        const derived = local.charAt(0).toUpperCase() + local.slice(1);
        // Persist so all parts of the app can use it
        const db = getDb(), uid = getUserId();
        if (db && uid) {
          db.collection('users').doc(uid)
            .set({ displayNameAuto: derived }, { merge: true }).catch(() => {});
        }
        return derived;
      }
    }
    return 'Studier';
  }

  // ── Role helper ───────────────────────────────────────────────────────────
  // Returns 'owner' | 'admin' | 'member' | null
  // SAFE: guards against null/undefined members entries (e.g. placeholder arrays)
  function _getMyRole(g) {
    try {
      const uid = getUserId();
      if (!uid || !g) return null;
      // owner: UID matches any ownership/creator field
      if (g.ownerUid === uid || g.createdByUid === uid || g.createdBy === uid) return 'owner';
      // admin: explicitly listed in admins[] array in Firestore
      const admins = Array.isArray(g.admins) ? g.admins : [];
      if (admins.includes(uid)) return 'admin';
      // member: check members array role or locally stored role
      const me = (g.members || []).find(m => m != null && ((m.id || m.uid) === uid));
      if (me) return (me.role === 'admin' || me.role === 'owner') ? 'admin' : 'member';
      // _isLocalMember flag means this group is in sc_v1 — user is confirmed member/admin
      if (g._isLocalMember) return g.role || 'member';
      if (g.role === 'member') return 'member';
      return null;
    } catch(_) { return null; }
  }

  // Auto-migrate old group document — ONLY fills missing ownerUid from existing creator fields.
  // NEVER changes ownership to the calling uid unless they are the verified creator.
  // NEVER adds the calling uid to admins unless they are the verified creator.
  function _autoMigrateGroupDoc(code, data, uid) {
    const db = getDb(), fb_ = getFb();
    if (!db || !fb_ || !code) return;
    const patch = {};
    // Fix missing ownerUid by using the existing createdByUid/createdBy — NOT the calling uid
    if (!data.ownerUid && data.createdByUid) patch.ownerUid = data.createdByUid;
    else if (!data.ownerUid && data.createdBy) patch.ownerUid = data.createdBy;
    // Fix missing createdByUid from createdBy — NOT from calling uid
    if (!data.createdByUid && data.createdBy) patch.createdByUid = data.createdBy;
    // Only add uid to admins if they are the VERIFIED creator of this group
    const verifiedCreator = data.createdBy === uid || data.createdByUid === uid || data.ownerUid === uid;
    if (verifiedCreator) {
      const admins = Array.isArray(data.admins) ? data.admins : [];
      if (!admins.includes(uid)) patch.admins = fb_.firestore.FieldValue.arrayUnion(uid);
    }
    if (Object.keys(patch).length > 0) {
      db.collection('groups').doc(code).set(patch, { merge: true }).catch(() => {});
    }
  }

  // ── My Groups realtime subscription ──────────────────────────────────────
  // Listens for all groups where createdByUid == currentUser.uid
  // and merges them into localStorage so My Groups tab is always accurate.
  let _myGroupsRetries = 0;
  function _subscribeMyGroups() {
    if (_myGroupsUnsub) { try { _myGroupsUnsub(); } catch(_) {} _myGroupsUnsub = null; }
    const db = getDb(), uid = getUserId();
    if (!db || !uid) {
      // Retry up to 8 times (~12 seconds) then give up — user may be logged out
      if (_myGroupsRetries < 8) { _myGroupsRetries++; setTimeout(_subscribeMyGroups, 1500); }
      return;
    }
    _myGroupsRetries = 0;
    try {
      _myGroupsUnsub = db.collection('groups')
        .where('createdByUid', '==', uid)
        .onSnapshot(snap => {
          const myName = _getUserDisplayName();
          const sc     = scLoad();
          let dirty    = false;
          snap.docs.forEach(d => {
            const data = d.data();
            const code = d.id;
            const existing = sc.groups.find(g => g.code === code);
            if (!existing) {
              const rawCat = data.category || 'General';
              sc.groups.push({
                id:           data.groupId || code,
                name:         data.name || `Group ${code}`,
                icon:         data.icon || '📚',
                code,
                isPrivate:    data.isPrivate || false,
                description:  data.description || '',
                category:     rawCat === 'camstudy' ? 'General' : rawCat,
                dailyGoalHrs: data.dailyGoalHrs || 8,
                maxMembers:   data.maxMembers || 50,
                leader:       data.createdByName || data.leader || myName,
                promoted:     false,
                createdAt:    data.createdAt?.toMillis?.() ?? Date.now(),
                dailyMinsTotal: 0, attendancePct: 0,
                role:         'admin',
                createdByUid: data.createdByUid || uid,
                ownerUid:     data.ownerUid || data.createdByUid || uid,
                admins:       Array.isArray(data.admins) ? data.admins : [uid],
                members:      [{ id: uid, name: myName, role: 'admin', joinedAt: Date.now() }],
              });
              dirty = true;
            } else {
              // Keep local group in sync with Firestore ownership + live fields
              let changed = false;
              if (!existing.createdByUid) { existing.createdByUid = data.createdByUid || uid; changed = true; }
              if (!existing.ownerUid)     { existing.ownerUid     = data.ownerUid || data.createdByUid || uid; changed = true; }
              if (!Array.isArray(existing.admins) || !existing.admins.includes(uid)) {
                existing.admins = Array.isArray(data.admins) ? data.admins : [uid]; changed = true;
              }
              if (existing.role !== 'admin') { existing.role = 'admin'; changed = true; }
              if (typeof data.memberCount === 'number' && existing.memberCount !== data.memberCount) {
                existing.memberCount = data.memberCount; changed = true;
              }
              if (changed) dirty = true;
            }
          });
          if (dirty) scSave(sc);
          // Clear Groups PTR loading state
          if (_ptrGroupLoading) {
            _ptrGroupLoading = false;
            if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; }
          }
          // Schedule a group-doc subscription refresh so memberCount stays live
          setTimeout(_ensureGroupDocSubs, 200);
          // Also ensure creator is in members subcollection for each own group
          snap.docs.forEach(d => {
            const fb_ = getFb();
            if (!fb_) return;
            db.collection('groups').doc(d.id).collection('members').doc(uid)
              .get().then(ms => {
                if (!ms.exists) {
                  db.collection('groups').doc(d.id).collection('members').doc(uid).set({
                    uid, displayName: _getUserDisplayName(), role: 'admin',
                    joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
                    isStudying: false, currentSubject: null, elapsedTimeToday: 0,
                  }, { merge: true }).catch(() => {});
                }
              }).catch(() => {});
          });
          if ((_tab === 'groups' || _tab === 'rooms') && !_groupView && !_destroyed) _scheduleRender();
        }, () => { _myGroupsUnsub = null; });
    } catch(_) { _myGroupsUnsub = null; }
  }

  // ── My Groups by ownerUid (catches old groups without createdByUid) ─────
  let _myGroupsByOwnerUnsub = null;
  function _subscribeMyGroupsByOwner() {
    if (_myGroupsByOwnerUnsub) { try { _myGroupsByOwnerUnsub(); } catch(_) {} _myGroupsByOwnerUnsub = null; }
    const db = getDb(), uid = getUserId();
    if (!db || !uid) return;
    try {
      _myGroupsByOwnerUnsub = db.collection('groups')
        .where('ownerUid', '==', uid)
        .onSnapshot(snap => {
          const myName = _getUserDisplayName();
          const sc = scLoad();
          let dirty = false;
          snap.docs.forEach(d => {
            const data = d.data(), code = d.id;
            const existing = sc.groups.find(g => g.code === code);
            if (!existing) {
              const rawCat = data.category || 'General';
              sc.groups.push({
                id: data.groupId || code,
                name: data.name || `Group ${code}`,
                icon: data.icon || '📚', code,
                isPrivate: data.isPrivate || false,
                description: data.description || '',
                category: rawCat === 'camstudy' ? 'General' : rawCat,
                dailyGoalHrs: data.dailyGoalHrs || 8,
                maxMembers: data.maxMembers || 50,
                leader: data.createdByName || data.leader || myName,
                promoted: false,
                createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
                dailyMinsTotal: 0, attendancePct: 0,
                role: 'admin',
                createdByUid: data.createdByUid || uid,
                ownerUid: uid,
                admins: Array.isArray(data.admins) ? data.admins : [uid],
                members: [{ id: uid, name: myName, role: 'admin', joinedAt: Date.now() }],
                memberCount: data.memberCount || 0,
              });
              dirty = true;
            } else {
              let changed = false;
              if (existing.role !== 'admin') { existing.role = 'admin'; changed = true; }
              if (!existing.ownerUid) { existing.ownerUid = uid; changed = true; }
              if (!existing.createdByUid) { existing.createdByUid = data.createdByUid || uid; changed = true; }
              if (!Array.isArray(existing.admins) || !existing.admins.includes(uid)) {
                existing.admins = Array.isArray(data.admins) ? [...data.admins] : [uid];
                if (!existing.admins.includes(uid)) existing.admins.push(uid);
                changed = true;
              }
              if (typeof data.memberCount === 'number' && existing.memberCount !== data.memberCount) {
                existing.memberCount = data.memberCount; changed = true;
              }
              if (changed) dirty = true;
            }
            // Auto-migrate Firestore doc if missing fields
            _autoMigrateGroupDoc(code, data, uid);
          });
          if (dirty) scSave(sc);
          setTimeout(_ensureGroupDocSubs, 200);
          if ((_tab === 'groups' || _tab === 'rooms') && !_groupView && !_destroyed) _scheduleRender();
        }, () => { _myGroupsByOwnerUnsub = null; });
    } catch(_) { _myGroupsByOwnerUnsub = null; }
  }

  // ── Subscribe to each local group's Firestore doc for live memberCount ────
  // ── Member-count self-healer ──────────────────────────────────────────────
  // Counts the actual members subcollection and writes the real number back to
  // the group doc. Called after every join/leave to correct any historical drift.
  function _recalcMemberCount(code) {
    const db_ = getDb();
    if (!db_ || !code) return;
    db_.collection('groups').doc(code).collection('members').get()
      .then(snap => {
        const actual = snap.size;
        if (actual >= 0) {
          db_.collection('groups').doc(code)
            .update({ memberCount: actual })
            .catch(() => {});
        }
      }).catch(() => {});
  }

  // ── Ghost member detection ────────────────────────────────────────────────
  // Checks every non-self member UID in the room against users/{uid}.
  // Members whose user doc is missing are "orphans" (deleted accounts).
  // They are:
  //   1. Added to _confirmedOrphans → filtered out of all renders immediately.
  //   2. Batch-deleted from Firestore if the current user owns the group.
  // Uses FieldPath.documentId() 'in' queries (10-per-chunk) to minimise reads.
  async function _detectGhostMembers(code) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!db_ || !uid_ || !fb_) return;
    const memberUids = Object.keys(_liveMembers).filter(u => u !== uid_);
    if (!memberUids.length) return;

    const ghosts = [];
    // Chunk into ≤10 per Firestore 'in' limit
    for (let i = 0; i < memberUids.length; i += 10) {
      const chunk = memberUids.slice(i, i + 10);
      try {
        const snap = await db_.collection('users')
          .where(fb_.firestore.FieldPath.documentId(), 'in', chunk)
          .get();
        const found = new Set(snap.docs.map(d => d.id));
        chunk.forEach(u => { if (!found.has(u)) ghosts.push(u); });
      } catch(_) {}
    }
    if (!ghosts.length) return;

    // Register orphans for immediate visual filtering
    ghosts.forEach(u => _confirmedOrphans.add(u));
    // Remove orphans from local live members / session caches
    ghosts.forEach(u => {
      delete _liveMembers[u];
      delete _activeSessionsCache[u];
      if (_activeSessionsUnsubs[u])  { try { _activeSessionsUnsubs[u](); }  catch(_) {} delete _activeSessionsUnsubs[u]; }
      if (_memberPresenceUnsubs[u])  { try { _memberPresenceUnsubs[u](); }  catch(_) {} delete _memberPresenceUnsubs[u]; }
    });
    if (window._currentTab === 'social') renderSocial();

    // Destructive Firestore cleanup — only if current user is owner/admin of this group
    const sc_  = scLoad();
    const myG  = sc_.groups.find(g => g.code === code);
    const canClean = myG && (myG.ownerUid === uid_ || myG.createdByUid === uid_ ||
                             (Array.isArray(myG.adminUids) && myG.adminUids.includes(uid_)));
    if (!canClean) return;

    // Batch delete: up to 500 ops. Firestore batch.update increments count once per ghost.
    // Split into sub-batches of 200 to stay well under the 500-op limit.
    const groupRef = db_.collection('groups').doc(code);
    const BATCH_SIZE = 200;
    for (let i = 0; i < ghosts.length; i += BATCH_SIZE) {
      const slice = ghosts.slice(i, i + BATCH_SIZE);
      const batch = db_.batch();
      slice.forEach(ghostUid => {
        batch.delete(groupRef.collection('members').doc(ghostUid));
        batch.delete(groupRef.collection('presence').doc(ghostUid));
        batch.delete(groupRef.collection('joinRequests').doc(ghostUid));
        batch.delete(groupRef.collection('voice_presence').doc(ghostUid));
        // Each ghost decrement is a separate update — track total outside batch
      });
      try { await batch.commit(); } catch(_) {}
    }
    // Clean activeSessions/{uid} for each ghost (separate collection, no group scope)
    await Promise.allSettled(
      ghosts.map(u => db_.collection('activeSessions').doc(u).delete().catch(() => {}))
    );
    // Recalculate authoritative count after all deletes
    _recalcMemberCount(code);
  }

  // ── Unread message tracking ───────────────────────────────────────────────
  const _unreadCounts   = {};  // { [groupCode]: number }
  const _lastSeenTs     = {};  // { [groupCode]: ms timestamp }
  const _nudgeListeners = {};  // { [groupCode]: unsub fn }

  function _updateLastSeen(code) {
    if (!code) return;
    _lastSeenTs[code]   = Date.now();
    _unreadCounts[code] = 0;
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (db_ && uid_ && fb_) {
      db_.collection('groups').doc(code).collection('members').doc(uid_)
        .set({ lastSeen: fb_.firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {});
    }
    _refreshUnreadBadges();
  }

  function _recomputeUnread(code) {
    if (!code) return;
    const msgs     = (_chatMessages && _chatMessages[code]) || [];
    const lastSeen = _lastSeenTs[code] || 0;
    const uid_     = getUserId();
    let count = 0;
    msgs.forEach(m => {
      if (m._deleted) return;
      const ts = m.ts?.toMillis?.() ?? (typeof m.ts === 'number' ? m.ts : 0);
      if (ts > lastSeen && m.authorId !== uid_) count++;
    });
    _unreadCounts[code] = count;
    _refreshUnreadBadges();
  }

  function _refreshUnreadBadges() {
    try {
      const chatBtn = document.querySelector('.sr-nav-btn[data-tab="chat"]');
      if (chatBtn) {
        const sc_  = scLoad();
        const code = _groupView ? sc_.groups.find(x => x.id === _groupView)?.code : null;
        const cnt  = code ? (_unreadCounts[code] || 0) : 0;
        let badge  = chatBtn.querySelector('.sr-unread-badge');
        if (cnt > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'sr-unread-badge';
            chatBtn.style.position = 'relative';
            chatBtn.appendChild(badge);
          }
          badge.textContent = cnt > 99 ? '99+' : String(cnt);
        } else {
          badge?.remove();
        }
      }
    } catch(_) {}
  }

  function _subscribeNudges(code) {
    if (!code || _nudgeListeners[code]) return;
    const db_ = getDb(), uid_ = getUserId();
    if (!db_ || !uid_) return;
    try {
      const cutoffMs = Date.now() - 10 * 60 * 1000;
      _nudgeListeners[code] = db_.collection('groups').doc(code)
        .collection('nudges')
        .orderBy('sentAt', 'desc')
        .limit(1)
        .onSnapshot(snap => {
          if (snap.empty) return;
          const nudge  = snap.docs[0].data();
          const sentMs = nudge.sentAt?.toMillis?.() ?? (typeof nudge.sentAt === 'number' ? nudge.sentAt : 0);
          if (!sentMs || sentMs < cutoffMs) return;
          if (nudge.senderUid === uid_) return;
          const sc_     = scLoad();
          const gL      = sc_.groups.find(x => x.code === code);
          const prevMs  = gL?._lastNudgeReceived || 0;
          if (sentMs <= prevMs) return;
          if (gL) { gL._lastNudgeReceived = sentMs; scSave(sc_); }
          toast(`📣 ${esc(nudge.senderName || 'Admin')} is nudging you to study!`, 'info', 5000);
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch(_) {}
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification('📢 Study Reminder', {
                body:     nudge.message || `${nudge.senderName || 'Admin'} is nudging you to study!`,
                icon:     '/icon-192.png',
                badge:    '/icon-192.png',
                tag:      `nudge-${code}`,
                renotify: true,
                vibrate:  [200, 100, 200],
              });
            } catch(_) {}
          }
        }, () => { delete _nudgeListeners[code]; });
    } catch(_) { delete _nudgeListeners[code]; }
  }

  // ── Global presence broadcaster ───────────────────────────────────────────
  // Single source of truth for the current user's study session start time.
  // Stored once when a session begins; reused for all group member doc writes
  // so every group shows the identical live timer (Date.now() - _mySessionStartedAt).
  let _mySessionStartedAt = null;

  // Writes the same presence snapshot to ALL joined groups atomically.
  // This is the only function that should push presence data to Firestore —
  // never write per-group directly, or timers will diverge between groups.
  function _writePresenceAllGroups(isStudying, todayMins, avStage) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!db_ || !uid_ || !fb_) return;
    const sc_ = scLoad();
    const codes = sc_.groups.map(g => g.code).filter(Boolean);
    if (!codes.length) return;

    // Manage session start time: set ONCE when transitioning to studying,
    // clear when stopping. Never reset mid-session (that would make all timers
    // restart from 0 for remote viewers on the next snapshot).
    if (isStudying && !_mySessionStartedAt) {
      _mySessionStartedAt = Date.now();
    } else if (!isStudying) {
      _mySessionStartedAt = null;
    }

    const tk_ = todayKey();
    const update = {
      uid:              uid_,
      displayName:      _getUserDisplayName(),
      isStudying:       !!isStudying,
      elapsedTimeToday: todayMins || 0,
      dateKey:          tk_,
      avatarStage:      typeof avStage === 'number' ? avStage : (window._lsGetCurrentAvStage?.() || 0),
      lastUpdated:      fb_.firestore.FieldValue.serverTimestamp(),
    };
    // studyStartedAt is kept stable for the entire session so remote clients
    // can always compute: liveSecs = Date.now() - studyStartedAt
    if (isStudying && _mySessionStartedAt) {
      update.studyStartedAt = _mySessionStartedAt;
    }

    // ── 1. Write global canonical presence to users/{uid} ────────────────────
    // This is the single source of truth that group rooms subscribe to.
    // Even if a group member doc is stale, this doc always has the real value.
    try {
      const globalUpdate = {
        todayFocusMinutes: todayMins || 0,
        todayDateKey:      tk_,
        isStudying:        !!isStudying,
        presenceUpdatedAt: fb_.firestore.FieldValue.serverTimestamp(),
      };
      if (isStudying && _mySessionStartedAt) {
        globalUpdate.studyStartedAt = _mySessionStartedAt;
      } else {
        globalUpdate.studyStartedAt = fb_.firestore.FieldValue.delete();
      }
      db_.collection('users').doc(uid_).set(globalUpdate, { merge: true }).catch(() => {});
    } catch(_) {}

    // ── 2. Batch write to all group member docs ───────────────────────────────
    // Group member docs carry isStudying, role, displayName, avatarStage etc.
    // elapsedTimeToday here stays in sync via the batch; the users/{uid} doc
    // is the authoritative override that group room listeners use.
    // When stopping, explicitly delete studyStartedAt so remote clients don't
    // continue computing live elapsed time from a stale start timestamp.
    if (!isStudying) {
      update.studyStartedAt = fb_.firestore.FieldValue.delete();
    }
    const batch = db_.batch();
    codes.forEach(code => {
      batch.set(
        db_.collection('groups').doc(code).collection('members').doc(uid_),
        update,
        { merge: true }
      );
    });
    batch.commit()
      .then(() => { codes.forEach(code => _updateGroupStats(code)); })
      .catch(() => {
        // Fallback: write individually if batch fails
        codes.forEach(code => {
          db_.collection('groups').doc(code).collection('members').doc(uid_)
            .set(update, { merge: true }).catch(() => {});
        });
      });

    // Also write to the top-level activeSessions/{uid} doc — a single write
    // that ALL group rooms subscribe to, ensuring instant cross-group sync.
    _writeActiveSession(isStudying);
  }

  // ── activeSessions/{uid} writer ───────────────────────────────────────────
  // Writes the current focus state to the top-level activeSessions collection.
  // This is the single canonical doc ALL groups subscribe to — one write per
  // event, not one write per group.  Falls back silently if security rules
  // haven't been deployed for this collection yet.
  function _writeActiveSession(isStudying) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!db_ || !uid_ || !fb_) return;
    const sessionDoc = {
      uid:              uid_,
      active:           !!isStudying,
      mode:             isStudying ? 'focus' : 'idle',
      updatedAt:        fb_.firestore.FieldValue.serverTimestamp(),
      // lastHeartbeatAt is refreshed on every write so remote viewers can detect
      // ghost sessions: active && (now - lastHeartbeatAt) > PRESENCE_STALE_MS → offline.
      lastHeartbeatAt:  fb_.firestore.FieldValue.serverTimestamp(),
    };
    if (isStudying && _mySessionStartedAt) {
      sessionDoc.startedAt        = _mySessionStartedAt;  // client ms timestamp (set once)
      sessionDoc.currentSessionId = String(_mySessionStartedAt);
    } else {
      sessionDoc.startedAt        = null;
      sessionDoc.currentSessionId = null;
      sessionDoc.lastActiveAt     = fb_.firestore.FieldValue.serverTimestamp();
    }
    db_.collection('activeSessions').doc(uid_)
      .set(sessionDoc, { merge: true })
      .catch(() => {}); // silent — rules may not cover this collection yet
  }

  // ── Global heartbeat ──────────────────────────────────────────────────────
  // Writes ONLY to activeSessions/{uid} and users/{uid} (2 docs, not N×groups).
  // Runs every 30 s while studying regardless of which tab is open, so remote
  // clients can detect disconnects via the lastHeartbeatAt staleness check.
  function _startGlobalHeartbeat() {
    _stopGlobalHeartbeat();
    _globalHeartbeatInterval = setInterval(() => {
      // Stop automatically if no longer studying
      if (!ui().focusIsRunning?.()) { _stopGlobalHeartbeat(); return; }
      const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
      if (!db_ || !uid_ || !fb_) return;
      const now = fb_.firestore.FieldValue.serverTimestamp();
      // Single-doc write — no per-group fan-out, no battery drain
      db_.collection('activeSessions').doc(uid_)
        .set({ lastHeartbeatAt: now, updatedAt: now, active: true }, { merge: true })
        .catch(() => {});
      // Also keep users/{uid} fresh so the users/{uid} fallback path stays alive
      db_.collection('users').doc(uid_)
        .set({ presenceUpdatedAt: now }, { merge: true })
        .catch(() => {});
      // Prevent the local user from appearing stale in their own _liveMembers entry
      if (_liveMembers[uid_]) _liveMembers[uid_].lastUpdated = Date.now();
    }, 30000); // every 30 s
  }

  function _stopGlobalHeartbeat() {
    if (_globalHeartbeatInterval !== null) {
      clearInterval(_globalHeartbeatInterval);
      _globalHeartbeatInterval = null;
    }
  }

  // Best-effort "I'm gone" write used by visibility/unload handlers.
  // Uses sendBeacon when available for reliability on tab close.
  function _writeOfflineNow() {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!db_ || !uid_ || !fb_) return;
    _stopGlobalHeartbeat();
    db_.collection('activeSessions').doc(uid_)
      .set({
        active:        false,
        lastActiveAt:  fb_.firestore.FieldValue.serverTimestamp(),
        updatedAt:     fb_.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      .catch(() => {});
  }

  // ── Startup reconciliation ─────────────────────────────────────────────────
  // Called once on auth. Writes the user's real today-minutes to all joined
  // group member docs so stale 0-minute docs are corrected immediately.
  function _reconcileAllGroupPresence() {
    const uid = getUserId(), db_ = getDb(), fb_ = getFb();
    if (!uid || !db_ || !fb_) return;
    const ms = getMainState(), tk = todayKey();
    const todayMins = (((ms.focusStats || {}).minutesByDate) || {})[tk] || 0;
    const avStage   = window._lsGetCurrentAvStage?.() || 0;
    // Write current state to all groups (isStudying=false at startup, actual minutes)
    _writePresenceAllGroups(false, todayMins, avStage);
  }

  // ── Group stats aggregator ────────────────────────────────────────────────
  // Reads all member docs for a group, then writes aggregated attendance% and
  // dailyMinsTotal back to the group doc so the Discover feed shows live data.
  // Debounced internally — safe to call frequently from presence updates.
  const _statsDebounce = {};
  function _updateGroupStats(code) {
    const db = getDb(), fb_ = getFb();
    if (!db || !code || !fb_) return;
    // Debounce: at most once every 20 s per group to avoid excessive Firestore writes
    if (_statsDebounce[code]) return;
    _statsDebounce[code] = setTimeout(() => { delete _statsDebounce[code]; }, 20000);
    const tk = todayKey();
    // Look up current group to get goal-based attendance threshold
    const sc = scLoad();
    const grp = sc.groups.find(x => x.code === code);
    const required = _attMinRequired(grp || {});
    db.collection('groups').doc(code).collection('members').get()
      .then(snap => {
        if (snap.empty) return;
        const members = snap.docs.map(d => d.data());
        const total  = members.length;
        // Present = studied at least the group's minimum attendance minutes today
        const present = members.filter(m => m.dateKey === tk && (m.elapsedTimeToday || 0) >= required).length;
        const attendancePct  = total > 0 ? Math.round(present / total * 100) : 0;
        const dailyMinsTotal = members.reduce(
          (sum, m) => sum + (m.dateKey === tk ? Math.round(m.elapsedTimeToday || 0) : 0), 0
        );
        db.collection('groups').doc(code).update({
          attendancePct,
          dailyMinsTotal,
          memberCount: total,
        }).catch(() => {});
      }).catch(() => {});
  }

  // ── Attendance helpers ────────────────────────────────────────────────────
  // Minimum minutes required to count as "Present" for a group day
  function _attMinRequired(g) {
    if (g && g.minAttendanceMins > 0) return g.minAttendanceMins;
    // 25% of daily goal, floor 30 mins
    return Math.max(30, Math.round(((g && g.dailyGoalHrs) || 2) * 15));
  }

  // 7 day objects for the current Fri–Thu week
  function _attWeekDays() {
    const fridayStr  = _weekStart(); // already Friday-based
    const fridayDate = new Date(fridayStr + 'T00:00:00');
    const today      = new Date(); today.setHours(0, 0, 0, 0);
    const dayNames   = ['Fri','Sat','Sun','Mon','Tue','Wed','Thu'];
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(fridayDate); d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      days.push({
        key,
        dayName:  dayNames[i],
        dayNum:   d.getDate(),
        isToday:  d.getTime() === today.getTime(),
        isFuture: d.getTime() >  today.getTime(),
      });
    }
    return days;
  }

  // Canonical attendance status for a single day
  // 'present' | 'missed' | 'future' | 'unknown' | 'offday'
  function _attStatus(mins, isFuture, hasData, required, isOffDay) {
    if (isFuture)  return 'future';
    if (isOffDay)  return 'offday';
    if (!hasData)  return 'unknown';
    return mins >= required ? 'present' : 'missed';
  }

  // Consecutive present-day streak for the current user going backwards from today
  function _attStreak(mbd, required) {
    let streak = 0;
    for (let i = 0; i <= 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key  = d.toISOString().slice(0, 10);
      const mins = mbd[key] || 0;
      if (mins >= required) { streak++; }
      else if (i === 0)     { /* today not present yet — skip, don't break */ }
      else                  { break; }
    }
    return streak;
  }

  // ── Subscribe to each local group's Firestore doc for live memberCount ────
  function _subscribeGroupDocs() {
    const db = getDb(), uid = getUserId();
    if (!db || !uid) return;
    const sc = scLoad();
    sc.groups.forEach(g => {
      if (!g.code || _groupDocUnsubs[g.code]) return;
      try {
        _groupDocUnsubs[g.code] = db.collection('groups').doc(g.code).onSnapshot(snap => {
          if (!snap.exists) return;
          const data = snap.data();
          const sc2  = scLoad();
          const local = sc2.groups.find(x => x.code === g.code);
          if (!local) return;
          let changed = false;
          if (typeof data.memberCount === 'number' && local.memberCount !== data.memberCount) {
            local.memberCount = data.memberCount; changed = true;
          }
          if (data.name && local.name !== data.name) { local.name = data.name; changed = true; }
          if (data.icon && local.icon !== data.icon) { local.icon = data.icon; changed = true; }
          if (data.description !== undefined && local.description !== data.description) { local.description = data.description; changed = true; }
          if (typeof data.dailyGoalHrs === 'number' && local.dailyGoalHrs !== data.dailyGoalHrs) { local.dailyGoalHrs = data.dailyGoalHrs; changed = true; }
          if (typeof data.maxMembers === 'number' && local.maxMembers !== data.maxMembers) { local.maxMembers = data.maxMembers; changed = true; }
          if (typeof data.isPrivate === 'boolean' && local.isPrivate !== data.isPrivate) { local.isPrivate = data.isPrivate; changed = true; }
          if (data.leader && local.leader !== data.leader) { local.leader = data.leader; changed = true; }
          // Sync pinned message so all members see the same banner in real-time
          const newPin = data.pinnedMsg ?? null;
          const oldPin = local.pinnedMsg ?? null;
          const pinChanged = JSON.stringify(newPin) !== JSON.stringify(oldPin);
          if (pinChanged) { local.pinnedMsg = newPin; changed = true; }
          if (data.category && local.category !== data.category) { local.category = data.category; changed = true; }
          // Sync live attendance and focus-time from Firestore
          if (typeof data.dailyMinsTotal === 'number' && local.dailyMinsTotal !== data.dailyMinsTotal) {
            local.dailyMinsTotal = data.dailyMinsTotal; changed = true;
          }
          if (typeof data.attendancePct === 'number' && local.attendancePct !== data.attendancePct) {
            local.attendancePct = data.attendancePct; changed = true;
          }
          if (data.joinMode !== undefined && local.joinMode !== data.joinMode) { local.joinMode = data.joinMode; changed = true; }
          if (data.chatEnabled !== undefined && local.chatEnabled !== data.chatEnabled) { local.chatEnabled = data.chatEnabled; changed = true; }
          if (data.nicknameRequired !== undefined && local.nicknameRequired !== data.nicknameRequired) { local.nicknameRequired = data.nicknameRequired; changed = true; }
          if (data.joinQuestion !== undefined && local.joinQuestion !== data.joinQuestion) { local.joinQuestion = data.joinQuestion; changed = true; }
          if (data.joinPassword !== undefined && local.joinPassword !== data.joinPassword) { local.joinPassword = data.joinPassword; changed = true; }
          if (Array.isArray(data.admins) && JSON.stringify(local.admins) !== JSON.stringify(data.admins)) {
            local.admins = data.admins;
            changed = true;
            // Detect self-demotion: if my uid was removed from admins by an owner
            const myUid_gd = getUserId();
            if (myUid_gd && !data.admins.includes(myUid_gd)) {
              const isOwner_ = local.ownerUid === myUid_gd || local.createdByUid === myUid_gd || local.createdBy === myUid_gd;
              if (!isOwner_ && (local.role === 'admin' || local.role === 'owner')) {
                local.role = 'member';
                toast('Your admin role in "' + (local.name || g.code) + '" was revoked', 'info', 4000);
              }
            }
          }
          if (data.lastNudge !== undefined) {
            const nudgeMs = data.lastNudge?.toMillis?.() ?? (typeof data.lastNudge === 'number' ? data.lastNudge : 0);
            const prevMs  = local._lastNudgeReceived || 0;
            if (nudgeMs && nudgeMs > prevMs) {
              local._lastNudgeReceived = nudgeMs;
              const myUid_n = getUserId();
              if (myUid_n && data.lastNudgeSender) {
                setTimeout(() => {
                  toast(`📣 ${esc(data.lastNudgeSender)} is nudging you to study!`, 'info', 5000);
                  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]); } catch(_) {}
                }, 600);
              }
              changed = true;
            }
          }
          if (changed) {
            scSave(sc2);
            if ((_tab === 'groups' || _tab === 'rooms') && !_destroyed) _scheduleRender();
          }
        }, () => { delete _groupDocUnsubs[g.code]; });
      } catch(_) { delete _groupDocUnsubs[g.code]; }
    });
  }
  // Call after any group list change to ensure all groups are covered
  function _ensureGroupDocSubs() {
    try { _subscribeGroupDocs(); } catch(_) {}
    try {
      const sc_ = scLoad();
      sc_.groups.forEach(g => {
        if (g.code) _subscribeSelfMembership(g.code); // real-time self-kick detection
        if (g.code && (_getMyRole(g) === 'owner' || _getMyRole(g) === 'admin')) {
          _subscribeJoinRequests(g.code);
        }
      });
    } catch(_) {}
  }

  // ── Self-membership listener — detects when the current user is kicked ────
  // Listens to groups/{code}/members/{uid}. If the doc disappears, the user
  // was kicked or banned. Immediately removes the group from local state,
  // cleans up all related subscriptions, and shows a notification.
  function _subscribeSelfMembership(code) {
    if (!code || _selfMemberUnsubs[code]) return;
    const db_ = getDb(), uid_ = getUserId();
    if (!db_ || !uid_) return;
    let _initialLoad = true; // skip the first snapshot (just confirms presence)
    try {
      _selfMemberUnsubs[code] = db_.collection('groups').doc(code)
        .collection('members').doc(uid_)
        .onSnapshot(snap => {
          if (_initialLoad) { _initialLoad = false; return; } // ignore first snapshot
          if (!snap.exists) {
            // Self was removed — purge group from local state immediately
            const sc_ = scLoad();
            const removedGroup = sc_.groups.find(x => x.code === code);
            if (!removedGroup) return; // already gone
            const groupName = removedGroup.name || code;
            sc_.groups = sc_.groups.filter(x => x.code !== code);
            delete sc_.pendingRequests?.[code];
            scSave(sc_);
            // Tear down all subscriptions for this code
            if (_selfMemberUnsubs[code]) { try { _selfMemberUnsubs[code](); } catch(_) {} delete _selfMemberUnsubs[code]; }
            if (_groupDocUnsubs[code])   { try { _groupDocUnsubs[code](); }   catch(_) {} delete _groupDocUnsubs[code]; }
            if (_joinRequestsUnsubs[code]) { try { _joinRequestsUnsubs[code](); } catch(_) {} delete _joinRequestsUnsubs[code]; }
            if (_pendingReqUnsubs[code]) { try { _pendingReqUnsubs[code](); } catch(_) {} delete _pendingReqUnsubs[code]; }
            // If currently inside this group's room view, navigate back
            if (_groupView) {
              const sc2_ = scLoad();
              const cur = sc2_.groups.find(x => x.id === _groupView);
              if (!cur) {
                _groupView = null; _settingsView = false; _srTab = 'home';
                _stopSrTicker(); _unsubscribeRoomMembers();
                toast(`You were removed from "${groupName}" by an admin`, 'warn', 5000);
              } else {
                toast(`You were removed from "${groupName}"`, 'info', 4000);
              }
            } else {
              toast(`You were removed from "${groupName}" by an admin`, 'info', 4000);
            }
            if (!_destroyed) _scheduleRender();
          } else {
            // Doc still exists — sync role if an admin demoted this user's member doc role
            const data = snap.data();
            if (data.role && data.role !== 'admin' && data.role !== 'owner') {
              const sc_ = scLoad();
              const g_ = sc_.groups.find(x => x.code === code);
              if (g_ && g_.role !== data.role) {
                g_.role = data.role;
                scSave(sc_);
                if (!_destroyed) _scheduleRender();
              }
            }
          }
        }, () => { delete _selfMemberUnsubs[code]; });
    } catch(_) { delete _selfMemberUnsubs[code]; }
  }

  // ── Firebase helper: save a group settings patch to Firestore ─────────────
  function _saveGroupSetting(code, patch) {
    const db_ = getDb(), fb_ = getFb();
    if (!db_ || !code || !fb_) return;
    try {
      const payload = Object.assign({}, patch, { updatedAt: fb_.firestore.FieldValue.serverTimestamp() });
      db_.collection('groups').doc(code).set(payload, { merge: true }).catch(() => {});
    } catch(_) {}
  }

  // ── Kick / ban a member — shared by both MM modal and legacy sgs-kick/ban ─
  function _execKickMember(g, targetUid, name, ban) {
    const db_ = getDb(), fb_ = getFb();
    if (!g || !g.code) return;
    const gRef = db_ && db_.collection('groups').doc(g.code);
    if (gRef && fb_) {
      // Use a batch so member delete + group patch + admins removal are atomic
      const batch_ = db_.batch();
      batch_.delete(gRef.collection('members').doc(targetUid));
      const patch = {
        memberCount: fb_.firestore.FieldValue.increment(-1),
        // Always strip from admins and adminUids arrays — prevents ghost-admin bug
        admins:    fb_.firestore.FieldValue.arrayRemove(targetUid),
        adminUids: fb_.firestore.FieldValue.arrayRemove(targetUid),
      };
      if (ban) patch.bannedUids = fb_.firestore.FieldValue.arrayUnion(targetUid);
      batch_.set(gRef, patch, { merge: true });
      batch_.commit()
        .then(() => _recalcMemberCount(g.code))
        .catch(() => {
          // Fallback: fire individually
          gRef.collection('members').doc(targetUid).delete().catch(() => {});
          gRef.set(patch, { merge: true }).catch(() => {});
        });
      db_.collection('users').doc(targetUid).set({
        joinedRooms:  fb_.firestore.FieldValue.arrayRemove(g.code),
        joinedGroups: fb_.firestore.FieldValue.arrayRemove(g.code),
      }, { merge: true }).catch(() => {});
    }
    // Purge from _liveMembers immediately so UI reflects change at once
    delete _liveMembers[targetUid];
    // Update local state: remove from members AND admins arrays
    const sc_ = scLoad(), g_ = sc_.groups.find(x => x.code === g.code || x.id === g.id);
    if (g_) {
      g_.members   = (g_.members||[]).filter(m => (m.id||m.uid) !== targetUid);
      g_.admins    = (g_.admins||[]).filter(a => a !== targetUid);
      g_.adminUids = (g_.adminUids||[]).filter(a => a !== targetUid);
      if (ban) { if (!g_.bannedUids) g_.bannedUids = []; if (!g_.bannedUids.includes(targetUid)) g_.bannedUids.push(targetUid); }
      scSave(sc_);
    }
    toast(ban ? `${name} has been banned` : `${name} removed from group`, 'info');
    closeModal();
    renderSocial();
  }

  // ── Manage Members modal — realtime Firebase onSnapshot ──────────────────
  function _openManageMembersModal(g) {
    const db_mm = getDb(), myUid_mm = getUserId(), fb_mm = getFb();
    if (!db_mm || !g.code) { toast('Cannot load members — Firebase unavailable', 'warn'); return; }
    const myRole   = _getMyRole(g);
    const iAmOwner = myRole === 'owner';
    const iAmAdmin = iAmOwner || myRole === 'admin';
    if (!iAmAdmin) return;

    // Avatar color derived from uid/name (deterministic)
    const _avatarColor = (uid) => {
      const COLORS = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#9333ea'];
      let hash = 0; for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) | 0;
      return COLORS[Math.abs(hash) % COLORS.length];
    };

    // Build one member row HTML
    const _mmRow = (m) => {
      const isMe       = m.uid === myUid_mm;
      const isOwnerMem = m.role === 'owner' || m.uid === (g.ownerUid||g.createdByUid||g.createdBy);
      const isAdminMem = isOwnerMem || m.role === 'admin' || (Array.isArray(g.admins) && g.admins.includes(m.uid));
      const roleLbl    = isOwnerMem ? '<span style="color:#f59e0b;font-size:11px;font-weight:700">👑 Owner</span>' : isAdminMem ? '<span style="color:#7c3aed;font-size:11px;font-weight:700">⚡ Admin</span>' : '<span style="color:var(--text-muted);font-size:11px">✓ Member</span>';
      const lm         = _liveMembers[m.uid] || {};
      const isOnline   = lm.isStudying || (typeof _activeSessionsCache !== 'undefined' && _activeSessionsCache[m.uid]?.active);
      const onlineDot  = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${isOnline ? '#10b981' : '#6b7280'};margin-left:5px;vertical-align:middle" title="${isOnline ? 'Studying now' : 'Offline'}"></span>`;
      const focusMins  = lm.elapsedTimeToday || m.elapsedTimeToday || m.todayMins || 0;
      const focusTxt   = focusMins > 0 ? `<span style="font-size:11px;color:var(--text-muted);margin-left:6px">📚 ${minsToHrs(focusMins)} today</span>` : '';
      const joinedTxt  = (m.joinedAt && m.joinedAt > 0) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Joined ${new Date(typeof m.joinedAt?.toMillis === 'function' ? m.joinedAt.toMillis() : m.joinedAt).toLocaleDateString()}</div>` : '';
      const initials   = esc((m.displayName||m.name||'?').slice(0,2).toUpperCase());
      const dispName   = esc(m.displayName || m.name || 'Unknown');

      // Admin action buttons (only for non-self, non-owner targets)
      let actions = '';
      if (!isMe && !isOwnerMem && iAmAdmin) {
        const promoteBtn = !isAdminMem
          ? `<button class="btn mm-act" data-mmact="promote" data-uid="${esc(m.uid)}" data-name="${dispName}" style="padding:4px 10px;font-size:11px;background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3);border-radius:6px;cursor:pointer">Promote</button>`
          : (iAmOwner ? `<button class="btn mm-act" data-mmact="demote" data-uid="${esc(m.uid)}" data-name="${dispName}" style="padding:4px 10px;font-size:11px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3);border-radius:6px;cursor:pointer">Demote</button>` : '');
        actions = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          ${promoteBtn}
          <button class="btn mm-act" data-mmact="kick" data-uid="${esc(m.uid)}" data-name="${dispName}" style="padding:4px 10px;font-size:11px;background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:6px;cursor:pointer">Kick</button>
          <button class="btn mm-act" data-mmact="ban" data-uid="${esc(m.uid)}" data-name="${dispName}" style="padding:4px 10px;font-size:11px;background:rgba(239,68,68,.07);color:#ef4444;border:1px solid rgba(239,68,68,.2);border-radius:6px;cursor:pointer;opacity:.8">Ban</button>
        </div>`;
      }

      return `<div class="adm-member-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <div style="width:38px;height:38px;border-radius:50%;background:${_avatarColor(m.uid)};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;display:flex;align-items:center;flex-wrap:wrap;gap:3px">
            ${dispName}${isMe ? ' <span style="color:#7c3aed;font-size:11px">(you)</span>' : ''}${onlineDot}${focusTxt}
          </div>
          <div style="margin-top:2px">${roleLbl}</div>
          ${joinedTxt}
          ${actions}
        </div>
      </div>`;
    };

    let _mmUnsub = null;
    let _modalEl = null;
    let _latestMembers = [];

    const _renderList = (docs) => {
      const listEl = _modalEl && _modalEl.querySelector('#mm-list');
      const headEl = _modalEl && _modalEl.querySelector('#mm-count');
      if (!listEl) return;
      // Sort: owner → admin → member, then alphabetically
      const roleOrder = (m) => {
        const isOwner = m.role === 'owner' || m.uid === (g.ownerUid||g.createdByUid||g.createdBy);
        const isAdmin = isOwner || m.role === 'admin' || (Array.isArray(g.admins) && g.admins.includes(m.uid));
        return isOwner ? 0 : isAdmin ? 1 : 2;
      };
      docs.sort((a, b) => roleOrder(a) - roleOrder(b) || (a.displayName||a.name||'').localeCompare(b.displayName||b.name||''));
      if (headEl) headEl.textContent = `${docs.length} member${docs.length !== 1 ? 's' : ''}`;
      listEl.innerHTML = docs.length ? docs.map(_mmRow).join('') : '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">No members found</div>';
    };

    openModal(`
      <h3 class="sc-modal-title">👥 Manage Members</h3>
      <p id="mm-count" style="font-size:13px;color:var(--text-muted);margin:0 0 10px">Loading…</p>
      <div id="mm-list" style="max-height:55vh;overflow-y:auto;margin:0 -4px">
        <div style="text-align:center;padding:28px;color:var(--text-muted);font-size:13px">
          <div style="width:28px;height:28px;border:2px solid #7c3aed;border-top-color:transparent;border-radius:50%;margin:0 auto 10px;animation:spin .7s linear infinite"></div>
          Loading members…
        </div>
      </div>
      <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
    `, (modalEl) => {
      _modalEl = modalEl;

      // Subscribe to groups/{code}/members in realtime
      try {
        _mmUnsub = db_mm.collection('groups').doc(g.code).collection('members')
          .onSnapshot(snap => {
            _latestMembers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
            _renderList(_latestMembers);
          }, () => {
            const listEl = modalEl.querySelector('#mm-list');
            if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px">Failed to load members — check connection</div>';
          });
      } catch(_) {}

      // Event delegation for action buttons inside the list
      modalEl.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.mm-act');
        if (!btn) return;
        const act  = btn.dataset.mmact;
        const tuid = btn.dataset.uid;
        const name = btn.dataset.name || 'Member';
        if (!act || !tuid) return;

        if (act === 'kick') {
          confirmModal(`Remove ${name} from the group?`, () => {
            if (_mmUnsub) { try { _mmUnsub(); } catch(_) {} _mmUnsub = null; }
            _execKickMember(g, tuid, name, false);
          }, { title:`Kick ${name}?`, yesLabel:'Remove', yesClass:'btn btn-danger' });
          return;
        }
        if (act === 'ban') {
          confirmModal(`Ban ${name}? They will be removed and blocked from rejoining.`, () => {
            if (_mmUnsub) { try { _mmUnsub(); } catch(_) {} _mmUnsub = null; }
            _execKickMember(g, tuid, name, true);
          }, { title:`Ban ${name}?`, yesLabel:'Ban', yesClass:'btn btn-danger' });
          return;
        }
        if (act === 'promote') {
          confirmModal(`Promote ${name} to Admin? They can manage group settings.`, () => {
            if (db_mm && fb_mm) {
              // Write to both admins and adminUids for full consistency
              db_mm.collection('groups').doc(g.code).set({
                admins:    fb_mm.firestore.FieldValue.arrayUnion(tuid),
                adminUids: fb_mm.firestore.FieldValue.arrayUnion(tuid),
              }, { merge: true }).catch(() => {});
              db_mm.collection('groups').doc(g.code).collection('members').doc(tuid).set({ role: 'admin' }, { merge: true }).catch(() => {});
            }
            const sc_ = scLoad(), g_ = sc_.groups.find(x => x.code === g.code || x.id === g.id);
            if (g_) {
              if (!g_.admins)    g_.admins    = [];
              if (!g_.adminUids) g_.adminUids = [];
              if (!g_.admins.includes(tuid))    g_.admins.push(tuid);
              if (!g_.adminUids.includes(tuid)) g_.adminUids.push(tuid);
              scSave(sc_);
            }
            toast(`${name} promoted to Admin ⚡`, 'success');
          }, { title:`Promote ${name}?`, yesLabel:'Promote', yesClass:'btn sc-modal-submit' });
          return;
        }
        if (act === 'demote') {
          if (!iAmOwner) return;
          confirmModal(`Remove ${name}'s Admin role?`, () => {
            if (db_mm && fb_mm) {
              // Remove from both admins and adminUids for full consistency
              db_mm.collection('groups').doc(g.code).set({
                admins:    fb_mm.firestore.FieldValue.arrayRemove(tuid),
                adminUids: fb_mm.firestore.FieldValue.arrayRemove(tuid),
              }, { merge: true }).catch(() => {});
              db_mm.collection('groups').doc(g.code).collection('members').doc(tuid).set({ role: 'member' }, { merge: true }).catch(() => {});
            }
            const sc_ = scLoad(), g_ = sc_.groups.find(x => x.code === g.code || x.id === g.id);
            if (g_) {
              g_.admins    = (g_.admins    || []).filter(a => a !== tuid);
              g_.adminUids = (g_.adminUids || []).filter(a => a !== tuid);
              scSave(sc_);
            }
            toast(`${name} demoted to Member`, 'info');
          }, { title:`Demote ${name}?`, yesLabel:'Demote', yesClass:'btn btn-danger' });
          return;
        }
      });

      // Clean up listener when modal closes
      const closeBtn = modalEl.querySelector('[data-close]');
      if (closeBtn) closeBtn.addEventListener('click', () => { if (_mmUnsub) { try { _mmUnsub(); } catch(_) {} _mmUnsub = null; } }, { once: true });
      const backdrop = modalEl.closest?.('.modal-backdrop') || modalEl.parentElement;
      if (backdrop) backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop && _mmUnsub) { try { _mmUnsub(); } catch(_) {} _mmUnsub = null; } }, { once: true });
    });
  }

  // ── Real-time join-requests subscription (admins/owners only) ────────────
  const _joinRequestsUnsubs = {};
  function _subscribeJoinRequests(code) {
    if (!code || _joinRequestsUnsubs[code]) return;
    const db_ = getDb(), uid_ = getUserId();
    if (!db_ || !uid_) return;
    const sc0 = scLoad();
    const g0  = sc0.groups.find(x => x.code === code);
    if (!g0 || (_getMyRole(g0) !== 'owner' && _getMyRole(g0) !== 'admin')) return;
    let _prevCount = -1;
    try {
      _joinRequestsUnsubs[code] = db_.collection('groups').doc(code)
        .collection('joinRequests')
        .where('status', '==', 'pending')
        .onSnapshot(snap => {
          const count = snap.docs.length;
          _joinRequestsCount[code] = count;
          // Toast admin when new requests arrive (not on first load)
          if (_prevCount >= 0 && count > _prevCount) {
            const diff = count - _prevCount;
            toast(`🔔 ${diff} new join request${diff > 1 ? 's' : ''} awaiting approval`, 'info', 4000);
          }
          _prevCount = count;
          const sc2 = scLoad();
          const grp = sc2.groups.find(x => x.code === code);
          if (!grp) return;
          if (!sc2.requests) sc2.requests = {};
          sc2.requests[grp.id] = snap.docs.map(d => {
            const r = d.data();
            return {
              id:          d.id,
              name:        r.displayName || r.name || 'Anonymous',
              answer:      r.message     || r.answer || '',
              requestedAt: r.requestedAt?.toMillis?.() ?? Date.now(),
            };
          });
          scSave(sc2);
          if ((_settingsView || _groupView) && !_destroyed) _scheduleRender();
        }, () => { delete _joinRequestsUnsubs[code]; });
    } catch(_) { delete _joinRequestsUnsubs[code]; }
  }

  // ── Subscribe to user's own pending request status across groups ──────────
  // Watches groups/{code}/joinRequests/{uid} for status changes (approved/rejected).
  function _subscribeMyPendingRequests() {
    const db_ = getDb(), uid_ = getUserId();
    if (!db_ || !uid_) return;
    // Load known pending requests from localStorage
    const sc_ = scLoad();
    const pending = sc_.pendingRequests || {};
    // Sync _myPendingGroups from localStorage
    Object.assign(_myPendingGroups, pending);
    // Subscribe to each pending group's join request doc
    Object.keys(pending).forEach(code => {
      if (_pendingReqUnsubs[code]) return; // already subscribed
      try {
        _pendingReqUnsubs[code] = db_.collection('groups').doc(code)
          .collection('joinRequests').doc(uid_)
          .onSnapshot(snap => {
            const data = snap.data();
            if (!snap.exists || !data) {
              // Doc deleted = group joined normally or expired
              delete _myPendingGroups[code];
              const sc2 = scLoad(); delete sc2.pendingRequests[code]; scSave(sc2);
              if (!_destroyed) _scheduleRender();
              return;
            }
            const status = data.status || 'pending';
            const prev   = _myPendingGroups[code];
            _myPendingGroups[code] = { ...(_myPendingGroups[code] || {}), status, groupName: data.groupName || prev?.groupName || code };
            const sc2 = scLoad();
            sc2.pendingRequests[code] = _myPendingGroups[code];
            scSave(sc2);
            // Notify user on status change
            if (prev && prev.status === 'pending' && status === 'approved') {
              const gName = _myPendingGroups[code].groupName || code;
              toast(`✅ Your request to join "${gName}" was approved! 🎉`, 'success', 5000);
              // Trigger group restore so user is added to sc.groups
              setTimeout(() => window._socialRestoreGroups?.(), 400);
            } else if (prev && prev.status === 'pending' && status === 'rejected') {
              const gName = _myPendingGroups[code].groupName || code;
              toast(`Your request to join "${gName}" was not approved this time.`, 'info', 4000);
            }
            if (!_destroyed) _scheduleRender();
          }, () => { delete _pendingReqUnsubs[code]; });
      } catch(_) { delete _pendingReqUnsubs[code]; }
    });
  }

  // Cancel a pending join request
  function _cancelJoinRequest(code) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (db_ && uid_) {
      db_.collection('groups').doc(code).collection('joinRequests').doc(uid_)
        .delete().catch(() => {});
    }
    delete _myPendingGroups[code];
    if (_pendingReqUnsubs[code]) { try { _pendingReqUnsubs[code](); } catch(_) {} delete _pendingReqUnsubs[code]; }
    const sc_ = scLoad(); delete sc_.pendingRequests[code]; scSave(sc_);
    toast('Join request cancelled', 'info');
    renderSocial();
  }

  // ── Realtime Waiting Room modal (Firebase onSnapshot) ────────────────────
  function _openWaitingRoomModal(g) {
    const db_wr = getDb(), myUid_wr = getUserId(), fb_wr = getFb();
    if (!db_wr || !g.code) { toast('Firebase unavailable', 'warn'); return; }
    const gName = g.name || g.code;
    let _wrUnsub = null, _wrModalEl = null;

    // Avatar color same as manage members
    const _wrColor = (uid) => {
      const C = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#9333ea'];
      let h = 0; for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
      return C[Math.abs(h) % C.length];
    };

    const _renderWrRow = (req) => {
      const initials  = esc((req.displayName || '?').slice(0, 2).toUpperCase());
      const name      = esc(req.displayName || 'Anonymous');
      const msg       = req.message ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-top:3px">"${esc(req.message)}"</div>` : '';
      const ts        = req.requestedAt?.toMillis ? req.requestedAt.toMillis() : (req.requestedAt || Date.now());
      const timeStr   = _timeAgo(ts);
      return `
        <div class="jr-row" data-req-id="${esc(req.uid)}">
          <div style="width:40px;height:40px;border-radius:50%;background:${_wrColor(req.uid)};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${initials}</div>
          <div style="flex:1;min-width:0;margin-left:10px">
            <div style="font-weight:600;font-size:14px">${name}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">⏱ ${timeStr}</div>
            ${msg}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">
            <button class="wr-act" data-act="approve" data-uid="${esc(req.uid)}" data-name="${name}"
              style="width:36px;height:36px;border-radius:50%;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);color:#22c55e;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Approve">✓</button>
            <button class="wr-act" data-act="reject" data-uid="${esc(req.uid)}" data-name="${name}"
              style="width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#ef4444;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center" title="Reject">✕</button>
          </div>
        </div>`;
    };

    const _renderWrList = (docs) => {
      const listEl  = _wrModalEl && _wrModalEl.querySelector('#wr-live-list');
      const countEl = _wrModalEl && _wrModalEl.querySelector('#wr-live-count');
      if (!listEl) return;
      if (countEl) countEl.textContent = `${docs.length} pending request${docs.length !== 1 ? 's' : ''}`;
      listEl.innerHTML = docs.length
        ? docs.map(_renderWrRow).join('')
        : `<div style="text-align:center;padding:32px 16px;color:var(--text-muted)">
             <div style="font-size:36px;margin-bottom:10px">✅</div>
             <div style="font-size:14px">No pending requests</div>
             <div style="font-size:12px;margin-top:6px;opacity:.7">All caught up!</div>
           </div>`;
    };

    openModal(`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <span style="font-size:22px">⏳</span>
        <div>
          <h3 class="sc-modal-title" style="margin:0">Waiting Room</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-top:1px">${esc(gName)}</div>
        </div>
      </div>
      <p id="wr-live-count" style="font-size:13px;color:var(--text-muted);margin:8px 0 12px">Loading…</p>
      <div id="wr-live-list" style="max-height:55vh;overflow-y:auto;margin:0 -2px">
        <div style="text-align:center;padding:28px;color:var(--text-muted)">
          <div style="width:26px;height:26px;border:2px solid #7c3aed;border-top-color:transparent;border-radius:50%;margin:0 auto 10px;animation:spin .7s linear infinite"></div>
          Loading requests…
        </div>
      </div>
      <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
    `, (modalEl) => {
      _wrModalEl = modalEl;
      try {
        _wrUnsub = db_wr.collection('groups').doc(g.code)
          .collection('joinRequests')
          .where('status', '==', 'pending')
          .onSnapshot(snap => {
            const docs = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
            docs.sort((a, b) => (a.requestedAt?.toMillis?.() ?? a.requestedAt ?? 0) - (b.requestedAt?.toMillis?.() ?? b.requestedAt ?? 0));
            _renderWrList(docs);
          }, () => {
            const el = modalEl.querySelector('#wr-live-list');
            if (el) el.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444;font-size:13px">Failed to load — check connection</div>`;
          });
      } catch(_) {}

      // Inline approve/reject via event delegation
      modalEl.addEventListener('click', ev => {
        const btn = ev.target.closest('.wr-act');
        if (!btn) return;
        const act  = btn.dataset.act;
        const uid  = btn.dataset.uid;
        const name = btn.dataset.name || 'Member';
        if (!uid || !act) return;

        if (act === 'approve') {
          btn.disabled = true; btn.textContent = '…';
          const gRef  = db_wr.collection('groups').doc(g.code);
          const mRef  = gRef.collection('members').doc(uid);
          const rRef  = gRef.collection('joinRequests').doc(uid);
          mRef.set({
            uid, displayName: name, role: 'member',
            joinedAt: fb_wr.firestore.FieldValue.serverTimestamp(),
            isStudying: false, currentSubject: null, elapsedTimeToday: 0, dateKey: todayKey(),
          }, { merge: true }).then(() => {
            gRef.set({ memberCount: fb_wr.firestore.FieldValue.increment(1) }, { merge: true }).catch(() => {});
            rRef.set({ status: 'approved', approvedAt: fb_wr.firestore.FieldValue.serverTimestamp(), groupName: g.name }, { merge: true }).catch(() => {});
            db_wr.collection('users').doc(uid).set({ joinedRooms: fb_wr.firestore.FieldValue.arrayUnion(g.code) }, { merge: true }).catch(() => {});
            btn.closest('.jr-row')?.remove();
            const listEl = modalEl.querySelector('#wr-live-list');
            const remaining = listEl ? listEl.querySelectorAll('.jr-row').length : 0;
            const countEl   = modalEl.querySelector('#wr-live-count');
            if (countEl) countEl.textContent = `${remaining} pending request${remaining !== 1 ? 's' : ''}`;
            toast(`✓ ${name} approved!`, 'success');
          }).catch(() => { btn.disabled = false; btn.textContent = '✓'; toast('Failed to approve', 'error'); });
          return;
        }
        if (act === 'reject') {
          btn.disabled = true; btn.textContent = '…';
          db_wr.collection('groups').doc(g.code).collection('joinRequests').doc(uid)
            .set({ status: 'rejected', rejectedAt: fb_wr.firestore.FieldValue.serverTimestamp() }, { merge: true })
            .then(() => {
              btn.closest('.jr-row')?.remove();
              const listEl = modalEl.querySelector('#wr-live-list');
              const remaining = listEl ? listEl.querySelectorAll('.jr-row').length : 0;
              const countEl   = modalEl.querySelector('#wr-live-count');
              if (countEl) countEl.textContent = `${remaining} pending request${remaining !== 1 ? 's' : ''}`;
              toast('Request rejected', 'info');
            }).catch(() => { btn.disabled = false; btn.textContent = '✕'; });
          return;
        }
      });

      const cleanup = () => { if (_wrUnsub) { try { _wrUnsub(); } catch(_) {} _wrUnsub = null; } };
      modalEl.querySelector('[data-close]')?.addEventListener('click', cleanup, { once: true });
      const backdrop = modalEl.closest?.('.modal-backdrop') || modalEl.parentElement;
      if (backdrop) backdrop.addEventListener('click', ev => { if (ev.target === backdrop) cleanup(); }, { once: true });
    });
  }

  // ── Also query groups where uid is in admins[] (catches other old groups) ─
  let _myGroupsByAdminUnsub = null;
  function _subscribeMyGroupsByAdmin() {
    if (_myGroupsByAdminUnsub) { try { _myGroupsByAdminUnsub(); } catch(_) {} _myGroupsByAdminUnsub = null; }
    const db = getDb(), uid = getUserId();
    if (!db || !uid) return;
    try {
      _myGroupsByAdminUnsub = db.collection('groups')
        .where('admins', 'array-contains', uid)
        .onSnapshot(snap => {
          const sc = scLoad(); let dirty = false;
          snap.docs.forEach(d => {
            const data = d.data(), code = d.id;
            const existing = sc.groups.find(g => g.code === code);
            if (existing) {
              if (existing.role !== 'admin') { existing.role = 'admin'; dirty = true; }
              if (!existing.ownerUid) { existing.ownerUid = data.ownerUid || data.createdByUid || uid; dirty = true; }
            }
          });
          if (dirty) { scSave(sc); if ((_tab === 'groups' || _tab === 'rooms') && !_groupView && !_destroyed) _scheduleRender(); }
        }, () => { _myGroupsByAdminUnsub = null; });
    } catch(_) { _myGroupsByAdminUnsub = null; }
  }

  // ── Data ─────────────────────────────────────────────────────────────────
  function scLoad() {
    try {
      const raw = localStorage.getItem(SC_KEY);
      const d = raw ? JSON.parse(raw) : {};
      return {
        groups:          Array.isArray(d.groups) ? d.groups : [],
        tasks:           Array.isArray(d.tasks)  ? d.tasks  : [],
        notes:           Array.isArray(d.notes)  ? d.notes  : [],
        chats:           (d.chats    && typeof d.chats    === 'object') ? d.chats    : {},
        requests:        (d.requests && typeof d.requests === 'object') ? d.requests : {},
        pendingRequests: (d.pendingRequests && typeof d.pendingRequests === 'object') ? d.pendingRequests : {},
      };
    } catch(_) { return { groups: [], tasks: [], notes: [], chats: {}, pendingRequests: {} }; }
  }
  function scSave(d) { try { localStorage.setItem(SC_KEY, JSON.stringify(d)); } catch(_) {} }

  // ── State ─────────────────────────────────────────────────────────────────
  let _tab           = 'rooms';
  let _groupView     = null;
  let _lbPeriod      = 'daily';
  let _roomFilter    = 'new';
  let _roomPublicOnly = false;
  let _roomWithSpace  = false;
  let _destroyed      = false;
  let _srTab          = 'home';
  let _settingsView   = false;
  let _srTickInterval = null;
  let _srTickCount    = 0;
  // Global heartbeat — runs whenever studying, regardless of which tab is open.
  // Keeps activeSessions/{uid}.lastHeartbeatAt fresh so remote viewers can
  // detect ghost sessions via staleness rather than relying only on explicit stops.
  let _globalHeartbeatInterval = null;
  let _publicGroups        = [];
  let _publicGroupsUnsub   = null;
  let _myGroupsUnsub       = null;
  let _ptrLoading          = false;   // true while Discover PTR refresh is in flight
  let _ptrGroupLoading     = false;   // true while Groups PTR refresh is in flight
  let _ptrHideTimer        = null;    // safety timeout to hide PTR bar if snapshot stalls
  let _memberUnsub         = null;
  let _liveMembers         = {};
  let _globalLbDailyData   = [];
  let _globalLbWeeklyData  = [];
  let _globalLbDailyUnsub  = null;
  let _globalLbWeeklyUnsub = null;
  let _globalLbSubDate     = null; // track date to re-sub at midnight
  let _lbLastUpdated       = 0;   // timestamp of last successful snapshot
  let _lbLoading           = true; // true until first snapshot arrives
  // Chat state
  let _chatUnsub           = null;
  let _chatMessages        = {};   // { groupCode: Message[] }
  let _chatGid             = null; // group code currently subscribed to chat
  let _replyTo             = null; // { id, text, author } — message being replied to
  let _editMsgId           = null; // string msgId currently being edited
  // Group doc live subscriptions (for real-time memberCount in Your Groups list)
  const _groupDocUnsubs    = {};   // { code: unsubFn }
  // Self-membership listeners — detects when the current user is kicked from a group
  const _selfMemberUnsubs  = {};   // { code: unsubFn }
  let _liveSubscribedCode  = null; // code currently subscribed to in _subscribeRoomMembers
  // Per-member global presence subscriptions: users/{uid} → overrides per-group elapsedTimeToday
  let _memberPresenceUnsubs = {};  // { uid: unsubFn }
  // Expose live members map + tab-setter for DuelSystem
  window._scLiveMembers = () => _liveMembers;
  window._scSetSrTab    = tab => { if (_srTab !== tab) { _srTab = tab; _scheduleRender(); } };
  // Cache of latest users/{uid} presence data — survives group member snapshot rebuilds
  // so timers stay consistent even when the group roster snapshot re-fires.
  let _cachedUserPresence  = {};   // { uid: { todayFocusMinutes, isStudying, studyStartedAt, ... } }
  // Global activeSessions/{uid} — canonical real-time source for focus state.
  // Written on every focus start/stop. Subscribed per-member in every room.
  // Falls back to users/{uid} if Firestore rules block the collection.
  let _activeSessionsUnsubs = {}; // { uid: unsubFn }
  let _activeSessionsCache  = {}; // { uid: { active, startedAt, mode } }
  // UIDs confirmed to have no users/{uid} doc — orphaned members (deleted accounts).
  // Filtered out of member renders; cleaned from Firestore if current user is owner/admin.
  let _confirmedOrphans    = new Set();
  // Guard so ghost detection runs only once per subscription, not every snapshot fire.
  let _ghostCheckDone      = false;
  // ── Join-request state ────────────────────────────────────────────────────
  // Admin-side: pending request counts per group code (realtime from _subscribeJoinRequests)
  let _joinRequestsCount   = {};  // { code: number }
  // User-side: groups where current user has a pending/rejected/approved request
  let _myPendingGroups     = {};  // { code: { status:'pending'|'approved'|'rejected', groupName, requestedAt } }
  let _pendingReqUnsubs    = {};  // { code: unsubFn } — one listener per code

  const isStudying = () => { try { return window._focusActive === true; } catch(_) { return false; } };

  // ── Icons ─────────────────────────────────────────────────────────────────
  const ICON = {
    plus:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    join:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    copy:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    back:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    chevron:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    edit:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    trash:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    check:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    leave:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    trophy: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function _formatDate(ts) {
    if (!ts) return '—';
    const d  = new Date(typeof ts === 'number' ? ts : ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  function _catColor(cat) {
    const map = {
      'Exams':       { bg:'rgba(245,158,11,.18)',  text:'#fbbf24', border:'rgba(245,158,11,.3)'  },
      'Subject':     { bg:'rgba(59,130,246,.18)',  text:'#60a5fa', border:'rgba(59,130,246,.3)'  },
      'Productivity':{ bg:'rgba(56,189,248,.18)',  text:'#38bdf8', border:'rgba(56,189,248,.3)'  },
      'Challenge':   { bg:'rgba(34,197,94,.18)',   text:'#4ade80', border:'rgba(34,197,94,.3)'   },
      'General':     { bg:'rgba(124,58,237,.18)',  text:'#a78bfa', border:'rgba(124,58,237,.3)'  },
      // legacy aliases so old groups still get a colour
      'Language':    { bg:'rgba(59,130,246,.18)',  text:'#60a5fa', border:'rgba(59,130,246,.3)'  },
      'Tech':        { bg:'rgba(56,189,248,.18)',  text:'#38bdf8', border:'rgba(56,189,248,.3)'  },
      'Science':     { bg:'rgba(34,197,94,.18)',   text:'#4ade80', border:'rgba(34,197,94,.3)'   },
      'Arts':        { bg:'rgba(244,114,182,.18)', text:'#f472b6', border:'rgba(244,114,182,.3)' },
    };
    return map[cat] || { bg:'rgba(148,163,184,.12)', text:'#94a3b8', border:'rgba(148,163,184,.2)' };
  }

  function _avatarColor(name) {
    const cols = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2'];
    let h = 0;
    for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return cols[h % cols.length];
  }

  // ── Global Leaderboard subscription ──────────────────────────────────────
  // Friday-Thursday weekly cycle (matches script.js _weekStartKey)
  function _weekStart() {
    const d = new Date();
    const daysSinceFri = (d.getDay() + 2) % 7;
    d.setDate(d.getDate() - daysSinceFri);
    // Use LOCAL date fields (not toISOString which is UTC — causes off-by-one on UTC+ devices)
    const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), dy = String(d.getDate()).padStart(2,'0');
    return `${y}-${mo}-${dy}`;
  }

  // Sum local focus minutes from Friday of current week to today
  function _weekMinsLocal() {
    const ms   = getMainState();
    const mins = (ms.focusStats || {}).minutesByDate || {};
    const fri  = _weekStart();
    const friDate = new Date(fri + 'T00:00:00');
    const todayD  = new Date(); todayD.setHours(0,0,0,0);
    const dayDiff = Math.round((todayD - friDate) / 86400000);
    let total = 0;
    for (let i = 0; i <= Math.max(0, dayDiff); i++) {
      const d = new Date(friDate); d.setDate(d.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      total += mins[key] || 0;
    }
    return total;
  }

  function _subscribeGlobalLbPeriod(period) {
    const db = getDb();
    if (!db) { setTimeout(() => _subscribeGlobalLbPeriod(period), 1500); return; }

    const today     = todayKey();
    const weekStart = _weekStart();
    _globalLbSubDate = today;

    if (period === 'daily') {
      if (_globalLbDailyUnsub) return;
      const dateVal = today;
      const _onDailySnap = (snap) => {
        _globalLbDailyData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _lbLastUpdated = Date.now(); _lbLoading = false;
        if (_tab === 'leaderboard' && _lbPeriod === 'daily' && window._currentTab === 'social') _scheduleRender();
      };
      const tryIndexed = () => {
        try {
          _globalLbDailyUnsub = db.collection('global_lb')
            .where('dailyResetDate', '==', dateVal)
            .orderBy('dailyStudyTime', 'desc')
            .limit(100)
            .onSnapshot(_onDailySnap, () => { _globalLbDailyUnsub = null; tryFallback(); });
        } catch(_) { _globalLbDailyUnsub = null; tryFallback(); }
      };
      const tryFallback = () => {
        try {
          // Fallback without orderBy (composite index may be missing)
          _globalLbDailyUnsub = db.collection('global_lb')
            .where('dailyResetDate', '==', dateVal)
            .limit(200)
            .onSnapshot(snap => {
              _globalLbDailyData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(u => (u.dailyStudyTime || 0) > 0)
                .sort((a, b) => (b.dailyStudyTime || 0) - (a.dailyStudyTime || 0));
              _lbLastUpdated = Date.now(); _lbLoading = false;
              if (_tab === 'leaderboard' && _lbPeriod === 'daily' && window._currentTab === 'social') _scheduleRender();
            }, () => { _globalLbDailyUnsub = null; tryLastResortDaily(); });
        } catch(_) { _globalLbDailyUnsub = null; tryLastResortDaily(); }
      };
      const tryLastResortDaily = () => {
        try {
          // Last resort: all users with daily time > 0, sort client-side
          _globalLbDailyUnsub = db.collection('global_lb')
            .where('dailyStudyTime', '>', 0)
            .orderBy('dailyStudyTime', 'desc')
            .limit(100)
            .onSnapshot(snap => {
              const today2 = todayKey();
              _globalLbDailyData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(u => u && u.id && (!u.dailyResetDate || u.dailyResetDate === today2));
              _lbLastUpdated = Date.now(); _lbLoading = false;
              if (_tab === 'leaderboard' && _lbPeriod === 'daily' && window._currentTab === 'social') _scheduleRender();
            }, () => { _globalLbDailyUnsub = null; });
        } catch(_) { _globalLbDailyUnsub = null; }
      };
      tryIndexed();
    } else {
      if (_globalLbWeeklyUnsub) return;
      const dateVal = weekStart; // kept for reference; primary query no longer uses date filter
      const _wkSort = (a, b) => {
        const td = (b.weeklyStudyTime||0) - (a.weeklyStudyTime||0); if (td) return td;
        const sd = (b.sessions||0) - (a.sessions||0); if (sd) return sd;
        return (b.streak||0) - (a.streak||0);
      };
      // Drop entries whose weeklyResetDate is explicitly from a prior week
      // (means weeklyStudyTime is stale). Entries with no weeklyResetDate are kept.
      const _wkFilter = (docs) => {
        const wkStart = _weekStart();
        return docs.filter(u => {
          if (!u || !u.id) return false;
          if (u.weeklyResetDate && u.weeklyResetDate < wkStart) return false;
          return true;
        });
      };
      const _onWeeklySnap = (snap) => {
        _globalLbWeeklyData = _wkFilter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        _lbLastUpdated = Date.now();
        _lbLoading = false;
        if (_tab === 'leaderboard' && _lbPeriod === 'weekly' && window._currentTab === 'social') _scheduleRender();
      };
      const tryIndexed = () => {
        try {
          // PRIMARY: ALL users with weeklyStudyTime > 0, sorted descending.
          // inequality filter + orderBy on SAME field = valid single-field index (no composite needed).
          // This catches every user regardless of when they were last active.
          _globalLbWeeklyUnsub = db.collection('global_lb')
            .where('weeklyStudyTime', '>', 0)
            .orderBy('weeklyStudyTime', 'desc')
            .limit(100)
            .onSnapshot(_onWeeklySnap, () => { _globalLbWeeklyUnsub = null; tryFallback(); });
        } catch(_) { _globalLbWeeklyUnsub = null; tryFallback(); }
      };
      const tryFallback = () => {
        try {
          // FALLBACK: order by weeklyStudyTime desc without inequality filter
          _globalLbWeeklyUnsub = db.collection('global_lb')
            .orderBy('weeklyStudyTime', 'desc')
            .limit(200)
            .onSnapshot(snap => {
              const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(u => u && u.id && (u.weeklyStudyTime||0) > 0);
              _globalLbWeeklyData = _wkFilter(docs).slice(0, 100);
              _lbLastUpdated = Date.now(); _lbLoading = false;
              if (_tab === 'leaderboard' && _lbPeriod === 'weekly' && window._currentTab === 'social') _scheduleRender();
            }, () => { _globalLbWeeklyUnsub = null; tryLastResort(); });
        } catch(_) { _globalLbWeeklyUnsub = null; tryLastResort(); }
      };
      const tryLastResort = () => {
        try {
          // LAST RESORT: broadest possible, full client-side filter+sort
          _globalLbWeeklyUnsub = db.collection('global_lb')
            .orderBy('updatedAt', 'desc')
            .limit(500)
            .onSnapshot(snap => {
              _globalLbWeeklyData = _wkFilter(
                snap.docs.map(d => ({ id: d.id, ...d.data() }))
                  .filter(u => u && u.id && (u.weeklyStudyTime||0) > 0)
                  .sort(_wkSort)
              ).slice(0, 100);
              _lbLastUpdated = Date.now(); _lbLoading = false;
              if (_tab === 'leaderboard' && _lbPeriod === 'weekly' && window._currentTab === 'social') _scheduleRender();
            }, () => { _globalLbWeeklyUnsub = null; });
        } catch(_) { _globalLbWeeklyUnsub = null; }
      };
      tryIndexed();
    }
  }

  function _subscribeGlobalLb() {
    // Reset subscriptions if the date has changed (midnight rollover)
    const today = todayKey();
    if (_globalLbSubDate && _globalLbSubDate !== today) {
      _unsubscribeGlobalLb();
      _globalLbDailyData = [];
      _globalLbWeeklyData = [];
    }
    _subscribeGlobalLbPeriod('daily');
    _subscribeGlobalLbPeriod('weekly');
  }

  function _unsubscribeGlobalLb() {
    if (_globalLbDailyUnsub)  { try { _globalLbDailyUnsub();  } catch(_) {} _globalLbDailyUnsub  = null; }
    if (_globalLbWeeklyUnsub) { try { _globalLbWeeklyUnsub(); } catch(_) {} _globalLbWeeklyUnsub = null; }
  }

  // ── Live leaderboard ticker (updates your-card time in-place + periodic rank re-render) ──
  let _lbLiveInterval   = null;
  let _lbLiveTick       = 0;
  let _lbFullRenderSecs = 30; // full re-render every N seconds to sync rank positions
  function _startLbLive() {
    _stopLbLive();
    _lbLiveTick = 0;
    _lbLiveInterval = setInterval(() => {
      if (_tab !== 'leaderboard' || window._currentTab !== 'social') { _stopLbLive(); return; }
      _lbLiveTick++;

      const ms       = getMainState();
      const mins     = (ms.focusStats || {}).minutesByDate || {};
      const todayStr = todayKey();
      const todayMins = mins[todayStr] || 0;
      const wkMins   = _weekMinsLocal();
      const dm       = _lbPeriod === 'daily' ? todayMins : wkMins;
      const goal     = _lbPeriod === 'daily' ? 480 : 3360;

      // Patch the "your card" elements in-place every second
      const timeEl   = document.querySelector('[data-lb-live="time"]');
      const progEl   = document.querySelector('[data-lb-live="progress"]');
      const stuEl    = document.querySelector('[data-lb-live="studying"]');
      if (timeEl) timeEl.textContent = minsToHrs(dm);
      if (progEl) progEl.style.width = Math.min(100, (dm / goal) * 100).toFixed(1) + '%';
      if (stuEl)  stuEl.style.display = (window._focusActive === true) ? '' : 'none';

      // Full re-render every _lbFullRenderSecs to recalculate rank positions
      // and pick up any Firebase snapshot changes that arrived since last render
      if (_lbLiveTick % _lbFullRenderSecs === 0) {
        _scheduleRender();
      }
    }, 1000);
  }
  function _stopLbLive() {
    if (_lbLiveInterval) { clearInterval(_lbLiveInterval); _lbLiveInterval = null; }
    _lbLiveTick = 0;
  }

  // ── Rank movement tracking ────────────────────────────────────────────────
  let _lbPrevRanks = {}; // { [uid]: rank }
  function _lbRankDelta(uid, newRank) {
    const prev = _lbPrevRanks[uid];
    if (prev == null) return 0;
    return prev - newRank; // positive = improved (moved up)
  }
  function _lbSaveRanks(sorted) {
    const next = {};
    sorted.forEach((u, i) => { next[u.id] = i + 1; });
    _lbPrevRanks = next;
  }

  // ── Render debounce — prevents rapid-fire re-renders from snapshot callbacks ─
  let _renderTimer = null;
  function _scheduleRender() {
    if (_destroyed) return;
    if (_renderTimer) return; // already scheduled
    _renderTimer = setTimeout(() => { _renderTimer = null; renderSocial(); }, 60);
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function renderSocial() {
    if (_destroyed) return;
    const view = document.getElementById('view-social');
    if (!view) return;
    try {
      // ── Study Room mode (full-screen, own layout) ─────────────────────────
      if (_groupView) {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === _groupView);
        if (!g) { _groupView = null; _settingsView = false; _stopSrTicker(); renderSocial(); return; }
        if (_settingsView) {
          _stopSrTicker();
          view.innerHTML = _renderGroupSettings(g, sc);
          _bindEvents(view);
          return;
        }
        view.innerHTML = _renderStudyRoom(g, sc);
        _bindEvents(view);
        // Always start the Firebase member subscription regardless of which tab is active
        if (g.code) _subscribeRoomMembers(g.code);
        if (g.code) window.DuelSystem?.onGroupEnter(g.code);
        if (_srTab === 'home') _startSrTicker(_groupView);
        if (_srTab === 'chat') {
          if (g.code) _subscribeChatMessages(g.code);
          const msgsEl = document.getElementById('sr-chat-msgs');
          if (msgsEl) {
            _bindChatLongPress(msgsEl, g.code, g);
            setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 60);
          }
        }
        return;
      }
      // ── Normal tab mode ───────────────────────────────────────────────────
      _stopSrTicker();
      view.innerHTML = `
        <div class="sc-page" role="main">
          ${_renderSubNav()}
          <div class="sc-body">${_renderTabContent()}</div>
        </div>`;
      _bindEvents(view);
    } catch(err) {
      console.error('[Social]', err);
      view.innerHTML = `<div class="sc-page"><div class="sc-error-state">
        <div class="sc-error-icon">⚠️</div>
        <div class="sc-error-title">Something went wrong</div>
        <button class="sc-btn sc-btn-primary" onclick="if(window._socialRender)window._socialRender()">Retry</button>
      </div></div>`;
    }
  }

  // ── Sub-nav ───────────────────────────────────────────────────────────────
  function _renderSubNav() {
    const tabs = [
      { id:'rooms',       label:'Discover', emoji:'🌍' },
      { id:'groups',      label:'Groups',   emoji:'👥' },
      { id:'leaderboard', label:'Rankings', emoji:'🏆' },
    ];
    return `<nav class="sc-subnav" role="tablist">
      ${tabs.map(t => `
        <button class="sc-subnav-btn${_tab === t.id ? ' sc-active' : ''}"
                data-sc="tab" data-tab="${t.id}" role="tab" aria-selected="${_tab === t.id}">
          <span class="sc-subnav-emoji">${t.emoji}</span>
          <span class="sc-subnav-label">${t.label}</span>
        </button>`).join('')}
    </nav>`;
  }

  function _safeRender(fn, tabName) {
    try {
      const html = fn();
      if (typeof html !== 'string') throw new Error('render returned non-string');
      return html;
    } catch(e) {
      console.error(`[Social] ${tabName} render error:`, e);
      return `
        <div class="sc-error-state">
          <div class="sc-error-icon">⚠️</div>
          <div class="sc-error-title">Could not load ${tabName}</div>
          <button class="sc-btn sc-btn-primary sc-retry-btn"
                  onclick="if(window._socialRender)window._socialRender()"
                  style="margin-top:12px">Retry</button>
        </div>`;
    }
  }

  function _renderTabContent() {
    switch (_tab) {
      case 'rooms':       return _safeRender(_renderRooms,       'Discover');
      case 'groups':      return _safeRender(_renderGroups,      'Groups');
      case 'leaderboard': return _safeRender(_renderLeaderboard, 'Rankings');
      case 'tasks':       return _safeRender(_renderTasks,       'Tasks');
      case 'notes':       return _safeRender(_renderNotes,       'Notes');
      default:            return _safeRender(_renderRooms,       'Discover');
    }
  }

  // ── Rooms / Discovery ─────────────────────────────────────────────────────
  const FILTER_TABS = [
    { id:'new',          label:'New' },
    { id:'most-members', label:'Most Members' },
    { id:'most-study',   label:'Most Study Time' },
  ];

  function _renderRooms() {
    const sc  = scLoad();
    const ms  = getMainState();
    const studying  = isStudying();
    const todayMins = (ms.focusStats?.minutesByDate || {})[todayKey()] || 0;

    // Use Firebase public groups for discovery feed; fall back to local groups.
    // Merge local group ownership/admin data so _getMyRole() can detect membership correctly.
    let groups = _publicGroups.length > 0
      ? _publicGroups.map(pg => {
          const local = sc.groups.find(x => x.code === pg._fbCode);
          if (local) {
            // User has this group in local storage — they ARE a member.
            // Merge local ownership/role data so _getMyRole() detects membership
            // even for users who lost their sc_v1 cache and had it restored.
            return {
              ...pg,
              ownerUid:      local.ownerUid     || pg.ownerUid,
              createdByUid:  local.createdByUid || pg.createdByUid,
              admins:        local.admins        || pg.admins,
              members:       local.members,
              role:          local.role          || 'member',
              _isLocalMember: true,
            };
          }
          return { ...pg };
        })
      : sc.groups.filter(_isValidGroup);

    // Strict validation — strip any group with undefined/null name
    groups = groups.filter(_isValidGroup);

    // Client-side filters (applied on top of server-side query)
    if (_roomPublicOnly) groups = groups.filter(g => !g.isPrivate);
    if (_roomWithSpace)  groups = groups.filter(g => (g.memberCount || (g.members||[]).length) < (g.maxMembers || 50));
    // Auto-convert any legacy camstudy groups to general
    groups = groups.map(g => g.category === 'camstudy' ? { ...g, category: 'General' } : g);

    // Client-side sort (reinforces server-side ordering; handles the 'cam' filter case)
    if (_roomFilter === 'most-members')
      groups.sort((a, b) => (b.memberCount || (b.members||[]).length) - (a.memberCount || (a.members||[]).length));
    else if (_roomFilter === 'most-study')
      groups.sort((a, b) => (b.dailyMinsTotal || 0) - (a.dailyMinsTotal || 0));
    else
      groups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const filterTabsHtml = FILTER_TABS.map(f =>
      `<button class="sc-filter-tab${_roomFilter === f.id ? ' sc-ftab-active' : ''}"
               data-sc="room-filter" data-filter="${f.id}">${f.label}</button>`
    ).join('');

    // Detect if Firestore public feed is unavailable (permission rules not yet deployed)
    const fbUnavailable  = _publicGroups.length === 0 && !getDb()?.app;
    const hasNoGroups    = _publicGroups.length === 0 && sc.groups.length === 0;
    const localOnlyMode  = _publicGroups.length === 0 && sc.groups.length > 0;

    // Shimmer skeleton HTML — shown as placeholder while groups load
    const shimmerHtml = `
      <div style="padding:12px 14px">
        ${[1,2,3].map(() => `
          <div class="sc-skeleton-card">
            <div style="display:flex;gap:8px;align-items:center">
              <div class="sc-skeleton sc-skeleton-tag"></div>
            </div>
            <div class="sc-skeleton sc-skeleton-title"></div>
            <div class="sc-skeleton sc-skeleton-line sc-skeleton-wide"></div>
            <div class="sc-skeleton sc-skeleton-line sc-skeleton-short"></div>
          </div>`).join('')}
      </div>`;

    const emptyHtml = hasNoGroups ? `
      <div class="sc-disc-empty">
        <div class="sc-disc-empty-icon">🌍</div>
        <div class="sc-disc-empty-title">No Study Groups Yet</div>
        <div class="sc-disc-empty-sub">Create your first group and invite others to study together globally.</div>
        <button class="sc-btn sc-btn-primary sc-disc-create-btn" data-sc="create-group">${ICON.plus} Create a Group</button>
      </div>` : `
      <div class="sc-disc-empty">
        <div class="sc-disc-empty-icon">🔍</div>
        <div class="sc-disc-empty-title">No Groups Match</div>
        <div class="sc-disc-empty-sub">Try adjusting the filters above.</div>
      </div>`;

    return `
      <div class="sc-discovery">
        <div class="sc-filter-tabs">${filterTabsHtml}</div>

        <div class="sc-filter-checks">
          <label class="sc-check-row">
            <input type="checkbox" class="sc-checkbox" data-sc="filter-public" ${_roomPublicOnly ? 'checked' : ''}/>
            <span>Public Only</span>
          </label>
          <label class="sc-check-row">
            <input type="checkbox" class="sc-checkbox" data-sc="filter-space" ${_roomWithSpace ? 'checked' : ''}/>
            <span>Groups with Space</span>
          </label>
        </div>

        <div class="sc-ptr-bar${_ptrLoading ? ' sc-ptr-loading' : ''}" id="sc-ptr-bar">
          <div class="sc-ptr-spinner"></div>
          <span>${_ptrLoading ? 'Updating…' : 'Refreshing…'}</span>
        </div>

        <div class="sc-disc-feed">
          ${groups.length === 0
            ? emptyHtml
            : groups.map(g => _renderDiscCard(g, studying, todayMins)).join('')}
        </div>

        <button class="sc-fab" data-sc="create-group" aria-label="Create group">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>`;
  }

  function _renderDiscCard(g, studying, todayMins) {
    // Hard validation — never render a card with missing critical fields
    const name = (g.name || '').trim();
    if (!name || name === 'undefined' || name === 'null') return '';

    const memberCount    = g.memberCount || (g.members || []).length || 0;
    const maxMembers     = g.maxMembers    || 50;
    const dailyGoalHrs   = g.dailyGoalHrs  || 8;
    // Resolve leader: prefer stored leader field, then createdByName, never 'Unknown'/'You'
    const leaderRaw      = g.leader && g.leader !== 'Unknown' && g.leader !== 'You' ? g.leader : null;
    const createdByName  = g.createdByName && g.createdByName !== 'You' ? g.createdByName : null;
    const leader         = leaderRaw || createdByName || (g.createdBy ? 'Admin' : 'Anonymous');
    const rawCat         = g.category && g.category !== 'undefined' ? g.category : 'General';
    const category       = rawCat === 'camstudy' ? 'General' : rawCat;
    const promoted       = !!g.promoted;
    const createdAt      = g.createdAt || Date.now();
    const dailyMinsTotal = typeof g.dailyMinsTotal === 'number' ? g.dailyMinsTotal : 0;
    const attendancePct  = typeof g.attendancePct  === 'number' ? g.attendancePct  : 0;
    const col            = _catColor(category);
    const myRole         = _getMyRole(g);
    const isOwner        = myRole === 'owner';
    const isAdmin        = myRole === 'admin' || isOwner;
    const isMember       = myRole === 'member' || isAdmin;
    const promoHTML      = promoted ? ' · <span class="sc-promo-badge">Promoted</span>' : '';
    const categoryUpper  = category.toUpperCase();

    const _fbCode_ = g._fbCode || g.code || '';
    const _pendingInfo = _myPendingGroups[_fbCode_];
    let roleBadge;
    if (isOwner)       roleBadge = `<span class="sc-disc-role sc-role-owner">👑 Admin</span>`;
    else if (isAdmin)  roleBadge = `<span class="sc-disc-role sc-role-admin">🛡 Admin</span>`;
    else if (isMember) roleBadge = `<span class="sc-disc-role sc-role-member">✓ Member</span>`;
    else if (_pendingInfo && _pendingInfo.status === 'pending')
                       roleBadge = `<span class="sc-disc-pending-badge">⏳ Request Pending</span>`;
    else if (_pendingInfo && _pendingInfo.status === 'rejected')
                       roleBadge = `<span class="sc-disc-join-hint" style="color:#ef4444">✕ Not approved — Tap to retry</span>`;
    else if (g.joinMode === 'approval')
                       roleBadge = `<span class="sc-disc-join-hint">⏳ Approval required →</span>`;
    else if (g.isPrivate) roleBadge = `<span class="sc-disc-join-hint">🔒 Enter Invite Code →</span>`;
    else               roleBadge = `<span class="sc-disc-join-hint">Tap to Join →</span>`;

    return `
      <div class="sc-disc-card" data-sc="enter-room" data-gid="${esc(g.id)}" data-fbcode="${esc(g._fbCode || '')}" role="button" tabindex="0">
        <div class="sc-disc-toprow">
          <span class="sc-cat-tag" style="background:${col.bg};color:${col.text};border-color:${col.border}">${esc(categoryUpper)}</span>
          <span class="sc-disc-time">${esc(_timeAgo(createdAt))}${promoHTML}</span>
        </div>

        <div class="sc-disc-title">${esc(name)}</div>
        ${g.description && g.description !== 'undefined' ? `<div class="sc-disc-desc">${esc(g.description)}</div>` : ''}

        <div class="sc-disc-stats-row">
          <span class="sc-dstat"><span class="sc-dstat-icon">🎯</span>${dailyGoalHrs}h goal</span>
          <span class="sc-dstat-sep"></span>
          <span class="sc-dstat"><span class="sc-dstat-icon">👥</span>${memberCount}/${maxMembers} people</span>
          <span class="sc-dstat-sep"></span>
          <span class="sc-dstat sc-dstat-leader"><span class="sc-dstat-icon">👑</span>${esc(leader)}</span>
        </div>

        <div class="sc-disc-perf-row">
          <span class="sc-dperf">⏱ <strong>${minsToHrs(dailyMinsTotal)}</strong> today</span>
          <span class="sc-dperf-dot">·</span>
          <span class="sc-dperf">📊 <strong>${attendancePct}%</strong> attendance</span>
        </div>

        <div class="sc-disc-footer">
          <span class="sc-disc-date">Started ${esc(_formatDate(createdAt))}</span>
          ${roleBadge}
        </div>
      </div>`;
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  function _renderGroups() {
    const sc = scLoad();
    if (_groupView) {
      const g = sc.groups.find(x => x.id === _groupView);
      if (!g) { _groupView = null; return _renderGroups(); }
      return _renderGroupDetail(g, sc);
    }

    const groupsPtrBar = `<div class="sc-ptr-bar${_ptrGroupLoading ? ' sc-ptr-loading' : ''}" id="sc-ptr-bar-groups"><div class="sc-ptr-spinner"></div><span>${_ptrGroupLoading ? 'Updating…' : 'Refreshing…'}</span></div>`;

    if (sc.groups.length === 0) {
      return `${groupsPtrBar}
        <div class="sc-empty-state">
          <div class="sc-empty-icon">👥</div>
          <div class="sc-empty-title">Create or Join a Group</div>
          <div class="sc-empty-sub">Groups let you study together, share tasks and notes, and track progress.</div>
          <div class="sc-empty-actions">
            <button class="sc-btn sc-btn-primary" data-sc="create-group">${ICON.plus} Create Group</button>
            <button class="sc-btn sc-btn-outline" data-sc="join-group">${ICON.join} Join via Invite Code</button>
          </div>
        </div>`;
    }

    return `${groupsPtrBar}
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Your Groups</span>
          <button class="sc-icon-btn" data-sc="create-group">${ICON.plus}</button>
        </div>
        <div class="sc-groups-list">
          ${sc.groups.map(g => {
            // Use live Firestore memberCount: check _publicGroups first, then local field, then members array
            const pbG = _publicGroups.find(pg => pg._fbCode === g.code);
            const mc  = (pbG != null ? pbG.memberCount : null) ?? g.memberCount ?? (g.members||[]).length ?? 0;
            return `
              <div class="sc-group-card" data-sc="open-group" data-gid="${esc(g.id)}" role="button" tabindex="0">
                <div class="sc-group-icon">${g.icon||'📚'}</div>
                <div class="sc-group-info">
                  <div class="sc-group-name">${esc(g.name)}</div>
                  <div class="sc-group-meta">
                    ${g.isPrivate ? '🔒 Private' : '🌐 Public'} &middot;
                    ${mc} member${mc!==1?'s':''} &middot;
                    Code: <strong>${esc(g.code)}</strong>
                  </div>
                  ${g.description ? `<div class="sc-group-desc-preview">${esc(g.description)}</div>` : ''}
                </div>
                <div class="sc-chevron">${ICON.chevron}</div>
              </div>`;
          }).join('')}
        </div>
        <button class="sc-join-row-btn" data-sc="join-group">${ICON.join} Join via Invite Code</button>
      </div>`;
  }

  function _renderGroupDetail(g, sc) {
    // Use centralized realtime source (merges Firebase live data + local fallback)
    const members = _getGroupMembers(g);
    const gTasks  = sc.tasks.filter(t => t.groupId === g.id);
    const gNotes  = sc.notes.filter(n => n.groupId === g.id);
    const pending = gTasks.filter(t => !t.done).length;

    return `
      <div class="sc-detail">
        <div class="sc-detail-header">
          <button class="sc-back-btn" data-sc="close-group" aria-label="Back">${ICON.back}</button>
          <span class="sc-detail-icon">${g.icon||'📚'}</span>
          <span class="sc-detail-name">${esc(g.name)}</span>
          <button class="sc-icon-btn sc-btn-danger-icon" data-sc="leave-group" data-gid="${esc(g.id)}">${ICON.leave}</button>
        </div>
        <div class="sc-detail-meta">
          <span class="sc-meta-chip">${g.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
          <span class="sc-meta-chip">Code: <strong>${esc(g.code)}</strong>
            <button class="sc-copy-inline" data-sc="copy-code" data-code="${esc(g.code)}">Copy</button>
          </span>
        </div>
        ${g.description ? `<p class="sc-detail-desc">${esc(g.description)}</p>` : ''}
        <div class="sc-detail-block">
          <div class="sc-block-header"><span class="sc-block-title">Members (${members.length})</span></div>
          <div class="sc-members-list">
            ${members.length === 0
              ? `<div class="sc-empty-mini">No members listed.</div>`
              : members.map(m => {
                  const lm    = _liveMembers[m.id] || _liveMembers[m.uid] || {};
                  const mBadge = (m.id === getUserId() || m.uid === getUserId())
                    ? (window._lsGetMyBadge?.() || lm.equippedBadge || '')
                    : (lm.equippedBadge || m.equippedBadge || '');
                  return `
                  <div class="sc-member-row">
                    <div class="sc-member-av" style="background:${_avatarColor(m.name)}">${(m.name||'?')[0].toUpperCase()}</div>
                    <div class="sc-member-info">
                      <span class="sc-member-name">${esc(m.name||'Unknown')}</span>
                      ${mBadge ? `<span class="sc-member-badge-cmk">${window._cmkBadgeHTML?.(mBadge)||''}</span>` : ''}
                    </div>
                    <span class="sc-member-badge sc-badge-${m.role==='admin'?'admin':'member'}">${m.role==='admin'?'Admin':'Member'}</span>
                  </div>`;
                }).join('')}
          </div>
        </div>
        <div class="sc-detail-block">
          <div class="sc-block-header">
            <span class="sc-block-title">Group Tasks (${pending} pending)</span>
            <button class="sc-icon-btn" data-sc="add-task" data-gid="${esc(g.id)}">${ICON.plus}</button>
          </div>
          <div class="sc-tasks-list">
            ${gTasks.length === 0 ? `<div class="sc-empty-mini">No group tasks yet.</div>` : gTasks.map(_taskRow).join('')}
          </div>
        </div>
        <div class="sc-detail-block">
          <div class="sc-block-header">
            <span class="sc-block-title">Group Notes (${gNotes.length})</span>
            <button class="sc-icon-btn" data-sc="add-note" data-gid="${esc(g.id)}">${ICON.plus}</button>
          </div>
          <div class="sc-notes-list">
            ${gNotes.length === 0 ? `<div class="sc-empty-mini">No group notes yet.</div>` : gNotes.map(_noteCard).join('')}
          </div>
        </div>
      </div>`;
  }

  // ── Study Room Helpers ────────────────────────────────────────────────────
  function _fmtSecs(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }

  function _isMemberByCode(code) {
    try { return scLoad().groups.some(g => g.code === code); } catch(_) { return false; }
  }

  // A member is stale when their heartbeat is this old.
  // Global heartbeat fires every 30 s; 75 s = 2.5 intervals — resilient
  // against brief blips while clearing ghosts within ~2 minutes.
  const PRESENCE_STALE_MS = 75000;

  function _getMemberLastUpdatedMs(lm) {
    const lu = lm && lm.lastUpdated;
    if (!lu) return null;
    // Firestore Timestamp objects expose .toMillis(); plain numbers pass through
    if (typeof lu.toMillis === 'function') return lu.toMillis();
    if (typeof lu === 'number') return lu;
    return null;
  }

  function _isMemberStale(lm) {
    const lastMs = _getMemberLastUpdatedMs(lm);
    if (!lastMs) return false; // no timestamp yet — give benefit of the doubt
    return (Date.now() - lastMs) > PRESENCE_STALE_MS;
  }

  function _fmtLastSeen(lm) {
    const lastMs = _getMemberLastUpdatedMs(lm);
    if (!lastMs) return '';
    const diff = Date.now() - lastMs;
    if (diff < 60000)        return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60)           return `${mins}m ago`;
    const hrs  = Math.floor(mins / 60);
    if (hrs < 24)            return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // Resolve a Firestore Timestamp OR plain-number ms value to milliseconds.
  function _toMs(v) {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v === 'number') return v;
    return null;
  }

  function _srMemberIsActive(m) {
    if (m.id === 'me') return ui().focusIsRunning?.() === true;
    const uid = m.id || m.uid;
    // activeSessions cache is the primary source — optimistically updated on
    // every focus start/stop and refreshed by the per-member Firestore listener.
    if (uid && _activeSessionsCache[uid]) {
      const as = _activeSessionsCache[uid];
      if (!as.active) return false; // explicit stop
      // Heartbeat staleness: if lastHeartbeatAt is too old → ghost session
      const hbMs = _toMs(as.lastHeartbeatAt);
      if (hbMs && (Date.now() - hbMs) > PRESENCE_STALE_MS) return false;
      return true; // active AND heartbeat recent
    }
    // Fall back to _liveMembers (updated by users/{uid} and group-member snapshots)
    if (uid && _liveMembers[uid]) {
      const lm = _liveMembers[uid];
      if (!lm.isStudying) return false;
      if (_isMemberStale(lm)) return false;
      return true;
    }
    return false;
  }

  function _srMemberSeconds(m) {
    const ms = getMainState(), tk = todayKey();
    if (m.id === 'me') {
      const storedMins = ((ms.focusStats || {}).minutesByDate || {})[tk] || 0;
      const ft = ui().focusStartTime?.();
      const elapsed = ft ? Math.floor((Date.now() - ft) / 1000) : 0;
      return storedMins * 60 + elapsed;
    }
    const uid = m.id || m.uid;
    const as  = uid ? _activeSessionsCache[uid] : null;  // activeSessions cache
    const lm  = uid ? _liveMembers[uid] : null;          // group member doc
    if (lm) {
      const baseMins = (lm.dateKey === tk ? (lm.elapsedTimeToday || 0) : 0);
      // Determine active state: prefer activeSessions cache (most authoritative)
      const isActive = (as?.active === true) || (lm.isStudying && !_isMemberStale(lm));
      // Prefer activeSessions startedAt (set once, never reset); fall back to group doc
      const startedAt = (as?.active && as?.startedAt) ? as.startedAt
        : (lm.studyStartedAt || null);
      // Do not add live elapsed if stale — timer would run forever after disconnect
      const extra = isActive && startedAt
        ? Math.floor((Date.now() - startedAt) / 1000)
        : 0;
      return baseMins * 60 + extra;
    }
    // Member not in _liveMembers yet — use activeSessions alone if available
    if (as?.active && as?.startedAt) {
      return Math.floor((Date.now() - as.startedAt) / 1000);
    }
    return (m.todayKey === tk ? (m.todayMins || 0) : 0) * 60;
  }

  function _startSrTicker(gid) {
    _stopSrTicker();
    _srTickCount = 0;
    // Subscribe to Firebase member presence for this room
    const sc0 = scLoad();
    const g0  = sc0.groups.find(x => x.id === gid);
    if (g0 && g0.code) _subscribeRoomMembers(g0.code);

    _srTickInterval = setInterval(() => {
      if (document.hidden) return;
      const view = document.getElementById('view-social');
      if (!view || !view.querySelector('.sr-room')) { _stopSrTicker(); return; }
      const sc = scLoad();
      const g  = sc.groups.find(x => x.id === gid);
      if (!g) { _stopSrTicker(); return; }

      // Update timers for local members
      (g.members || []).forEach(m => {
        const timerEl = view.querySelector(`[data-sr-timer="${m.id}"]`);
        if (timerEl) timerEl.textContent = _fmtSecs(_srMemberSeconds(m));
      });
      // Update timers, last-seen labels, and detect staleness-based state changes
      // for Firebase members. The Firestore listener handles isStudying flips that
      // come from explicit writes, but staleness (heartbeat timeout) is purely
      // time-based — only the ticker can catch those transitions.
      const _tickMyUid = getUserId();
      let _remoteStateDirty = false;
      Object.keys(_liveMembers).forEach(uid => {
        const timerEl = view.querySelector(`[data-sr-timer="${uid}"]`);
        if (timerEl) timerEl.textContent = _fmtSecs(_srMemberSeconds({ id: uid }));
        const lsEl = view.querySelector(`[data-sr-lastseen="${uid}"]`);
        if (lsEl) lsEl.textContent = _fmtLastSeen(_liveMembers[uid]);
        // Detect staleness-based active→idle flip (not covered by Firestore listener)
        if (uid !== _tickMyUid) {
          const cardEl = view.querySelector(`[data-sr-card="${uid}"]`);
          if (cardEl) {
            const lm = _liveMembers[uid];
            const shouldBeActive = !!(lm.isStudying && !_isMemberStale(lm) && !_isOffDayToday(uid));
            if (shouldBeActive !== cardEl.classList.contains('sr-card-active')) {
              _remoteStateDirty = true;
            }
          }
        }
      });
      if (_remoteStateDirty) { _stopSrTicker(); renderSocial(); return; }

      const me = (g.members || []).find(x => x.id === 'me');
      // Filter stale heartbeats so active count matches visible card states
      const fbActiveCount = Object.values(_liveMembers).filter(x => x.isStudying && !_isMemberStale(x)).length;
      // Always derive own active state from live focus engine, never from stale _liveMembers
      const meActive = ui().focusIsRunning?.() === true;
      const activeCnt = meActive ? Math.max(1, fbActiveCount) : fbActiveCount;
      const cntEl = view.querySelector('.sr-studying-count');
      if (cntEl) cntEl.textContent = activeCnt;

      if (me) {
        const myCard = view.querySelector(`[data-sr-card="${me.id}"]`);
        if (myCard) {
          const isActive     = myCard.classList.contains('sr-card-active');
          const shouldActive = _srMemberIsActive(me);
          if (isActive !== shouldActive) { _stopSrTicker(); renderSocial(); return; }
        }
      }

      // Broadcast self presence to ALL joined groups every 30 ticks (~30 s).
      // Using _writePresenceAllGroups ensures every group gets identical data
      // so remote viewers see the same timer in every group simultaneously.
      _srTickCount++;
      if (_srTickCount % 30 === 0) {
        const ms_ = getMainState(), tk_ = todayKey();
        const todayMins_ = ((ms_.focusStats || {}).minutesByDate || {})[tk_] || 0;
        const avStage_   = window._lsGetCurrentAvStage?.() || 0;
        _writePresenceAllGroups(meActive, todayMins_, avStage_);
      }
    }, 1000);
  }

  function _stopSrTicker() {
    if (_srTickInterval !== null) { clearInterval(_srTickInterval); _srTickInterval = null; }
  }

  function _isValidGroup(g) {
    if (!g) return false;
    const name = g.name;
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return false;
    if (!g.code || typeof g.code !== 'string') return false;
    return true;
  }

  function _subscribePublicGroups() {
    const db = getDb();
    if (!db) return;
    if (_publicGroupsUnsub) { _publicGroupsUnsub(); _publicGroupsUnsub = null; }
    try {
      let q = db.collection('groups');

      // Server-side ordering based on active filter tab
      if (_roomFilter === 'most-members') {
        q = q.orderBy('memberCount', 'desc');
      } else if (_roomFilter === 'most-study') {
        q = q.orderBy('dailyMinsTotal', 'desc');
      } else {
        // 'new' (default) and 'cam' both sort by newest first
        q = q.orderBy('createdAt', 'desc');
      }

      // Server-side public-only filter (avoids needing a composite index for simple equality)
      if (_roomPublicOnly) {
        q = db.collection('groups')
          .where('isPrivate', '==', false)
          .orderBy('createdAt', 'desc');
      }

      q = q.limit(80);

      _publicGroupsUnsub = q.onSnapshot(snap => {
        try {
          const myUid = getUserId();
          _publicGroups = snap.docs
            .map(d => {
              try {
                const data = d.data();
                // Ensure admins[] always has the creator so _getMyRole works for old groups
                const creator = data.createdByUid || data.createdBy || data.ownerUid || null;
                let admins = Array.isArray(data.admins) ? [...data.admins] : [];
                if (creator && !admins.includes(creator)) admins.push(creator);
                const g = {
                  ...data,
                  id:           data.groupId || d.id,
                  _fbCode:      d.id,
                  memberCount:  data.memberCount || 0,
                  members:      [],   // realtime from _liveMembers; _getMyRole uses ownership fields
                  admins,
                  createdByUid: data.createdByUid || data.createdBy || null,
                  ownerUid:     data.ownerUid || data.createdByUid || data.createdBy || null,
                  createdAt:    data.createdAt?.toMillis?.() ?? (typeof data.createdAt === 'number' ? data.createdAt : Date.now()),
                };
                // If current user is creator/owner, auto-migrate old doc & set local role hint
                if (myUid && (g.createdByUid === myUid || g.ownerUid === myUid) &&
                    (!data.ownerUid || !data.createdByUid || !Array.isArray(data.admins))) {
                  _autoMigrateGroupDoc(d.id, data, myUid);
                }
                return g;
              } catch(_) { return null; }
            })
            .filter(g => g != null && _isValidGroup(g));
          // Clear PTR loading state so the bar hides on next render
          if (_ptrLoading) {
            _ptrLoading = false;
            if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; }
          }
          if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
        } catch(e) { console.error('[Social] publicGroups snapshot error:', e); }
      }, err => {
        const code = err?.code || '';
        console.warn('[Social] publicGroups listener error:', code, err?.message || '');

        // Always clear PTR loading state on any error path
        if (_ptrLoading) {
          _ptrLoading = false;
          if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; }
        }

        if (code === 'permission-denied' || code === 'unauthenticated') {
          _publicGroups = [];
          if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
          return;
        }

        if (code === 'failed-precondition') {
          // Missing composite index — retry with simpler query
          try {
            db.collection('groups').orderBy('createdAt', 'desc').limit(80)
              .onSnapshot(snap => {
                try {
                  _publicGroups = snap.docs.map(d => {
                    try {
                      const data = d.data();
                      return {
                        ...data,
                        id: data.groupId || d.id, _fbCode: d.id,
                        memberCount: data.memberCount || 0,
                        members: [],
                        admins: Array.isArray(data.admins) ? data.admins : [],
                        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
                      };
                    } catch(_) { return null; }
                  }).filter(g => g != null && _isValidGroup(g));
                  if (_ptrLoading) { _ptrLoading = false; if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; } }
                  if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
                } catch(_) {}
              }, innerErr => {
                console.warn('[Social] fallback query also failed:', innerErr?.code);
                _publicGroups = [];
                if (_ptrLoading) { _ptrLoading = false; if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; } }
                if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
              });
          } catch(_) {}
          return;
        }

        // Any other error — clear and render from local
        _publicGroups = [];
        if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
      });
    } catch(_) {}
  }

  // ── Apply cached user-doc presence overrides to _liveMembers ──────────────
  // Called after every group-members snapshot rebuild so timers never regress
  // to stale group-doc values. The cache is populated by the per-member
  // users/{uid} listeners and persists until the room is unsubscribed.
  function _applyPresenceCache() {
    const tk = todayKey();
    Object.entries(_cachedUserPresence).forEach(([mUid, uData]) => {
      const lm = _liveMembers[mUid];
      if (!lm) return;
      if (uData.todayDateKey === tk && typeof uData.todayFocusMinutes === 'number') {
        lm.elapsedTimeToday = uData.todayFocusMinutes;
        lm.dateKey          = tk;
      }
      // studyStartedAt: prefer cached (authoritative) value; null means session ended
      if ('studyStartedAt' in uData) {
        if (uData.studyStartedAt) lm.studyStartedAt = uData.studyStartedAt;
        else delete lm.studyStartedAt;
      }
      if (uData.isStudying != null) lm.isStudying   = uData.isStudying;
      if (uData.presenceUpdatedAt)  lm.lastUpdated   = uData.presenceUpdatedAt;
    });
  }

  function _subscribeRoomMembers(code) {
    // Guard: already listening to this exact room — skip duplicate attach
    if (_liveSubscribedCode === code && _memberUnsub) return;
    if (_memberUnsub) { try { _memberUnsub(); } catch(_) {} _memberUnsub = null; }
    // Tear down stale per-member presence listeners from the previous room
    Object.values(_memberPresenceUnsubs).forEach(unsub => { try { unsub(); } catch(_) {} });
    _memberPresenceUnsubs = {};
    _cachedUserPresence = {};
    _liveSubscribedCode = code;
    _liveMembers = {};
    const db = getDb();
    if (!db || !code) return;
    try {
      _memberUnsub = db.collection('groups').doc(code)
        .collection('members')
        .onSnapshot(snap => {
          // Track prev roster so we can detect joins and leaves
          const prevKeys = new Set(Object.keys(_liveMembers));
          _liveMembers = {};
          snap.docs.forEach(d => { _liveMembers[d.id] = d.data(); });
          // One-time ghost detection per subscription: schedule after Firestore
          // presence listeners have had a chance to populate _liveMembers.
          if (!_ghostCheckDone) {
            _ghostCheckDone = true;
            setTimeout(() => _detectGhostMembers(code), 6000);
          }

          // ── Re-apply cached presence overrides IMMEDIATELY after rebuild ──
          // This prevents stale group-doc data from temporarily overwriting
          // the authoritative users/{uid} values between snapshot fires.
          _applyPresenceCache();

          // ── Subscribe to activeSessions/{uid} for each member ──────────────
          // This is the primary real-time presence source — a single flat doc
          // per user, written on every focus start/stop. Subscribing here means
          // ALL groups instantly see the same session state for each member.
          const _myUid2 = getUserId();
          const _db2 = getDb();
          if (_db2) {
            Object.keys(_liveMembers).forEach(mUid => {
              if (mUid === _myUid2) return; // self updated optimistically in _socialFocusUpdate
              // ── activeSessions/{uid} listener ────────────────────────────
              if (!_activeSessionsUnsubs[mUid]) {
                try {
                  _activeSessionsUnsubs[mUid] = _db2.collection('activeSessions').doc(mUid)
                    .onSnapshot(asSnap => {
                      const as = asSnap.data() || {};
                      _activeSessionsCache[mUid] = {
                        active:          !!as.active,
                        startedAt:       as.startedAt ?? null,
                        mode:            as.mode || 'idle',
                        lastHeartbeatAt: as.lastHeartbeatAt ?? null,
                        lastActiveAt:    as.lastActiveAt ?? null,
                      };
                      // Merge into _liveMembers so existing render code stays correct
                      if (_liveMembers[mUid]) {
                        _liveMembers[mUid].isStudying = !!as.active;
                        if (as.startedAt) _liveMembers[mUid].studyStartedAt = as.startedAt;
                        else              delete _liveMembers[mUid].studyStartedAt;
                        // Treat the activeSessions updatedAt as a fresh heartbeat
                        if (as.updatedAt) _liveMembers[mUid].lastUpdated = as.updatedAt;
                      }
                      // Instantly refresh the timer chip if the room is visible
                      const vw = document.getElementById('view-social');
                      if (vw) {
                        const te = vw.querySelector(`[data-sr-timer="${mUid}"]`);
                        if (te) te.textContent = _fmtSecs(_srMemberSeconds({ id: mUid }));
                      }
                    }, () => {
                      // Permission denied — collection rules not deployed yet; fall through
                      delete _activeSessionsUnsubs[mUid];
                    });
                } catch(_) {}
              }
              // ── users/{uid} listener (presence fallback) ─────────────────
              if (_memberPresenceUnsubs[mUid]) return; // already subscribed
              try {
                _memberPresenceUnsubs[mUid] = _db2.collection('users').doc(mUid)
                  .onSnapshot(uSnap => {
                    const uData = uSnap.data() || {};
                    const tk2 = todayKey();

                    // ── 1. Update the persistent presence cache ────────────
                    // This cache survives group-roster snapshot rebuilds so
                    // timers never regress to stale group-doc values.
                    _cachedUserPresence[mUid] = {
                      todayFocusMinutes: uData.todayFocusMinutes,
                      todayDateKey:      uData.todayDateKey,
                      isStudying:        uData.isStudying,
                      studyStartedAt:    uData.studyStartedAt ?? null,
                      presenceUpdatedAt: uData.presenceUpdatedAt,
                    };

                    // ── 2. Apply overrides to live member entry ────────────
                    if (uData.todayDateKey === tk2 && typeof uData.todayFocusMinutes === 'number') {
                      if (_liveMembers[mUid]) {
                        _liveMembers[mUid].elapsedTimeToday = uData.todayFocusMinutes;
                        _liveMembers[mUid].dateKey           = tk2;
                        if (uData.studyStartedAt) {
                          _liveMembers[mUid].studyStartedAt = uData.studyStartedAt;
                        } else {
                          delete _liveMembers[mUid].studyStartedAt;
                        }
                        if (uData.isStudying != null) _liveMembers[mUid].isStudying = uData.isStudying;
                        if (uData.presenceUpdatedAt) _liveMembers[mUid].lastUpdated = uData.presenceUpdatedAt;
                      }
                      // Instantly update the timer chip if the card is visible
                      const vw = document.getElementById('view-social');
                      if (vw) {
                        const te = vw.querySelector(`[data-sr-timer="${mUid}"]`);
                        if (te) te.textContent = _fmtSecs(_srMemberSeconds({ id: mUid }));
                      }
                    }
                  }, () => {
                    // Permission denied or network error — silently drop, fall back to group doc
                    delete _memberPresenceUnsubs[mUid];
                    delete _cachedUserPresence[mUid];
                  });
              } catch(_) {}
            });
          }

          // Always persist live count to localStorage
          const sc = scLoad();
          const gLocal = sc.groups.find(x => x.code === code);
          if (gLocal && gLocal.memberCount !== snap.size) {
            gLocal.memberCount = snap.size; scSave(sc);
          }

          const view = document.getElementById('view-social');
          if (!view) return;

          // ── Smart full re-render: only when roster actually changes ──────
          const grid = view.querySelector('.sr-members-grid');
          if (grid && !_destroyed) {
            const renderedIds = new Set(
              [...grid.querySelectorAll('[data-sr-card]')].map(c => c.dataset.srCard)
            );
            const myUid = getUserId();
            // New Firebase member has no card yet (exclude self — shown as 'me')
            const hasNew = Object.keys(_liveMembers).some(
              uid => uid !== myUid && !renderedIds.has(uid)
            );
            // Member left — card still rendered but gone from Firestore
            const hasLeft = [...prevKeys].some(
              uid => !_liveMembers[uid] && renderedIds.has(uid)
            );
            if (hasNew || hasLeft) {
              renderSocial();   // re-render with full correct roster
              return;
            }
          }

          // ── Lightweight pass: update timers + counts for existing cards ──
          if (!view.querySelector('.sr-room')) return;

          // Detect active↔idle state changes for remote members and re-render if needed.
          // This covers the common case where a member starts/stops studying without
          // joining or leaving the room (roster didn't change so the hasNew/hasLeft
          // guards above didn't fire).
          const _myUid = getUserId();
          const stateChanged = Object.keys(_liveMembers).some(uid => {
            if (uid === _myUid) return false; // 'me' is handled by the ticker
            const cardEl = view.querySelector(`[data-sr-card="${uid}"]`);
            if (!cardEl) return false;
            const lm = _liveMembers[uid];
            const shouldBeActive = !!(lm.isStudying && !_isMemberStale(lm) && !_isOffDayToday(uid));
            return shouldBeActive !== cardEl.classList.contains('sr-card-active');
          });
          if (stateChanged) { renderSocial(); return; }

          Object.keys(_liveMembers).forEach(uid => {
            const el = view.querySelector(`[data-sr-timer="${uid}"]`);
            if (el) el.textContent = _fmtSecs(_srMemberSeconds({ id: uid }));
          });
          const meIsActive  = !!(view.querySelector('[data-sr-card="me"]')?.classList.contains('sr-card-active'));
          // Filter stale members (heartbeat expired) so active count matches card state
          const onlineCount = Object.values(_liveMembers).filter(x => x.isStudying && !_isMemberStale(x)).length;
          const activeCnt   = meIsActive ? Math.max(1, onlineCount) : onlineCount;
          const cntEl = view.querySelector('.sr-studying-count');
          if (cntEl) cntEl.textContent = activeCnt;
          const totalEl = view.querySelector('.sr-total-member-count');
          if (totalEl) totalEl.textContent = snap.size;
          // Aggregate attendance + focus time and push to group doc
          _updateGroupStats(code);
        }, () => { _memberUnsub = null; _liveSubscribedCode = null; });
    } catch(_) { _memberUnsub = null; _liveSubscribedCode = null; }
  }

  function _unsubscribeRoomMembers() {
    if (_memberUnsub) { try { _memberUnsub(); } catch(_) {} _memberUnsub = null; }
    _liveSubscribedCode = null;
    _liveMembers = {};
    // Clear presence cache so the next room starts fresh with no stale overrides
    _cachedUserPresence = {};
    // Clean up per-member global presence subscriptions (users/{uid})
    Object.values(_memberPresenceUnsubs).forEach(unsub => { try { unsub(); } catch(_) {} });
    _memberPresenceUnsubs = {};
    // Clean up activeSessions/{uid} subscriptions
    Object.values(_activeSessionsUnsubs).forEach(unsub => { try { unsub(); } catch(_) {} });
    _activeSessionsUnsubs = {};
    _activeSessionsCache  = {};
    // Reset ghost detection state for the next room
    _confirmedOrphans  = new Set();
    _ghostCheckDone    = false;
    _unsubscribeChatMessages();
  }

  // ── Centralized member source — used by ALL group tabs ───────────────────
  // Merges Firebase realtime (_liveMembers) with local g.members fallback.
  // Always deduplicates by real UID. Firebase is the primary source.
  function _getGroupMembers(g) {
    const myUid  = getUserId();
    const myName = _getUserDisplayName();
    const tk     = todayKey();
    const memberMap = new Map();

    // PRIMARY: Firebase realtime members (complete roster)
    Object.entries(_liveMembers).forEach(([uid, data]) => {
      memberMap.set(uid, {
        uid,
        id:           uid === myUid ? 'me' : uid,
        name:         uid === myUid ? myName : (data.displayName || 'Unknown'),
        role:         data.role || 'member',
        isMe:         uid === myUid,
        // Own badge always comes from local state (most up-to-date); others from Firebase
        equippedBadge: uid === myUid ? (window._lsGetMyBadge?.() || data.equippedBadge || '') : (data.equippedBadge || ''),
        // Only count today's study time — if dateKey is yesterday, treat as 0
        todayMins:    (data.dateKey === tk ? (data.elapsedTimeToday || 0) : 0),
        todayKey:     data.dateKey || tk,
        joinedAt:     (typeof data.joinedAt?.toMillis === 'function' ? data.joinedAt.toMillis() : (data.joinedAt || 0)),
        _fromFirebase: true,
      });
    });

    // FALLBACK: local g.members (used when Firebase hasn't responded yet)
    (g.members || []).forEach(m => {
      const uid = m.id === 'me' ? myUid : (m.id || m.uid);
      if (!uid || memberMap.has(uid)) return;
      memberMap.set(uid, {
        uid,
        id:            m.id === 'me' ? 'me' : uid,
        name:          m.id === 'me' ? myName : (m.name || 'Unknown'),
        role:          m.role || 'member',
        isMe:          m.id === 'me' || uid === myUid,
        equippedBadge: (m.id === 'me' || uid === myUid) ? (window._lsGetMyBadge?.() || '') : (m.equippedBadge || ''),
        todayMins:     m.todayMins || 0,
        todayKey:      m.todayKey || tk,
        joinedAt:      m.joinedAt || 0,
        _fromLocal: true,
      });
    });

    // Ensure current user is included even if not yet in Firebase
    if (myUid && !memberMap.has(myUid)) {
      memberMap.set(myUid, {
        uid: myUid, id: 'me', name: myName,
        role: _getMyRole(g) === 'owner' || _getMyRole(g) === 'admin' ? 'admin' : 'member',
        isMe: true, todayMins: 0, todayKey: tk, joinedAt: Date.now(),
      });
    }

    const members = [...memberMap.values()];
    // Guarantee self is always marked correctly
    members.forEach(m => { if (m.uid === myUid) { m.isMe = true; m.id = 'me'; } });
    return members;
  }

  // ── Off Day helpers ───────────────────────────────────────────────────────
  function _isOffDayToday(uid) {
    if (!uid) return false;
    const lm = _liveMembers[uid];
    return !!(lm && lm.isOffDay === true && lm.offDayDate === todayKey());
  }

  function _setOffDay(code, isOff) {
    const db = getDb(), uid = getUserId(), fb = getFb();
    if (!db || !uid || !code || !fb) return;
    const update = {
      isOffDay:    isOff,
      offDayDate:  todayKey(),
      lastUpdated: fb.firestore.FieldValue.serverTimestamp(),
    };
    if (isOff) update.isStudying = false;
    db.collection('groups').doc(code).collection('members').doc(uid)
      .set(update, { merge: true }).catch(() => {});
  }

  // ── Firebase-backed Chat ──────────────────────────────────────────────────
  function _subscribeChatMessages(code) {
    if (_chatGid === code && _chatUnsub) return; // already subscribed
    if (_chatUnsub) { try { _chatUnsub(); } catch(_) {} _chatUnsub = null; }
    _chatGid = code;
    if (!_chatMessages[code]) _chatMessages[code] = [];
    const db = getDb();
    if (!db || !code) return;
    try {
      _chatUnsub = db.collection('groups').doc(code)
        .collection('messages')
        .orderBy('ts', 'asc')
        .limit(100)
        .onSnapshot(snap => {
          const allMsgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          // ── Auto-unpin if the pinned message was deleted ─────────────────
          // Check BEFORE filtering so _deleted:true is still visible here.
          try {
            const sc0  = scLoad();
            const g0   = sc0.groups.find(gg => gg.code === code);
            if (g0?.pinnedMsg?.id) {
              const pinnedInSnap = allMsgs.find(m => m.id === g0.pinnedMsg.id);
              if (pinnedInSnap?._deleted) {
                const db0 = getDb(), fb0 = getFb();
                if (db0 && fb0) {
                  db0.collection('groups').doc(code)
                    .update({ pinnedMsg: fb0.firestore.FieldValue.delete() })
                    .catch(() => {});
                  g0.pinnedMsg = null; scSave(sc0);
                }
              }
            }
          } catch(_) {}
          _chatMessages[code] = allMsgs.filter(m => !m._deleted);
          // Recompute unread count for this group (updates badge in DOM)
          if (_srTab !== 'chat' || _groupView !== ((() => { const sc_u = scLoad(); return sc_u.groups.find(x => x.code === code)?.id; })())) {
            _recomputeUnread(code);
          }
          // Patch chat DOM without full re-render when chat view is active
          const msgsEl = document.getElementById('sr-chat-msgs');
          if (!msgsEl) return;
          const uid     = getUserId();
          const myName  = _getUserDisplayName();
          const sc      = scLoad();
          const g       = sc.groups.find(x => x.code === code);
          if (!g) return;
          msgsEl.innerHTML = _renderChatMessages(code, uid, myName);
          _bindChatLongPress(msgsEl, code, g);
          setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 30);
        }, () => {});
    } catch(_) {}
  }

  function _unsubscribeChatMessages() {
    if (_chatUnsub) { try { _chatUnsub(); } catch(_) {} _chatUnsub = null; }
    _chatGid  = null;
    _replyTo  = null;
    _editMsgId = null;
  }

  // ── Chat rendering helpers ────────────────────────────────────────────────
  function _renderReactions(msg, myUid, code) {
    const reactions = msg.reactions || {};
    const pills = Object.entries(reactions)
      .filter(([, uids]) => Array.isArray(uids) && uids.length > 0)
      .map(([emoji, uids]) => {
        const reacted = myUid && uids.includes(myUid);
        return `<button class="sr-reaction-pill${reacted ? ' sr-reaction-mine' : ''}"
          data-sc="sr-chat-react" data-code="${esc(code)}" data-mid="${esc(msg.id)}" data-emoji="${esc(emoji)}"
          >${emoji} <span>${uids.length}</span></button>`;
      }).join('');
    return pills ? `<div class="sr-reactions-row">${pills}</div>` : '';
  }

  function _renderChatMessages(code, myUid, myName) {
    const msgs = _chatMessages[code] || [];
    if (!msgs.length) return `<div class="sr-chat-empty">No messages yet — say hello! 👋</div>`;
    return msgs.map(msg => {
      const isMe = msg.authorId === myUid || msg.authorId === 'me';
      // Deleted messages render as a subtle tombstone — no text content
      if (msg._deleted) {
        return `
          <div class="sr-chat-row ${isMe ? 'sr-chat-mine' : 'sr-chat-theirs'}" data-msg-id="${esc(msg.id)}">
            ${!isMe ? `<div class="sr-chat-av" style="background:#1e293b;font-size:10px;color:#475569">🗑</div>` : ''}
            <div class="sr-chat-col">
              <div class="sr-chat-deleted">🗑 Message deleted</div>
            </div>
          </div>`;
      }
      // Reply quote — data-reply-id enables scroll-to-original on tap
      const replyHtml = msg.replyToId ? `
        <div class="sr-chat-reply-quote" data-reply-id="${esc(msg.replyToId)}">
          <span class="sr-chat-reply-author">${esc(msg.replyToAuthor || 'Unknown')}</span>
          <span class="sr-chat-reply-text">${esc((msg.replyToText || '').slice(0, 60))}${(msg.replyToText || '').length > 60 ? '…' : ''}</span>
        </div>` : '';
      const reactionsHtml = _renderReactions(msg, myUid, code);
      const tsVal = msg.ts?.toMillis?.() ?? (typeof msg.ts === 'number' ? msg.ts : 0);
      return `
        <div class="sr-chat-row ${isMe ? 'sr-chat-mine' : 'sr-chat-theirs'}" data-msg-id="${esc(msg.id)}">
          ${!isMe ? `<div class="sr-chat-av" data-sc="sr-view-profile" data-uid="${esc(msg.authorId||'')}" data-name="${esc(msg.author||'')}" data-code="${esc(code)}" style="background:${_avatarColor(msg.author||'')};cursor:pointer">${(msg.author||'?')[0].toUpperCase()}</div>` : ''}
          <div class="sr-chat-col">
            ${!isMe ? `<div class="sr-chat-author" data-sc="sr-view-profile" data-uid="${esc(msg.authorId||'')}" data-name="${esc(msg.author||'')}" data-code="${esc(code)}" style="cursor:pointer">${esc(msg.author || 'Unknown')}</div>` : ''}
            ${replyHtml}
            <div class="sr-chat-bubble" data-msg-id="${esc(msg.id)}">${esc(msg.text)}${msg.isEdited ? ' <span class="sr-edited-tag">edited</span>' : ''}</div>
            ${reactionsHtml}
            <div class="sr-chat-ts">${_chatTimeAgo(tsVal)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function _bindChatLongPress(el, code, g) {
    let pressTimer = null, startX = 0, startY = 0, longFired = false, activeMsgEl = null;

    const _cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (activeMsgEl) { activeMsgEl.classList.remove('sr-msg-pressing'); activeMsgEl = null; }
    };

    el.addEventListener('touchstart', e => {
      // Ignore taps on interactive sub-elements (reaction pills, reply quotes)
      if (e.target.closest('.sr-reaction-pill, .sr-chat-reply-quote')) return;
      const msgEl = e.target.closest('[data-msg-id]');
      if (!msgEl) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      longFired = false;
      activeMsgEl = msgEl;
      // Instant visual press feedback
      msgEl.classList.add('sr-msg-pressing');
      const msgId = msgEl.dataset.msgId;
      pressTimer = setTimeout(() => {
        longFired = true;
        if (activeMsgEl) { activeMsgEl.classList.remove('sr-msg-pressing'); activeMsgEl = null; }
        try { if (navigator.vibrate) navigator.vibrate([12]); } catch(_) {}
        _openChatActionSheet(code, g, msgId);
      }, 280);
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (!pressTimer) return;
      // Only cancel on real scroll movement (>12px), not micro-jitter
      if (Math.abs(e.touches[0].clientX - startX) > 12 ||
          Math.abs(e.touches[0].clientY - startY) > 12) {
        _cancelPress();
      }
    }, { passive: true });

    el.addEventListener('touchend', e => {
      const wasFired = longFired;
      _cancelPress();
      longFired = false;
      // Suppress the click that fires after a long-press so no accidental actions
      if (wasFired) e.preventDefault();
    }, { passive: false });

    el.addEventListener('touchcancel', () => {
      _cancelPress(); longFired = false;
    });

    // Desktop: right-click context menu
    el.addEventListener('contextmenu', e => {
      const msgEl = e.target.closest('[data-msg-id]');
      if (!msgEl) return;
      e.preventDefault();
      _openChatActionSheet(code, g, msgEl.dataset.msgId);
    });

    // Tap on reply quote → scroll to original message with highlight flash
    el.addEventListener('click', e => {
      const quote = e.target.closest('.sr-chat-reply-quote');
      if (!quote || !quote.dataset.replyId) return;
      const target = el.querySelector(`.sr-chat-row[data-msg-id="${quote.dataset.replyId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('sr-msg-highlight');
        setTimeout(() => target.classList.remove('sr-msg-highlight'), 1400);
      }
    });
  }

  // ── Chat action sheet (replaces openModal context menu) ──────────────────
  // Renders a DOM-injected bottom sheet so we get a proper mobile feel:
  // slide-up animation, haptic feedback, backdrop dismiss, no modal overhead.
  function _openChatActionSheet(code, g, msgId) {
    document.getElementById('sr-cas')?.remove();
    const msgs = _chatMessages[code] || [];
    const msg  = msgs.find(m => m.id === msgId);
    if (!msg || msg._deleted) return;
    const uid     = getUserId();
    const isMe    = msg.authorId === uid || msg.authorId === 'me';
    const isAdmin = g.ownerUid === uid || g.createdByUid === uid ||
                    (Array.isArray(g.adminUids) && g.adminUids.includes(uid)) ||
                    g.role === 'admin';
    const myName  = _getUserDisplayName();
    const EMOJIS  = ['👍','❤️','😂','😮','😢','🔥'];

    const sheet = document.createElement('div');
    sheet.id = 'sr-cas';
    sheet.className = 'sr-cas-backdrop';
    sheet.innerHTML = `
      <div class="sr-cas-panel" id="sr-cas-panel">
        <div class="sr-cas-handle"></div>
        <div class="sr-cas-preview">${esc((msg.text || '').slice(0, 80))}${(msg.text||'').length > 80 ? '…' : ''}</div>
        <div class="sr-cas-emoji-row">
          ${EMOJIS.map(e => {
            const reacted = Array.isArray((msg.reactions||{})[e]) && msg.reactions[e].includes(uid);
            return `<button class="sr-cas-emoji${reacted ? ' sr-cas-emoji-active' : ''}" data-action="react" data-emoji="${esc(e)}">${e}</button>`;
          }).join('')}
        </div>
        <div class="sr-cas-divider"></div>
        <button class="sr-cas-action" data-action="reply">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          Reply
        </button>
        <button class="sr-cas-action" data-action="copy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Text
        </button>
        ${isMe ? `
        <button class="sr-cas-action" data-action="edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>` : ''}
        ${isAdmin ? `
        <button class="sr-cas-action" data-action="pin">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
          Pin Message
        </button>` : ''}
        ${(isMe || isAdmin) ? `
        <button class="sr-cas-action sr-cas-danger" data-action="delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          ${isMe ? 'Delete for Everyone' : 'Delete (Admin)'}
        </button>` : ''}
      </div>`;

    document.body.appendChild(sheet);
    // Slide-up animation
    requestAnimationFrame(() => requestAnimationFrame(() =>
      document.getElementById('sr-cas-panel')?.classList.add('sr-cas-open')
    ));
    // Backdrop tap → close
    sheet.addEventListener('click', e => { if (e.target === sheet) _closeChatActionSheet(); });

    // Action handlers — closured over (code, msgId, msg, uid, myName)
    sheet.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        _closeChatActionSheet();

        if (action === 'react') {
          const emoji = btn.dataset.emoji;
          const db2 = getDb(), fb2 = getFb();
          if (!code || !msgId || !emoji || !uid || !db2 || !fb2) return;
          const msgRef = db2.collection('groups').doc(code).collection('messages').doc(msgId);
          db2.runTransaction(t => t.get(msgRef).then(snap => {
            if (!snap.exists) return;
            const reacs = { ...(snap.data().reactions || {}) };
            // Find which emoji this user currently has (one reaction per user rule)
            let currentEmoji = null;
            Object.entries(reacs).forEach(([e, uids]) => {
              if (Array.isArray(uids) && uids.includes(uid)) currentEmoji = e;
            });
            // Remove user from every emoji array first
            Object.keys(reacs).forEach(e => {
              if (Array.isArray(reacs[e])) reacs[e] = reacs[e].filter(u => u !== uid);
            });
            // If tapping a different emoji → add it. If same emoji → just removed (toggle off).
            if (emoji !== currentEmoji) {
              if (!Array.isArray(reacs[emoji])) reacs[emoji] = [];
              reacs[emoji].push(uid);
            }
            // Prune empty arrays so Firestore stays clean
            Object.keys(reacs).forEach(e => { if (!reacs[e].length) delete reacs[e]; });
            t.update(msgRef, { reactions: reacs });
          })).catch(() => {});

        } else if (action === 'reply') {
          _replyTo   = { id: msgId, text: msg.text || '', author: msg.author || 'Unknown' };
          _editMsgId = null;
          renderSocial();
          setTimeout(() => document.getElementById('sr-chat-input')?.focus(), 80);

        } else if (action === 'copy') {
          try {
            navigator.clipboard.writeText(msg.text || '')
              .then(() => toast('Copied!', 'success', 1500))
              .catch(() => {});
          } catch(_) {}

        } else if (action === 'edit') {
          _editMsgId = msgId;
          _replyTo   = null;
          renderSocial();
          setTimeout(() => {
            const inp = document.getElementById('sr-chat-input');
            if (inp) { inp.value = msg.text || ''; inp.focus(); }
          }, 80);

        } else if (action === 'pin') {
          const db3 = getDb(), fb3 = getFb();
          if (!db3 || !fb3) return;
          db3.collection('groups').doc(code).update({
            pinnedMsg: { id: msgId, text: msg.text || '', author: msg.author || '',
                         pinnedBy: myName, pinnedAt: fb3.firestore.FieldValue.serverTimestamp() }
          }).then(() => {
            const sc_ = scLoad();
            const gL  = sc_.groups.find(gg => gg.code === code);
            if (gL) { gL.pinnedMsg = { id: msgId, text: msg.text || '', author: msg.author || '', pinnedBy: myName }; scSave(sc_); }
            renderSocial();
            toast('📌 Message pinned', 'success', 1500);
          }).catch(() => {});

        } else if (action === 'delete') {
          const db4 = getDb(), fb4 = getFb();
          if (!db4) return;
          const batch4 = db4.batch();
          const msgRef4 = db4.collection('groups').doc(code).collection('messages').doc(msgId);
          batch4.update(msgRef4, { _deleted: true, text: '' });
          // If this is the pinned message — atomically unpin it in the same batch
          const sc4 = scLoad();
          const gL4 = sc4.groups.find(gg => gg.code === code);
          if (gL4?.pinnedMsg?.id === msgId && fb4) {
            batch4.update(db4.collection('groups').doc(code), { pinnedMsg: fb4.firestore.FieldValue.delete() });
            gL4.pinnedMsg = null; scSave(sc4);
          }
          batch4.commit().catch(() => {});
          // Optimistic local update so the tombstone appears immediately
          const localMsgs = _chatMessages[code];
          if (localMsgs) {
            const m_ = localMsgs.find(x => x.id === msgId);
            if (m_) { m_._deleted = true; m_.text = ''; }
          }
          renderSocial();
        }
      });
    });
  }

  function _closeChatActionSheet() {
    const panel = document.getElementById('sr-cas-panel');
    if (panel) {
      panel.classList.remove('sr-cas-open');
      setTimeout(() => document.getElementById('sr-cas')?.remove(), 180);
    } else {
      document.getElementById('sr-cas')?.remove();
    }
  }

  // Thin alias — kept so any stray call-sites don't break
  function _openChatContextMenu(code, g, msgId) { _openChatActionSheet(code, g, msgId); }

  function _writeSelfPresence(code, isStudying, todayMins, subjectName, avatarStage, setStartTime) {
    const db = getDb(), uid = getUserId(), fb = getFb();
    if (!db || !uid || !code || !fb) return;
    const update = {
      uid,
      displayName:      _getUserDisplayName(),
      isStudying:       !!isStudying,
      elapsedTimeToday: todayMins || 0,
      currentSubject:   subjectName || null,
      dateKey:          todayKey(),
      avatarStage:      typeof avatarStage === 'number' ? avatarStage : (window._lsGetCurrentAvStage?.() || 0),
      equippedBadge:    window._lsGetMyBadge?.() || '',
      lastUpdated:      fb.firestore.FieldValue.serverTimestamp(),
    };
    // Only set studyStartedAt on an explicit transition to studying (setStartTime=true).
    // Periodic ticker updates must NOT reset it — other members use it to compute
    // live elapsed time as (Date.now() - studyStartedAt), so resetting it every
    // 30 s would make their timers appear to restart from zero repeatedly.
    if (isStudying && setStartTime) update.studyStartedAt = Date.now();
    db.collection('groups').doc(code).collection('members').doc(uid)
      .set(update, { merge: true })
      .then(() => { _updateGroupStats(code); })
      .catch(() => {});
  }

  async function _restoreGroupsFromFirebase() {
    const db = getDb(), uid = getUserId();
    if (!db || !uid) return;
    try {
      const myName = _getUserDisplayName();

      // Gather codes from: 1) user joinedRooms 2) groups this user created
      let allCodes = [];
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        allCodes = [...(userSnap.data().joinedRooms || [])];
      }

      // Also query groups created by this user so ownership never gets lost
      const createdSnap = await db.collection('groups')
        .where('createdBy', '==', uid).get()
        .catch(() => ({ docs: [] }));
      createdSnap.docs.forEach(d => {
        const code = d.id;
        if (!allCodes.includes(code)) allCodes.push(code);
        // Also repair missing createdByUid field
        const data = d.data();
        if (!data.createdByUid) {
          d.ref.set({ createdByUid: uid }, { merge: true }).catch(() => {});
        }
        // Auto-repair: ensure creator is in members subcollection
        db.collection('groups').doc(code).collection('members').doc(uid)
          .get().then(ms_ => {
            if (!ms_.exists) {
              const fb_ = getFb();
              if (fb_) {
                db.collection('groups').doc(code).collection('members').doc(uid).set({
                  uid, displayName: myName, role: 'admin',
                  joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
                  isStudying: false, currentSubject: null, elapsedTimeToday: 0,
                }, { merge: true }).catch(() => {});
              }
            }
          }).catch(() => {});
      });

      if (!allCodes.length) return;
      const sc = scLoad();
      const existingCodes = sc.groups.map(g => g.code);
      const missing = allCodes.filter(c => !existingCodes.includes(c));
      if (!missing.length) return;

      await Promise.all(missing.map(async code => {
        try {
          const snap = await db.collection('groups').doc(code).get();
          if (!snap.exists) return;
          const data = snap.data();
          const sc2 = scLoad();
          if (sc2.groups.some(g => g.code === code)) return;
          // Verify the user is the creator OR has an actual Firestore member doc.
          // Never add a group to local state without confirmed membership.
          const isCreator = data.createdBy === uid || data.createdByUid === uid || data.ownerUid === uid;
          let myRole = isCreator ? 'admin' : 'member';
          let hasMemberDoc = false;
          try {
            const mSnap = await db.collection('groups').doc(code).collection('members').doc(uid).get();
            hasMemberDoc = mSnap.exists;
            if (hasMemberDoc) myRole = mSnap.data().role || myRole;
          } catch(_) {}
          // Guard: skip if user is neither creator nor has a member doc
          if (!hasMemberDoc && !isCreator) {
            // Remove stale code from user's joinedRooms to prevent future confusion
            const fb_guard = getFb();
            if (fb_guard) {
              db.collection('users').doc(uid).set({
                joinedRooms: fb_guard.firestore.FieldValue.arrayRemove(code),
              }, { merge: true }).catch(() => {});
            }
            return;
          }
          const rawCat = data.category || 'General';
          sc2.groups.push({
            id:           data.groupId || code,
            name:         data.name || `Group ${code}`,
            icon:         data.icon || '📚',
            code:         data.code || code,
            isPrivate:    data.isPrivate || false,
            description:  data.description || '',
            category:     rawCat === 'camstudy' ? 'General' : rawCat,
            dailyGoalHrs: data.dailyGoalHrs || 8,
            maxMembers:   data.maxMembers || 50,
            leader:       (data.leader && data.leader !== 'You') ? data.leader : (data.createdByName || myName),
            promoted:     false,
            createdAt:    data.createdAt?.toMillis?.() ?? Date.now(),
            dailyMinsTotal: 0, attendancePct: 0,
            role:         myRole,
            ownerUid:     data.ownerUid || data.createdByUid || data.createdBy || null,
            createdByUid: data.createdByUid || data.createdBy || null,
            admins:       Array.isArray(data.admins) ? data.admins : (isCreator ? [uid] : []),
            members:      [{ id: uid, name: myName, role: myRole, joinedAt: Date.now() }],
          });
          scSave(sc2);
        } catch(_) {}
      }));

      // Ensure Firestore user doc has all codes
      const fb_ = getFb();
      if (fb_ && allCodes.length) {
        db.collection('users').doc(uid).set({
          joinedRooms: allCodes,
          displayNameAuto: myName,
        }, { merge: true }).catch(() => {});
      }

      // Start self-kick detection for all restored groups
      if (missing.length > 0) {
        setTimeout(() => {
          const sc_r = scLoad();
          sc_r.groups.forEach(g => { if (g.code) _subscribeSelfMembership(g.code); });
        }, 600);
        if (window._currentTab === 'social') renderSocial();
      }
    } catch(_) {}
  }

  // ── Study Room SVG constants ──────────────────────────────────────────────
  const SR_ACTIVE_DESK = `<svg class="sr-desk-svg" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="28" cy="10" r="5" stroke="currentColor" stroke-width="2.2"/>
    <path d="M20 22 C20 17 23 16 28 16 C33 16 36 17 36 22 L36 26" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M20 25 C24 27 32 27 36 26" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <rect x="10" y="30" width="36" height="4" rx="2" fill="currentColor"/>
    <line x1="15" y1="34" x2="15" y2="44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="41" y1="34" x2="41" y2="44" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

  const SR_IDLE_DESK = `<svg class="sr-desk-svg" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="28" cy="18" r="10" stroke="currentColor" stroke-width="2.2"/>
    <line x1="28" y1="18" x2="28" y2="11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="28" y1="18" x2="33.5" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <rect x="10" y="32" width="36" height="4" rx="2" fill="currentColor"/>
    <line x1="15" y1="36" x2="15" y2="46" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="41" y1="36" x2="41" y2="46" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

  const SR_NAV_ICONS = {
    home:       `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    attendance: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    rankings:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    duels:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l2-2"/><path d="M20.5 6.5L22 5V3h-2l-1.5 1.5"/><path d="M5 5l9.5 9.5"/><path d="M10.5 17.5L3 21"/><path d="M21 14.5L17.5 11"/></svg>`,
    chat:       `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  };

  // ── Group Settings Panel — role-aware ─────────────────────────────────────
  function _renderGroupSettings(g, sc) {
    const myRole  = _getMyRole(g);
    const isOwner = myRole === 'owner';
    const isAdmin = myRole === 'owner' || myRole === 'admin';

    // Members get a completely different (limited) settings page
    if (!isAdmin) return _renderMemberSettings(g, sc);

    // ── ADMIN / OWNER SETTINGS ────────────────────────────────────────────
    const joinMode     = g.joinMode     || 'open';
    const hasPassword  = !!(g.joinPassword && g.joinPassword.length);
    const chatEnabled  = g.chatEnabled  !== false;
    const nicknameReq  = !!g.nicknameRequired;
    const signupQOn    = !!(g.joinQuestion && g.joinQuestion.length);
    const maxMembers   = g.maxMembers   || 50;
    const category     = g.category    || 'General';
    const promotedAt   = g.promotedAt  || null;
    const promotedAgo  = promotedAt ? _timeAgo(promotedAt) : null;
    const requests     = (sc.requests && sc.requests[g.id]) || [];
    const memberCount  = Math.max(
      (g.members || []).length,
      g.memberCount || 0,
      Object.keys(_liveMembers).length
    );

    const ch  = `<svg class="sgs-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const div = `<div class="sgs-row-divider"></div>`;

    const row = (icon, label, hint, act, disabled) => `
      <button class="sgs-row${disabled ? ' sgs-row-disabled' : ''}" data-sc="${act}" data-gid="${esc(g.id)}"${disabled ? ' disabled' : ''}>
        <span class="sgs-row-icon">${icon}</span>
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta">${hint ? `<span class="sgs-row-hint">${hint}</span>` : ''}${disabled ? '' : ch}</span>
      </button>`;

    const toggleRow = (icon, label, on, act) => `
      <button class="sgs-row" data-sc="${act}" data-gid="${esc(g.id)}">
        <span class="sgs-row-icon">${icon}</span>
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta"><span class="sgs-toggle ${on ? 'sgs-toggle-on' : 'sgs-toggle-off'}">${on ? 'ON' : 'OFF'}</span>${ch}</span>
      </button>`;

    const roleBadge = isOwner
      ? `<span class="sgs-role-badge sgs-role-owner">👑 Owner</span>`
      : `<span class="sgs-role-badge sgs-role-admin">⚡ Admin</span>`;

    return `
      <div class="sgs-page">
        <div class="sgs-topbar">
          <button class="sgs-back-btn" data-sc="sgs-back" data-gid="${esc(g.id)}" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="sgs-topbar-title">Admin Settings</span>
          ${roleBadge}
        </div>

        <div class="sgs-scroll">

          <div class="sgs-group-hero">
            <div class="sgs-group-hero-icon">${g.icon || '📚'}</div>
            <div class="sgs-group-hero-name">${esc(g.name)}</div>
            <div class="sgs-group-hero-stats">${memberCount} members · ${category}</div>
          </div>

          <div class="sgs-section-label">Group Management</div>
          <div class="sgs-card">
            ${row('✏️', 'Group Name & Icon', esc(g.name || ''), 'sgs-change-name')}
            ${div}
            ${row('📋', 'Introduction / Rules', g.description ? '' : 'Not set', 'sgs-change-rules')}
            ${div}
            ${row('🏷️', 'Category', esc(category), 'sgs-change-category')}
            ${div}
            ${row('🎯', 'Daily Goal', (g.dailyGoalHrs || 8) + 'h / day', 'sgs-change-goal')}
            ${div}
            ${row('👥', 'Max Capacity', maxMembers + ' people', 'sgs-change-capacity')}
            ${div}
            ${row('🔒', 'Privacy & Join Mode', joinMode === 'approval' ? 'Approval required' : hasPassword ? 'Password protected' : 'Open', 'sgs-join-mode')}
          </div>

          <div class="sgs-section-label">Member Management</div>
          <div class="sgs-card">
            ${row('👤', 'Manage Members', memberCount + ' member' + (memberCount !== 1 ? 's' : ''), 'sgs-manage-members')}
            ${div}
            ${(joinMode === 'approval') ? (() => {
              const liveCount = _joinRequestsCount[g.code] ?? requests.length;
              const badge     = liveCount > 0 ? ` <span style="display:inline-block;background:#f97316;color:#fff;font-size:10px;font-weight:700;border-radius:999px;padding:1px 7px;margin-left:4px;vertical-align:middle">${liveCount}</span>` : '';
              return row('⏳', 'Waiting Room' + badge, liveCount > 0 ? liveCount + ' pending request' + (liveCount !== 1 ? 's' : '') : 'No pending requests', 'sgs-waiting-room') + div;
            })() : (requests.length > 0 ? row('⏳', 'Waiting Room', requests.length + ' pending', 'sgs-waiting-room') + div : '')}
            ${row('📣', 'Nudge Everyone', 'Send a study reminder', 'sgs-nudge-all')}
          </div>

          <div class="sgs-section-label">Study System</div>
          <div class="sgs-card">
            ${toggleRow('💬', 'Group Chat', chatEnabled, 'sgs-toggle-chat')}
            ${div}
            ${toggleRow('📛', 'Require Nickname', nicknameReq, 'sgs-nickname-rules')}
            ${div}
            ${toggleRow('❓', 'Sign-Up Questions', signupQOn, 'sgs-signup-question')}
          </div>

          <div class="sgs-section-label">Security</div>
          <div class="sgs-card">
            ${row('🔑', 'Group Password', hasPassword ? '🔐 Protected' : 'Public', 'sgs-change-password')}
            ${div}
            ${row('📤', 'Promote Group', promotedAgo ? 'Last: ' + promotedAgo : 'Share & invite', 'sgs-promote')}
          </div>

          <div class="sgs-section-label">Invite Members</div>
          <div class="sgs-card">
            <div class="sgs-invite-block">
              <div class="sgs-invite-label">Group Invite Code</div>
              <div class="sgs-invite-code-row">
                <span class="sgs-invite-code">${esc(g.code)}</span>
                <button class="sgs-invite-copy-btn" data-sc="sr-copy-invite" data-code="${esc(g.code)}">Copy</button>
              </div>
              <div class="sgs-invite-hint">Share this code with friends to invite them to the group</div>
            </div>
          </div>

          ${isOwner ? `
          <div class="sgs-section-label">Danger Zone</div>
          <div class="sgs-card sgs-card-danger">
            <button class="sgs-row" data-sc="sgs-delete-group" data-gid="${esc(g.id)}">
              <span class="sgs-row-icon">🗑️</span>
              <span class="sgs-row-label sgs-label-danger">Delete Group</span>
            </button>
          </div>
          ` : `
          <div class="sgs-section-label">Danger Zone</div>
          <div class="sgs-card sgs-card-danger">
            <button class="sgs-row" data-sc="sgs-leave-group-settings" data-gid="${esc(g.id)}">
              <span class="sgs-row-icon">🚪</span>
              <span class="sgs-row-label sgs-label-danger">Leave Group</span>
            </button>
          </div>
          `}

          <div style="height:48px"></div>
        </div>
      </div>`;
  }

  // ── Member Settings Panel — for regular members only ──────────────────────
  function _renderMemberSettings(g, sc) {
    const myUid      = getUserId();
    const myMember   = (g.members || []).find(m => m.id === 'me' || m.id === myUid || m.uid === myUid);
    const myNickname = myMember?.name || _getUserDisplayName();
    const notifOn    = g.notifEnabled !== false;
    const muteOn     = !!(g.muted);

    const ch  = `<svg class="sgs-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const div = `<div class="sgs-row-divider"></div>`;

    const row = (icon, label, hint, act) => `
      <button class="sgs-row" data-sc="${act}" data-gid="${esc(g.id)}">
        <span class="sgs-row-icon">${icon}</span>
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta">${hint ? `<span class="sgs-row-hint">${hint}</span>` : ''}${ch}</span>
      </button>`;

    const toggleRow = (icon, label, on, act) => `
      <button class="sgs-row" data-sc="${act}" data-gid="${esc(g.id)}">
        <span class="sgs-row-icon">${icon}</span>
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta"><span class="sgs-toggle ${on ? 'sgs-toggle-on' : 'sgs-toggle-off'}">${on ? 'ON' : 'OFF'}</span>${ch}</span>
      </button>`;

    return `
      <div class="sgs-page">
        <div class="sgs-topbar">
          <button class="sgs-back-btn" data-sc="sgs-back" data-gid="${esc(g.id)}" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="sgs-topbar-title">My Settings</span>
          <span class="sgs-role-badge sgs-role-member">✓ Member</span>
        </div>

        <div class="sgs-scroll">

          <div class="sgs-group-hero">
            <div class="sgs-group-hero-icon">${g.icon || '📚'}</div>
            <div class="sgs-group-hero-name">${esc(g.name)}</div>
            <div class="sgs-group-hero-stats">Your personal group preferences</div>
          </div>

          <div class="sgs-section-label">Personal</div>
          <div class="sgs-card">
            ${row('📛', 'My Nickname in Group', esc(myNickname), 'mbs-nickname')}
            ${div}
            ${toggleRow('🔔', 'Group Notifications', notifOn, 'mbs-notif')}
            ${div}
            ${toggleRow('🔕', 'Mute Group', muteOn, 'mbs-mute')}
          </div>

          <div class="sgs-section-label">Invite Members</div>
          <div class="sgs-card">
            <div class="sgs-invite-block">
              <div class="sgs-invite-label">Group Invite Code</div>
              <div class="sgs-invite-code-row">
                <span class="sgs-invite-code">${esc(g.code)}</span>
                <button class="sgs-invite-copy-btn" data-sc="sr-copy-invite" data-code="${esc(g.code)}">Copy</button>
              </div>
              <div class="sgs-invite-hint">Share this code with friends to invite them</div>
            </div>
          </div>

          <div class="sgs-section-label">Social</div>
          <div class="sgs-card">
            ${row('🔖', 'Bookmark Group', '', 'mbs-bookmark')}
            ${div}
            ${row('📤', 'Share Group', 'Invite friends', 'mbs-share')}
            ${div}
            ${row('👥', 'View Members', '', 'mbs-view-members')}
          </div>

          <div class="sgs-section-label">Study</div>
          <div class="sgs-card">
            ${row('🎯', 'Daily Goal', (g.dailyGoalHrs || 8) + 'h (group goal)', 'mbs-daily-goal')}
          </div>

          <div class="sgs-section-label">Danger Zone</div>
          <div class="sgs-card sgs-card-danger">
            <button class="sgs-row" data-sc="sgs-leave-group-settings" data-gid="${esc(g.id)}">
              <span class="sgs-row-icon">🚪</span>
              <span class="sgs-row-label sgs-label-danger">Leave Group</span>
            </button>
            ${div}
            <button class="sgs-row" data-sc="mbs-report" data-gid="${esc(g.id)}">
              <span class="sgs-row-icon">🚨</span>
              <span class="sgs-row-label sgs-label-danger">Report Group</span>
            </button>
          </div>

          <div class="sgs-member-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Group settings are managed by the group admin or owner.
          </div>

          <div style="height:48px"></div>
        </div>
      </div>`;
  }

  // ── Study Room Render ─────────────────────────────────────────────────────
  function _renderStudyRoom(g, sc) {
    const SR_TABS = [
      { id:'home',       icon: SR_NAV_ICONS.home,       label:'Home' },
      { id:'attendance', icon: SR_NAV_ICONS.attendance, label:'Attend' },
      { id:'rankings',   icon: SR_NAV_ICONS.rankings,   label:'Rankings' },
      { id:'duels',      icon: SR_NAV_ICONS.duels,      label:'Duels' },
      { id:'chat',       icon: SR_NAV_ICONS.chat,       label:'Chat' },
    ];
    const tabContent = (() => {
      switch (_srTab) {
        case 'attendance': return _renderSrAttendance(g, sc);
        case 'rankings':   return _renderSrRankings(g, sc);
        case 'duels':      return window.DuelSystem?.renderDuelsTab(g, sc) || '<div class="dt-loading-msg">Loading duel system…</div>';
        case 'chat':       return _renderSrChat(g, sc);
        default:           return _renderSrHome(g, sc);
      }
    })();
    return `
      <div class="sr-room${_srTab === 'chat' ? ' sr-room--chat' : ''}">
        <div class="sr-top-bar">
          <button class="sr-back-btn" data-sc="close-group" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="sr-top-title">${esc(g.name)}</div>
          <button class="sr-gear-btn" data-sc="sr-settings" data-gid="${esc(g.id)}" aria-label="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
        <button class="sr-rules-banner" data-sc="sr-rules" data-gid="${esc(g.id)}">
          <span class="sr-rules-icon">📢</span>
          <span class="sr-rules-text">${g.description ? esc(g.description.slice(0,80)) + (g.description.length > 80 ? '…' : '') : 'Group Introduction / Rules'}</span>
          <span class="sr-rules-chevron">›</span>
        </button>
        <div class="sr-scroll-area">
          ${tabContent}
        </div>
        <nav class="sr-bottom-nav">
          ${SR_TABS.map(t => {
            const isChatTab = t.id === 'chat';
            const code_     = g.code;
            const unread_   = isChatTab ? (_unreadCounts[code_] || 0) : 0;
            const badgeHtml = (isChatTab && unread_ > 0)
              ? `<span class="sr-unread-badge">${unread_ > 99 ? '99+' : unread_}</span>`
              : '';
            return `
            <button class="sr-nav-btn${_srTab === t.id ? ' sr-nav-active' : ''}" data-sc="sr-tab" data-tab="${t.id}" style="position:relative">
              <span class="sr-nav-icon">${t.icon}${badgeHtml}</span>
              <span class="sr-nav-label">${t.label}</span>
            </button>`;
          }).join('')}
        </nav>
      </div>`;
  }

  function _renderSrHome(g, sc) {
    const members  = g.members || [];
    const myUid    = getUserId();
    // Always derive own active state from the live focus engine — never from
    // the Firestore-delayed _liveMembers[uid] or local g.members data.
    const meActive = ui().focusIsRunning?.() === true;

    // Deduplicate members using a UID-keyed map — prevents duplicate "You" cards
    const memberMap = new Map();
    members.forEach(m => {
      const uid = (m.id === 'me' || m.id === myUid) ? myUid : (m.id || m.uid);
      if (uid && !memberMap.has(uid)) memberMap.set(uid, m);
      else if (!uid) memberMap.set('__' + Math.random(), m);
    });
    // Merge Firebase-only members not already in local list.
    // Skip confirmed orphans — users whose account has been deleted.
    Object.entries(_liveMembers).forEach(([uid, data]) => {
      if (uid && !memberMap.has(uid) && !_confirmedOrphans.has(uid)) {
        memberMap.set(uid, {
          id: uid, name: data.displayName || 'Studying…', role: data.role || 'member',
          _fromFirebase: true,
        });
      }
    });
    // Also prune any local members already identified as orphans
    _confirmedOrphans.forEach(uid => memberMap.delete(uid));
    const allMembers  = [...memberMap.values()];
    // Filter stale heartbeats (heartbeat > PRESENCE_STALE_MS old) so active
    // count matches what the member cards actually show as active.
    const fbOnline    = Object.values(_liveMembers).filter(x => x.isStudying && !_isMemberStale(x)).length;
    const activeCount = meActive ? Math.max(1, fbOnline) : fbOnline;
    const totalCount  = Math.max(allMembers.length, Object.keys(_liveMembers).length, (g.memberCount || 0));

    // Goal progress for current user
    const dailyGoalMins = (g.dailyGoalHrs || 8) * 60;
    const myTodayMins   = (((getMainState().focusStats || {}).minutesByDate) || {})[todayKey()] || 0;
    const goalPct       = Math.min(100, Math.round((myTodayMins / dailyGoalMins) * 100));
    const goalHrsDisplay = myTodayMins >= 60
      ? `${Math.floor(myTodayMins / 60)}h ${myTodayMins % 60}m`
      : `${myTodayMins}m`;

    const _avLabel   = s => (window._lsAvLabels || ['IDLE','FOCUSED','STUDYING','DEEP STUDY','SCHOLAR','SAGE','WARRIOR','BLAZING','INFERNO','LEGENDARY'])[s] || 'LEGENDARY';
    const _avPillCls = s => s >= 9 ? 'sr-av-pill--legend' : s >= 6 ? 'sr-av-pill--fire' : s >= 3 ? 'sr-av-pill--warm' : 'sr-av-pill--dim';

    // Active members chips — currently studying
    const activeMembers = allMembers.filter(m => {
      const uid   = (m.id === 'me' || m.id === myUid) ? myUid : (m.id || m.uid);
      const isOff = _isOffDayToday(uid);
      return !isOff && ((m.id === 'me' || m.id === myUid) ? meActive : _srMemberIsActive(m));
    });

    const activeChips = activeMembers.map(m => {
      const uid     = (m.id === 'me' || m.id === myUid) ? myUid : (m.id || m.uid);
      const secs    = _srMemberSeconds(m);
      const name    = m.name || 'Unknown';
      const lm      = _liveMembers[uid] || null;
      const subject = (lm?.currentSubject || '').trim();
      const avStage = (m.id === 'me' || m.id === myUid)
        ? (window._lsGetCurrentAvStage?.() || 0)
        : (lm?.avatarStage || 0);
      return `
        <div class="sr-active-chip">
          <div class="sr-active-chip-av" style="background:${_avatarColor(name)}">${name[0].toUpperCase()}</div>
          <div class="sr-active-chip-body">
            <div class="sr-active-chip-name">${esc(name.length > 12 ? name.slice(0,11)+'…' : name)}</div>
            <div class="sr-active-chip-time">${_fmtSecs(secs)}</div>
            ${subject ? `<div class="sr-active-chip-subj">${esc(subject.length > 14 ? subject.slice(0,13)+'…' : subject)}</div>` : ''}
          </div>
          ${avStage > 0 ? `<div class="sr-active-chip-stage ${_avPillCls(avStage)}">${_avLabel(avStage)}</div>` : ''}
        </div>`;
    }).join('');

    const memberCards = allMembers.map(m => {
      const realUid     = (m.id === 'me' || m.id === myUid) ? myUid : (m.id || m.uid);
      const isOff       = _isOffDayToday(realUid);
      const active      = !isOff && ((m.id === 'me' || m.id === myUid) ? meActive : _srMemberIsActive(m));
      const secs        = isOff ? 0 : _srMemberSeconds(m);
      const name        = m.name || 'Unknown';
      const displayName = name.length > 10 ? name.slice(0, 9) + '…' : name;
      const timerId     = (m.id === 'me' || m.id === myUid) ? 'me' : (m.id || m.uid);
      const cardClass   = isOff ? 'sr-card-off' : (active ? 'sr-card-active' : 'sr-card-idle');
      const avStage     = (m.id === 'me' || m.id === myUid)
        ? (window._lsGetCurrentAvStage?.() || 0)
        : (realUid && _liveMembers[realUid] ? (_liveMembers[realUid].avatarStage || 0) : 0);
      const showPill    = !isOff && avStage > 0;
      // Last-seen label: only for idle members that are not the local user
      const lmData      = realUid && _liveMembers[realUid] ? _liveMembers[realUid] : null;
      const showLastSeen = !active && !isOff && timerId !== 'me' && lmData;
      const lastSeenStr  = showLastSeen ? _fmtLastSeen(lmData) : '';
      return `
        <div class="sr-member-card ${cardClass}" data-sr-card="${esc(m.id)}"
             data-sc="sr-view-profile" data-uid="${esc(realUid)}" data-name="${esc(name)}" data-code="${esc(g.code||g.id||'')}">
          <div class="sr-card-icon-wrap">
            <div class="sr-card-icon">${active ? SR_ACTIVE_DESK : SR_IDLE_DESK}</div>
            ${isOff ? `<div class="sr-off-badge">OFF</div>` : ''}
          </div>
          <div class="sr-card-name">${esc(displayName)}</div>
          ${m.equippedBadge ? `<div class="sr-card-badge">${window._cmkBadgeHTML?.(m.equippedBadge) || ''}</div>` : ''}
          <div class="sr-card-timer${active ? ' sr-timer-live' : ''}" data-sr-timer="${esc(timerId)}">${isOff ? '—' : _fmtSecs(secs)}</div>
          ${showLastSeen ? `<div class="sr-card-lastseen" data-sr-lastseen="${esc(timerId)}">${lastSeenStr}</div>` : ''}
          ${showPill ? `<div class="sr-av-pill ${_avPillCls(avStage)}">${_avLabel(avStage)}</div>` : ''}
        </div>`;
    });

    return `
      <div class="sr-home-view">

        <div class="sr-home-stats-bar">
          <div class="sr-home-stat">
            <div class="sr-home-stat-val sr-home-stat-active">${activeCount}</div>
            <div class="sr-home-stat-lbl">Active</div>
          </div>
          <div class="sr-home-stat-div"></div>
          <div class="sr-home-stat">
            <div class="sr-home-stat-val">${totalCount}</div>
            <div class="sr-home-stat-lbl">Members</div>
          </div>
          <div class="sr-home-stat-div"></div>
          <div class="sr-home-stat">
            <div class="sr-home-stat-val">${g.dailyGoalHrs || 8}h</div>
            <div class="sr-home-stat-lbl">Daily Goal</div>
          </div>
          <div class="sr-home-stat-div"></div>
          <div class="sr-home-stat">
            <div class="sr-home-stat-val">${goalPct}%</div>
            <div class="sr-home-stat-lbl">My Progress</div>
            <div class="sr-home-stat-bar-wrap">
              <div class="sr-home-stat-bar" style="width:${goalPct}%"></div>
            </div>
          </div>
        </div>

        ${activeMembers.length > 0 ? `
        <div class="sr-home-section-hd">
          <span class="sr-home-section-title">🔥 Studying Now</span>
          <span class="sr-home-section-badge">${activeCount}</span>
        </div>
        <div class="sr-active-chips-scroll">
          ${activeChips}
        </div>` : `
        <div class="sr-home-idle-banner">
          <span class="sr-home-idle-icon">💤</span>
          <span class="sr-home-idle-text">No one is studying right now — be the first!</span>
        </div>`}

        <div class="sr-home-section-hd" style="margin-top:16px">
          <span class="sr-home-section-title">All Members</span>
          <span class="sr-home-section-count">${totalCount}</span>
        </div>

        <div class="sr-members-grid">
          ${memberCards.length
            ? memberCards.join('')
            : `<div class="sr-empty-grid">No members in this group yet.</div>`}
        </div>

      </div>`;
  }

  function _renderSrAttendance(g, sc) {
    const ms       = getMainState();
    const mbd      = ((ms.focusStats || {}).minutesByDate) || {};
    const members  = _getGroupMembers(g);
    const myUid    = getUserId();
    const tk       = todayKey();
    const amOff    = _isOffDayToday(myUid);
    const required = _attMinRequired(g);
    const weekDays = _attWeekDays();   // 7 days: Fri → Thu

    // Week label  e.g. "Nov 8 – Nov 14"
    const fmt = d => {
      const [, mm, dd] = d.key.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[parseInt(mm,10)-1]} ${parseInt(dd,10)}`;
    };
    const weekLabel = `${fmt(weekDays[0])} – ${fmt(weekDays[6])}`;

    // My summary stats for this week
    let myPresent = 0, myMissed = 0;
    weekDays.forEach(day => {
      if (day.isFuture) return;
      const mins   = mbd[day.key] || 0;
      const isOff  = amOff && day.isToday; // off-day only affects today
      const status = _attStatus(mins, day.isFuture, true, required, isOff);
      if (status === 'present' || status === 'offday') myPresent++;
      else if (status === 'missed') myMissed++;
    });
    const myStreak  = _attStreak(mbd, required);
    const myPct     = (myPresent + myMissed) > 0
      ? Math.round(myPresent / (myPresent + myMissed) * 100) : 0;

    // Status icon/classes
    const statusCell = (status, isToday, mins, required) => {
      const icons = { present: '✓', missed: '✗', future: '·', unknown: '·', offday: '○' };
      const cls   = `sr-att-status sr-att-status--${status}${isToday ? ' sr-att-status--today' : ''}`;
      const tip   = status === 'present' ? `${Math.floor(mins/60)}h ${mins%60}m` :
                    status === 'missed'  ? (mins > 0 ? `${mins}m (need ${required}m)` : 'No session') :
                    status === 'offday'  ? 'Off day' : '';
      return `<div class="${cls}" title="${tip}">${icons[status] || '·'}</div>`;
    };

    return `
      <div class="sr-att-view">

        <div class="sr-att-topbar">
          <div class="sr-att-week-label">
            <span class="sr-att-week-title">Week</span>
            <span class="sr-att-week-range">${weekLabel}</span>
          </div>
          <button class="sr-att-offday-btn${amOff ? ' sr-att-offday-active' : ''}" data-sc="sr-set-offday"
            title="${amOff ? 'Cancel off day' : 'Mark today as rest day'}">
            ${amOff ? '🛋 Off' : '😴 Off Day'}
          </button>
        </div>

        ${amOff ? `<div class="sr-att-offday-banner">🛋️ You've marked today as a rest day — enjoy your break!</div>` : ''}

        <div class="sr-att-grid-wrap">
          <div class="sr-att-grid">

            <div class="sr-att-grid-head">
              <div class="sr-att-mem-col"></div>
              ${weekDays.map(d => `
                <div class="sr-att-day-hdr${d.isToday ? ' sr-att-day-hdr--today' : ''}${d.isFuture ? ' sr-att-day-hdr--future' : ''}">
                  <div class="sr-att-day-name">${d.dayName}</div>
                  <div class="sr-att-day-num">${d.dayNum}</div>
                </div>`).join('')}
            </div>

            ${members.length === 0
              ? `<div class="sr-empty-grid" style="grid-column:1/-1">No members yet.</div>`
              : members.map(m => {
                  const rawName  = m.name || '?';
                  const dispName = rawName.length > 8 ? rawName.slice(0, 7) + '…' : rawName;
                  const lm       = _liveMembers[m.uid] || null;
                  const isOff    = _isOffDayToday(m.uid);

                  const cells = weekDays.map(day => {
                    let mins = 0, hasData = false;
                    if (m.isMe) {
                      mins    = mbd[day.key] || 0;
                      hasData = true;
                    } else if (day.isToday && lm) {
                      // Today: live elapsedTimeToday from Firestore member doc
                      const baseMins = (lm.dateKey === day.key ? (lm.elapsedTimeToday || 0) : 0);
                      const liveMins = lm.isStudying && lm.studyStartedAt
                        ? Math.floor((Date.now() - lm.studyStartedAt) / 1000 / 60) : 0;
                      mins    = baseMins + liveMins;
                      hasData = lm.dateKey === day.key; // only trust if dateKey matches today
                    }
                    const status = _attStatus(mins, day.isFuture, hasData, required, isOff && day.isToday);
                    return statusCell(status, day.isToday, mins, required);
                  }).join('');

                  return `
                    <div class="sr-att-member-row">
                      <div class="sr-att-mem-col sr-att-mem-info-col">
                        <div class="sr-att-member-av" style="background:${_avatarColor(rawName)}">${rawName[0].toUpperCase()}</div>
                        <div class="sr-att-member-name">${esc(dispName)}${m.isMe ? '<span class="sr-att-you">you</span>' : ''}</div>
                      </div>
                      ${cells}
                    </div>`;
                }).join('')}
          </div>
        </div>

        <div class="sr-att-legend">
          <span class="sr-att-legend-item"><span class="sr-att-legend-dot sr-att-legend-dot--present"></span>Present</span>
          <span class="sr-att-legend-item"><span class="sr-att-legend-dot sr-att-legend-dot--missed"></span>Missed</span>
          <span class="sr-att-legend-item"><span class="sr-att-legend-dot sr-att-legend-dot--offday"></span>Off Day</span>
          <span class="sr-att-legend-item sr-att-legend-req">Min: ${required >= 60 ? Math.round(required/60*10)/10 + 'h' : required + 'm'}/day</span>
        </div>

        <div class="sr-att-summary">
          <div class="sr-att-sum-card">
            <div class="sr-att-sum-val sr-att-sum-val--green">${myPresent}</div>
            <div class="sr-att-sum-lbl">Present</div>
          </div>
          <div class="sr-att-sum-card">
            <div class="sr-att-sum-val sr-att-sum-val--red">${myMissed}</div>
            <div class="sr-att-sum-lbl">Missed</div>
          </div>
          <div class="sr-att-sum-card">
            <div class="sr-att-sum-val">${myPct}%</div>
            <div class="sr-att-sum-lbl">Rate</div>
          </div>
          <div class="sr-att-sum-card">
            <div class="sr-att-sum-val">${myStreak}🔥</div>
            <div class="sr-att-sum-lbl">Streak</div>
          </div>
        </div>

      </div>`;
  }

  function _renderSrRankings(g, sc) {
    const ms      = getMainState(), tk = todayKey();
    const members = _getGroupMembers(g);   // ← centralized realtime source
    const ft      = ui().focusStartTime?.();
    const ranked  = members.map(m => {
      let secs = 0;
      if (m.isMe) {
        const storedMins = (((ms.focusStats || {}).minutesByDate) || {})[tk] || 0;
        const elapsed    = ft ? Math.floor((Date.now() - ft) / 1000) : 0;
        secs = storedMins * 60 + elapsed;
      } else {
        // Use Firebase live data: elapsedTimeToday (mins) + live elapsed if currently studying
        const lm = _liveMembers[m.uid] || null;
        if (lm) {
          // Only count today's time — guard against stale dateKey from a previous day
          const storedSecs = (lm.dateKey === tk ? (lm.elapsedTimeToday || 0) : 0) * 60;
          const liveSecs   = lm.isStudying && lm.studyStartedAt
            ? Math.floor((Date.now() - lm.studyStartedAt) / 1000) : 0;
          secs = storedSecs + liveSecs;
        } else {
          secs = (m.todayKey === tk ? (m.todayMins || 0) : 0) * 60;
        }
      }
      return { ...m, secs };
    }).sort((a, b) => b.secs - a.secs);
    const topSecs = ranked[0]?.secs || 1;
    return `
      <div class="sr-rank-view">
        <div class="sr-section-head">Today's Rankings</div>
        ${ranked.length === 0
          ? `<div class="sr-empty-grid">No members yet.</div>`
          : ranked.map((m, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
              const pct   = Math.round((m.secs / topSecs) * 100);
              return `
                <div class="sr-rank-row${i === 0 ? ' sr-rank-first' : ''}">
                  <div class="sr-rank-medal">${medal}</div>
                  <div class="sr-rank-av" style="background:${_avatarColor(m.name||'')}">${(m.name||'?')[0].toUpperCase()}</div>
                  <div class="sr-rank-info">
                    <div class="sr-rank-name">${esc(m.name||'Unknown')}${m.isMe ? ` <span class="sr-rank-you">you</span>` : ''}${m.equippedBadge ? ` ${window._cmkBadgeHTML?.(m.equippedBadge)||''}` : ''}</div>
                    <div class="sr-rank-bar-wrap"><div class="sr-rank-bar" style="width:${pct}%"></div></div>
                  </div>
                  <div class="sr-rank-time">${_fmtSecs(m.secs)}</div>
                </div>`;
            }).join('')}
      </div>`;
  }

  function _renderSrInvite(g) {
    return `
      <div class="sr-invite-view">
        <div class="sr-invite-icon-big">${g.icon || '📚'}</div>
        <div class="sr-invite-group-name">${esc(g.name)}</div>
        <div class="sr-invite-label">Invite Code</div>
        <div class="sr-invite-code-wrap">
          <div class="sr-invite-code">${esc(g.code)}</div>
          <button class="sr-invite-copy-btn" data-sc="sr-copy-invite" data-code="${esc(g.code)}">Copy</button>
        </div>
        <div class="sr-invite-hint">Share this code with friends to invite them to the group</div>
        <div class="sr-invite-stats">
          <div class="sr-invite-stat">
            <div class="sr-invite-stat-val">${Math.max(Object.keys(_liveMembers).length, g.memberCount || 0, (g.members||[]).length)}</div>
            <div class="sr-invite-stat-lbl">Members</div>
          </div>
          <div class="sr-invite-stat">
            <div class="sr-invite-stat-val">${g.maxMembers || 50}</div>
            <div class="sr-invite-stat-lbl">Capacity</div>
          </div>
          <div class="sr-invite-stat">
            <div class="sr-invite-stat-val">${g.dailyGoalHrs || 8}h</div>
            <div class="sr-invite-stat-lbl">Daily Goal</div>
          </div>
        </div>
      </div>`;
  }

  function _renderSrChat(g, sc) {
    const myName  = _getUserDisplayName();
    const uid     = getUserId();
    const code    = g.code;
    const chatOn  = g.chatEnabled !== false;

    // Kick off Firebase subscription (idempotent)
    if (code) _subscribeChatMessages(code);
    // Start nudge listener so all members get vibrated / notified
    if (code) _subscribeNudges(code);

    // Chat disabled state — show banner and disable input for non-admins
    if (!chatOn) {
      const isRoomAdminCheck = g.ownerUid === uid || g.createdByUid === uid ||
                               (Array.isArray(g.adminUids) && g.adminUids.includes(uid)) ||
                               g.role === 'admin';
      return `
        <div class="sr-chat-view">
          <div class="sr-chat-disabled-banner">
            <span class="sr-chat-disabled-icon">🔇</span>
            <span class="sr-chat-disabled-msg">Group chat is disabled by admin</span>
          </div>
          <div class="sr-chat-messages sr-chat-messages--disabled" id="sr-chat-msgs">
            ${_renderChatMessages(code, uid, myName)}
          </div>
          <div class="sr-chat-compose sr-chat-compose--disabled">
            <div class="sr-chat-input-area">
              <input class="sr-chat-input" type="text"
                     placeholder="Chat is currently disabled" maxlength="500"
                     autocomplete="off" disabled readonly/>
              <button class="sr-chat-send-btn" disabled style="opacity:.35;cursor:not-allowed">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>`;
    }

    const replyBar = _replyTo ? `
      <div class="sr-reply-preview">
        <div class="sr-reply-line"></div>
        <div class="sr-reply-body">
          <span class="sr-reply-author">${esc(_replyTo.author)}</span>
          <span class="sr-reply-text">${esc(_replyTo.text.slice(0, 60))}${_replyTo.text.length > 60 ? '…' : ''}</span>
        </div>
        <button class="sr-preview-cancel" data-sc="sr-chat-cancel-reply">✕</button>
      </div>` : '';

    const editBar = _editMsgId ? `
      <div class="sr-edit-preview">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        <span>Editing message</span>
        <button class="sr-preview-cancel" data-sc="sr-chat-cancel-edit">✕</button>
      </div>` : '';

    // Pinned message banner — shown to all room members, live-synced via group doc
    const pinnedMsg  = g.pinnedMsg || null;
    const isRoomAdmin = g.ownerUid === uid || g.createdByUid === uid ||
                        (Array.isArray(g.adminUids) && g.adminUids.includes(uid)) ||
                        g.role === 'admin';
    const pinnedBanner = pinnedMsg ? `
      <div class="sr-pinned-banner" data-sc="sr-goto-pin" data-code="${esc(code)}" data-mid="${esc(pinnedMsg.id)}">
        <div class="sr-pinned-icon">📌</div>
        <div class="sr-pinned-body">
          <div class="sr-pinned-label">Pinned by ${esc(pinnedMsg.pinnedBy || 'Admin')}</div>
          <div class="sr-pinned-text">${esc((pinnedMsg.text || '').slice(0, 50))}${(pinnedMsg.text||'').length > 50 ? '…' : ''}</div>
        </div>
        ${isRoomAdmin ? `<button class="sr-pinned-unpin" data-sc="sr-chat-unpin" data-code="${esc(code)}">✕</button>` : ''}
      </div>` : '';

    return `
      <div class="sr-chat-view">
        ${pinnedBanner}
        <div class="sr-chat-messages" id="sr-chat-msgs">
          ${_renderChatMessages(code, uid, myName)}
        </div>
        <div class="sr-chat-compose">
          ${replyBar}${editBar}
          <div class="sr-chat-input-area">
            <input class="sr-chat-input" id="sr-chat-input" type="text" placeholder="Type a message…"
                   maxlength="500" autocomplete="off"/>
            <button class="sr-chat-send-btn" data-sc="sr-send-chat" data-gid="${esc(g.id)}" data-code="${esc(code)}" data-author="${esc(myName)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  function _chatTimeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts, m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────
  function _lbAvatar(name, id, size) {
    const initial = (name || '?').charAt(0).toUpperCase();
    const color   = _avatarColor(name || id || '');
    const sz = size || 38;
    return `<div class="sc-glb-avatar" style="background:${color};width:${sz}px;height:${sz}px;font-size:${Math.round(sz*0.38)}px">${initial}</div>`;
  }

  function _lbAvatarLabel(avS) {
    const avLabels = window._lsAvLabels || ['IDLE','FOCUSED','STUDYING','DEEP STUDY','SCHOLAR','SAGE','WARRIOR','BLAZING','INFERNO','LEGENDARY'];
    const cls = avS >= 9 ? 'sr-av-pill--legend' : avS >= 6 ? 'sr-av-pill--fire' : avS >= 3 ? 'sr-av-pill--warm' : 'sr-av-pill--dim';
    return `<span class="sr-av-pill ${cls}">${avLabels[Math.max(0, avS)]}</span>`;
  }

  // Podium rank config: platformH, avatarSize, baseClass, rankBadgeClass, crown
  const _PODIUM_CFG = {
    1: { h: 90,  av: 58, rankCls: 'sc-lb-podium-rank--gold',   baseCls: 'sc-lb-pbase--gold',   crown: '👑' },
    2: { h: 68,  av: 46, rankCls: 'sc-lb-podium-rank--silver', baseCls: 'sc-lb-pbase--silver', crown: '' },
    3: { h: 50,  av: 44, rankCls: 'sc-lb-podium-rank--bronze', baseCls: 'sc-lb-pbase--bronze', crown: '' },
  };
  const _PODIUM_MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

  function _renderPodiumSlot(u, rank, uid, uTime) {
    if (!u) return '';
    const cfg     = _PODIUM_CFG[rank];
    const isMe    = !!(uid && u.id === uid);
    const avS     = typeof u.avatarStage === 'number' ? u.avatarStage : 0;
    const studying = u.isStudying === true;
    const nameStr = esc((u.name || 'Studier').split(' ')[0]);
    const youTag  = isMe ? ' <span class="sc-glb-you-tag">YOU</span>' : '';
    const liveTag = studying ? ' <span class="sc-lb-live-dot">●</span>' : '';
    const liveRing = studying ? '<div class="sc-lb-studying-pulse"></div>' : '';
    const streakBadge = (u.streak || 0) > 1 ? `<div class="sc-lb-podium-streak">${u.streak}🔥</div>` : '';
    return `<div class="sc-lb-pslot sc-lb-pslot--${rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze'}${isMe ? ' sc-lb-pslot--me' : ''}">
      <div class="sc-lb-pcrown${cfg.crown ? '' : ' sc-lb-pcrown--empty'}">${cfg.crown}</div>
      <div class="sc-lb-pcontent">
        <div class="sc-lb-podium-avatar-wrap">
          ${_lbAvatar(u.name, u.id, cfg.av)}
          <div class="sc-lb-podium-rank ${cfg.rankCls}">${rank}</div>
          ${liveRing}
        </div>
        <div class="sc-lb-podium-name">${nameStr}${youTag}${liveTag}</div>
        <div class="sc-lb-podium-time">${minsToHrs(uTime)}</div>
        ${avS > 0 ? _lbAvatarLabel(avS) : ''}
        ${streakBadge}
      </div>
      <div class="sc-lb-pbase ${cfg.baseCls}" style="height:${cfg.h}px">
        <span class="sc-lb-pbase-medal">${_PODIUM_MEDALS[rank]}</span>
      </div>
    </div>`;
  }

  function _renderLbPodium(top3, uid, period) {
    const uTime   = u => period === 'daily' ? (u.dailyStudyTime || 0) : (u.weeklyStudyTime || 0);
    const valid   = (top3 || []).filter(u => u && u.id && uTime(u) > 0);
    if (valid.length === 0) return '';

    if (valid.length === 1) {
      return `<div class="sc-lb-podium sc-lb-podium--solo">
        ${_renderPodiumSlot(valid[0], 1, uid, uTime(valid[0]))}
      </div>`;
    }

    // Visual order: 2nd (left), 1st (center), 3rd (right)
    const order = valid.length === 2
      ? [[valid[1], 2], [valid[0], 1]]
      : [[valid[1], 2], [valid[0], 1], [valid[2], 3]];

    return `<div class="sc-lb-podium">
      ${order.map(([u, rank]) => _renderPodiumSlot(u, rank, uid, uTime(u))).join('')}
    </div>`;
  }

  function _renderLbRow(u, rank, uid, period, delta) {
    const uTime    = period === 'daily' ? (u.dailyStudyTime || 0) : (u.weeklyStudyTime || 0);
    const isMe     = uid && u.id === uid;
    const avS      = typeof u.avatarStage === 'number' ? u.avatarStage : 0;
    const studying = u.isStudying === true;
    const uStreak  = u.streak   || 0;
    let deltaHtml = '';
    if (delta > 0)      deltaHtml = `<span class="sc-lb-delta sc-lb-delta--up">▲${delta}</span>`;
    else if (delta < 0) deltaHtml = `<span class="sc-lb-delta sc-lb-delta--dn">▼${Math.abs(delta)}</span>`;
    else                deltaHtml = `<span class="sc-lb-delta sc-lb-delta--same">—</span>`;
    return `<div class="sc-glb-row${isMe ? ' sc-glb-row--me' : ''}${studying ? ' sc-glb-row--studying' : ''}">
      <div class="sc-glb-rank"><span class="sc-glb-rank-num">#${rank}</span></div>
      <div class="sc-glb-avatar-wrap">
        ${_lbAvatar(u.name, u.id, 36)}
        ${studying ? '<div class="sc-glb-studying-ring"></div>' : ''}
      </div>
      <div class="sc-glb-info">
        <div class="sc-glb-name">${esc(u.name || 'Studier')}${isMe ? ' <span class="sc-glb-you-tag">you</span>' : ''}${studying ? ' <span class="sc-lb-live-dot">●</span>' : ''}</div>
        <div class="sc-lb-row-sub">${avS > 0 ? _lbAvatarLabel(avS) : ''}${uStreak > 0 ? ` <span class="sc-lb-streak-chip">${uStreak}🔥</span>` : ''}</div>
      </div>
      ${deltaHtml}
      <div class="sc-glb-time">${minsToHrs(uTime)}</div>
    </div>`;
  }

  // Format "Updated X ago" label
  function _lbUpdatedAgo() {
    if (!_lbLastUpdated) return '';
    const secs = Math.floor((Date.now() - _lbLastUpdated) / 1000);
    if (secs < 10)  return 'Updated just now';
    if (secs < 60)  return `Updated ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60)  return `Updated ${mins}m ago`;
    return `Updated ${Math.floor(mins/60)}h ago`;
  }

  function _renderLeaderboard() {
    const ms          = getMainState();
    const mins        = (ms.focusStats || {}).minutesByDate || {};
    const today       = todayKey();
    const todayMins   = mins[today] || 0;
    const weekMins    = _weekMinsLocal();
    const displayMins = _lbPeriod === 'daily' ? todayMins : weekMins;
    const studying    = isStudying();
    const uid         = getUserId();
    const weekStartKey = _weekStart();
    const goal        = _lbPeriod === 'daily' ? 480 : 3360;
    const goalLabel   = _lbPeriod === 'daily' ? '8h / day (Fri–Thu)' : '56h / week (Fri–Thu)';
    const streak      = ms.streak?.count ?? ms.streak?.current ?? ms.currentStreak ?? 0;
    const sessions    = ms.focusStats?.sessions?.[today] ?? 0;

    // Start real-time subscriptions (idempotent, handles midnight rollover)
    _subscribeGlobalLb();

    // ── Pick dataset for current period ──────────────────────────────────────
    const rawData = _lbPeriod === 'daily' ? _globalLbDailyData : _globalLbWeeklyData;

    // ── Dedup + validate ──────────────────────────────────────────────────────
    const seen = new Set();
    const rawFiltered = rawData.filter(u => {
      if (!u || !u.id || typeof u.id !== 'string') return false;
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      if (!u.name || typeof u.name !== 'string' || u.name.trim() === '') return false;
      const time = _lbPeriod === 'daily' ? (u.dailyStudyTime || 0) : (u.weeklyStudyTime || 0);
      return time > 0;
    });

    // ── Inject current user if missing from server data ───────────────────────
    const currentUserInList = uid ? rawFiltered.some(u => u.id === uid) : true;
    if (uid && !currentUserInList && displayMins > 0) {
      const userName = _getUserDisplayName();
      rawFiltered.push({
        id:              uid,
        name:            userName,
        dailyStudyTime:  todayMins,
        dailyResetDate:  today,
        weeklyStudyTime: weekMins,
        weeklyResetDate: weekStartKey,
        lastActive:      today,
        avatarStage:     window._lsGetCurrentAvStage?.() || 0,
        isStudying:      studying,
        streak:          streak,
        sessions:        sessions,
        _local:          true,
      });
    } else if (uid && studying) {
      const idx = rawFiltered.findIndex(u => u.id === uid);
      if (idx >= 0 && !rawFiltered[idx].isStudying) {
        rawFiltered[idx] = { ...rawFiltered[idx], isStudying: true };
      }
    }

    // ── Sort: time → sessions → streak → id (stable) ─────────────────────────
    const getTime     = u => _lbPeriod === 'daily' ? (u.dailyStudyTime || 0) : (u.weeklyStudyTime || 0);
    const allSorted = rawFiltered.sort((a, b) => {
      const tDiff = getTime(b) - getTime(a);
      if (tDiff !== 0) return tDiff;
      const sDiff = (b.sessions || 0) - (a.sessions || 0);
      if (sDiff !== 0) return sDiff;
      const stDiff = (b.streak || 0) - (a.streak || 0);
      if (stDiff !== 0) return stDiff;
      return (a.id || '').localeCompare(b.id || '');
    });

    const myRankIdx   = uid ? allSorted.findIndex(u => u.id === uid) : -1;
    const myRank      = myRankIdx >= 0 ? myRankIdx + 1 : 0;
    const progPct     = Math.min(100, (displayMins / goal) * 100).toFixed(1);

    // ── Rank deltas ───────────────────────────────────────────────────────────
    const deltas = {};
    allSorted.forEach((u, i) => { deltas[u.id] = _lbRankDelta(u.id, i + 1); });
    _lbSaveRanks(allSorted);

    setTimeout(_startLbLive, 80);

    const top100  = allSorted.slice(0, 100);
    const top3    = top100.slice(0, 3);
    const rest    = top100.slice(3);

    const myRankPill = myRank > 0
      ? `<div class="sc-lb-you-rank-pill">${myRank === 1 ? '👑' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : ''}#${myRank}</div>`
      : `<div class="sc-lb-you-rank-pill sc-lb-you-rank-pill--none">Unranked</div>`;

    // "Your rank" section if outside top 100
    const myEntry = (myRank > 100 && myRankIdx >= 0) ? allSorted[myRankIdx] : null;
    const myRankFooter = myEntry ? `
      <div class="sc-lb-myrank-section">
        <div class="sc-lb-myrank-label">YOUR RANK</div>
        <div class="sc-glb-row sc-glb-row--me sc-lb-myrank-row">
          <div class="sc-glb-rank"><span class="sc-glb-rank-num">#${myRank}</span></div>
          <div class="sc-glb-avatar-wrap">${_lbAvatar(myEntry.name, myEntry.id, 36)}</div>
          <div class="sc-glb-info">
            <div class="sc-glb-name">${esc(myEntry.name || 'You')} <span class="sc-glb-you-tag">you</span></div>
            <div class="sc-lb-row-sub">${sessions} session${sessions !== 1 ? 's' : ''}${streak > 0 ? ` <span class="sc-lb-streak-chip">${streak}🔥</span>` : ''}</div>
          </div>
          <div class="sc-glb-time">${minsToHrs(displayMins)}</div>
        </div>
        <div class="sc-lb-myrank-hint">Keep going to reach the Top 100! 🚀</div>
      </div>` : '';

    // Skeleton rows while loading
    const skeletonRows = _lbLoading && top100.length === 0 ? `
      <div class="sc-lb-skeleton-wrap">
        ${[1,2,3].map(i => `<div class="sc-lb-skel-podium sc-lb-skel-podium--${i}"></div>`).join('')}
        ${[1,2,3,4,5].map(() => `<div class="sc-lb-skel-row"><div class="sc-lb-skel-av"></div><div class="sc-lb-skel-lines"><div class="sc-lb-skel-line sc-lb-skel-line--wide"></div><div class="sc-lb-skel-line sc-lb-skel-line--narrow"></div></div><div class="sc-lb-skel-time"></div></div>`).join('')}
      </div>` : '';

    const updatedLabel = _lbLastUpdated ? `<span class="sc-lb-updated" id="sc-lb-updated">${_lbUpdatedAgo()}</span>` : `<span class="sc-lb-updated sc-lb-updated--live">● Live</span>`;

    return `
      <div class="sc-section sc-lb-global">

        <div class="sc-lb-header-row">
          <div class="sc-lb-title-col">
            <span class="sc-section-title">🏆 Rankings</span>
            ${updatedLabel}
          </div>
          <div class="sc-lb-period-tabs">
            <button class="sc-lb-tab-btn${_lbPeriod==='daily'?' sc-lb-tab-active':''}" data-sc="lb-period" data-period="daily">Daily</button>
            <button class="sc-lb-tab-btn${_lbPeriod==='weekly'?' sc-lb-tab-active':''}" data-sc="lb-period" data-period="weekly">Weekly</button>
          </div>
        </div>

        <div class="sc-lb-you-card">
          <div class="sc-lb-you-inner">
            <div class="sc-lb-you-left">
              <div class="sc-lb-you-label">YOUR ${_lbPeriod==='daily'?'TODAY':'THIS WEEK'}</div>
              <div class="sc-lb-you-time" data-lb-live="time">${minsToHrs(displayMins)}</div>
              <div class="sc-lb-you-meta">
                ${studying ? `<div class="sc-lb-studying-badge" data-lb-live="studying">● Live</div>` : `<div class="sc-lb-studying-badge" data-lb-live="studying" style="display:none">● Live</div>`}
                <div class="sc-lb-you-sessions">${sessions} session${sessions !== 1 ? 's' : ''} · ${streak > 0 ? `${streak}🔥` : 'No streak'}</div>
              </div>
            </div>
            ${myRankPill}
          </div>
          <div class="sc-lb-progress-wrap">
            <div class="sc-lb-progress-bar" data-lb-live="progress" style="width:${progPct}%"></div>
          </div>
          <div class="sc-lb-goal-row">
            <span class="sc-lb-goal-label">Goal: ${goalLabel}</span>
            <span class="sc-lb-goal-pct">${progPct}%</span>
          </div>
        </div>

        ${skeletonRows}

        ${!skeletonRows && top100.length === 0 ? `
          <div class="sc-lb-empty">
            <div class="sc-lb-empty-icon">${_lbPeriod === 'daily' ? '📅' : '📆'}</div>
            <div class="sc-lb-empty-title">No ${_lbPeriod === 'daily' ? 'daily' : 'weekly'} rankings yet</div>
            <div class="sc-lb-empty-sub">Complete a focus session to appear on the leaderboard!</div>
            <button class="sc-lb-retry-btn" data-sc="lb-retry">Retry</button>
          </div>
        ` : ''}

        ${top100.length > 0 ? `
          ${top3.length > 0 ? _renderLbPodium(top3, uid, _lbPeriod) : ''}

          ${rest.length > 0 ? `
            <div class="sc-glb-section">
              <div class="sc-glb-header">
                <span class="sc-block-title">Top ${top100.length}</span>
                <span class="sc-glb-count">${top100.length} studier${top100.length !== 1 ? 's' : ''}</span>
              </div>
              ${rest.map((u, i) => _renderLbRow(u, i + 4, uid, _lbPeriod, deltas[u.id] || 0)).join('')}
            </div>
          ` : ''}
        ` : ''}

        ${myRankFooter}

        <div class="sc-lb-stats-section">
          <div class="sc-block-title sc-lb-stats-title">Your Stats</div>
          <div class="sc-stats-grid">
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${minsToHrs(todayMins)}</div>
              <div class="sc-stat-label">Today</div>
            </div>
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${minsToHrs(weekMins)}</div>
              <div class="sc-stat-label">This Week</div>
            </div>
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${streak > 0 ? streak + '🔥' : '—'}</div>
              <div class="sc-stat-label">Streak</div>
            </div>
          </div>
        </div>

      </div>`;
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  function _renderTasks() {
    const sc = scLoad();
    const personal = sc.tasks.filter(t => !t.groupId);

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Tasks</span>
          <button class="sc-icon-btn" data-sc="add-task" data-gid="">${ICON.plus}</button>
        </div>
        <div class="sc-tasks-group">
          <div class="sc-tasks-label">Personal (${personal.filter(t=>!t.done).length} pending)</div>
          ${personal.length === 0
            ? `<div class="sc-empty-mini">No tasks yet — tap + to add one.</div>`
            : personal.map(_taskRow).join('')}
          <button class="sc-add-inline-btn" data-sc="add-task" data-gid="">${ICON.plus} Add personal task</button>
        </div>
        ${sc.groups.map(g => {
          const gt = sc.tasks.filter(t => t.groupId === g.id);
          return `
            <div class="sc-tasks-group">
              <div class="sc-tasks-label">${esc(g.icon||'📚')} ${esc(g.name)} (${gt.filter(t=>!t.done).length} pending)</div>
              ${gt.length === 0 ? `<div class="sc-empty-mini">No group tasks yet.</div>` : gt.map(_taskRow).join('')}
              <button class="sc-add-inline-btn" data-sc="add-task" data-gid="${esc(g.id)}">${ICON.plus} Add group task</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function _taskRow(t) {
    return `
      <div class="sc-task-row${t.done?' sc-task-done':''}">
        <button class="sc-task-check${t.done?' sc-checked':''}" data-sc="toggle-task" data-tid="${esc(t.id)}">${t.done?ICON.check:''}</button>
        <span class="sc-task-text">${esc(t.title)}</span>
        ${t.dueDate ? `<span class="sc-task-due">${esc(t.dueDate)}</span>` : ''}
        <button class="sc-task-del" data-sc="delete-task" data-tid="${esc(t.id)}">${ICON.trash}</button>
      </div>`;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  function _renderNotes() {
    const sc = scLoad();
    const personal = sc.notes.filter(n => !n.groupId);
    if (personal.length === 0 && sc.groups.every(g => sc.notes.filter(n => n.groupId === g.id).length === 0)) {
      return `
        <div class="sc-empty-state">
          <div class="sc-empty-icon">📝</div>
          <div class="sc-empty-title">No Notes Yet</div>
          <div class="sc-empty-sub">Jot down formulas, ideas, and revision notes.</div>
          <button class="sc-btn sc-btn-primary" data-sc="add-note" data-gid="">${ICON.plus} Add First Note</button>
        </div>`;
    }
    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Notes</span>
          <button class="sc-icon-btn" data-sc="add-note" data-gid="">${ICON.plus}</button>
        </div>
        <div class="sc-notes-group">
          <div class="sc-tasks-label">Personal (${personal.length})</div>
          ${personal.length === 0 ? `<div class="sc-empty-mini">No personal notes yet.</div>` : personal.map(_noteCard).join('')}
          <button class="sc-add-inline-btn" data-sc="add-note" data-gid="">${ICON.plus} Add note</button>
        </div>
        ${sc.groups.map(g => {
          const gn = sc.notes.filter(n => n.groupId === g.id);
          return `
            <div class="sc-notes-group">
              <div class="sc-tasks-label">${esc(g.icon||'📚')} ${esc(g.name)}</div>
              ${gn.length === 0 ? `<div class="sc-empty-mini">No group notes yet.</div>` : gn.map(_noteCard).join('')}
              <button class="sc-add-inline-btn" data-sc="add-note" data-gid="${esc(g.id)}">${ICON.plus} Add group note</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  function _noteCard(n) {
    const preview = (n.content||'').slice(0,140) + ((n.content||'').length > 140 ? '…' : '');
    return `
      <div class="sc-note-card">
        <div class="sc-note-top">
          <div class="sc-note-title">${esc(n.title||'Untitled')}</div>
          <div class="sc-note-actions">
            <button class="sc-note-btn" data-sc="edit-note" data-nid="${esc(n.id)}">${ICON.edit}</button>
            <button class="sc-note-btn sc-note-del" data-sc="delete-note" data-nid="${esc(n.id)}">${ICON.trash}</button>
          </div>
        </div>
        ${preview ? `<div class="sc-note-body">${esc(preview)}</div>` : ''}
      </div>`;
  }

  // ── Modals ────────────────────────────────────────────────────────────────
  const ICONS_LIST = ['📚','🎯','⚡','🔥','🚀','🧠','💡','🌟','🎓','💪','🏆','✨','🎨','🔬','🧪','📖'];
  const CATEGORIES = ['General','Exams','Subject','Productivity','Challenge'];

  function _modalCreateGroup() {
    let selectedIcon = '📚';
    let selectedCat  = 'General';

    const iconBtns = ICONS_LIST.map(ic =>
      `<button class="sc-icon-pick${ic===selectedIcon?' sc-icon-active':''}" data-icon="${ic}" type="button">${ic}</button>`
    ).join('');

    const catChips = CATEGORIES.map(c =>
      `<button class="sc-cat-chip-pick${c===selectedCat?' sc-cat-chip-active':''}" data-cat="${c}" type="button">${c}</button>`
    ).join('');

    openModal(`
      <h3 class="sc-modal-title">Create Study Group</h3>
      <div class="sc-field">
        <label class="sc-label">Group Name</label>
        <input id="sc-grp-name" type="text" maxlength="40" placeholder="e.g. Global SAT Prep 2026" class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Category</label>
        <div id="sc-cat-chips" class="sc-cat-chips-row">${catChips}</div>
      </div>
      <div class="sc-field sc-field-row">
        <div style="flex:1;min-width:0">
          <label class="sc-label">Daily Goal (hrs)</label>
          <input id="sc-grp-goal" type="number" min="1" max="24" value="8" class="sc-input" style="text-align:center"/>
        </div>
        <div style="flex:1;min-width:0">
          <label class="sc-label">Max Members</label>
          <input id="sc-grp-max" type="number" min="2" max="500" value="50" class="sc-input" style="text-align:center"/>
        </div>
      </div>
      <div class="sc-field">
        <label class="sc-label">Description <span class="sc-opt">(optional)</span></label>
        <input id="sc-grp-desc" type="text" maxlength="100" placeholder="What are you studying?" class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Icon</label>
        <div id="sc-icon-grid" class="sc-icon-grid">${iconBtns}</div>
      </div>
      <div class="sc-field sc-checkboxes-stack">
        <label class="sc-checkbox-row" style="margin-top:0">
          <input id="sc-grp-private" type="checkbox" class="sc-checkbox"/>
          <span>🔒 Private (invite only)</span>
        </label>
      </div>
      <div id="sc-grp-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-create">Create Group</button>
      </div>
    `, root => {
      const nameEl   = root.querySelector('#sc-grp-name');
      const descEl   = root.querySelector('#sc-grp-desc');
      const goalEl   = root.querySelector('#sc-grp-goal');
      const maxEl    = root.querySelector('#sc-grp-max');
      const privEl   = root.querySelector('#sc-grp-private');
      const errEl    = root.querySelector('#sc-grp-err');
      const submitEl = root.querySelector('#sc-do-create');
      nameEl.focus();

      root.querySelector('#sc-icon-grid').addEventListener('click', e => {
        const btn = e.target.closest('.sc-icon-pick');
        if (!btn) return;
        selectedIcon = btn.dataset.icon;
        root.querySelectorAll('.sc-icon-pick').forEach(b => b.classList.toggle('sc-icon-active', b.dataset.icon === selectedIcon));
      });

      root.querySelector('#sc-cat-chips').addEventListener('click', e => {
        const btn = e.target.closest('.sc-cat-chip-pick');
        if (!btn) return;
        selectedCat = btn.dataset.cat;
        root.querySelectorAll('.sc-cat-chip-pick').forEach(b => b.classList.toggle('sc-cat-chip-active', b.dataset.cat === selectedCat));
      });

      const doCreate = () => {
        const name = nameEl.value.trim();
        if (!name) { errEl.textContent = 'Please enter a group name.'; errEl.style.display = ''; return; }
        const sc = scLoad();
        const myName = _getUserDisplayName();
        const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
        if (!uid_) { errEl.textContent = 'You must be signed in to create a group.'; errEl.style.display = ''; return; }
        const newGroup = {
          id: genId(), name, icon: selectedIcon,
          code: genCode(), isPrivate: privEl.checked,
          description: descEl.value.trim(),
          category:     selectedCat,
          dailyGoalHrs: Math.max(1, Math.min(24, parseInt(goalEl.value)||8)),
          maxMembers:   Math.max(2, Math.min(500, parseInt(maxEl.value)||50)),
          leader:       myName,
          promoted:     false,
          createdAt:    Date.now(),
          dailyMinsTotal: 0,
          attendancePct:  0,
          role:         'admin',
          createdByUid: uid_,
          ownerUid:     uid_,
          admins:       [uid_],
          members: [{ id: uid_, name: myName, role: 'admin', joinedAt: Date.now() }],
        };
        sc.groups.push(newGroup);
        scSave(sc);

        // Persist to Firebase so other users can discover and join
        if (db_ && uid_ && fb_) {
          db_.collection('groups').doc(newGroup.code).set({
            groupId:       newGroup.id,
            code:          newGroup.code,
            name:          newGroup.name,
            icon:          newGroup.icon,
            description:   newGroup.description || '',
            category:      newGroup.category || 'General',
            dailyGoalHrs:  newGroup.dailyGoalHrs || 8,
            maxMembers:    newGroup.maxMembers || 50,
            joinMode:      'open',
            isPrivate:     !!newGroup.isPrivate,
            leader:        myName,
            createdAt:     fb_.firestore.FieldValue.serverTimestamp(),
            createdBy:     uid_,
            createdByUid:  uid_,
            createdByName: myName,
            ownerUid:      uid_,
            admins:        [uid_],
            memberCount:   1,
            dailyMinsTotal: 0,
          }).catch(() => {});
          const _crtTodayMins = (((getMainState().focusStats || {}).minutesByDate) || {})[todayKey()] || 0;
          db_.collection('groups').doc(newGroup.code).collection('members').doc(uid_).set({
            uid: uid_, displayName: myName, role: 'admin',
            joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
            isStudying: false, currentSubject: null,
            elapsedTimeToday: _crtTodayMins,
            dateKey: todayKey(),
          }).catch(() => {});
          db_.collection('users').doc(uid_).set({
            joinedRooms:     fb_.firestore.FieldValue.arrayUnion(newGroup.code),
            displayNameAuto: myName,
          }, { merge: true }).catch(() => {});
        }

        closeModal();
        toast(`"${name}" created! 🎉`, 'success');
        _tab = 'rooms';
        renderSocial();
      };

      submitEl.addEventListener('click', doCreate);
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
    });
  }

  // ── Shared join helpers ────────────────────────────────────────────────────

  // Common Firestore + local write when actually adding a user to a group.
  // Called only after all validation passes (password, approval, capacity).
  function _doJoinGroupWithData(code, data) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    const myName = _getUserDisplayName();
    const rawCat = data.category || 'General';
    const sc2 = scLoad();
    if (!sc2.groups.find(g => g.code === code)) {
      sc2.groups.push({
        id:           data.groupId || data.id || code,
        name:         data.name || `Group ${code}`,
        icon:         data.icon || '📚',
        code:         data.code || code,
        isPrivate:    data.isPrivate || false,
        description:  data.description || '',
        category:     rawCat === 'camstudy' ? 'General' : rawCat,
        dailyGoalHrs: data.dailyGoalHrs || 8,
        maxMembers:   data.maxMembers || 50,
        leader:       (data.leader && data.leader !== 'You') ? data.leader : (data.createdByName || 'Admin'),
        promoted:     false,
        createdAt:    data.createdAt?.toMillis?.() ?? (typeof data.createdAt === 'number' ? data.createdAt : Date.now()),
        dailyMinsTotal: 0, attendancePct: 0,
        role:    'member',
        members: [{ id: uid_ || 'me', name: myName, role: 'member', joinedAt: Date.now() }],
      });
      scSave(sc2);
    }
    if (db_ && uid_ && fb_) {
      const mRef = db_.collection('groups').doc(code).collection('members').doc(uid_);
      const gRef = db_.collection('groups').doc(code);
      const todayMins = (((getMainState().focusStats || {}).minutesByDate) || {})[todayKey()] || 0;
      db_.runTransaction(t => t.get(mRef).then(memberSnap => {
        if (!memberSnap.exists) {
          t.set(mRef, {
            uid: uid_, displayName: myName, role: 'member',
            joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
            isStudying: false, currentSubject: null,
            elapsedTimeToday: todayMins,
            dateKey: todayKey(),
          });
          t.update(gRef, { memberCount: fb_.firestore.FieldValue.increment(1) });
        } else {
          t.update(mRef, { displayName: myName, elapsedTimeToday: todayMins, dateKey: todayKey() });
        }
      })).then(() => _recalcMemberCount(code)).catch(() => {});
      db_.collection('users').doc(uid_).set({
        joinedRooms:     fb_.firestore.FieldValue.arrayUnion(code),
        displayNameAuto: myName,
      }, { merge: true }).catch(() => {});
    }
    setTimeout(_ensureGroupDocSubs, 300);
    // Start self-kick detection for the newly joined group
    setTimeout(() => _subscribeSelfMembership(code), 500);
  }

  // Offline fallback: adds group locally when Firestore is unavailable
  function _doLocalFallbackJoin(code) {
    const sc2 = scLoad();
    if (sc2.groups.find(g => g.code === code)) return;
    const myName = _getUserDisplayName();
    const uid2   = getUserId();
    sc2.groups.push({
      id: genId(), name: `Group ${code}`, icon: '📚',
      code, isPrivate: false, description: '',
      category: 'General', dailyGoalHrs: 8, maxMembers: 50,
      leader: 'Admin', promoted: false,
      createdAt: Date.now(), dailyMinsTotal: 0, attendancePct: 0,
      role: 'member',
      members: [{ id: uid2 || 'me', name: myName, role: 'member', joinedAt: Date.now() }],
    });
    scSave(sc2);
    closeModal();
    toast('Group joined (offline mode)', 'success');
    _tab = 'rooms';
    renderSocial();
  }

  // Shows an approval-request modal for groups that require admin sign-off.
  function _modalRequestApproval(code, data) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!uid_) { toast('Sign in to join groups', 'warn'); return; }

    // Check if already pending → show cancel option instead
    const alreadyPending = _myPendingGroups[code] && _myPendingGroups[code].status === 'pending';
    if (alreadyPending) {
      openModal(`
        <div style="text-align:center;padding:8px 0 12px">
          <div style="font-size:36px;margin-bottom:10px">⏳</div>
          <h3 class="sc-modal-title" style="margin-bottom:6px">Request Pending</h3>
          <p class="sc-modal-sub">Your request to join <strong>"${esc(data.name || code)}"</strong> is awaiting admin approval.</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:8px">You'll be notified once the admin reviews your request.</p>
        </div>
        <div class="actions" style="margin-top:16px;flex-direction:column;gap:8px">
          <button class="btn sc-modal-submit" data-close>OK, I'll wait</button>
          <button class="btn btn-ghost" id="sc-cancel-req" style="color:#ef4444;font-size:13px">Cancel my request</button>
        </div>
      `, root => {
        root.querySelector('#sc-cancel-req').addEventListener('click', () => {
          closeModal(); _cancelJoinRequest(code);
        });
      });
      return;
    }

    const hasQuestion = !!(data.joinQuestion && data.joinQuestion.trim());
    openModal(`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:28px">⏳</span>
        <div>
          <h3 class="sc-modal-title" style="margin:0">Request to Join</h3>
          <p class="sc-modal-sub" style="margin:2px 0 0">"${esc(data.name || code)}" needs admin approval</p>
        </div>
      </div>
      ${hasQuestion ? `
        <div class="sc-field">
          <label class="sc-label">${esc(data.joinQuestion)} <span style="color:#ef4444">*</span></label>
          <textarea id="sc-req-msg" rows="3" maxlength="200" class="sc-textarea"
                    placeholder="Your answer…" style="margin-top:6px"></textarea>
        </div>
      ` : `
        <div class="sc-field">
          <label class="sc-label">Message to admin <span class="sc-opt">(optional)</span></label>
          <input id="sc-req-msg" type="text" maxlength="120"
                 placeholder="e.g. Hey, I'd love to join your study group!"
                 class="sc-input" autocomplete="off"/>
        </div>
      `}
      <div id="sc-req-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-req">Send Request</button>
      </div>
    `, root => {
      const msgEl    = root.querySelector('#sc-req-msg');
      const errEl    = root.querySelector('#sc-req-err');
      const submitEl = root.querySelector('#sc-do-req');
      if (msgEl) msgEl.focus();
      const send = () => {
        const msgVal = (msgEl?.value || '').trim();
        if (hasQuestion && !msgVal) {
          errEl.textContent = 'Please answer the question above.';
          errEl.style.display = ''; msgEl?.focus(); return;
        }
        submitEl.disabled = true; submitEl.textContent = 'Sending…';
        const myName = _getUserDisplayName();
        if (!db_ || !uid_ || !fb_) {
          errEl.textContent = 'Not connected — please try again when online.';
          errEl.style.display = ''; submitEl.disabled = false; submitEl.textContent = 'Send Request'; return;
        }
        const reqRef = db_.collection('groups').doc(code).collection('joinRequests').doc(uid_);
        reqRef.get().then(existing => {
          if (existing.exists && existing.data().status === 'pending') {
            errEl.textContent = 'You already have a pending request for this group.';
            errEl.style.display = ''; submitEl.disabled = false; submitEl.textContent = 'Send Request'; return;
          }
          return reqRef.set({
            uid: uid_, displayName: myName,
            message: msgVal, groupName: data.name || code,
            status: 'pending',
            requestedAt: fb_.firestore.FieldValue.serverTimestamp(),
          }).then(() => {
            // Track pending request locally so UI can reflect it immediately
            const pendingEntry = { status: 'pending', groupName: data.name || code, requestedAt: Date.now() };
            _myPendingGroups[code] = pendingEntry;
            const sc_ = scLoad(); sc_.pendingRequests[code] = pendingEntry; scSave(sc_);
            // Subscribe for status updates
            if (!_pendingReqUnsubs[code]) {
              _pendingReqUnsubs[code] = db_.collection('groups').doc(code)
                .collection('joinRequests').doc(uid_)
                .onSnapshot(snap => {
                  const d_ = snap.data();
                  if (!snap.exists || !d_) {
                    delete _myPendingGroups[code]; const s2 = scLoad(); delete s2.pendingRequests[code]; scSave(s2);
                    if (!_destroyed) _scheduleRender(); return;
                  }
                  const status_ = d_.status || 'pending';
                  const prev_   = _myPendingGroups[code];
                  _myPendingGroups[code] = { ...(_myPendingGroups[code] || {}), status: status_, groupName: d_.groupName || data.name || code };
                  const s2 = scLoad(); s2.pendingRequests[code] = _myPendingGroups[code]; scSave(s2);
                  if (prev_ && prev_.status === 'pending' && status_ === 'approved') {
                    toast(`✅ Your request to join "${_myPendingGroups[code].groupName}" was approved! 🎉`, 'success', 5000);
                    setTimeout(() => window._socialRestoreGroups?.(), 400);
                  } else if (prev_ && prev_.status === 'pending' && status_ === 'rejected') {
                    toast(`Your request to join "${_myPendingGroups[code].groupName}" was not approved.`, 'info', 4000);
                  }
                  if (!_destroyed) _scheduleRender();
                }, () => { delete _pendingReqUnsubs[code]; });
            }
            closeModal();
            toast('✅ Request sent! We\'ll notify you when the admin responds.', 'success', 5000);
            renderSocial();
          });
        }).catch(() => {
          errEl.textContent = 'Could not send request. Check your connection.';
          errEl.style.display = ''; submitEl.disabled = false; submitEl.textContent = 'Send Request';
        });
      };
      submitEl.addEventListener('click', send);
      msgEl?.addEventListener('keydown', e => { if (e.key === 'Enter' && !hasQuestion) send(); });
    });
  }

  // Shows a password-entry modal for password-protected groups.
  function _modalEnterPassword(code, data) {
    openModal(`
      <h3 class="sc-modal-title">🔑 Enter Password</h3>
      <p class="sc-modal-sub">"${esc(data.name || code)}" is password protected.</p>
      <div class="sc-field">
        <input id="sc-pw-inp" type="password" maxlength="50" placeholder="Group password"
               class="sc-input" autocomplete="off"/>
      </div>
      <div id="sc-pw-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-pw">Join Group</button>
      </div>
    `, root => {
      const pwEl     = root.querySelector('#sc-pw-inp');
      const errEl    = root.querySelector('#sc-pw-err');
      const submitEl = root.querySelector('#sc-do-pw');
      pwEl.focus();
      const doJoin = () => {
        const entered = pwEl.value;
        if (!entered) { errEl.textContent = 'Please enter the group password.'; errEl.style.display = ''; return; }
        if (entered !== (data.joinPassword || '')) {
          errEl.textContent = 'Incorrect password. Please try again.';
          errEl.style.display = ''; pwEl.value = ''; pwEl.focus(); return;
        }
        closeModal();
        _doJoinGroupWithData(code, data);
        toast('Group joined! 🎉', 'success');
        _tab = 'rooms';
        renderSocial();
      };
      submitEl.addEventListener('click', doJoin);
      pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
    });
  }

  // Routes the join attempt through the correct validation gate based on group settings.
  // This is the single entry point for joining ANY group (public or private, any mode).
  function _routeJoinGroup(code, data) {
    const uid_ = getUserId();
    if (!uid_) { toast('Sign in to join groups', 'warn'); return; }
    if ((data.memberCount || 0) >= (data.maxMembers || 50)) { toast('This group is full', 'warn'); return; }
    // If user already has a pending request, show the pending modal (with cancel option)
    const pendingInfo = _myPendingGroups[code];
    if (pendingInfo && pendingInfo.status === 'pending') {
      _modalRequestApproval(code, data);
      return;
    }
    const joinMode    = data.joinMode    || 'open';
    const hasPassword = !!(data.joinPassword && data.joinPassword.length);
    if (joinMode === 'approval') {
      _modalRequestApproval(code, data);
    } else if (hasPassword) {
      _modalEnterPassword(code, data);
    } else {
      _checkNicknameBeforeJoin(code, data, () => {
        _doJoinGroupWithData(code, data);
        toast(`Joined "${data.name || code}"! 🎉`, 'success');
        _tab = 'rooms';
        renderSocial();
      });
    }
  }

  // Show a nickname modal when nicknameRequired is ON and user has no nickname set.
  function _checkNicknameBeforeJoin(code, data, onContinue) {
    if (!data.nicknameRequired) { onContinue(); return; }
    const current = _getUserDisplayName();
    // If user already has a real name (not the generic fallback), skip modal
    const uid_ = getUserId();
    if (current && current !== 'Studier' && current !== uid_ && current.trim() !== '') {
      onContinue(); return;
    }
    openModal(`
      <h3 class="sc-modal-title">Nickname Required</h3>
      <p class="sc-modal-sub">This group requires a nickname to join. Enter one below.</p>
      <div class="sc-field">
        <input id="sc-nickname-inp" type="text" maxlength="30" placeholder="Your display name"
               class="sc-input" autocomplete="off" value="${esc(current !== 'Studier' ? current : '')}"/>
      </div>
      <div id="sc-nickname-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-nickname-ok">Join Group</button>
      </div>
    `, root => {
      const inp = root.querySelector('#sc-nickname-inp');
      const err = root.querySelector('#sc-nickname-err');
      const ok  = root.querySelector('#sc-nickname-ok');
      inp.focus();
      ok.addEventListener('click', () => {
        const val = (inp.value || '').trim();
        if (!val || val.length < 2) { err.textContent = 'Please enter at least 2 characters.'; err.style.display = ''; return; }
        // Save nickname using the existing display name setter
        try {
          if (window._lsSetDisplayName) window._lsSetDisplayName(val);
          else {
            const ms = getMainState?.() || {};
            ms.displayName = val;
            if (window.saveMainState) window.saveMainState(ms);
          }
        } catch(_) {}
        // Also persist to Firestore
        const db_ = getDb(), uid2 = getUserId(), fb_ = getFb();
        if (db_ && uid2 && fb_) {
          db_.collection('users').doc(uid2).set({ displayName: val }, { merge: true }).catch(() => {});
        }
        closeModal();
        onContinue();
      });
    });
  }

  // ── Direct join for public groups (no invite code needed) ────────────────
  function _joinPublicGroup(code, fbGroupData) {
    const uid_ = getUserId();
    if (!uid_) { toast('Sign in to join groups', 'warn'); return; }
    const sc = scLoad();
    if (sc.groups.find(g => g.code === code)) { toast('You are already in this group', 'info'); return; }
    _routeJoinGroup(code, fbGroupData || {});
  }

  function _modalJoinGroup() {
    openModal(`
      <h3 class="sc-modal-title">Join via Invite Code</h3>
      <p class="sc-modal-sub">Enter the invite code shared by a group admin.</p>
      <div class="sc-field">
        <input id="sc-join-code" type="text" maxlength="8" placeholder="e.g. A1B2C3"
               class="sc-input sc-input-code" autocomplete="off" spellcheck="false"/>
      </div>
      <div id="sc-join-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-join">Find Group</button>
      </div>
    `, root => {
      const codeEl   = root.querySelector('#sc-join-code');
      const errEl    = root.querySelector('#sc-join-err');
      const submitEl = root.querySelector('#sc-do-join');
      codeEl.focus();
      codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

      const doFind = () => {
        const code = codeEl.value.trim().toUpperCase();
        if (code.length < 4) { errEl.textContent = 'Enter a valid invite code (4–8 characters).'; errEl.style.display = ''; return; }
        const sc = scLoad();
        if (sc.groups.find(g => g.code === code)) { errEl.textContent = 'You are already in this group.'; errEl.style.display = ''; return; }
        const db_ = getDb(), uid_ = getUserId();
        if (!db_) { _doLocalFallbackJoin(code); return; }
        if (!uid_) { toast('Sign in to join groups', 'warn'); closeModal(); return; }
        submitEl.disabled = true; submitEl.textContent = 'Searching…'; errEl.style.display = 'none';
        db_.collection('groups').doc(code).get().then(snap => {
          if (!snap.exists) {
            errEl.textContent = 'No group found with this code. Please check and try again.';
            errEl.style.display = ''; submitEl.disabled = false; submitEl.textContent = 'Find Group'; return;
          }
          const data = snap.data();
          if ((data.memberCount || 0) >= (data.maxMembers || 50)) {
            errEl.textContent = 'This group is full.';
            errEl.style.display = ''; submitEl.disabled = false; submitEl.textContent = 'Find Group'; return;
          }
          // Always close the code modal first, then route to correct validation gate
          closeModal();
          _routeJoinGroup(code, data);
        }).catch(() => {
          _doLocalFallbackJoin(code);
          submitEl.disabled = false; submitEl.textContent = 'Find Group';
        });
      };
      submitEl.addEventListener('click', doFind);
      codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') doFind(); });
    });
  }

  function _modalAddTask(groupId) {
    const sc = scLoad();
    const g  = groupId ? sc.groups.find(x => x.id === groupId) : null;
    openModal(`
      <h3 class="sc-modal-title">Add Task${g ? ` — ${esc(g.name)}` : ''}</h3>
      <div class="sc-field">
        <label class="sc-label">Task</label>
        <input id="sc-task-title" type="text" maxlength="100" placeholder="e.g. Complete Chapter 5 MCQs" class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Due Date <span class="sc-opt">(optional)</span></label>
        <input id="sc-task-due" type="date" class="sc-input sc-input-date"/>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-add-task">Add Task</button>
      </div>
    `, root => {
      const titleEl = root.querySelector('#sc-task-title');
      const dueEl   = root.querySelector('#sc-task-due');
      titleEl.focus();
      const doAdd = () => {
        const title = titleEl.value.trim();
        if (!title) { titleEl.style.borderColor='#ef4444'; return; }
        const sc2 = scLoad();
        sc2.tasks.push({ id:genId(), title, groupId:groupId||null, done:false, dueDate:dueEl.value||null, createdAt:Date.now() });
        scSave(sc2); closeModal(); toast('Task added!', 'success'); renderSocial();
      };
      root.querySelector('#sc-do-add-task').addEventListener('click', doAdd);
      titleEl.addEventListener('keydown', e => { if (e.key==='Enter') doAdd(); });
    });
  }

  function _modalAddNote(groupId) {
    const sc = scLoad();
    const g  = groupId ? sc.groups.find(x => x.id === groupId) : null;
    openModal(`
      <h3 class="sc-modal-title">Add Note${g ? ` — ${esc(g.name)}` : ''}</h3>
      <div class="sc-field">
        <label class="sc-label">Title</label>
        <input id="sc-note-title" type="text" maxlength="60" placeholder="Note title…" class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Content <span class="sc-opt">(optional)</span></label>
        <textarea id="sc-note-body" rows="5" placeholder="Write here…" class="sc-textarea"></textarea>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-add-note">Save Note</button>
      </div>
    `, root => {
      const titleEl = root.querySelector('#sc-note-title');
      titleEl.focus();
      root.querySelector('#sc-do-add-note').addEventListener('click', () => {
        const sc2 = scLoad();
        sc2.notes.push({ id:genId(), title:titleEl.value.trim()||'Untitled', content:root.querySelector('#sc-note-body').value.trim(), groupId:groupId||null, createdAt:Date.now(), updatedAt:Date.now() });
        scSave(sc2); closeModal(); toast('Note saved!', 'success'); renderSocial();
      });
    });
  }

  function _modalEditNote(noteId) {
    const sc = scLoad();
    const n  = sc.notes.find(x => x.id === noteId);
    if (!n) return;
    openModal(`
      <h3 class="sc-modal-title">Edit Note</h3>
      <div class="sc-field">
        <label class="sc-label">Title</label>
        <input id="sc-enote-title" type="text" maxlength="60" value="${esc(n.title)}" class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Content</label>
        <textarea id="sc-enote-body" rows="6" class="sc-textarea">${esc(n.content||'')}</textarea>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-edit-note">Save Changes</button>
      </div>
    `, root => {
      const titleEl = root.querySelector('#sc-enote-title');
      titleEl.focus();
      root.querySelector('#sc-do-edit-note').addEventListener('click', () => {
        const sc2 = scLoad();
        const note = sc2.notes.find(x => x.id === noteId);
        if (note) { note.title = titleEl.value.trim()||'Untitled'; note.content = root.querySelector('#sc-enote-body').value.trim(); note.updatedAt=Date.now(); scSave(sc2); }
        closeModal(); toast('Note updated!', 'success'); renderSocial();
      });
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function _bindEvents(root) {
    root.addEventListener('click',  _onClick);
    root.addEventListener('change', _onChange);

    // ── Pull-to-refresh on Discover tab ────────────────────────────────────
    const scBody = root.querySelector('.sc-body');
    if (scBody && !_groupView) {
      const THRESHOLD = 64;
      let _ptrStartY  = 0;
      let _ptrPulling = false;
      let _ptrFired   = false;

      // Helper: get the active PTR bar for current tab
      const getPtrBar = () => root.querySelector(_tab === 'rooms' ? '#sc-ptr-bar' : '#sc-ptr-bar-groups');

      // Helper: hide bar and cancel safety timer
      const _clearPtr = () => {
        if (_ptrHideTimer) { clearTimeout(_ptrHideTimer); _ptrHideTimer = null; }
        _ptrLoading      = false;
        _ptrGroupLoading = false;
        const b = getPtrBar();
        if (b) { b.classList.remove('sc-ptr-visible', 'sc-ptr-loading'); }
      };

      scBody.addEventListener('touchstart', e => {
        _ptrStartY  = e.touches[0].clientY;
        _ptrPulling = scBody.scrollTop === 0;
        _ptrFired   = false;
      }, { passive: true });

      scBody.addEventListener('touchmove', e => {
        if (!_ptrPulling) return;
        const dy = e.touches[0].clientY - _ptrStartY;
        const bar = getPtrBar();
        if (!bar) return;
        if (dy > 12 && scBody.scrollTop === 0) {
          bar.classList.add('sc-ptr-visible');
          if (dy > THRESHOLD && !_ptrFired) {
            _ptrFired = true;
            navigator.vibrate && navigator.vibrate(18);
          }
        } else {
          if (!_ptrLoading && !_ptrGroupLoading) bar.classList.remove('sc-ptr-visible');
        }
      }, { passive: true });

      scBody.addEventListener('touchend', () => {
        const bar = getPtrBar();
        if (_ptrFired) {
          _ptrFired = false;
          // Transition from "pulling" style to persistent "loading" style
          if (bar) { bar.classList.remove('sc-ptr-visible'); bar.classList.add('sc-ptr-loading'); }

          if (_tab === 'rooms') {
            _ptrLoading = true;
            if (_publicGroupsUnsub) { try { _publicGroupsUnsub(); } catch(_) {} _publicGroupsUnsub = null; }
            _publicGroups = [];
            _subscribePublicGroups();
            // Re-render so the bar is baked in with sc-ptr-loading class for continuity
            renderSocial();
          } else if (_tab === 'groups') {
            _ptrGroupLoading = true;
            if (_myGroupsUnsub) { try { _myGroupsUnsub(); } catch(_) {} _myGroupsUnsub = null; }
            _subscribeMyGroups();
            _subscribeMyGroupsByOwner();
            _subscribeMyGroupsByAdmin();
            _ensureGroupDocSubs();
            renderSocial();
          }

          // Safety fallback: auto-hide after 5 s if snapshot never fires
          _ptrHideTimer = setTimeout(() => {
            _ptrLoading      = false;
            _ptrGroupLoading = false;
            _ptrHideTimer    = null;
            if (!_destroyed) _scheduleRender();
          }, 5000);
        } else {
          // Finger lifted without reaching threshold — just hide the bar
          if (bar && !_ptrLoading && !_ptrGroupLoading) bar.classList.remove('sc-ptr-visible');
        }
        _ptrPulling = false;
      }, { passive: true });
    }
  }

  function _onClick(e) {
    const el = e.target.closest('[data-sc]');
    if (!el || el.type === 'checkbox') return;
    e.stopPropagation();
    try { _dispatch(el.dataset.sc, el); } catch(err) { console.error('[Social]', el.dataset.sc, err); }
  }

  function _onChange(e) {
    const el = e.target;
    if (el.dataset.sc === 'filter-public') {
      _roomPublicOnly = el.checked;
      _subscribePublicGroups(); // re-query with/without isPrivate==false filter
      renderSocial();
    } else if (el.dataset.sc === 'filter-space') {
      _roomWithSpace = el.checked;
      renderSocial(); // client-side capacity filter only
    }
  }

  function _dispatch(act, el) {
    switch (act) {
      case 'tab':
        if (_tab === 'leaderboard') _stopLbLive();
        _tab = el.dataset.tab || _tab;
        _groupView = null;
        renderSocial();
        break;

      case 'room-filter':
        _roomFilter = el.dataset.filter || 'new';
        // Re-subscribe with new ordering (unsubscribes old listener automatically)
        _subscribePublicGroups();
        renderSocial();
        break;

      case 'lb-period':
        _lbPeriod = el.dataset.period || 'daily';
        _lbLoading = _lbPeriod === 'daily' ? _globalLbDailyData.length === 0 : _globalLbWeeklyData.length === 0;
        renderSocial();
        break;

      case 'lb-retry':
        // Force re-subscribe by tearing down and restarting
        _unsubscribeGlobalLb();
        _globalLbDailyData = []; _globalLbWeeklyData = [];
        _lbLoading = true; _lbLastUpdated = 0;
        _subscribeGlobalLb();
        renderSocial();
        break;

      case 'create-group': _modalCreateGroup(); break;
      case 'join-group':   _modalJoinGroup();   break;

      case 'open-group':
      case 'enter-room': {
        const fbCode = el.dataset.fbcode;
        if (fbCode) {
          // Discovery card from Firebase
          const sc_ = scLoad();
          const localG = sc_.groups.find(g => g.code === fbCode);
          if (localG) {
            // Already in local state — enter room directly
            _tab = 'groups'; _groupView = localG.id; renderSocial();
          } else {
            // Check if this user is the owner based on Firebase data
            const fbGroup = _publicGroups.find(g => g._fbCode === fbCode);
            const uid_ = getUserId();
            const isOwnerOfFb = fbGroup && (fbGroup.createdByUid === uid_ || fbGroup.ownerUid === uid_);
            if (isOwnerOfFb) {
              // Creator clicked their own group from Discover — auto-join/restore
              _joinPublicGroup(fbCode, { ...fbGroup, role: 'admin', isPrivate: false });
            } else if (fbGroup && !fbGroup.isPrivate) {
              // Public group — join instantly
              _joinPublicGroup(fbCode, fbGroup);
            } else {
              // Private group — require invite code
              _modalJoinGroup();
            }
          }
          break;
        }
        _tab = 'groups';
        _groupView = el.dataset.gid;
        renderSocial();
        break;
      }

      case 'close-group':
        _groupView    = null;
        _settingsView = false;
        _srTab        = 'home';
        _stopSrTicker();
        _unsubscribeRoomMembers();
        renderSocial();
        break;

      case 'leave-group': {
        const gid = el.dataset.gid;
        const sc  = scLoad();
        const g   = sc.groups.find(x => x.id === gid);
        if (!g) break;
        const groupCode = g.code;
        confirmModal(`Leave "${g.name}"? Local group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks  = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes  = sc2.notes.filter(n => n.groupId !== gid);
          if (sc2.chats) delete sc2.chats[gid];
          scSave(sc2);
          if (groupCode && _groupDocUnsubs[groupCode]) {
            try { _groupDocUnsubs[groupCode](); } catch(_e) {}
            delete _groupDocUnsubs[groupCode];
          }
          _groupView = null; _srTab = 'home'; _stopSrTicker(); _unsubscribeRoomMembers();
          // Atomic transaction: delete member doc + decrement only if member exists
          const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
          if (db_ && uid_ && fb_ && groupCode) {
            const mRefL  = db_.collection('groups').doc(groupCode).collection('members').doc(uid_);
            const gRefL  = db_.collection('groups').doc(groupCode);
            db_.runTransaction(t => t.get(mRefL).then(memberSnap => {
              if (memberSnap.exists) {
                t.delete(mRefL);
                t.update(gRefL, { memberCount: fb_.firestore.FieldValue.increment(-1) });
              }
            })).then(() => _recalcMemberCount(groupCode)).catch(() => {});
            db_.collection('users').doc(uid_).set({ joinedRooms: fb_.firestore.FieldValue.arrayRemove(groupCode) }, { merge: true }).catch(() => {});
          }
          toast('Left group.', 'info'); renderSocial();
        }, { title:'Leave Group?', yesLabel:'Leave', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      case 'copy-code': {
        const code = el.dataset.code || '';
        if (code) navigator.clipboard.writeText(code).then(() => toast(`Code ${code} copied!`, 'success')).catch(() => toast(`Code: ${code}`, 'info'));
        break;
      }

      case 'add-task':    _modalAddTask(el.dataset.gid || null); break;
      case 'add-note':    _modalAddNote(el.dataset.gid || null); break;
      case 'edit-note':   _modalEditNote(el.dataset.nid);        break;

      case 'toggle-task': {
        const sc = scLoad();
        const t  = sc.tasks.find(x => x.id === el.dataset.tid);
        if (t) { t.done = !t.done; scSave(sc); renderSocial(); }
        break;
      }

      case 'delete-task': {
        const sc = scLoad();
        sc.tasks = sc.tasks.filter(x => x.id !== el.dataset.tid);
        scSave(sc); renderSocial();
        break;
      }

      case 'delete-note':
        confirmModal('Delete this note?', () => {
          const sc = scLoad();
          sc.notes = sc.notes.filter(n => n.id !== el.dataset.nid);
          scSave(sc); renderSocial();
        }, { title:'Delete Note', yesLabel:'Delete', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;

      case 'sr-tab': {
        const newTab = el.dataset.tab || 'home';
        if (_srTab !== newTab) {
          _srTab = newTab;
          _stopSrTicker();
          if (_srTab === 'chat' && _groupView) {
            const sc0 = scLoad();
            const g0  = sc0.groups.find(x => x.id === _groupView);
            if (g0 && g0.code) {
              _subscribeChatMessages(g0.code);
              _subscribeNudges(g0.code);
              _updateLastSeen(g0.code);
            }
          }
          renderSocial();
        }
        break;
      }

      case 'sr-rules': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        openModal(`
          <h3 class="sc-modal-title">📢 Group Introduction / Rules</h3>
          <div style="color:var(--sc-text);line-height:1.7;white-space:pre-wrap;font-size:15px;margin:12px 0">${
            g.description
              ? esc(g.description)
              : `<span style="color:var(--sc-muted)">No rules or introduction set yet.<br>Admins can add one in Group Settings.</span>`
          }</div>
          <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
        `);
        break;
      }

      case 'sr-settings': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        _settingsView = true;
        renderSocial();
        break;
      }

      case 'sr-copy-invite': {
        const code = el.dataset.code || '';
        if (code) {
          navigator.clipboard.writeText(code)
            .then(() => toast(`Code ${code} copied! 🔗`, 'success'))
            .catch(() => toast(`Invite code: ${code}`, 'info'));
        }
        break;
      }

      // ── Settings Panel Navigation ─────────────────────────────────────────
      case 'sgs-back': {
        _settingsView = false;
        renderSocial();
        break;
      }

      // ── Member Profile ────────────────────────────────────────────────────
      case 'sr-view-profile': {
        let tUid  = el.dataset.uid || '';
        const tName = el.dataset.name || 'Member';
        const tCode = el.dataset.code || '';
        const myUid = getUserId();
        if (!tUid || tUid === 'me') tUid = myUid;
        if (!tUid) break;
        _openMemberProfile(tUid, tName, tCode);
        break;
      }

      // ── Personal Settings ─────────────────────────────────────────────────
      case 'sgs-group-profile': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        if (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin') {
          toast('Only admins can edit the group profile', 'warn'); break;
        }
        const gid = g.id;
        const catChips = CATEGORIES.map(c =>
          `<button class="sc-cat-chip-pick${(g.category||'General')===c?' sc-cat-chip-active':''}" data-cat="${c}" type="button">${c}</button>`
        ).join('');
        openModal(`
          <h3 class="sc-modal-title">Group Profile</h3>
          <div class="sc-field">
            <label class="sc-label">Group Name</label>
            <input id="gp-name" type="text" maxlength="40" value="${esc(g.name||'')}" class="sc-input" autocomplete="off"/>
          </div>
          <div class="sc-field">
            <label class="sc-label">Introduction / Rules</label>
            <textarea id="gp-desc" rows="3" maxlength="300" class="sc-textarea" placeholder="Describe your group or add rules…">${esc(g.description||'')}</textarea>
          </div>
          <div class="sc-field">
            <label class="sc-label">Category</label>
            <div id="gp-cats" class="sc-cat-chips-row">${catChips}</div>
          </div>
          <div class="sc-field sc-field-row">
            <div style="flex:1;min-width:0">
              <label class="sc-label">Daily Goal (hrs)</label>
              <input id="gp-goal" type="number" min="1" max="24" value="${g.dailyGoalHrs||8}" class="sc-input" style="text-align:center"/>
            </div>
            <div style="flex:1;min-width:0">
              <label class="sc-label">Max Members</label>
              <input id="gp-max" type="number" min="2" max="500" value="${g.maxMembers||50}" class="sc-input" style="text-align:center"/>
            </div>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="gp-save">Save</button>
          </div>
        `, root => {
          let selCat = g.category || 'General';
          root.querySelector('#gp-cats').addEventListener('click', e => {
            const b = e.target.closest('.sc-cat-chip-pick');
            if (!b) return;
            selCat = b.dataset.cat;
            root.querySelectorAll('.sc-cat-chip-pick').forEach(x => x.classList.toggle('sc-cat-chip-active', x.dataset.cat === selCat));
          });
          root.querySelector('#gp-save').addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            const name = root.querySelector('#gp-name').value.trim();
            if (!name) { toast('Group name is required', 'warn'); return; }
            g2.name        = name;
            g2.description = root.querySelector('#gp-desc').value.trim();
            g2.category    = selCat;
            g2.dailyGoalHrs= Math.max(1, Math.min(24, parseInt(root.querySelector('#gp-goal').value)||8));
            g2.maxMembers  = Math.max(2, Math.min(500, parseInt(root.querySelector('#gp-max').value)||50));
            scSave(sc2); closeModal(); toast('Profile updated!', 'success'); renderSocial();
          });
        });
        break;
      }

      case 'sgs-notif': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const curOn = g.notifEnabled !== false;
        openModal(`
          <h3 class="sc-modal-title">Group Notification Settings</h3>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
            <div>
              <div style="font-size:15px;font-weight:500;color:var(--text)">Group Notifications</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Receive alerts for group activity</div>
            </div>
            <label class="switch" style="flex-shrink:0">
              <input type="checkbox" id="gn-toggle" ${curOn ? 'checked' : ''}/>
              <span class="slider"></span>
            </label>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="gn-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#gn-save').addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.notifEnabled = root.querySelector('#gn-toggle').checked;
            scSave(sc2); closeModal();
            toast(g2.notifEnabled ? '🔔 Notifications on' : '🔕 Notifications off', 'success');
            renderSocial();
          });
        });
        break;
      }

      case 'sgs-challenges':
      case 'sgs-missions':
        toast('Coming soon! 🚀 Challenges & Missions are in development.', 'info', 3000);
        break;

      // ── Group Leader Menu ─────────────────────────────────────────────────
      case 'sgs-change-name': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        let selIcon = g.icon || '📚';
        const iconBtns = ICONS_LIST.map(ic =>
          `<button class="sc-icon-pick${ic===selIcon?' sc-icon-active':''}" data-icon="${ic}" type="button">${ic}</button>`
        ).join('');
        openModal(`
          <h3 class="sc-modal-title">Group Name & Icon</h3>
          <div class="sc-field">
            <label class="sc-label">Group Name</label>
            <input id="cn-name" type="text" maxlength="40" value="${esc(g.name||'')}" class="sc-input" autocomplete="off" placeholder="Enter group name"/>
          </div>
          <div class="sc-field">
            <label class="sc-label">Icon</label>
            <div id="cn-icon-grid" class="sc-icon-grid">${iconBtns}</div>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cn-save">Save</button>
          </div>
        `, root => {
          const inp = root.querySelector('#cn-name');
          inp.focus(); inp.select();
          root.querySelector('#cn-icon-grid').addEventListener('click', e => {
            const btn = e.target.closest('.sc-icon-pick');
            if (!btn) return;
            selIcon = btn.dataset.icon;
            root.querySelectorAll('.sc-icon-pick').forEach(b => b.classList.toggle('sc-icon-active', b.dataset.icon === selIcon));
          });
          const doSave = () => {
            const name = inp.value.trim();
            if (!name) { toast('Name cannot be empty', 'warn'); return; }
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.name = name; g2.icon = selIcon;
            scSave(sc2);
            _saveGroupSetting(g2.code, { name, icon: selIcon });
            closeModal(); toast('Group updated!', 'success'); renderSocial();
          };
          root.querySelector('#cn-save').addEventListener('click', doSave);
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });
        });
        break;
      }

      case 'sgs-change-rules': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        openModal(`
          <h3 class="sc-modal-title">Group Introduction / Rules</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Describe your group, set rules, or add an introduction visible to all members.</p>
          <div class="sc-field">
            <textarea id="cr-desc" rows="5" maxlength="500" class="sc-textarea" placeholder="e.g. Welcome! Study for 4h daily and stay active…">${esc(g.description||'')}</textarea>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" id="cr-clear" style="color:#ef4444">Remove</button>
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cr-save">Save</button>
          </div>
        `, root => {
          const ta = root.querySelector('#cr-desc');
          const doSave = (val) => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.description = val;
            scSave(sc2);
            _saveGroupSetting(g2.code, { description: val });
            closeModal(); toast(val ? 'Rules saved!' : 'Rules removed', 'success'); renderSocial();
          };
          root.querySelector('#cr-save').addEventListener('click', () => doSave(ta.value.trim()));
          root.querySelector('#cr-clear').addEventListener('click', () => doSave(''));
        });
        break;
      }

      case 'sgs-change-category': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        let selCat = g.category || 'General';
        const chips = CATEGORIES.map(c =>
          `<button class="sc-cat-chip-pick${selCat===c?' sc-cat-chip-active':''}" data-cat="${c}" type="button">${c}</button>`
        ).join('');
        openModal(`
          <h3 class="sc-modal-title">Change Category</h3>
          <div id="cc-chips" class="sc-cat-chips-row" style="margin:12px 0">${chips}</div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cc-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#cc-chips').addEventListener('click', e => {
            const b = e.target.closest('.sc-cat-chip-pick');
            if (!b) return;
            selCat = b.dataset.cat;
            root.querySelectorAll('.sc-cat-chip-pick').forEach(x => x.classList.toggle('sc-cat-chip-active', x.dataset.cat === selCat));
          });
          root.querySelector('#cc-save').addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.category = selCat;
            scSave(sc2);
            _saveGroupSetting(g2.code, { category: selCat });
            closeModal(); toast('Category updated!', 'success'); renderSocial();
          });
        });
        break;
      }

      case 'sgs-change-goal': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        openModal(`
          <h3 class="sc-modal-title">Change Daily Goal</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Set the daily study target for all group members.</p>
          <div class="sc-field" style="display:flex;align-items:center;gap:12px;justify-content:center">
            <input id="cg-goal" type="number" min="1" max="24" value="${g.dailyGoalHrs||8}" class="sc-input" style="text-align:center;width:100px;font-size:22px;font-weight:700"/>
            <span style="font-size:18px;color:var(--text-muted)">hours / day</span>
          </div>
          <div class="actions" style="margin-top:20px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cg-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#cg-save').addEventListener('click', () => {
            const val = Math.max(1, Math.min(24, parseInt(root.querySelector('#cg-goal').value)||8));
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.dailyGoalHrs = val;
            scSave(sc2);
            _saveGroupSetting(g2.code, { dailyGoalHrs: val });
            closeModal(); toast(`Daily goal set to ${val}h`, 'success'); renderSocial();
          });
        });
        break;
      }

      case 'sgs-change-capacity': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        openModal(`
          <h3 class="sc-modal-title">Change Capacity</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Maximum number of members allowed in this group.</p>
          <div class="sc-field" style="display:flex;align-items:center;gap:12px;justify-content:center">
            <input id="cap-val" type="number" min="2" max="500" value="${g.maxMembers||50}" class="sc-input" style="text-align:center;width:100px;font-size:22px;font-weight:700"/>
            <span style="font-size:18px;color:var(--text-muted)">people</span>
          </div>
          <div class="actions" style="margin-top:20px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cap-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#cap-save').addEventListener('click', () => {
            const val = Math.max(2, Math.min(500, parseInt(root.querySelector('#cap-val').value)||50));
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.maxMembers = val;
            scSave(sc2);
            _saveGroupSetting(g2.code, { maxMembers: val });
            closeModal(); toast(`Capacity set to ${val}`, 'success'); renderSocial();
          });
        });
        break;
      }

      case 'sgs-join-mode': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const cur = g.joinMode || 'open';
        const hasPw = !!(g.joinPassword && g.joinPassword.length);
        openModal(`
          <h3 class="sc-modal-title" style="margin-bottom:4px">🔒 Privacy & Join Mode</h3>
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px">Control how new members enter your group.</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label class="sgs-radio-row ${cur==='open' && !hasPw ? 'sgs-radio-selected':''}">
              <input type="radio" name="jm" value="open" ${cur==='open' && !hasPw ? 'checked':''} style="display:none"/>
              <div class="sgs-radio-content">
                <div style="font-size:14px;font-weight:700">🌐 Open — join immediately</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Anyone with the invite code can join instantly. No friction.</div>
              </div>
              <div class="sgs-radio-dot ${cur==='open' && !hasPw ? 'sgs-radio-dot-on':''}"></div>
            </label>
            <label class="sgs-radio-row ${cur==='approval'?'sgs-radio-selected':''}">
              <input type="radio" name="jm" value="approval" ${cur==='approval'?'checked':''} style="display:none"/>
              <div class="sgs-radio-content">
                <div style="font-size:14px;font-weight:700">⏳ Approval required</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">New members send a request. You review and approve each one.</div>
              </div>
              <div class="sgs-radio-dot ${cur==='approval'?'sgs-radio-dot-on':''}"></div>
            </label>
            <label class="sgs-radio-row ${hasPw?'sgs-radio-selected':''}">
              <input type="radio" name="jm" value="password" ${hasPw?'checked':''} style="display:none"/>
              <div class="sgs-radio-content">
                <div style="font-size:14px;font-weight:700">🔑 Password protected</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Members must enter the correct password to join.</div>
              </div>
              <div class="sgs-radio-dot ${hasPw?'sgs-radio-dot-on':''}"></div>
            </label>
          </div>
          <div id="jm-pw-wrap" style="margin-top:14px;display:${hasPw?'block':'none'}">
            <label class="sc-label" style="font-size:12px">Password</label>
            <input id="jm-pw-inp" type="text" maxlength="30" value="${esc(g.joinPassword||'')}" class="sc-input" placeholder="e.g. study2026" autocomplete="off" style="margin-top:6px"/>
          </div>
          <div class="actions" style="margin-top:20px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="jm-save">Save</button>
          </div>
        `, root => {
          const pwWrap = root.querySelector('#jm-pw-wrap');
          root.querySelectorAll('.sgs-radio-row').forEach(row => {
            row.addEventListener('click', () => {
              root.querySelectorAll('.sgs-radio-row').forEach(r => r.classList.remove('sgs-radio-selected'));
              root.querySelectorAll('.sgs-radio-dot').forEach(d => d.classList.remove('sgs-radio-dot-on'));
              row.classList.add('sgs-radio-selected');
              row.querySelector('.sgs-radio-dot').classList.add('sgs-radio-dot-on');
              row.querySelector('input[type=radio]').checked = true;
              const val = row.querySelector('input[type=radio]').value;
              pwWrap.style.display = val === 'password' ? 'block' : 'none';
            });
          });
          root.querySelector('#jm-save').addEventListener('click', () => {
            const val    = root.querySelector('input[name=jm]:checked')?.value || 'open';
            const pwVal  = (root.querySelector('#jm-pw-inp')?.value || '').trim();
            const sc2    = scLoad();
            const g2     = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            if (val === 'password' && !pwVal) {
              root.querySelector('#jm-pw-inp').focus(); return;
            }
            if (val === 'approval') {
              g2.joinMode = 'approval'; g2.isPrivate = true; g2.joinPassword = '';
              scSave(sc2);
              _saveGroupSetting(g2.code, { joinMode: 'approval', isPrivate: true, joinPassword: '' });
              if (g2.code) _subscribeJoinRequests(g2.code);
              closeModal(); toast('⏳ Approval required to join', 'success'); renderSocial();
            } else if (val === 'password') {
              g2.joinMode = 'open'; g2.isPrivate = false; g2.joinPassword = pwVal;
              scSave(sc2);
              _saveGroupSetting(g2.code, { joinMode: 'open', isPrivate: false, joinPassword: pwVal });
              closeModal(); toast('🔑 Group is now password-protected', 'success'); renderSocial();
            } else {
              g2.joinMode = 'open'; g2.isPrivate = false; g2.joinPassword = '';
              scSave(sc2);
              _saveGroupSetting(g2.code, { joinMode: 'open', isPrivate: false, joinPassword: '' });
              closeModal(); toast('🌐 Group is now open to everyone', 'success'); renderSocial();
            }
          });
        });
        break;
      }

      case 'sgs-signup-question': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const cur = g.joinQuestion || '';
        openModal(`
          <h3 class="sc-modal-title">Sign Up Questions</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Ask new members a question when they request to join. Leave empty to disable.</p>
          <div class="sc-field">
            <label class="sc-label">Question</label>
            <textarea id="sq-inp" rows="3" maxlength="200" class="sc-textarea" placeholder="e.g. What subject are you preparing for?">${esc(cur)}</textarea>
          </div>
          <div class="actions" style="margin-top:16px">
            ${cur ? `<button class="btn btn-ghost" id="sq-clear" style="color:#ef4444">Turn Off</button>` : ''}
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="sq-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#sq-save').addEventListener('click', () => {
            const val = root.querySelector('#sq-inp').value.trim();
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinQuestion = val;
            scSave(sc2);
            _saveGroupSetting(g2.code, { joinQuestion: val });
            closeModal();
            toast(val ? '❓ Question saved & enabled' : 'Sign-up question disabled', 'success');
            renderSocial();
          });
          root.querySelector('#sq-clear')?.addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinQuestion = '';
            scSave(sc2);
            _saveGroupSetting(g2.code, { joinQuestion: '' });
            closeModal(); toast('Sign-up question removed', 'info'); renderSocial();
          });
        });
        break;
      }

      case 'sgs-nickname-rules': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const newVal = !g.nicknameRequired;
        {
          const sc2 = scLoad();
          const g2  = sc2.groups.find(x => x.id === gid);
          if (!g2) break;
          g2.nicknameRequired = newVal;
          scSave(sc2);
          _saveGroupSetting(g2.code, { nicknameRequired: newVal });
          toast(newVal ? '📛 Nickname rules ON — display name required' : '📛 Nickname rules OFF', 'success');
          renderSocial();
        }
        break;
      }

      case 'sgs-change-password': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const hasPass = !!(g.joinPassword && g.joinPassword.length);
        openModal(`
          <h3 class="sc-modal-title">Change Password</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Set a password that members must enter to join. Leave empty to make the group public.</p>
          <div class="sc-field">
            <label class="sc-label">Password <span class="sc-opt">(leave empty for public)</span></label>
            <input id="pw-inp" type="text" maxlength="30" value="${esc(g.joinPassword||'')}" class="sc-input" placeholder="e.g. study2026" autocomplete="off"/>
          </div>
          <div class="actions" style="margin-top:16px">
            ${hasPass ? `<button class="btn btn-ghost" id="pw-clear" style="color:#ef4444">Make Public</button>` : ''}
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="pw-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#pw-save').addEventListener('click', () => {
            const val = root.querySelector('#pw-inp').value.trim();
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinPassword = val;
            scSave(sc2);
            _saveGroupSetting(g2.code, { joinPassword: val });
            closeModal();
            toast(val ? '🔐 Password protected' : '🌐 Group is now public', 'success');
            renderSocial();
          });
          root.querySelector('#pw-clear')?.addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinPassword = '';
            scSave(sc2);
            _saveGroupSetting(g2.code, { joinPassword: '' });
            closeModal(); toast('🌐 Password removed', 'info'); renderSocial();
          });
        });
        break;
      }

      // ── Management Section ────────────────────────────────────────────────
      case 'sgs-waiting-room': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        _openWaitingRoomModal(g);
        break;
      }

      case 'sgs-approve-req': {
        const sc  = scLoad();
        const gid = el.dataset.gid;
        const rid = el.dataset.rid;
        const name= el.dataset.name || 'Member';
        const g   = sc.groups.find(x => x.id === gid);
        if (!g) break;
        if (!sc.requests) sc.requests = {};
        if (!sc.requests[gid]) sc.requests[gid] = [];
        const req = sc.requests[gid].find(r => r.id === rid);
        if (req) {
          sc.requests[gid] = sc.requests[gid].filter(r => r.id !== rid);
          g.members = g.members || [];
          if (!g.members.find(m => m.id === rid)) {
            g.members.push({ id: rid, name, role: 'member', joinedAt: Date.now() });
          }
        }
        scSave(sc);
        const db_ap = getDb(), fb_ap = getFb();
        if (db_ap && fb_ap && g.code) {
          const gRef_ap   = db_ap.collection('groups').doc(g.code);
          const reqRef_ap = gRef_ap.collection('joinRequests').doc(rid);
          const mRef_ap   = gRef_ap.collection('members').doc(rid);
          // Mark approved + include groupName so user's listener can display notification
          reqRef_ap.set({ status: 'approved', approvedAt: fb_ap.firestore.FieldValue.serverTimestamp(), groupName: g.name || g.code }, { merge: true }).catch(() => {});
          mRef_ap.set({
            uid: rid, displayName: name, role: 'member',
            joinedAt: fb_ap.firestore.FieldValue.serverTimestamp(),
            isStudying: false, currentSubject: null, elapsedTimeToday: 0, dateKey: todayKey(),
          }, { merge: true }).then(() => {
            gRef_ap.set({ memberCount: fb_ap.firestore.FieldValue.increment(1) }, { merge: true }).catch(() => {});
          }).catch(() => {});
          db_ap.collection('users').doc(rid).set({ joinedRooms: fb_ap.firestore.FieldValue.arrayUnion(g.code) }, { merge: true }).catch(() => {});
        }
        toast(`✓ ${name} approved!`, 'success');
        el.closest('.adm-member-row')?.remove();
        renderSocial();
        break;
      }

      case 'sgs-reject-req': {
        const sc    = scLoad();
        const gid   = el.dataset.gid;
        const rid   = el.dataset.rid;
        const g_rj  = sc.groups.find(x => x.id === gid);
        if (!sc.requests) sc.requests = {};
        if (!sc.requests[gid]) sc.requests[gid] = [];
        sc.requests[gid] = sc.requests[gid].filter(r => r.id !== rid);
        scSave(sc);
        const db_rj = getDb(), fb_rj = getFb();
        if (db_rj && g_rj?.code) {
          // Include groupName so user's listener can show a polite notification
          db_rj.collection('groups').doc(g_rj.code).collection('joinRequests').doc(rid)
            .set({ status: 'rejected', rejectedAt: fb_rj?.firestore?.FieldValue?.serverTimestamp?.() ?? null, groupName: g_rj.name || g_rj.code }, { merge: true }).catch(() => {});
        }
        toast('Request rejected', 'info');
        el.closest('.adm-member-row')?.remove();
        renderSocial();
        break;
      }

      case 'sgs-manage-members': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const myRole = _getMyRole(g);
        if (myRole !== 'owner' && myRole !== 'admin') { toast('Admin access required', 'warn'); break; }
        _openManageMembersModal(g);
        break;
      }

      case 'sgs-kick': {
        const sc   = scLoad();
        const gid  = el.dataset.gid;
        const tuid = el.dataset.uid;
        const name = el.dataset.name || 'Member';
        const g    = sc.groups.find(x => x.id === gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        confirmModal(`Remove ${name} from the group?`, () => {
          _execKickMember(g, tuid, name, false);
        }, { title:`Kick ${name}?`, yesLabel:'Remove', yesClass:'btn btn-danger' });
        break;
      }

      case 'sgs-ban': {
        const sc   = scLoad();
        const gid  = el.dataset.gid;
        const tuid = el.dataset.uid;
        const name = el.dataset.name || 'Member';
        const g    = sc.groups.find(x => x.id === gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        confirmModal(`Ban ${name}? They will be removed and blocked from rejoining.`, () => {
          _execKickMember(g, tuid, name, true);
        }, { title:`Ban ${name}?`, yesLabel:'Ban', yesClass:'btn btn-danger' });
        break;
      }

      case 'sgs-promote-member': {
        const sc   = scLoad();
        const gid  = el.dataset.gid;
        const tuid = el.dataset.uid;
        const name = el.dataset.name || 'Member';
        const g    = sc.groups.find(x => x.id === gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        confirmModal(`Promote ${name} to Admin? They can manage group settings.`, () => {
          const db_p = getDb(), fb_p = getFb();
          if (db_p && fb_p && g.code) {
            db_p.collection('groups').doc(g.code).set({ admins: fb_p.firestore.FieldValue.arrayUnion(tuid) }, { merge: true }).catch(() => {});
            db_p.collection('groups').doc(g.code).collection('members').doc(tuid).set({ role: 'admin' }, { merge: true }).catch(() => {});
          }
          const sc2 = scLoad(), g2 = sc2.groups.find(x => x.id === gid);
          if (g2) { const m = (g2.members||[]).find(x => x.id === tuid); if (m) m.role = 'admin'; if (!g2.admins) g2.admins = []; if (!g2.admins.includes(tuid)) g2.admins.push(tuid); scSave(sc2); }
          toast(`${name} promoted to Admin ⚡`, 'success');
          closeModal(); renderSocial();
        }, { title:`Promote ${name}?`, yesLabel:'Promote', yesClass:'btn sc-modal-submit' });
        break;
      }

      case 'sgs-demote-member': {
        const sc   = scLoad();
        const gid  = el.dataset.gid;
        const tuid = el.dataset.uid;
        const name = el.dataset.name || 'Member';
        const g    = sc.groups.find(x => x.id === gid);
        if (!g || _getMyRole(g) !== 'owner') break;
        confirmModal(`Remove ${name}'s Admin role?`, () => {
          const db_d = getDb(), fb_d = getFb();
          if (db_d && fb_d && g.code) {
            db_d.collection('groups').doc(g.code).set({ admins: fb_d.firestore.FieldValue.arrayRemove(tuid) }, { merge: true }).catch(() => {});
            db_d.collection('groups').doc(g.code).collection('members').doc(tuid).set({ role: 'member' }, { merge: true }).catch(() => {});
          }
          const sc2 = scLoad(), g2 = sc2.groups.find(x => x.id === gid);
          if (g2) { const m = (g2.members||[]).find(x => x.id === tuid); if (m) m.role = 'member'; if (g2.admins) g2.admins = g2.admins.filter(a => a !== tuid); scSave(sc2); }
          toast(`${name} demoted to Member`, 'info');
          closeModal(); renderSocial();
        }, { title:`Demote ${name}?`, yesLabel:'Demote', yesClass:'btn btn-danger' });
        break;
      }

      case 'sgs-nudge-all': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const myUid_nu  = getUserId();
        const others    = (g.members||[]).filter(m => m.id !== myUid_nu && m.id !== 'me');
        if (!others.length) { toast('No other members to nudge yet', 'info'); break; }
        // Spam guard: 15-minute cooldown
        const lastNudge = g._lastNudge || 0;
        if (Date.now() - lastNudge < 15 * 60 * 1000) {
          const minsLeft = Math.ceil((15 * 60 * 1000 - (Date.now() - lastNudge)) / 60000);
          toast(`⏳ Nudge cooldown: ${minsLeft}m remaining before next nudge`, 'warn'); break;
        }
        const sc2_nu = scLoad();
        const g2_nu  = sc2_nu.groups.find(x => x.id === g.id);
        if (g2_nu) { g2_nu._lastNudge = Date.now(); scSave(sc2_nu); }
        const db_nu = getDb(), fb_nu = getFb();
        const senderName = _getUserDisplayName();
        if (db_nu && myUid_nu && fb_nu && g.code) {
          db_nu.collection('groups').doc(g.code).collection('nudges').add({
            senderUid:   myUid_nu,
            senderName,
            message:     `📣 ${senderName} is nudging you to study!`,
            sentAt:      fb_nu.firestore.FieldValue.serverTimestamp(),
            memberCount: others.length,
          }).catch(() => {});
          // Write to group doc so all members' onSnapshot fires and shows toast
          db_nu.collection('groups').doc(g.code).set({
            lastNudge:       fb_nu.firestore.FieldValue.serverTimestamp(),
            lastNudgeSender: senderName,
          }, { merge: true }).catch(() => {});
        }
        toast(`📣 Nudged ${others.length} member${others.length!==1?'s':''}! They'll get a reminder to study.`, 'success', 3500);
        break;
      }

      case 'sgs-toggle-chat': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        {
          const sc2 = scLoad();
          const g2  = sc2.groups.find(x => x.id === gid);
          if (!g2) break;
          g2.chatEnabled = g2.chatEnabled === false ? true : false;
          scSave(sc2);
          _saveGroupSetting(g2.code, { chatEnabled: g2.chatEnabled });
          toast(g2.chatEnabled ? '💬 Group chat enabled' : '💬 Group chat disabled', 'success');
          renderSocial();
        }
        break;
      }

      case 'sgs-promote': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid      = g.id;
        const shareText= `Join my study group "${g.name}" on Syllabus Tracker!\nCode: ${g.code}${g.description ? '\n' + g.description : ''}`;
        const sc2      = scLoad();
        const g2       = sc2.groups.find(x => x.id === gid);
        if (g2) { g2.promotedAt = Date.now(); scSave(sc2); }
        if (navigator.share) {
          navigator.share({ title: g.name, text: shareText }).catch(() => {});
        } else {
          navigator.clipboard.writeText(shareText)
            .then(() => toast('📣 Invite text copied to clipboard!', 'success'))
            .catch(() => toast(`📣 Share code: ${g.code}`, 'info'));
        }
        renderSocial();
        break;
      }

      case 'sgs-delete-group': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const delCode = g.code;
        confirmModal(`Permanently delete "${g.name}"? This cannot be undone. All group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups   = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks    = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes    = sc2.notes.filter(n => n.groupId !== gid);
          if (sc2.chats)    delete sc2.chats[gid];
          if (sc2.requests) delete sc2.requests[gid];
          scSave(sc2);
          _groupView = null; _settingsView = false; _srTab = 'home'; _stopSrTicker(); _unsubscribeRoomMembers();
          // Delete entire group from Firebase
          const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
          if (db_ && delCode && fb_) {
            const gRef = db_.collection('groups').doc(delCode);
            const subcolls = ['presence','members','messages','joinRequests','voice_signals','voice_presence'];
            Promise.allSettled(subcolls.map(async s => {
              try {
                const snap = await gRef.collection(s).limit(200).get();
                if (snap.empty) return;
                const b = db_.batch();
                snap.docs.forEach(d => b.delete(d.ref));
                await b.commit();
              } catch(_) {}
            })).then(() => gRef.delete().catch(() => {})).catch(() => {});
            if (uid_) {
              db_.collection('users').doc(uid_).set({ joinedRooms: fb_.firestore.FieldValue.arrayRemove(delCode) }, { merge: true }).catch(() => {});
            }
          }
          toast(`"${g.name}" deleted`, 'info');
          renderSocial();
        }, { title:'Delete Group?', yesLabel:'Delete', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      // ── Duel & Tournament Handlers (ds-*) ────────────────────────────────
      case 'ds-sub-tab': {
        const sub = el.dataset.sub;
        if (sub) window.DuelSystem?.setDuelSubTab(sub);
        break;
      }

      case 'ds-open-challenge':
      case 'ds-surrender':
      case 'ds-cancel-duel':
      case 'ds-accept-duel':
      case 'ds-reject-duel':
      case 'ds-create-tournament':
      case 'ds-join-tournament':
      case 'ds-view-tournament':
      case 'ds-leave-tournament':
      case 'ds-delete-tournament':
      case 'ds-admin-tournament':
      case 'ds-end-tournament-early': {
        const _sc_ds = scLoad();
        const _g_ds  = _groupView ? _sc_ds.groups.find(x => x.id === _groupView) : null;
        window.DuelSystem?.handleEvent(act, el, _g_ds);
        break;
      }

      // ── Member Settings Handlers (mbs-*) ─────────────────────────────────
      case 'mbs-nickname': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const myUid_ = getUserId();
        const myMem  = (g.members || []).find(m => m.id === 'me' || m.id === myUid_ || m.uid === myUid_);
        const curNick = myMem?.name || _getUserDisplayName();
        openModal(`
          <h3 class="sc-modal-title">📛 My Nickname in Group</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">This name is shown to other members in this group only.</p>
          <div class="sc-field">
            <input id="mbs-nick-inp" type="text" maxlength="30" value="${esc(curNick)}" class="sc-input" autocomplete="off" placeholder="Your display name"/>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="mbs-nick-save">Save</button>
          </div>
        `, root => {
          const inp = root.querySelector('#mbs-nick-inp');
          inp.focus(); inp.select();
          root.querySelector('#mbs-nick-save').addEventListener('click', () => {
            const val = inp.value.trim();
            if (!val) { toast('Nickname cannot be empty', 'warn'); return; }
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            if (!g2.members) g2.members = [];
            const mem2 = g2.members.find(m => m.id === 'me' || m.id === myUid_ || m.uid === myUid_);
            if (mem2) mem2.name = val;
            scSave(sc2);
            const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
            if (db_ && uid_ && g2.code && fb_) {
              db_.collection('groups').doc(g2.code).collection('members').doc(uid_)
                .set({ displayName: val }, { merge: true }).catch(() => {});
            }
            closeModal(); toast('Nickname updated! 📛', 'success'); renderSocial();
          });
        });
        break;
      }

      case 'mbs-notif': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const curOn = g.notifEnabled !== false;
        openModal(`
          <h3 class="sc-modal-title">🔔 Notification Settings</h3>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
            <div>
              <div style="font-size:15px;font-weight:500;color:var(--text)">Group Notifications</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Receive alerts for group activity</div>
            </div>
            <label class="switch" style="flex-shrink:0">
              <input type="checkbox" id="mbs-notif-toggle" ${curOn ? 'checked' : ''}/>
              <span class="slider"></span>
            </label>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="mbs-notif-save">Save</button>
          </div>
        `, root => {
          root.querySelector('#mbs-notif-save').addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.notifEnabled = root.querySelector('#mbs-notif-toggle').checked;
            scSave(sc2); closeModal();
            toast(g2.notifEnabled ? '🔔 Notifications on' : '🔕 Notifications off', 'success');
            renderSocial();
          });
        });
        break;
      }

      case 'mbs-mute': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const sc2 = scLoad();
        const g2  = sc2.groups.find(x => x.id === gid);
        if (!g2) break;
        g2.muted = !g2.muted;
        scSave(sc2);
        toast(g2.muted ? '🔕 Group muted' : '🔔 Group unmuted', 'success');
        renderSocial();
        break;
      }

      case 'mbs-bookmark': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const sc2 = scLoad();
        const g2  = sc2.groups.find(x => x.id === gid);
        if (!g2) break;
        g2.bookmarked = !g2.bookmarked;
        scSave(sc2);
        toast(g2.bookmarked ? '🔖 Group bookmarked!' : '🔖 Bookmark removed', 'success');
        renderSocial();
        break;
      }

      case 'mbs-share': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const shareText = `Join my study group "${g.name}" on Syllabus Tracker!\nCode: ${g.code}${g.description ? '\n' + g.description : ''}`;
        if (navigator.share) {
          navigator.share({ title: g.name, text: shareText }).catch(() => {});
        } else {
          navigator.clipboard.writeText(shareText)
            .then(() => toast('📤 Invite text copied!', 'success'))
            .catch(() => toast(`Code: ${g.code}`, 'info'));
        }
        break;
      }

      case 'mbs-view-members': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const myUid_ = getUserId();
        const members_ = (g.members || []);
        const rows_ = members_.map(m => {
          const isMe_ = m.id === 'me' || m.id === myUid_ || m.uid === myUid_;
          const role_  = m.role === 'admin' || m.role === 'owner' ? m.role : 'member';
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)">
              <div style="width:36px;height:36px;border-radius:50%;background:${_avatarColor(m.name||'?')};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${esc((m.name||'?')[0].toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">${esc(m.name||'Unknown')} ${isMe_ ? '<span style="color:#7c3aed;font-size:11px">(you)</span>' : ''}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px">${role_ === 'admin' ? '👑 Admin' : role_ === 'owner' ? '👑 Owner' : '✓ Member'}</div>
              </div>
            </div>`;
        }).join('');
        openModal(`
          <h3 class="sc-modal-title">👥 Members (${members_.length})</h3>
          <div style="max-height:300px;overflow-y:auto;padding:4px 0">${rows_ || '<p style="color:#64748b;text-align:center;padding:20px 0">No members listed</p>'}</div>
          <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
        `);
        break;
      }

      case 'mbs-daily-goal': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        toast(`🎯 Group daily goal is ${g.dailyGoalHrs || 8}h. Set by admins.`, 'info', 3000);
        break;
      }

      case 'mbs-report': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        openModal(`
          <h3 class="sc-modal-title">🚨 Report Group</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Why are you reporting this group?</p>
          <div class="sc-field">
            <textarea id="rep-reason" rows="3" maxlength="300" class="sc-textarea" placeholder="Describe the issue…"></textarea>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn btn-danger" id="rep-submit">Submit Report</button>
          </div>
        `, root => {
          root.querySelector('#rep-submit').addEventListener('click', () => {
            closeModal();
            toast('🚨 Report submitted. Thank you.', 'success');
          });
        });
        break;
      }

      case 'sgs-leave-group-settings': {
        const sc  = scLoad();
        const gid = el.dataset.gid;
        const g   = sc.groups.find(x => x.id === gid);
        if (!g) break;
        const leaveCode = g.code;
        confirmModal(`Leave "${g.name}"? Your local group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks  = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes  = sc2.notes.filter(n => n.groupId !== gid);
          if (sc2.chats) delete sc2.chats[gid];
          scSave(sc2);
          if (leaveCode && _groupDocUnsubs[leaveCode]) {
            try { _groupDocUnsubs[leaveCode](); } catch(_e) {}
            delete _groupDocUnsubs[leaveCode];
          }
          _groupView = null; _settingsView = false; _srTab = 'home'; _stopSrTicker(); _unsubscribeRoomMembers();
          // Atomic transaction: delete member doc + decrement only if member exists
          const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
          if (db_ && uid_ && fb_ && leaveCode) {
            const mRefS = db_.collection('groups').doc(leaveCode).collection('members').doc(uid_);
            const gRefS = db_.collection('groups').doc(leaveCode);
            db_.runTransaction(t => t.get(mRefS).then(memberSnap => {
              if (memberSnap.exists) {
                t.delete(mRefS);
                t.update(gRefS, { memberCount: fb_.firestore.FieldValue.increment(-1) });
              }
            })).then(() => _recalcMemberCount(leaveCode)).catch(() => {});
            db_.collection('users').doc(uid_).set({ joinedRooms: fb_.firestore.FieldValue.arrayRemove(leaveCode) }, { merge: true }).catch(() => {});
          }
          toast('Left group.', 'info'); renderSocial();
        }, { title:'Leave Group?', yesLabel:'Leave', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      case 'sr-send-chat': {
        const input  = document.getElementById('sr-chat-input');
        const text   = input ? input.value.trim() : '';
        if (!text) break;
        const gid    = el.dataset.gid;
        const code   = el.dataset.code;
        const author = el.dataset.author || 'You';
        const uid    = getUserId();
        const db     = getDb(), fb = getFb();
        if (input) input.value = '';

        if (_editMsgId && code && db) {
          // ── Update existing message ──────────────────────────────────────
          db.collection('groups').doc(code).collection('messages').doc(_editMsgId)
            .update({ text, isEdited: true }).catch(() => {});
          _editMsgId = null;
          renderSocial();
          break;
        }

        // ── Send new message ─────────────────────────────────────────────
        const payload = {
          authorId:      uid || 'me',
          author,
          text,
          replyToId:     _replyTo?.id    || null,
          replyToText:   _replyTo?.text  || null,
          replyToAuthor: _replyTo?.author || null,
          reactions:     {},
          isEdited:      false,
        };
        _replyTo = null;

        if (db && code && fb) {
          payload.ts = fb.firestore.FieldValue.serverTimestamp();
          db.collection('groups').doc(code).collection('messages').add(payload).catch(() => {});
        } else {
          // Offline fallback — local storage only
          payload.ts = Date.now();
          const sc2 = scLoad();
          if (!sc2.chats) sc2.chats = {};
          if (!sc2.chats[gid]) sc2.chats[gid] = [];
          sc2.chats[gid].push({ id: genId(), ...payload });
          if (sc2.chats[gid].length > 100) sc2.chats[gid] = sc2.chats[gid].slice(-100);
          scSave(sc2);
          if (!_chatMessages[code]) _chatMessages[code] = [];
          _chatMessages[code].push({ id: genId(), ...payload });
          renderSocial();
        }
        // Clear reply bar & scroll
        renderSocial();
        setTimeout(() => {
          const msgs = document.getElementById('sr-chat-msgs');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 60);
        break;
      }

      // ── Off Day toggle ───────────────────────────────────────────────────
      case 'sr-set-offday': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === _groupView);
        if (!g || !g.code) break;
        const uid2  = getUserId();
        const wasOff = _isOffDayToday(uid2);
        _setOffDay(g.code, !wasOff);
        // Optimistic local update
        if (_liveMembers[uid2]) {
          _liveMembers[uid2].isOffDay   = !wasOff;
          _liveMembers[uid2].offDayDate = todayKey();
        }
        toast(!wasOff ? '🛋️ Off Day set — rest well!' : '📚 Back to studying!', 'info');
        renderSocial();
        break;
      }

      // ── Chat: react (from existing reaction pills under messages) ────────
      // One reaction per user: removes any previous emoji before adding new.
      case 'sr-chat-react': {
        const code2 = el.dataset.code;
        const mid   = el.dataset.mid;
        const emoji = el.dataset.emoji;
        const uid3  = getUserId();
        if (!code2 || !mid || !emoji || !uid3) break;
        const db2 = getDb();
        if (!db2) break;
        const msgRef = db2.collection('groups').doc(code2).collection('messages').doc(mid);
        db2.runTransaction(t => t.get(msgRef).then(snap => {
          if (!snap.exists) return;
          const reacs = { ...(snap.data().reactions || {}) };
          // Find current emoji for this user
          let currentEmoji = null;
          Object.entries(reacs).forEach(([e, uids]) => {
            if (Array.isArray(uids) && uids.includes(uid3)) currentEmoji = e;
          });
          // Remove user from all arrays
          Object.keys(reacs).forEach(e => {
            if (Array.isArray(reacs[e])) reacs[e] = reacs[e].filter(u => u !== uid3);
          });
          // Add to new emoji only if different from current (same → toggle off)
          if (emoji !== currentEmoji) {
            if (!Array.isArray(reacs[emoji])) reacs[emoji] = [];
            reacs[emoji].push(uid3);
          }
          // Prune empty arrays
          Object.keys(reacs).forEach(e => { if (!reacs[e].length) delete reacs[e]; });
          t.update(msgRef, { reactions: reacs });
        })).catch(() => {});
        break;
      }

      // ── Chat: scroll to pinned message ───────────────────────────────────
      case 'sr-goto-pin': {
        const pMid  = el.dataset.mid;
        if (!pMid) break;
        const msgsEl = document.getElementById('sr-chat-msgs');
        if (!msgsEl) break;
        const target = msgsEl.querySelector(`.sr-chat-row[data-msg-id="${pMid}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('sr-msg-highlight');
          setTimeout(() => target.classList.remove('sr-msg-highlight'), 1400);
        }
        break;
      }

      // ── Chat: unpin message (admin only, with confirmation) ──────────────
      case 'sr-chat-unpin': {
        const upCode = el.dataset.code;
        if (!upCode) break;
        confirmModal('Remove the pinned message from this group?', () => {
          const db5 = getDb(), fb5 = getFb();
          if (!db5 || !fb5) return;
          db5.collection('groups').doc(upCode)
            .update({ pinnedMsg: fb5.firestore.FieldValue.delete() })
            .then(() => {
              const sc_ = scLoad();
              const gL  = sc_.groups.find(gg => gg.code === upCode);
              if (gL) { gL.pinnedMsg = null; scSave(sc_); }
              renderSocial();
              toast('Unpinned', 'info', 1500);
            }).catch(() => {});
        }, { title: 'Unpin Message?', yesLabel: 'Unpin', yesClass: 'btn btn-danger', noLabel: 'Cancel' });
        break;
      }

      // ── Chat: reply ──────────────────────────────────────────────────────
      case 'sr-chat-reply': {
        const code3 = el.dataset.code;
        const mid2  = el.dataset.mid;
        const msgs2 = _chatMessages[code3] || [];
        const msg2  = msgs2.find(m => m.id === mid2);
        if (!msg2) break;
        _replyTo   = { id: mid2, text: msg2.text || '', author: msg2.author || 'Unknown' };
        _editMsgId = null;
        renderSocial();
        setTimeout(() => document.getElementById('sr-chat-input')?.focus(), 80);
        break;
      }

      // ── Chat: start edit (from context menu) ────────────────────────────
      case 'sr-chat-edit-ctx': {
        const mid3 = el.dataset.mid;
        const txt  = el.dataset.text || '';
        _editMsgId = mid3;
        _replyTo   = null;
        renderSocial();
        setTimeout(() => {
          const inp = document.getElementById('sr-chat-input');
          if (inp) { inp.value = txt; inp.focus(); }
        }, 80);
        break;
      }

      // ── Chat: delete message (legacy data-sc path, auto-unpin if needed) ──
      case 'sr-chat-delete': {
        const code4 = el.dataset.code;
        const mid4  = el.dataset.mid;
        if (!code4 || !mid4) break;
        const db3 = getDb(), fb3b = getFb();
        if (!db3) break;
        const batch3 = db3.batch();
        batch3.update(
          db3.collection('groups').doc(code4).collection('messages').doc(mid4),
          { _deleted: true, text: '' }
        );
        // Auto-unpin if this message is currently pinned
        const sc3 = scLoad();
        const g3  = sc3.groups.find(gg => gg.code === code4);
        if (g3?.pinnedMsg?.id === mid4 && fb3b) {
          batch3.update(db3.collection('groups').doc(code4), { pinnedMsg: fb3b.firestore.FieldValue.delete() });
          g3.pinnedMsg = null; scSave(sc3);
        }
        batch3.commit().catch(() => {});
        break;
      }

      // ── Chat: cancel reply / edit ────────────────────────────────────────
      case 'sr-chat-cancel-reply':
        _replyTo = null;
        renderSocial();
        break;

      case 'sr-chat-cancel-edit':
        _editMsgId = null;
        renderSocial();
        break;

      default: break;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    window._socialRender = renderSocial;
    window._socialFocusUpdate = () => {
      const ms = getMainState(), tk = todayKey();
      const todayMins = (((ms.focusStats || {}).minutesByDate) || {})[tk] || 0;
      // Keep local "me" member state in sync with the main app's focus minutes
      if (todayMins > 0) {
        const sc = scLoad();
        let dirty = false;
        sc.groups.forEach(g => {
          const me = (g.members || []).find(m => m.id === 'me');
          if (me && (me.todayMins !== todayMins || me.todayKey !== tk)) {
            me.todayMins = todayMins;
            me.todayKey  = tk;
            dirty = true;
          }
        });
        if (dirty) scSave(sc);
      }
      // Broadcast to ALL joined groups simultaneously so every group shows
      // the same timer for this user. _writePresenceAllGroups manages the
      // studyStartedAt session-start timestamp correctly (set once, never reset).
      const studying_ = ui().focusIsRunning?.() === true;
      const avStage_  = window._lsGetCurrentAvStage?.() || 0;
      _writePresenceAllGroups(studying_, todayMins, avStage_);
      // Start/stop the global heartbeat based on focus state.
      // The heartbeat keeps activeSessions/{uid}.lastHeartbeatAt fresh so
      // remote viewers can detect ghost sessions via staleness.
      if (studying_) { _startGlobalHeartbeat(); }
      else           { _stopGlobalHeartbeat();  }

      // ── Optimistic local update ─────────────────────────────────────────────
      // Update _liveMembers[myUid] and _activeSessionsCache IMMEDIATELY, without
      // waiting for the Firestore roundtrip (~200-500ms).  This ensures:
      //   • The active counter is correct on the very first render after focus start.
      //   • Member cards flip to active state instantly.
      //   • _srMemberIsActive / _srMemberSeconds return correct values right away.
      const myUid_ = getUserId();
      if (myUid_) {
        if (!_liveMembers[myUid_]) {
          _liveMembers[myUid_] = { uid: myUid_, displayName: _getUserDisplayName() };
        }
        _liveMembers[myUid_].isStudying       = !!studying_;
        _liveMembers[myUid_].elapsedTimeToday = todayMins;
        _liveMembers[myUid_].dateKey           = tk;
        _liveMembers[myUid_].lastUpdated       = Date.now();
        if (studying_ && _mySessionStartedAt) {
          _liveMembers[myUid_].studyStartedAt  = _mySessionStartedAt;
        } else if (!studying_) {
          delete _liveMembers[myUid_].studyStartedAt;
        }
        // Mirror to activeSessions cache so _srMemberIsActive/_srMemberSeconds
        // (and remote users who subscribe to activeSessions) see consistent data.
        _activeSessionsCache[myUid_] = {
          active:    !!studying_,
          startedAt: studying_ ? (_mySessionStartedAt || Date.now()) : null,
          mode:      studying_ ? 'focus' : 'idle',
        };
      }

      // Re-render the social view if it is currently open.
      // This makes the active badge, counter, and member card flip happen
      // without waiting for the next Firestore snapshot.
      if (window._currentTab === 'social') renderSocial();
    };

    // ── App lifecycle / disconnect detection ──────────────────────────────────
    // These listeners write active:false when the user leaves the app so remote
    // viewers see offline state quickly without waiting for heartbeat timeout.

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Tab became visible — resume heartbeat if still studying
        if (ui().focusIsRunning?.()) _startGlobalHeartbeat();
        return;
      }
      // Tab hidden: stop heartbeat so it doesn't fire in background.
      // Staleness detection (PRESENCE_STALE_MS) will naturally mark the
      // user offline after 75 s without a heartbeat — no extra write needed
      // for simply minimizing. Only write active:false if focus was paused.
      _stopGlobalHeartbeat();
      if (!ui().focusIsRunning?.()) _writeOfflineNow();
    });

    const _handleUnload = () => {
      // Tab/app closing: best-effort immediate offline write.
      // Firestore SDK queues the write; even if the tab dies it may flush.
      _stopGlobalHeartbeat();
      _writeOfflineNow();
    };
    window.addEventListener('beforeunload', _handleUnload, { capture: true });
    window.addEventListener('pagehide',     _handleUnload, { capture: true });

    // Network offline: stop heartbeat; staleness detection handles the rest.
    window.addEventListener('offline', () => { _stopGlobalHeartbeat(); });
    // Network back online: resume heartbeat if still studying.
    window.addEventListener('online',  () => {
      if (ui().focusIsRunning?.()) _startGlobalHeartbeat();
    });

    // Start real-time Firebase listeners
    // Use a small delay to ensure the appUI bridge is ready
    setTimeout(() => {
      _subscribePublicGroups();
      _subscribeGlobalLb();
      _subscribeMyGroups();
      _subscribeMyGroupsByOwner();
      _subscribeMyGroupsByAdmin();
      _subscribeGroupDocs();            // per-group doc listeners for live memberCount
      _subscribeMyPendingRequests();    // watch user's own pending join requests
      _restoreGroupsFromFirebase().catch(() => {});
    }, 500);

    // Expose restoration hook so script.js can re-trigger after login.
    // This is needed when the user wasn't logged in at page load (auth modal showing):
    // the 500ms init timeout above fires with uid=null and returns early, so groups
    // would never appear after login without this re-entry point.
    window._socialRestoreGroups = () => { _restoreGroupsFromFirebase().catch(() => {}); };

    // Exposed so script.js can trigger a member-count recalculation after
    // account-deletion cascade without needing access to the social IIFE scope.
    window._socialRecalcMemberCount = (code) => _recalcMemberCount(code);

    // Exposed so script.js (and any future caller) can run the full social-layer
    // cleanup for a UID: cancels active sessions, removes from all group renders,
    // and lets _detectGhostMembers do the Firestore writes on next room open.
    window._socialCascadeCleanupUid = (uid) => {
      if (!uid) return;
      _confirmedOrphans.add(uid);
      delete _liveMembers[uid];
      delete _activeSessionsCache[uid];
      if (_activeSessionsUnsubs[uid])  { try { _activeSessionsUnsubs[uid](); }  catch(_) {} delete _activeSessionsUnsubs[uid]; }
      if (_memberPresenceUnsubs[uid])  { try { _memberPresenceUnsubs[uid](); }  catch(_) {} delete _memberPresenceUnsubs[uid]; }
      if (window._currentTab === 'social') renderSocial();
    };

    // Called by script.js whenever study time is saved (timer stop, session end, pomodoro complete).
    // This writes the updated minutes to all group member docs and triggers stat recalculation
    // so the Discover tab shows live "Xm today" and correct attendance without needing a refresh.
    window._socialOnStudyTimeUpdate = (newTodayMins) => {
      try {
        const mins     = typeof newTodayMins === 'number' ? newTodayMins : 0;
        const isActive = ui().focusIsRunning?.() ?? false;
        const avStage  = window._lsGetCurrentAvStage?.() || 0;
        _writePresenceAllGroups(isActive, mins, avStage);
      } catch(_) {}
    };

    // Reconcile presence on startup and on every auth state change.
    // This writes the user's real today-minutes to all joined group member docs,
    // correcting any stale 0-minute docs that existed before the batch-write fix.
    // Also writes the global users/{uid} canonical presence doc.
    window._socialReconcilePresence = () => {
      // Small delay so Firebase auth and main state are both ready
      setTimeout(_reconcileAllGroupPresence, 1500);
    };
    // Fire once on initial load (covers the signed-in-at-page-load case)
    setTimeout(_reconcileAllGroupPresence, 2000);

    // Syncs the current user's display name to all their group member documents.
    // Called by script.js immediately after the user saves profile changes so
    // other members see the new name without waiting for the next focus session.
    window._socialSyncProfile = () => {
      const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
      if (!db_ || !uid_ || !fb_) return;
      const newName = _getUserDisplayName();
      // Update displayNameAuto on the user's own doc
      db_.collection('users').doc(uid_)
        .set({ displayNameAuto: newName }, { merge: true }).catch(() => {});
      const sc_ = scLoad();
      // Patch every group member doc this user belongs to
      sc_.groups.forEach(g => {
        if (!g.code) return;
        db_.collection('groups').doc(g.code).collection('members').doc(uid_)
          .set({ displayName: newName }, { merge: true }).catch(() => {});
      });
      // Also update createdByName / leader for groups this user owns
      sc_.groups.forEach(g => {
        if (!g.code) return;
        if (g.createdByUid === uid_ || g.ownerUid === uid_) {
          db_.collection('groups').doc(g.code)
            .set({ leader: newName, createdByName: newName }, { merge: true }).catch(() => {});
        }
      });
    };

    window._socialDestroy = () => {
      _destroyed = true;
      _unsubscribeGlobalLb();
      _unsubscribeRoomMembers();
      if (_publicGroupsUnsub)      { try { _publicGroupsUnsub();      } catch(_) {} _publicGroupsUnsub      = null; }
      if (_myGroupsUnsub)          { try { _myGroupsUnsub();          } catch(_) {} _myGroupsUnsub          = null; }
      if (_myGroupsByOwnerUnsub)   { try { _myGroupsByOwnerUnsub();   } catch(_) {} _myGroupsByOwnerUnsub   = null; }
      if (_myGroupsByAdminUnsub)   { try { _myGroupsByAdminUnsub();   } catch(_) {} _myGroupsByAdminUnsub   = null; }
      // Tear down all group-doc listeners
      Object.keys(_groupDocUnsubs).forEach(k => {
        try { _groupDocUnsubs[k](); } catch(_) {}
        delete _groupDocUnsubs[k];
      });
      // Tear down all join-requests listeners
      Object.keys(_joinRequestsUnsubs).forEach(k => {
        try { _joinRequestsUnsubs[k](); } catch(_) {}
        delete _joinRequestsUnsubs[k];
      });
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  GROUP MEMBER PROFILE MODAL
  //  Opens a full-screen slide-up sheet with study stats, heatmap, level/rank,
  //  achievements and social info for any group member.
  // ═══════════════════════════════════════════════════════════════════════════

  // Local date arithmetic — no dependency on script.js addDaysISO
  function _mpDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function _mpAddDays(yyyy_mm_dd, days) {
    const d = new Date(yyyy_mm_dd + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return _mpDateKey(d);
  }
  function _mpFmtMin(m) {
    if (!m || m <= 0) return '0m';
    const h = Math.floor(m / 60), min = m % 60;
    return h > 0 ? `${h}h${min > 0 ? ` ${min}m` : ''}` : `${min}m`;
  }
  function _mpFmtDate(ts) {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    } catch(_) { return ''; }
  }

  // ── Member-profile calendar state ────────────────────────────────────────
  let _mpCalViewDate  = null;
  let _mpCalMbd       = {};
  let _mpCalInstallStr = '';

  function _mpBuildCalendarInnerHTML() {
    const mbd        = _mpCalMbd;
    const installStr = _mpCalInstallStr;
    const todayStr   = todayKey ? todayKey() : _mpDateKey(new Date());
    if (!_mpCalViewDate) _mpCalViewDate = new Date();
    const vd = _mpCalViewDate;
    const vy = vd.getFullYear(), vm = vd.getMonth();
    const mp = `${String(vy).padStart(4,'0')}-${String(vm+1).padStart(2,'0')}`;
    let monthMin = 0;
    Object.entries(mbd).forEach(([k,v]) => { if (k.startsWith(mp)) monthMin += v; });
    const mFmt = monthMin > 0 ? _mpFmtMin(monthMin) + ' this month' : 'No study data';
    const now  = new Date();
    const inst = new Date((installStr || todayStr) + 'T00:00:00');
    const canPrev = !(vy < inst.getFullYear() || (vy === inst.getFullYear() && vm <= inst.getMonth()));
    const canNext = !(vy > now.getFullYear() || (vy === now.getFullYear() && vm >= now.getMonth()));
    const monthLabel  = vd.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstDow    = (new Date(vy, vm, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(vy, vm + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += `<div class="mp-cal-cell mp-cal-empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const ds       = `${mp}-${String(d).padStart(2,'0')}`;
      const isFuture = ds > todayStr, isToday = ds === todayStr;
      const min = mbd[ds] || 0, hrs = min / 60;
      const isOff = !isFuture && !isToday && min === 0 && installStr && ds >= installStr;
      const lvl = isFuture ? 'mp-cal-future'
        : isOff  ? 'lv-off'
        : min === 0 ? 'lv0'
        : hrs < 3   ? 'lv1'
        : hrs < 6   ? 'lv2'
        : hrs < 9   ? 'lv3'
        : hrs < 12  ? 'lv4' : 'lv5';
      const tip = isFuture ? '—' : isOff ? 'Off day'
        : min === 0 ? 'No focus'
        : min < 60  ? `${min}m` : `${Math.floor(min/60)}h${min%60?' '+min%60+'m':''}`;
      cells += `<div class="mp-cal-cell ${lvl}${isToday?' mp-cal-today':''}" title="${tip}">${d}</div>`;
    }
    return `
      <div class="mp-cal-header">
        <button class="mp-cal-nav" id="mp-cal-prev" aria-label="Prev" ${canPrev?'':'disabled'}>‹</button>
        <div class="mp-cal-month-info">
          <div class="mp-cal-month-label">${monthLabel}</div>
          <div class="mp-cal-month-sub">${mFmt}</div>
        </div>
        <button class="mp-cal-nav" id="mp-cal-next" aria-label="Next" ${canNext?'':'disabled'}>›</button>
      </div>
      <div class="mp-cal-dow-row"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
      <div class="mp-cal-cells">${cells}</div>
      <div class="mp-cal-legend">
        <div class="mp-cal-leg-item"><div class="mp-cal-cell lv-off mp-cal-leg-swatch"></div><span>Off</span></div>
        <span class="mp-cal-leg-txt">Less</span>
        <div class="mp-cal-cell lv0 mp-cal-leg-swatch"></div>
        <div class="mp-cal-cell lv1 mp-cal-leg-swatch"></div>
        <div class="mp-cal-cell lv2 mp-cal-leg-swatch"></div>
        <div class="mp-cal-cell lv3 mp-cal-leg-swatch"></div>
        <div class="mp-cal-cell lv4 mp-cal-leg-swatch"></div>
        <div class="mp-cal-cell lv5 mp-cal-leg-swatch"></div>
        <span class="mp-cal-leg-txt">More</span>
        <div class="mp-cal-leg-scale">
          <span style="color:rgba(248,113,113,.8)">Off</span><span>0h</span>
          <span style="color:rgba(167,108,255,.95)">1–3h</span>
          <span style="color:rgba(6,182,212,.95)">3–6h</span>
          <span style="color:#4ade80">6–9h</span>
          <span style="color:#f97316">9–12h</span>
          <span style="color:#ef4444">12h+</span>
        </div>
      </div>`;
  }

  function _mpBindCalNav(sheetEl) {
    const ctr = sheetEl.querySelector('#mp-cal-container');
    if (!ctr) return;
    const prev = ctr.querySelector('#mp-cal-prev');
    const next = ctr.querySelector('#mp-cal-next');
    if (prev) prev.onclick = () => {
      _mpCalViewDate = new Date(_mpCalViewDate.getFullYear(), _mpCalViewDate.getMonth() - 1, 1);
      ctr.innerHTML = _mpBuildCalendarInnerHTML();
      _mpBindCalNav(sheetEl);
    };
    if (next) next.onclick = () => {
      _mpCalViewDate = new Date(_mpCalViewDate.getFullYear(), _mpCalViewDate.getMonth() + 1, 1);
      ctr.innerHTML = _mpBuildCalendarInnerHTML();
      _mpBindCalNav(sheetEl);
    };
  }

  function _closeMemberProfile() {
    const overlay = document.getElementById('mp-overlay');
    if (!overlay) return;
    const sheet = document.getElementById('mp-sheet');
    if (sheet) sheet.classList.remove('mp-sheet-open');
    setTimeout(() => overlay.remove(), 340);
  }

  async function _openMemberProfile(uid, displayName, groupCode) {
    document.getElementById('mp-overlay')?.remove();
    _mpCalViewDate = null;
    const myUid  = getUserId();
    const isSelf = uid === myUid;

    // ── Skeleton overlay ──────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id    = 'mp-overlay';
    overlay.className = 'mp-overlay';
    overlay.innerHTML = `
      <div class="mp-sheet" id="mp-sheet">
        <div class="mp-handle"></div>
        <div class="mp-skel-banner"></div>
        <div class="mp-body">
          <div class="mp-skel-row mp-skel-name"></div>
          <div class="mp-skel-row mp-skel-rank"></div>
          <div class="mp-skel-row mp-skel-bar"></div>
          <div class="mp-skel-stats"></div>
          <div class="mp-skel-row" style="height:120px;margin-top:16px;border-radius:12px"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('mp-sheet')?.classList.add('mp-sheet-open');
    }));
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeMemberProfile(); });

    // ── Fetch data ────────────────────────────────────────────────────────
    let userData    = {};
    let parsedState = null;
    const db        = getDb();

    if (isSelf && window._sc_getMyState) {
      parsedState = window._sc_getMyState();
      const lm    = _liveMembers[uid] || {};
      userData = {
        displayName:      _getUserDisplayName() || displayName,
        isStudying:       !!(window._scIsStudying?.() || lm.isStudying),
        studyStartedAt:   lm.studyStartedAt || null,
        currentSubject:   lm.currentSubject  || '',
        elapsedTimeToday: lm.elapsedTimeToday || 0,
        joinedAt:         null,
        role:             'me',
      };
    } else {
      try {
        if (db && uid) {
          const snap = await db.collection('users').doc(uid).get();
          if (snap.exists) {
            const raw = snap.data() || {};
            userData  = raw;
            if (raw.data) { try { parsedState = JSON.parse(raw.data); } catch(_) {} }
          }
        }
      } catch(_) {}
      // Merge live presence on top of Firestore snapshot
      const lm = _liveMembers[uid] || {};
      if (lm.isStudying     != null) userData.isStudying      = lm.isStudying;
      if (lm.currentSubject)         userData.currentSubject  = lm.currentSubject;
      if (lm.elapsedTimeToday != null) userData.elapsedTimeToday = lm.elapsedTimeToday;
      if (lm.studyStartedAt)         userData.studyStartedAt  = lm.studyStartedAt;
      if (lm.displayName && !userData.displayName) userData.displayName = lm.displayName;
      if (lm.role)                   userData.role            = lm.role;
    }

    // ── Render ────────────────────────────────────────────────────────────
    const sheet = document.getElementById('mp-sheet');
    if (!sheet) return;
    sheet.classList.remove('mp-skel-loading');
    sheet.innerHTML =
      '<div class="mp-handle"></div>' +
      _buildMemberProfileHTML(uid, displayName, userData, parsedState, isSelf, groupCode);

    sheet.querySelector('.mp-close-btn')
         ?.addEventListener('click', _closeMemberProfile);
    _mpBindCalNav(sheet);
  }

  function _buildMemberProfileHTML(uid, displayName, userData, parsedState, isSelf, groupCode) {
    const name        = (userData.displayName || displayName || 'Unknown').trim();
    const avatarColor = _avatarColor(name);
    const avatarLetter= (name[0] || '?').toUpperCase();

    // ── XP & Level ────────────────────────────────────────────────────────
    const xpTotal = parsedState?.xp?.total || 0;
    const lvInfo  = window._sc_calculateLevel
      ? window._sc_calculateLevel(xpTotal)
      : { level: 1, percent: 0, currentLevelXP: 0, nextLevelXP: 100 };

    // ── Focus stats ────────────────────────────────────────────────────────
    const mbd      = parsedState?.focusStats?.minutesByDate || {};
    const today    = todayKey ? todayKey() : _mpDateKey(new Date());
    const totalMin = Object.values(mbd).reduce((a, b) => a + b, 0);
    // Today: prefer live elapsedTimeToday when studying, fall back to stored
    const liveTodayMin = (userData.isStudying && userData.elapsedTimeToday)
      ? userData.elapsedTimeToday : 0;
    const todayMin = Math.max(liveTodayMin, mbd[today] || 0);

    let weekMin = 0;
    for (let i = 0; i < 7;  i++) weekMin  += mbd[_mpAddDays(today, -i)] || 0;
    let monthMin = 0;
    for (let i = 0; i < 30; i++) monthMin += mbd[_mpAddDays(today, -i)] || 0;

    // Sessions
    const sbd          = parsedState?.focusStats?.sessions || {};
    const totalSess    = Object.values(sbd).reduce((a, b) => a + b, 0);

    // ── Rank ──────────────────────────────────────────────────────────────
    const totalHrs = totalMin / 60;
    const rank     = window._sc_calculateRank
      ? window._sc_calculateRank(totalHrs)
      : { label: 'Seeker', icon: '🌱', color: '#94a3b8', glow: 'rgba(148,163,184,0.45)', pct: 0, next: null, hrsToNext: 0, group: 'Novice', tierIndex: 0 };

    // ── Streak ────────────────────────────────────────────────────────────
    const focusStreak  = parsedState?.focusStreak || {};
    const legStreak    = parsedState?.streak       || {};
    const streakCount  = focusStreak.count  || legStreak.count || 0;
    const bestStreak   = Math.max(focusStreak.best || 0, legStreak.best || 0, streakCount);

    // ── Max session ───────────────────────────────────────────────────────
    const maxSess = Math.max(0, ...Object.values(parsedState?.focusStats?.maxSessionMin || {}));

    // ── Live session times ────────────────────────────────────────────────
    const isStudying = !!userData.isStudying;
    const subject    = (userData.currentSubject || '').trim();
    let startStr = '';
    if (isStudying && userData.studyStartedAt) {
      try {
        const t = typeof userData.studyStartedAt === 'number'
          ? userData.studyStartedAt
          : userData.studyStartedAt.toMillis?.() || Number(userData.studyStartedAt);
        startStr = new Date(t).toLocaleTimeString(undefined,
          { hour: 'numeric', minute: '2-digit', hour12: true });
      } catch(_) {}
    }

    // ── Last active ───────────────────────────────────────────────────────
    const lmData = _liveMembers[uid] || {};
    const isOnline = isStudying || (!_isMemberStale(lmData) && lmData.lastHeartbeatAt);
    const lastSeenStr = (!isStudying && lmData.lastHeartbeatAt) ? _fmtLastSeen(lmData) : '';

    // ── Joined date ───────────────────────────────────────────────────────
    const joinedStr = _mpFmtDate(userData.joinedAt || userData.createdAt);

    // ── Role ──────────────────────────────────────────────────────────────
    const role = userData.role || lmData.role || '';
    const roleLabel = role === 'owner' ? '👑 Owner'
                    : role === 'admin' ? '🛡 Admin'
                    : isSelf           ? '👤 You'
                    : '';

    // ── Group rank by today's focus ───────────────────────────────────────
    const ranked = Object.entries(_liveMembers)
      .map(([u, d]) => ({ uid: u, mins: d.elapsedTimeToday || 0 }))
      .sort((a, b) => b.mins - a.mins);
    const gRankIdx = ranked.findIndex(e => e.uid === uid);
    const groupRankStr = gRankIdx >= 0 && ranked[gRankIdx].mins > 0
      ? `#${gRankIdx + 1} in group today` : '';

    // ── Calendar state (shared with _mpBuildCalendarInnerHTML) ───────────
    const installStr = parsedState?.burnout?.installDate || today;
    _mpCalMbd        = mbd;
    _mpCalInstallStr = installStr;
    if (!_mpCalViewDate) _mpCalViewDate = new Date();

    // ── Custom badge & title ──────────────────────────────────────────────
    const badgeId   = ((parsedState?.customBadgeOwned || (parsedState?.inventory?.custom_badge || 0) > 0) && parsedState?.selectedBadge)
      ? parsedState.selectedBadge : '';
    const badgeHTML = window._cmkBadgeHTML ? window._cmkBadgeHTML(badgeId) : '';
    const titleHTML = window._cmkTitleHTML ? window._cmkTitleHTML(parsedState?.equippedItems) : '';

    // ── Tagline ────────────────────────────────────────────────────────────
    const tagline = (parsedState?.profile?.tagline || '').trim();

    // ── Upcoming exam ──────────────────────────────────────────────────────
    const exams = Array.isArray(parsedState?.exams) ? parsedState.exams : [];
    const upcomingExam = exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;

    // ── Syllabus progress (chapter-based) ─────────────────────────────────
    const subjects = Array.isArray(parsedState?.subjects) ? parsedState.subjects : [];
    function _mpChDone(ch) {
      const tops = ch.topics || [];
      if (tops.length === 0) return !!ch.done;
      return tops.every(t => t.done);
    }
    const subjectProgress = subjects.map(sub => {
      let chTot = 0, chDn = 0;
      for (const ch of (sub.chapters || [])) { chTot++; if (_mpChDone(ch)) chDn++; }
      const pct = chTot ? Math.round((chDn / chTot) * 100) : 0;
      return { name: sub.name, color: sub.color || '#ff7a1a', pct, chDn, chTot };
    }).filter(s => s.chTot > 0);
    let allChTot = 0, allChDn = 0;
    subjectProgress.forEach(s => { allChTot += s.chTot; allChDn += s.chDn; });
    const overallSylPct = allChTot > 0 ? Math.round((allChDn / allChTot) * 100) : 0;

    // ── Achievements ──────────────────────────────────────────────────────
    const ACHS         = window._sc_ACHIEVEMENTS || [];
    const badges       = parsedState?.badges || {};
    const tierColor    = { easy: '#22c55e', medium: '#38bdf8', hard: '#f59e0b' };
    const unlockedAchs = ACHS.filter(a => badges[a.id]);
    const lockedAchs   = ACHS.filter(a => !badges[a.id]).slice(0, Math.max(0, 6 - unlockedAchs.length));

    // ── Banner gradient based on rank color ───────────────────────────────
    const bannerBg = `linear-gradient(160deg, ${rank.color}28 0%, #0f172a 55%)`;

    // ── Avg daily ─────────────────────────────────────────────────────────
    const activeDays = Object.values(mbd).filter(v => v > 0).length;
    const avgDayMin  = activeDays > 0 ? Math.round(totalMin / activeDays) : 0;

    return `
      <div class="mp-banner" style="background:${bannerBg}">
        <button class="mp-close-btn" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="mp-av-wrap">
          <div class="mp-avatar" style="background:${avatarColor};box-shadow:0 0 0 3px ${rank.color}66,0 0 22px ${rank.color}33">${avatarLetter}</div>
          <div class="mp-status-dot ${isStudying ? 'mp-dot-live' : isOnline ? 'mp-dot-online' : 'mp-dot-offline'}"></div>
        </div>
        <div class="mp-banner-status">
          ${isStudying
            ? `<span class="mp-banner-live-badge"><span class="mp-live-pulse"></span>LIVE</span>${subject ? `<span class="mp-banner-subj">${esc(subject)}</span>` : ''}`
            : isOnline
              ? '<span class="mp-banner-online">● Online</span>'
              : lastSeenStr ? `<span class="mp-banner-offline">Last seen ${lastSeenStr}</span>` : ''}
        </div>
      </div>

      <div class="mp-body">
        <!-- Identity -->
        <div class="mp-identity-row">
          <div class="mp-display-name">${esc(name)}</div>
          ${roleLabel ? `<div class="mp-role-chip">${roleLabel}</div>` : ''}
        </div>
        ${tagline ? `<div class="mp-tagline">"${esc(tagline)}"</div>` : ''}
        ${(badgeHTML || titleHTML) ? `<div class="mp-badge-title-row">${badgeHTML}${titleHTML}</div>` : ''}
        <div class="mp-meta-row">
          <div class="mp-rank-pill" style="color:${rank.color};border-color:${rank.color}44;background:${rank.color}12">${rank.icon} ${rank.label}</div>
          ${joinedStr ? `<div class="mp-joined-str">📅 Since ${joinedStr}</div>` : ''}
        </div>

        <!-- XP Bar -->
        <div class="mp-xp-section">
          <div class="mp-xp-label-row">
            <span class="mp-xp-level" style="color:${rank.color}">Level ${lvInfo.level}</span>
            <span class="mp-xp-nums">${xpTotal.toLocaleString()} XP total</span>
          </div>
          <div class="mp-xp-track">
            <div class="mp-xp-fill" style="width:${lvInfo.percent}%;background:linear-gradient(90deg,${rank.color}88,${rank.color})${lvInfo.percent > 0 ? ';min-width:6px' : ''}"></div>
          </div>
          <div class="mp-xp-sub-row">
            <span>${lvInfo.currentLevelXP.toLocaleString()} / ${lvInfo.nextLevelXP.toLocaleString()} XP to next level</span>
            ${groupRankStr ? `<span class="mp-group-rank-str">${groupRankStr}</span>` : ''}
          </div>
        </div>

        <!-- Live Focus Banner -->
        ${isStudying ? `
        <div class="mp-live-banner">
          <span class="mp-live-pulse-dot"></span>
          <div class="mp-live-banner-text">
            <strong>Currently Studying</strong>${subject ? ` · ${esc(subject)}` : ''}
            ${startStr ? `<div class="mp-live-banner-since">Started at ${startStr}</div>` : ''}
          </div>
          <div class="mp-live-banner-time">${_mpFmtMin(todayMin)}</div>
        </div>` : ''}

        <!-- Stats Grid -->
        <div class="mp-section-title">Study Stats</div>
        <div class="mp-stats-grid">
          <div class="mp-stat-card">
            <div class="mp-stat-val">${_mpFmtMin(todayMin)}</div>
            <div class="mp-stat-lbl">Today</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">${_mpFmtMin(weekMin)}</div>
            <div class="mp-stat-lbl">This Week</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">${_mpFmtMin(monthMin)}</div>
            <div class="mp-stat-lbl">This Month</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">${_mpFmtMin(totalMin)}</div>
            <div class="mp-stat-lbl">All Time</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">🔥 ${streakCount}</div>
            <div class="mp-stat-lbl">Streak</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">🏆 ${bestStreak}</div>
            <div class="mp-stat-lbl">Best Streak</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">${_mpFmtMin(avgDayMin)}</div>
            <div class="mp-stat-lbl">Avg / Day</div>
          </div>
          <div class="mp-stat-card">
            <div class="mp-stat-val">${totalSess}</div>
            <div class="mp-stat-lbl">Sessions</div>
          </div>
        </div>

        <!-- Focus Calendar -->
        <div class="mp-section-title">Focus Calendar</div>
        <div class="mp-cal-wrap" id="mp-cal-container">
          ${_mpBuildCalendarInnerHTML()}
        </div>

        <!-- Rank Card -->
        <div class="mp-section-title">Rank Progress</div>
        <div class="mp-rank-card" style="border-color:${rank.color}33">
          <div class="mp-rank-card-top">
            <span class="mp-rank-big-icon">${rank.icon}</span>
            <div class="mp-rank-card-info">
              <div class="mp-rank-label" style="color:${rank.color}">${rank.label}</div>
              <div class="mp-rank-group" style="color:${rank.color}99">${rank.group || ''} · Tier #${(rank.tierIndex || 0) + 1}</div>
            </div>
            <div class="mp-rank-total">${Math.floor(totalHrs)}h</div>
          </div>
          <div class="mp-rank-bar-track">
            <div class="mp-rank-bar-fill" style="width:${rank.pct}%;background:linear-gradient(90deg,${rank.color}88,${rank.color})"></div>
          </div>
          <div class="mp-rank-next">
            ${rank.next
              ? `🎯 ${rank.hrsToNext}h more → ${rank.next.icon} <strong style="color:${rank.next.color}">${rank.next.label}</strong>`
              : `<span style="color:${rank.color}">✦ Maximum rank achieved — Legend status</span>`}
          </div>
        </div>

        <!-- Target Exam -->
        ${upcomingExam ? (() => {
          const daysLeft = Math.ceil((new Date(upcomingExam.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
          const urgency  = daysLeft <= 7 ? 'high' : daysLeft <= 21 ? 'med' : 'low';
          const uColor   = urgency === 'high' ? '#f87171' : urgency === 'med' ? '#f59e0b' : '#4ade80';
          const uLabel   = urgency === 'high' ? '⚠️ Urgent' : urgency === 'med' ? '⏳ On Track' : '✅ Comfortable';
          const dLabel   = daysLeft > 0 ? `${daysLeft}d left` : daysLeft === 0 ? 'Today!' : `${Math.abs(daysLeft)}d ago`;
          return `<div class="mp-section-title">Target Exam</div>
        <div class="mp-exam-card" style="--ec:${uColor}">
          <div class="mp-exam-icon">🎯</div>
          <div class="mp-exam-info">
            <div class="mp-exam-name">${esc(upcomingExam.name)}</div>
            <div class="mp-exam-date">${upcomingExam.date} · ${dLabel}</div>
          </div>
          <span class="mp-exam-badge" style="color:${uColor};border-color:${uColor}44;background:${uColor}14">${uLabel}</span>
        </div>`;
        })() : ''}

        <!-- Syllabus Progress -->
        ${subjectProgress.length ? `
        <div class="mp-section-title">Syllabus <span class="mp-section-sub">${overallSylPct}% · ${allChDn}/${allChTot} chapters</span></div>
        <div class="mp-syl2-overall-wrap">
          <div class="mp-syl2-overall-track">
            <div class="mp-syl2-overall-fill" style="width:${overallSylPct}%"></div>
          </div>
          <span class="mp-syl2-overall-pct">${overallSylPct}%</span>
        </div>
        <div class="mp-syl2-grid">
          ${subjectProgress.slice(0, 6).map(s => `
          <div class="mp-syl2-card" style="--sc:${s.color}">
            <div class="mp-syl2-card-header">
              <span class="mp-syl2-dot" style="background:${s.color};box-shadow:0 0 5px ${s.color}66"></span>
              <span class="mp-syl2-name">${esc(s.name)}</span>
              <span class="mp-syl2-pct" style="color:${s.color}">${s.pct}%</span>
            </div>
            <div class="mp-syl2-bar-track">
              <div class="mp-syl2-bar-fill" style="width:${s.pct}%;background:linear-gradient(90deg,${s.color},${s.color}88)"></div>
            </div>
            <div class="mp-syl2-ch-label">${s.chDn} / ${s.chTot} Chapter${s.chTot !== 1 ? 's' : ''}</div>
          </div>`).join('')}
        </div>` : ''}

        <!-- Achievements -->
        <div class="mp-section-title">Achievements <span class="mp-section-sub">${unlockedAchs.length} / ${ACHS.length}</span></div>
        <div class="mp-badges-grid">
          ${unlockedAchs.map(a => {
            const c = tierColor[a.tier] || '#fbbf24';
            // Parse hex → r,g,b for cross-browser rgba usage
            const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
            return `
            <div class="mp-badge mp-badge-unlocked" style="--ac-bg:rgba(${r},${g},${b},0.10);--ac-bd:rgba(${r},${g},${b},0.28)" title="${esc(a.desc)}">
              <div class="mp-badge-icon">${a.icon}</div>
              <div class="mp-badge-name" style="color:rgba(${r},${g},${b},0.9)">${esc(a.name)}</div>
            </div>`;
          }).join('')}
          ${lockedAchs.map(a => `
            <div class="mp-badge mp-badge-locked" title="${esc(a.desc)}">
              <div class="mp-badge-icon mp-badge-icon-locked">🔒</div>
              <div class="mp-badge-name mp-badge-name-locked">${esc(a.name)}</div>
            </div>`).join('')}
          ${unlockedAchs.length === 0 && lockedAchs.length === 0
            ? '<div class="mp-no-data">No achievement data available</div>' : ''}
        </div>

        <div style="height:40px"></div>
      </div>`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
