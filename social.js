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
      // admin: in admins[] array
      const admins = Array.isArray(g.admins) ? g.admins : [];
      if (admins.includes(uid)) return 'admin';
      // role field set by _subscribeMyGroups (owner always gets 'admin' here)
      if (g.role === 'owner' || g.role === 'admin') return 'admin';
      // member: in members[] or stored role
      const me = (g.members || []).find(m => m != null && ((m.id || m.uid) === uid));
      if (me) return (me.role === 'admin' || me.role === 'owner') ? 'admin' : 'member';
      if (g.role === 'member') return 'member';
      return null;
    } catch(_) { return null; }
  }

  // Auto-migrate old group document — adds missing ownerUid/admins fields to Firestore
  function _autoMigrateGroupDoc(code, data, uid) {
    const db = getDb(), fb_ = getFb();
    if (!db || !fb_ || !code) return;
    const patch = {};
    if (!data.ownerUid && data.createdByUid)  patch.ownerUid = data.createdByUid;
    if (!data.ownerUid && !data.createdByUid) patch.ownerUid = uid;
    if (!data.createdByUid)                   patch.createdByUid = uid;
    const admins = Array.isArray(data.admins) ? data.admins : [];
    if (!admins.includes(uid)) patch.admins = fb_.firestore.FieldValue.arrayUnion(uid);
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
          if (changed) {
            scSave(sc2);
            if ((_tab === 'groups' || _tab === 'rooms') && !_groupView && !_destroyed) _scheduleRender();
          }
        }, () => { delete _groupDocUnsubs[g.code]; });
      } catch(_) { delete _groupDocUnsubs[g.code]; }
    });
  }
  // Call after any group list change to ensure all groups are covered
  function _ensureGroupDocSubs() {
    try { _subscribeGroupDocs(); } catch(_) {}
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
        groups:   Array.isArray(d.groups) ? d.groups : [],
        tasks:    Array.isArray(d.tasks)  ? d.tasks  : [],
        notes:    Array.isArray(d.notes)  ? d.notes  : [],
        chats:    (d.chats    && typeof d.chats    === 'object') ? d.chats    : {},
        requests: (d.requests && typeof d.requests === 'object') ? d.requests : {},
      };
    } catch(_) { return { groups: [], tasks: [], notes: [], chats: {} }; }
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
  let _publicGroups        = [];
  let _publicGroupsUnsub   = null;
  let _myGroupsUnsub       = null;
  let _memberUnsub         = null;
  let _liveMembers         = {};
  let _globalLbData        = [];
  let _globalLbUnsub       = null;
  // Chat state
  let _chatUnsub           = null;
  let _chatMessages        = {};   // { groupCode: Message[] }
  let _chatGid             = null; // group code currently subscribed to chat
  let _replyTo             = null; // { id, text, author } — message being replied to
  let _editMsgId           = null; // string msgId currently being edited
  // Group doc live subscriptions (for real-time memberCount in Your Groups list)
  const _groupDocUnsubs    = {};   // { code: unsubFn }
  let _liveSubscribedCode  = null; // code currently subscribed to in _subscribeRoomMembers

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
  function _weekStart() {
    const d = new Date(), day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }

  function _subscribeGlobalLb() {
    if (_globalLbUnsub) return;
    const db = getDb();
    if (!db) { setTimeout(_subscribeGlobalLb, 1500); return; }
    try {
      _globalLbUnsub = db.collection('global_lb')
        .orderBy('dailyStudyTime', 'desc')
        .limit(200)
        .onSnapshot(snap => {
          _globalLbData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          if (_tab === 'leaderboard' && window._currentTab === 'social') _scheduleRender();
        }, () => { _globalLbUnsub = null; });
    } catch(_) { _globalLbUnsub = null; }
  }

  function _unsubscribeGlobalLb() {
    if (_globalLbUnsub) { try { _globalLbUnsub(); } catch(_) {} _globalLbUnsub = null; }
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

    // Use Firebase public groups for discovery feed; fall back to local groups
    let groups = _publicGroups.length > 0
      ? _publicGroups.map(g => ({
          ...g,
          role: sc.groups.find(x => x.code === g._fbCode)?.role ?? null,
        }))
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
    const dailyMinsTotal = g.dailyMinsTotal || (studying ? todayMins : 0);
    const attendancePct  = g.attendancePct
      || ((studying && memberCount > 0) ? Math.min(100, Math.round(1 / memberCount * 100)) : 0);
    const col            = _catColor(category);
    const myRole         = _getMyRole(g);
    const isOwner        = myRole === 'owner';
    const isAdmin        = myRole === 'admin' || isOwner;
    const isMember       = myRole === 'member' || isAdmin;
    const promoHTML      = promoted ? ' · <span class="sc-promo-badge">Promoted</span>' : '';
    const categoryUpper  = category.toUpperCase();

    let roleBadge;
    if (isOwner)       roleBadge = `<span class="sc-disc-role sc-role-owner">👑 Admin</span>`;
    else if (isAdmin)  roleBadge = `<span class="sc-disc-role sc-role-admin">🛡 Admin</span>`;
    else if (isMember) roleBadge = `<span class="sc-disc-role sc-role-member">✓ Member</span>`;
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

    if (sc.groups.length === 0) {
      return `
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

    return `
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
    const members = g.members || [];
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
              : members.map(m => `
                  <div class="sc-member-row">
                    <div class="sc-member-av" style="background:${_avatarColor(m.name)}">${(m.name||'?')[0].toUpperCase()}</div>
                    <span class="sc-member-name">${esc(m.name||'Unknown')}</span>
                    <span class="sc-member-badge sc-badge-${m.role==='admin'?'admin':'member'}">${m.role==='admin'?'Admin':'Member'}</span>
                  </div>`).join('')}
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

  function _srMemberIsActive(m) {
    if (m.id === 'me') return ui().focusIsRunning?.() === true;
    const uid = m.id || m.uid;
    if (uid && _liveMembers[uid]) return !!_liveMembers[uid].isStudying;
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
    if (uid && _liveMembers[uid]) {
      const lm = _liveMembers[uid];
      const baseMins = (lm.dateKey === tk ? (lm.elapsedTimeToday || 0) : 0);
      const extra = lm.isStudying
        ? Math.floor((Date.now() - (lm.studyStartedAt || Date.now())) / 1000)
        : 0;
      return baseMins * 60 + extra;
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
      // Also update timers for Firebase-only members
      Object.keys(_liveMembers).forEach(uid => {
        const timerEl = view.querySelector(`[data-sr-timer="${uid}"]`);
        if (timerEl) timerEl.textContent = _fmtSecs(_srMemberSeconds({ id: uid }));
      });

      const me = (g.members || []).find(x => x.id === 'me');
      const fbActiveCount = Object.values(_liveMembers).filter(x => x.isStudying).length;
      const meActive = me ? _srMemberIsActive(me) : false;
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

      // Broadcast self presence to Firebase every 30 ticks (~30 s)
      _srTickCount++;
      if (_srTickCount % 30 === 0 && g.code) {
        const ms_ = getMainState(), tk_ = todayKey();
        const todayMins_ = ((ms_.focusStats || {}).minutesByDate || {})[tk_] || 0;
        const avStage_   = window._lsGetCurrentAvStage?.() || 0;
        _writeSelfPresence(g.code, meActive, todayMins_, null, avStage_);
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
          if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
        } catch(e) { console.error('[Social] publicGroups snapshot error:', e); }
      }, err => {
        const code = err?.code || '';
        console.warn('[Social] publicGroups listener error:', code, err?.message || '');

        if (code === 'permission-denied' || code === 'unauthenticated') {
          // Rules block unauthenticated reads — fall back to showing local groups only.
          // The Discover tab will show locally-joined groups until the user is authenticated.
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
                  if (_tab === 'rooms' && !_groupView && !_destroyed) _scheduleRender();
                } catch(_) {}
              }, innerErr => {
                console.warn('[Social] fallback query also failed:', innerErr?.code);
                _publicGroups = [];
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

  function _subscribeRoomMembers(code) {
    // Guard: already listening to this exact room — skip duplicate attach
    if (_liveSubscribedCode === code && _memberUnsub) return;
    if (_memberUnsub) { try { _memberUnsub(); } catch(_) {} _memberUnsub = null; }
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
          Object.keys(_liveMembers).forEach(uid => {
            const el = view.querySelector(`[data-sr-timer="${uid}"]`);
            if (el) el.textContent = _fmtSecs(_srMemberSeconds({ id: uid }));
          });
          const meIsActive  = !!(view.querySelector('[data-sr-card="me"]')?.classList.contains('sr-card-active'));
          const onlineCount = Object.values(_liveMembers).filter(x => x.isStudying).length;
          const activeCnt   = meIsActive ? Math.max(1, onlineCount) : onlineCount;
          const cntEl = view.querySelector('.sr-studying-count');
          if (cntEl) cntEl.textContent = activeCnt;
          const totalEl = view.querySelector('.sr-total-member-count');
          if (totalEl) totalEl.textContent = snap.size;
        }, () => { _memberUnsub = null; _liveSubscribedCode = null; });
    } catch(_) { _memberUnsub = null; _liveSubscribedCode = null; }
  }

  function _unsubscribeRoomMembers() {
    if (_memberUnsub) { try { _memberUnsub(); } catch(_) {} _memberUnsub = null; }
    _liveSubscribedCode = null;
    _liveMembers = {};
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
        id:        uid === myUid ? 'me' : uid,
        name:      uid === myUid ? myName : (data.displayName || 'Unknown'),
        role:      data.role || 'member',
        isMe:      uid === myUid,
        todayMins: data.elapsedTimeToday || 0,
        todayKey:  data.dateKey || tk,
        joinedAt:  (typeof data.joinedAt?.toMillis === 'function' ? data.joinedAt.toMillis() : (data.joinedAt || 0)),
        _fromFirebase: true,
      });
    });

    // FALLBACK: local g.members (used when Firebase hasn't responded yet)
    (g.members || []).forEach(m => {
      const uid = m.id === 'me' ? myUid : (m.id || m.uid);
      if (!uid || memberMap.has(uid)) return;
      memberMap.set(uid, {
        uid,
        id:        m.id === 'me' ? 'me' : uid,
        name:      m.id === 'me' ? myName : (m.name || 'Unknown'),
        role:      m.role || 'member',
        isMe:      m.id === 'me' || uid === myUid,
        todayMins: m.todayMins || 0,
        todayKey:  m.todayKey || tk,
        joinedAt:  m.joinedAt || 0,
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
          _chatMessages[code] = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(m => !m._deleted);
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
      const replyHtml = msg.replyToId ? `
        <div class="sr-chat-reply-quote">
          <span class="sr-chat-reply-author">${esc(msg.replyToAuthor || 'Unknown')}</span>
          <span class="sr-chat-reply-text">${esc((msg.replyToText || '').slice(0, 60))}${(msg.replyToText || '').length > 60 ? '…' : ''}</span>
        </div>` : '';
      const reactionsHtml = _renderReactions(msg, myUid, code);
      const tsVal = msg.ts?.toMillis?.() ?? (typeof msg.ts === 'number' ? msg.ts : 0);
      return `
        <div class="sr-chat-row ${isMe ? 'sr-chat-mine' : 'sr-chat-theirs'}" data-msg-id="${esc(msg.id)}">
          ${!isMe ? `<div class="sr-chat-av" style="background:${_avatarColor(msg.author||'')}">${(msg.author||'?')[0].toUpperCase()}</div>` : ''}
          <div class="sr-chat-col">
            ${!isMe ? `<div class="sr-chat-author">${esc(msg.author || 'Unknown')}</div>` : ''}
            ${replyHtml}
            <div class="sr-chat-bubble" data-msg-id="${esc(msg.id)}">${esc(msg.text)}${msg.isEdited ? ' <span class="sr-edited-tag">edited</span>' : ''}</div>
            ${reactionsHtml}
            <div class="sr-chat-ts">${_chatTimeAgo(tsVal)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function _bindChatLongPress(el, code, g) {
    let pressTimer = null;
    el.addEventListener('touchstart', e => {
      const bubble = e.target.closest('[data-msg-id]');
      if (!bubble) return;
      const msgId = bubble.dataset.msgId;
      pressTimer = setTimeout(() => { _openChatContextMenu(code, g, msgId); }, 500);
    }, { passive: true });
    el.addEventListener('touchend',  () => clearTimeout(pressTimer), { passive: true });
    el.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });
    // Desktop right-click for testing
    el.addEventListener('contextmenu', e => {
      const bubble = e.target.closest('[data-msg-id]');
      if (!bubble) return;
      e.preventDefault();
      _openChatContextMenu(code, g, bubble.dataset.msgId);
    });
  }

  function _openChatContextMenu(code, g, msgId) {
    const msgs = _chatMessages[code] || [];
    const msg  = msgs.find(m => m.id === msgId);
    if (!msg) return;
    const uid     = getUserId();
    const isMe    = msg.authorId === uid || msg.authorId === 'me';
    const isAdmin = g.role === 'admin';
    const EMOJIS  = ['👍','❤️','😂','😮','😢','🔥'];
    const emojiRow = EMOJIS.map(e =>
      `<button class="sr-ctx-emoji" data-sc="sr-chat-react" data-code="${esc(code)}" data-mid="${esc(msgId)}" data-emoji="${esc(e)}" data-close>${e}</button>`
    ).join('');
    openModal(`
      <div class="sr-ctx-menu">
        <div class="sr-ctx-preview">${esc((msg.text || '').slice(0, 80))}${(msg.text||'').length > 80 ? '…' : ''}</div>
        <div class="sr-ctx-emoji-row">${emojiRow}</div>
        <div class="sr-ctx-actions">
          <button class="sr-ctx-action" data-sc="sr-chat-reply" data-code="${esc(code)}" data-mid="${esc(msgId)}" data-close>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            Reply
          </button>
          ${isMe ? `
          <button class="sr-ctx-action" data-sc="sr-chat-edit-ctx" data-code="${esc(code)}" data-mid="${esc(msgId)}" data-text="${esc(msg.text)}" data-close>
            ${ICON.edit} Edit
          </button>
          <button class="sr-ctx-action sr-ctx-danger" data-sc="sr-chat-delete" data-code="${esc(code)}" data-mid="${esc(msgId)}" data-close>
            ${ICON.trash} Delete for Everyone
          </button>` : (isAdmin ? `
          <button class="sr-ctx-action sr-ctx-danger" data-sc="sr-chat-delete" data-code="${esc(code)}" data-mid="${esc(msgId)}" data-close>
            ${ICON.trash} Delete (Admin)
          </button>` : '')}
        </div>
      </div>
    `);
  }

  function _writeSelfPresence(code, isStudying, todayMins, subjectName, avatarStage) {
    const db = getDb(), uid = getUserId(), fb = getFb();
    if (!db || !uid || !code || !fb) return;
    const update = {
      uid,
      isStudying:       !!isStudying,
      elapsedTimeToday: todayMins || 0,
      currentSubject:   subjectName || null,
      dateKey:          todayKey(),
      avatarStage:      typeof avatarStage === 'number' ? avatarStage : (window._lsGetCurrentAvStage?.() || 0),
      lastUpdated:      fb.firestore.FieldValue.serverTimestamp(),
    };
    if (isStudying) update.studyStartedAt = Date.now();
    db.collection('groups').doc(code).collection('members').doc(uid)
      .set(update, { merge: true }).catch(() => {});
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
          let myRole = 'member';
          // Creator always gets admin role
          if (data.createdBy === uid || data.createdByUid === uid) myRole = 'admin';
          try {
            const mSnap = await db.collection('groups').doc(code).collection('members').doc(uid).get();
            if (mSnap.exists) myRole = mSnap.data().role || myRole;
          } catch(_) {}
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
            role:    myRole,
            members: [{ id: uid, name: myName, role: myRole, joinedAt: Date.now() }],
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

      if (missing.length > 0 && window._currentTab === 'social') renderSocial();
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
    invite:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
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
            ${requests.length > 0 ? row('⏳', 'Waiting Room', requests.length + ' pending', 'sgs-waiting-room') + div : ''}
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

          <div class="sgs-section-label">Privacy</div>
          <div class="sgs-card">
            ${toggleRow('👁️', 'Hide Online Status', !!(g._myHideStatus), 'mbs-hide-status')}
            ${div}
            ${toggleRow('📚', 'Hide Study Subject', !!(g._myHideSubject), 'mbs-hide-subject')}
            ${div}
            ${toggleRow('⏱️', 'Hide Focus Time', !!(g._myHideFocus), 'mbs-hide-focus')}
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
      { id:'attendance', icon: SR_NAV_ICONS.attendance, label:'Attendance' },
      { id:'rankings',   icon: SR_NAV_ICONS.rankings,   label:'Rankings' },
      { id:'invite',     icon: SR_NAV_ICONS.invite,     label:'Invite' },
      { id:'chat',       icon: SR_NAV_ICONS.chat,       label:'Chat' },
    ];
    const tabContent = (() => {
      switch (_srTab) {
        case 'attendance': return _renderSrAttendance(g, sc);
        case 'rankings':   return _renderSrRankings(g, sc);
        case 'invite':     return _renderSrInvite(g);
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
          ${SR_TABS.map(t => `
            <button class="sr-nav-btn${_srTab === t.id ? ' sr-nav-active' : ''}" data-sc="sr-tab" data-tab="${t.id}">
              <span class="sr-nav-icon">${t.icon}</span>
              <span class="sr-nav-label">${t.label}</span>
            </button>`).join('')}
        </nav>
      </div>`;
  }

  function _renderSrHome(g, sc) {
    const members  = g.members || [];
    const myUid    = getUserId();
    const me       = members.find(x => x.id === 'me');
    const meActive = me ? _srMemberIsActive(me) : false;

    // Deduplicate members using a UID-keyed map — prevents duplicate "You" cards
    const memberMap = new Map();
    members.forEach(m => {
      const uid = m.id === 'me' ? myUid : (m.id || m.uid);
      if (uid && !memberMap.has(uid)) memberMap.set(uid, m);
      else if (!uid) memberMap.set('__' + Math.random(), m);
    });
    // Merge Firebase-only members not already in local list
    Object.entries(_liveMembers).forEach(([uid, data]) => {
      if (uid && !memberMap.has(uid)) {
        memberMap.set(uid, {
          id: uid, name: data.displayName || 'Studying…', role: data.role || 'member',
          _fromFirebase: true,
        });
      }
    });
    const allMembers  = [...memberMap.values()];
    const fbOnline    = Object.values(_liveMembers).filter(x => x.isStudying).length;
    const activeCount = meActive ? Math.max(1, fbOnline) : fbOnline;
    const totalCount  = Math.max(allMembers.length, Object.keys(_liveMembers).length, (g.memberCount || 0));

    const _avLabel = s => (window._lsAvLabels || ['IDLE','FOCUSED','STUDYING','DEEP STUDY','SCHOLAR','SAGE','WARRIOR','BLAZING','INFERNO','LEGENDARY'])[s] || 'LEGENDARY';
    const _avPillCls = s => s >= 9 ? 'sr-av-pill--legend' : s >= 6 ? 'sr-av-pill--fire' : s >= 3 ? 'sr-av-pill--warm' : 'sr-av-pill--dim';

    const memberCards = allMembers.map(m => {
      const realUid     = m.id === 'me' ? myUid : (m.id || m.uid);
      const isOff       = _isOffDayToday(realUid);
      const active      = !isOff && (m.id === 'me' ? meActive : _srMemberIsActive(m));
      const secs        = isOff ? 0 : _srMemberSeconds(m);
      const name        = m.name || 'Unknown';
      const displayName = name.length > 10 ? name.slice(0, 9) + '…' : name;
      const timerId     = m.id === 'me' ? 'me' : (m.id || m.uid);
      const cardClass   = isOff ? 'sr-card-off' : (active ? 'sr-card-active' : 'sr-card-idle');
      const avStage     = m.id === 'me'
        ? (window._lsGetCurrentAvStage?.() || 0)
        : (realUid && _liveMembers[realUid] ? (_liveMembers[realUid].avatarStage || 0) : 0);
      const showPill    = !isOff && avStage > 0;
      return `
        <div class="sr-member-card ${cardClass}" data-sr-card="${esc(m.id)}">
          <div class="sr-card-icon-wrap">
            <div class="sr-card-icon">${active ? SR_ACTIVE_DESK : SR_IDLE_DESK}</div>
            ${isOff ? `<div class="sr-off-badge">OFF</div>` : ''}
          </div>
          <div class="sr-card-name">${esc(displayName)}</div>
          <div class="sr-card-timer${active ? ' sr-timer-live' : ''}" data-sr-timer="${esc(timerId)}">${isOff ? '—' : _fmtSecs(secs)}</div>
          ${showPill ? `<div class="sr-av-pill ${_avPillCls(avStage)}">${_avLabel(avStage)}</div>` : ''}
        </div>`;
    });
    return `
      <div class="sr-home-view">
        <div class="sr-studying-header">
          <span class="sr-studying-label">Studying</span>
          <span class="sr-studying-badge">
            <span class="sr-studying-count">${activeCount}</span> active
            <span class="sr-total-member-count-wrap"> · <span class="sr-total-member-count">${totalCount}</span> total</span>
          </span>
        </div>
        <div class="sr-members-grid">
          ${memberCards.length
            ? memberCards.join('')
            : `<div class="sr-empty-grid">No members in this group yet.</div>`}
        </div>
      </div>`;
  }

  function _renderSrAttendance(g, sc) {
    const ms      = getMainState();
    const mbd     = ((ms.focusStats || {}).minutesByDate) || {};
    const members = _getGroupMembers(g);   // ← centralized realtime source
    const days    = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      days.push({ key, label: String(d.getDate()).padStart(2,'0') });
    }
    const myUid   = getUserId();
    const tk      = todayKey();
    const amOff   = _isOffDayToday(myUid);
    return `
      <div class="sr-att-view">
        <div class="sr-att-offday-row">
          <div class="sr-att-offday-info">
            <div class="sr-att-offday-title">Off Day</div>
            <div class="sr-att-offday-sub">${amOff ? 'You\'re off today — rest up! 🛋️' : 'Mark today as a rest day for this group'}</div>
          </div>
          <button class="sr-att-offday-btn${amOff ? ' sr-att-offday-active' : ''}" data-sc="sr-set-offday">
            ${amOff ? '✓ Off Day' : 'Set Off Day'}
          </button>
        </div>
        <div class="sr-section-head">Attendance — Last 14 Days</div>
        ${members.length === 0
          ? `<div class="sr-empty-grid">No members yet.</div>`
          : members.map(m => {
              const rawName   = m.name || '?';
              const shortName = rawName.length > 9 ? rawName.slice(0, 8) + '…' : rawName;
              const lm        = _liveMembers[m.uid] || null;
              const cells = days.map(day => {
                let mins = 0;
                if (m.isMe) {
                  mins = mbd[day.key] || 0;
                } else if (day.key === tk && lm) {
                  // For today: use Firebase elapsedTimeToday + live elapsed
                  mins = (lm.elapsedTimeToday || 0) +
                    (lm.isStudying && lm.studyStartedAt
                      ? Math.floor((Date.now() - lm.studyStartedAt) / 1000 / 60) : 0);
                }
                const present = mins > 0;
                const tip     = present ? `${Math.floor(mins/60)}h${mins%60}m` : '—';
                return `<div class="sr-att-cell${present ? ' sr-att-present' : ''}" title="${day.key}: ${tip}">${day.label}</div>`;
              }).join('');
              return `
                <div class="sr-att-member-row">
                  <div class="sr-att-member-av" style="background:${_avatarColor(rawName)}">${rawName[0].toUpperCase()}</div>
                  <div class="sr-att-member-name">${esc(shortName)}${m.isMe ? ' <span class="sr-att-you">you</span>' : ''}</div>
                  <div class="sr-att-cells">${cells}</div>
                </div>`;
            }).join('')}
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
          const storedSecs = (lm.elapsedTimeToday || 0) * 60;
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
                    <div class="sr-rank-name">${esc(m.name||'Unknown')}${m.isMe ? ` <span class="sr-rank-you">you</span>` : ''}</div>
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
    const myName = _getUserDisplayName();
    const uid    = getUserId();
    const code   = g.code;
    // Kick off Firebase subscription (idempotent)
    if (code) _subscribeChatMessages(code);

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

    return `
      <div class="sr-chat-view">
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
  function _renderLeaderboard() {
    const ms    = getMainState();
    const mins  = (ms.focusStats||{}).minutesByDate || {};
    const today = todayKey();
    const todayMins = mins[today] || 0;
    let weekMins = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      weekMins += (mins[d.toISOString().slice(0,10)] || 0);
    }
    const displayMins = _lbPeriod === 'daily' ? todayMins : weekMins;
    const studying    = isStudying();
    const uid         = getUserId();
    const weekStartKey = _weekStart();

    // Kick off real-time subscription (idempotent)
    _subscribeGlobalLb();

    // Filter + sort for the selected period
    const filtered = _globalLbData
      .filter(u => {
        if (_lbPeriod === 'daily')  return u.dailyResetDate  === today        && (u.dailyStudyTime  || 0) > 0;
        return u.weeklyResetDate === weekStartKey && (u.weeklyStudyTime || 0) > 0;
      })
      .sort((a, b) => {
        const aT = _lbPeriod === 'daily' ? (a.dailyStudyTime  || 0) : (a.weeklyStudyTime || 0);
        const bT = _lbPeriod === 'daily' ? (b.dailyStudyTime  || 0) : (b.weeklyStudyTime || 0);
        return bT - aT;
      });

    const topRows  = filtered.slice(0, 50);
    const myRankIdx = uid ? filtered.findIndex(u => u.id === uid) : -1;
    const myRank    = myRankIdx >= 0 ? myRankIdx + 1 : 0;

    const rankBadge = rank => {
      if (rank === 1) return `<span class="sc-glb-medal">🥇</span>`;
      if (rank === 2) return `<span class="sc-glb-medal">🥈</span>`;
      if (rank === 3) return `<span class="sc-glb-medal">🥉</span>`;
      return `<span class="sc-glb-rank-num">#${rank}</span>`;
    };

    const avatar = (name, id) => {
      const initial = (name || '?').charAt(0).toUpperCase();
      const color   = _avatarColor(name || id || '');
      return `<div class="sc-glb-avatar" style="background:${color}">${initial}</div>`;
    };

    return `
      <div class="sc-section sc-lb-global">
        <div class="sc-section-header">
          <span class="sc-section-title">🏆 Rankings</span>
          <div class="sc-toggle-row">
            <button class="sc-toggle-btn${_lbPeriod==='daily'?' sc-active':''}" data-sc="lb-period" data-period="daily">Daily</button>
            <button class="sc-toggle-btn${_lbPeriod==='weekly'?' sc-active':''}" data-sc="lb-period" data-period="weekly">Weekly</button>
          </div>
        </div>

        <div class="sc-lb-you-card">
          <div class="sc-lb-you-label">YOUR STUDY TIME ${_lbPeriod==='daily'?'TODAY':'THIS WEEK'}</div>
          <div class="sc-lb-you-time">${minsToHrs(displayMins)}</div>
          ${studying ? '<div class="sc-lb-studying-badge">● Currently Studying</div>' : ''}
          <div class="sc-lb-progress-wrap">
            <div class="sc-lb-progress-bar" style="width:${Math.min(100,(displayMins/(_lbPeriod==='daily'?480:3360))*100).toFixed(1)}%"></div>
          </div>
          <div class="sc-lb-goal-label">
            Goal: ${_lbPeriod==='daily'?'8h / day':'56h / week'}
            ${myRank > 0 ? ` &nbsp;·&nbsp; Your rank: <strong style="color:#a78bfa">#${myRank}</strong>` : ''}
          </div>
        </div>

        <div class="sc-glb-section">
          <div class="sc-glb-header">
            <span class="sc-block-title">🌍 Global Leaderboard</span>
            <span class="sc-glb-count">${filtered.length} studier${filtered.length !== 1 ? 's' : ''}</span>
          </div>
          ${topRows.length === 0 ? `
            <div class="sc-lb-info-card">
              <div class="sc-lb-info-icon">${ICON.trophy}</div>
              <div class="sc-lb-info-text">
                <strong>No one ranked yet ${_lbPeriod === 'daily' ? 'today' : 'this week'}</strong><br>
                Start a study session to claim the top spot!
              </div>
            </div>
          ` : topRows.map((u, i) => {
            const rank     = i + 1;
            const isMe     = uid && u.id === uid;
            const uTime    = _lbPeriod === 'daily' ? (u.dailyStudyTime || 0) : (u.weeklyStudyTime || 0);
            const avS      = typeof u.avatarStage === 'number' ? u.avatarStage : -1;
            const avLabels = window._lsAvLabels || ['IDLE','FOCUSED','STUDYING','DEEP STUDY','SCHOLAR','SAGE','WARRIOR','BLAZING','INFERNO','LEGENDARY'];
            const avPillCls = avS >= 9 ? 'sr-av-pill--legend' : avS >= 6 ? 'sr-av-pill--fire' : avS >= 3 ? 'sr-av-pill--warm' : 'sr-av-pill--dim';
            return `<div class="sc-glb-row${isMe ? ' sc-glb-row--me' : ''}${rank <= 3 ? ' sc-glb-row--top' : ''}">
              <div class="sc-glb-rank">${rankBadge(rank)}</div>
              ${avatar(u.name, u.id)}
              <div class="sc-glb-info">
                <div class="sc-glb-name">${esc(u.name || 'Anonymous')}${isMe ? ' <span class="sc-glb-you-tag">You</span>' : ''}</div>
                ${avS > 0 ? `<span class="sr-av-pill ${avPillCls}" style="margin-top:3px">${avLabels[avS]}</span>` : ''}
              </div>
              <div class="sc-glb-time">${minsToHrs(uTime)}</div>
            </div>`;
          }).join('')}
        </div>

        <div class="sc-lb-streaks">
          <div class="sc-block-title" style="margin-bottom:10px">Your Stats</div>
          <div class="sc-stats-grid">
            <div class="sc-stat-chip"><div class="sc-stat-value">${minsToHrs(todayMins)}</div><div class="sc-stat-label">Today</div></div>
            <div class="sc-stat-chip"><div class="sc-stat-value">${minsToHrs(weekMins)}</div><div class="sc-stat-label">This Week</div></div>
            <div class="sc-stat-chip"><div class="sc-stat-value">${ms.streak?.current??ms.currentStreak??0}🔥</div><div class="sc-stat-label">Streak</div></div>
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
          db_.collection('groups').doc(newGroup.code).collection('members').doc(uid_).set({
            uid: uid_, displayName: myName, role: 'admin',
            joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
            isStudying: false, currentSubject: null, elapsedTimeToday: 0,
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

  // ── Direct join for public groups (no invite code needed) ────────────────
  function _joinPublicGroup(code, fbGroupData) {
    const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
    if (!uid_) { toast('Sign in to join groups', 'warn'); return; }
    const sc = scLoad();
    if (sc.groups.find(g => g.code === code)) {
      toast('You are already in this group', 'info'); return;
    }
    const myName = _getUserDisplayName();
    const data = fbGroupData || {};
    if ((data.memberCount || 0) >= (data.maxMembers || 50)) {
      toast('This group is full', 'warn'); return;
    }
    const rawCat = data.category || 'General';
    const sc2 = scLoad();
    sc2.groups.push({
      id:           data.groupId || data.id || code,
      name:         data.name || `Group ${code}`,
      icon:         data.icon || '📚',
      code:         code,
      isPrivate:    false,
      description:  data.description || '',
      category:     rawCat === 'camstudy' ? 'General' : rawCat,
      dailyGoalHrs: data.dailyGoalHrs || 8,
      maxMembers:   data.maxMembers || 50,
      leader:       (data.leader && data.leader !== 'You') ? data.leader : (data.createdByName || 'Admin'),
      promoted:     false,
      createdAt:    data.createdAt || Date.now(),
      dailyMinsTotal: 0, attendancePct: 0,
      role:    'member',
      members: [{ id: uid_, name: myName, role: 'member', joinedAt: Date.now() }],
    });
    scSave(sc2);
    if (db_ && uid_ && fb_) {
      db_.collection('groups').doc(code).collection('members').doc(uid_).set({
        uid: uid_, displayName: myName, role: 'member',
        joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
        isStudying: false, currentSubject: null, elapsedTimeToday: 0,
      }).catch(() => {});
      db_.collection('groups').doc(code).update({
        memberCount: fb_.firestore.FieldValue.increment(1)
      }).catch(() => {});
      db_.collection('users').doc(uid_).set({
        joinedRooms:     fb_.firestore.FieldValue.arrayUnion(code),
        displayNameAuto: myName,
      }, { merge: true }).catch(() => {});
    }
    toast(`Joined "${data.name || code}"! 🎉`, 'success');
    setTimeout(_ensureGroupDocSubs, 300);
    _tab = 'rooms';
    renderSocial();
  }

  function _modalJoinGroup() {
    openModal(`
      <h3 class="sc-modal-title">Join a Private Group</h3>
      <p class="sc-modal-sub">Enter the 6-character invite code shared by a group admin.</p>
      <div class="sc-field">
        <input id="sc-join-code" type="text" maxlength="8" placeholder="e.g. A1B2C3"
               class="sc-input sc-input-code" autocomplete="off" spellcheck="false"/>
      </div>
      <div id="sc-join-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-join">Join Group</button>
      </div>
    `, root => {
      const codeEl   = root.querySelector('#sc-join-code');
      const errEl    = root.querySelector('#sc-join-err');
      const submitEl = root.querySelector('#sc-do-join');
      codeEl.focus();
      codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
      const _doLocalFallbackJoin = (code) => {
        const sc2 = scLoad();
        if (sc2.groups.find(g => g.code === code)) return;
        const myName2 = _getUserDisplayName();
        const uid2 = getUserId();
        sc2.groups.push({
          id: genId(), name: `Group ${code}`, icon: '📚',
          code, isPrivate: false, description: '',
          category: 'General', dailyGoalHrs: 8, maxMembers: 50,
          leader: 'Admin', promoted: false,
          createdAt: Date.now(), dailyMinsTotal: 0, attendancePct: 0,
          role: 'member',
          members: [{ id: uid2 || 'me', name: myName2, role: 'member', joinedAt: Date.now() }],
        });
        scSave(sc2);
        closeModal();
        toast('Group joined (offline mode)', 'success');
        _tab = 'rooms';
        renderSocial();
      };

      const doJoin = () => {
        const code = codeEl.value.trim().toUpperCase();
        if (code.length < 4) { errEl.textContent = 'Enter a valid invite code (4–8 characters).'; errEl.style.display=''; return; }
        const sc = scLoad();
        if (sc.groups.find(g => g.code === code)) { errEl.textContent = 'You already belong to a group with this code.'; errEl.style.display=''; return; }

        const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
        if (!db_) { _doLocalFallbackJoin(code); return; }

        submitEl.disabled = true;
        submitEl.textContent = 'Searching…';
        errEl.style.display = 'none';

        db_.collection('groups').doc(code).get().then(snap => {
          if (!snap.exists) {
            errEl.textContent = 'No group found with this code. Please check and try again.';
            errEl.style.display = '';
            submitEl.disabled = false; submitEl.textContent = 'Join Group';
            return;
          }
          const data = snap.data();
          if ((data.memberCount || 0) >= (data.maxMembers || 50)) {
            errEl.textContent = 'This group is full.';
            errEl.style.display = '';
            submitEl.disabled = false; submitEl.textContent = 'Join Group';
            return;
          }
          const myName2 = _getUserDisplayName();
          const rawCat = data.category || 'General';
          const sc2 = scLoad();
          if (!sc2.groups.find(g => g.code === code)) {
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
              leader:       (data.leader && data.leader !== 'You') ? data.leader : (data.createdByName || 'Admin'),
              promoted:     false,
              createdAt:    data.createdAt?.toMillis?.() ?? Date.now(),
              dailyMinsTotal: 0, attendancePct: 0,
              role:    'member',
              members: [{ id: uid_ || 'me', name: myName2, role: 'member', joinedAt: Date.now() }],
            });
            scSave(sc2);
          }
          if (uid_ && fb_) {
            db_.collection('groups').doc(code).collection('members').doc(uid_).set({
              uid: uid_, displayName: myName2, role: 'member',
              joinedAt: fb_.firestore.FieldValue.serverTimestamp(),
              isStudying: false, currentSubject: null, elapsedTimeToday: 0,
            }).catch(() => {});
            db_.collection('groups').doc(code).update({
              memberCount: fb_.firestore.FieldValue.increment(1)
            }).catch(() => {});
            db_.collection('users').doc(uid_).set({
              joinedRooms:     fb_.firestore.FieldValue.arrayUnion(code),
              displayNameAuto: _getUserDisplayName(),
            }, { merge: true }).catch(() => {});
          }
          closeModal();
          toast('Group joined! 🎉', 'success');
          _tab = 'rooms';
          renderSocial();
        }).catch(() => {
          _doLocalFallbackJoin(code);
          submitEl.disabled = false; submitEl.textContent = 'Join Group';
        });
      };
      submitEl.addEventListener('click', doJoin);
      codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
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
          scSave(sc2); _groupView = null; _srTab = 'home'; _stopSrTicker(); _unsubscribeRoomMembers();
          // Remove from Firebase
          const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
          if (db_ && uid_ && fb_ && groupCode) {
            db_.collection('groups').doc(groupCode).collection('members').doc(uid_).delete().catch(() => {});
            db_.collection('groups').doc(groupCode).update({ memberCount: fb_.firestore.FieldValue.increment(-1) }).catch(() => {});
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
            if (g0 && g0.code) _subscribeChatMessages(g0.code);
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
        openModal(`
          <h3 class="sc-modal-title">Change Group Name</h3>
          <div class="sc-field">
            <input id="cn-name" type="text" maxlength="40" value="${esc(g.name||'')}" class="sc-input" autocomplete="off" placeholder="Enter group name"/>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="cn-save">Save</button>
          </div>
        `, root => {
          const inp = root.querySelector('#cn-name');
          inp.focus(); inp.select();
          const doSave = () => {
            const name = inp.value.trim();
            if (!name) { toast('Name cannot be empty', 'warn'); return; }
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.name = name;
            scSave(sc2); closeModal(); toast('Group name updated!', 'success'); renderSocial();
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
            scSave(sc2); closeModal(); toast(val ? 'Rules saved!' : 'Rules removed', 'success'); renderSocial();
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
            scSave(sc2); closeModal(); toast('Category updated!', 'success'); renderSocial();
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
            scSave(sc2); closeModal(); toast(`Daily goal set to ${val}h`, 'success'); renderSocial();
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
            scSave(sc2); closeModal(); toast(`Capacity set to ${val}`, 'success'); renderSocial();
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
        openModal(`
          <h3 class="sc-modal-title">How to Join</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px">Choose how new members can enter this group.</p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label class="sgs-radio-row ${cur==='open'?'sgs-radio-selected':''}">
              <input type="radio" name="jm" value="open" ${cur==='open'?'checked':''} style="display:none"/>
              <div class="sgs-radio-content">
                <div style="font-size:15px;font-weight:600">🚪 Join immediately</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Anyone with the code can join right away</div>
              </div>
              <div class="sgs-radio-dot ${cur==='open'?'sgs-radio-dot-on':''}"></div>
            </label>
            <label class="sgs-radio-row ${cur==='approval'?'sgs-radio-selected':''}">
              <input type="radio" name="jm" value="approval" ${cur==='approval'?'checked':''} style="display:none"/>
              <div class="sgs-radio-content">
                <div style="font-size:15px;font-weight:600">⏳ Join after approval</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">You review and approve each request</div>
              </div>
              <div class="sgs-radio-dot ${cur==='approval'?'sgs-radio-dot-on':''}"></div>
            </label>
          </div>
          <div class="actions" style="margin-top:20px">
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn sc-modal-submit" id="jm-save">Save</button>
          </div>
        `, root => {
          root.querySelectorAll('.sgs-radio-row').forEach(row => {
            row.addEventListener('click', () => {
              root.querySelectorAll('.sgs-radio-row').forEach(r => r.classList.remove('sgs-radio-selected'));
              root.querySelectorAll('.sgs-radio-dot').forEach(d => d.classList.remove('sgs-radio-dot-on'));
              row.classList.add('sgs-radio-selected');
              row.querySelector('.sgs-radio-dot').classList.add('sgs-radio-dot-on');
              row.querySelector('input[type=radio]').checked = true;
            });
          });
          root.querySelector('#jm-save').addEventListener('click', () => {
            const val = root.querySelector('input[name=jm]:checked')?.value || 'open';
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinMode = val;
            scSave(sc2); closeModal();
            toast(val === 'approval' ? '⏳ Approval required to join' : '🚪 Open join enabled', 'success');
            renderSocial();
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
            scSave(sc2); closeModal();
            toast(val ? '❓ Question saved & enabled' : 'Sign-up question disabled', 'success');
            renderSocial();
          });
          root.querySelector('#sq-clear')?.addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinQuestion = '';
            scSave(sc2); closeModal(); toast('Sign-up question removed', 'info'); renderSocial();
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
            scSave(sc2); closeModal();
            toast(val ? '🔐 Password protected' : '🌐 Group is now public', 'success');
            renderSocial();
          });
          root.querySelector('#pw-clear')?.addEventListener('click', () => {
            const sc2 = scLoad();
            const g2  = sc2.groups.find(x => x.id === gid);
            if (!g2) return;
            g2.joinPassword = '';
            scSave(sc2); closeModal(); toast('🌐 Password removed', 'info'); renderSocial();
          });
        });
        break;
      }

      // ── Management Section ────────────────────────────────────────────────
      case 'sgs-waiting-room': {
        const sc  = scLoad();
        const g   = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid  = g.id;
        const reqs = (sc.requests && sc.requests[gid]) || [];
        if (!reqs.length) {
          openModal(`
            <h3 class="sc-modal-title">⏳ Waiting Room</h3>
            <div style="text-align:center;padding:28px 0;color:var(--text-muted)">
              <div style="font-size:36px;margin-bottom:12px">✅</div>
              <div>No pending join requests</div>
            </div>
            <div class="actions"><button class="btn btn-ghost" data-close>Close</button></div>
          `);
          break;
        }
        const rows = reqs.map(r => `
          <div class="adm-member-row" data-req-id="${esc(r.id)}" style="margin-bottom:10px">
            <div class="adm-member-av-wrap">
              <div class="adm-member-av" style="width:36px;height:36px;border-radius:50%;background:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${esc((r.name||'?').slice(0,2).toUpperCase())}</div>
            </div>
            <div class="adm-member-info" style="flex:1;min-width:0;margin-left:10px">
              <div style="font-weight:600;font-size:14px">${esc(r.name||'Anonymous')}</div>
              ${r.answer ? `<div style="font-size:12px;color:var(--text-muted);font-style:italic;margin-top:2px">"${esc(r.answer)}"</div>` : ''}
              <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${new Date(r.requestedAt||Date.now()).toLocaleString()}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn" style="padding:6px 12px;font-size:12px;background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3)" data-sc="sgs-approve-req" data-gid="${esc(gid)}" data-rid="${esc(r.id)}" data-name="${esc(r.name||'Member')}">✓</button>
              <button class="btn btn-danger" style="padding:6px 12px;font-size:12px" data-sc="sgs-reject-req" data-gid="${esc(gid)}" data-rid="${esc(r.id)}">✕</button>
            </div>
          </div>`).join('');
        openModal(`
          <h3 class="sc-modal-title">⏳ Waiting Room</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">${reqs.length} pending request${reqs.length!==1?'s':''}</p>
          <div id="wr-list">${rows}</div>
          <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
        `);
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
          g.members.push({ id: rid, name, role: 'member', joinedAt: Date.now() });
        }
        scSave(sc);
        toast(`✓ ${name} approved!`, 'success');
        el.closest('.adm-member-row')?.remove();
        renderSocial();
        break;
      }

      case 'sgs-reject-req': {
        const sc  = scLoad();
        const gid = el.dataset.gid;
        const rid = el.dataset.rid;
        if (!sc.requests) sc.requests = {};
        if (!sc.requests[gid]) sc.requests[gid] = [];
        sc.requests[gid] = sc.requests[gid].filter(r => r.id !== rid);
        scSave(sc);
        toast('Request rejected', 'info');
        el.closest('.adm-member-row')?.remove();
        renderSocial();
        break;
      }

      case 'sgs-manage-members': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const gid = g.id;
        const members = (g.members || []);
        if (!members.length) {
          toast('No members in this group yet', 'info');
          break;
        }
        const rows = members.map(m => {
          const isMe = m.id === 'me';
          return `
            <div class="adm-member-row" style="margin-bottom:10px;display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0">${esc((m.name||'?').slice(0,2).toUpperCase())}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px">${esc(m.name||'Unknown')} ${isMe ? '<span style="color:#7c3aed;font-size:11px">(you)</span>' : ''}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${m.role === 'admin' ? '👑 Admin' : '✓ Member'}</div>
              </div>
              ${!isMe && m.role !== 'admin' ? `<button class="btn btn-danger" style="padding:5px 12px;font-size:12px" data-sc="sgs-kick" data-gid="${esc(gid)}" data-uid="${esc(m.id)}" data-name="${esc(m.name||'Member')}">Kick</button>` : ''}
            </div>`;
        }).join('');
        openModal(`
          <h3 class="sc-modal-title">👥 Manage Members</h3>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">${members.length} member${members.length!==1?'s':''}</p>
          <div id="mm-list">${rows}</div>
          <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>
        `);
        break;
      }

      case 'sgs-kick': {
        const sc   = scLoad();
        const gid  = el.dataset.gid;
        const uid  = el.dataset.uid;
        const name = el.dataset.name || 'Member';
        const g    = sc.groups.find(x => x.id === gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        confirmModal(`Remove ${name} from the group?`, () => {
          const sc2 = scLoad();
          const g2  = sc2.groups.find(x => x.id === gid);
          if (!g2) return;
          g2.members = (g2.members||[]).filter(m => m.id !== uid);
          scSave(sc2);
          toast(`${name} removed from group`, 'info');
          closeModal();
          renderSocial();
        }, { title:`Kick ${name}?`, yesLabel:'Remove', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      case 'sgs-nudge-all': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || (_getMyRole(g) !== 'owner' && _getMyRole(g) !== 'admin')) break;
        const others = (g.members||[]).filter(m => m.id !== 'me');
        if (!others.length) { toast('No other members to nudge yet', 'info'); break; }
        toast(`📣 Nudged ${others.length} member${others.length!==1?'s':''}! They'll be notified to study.`, 'success', 3500);
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

      case 'mbs-hide-status':
      case 'mbs-hide-subject':
      case 'mbs-hide-focus': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g) break;
        const gid = g.id;
        const sc2 = scLoad();
        const g2  = sc2.groups.find(x => x.id === gid);
        if (!g2) break;
        const fieldMap = { 'mbs-hide-status': '_myHideStatus', 'mbs-hide-subject': '_myHideSubject', 'mbs-hide-focus': '_myHideFocus' };
        const field = fieldMap[act];
        g2[field] = !g2[field];
        scSave(sc2);
        toast(g2[field] ? '🔒 Hidden from other members' : '👁️ Visible to members', 'success');
        renderSocial();
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
          _groupView = null; _settingsView = false; _srTab = 'home'; _stopSrTicker(); _unsubscribeRoomMembers();
          // Remove from Firebase
          const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
          if (db_ && uid_ && fb_ && leaveCode) {
            db_.collection('groups').doc(leaveCode).collection('members').doc(uid_).delete().catch(() => {});
            db_.collection('groups').doc(leaveCode).update({ memberCount: fb_.firestore.FieldValue.increment(-1) }).catch(() => {});
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

      // ── Chat: react (from pill or context menu) ──────────────────────────
      case 'sr-chat-react': {
        const code2 = el.dataset.code;
        const mid   = el.dataset.mid;
        const emoji = el.dataset.emoji;
        const uid3  = getUserId();
        if (!code2 || !mid || !emoji || !uid3) break;
        const db2 = getDb();
        if (!db2) break;
        const msgRef = db2.collection('groups').doc(code2).collection('messages').doc(mid);
        msgRef.get().then(snap => {
          if (!snap.exists) return;
          const reacs  = { ...(snap.data().reactions || {}) };
          const arr    = [...(reacs[emoji] || [])];
          const idx    = arr.indexOf(uid3);
          if (idx >= 0) arr.splice(idx, 1); else arr.push(uid3);
          reacs[emoji] = arr;
          return msgRef.update({ reactions: reacs });
        }).catch(() => {});
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

      // ── Chat: delete message ─────────────────────────────────────────────
      case 'sr-chat-delete': {
        const code4 = el.dataset.code;
        const mid4  = el.dataset.mid;
        if (!code4 || !mid4) break;
        const db3 = getDb();
        if (!db3) break;
        db3.collection('groups').doc(code4).collection('messages').doc(mid4)
          .update({ _deleted: true, text: '' }).catch(() => {});
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
      // Broadcast presence update to Firebase for all joined groups
      const db_ = getDb(), uid_ = getUserId(), fb_ = getFb();
      if (db_ && uid_ && fb_) {
        const studying_ = ui().focusIsRunning?.() === true;
        const tk_ = todayKey();
        const sc_ = scLoad();
        const avStageGlobal_ = window._lsGetCurrentAvStage?.() || 0;
        sc_.groups.forEach(g => {
          if (g.code) {
            const update = {
              uid: uid_,
              isStudying:       studying_,
              elapsedTimeToday: todayMins,
              dateKey:          tk_,
              avatarStage:      avStageGlobal_,
              lastUpdated:      fb_.firestore.FieldValue.serverTimestamp(),
            };
            if (studying_) update.studyStartedAt = Date.now();
            db_.collection('groups').doc(g.code).collection('members').doc(uid_)
              .set(update, { merge: true }).catch(() => {});
          }
        });
      }
      if (window._currentTab === 'social') renderSocial();
    };

    // Start real-time Firebase listeners
    // Use a small delay to ensure the appUI bridge is ready
    setTimeout(() => {
      _subscribePublicGroups();
      _subscribeGlobalLb();
      _subscribeMyGroups();
      _subscribeMyGroupsByOwner();
      _subscribeMyGroupsByAdmin();
      _subscribeGroupDocs();            // per-group doc listeners for live memberCount
      _restoreGroupsFromFirebase().catch(() => {});
    }, 500);

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
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
