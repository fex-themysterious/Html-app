(() => {
  'use strict';

  // ── Cloud sync / auth state ──────────────────────────────────────────────
  let _db             = null;
  let _auth           = null;
  let _userId         = null;
  let _cloudSyncTimer = null;
  let _authMode       = 'login'; // 'login' | 'signup'
  let _authConfigured = false;   // true once Firebase config validated & auth object created

  const STORAGE_KEY = 'syllabus_tracker_v2';
  const BACKUP_DATE_KEY = 'backup_last_date';

  // ── Shared date utilities (always local-timezone, never UTC) ─────────────
  // Zero day-offset guarantee: format a Date using local year/month/date fields.
  // Never use toISOString() for date keys — it returns UTC which shifts for UTC+ zones.
  function localISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // Returns today's YYYY-MM-DD in local timezone (used as the canonical storage key)
  const todayKey = () => localISO(new Date());
  // Build a date key N calendar days from a base local-ISO key
  function addDaysISO(base, days) {
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return localISO(d);
  }
  // Build an array of the last N local-date keys ending with today (ascending)
  function buildDateRange(n) {
    const arr = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      arr.push(localISO(d));
    }
    return arr;
  }
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ── Built-in Motivation Quotes (interval system) ─────────────────
  const MOTIVATION_QUOTES = [
    "Stay focused. The results will speak for themselves.",
    "Consistency is the bridge between goals and accomplishment.",
    "One more topic. One step closer to your dream.",
    "The pain of studying is temporary. The pride of success is permanent.",
    "Every page you study today is a wall between you and failure.",
    "Champions don't skip study sessions. Neither do you.",
    "Your future self is watching you right now — make them proud.",
    "Small daily improvements lead to stunning yearly results.",
    "Discipline is choosing what you want most over what you want now.",
    "You are not tired. You are just momentarily weak. Push through.",
    "The difference between ordinary and extraordinary is that little extra.",
    "Hard days build strong scholars. This is one of those days.",
    "Every revision you do today is an exam answer tomorrow.",
    "Genius is 1% inspiration and 99% sweating over textbooks.",
    "The only way out is through. Keep studying."
  ];
  const MOTIVATION_QUOTES_URGENT = [
    "You haven't studied in a while. Your goals are still waiting.",
    "Wake up! Every hour you delay is ground you have to make up later.",
    "Your mastery is low — but it's not too late. Open the app and grind.",
    "Exams don't care about excuses. Get back to studying NOW.",
    "Danger zone! Low progress detected. Time to turn it around.",
    "You didn't come this far to only come this far. KEEP GOING."
  ];

  function addDaysISO(base, days) {
    const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + days);
    return localISO(d);
  }
  function nextDateISO(d) { return addDaysISO(todayKey(), d); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
  function daysSince(k) { return k ? Math.max(0, daysBetween(k, todayKey())) : Infinity; }

  function makeDefaultChecklist() {
    return ['Basic', 'MCQ', 'CQ', 'SQ'].map(l => ({ id: uid(), label: l, checked: false }));
  }

  function seedSubject(name, color, chapters) {
    return {
      id: uid(), name, color, notes: '', priority: null,
      revisionCount: 0, lastRevisedAt: null, checklist: makeDefaultChecklist(),
      chapters: chapters.map(c => ({
        id: uid(), name: c.name, notes: '', priority: c.priority || null,
        done: false, scheduledDate: null, revisionCount: 0, lastRevisedAt: null,
        checklist: makeDefaultChecklist(),
        topics: (c.topics || []).map(t => ({
          id: uid(), name: t, notes: '', done: false, priority: null,
          revisionCount: 0, lastRevisedAt: null, skipCount: 0,
          firstSeenAt: todayKey(), lastSkippedAt: null
        }))
      }))
    };
  }

  function defaultState() {
    return {
      profile: { name: '', tagline: '', avatarDataUrl: null },
      subjects: [
        seedSubject('Mathematics', '#38bdf8', [
          { name: 'Differential Calculus', priority: 'high', topics: ['Limits', 'Derivatives', 'Applications'] },
          { name: 'Matrices & Determinants', priority: 'high', topics: ['Operations', 'Inverse', 'Rank'] },
          { name: 'Sequences & Series', priority: 'medium', topics: ['AP/GP', 'Convergence'] }
        ]),
        seedSubject('Biology', '#34d399', [
          { name: 'Cell Biology', priority: 'high', topics: ['Cell Structure', 'Cell Cycle'] },
          { name: 'Genetics', priority: 'medium', topics: ['Mendel Laws', 'DNA Structure'] }
        ]),
        seedSubject('Physics', '#a78bfa', [
          { name: 'Mechanics', priority: 'medium', topics: ['Kinematics', 'Newton Laws'] }
        ])
      ],
      exams: [{ id: uid(), name: 'Mid-Term Exam', date: nextDateISO(30) }],
      motivationQuotes: [],
      streak: { count: 1, lastDate: todayKey() },
      activity: { [todayKey()]: 0 },
      dailyPlans: {},
      smartReminder: { enabled: false, times: ['20:00'], lastFired: {} },
      motivationReminders: { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} },
      motivationInterval: { enabled: true, intervalHours: 2, lastFired: null },
      revisions: [],
      burnout: { installDate: todayKey(), popupDismissedDate: null, bannerDismissedDate: null },
      goals: [],
      classroom: { groups: [] },
      focusStats: { sessions: {}, minutesByDate: {}, minutesBySubject: {} },
      rankTestHours: 0,
      recurringTasks: [],
      alarms: [],
      xp: { total: 0, streakBonusDate: null },
      focusStreak: { count: 0, lastDate: null, best: 0 },
      badges: {},
      eyeCareMode: false
    };
  }

  function migrate(s) {
    s.subjects = (s.subjects || []).map(sub => ({
      id: sub.id || uid(), name: sub.name || 'Subject', color: sub.color || '#38bdf8',
      notes: sub.notes || '', priority: sub.priority || null,
      revisionCount: sub.revisionCount || 0, lastRevisedAt: sub.lastRevisedAt || null,
      checklist: Array.isArray(sub.checklist) && sub.checklist.length ? sub.checklist.map(it => ({ id: it.id || uid(), label: String(it.label || 'Item'), checked: !!it.checked })) : makeDefaultChecklist(),
      chapters: (sub.chapters || []).map(c => ({
        id: c.id || uid(), name: c.name || 'Chapter', notes: c.notes || '',
        priority: c.priority || null, revisionCount: c.revisionCount || 0,
        lastRevisedAt: c.lastRevisedAt || null, done: !!c.done, scheduledDate: c.scheduledDate || null,
        checklist: Array.isArray(c.checklist) && c.checklist.length ? c.checklist.map(it => ({ id: it.id || uid(), label: String(it.label || 'Item'), checked: !!it.checked })) : makeDefaultChecklist(),
        topics: (c.topics || []).map(t => ({
          id: t.id || uid(), name: t.name || 'Topic', notes: t.notes || '',
          done: !!t.done, priority: t.priority || null,
          revisionCount: t.revisionCount || 0, lastRevisedAt: t.lastRevisedAt || null,
          skipCount: typeof t.skipCount === 'number' ? t.skipCount : 0,
          firstSeenAt: t.firstSeenAt || todayKey(), lastSkippedAt: t.lastSkippedAt || null
        }))
      }))
    }));
    s.exams = s.exams || [];
    if (!s.profile || typeof s.profile !== 'object') s.profile = { name: '', tagline: '' };
    if (typeof s.profile.name !== 'string') s.profile.name = '';
    if (typeof s.profile.tagline !== 'string') s.profile.tagline = '';
    if (!('avatarDataUrl' in s.profile)) s.profile.avatarDataUrl = null;
    const _legacyDefaults = new Set([
      "Small steps every day lead to big results.",
      "Discipline beats motivation.",
      "You don't have to be perfect, just consistent.",
      "Future you is watching. Make them proud.",
      "One topic at a time. Keep going.",
      "Hard work beats talent when talent doesn't work hard.",
      "Every expert was once a beginner.",
      "The secret to success is to start.",
      "Push yourself — no one else will do it for you.",
      "Study now, shine later."
    ]);
    s.motivationQuotes = Array.isArray(s.motivationQuotes)
      ? s.motivationQuotes.filter(q => !_legacyDefaults.has(q))
      : [];
    s.streak = s.streak || { count: 0, lastDate: null };
    s.activity = s.activity || {};
    s.dailyPlans = s.dailyPlans || {};
    delete s.calendarTasks;
    if (!s.smartReminder || typeof s.smartReminder !== 'object') s.smartReminder = { enabled: false, times: ['20:00'], lastFired: {} };
    s.smartReminder.lastFired = s.smartReminder.lastFired || {};
    if (!Array.isArray(s.smartReminder.times) || !s.smartReminder.times.length) s.smartReminder.times = ['20:00'];
    if (!s.motivationReminders || typeof s.motivationReminders !== 'object') s.motivationReminders = { enabled: false, times: ['09:00', '20:00'], lastFired: {} };
    s.motivationReminders.lastFired = s.motivationReminders.lastFired || {};
    if (!Array.isArray(s.motivationReminders.times) || !s.motivationReminders.times.length) s.motivationReminders.times = ['09:00', '20:00'];
    if (!s.motivationInterval || typeof s.motivationInterval !== 'object') s.motivationInterval = { enabled: true, intervalHours: 2, lastFired: null };
    if (typeof s.motivationInterval.enabled !== 'boolean') s.motivationInterval.enabled = true;
    if (typeof s.motivationInterval.intervalHours !== 'number' || s.motivationInterval.intervalHours < 1) s.motivationInterval.intervalHours = 2;
    s.burnout = s.burnout || { installDate: todayKey(), popupDismissedDate: null, bannerDismissedDate: null };
    if (!s.burnout.installDate) s.burnout.installDate = todayKey();
    s.goals = Array.isArray(s.goals) ? s.goals.map(g => ({
      id: g.id || uid(), name: g.name || '', subjectId: g.subjectId || null,
      durationDays: Math.max(1, parseInt(g.durationDays, 10) || 1),
      startDate: g.startDate || todayKey(),
      targetDate: g.targetDate || addDaysISO(g.startDate || todayKey(), Math.max(1, parseInt(g.durationDays, 10) || 1)),
      createdAt: g.createdAt || todayKey(), completedAt: g.completedAt || null
    })) : [];
    s.revisions = (s.revisions || []).map(r => ({
      id: r.id || uid(), subId: r.subId, chId: r.chId, tId: r.tId,
      completedAt: r.completedAt || todayKey(),
      schedule: (r.schedule || []).map(st => ({ offset: st.offset, dueDate: st.dueDate, done: !!st.done, completedAt: st.completedAt || null }))
    }));
    if (!s.focusStats || typeof s.focusStats !== 'object') s.focusStats = { sessions: {}, minutesByDate: {} };
    if (!s.focusStats.sessions) s.focusStats.sessions = {};
    if (!s.focusStats.minutesByDate) s.focusStats.minutesByDate = {};
    s.recurringTasks = Array.isArray(s.recurringTasks) ? s.recurringTasks.map(rt => ({
      id: rt.id || uid(), text: rt.text || '', frequency: rt.frequency || 'daily', lastResetDate: rt.lastResetDate || null
    })) : [];
    if (!Array.isArray(s.alarms)) s.alarms = [];
    s.alarms = s.alarms.map(a => ({ id: a.id || uid(), label: a.label || 'Alarm', time: a.time || '07:00', enabled: typeof a.enabled === 'boolean' ? a.enabled : true }));
    if (!s.xp || typeof s.xp !== 'object') s.xp = { total: 0 };
    if (typeof s.xp.total !== 'number' || isNaN(s.xp.total)) s.xp.total = 0;
    if (!('streakBonusDate' in s.xp)) s.xp.streakBonusDate = null;
    if (typeof s.xp.spent !== 'number')       s.xp.spent       = 0;
    if (typeof s.xp.weeklyEarned !== 'number') s.xp.weeklyEarned = 0;
    if (!s.xp.weeklyReset) s.xp.weeklyReset = todayKey();
    if (!s.inventory  || typeof s.inventory  !== 'object') s.inventory  = {};
    if (!s.equippedItems || typeof s.equippedItems !== 'object') s.equippedItems = {};
    if (!s.dailyQuests || typeof s.dailyQuests !== 'object') s.dailyQuests = { date: '', quests: [] };
    if (!s.focusStreak || typeof s.focusStreak !== 'object') s.focusStreak = { count: 0, lastDate: null, best: 0 };
    if (!s.focusStreak.best) s.focusStreak.best = s.focusStreak.count || 0;
    if (!s.focusStats.videoMinutes || typeof s.focusStats.videoMinutes !== 'object') s.focusStats.videoMinutes = {};
    if (!s.focusStats.minutesBySubject || typeof s.focusStats.minutesBySubject !== 'object') s.focusStats.minutesBySubject = {};
    if (!s.badges || typeof s.badges !== 'object') s.badges = {};
    if (typeof s.eyeCareMode !== 'boolean') s.eyeCareMode = false;
    if (typeof s.rankTestHours !== 'number' || isNaN(s.rankTestHours)) s.rankTestHours = 0;
    if (!s.classroom || typeof s.classroom !== 'object') s.classroom = { groups: [] };
    if (!Array.isArray(s.classroom.groups)) s.classroom.groups = [];
    s.classroom.groups = s.classroom.groups.map(g => ({
      id: g.id || uid(), name: g.name || 'Group',
      items: Array.isArray(g.items) ? g.items.map(it => ({
        id: it.id || uid(), title: it.title || 'Video', url: it.url || '',
        videoId: it.videoId || null, playlistId: it.playlistId || null,
        type: it.type || 'video', addedAt: it.addedAt || todayKey(),
        description: it.description || '',
        thumbnailUrl: it.thumbnailUrl || (it.videoId ? `https://img.youtube.com/vi/${it.videoId}/mqdefault.jpg` : ''),
        notes: Array.isArray(it.notes) ? it.notes.map(n => ({ id: n.id || uid(), ts: typeof n.ts === 'number' ? n.ts : 0, label: n.label || '' })) : []
      })) : []
    }));
    return s;
  }

  function loadState() {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? migrate(JSON.parse(r)) : defaultState(); }
    catch (e) { return defaultState(); }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    _scheduledCloudSync();
  }

  // ── Offline/Skip Auth ────────────────────────────────────────────────────
  let _authSkipped = (function() {
    try { return localStorage.getItem('stk_auth_skipped') === '1'; } catch(_) { return false; }
  })();

  // ── Firebase / Cloud Sync ────────────────────────────────────────────────
  // 'loading' → still initialising | 'ready' → _auth set | 'failed' → gave up
  let _authInitState = 'loading';
  // True once getRedirectResult() has settled — suppresses the login modal
  // during the brief null flash that happens before a redirect result is applied
  let _redirectCheckDone = false;
  // Timer handle for the 3-second modal delay
  let _modalDelayTimer = null;
  // Persisted flag: was the user signed in during the last session?
  // Used to keep the modal hidden while the redirect bounce is resolving.
  function _wasLoggedIn() {
    try { return localStorage.getItem('stk_logged_in') === '1'; } catch(_) { return false; }
  }

  // Schedule the login modal to appear after a 3-second delay.
  // This gives Firebase time to restore a persisted session OR process a redirect
  // result before interrupting the user. Cancelled immediately if a user signs in.
  function _scheduleModal() {
    if (_authSkipped) return;
    // Returning user: Firebase will fire onAuthStateChanged(user) soon — don't rush
    if (!_redirectCheckDone && _wasLoggedIn()) return;
    // Cancel any existing pending timer before setting a new one
    if (_modalDelayTimer) { clearTimeout(_modalDelayTimer); _modalDelayTimer = null; }
    _modalDelayTimer = setTimeout(() => {
      _modalDelayTimer = null;
      if (_authSkipped) return;
      if (_auth && _auth.currentUser) return;
      showAuthModal();
    }, 3000);
  }
  function _cancelModalTimer() {
    if (_modalDelayTimer) { clearTimeout(_modalDelayTimer); _modalDelayTimer = null; }
  }

  // Called when a sign-in button is tapped before Firebase is ready.
  // Only polls when Firebase IS configured (just slow). Gives up cleanly at 7 s.
  function _runWhenAuthReady(fn) {
    if (_auth) { fn(); return; }

    // Config fetch already failed — no point waiting
    if (_authInitState === 'failed') {
      _showAuthErrorWithRetry('Sign-in unavailable.');
      return;
    }

    // Firebase is configured but still connecting — wait up to 7 s, then try anyway
    _showAuthError('Connecting… please wait a moment.');
    let waited = 0;
    const poll = setInterval(() => {
      waited += 500;
      if (_auth) {
        clearInterval(poll);
        _clearAuthError();
        fn();
      } else if (_authInitState === 'failed' || waited >= 7000) {
        clearInterval(poll);
        _clearAuthError();
        // Attempt the action anyway — Firebase may still accept the call
        if (_auth) { fn(); } else { _showAuthErrorWithRetry('Connection slow — tap again or'); }
      }
    }, 500);
  }

  var FIREBASE_CONFIG = (window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.apiKey)
    ? window.__FIREBASE_CONFIG__
    : {
        apiKey:            'AIzaSyCRg1W9ueQp80kfDbS-o5VdDZmW7I9AbMQ',
        authDomain:        'study-hub-app-f3431.firebaseapp.com',
        projectId:         'study-hub-app-f3431',
        storageBucket:     'study-hub-app-f3431.firebasestorage.app',
        messagingSenderId: '18536531099',
        appId:             '1:18536531099:web:6b691f03283530c927f23e',
        measurementId:     'G-HSRVYWG6D6'
      };

  function _initFirebase() {
    if (typeof firebase === 'undefined') {
      console.warn('[Firebase] SDK not loaded yet — retrying in 2 s…');
      setTimeout(() => {
        if (typeof firebase === 'undefined') {
          console.error('[Firebase] SDK unavailable after retry — running offline.');
          _authInitState = 'failed';
          _authSetReady();
          if (!_authSkipped) _scheduleModal();
        } else {
          _initFirebase();
        }
      }, 2000);
      return;
    }

    // 7-second safety net: unblock the form so the user is never permanently stuck
    var _initDeadline = setTimeout(() => {
      if (_auth) return;
      console.warn('[Firebase] Auth not ready after 7 s — showing form anyway.');
      _authSetReady();
      if (!_authSkipped) _scheduleModal();
    }, 7000);

    console.log('[Firebase] Applying config for project:', FIREBASE_CONFIG.projectId);
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      _db             = firebase.firestore();
      _auth           = firebase.auth();
      _authConfigured = true;
      _authInitState  = 'ready';
      clearTimeout(_initDeadline);
      _authSetReady();

      console.log('[Firebase] Initialized successfully. Auth:', !!_auth, '| Project:', FIREBASE_CONFIG.projectId);

      // Set LOCAL persistence so verified users stay logged in across sessions.
      _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => console.log('[Firebase] Persistence set to LOCAL.'))
        .catch(e => console.warn('[Firebase] Persistence warning:', e.message));

      // No redirect flow — mark as resolved immediately so _scheduleModal
      // can run for new users right away (still delayed 3 s by the timer).
      _redirectCheckDone = true;

      // Register auth-state listener — fires with current user or null
      _auth.onAuthStateChanged(_handleAuthStateChange);
    } catch (e) {
      clearTimeout(_initDeadline);
      console.error('[Firebase] initializeApp failed:', e.message);
      _authInitState  = 'failed';
      _authConfigured = false;
      _authSetReady();
      if (!_authSkipped) {
        _scheduleModal();
        _showAuthError('Firebase initialization failed. Use "Continue without signing in" to use the app offline.');
      }
    }
  }

  function _setCloudStatus(status) {
    const el = document.getElementById('cloud-sync-icon');
    if (!el) return;
    el.className = 'cloud-sync-icon cloud-' + status;
    const msgs = {
      idle:    'Cloud sync ready',
      syncing: 'Saving to cloud\u2026',
      synced:  'Saved to cloud \u2713',
      error:   'Sync failed \u2014 working offline'
    };
    el.title = msgs[status] || '';
  }

  function _scheduledCloudSync() {
    if (!_db || !_userId || !(_auth && _auth.currentUser)) return;
    clearTimeout(_cloudSyncTimer);
    _setCloudStatus('syncing');
    _cloudSyncTimer = setTimeout(() => {
      _db.collection('users').doc(_userId).set({
        data:       JSON.stringify(state),
        uid:        _userId,
        updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => {
        _setCloudStatus('synced');
        setTimeout(() => _setCloudStatus('idle'), 3000);
      }).catch(e => {
        console.warn('[Firestore] Write failed:', e.message);
        _setCloudStatus('error');
        setTimeout(() => _setCloudStatus('idle'), 5000);
      });
    }, 3000);
  }

  async function _restoreFromCloud() {
    if (!_db || !_userId) return;
    try {
      _setCloudStatus('syncing');
      const snap = await _db.collection('users').doc(_userId).get();
      if (!snap.exists) { _setCloudStatus('idle'); return; }
      const raw = snap.data().data;
      if (!raw) { _setCloudStatus('idle'); return; }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.subjects)) { _setCloudStatus('idle'); return; }
      state = migrate(JSON.parse(JSON.stringify(parsed)));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      renderAll();
      _setCloudStatus('synced');
      setTimeout(() => _setCloudStatus('idle'), 3000);
      toast('\u2601\ufe0f Data restored from cloud!', 'success', 4500);
    } catch (e) {
      console.warn('[Firestore] Restore failed:', e.message);
      _setCloudStatus('error');
      setTimeout(() => _setCloudStatus('idle'), 5000);
    }
  }

  // ── Auth State Handler ───────────────────────────────────────────────────
  async function _handleAuthStateChange(user) {
    if (user) {
      // ── Confirmed login ──
      _cancelModalTimer();
      try { localStorage.setItem('stk_logged_in', '1'); } catch(_) {}
      _userId = user.uid;
      _authSkipped = false;
      try { localStorage.removeItem('stk_auth_skipped'); } catch(_) {}
      hideAuthModal();
      // Always land on Home tab after login
      switchTab('home');
      renderAll();
      _sSocialInit();
      refreshSettingsIfOpen();
      console.log('[Auth] Signed in:', user.email || user.uid);
      if (!_db) return;
      _setCloudStatus('syncing');
      try {
        const snap = await _db.collection('users').doc(user.uid).get();
        if (snap.exists && snap.data() && snap.data().data) {
          const parsed = JSON.parse(snap.data().data);
          if (parsed && Array.isArray(parsed.subjects)) {
            state = migrate(JSON.parse(JSON.stringify(parsed)));
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
            // Restore joined rooms from Firestore profile
            const savedRooms = snap.data().joinedRooms;
            if (Array.isArray(savedRooms) && savedRooms.length) {
              _myGroupCodes = savedRooms;
              try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
            }
            renderAll();
            if (_currentTab === 'social') renderSocial();
            _setCloudStatus('synced');
            setTimeout(() => _setCloudStatus('idle'), 3000);
            toast('\u2601\ufe0f Synced from your account!', 'success', 4000);
            return;
          }
        }
        // No cloud data yet — but try to restore joinedRooms if it exists
        const existingRooms = snap.exists && snap.data() && snap.data().joinedRooms;
        if (Array.isArray(existingRooms) && existingRooms.length) {
          _myGroupCodes = existingRooms;
          try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        }
        // Upload current local state
        await _db.collection('users').doc(user.uid).set({
          data:        JSON.stringify(state),
          uid:         user.uid,
          joinedRooms: _myGroupCodes,
          updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        _setCloudStatus('synced');
        setTimeout(() => _setCloudStatus('idle'), 3000);
        toast('\u2705 Account linked! Data saved to cloud.', 'success', 4000);
      } catch (e) {
        console.warn('[Auth] Sync error:', e.message);
        _setCloudStatus('error');
        setTimeout(() => _setCloudStatus('idle'), 5000);
      }
    } else {
      _userId = null;
      _setCloudStatus('idle');
      if (!_authSkipped) _scheduleModal();
      refreshSettingsIfOpen();
    }
  }

  // ── Auth UI Helpers ──────────────────────────────────────────────────────
  function showAuthModal() {
    const el = document.getElementById('auth-overlay');
    if (!el) return;
    el.classList.remove('hidden');

    // Belt-and-suspenders: bind form submit directly (in case event delegation misses it)
    const form = document.getElementById('auth-form');
    if (form && !form._authBound) {
      form._authBound = true;
      form.addEventListener('submit', e => { e.preventDefault(); _authSubmit(); });
      // With auth-submit as type="button", browsers won't fire submit on Enter in multi-field
      // forms. Handle Enter key on any form input directly.
      form.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); _authSubmit(); }
      });
    }
    // Belt-and-suspenders: bind Sign In button directly
    const submitBtn = document.getElementById('auth-submit');
    if (submitBtn && !submitBtn._authBound) {
      submitBtn._authBound = true;
      submitBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _authSubmit(); });
    }
    // Belt-and-suspenders: bind Forgot Password button directly
    const forgotBtn = el.querySelector('[data-act="auth-forgot"]');
    if (forgotBtn && !forgotBtn._authBound) {
      forgotBtn._authBound = true;
      forgotBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _authForgotPassword(); });
    }

  }
  function hideAuthModal() {
    const el = document.getElementById('auth-overlay');
    if (el) el.classList.add('hidden');
    _clearAuthError();
  }
  function _showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function _clearAuthError() {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('auth-success');
    el.innerHTML = '';
  }
  function _showAuthSuccess(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('auth-success');
  }
  // Show a small non-intrusive refresh button for connection issues (no red error box)
  function _showAuthErrorWithRetry(msg) {
    // Hide the red error box — connection issues shouldn't alarm the user
    const errEl = document.getElementById('auth-error');
    if (errEl) errEl.classList.add('hidden');

    const existingBtn = document.getElementById('auth-refresh-btn');
    if (existingBtn) return; // already showing

    const btn = document.createElement('button');
    btn.id = 'auth-refresh-btn';
    btn.textContent = '↻ Refresh to reconnect';
    btn.style.cssText = [
      'display:block', 'margin:10px auto 0', 'background:none', 'border:1px solid rgba(165,180,252,0.35)',
      'color:rgba(165,180,252,0.85)', 'font-size:12px', 'font-family:inherit', 'padding:5px 14px',
      'border-radius:20px', 'cursor:pointer', 'letter-spacing:0.02em', 'transition:opacity .2s'
    ].join(';');
    btn.onmouseenter = () => { btn.style.opacity = '0.7'; };
    btn.onmouseleave = () => { btn.style.opacity = '1'; };
    btn.onclick = () => window.location.reload();

    const card = document.querySelector('.auth-card');
    if (card) card.appendChild(btn);
  }
  // Call once Firebase is ready (or we give up waiting) to reveal the sign-in form
  function _authSetReady() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('auth-loading');
  }
  function _setAuthLoading(loading) {
    const btn = document.getElementById('auth-submit');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading
      ? 'Please wait\u2026'
      : (_authMode === 'login' ? 'Sign In' : 'Create Account');
  }
  function _authErrorMsg(code) {
    const domain = window.location.hostname;
    const map = {
      'auth/invalid-email':          'Invalid email address.',
      'auth/user-not-found':         'No account found with this email.',
      'auth/wrong-password':         'Incorrect password.',
      'auth/invalid-credential':     'Invalid email or password.',
      'auth/email-already-in-use':   'An account with this email already exists.',
      'auth/weak-password':          'Password must be at least 6 characters.',
      'auth/too-many-requests':      'Too many attempts. Please try again later.',
      'auth/network-request-failed': 'Network error. Check your connection.',
      'auth/unauthorized-domain':    `Domain not authorized. Add this domain in Firebase Console → Authentication → Settings → Authorized Domains.`,
      'auth/internal-error':         'Authentication error. Please try again.',
      'auth/user-disabled':          'This account has been disabled.'
    };
    return map[code] !== undefined ? map[code] : 'Authentication failed. Please try again.';
  }

  // ── Auth Actions ─────────────────────────────────────────────────────────
  function _authToggleMode() {
    _authMode = _authMode === 'login' ? 'signup' : 'login';
    const isLogin = _authMode === 'login';
    const el = (id) => document.getElementById(id);
    if (el('auth-submit'))      el('auth-submit').textContent    = isLogin ? 'Sign In' : 'Create Account';
    if (el('auth-toggle-btn'))  el('auth-toggle-btn').textContent = isLogin ? 'Sign Up' : 'Sign In';
    if (el('auth-toggle-text')) el('auth-toggle-text').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
    if (el('auth-subtitle'))    el('auth-subtitle').textContent   = isLogin ? 'Sign in to sync your progress' : 'Create an account to save your progress';
    _clearAuthError();
  }
  async function _authSubmit() {
    if (!_auth) { _runWhenAuthReady(() => _authSubmit()); return; }
    const email    = (document.getElementById('auth-email')?.value    || '').trim();
    const password =  document.getElementById('auth-password')?.value || '';
    if (!email)    { _showAuthError('Please enter your email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _showAuthError('Please enter a valid email address (e.g. user@example.com).');
      return;
    }
    if (!password) { _showAuthError('Please enter your password.'); return; }
    _setAuthLoading(true);
    _clearAuthError();
    try {
      if (_authMode === 'login') {
        await _auth.signInWithEmailAndPassword(email, password);
      } else {
        await _auth.createUserWithEmailAndPassword(email, password);
      }
      // onAuthStateChanged(user) fires next — handles navigation, sync, modal hide
    } catch (e) {
      console.error('[Auth] Auth error:', e.code, e.message);
      _setAuthLoading(false);
      _showAuthError(_authErrorMsg(e.code) || 'Invalid email or password.');
    }
  }
  async function _authForgotPassword() {
    if (!_auth) {
      _runWhenAuthReady(() => _authForgotPassword());
      return;
    }
    const email = (document.getElementById('auth-email')?.value || '').trim();
    if (!email) { _showAuthError('Enter your email address above first.'); return; }
    try {
      await _auth.sendPasswordResetEmail(email);
      _showAuthSuccess('✓ Reset email sent! Check your inbox (and spam folder).');
    } catch (e) {
      console.error('[Auth] Password reset error:', e.code, e.message);
      const msg = _authErrorMsg(e.code) || 'Failed to send reset email. Please try again.';
      _showAuthError(msg);
    }
  }
  async function _authSignOut() {
    if (!_auth) return;
    try {
      // Persist joined rooms to Firestore before signing out so they're restored on next login
      if (_db && _userId && _myGroupCodes.length) {
        _db.collection('users').doc(_userId).set({ joinedRooms: _myGroupCodes }, { merge: true }).catch(() => {});
      }
      try { localStorage.removeItem('stk_logged_in'); } catch(_) {}
      await _auth.signOut();
      toast('Signed out successfully', 'info', 3000);
    } catch (e) { console.warn('[Auth] Sign out error:', e.message); }
  }

  // ======================================================================
  // ========== Social Study System =======================================
  // ======================================================================
  const SOCIAL_OFFLINE_MS = 3 * 60 * 1000;
  const SOCIAL_BOUNTY_XP  = 50;
  let _socialRoomCode       = null;
  let _socialMembers        = {};
  let _socialRoomData       = null;
  let _socialUnsubPresence  = null;
  let _socialUnsubRoom      = null;
  let _socialHeartbeatId    = null;
  let _socialLobbyCode      = null;
  let _socialPrevStatuses   = {};
  let _socialPrevRanks      = {};
  let _momentumConfettiFired = false;
  let _vaultCelebFired      = false;
  let _socialLiveTimerId    = null;
  let _vaultThemeNotified   = false;

  // ── Multi-group / Global LB / Voice ──────────────────────────────────────
  let _myGroupCodes    = [];
  let _lbView          = 'group';
  let _globalLbData    = [];
  let _globalLbUnsub   = null;
  let _voicePeers      = {};
  let _localStream     = null;
  let _voiceMembers    = {};
  let _voiceSignalUnsub  = null;
  let _voicePresentUnsub = null;
  let _inVoice         = false;
  let _voiceMuted      = false;
  let _voiceRemoteAudios = {};

  function _sDisplayName() {
    if (state.profile && state.profile.name) return state.profile.name;
    const u = _auth && _auth.currentUser;
    if (u) return u.displayName || (u.email && u.email.split('@')[0]) || 'Studier';
    return 'Studier';
  }
  function _sInitials(name) {
    const p = (name || 'S').trim().split(/\s+/);
    return (p.length >= 2 ? p[0][0] + p[1][0] : (name || 'S').slice(0, 2)).toUpperCase();
  }
  function _sStatusOf(m) {
    if (!m || !m.lastSeen) return 'offline';
    const ms = typeof m.lastSeen === 'number' ? m.lastSeen : (m.lastSeen.toMillis ? m.lastSeen.toMillis() : 0);
    return (!ms || Date.now() - ms > SOCIAL_OFFLINE_MS) ? 'offline' : (m.status || 'break');
  }
  function _sAvatarColor(uid_) {
    const C = ['#5badff','#a78bfa','#f472b6','#34d399','#fbbf24','#fb7185','#38bdf8','#818cf8'];
    let h = 0; for (let i = 0; i < (uid_ || '').length; i++) h = ((h << 5) - h + uid_.charCodeAt(i)) | 0;
    return C[Math.abs(h) % C.length];
  }
  function _sWeekStart() {
    const d = new Date(todayKey() + 'T00:00:00'), dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return localISO(d);
  }
  function _sWeeklyMinutes() {
    const m = (state.focusStats && state.focusStats.minutesByDate) || {}, s = _sWeekStart();
    return Object.entries(m).reduce((a, [k, v]) => a + (k >= s ? v : 0), 0);
  }
  function _sWeeklyXP() { return Math.round(_sWeeklyMinutes() * 25 / 30); }
  function _sGenerateCode() {
    const C = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => C[Math.floor(Math.random() * C.length)]).join('');
  }

  async function _sUpdatePresence(status, extra) {
    if (!_db || !_userId || !_socialRoomCode) return;
    const u = _auth && _auth.currentUser;
    let focusSubjectName = '';
    if (status === 'focusing' && typeof focusCurrentTaskKey !== 'undefined' && focusCurrentTaskKey) {
      try {
        const tasks = typeof getActivePlanTasks === 'function' ? getActivePlanTasks() : [];
        const task = tasks.find(t => t.key === focusCurrentTaskKey);
        if (task && task.subId) {
          const sub = state.subjects.find(s => s.id === task.subId);
          if (sub) focusSubjectName = sub.name;
        }
      } catch (_) {}
    }
    try {
      await _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(_userId).set({
        uid: _userId, displayName: _sDisplayName(), email: (u && u.email) || '',
        status, lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        xpTotal: (state.xp && state.xp.total) || 0, weeklyXP: _sWeeklyXP(),
        weeklyMinutes: _sWeeklyMinutes(),
        subjectMinutes: (state.focusStats && state.focusStats.minutesBySubject) || {},
        focusStartedAt: status === 'focusing' ? (focusStartTime || Date.now()) : null,
        focusSubjectName: status === 'focusing' ? focusSubjectName : '',
        studyStreak: (state.streak && state.streak.count) || 0,
        avatarUrl: state.profile.avatarDataUrl || '',
        totalFocusMinutes: Object.values((state.focusStats && state.focusStats.minutesByDate) || {}).reduce((a, b) => a + b, 0),
        ...(extra || {})
      }, { merge: true });
    } catch (e) { console.warn('[Social] Presence failed:', e.message); }
  }

  function _sSubscribe() {
    if (!_db || !_socialRoomCode) return;
    if (_socialUnsubPresence) { _socialUnsubPresence(); _socialUnsubPresence = null; }
    if (_socialUnsubRoom)     { _socialUnsubRoom();     _socialUnsubRoom = null; }
    _socialUnsubPresence = _db.collection('groups').doc(_socialRoomCode).collection('presence')
      .onSnapshot(snap => {
        snap.docChanges().forEach(change => {
          if (change.type === 'removed') { delete _socialMembers[change.doc.id]; return; }
          const data = { ...change.doc.data() };
          if (data.lastSeen && typeof data.lastSeen.toMillis === 'function') data.lastSeen = data.lastSeen.toMillis();
          _socialMembers[data.uid] = data;
          // Real-time toast: detect when a teammate starts focusing
          if (data.uid !== _userId && data.status === 'focusing') {
            const prev = _socialPrevStatuses[data.uid];
            if (prev !== undefined && prev !== 'focusing') {
              const subNote = data.focusSubjectName ? ` on ${escapeHTML(data.focusSubjectName)}` : '';
              toast(`🎯 ${escapeHTML(data.displayName || 'A teammate')} just started a focus session${subNote}!`, 'info', 4500);
            }
          }
          _socialPrevStatuses[data.uid] = data.status;
          if (data.uid !== _userId) return;
          // Nudge (poke)
          if (data.nudge && data.nudge.ts && Date.now() - data.nudge.ts < 12000) {
            toast(`👋 ${escapeHTML(data.nudge.fromName)} is poking you — get back to studying!`, 'warn', 6000);
            _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(_userId)
              .update({ nudge: firebase.firestore.FieldValue.delete() }).catch(() => {});
          }
          // Focus Bounty
          if (data.pendingBounty && data.pendingBounty > 0) {
            const bounty = data.pendingBounty;
            gamificationManager.addXP(bounty, 'focus_bounty');
            saveState();
            toast(`🎁 +${bounty} XP Focus Bounty — a teammate quit early!`, 'success', 5000);
            _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(_userId)
              .update({ pendingBounty: firebase.firestore.FieldValue.delete() }).catch(() => {});
          }
          // Duel Challenge
          if (data.pendingDuelChallenge && Date.now() - data.pendingDuelChallenge.ts < 20000) {
            const ch = { ...data.pendingDuelChallenge };
            _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(_userId)
              .update({ pendingDuelChallenge: firebase.firestore.FieldValue.delete() }).catch(() => {});
            openModal(`<h3>⚔️ XP Duel Challenge!</h3>
              <p style="color:var(--text-muted);font-size:14px;margin:8px 0 16px">
                <strong>${escapeHTML(ch.fromName)}</strong> challenges you to a <strong>2-hour XP Duel</strong>!<br>
                The player who earns the most XP wins the <strong>⚔️ Duel Victor</strong> badge.
              </p>
              <div class="actions"><button class="btn btn-ghost" id="duel-decline">Decline</button><button class="btn" id="duel-accept">⚔️ Accept!</button></div>`,
              root => {
                root.querySelector('#duel-decline').onclick = () => { closeModal(); toast('Duel declined', 'info'); };
                root.querySelector('#duel-accept').onclick = async () => {
                  closeModal();
                  const duel = {
                    id: uid(), challenger: ch.fromUid, challengerName: ch.fromName, challengerXPStart: ch.challengerXPStart,
                    opponent: _userId, opponentName: _sDisplayName(), opponentXPStart: (state.xp && state.xp.total) || 0,
                    startedAt: Date.now(), endsAt: Date.now() + 2 * 60 * 60 * 1000, winner: null
                  };
                  try {
                    await _db.collection('groups').doc(_socialRoomCode).update({ duels: firebase.firestore.FieldValue.arrayUnion(duel) });
                    toast('⚔️ Duel started! 2 hours — fight!', 'success', 5000);
                  } catch (e2) { toast('Failed to start duel', 'danger'); }
                };
              });
          }
        });
        if (_currentTab === 'social') renderSocial();
      }, e => { console.warn('[Social] Presence error:', e.message); });
    _socialUnsubRoom = _db.collection('groups').doc(_socialRoomCode)
      .onSnapshot(snap => {
        _socialRoomData = snap.exists ? snap.data() : null;
        _sCheckDuelResults();
        // Theme unlock detection
        if (_socialRoomData && _socialRoomData.vaultThemeUnlocked) {
          const tid = _socialRoomData.vaultThemeUnlocked;
          _unlockTheme(tid);
          if (!_vaultThemeNotified) {
            _vaultThemeNotified = true;
            const tObj = _THEMES.find(t => t.id === tid);
            toast(`🎨 Group theme unlocked: ${tObj ? tObj.icon + ' ' + tObj.name : tid}! Open Theme Gallery to equip it.`, 'success', 8000);
          }
        }
        if (_currentTab === 'social') renderSocial();
      }, e => { console.warn('[Social] Room error:', e.message); });
    if (_socialHeartbeatId) clearInterval(_socialHeartbeatId);
    _socialHeartbeatId = setInterval(() => {
      _sUpdatePresence((focusRunning && focusMode === 'work') ? 'focusing' : 'break');
    }, 30000);
  }

  function _sCheckDuelResults() {
    if (!_socialRoomData || !Array.isArray(_socialRoomData.duels)) return;
    const now = Date.now();
    _socialRoomData.duels.forEach(duel => {
      if (duel.winner || duel.endsAt > now) return;
      if (duel.challenger !== _userId && duel.opponent !== _userId) return;
      const iAm = duel.challenger === _userId;
      const myXPS = iAm ? duel.challengerXPStart : duel.opponentXPStart;
      const oppUid = iAm ? duel.opponent : duel.challenger;
      const myG = Math.max(0, ((state.xp && state.xp.total) || 0) - myXPS);
      const opp = _socialMembers[oppUid];
      const oppXPS = iAm ? duel.opponentXPStart : duel.challengerXPStart;
      const oppG = opp ? Math.max(0, (opp.xpTotal || 0) - oppXPS) : 0;
      const winnerId = myG >= oppG ? _userId : oppUid;
      const updated = (_socialRoomData.duels || []).map(d => d.id === duel.id ? { ...d, winner: winnerId } : d);
      _db.collection('groups').doc(_socialRoomCode).update({ duels: updated }).catch(() => {});
      if (winnerId === _userId) {
        toast(`🏆 Duel Victor! +${myG} XP vs ${oppG} XP — you won!`, 'success', 7000);
        if (!state.badges) state.badges = {};
        if (!state.badges['duel_victor']) {
          state.badges['duel_victor'] = { unlockedAt: new Date().toISOString() };
          saveState();
          achievementToast({ icon: '⚔️', name: 'Duel Victor', desc: 'Won a 2-hour XP Duel against a friend' });
        }
      } else {
        toast(`⚔️ Duel over. They won (+${oppG} vs +${myG} XP). Train harder!`, 'warn', 7000);
      }
    });
  }

  async function _sJoinRoom(code) {
    if (!_db || !_userId) { toast('Sign in to use Social Study', 'warn'); return false; }
    code = (code || '').toString().trim().toUpperCase();
    if (!code || code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) { toast('Enter a valid 6-character room code', 'warn'); return false; }
    try {
      const ref = _db.collection('groups').doc(code);
      if (!(await ref.get()).exists) {
        await ref.set({ roomCode: code, createdBy: _userId, createdAt: firebase.firestore.FieldValue.serverTimestamp(), groupGoals: [], duels: [], groupVault: null });
      }
      _socialRoomCode = code;
      _socialLobbyCode = null;
      try { localStorage.setItem('social_room_code', code); } catch (e) {}
      // Track in My Groups
      if (!_myGroupCodes.includes(code)) {
        _myGroupCodes.push(code);
        try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        if (_db && _userId) _db.collection('users').doc(_userId).update({ joinedRooms: _myGroupCodes }).catch(() => {});
      }
      await _sUpdatePresence('break');
      _sSubscribe();
      _updateGlobalLb();
      toast(`✅ Joined room ${code}!`, 'success');
      // Award Group Member achievement on first room join
      checkBadges({ joinedRoom: true });
      renderSocial();
      return true;
    } catch (e) { console.warn('[Social] Join failed:', e.message); toast('Failed to join room', 'danger'); return false; }
  }

  function _sLeaveRoom() {
    _stopSocialLiveTimers();
    if (_socialUnsubPresence) { _socialUnsubPresence(); _socialUnsubPresence = null; }
    if (_socialUnsubRoom)     { _socialUnsubRoom();     _socialUnsubRoom = null; }
    if (_socialHeartbeatId)   { clearInterval(_socialHeartbeatId); _socialHeartbeatId = null; }
    if (_db && _userId && _socialRoomCode) {
      _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(_userId)
        .update({ status: 'offline' }).catch(() => {});
    }
    _socialRoomCode = null; _socialMembers = {}; _socialRoomData = null;
    _socialLobbyCode = null;
    try { localStorage.removeItem('social_room_code'); } catch (e) {}
    // Also leave voice if active
    if (_inVoice) _voiceLeave(true);
    renderSocial(); toast('Left the room', 'info');
  }

  async function _sNudge(memberUid, memberName) {
    if (!_db || !_userId || !_socialRoomCode) return;
    try {
      await _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(memberUid)
        .update({ nudge: { from: _userId, fromName: _sDisplayName(), ts: Date.now() } });
      toast(`👋 Poked ${escapeHTML(memberName)}!`, 'success');
    } catch (e) { toast('Poke failed', 'danger'); }
  }

  async function _sChallengeDuel(memberUid, memberName) {
    if (!_db || !_userId || !_socialRoomCode) return;
    const existing = (_socialRoomData && _socialRoomData.duels || []).find(d =>
      !d.winner && d.endsAt > Date.now() &&
      ((d.challenger === _userId && d.opponent === memberUid) || (d.opponent === _userId && d.challenger === memberUid)));
    if (existing) { toast('A duel with this person is already active!', 'warn'); return; }
    try {
      await _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(memberUid)
        .update({ pendingDuelChallenge: { fromUid: _userId, fromName: _sDisplayName(), challengerXPStart: (state.xp && state.xp.total) || 0, ts: Date.now() } });
      toast(`⚔️ Duel challenge sent to ${escapeHTML(memberName)}!`, 'success');
    } catch (e) { toast('Failed to send challenge', 'danger'); }
  }

  async function _sHandleFocusBounty() {
    if (!_db || !_userId || !_socialRoomCode) return;
    const others = Object.values(_socialMembers).filter(m => m.uid !== _userId && _sStatusOf(m) !== 'offline');
    if (!others.length) return;
    const deduct = Math.min(SOCIAL_BOUNTY_XP, Math.max(0, (state.xp && state.xp.total) || 0));
    if (deduct <= 0) return;
    state.xp.total = Math.max(0, state.xp.total - deduct);
    gamificationManager._updateXPBar(); saveState();
    const n = others.length;
    toast(`⚠️ Early quit! −${deduct} XP distributed to ${n} teammate${n !== 1 ? 's' : ''}`, 'warn', 5000);
    const share = Math.max(1, Math.floor(deduct / n));
    await Promise.all(others.map(m =>
      _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(m.uid)
        .update({ pendingBounty: firebase.firestore.FieldValue.increment(share) }).catch(() => {})));
  }

  async function _sAddGroupGoal(title, targetHours) {
    if (!_db || !_socialRoomCode) return;
    const g = { id: uid(), title, targetMinutes: Math.round(targetHours * 60), contributions: {}, createdAt: Date.now() };
    try {
      await _db.collection('groups').doc(_socialRoomCode).update({ groupGoals: firebase.firestore.FieldValue.arrayUnion(g) });
      toast('Group goal created! 🎯', 'success');
    } catch (e) { toast('Failed to add goal', 'danger'); }
  }

  async function _sRemoveGroupGoal(goalId) {
    if (!_db || !_socialRoomCode || !_socialRoomData) return;
    try {
      await _db.collection('groups').doc(_socialRoomCode).update({ groupGoals: (_socialRoomData.groupGoals || []).filter(g => g.id !== goalId) });
      toast('Goal removed', 'info');
    } catch (e) { toast('Failed to remove goal', 'danger'); }
  }

  async function _sContributeToGoals(minutes) {
    if (!_db || !_userId || !_socialRoomCode || !_socialRoomData || !minutes) return;
    const goals = _socialRoomData.groupGoals || [];
    if (!goals.length) return;
    const updated = goals.map(g => {
      const tot = Object.values(g.contributions || {}).reduce((a, b) => a + b, 0);
      if (tot >= g.targetMinutes) return g;
      return { ...g, contributions: { ...(g.contributions || {}), [_userId]: ((g.contributions || {})[_userId] || 0) + minutes } };
    });
    try { await _db.collection('groups').doc(_socialRoomCode).update({ groupGoals: updated }); }
    catch (e) { console.warn('[Social] Goal contribution failed:', e.message); }
  }

  function _sSubjectEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('physics')) return '⚛️';
    if (n.includes('chem')) return '🧪';
    if (n.includes('math') || n.includes('calc') || n.includes('algebra') || n.includes('stat')) return '📐';
    if (n.includes('bio')) return '🧬';
    if (n.includes('english') || n.includes('liter') || n.includes('writing') || n.includes('essay')) return '📝';
    if (n.includes('hist')) return '📜';
    if (n.includes('geo')) return '🌍';
    if (n.includes('computer') || n.includes(' cs') || n.includes('program') || n.includes('coding') || n.includes('software')) return '💻';
    if (n.includes('econ')) return '📊';
    if (n.includes('art') || n.includes('design')) return '🎨';
    if (n.includes('music')) return '🎵';
    if (n.includes('french') || n.includes('spanish') || n.includes('german') || n.includes('lang')) return '🗣️';
    if (n.includes('law') || n.includes('legal')) return '⚖️';
    if (n.includes('med') || n.includes('anatomy')) return '🏥';
    return '📚';
  }

  function _sFireConfetti() {
    const colors = ['#5badff','#a78bfa','#f472b6','#34d399','#fbbf24','#fb7185','#60a5fa','#4ade80'];
    for (let i = 0; i < 90; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      const size = 6 + Math.random() * 8;
      el.style.cssText = `left:${Math.random() * 100}vw;background:${colors[Math.floor(Math.random() * colors.length)]};animation-duration:${0.9 + Math.random() * 1.4}s;animation-delay:${Math.random() * 0.6}s;width:${size}px;height:${size}px;border-radius:${Math.random() > 0.5 ? '50%' : '3px'};`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2800);
    }
    toast('🎉 Collective Momentum maxed! Your group is on fire!', 'success', 5000);
  }

  function _triggerVaultCelebration(tierNum, rewardLabel, rewardIcon) {
    const tier = tierNum || 1;
    const icon = rewardIcon || '🏦';
    const label = rewardLabel || 'Group Achievement';
    const rarityMap = { 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary', 5: 'legendary' };
    const rarity = rarityMap[Math.min(tier, 5)] || 'legendary';
    document.querySelectorAll('.vault-celeb-overlay').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'vault-celeb-overlay';
    overlay.innerHTML = `
      <div class="vault-celeb-inner">
        <div class="vault-celeb-tier-badge vault-rarity-${rarity}">TIER ${tier} COMPLETE</div>
        <div class="vault-celeb-icon">${icon}</div>
        <div class="vault-celeb-sparks">✨ ⚡ 🔥 ⚡ ✨</div>
        <h1 class="vault-celeb-title">VAULT UNLOCKED!</h1>
        <p class="vault-celeb-sub">Tier ${tier} conquered! Claim your <strong>${escapeHTML(label)}</strong> reward below. 🏆</p>
        <div class="vault-celeb-reward-row vault-celeb-rarity-${rarity}">
          <span style="font-size:22px">${icon}</span><span>${escapeHTML(label)}</span>
        </div>
        <button class="btn vault-celeb-close" onclick="this.closest('.vault-celeb-overlay').remove()">🎉 Awesome!</button>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('vault-celeb-show'));
    const colors = ['#fbbf24','#f59e0b','#5badff','#a78bfa','#f472b6','#34d399','#fb7185','#fff'];
    for (let i = 0; i < 160; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      const size = 5 + Math.random() * 11;
      p.style.cssText = `left:${Math.random()*100}vw;background:${colors[i%colors.length]};animation-duration:${0.8+Math.random()*1.8}s;animation-delay:${Math.random()*1.2}s;width:${size}px;height:${size}px;border-radius:${Math.random()>0.4?'50%':'3px'};z-index:200001`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 3600);
    }
    setTimeout(() => { overlay.classList.remove('vault-celeb-show'); setTimeout(() => overlay.remove(), 500); }, 9000);
  }

  async function _sDonateToVault(xpAmount) {
    if (!_db || !_userId || !_socialRoomCode || !_socialRoomData) return;
    const myXP = (state.xp && state.xp.total) || 0;
    if (xpAmount <= 0 || xpAmount > myXP) { toast('Invalid XP amount', 'warn'); return; }
    const vault = _socialRoomData.groupVault;
    if (!vault || !vault.goal) { toast('No vault active', 'warn'); return; }
    if (vault.pendingReward && vault.pendingReward.expiresAt > Date.now()) {
      toast('Vault just completed! Claim your reward first.', 'info'); return;
    }
    const vaultTotal = Object.values(vault.contributions || {}).reduce((a, b) => a + b, 0);
    if (vaultTotal >= vault.goal) { toast('Vault complete! Claim your reward.', 'info'); return; }
    state.xp.total = Math.max(0, myXP - xpAmount);
    gamificationManager._updateXPBar(); saveState();
    const newContribs = { ...(vault.contributions || {}), [_userId]: ((vault.contributions || {})[_userId] || 0) + xpAmount };
    const newTotal = Object.values(newContribs).reduce((a, b) => a + b, 0);
    const feedEntry = { uid: _userId, name: _sDisplayName(), amount: xpAmount, ts: Date.now() };
    const existingFeed = Array.isArray(vault.feed) ? vault.feed : [];
    const newFeed = [feedEntry, ...existingFeed].slice(0, 15);
    try {
      if (newTotal >= vault.goal) {
        await _sAdvanceVaultTier(vault, newContribs, newFeed, newTotal);
      } else {
        await _db.collection('groups').doc(_socialRoomCode).update({
          'groupVault.contributions': newContribs,
          'groupVault.feed': newFeed,
        });
        toast(`⚡ Donated ${xpAmount.toLocaleString()} XP to the vault!`, 'success');
      }
    } catch (e) {
      state.xp.total = myXP;
      gamificationManager._updateXPBar(); saveState();
      toast('Donation failed — XP refunded', 'danger');
    }
  }

  async function _sCreateVault() {
    if (!_db || !_socialRoomCode) { toast('Not in a room', 'warn'); return; }
    try {
      await _db.collection('groups').doc(_socialRoomCode).update({
        groupVault: { tier: 1, goal: 100, contributions: {}, createdAt: Date.now(),
          feed: [], history: [], pendingReward: null, booster: null }
      });
      toast('🏦 Group Vault launched! Pool XP together to unlock epic rewards.', 'success', 5000);
    } catch (e) { toast('Failed to create vault', 'danger'); }
  }

  function _vaultTierGoal(tier) {
    const goals = [0, 100, 500, 1000, 2500, 5000];
    if (tier <= 5) return goals[tier] || 100;
    return Math.round(5000 * Math.pow(2.5, tier - 5));
  }

  function _vaultTierReward(tier) {
    const rewards = [
      null,
      { type: 'dividend', icon: '⚡', label: 'XP Dividend',    desc: '5% of vault XP returned to contributors',                   pct: 0.05, boosterMult: 1.0,  boosterHours: 0,  rarity: 'common'    },
      { type: 'booster',  icon: '🚀', label: 'Group Booster',   desc: '1.25× XP Booster for 24h + 10% dividend',                   pct: 0.10, boosterMult: 1.25, boosterHours: 24, rarity: 'rare'      },
      { type: 'theme',    icon: '🎨', label: 'Room Theme',       desc: 'Exclusive group theme unlocked + 1.5× booster + 15% div',   pct: 0.15, boosterMult: 1.5,  boosterHours: 24, rarity: 'epic'      },
      { type: 'aura',     icon: '✨', label: 'Study Aura',       desc: '1.75× XP Booster for 48h + 18% dividend',                   pct: 0.18, boosterMult: 1.75, boosterHours: 48, rarity: 'epic'      },
      { type: 'prestige', icon: '👑', label: 'Prestige Reward',  desc: '2× XP Booster for 72h + 20% dividend + Avatar Border',      pct: 0.20, boosterMult: 2.0,  boosterHours: 72, rarity: 'legendary' },
    ];
    if (tier <= 5) return rewards[tier] || rewards[5];
    return { ...rewards[5], label: `Prestige ${tier - 4}`, pct: Math.min(0.25, 0.20 + (tier - 5) * 0.01),
      boosterMult: Math.min(3.0, 2.0 + (tier - 5) * 0.2), rarity: 'legendary' };
  }

  function _vaultRarityClass(tier) {
    if (tier <= 1) return 'vault-rarity-common';
    if (tier <= 2) return 'vault-rarity-rare';
    if (tier <= 3) return 'vault-rarity-epic';
    return 'vault-rarity-legendary';
  }

  async function _sAdvanceVaultTier(vault, finalContribs, finalFeed, finalTotal) {
    const currentTier = vault.tier || 1;
    const completedAt = Date.now();
    const completionSpeedMs = completedAt - (vault.createdAt || completedAt);
    const reward = _vaultTierReward(currentTier);
    const topContributors = Object.entries(finalContribs).sort(([, a], [, b]) => b - a).slice(0, 3)
      .map(([uid, amount]) => {
        const m = _socialMembers[uid];
        return { uid, name: m ? (m.displayName || 'User') : (uid === _userId ? _sDisplayName() : 'User'), amount };
      });
    const historyEntry = {
      tier: currentTier, goal: vault.goal, total: finalTotal, completedAt,
      completionSpeedMs, topContributors, reward: { icon: reward.icon, label: reward.label }
    };
    const existingHistory = Array.isArray(vault.history) ? vault.history : [];
    const newHistory = [...existingHistory, historyEntry].slice(-10);
    const dividendPool = Math.floor(finalTotal * reward.pct);
    const pendingReward = {
      type: reward.type, icon: reward.icon, label: reward.label, desc: reward.desc,
      dividendPool, boosterMult: reward.boosterMult, boosterHours: reward.boosterHours,
      expiresAt: completedAt + 24 * 3600000, claimedBy: {}, contributions: finalContribs
    };
    const nextTier = currentTier + 1;
    const nextGoal = _vaultTierGoal(nextTier);
    let booster = null;
    if (reward.boosterMult > 1) {
      booster = { multiplier: reward.boosterMult, label: reward.label, expiresAt: completedAt + reward.boosterHours * 3600000 };
    }
    if (currentTier >= 3) {
      const unlocked = _getUnlockedThemes();
      const nextTheme = _THEMES.find(t => t.unlockable && !unlocked.includes(t.id));
      if (nextTheme) {
        _db.collection('groups').doc(_socialRoomCode)
          .update({ vaultThemeUnlocked: nextTheme.id, vaultUnlockedAt: completedAt }).catch(() => {});
      }
    }
    await _db.collection('groups').doc(_socialRoomCode).update({
      groupVault: {
        tier: nextTier, goal: nextGoal, contributions: {}, createdAt: completedAt,
        feed: finalFeed, history: newHistory, pendingReward, booster
      }
    });
    toast(`🏦 Vault Tier ${currentTier} Complete! Claim your ${reward.icon} ${reward.label}!`, 'success', 6000);
    setTimeout(() => _triggerVaultCelebration(currentTier, reward.label, reward.icon), 800);
  }

  async function _sClaimVaultReward() {
    if (!_db || !_userId || !_socialRoomCode || !_socialRoomData) return;
    const vault = _socialRoomData.groupVault;
    if (!vault || !vault.pendingReward) { toast('No reward to claim', 'warn'); return; }
    const reward = vault.pendingReward;
    if (reward.claimedBy && reward.claimedBy[_userId]) { toast('Already claimed!', 'info'); return; }
    if (reward.expiresAt && Date.now() > reward.expiresAt) { toast('Reward expired', 'warn'); return; }
    const myContrib = (reward.contributions || {})[_userId] || 0;
    if (myContrib === 0) { toast('You didn\'t contribute to this vault tier', 'warn'); return; }
    const totalContrib = Object.values(reward.contributions || {}).reduce((a, b) => a + b, 0);
    const myShare = totalContrib > 0 ? Math.round(reward.dividendPool * (myContrib / totalContrib)) : 0;
    if (myShare > 0) {
      state.xp.total = (state.xp.total || 0) + myShare;
      gamificationManager._updateXPBar(); saveState();
      toast(`💰 Claimed ${myShare.toLocaleString()} XP dividend! 🎉`, 'success', 5000);
    } else {
      toast('✅ Reward claimed!', 'success');
    }
    try {
      await _db.collection('groups').doc(_socialRoomCode).update({
        [`groupVault.pendingReward.claimedBy.${_userId}`]: true
      });
    } catch (e) { console.warn('[Vault] Claim update failed', e); }
  }

  function _renderVaultSection() {
    const vault = (_socialRoomData && _socialRoomData.groupVault) || null;
    const myXPTotal = (state.xp && state.xp.total) || 0;
    const isCreator = _userId === (_socialRoomData && _socialRoomData.createdBy);
    if (!vault || !vault.goal) {
      if (!isCreator) return '';
      return `<h2 class="social-section-head">Group XP Vault</h2>
      <div class="social-vault-wrap">
        <div class="group-vault vault-empty-state">
          <div class="vault-empty-icon">🏦</div>
          <div class="vault-empty-title">Start the Group Vault</div>
          <p class="vault-empty-desc">Pool XP together across tiers to unlock exclusive rewards for every member of your room.</p>
          <button class="btn vault-start-btn" data-act="social-vault-create">⚡ Launch Group Vault</button>
        </div>
      </div>`;
    }
    const tier = vault.tier || 1;
    const goal = vault.goal;
    const contributions = vault.contributions || {};
    const vaultTotal = Object.values(contributions).reduce((a, b) => a + b, 0);
    const vaultPct = Math.min(100, Math.round(vaultTotal / goal * 100));
    const myContrib = contributions[_userId] || 0;
    const isComplete = vaultTotal >= goal;
    const reward = _vaultTierReward(tier);
    const rarityClass = _vaultRarityClass(tier);
    const pendingReward = vault.pendingReward || null;
    const hasPending = !!(pendingReward && pendingReward.expiresAt > Date.now());
    const alreadyClaimed = !!(hasPending && pendingReward.claimedBy && pendingReward.claimedBy[_userId]);
    const booster = vault.booster;
    const boosterActive = !!(booster && booster.expiresAt > Date.now());

    const boosterHTML = boosterActive ? (() => {
      const rem = Math.max(0, booster.expiresAt - Date.now());
      const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
      return `<div class="vault-booster-pill ${rarityClass}">
        <span>🚀</span><span class="vbp-label">${booster.multiplier}× XP Booster Active</span>
        <span class="vbp-timer" data-booster-expires="${booster.expiresAt}">${h}h ${m}m left</span>
      </div>`;
    })() : '';

    const barWidth = isComplete ? 100 : vaultPct;
    const contribCount = Object.keys(contributions).filter(u => contributions[u] > 0).length;
    const topContribs = Object.entries(contributions).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 3);
    const topContribsHTML = topContribs.length ? `<div class="vault-top-contribs">
      <div class="vtc-label">🏆 Top Contributors</div>
      ${topContribs.map(([uid, amount], i) => {
        const mb = _socialMembers[uid];
        const name = mb ? (mb.displayName || 'User') : (uid === _userId ? _sDisplayName() : 'User');
        const medals = ['🥇', '🥈', '🥉'];
        const isMe = uid === _userId;
        const myPct = vaultTotal > 0 ? Math.round(amount / vaultTotal * 100) : 0;
        return `<div class="vtc-item${isMe ? ' vtc-me' : ''}">
          <span class="vtc-av" style="background:${_sAvatarColor(uid)}">${_sInitials(name)}</span>
          <span class="vtc-name">${escapeHTML(name)}${isMe ? ' <span class="vtc-you">you</span>' : ''}</span>
          <div class="vtc-bar-wrap"><div class="vtc-bar" style="width:${myPct}%;background:${isMe ? '#fbbf24' : '#5badff'}"></div></div>
          <span class="vtc-xp">${medals[i]} ${amount.toLocaleString()}</span>
        </div>`;
      }).join('')}
    </div>` : '';

    let actionHTML = '';
    if (hasPending && !alreadyClaimed) {
      const rem = Math.max(0, pendingReward.expiresAt - Date.now());
      const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
      const prevTier = Math.max(1, tier - 1);
      const prevRarityClass = _vaultRarityClass(prevTier);
      const myContribForReward = (pendingReward.contributions || {})[_userId] || 0;
      const totalForReward = Object.values(pendingReward.contributions || {}).reduce((a, b) => a + b, 0);
      const myDiv = (totalForReward > 0 && myContribForReward > 0) ? Math.round(pendingReward.dividendPool * (myContribForReward / totalForReward)) : 0;
      actionHTML = `<div class="vault-reward-card ${prevRarityClass}-bg">
        <div class="vrc-header">
          <span class="vrc-icon">${pendingReward.icon}</span>
          <div class="vrc-info">
            <div class="vrc-title ${prevRarityClass}">${escapeHTML(pendingReward.label)} Unlocked!</div>
            <div class="vrc-desc">${escapeHTML(pendingReward.desc)}</div>
          </div>
        </div>
        ${myDiv > 0 ? `<div class="vrc-dividend">💰 Your XP Dividend: <strong class="vrc-div-amt">+${myDiv.toLocaleString()} XP</strong></div>` : myContribForReward === 0 ? `<div class="vrc-dividend" style="color:var(--text-muted);font-size:11px">Contribute next tier to earn dividends</div>` : ''}
        <div class="vrc-footer">
          <span class="vrc-timer" data-reward-expires="${pendingReward.expiresAt}">⏳ ${h}h ${m}m to claim</span>
          ${myContribForReward > 0 ? `<button class="btn vault-claim-btn" data-act="vault-claim-reward">Claim 🎁</button>` : `<span style="font-size:11px;color:var(--text-muted)">No contribution</span>`}
        </div>
      </div>`;
    } else if (hasPending && alreadyClaimed) {
      actionHTML = `<div class="vault-claimed-badge">✅ Reward claimed! Vault Tier ${tier} is now active — keep contributing!</div>`;
    } else if (!isComplete) {
      actionHTML = `<div class="vault-donate-row">
        <input id="vault-xp-input" class="auth-input vault-input" type="number" min="1" max="${myXPTotal}" placeholder="XP to donate (have ${myXPTotal.toLocaleString()})"/>
        <button class="btn btn-sm" data-act="social-vault-donate"${myXPTotal < 1 ? ' disabled' : ''}>Donate ⚡</button>
      </div>
      ${myXPTotal < 1 ? '<div class="vault-no-xp">Earn XP by studying to donate to the vault!</div>' : ''}`;
    }

    const feed = Array.isArray(vault.feed) ? vault.feed.slice(0, 8) : [];
    const feedHTML = feed.length ? `<div class="vault-feed-wrap">
      <div class="vault-feed-title">⚡ Live Donations</div>
      <div class="vault-feed">
        ${feed.map((f, i) => {
          const age = Date.now() - (f.ts || 0);
          const timeStr = age < 60000 ? 'just now' : age < 3600000 ? `${Math.floor(age / 60000)}m ago` : `${Math.floor(age / 3600000)}h ago`;
          return `<div class="vault-feed-item" style="animation-delay:${i * 0.05}s">
            <span class="vfi-av" style="background:${_sAvatarColor(f.uid)}">${_sInitials(f.name || 'S')}</span>
            <span class="vfi-body"><strong>${escapeHTML(f.name || 'Someone')}</strong> donated <span class="vfi-xp">+${(f.amount || 0).toLocaleString()} XP</span> ⚡</span>
            <span class="vfi-time">${timeStr}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

    const history = Array.isArray(vault.history) ? vault.history.slice().reverse().slice(0, 5) : [];
    const histHTML = history.length ? `<div class="vault-history-wrap">
      <button class="vault-history-toggle" data-act="vault-history-toggle">
        <span>📜 Vault History (${history.length} tier${history.length !== 1 ? 's' : ''})</span>
        <span class="vht-chevron" id="vht-arrow">▼</span>
      </button>
      <div class="vault-history-list" id="vault-history-list">
        ${history.map(h => {
          const date = new Date(h.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          const speedMs = h.completionSpeedMs || 0;
          const speed = speedMs < 3600000 ? 'under 1h' : speedMs < 86400000 ? `${Math.floor(speedMs / 3600000)}h` : `${Math.floor(speedMs / 86400000)}d`;
          const hRarity = _vaultRarityClass(h.tier || 1);
          return `<div class="vault-history-item">
            <span class="vhi-tier ${hRarity}">T${h.tier || 1}</span>
            <div class="vhi-body">
              <span class="vhi-reward">${h.reward ? h.reward.icon + ' ' + h.reward.label : 'Completed'}</span>
              <span class="vhi-meta">${(h.goal || 0).toLocaleString()} XP · ${date} · ${speed}</span>
            </div>
            ${h.topContributors && h.topContributors[0] ? `<span class="vhi-top">👑 ${escapeHTML(h.topContributors[0].name)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

    const nextGoal = _vaultTierGoal(tier + 1);
    const nextReward = _vaultTierReward(tier + 1);
    const hintHTML = `<div class="vault-next-hint">
      <span class="vnh-tier ${_vaultRarityClass(tier + 1)}">TIER ${tier + 1}</span>
      <span>Next: <strong>${nextGoal.toLocaleString()} XP</strong> → ${nextReward.icon} ${nextReward.label}</span>
    </div>`;

    return `<h2 class="social-section-head">Group XP Vault</h2>
    <div class="social-vault-wrap">
      ${boosterHTML}
      <div class="group-vault${isComplete ? ' vault-unlocked' : ''}">
        <div class="vault-header">
          <div class="vault-title">
            <span class="vault-tier-badge ${rarityClass}">TIER ${tier}</span>
            🏦 Group Vault
          </div>
          <div class="vault-goal">${vaultTotal.toLocaleString()} / ${goal.toLocaleString()} XP</div>
        </div>
        <div class="vault-bar-track">
          <div class="vault-bar-fill${isComplete ? ' vault-bar-complete' : ''}" style="width:${barWidth}%"></div>
        </div>
        <div class="vault-stats">
          <span>My donation: ⚡ <strong>${myContrib.toLocaleString()}</strong> XP</span>
          <span>👥 ${contribCount} contributor${contribCount !== 1 ? 's' : ''}</span>
          <span class="vault-pct">${vaultPct}%</span>
        </div>
        ${topContribsHTML}
        ${actionHTML}
      </div>
      ${feedHTML}
      ${hintHTML}
      ${histHTML}
    </div>`;
  }

  // ========== Theme System ==========
  const _THEMES = [
    { id: 'default',   name: 'Dark Neon',       icon: '🌃', rarity: 'default',   desc: 'The original premium dark aesthetic',             unlockable: false },
    { id: 'galaxy',    name: 'Galaxy',           icon: '🌌', rarity: 'rare',      desc: 'Purple cosmic gradients with star fields',        unlockable: true  },
    { id: 'forest',    name: 'Forest Focus',     icon: '🌿', rarity: 'rare',      desc: 'Green ambient glow inspired by nature',           unlockable: true  },
    { id: 'cyberpunk', name: 'Cyberpunk',        icon: '⚡', rarity: 'epic',      desc: 'Blue/pink neon with digital scanline overlay',    unlockable: true  },
    { id: 'golden',    name: 'Golden Prestige',  icon: '👑', rarity: 'legendary', desc: 'Gold gradients and luxury elite styling',         unlockable: true  },
  ];
  const _RARITY_COLORS = { default: '#566e8a', rare: '#38bdf8', epic: '#a78bfa', legendary: '#fbbf24' };

  function getActiveTheme() {
    try { return localStorage.getItem('active_theme') || 'default'; } catch (_) { return 'default'; }
  }

  function applyTheme(id) {
    const valid = _THEMES.find(t => t.id === id);
    if (!valid) id = 'default';
    try { localStorage.setItem('active_theme', id); } catch (_) {}
    if (id === 'default') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', id);
  }

  function _getUnlockedThemes() {
    try {
      const raw = localStorage.getItem('unlocked_themes');
      const arr = raw ? JSON.parse(raw) : ['default'];
      if (!arr.includes('default')) arr.unshift('default');
      return arr;
    } catch (_) { return ['default']; }
  }

  function _unlockTheme(id) {
    const arr = _getUnlockedThemes();
    if (!arr.includes(id)) {
      arr.push(id);
      try { localStorage.setItem('unlocked_themes', JSON.stringify(arr)); } catch (_) {}
    }
  }

  function _themeGalleryModal() {
    const unlocked = _getUnlockedThemes();
    const active = getActiveTheme();
    const rows = _THEMES.map(t => {
      const isUnlocked = unlocked.includes(t.id);
      const isActive = t.id === active;
      const rc = _RARITY_COLORS[t.rarity] || '#566e8a';
      return `<div class="theme-gallery-card${isActive ? ' tgc-active' : ''}${!isUnlocked ? ' tgc-locked' : ''}">
        <div class="tgc-icon">${t.icon}</div>
        <div class="tgc-body">
          <div class="tgc-name">${escapeHTML(t.name)}</div>
          <div class="tgc-rarity" style="color:${rc}">${t.rarity.toUpperCase()}</div>
          <div class="tgc-desc">${escapeHTML(t.desc)}</div>
        </div>
        ${isActive ? '<span class="tgc-badge">● Active</span>' : ''}
        ${isUnlocked && !isActive ? `<button class="btn btn-sm tgc-equip" data-act="theme-equip" data-tid="${t.id}">Equip</button>` : ''}
        ${!isUnlocked ? `<span class="tgc-locked-badge">🔒 Vault Reward</span>` : ''}
      </div>`;
    }).join('');
    openModal(`<div class="theme-gallery-header">
      <h3>🎨 Theme Gallery</h3>
      <p style="color:var(--text-muted);font-size:13px;margin-top:4px">Fill the Group XP Vault to unlock premium themes for your whole study room.</p>
    </div>
    <div class="theme-gallery-list">${rows}</div>`,
      root => {
        root.querySelectorAll('[data-act="theme-equip"]').forEach(btn => {
          btn.onclick = () => {
            const tid = btn.dataset.tid;
            applyTheme(tid);
            closeModal();
            const theme = _THEMES.find(t => t.id === tid);
            toast(`✨ ${theme ? theme.name : 'Theme'} activated!`, 'success');
            if (_currentTab === 'social') renderSocial();
          };
        });
      });
  }

  function _startSocialLiveTimers() {
    _stopSocialLiveTimers();
    _socialLiveTimerId = setInterval(() => {
      const now = Date.now();
      document.querySelectorAll('.sm-elapsed[data-focusat]').forEach(el => {
        const start = parseInt(el.dataset.focusat, 10);
        if (!start || isNaN(start)) return;
        const s = Math.floor((now - start) / 1000);
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        el.textContent = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${String(sec).padStart(2,'0')}s` : `${sec}s`;
      });
      document.querySelectorAll('.vbp-timer[data-booster-expires]').forEach(el => {
        const exp = parseInt(el.dataset.boosterExpires, 10);
        if (!exp || isNaN(exp)) return;
        const rem = Math.max(0, exp - now);
        if (rem === 0) { el.textContent = 'Expired'; return; }
        const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
        el.textContent = `${h}h ${m}m left`;
      });
      document.querySelectorAll('.vrc-timer[data-reward-expires]').forEach(el => {
        const exp = parseInt(el.dataset.rewardExpires, 10);
        if (!exp || isNaN(exp)) return;
        const rem = Math.max(0, exp - now);
        if (rem === 0) { el.textContent = 'Expired'; return; }
        const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
        el.textContent = `⏳ ${h}h ${m}m to claim`;
      });
    }, 1000);
  }

  function _stopSocialLiveTimers() {
    if (_socialLiveTimerId) { clearInterval(_socialLiveTimerId); _socialLiveTimerId = null; }
  }

  async function _sSocialInit() {
    // Load saved my-groups list
    try {
      const raw = localStorage.getItem('my_group_codes');
      if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) _myGroupCodes = arr; }
    } catch(_) {}
    const saved = (() => { try { return localStorage.getItem('social_room_code'); } catch (e) { return null; } })();
    if (saved && _db && _userId && !_socialRoomCode) {
      _socialRoomCode = saved;
      await _sUpdatePresence('break');
      _sSubscribe();
    }
  }

  function renderSocial() {
    const view = document.getElementById('view-social');
    if (!view) return;
    if (!_userId) {
      view.innerHTML = `<div class="social-gate"><div class="social-gate-icon">👥</div><h2 class="social-gate-title">Social Study Rooms</h2><p class="social-gate-sub">Sign in to join a room and study with friends, compete in duels, and hit group goals together.</p><button class="btn" data-act="auth-show-modal">Sign In to Continue</button></div>`;
      return;
    }
    // Always keep global leaderboard fresh when social tab is open
    if (!_socialRoomCode && (!_globalLbData || !_globalLbData.length)) {
      _loadGlobalLeaderboard().catch(() => {});
    }
    if (!_socialRoomCode) { view.innerHTML = _renderSocialLobby(); return; }
    // Confetti check for momentum bar
    const _momMembers = Object.values(_socialMembers);
    const _momXP = _momMembers.reduce((s, m) => s + (m.weeklyXP || 0), 0);
    const _momTarget = Math.max(500, _momMembers.length * 300);
    const _momPct = Math.min(100, Math.round(_momXP / _momTarget * 100));
    if (_momPct >= 100 && !_momentumConfettiFired) {
      _momentumConfettiFired = true;
      setTimeout(_sFireConfetti, 700);
    }
    if (_momPct < 90) _momentumConfettiFired = false;
    view.innerHTML = _renderSocialRoom();
    _startSocialLiveTimers();
  }

  function _renderSocialLobby() {
    if (!_socialLobbyCode) _socialLobbyCode = _sGenerateCode();
    const code = _socialLobbyCode;
    const myGroupsHTML = _myGroupCodes.length > 0
      ? `<div class="my-groups-section">
          <h3 class="my-groups-title">📚 My Rooms</h3>
          ${_myGroupCodes.map(c => `<div class="my-group-item">
            <span class="my-group-code">${c}</span>
            <div class="my-group-btns">
              <button class="btn btn-sm" data-act="social-rejoin" data-code="${c}">Rejoin</button>
              <button class="btn btn-sm btn-ghost my-group-remove" data-act="social-remove-group" data-code="${c}" title="Remove from list">✕</button>
            </div>
          </div>`).join('')}
        </div>`
      : '';
    // Global leaderboard section in lobby
    const glbRows = _globalLbData.slice(0, 20).map((m, i) => {
      const isMe = m.uid === _userId;
      const topGlow = i === 0 ? ' lb-row-gold' : i === 1 ? ' lb-row-silver' : i === 2 ? ' lb-row-bronze' : '';
      const med = i === 0 ? '<span class="lb-crown">👑</span>' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:var(--text-muted)">${i + 1}.</span>`;
      return `<div class="lb-row${isMe ? ' lb-me' : ''}${topGlow}"><span class="lb-rank">${med}</span><span class="lb-av lb-av-click" style="background:${_sAvatarColor(m.uid)}" data-act="view-profile-global" data-uid="${m.uid}" data-name="${escapeHTML(m.name || 'Anonymous')}">${_sInitials(m.name || 'S')}</span><span class="lb-name">${escapeHTML(m.name || 'Anonymous')}</span><span class="lb-val">⚡ ${(m.weeklyXP || 0).toLocaleString()}</span><span class="lb-val2">📚 ${minsToHrs(m.weeklyMinutes || 0)}</span></div>`;
    }).join('') || '<div class="empty" style="padding:8px 0;font-size:13px">No global data yet — join a room and start focusing!</div>';
    const globalLbSection = `<div class="social-global-lb-section">
      <div class="social-global-lb-head"><span>🌍 Global Leaderboard</span><span class="slb-sub">Weekly XP — resets every Monday</span></div>
      <div class="social-lb">${glbRows}</div>
    </div>`;

    return `<div class="social-lobby">
      <div class="social-lobby-hero"><div class="social-lobby-icon">👥</div><h1 class="social-lobby-title">Study Together</h1><p class="social-lobby-sub">Join a room to see friends' live focus, duel for XP, and hit group goals together.</p></div>
      ${myGroupsHTML}
      <div class="social-lobby-cards">
        <div class="social-lobby-card"><div class="slc-icon">🔗</div><div class="slc-title">Create a Room</div><div class="slc-code">${code}</div><div class="slc-hint">Share this code with friends</div><button class="btn btn-block" data-act="social-create" data-code="${code}">Create &amp; Join</button></div>
        <div class="social-lobby-card"><div class="slc-icon">🚪</div><div class="slc-title">Join a Room</div><input id="social-join-input" class="auth-input" style="margin:12px 0 8px;text-align:center;text-transform:uppercase;letter-spacing:4px;font-weight:700;font-size:18px" maxlength="6" placeholder="XXXXXX" autocomplete="off" spellcheck="false"/><button class="btn btn-block" data-act="social-join">Join Room</button></div>
      </div>
      ${globalLbSection}
      <p class="social-lobby-privacy">🔒 Only members of the same room can see your data.</p>
    </div>`;
  }

  function _renderSocialRoom() {
    const now = Date.now();
    const members = Object.values(_socialMembers);
    const sRank = { focusing: 0, break: 1, offline: 2 };
    const sorted = members.slice().sort((a, b) => {
      if (a.uid === _userId) return -1; if (b.uid === _userId) return 1;
      return sRank[_sStatusOf(a)] - sRank[_sStatusOf(b)];
    });

    // ── Collective Momentum Bar ──
    const totalWeeklyXP = members.reduce((s, m) => s + (m.weeklyXP || 0), 0);
    const momentumTarget = Math.max(500, members.length * 300);
    const momentumPct = Math.min(100, Math.round(totalWeeklyXP / momentumTarget * 100));
    const momentumComplete = momentumPct >= 100;
    const momentumHTML = `<div class="social-momentum">
      <div class="momentum-top">
        <div class="momentum-label"><span class="momentum-label-icon">⚡</span>Collective Momentum</div>
        <span class="momentum-pct">${momentumPct}%</span>
      </div>
      <div class="momentum-track"><div class="momentum-fill${momentumComplete ? ' momentum-complete' : ''}" style="width:${momentumPct}%"></div></div>
      <div class="momentum-sub">${totalWeeklyXP.toLocaleString()} / ${momentumTarget.toLocaleString()} XP this week${momentumComplete ? ' 🎉 Goal smashed!' : ` · ${members.length} member${members.length !== 1 ? 's' : ''}`}</div>
    </div>`;

    // ── Room Stats Strip ──
    const activeFocusing = members.filter(m => _sStatusOf(m) === 'focusing').length;
    const todayKey_ = todayKey();
    const totalFocusToday = members.reduce((s, m) => {
      const byDate = (m.focusStatsByDate) || {};
      return s + (byDate[todayKey_] || 0);
    }, 0);
    const energyPct = members.length ? Math.min(100, Math.round((activeFocusing / members.length) * 100)) : 0;
    const roomStatsHTML = `<div class="room-stats-strip">
      <div class="rss-item"><span class="rss-val" style="color:${activeFocusing > 0 ? '#4ade80' : 'var(--text-muted)'}">${activeFocusing}</span><span class="rss-lbl">Focusing</span></div>
      <div class="rss-sep"></div>
      <div class="rss-item"><span class="rss-val">${minsToHrs(totalFocusToday)}</span><span class="rss-lbl">Group Today</span></div>
      <div class="rss-sep"></div>
      <div class="rss-item"><span class="rss-val">${members.length}</span><span class="rss-lbl">Members</span></div>
    </div>
    <div class="room-energy-wrap">
      <span class="room-energy-label">⚡ Room Energy</span>
      <div class="room-energy-track"><div class="room-energy-fill" style="width:${energyPct}%"></div></div>
      <span class="room-energy-pct">${energyPct}%</span>
    </div>`;

    // ── Member Cards (animated presence + live elapsed timer + particles) ──
    const memberCards = sorted.map(m => {
      const st = _sStatusOf(m);
      const isMe = m.uid === _userId;
      const ini = _sInitials(m.displayName || 'S');
      const isFocusing = st === 'focusing';
      const isOnline = st !== 'offline';
      let cardClass = 'social-member-card';
      if (isFocusing) cardClass += ' sm-focusing';
      else if (isOnline) cardClass += ' sm-online';
      else cardClass += ' sm-offline';

      // Live elapsed timer chip (data-focusat drives the 1s interval patcher)
      let elapsedChip = '';
      if (isFocusing && m.focusStartedAt) {
        const s = Math.floor((now - m.focusStartedAt) / 1000);
        const h = Math.floor(s / 3600), mn = Math.floor((s % 3600) / 60), sc = s % 60;
        const initTxt = h > 0 ? `${h}h ${mn}m` : mn > 0 ? `${mn}m ${String(sc).padStart(2,'0')}s` : `${sc}s`;
        elapsedChip = `<span class="sm-elapsed" data-focusat="${m.focusStartedAt}">${initTxt}</span>`;
      }

      const dot = isFocusing ? '🔵' : isOnline ? '🟢' : '⚪';
      const stTxt = isFocusing ? 'In Focus' : isOnline ? 'Online' : 'Offline';
      const subPill = isFocusing && m.focusSubjectName
        ? `<div class="sm-subject-pill">${_sSubjectEmoji(m.focusSubjectName)} ${escapeHTML(m.focusSubjectName)}</div>` : '';
      const streakN = m.studyStreak || 0;
      const streakBadge = streakN >= 2 ? `<span class="sm-streak">🔥 ${streakN}d</span>` : '';

      // Double animated ring: outer slow glow + inner pulse (only when online/focusing)
      const outerRing = isOnline ? `<div class="sm-outer-ring${isFocusing ? '' : ' sm-outer-ring-green'}"></div>` : '';
      const innerRing = isOnline ? `<div class="sm-focus-ring${isFocusing ? ' ring-blue' : ''}"></div>` : '';

      // Floating particles for focusing members
      const particles = isFocusing ? `<div class="sm-focus-particles"><div class="sm-particle"></div><div class="sm-particle"></div><div class="sm-particle"></div><div class="sm-particle"></div><div class="sm-particle"></div></div>` : '';

      // Mic indicator: show when user is in voice room
      const inVoiceNow = !!(isMe ? _inVoice : _voiceMembers[m.uid]);
      const micBadge = inVoiceNow ? `<span class="sm-mic-badge${isMe && _voiceMuted ? ' sm-mic-muted' : ''}">${isMe && _voiceMuted ? '🔇' : '🎙'}</span>` : '';

      let acts = '';
      if (!isMe) {
        const nudgeBtn = `<button class="btn btn-sm btn-ghost" data-act="social-nudge" data-uid="${m.uid}" data-name="${escapeHTML(m.displayName || '')}">👋 Poke</button>`;
        const duelBtn = isOnline ? `<button class="btn btn-sm" data-act="social-duel" data-uid="${m.uid}" data-name="${escapeHTML(m.displayName || '')}">⚔️ Duel</button>` : '';
        acts = `<div class="sm-actions">${nudgeBtn}${duelBtn}</div>`;
      }
      const youB = isMe ? '<span class="sm-you-badge">You</span>' : '';
      const avatarContent = m.avatarUrl
        ? `<img src="${escapeHTML(m.avatarUrl)}" class="sm-avatar-img" alt=""/>`
        : ini;
      const profileAct = !isMe ? ` data-act="view-profile" data-uid="${m.uid}" title="View profile" style="cursor:pointer"` : '';
      return `<div class="${cardClass}">${particles}
        <div class="sm-ring-wrap">${outerRing}${innerRing}<div class="sm-avatar" style="background:${_sAvatarColor(m.uid)}"${profileAct}>${avatarContent}${micBadge}</div></div>
        <div class="sm-info">
          <div class="sm-name-row"><span class="sm-name">${escapeHTML(m.displayName || 'Anonymous')}</span>${youB}${streakBadge}</div>
          <div class="sm-status">${dot} ${stTxt}${elapsedChip}</div>
          ${subPill}
          <div class="sm-xp">⚡ ${(m.xpTotal || 0).toLocaleString()} XP · 📚 ${minsToHrs(m.weeklyMinutes || 0)} this week</div>
        </div>${acts}
      </div>`;
    }).join('') || '<div class="empty" style="padding:16px">No one here yet — share the code!</div>';

    // ── Leaderboard with rank movement, crown glow & reset countdown ──
    const lb = [...members].sort((a, b) => (b.weeklyXP || 0) - (a.weeklyXP || 0));
    const lbNow = new Date();
    const daysToMon = (8 - lbNow.getDay()) % 7 || 7;
    const nextMon = new Date(lbNow); nextMon.setDate(lbNow.getDate() + daysToMon); nextMon.setHours(0, 0, 0, 0);
    const secsLeft = Math.max(0, Math.floor((nextMon - lbNow) / 1000));
    const hLeft = Math.floor(secsLeft / 3600), mLeft = Math.floor((secsLeft % 3600) / 60);
    const countdownTxt = secsLeft > 86400 ? `${daysToMon}d ${hLeft % 24}h left` : `${hLeft}h ${mLeft}m left`;
    const lbToggleHTML = `<div class="lb-toggle-row">
      <button class="lb-toggle-btn${_lbView === 'group' ? ' active' : ''}" data-act="lb-view" data-v="group">👥 Group</button>
      <button class="lb-toggle-btn${_lbView === 'global' ? ' active' : ''}" data-act="lb-view" data-v="global">🌍 Global</button>
    </div>`;
    let lbRows;
    if (_lbView === 'global') {
      lbRows = _globalLbData.slice(0, 30).map((m, i) => {
        const isMe = m.uid === _userId;
        const topGlow = i === 0 ? ' lb-row-gold' : i === 1 ? ' lb-row-silver' : i === 2 ? ' lb-row-bronze' : '';
        const med = i === 0 ? '<span class="lb-crown">👑</span>' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:var(--text-muted)">${i + 1}.</span>`;
        return `<div class="lb-row${isMe ? ' lb-me' : ''}${topGlow}"><span class="lb-rank">${med}</span><span class="lb-av lb-av-click" style="background:${_sAvatarColor(m.uid)}" data-act="view-profile-global" data-uid="${m.uid}" data-name="${escapeHTML(m.name || 'Anonymous')}">${_sInitials(m.name || 'S')}</span><span class="lb-name">${escapeHTML(m.name || 'Anonymous')}</span><span class="lb-val">⚡ ${(m.weeklyXP || 0).toLocaleString()}</span><span class="lb-val2">📚 ${minsToHrs(m.weeklyMinutes || 0)}</span></div>`;
      }).join('') || '<div class="empty" style="padding:8px 0">Loading global rankings…</div>';
    } else {
      lbRows = lb.map((m, i) => {
        const isMe = m.uid === _userId;
        const prevRank = _socialPrevRanks[m.uid];
        let mvIcon = '';
        if (prevRank !== undefined && prevRank !== i) {
          if (i < prevRank)       mvIcon = `<span class="lb-mv lb-mv-up">↑</span>`;
          else if (i > prevRank)  mvIcon = `<span class="lb-mv lb-mv-dn">↓</span>`;
        } else if (prevRank !== undefined) {
          mvIcon = `<span class="lb-mv lb-mv-eq">—</span>`;
        }
        _socialPrevRanks[m.uid] = i;
        const streak = (m.studyStreak || 0) >= 2 ? `<span class="lb-streak">🔥${m.studyStreak}</span>` : '';
        const topGlow = i === 0 ? ' lb-row-gold' : i === 1 ? ' lb-row-silver' : i === 2 ? ' lb-row-bronze' : '';
        const med = i === 0 ? '<span class="lb-crown">👑</span>' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:var(--text-muted)">${i + 1}.</span>`;
        return `<div class="lb-row${isMe ? ' lb-me' : ''}${topGlow}">${mvIcon}<span class="lb-rank">${med}</span><span class="lb-av" style="background:${_sAvatarColor(m.uid)}">${_sInitials(m.displayName || 'S')}</span><span class="lb-name">${escapeHTML(m.displayName || 'Anonymous')}${streak}</span><span class="lb-val">⚡ ${(m.weeklyXP || 0).toLocaleString()}</span><span class="lb-val2">📚 ${minsToHrs(m.weeklyMinutes || 0)}</span></div>`;
      }).join('') || '<div class="empty" style="padding:8px 0">No data yet</div>';
    }
    const lbFooter = `<div class="lb-reset-row">🔄 Resets in <strong>${countdownTxt}</strong></div>`;

    // ── Voice Room Panel ──
    const voiceActive = Object.values(_voiceMembers).filter(m => m.active);
    const voiceMemberChips = voiceActive.map(m => {
      const isMeVoice = m.uid === _userId;
      const micClass = isMeVoice && _voiceMuted ? ' voice-chip-muted' : isMeVoice ? ' voice-chip-active' : '';
      const micIcon = isMeVoice ? (_voiceMuted ? ' 🔇' : ' 🎙') : '';
      return `<span class="voice-chip${micClass}" style="background:${_sAvatarColor(m.uid)}" title="${escapeHTML(m.name || 'S')}">${_sInitials(m.name || 'S')}${micIcon}</span>`;
    }).join('');
    const voicePanel = `<div class="voice-panel${_inVoice ? ' voice-panel-active' : ''}">
      <div class="voice-panel-head">
        <div class="voice-panel-title-row">
          <span class="voice-panel-title">🎤 Voice Room</span>
          ${_inVoice ? `<span class="voice-live-badge">${_voiceMuted ? '🔇 Muted' : '● Live'}</span>` : ''}
        </div>
        <span class="voice-panel-count">${voiceActive.length ? `${voiceActive.length} in voice` : 'No one in voice'}</span>
      </div>
      ${voiceActive.length ? `<div class="voice-chips">${voiceMemberChips}</div>` : ''}
      ${_inVoice
        ? `<div class="voice-controls">
            <button class="btn btn-sm${_voiceMuted ? ' btn-danger' : ' btn-ghost'} voice-ctrl-btn" data-act="voice-mute">${_voiceMuted ? '🔇 Unmute' : '🎙️ Mute'}</button>
            <button class="btn btn-sm btn-ghost voice-ctrl-btn" data-act="voice-leave">📵 Leave</button>
           </div>`
        : `<button class="btn btn-sm btn-block voice-join-btn" data-act="voice-join">🎤 Join Voice</button>`}
    </div>`;

    // ── Subject Mastery with 3D glowing badges ──
    const subMap = {};
    members.forEach(m => Object.entries(m.subjectMinutes || {}).forEach(([sid, mins]) => {
      if (!subMap[sid]) subMap[sid] = [];
      subMap[sid].push({ uid: m.uid, name: m.displayName, mins });
    }));
    const subRanked = Object.entries(subMap).map(([sid, arr]) => ({
      sid,
      name: (s => s ? s.name : sid)(state.subjects.find(x => x.id === sid)),
      color: (s => s ? s.color : '#5badff')(state.subjects.find(x => x.id === sid)),
      total: arr.reduce((a, b) => a + b.mins, 0), top: arr.slice().sort((a, b) => b.mins - a.mins)
    })).sort((a, b) => b.total - a.total).slice(0, 3);
    const masteryHTML = subRanked.length ? subRanked.map(sr => {
      const top = sr.top[0];
      const emoji = _sSubjectEmoji(sr.name);
      return `<div class="mastery-card"><div class="mc-header"><div class="mc-badge" style="background:${sr.color}1a;color:${sr.color};border-color:${sr.color}30">${emoji}</div><div style="flex:1"><div class="mc-sub">${escapeHTML(sr.name)}</div><div class="mc-king">👑 ${escapeHTML(top ? top.name || '—' : '—')} <span class="mc-king-h">${minsToHrs(top ? top.mins : 0)}</span></div></div></div><div class="mc-members">${sr.top.map(t => `<div class="mc-m"><span class="mc-m-av" style="background:${_sAvatarColor(t.uid)}">${_sInitials(t.name || 'S')}</span><div class="mc-m-bw"><div class="mc-m-bar" style="width:${sr.total ? Math.round(t.mins / sr.top[0].mins * 100) : 0}%;background:${sr.color}"></div></div><span class="mc-m-min">${minsToHrs(t.mins)}</span></div>`).join('')}</div></div>`;
    }).join('') : '<div class="empty" style="padding:0 16px">Complete focus sessions to populate mastery.</div>';

    // ── Active Duels ──
    const activeDuels = ((_socialRoomData && _socialRoomData.duels) || []).filter(d => !d.winner && d.endsAt > now && (d.challenger === _userId || d.opponent === _userId));
    const duelsHTML = activeDuels.map(d => {
      const iAm = d.challenger === _userId;
      const myXPS = iAm ? d.challengerXPStart : d.opponentXPStart;
      const myG = Math.max(0, ((state.xp && state.xp.total) || 0) - myXPS);
      const oppUid = iAm ? d.opponent : d.challenger;
      const oppN = iAm ? d.opponentName : d.challengerName;
      const opp = _socialMembers[oppUid];
      const oppXPS = iAm ? d.opponentXPStart : d.challengerXPStart;
      const oppG = opp ? Math.max(0, (opp.xpTotal || 0) - oppXPS) : 0;
      const rem = Math.max(0, Math.ceil((d.endsAt - now) / 60000));
      const tl = rem >= 60 ? `${Math.floor(rem / 60)}h ${rem % 60}m` : `${rem}m`;
      const myP = Math.max(myG, oppG) > 0 ? Math.round(myG / Math.max(myG, oppG) * 100) : 50;
      const win = myG >= oppG;
      return `<div class="duel-card"><div class="duel-header"><span class="duel-title">⚔️ Focus Duel</span><span class="duel-time">⏱ ${tl} left</span></div><div class="duel-combatants"><div class="duel-side${win ? ' duel-winning' : ''}"><div class="duel-av" style="background:${_sAvatarColor(_userId)}">${_sInitials(_sDisplayName())}</div><div class="duel-name">You</div><div class="duel-xp">+${myG} XP</div></div><div class="duel-vs">VS</div><div class="duel-side${!win ? ' duel-winning' : ''}"><div class="duel-av" style="background:${_sAvatarColor(oppUid)}">${_sInitials(oppN || 'S')}</div><div class="duel-name">${escapeHTML(oppN || 'Opponent')}</div><div class="duel-xp">+${oppG} XP</div></div></div><div class="duel-bar-wrap"><div class="duel-bar-fill" style="width:${myP}%;background:${win ? '#22c55e' : '#f87171'}"></div></div></div>`;
    }).join('');

    const pastDuels = ((_socialRoomData && _socialRoomData.duels) || []).filter(d => d.winner && (d.challenger === _userId || d.opponent === _userId)).slice(-3).reverse();
    const pastHTML = pastDuels.map(d => {
      const won = d.winner === _userId;
      const oN = d.challenger === _userId ? d.opponentName : d.challengerName;
      return `<div class="past-duel${won ? ' past-duel-won' : ' past-duel-lost'}"><span>${won ? '🏆 Won' : '💀 Lost'}</span><span>vs ${escapeHTML(oN || '?')}</span><span>${won ? 'Victor!' : 'Rematch?'}</span></div>`;
    }).join('');

    // ── Group XP Vault ──
    const vaultSection = _renderVaultSection();

    // ── Group Goals ──
    const goals = (_socialRoomData && _socialRoomData.groupGoals) || [];
    const goalsHTML = goals.map(g => {
      const tot = Object.values(g.contributions || {}).reduce((a, b) => a + b, 0);
      const pct = Math.min(100, Math.round(tot / g.targetMinutes * 100));
      const myC = (g.contributions || {})[_userId] || 0;
      const cs = Object.entries(g.contributions || {}).sort(([, a], [, b]) => b - a)
        .map(([u_, m_]) => { const mb = _socialMembers[u_]; const n = mb ? mb.displayName : u_.slice(0, 4); return `<span class="gg-av" title="${escapeHTML(n)}: ${minsToHrs(m_)}" style="background:${_sAvatarColor(u_)}">${_sInitials(n)}</span>`; }).join('');
      const canDel = _userId === (_socialRoomData && _socialRoomData.createdBy);
      return `<div class="group-goal-card${pct >= 100 ? ' gg-complete' : ''}"><div class="gg-header"><span class="gg-title">${pct >= 100 ? '🏆 ' : '🎯 '}${escapeHTML(g.title)}</span>${canDel ? `<button class="gg-del" data-act="social-del-goal" data-gid="${g.id}">×</button>` : ''}</div><div class="gg-bar-row"><div class="gg-bar-track"><div class="gg-bar-fill" style="width:${pct}%"></div></div><span class="gg-pct">${pct}%</span></div><div class="gg-stats"><span>${minsToHrs(tot)} / ${minsToHrs(g.targetMinutes)} · Mine: ${minsToHrs(myC)}</span><div class="gg-contribs">${cs}</div></div></div>`;
    }).join('') || '<div class="empty" style="padding:0 16px">No group goals yet — create one below!</div>';

    const isRoomCreator = _userId === (_socialRoomData && _socialRoomData.createdBy);
    const isPrivate = !!(_socialRoomData && _socialRoomData.private);
    return `<div class="social-room">
      <div class="social-room-header">
        <div class="srh-left">
          <button class="srh-back-btn" data-act="social-leave" title="Back to Lobby">←</button>
          <div class="srh-code-wrap">
            <span class="srh-label">ROOM</span>
            <span class="srh-code">${_socialRoomCode}</span>
            <button class="srh-copy-btn" data-act="social-copy-code" title="Copy room code">⧉</button>
          </div>
          <span class="srh-count">${members.length} member${members.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="srh-right">
          <button class="srh-settings-btn" data-act="social-room-settings" title="Room Settings">⚙</button>
        </div>
      </div>
      ${voicePanel}
      ${roomStatsHTML}
      ${momentumHTML}
      <h2 class="social-section-head">Live Focus Map</h2>
      <div class="social-members">${memberCards}</div>
      ${duelsHTML ? `<h2 class="social-section-head">Active Duel</h2><div class="social-duels">${duelsHTML}</div>` : ''}
      ${pastHTML ? `<div class="past-duels">${pastHTML}</div>` : ''}
      <h2 class="social-section-head">Leaderboard</h2>
      ${lbToggleHTML}
      <div class="social-lb">${lbRows}${_lbView === 'group' ? lbFooter : ''}</div>
      <h2 class="social-section-head">Subject Mastery</h2>
      <div class="social-mastery">${masteryHTML}</div>
      ${vaultSection}
      <h2 class="social-section-head">Group Challenges</h2>
      <div class="social-goals">${goalsHTML}</div>
      <div class="social-add-goal"><div class="sag-title">Create Group Goal</div><input id="gg-title-input" class="auth-input" placeholder="e.g. 50 hours of study this week" maxlength="60" style="margin:8px 0"/><div class="gg-add-row"><input id="gg-hours-input" class="auth-input gg-hours-input" type="number" min="1" max="1000" placeholder="Hours" value="50"/><button class="btn" data-act="social-add-goal">Set Goal</button></div></div>
    </div>`;
  }

  // ── Room Settings dispatcher ──────────────────────────────────────────────
  function _openRoomSettings() {
    const isCreator = _userId === (_socialRoomData && _socialRoomData.createdBy);
    if (isCreator) _openAdminSettings();
    else _openMemberSettings();
  }

  // ── Admin Settings Modal ──────────────────────────────────────────────────
  function _openAdminSettings() {
    if (!_db || !_userId || !_socialRoomCode || !_socialRoomData) { toast('Not available', 'warn'); return; }
    if (_userId !== _socialRoomData.createdBy) { toast('Only the room creator can access Admin Settings', 'warn'); return; }
    const members = Object.values(_socialMembers);
    const isPrivate = !!(_socialRoomData && _socialRoomData.private);
    const memberRows = members.map(m => {
      const isMe = m.uid === _userId;
      return `<div class="admin-member-row">
        <span class="lb-av" style="background:${_sAvatarColor(m.uid)}">${_sInitials(m.displayName || 'S')}</span>
        <span class="admin-member-name">${escapeHTML(m.displayName || 'Anonymous')}${isMe ? ' <span class="sm-you-badge">You (Creator)</span>' : ''}</span>
        ${!isMe ? `<div class="admin-member-btns"><button class="btn btn-sm btn-danger" data-act="admin-kick" data-uid="${m.uid}" data-name="${escapeHTML(m.displayName || 'Member')}">Kick</button></div>` : ''}
      </div>`;
    }).join('') || '<div class="empty" style="font-size:13px">No members yet.</div>';

    openModal(`<div class="admin-modal-head"><span>⚙️ Admin Settings</span><span class="admin-room-code-badge">${_socialRoomCode}</span></div>
      <div class="admin-modal-body">
        <div class="admin-section">
          <div class="admin-section-title">Room Code</div>
          <div class="admin-code-row">
            <span class="admin-code-display">${_socialRoomCode}</span>
            <button class="btn btn-sm btn-ghost" data-act="social-copy-code">⧉ Copy</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Share this code for others to join</div>
        </div>
        <div class="admin-section">
          <div class="admin-section-title">Privacy</div>
          <div class="admin-privacy-row">
            <span class="admin-privacy-label">${isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            <button class="btn btn-sm btn-ghost" data-act="admin-toggle-privacy">${isPrivate ? 'Make Public' : 'Make Private'}</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${isPrivate ? 'Only people with the code can join.' : 'Anyone can discover and join this room.'}</div>
        </div>
        <div class="admin-section">
          <div class="admin-section-title">Members (${members.length})</div>
          <div class="admin-members-list">${memberRows}</div>
        </div>
        <div class="admin-section admin-section-theme">
          <div class="admin-section-title">Appearance</div>
          <button class="btn btn-ghost admin-wide-btn" data-act="theme-gallery">🎨 Open Theme Gallery</button>
        </div>
        <div class="admin-section admin-danger-zone">
          <div class="admin-section-title">Danger Zone</div>
          <button class="btn btn-danger btn-block" data-act="admin-close-room">🗑 Close &amp; Delete Room</button>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">This permanently removes the room. All members will be returned to the lobby.</div>
        </div>
      </div>
      <div class="actions"><button class="btn btn-ghost" data-close>Close</button></div>`);
  }

  // ── Member Settings Modal (for non-admins) ────────────────────────────────
  function _openMemberSettings() {
    if (!_socialRoomData) { toast('Not in a room', 'warn'); return; }
    const creatorUid = _socialRoomData.createdBy;
    const creatorMember = _socialMembers[creatorUid];
    const creatorName = creatorMember ? (creatorMember.displayName || 'Room Creator') : 'Room Creator';
    const notifOn = !!(state.socialNotif !== false);
    openModal(`<h3>Room Settings</h3>
      <div class="member-settings-list">
        <div class="member-setting-item">
          <div class="msi-info">
            <div class="msi-label">🔔 Focus Notifications</div>
            <div class="msi-sub">Get notified when members start focusing</div>
          </div>
          <button class="btn btn-sm ${notifOn ? '' : 'btn-ghost'}" data-act="member-notif-toggle">${notifOn ? 'On' : 'Off'}</button>
        </div>
        <div class="member-setting-item">
          <div class="msi-info">
            <div class="msi-label">🎨 Theme Gallery</div>
            <div class="msi-sub">Customise the app's look</div>
          </div>
          <button class="btn btn-sm btn-ghost" data-act="theme-gallery" data-close>Open</button>
        </div>
        <div class="member-setting-item">
          <div class="msi-info">
            <div class="msi-label">👑 Room Creator</div>
            <div class="msi-sub">${escapeHTML(creatorName)}</div>
          </div>
        </div>
        <div class="member-setting-item member-setting-danger">
          <div class="msi-info">
            <div class="msi-label">🚪 Leave Room</div>
            <div class="msi-sub">You can rejoin later with the same code</div>
          </div>
          <button class="btn btn-sm btn-danger" data-act="social-leave" data-close>Leave</button>
        </div>
      </div>
      <div class="actions"><button class="btn btn-ghost" data-close>Close</button></div>`);
  }

  async function _adminKickMember(uid_, name) {
    if (!_db || !_socialRoomCode) return;
    try {
      await _db.collection('groups').doc(_socialRoomCode).collection('presence').doc(uid_).update({ status: 'kicked' });
      toast(`Removed ${name} from the room`, 'info');
      closeModal();
    } catch(e) { toast('Failed to remove member', 'danger'); }
  }

  async function _adminCloseRoom() {
    if (!_db || !_socialRoomCode) return;
    const code = _socialRoomCode;
    _sLeaveRoom();
    try {
      await _db.collection('groups').doc(code).update({ closed: true });
      toast('Room closed', 'info');
    } catch(e) {}
  }

  // ── Global Leaderboard ────────────────────────────────────────────────────
  function _updateGlobalLb() {
    if (!_db || !_userId) return;
    try {
      _db.collection('global_lb').doc(_userId).set({
        uid:          _userId,
        name:         _sDisplayName(),
        weeklyXP:     _sWeeklyXP(),
        weeklyMinutes: _sWeeklyMinutes(),
        updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    } catch(_) {}
  }
  async function _loadGlobalLeaderboard() {
    if (!_db) return;
    try {
      const snap = await _db.collection('global_lb').orderBy('weeklyXP', 'desc').limit(50).get();
      _globalLbData = snap.docs.map(d => d.data());
      if (_currentTab === 'social') renderSocial();
    } catch(e) { console.warn('[Global LB]', e.message); }
  }

  // ── Social Profile Modal ──────────────────────────────────────────────────
  function _buildProfileModal(uid_, name, xpTotal, weeklyMinutes, totalFocusMinutes, studyStreak, email, avatarUrl) {
    const ini    = _sInitials(name);
    const lvInfo = gamificationManager.calculateLevel(xpTotal || 0);
    const focusHrs = minsToHrs((totalFocusMinutes || 0));
    const streak   = studyStreak || 0;
    const avatarHTML = avatarUrl
      ? `<img src="${escapeHTML(avatarUrl)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover" alt=""/>`
      : `<div class="sm-avatar" style="width:72px;height:72px;border-radius:50%;background:${_sAvatarColor(uid_)};display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff">${ini}</div>`;
    openModal(`<h3 style="text-align:center">Profile Card</h3>
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 0 16px">
        ${avatarHTML}
        <div style="text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--text)">${escapeHTML(name)}</div>
          ${email ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHTML(email)}</div>` : ''}
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center">
          <div style="text-align:center;background:rgba(255,255,255,0.04);padding:10px 16px;border-radius:12px;min-width:70px">
            <div style="font-size:20px;font-weight:900;color:var(--accent)">${lvInfo.level}</div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Level</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.04);padding:10px 16px;border-radius:12px;min-width:70px">
            <div style="font-size:20px;font-weight:900;color:var(--primary)">⚡ ${(xpTotal || 0).toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Total XP</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.04);padding:10px 16px;border-radius:12px;min-width:70px">
            <div style="font-size:20px;font-weight:900;color:#34d399">${focusHrs}</div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Focus Time</div>
          </div>
          ${streak >= 2 ? `<div style="text-align:center;background:rgba(255,255,255,0.04);padding:10px 16px;border-radius:12px;min-width:70px">
            <div style="font-size:20px;font-weight:900;color:#f97316">🔥 ${streak}</div>
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Day Streak</div>
          </div>` : ''}
        </div>
      </div>
      <div class="actions"><button class="btn btn-ghost" data-close>Close</button></div>`);
  }

  function _viewMemberProfile(uid_) {
    const m = _socialMembers[uid_];
    if (!m) { toast('Profile not available', 'warn'); return; }
    _buildProfileModal(uid_, m.displayName || 'Anonymous', m.xpTotal, m.weeklyMinutes, m.totalFocusMinutes, m.studyStreak, m.email, m.avatarUrl);
  }

  async function _viewGlobalProfile(uid_, fallbackName) {
    // Try to find in current room first
    const inRoom = _socialMembers[uid_];
    if (inRoom) { _viewMemberProfile(uid_); return; }
    // Fall back to global_lb data
    const cached = _globalLbData.find(x => x.uid === uid_);
    if (cached) {
      _buildProfileModal(uid_, cached.name || fallbackName || 'Anonymous', cached.weeklyXP, cached.weeklyMinutes, null, null, null, null);
      return;
    }
    // Fetch from Firestore
    toast('Loading profile…', 'info', 1500);
    try {
      const snap = await _db.collection('global_lb').doc(uid_).get();
      if (snap.exists) {
        const d = snap.data();
        _buildProfileModal(uid_, d.name || fallbackName || 'Anonymous', d.weeklyXP, d.weeklyMinutes, null, null, null, null);
      } else {
        toast('Profile not found', 'warn');
      }
    } catch(e) { toast('Could not load profile', 'danger'); }
  }

  // ── Change Password ───────────────────────────────────────────────────────
  function _handleChangePassword() {
    const user = _auth && _auth.currentUser;
    if (!user) { toast('Sign in first', 'warn'); return; }
    openModal(`<h3>Change Password</h3>
      <div class="field"><label>Current Password</label><input id="cp-current" type="password" class="auth-input" placeholder="Current password" autocomplete="current-password"/></div>
      <div class="field"><label>New Password</label><input id="cp-new" type="password" class="auth-input" placeholder="New password (min 6 chars)" autocomplete="new-password"/></div>
      <div id="cp-error" class="auth-error hidden"></div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="cp-save">Change Password</button></div>`,
      root => {
        root.querySelector('#cp-save').onclick = async () => {
          const cur = root.querySelector('#cp-current').value;
          const nw  = root.querySelector('#cp-new').value;
          const errEl = root.querySelector('#cp-error');
          errEl.classList.add('hidden');
          if (!cur || !nw) { errEl.textContent = 'Both fields are required.'; errEl.classList.remove('hidden'); return; }
          if (nw.length < 6) { errEl.textContent = 'New password must be at least 6 characters.'; errEl.classList.remove('hidden'); return; }
          try {
            const cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
            await user.reauthenticateWithCredential(cred);
            await user.updatePassword(nw);
            closeModal();
            toast('✅ Password changed successfully!', 'success');
          } catch(e) {
            errEl.textContent = e.message || 'Failed to change password.';
            errEl.classList.remove('hidden');
          }
        };
      });
  }

  // ── Avatar Upload ─────────────────────────────────────────────────────────
  function _handleAvatarUpload(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file', 'warn'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const SIZE = 120;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        const ratio = Math.min(SIZE / img.width, SIZE / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        state.profile.avatarDataUrl = canvas.toDataURL('image/jpeg', 0.75);
        saveState();
        _scheduledCloudSync();
        renderAll();
        toast('✅ Profile picture updated!', 'success');
        modalSettings();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ── WebRTC Voice ──────────────────────────────────────────────────────────
  const _vcPath = () => `groups/${_socialRoomCode}/vc`;
  function _vcPairId(offerer, answerer) { return offerer + '__' + answerer; }

  function _vcAttachRemoteAudio(uid_, stream) {
    if (_voiceRemoteAudios[uid_]) { _voiceRemoteAudios[uid_].srcObject = stream; return; }
    const audio = document.createElement('audio');
    audio.autoplay = true; audio.srcObject = stream;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    _voiceRemoteAudios[uid_] = audio;
  }

  async function _vcInitiateCall(targetUid) {
    if (_voicePeers[targetUid]) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    _voicePeers[targetUid] = pc;
    if (_localStream) _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream));
    pc.ontrack = e => { if (e.streams[0]) _vcAttachRemoteAudio(targetUid, e.streams[0]); };
    const pairId = _vcPairId(_userId, targetUid);
    pc.onicecandidate = e => {
      if (e.candidate && _db && _socialRoomCode)
        _db.collection(_vcPath()).doc(pairId).update({ candidates_offerer: firebase.firestore.FieldValue.arrayUnion(e.candidate.toJSON()) }).catch(() => {});
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (_db && _socialRoomCode)
      await _db.collection(_vcPath()).doc(pairId).set({ offerer: _userId, answerer: targetUid, offer: { type: offer.type, sdp: offer.sdp }, candidates_offerer: [], candidates_answerer: [] });
  }

  async function _vcHandleOffer(pairId, data) {
    const offererUid = data.offerer;
    if (_voicePeers[offererUid]) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    _voicePeers[offererUid] = pc;
    if (_localStream) _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream));
    pc.ontrack = e => { if (e.streams[0]) _vcAttachRemoteAudio(offererUid, e.streams[0]); };
    pc.onicecandidate = e => {
      if (e.candidate && _db && _socialRoomCode)
        _db.collection(_vcPath()).doc(pairId).update({ candidates_answerer: firebase.firestore.FieldValue.arrayUnion(e.candidate.toJSON()) }).catch(() => {});
    };
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (_db && _socialRoomCode)
      await _db.collection(_vcPath()).doc(pairId).update({ answer: { type: answer.type, sdp: answer.sdp } });
    (data.candidates_offerer || []).forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  }

  function _voiceSubscribeSignals() {
    if (!_db || !_socialRoomCode || _voiceSignalUnsub) return;
    _voiceSignalUnsub = _db.collection(_vcPath()).onSnapshot(snap => {
      snap.docChanges().forEach(async change => {
        const data = change.doc.data(); if (!data) return;
        const pairId = change.doc.id;
        if (data.offerer === _userId && data.answer) {
          const pc = _voicePeers[data.answerer];
          if (pc && !pc._answerSet && pc.signalingState === 'have-local-offer') {
            pc._answerSet = true;
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {});
            const prev = pc._prevAnsCandCount || 0;
            (data.candidates_answerer || []).slice(prev).forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
            pc._prevAnsCandCount = (data.candidates_answerer || []).length;
          } else if (pc && pc._answerSet) {
            const prev = pc._prevAnsCandCount || 0;
            const newC = (data.candidates_answerer || []).slice(prev);
            pc._prevAnsCandCount = (data.candidates_answerer || []).length;
            newC.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
          }
        }
        if (data.answerer === _userId && data.offer && !data.answer && !_voicePeers[data.offerer]) {
          // Only handle incoming WebRTC offers if the user has explicitly joined voice
          if (_inVoice) {
            await _vcHandleOffer(pairId, data).catch(e => console.warn('[Voice] handleOffer', e.message));
          }
        }
        if (data.answerer === _userId && data.answer) {
          const pc = _voicePeers[data.offerer];
          if (pc) {
            const prev = pc._prevOffCandCount || 0;
            const newC = (data.candidates_offerer || []).slice(prev);
            pc._prevOffCandCount = (data.candidates_offerer || []).length;
            newC.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
          }
        }
      });
    });
  }

  async function _voiceJoin() {
    if (!_db || !_userId || !_socialRoomCode) { toast('Join a study room first', 'warn'); return; }
    if (_inVoice) return;
    try {
      _localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(e) { toast(`Microphone: ${e.message}`, 'danger'); return; }
    _inVoice = true; _voiceMuted = false; _voicePeers = {}; _voiceMembers = {};
    try {
      await _db.collection('groups').doc(_socialRoomCode).collection('voice_presence').doc(_userId).set({ uid: _userId, name: _sDisplayName(), active: true, ts: Date.now() });
    } catch(e) { console.warn('[Voice] presence write', e.message); }
    if (_voicePresentUnsub) _voicePresentUnsub();
    _voicePresentUnsub = _db.collection('groups').doc(_socialRoomCode).collection('voice_presence').onSnapshot(async snap => {
      const prev = { ..._voiceMembers };
      _voiceMembers = {};
      snap.docs.forEach(doc => { const d = doc.data(); if (d.active) _voiceMembers[d.uid] = d; });
      for (const uid_ of Object.keys(_voiceMembers)) {
        if (uid_ !== _userId && !prev[uid_] && !_voicePeers[uid_])
          _vcInitiateCall(uid_).catch(e => console.warn('[Voice] initiate', e.message));
      }
      for (const uid_ of Object.keys(prev)) { if (!_voiceMembers[uid_]) _vcHangUpPeer(uid_); }
      if (_currentTab === 'social') renderSocial();
    });
    _voiceSubscribeSignals();
    renderSocial();
    toast('🎤 Joined voice room!', 'success');
  }

  function _vcHangUpPeer(uid_) {
    const pc = _voicePeers[uid_]; if (pc) { try { pc.close(); } catch(_) {} delete _voicePeers[uid_]; }
    const au = _voiceRemoteAudios[uid_]; if (au) { try { au.srcObject = null; au.remove(); } catch(_) {} delete _voiceRemoteAudios[uid_]; }
  }

  function _voiceLeave(silent) {
    if (!_inVoice) return;
    _inVoice = false;
    if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
    Object.keys(_voicePeers).forEach(uid_ => _vcHangUpPeer(uid_));
    if (_voicePresentUnsub) { _voicePresentUnsub(); _voicePresentUnsub = null; }
    if (_voiceSignalUnsub)  { _voiceSignalUnsub();  _voiceSignalUnsub = null; }
    _voiceMembers = {}; _voicePeers = {}; _voiceRemoteAudios = {};
    if (_db && _userId && _socialRoomCode)
      _db.collection('groups').doc(_socialRoomCode).collection('voice_presence').doc(_userId).update({ active: false }).catch(() => {});
    if (!silent) { renderSocial(); toast('Left voice room', 'info'); }
  }

  function _voiceMuteToggle() {
    if (!_localStream) return;
    _voiceMuted = !_voiceMuted;
    _localStream.getAudioTracks().forEach(t => { t.enabled = !_voiceMuted; });
    renderSocial();
  }

  // Safe render helper — calls fn(), returns fallback string on any throw
  function _safe(fn, fallback) {
    if (fallback === undefined) fallback = '';
    try { return fn(); } catch (e) { console.error('[Render error]', e); return fallback; }
  }

  const _hadLocalData = !!localStorage.getItem(STORAGE_KEY);
  let state = loadState();

  // ── One-time migration: UTC date keys → local-date keys ──────────────────
  // Old todayKey() used toISOString() (UTC). For UTC+ timezones this stored
  // data under the wrong calendar date.  Re-key each entry so the UTC midnight
  // is mapped to the user's local calendar date, then persist once.
  (function _migrateStatsToLocalDates() {
    const fields = ['minutesByDate', 'sessions', 'videoMinutes'];
    let changed = false;
    fields.forEach(field => {
      const obj = state.focusStats[field];
      if (!obj || typeof obj !== 'object') return;
      const next = {};
      Object.entries(obj).forEach(([k, v]) => {
        // Interpret the stored key as UTC midnight and find the local calendar date
        const utcMidnight = new Date(k + 'T00:00:00Z');
        const localKey = localISO(utcMidnight);
        if (localKey !== k) changed = true;
        next[localKey] = (next[localKey] || 0) + v;
      });
      state.focusStats[field] = next;
    });
    // Also migrate activity keys
    const act = state.activity;
    if (act && typeof act === 'object') {
      const nextAct = {};
      Object.entries(act).forEach(([k, v]) => {
        const localKey = localISO(new Date(k + 'T00:00:00Z'));
        if (localKey !== k) changed = true;
        nextAct[localKey] = (nextAct[localKey] || 0) + v;
      });
      if (changed) state.activity = nextAct;
    }
    if (changed) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      console.log('[DateFix] Migrated UTC stat keys → local-date keys');
    }
  })();

  // ========== Helpers ==========
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Centralized minutes → human-readable hours converter
  function minsToHrs(min) {
    if (!min) return '0m';
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  function minsToHrsShort(min) {
    if (!min) return '0h';
    return (min / 60).toFixed(1) + 'h';
  }
  function formatTime12(hhmm) {
    if (!hhmm || !hhmm.includes(':')) return hhmm || '';
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return hhmm;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function daysUntil(iso) { return iso ? Math.ceil((new Date(iso + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000) : null; }
  function signedDaysUntil(iso) { return Math.round((new Date(iso + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000); }
  function daysFromStart(startISO) { return Math.max(0, Math.round((new Date(todayKey() + 'T00:00:00') - new Date(startISO + 'T00:00:00')) / 86400000)); }

  function findSubject(id) { return state.subjects.find(s => s.id === id); }
  function findChapter(subId, chId) { const s = findSubject(subId); return s && s.chapters.find(c => c.id === chId); }
  function findTopic(subId, chId, tId) { const c = findChapter(subId, chId); return c && c.topics.find(t => t.id === tId); }

  function chapterProgress(c) {
    if (!c.topics || !c.topics.length) return c.done ? 100 : 0;
    return Math.round((c.topics.filter(t => t.done).length / c.topics.length) * 100);
  }
  function isChapterEffectivelyDone(c) {
    return c.topics && c.topics.length ? c.topics.every(t => t.done) : c.done;
  }
  // ── Single source of truth for syllabus progress ──
  // Always chapter-based (matches the "30/90 ch" shown in Board Goals).
  // Uses isChapterEffectivelyDone: a chapter with topics is done when ALL topics are done;
  // a chapter without topics uses its own .done flag.
  function calculateTotalProgress() {
    let total = 0, done = 0;
    for (const sub of state.subjects)
      for (const ch of sub.chapters) {
        total++;
        if (isChapterEffectivelyDone(ch)) done++;
      }
    return total ? Math.round((done / total) * 100) : 0;
  }
  // All callers use these aliases — do not duplicate the logic above
  function overallProgress()          { return calculateTotalProgress(); }
  function getGlobalSyllabusProgress(){ return calculateTotalProgress(); }
  function nextExam() {
    const today = todayKey();
    return state.exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }

  // ========== Activity & Streak ==========
  function bumpActivity() {
    const k = todayKey();
    state.activity[k] = (state.activity[k] || 0) + 1;
    if (state.streak.lastDate !== k) {
      const yk = addDaysISO(k, -1);
      state.streak.count = state.streak.lastDate === yk ? state.streak.count + 1 : 1;
      state.streak.lastDate = k;
      if (!state.streak.best || state.streak.count > state.streak.best) state.streak.best = state.streak.count;
    }
    checkGoalCompletions();
    _updateLiveStats();
  }

  // Patch live stat widgets across any visible DOM without a full re-render
  function _updateLiveStats() {
    const streak = state.streak.count || 0;
    const today = todayKey();
    const totalFocusMin = Object.values(state.focusStats.minutesByDate || {}).reduce((a, b) => a + b, 0);
    const todayMin = state.focusStats.minutesByDate[today] || 0;
    // 7-day weekly total (for weekly graph meta label)
    const weekMin = [0,1,2,3,4,5,6].reduce((a, i) => a + (state.focusStats.minutesByDate[addDaysISO(today, -i)] || 0), 0);
    // Streak badges (class-based, used in Home XP board + stats tile)
    document.querySelectorAll('.live-streak-count').forEach(el => { el.textContent = streak + ' 🔥'; });
    // Home XP board streak number
    const homeStreakNum = document.querySelector('.xp-board-streak-num');
    if (homeStreakNum) homeStreakNum.textContent = streak;
    // Focus today (focus tab + any live label)
    document.querySelectorAll('.live-focus-today').forEach(el => { el.textContent = minsToHrs(todayMin); });
    // Total focus badges
    document.querySelectorAll('.live-focus-total').forEach(el => { el.textContent = minsToHrs(totalFocusMin); });
    // Stat tiles in stats view (patch in-place when on stats/focus tab)
    const todayFocusTile = document.querySelector('[data-live="today-focus"] .v');
    if (todayFocusTile) todayFocusTile.textContent = minsToHrs(todayMin);
    const totalFocusTile = document.querySelector('[data-live="total-focus"] .v');
    if (totalFocusTile) totalFocusTile.textContent = minsToHrs(totalFocusMin);
    const streakTile = document.querySelector('[data-live="streak"] .v');
    if (streakTile) streakTile.textContent = streak + ' 🔥';
    // Weekly chart meta label
    const weekMeta = document.querySelector('.stats-weekly-meta');
    if (weekMeta) weekMeta.textContent = minsToHrs(weekMin) + ' this week';
    // Mastery bento streak line in Home
    const masteryStreak = document.querySelector('.bento-mastery-streak');
    if (masteryStreak) masteryStreak.textContent = streak + ' day streak 🏅';
  }

  // ========== XP & Gamification System ==========
  // Triangular leveling: Level N requires N×100 XP to complete.
  // Total XP at start of level N = 100×(1+2+…+(N-1)) = 50×N×(N-1)
  const gamificationManager = {

    calculateLevel(totalXP) {
      let level = 1, threshold = 0;
      while (true) {
        const needed = level * 100;                      // XP to finish this level
        if (totalXP < threshold + needed)
          return { level, currentLevelXP: totalXP - threshold, nextLevelXP: needed,
            percent: Math.min(100, Math.round(((totalXP - threshold) / needed) * 100)) };
        threshold += needed;
        level++;
        if (level > 9999) break;
      }
      return { level: 9999, currentLevelXP: 0, nextLevelXP: 100, percent: 100 };
    },

    // Core XP addition — does NOT call saveState (caller's responsibility)
    addXP(amount, reason) {
      if (!amount || amount <= 0) return 0;
      if (!state.xp || typeof state.xp !== 'object') state.xp = { total: 0, streakBonusDate: null };
      const prev = this.calculateLevel(state.xp.total || 0);
      state.xp.total = (state.xp.total || 0) + amount;
      const next = this.calculateLevel(state.xp.total);
      if (next.level > prev.level) {
        setTimeout(() => {
          toast(`⚡ Level Up! You are now Level ${next.level} — keep grinding!`, 'success', 5500);
          this._flashGlow('rgba(99,102,241,0.22)');
        }, 700);
      }
      this._updateXPBar();
      return amount;
    },

    // Focus XP: 25 XP per 30 min (proportional, minimum 1 XP)
    addFocusXP(elapsedMin, dateStr) {
      if (!elapsedMin || elapsedMin <= 0) return;
      const amount = Math.max(1, Math.round(elapsedMin * 25 / 30));
      this.addXP(amount, 'focus');
      this._updateFocusStreak(elapsedMin, dateStr);
      this.checkStreakBonus();
      // Float near the timer ring (works in both normal and full-session views)
      const ringEl = document.querySelector('.focus-ring-center') ||
                     document.querySelector('.fs-timer-wrap')     ||
                     document.querySelector('.focus-ring-wrap');
      showXPFloat(amount, ringEl);
    },

    // Task XP: exactly 10 XP per completed task
    // sourceEl — the DOM element that was checked (used to position the float)
    addTaskXP(sourceEl) {
      this.addXP(10, 'task');
      showXPFloat(10, sourceEl || null);
    },

    // 7-day streak bonus: award 100 XP once per qualifying streak
    // Qualifies if last 7 consecutive days each have ≥ 180 min (3 h) of focus
    checkStreakBonus() {
      const today = todayKey();
      if (state.xp && state.xp.streakBonusDate === today) return;
      const mins = (state.focusStats && state.focusStats.minutesByDate) || {};
      let streak = 0;
      for (let i = 0; i < 7; i++) {
        if ((mins[addDaysISO(today, -i)] || 0) >= 180) streak++;
        else break;
      }
      if (streak >= 7) {
        if (!state.xp) state.xp = { total: 0, streakBonusDate: null };
        state.xp.streakBonusDate = today;
        this.addXP(100, 'streak_bonus');
        saveState();
        setTimeout(() => {
          toast('🔥 7-Day Consistency Bonus! +100 XP — incredible dedication!', 'success', 7000);
          this._flashGlow('rgba(249,115,22,0.26)');
        }, 400);
      }
    },

    // Momentary full-screen color flash (level-ups / streak bonuses)
    _flashGlow(color) {
      const el = document.createElement('div');
      el.style.cssText = `position:fixed;inset:0;background:${color};opacity:0;z-index:99998;pointer-events:none;transition:opacity 0.38s ease`;
      document.body.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = '1';
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 420); }, 560);
      });
    },

    // Update the XP widgets in the current DOM without a full re-render
    _updateXPBar() {
      const info = this.calculateLevel((state.xp && state.xp.total) || 0);
      const badge = document.querySelector('.xp-level-badge');
      const fill  = document.querySelector('.xp-bar-fill');
      const label = document.querySelector('.xp-label');
      if (badge) badge.textContent = `Lv.${info.level}`;
      if (fill)  fill.style.width  = `${info.percent}%`;
      if (label) label.textContent = `${info.currentLevelXP}/${info.nextLevelXP} XP`;
    },

    // Focus-streak tracker (was embedded in old awardXP)
    _updateFocusStreak(minutes, dateStr) {
      if (minutes < 25) return;
      if (!state.focusStreak || typeof state.focusStreak !== 'object')
        state.focusStreak = { count: 0, lastDate: null, best: 0 };
      const d = dateStr || todayKey(), yd = addDaysISO(d, -1);
      if (state.focusStreak.lastDate !== d) {
        state.focusStreak.count = state.focusStreak.lastDate === yd ? state.focusStreak.count + 1 : 1;
        state.focusStreak.lastDate = d;
        if (!state.focusStreak.best || state.focusStreak.count > state.focusStreak.best)
          state.focusStreak.best = state.focusStreak.count;
      }
    }
  };

  // Compatibility wrapper — used in renderHome / renderStats HTML templates
  function xpLevel() {
    return gamificationManager.calculateLevel((state.xp && state.xp.total) || 0).level;
  }
  // Legacy wrapper — existing call sites (focus timer, video, classroom) delegate here
  function awardXP(minutes, dateStr) {
    gamificationManager.addFocusXP(minutes, dateStr);
  }

  // ═══════════════════════════════════════════════════════════════
  // XP SHOP SYSTEM
  // ═══════════════════════════════════════════════════════════════
  var SHOP_ITEMS = [
    // Profile
    { id:'border_flame',   name:'Flame Border',    cat:'profile', rarity:'epic',      cost:500,  icon:'🔥', desc:'Animated fire ring pulses around your avatar',       equip:'border' },
    { id:'border_galaxy',  name:'Galaxy Frame',    cat:'profile', rarity:'legendary', cost:1500, icon:'🌌', desc:'Swirling galaxy frame — the rarest border',          equip:'border' },
    { id:'border_crystal', name:'Crystal Aura',    cat:'profile', rarity:'rare',      cost:350,  icon:'💎', desc:'Shimmering crystal ring — elegant & rare',           equip:'border' },
    { id:'title_botany',   name:'Botany Expert',   cat:'profile', rarity:'rare',      cost:300,  icon:'🌿', desc:'Custom title shown in Social rooms',                 equip:'title'  },
    { id:'title_night',    name:'Night Scholar',   cat:'profile', rarity:'rare',      cost:300,  icon:'🌙', desc:'For those who study after midnight',                 equip:'title'  },
    { id:'title_focus',    name:'Focus Master',    cat:'profile', rarity:'epic',      cost:600,  icon:'⚡', desc:'Elite title — only for the truly dedicated',         equip:'title'  },
    { id:'title_grind',    name:'The Grinder',     cat:'profile', rarity:'legendary', cost:1200, icon:'💀', desc:'Legendary status — earned through relentless grind', equip:'title'  },
    // Visual
    { id:'aura_fire',      name:'Fire Aura',       cat:'visual',  rarity:'epic',      cost:700,  icon:'🔥', desc:'Blazing aura pulses when you\'re online',           equip:'aura'   },
    { id:'aura_lightning', name:'Lightning Pulse', cat:'visual',  rarity:'epic',      cost:800,  icon:'⚡', desc:'Electric pulse rings during focus sessions',        equip:'aura'   },
    { id:'aura_galaxy',    name:'Galaxy Orb',      cat:'visual',  rarity:'legendary', cost:1800, icon:'🌌', desc:'Orbital galaxy effect — rarest visual in the shop', equip:'aura'   },
    { id:'aura_leaf',      name:'Leaf Animation',  cat:'visual',  rarity:'common',    cost:200,  icon:'🍃', desc:'Peaceful floating leaves during study sessions',    equip:'aura'   },
    // Utility (stackable)
    { id:'streak_freeze',  name:'Streak Freeze',   cat:'utility', rarity:'rare',      cost:150,  icon:'🧊', desc:'Protects your streak for 1 missed day. Stackable.',    equip:null, stackable:true },
    { id:'xp_boost_2x',    name:'XP Booster 2×',  cat:'utility', rarity:'rare',      cost:400,  icon:'⚡', desc:'Double XP for your next focus session. Stackable.',    equip:null, stackable:true },
    { id:'session_shield', name:'Session Shield',  cat:'utility', rarity:'common',    cost:200,  icon:'🛡️', desc:'Protect your longest session record. Stackable.',     equip:null, stackable:true },
    { id:'focus_energy',   name:'Focus Energy',    cat:'utility', rarity:'common',    cost:100,  icon:'🔋', desc:'Instantly refill your focus energy. Stackable.',      equip:null, stackable:true },
  ];

  var QUEST_TEMPLATES = [
    { id:'login',     title:'Open the app today',          icon:'⚡', xp:5,  type:'auto_done', target:1  },
    { id:'focus_30',  title:'Focus for 30 minutes',        icon:'⏱',  xp:25, type:'focus_min', target:30 },
    { id:'focus_60',  title:'Power Hour: 60 min focus',    icon:'🔥', xp:55, type:'focus_min', target:60 },
    { id:'focus_90',  title:'Deep Work: 90 min focus',     icon:'💪', xp:90, type:'focus_min', target:90 },
    { id:'tasks_3',   title:'Complete 3 study tasks',      icon:'✅', xp:30, type:'tasks',     target:3  },
    { id:'tasks_5',   title:'Crush 5 study tasks',         icon:'🎯', xp:55, type:'tasks',     target:5  },
    { id:'join_room', title:'Join a study room',           icon:'👥', xp:20, type:'social',    target:1  },
    { id:'streak',    title:'Keep your study streak alive',icon:'🔥', xp:40, type:'streak',    target:1  },
    { id:'revision',  title:'Complete a revision session', icon:'📖', xp:35, type:'revision',  target:1  },
  ];

  var _shopCategory = 'profile';

  function _xpBalance() {
    if (!state.xp) return 0;
    return Math.max(0, (state.xp.total || 0) - (state.xp.spent || 0));
  }
  function _itemOwned(id) { return (_itemQty(id)) > 0; }
  function _itemQty(id)   { return (state.inventory || {})[id] || 0; }
  function _itemEquipped(id) {
    const item = SHOP_ITEMS.find(i => i.id === id);
    if (!item || !item.equip) return false;
    return (state.equippedItems || {})[item.equip] === id;
  }

  function renderShop() {
    const view = document.getElementById('view-shop');
    if (!view) return;
    if (!_userId && !_authSkipped) {
      view.innerHTML = `<div class="social-gate"><div class="social-gate-icon">🛍️</div><h2 class="social-gate-title">XP Shop</h2><p class="social-gate-sub">Sign in to spend your earned XP on exclusive items, effects &amp; titles.</p><button class="btn" data-act="auth-show-modal">Sign In to Continue</button></div>`;
      return;
    }
    const bal      = _xpBalance();
    const lifetime = (state.xp && state.xp.total) || 0;
    const spent    = (state.xp && state.xp.spent)  || 0;
    const cats = [
      { id:'profile', label:'Profile', icon:'👤' },
      { id:'visual',  label:'Visual',  icon:'✨' },
      { id:'utility', label:'Utility', icon:'🛠️' },
    ];
    const catTabs = cats.map(c =>
      `<button class="shop-cat-btn${c.id === _shopCategory ? ' active' : ''}" data-act="shop-cat" data-cat="${c.id}">${c.icon} ${c.label}</button>`
    ).join('');

    const items = SHOP_ITEMS.filter(it => it.cat === _shopCategory);
    const itemsHTML = items.map(it => {
      const owned    = _itemOwned(it.id);
      const equipped = _itemEquipped(it.id);
      const qty      = it.stackable ? _itemQty(it.id) : 0;
      const canAfford = bal >= it.cost;
      const qtyBadge = qty > 0 ? `<span class="shop-qty-badge">×${qty}</span>` : '';
      let stateClass = '', stateLabel = '';
      if (equipped)            { stateClass = 'shop-item--equipped'; stateLabel = '✓ Equipped'; }
      else if (owned && !it.stackable) { stateClass = 'shop-item--owned';    stateLabel = 'Owned'; }
      else if (!canAfford)     { stateClass = 'shop-item--locked'; }
      let btnHTML;
      if (equipped && it.equip) {
        btnHTML = `<button class="shop-btn shop-btn-ghost" data-act="shop-unequip" data-iid="${it.id}">Unequip</button>`;
      } else if (owned && it.equip && !it.stackable) {
        btnHTML = `<button class="shop-btn shop-btn-equip" data-act="shop-equip" data-iid="${it.id}">Equip</button>`;
      } else if (canAfford) {
        btnHTML = `<button class="shop-btn shop-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()}</button>`;
      } else {
        btnHTML = `<button class="shop-btn shop-btn-locked" disabled>⚡ ${it.cost.toLocaleString()}</button>`;
      }
      return `<div class="shop-item-card rarity-${it.rarity} ${stateClass}">
        <div class="shop-rarity-bar rarity-${it.rarity}"></div>
        <div class="shop-item-top">
          <div class="shop-item-icon rarity-${it.rarity}">${it.icon}</div>
          <div class="shop-item-meta">
            <div class="shop-item-name">${escapeHTML(it.name)}${qtyBadge}</div>
            <div class="shop-rarity-pill rarity-${it.rarity}">${it.rarity.charAt(0).toUpperCase()+it.rarity.slice(1)}</div>
          </div>
          ${stateLabel ? `<span class="shop-state-badge">${stateLabel}</span>` : ''}
        </div>
        <div class="shop-item-desc">${escapeHTML(it.desc)}</div>
        ${btnHTML}
      </div>`;
    }).join('') || '<div class="empty">No items in this category yet.</div>';

    const ownedItems  = SHOP_ITEMS.filter(it => _itemOwned(it.id));
    const invPreview  = ownedItems.slice(0, 8).map(it => `<span class="inv-icon" title="${escapeHTML(it.name)}">${it.icon}</span>`).join('')
                        || '<span style="color:var(--text-muted);font-size:12px">Nothing yet — buy something below!</span>';

    // Daily quests section
    const questsHTML = renderDailyQuestsHTML();

    view.innerHTML = `<div class="view-pad shop-page">
      <div class="shop-topbar">
        <button class="shop-back-btn" data-act="shop-back" aria-label="Back">← Back</button>
      </div>
      <div class="shop-header-card">
        <div class="shop-header-row">
          <div><h1 class="shop-title">⚡ XP Shop</h1><p class="shop-sub">Spend your XP on premium rewards</p></div>
          <div class="shop-bal-pill">⚡ ${bal.toLocaleString()}</div>
        </div>
        <div class="shop-xp-stats">
          <div class="shop-stat"><span class="shop-stat-val">${lifetime.toLocaleString()}</span><span class="shop-stat-lbl">Lifetime</span></div>
          <div class="shop-stat-div"></div>
          <div class="shop-stat"><span class="shop-stat-val">${spent.toLocaleString()}</span><span class="shop-stat-lbl">Spent</span></div>
          <div class="shop-stat-div"></div>
          <div class="shop-stat"><span class="shop-stat-val">${bal.toLocaleString()}</span><span class="shop-stat-lbl">Balance</span></div>
        </div>
      </div>
      <div class="shop-inv-row"><span class="shop-inv-label">🎒 Inventory</span><div class="shop-inv-icons">${invPreview}</div></div>
      ${questsHTML}
      <div class="shop-cats">${catTabs}</div>
      <div class="shop-items">${itemsHTML}</div>
    </div>`;
  }

  function _shopBuy(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it) return;
    const bal = _xpBalance();
    if (bal < it.cost) { toast('Not enough XP to buy this!', 'warn', 3000); return; }
    openModal(`<div class="modal-body">
      <h3 style="text-align:center;margin-bottom:16px">Confirm Purchase</h3>
      <div style="text-align:center;padding:4px 0 12px">
        <div style="font-size:48px;margin-bottom:8px">${it.icon}</div>
        <div style="font-size:17px;font-weight:800;margin-bottom:4px">${escapeHTML(it.name)}</div>
        <div class="shop-rarity-pill rarity-${it.rarity}" style="display:inline-block;margin-bottom:12px">${it.rarity.charAt(0).toUpperCase()+it.rarity.slice(1)}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.5">${escapeHTML(it.desc)}</div>
        <div style="font-size:17px;font-weight:900;color:#fbbf24">⚡ ${it.cost.toLocaleString()} XP</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:3px">Balance after: ⚡ ${(bal - it.cost).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn btn-ghost btn-block" data-act="close-modal">Cancel</button>
        <button class="btn btn-block" data-act="shop-confirm-buy" data-iid="${itemId}" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1a1122;font-weight:800">Buy Now ⚡</button>
      </div>
    </div>`);
  }

  function _shopConfirmBuy(itemId) {
    closeModal();
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it) return;
    if (_xpBalance() < it.cost) { toast('Not enough XP!', 'warn', 3000); return; }
    if (!state.xp) state.xp = { total: 0 };
    if (typeof state.xp.spent !== 'number') state.xp.spent = 0;
    state.xp.spent += it.cost;
    if (!state.inventory) state.inventory = {};
    state.inventory[it.id] = (state.inventory[it.id] || 0) + 1;
    if (it.equip && !it.stackable) {
      if (!state.equippedItems) state.equippedItems = {};
      state.equippedItems[it.equip] = it.id;
    }
    saveState();
    gamificationManager._updateXPBar();
    toast(`${it.icon} ${it.name} purchased!`, 'success', 3500);
    const balEl = document.querySelector('.shop-bal-pill');
    if (balEl) showXPFloat(-it.cost, balEl);
    renderShop();
  }

  function _shopEquip(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it || !it.equip || !_itemOwned(it.id)) return;
    if (!state.equippedItems) state.equippedItems = {};
    state.equippedItems[it.equip] = it.id;
    saveState();
    toast(`${it.icon} ${it.name} equipped!`, 'success', 2500);
    renderShop();
  }

  function _shopUnequip(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it || !it.equip) return;
    if (!state.equippedItems) state.equippedItems = {};
    delete state.equippedItems[it.equip];
    saveState();
    toast(`Unequipped`, 'info', 2000);
    renderShop();
  }

  // ═══════════════════════════════════════════════════════════════
  // DAILY QUEST SYSTEM
  // ═══════════════════════════════════════════════════════════════
  function _ensureDailyQuests() {
    const today = todayKey();
    if (!state.dailyQuests || typeof state.dailyQuests !== 'object')
      state.dailyQuests = { date: '', quests: [] };
    if (state.dailyQuests.date !== today) {
      const always = QUEST_TEMPLATES.find(t => t.id === 'login');
      const pool   = QUEST_TEMPLATES.filter(t => t.id !== 'login');
      const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, 4);
      const templates = [always, ...shuffled].filter(Boolean);
      state.dailyQuests = {
        date: today,
        quests: templates.map(t => ({
          id: t.id, title: t.title, icon: t.icon, xp: t.xp,
          type: t.type, target: t.target, progress: 0, completed: false, claimed: false
        }))
      };
    }
    const today2 = todayKey();
    state.dailyQuests.quests.forEach(q => {
      if (q.claimed) return;
      if (q.type === 'auto_done')                                                    { q.progress = 1; q.completed = true; }
      if (q.type === 'streak'   && (state.streak && state.streak.count) > 0)        { q.progress = 1; q.completed = true; }
      if (q.type === 'social'   && _socialRoomCode)                                 { q.progress = 1; q.completed = true; }
      if (q.type === 'focus_min') {
        const m = (state.focusStats && state.focusStats.minutesByDate && state.focusStats.minutesByDate[today2]) || 0;
        q.progress = Math.min(m, q.target); q.completed = m >= q.target;
      }
    });
  }

  function _claimQuestXP(questId) {
    _ensureDailyQuests();
    const q = (state.dailyQuests.quests || []).find(x => x.id === questId);
    if (!q || !q.completed || q.claimed) return;
    q.claimed = true;
    gamificationManager.addXP(q.xp, 'quest');
    saveState();
    toast(`${q.icon} Quest complete! +${q.xp} XP`, 'success', 3000);
    const btn = document.querySelector(`[data-qid="${questId}"]`);
    if (btn) showXPFloat(q.xp, btn);
    if (_currentTab === 'shop') renderShop();
  }

  function renderDailyQuestsHTML() {
    _ensureDailyQuests();
    const quests   = state.dailyQuests.quests || [];
    const claimed  = quests.filter(q => q.claimed).length;
    const allDone  = claimed === quests.length && quests.length > 0;
    const rows = quests.map(q => {
      const pct = Math.min(100, Math.round((q.progress / (q.target || 1)) * 100));
      let actionEl = '';
      if (q.claimed) {
        actionEl = `<span class="quest-claimed">✓</span>`;
      } else if (q.completed) {
        actionEl = `<button class="btn btn-sm quest-claim-btn" data-act="quest-claim" data-qid="${q.id}">+${q.xp}</button>`;
      } else {
        actionEl = `<span class="quest-xp-pill">+${q.xp}</span>`;
      }
      return `<div class="quest-row${q.claimed ? ' quest-row--done' : ''}">
        <span class="quest-row-icon">${q.icon}</span>
        <div class="quest-row-body">
          <div class="quest-row-title">${escapeHTML(q.title)}</div>
          <div class="quest-bar-row">
            <div class="quest-bar-track"><div class="quest-bar-fill${q.completed ? ' quest-bar--complete' : ''}" style="width:${pct}%"></div></div>
            <span class="quest-prog">${q.progress}/${q.target}</span>
          </div>
        </div>
        ${actionEl}
      </div>`;
    }).join('');
    return `<div class="daily-quests-card">
      <div class="dq-header">
        <span class="dq-title">📋 Daily Quests</span>
        <span class="dq-count${allDone ? ' dq-count--done' : ''}">${claimed}/${quests.length} done${allDone ? ' 🎉' : ''}</span>
      </div>
      <div class="dq-list">${rows}</div>
    </div>`;
  }

  // ========== Badge System ==========
  const ACHIEVEMENTS = [
    // ── Easy Tier (Bronze) — +50 XP each ──────────────────────────────────
    { id: 'first_milestone',  tier: 'easy',   icon: '🎯', name: 'First Milestone',    desc: 'Complete your first focus session',         xp: 50  },
    { id: 'group_member',     tier: 'easy',   icon: '👥', name: 'Group Member',        desc: 'Join a Social Study Room',                  xp: 50  },
    { id: 'early_bird',       tier: 'easy',   icon: '🌅', name: 'Early Bird',          desc: 'Start a focus session before 7 AM',         xp: 50  },
    { id: 'night_owl',        tier: 'easy',   icon: '🦉', name: 'Night Owl',           desc: 'Start a session after 11 PM',               xp: 50  },
    { id: 'topic_starter',    tier: 'easy',   icon: '📝', name: 'Topic Starter',       desc: 'Complete your first topic',                 xp: 50  },
    { id: 'week_starter',     tier: 'easy',   icon: '📅', name: 'Week Starter',        desc: 'Study on 3 different days in a week',       xp: 50  },
    { id: 'first_revision',   tier: 'easy',   icon: '🔄', name: 'First Revision',      desc: 'Complete your first spaced revision',       xp: 50  },
    { id: 'plan_completer',   tier: 'easy',   icon: '✅', name: 'Plan Completer',      desc: 'Complete all tasks in a daily plan',        xp: 50  },
    // ── Medium Tier (Silver) — +200 XP each ───────────────────────────────
    { id: 'deep_work',        tier: 'medium', icon: '🧠', name: 'Deep Work',           desc: '5 hours of focus in a single day',          xp: 200 },
    { id: 'weekly_streak',    tier: 'medium', icon: '🔥', name: 'Weekly Streak',       desc: 'Maintain a 7-day study streak',             xp: 200 },
    { id: 'deep_diver',       tier: 'medium', icon: '🏊', name: 'Deep Diver',          desc: 'Complete a 90-minute continuous session',   xp: 200 },
    { id: 'consistency_king', tier: 'medium', icon: '👑', name: 'Consistency King',    desc: 'Maintain a 7-day streak with 3+ hrs/day',   xp: 200 },
    { id: 'week_warrior',     tier: 'medium', icon: '⚔️', name: 'Week Warrior',        desc: '7 focus sessions in one week',              xp: 200 },
    { id: 'topic_master',     tier: 'medium', icon: '📚', name: 'Topic Master',        desc: 'Complete 10 or more topics',                xp: 200 },
    { id: 'focus_10h',        tier: 'medium', icon: '⏱️', name: '10-Hour Club',         desc: 'Accumulate 10 total focus hours',           xp: 200 },
    { id: 'streak_14',        tier: 'medium', icon: '🌊', name: 'Fortnight Fire',      desc: 'Maintain a 14-day study streak',            xp: 200 },
    // ── Hard Tier (Gold) — +500 XP each ───────────────────────────────────
    { id: 'focus_legend',     tier: 'hard',   icon: '⭐', name: 'Focus Legend',        desc: 'Accumulate 100 total focus hours',          xp: 500 },
    { id: 'curriculum_master',tier: 'hard',   icon: '🎓', name: 'Curriculum Master',   desc: '100% syllabus completion in any subject',   xp: 500 },
    { id: 'marathon_study',   tier: 'hard',   icon: '🏃', name: 'Marathon Scholar',    desc: 'Complete a 3-hour continuous session',      xp: 500 },
    { id: 'streak_30',        tier: 'hard',   icon: '🌟', name: '30-Day Legend',       desc: 'Maintain a 30-day study streak',            xp: 500 },
    { id: 'topic_50',         tier: 'hard',   icon: '📖', name: 'Subject Dominator',   desc: 'Complete 50 or more topics',                xp: 500 },
    { id: 'focus_50h',        tier: 'hard',   icon: '🔱', name: 'Titan Scholar',       desc: 'Accumulate 50 total focus hours',           xp: 500 },
    { id: 'duel_victor',      tier: 'hard',   icon: '🏆', name: 'Duel Victor',         desc: 'Won a 2-hour XP Duel against a friend',    xp: 500 },
  ];
  const BADGES = ACHIEVEMENTS; // backward-compat alias
  // Map legacy IDs → current IDs for users who had old badges saved
  const _LEGACY_ID_MAP = { first_session: 'first_milestone', century_club: 'focus_legend', speed_learner: 'topic_master' };
  function _migrateLegacyBadges() {
    if (!state.badges) return;
    let changed = false;
    for (const [old, cur] of Object.entries(_LEGACY_ID_MAP)) {
      if (state.badges[old] && !state.badges[cur]) { state.badges[cur] = state.badges[old]; delete state.badges[old]; changed = true; }
    }
    if (changed) saveState();
  }

  function achievementToast(ach) {
    const wrap = document.getElementById('toast-container'); if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast achievement-toast';
    const tierColors  = { easy: '#22c55e', medium: '#38bdf8', hard: '#f59e0b' };
    const tierLabels  = { easy: '🥉 Easy', medium: '🥈 Medium', hard: '🥇 Hard' };
    const color = tierColors[ach.tier] || '#fbbf24';
    el.style.setProperty('--ach-color', color);
    el.innerHTML = `<div class="ach-toast-icon" style="filter:drop-shadow(0 0 8px ${color}88)">${ach.icon}</div><div class="ach-toast-body"><div class="ach-toast-title" style="color:${color}">Achievement Unlocked!</div><div class="ach-toast-name">${escapeHTML(ach.name)}</div><div class="ach-toast-desc">${escapeHTML(ach.desc)}</div>${ach.xp ? `<div class="ach-toast-xp" style="color:${color}">+${ach.xp} XP &nbsp;·&nbsp; ${tierLabels[ach.tier] || ''}</div>` : ''}</div>`;
    wrap.appendChild(el);
    gamificationManager._flashGlow(color + '28');
    setTimeout(() => el.remove(), 7000);
  }

  function checkBadges({ sessionMinutes = 0, sessionStartHour = null, joinedRoom = false } = {}) {
    if (!state.badges || typeof state.badges !== 'object') state.badges = {};
    _migrateLegacyBadges();
    const newlyUnlocked = [];
    const today = todayKey();
    const totalFocusMin = Object.values(state.focusStats.minutesByDate || {}).reduce((a, b) => a + b, 0);
    const todayFocusMin = state.focusStats.minutesByDate[today] || 0;
    const totalFocusSessions = Object.values(state.focusStats.sessions || {}).reduce((a, b) => a + b, 0);
    const totalRevDone = state.revisions.reduce((a, r) => a + r.schedule.filter(s => s.done).length, 0);
    const doneTopics = state.subjects.reduce((a, sub) => a + sub.chapters.reduce((b, ch) => b + ch.topics.filter(t => t.done).length, 0), 0);
    const streakCount = state.streak.count || 0;
    // Curriculum master: any single subject where ALL chapters are effectively done (and subject has chapters)
    const hasFullSubject = state.subjects.some(sub =>
      sub.chapters.length > 0 && sub.chapters.every(ch => isChapterEffectivelyDone(ch))
    );
    let weekSessions = 0, weekActiveDays = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDaysISO(today, -i);
      weekSessions += (state.focusStats.sessions[d] || 0);
      if ((state.focusStats.minutesByDate[d] || 0) > 0 || (state.activity[d] || 0) > 0) weekActiveDays++;
    }
    // All plan tasks done today?
    const allTodayDone = (() => {
      try { const tasks = getActivePlanTasks(); return tasks.length > 0 && tasks.every(t => t.done); } catch (_) { return false; }
    })();
    // Consistency king: 7-day streak + avg 3+ hrs/day this week
    const weekTotalMin = [0,1,2,3,4,5,6].reduce((a, i) => a + (state.focusStats.minutesByDate[addDaysISO(today, -i)] || 0), 0);
    const conditions = {
      first_milestone:  totalFocusSessions >= 1,
      group_member:     joinedRoom,
      early_bird:       sessionStartHour !== null && sessionStartHour < 7,
      night_owl:        sessionStartHour !== null && sessionStartHour >= 23,
      topic_starter:    doneTopics >= 1,
      week_starter:     weekActiveDays >= 3,
      first_revision:   totalRevDone >= 1,
      plan_completer:   allTodayDone,
      deep_work:        todayFocusMin >= 300,   // 5 hours in one day
      weekly_streak:    streakCount >= 7,
      deep_diver:       sessionMinutes >= 90,
      consistency_king: streakCount >= 7 && weekTotalMin / 7 >= 180,
      week_warrior:     weekSessions >= 7,
      topic_master:     doneTopics >= 10,
      focus_10h:        totalFocusMin / 60 >= 10,
      streak_14:        streakCount >= 14,
      focus_legend:     totalFocusMin / 60 >= 100,
      curriculum_master: hasFullSubject,
      marathon_study:   sessionMinutes >= 180,
      streak_30:        streakCount >= 30,
      topic_50:         doneTopics >= 50,
      focus_50h:        totalFocusMin / 60 >= 50,
    };
    for (const ach of ACHIEVEMENTS) {
      if (!state.badges[ach.id] && conditions[ach.id]) {
        state.badges[ach.id] = { unlockedAt: new Date().toISOString() };
        if (ach.xp) gamificationManager.addXP(ach.xp, `achievement_${ach.id}`);
        newlyUnlocked.push(ach);
      }
    }
    if (newlyUnlocked.length) {
      saveState();
      newlyUnlocked.forEach((b, i) => setTimeout(() => achievementToast(b), i * 900));
    }
  }

  function _recordSubjectMinutes(elapsedMin) {
    if (!elapsedMin || elapsedMin <= 0) return;
    const task = focusCurrentTaskKey ? getActivePlanTasks().find(t => t.key === focusCurrentTaskKey) : null;
    if (task && task.subId) {
      if (!state.focusStats.minutesBySubject) state.focusStats.minutesBySubject = {};
      state.focusStats.minutesBySubject[task.subId] = (state.focusStats.minutesBySubject[task.subId] || 0) + elapsedMin;
    }
  }

  // ========== Export / Import ==========
  function exportData(silent = false) {
    try {
      const blob = new Blob([JSON.stringify({ app: 'syllabus-tracker', version: 1, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `syllabus-backup-${todayKey()}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      localStorage.setItem(BACKUP_DATE_KEY, todayKey());
      dismissBackupBanner();
      if (!silent) toast('✅ Backup downloaded! Your progress is safe.', 'success', 4500);
    } catch (e) { toast('Export failed', 'danger'); }
  }

  function hasBackupToday() {
    return localStorage.getItem(BACKUP_DATE_KEY) === todayKey();
  }

  function dismissBackupBanner() {
    const banner = document.getElementById('backup-reminder-banner');
    if (banner) { banner.style.opacity = '0'; banner.style.transform = 'translateY(-10px)'; setTimeout(() => banner.remove(), 300); }
  }

  function showBackupReminderBanner() {
    if (hasBackupToday()) return;
    if (document.getElementById('backup-reminder-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'backup-reminder-banner';
    banner.className = 'backup-reminder-banner';
    banner.innerHTML = `
      <div class="brb-icon">🛡️</div>
      <div class="brb-text">
        <div class="brb-title">Keep your progress safe, ${escapeHTML(state.profile.name || 'friend')}!</div>
        <div class="brb-sub">No backup taken today. Download one to prevent data loss.</div>
      </div>
      <button class="brb-btn" id="brb-download-btn">Download</button>
      <button class="brb-dismiss" id="brb-dismiss-btn" aria-label="Dismiss">×</button>
    `;
    document.getElementById('app').prepend(banner);
    requestAnimationFrame(() => { banner.style.opacity = '1'; banner.style.transform = 'translateY(0)'; });
    document.getElementById('brb-download-btn').onclick = () => exportData();
    document.getElementById('brb-dismiss-btn').onclick = () => dismissBackupBanner();
  }

  function isBackupBannerTime() {
    const h = new Date().getHours(), m = new Date().getMinutes();
    return h === 23 && m >= 30;
  }

  function maybeShowBackupReminder() {
    if (hasBackupToday()) return;
    if (!isBackupBannerTime()) return;
    setTimeout(showBackupReminderBanner, 1500);
  }

  function checkBackupBannerWindow() {
    if (hasBackupToday()) { dismissBackupBanner(); return; }
    if (isBackupBannerTime()) {
      if (!document.getElementById('backup-reminder-banner')) showBackupReminderBanner();
    } else {
      dismissBackupBanner();
    }
  }
  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read file', 'danger');
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result || '')); } catch (e) { toast('Invalid JSON', 'danger'); return; }
      const candidate = (parsed && parsed.state && typeof parsed.state === 'object') ? parsed.state : parsed;
      if (!candidate || !Array.isArray(candidate.subjects)) { toast('Invalid backup file', 'danger'); return; }
      confirmModal(`Replace current data with ${candidate.subjects.length} subject(s) from backup?`, () => {
        try { state = migrate(JSON.parse(JSON.stringify(candidate))); saveState(); renderAll(); toast('Import complete', 'success'); } catch (e) { toast('Import failed', 'danger'); }
      }, { title: 'Replace all data?', yesLabel: 'Import', yesClass: 'btn' });
    };
    reader.readAsText(file);
  }

  // ========== Burnout Detector ==========
  function activeDaysInLast(n) {
    let count = 0;
    const keys = buildDateRange(n);
    keys.forEach(k => { if ((state.activity[k] || 0) > 0) count++; });
    return count;
  }
  function detectBurnout() {
    const out = { burned: false, reasons: [] };
    if (daysSince(state.burnout.installDate) < 3) return out;
    const lastDate = state.streak && state.streak.lastDate;
    const daysInactive = lastDate ? daysSince(lastDate) : daysSince(state.burnout.installDate);
    const active7 = activeDaysInLast(7);
    if (daysInactive >= 2) out.reasons.push({ label: `No activity for ${daysInactive} days` });
    if (daysSince(state.burnout.installDate) >= 5 && active7 <= 1) out.reasons.push({ label: `Only ${active7} active day(s) this week` });
    out.burned = out.reasons.length > 0;
    return out;
  }
  function renderBurnoutBanner() {
    const info = detectBurnout();
    if (!info.burned || (state.burnout && state.burnout.bannerDismissedDate === todayKey())) return '';
    return `<div class="burnout-banner" role="alert">
      <div class="burnout-banner-icon">⚠️</div>
      <div class="burnout-banner-body">
        <div class="burnout-banner-title">You are losing consistency!</div>
        <ul class="burnout-banner-reasons">${info.reasons.map(r => `<li>${escapeHTML(r.label)}</li>`).join('')}</ul>
        <div class="burnout-banner-actions">
          <button class="btn btn-warn" data-act="burnout-popup">Get Motivated</button>
          <button class="btn-link" data-act="burnout-dismiss-banner">Hide for today</button>
        </div>
      </div>
    </div>`;
  }
  function showBurnoutPopup() {
    const info = detectBurnout();
    const quotes = state.motivationQuotes;
    const quote = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : "";
    openModal(`
      <h3>⚠️ Losing consistency</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:-6px 0 12px">${info.reasons.map(r => escapeHTML(r.label)).join(' · ')}</p>
      ${quote ? `<div style="background:var(--surface-2);border-left:3px solid var(--primary);padding:10px 12px;border-radius:8px;font-style:italic;font-size:14px;margin-bottom:10px">"${escapeHTML(quote)}"</div>` : ''}
      <div class="actions">
        <button class="btn btn-ghost" data-close>Not now</button>
        <button class="btn" data-act="burnout-go-plan">Open Today's Plan</button>
      </div>
    `);
  }
  function maybeAutoShowBurnoutPopup() {
    const info = detectBurnout();
    if (!info.burned || state.burnout.popupDismissedDate === todayKey()) return;
    showBurnoutPopup();
    state.burnout.popupDismissedDate = todayKey();
    saveState();
  }

  // ========== Daily Plan ==========
  const autoKey = (subId, chId, tId) => `${subId}:${chId}:${tId}`;

  // Priority rank: high=0, medium=1, low=2, unset=3
  function planPriority(p) { return p === 'high' ? 0 : p === 'medium' ? 1 : p === 'low' ? 2 : 3; }

  // Pick the best undone topic from a single subject (highest-priority chapter first)
  function pickBestTopicFromSubject(sub, alreadyPicked) {
    const sortedChs = [...sub.chapters].sort((a, b) => planPriority(a.priority) - planPriority(b.priority));
    for (const ch of sortedChs) {
      if (isChapterEffectivelyDone(ch)) continue;
      for (const t of ch.topics) {
        if (t.done) continue;
        const key = autoKey(sub.id, ch.id, t.id);
        if (!alreadyPicked.has(key)) return { chId: ch.id, tId: t.id };
      }
    }
    return null;
  }

  // Generate up to 4 new tasks — one per subject when possible, priority-sorted
  function generateDailyTasks() {
    const picked = new Set();
    const auto = [];
    const sortedSubs = [...state.subjects].sort((a, b) => planPriority(a.priority) - planPriority(b.priority));

    // Pass 1: one topic per subject (variety first)
    for (const sub of sortedSubs) {
      if (auto.length >= 4) break;
      const topic = pickBestTopicFromSubject(sub, picked);
      if (topic) {
        picked.add(autoKey(sub.id, topic.chId, topic.tId));
        auto.push({ subId: sub.id, chId: topic.chId, tId: topic.tId });
      }
    }

    // Pass 2: fill remaining slots from any subject if we still have < 4
    if (auto.length < 4) {
      for (const sub of sortedSubs) {
        if (auto.length >= 4) break;
        let topic = pickBestTopicFromSubject(sub, picked);
        while (topic && auto.length < 4) {
          picked.add(autoKey(sub.id, topic.chId, topic.tId));
          auto.push({ subId: sub.id, chId: topic.chId, tId: topic.tId });
          topic = pickBestTopicFromSubject(sub, picked);
        }
      }
    }

    return auto;
  }

  // Collect undone tasks from yesterday to carry forward
  function collectRollover(newPickedKeys) {
    const yesterday = addDaysISO(todayKey(), -1);
    const prevPlan = state.dailyPlans[yesterday];
    if (!prevPlan) return { autoRollover: [], customRollover: [] };

    const autoRollover = [];
    const seenKeys = new Set(newPickedKeys);

    // Auto tasks that were not done and not explicitly removed yesterday
    for (const a of prevPlan.auto || []) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if ((prevPlan.removed || []).includes(key)) continue; // user removed it — respect that
      if (seenKeys.has(key)) continue;                       // already in today's fresh tasks
      const t = findTopic(a.subId, a.chId, a.tId);
      if (!t || t.done) continue;                            // completed — no need to roll over
      seenKeys.add(key);
      autoRollover.push({ subId: a.subId, chId: a.chId, tId: a.tId, rolledOver: true });
    }

    // Custom tasks that were not done yesterday (skip recurring — they self-reset)
    const customRollover = [];
    for (const c of prevPlan.custom || []) {
      if (c.recurringId) continue;
      if (!c.done) customRollover.push({ id: uid(), text: c.text, done: false, rolledOver: true });
    }

    return { autoRollover, customRollover };
  }

  function syncRecurringTasks(plan, k) {
    for (const rt of state.recurringTasks || []) {
      if (rt.lastResetDate !== k) rt.lastResetDate = k;
      const alreadyIn = plan.custom.some(c => c.recurringId === rt.id);
      if (!alreadyIn) plan.custom.unshift({ id: uid(), text: rt.text, done: false, recurringId: rt.id });
    }
  }

  function ensureTodayPlan() {
    const k = todayKey();
    if (!state.dailyPlans[k]) state.dailyPlans[k] = { auto: [], removed: [], custom: [], generated: false };
    const plan = state.dailyPlans[k];
    if (!plan.generated) {
      // 4 new priority-based tasks from different subjects
      const newAuto = generateDailyTasks();
      // Collect undone tasks from yesterday
      const pickedKeys = new Set(newAuto.map(a => autoKey(a.subId, a.chId, a.tId)));
      const { autoRollover, customRollover } = collectRollover(pickedKeys);
      // Rollover tasks appear first so they're immediately visible
      plan.auto = [...autoRollover, ...newAuto];
      const existingIds = new Set(plan.custom.map(c => c.id));
      for (const c of customRollover) { if (!existingIds.has(c.id)) plan.custom.unshift(c); }
      plan.generated = true;
      saveState();
    }
    syncRecurringTasks(plan, k);
    return plan;
  }

  function getActivePlanTasks() {
    const plan = ensureTodayPlan(); const tasks = [];
    for (const a of plan.auto) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if (plan.removed.includes(key)) continue;
      const sub = findSubject(a.subId), ch = findChapter(a.subId, a.chId), t = findTopic(a.subId, a.chId, a.tId);
      if (!sub || !ch || !t) continue;
      tasks.push({ type: 'auto', key, text: t.name, meta: `${sub.name} · ${ch.name}`, color: sub.color, done: !!t.done, subId: a.subId, chId: a.chId, tId: a.tId, rolledOver: !!a.rolledOver });
    }
    for (const c of plan.custom) tasks.push({ type: 'custom', key: c.id, text: c.text, meta: c.rolledOver ? 'Rolled over from yesterday' : c.recurringId ? 'Daily recurring task' : 'Custom task', color: c.rolledOver ? '#f59e0b' : c.recurringId ? '#818cf8' : '#94a3b8', done: !!c.done, id: c.id, rolledOver: !!c.rolledOver, recurringId: c.recurringId || null });
    return tasks;
  }

  // ========== Weak Point Detector ==========
  const WEAK_SKIP_THRESHOLD = 3, WEAK_AGE_DAYS = 7;
  function topicAgeDays(t) { return t.firstSeenAt ? Math.max(0, daysBetween(t.firstSeenAt, todayKey())) : 0; }
  function isWeakTopic(t) { return !t.done && ((t.skipCount || 0) >= WEAK_SKIP_THRESHOLD || topicAgeDays(t) >= WEAK_AGE_DAYS); }
  function weakReason(t) { const r = []; if ((t.skipCount || 0) >= WEAK_SKIP_THRESHOLD) r.push(`Skipped ×${t.skipCount}`); const age = topicAgeDays(t); if (age >= WEAK_AGE_DAYS) r.push(`${age}d stale`); return r.join(' · ') || 'Needs attention'; }
  function getWeakTopics() {
    const out = [];
    for (const sub of state.subjects) for (const ch of sub.chapters) for (const t of ch.topics) if (isWeakTopic(t)) out.push({ sub, ch, topic: t, reason: weakReason(t), age: topicAgeDays(t), skips: t.skipCount || 0 });
    return out.sort((a, b) => (b.skips - a.skips) || (b.age - a.age));
  }
  function resetWeakTopic(subId, chId, tId) { const t = findTopic(subId, chId, tId); if (t) { t.skipCount = 0; t.firstSeenAt = todayKey(); t.lastSkippedAt = null; } }

  // ========== Spaced Repetition ==========
  const REVISION_OFFSETS = [1, 3, 7];
  function scheduleRevisionsForTopic(subId, chId, tId) {
    if (!findTopic(subId, chId, tId)) return;
    const today = todayKey();
    const existing = state.revisions.find(r => r.tId === tId);
    if (existing) {
      const haveOffsets = new Set(existing.schedule.map(s => s.offset));
      for (const off of REVISION_OFFSETS) if (!haveOffsets.has(off)) existing.schedule.push({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null });
      if (existing.schedule.every(s => s.done)) existing.schedule = REVISION_OFFSETS.map(off => ({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null }));
      existing.subId = subId; existing.chId = chId; return;
    }
    state.revisions.push({ id: uid(), subId, chId, tId, completedAt: today, schedule: REVISION_OFFSETS.map(off => ({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null })) });
  }
  function cancelRevisionsForTopic(tId) { state.revisions = state.revisions.filter(r => r.tId !== tId || r.schedule.some(s => s.done)); }
  function onTopicDoneChanged(subId, chId, tId, isDone) { if (isDone) scheduleRevisionsForTopic(subId, chId, tId); else cancelRevisionsForTopic(tId); }
  function pruneRevisions() { state.revisions = state.revisions.filter(r => findTopic(r.subId, r.chId, r.tId) && !r.schedule.every(s => s.done)); }
  function dueRevisionItems() {
    const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
      if (!sub || !ch) continue;
      for (const step of r.schedule) if (!step.done && step.dueDate <= today) items.push({ revisionId: r.id, sub, ch, topic, step, daysOverdue: daysBetween(step.dueDate, today) });
    }
    return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }
  function upcomingRevisionItems(limit = 8) {
    const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
      if (!sub || !ch) continue;
      for (const step of r.schedule) if (!step.done && step.dueDate > today) items.push({ revisionId: r.id, sub, ch, topic, step, daysUntil: daysBetween(today, step.dueDate) });
    }
    return items.sort((a, b) => a.step.dueDate.localeCompare(b.step.dueDate)).slice(0, limit);
  }
  function completeRevisionStep(revisionId, offset) {
    const r = state.revisions.find(x => x.id === revisionId); if (!r) return;
    const step = r.schedule.find(s => s.offset === offset); if (!step || step.done) return;
    step.done = true; step.completedAt = todayKey(); bumpActivity();
    if (r.schedule.every(s => s.done)) state.revisions = state.revisions.filter(x => x.id !== r.id);
    saveState();
  }
  function dismissRevisionEntry(revisionId) { state.revisions = state.revisions.filter(x => x.id !== revisionId); saveState(); }

  // ========== Notifications ==========
  const NOTIF_SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;
  let dueTaskTimer = null;
  const dueTaskNotified = new Set(); let dueTaskNotifiedDate = null;

  function notifPermission() { try { return NOTIF_SUPPORTED ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } }
  function requestNotifPermission() {
    return new Promise(resolve => {
      if (!NOTIF_SUPPORTED) return resolve('unsupported');
      try { const p = Notification.requestPermission(r => resolve(r)); if (p && p.then) p.then(resolve).catch(() => resolve('denied')); } catch (e) { resolve('denied'); }
    });
  }
  function showWebNotification(title, body, opts) {
    if (notifPermission() !== 'granted') return false;
    const options = Object.assign({ body: body || '', tag: 'syllabus-tracker', renotify: true }, opts || {});
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) { navigator.serviceWorker.controller.postMessage({ type: 'show-notification', title, options, url: './' }); return true; }
      new Notification(title, options); return true;
    } catch (e) { return false; }
  }
  function checkSmartReminder() {
    const sr = state.smartReminder; if (!sr || !sr.enabled || !sr.times.length) return;
    const now = new Date(); const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of sr.times) {
      if (t !== cur) continue; const stampKey = today + 'T' + t;
      if (sr.lastFired[stampKey]) continue;
      const incomplete = getActivePlanTasks().filter(x => !x.done);
      if (!incomplete.length) continue;
      sr.lastFired[stampKey] = true; saveState();
      if (notifPermission() === 'granted') { showWebNotification('Syllabus Tracker', `Reminder · You have ${incomplete.length} task(s) for today.`, { tag: 'smart-rem' }); }
      else { openModal(`<h3>⏰ Study Reminder</h3><div style="margin:8px 0 16px;font-size:15px">${escapeHTML(`${formatTime12(t)} — ${incomplete.length} task(s) remaining today.`)}</div><div class="actions"><button class="btn btn-ghost" data-close>Dismiss</button><button class="btn" data-act="open-plan">Open Plan</button></div>`); }
      break;
    }
  }
  function checkMotivationReminders() {
    const mr = state.motivationReminders; if (!mr || !mr.enabled || !mr.times.length) return;
    const now = new Date(); const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of mr.times) {
      if (t !== cur) continue; const stampKey = today + 'T' + t; if (mr.lastFired[stampKey]) continue;
      mr.lastFired[stampKey] = true; saveState();
      const _mqPool = state.motivationQuotes.length ? [...MOTIVATION_QUOTES, ...state.motivationQuotes] : MOTIVATION_QUOTES;
      const quote = _mqPool[Math.floor(Math.random() * _mqPool.length)];
      if (notifPermission() === 'granted') showWebNotification('💪 Stay focused', quote, { tag: `mot-${stampKey}` });
      else toast(`💪 ${quote}`, 'info', 5000);
      break;
    }
  }
  // ========== Precise Notification Scheduler ==========
  // Replaces 30s polling — fires exactly at HH:MM:00 ±1s.
  // Works while app is open or backgrounded (tab/PWA minimized).
  const _notifTimers = new Map();

  function _nextOccurrenceMs(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function _scheduleSmartReminderAt(timeStr) {
    const key = 'sr:' + timeStr;
    if (_notifTimers.has(key)) clearTimeout(_notifTimers.get(key));
    const delay = _nextOccurrenceMs(timeStr);
    const id = setTimeout(() => {
      _notifTimers.delete(key);
      const sr = state.smartReminder;
      if (sr && sr.enabled && notifPermission() === 'granted') {
        const stampKey = todayKey() + 'T' + timeStr;
        if (!sr.lastFired[stampKey]) {
          const incomplete = getActivePlanTasks().filter(x => !x.done);
          if (incomplete.length > 0) {
            sr.lastFired[stampKey] = true; saveState();
            showWebNotification('📚 Study Reminder', `${incomplete.length} task${incomplete.length > 1 ? 's' : ''} pending for today!`, { tag: 'smart-rem-' + timeStr, requireInteraction: false });
          }
        }
      }
      _scheduleSmartReminderAt(timeStr);
    }, delay);
    _notifTimers.set(key, id);
  }

  function _scheduleMotivationAt(timeStr) {
    const key = 'mot:' + timeStr;
    if (_notifTimers.has(key)) clearTimeout(_notifTimers.get(key));
    const delay = _nextOccurrenceMs(timeStr);
    const id = setTimeout(() => {
      _notifTimers.delete(key);
      const mr = state.motivationReminders;
      if (mr && mr.enabled) {
        const stampKey = todayKey() + 'T' + timeStr;
        if (!mr.lastFired[stampKey]) {
          mr.lastFired[stampKey] = true; saveState();
          const _mPool = state.motivationQuotes.length ? [...MOTIVATION_QUOTES, ...state.motivationQuotes] : MOTIVATION_QUOTES;
          const quote = _mPool[Math.floor(Math.random() * _mPool.length)];
          if (notifPermission() === 'granted') {
            showWebNotification('💪 Stay Focused!', quote, { tag: 'mot-' + timeStr, requireInteraction: false });
          } else {
            toast(`💪 ${quote}`, 'info', 5000);
          }
        }
      }
      _scheduleMotivationAt(timeStr);
    }, delay);
    _notifTimers.set(key, id);
  }

  function scheduleAllNotifications() {
    _notifTimers.forEach(id => clearTimeout(id));
    _notifTimers.clear();
    if (notifPermission() !== 'granted') return;
    if (state.smartReminder && state.smartReminder.enabled) {
      (state.smartReminder.times || []).forEach(_scheduleSmartReminderAt);
    }
    if (state.motivationReminders && state.motivationReminders.enabled) {
      (state.motivationReminders.times || []).forEach(_scheduleMotivationAt);
    }
    _pushScheduleToSW();
  }

  function _pushScheduleToSW() {
    if (!('serviceWorker' in navigator)) return;
    const schedules = [];
    if (state.smartReminder && state.smartReminder.enabled) {
      (state.smartReminder.times || []).forEach(t => {
        schedules.push({ type: 'study-reminder', time: t, title: '📚 Study Reminder', body: 'You have tasks pending today!' });
      });
    }
    if (state.motivationReminders && state.motivationReminders.enabled) {
      const quotes = state.motivationQuotes || [];
      (state.motivationReminders.times || []).forEach(t => {
        const q = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : 'Keep going! 💪';
        schedules.push({ type: 'motivation', time: t, title: '💪 Stay Focused!', body: q });
      });
    }
    try { localStorage.setItem('stk_notif_config', JSON.stringify({ schedules, ts: Date.now() })); } catch (e) {}
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'schedule-notifications', schedules });
    }).catch(() => {});
  }


  // ========== Interval-Based Motivation System ==========
  let _motivationIntervalTimer = null;

  function isQuietHours() {
    const h = new Date().getHours();
    return h >= 0 && h < 6;
  }

  function isStudyUrgent() {
    const mastery = overallProgress();
    if (mastery < 30) return true;
    const yesterday = addDaysISO(todayKey(), -1);
    if ((state.activity[todayKey()] || 0) === 0 && (state.activity[yesterday] || 0) === 0) return true;
    return false;
  }

  function showMotivationToast(quote, urgent) {
    const existing = document.getElementById('moti-toast-el');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'moti-toast-el';
    el.className = 'moti-toast' + (urgent ? ' urgent' : '');
    el.innerHTML = `<div class="moti-toast-icon">${urgent ? '🚨' : '💪'}</div><div class="moti-toast-body"><div class="moti-toast-label">${urgent ? 'Wake-Up Call' : 'Stay Motivated'}</div><div class="moti-toast-quote">${escapeHTML(quote)}</div></div><button class="moti-toast-close" aria-label="Dismiss">×</button>`;
    el.querySelector('.moti-toast-close').onclick = () => el.remove();
    const app = document.getElementById('app');
    if (app) app.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 9000);
  }

  function fireMotivationReminder() {
    if (isQuietHours()) return;
    const urgent = isStudyUrgent();
    const pool = urgent ? MOTIVATION_QUOTES_URGENT : MOTIVATION_QUOTES;
    const userQuotes = state.motivationQuotes || [];
    const combined = userQuotes.length > 0 ? [...pool, ...userQuotes] : pool;
    const quote = combined[Math.floor(Math.random() * combined.length)];
    if (notifPermission() === 'granted') {
      showWebNotification(
        urgent ? '🚨 Study Alert!' : '💪 Stay Focused!',
        quote,
        { tag: 'mot-interval-' + Date.now(), requireInteraction: urgent }
      );
    }
    showMotivationToast(quote, urgent);
    state.motivationInterval.lastFired = Date.now();
    saveState();
  }

  function startMotivationIntervalLoop() {
    if (_motivationIntervalTimer) { clearInterval(_motivationIntervalTimer); _motivationIntervalTimer = null; }
    const mi = state.motivationInterval;
    if (!mi || !mi.enabled) return;
    const ms = Math.max(1, mi.intervalHours || 2) * 60 * 60 * 1000;
    _motivationIntervalTimer = setInterval(() => {
      if (state.motivationInterval && state.motivationInterval.enabled) fireMotivationReminder();
    }, ms);
  }

  // ========== Motivational Sleeper Alarm ==========
  const ALARM_QUOTES_DEFAULT = [
    "GET UP! Your dreams won't chase themselves!",
    "Rise and conquer — the world won't wait for you!",
    "Every champion was once a beginner who refused to quit. GET UP!",
    "You didn't come this far to only come this far. WAKE UP!",
    "While you sleep, someone else is grinding for YOUR spot.",
    "Your future self is counting on YOU right now. GET UP!",
    "Pain is temporary. Glory is forever. WAKE UP!",
    "Champions don't hit snooze. Neither do you.",
    "Success is for those who show up. SHOW UP NOW.",
    "The grind never stops. Why should you?"
  ];
  let _alarmTimers    = new Map();
  let _alarmAudioEl   = null;
  let _alarmRampTimer = null;
  let _alarmMoveTimer = null;
  let _alarmWakeLock  = null;
  let _activeAlarmId  = null;

  function _getAlarmQuote() {
    const pool = (state.motivationQuotes && state.motivationQuotes.length)
      ? state.motivationQuotes : ALARM_QUOTES_DEFAULT;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function scheduleAllAlarms() {
    _alarmTimers.forEach((id, k) => { if (k !== 'snooze') clearTimeout(id); });
    _alarmTimers.clear();
    (state.alarms || []).forEach(alarm => { if (alarm.enabled) _scheduleOneAlarm(alarm); });
  }

  function _scheduleOneAlarm(alarm) {
    const prev = _alarmTimers.get(alarm.id);
    if (prev) clearTimeout(prev);
    const delay = _nextOccurrenceMs(alarm.time);
    const id = setTimeout(() => { _alarmTimers.delete(alarm.id); triggerAlarm(alarm.id); }, delay);
    _alarmTimers.set(alarm.id, id);
  }

  async function triggerAlarm(alarmId) {
    _activeAlarmId = alarmId;
    const alarm = (state.alarms || []).find(a => a.id === alarmId);
    try {
      if ('wakeLock' in navigator) _alarmWakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { console.warn('[Alarm] WakeLock:', e.message); }
    _showAlarmOverlay(alarm);
    _startAlarmAudio();
  }

  function _startAlarmAudio() {
    _stopAlarmAudio();
    const audio = new Audio('./sounds/alarm-wake.mp3');
    audio.loop = true;
    audio.volume = 0.2;
    _alarmAudioEl = audio;
    audio.play().catch(() => {
      const fb = new Audio('./sounds/peaky-blinder.mp3');
      fb.loop = true; fb.volume = 0.2;
      _alarmAudioEl = fb;
      fb.play().catch(() => {});
    });
    // Ramp 0.2 → 1.0 over 10 s: 80 steps × 125 ms
    let step = 0;
    _alarmRampTimer = setInterval(() => {
      if (!_alarmAudioEl) { clearInterval(_alarmRampTimer); return; }
      step++;
      try { _alarmAudioEl.volume = Math.min(1, 0.2 + 0.8 * (step / 80)); } catch (_) {}
      if (step >= 80) { clearInterval(_alarmRampTimer); _alarmRampTimer = null; }
    }, 125);
  }

  function _showAlarmOverlay(alarm) {
    document.getElementById('alarm-overlay')?.remove();
    const quote = _getAlarmQuote();
    const now   = new Date();
    const h12   = ((now.getHours() + 11) % 12) + 1;
    const min   = String(now.getMinutes()).padStart(2, '0');
    const ampm  = now.getHours() < 12 ? 'AM' : 'PM';
    const label = alarm ? (alarm.label || 'Alarm') : 'Alarm';
    const ov = document.createElement('div');
    ov.id = 'alarm-overlay';
    ov.innerHTML = `
      <div class="al-pulse-bg"></div>
      <div class="al-bell-wrap">
        <span class="al-bell">⏰</span>
        <span class="al-label">${escapeHTML(label)}</span>
      </div>
      <div class="al-clock">${h12}:${min}<span class="al-ampm">${ampm}</span></div>
      <div class="al-quote">"${escapeHTML(quote)}"</div>
      <button class="al-snooze" id="al-snooze">💤 Snooze 5 min</button>
      <button class="al-dismiss" id="al-dismiss">✋ Dismiss</button>
    `;
    document.body.appendChild(ov);
    document.getElementById('al-snooze').addEventListener('click', snoozeAlarm);
    document.getElementById('al-dismiss').addEventListener('click', dismissAlarm);
    lockPortrait();
    setTimeout(_startMovingDismiss, 3000);
  }

  function _startMovingDismiss() {
    if (_alarmMoveTimer) { clearInterval(_alarmMoveTimer); _alarmMoveTimer = null; }
    const btn = document.getElementById('al-dismiss');
    if (!btn) return;
    function move() {
      const bw = btn.offsetWidth || 160, bh = btn.offsetHeight || 52;
      const maxX = Math.max(bw, window.innerWidth  - bw - 16);
      const maxY = Math.max(bh, window.innerHeight - bh - 16);
      btn.style.left      = Math.max(8, Math.floor(Math.random() * maxX)) + 'px';
      btn.style.top       = Math.max(8, Math.floor(Math.random() * maxY)) + 'px';
      btn.style.transform = 'none';
    }
    move();
    _alarmMoveTimer = setInterval(move, 1500);
  }

  function dismissAlarm() {
    _stopAlarmAudio();
    _releaseAlarmWakeLock();
    if (_alarmMoveTimer) { clearInterval(_alarmMoveTimer); _alarmMoveTimer = null; }
    document.getElementById('alarm-overlay')?.remove();
    const alarm = (state.alarms || []).find(a => a.id === _activeAlarmId);
    if (alarm && alarm.enabled) _scheduleOneAlarm(alarm);
    _activeAlarmId = null;
    toast('Alarm dismissed — go get it! 🔥', 'success', 4000);
  }

  function snoozeAlarm() {
    _stopAlarmAudio();
    if (_alarmMoveTimer) { clearInterval(_alarmMoveTimer); _alarmMoveTimer = null; }
    document.getElementById('alarm-overlay')?.remove();
    const savedId = _activeAlarmId;
    const tid = setTimeout(() => { _alarmTimers.delete('snooze'); triggerAlarm(savedId); }, 5 * 60 * 1000);
    _alarmTimers.set('snooze', tid);
    toast('Snoozed 5 minutes 💤 — alarm returns shortly!', 'info', 4000);
  }

  function _stopAlarmAudio() {
    if (_alarmRampTimer) { clearInterval(_alarmRampTimer); _alarmRampTimer = null; }
    if (_alarmAudioEl) {
      try { _alarmAudioEl.pause(); _alarmAudioEl.currentTime = 0; } catch (_) {}
      _alarmAudioEl = null;
    }
  }

  function _releaseAlarmWakeLock() {
    if (_alarmWakeLock) { try { _alarmWakeLock.release(); } catch (_) {} _alarmWakeLock = null; }
  }

  // ========== Eye-Care Mode (Night Study Mode) ==========
  let _videoWatchStart  = null;
  let _eyeBreakInterval = null;
  // ── 20-20-20 Eye Break tracker (Video Player) ─────────────────
  let _eyeBreakElapsed    = 0;   // seconds of active play accumulated
  let _eyeBreakActive     = false;
  let _eyeBreakCountdownId = null;
  const EYE_BREAK_SECS    = 20 * 60; // 20 minutes

  function applyEyCareMode() {
    if (state.eyeCareMode) {
      if (!document.getElementById('eye-care-overlay')) {
        const el = document.createElement('div');
        el.id = 'eye-care-overlay';
        document.body.appendChild(el);
      }
    } else {
      document.getElementById('eye-care-overlay')?.remove();
      _stopEyeBreakTimer();
    }
  }

  function startVideoWatch() { _videoWatchStart = Date.now(); }

  function _startEyeBreakTimer() {
    _stopEyeBreakTimer();
    _eyeBreakElapsed = 0;
    _eyeBreakActive  = false;
    // Tick every second — only counts while video is actually playing
    _eyeBreakInterval = setInterval(() => {
      if (!document.getElementById('vp-overlay')) { _stopEyeBreakTimer(); return; }
      if (_eyeBreakActive) return;
      // Smart pause detection: if YT API is bound, respect player state;
      // otherwise (external URLs, unbound API) always count while player is open
      const isPlaying = _ytPlayerReady
        ? (_ytPlayerState === 1 || _ytPlayerState === 3)
        : true;
      if (!isPlaying) return;
      _eyeBreakElapsed++;
      if (_eyeBreakElapsed >= EYE_BREAK_SECS) {
        _eyeBreakElapsed = 0;
        _showEyeBreakModal();
      }
    }, 1000);
  }

  function _stopEyeBreakTimer() {
    if (_eyeBreakInterval)    { clearInterval(_eyeBreakInterval);    _eyeBreakInterval    = null; }
    if (_eyeBreakCountdownId) { clearInterval(_eyeBreakCountdownId); _eyeBreakCountdownId = null; }
    _eyeBreakActive = false;
    document.getElementById('eye-break-overlay')?.remove();
  }

  function _showEyeBreakModal() {
    if (_eyeBreakActive) return;
    _eyeBreakActive = true;
    // Pause video if YT API is available
    try { if (_ytPlayerReady && _ytPlayer) _ytPlayer.pauseVideo(); } catch (e) {}
    // Remove stale overlay if any
    document.getElementById('eye-break-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'eye-break-overlay';
    overlay.innerHTML = `
      <div class="ebm-modal" role="dialog" aria-modal="true" aria-label="Eye Break Reminder">
        <div class="ebm-eye-icon" aria-hidden="true">👁️</div>
        <h2 class="ebm-title">Time for an Eye Break!</h2>
        <p class="ebm-sub">Look at something 20 feet away for 20 seconds<br>to relax your eyes and reduce strain.</p>
        <div class="ebm-rule">
          <div class="ebm-rule-card">
            <span class="ebm-rule-num">20</span>
            <span class="ebm-rule-unit">MIN</span>
          </div>
          <span class="ebm-rule-arrow">›</span>
          <div class="ebm-rule-card">
            <span class="ebm-rule-num">20</span>
            <span class="ebm-rule-unit">FEET</span>
          </div>
          <span class="ebm-rule-arrow">›</span>
          <div class="ebm-rule-card">
            <span class="ebm-rule-num">20</span>
            <span class="ebm-rule-unit">SECS</span>
          </div>
        </div>
        <div class="ebm-countdown-wrap">
          <p class="ebm-countdown-label">Look away for</p>
          <div class="ebm-ring-wrap">
            <svg class="ebm-ring-svg" viewBox="0 0 88 88" aria-hidden="true">
              <circle class="ebm-ring-bg" cx="44" cy="44" r="36"/>
              <circle class="ebm-ring-fg" cx="44" cy="44" r="36" id="ebm-ring-fg"/>
            </svg>
            <span class="ebm-countdown-num" id="ebm-countdown">20</span>
          </div>
          <p class="ebm-countdown-unit">seconds</p>
        </div>
        <button class="ebm-btn" id="ebm-btn" data-act="eye-break-done">✅ Break taken!</button>
        <p class="ebm-tip">💡 Blink slowly 10–15 times to re-lubricate your eyes.</p>
      </div>`;
    document.body.appendChild(overlay);
    // Animate in after next frame
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('ebm-show')));

    // 20-second countdown + ring
    const CIRC = 2 * Math.PI * 36; // ≈ 226.2
    const ringEl = document.getElementById('ebm-ring-fg');
    if (ringEl) { ringEl.style.strokeDasharray = CIRC; ringEl.style.strokeDashoffset = CIRC; }
    let secs = 20;
    const updateCountdown = () => {
      const numEl = document.getElementById('ebm-countdown');
      if (numEl) numEl.textContent = secs;
      if (ringEl) ringEl.style.strokeDashoffset = CIRC * (secs / 20);
    };
    updateCountdown();
    _eyeBreakCountdownId = setInterval(() => {
      secs = Math.max(0, secs - 1);
      updateCountdown();
      if (secs === 0) {
        clearInterval(_eyeBreakCountdownId); _eyeBreakCountdownId = null;
        const btn = document.getElementById('ebm-btn');
        if (btn) btn.classList.add('ebm-btn-pulse');
      }
    }, 1000);
  }

  function _dismissEyeBreak() {
    if (_eyeBreakCountdownId) { clearInterval(_eyeBreakCountdownId); _eyeBreakCountdownId = null; }
    _eyeBreakActive  = false;
    _eyeBreakElapsed = 0;
    // Resume video
    try { if (_ytPlayerReady && _ytPlayer) _ytPlayer.playVideo(); } catch (e) {}
    const overlay = document.getElementById('eye-break-overlay');
    if (overlay) {
      overlay.classList.remove('ebm-show');
      overlay.classList.add('ebm-hide');
      setTimeout(() => overlay.remove(), 380);
    }
  }

  // ========== Alarm Manager Modal ==========
  function openAlarmManager() {
    const alarms = state.alarms || [];
    const rows = alarms.length ? alarms.map(a => {
      const [hh, mm] = a.time.split(':');
      const h12 = ((parseInt(hh) + 11) % 12) + 1;
      const ampm = parseInt(hh) < 12 ? 'AM' : 'PM';
      return `<div class="al-row">
        <div class="al-row-left">
          <div class="al-row-time">${h12}:${mm} <span class="al-row-ampm">${ampm}</span></div>
          <div class="al-row-lbl">${escapeHTML(a.label || 'Alarm')}</div>
        </div>
        <div class="al-row-right">
          <label class="switch"><input type="checkbox" data-act="toggle-alarm" data-id="${a.id}" ${a.enabled ? 'checked' : ''}/><span class="slider"></span></label>
          <button class="menu-btn" data-act="edit-alarm" data-id="${a.id}">${ic('edit')}</button>
          <button class="menu-btn" data-act="del-alarm" data-id="${a.id}">${ic('trash')}</button>
        </div>
      </div>`;
    }).join('') : `<div style="color:var(--text-muted);font-size:14px;padding:6px 0">No alarms yet. Add one below.</div>`;
    openModal(`<h3>⏰ Sleeper Alarm</h3>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 14px">High-intensity alarm that plays your saved motivation quotes and won't stop until you catch the moving Dismiss button.</p>
      <div class="al-list">${rows}</div>
      <div style="margin-top:14px"><button class="btn btn-block" data-act="add-alarm">+ Add Alarm</button></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-close>Close</button></div>`);
  }

  function openAddEditAlarm(existingId) {
    const existing = existingId ? (state.alarms || []).find(a => a.id === existingId) : null;
    let [h, m] = (existing ? existing.time : '07:00').split(':').map(Number);
    if (isNaN(h)) h = 7; if (isNaN(m)) m = 0;
    const initLabel = existing ? (existing.label || '') : '';
    openModal(`<h3>${existing ? 'Edit' : 'New'} Alarm</h3>
      <div class="field"><label>Label</label><input id="al-label-in" value="${escapeHTML(initLabel)}" maxlength="40" placeholder="e.g. Morning Alarm"/></div>
      <div class="field"><label>Time</label>
        <div class="tp-wrap-min" style="margin-top:6px">
          <div class="tp-display"><span class="tp-h">${String(((h+11)%12)+1).padStart(2,'0')}</span><span class="tp-sep">:</span><span class="tp-m">${String(m).padStart(2,'0')}</span><span class="tp-ampm-lbl">${h<12?'AM':'PM'}</span></div>
          <div class="tp-steppers">
            <div class="tp-stepper"><div class="tp-s-label">Hour</div><div class="tp-s-row"><button class="tp-s-btn" data-tp="h-down">−</button><div class="tp-s-val tp-val-h">${String(h).padStart(2,'0')}</div><button class="tp-s-btn" data-tp="h-up">+</button></div></div>
            <div class="tp-stepper"><div class="tp-s-label">Minute</div><div class="tp-s-row"><button class="tp-s-btn" data-tp="m-down">−</button><div class="tp-s-val tp-val-m">${String(m).padStart(2,'0')}</div><button class="tp-s-btn" data-tp="m-up">+</button></div></div>
          </div>
          <div class="tp-ampm"><button class="tp-chip ${h<12?'on':''}" data-tp-ampm="AM">AM</button><button class="tp-chip ${h>=12?'on':''}" data-tp-ampm="PM">PM</button></div>
          <div class="tp-presets"><button class="tp-chip" data-tp-set="05:30">5:30</button><button class="tp-chip" data-tp-set="06:00">6 AM</button><button class="tp-chip" data-tp-set="06:30">6:30</button><button class="tp-chip" data-tp-set="07:00">7 AM</button><button class="tp-chip" data-tp-set="07:30">7:30</button><button class="tp-chip" data-tp-set="08:00">8 AM</button></div>
        </div>
      </div>
      <div class="al-confirm-hint">🔊 Tap <b>Save &amp; Test Sound</b> — plays a 2-second preview which also unlocks alarm audio on your device (required by browsers).</div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="al-del-btn">Delete</button>` : ''}
        <button class="btn al-save-btn" id="al-save-btn">💾 Save &amp; Test Sound</button>
      </div>`,
      root => {
        function upd() {
          h=((h%24)+24)%24; m=((m%60)+60)%60;
          const h12=((h+11)%12)+1, ap=h<12?'AM':'PM';
          root.querySelector('.tp-h').textContent=String(h12).padStart(2,'0');
          root.querySelector('.tp-m').textContent=String(m).padStart(2,'0');
          root.querySelector('.tp-ampm-lbl').textContent=ap;
          root.querySelector('.tp-val-h').textContent=String(h).padStart(2,'0');
          root.querySelector('.tp-val-m').textContent=String(m).padStart(2,'0');
          root.querySelectorAll('[data-tp-ampm]').forEach(b=>b.classList.toggle('on',b.dataset.tpAmpm===ap));
        }
        root.querySelectorAll('[data-tp]').forEach(btn=>{
          let ti=null,ri=null;
          const fn=()=>{const tp=btn.dataset.tp;if(tp==='h-up')h++;else if(tp==='h-down')h--;else if(tp==='m-up')m++;else m--;upd();};
          btn.addEventListener('pointerdown',e=>{e.preventDefault();fn();ti=setTimeout(()=>{ri=setInterval(fn,80);},350);});
          const stop=()=>{clearTimeout(ti);clearInterval(ri);};
          btn.addEventListener('pointerup',stop);btn.addEventListener('pointerleave',stop);btn.addEventListener('pointercancel',stop);
        });
        root.querySelectorAll('[data-tp-ampm]').forEach(btn=>btn.addEventListener('click',()=>{const t=btn.dataset.tpAmpm;if(t==='AM'&&h>=12)h-=12;if(t==='PM'&&h<12)h+=12;upd();}));
        root.querySelectorAll('[data-tp-set]').forEach(btn=>btn.addEventListener('click',()=>{const[hh,mm]=btn.dataset.tpSet.split(':').map(Number);h=hh;m=mm;upd();}));
        const delBtn = root.querySelector('#al-del-btn');
        if (delBtn) delBtn.onclick = () => {
          state.alarms=(state.alarms||[]).filter(a=>a.id!==existingId);
          const t=_alarmTimers.get(existingId); if(t){clearTimeout(t);_alarmTimers.delete(existingId);}
          saveState(); closeModal(); openAlarmManager(); toast('Alarm deleted','danger');
        };
        root.querySelector('#al-save-btn').onclick = () => {
          const label = root.querySelector('#al-label-in').value.trim() || 'Alarm';
          const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
          if (existing) { existing.label=label; existing.time=timeStr; }
          else { if (!state.alarms) state.alarms=[]; state.alarms.push({id:uid(),label,time:timeStr,enabled:true}); }
          saveState();
          scheduleAllAlarms();
          // 2-second test sound — bypasses autoplay for the real trigger later
          resumeAudioContext();
          const test = new Audio('./sounds/alarm-wake.mp3');
          test.volume = 0.4;
          test.play().catch(() => {
            const fb = new Audio('./sounds/peaky-blinder.mp3');
            fb.volume = 0.4;
            fb.play().catch(() => {});
            setTimeout(() => { try { fb.pause(); } catch(_) {} }, 2000);
          });
          setTimeout(() => { try { test.pause(); test.currentTime = 0; } catch(_) {} }, 2000);
          closeModal();
          openAlarmManager();
          const h12=((h+11)%12)+1, ap=h<12?'AM':'PM';
          toast(`⏰ Alarm set for ${h12}:${String(m).padStart(2,'0')} ${ap}!`, 'success', 4000);
        };
      }
    );
  }

  // ========== Midnight date-change detector ==========
  let _planDateKey = todayKey();
  function onMidnightReset() {
    const k = todayKey();
    // Ensure today's slot exists and is marked un-generated so rollover + fresh tasks are built
    if (!state.dailyPlans[k]) state.dailyPlans[k] = { auto: [], removed: [], custom: [], generated: false };
    state.dailyPlans[k].generated = false;
    state.dailyPlans[k].auto = [];
    saveState();
    ensureTodayPlan();
    renderAll();
    toast('🌙 New day! Daily plan refreshed with rollover tasks.', 'info', 5000);
    maybeShowBackupReminder();
  }

  function startTimers() {
    clearInterval(dueTaskTimer);
    setInterval(checkBackupBannerWindow, 60000);
    // Check for date change every 60s — triggers midnight rollover
    setInterval(() => {
      const now = todayKey();
      if (now !== _planDateKey) { _planDateKey = now; onMidnightReset(); }
    }, 60000);
    dueTaskTimer = setInterval(() => {
      const today = todayKey(); if (dueTaskNotifiedDate !== today) { dueTaskNotified.clear(); dueTaskNotifiedDate = today; }
      for (const item of dueRevisionItems()) {
        const key = `${item.revisionId}:${item.step.offset}`; if (dueTaskNotified.has(key)) continue;
        dueTaskNotified.add(key);
        if (notifPermission() === 'granted') showWebNotification('Revision due', `${item.topic.name} (${item.sub.name})`, { tag: `rev-${key}` });
      }
    }, 60000);
    // Precise setTimeout-based scheduling replaces 30s polling intervals
    scheduleAllNotifications();
  }

  // ========== Toast ==========
  function toast(msg, kind = 'info', ms = 3800) {
    const wrap = document.getElementById('toast-container'); if (!wrap) return;
    const t = document.createElement('div'); t.className = 'toast ' + kind;
    t.textContent = msg; wrap.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ── XP Float: golden pill that rises from a tapped element ──────────────
  function showXPFloat(amount, anchorEl) {
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${amount} XP`;
    let cx, cy;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      cx = r.left + r.width  / 2;
      cy = r.top  + r.height / 4;
    } else {
      cx = window.innerWidth  / 2;
      cy = window.innerHeight * 0.42;
    }
    el.style.left = Math.round(cx) + 'px';
    el.style.top  = Math.round(cy) + 'px';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  // ========== Modal ==========
  function openModal(html, onMount) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const backdrop = root.firstElementChild;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    if (onMount) onMount(backdrop.querySelector('.modal'));
  }
  function closeModal() { const r = document.getElementById('modal-root'); if (r) r.innerHTML = ''; }
  function confirmModal(msg, onYes, opts) {
    const o = opts || {};
    openModal(`<h3>${escapeHTML(o.title || 'Are you sure?')}</h3><div style="margin:6px 0 14px;color:var(--text-muted);font-size:14px">${escapeHTML(msg)}</div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${o.yesClass || 'btn-danger'}" id="m-yes">${escapeHTML(o.yesLabel || 'Delete')}</button></div>`,
      root => { root.querySelector('#m-yes').onclick = () => { closeModal(); onYes(); }; });
  }

  // ========== Icons ==========
  const ICONS = {
    plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
    chev: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    edit: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    trash: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    cal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    warn: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    refresh: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
    download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    lock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    unlock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
    play: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    note: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    star: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  };
  const ic = n => ICONS[n] || '';

  // ========== Motivation Rotation ==========
  let _motivationIdx = 0;
  let _motivationRotateTimer = null;

  const MOTI_EMPTY_HINT = '✨ Add your favorite quotes in Settings to see them here.';
  function getRotatingQuote() {
    const saved = state.motivationQuotes || [];
    if (!saved.length) return MOTI_EMPTY_HINT;
    _motivationIdx = _motivationIdx % saved.length;
    return saved[_motivationIdx];
  }
  function nextMotivationQuote() {
    const saved = state.motivationQuotes || [];
    if (!saved.length) return;
    _motivationIdx = (_motivationIdx + 1) % saved.length;
    const el = document.getElementById('home-moti-text');
    if (el) {
      el.style.animation = 'none';
      el.offsetWidth;
      el.style.animation = '';
      el.textContent = saved[_motivationIdx] || '';
    }
  }
  function _refreshHomeMotiText() {
    const el = document.getElementById('home-moti-text');
    if (!el) return;
    const saved = state.motivationQuotes || [];
    if (!saved.length) { el.textContent = MOTI_EMPTY_HINT; return; }
    _motivationIdx = _motivationIdx % saved.length;
    el.textContent = saved[_motivationIdx];
  }
  function startMotivationRotation() {
    clearInterval(_motivationRotateTimer);
    _motivationRotateTimer = setInterval(nextMotivationQuote, 30000);
  }

  // ========== Focus Timer State ==========
  let focusMode = 'work', focusSeconds = 25 * 60;
  let focusRunning = false, focusTimer = null;
  let focusSessions = state.focusStats.sessions[todayKey()] || 0;
  let focusSubTab = 'timer';
  let focusLocked = false;
  let focusCurrentTaskKey = null;
  let fsSessionActive = false;
  let _fsSwipeStartX = 0, _fsSwipeStartY = 0;
  let _fsMotiQuote = ''; /* set once on entering full session, shown in motivation box */
  const customDurations = { work: 25, short: 5, long: 15 };
  let focusStartTime = null;
  let focusStartSeconds = null;
  let focusMultitaskMode = false;
  let focusOvertime = false, focusOvertimeSeconds = 0, focusOvertimeTimer = null;
  let _alarmAudio = null, _alarmStopTimer = null;

  // ========== Ambient Sound (MP3-based) ==========
  let ambientAudio = null;
  let ambientMode = 'none', ambientVolume = 0.5;

  // ========== Focus Intensity (Deep-focus WAV tracks) ==========
  let focusIntensityAudio = null;
  let focusIntensityMode  = 'none';

  // ========== Binaural Beats Player ==========
  let _binauralAudio   = null;
  let _binauralPlaying = false;
  let _binauralVolume  = 0.7;
  const FOCUS_INTENSITY_TRACKS = [
    { id: 'monk-mode',      label: '🧘 Monk Mode',   desc: '40 Hz Gamma Binaural',    src: './sounds/monk-mode.wav' },
    { id: 'void',           label: '🌊 Void',          desc: 'Pink Noise · Deep Rain',  src: './sounds/void.wav' },
    { id: 'solfeggio-528',  label: '✨ 528 Hz',        desc: 'Solfeggio Transformation', src: './sounds/solfeggio-528.wav' },
  ];
  let _audioCtx = null;

  function getAudioContext() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { console.warn('[Audio] AudioContext not supported:', e); }
    }
    return _audioCtx;
  }
  function resumeAudioContext() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(e => console.warn('[Audio] AudioContext resume failed:', e));
    }
  }

  // ========== Sound Track Catalogue ==========
  const SOUNDS = [
    { id: 'none',          label: '🔇 Off',              src: null,                               cat: null },
    { id: 'rain',          label: '🌧 Rain',              src: './sounds/rain.mp3',                cat: 'Ambient' },
    { id: 'soft',          label: '🎵 Soft',              src: './sounds/soft.mp3',                cat: 'Ambient' },
    { id: 'concentration', label: '🧠 Concentration',    src: './sounds/concentration.mp3',       cat: 'Focus' },
    { id: 'peaky',         label: '🎩 Peaky Blinder',     src: './sounds/peaky-blinder.mp3',       cat: 'Workout' },
    { id: 'believer',      label: '💥 Believer',          src: './sounds/believer.m4a',            cat: 'Workout' },
    { id: 'rasputin',      label: '⚡ Rasputin',           src: './sounds/rasputin.m4a',            cat: 'Workout' },
    { id: 'enemy',         label: '🎭 Enemy',             src: './sounds/enemy.m4a',               cat: 'Workout' },
    { id: 'aal-izz-well',  label: '✌ Aal Izz Well',      src: './sounds/aal-izz-well.m4a',        cat: 'Vibes' },
    { id: 'sunshine',      label: '🌞 Give Me Sunshine',  src: './sounds/give-me-sunshine.m4a',    cat: 'Vibes' },
    { id: 'shape',         label: '💃 Shape of You',      src: './sounds/shape-of-you.m4a',        cat: 'Vibes' },
    { id: 'hall-of-fame',  label: '🏆 Hall of Fame',      src: './sounds/hall-of-fame.m4a',        cat: 'Vibes' },
    { id: 'summertime',    label: '🌊 Summertime Sadness', src: './sounds/summertime-sadness.m4a',  cat: 'Vibes' },
  ];
  function soundById(id) { return SOUNDS.find(s => s.id === id) || SOUNDS[0]; }

  // ── Focus Timer Motivational Quotes ─────────────────────────────
  let _currentQuote = null;
  function pickNewQuote() {
    const pool = state.motivationQuotes;
    if (!pool || !pool.length) { _currentQuote = ''; return; }
    const others = pool.filter(q => q !== _currentQuote);
    const src = others.length ? others : pool;
    _currentQuote = src[Math.floor(Math.random() * src.length)];
  }

  function stopAmbient() {
    if (ambientAudio) {
      ambientAudio.pause();
      ambientAudio.currentTime = 0;
      ambientAudio = null;
    }
  }

  function stopFocusIntensity() {
    if (focusIntensityAudio) {
      focusIntensityAudio.pause();
      focusIntensityAudio.currentTime = 0;
      focusIntensityAudio = null;
    }
  }

  function startFocusIntensity(mode) {
    stopFocusIntensity();
    focusIntensityMode = mode;
    if (mode === 'none') return;
    resumeAudioContext();
    const track = FOCUS_INTENSITY_TRACKS.find(t => t.id === mode);
    if (!track) return;
    const audio = new Audio();
    audio.loop    = true;
    audio.volume  = 0.55;
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      if (focusIntensityAudio === audio) { audio.currentTime = 0; audio.play().catch(() => {}); }
    });
    audio.addEventListener('error', e => console.error('[FocusIntensity] Load error:', e));
    audio.src = track.src;
    audio.load();
    audio.play().catch(e => console.warn('[FocusIntensity] play() failed:', e.message));
    focusIntensityAudio = audio;
  }

  // ── Binaural Beats functions ──────────────────────────────────
  function _updateBinauralUI() {
    const btn  = document.getElementById('binaural-play-btn');
    const card = document.getElementById('binaural-card');
    if (btn)  btn.innerHTML  = _binauralPlaying ? '⏸ Pause' : '▶ Play';
    if (card) card.classList.toggle('bb-playing', _binauralPlaying);
  }

  function _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:   'Beta Wave — 20 Hz Deep Focus',
      artist:  'StudyVault Binaural',
      album:   'StudyVault Focus',
      artwork: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
    navigator.mediaSession.setActionHandler('play', () => {
      if (_binauralAudio) _binauralAudio.play().catch(() => {});
      _binauralPlaying = true;
      navigator.mediaSession.playbackState = 'playing';
      _updateBinauralUI();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (_binauralAudio) _binauralAudio.pause();
      _binauralPlaying = false;
      navigator.mediaSession.playbackState = 'paused';
      _updateBinauralUI();
    });
  }

  function toggleBinaural() {
    if (!_binauralAudio) {
      _binauralAudio = new Audio('./sounds/focus-beta.wav');
      _binauralAudio.loop    = true;
      _binauralAudio.volume  = _binauralVolume;
      _binauralAudio.preload = 'auto';
      // Backup ended handler for browsers that ignore loop on WAV
      _binauralAudio.addEventListener('ended', () => {
        if (_binauralPlaying) { _binauralAudio.currentTime = 0; _binauralAudio.play().catch(() => {}); }
      });
    }
    resumeAudioContext();
    if (_binauralPlaying) {
      _binauralAudio.pause();
      _binauralPlaying = false;
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } else {
      _binauralAudio.play().catch(e => {
        console.warn('[Binaural] play() failed:', e.message);
        toast('Tap Play again — browser requires a fresh gesture.', 'info', 3000);
      });
      _binauralPlaying = true;
      _setupMediaSession();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
    _updateBinauralUI();
  }

  function setBinauralVolume(v) {
    _binauralVolume = parseFloat(v);
    if (_binauralAudio) _binauralAudio.volume = _binauralVolume;
  }

  function startAmbient(mode) {
    stopAmbient();
    if (mode === 'none') return;

    // Unlock AudioContext inside user-gesture call stack (required on iOS/Android)
    resumeAudioContext();

    const sound = soundById(mode);
    if (!sound || !sound.src) return;

    const audio = new Audio();
    audio.loop = true;          // Primary gapless loop mechanism
    audio.volume = ambientVolume;
    audio.preload = 'auto';

    audio.addEventListener('error', e => {
      const err = e.target.error;
      console.error('[Audio] Load error for', sound.src, ':', err ? `code ${err.code} – ${err.message}` : 'unknown');
    });

    // Backup: restart via ended event in case loop attribute misfires on some browsers
    audio.addEventListener('ended', () => {
      if (ambientAudio === audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.warn('[Audio] Loop restart failed:', e.message));
      }
    });

    // Set src → load → play (required order for iOS Safari)
    audio.src = sound.src;
    audio.load();

    const p = audio.play();
    if (p !== undefined) {
      p.then(() => console.log('[Audio] Playing:', sound.src))
       .catch(e => console.error('[Audio] play() rejected for', sound.src, ':', e.name, '-', e.message));
    }

    ambientAudio = audio;

    // MediaSession: keep audio alive on mobile when screen locks
    if ('mediaSession' in navigator) {
      const sound = soundById(mode);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: sound ? sound.label.replace(/^[^\w]+ /, '') : 'Ambient Sound',
        artist: 'Syllabus Tracker',
        album: 'Focus Session',
      });
      navigator.mediaSession.setActionHandler('play', () => { audio.play().catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
    }
  }

  function resumeAmbientIfNeeded() {
    resumeAudioContext();
    if (ambientMode === 'none') return;
    if (!ambientAudio || ambientAudio.paused) startAmbient(ambientMode);
  }

  function setAmbientVolume(vol) {
    ambientVolume = Math.max(0, Math.min(1, vol));
    if (ambientAudio) ambientAudio.volume = ambientVolume;
  }

  // ========== YouTube / Classroom ==========
  function parseYouTubeUrl(url) {
    let videoId = null, playlistId = null;
    try {
      if (url.includes('youtu.be/')) { videoId = url.split('youtu.be/')[1].split(/[?&#]/)[0]; }
      else if (url.includes('youtube.com')) {
        const u = new URL(url);
        videoId = u.searchParams.get('v');
        playlistId = u.searchParams.get('list');
      }
    } catch (e) {}
    return { videoId: videoId ? videoId.trim() : null, playlistId: playlistId ? playlistId.trim() : null };
  }
  function ytThumb(videoId) { return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`; }
  function ytEmbedUrl(item) { return buildEmbedUrl(item); }
  function buildEmbedUrl(item) {
    if (item.type === 'playlist' && item.playlistId) return `https://www.youtube.com/embed/videoseries?list=${item.playlistId}&autoplay=1&fs=1`;
    if (item.videoId) return `https://www.youtube.com/embed/${item.videoId}?autoplay=1&enablejsapi=1&fs=1&playsinline=0&rel=0`;
    if (item.url) return item.url;
    return '';
  }
  function extractSiteName(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch(e) { return 'External'; }
  }

  let _classroomLastUrl = '';
  try { _classroomLastUrl = localStorage.getItem('cls_last_url') || ''; } catch(e) {}
  async function fetchYouTubeTitle(url) {
    try {
      const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
      const resp = await fetch(endpoint, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!resp.ok) return { title: null, thumbnailUrl: null };
      const data = await resp.json();
      return {
        title: (data && data.title) ? data.title : null,
        thumbnailUrl: (data && data.thumbnail_url) ? data.thumbnail_url : null
      };
    } catch (e) { return { title: null, thumbnailUrl: null }; }
  }

  // ========== Navigation ==========
  const openSubjects = new Set(), openChapters = new Set();
  let activeDropdown = null, _dropdownBackdrop = null;
  let _justPoppedKey = null, _justCompletedDay = null;
  let _addTaskRecurring = false;
  let calendarViewDate = new Date();
  let _selectedCalDate = null;
  let _currentTab = 'home';

  function switchTab(tab) {
    if (focusLocked && !focusMultitaskMode && focusRunning && tab !== 'focus') {
      if (!confirm('Lock Mode is on and timer is running. Leave Focus tab?')) return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const view = document.getElementById('view-' + tab); if (view) view.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`); if (btn) btn.classList.add('active');
    document.body.className = 'tab-' + tab;
    _currentTab = tab;
    closeDropdown();
    // Show/hide mini timer bubble
    updateMiniTimer();
  }
  function closeDropdown() {
    if (activeDropdown)   { activeDropdown.remove();   activeDropdown   = null; }
    if (_dropdownBackdrop){ _dropdownBackdrop.remove(); _dropdownBackdrop = null; }
  }

  // Shared fixed-position menu builder with smart edge detection
  function showMenu(btn, innerHTML) {
    closeDropdown();
    const d = document.createElement('div');
    d.className = 'dropdown';
    d.innerHTML = innerHTML;

    // Position via fixed so it escapes any overflow:hidden ancestor
    const rect   = btn.getBoundingClientRect();
    const menuW  = 216;
    const gap    = 5;

    // Horizontal: right-align to button, clamp within viewport
    let left = rect.right - menuW;
    if (left < 8)                              left = 8;
    if (left + menuW > window.innerWidth - 8)  left = window.innerWidth - menuW - 8;
    d.style.cssText = `position:fixed;z-index:9999;left:${left}px;min-width:${menuW}px`;

    // Vertical: open upward if more room above than below
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 200 && spaceAbove > spaceBelow) {
      d.style.bottom         = (window.innerHeight - rect.top + gap) + 'px';
      d.style.transformOrigin = 'bottom right';
      d.dataset.openUp       = '1';
    } else {
      d.style.top            = (rect.bottom + gap) + 'px';
      d.style.transformOrigin = 'top right';
    }

    // Invisible full-screen backdrop — tap anywhere to close
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;z-index:9998;-webkit-tap-highlight-color:transparent';
    bd.addEventListener('pointerdown', closeDropdown, { once: true });

    document.body.appendChild(bd);
    document.body.appendChild(d);
    activeDropdown    = d;
    _dropdownBackdrop = bd;
  }

  // ========== Render All ==========
  // Only renders the currently visible tab to prevent CPU waste.
  function _renderOneTab(tab) {
    if (tab === 'home')           renderHome();
    else if (tab === 'dashboard') renderDashboard();
    else if (tab === 'syllabus')  renderSyllabus();
    else if (tab === 'stats')     renderStats();
    else if (tab === 'social')    renderSocial();
    else if (tab === 'shop')      renderShop();
    // 'focus' is handled separately by renderFocus()
  }
  function renderAll() {
    _renderOneTab(_currentTab);
  }

  // ========== Home ==========
  function progressRingSVG(pct) {
    const r = 55, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return `<svg class="ring-svg" viewBox="0 0 130 130" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#38bdf8"/><stop offset="55%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#f472b6"/></linearGradient></defs><circle class="ring-track" cx="65" cy="65" r="${r}"/><circle class="ring-fill" cx="65" cy="65" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/></svg>`;
  }
  function renderConfettiBurst() {
    const colors = ['#38bdf8', '#a78bfa', '#f472b6', '#facc15', '#34d399', '#fb7185']; let p = '';
    for (let i = 0; i < 16; i++) { const w = 5 + Math.floor(Math.random() * 5); p += `<i style="left:${Math.random()*100}%;background:${colors[i%colors.length]};width:${w}px;height:${w*1.6}px;animation-delay:${(Math.random()*0.25).toFixed(2)}s;animation-duration:${(1+Math.random()*0.8).toFixed(2)}s"></i>`; }
    return `<div class="confetti" aria-hidden="true">${p}</div>`;
  }
  // ── Mini task-ring SVG (Apple Watch style) for bento card ──
  function miniTaskRingSVG(done, total) {
    const r = 22, c = 2 * Math.PI * r;
    const off = c * (1 - (total > 0 ? done / total : 0));
    return `<svg class="bento-ring-svg" viewBox="0 0 52 52" aria-hidden="true" style="transform:rotate(-90deg)"><circle cx="26" cy="26" r="${r}" fill="none" stroke="rgba(244,114,182,0.14)" stroke-width="4.5"/><circle cx="26" cy="26" r="${r}" fill="none" stroke="#f472b6" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" style="filter:drop-shadow(0 0 5px rgba(244,114,182,0.65));transition:stroke-dashoffset 0.9s cubic-bezier(0.2,0.8,0.2,1)"/></svg>`;
  }

  // ── 3-column Study Analytics Bento Grid ──
  function renderBentoGrid() {
    const exam = nextExam();
    const overall = overallProgress();
    const planTasks = getActivePlanTasks();
    const doneCount = planTasks.filter(t => t.done).length;
    const totalCount = planTasks.length;
    const examDays = exam ? daysUntil(exam.date) : null;
    const urgent = exam && examDays !== null && examDays <= 7 && examDays >= 0;
    // Bar drains from 100% (90+ days) → 0% (exam day)
    const examBarPct = exam && examDays !== null ? Math.max(0, Math.min(100, Math.round((examDays / 90) * 100))) : 0;
    const examBarColor = urgent
      ? 'background:linear-gradient(90deg,#f87171,#fbbf24)'
      : 'background:linear-gradient(90deg,#22d3ee,#67e8f9)';
    const taskPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    const examCard = exam
      ? `<article class="bento-card bento-exam${urgent ? ' bento-urgent' : ''}" data-act="edit-exam" data-id="${exam.id}" role="button" tabindex="0">
          <div class="bento-eyebrow"><span class="bento-dot bento-dot-cyan"></span>NEXT EXAM</div>
          <div class="bento-big" style="color:${urgent?'#f87171':'#22d3ee'}">${examDays !== null ? examDays : '—'}<span class="bento-unit">d</span></div>
          <div class="bento-name">${escapeHTML(exam.name)}</div>
          <div class="bento-spacer"></div>
          <div class="bento-bar-track"><div class="bento-bar-fill" style="width:${examBarPct}%;${examBarColor}"></div></div>
          <div class="bento-foot">${examBarPct}% time left</div>
        </article>`
      : `<article class="bento-card bento-exam" data-act="add-exam" role="button" tabindex="0" style="justify-content:center;align-items:center;text-align:center;gap:6px">
          <div class="bento-eyebrow" style="justify-content:center"><span class="bento-dot bento-dot-cyan"></span>NEXT EXAM</div>
          <div style="font-size:22px;color:#22d3ee;font-weight:900;line-height:1">No Exam</div>
          <div class="bento-foot">Tap to add →</div>
        </article>`;

    const tasksCard = `<article class="bento-card bento-tasks" data-act="open-dashboard" role="button" tabindex="0" style="align-items:center;text-align:center">
      <div class="bento-eyebrow"><span class="bento-dot bento-dot-pink"></span>TODAY</div>
      <div class="bento-ring-wrap">
        ${miniTaskRingSVG(doneCount, totalCount)}
        <div class="bento-ring-label">
          <div class="bento-ring-num">${doneCount}<span class="bento-ring-denom">/${totalCount}</span></div>
          <div class="bento-ring-sub">done</div>
        </div>
      </div>
      <div class="bento-foot">${taskPct}% complete</div>
    </article>`;

    const syllabusCard = `<article class="bento-card bento-syllabus" data-act="open-syllabus" role="button" tabindex="0">
      <div class="bento-eyebrow"><span class="bento-dot bento-dot-lime"></span>MASTERY</div>
      <div class="bento-big" style="color:#a3e635">${overall}<span class="bento-unit">%</span></div>
      <div class="bento-name">syllabus done</div>
      <div class="bento-spacer"></div>
      <div class="bento-bar-track"><div class="bento-bar-fill" style="width:${overall}%;background:linear-gradient(90deg,#a3e635,#84cc16)"></div></div>
      <div class="bento-foot">${state.streak.count} day streak 🔥</div>
    </article>`;

    return `<div class="bento-grid">${examCard}${tasksCard}${syllabusCard}</div>`;
  }

  function renderHome() {
    const view = document.getElementById('view-home'); if (!view) return;
    const overall = overallProgress();
    const tasks = getActivePlanTasks(), doneCount = tasks.filter(t => t.done).length, totalCount = tasks.length;
    const allDone = totalCount > 0 && doneCount === totalCount;
    const achievedBadge = allDone ? `<div class="daily-achieved" role="status">${_justCompletedDay === todayKey() ? renderConfettiBurst() : ''}<span class="da-glyph">🏆</span><div><div class="da-title">Daily Goal Achieved!</div><div class="da-sub">All ${totalCount} task${totalCount === 1 ? '' : 's'} done!</div></div></div>` : '';
    const motivationMsg = getRotatingQuote();
    const profName    = state.profile.name    || '';
    const profTagline = state.profile.tagline || '';
    const profInitial = profName ? profName.trim().charAt(0).toUpperCase() : '?';
    const profAvatarHTML = state.profile.avatarDataUrl
      ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="home-profile-avatar home-profile-avatar--img" alt="Avatar"/>`
      : `<div class="home-profile-avatar">${profInitial}</div>`;
    const nameHtml    = profName
      ? `<div class="home-profile-name">${escapeHTML(profName)}</div>`
      : `<div class="home-profile-name home-profile-name--empty" style="opacity:.55;font-style:italic;font-size:14px">Tap to set name</div>`;
    const taglineHtml = profTagline
      ? `<div class="home-profile-sub">${escapeHTML(profTagline)}</div>`
      : '';
    const _lvInfo = gamificationManager.calculateLevel((state.xp && state.xp.total) || 0);
    const tasksHtml = totalCount === 0
      ? `<div class="empty" style="text-align:center;padding:28px 16px 8px">No tasks for today — head to Dashboard to build your plan.</div>`
      : renderTasksList(tasks);
    const _totalFocusMin = Object.values((state.focusStats && state.focusStats.minutesByDate) || {}).reduce((a, b) => a + b, 0);
    const _rankInfo = calculateRank(_totalFocusMin / 60 + (state.rankTestHours || 0)) || {};
    const _streakCount = state.streak.count || 0;
    view.innerHTML = `<div class="home-profile" data-act="open-settings" role="button" tabindex="0" style="cursor:pointer" title="Edit profile">${profAvatarHTML}<div class="home-profile-info">${nameHtml}${taglineHtml}</div><span class="home-profile-greeting">${greeting()} 👋</span></div><div class="home-moti-card"><span class="home-moti-icon">💡</span><p class="home-moti-text" id="home-moti-text">${escapeHTML(motivationMsg)}</p></div><div class="home-xp-board"><div class="xp-board-header"><span class="xp-board-eyebrow">⚡ STATS BOARD</span><span class="xp-board-rank-pill">${escapeHTML(_rankInfo.label || 'Seeker')}</span></div><div class="xp-board-body"><div class="xp-board-level-wrap"><span class="xp-board-lv-label">LEVEL</span><span class="xp-board-lv-num">${_lvInfo.level}</span></div><div class="xp-board-bar-col"><div class="xp-board-bar-track"><div class="xp-board-bar-fill" style="width:${_lvInfo.percent}%;${_lvInfo.percent>0?'min-width:4px':''}"></div></div><div class="xp-board-bar-label"><span>${_lvInfo.currentLevelXP} XP earned</span><span>${_lvInfo.nextLevelXP} XP next</span></div></div><div class="xp-board-streak-wrap"><span class="xp-board-streak-num">${_streakCount}</span><span class="xp-board-streak-label">🔥 streak</span></div></div></div>${renderBentoGrid()}${achievedBadge}<div class="section-head"><h2>Today's Tasks</h2><button class="btn-link" data-act="open-dashboard">+ Add tasks ›</button></div>${tasksHtml}`;
    if (_justPoppedKey) requestAnimationFrame(() => { _justPoppedKey = null; });
    if (_justCompletedDay) setTimeout(() => { _justCompletedDay = null; }, 1800);
  }
  function renderTasksList(tasks) {
    if (!tasks.length) return `<div class="empty">No tasks for today — add some below.</div>`;
    return `<div class="list">${tasks.map(t => {
      const dataAttrs = t.type === 'auto' ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"` : `data-type="custom" data-id="${t.id}"`;
      const removeAttrs = t.type === 'custom' ? `data-type="custom" data-id="${t.id}" data-rid="${t.recurringId || ''}"` : dataAttrs;
      const popped = _justPoppedKey === (t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`) ? 'just-popped' : '';
      const rolloverBadge = t.rolledOver ? `<span style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);vertical-align:middle;letter-spacing:0.03em">↩ yesterday</span>` : '';
      const recurringBadge = t.recurringId ? `<span class="task-recurring-badge">↻ Daily</span>` : '';
      return `<div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-plan-task" ${dataAttrs}/><span class="color-dot" style="background:${t.color}"></span><div style="flex:1;min-width:0"><div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}${rolloverBadge}${recurringBadge}</div><div class="meta">${escapeHTML(t.meta)}</div></div><button class="menu-btn" data-act="remove-plan-task" ${removeAttrs}>${ic('trash')}</button></div>`;
    }).join('')}</div>`;
  }
  function renderPlanAdder() {
    const subjOptions = state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    const recurringHint = _addTaskRecurring ? `<div class="plan-recurring-hint">↻ This task will repeat every day</div>` : '';
    return `<div class="plan-add-card"><div class="plan-add-title">Add to Today's Plan</div><div class="plan-add-grid"><select class="plan-sel" id="plan-pick-sub"><option value="">Subject…</option>${subjOptions}</select><select class="plan-sel" id="plan-pick-ch" disabled><option value="">Chapter…</option></select><select class="plan-sel" id="plan-pick-t" disabled><option value="">Topic (optional)…</option></select></div><div class="plan-add-actions"><button class="btn btn-block" data-act="add-plan-from-syllabus">${ic('plus')} Add from Syllabus</button></div><div class="plan-add-divider"><span>or custom task</span></div><div class="row" style="gap:7px;margin-top:4px"><input id="plan-new-task" placeholder="Custom task for today…" maxlength="120" style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:10px 11px;border-radius:9px;font:inherit;font-size:14px"/><button class="plan-recurring-toggle${_addTaskRecurring ? ' active' : ''}" id="plan-recurring-btn" data-act="toggle-add-recurring" title="Make this task repeat every day">↻</button><button class="btn" data-act="add-plan-task">${ic('plus')}</button></div>${recurringHint}</div>`;
  }

  // ========== Dashboard ==========
  function renderRevisionZone() {
    const dueItems = dueRevisionItems(), upcoming = upcomingRevisionItems(8);
    const dueHtml = !dueItems.length
      ? `<div class="empty">No revisions due — great work!</div>`
      : `<div class="list">${dueItems.map(item => `<div class="card card-row revision-item is-overdue"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px">${item.daysOverdue > 0 ? `<span class="pill pill-overdue">${item.daysOverdue}d overdue</span>` : `<span class="pill pill-today">Due today</span>`}</div></div><div style="display:flex;gap:6px"><button class="btn btn-sm" data-act="rev-done" data-rev="${item.revisionId}" data-off="${item.step.offset}">${ic('check')}</button><button class="menu-btn" data-act="rev-dismiss" data-rev="${item.revisionId}">${ic('trash')}</button></div></div>`).join('')}</div>`;
    const upcomingHtml = !upcoming.length
      ? `<div class="empty">No upcoming revisions scheduled.</div>`
      : `<div class="list">${upcoming.map(item => `<div class="card card-row revision-item upcoming"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px"><span class="pill pill-upcoming">In ${item.daysUntil}d · ${formatDate(item.step.dueDate)}</span></div></div></div>`).join('')}</div>`;
    return `<div class="section-head" style="margin-top:20px"><h2>Revision Zone</h2>${dueItems.length ? `<span class="muted">${dueItems.length} due</span>` : ''}</div><div class="section-head" style="margin-top:12px"><h3 style="font-size:13px;font-weight:600;color:var(--text-muted)">Due Today${dueItems.length ? ` (${dueItems.length})` : ''}</h3></div>${dueHtml}<div class="section-head" style="margin-top:12px"><h3 style="font-size:13px;font-weight:600;color:var(--text-muted)">Upcoming</h3></div>${upcomingHtml}`;
  }

  function renderDashboard() {
    const view = document.getElementById('view-dashboard'); if (!view) return;
    try {
      const tasks = getActivePlanTasks(), doneCount = tasks.filter(t => t.done).length;
      const _bB    = _safe(renderBurnoutBanner, '');
      const _tlist = _safe(() => renderTasksList(tasks), '');
      const _padd  = _safe(renderPlanAdder, '');
      const _cal   = _safe(renderCalendar, '<div class="empty">Calendar unavailable</div>');
      const _goals = _safe(renderGoals, '');
      const _sugg  = _safe(renderSmartSuggestions, '');
      const _weak  = _safe(renderWeakAreas, '');
      const _rev   = _safe(renderRevisionZone, '');
      view.innerHTML = `<div class="page-header"><h1>Dashboard</h1><div class="subtitle">Your study control center</div></div>${_bB}<div class="section-head"><h2>Today's Plan</h2><div style="display:flex;gap:8px;align-items:center"><span class="muted" style="font-size:13px">${doneCount}/${tasks.length} done</span><button class="btn-link" data-act="regen-plan">↻ Regen</button></div></div>${_tlist}${_padd}<div class="section-head" style="margin-top:20px"><h2>Study Calendar</h2></div>${_cal}${_goals}${_sugg}${_weak}${_rev}`;
      bindPlanPickers();
    } catch (err) {
      console.error('[Dashboard] render failed:', err);
      view.innerHTML = '<div class="page-header"><h1>Dashboard</h1></div><div class="empty" style="margin-top:40px;text-align:center"><div style="font-size:32px">⚠️</div><div style="margin:10px 0">Dashboard could not load.<br>Your data is safe.</div><button class="btn" style="margin-top:12px" onclick="location.reload()">Reload App</button></div>';
    }
  }

  // Goals
  function subjectChapterProgress(subId) { const s = findSubject(subId); if (!s) return { done: 0, total: 0, percent: 0 }; let total = 0, done = 0; for (const c of s.chapters) { total++; if (isChapterEffectivelyDone(c)) done++; } return { done, total, percent: total ? Math.round((done/total)*100) : 0 }; }
  function goalProgress(g) {
    const prog = g.subjectId ? subjectChapterProgress(g.subjectId) : (() => { let total = 0, done = 0; for (const s of state.subjects) for (const c of s.chapters) { total++; if (isChapterEffectivelyDone(c)) done++; } return { done, total, percent: total ? Math.round((done/total)*100) : 0 }; })();
    const totalDays = g.durationDays, elapsed = Math.min(totalDays, daysFromStart(g.startDate));
    const signedLeft = signedDaysUntil(g.targetDate), daysLeft = Math.max(0, signedLeft), overdueBy = signedLeft < 0 ? -signedLeft : 0;
    const isComplete = prog.total > 0 && prog.done >= prog.total, isOverdue = !isComplete && signedLeft < 0;
    const expectedPercent = totalDays > 0 ? Math.min(100, Math.round((elapsed/totalDays)*100)) : 0;
    return { ...prog, totalDays, elapsed, daysLeft, overdueBy, isComplete, isOverdue, expectedPercent };
  }
  function checkGoalCompletions() {
    let changed = false;
    for (const g of state.goals || []) { const p = goalProgress(g); if (p.isComplete && !g.completedAt) { g.completedAt = todayKey(); changed = true; setTimeout(() => toast(`Goal reached: ${goalDisplayName(g)} 🎯`, 'success'), 100); } else if (!p.isComplete && g.completedAt) { g.completedAt = null; changed = true; } }
    if (changed) saveState();
  }
  function goalDisplayName(g) { if (g.name && g.name.trim()) return g.name.trim(); const sub = g.subjectId ? findSubject(g.subjectId) : null; return `Finish ${sub ? sub.name : 'All subjects'} in ${g.durationDays}d`; }
  function renderGoals() {
    checkGoalCompletions(); const goals = state.goals || [];
    if (!goals.length) return `<div class="section-head"><h2>Goals</h2><button class="btn-link" data-act="add-goal">+ Add Goal</button></div><div class="empty-goals"><div style="font-size:28px;margin-bottom:6px">🎯</div><div>No goals yet.</div><button class="btn" style="margin-top:10px" data-act="add-goal">${ic('plus')} Add first goal</button></div>`;
    const decorated = goals.map(g => ({ g, p: goalProgress(g) })).sort((a, b) => (a.p.isComplete ? 1 : -1) - (b.p.isComplete ? 1 : -1));
    return `<div class="section-head"><h2>Goals</h2><button class="btn-link" data-act="add-goal">+ Add Goal</button></div><div class="goal-list">${decorated.map(({ g, p }) => {
      const sub = g.subjectId ? findSubject(g.subjectId) : null;
      const subColor = sub ? sub.color : 'var(--primary)';
      let statusLabel, statusClass;
      if (p.isComplete) { statusLabel = 'Completed'; statusClass = 'goal-status-done'; }
      else if (p.isOverdue) { statusLabel = `Overdue ${p.overdueBy}d`; statusClass = 'goal-status-overdue'; }
      else if (p.daysLeft === 0) { statusLabel = 'Due today'; statusClass = 'goal-status-today'; }
      else { statusLabel = `${p.daysLeft}d left`; statusClass = 'goal-status-active'; }
      const diff = p.percent - p.expectedPercent;
      const paceLabel = !p.isComplete && p.total > 0 ? (diff >= 5 ? `<span class="goal-pace ahead">▲ ${diff}% ahead</span>` : diff <= -5 ? `<span class="goal-pace behind">▼ ${-diff}% behind</span>` : `<span class="goal-pace ontrack">● on pace</span>`) : '';
      return `<div class="card goal-card ${p.isComplete ? 'is-complete' : ''}"><span class="goal-color-bar" style="background:${subColor}"></span><div class="goal-header"><div class="goal-title">${escapeHTML(goalDisplayName(g))}</div><button class="menu-btn" data-act="edit-goal" data-id="${g.id}">${ic('edit')}</button></div><div class="goal-pills"><span class="goal-pill" style="background:${subColor}22;color:${subColor}">📚 ${escapeHTML(sub ? sub.name : 'All subjects')}</span><span class="goal-pill goal-pill-status ${statusClass}">${escapeHTML(statusLabel)}</span>${paceLabel}</div><div class="goal-progress-row"><div><span class="goal-percent">${p.percent}%</span><span style="font-size:11px;color:var(--text-muted);margin-left:5px">${p.done}/${p.total} ch</span></div><div style="font-size:11px;color:var(--text-muted)">Day ${p.elapsed}/${p.totalDays}</div></div><div class="progress ${p.isComplete ? 'progress-done' : p.isOverdue ? 'progress-overdue' : ''} goal-progress"><span style="width:${p.percent}%"></span></div><div class="goal-meta">${formatDate(g.startDate)} → ${formatDate(g.targetDate)}</div></div>`;
    }).join('')}</div>`;
  }
  function modalAddGoal(existing) {
    const subjOpts = ['<option value="">All subjects</option>'].concat(state.subjects.map(s => `<option value="${s.id}" ${existing && existing.subjectId === s.id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`)).join('');
    const curDur = existing ? existing.durationDays : 20;
    const presets = [7, 14, 20, 30, 60, 90].map(d => `<button type="button" class="chip-pick" data-dur="${d}" ${d === curDur ? 'data-active="1"' : ''}>${d}d</button>`).join('');
    openModal(`<h3>${existing ? 'Edit Goal' : 'New Goal'}</h3><div class="field"><label>Goal name (optional)</label><input id="m-name" placeholder="e.g. Finish Math before exam" value="${existing ? escapeHTML(existing.name || '') : ''}" maxlength="60"/></div><div class="field"><label>Subject</label><select id="m-subject">${subjOpts}</select></div><div class="field"><label>Duration (days)</label><input id="m-duration" type="number" min="1" max="365" value="${curDur}"/><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${presets}</div></div><div class="field"><label>Start date</label><input id="m-start" type="date" value="${existing ? existing.startDate : todayKey()}"/></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Goal'}</button></div>`,
      root => {
        root.querySelectorAll('.chip-pick').forEach(chip => { chip.onclick = () => { root.querySelector('#m-duration').value = chip.dataset.dur; root.querySelectorAll('.chip-pick').forEach(c => c.removeAttribute('data-active')); chip.setAttribute('data-active', '1'); }; });
        root.querySelector('#m-save').onclick = () => {
          const name = root.querySelector('#m-name').value.trim(), subjectId = root.querySelector('#m-subject').value || null;
          const duration = parseInt(root.querySelector('#m-duration').value, 10), startDate = root.querySelector('#m-start').value || todayKey();
          if (!duration || duration < 1 || duration > 365) { toast('Duration must be 1–365 days', 'warn'); return; }
          const targetDate = addDaysISO(startDate, duration);
          if (existing) { Object.assign(existing, { name, subjectId, durationDays: duration, startDate, targetDate }); existing.completedAt = null; }
          else state.goals.push({ id: uid(), name, subjectId, durationDays: duration, startDate, targetDate, createdAt: todayKey(), completedAt: null });
          checkGoalCompletions(); saveState(); closeModal(); renderAll(); toast(existing ? 'Goal updated' : 'Goal added', 'success');
        };
        const delBtn = root.querySelector('#m-del');
        if (delBtn) delBtn.onclick = () => { state.goals = state.goals.filter(g => g.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Goal deleted', 'danger'); };
      });
  }

  // Smart Suggestions
  function getSmartSuggestions(limit = 4) {
    const out = [], seen = new Set();
    for (const item of dueRevisionItems()) {
      if (out.length >= limit) break; const k = `${item.sub.id}:${item.ch.id}:${item.topic.id}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ type: 'revision', key: k, sub: item.sub, ch: item.ch, topic: item.topic, label: 'Revise ' + item.ch.name, meta: item.daysOverdue > 0 ? `${item.daysOverdue}d overdue · ${item.sub.name}` : `Due today · ${item.sub.name}`, action: { kind: 'revision', revisionId: item.revisionId, offset: item.step.offset, subId: item.sub.id, chId: item.ch.id, tId: item.topic.id } });
    }
    for (const w of getWeakTopics()) {
      if (out.length >= limit) break; const k = `${w.sub.id}:${w.ch.id}:${w.topic.id}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ type: 'weak', key: k, sub: w.sub, ch: w.ch, topic: w.topic, label: 'Study ' + w.topic.name, meta: w.reason + ' · ' + w.sub.name, action: { kind: 'topic', subId: w.sub.id, chId: w.ch.id, tId: w.topic.id } });
    }
    if (out.length < limit) {
      const today = todayKey(); const buckets = { today: [], high: [], rest: [] };
      for (const sub of state.subjects) for (const ch of sub.chapters) { if (isChapterEffectivelyDone(ch)) continue; for (const t of ch.topics) { if (t.done) continue; const k = `${sub.id}:${ch.id}:${t.id}`; if (seen.has(k)) continue; const item = { sub, ch, topic: t, key: k }; if (ch.scheduledDate === today) { item.reason = 'Scheduled today'; buckets.today.push(item); } else if (ch.priority === 'high') { item.reason = 'High priority'; buckets.high.push(item); } else { item.reason = 'In progress'; buckets.rest.push(item); } } }
      for (const it of [...buckets.today, ...buckets.high, ...buckets.rest]) { if (out.length >= limit) break; seen.add(it.key); out.push({ type: 'incomplete', key: it.key, sub: it.sub, ch: it.ch, topic: it.topic, label: 'Continue ' + it.topic.name, meta: it.reason + ' · ' + it.sub.name, action: { kind: 'topic', subId: it.sub.id, chId: it.ch.id, tId: it.topic.id } }); }
    }
    return out;
  }
  function renderSmartSuggestions() {
    const items = getSmartSuggestions();
    if (!items.length) return `<div class="suggestion-card empty-suggestion"><div class="suggestion-card-header"><span class="suggestion-card-icon">💡</span><h3>Smart Suggestions</h3></div><div class="empty">All caught up!</div></div>`;
    const tm = { revision: { icon: '🔁', tag: 'Revision due' }, weak: { icon: '⚠️', tag: 'Weak topic' }, incomplete: { icon: '📘', tag: 'Continue' } };
    return `<div class="suggestion-card"><div class="suggestion-card-header"><span class="suggestion-card-icon">💡</span><h3>Smart Suggestions</h3><span class="suggestion-card-sub">Auto-updated</span></div><div class="suggestion-list">${items.map(s => { const meta = tm[s.type] || tm.incomplete; const isRev = s.action.kind === 'revision'; const doneAttrs = isRev ? `data-act="suggest-rev-done" data-rev="${s.action.revisionId}" data-off="${s.action.offset}"` : `data-act="suggest-topic-done" data-sub="${s.action.subId}" data-ch="${s.action.chId}" data-t="${s.action.tId}"`; return `<div class="suggestion-item"><span class="suggestion-color-bar" style="background:${s.sub.color||'var(--primary)'}"></span><div class="suggestion-icon">${meta.icon}</div><div class="suggestion-body"><div class="suggestion-tag">${meta.tag}</div><div class="suggestion-text">${escapeHTML(s.label)}</div><div class="suggestion-meta">${escapeHTML(s.meta)}</div></div><div class="suggestion-actions"><button class="btn btn-ghost btn-sm" data-act="suggest-open" data-sub="${s.sub.id}" data-ch="${s.ch.id}">Open</button><button class="btn btn-sm" ${doneAttrs}>${ic('check')}</button></div></div>`; }).join('')}</div></div>`;
  }
  function renderWeakAreas() {
    const weak = getWeakTopics();
    return `<div class="section-head"><h2>Weak Areas</h2>${weak.length ? `<span class="muted">${weak.length} flagged</span>` : ''}</div>${weak.length ? `<div class="list">${weak.map(w => `<div class="card" style="padding:11px 13px"><div class="row" style="align-items:flex-start"><div style="font-size:18px">⚠️</div><div style="flex:1;min-width:0"><div class="title">${escapeHTML(w.topic.name)}</div><div class="meta">${escapeHTML(w.sub.name)} · ${escapeHTML(w.ch.name)}</div><div style="display:flex;gap:4px;margin-top:5px">${(w.skips>=WEAK_SKIP_THRESHOLD)?`<span class="pill pill-weak">Skip ×${w.skips}</span>`:''} ${(w.age>=WEAK_AGE_DAYS)?`<span class="pill pill-stale">${w.age}d</span>`:''}</div></div><div style="display:flex;gap:4px"><button class="menu-btn" data-act="weak-mark-done" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}">${ic('check')}</button><button class="menu-btn" data-act="weak-reset" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}">${ic('refresh')}</button></div></div></div>`).join('')}</div>` : `<div class="empty">No weak topics — keep it up!</div>`}`;
  }

  // ========== Calendar ==========
  // Returns total and done task counts for any given day (auto + custom)
  function getDayPlanStatus(dateISO) {
    const plan = state.dailyPlans[dateISO];
    if (!plan) return { total: 0, done: 0 };
    let total = 0, done = 0;
    for (const a of plan.auto || []) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if ((plan.removed || []).includes(key)) continue;
      const t = findTopic(a.subId, a.chId, a.tId);
      if (!t) continue;
      total++;
      if (t.done) done++;
    }
    for (const c of plan.custom || []) {
      total++;
      if (c.done) done++;
    }
    return { total, done };
  }

  function renderCalendar() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const today = todayKey();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7;
    const monthLabel = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dowLabels = ['Mo','Tu','We','Th','Fr','Sa','Su'];
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateISO = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateISO === today;
      const isPast = dateISO < today;
      const isFuture = dateISO > today;
      const { total, done } = getDayPlanStatus(dateISO);
      const allDone = total > 0 && done === total;
      const incomplete = total > 0 && !allDone;

      // Cell colour class — green if all done, red if had tasks but not all done (past only)
      let colourClass = '';
      if (!isFuture && total > 0) {
        colourClass = allDone ? ' cal-completed' : (isPast ? ' cal-incomplete' : '');
      }

      // Small dot for today showing progress (green/amber)
      const dotHtml = isToday && total > 0
        ? `<span class="cal-dot${allDone ? ' cal-dot-done' : ''}"></span>`
        : '';

      const ariaLabel = `${dateISO}${total ? `, ${done}/${total} tasks` : ''}`;
      const isSelected = dateISO === _selectedCalDate;
      cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast && !isToday ? ' cal-past' : ''}${colourClass}${isSelected ? ' cal-selected' : ''}" data-act="calendar-day" data-date="${dateISO}" role="button" aria-label="${ariaLabel}"><span class="cal-day-num">${d}</span>${dotHtml}</div>`;
    }
    return `<div class="cal-wrap"><div class="cal-nav"><button class="cal-nav-btn" data-act="cal-prev" aria-label="Previous month">‹</button><span class="cal-title">${monthLabel}</span><button class="cal-nav-btn" data-act="cal-next" aria-label="Next month">›</button></div><div class="cal-body"><div class="cal-dow-row">${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div><div class="cal-cells">${cells}</div></div></div>`;
  }

  function modalCalendarDay(dateISO) {
    const today = todayKey();
    const isFuture = dateISO > today;
    const isToday = dateISO === today;

    // Highlight selected date on calendar
    _selectedCalDate = dateISO;
    document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('cal-selected'));
    const calCell = document.querySelector(`.cal-cell[data-date="${dateISO}"]`);
    if (calCell) calCell.classList.add('cal-selected');

    // Date label
    const dateObj = new Date(dateISO + 'T00:00:00');
    const label = isToday
      ? 'Today'
      : dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // Plan data
    if (!state.dailyPlans[dateISO]) state.dailyPlans[dateISO] = { auto: [], removed: [], custom: [], generated: false };
    const plan = state.dailyPlans[dateISO];

    // Build tasks list (auto + custom, tracking custom index for delete)
    const allTasks = [];
    for (const a of plan.auto || []) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if ((plan.removed || []).includes(key)) continue;
      const sub = findSubject(a.subId), ch = findChapter(a.subId, a.chId), t = findTopic(a.subId, a.chId, a.tId);
      if (!sub || !ch || !t) continue;
      allTasks.push({ type: 'auto', text: t.name, meta: `${sub.name} · ${ch.name}`, color: sub.color, done: !!t.done });
    }
    let _ci = 0;
    for (const c of plan.custom || []) {
      const ci = _ci++;
      allTasks.push({ type: 'custom', text: c.text, meta: c.recurringId ? 'Daily recurring task' : c.rolledOver ? 'Rolled over from yesterday' : 'Custom task', color: '#94a3b8', done: !!c.done, _customIdx: ci });
    }

    const totalTasks = allTasks.length;
    const doneTasks = allTasks.filter(t => t.done).length;

    // Analytics
    const focusMin = (state.focusStats.minutesByDate || {})[dateISO] || 0;
    const videoMin = (state.focusStats.videoMinutes || {})[dateISO] || 0;
    const sessions = (state.focusStats.sessions || {})[dateISO] || 0;
    const activityCount = state.activity[dateISO] || 0;
    const xpEarned = focusMin + videoMin;
    const fmtMin = m => {
      if (m <= 0) return '0m';
      const h = Math.floor(m / 60), rem = m % 60;
      return h > 0 ? (rem > 0 ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`;
    };

    const hasData = totalTasks > 0 || focusMin > 0 || videoMin > 0 || activityCount > 0;

    // Motivational quote
    const quotes = (state.motivationQuotes && state.motivationQuotes.length)
      ? state.motivationQuotes
      : ['Consistency is the key to mastery.', 'Every day is a new chance to grow.', 'Small steps lead to big results.'];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];

    // Header status badge
    let statusLabel = '', statusClass = '';
    if (isToday) { statusLabel = 'Today'; statusClass = 'ds-status-today'; }
    else if (isFuture) { statusLabel = 'Upcoming'; statusClass = 'ds-status-future'; }
    else if (totalTasks > 0 && doneTasks === totalTasks) { statusLabel = '✓ All Done'; statusClass = 'ds-status-done'; }
    else if (totalTasks > 0 && doneTasks > 0) { statusLabel = `${doneTasks}/${totalTasks} Done`; statusClass = 'ds-status-partial'; }
    else if (!hasData) { statusLabel = 'No Activity'; statusClass = 'ds-status-empty'; }

    // Task rows
    const taskRowsHtml = allTasks.map(t => {
      const icon = t.type === 'auto' ? '📚' : '✏️';
      const badge = t.done
        ? `<span class="ds-badge ds-badge-done">✓ Done</span>`
        : `<span class="ds-badge ds-badge-pending">Pending</span>`;
      const delBtn = t.type === 'custom'
        ? `<button class="ds-del-btn" data-act="del-cal-task" data-date="${dateISO}" data-i="${t._customIdx}" title="Remove task">${ic('trash')}</button>`
        : '';
      return `<div class="ds-task-row${t.done ? ' ds-task-done' : ''}">
        <span class="ds-task-icon">${icon}</span>
        <div class="ds-task-body">
          <div class="ds-task-text">${escapeHTML(t.text)}</div>
          <div class="ds-task-meta">${escapeHTML(t.meta)}</div>
        </div>
        ${badge}${delBtn}
      </div>`;
    }).join('');

    const emptyTaskHtml = isFuture
      ? `<div class="ds-empty"><div class="ds-empty-icon">🗓️</div><div>No tasks planned yet</div><div class="ds-empty-sub">Add tasks below to plan this day</div></div>`
      : `<div class="ds-empty"><div class="ds-empty-icon">💤</div><div>No tasks recorded</div><div class="ds-empty-sub">"${escapeHTML(quote)}"</div></div>`;

    // Analytics section
    const analyticsHtml = (focusMin > 0 || videoMin > 0 || sessions > 0)
      ? `<div class="ds-section">
          <div class="ds-section-head">📊 Study Analytics</div>
          <div class="ds-analytics-grid">
            ${focusMin > 0 ? `<div class="ds-stat-tile ds-stat-focus"><div class="ds-sv">${fmtMin(focusMin)}</div><div class="ds-sk">Focus Time</div></div>` : ''}
            ${videoMin > 0 ? `<div class="ds-stat-tile ds-stat-video"><div class="ds-sv">${fmtMin(videoMin)}</div><div class="ds-sk">Classroom</div></div>` : ''}
            ${sessions > 0 ? `<div class="ds-stat-tile"><div class="ds-sv">${sessions} 🍅</div><div class="ds-sk">Pomodoros</div></div>` : ''}
            ${xpEarned > 0 ? `<div class="ds-stat-tile ds-stat-xp"><div class="ds-sv">+${xpEarned} ⚡</div><div class="ds-sk">XP Earned</div></div>` : ''}
          </div>
        </div>` : '';

    // Syllabus completed
    const syllabusItems = allTasks.filter(t => t.type === 'auto' && t.done);
    const syllabusHtml = syllabusItems.length
      ? `<div class="ds-section">
          <div class="ds-section-head">✅ Syllabus Progress</div>
          ${syllabusItems.map(t => `<div class="ds-syl-row">
            <span class="ds-syl-dot" style="background:${t.color}"></span>
            <div class="ds-syl-body">
              <div class="ds-syl-text">${escapeHTML(t.text)}</div>
              <div class="ds-syl-meta">${escapeHTML(t.meta)}</div>
            </div>
            <span class="ds-badge ds-badge-done">Done</span>
          </div>`).join('')}
        </div>` : '';

    // Streak & XP summary (only show if there's activity, and only if analytics didn't already show XP)
    const streakHtml = (!isFuture && (activityCount > 0 || isToday))
      ? `<div class="ds-section">
          <div class="ds-section-head">🔥 Daily XP &amp; Streak</div>
          <div class="ds-analytics-grid">
            <div class="ds-stat-tile ds-stat-xp"><div class="ds-sv">${xpEarned > 0 ? '+' + xpEarned + ' ⚡' : '0 ⚡'}</div><div class="ds-sk">XP Earned</div></div>
            <div class="ds-stat-tile"><div class="ds-sv">${state.streak.count} 🔥</div><div class="ds-sk">Streak</div></div>
            ${activityCount > 0 ? `<div class="ds-stat-tile"><div class="ds-sv">${activityCount}</div><div class="ds-sk">Actions</div></div>` : ''}
          </div>
        </div>` : '';

    // No-activity state for past dates
    const noDataHtml = !hasData && !isFuture
      ? `<div class="ds-no-activity">
          <div class="ds-no-act-emoji">🌙</div>
          <div class="ds-no-act-text">No activity on this day</div>
          <div class="ds-no-act-quote">"${escapeHTML(quote)}"</div>
        </div>` : '';

    openModal(`
      <div class="ds-header">
        <div class="ds-date-label">${escapeHTML(label)}</div>
        ${statusLabel ? `<span class="ds-status ${statusClass}">${statusLabel}</span>` : ''}
      </div>
      ${noDataHtml}
      ${analyticsHtml}
      <div class="ds-section">
        <div class="ds-section-head">
          📋 Task Recap
          ${totalTasks ? `<span class="ds-task-count">${doneTasks}/${totalTasks} completed</span>` : ''}
        </div>
        <div class="ds-task-list">
          ${allTasks.length ? taskRowsHtml : emptyTaskHtml}
        </div>
      </div>
      ${syllabusHtml}
      ${streakHtml}
      <div class="ds-add-row">
        <input id="cal-new-task" placeholder="Add a task for ${isToday ? 'today' : 'this day'}…" maxlength="120"/>
        <button class="btn btn-sm" data-act="add-cal-task" data-date="${dateISO}">${ic('plus')}</button>
      </div>
      <div class="actions" style="margin-top:12px">
        <button class="btn btn-ghost" data-close>Close</button>
        ${isToday ? `<button class="btn" data-act="regen-plan">↻ Regen Plan</button>` : ''}
      </div>
    `, root => {
      const inp = root.querySelector('#cal-new-task');
      if (inp) {
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const btn = root.querySelector('[data-act="add-cal-task"]'); if (btn) btn.click(); } });
      }
    });
  }

  // ========== Syllabus ==========
  function renderSyllabus() {
    const view = document.getElementById('view-syllabus'); if (!view) return;
    const subjects = state.subjects;
    view.innerHTML = `<div class="page-header" style="display:flex;align-items:center;justify-content:space-between"><div><h1>Syllabus</h1><div class="subtitle">${subjects.length} subject${subjects.length !== 1 ? 's' : ''}</div></div><button class="btn" data-act="add-subject">${ic('plus')} Subject</button></div>${!subjects.length ? `<div class="empty">No subjects yet. Add one to get started.</div>` : `<div class="list">${subjects.map(sub => renderSubjectCard(sub)).join('')}</div>`}`;
    bindPlanPickers();
  }
  function renderSubjectCard(sub) {
    const isOpen = openSubjects.has(sub.id);
    const tot = sub.chapters.length, done = sub.chapters.filter(c => isChapterEffectivelyDone(c)).length;
    const pct = tot ? Math.round((done/tot)*100) : 0;
    const pp = sub.priority ? `<span class="pill pill-${sub.priority === 'high' ? 'high' : sub.priority === 'medium' ? 'med' : 'low'}">${sub.priority}</span>` : '';
    return `<div class="card subject-card" data-sub-id="${sub.id}" style="position:relative"><div class="subject-head" data-act="toggle-subject" data-id="${sub.id}"><span class="color-dot" style="background:${sub.color}"></span><span class="subject-name">${escapeHTML(sub.name)}</span>${pp}<span class="muted">${done}/${tot}</span><button class="menu-btn" data-act="open-subject-menu" data-id="${sub.id}" style="z-index:2">${ic('dots')}</button><span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span></div><div class="progress" style="margin-bottom:${isOpen?'7px':'3px'}"><span style="width:${pct}%"></span></div>${sub.notes ? `<div class="notes">${escapeHTML(sub.notes)}</div>` : ''}${isOpen ? `<div class="chapter-list">${sub.chapters.map(ch => renderChapterCard(sub, ch)).join('')}<button class="btn btn-ghost btn-block" style="margin-top:4px" data-act="add-chapter" data-sub="${sub.id}">${ic('plus')} Add Chapter</button></div>` : ''}</div>`;
  }
  function renderChapterCard(sub, ch) {
    const isOpen = openChapters.has(ch.id), isDone = isChapterEffectivelyDone(ch), pct = chapterProgress(ch), today = todayKey();
    const pp = ch.priority ? `<span class="pill pill-${ch.priority === 'high' ? 'high' : ch.priority === 'medium' ? 'med' : 'low'}">${ch.priority}</span>` : '';
    return `<div class="chapter" data-ch-id="${ch.id}" style="position:relative"><div class="chapter-row"><input type="checkbox" class="check" ${isDone ? 'checked' : ''} data-act="toggle-chapter-done" data-sub="${sub.id}" data-ch="${ch.id}"/><div style="flex:1;min-width:0"><div class="row" style="cursor:pointer" data-act="toggle-chapter" data-id="${ch.id}"><span class="name ${isDone ? 'done' : ''}">${escapeHTML(ch.name)}</span><span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span></div><div class="badges">${pp}${ch.scheduledDate === today ? `<span class="pill pill-today">Today</span>` : ''}${pct > 0 && pct < 100 ? `<span class="muted">${pct}%</span>` : ''}</div>${ch.notes ? `<div class="notes">${escapeHTML(ch.notes)}</div>` : ''}</div><button class="menu-btn" data-act="open-chapter-menu" data-sub="${sub.id}" data-ch="${ch.id}">${ic('dots')}</button></div>${isOpen && ch.topics.length ? `<div class="topic-list">${ch.topics.map(t => renderTopicRow(sub, ch, t)).join('')}</div>` : ''}${isOpen ? `<div style="padding-left:26px;margin-top:6px"><button class="btn-link" data-act="add-topic" data-sub="${sub.id}" data-ch="${ch.id}">${ic('plus')} Add Topic</button></div>` : ''}</div>`;
  }
  function renderTopicRow(sub, ch, t) {
    const pp = t.priority ? `<span class="pill pill-${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'med' : 'low'}">${t.priority}</span>` : '';
    return `<div class="topic" style="position:relative"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-topic-done" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}"/><div style="flex:1;min-width:0"><div class="name ${t.done ? 'done' : ''}">${escapeHTML(t.name)}</div>${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>` : ''}${pp || isWeakTopic(t) ? `<div style="display:flex;gap:4px;margin-top:3px">${pp}${isWeakTopic(t) ? `<span class="pill pill-weak">Weak</span>` : ''}</div>` : ''}</div><button class="menu-btn" data-act="open-topic-menu" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}">${ic('dots')}</button></div>`;
  }

  // Syllabus modals
  function makePriorityRow(existing) {
    const cur = existing ? (existing.priority || '') : '';
    return `<div class="priority-row">${['high', 'medium', 'low', ''].map(p => `<button type="button" data-prio="${p}" class="${cur === p ? (p === 'high' ? 'sel-high' : p === 'medium' ? 'sel-med' : 'sel-low') : ''}">${p || 'None'}</button>`).join('')}</div>`;
  }
  function bindPriorityRow(root) {
    let priority = root.querySelector('[data-prio].sel-high, [data-prio].sel-med, [data-prio].sel-low') ? (root.querySelector('[data-prio].sel-high') ? 'high' : root.querySelector('[data-prio].sel-med') ? 'medium' : 'low') : '';
    root.querySelectorAll('[data-prio]').forEach(btn => {
      if (!btn.dataset.prio) priority = '';
      btn.onclick = () => { priority = btn.dataset.prio; root.querySelectorAll('[data-prio]').forEach(b => b.className = ''); btn.className = priority === 'high' ? 'sel-high' : priority === 'medium' ? 'sel-med' : priority === 'low' ? 'sel-low' : ''; };
    });
    return () => priority;
  }
  function modalAddSubject(existing) {
    openModal(`<h3>${existing ? 'Edit Subject' : 'New Subject'}</h3><div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Mathematics" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="60"/></div><div class="field"><label>Color</label><input id="m-color" type="color" value="${existing ? existing.color : '#38bdf8'}" style="width:56px;height:38px;padding:3px;border-radius:8px;border:1px solid var(--border);background:var(--surface);cursor:pointer"/></div><div class="field"><label>Priority</label>${makePriorityRow(existing)}</div><div class="field"><label>Notes</label><textarea id="m-notes" placeholder="Optional notes…" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Subject'}</button></div>`,
      root => {
        const getPrio = bindPriorityRow(root);
        root.querySelector('#m-save').onclick = () => { const name = root.querySelector('#m-name').value.trim(); if (!name) { toast('Name required', 'warn'); return; } const color = root.querySelector('#m-color').value, notes = root.querySelector('#m-notes').value.trim(), priority = getPrio() || null; if (existing) { Object.assign(existing, { name, color, notes, priority }); } else state.subjects.push({ id: uid(), name, color, notes, priority, revisionCount: 0, lastRevisedAt: null, checklist: makeDefaultChecklist(), chapters: [] }); saveState(); closeModal(); renderAll(); toast(existing ? 'Subject updated' : 'Subject added', 'success'); };
        const delBtn = root.querySelector('#m-del'); if (delBtn) delBtn.onclick = () => { confirmModal(`Delete "${existing.name}" and all chapters?`, () => { state.subjects = state.subjects.filter(s => s.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Subject deleted', 'danger'); }); };
      });
  }
  function modalAddChapter(subId, existing) {
    const sub = findSubject(subId); if (!sub) return;
    openModal(`<h3>${existing ? 'Edit Chapter' : 'New Chapter'}</h3><div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Differential Calculus" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="80"/></div><div class="field"><label>Priority</label>${makePriorityRow(existing)}</div><div class="field"><label>Schedule date (optional)</label><input id="m-date" type="date" value="${existing && existing.scheduledDate ? existing.scheduledDate : ''}"/></div><div class="field"><label>Notes</label><textarea id="m-notes" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Chapter'}</button></div>`,
      root => {
        const getPrio = bindPriorityRow(root);
        root.querySelector('#m-save').onclick = () => { const name = root.querySelector('#m-name').value.trim(); if (!name) { toast('Name required', 'warn'); return; } const notes = root.querySelector('#m-notes').value.trim(), scheduledDate = root.querySelector('#m-date').value || null, priority = getPrio() || null; if (existing) { Object.assign(existing, { name, notes, priority, scheduledDate }); } else sub.chapters.push({ id: uid(), name, notes, priority, revisionCount: 0, lastRevisedAt: null, done: false, scheduledDate, checklist: makeDefaultChecklist(), topics: [] }); saveState(); closeModal(); renderAll(); toast(existing ? 'Chapter updated' : 'Chapter added', 'success'); };
        const delBtn = root.querySelector('#m-del'); if (delBtn) delBtn.onclick = () => { confirmModal(`Delete "${existing.name}" and all topics?`, () => { sub.chapters = sub.chapters.filter(c => c.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Chapter deleted', 'danger'); }); };
      });
  }
  function modalAddTopic(subId, chId, existing) {
    const ch = findChapter(subId, chId); if (!ch) return;
    openModal(`<h3>${existing ? 'Edit Topic' : 'New Topic'}</h3><div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Limits" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="80"/></div><div class="field"><label>Priority</label>${makePriorityRow(existing)}</div><div class="field"><label>Notes</label><textarea id="m-notes" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Topic'}</button></div>`,
      root => {
        const getPrio = bindPriorityRow(root);
        root.querySelector('#m-save').onclick = () => { const name = root.querySelector('#m-name').value.trim(); if (!name) { toast('Name required', 'warn'); return; } const notes = root.querySelector('#m-notes').value.trim(), priority = getPrio() || null; if (existing) { Object.assign(existing, { name, notes, priority }); } else ch.topics.push({ id: uid(), name, notes, done: false, priority, revisionCount: 0, lastRevisedAt: null, skipCount: 0, firstSeenAt: todayKey(), lastSkippedAt: null }); saveState(); closeModal(); renderAll(); toast(existing ? 'Topic updated' : 'Topic added', 'success'); };
        const delBtn = root.querySelector('#m-del'); if (delBtn) delBtn.onclick = () => { ch.topics = ch.topics.filter(t => t.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Topic deleted', 'danger'); };
      });
  }

  // ========== 3-Dot Menus (Separate Notes & Priority) ==========
  function showSubjectMenu(subId) {
    const btn = document.querySelector(`[data-act="open-subject-menu"][data-id="${subId}"]`);
    if (!btn) return;
    showMenu(btn, `
      <button data-act="edit-subject" data-id="${subId}">${ic('edit')} Edit Subject</button>
      <button data-act="open-subject-notes" data-id="${subId}">${ic('note')} Notes</button>
      <button data-act="open-subject-priority" data-id="${subId}">${ic('star')} Priority</button>
      <button data-act="add-chapter" data-sub="${subId}">${ic('plus')} Add Chapter</button>
      <button data-act="del-subject" data-id="${subId}" class="danger">${ic('trash')} Delete</button>`);
  }
  function showChapterMenu(subId, chId) {
    const btn = document.querySelector(`[data-act="open-chapter-menu"][data-sub="${subId}"][data-ch="${chId}"]`);
    if (!btn) return;
    showMenu(btn, `
      <button data-act="edit-chapter" data-sub="${subId}" data-ch="${chId}">${ic('edit')} Edit Chapter</button>
      <button data-act="open-chapter-notes" data-sub="${subId}" data-ch="${chId}">${ic('note')} Notes</button>
      <button data-act="open-chapter-priority" data-sub="${subId}" data-ch="${chId}">${ic('star')} Priority</button>
      <button data-act="add-topic" data-sub="${subId}" data-ch="${chId}">${ic('plus')} Add Topic</button>
      <button data-act="schedule-chapter" data-sub="${subId}" data-ch="${chId}">${ic('cal')} Schedule</button>
      <button data-act="del-chapter" data-sub="${subId}" data-ch="${chId}" class="danger">${ic('trash')} Delete</button>`);
  }
  function showTopicMenu(subId, chId, tId) {
    const btn = document.querySelector(`[data-act="open-topic-menu"][data-sub="${subId}"][data-ch="${chId}"][data-t="${tId}"]`);
    if (!btn) return;
    showMenu(btn, `
      <button data-act="edit-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('edit')} Edit Topic</button>
      <button data-act="open-topic-notes" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('note')} Notes</button>
      <button data-act="open-topic-priority" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('star')} Priority</button>
      <button data-act="del-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}" class="danger">${ic('trash')} Delete</button>`);
  }

  function modalQuickNote(obj, label, afterSave) {
    openModal(`<h3>${ic('note')} Notes — ${escapeHTML(label)}</h3>
      <div class="field"><label>Notes</label><textarea id="m-notes" rows="6" maxlength="500" placeholder="Add notes, formulas, key points…">${escapeHTML(obj.notes || '')}</textarea></div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Save Notes</button></div>`,
      root => {
        root.querySelector('#m-save').onclick = () => {
          obj.notes = root.querySelector('#m-notes').value.trim();
          saveState(); closeModal(); afterSave(); toast('Notes saved', 'success');
        };
      });
  }
  function modalQuickPriority(obj, label, afterSave) {
    openModal(`<h3>${ic('star')} Priority — ${escapeHTML(label)}</h3>
      <div class="field"><label>Set Priority</label>${makePriorityRow(obj)}</div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Save Priority</button></div>`,
      root => {
        const getPrio = bindPriorityRow(root);
        root.querySelector('#m-save').onclick = () => {
          obj.priority = getPrio() || null;
          saveState(); closeModal(); afterSave(); toast('Priority updated', 'success');
        };
      });
  }

  // ========== Focus Tab ==========
  function renderFocus() {
    const view = document.getElementById('view-focus'); if (!view) return;
    view.innerHTML = `<div class="page-header"><h1>Focus</h1><div class="subtitle">Pomodoro timer & study materials</div></div><div class="focus-sub-nav"><button class="focus-sub-btn ${focusSubTab === 'timer' ? 'active' : ''}" data-act="focus-subtab" data-stab="timer">⏱ Timer</button><button class="focus-sub-btn ${focusSubTab === 'classroom' ? 'active' : ''}" data-act="focus-subtab" data-stab="classroom">🎓 Classroom</button></div>${focusSubTab === 'timer' ? renderFocusTimer() : renderClassroom()}`;
  }

  function renderFocusTimer() {
    if (!_currentQuote) pickNewQuote();
    const total = customDurations[focusMode] * 60;
    const r = 96, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const isBreak = focusMode !== 'work';
    const tasks = getActivePlanTasks().filter(t => !t.done);
    const taskOptions = tasks.map(t => `<option value="${t.key}" ${focusCurrentTaskKey === t.key ? 'selected' : ''}>${escapeHTML(t.text)}</option>`).join('');
    const currentTask = focusCurrentTaskKey ? tasks.find(t => t.key === focusCurrentTaskKey) : null;
    return `<div class="focus-view">
      <div class="focus-col-left">
        <div class="focus-mode-tabs">
          <button class="focus-mode-btn ${focusMode === 'work' ? 'active' : ''}" data-act="focus-mode" data-mode="work">Work</button>
          <button class="focus-mode-btn ${focusMode === 'short' ? 'active' : ''}" data-act="focus-mode" data-mode="short">Short Break</button>
          <button class="focus-mode-btn ${focusMode === 'long' ? 'active' : ''}" data-act="focus-mode" data-mode="long">Long Break</button>
        </div>
        <div class="focus-mode-edit">
          <div class="focus-mode-edit-item"><label>Work</label><input type="number" min="1" max="120" id="focus-dur-work" value="${customDurations.work}" data-act="focus-dur-change" data-dmode="work"/><span>min</span></div>
          <div class="focus-mode-edit-item"><label>Short</label><input type="number" min="1" max="60" id="focus-dur-short" value="${customDurations.short}" data-act="focus-dur-change" data-dmode="short"/><span>min</span></div>
          <div class="focus-mode-edit-item"><label>Long</label><input type="number" min="1" max="60" id="focus-dur-long" value="${customDurations.long}" data-act="focus-dur-change" data-dmode="long"/><span>min</span></div>
        </div>
        <div class="focus-ring-wrap${focusIntensityMode !== 'none' ? ' intensity-active' : ''}">
          <svg class="focus-ring-svg" viewBox="0 0 220 220" aria-hidden="true">
            <circle class="focus-ring-track" cx="110" cy="110" r="${r}"/>
            <circle class="focus-ring-fill ${isBreak ? 'break-mode' : ''}${focusOvertime ? ' overtime-mode' : ''}" id="focus-ring-circle" cx="110" cy="110" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${focusOvertime ? c.toFixed(2) : off.toFixed(2)}"/>
          </svg>
          <div class="focus-ring-center">
            <div class="focus-ring-time${focusOvertime ? ' fs-overtime-text' : ''}" id="focus-time-display">${focusOvertime ? `+${String(Math.floor(focusOvertimeSeconds/60)).padStart(2,'0')}:${String(focusOvertimeSeconds%60).padStart(2,'0')}` : formatFocusTime(focusSeconds)}</div>
            <div class="focus-ring-mode">${focusOvertime ? '⚠ Overtime' : focusMode === 'work' ? 'Focus Time' : focusMode === 'short' ? 'Short Break' : 'Long Break'}</div>
          </div>
        </div>
        <div class="focus-buttons">
          <button class="btn btn-ghost" data-act="focus-reset">Reset</button>
          <button class="btn${focusOvertime ? ' btn-overtime' : ''}" style="min-width:110px" data-act="focus-toggle">${focusRunning ? '⏸ Pause' : (focusOvertime ? '⏹ End Session' : '▶ Start')}</button>
          <button class="focus-lock-btn ${focusMultitaskMode ? 'multitask' : focusLocked ? 'locked' : ''}" data-act="${focusMultitaskMode ? 'focus-multitask' : 'focus-lock'}">${focusMultitaskMode ? '🗒️ Multitask' : focusLocked ? ic('lock') + ' Locked' : ic('unlock') + ' Lock'}</button>
        </div>
      </div>
      <div class="focus-col-right">
        ${focusRunning && !focusMultitaskMode ? `<button class="focus-multitask-toggle" data-act="focus-multitask">🗒️ Enable Multitask Mode</button>` : ''}
        ${focusMultitaskMode ? `<div class="focus-multitask-card">
          <div class="fmt-card-title">📱 Multitask Mode Active</div>
          <div class="fmt-card-body">Timer keeps running while you use another app. A floating bubble appears on other tabs, and your browser tab title shows the countdown. You'll get a notification when done.</div>
          <div class="fmt-card-tip">💡 Open your notes app freely — this timer won't stop.</div>
        </div>` : ''}
        <div class="focus-task-bar">
          <label>Current Task</label>
          ${currentTask ? `<div class="focus-current-task"><span class="dot"></span>${escapeHTML(currentTask.text)}<button class="btn-link" data-act="focus-task-clear" style="margin-left:auto;font-size:12px">Clear</button></div>` :
            tasks.length ? `<select data-act="focus-task-select"><option value="">— Pick a task —</option>${taskOptions}</select>` :
            `<div style="color:var(--text-muted);font-size:13px">No tasks for today yet.</div>`}
        </div>
        <div class="focus-sessions-info">
          <div class="grid">
            <div><div class="v">${focusSessions}</div><div class="k">Sessions today</div></div>
            <div class="live-focus-today-wrap"><div class="v live-focus-today">${minsToHrs(state.focusStats.minutesByDate[todayKey()] || 0)}</div><div class="k">Focus today</div></div>
          </div>
        </div>
        <div class="ambient-panel">
          <div class="ambient-panel-top">
            ${ambientMode !== 'none' ? `<span class="ambient-now-label">♪ ${escapeHTML(soundById(ambientMode).label)}</span>` : '<span class="ambient-now-label muted">No sound selected</span>'}
            <div class="ambient-vol" style="${ambientMode !== 'none' ? '' : 'visibility:hidden'}">
              <span style="font-size:11px;color:var(--text-muted)">Vol</span>
              <input id="ambient-vol-slider" type="range" min="0" max="1" step="0.05" value="${ambientVolume}"/>
            </div>
          </div>
          <div class="ambient-track-list">
            <button class="ambient-btn ${ambientMode === 'none' ? 'active' : ''}" data-act="ambient-select" data-amode="none">🔇 Off</button>
            ${['Ambient','Focus','Workout','Vibes'].map(cat => {
              const tracks = SOUNDS.filter(s => s.cat === cat);
              return '<span class="ambient-cat-label">' + cat + '</span>' + tracks.map(s => '<button class="ambient-btn ' + (ambientMode === s.id ? 'active' : '') + '" data-act="ambient-select" data-amode="' + s.id + '">' + s.label + '</button>').join('');
            }).join('')}
          </div>
        </div>
        <div class="focus-intensity-panel">
          <div class="fi-header">
            <span class="fi-title">⚡ Focus Intensity</span>
            ${focusIntensityMode !== 'none' ? `<span class="fi-active-pill">● ${FOCUS_INTENSITY_TRACKS.find(t => t.id === focusIntensityMode)?.label || ''}</span>` : ''}
          </div>
          <select class="fi-select" data-act="intensity-select">
            <option value="none"${focusIntensityMode === 'none' ? ' selected' : ''}>🔇 Off — no deep focus track</option>
            ${FOCUS_INTENSITY_TRACKS.map(t => `<option value="${t.id}"${focusIntensityMode === t.id ? ' selected' : ''}>${t.label} — ${t.desc}</option>`).join('')}
          </select>
        </div>
        <div class="binaural-card${_binauralPlaying ? ' bb-playing' : ''}" id="binaural-card">
          <div class="bb-header">
            <div class="bb-pulse-dot"></div>
            <div class="bb-text">
              <div class="bb-title">🧠 Binaural Beats</div>
              <div class="bb-meta">Beta Wave · 20 Hz · 150 Hz L / 170 Hz R · Deep Focus &amp; Productivity</div>
            </div>
          </div>
          <div class="bb-disclaimer">🎧 Headphones required for the binaural effect</div>
          <div class="bb-controls">
            <button id="binaural-play-btn" class="bb-play-btn" data-act="binaural-toggle">${_binauralPlaying ? '⏸ Pause' : '▶ Play'}</button>
            <div class="bb-vol-row">
              <span class="bb-vol-icon">🔊</span>
              <input type="range" id="binaural-vol-slider" min="0" max="1" step="0.05" value="${_binauralVolume}" class="bb-vol-slider"/>
            </div>
          </div>
        </div>
        <button class="btn fs-enter-btn" data-act="enter-full-session">🚀 Enter Full Focus Mode</button>
      </div>
    </div>`;
  }

  function formatFocusTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

  // ========== Mini Floating Timer Bubble ==========
  function initMiniTimer() {
    if (document.getElementById('focus-mini-timer')) return;
    const bubble = document.createElement('div');
    bubble.id = 'focus-mini-timer';
    bubble.title = 'Tap to go to Focus tab';
    bubble.innerHTML = `<span class="fmt-icon">⏱</span><span id="fmt-time">25:00</span><span class="fmt-label">Focus</span>`;
    bubble.style.display = 'none';
    document.body.appendChild(bubble);
    bubble.addEventListener('click', () => switchTab('focus'));
  }

  /* ── Alarm + Overtime helpers ─────────────────────────────── */
  function stopOvertimeAlarm() {
    if (_alarmStopTimer) { clearTimeout(_alarmStopTimer); _alarmStopTimer = null; }
    if (_alarmAudio) { _alarmAudio.pause(); _alarmAudio.currentTime = 0; _alarmAudio = null; }
  }
  function playOvertimeAlarm() {
    stopOvertimeAlarm();
    resumeAudioContext();
    const audio = new Audio('./sounds/rain.mp3');
    audio.loop   = true;
    audio.volume = 1.0;
    audio.preload = 'auto';
    audio.play().catch(e => console.warn('[OvertimeAlarm] play() failed:', e.message));
    _alarmAudio = audio;
    _alarmStopTimer = setTimeout(() => stopOvertimeAlarm(), 30000);
  }
  function startOvertimeMode() {
    focusOvertime = true; focusOvertimeSeconds = 0;
    focusOvertimeTimer = setInterval(() => {
      focusOvertimeSeconds++;
      updateFocusDisplay();
      updateMiniTimer();
    }, 1000);
  }
  function stopOvertimeMode() {
    if (focusOvertimeTimer) { clearInterval(focusOvertimeTimer); focusOvertimeTimer = null; }
    focusOvertime = false; focusOvertimeSeconds = 0;
    stopOvertimeAlarm();
    const overlay = document.getElementById('fs-overlay');
    if (overlay) overlay.classList.remove('fs-overtime');
  }
  function saveOvertimeMinutes() {
    if (focusOvertimeSeconds >= 30) {
      const overtimeMin = Math.round(focusOvertimeSeconds / 60);
      if (overtimeMin > 0) {
        state.focusStats.minutesByDate[todayKey()] = (state.focusStats.minutesByDate[todayKey()] || 0) + overtimeMin;
        saveState();
      }
    }
  }
  function finishOvertimeAndSwitch() {
    saveOvertimeMinutes();
    const prevMode = focusMode;
    stopOvertimeMode();
    if (prevMode === 'work') {
      focusMode = focusSessions % 4 === 0 ? 'long' : 'short';
      focusSeconds = customDurations[focusMode] * 60;
    }
    document.title = 'Syllabus Tracker';
    updateMiniTimer();
  }

  function updateMiniTimer() {
    const bubble = document.getElementById('focus-mini-timer');
    if (!bubble) return;
    const onFocusTab = document.body.classList.contains('tab-focus');
    if (focusOvertime && !onFocusTab) {
      bubble.style.display = 'flex';
      const timeEl = document.getElementById('fmt-time');
      const om = Math.floor(focusOvertimeSeconds / 60), os = focusOvertimeSeconds % 60;
      if (timeEl) timeEl.textContent = `+${String(om).padStart(2,'0')}:${String(os).padStart(2,'0')}`;
    } else if (focusRunning && !onFocusTab) {
      bubble.style.display = 'flex';
      const timeEl = document.getElementById('fmt-time');
      if (timeEl) timeEl.textContent = formatFocusTime(focusSeconds);
    } else {
      bubble.style.display = 'none';
    }
  }

  function updateFocusDisplay() {
    const overlay = document.getElementById('fs-overlay');
    if (focusOvertime) {
      const om = Math.floor(focusOvertimeSeconds / 60), os = focusOvertimeSeconds % 60;
      const otStr = `+${String(om).padStart(2,'0')}:${String(os).padStart(2,'0')}`;
      document.title = `${otStr} — Overtime`;
      const el = document.getElementById('focus-time-display');
      if (el) { el.textContent = otStr; el.classList.add('fs-overtime-text'); }
      const fsEl = document.getElementById('fs-time-display');
      if (fsEl) { fsEl.textContent = otStr; fsEl.classList.add('fs-overtime-text'); }
      if (overlay) { overlay.classList.remove('fs-is-running'); overlay.classList.add('fs-overtime'); }
      return;
    }
    const formatted = formatFocusTime(focusSeconds);
    const total = customDurations[focusMode] * 60;
    const m = Math.floor(focusSeconds / 60), s = focusSeconds % 60;
    document.title = focusRunning ? `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} — Focus` : 'Syllabus Tracker';
    const el = document.getElementById('focus-time-display');
    if (el) { el.textContent = formatted; el.classList.remove('fs-overtime-text'); }
    const ring = document.getElementById('focus-ring-circle');
    if (ring) { const r = 96, c = 2 * Math.PI * r; ring.style.strokeDashoffset = (c * (1 - Math.max(0, Math.min(1, focusSeconds / total)))).toFixed(2); }
    const fsEl = document.getElementById('fs-time-display');
    if (fsEl) { fsEl.textContent = formatted; fsEl.classList.remove('fs-overtime-text'); }
    const fsRing = document.getElementById('fs-ring-circle');
    if (fsRing) { const rr = 120, cc = 2 * Math.PI * rr; fsRing.style.strokeDashoffset = (cc * (1 - Math.max(0, Math.min(1, focusSeconds / total)))).toFixed(2); }
    if (overlay) { overlay.classList.toggle('fs-is-running', focusRunning); overlay.classList.remove('fs-overtime'); }
  }

  function focusTick() {
    // Timestamp-based: stays accurate when tab is backgrounded/throttled
    if (focusStartTime !== null) {
      const elapsed = Math.floor((Date.now() - focusStartTime) / 1000);
      focusSeconds = Math.max(0, focusStartSeconds - elapsed);
    }
    if (focusSeconds > 0) { updateFocusDisplay(); updateMiniTimer(); return; }

    // Timer hit zero
    const _plannedSecs = focusStartSeconds; // capture before clearing
    clearInterval(focusTimer); focusTimer = null; focusRunning = false;
    focusStartTime = null; focusStartSeconds = null;
    document.title = 'Syllabus Tracker';
    updateMiniTimer();

    if (focusMode === 'work') {
      const todayStr = todayKey();
      // Credit the planned duration for this completed session
      const elapsedMin = _plannedSecs !== null ? Math.floor(_plannedSecs / 60) : customDurations.work;
      state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
      _recordSubjectMinutes(elapsedMin);
      awardXP(elapsedMin, todayStr);
      _sUpdatePresence('break').catch(() => {});
      _sContributeToGoals(elapsedMin).catch(() => {});
      bumpActivity(); saveState();
      checkBadges({ sessionMinutes: elapsedMin });
      // Re-render the active tab, and patch live stats widgets on home/dashboard if visible
      if (document.body.classList.contains('tab-stats')) renderStats();
      else if (document.body.classList.contains('tab-home')) renderHome();
      else if (document.body.classList.contains('tab-dashboard')) renderDashboard();
      _updateLiveStats();

      showWebNotification('🎉 Focus Session Complete!', `Session ${focusSessions} done! Keep going or take a break.`, { tag: 'focus-complete', requireInteraction: false });

      // Play soft ambient alarm at max volume for up to 30 s, then enter overtime mode
      playOvertimeAlarm();
      startOvertimeMode();
      if (fsSessionActive) renderFullSession(); else renderFocus();

      const task = focusCurrentTaskKey ? getActivePlanTasks().find(t => t.key === focusCurrentTaskKey) : null;
      if (task && !task.done) {
        confirmModal(`Session complete! Mark "${task.text}" as done?`, () => {
          if (task.type === 'auto') { const t = findTopic(task.subId, task.chId, task.tId); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(task.subId, task.chId, task.tId, true); saveState(); renderAll(); } }
          else { const plan = state.dailyPlans[todayKey()]; if (plan) { const ct = plan.custom.find(c => c.id === task.id); if (ct) { ct.done = true; bumpActivity(); saveState(); renderAll(); } } }
        }, { title: 'Session done!', yesLabel: 'Mark done', yesClass: 'btn' });
      } else {
        toast(`Session ${focusSessions} complete! ⏱ Overtime counting...`, 'success', 5000);
      }

      // Auto-backup every 4th Pomodoro
      if (focusSessions > 0 && focusSessions % 4 === 0 && !hasBackupToday()) {
        setTimeout(() => {
          confirmModal(
            `You've completed ${focusSessions} focus sessions today — amazing work! 🚀\n\nAuto-downloading your backup now to keep your progress safe.`,
            () => exportData(),
            { title: '🛡️ Backup Your Progress', yesLabel: 'Download Backup', yesClass: 'btn', noLabel: 'Skip' }
          );
        }, 1200);
      }
      // ↑ Mode switch deferred — happens in finishOvertimeAndSwitch() when user stops overtime
    } else {
      // Break ended — auto-switch back to work (no overtime for breaks)
      showWebNotification('🚀 Break Over!', 'Time to get back to work. You\'ve got this!', { tag: 'focus-break-end', requireInteraction: false });
      focusMode = 'work';
      focusSeconds = customDurations.work * 60;
      if (fsSessionActive) renderFullSession(); else renderFocus();
    }
  }

  // ========== Full Screen Session ==========
  function enterFullSession() {
    fsSessionActive = true;
    let overlay = document.getElementById('fs-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'fs-overlay';
      document.body.appendChild(overlay);
    }
    const _fsPool = state.motivationQuotes;
    _fsMotiQuote = _fsPool.length ? _fsPool[Math.floor(Math.random() * _fsPool.length)] : '';
    renderFullSession();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});

    /* ── Swipe-to-exit gesture ─────────────────────────────────────
       Any swipe of ≥ 65 px in any direction dismisses the overlay.
       Tap on controls is short-distance (<10 px) so never triggers. */
    overlay.addEventListener('touchstart', e => {
      _fsSwipeStartX = e.touches[0].clientX;
      _fsSwipeStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _fsSwipeStartX;
      const dy = e.changedTouches[0].clientY - _fsSwipeStartY;
      if (Math.sqrt(dx * dx + dy * dy) >= 65) {
        exitFullSession();
        stopAmbient();
        ambientMode = 'none';
      }
    }, { passive: true });
  }

  /* ── Orientation helpers ────────────────────────────────────────────
     lockPortrait()   — called on app start + whenever a special section exits
     lockLandscape()  — called by the toggle buttons inside Focus/Video overlays
     toggleOrientLock() — smart toggle: landscape↔portrait with fullscreen assist */
  function lockPortrait() {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('portrait').catch(() => {});
    }
  }
  async function toggleOrientLock() {
    if (!screen.orientation || typeof screen.orientation.lock !== 'function') {
      toast('Install the app as a PWA on Android to lock orientation', 'warn');
      return;
    }
    const isLandscape = screen.orientation.type.startsWith('landscape');
    if (isLandscape) {
      lockPortrait();
      toast('Returned to portrait', 'info');
    } else {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        }
        await screen.orientation.lock('landscape');
        toast('Landscape locked — tap ⤢ again to return', 'success');
      } catch (e) {
        toast('Install as PWA on Android to lock orientation', 'warn');
      }
    }
  }

  function exitFullSession() {
    fsSessionActive = false;
    const overlay = document.getElementById('fs-overlay'); if (overlay) overlay.remove();
    document.title = 'Syllabus Tracker';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    lockPortrait();
    renderFocus();
  }
  function _genFsParticles() {
    const out = [];
    // Small bright stars (drift fast across)
    for (let i = 0; i < 7; i++) {
      const sz   = (1.5 + Math.random() * 3).toFixed(1);
      const top  = (4  + Math.random() * 82).toFixed(1);
      const dur  = (14 + Math.random() * 16).toFixed(1);
      const del  = -(Math.random() * 28).toFixed(1);
      const dy   = ((Math.random() - 0.5) * 60).toFixed(0);
      const op   = (0.35 + Math.random() * 0.45).toFixed(2);
      out.push(`<div class="fs-particle" style="width:${sz}px;height:${sz}px;top:${top}%;--drift-y:${dy}px;animation-duration:${dur}s;animation-delay:${del}s;opacity:${op}"></div>`);
    }
    // Larger soft cloud blobs (drift slow)
    for (let i = 0; i < 5; i++) {
      const sz   = (28 + Math.random() * 55).toFixed(1);
      const top  = (5  + Math.random() * 80).toFixed(1);
      const dur  = (24 + Math.random() * 22).toFixed(1);
      const del  = -(Math.random() * 40).toFixed(1);
      const dy   = ((Math.random() - 0.5) * 80).toFixed(0);
      const op   = (0.02 + Math.random() * 0.045).toFixed(3);
      out.push(`<div class="fs-particle" style="width:${sz}px;height:${sz}px;top:${top}%;--drift-y:${dy}px;animation-duration:${dur}s;animation-delay:${del}s;opacity:${op}"></div>`);
    }
    return out.join('');
  }

  function renderFullSession() {
    const overlay = document.getElementById('fs-overlay'); if (!overlay) return;
    const total = customDurations[focusMode] * 60;
    const r = 120, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const isBreak = focusMode !== 'work';
    const tasks = getActivePlanTasks().filter(t => !t.done);
    const currentTask = focusCurrentTaskKey ? tasks.find(t => t.key === focusCurrentTaskKey) : null;
    const taskOpts = tasks.map(t => `<option value="${t.key}" ${focusCurrentTaskKey === t.key ? 'selected':''}>${escapeHTML(t.text)}</option>`).join('');
    const _curSound = soundById(ambientMode);
    const ambientIcon = _curSound.label.split(' ')[0];
    const sessionDots = Array.from({length: Math.min(focusSessions, 8)}, () => `<span class="fs-dot"></span>`).join('');
    overlay.className = focusRunning ? 'fs-is-running' : (focusOvertime ? 'fs-overtime' : '');
    const orientIcon = (screen.orientation && screen.orientation.type && screen.orientation.type.startsWith('landscape')) ? SVG_ORIENT_PORTRAIT : SVG_ORIENT_LANDSCAPE;
    const _otM = Math.floor(focusOvertimeSeconds / 60), _otS = focusOvertimeSeconds % 60;
    const _fsTimeStr = focusOvertime ? `+${String(_otM).padStart(2,'0')}:${String(_otS).padStart(2,'0')}` : formatFocusTime(focusSeconds);
    const _fsRingSub = focusOvertime ? `+${String(_otM).padStart(2,'0')}:${String(_otS).padStart(2,'0')} overtime` : `${formatFocusTime(customDurations[focusMode] * 60)} total`;
    overlay.innerHTML = `<div class="fs-bg"><div class="fs-bg-earth"></div>${_genFsParticles()}</div>
      <div class="fs-content">

        <!-- ── Badge + session dots (grid-area: top) ── -->
        <div class="fs-top">
          <div class="fs-mode-badge ${isBreak ? 'fs-mode-break' : ''}">${focusMode === 'work' ? '🎯 Focus Time' : focusMode === 'short' ? '☕ Short Break' : '🛌 Long Break'}</div>
          ${focusSessions > 0 ? `<div class="fs-session-dots">${sessionDots}<span class="fs-sessions-label">${focusSessions} session${focusSessions !== 1 ? 's' : ''}</span></div>` : ''}
        </div>

        <!-- ── Task picker (grid-area: task) ── -->
        <div class="fs-task-box">
          <div class="fs-task-label">Current Task</div>
          ${currentTask ? `<div class="fs-task-name">${escapeHTML(currentTask.text)}</div>${currentTask.meta ? `<div class="fs-task-meta">${escapeHTML(currentTask.meta)}</div>` : ''}` : (tasks.length ? `<select class="fs-task-select" data-act="focus-task-select"><option value="">— Pick a task —</option>${taskOpts}</select>` : `<div class="fs-task-empty">No tasks today</div>`)}
        </div>

        <!-- ── Glowing ring timer (grid-area: ring) ── -->
        <div class="fs-timer-wrap">
          <svg class="fs-ring-svg" viewBox="0 0 290 290" aria-hidden="true">
            <defs><linearGradient id="fsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${isBreak ? '#34d399' : '#38bdf8'}"/><stop offset="100%" stop-color="${isBreak ? '#86efac' : '#a78bfa'}"/></linearGradient></defs>
            <circle class="fs-ring-track" cx="145" cy="145" r="${r}"/>
            <circle class="fs-ring-fill" id="fs-ring-circle" cx="145" cy="145" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
          </svg>
          <div class="fs-ring-center">
            <div class="fs-time${focusOvertime ? ' fs-overtime-text' : ''}" id="fs-time-display">${_fsTimeStr}</div>
            <div class="fs-ring-sub">${_fsRingSub}</div>
          </div>
        </div>

        <!-- ── Vertical controls: Mute · Play · Landscape · Exit (grid-area: ctrl) ── -->
        <div class="fs-ctrl-col">
          <button class="fs-ctrl-btn fs-side-btn" data-act="fs-cycle-ambient" title="Toggle sound">${ambientIcon}</button>
          <button class="fs-ctrl-btn fs-main-btn${focusOvertime ? ' fs-overtime-btn' : ''}" data-act="fs-toggle">${focusRunning ? '⏸' : (focusOvertime ? '⏹' : '▶')}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-orient-btn" data-act="fs-toggle-landscape" title="Toggle landscape">${orientIcon}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-exit-btn" data-act="exit-full-session" title="Exit">✕</button>
        </div>

        <!-- ── Motivation quote (grid-area: moti) ── -->
        <div class="fs-motivation-box">${escapeHTML(_fsMotiQuote)}</div>

        <!-- ── Footer: swipe hint (grid-area: foot) ── -->
        <div class="fs-footer">
          <div class="fs-hint">${('ontouchstart' in window) ? 'Swipe to exit' : 'Press Esc to exit'} · ${ambientMode !== 'none' ? '♪ ' + escapeHTML(_curSound.label) : '🔇 Sound off'}</div>
        </div>

      </div>
      <div class="fs-swipe-bar"><div class="fs-swipe-handle"></div></div>`;
  }

  // ========== Classroom ==========
  function renderClassroom() {
    const groups = (state.classroom && state.classroom.groups) || [];
    const lastShort = _classroomLastUrl ? (_classroomLastUrl.length > 52 ? _classroomLastUrl.slice(0, 52) + '…' : _classroomLastUrl) : '';
    const quickLaunch = `<div class="cls-quicklaunch">
      <div class="cls-ql-label">⚡ Quick Launch</div>
      <div class="cls-ql-row">
        <input class="cls-url-input" id="cls-url-input" type="url" placeholder="Paste any video or course URL (YouTube, Udemy, Khan Academy…)" value="${escapeHTML(_classroomLastUrl)}"/>
        <button class="cls-open-btn" data-act="cls-open-url">▶ Open</button>
      </div>
      ${lastShort ? `<div class="cls-ql-last">Last opened: <span>${escapeHTML(lastShort)}</span></div>` : ''}
    </div>`;
    return `<div class="classroom-view">${quickLaunch}<div class="section-head" style="margin-top:4px"><h2>Saved Content</h2><button class="btn" data-act="add-classroom-group">${ic('plus')} New Group</button></div>${!groups.length ? `<div class="classroom-empty"><div style="font-size:32px;margin-bottom:8px">🎓</div><div>Save YouTube videos, playlists, or course links for quick access.</div><button class="btn" style="margin-top:12px" data-act="add-classroom-group">${ic('plus')} Create a group</button></div>` : groups.map(g => renderClassroomGroup(g)).join('')}</div>`;
  }
  function renderClassroomGroup(group) {
    return `<div class="classroom-group"><div class="classroom-group-head"><span class="classroom-group-icon">📂</span><h3>${escapeHTML(group.name)}</h3><button class="menu-btn" data-act="add-classroom-item" data-gid="${group.id}" title="Add video">${ic('plus')}</button><button class="menu-btn" data-act="del-classroom-group" data-gid="${group.id}" title="Delete group">${ic('trash')}</button></div>${!group.items.length ? `<div class="muted" style="font-size:13px;padding:8px 0">No videos yet. Click + to add one.</div>` : `<div class="video-grid">${group.items.map(item => renderVideoCard(group.id, item)).join('')}</div>`}</div>`;
  }
  function renderVideoCard(groupId, item) {
    const thumb = item.thumbnailUrl || (item.videoId ? ytThumb(item.videoId) : null);
    const typeLabel = item.type === 'playlist' ? '📋 Playlist' : item.type === 'external' ? `🌐 ${extractSiteName(item.url)}` : '🎬 Video';
    const thumbIcon = item.type === 'playlist' ? '📋' : item.type === 'external' ? '🌐' : '▶️';
    return `<div class="video-card" data-act="play-video" data-gid="${groupId}" data-iid="${item.id}">
      <button class="video-del-btn" data-act="del-classroom-item" data-gid="${groupId}" data-iid="${item.id}" title="Remove">×</button>
      <button class="video-edit-btn" data-act="edit-classroom-item" data-gid="${groupId}" data-iid="${item.id}" title="Edit">✏️</button>
      ${thumb ? `<img class="video-thumb" src="${thumb}" alt="${escapeHTML(item.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="video-thumb-placeholder" style="display:none">${thumbIcon}</div>` : `<div class="video-thumb-placeholder ${item.type === 'external' ? 'video-thumb-external' : ''}">${thumbIcon}</div>`}
      <div class="video-info">
        <div class="video-title">${escapeHTML(item.title)}</div>
        ${item.description ? `<div class="video-desc">${escapeHTML(item.description)}</div>` : ''}
        <div class="video-type">${typeLabel}</div>
      </div>
    </div>`;
  }
  function modalEditClassroomItem(groupId, itemId) {
    const group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
    const item = group.items.find(i => i.id === itemId); if (!item) return;
    openModal(`<h3>✏️ Edit Content</h3>
      <div class="field"><label>Title</label><input id="m-title" value="${escapeHTML(item.title)}" maxlength="120" placeholder="Custom title"/></div>
      <div class="field"><label>URL <span style="color:var(--text-muted);font-weight:400;font-size:11px">— YouTube, course site, any video link</span></label><input id="m-url" type="url" value="${escapeHTML(item.url)}" placeholder="https://…"/></div>
      <div class="field"><label>Description / Notes (optional)</label><textarea id="m-desc" maxlength="300" placeholder="Add notes, timestamps, what to focus on…">${escapeHTML(item.description || '')}</textarea></div>
      <div class="field"><label>Preview</label>${(item.thumbnailUrl || item.videoId) ? `<img src="${item.thumbnailUrl || ytThumb(item.videoId)}" style="width:100%;border-radius:8px;margin-top:4px" alt="thumb" onerror="this.style.display='none'"/>` : '<span style="color:var(--text-muted);font-size:13px">No preview available</span>'}</div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Save Changes</button></div>`,
      root => {
        root.querySelector('#m-save').onclick = async () => {
          const title = root.querySelector('#m-title').value.trim();
          const url = root.querySelector('#m-url').value.trim();
          if (!title) { toast('Title required', 'warn'); return; }
          if (!url) { toast('URL required', 'warn'); return; }
          const { videoId, playlistId } = parseYouTubeUrl(url);
          const prevUrl = item.url;
          item.title = title; item.url = url;
          item.videoId = videoId || null; item.playlistId = playlistId || null;
          item.type = (playlistId && !videoId) ? 'playlist' : videoId ? 'video' : 'external';
          item.description = root.querySelector('#m-desc').value.trim();
          if (url !== prevUrl || !item.thumbnailUrl) {
            const { thumbnailUrl } = await fetchYouTubeTitle(url);
            item.thumbnailUrl = thumbnailUrl || item.thumbnailUrl || (videoId ? ytThumb(videoId) : '');
          }
          saveState(); closeModal(); renderFocus(); toast('Updated', 'success');
        };
      });
  }
  function modalAddClassroomGroup() {
    openModal(`<h3>New Group</h3><div class="field"><label>Group name</label><input id="m-name" placeholder="e.g. Math Videos, Bio Notes…" maxlength="60"/></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Create Group</button></div>`,
      root => { root.querySelector('#m-save').onclick = () => { const name = root.querySelector('#m-name').value.trim(); if (!name) { toast('Enter a name', 'warn'); return; } if (!state.classroom) state.classroom = { groups: [] }; state.classroom.groups.push({ id: uid(), name, items: [] }); saveState(); closeModal(); renderFocus(); toast('Group created', 'success'); }; });
  }
  function modalAddClassroomItem(groupId) {
    const group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
    openModal(`<h3>Add Video / Course Link</h3>
      <div class="add-video-form">
        <div class="field">
          <label>URL <span style="color:var(--text-muted);font-weight:400;font-size:11px">— YouTube, Udemy, Coursera, any link</span></label>
          <input id="m-url" type="url" placeholder="https://…"/>
        </div>
        <div class="field">
          <label>Title <span id="m-title-status" style="font-size:10px;color:var(--text-muted)"></span></label>
          <input id="m-title" placeholder="Auto-fetched or enter manually…" maxlength="120"/>
        </div>
        <div class="field">
          <label>Description / Notes (optional)</label>
          <textarea id="m-desc" maxlength="300" placeholder="Notes, timestamps, topics covered…"></textarea>
        </div>
      </div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Add</button></div>`,
      root => {
        const urlInput = root.querySelector('#m-url');
        const titleInput = root.querySelector('#m-title');
        const statusEl = root.querySelector('#m-title-status');
        let fetchTimeout = null;
        let _fetchedThumb = null;

        urlInput.addEventListener('input', () => {
          clearTimeout(fetchTimeout);
          fetchTimeout = setTimeout(async () => {
            const url = urlInput.value.trim();
            if (!url) return;
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
              statusEl.textContent = '⏳ Fetching title…';
              const { title, thumbnailUrl } = await fetchYouTubeTitle(url);
              _fetchedThumb = thumbnailUrl || null;
              if (title && !titleInput.value.trim()) { titleInput.value = title; statusEl.textContent = '✅ Auto-fetched'; }
              else if (!title) { statusEl.textContent = '⚠️ Could not fetch — enter manually'; }
              else { statusEl.textContent = ''; }
            } else {
              // For external sites, suggest the domain as title
              if (!titleInput.value.trim()) {
                try { titleInput.value = new URL(url).hostname.replace(/^www\./, ''); } catch(e) {}
              }
              statusEl.textContent = '🌐 External course link';
            }
          }, 500);
        });

        root.querySelector('#m-save').onclick = () => {
          const url = urlInput.value.trim();
          if (!url) { toast('Enter a URL', 'warn'); return; }
          const { videoId, playlistId } = parseYouTubeUrl(url);
          const type = (playlistId && !videoId) ? 'playlist' : videoId ? 'video' : 'external';
          const titleVal = titleInput.value.trim();
          const title = titleVal || (type === 'playlist' ? 'Playlist' : type === 'external' ? extractSiteName(url) : 'Video');
          const description = root.querySelector('#m-desc').value.trim();
          const thumbnailUrl = _fetchedThumb || (videoId ? ytThumb(videoId) : '');
          group.items.push({ id: uid(), title, url, videoId: videoId || null, playlistId: playlistId || null, type, addedAt: todayKey(), description, thumbnailUrl, notes: [] });
          saveState(); closeModal(); renderFocus(); toast('Added to classroom', 'success');
        };
      });
  }
  /* ── Integrated Video Player ── */
  const SVG_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>`;
  const SVG_EXTLINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  /* Phone-rotate to landscape — shown when app is portrait, click to go landscape */
  const SVG_ORIENT_LANDSCAPE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  /* Compress arrows — shown when in landscape, click to return to portrait */
  const SVG_ORIENT_PORTRAIT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 3 3 3 3 9"/><polyline points="15 21 21 21 21 15"/><line x1="3" y1="3" x2="10" y2="10"/><line x1="21" y1="21" x2="14" y2="14"/></svg>`;

  /* ── Bookmark / YT-API helpers ── */
  let _ytPlayer      = null;
  let _ytPlayerReady = false;   // true only after onReady fires with e.target
  let _ytPlayerState = -1;      // mirrors YT player state (-1 unstarted, 1 playing, 2 paused…)

  // ── Video Focus Mode state ──────────────────────────────────
  let _vfmActive = false, _vfmDuration = 0, _vfmRemaining = 0;
  let _vfmTimer = null, _vfmRunning = false, _vfmComplete = false;
  let _vfmMinimized = false, _vfmTitle = '';
  const _VFM_C  = +(2 * Math.PI * 96).toFixed(2);  // ring  r=96
  const _VFM_BC = +(2 * Math.PI * 26).toFixed(2);  // bubble r=26

  function loadYTApi() {
    if (window._ytApiRequested) return;
    window._ytApiRequested = true;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }
  window.onYouTubeIframeAPIReady = function () { tryBindYTPlayer(); };

  function tryBindYTPlayer() {
    if (_ytPlayer) return; // already bound — guard against double-call
    const iframe = document.getElementById('vp-iframe');
    if (!iframe || !window.YT || !YT.Player) return;
    try {
      _ytPlayerReady = false;
      _ytPlayerState = -1;
      _ytPlayer = new YT.Player('vp-iframe', {
        events: {
          onReady: function (e) {
            _ytPlayer      = e.target;   // e.target is the live API object
            _ytPlayerReady = true;
          },
          onStateChange: function (e) {
            _ytPlayerState = e.data;
            // YT.PlayerState.ENDED = 0 → auto-complete focus session
            if (e.data === 0 && _vfmActive && !_vfmComplete) {
              setTimeout(onVfmComplete, 800);
            }
          }
        }
      });
    } catch (e) { _ytPlayer = null; _ytPlayerReady = false; }
  }

  function getCurrentYTTime() {
    try {
      if (_ytPlayer && _ytPlayerReady && typeof _ytPlayer.getCurrentTime === 'function') {
        const t = _ytPlayer.getCurrentTime();
        // Math.floor converts the float seconds to a clean integer
        return isFinite(t) ? Math.floor(t) : null;
      }
    } catch (e) {}
    return null; // API not ready — caller must handle null
  }

  function seekVideoPlayer(seconds) {
    // Primary: YT Player API (accurate, no page reload)
    try {
      if (_ytPlayer && _ytPlayerReady && typeof _ytPlayer.seekTo === 'function') {
        _ytPlayer.seekTo(seconds, true);
        return;
      }
    } catch (e) {}
    // Fallback: postMessage to iframe — works even before API binds, no src reload
    const iframe = document.getElementById('vp-iframe');
    if (!iframe) return;
    try {
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func:  'seekTo',
        args:  [seconds, true]
      }), '*');
    } catch (e) {}
  }

  function formatVpTs(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${m}:${String(sec).padStart(2,'0')}`;
  }

  function parseTsInput(str) {
    const parts = str.trim().split(':').map(Number);
    if (parts.some(isNaN) || parts.length < 2) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  function vpNoteCardHTML(groupId, itemId, n) {
    return `<div class="vp-note-card" data-act="vp-seek-note" data-gid="${groupId}" data-iid="${itemId}" data-ts="${n.ts}">
      <span class="vp-note-ts">${formatVpTs(n.ts)}</span>
      <span class="vp-note-label">${escapeHTML(n.label)}</span>
      <button class="vp-note-del" data-act="vp-del-note" data-gid="${groupId}" data-iid="${itemId}" data-nid="${n.id}" aria-label="Delete">×</button>
    </div>`;
  }

  function vpNotesHTML(groupId, item) {
    const notes = (item.notes || []).slice().sort((a, b) => a.ts - b.ts);
    return `<div class="vp-notes-section" id="vp-notes-section">
      <div class="vp-notes-head">
        <span class="vp-notes-title">📍 Saved Notes</span>
        <button class="vp-bookmark-btn" data-act="vp-bookmark" data-gid="${groupId}" data-iid="${item.id}">🔖 Bookmark</button>
      </div>
      <div id="vp-bookmark-form" class="vp-bookmark-form" data-gid="${groupId}" data-iid="${item.id}">
        <div class="vp-bm-row">
          <input id="vp-bm-time" class="vp-bm-input vp-bm-time" placeholder="0:00" maxlength="9" inputmode="text" autocomplete="off"/>
          <input id="vp-bm-label" class="vp-bm-input vp-bm-label" placeholder="What is this part about?" maxlength="80"/>
        </div>
        <div class="vp-bm-actions">
          <button class="btn btn-sm" data-act="vp-bm-save">Save Note</button>
          <button class="btn btn-ghost btn-sm" data-act="vp-bm-cancel">Cancel</button>
        </div>
      </div>
      <div id="vp-notes-list">${notes.length
        ? notes.map(n => vpNoteCardHTML(groupId, item.id, n)).join('')
        : '<div class="vp-notes-empty">No bookmarks yet — tap Bookmark to save a moment</div>'
      }</div>
    </div>`;
  }

  function vpPlaylistItemHTML(it, groupId, isActive) {
    const thumb = it.thumbnailUrl || (it.videoId ? ytThumb(it.videoId) : null);
    const thumbEl = thumb
      ? `<img class="vp-playlist-thumb" src="${thumb}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="vp-playlist-thumb-ph" style="display:none">${it.type === 'playlist' ? '📋' : '▶️'}</div>`
      : `<div class="vp-playlist-thumb-ph">${it.type === 'playlist' ? '📋' : '▶️'}</div>`;
    const rightEl = isActive
      ? `<div class="vp-now-playing"><div class="vp-now-playing-dot"></div>Playing</div>`
      : `<div class="vp-playlist-play">${SVG_PLAY}</div>`;
    return `<div class="vp-playlist-item${isActive ? ' vp-active' : ''}" data-act="${isActive ? '' : 'vp-switch'}" data-gid="${groupId}" data-iid="${it.id}">
      ${thumbEl}
      <div class="vp-playlist-info">
        <div class="vp-playlist-title">${escapeHTML(it.title)}</div>
        <div class="vp-playlist-type">${it.type === 'playlist' ? '📋 Playlist' : '🎬 Video'}</div>
      </div>
      ${rightEl}
    </div>`;
  }

  function _buildPlayerOverlay(item, group, groupId, itemId) {
    const embedUrl = buildEmbedUrl(item);
    const isExternal = item.type === 'external';
    const typeLabel = item.type === 'playlist' ? '📋 Playlist' : isExternal ? `🌐 ${extractSiteName(item.url)}` : '🎬 Video';
    const extHint = isExternal
      ? `<div class="vp-ext-hint">💡 If this page doesn't load, the site may block embedding. Use the <strong>↗ Open</strong> button to open it in your browser.</div>`
      : '';

    const playlistHTML = (group && group.items.length > 1)
      ? `<div class="vp-playlist-section">
           <div class="vp-playlist-label">${escapeHTML(group.name)}</div>
           <div class="vp-playlist">${group.items.map(it => vpPlaylistItemHTML(it, groupId, it.id === itemId)).join('')}</div>
         </div>`
      : '';

    const notesSection = vpNotesHTML(groupId || '__quick__', item);

    return `
      <div class="vp-header">
        <button class="vp-back-btn" data-act="vp-close" aria-label="Back">${SVG_BACK}</button>
        <div class="vp-header-title">${escapeHTML(item.title)}</div>
        <button class="vp-yt-btn vfm-start-vp-btn" data-act="vfm-start" title="Start Focus Mode" aria-label="Focus Mode">⏱</button>
        <button class="vp-yt-btn" id="vp-cinema-btn" data-act="vp-cinema" title="Cinema Mode (F)" aria-label="Cinema Mode">${SVG_CINEMA_ENTER}</button>
        <button class="vp-yt-btn vp-orient-btn" data-act="vp-toggle-landscape" title="Toggle landscape" aria-label="Toggle landscape">${SVG_ORIENT_LANDSCAPE}</button>
        <a href="${escapeHTML(item.url)}" target="_blank" rel="noopener" class="vp-yt-btn" title="Open externally">${SVG_EXTLINK}</a>
      </div>
      <div class="vp-split">
        <div class="vp-main">
          <div class="vp-embed-wrap">
            <iframe id="vp-iframe" src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" title="${escapeHTML(item.title)}"></iframe>
            <div id="vp-seek-zones" class="vp-seek-zones">
              <div class="vp-seek-zone vp-seek-l" id="vp-seek-flash-l"><div class="vp-seek-indicator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><polyline points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5"/></svg><span>−10s</span></div></div>
              <div class="vp-seek-zone vp-seek-r" id="vp-seek-flash-r"><div class="vp-seek-indicator"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><polyline points="5 4 15 12 5 20"/><line x1="19" y1="4" x2="19" y2="20"/></svg><span>+10s</span></div></div>
            </div>
            <div class="vp-ambient-glow"></div>
          </div>
          ${extHint}
          <div class="vp-info">
            <div class="vp-info-type">${typeLabel}</div>
            <div class="vp-info-title">${escapeHTML(item.title)}</div>
            ${item.description ? `<div class="vp-info-desc">${escapeHTML(item.description)}</div>` : ''}
          </div>
          ${playlistHTML}
          <div class="vp-notes-mobile">${notesSection}</div>
        </div>
        <div class="vp-notes-col" id="vp-notes-col">${notesSection}</div>
      </div>
      <div class="vp-cinema-hint" id="vp-cinema-hint">Press <kbd>F</kbd> or tap ⛶ for cinema · <kbd>Space</kbd> play/pause · <kbd>←→</kbd> seek · <kbd>M</kbd> minimize timer</div>`;
  }

  // ========== Video Focus Mode ==========
  function _fmtVfm(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function _vfmOverlayHTML() {
    const prog = _vfmDuration > 0 ? _vfmRemaining / _vfmDuration : 1;
    const offset = _VFM_C * (1 - prog);
    const statusCls = _vfmComplete ? ' complete' : !_vfmRunning ? ' paused' : '';
    const statusTxt = _vfmComplete ? '✅' : !_vfmRunning ? '⏸' : '▶';
    return `
      <div class="vfm-top-bar">
        <button class="vfm-tiny-btn" data-act="vfm-minimize" title="Minimize">&#8212;</button>
        <span class="vfm-badge-sm">🎯 FOCUS</span>
        <button class="vfm-tiny-btn vfm-close-btn" data-act="vfm-close" title="${_vfmComplete ? 'Exit' : 'Abandon'}">&times;</button>
      </div>
      <div class="vfm-ring-wrap">
        <svg class="vfm-svg" viewBox="0 0 220 220">
          <circle class="vfm-ring-bg" cx="110" cy="110" r="96" fill="none" stroke-width="10"/>
          <circle class="vfm-ring-fg${_vfmComplete ? ' vfm-ring-done' : ''}" cx="110" cy="110" r="96" fill="none" stroke-width="10" stroke-linecap="round" id="vfm-ring-fg" style="stroke-dashoffset:${offset}"/>
        </svg>
        <div class="vfm-center">
          <div class="vfm-time" id="vfm-time">${_fmtVfm(_vfmRemaining)}</div>
          <div class="vfm-status${statusCls}" id="vfm-status">${statusTxt}</div>
        </div>
      </div>
      <div class="vfm-vtitle">${escapeHTML(_vfmTitle)}</div>
      <div class="vfm-complete-msg" id="vfm-complete-msg"${_vfmComplete ? '' : ' style="display:none"'}>
        <div class="vfm-complete-text">🎉 Session Complete!</div>
      </div>
      <button class="btn vfm-exit-btn${_vfmComplete ? ' vfm-unlocked' : ' vfm-locked'}" id="vfm-exit-btn" data-act="vfm-exit">${_vfmComplete ? '✅ Exit &amp; Log' : '🔒 Finish to Exit'}</button>`;
  }

  // Selector for any interactive descendant that must NOT be intercepted by the drag handler.
  // Includes plain buttons, elements with data-act, anchor tags, and form controls.
  const _DRAG_EXEMPT = 'button, [data-act], a, input, select, textarea, label';
  function _bindVfmDrag(el) {
    let _sx = 0, _sy = 0, _ex = 0, _ey = 0, _drag = false, _moved = false;
    let _rafId = null, _pendingX = 0, _pendingY = 0;
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function startDrag(cx, cy) {
      const r = el.getBoundingClientRect();
      _ex = r.left; _ey = r.top; _sx = cx; _sy = cy; _drag = true; _moved = false;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = _ex + 'px'; el.style.top = _ey + 'px';
      el.classList.add('vfm-dragging');
    }
    function moveDrag(cx, cy) {
      if (!_drag) return;
      const dx = cx - _sx, dy = cy - _sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) _moved = true;
      el.style.left = clamp(_ex + dx, 0, window.innerWidth - el.offsetWidth) + 'px';
      el.style.top  = clamp(_ey + dy, 0, window.innerHeight - el.offsetHeight) + 'px';
    }
    // rAF throttle: coalesces all pointer events within one frame into a single DOM write
    function scheduleDrag(cx, cy) {
      _pendingX = cx; _pendingY = cy;
      if (_rafId !== null) return;
      _rafId = requestAnimationFrame(() => { _rafId = null; moveDrag(_pendingX, _pendingY); });
    }
    function endDrag() {
      _drag = false;
      el.classList.remove('vfm-dragging');
      if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    }
    el.addEventListener('touchstart', e => {
      if (e.target.closest(_DRAG_EXEMPT)) return;
      const t = e.touches[0]; startDrag(t.clientX, t.clientY);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!_drag) return; e.preventDefault();
      scheduleDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    el.addEventListener('touchend', e => {
      const wasMoved = _moved;
      _moved = false;
      endDrag();
      if (wasMoved && !e.target.closest(_DRAG_EXEMPT)) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    el.addEventListener('click', e => {
      // Block synthetic click after a mouse-drag (touch path already handled above)
      if (_moved) { _moved = false; if (!e.target.closest(_DRAG_EXEMPT)) e.stopImmediatePropagation(); }
    }, true);
    el.addEventListener('mousedown', e => {
      if (e.target.closest(_DRAG_EXEMPT)) return;
      startDrag(e.clientX, e.clientY); e.preventDefault();
    });
    document.addEventListener('mousemove', e => { if (_drag) scheduleDrag(e.clientX, e.clientY); });
    document.addEventListener('mouseup', () => endDrag());
  }

  function _vfmBubbleHTML() {
    const prog = _vfmDuration > 0 ? _vfmRemaining / _vfmDuration : 1;
    const offset = _VFM_BC * (1 - prog);
    return `
      <svg class="vfm-bubble-svg" viewBox="0 0 60 60">
        <circle class="vfm-br-bg" cx="30" cy="30" r="26" fill="none" stroke-width="5"/>
        <circle class="vfm-br-fg${_vfmComplete ? ' vfm-br-done' : ''}" cx="30" cy="30" r="26" fill="none" stroke-width="5" stroke-linecap="round" id="vfm-bubble-ring" style="stroke-dashoffset:${offset}"/>
      </svg>
      <div class="vfm-bubble-time" id="vfm-bubble-time">${_fmtVfm(_vfmRemaining)}</div>`;
  }

  function openVfmPicker() {
    if (_vfmActive) { if (_vfmMinimized) expandVfm(); return; }
    const vpOverlay = document.getElementById('vp-overlay');
    if (!vpOverlay) return;
    const existing = document.getElementById('vfm-picker');
    if (existing) { existing.remove(); return; }
    const title = document.querySelector('.vp-header-title')?.textContent || 'Video';
    const el = document.createElement('div');
    el.id = 'vfm-picker';
    el.innerHTML = `
      <div class="vfm-picker-title">⏱ Focus Session</div>
      <div class="vfm-picker-sub">${escapeHTML(title)}</div>
      <div class="vfm-dur-chips">
        <button class="vfm-chip active" data-dur="25">25 min</button>
        <button class="vfm-chip" data-dur="45">45 min</button>
        <button class="vfm-chip" data-dur="60">60 min</button>
        <button class="vfm-chip" data-dur="0">Custom</button>
      </div>
      <div class="vfm-custom-wrap" id="vfm-picker-custom">
        <input id="vfm-custom-min" type="number" min="1" max="180" value="30" inputmode="numeric"/>
        <span style="color:var(--text-muted);font-size:14px">minutes</span>
      </div>
      <div class="vfm-picker-actions">
        <button class="btn" id="vfm-pick-start" style="flex:1;background:linear-gradient(135deg,#4f46e5,#7c3aed)">🎯 Start Focus Mode</button>
        <button class="btn btn-ghost" id="vfm-pick-cancel">Cancel</button>
      </div>`;
    document.body.appendChild(el);
    let selectedDur = 25;
    el.querySelectorAll('.vfm-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        el.querySelectorAll('.vfm-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const dur = parseInt(chip.dataset.dur, 10);
        selectedDur = dur;
        document.getElementById('vfm-picker-custom').style.display = dur === 0 ? 'flex' : 'none';
      });
    });
    el.querySelector('#vfm-pick-start').addEventListener('click', () => {
      let dur = selectedDur;
      if (dur === 0) {
        const v = parseInt(document.getElementById('vfm-custom-min')?.value || '30', 10);
        if (isNaN(v) || v < 1 || v > 180) { toast('Enter 1–180 minutes', 'warn'); return; }
        dur = v;
      }
      el.remove();
      const titleNow = document.querySelector('.vp-header-title')?.textContent || 'Video';
      startVfm(dur, titleNow);
    });
    el.querySelector('#vfm-pick-cancel').addEventListener('click', () => el.remove());
  }

  function startVfm(mins, title) {
    _vfmActive = true; _vfmDuration = mins * 60; _vfmRemaining = mins * 60;
    _vfmComplete = false; _vfmMinimized = false; _vfmTitle = title || '';
    // Start paused if video is already paused/unstarted
    _vfmRunning = !(_ytPlayerReady && (_ytPlayerState === 2 || _ytPlayerState === 5 || _ytPlayerState === -1));
    document.getElementById('vfm-overlay')?.remove();
    document.getElementById('vfm-bubble')?.remove();
    const el = document.createElement('div');
    el.id = 'vfm-overlay';
    el.innerHTML = _vfmOverlayHTML();
    document.body.appendChild(el);
    _bindVfmDrag(el);
    const vpFocusBtn = document.querySelector('.vfm-start-vp-btn');
    if (vpFocusBtn) { vpFocusBtn.classList.add('vfm-btn-active'); vpFocusBtn.title = 'Focus Mode Active'; }
    _vfmTimer = setInterval(vfmTick, 1000);
    toast('Focus Mode started — stay locked in! 🎯', 'success', 3000);
  }

  // Save partial video session time (called on early abandon)
  function _saveVfmPartialTime() {
    const elapsed = Math.floor((_vfmDuration - _vfmRemaining) / 60);
    if (elapsed < 1) return;
    const todayStr = todayKey();
    state.focusStats.videoMinutes = state.focusStats.videoMinutes || {};
    state.focusStats.videoMinutes[todayStr] = (state.focusStats.videoMinutes[todayStr] || 0) + elapsed;
    awardXP(elapsed, todayStr);
    saveState();
    toast(`⏱ ${elapsed} min logged from your video session!`, 'info', 3500);
  }

  function stopVfm() {
    _vfmActive = false; _vfmComplete = false; _vfmMinimized = false; _vfmRunning = false;
    clearInterval(_vfmTimer); _vfmTimer = null;
    document.getElementById('vfm-overlay')?.remove();
    document.getElementById('vfm-bubble')?.remove();
    document.getElementById('vfm-picker')?.remove();
    const vpFocusBtn = document.querySelector('.vfm-start-vp-btn');
    if (vpFocusBtn) { vpFocusBtn.classList.remove('vfm-btn-active'); vpFocusBtn.title = 'Start Focus Mode'; }
  }

  function vfmTick() {
    if (_ytPlayerReady) {
      const playing = _ytPlayerState === 1 || _ytPlayerState === 3;
      const paused  = _ytPlayerState === 2 || _ytPlayerState === 5 || _ytPlayerState === -1;
      if (paused && _vfmRunning)          { _vfmRunning = false; updateVfmDisplay(); return; }
      if (playing && !_vfmRunning && !_vfmComplete) { _vfmRunning = true; }
    }
    if (!_vfmRunning || _vfmComplete) return;
    // Sync timer with video playback speed
    let rate = 1;
    try {
      if (_ytPlayerReady && _ytPlayer && typeof _ytPlayer.getPlaybackRate === 'function') {
        rate = _ytPlayer.getPlaybackRate() || 1;
      }
    } catch (e) {}
    _vfmRemaining = Math.max(0, _vfmRemaining - rate);
    updateVfmDisplay();
    if (_vfmRemaining <= 0) onVfmComplete();
  }

  function updateVfmDisplay() {
    const prog   = _vfmDuration > 0 ? _vfmRemaining / _vfmDuration : 1;
    const offset = _VFM_C * (1 - prog);
    const ringEl = document.getElementById('vfm-ring-fg');
    if (ringEl) ringEl.style.strokeDashoffset = offset;
    const timeEl = document.getElementById('vfm-time');
    if (timeEl) timeEl.textContent = _fmtVfm(_vfmRemaining);
    const statusEl = document.getElementById('vfm-status');
    if (statusEl) {
      statusEl.className = 'vfm-status' + (_vfmComplete ? ' complete' : !_vfmRunning ? ' paused' : '');
      statusEl.textContent = _vfmComplete ? '✅ Done' : !_vfmRunning ? '⏸ Paused' : '▶ Active';
    }
    const bubbleRing = document.getElementById('vfm-bubble-ring');
    if (bubbleRing) bubbleRing.style.strokeDashoffset = _VFM_BC * (1 - prog);
    const bubbleTime = document.getElementById('vfm-bubble-time');
    if (bubbleTime) bubbleTime.textContent = _fmtVfm(_vfmRemaining);
  }

  function onVfmComplete() {
    _vfmComplete = true; _vfmRunning = false;
    clearInterval(_vfmTimer); _vfmTimer = null;
    const ringEl = document.getElementById('vfm-ring-fg');
    if (ringEl) { ringEl.style.strokeDashoffset = 0; ringEl.classList.add('vfm-ring-done'); }
    const completeMsg = document.getElementById('vfm-complete-msg');
    if (completeMsg) completeMsg.style.display = '';
    const hintEl = document.getElementById('vfm-hint');
    if (hintEl) hintEl.style.display = 'none';
    const exitBtn = document.getElementById('vfm-exit-btn');
    if (exitBtn) { exitBtn.classList.remove('vfm-locked'); exitBtn.classList.add('vfm-unlocked'); exitBtn.textContent = '✅ Exit & Complete'; }
    const abandonLink = document.querySelector('.vfm-abandon-link');
    if (abandonLink) abandonLink.style.display = 'none';
    if (_vfmMinimized) expandVfm();
    // Save focus stats
    const todayStr = todayKey();
    const mins = Math.round(_vfmDuration / 60);
    state.focusStats.minutesByDate = state.focusStats.minutesByDate || {};
    state.focusStats.sessions      = state.focusStats.sessions || {};
    state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + mins;
    state.focusStats.sessions[todayStr]      = (state.focusStats.sessions[todayStr] || 0) + 1;
    state.focusStats.videoMinutes = state.focusStats.videoMinutes || {};
    state.focusStats.videoMinutes[todayStr]  = (state.focusStats.videoMinutes[todayStr]  || 0) + mins;
    awardXP(mins, todayStr);
    saveState();
    renderDashboard();
    // Instant realtime chart update — no page refresh needed
    if (document.body.classList.contains('tab-stats')) renderStats();
    toast('🎉 Focus session complete! Great work!', 'success', 5000);
  }

  function minimizeVfm() {
    if (!_vfmActive) return;
    _vfmMinimized = true;
    document.getElementById('vfm-overlay')?.remove();
    const el = document.createElement('div');
    el.id = 'vfm-bubble'; el.dataset.act = 'vfm-expand'; el.title = 'Tap to expand Focus Mode';
    el.innerHTML = _vfmBubbleHTML();
    document.body.appendChild(el);
    _bindVfmDrag(el);
  }

  function expandVfm() {
    if (!_vfmActive) return;
    _vfmMinimized = false;
    document.getElementById('vfm-bubble')?.remove();
    const existing = document.getElementById('vfm-overlay');
    if (existing) return;
    const el = document.createElement('div');
    el.id = 'vfm-overlay';
    el.innerHTML = _vfmOverlayHTML();
    document.body.appendChild(el);
    _bindVfmDrag(el);
    updateVfmDisplay();
  }

  // ── Video Player Enhancement ─────────────────────────────────
  const SVG_CINEMA_ENTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
  const SVG_CINEMA_EXIT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
  let _vpHudTimer = null;
  let _vpCinema = false;
  let _vpKeyHandler = null;

  function _vpToggleCinema() {
    const overlay = document.getElementById('vp-overlay');
    if (!overlay) return;
    _vpCinema = !_vpCinema;
    overlay.classList.toggle('vp-cinema', _vpCinema);
    const btn = document.getElementById('vp-cinema-btn');
    if (btn) {
      btn.innerHTML = _vpCinema ? SVG_CINEMA_EXIT : SVG_CINEMA_ENTER;
      btn.title = _vpCinema ? 'Exit Cinema (F)' : 'Cinema Mode (F)';
    }
    if (_vpCinema) _vpResetAutoHide();
    else { clearTimeout(_vpHudTimer); overlay.classList.remove('vp-hud-hidden'); }
  }

  function _vpResetAutoHide() {
    const overlay = document.getElementById('vp-overlay');
    if (!overlay) return;
    overlay.classList.remove('vp-hud-hidden');
    clearTimeout(_vpHudTimer);
    if (_vpCinema) {
      _vpHudTimer = setTimeout(() => {
        const el = document.getElementById('vp-overlay');
        if (el && _vpCinema) el.classList.add('vp-hud-hidden');
      }, 3200);
    }
  }

  function _vpInitPlayer(overlay) {
    _vpCinema = false;
    _vpHudTimer = null;
    const onActivity = () => _vpResetAutoHide();
    overlay.addEventListener('mousemove', onActivity, { passive: true });
    overlay.addEventListener('touchstart', onActivity, { passive: true });
    overlay.addEventListener('click', onActivity, { passive: true });
    if (_vpKeyHandler) document.removeEventListener('keydown', _vpKeyHandler);
    _vpKeyHandler = function(e) {
      if (!document.getElementById('vp-overlay')) {
        document.removeEventListener('keydown', _vpKeyHandler); _vpKeyHandler = null; return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case 'Escape':
          if (_vpCinema) { _vpToggleCinema(); e.preventDefault(); }
          else { closeVideoPlayer(); e.preventDefault(); }
          break;
        case 'f': case 'F':
          _vpToggleCinema(); e.preventDefault(); break;
        case ' ':
          if (_ytPlayerReady && _ytPlayer) {
            _ytPlayerState === 1 ? _ytPlayer.pauseVideo() : _ytPlayer.playVideo();
            e.preventDefault();
          }
          break;
        case 'ArrowRight':
          if (_ytPlayerReady && _ytPlayer) { _ytPlayer.seekTo((_ytPlayer.getCurrentTime() || 0) + 10, true); e.preventDefault(); } break;
        case 'ArrowLeft':
          if (_ytPlayerReady && _ytPlayer) { _ytPlayer.seekTo(Math.max(0, (_ytPlayer.getCurrentTime() || 0) - 10), true); e.preventDefault(); } break;
        case 'm': case 'M':
          if (_vfmActive) { _vfmMinimized ? expandVfm() : minimizeVfm(); } break;
        case 'p': case 'P': _vpTryPiP(); break;
      }
    };
    document.addEventListener('keydown', _vpKeyHandler);
    // Double-tap seek zones (active only in cinema mode via CSS pointer-events)
    let _tapTimer = null, _tapSide = null;
    const seekZones = document.getElementById('vp-seek-zones');
    if (seekZones) {
      seekZones.addEventListener('click', e => {
        const rect = seekZones.getBoundingClientRect();
        const side = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
        if (_tapTimer !== null && _tapSide === side) {
          clearTimeout(_tapTimer); _tapTimer = null; _tapSide = null;
          const secs = side === 'right' ? 10 : -10;
          if (_ytPlayerReady && _ytPlayer) _ytPlayer.seekTo(Math.max(0, (_ytPlayer.getCurrentTime() || 0) + secs), true);
          const flash = document.getElementById(side === 'right' ? 'vp-seek-flash-r' : 'vp-seek-flash-l');
          if (flash) { flash.classList.add('vp-seek-active'); setTimeout(() => flash.classList.remove('vp-seek-active'), 700); }
        } else {
          _tapSide = side;
          _tapTimer = setTimeout(() => { _tapTimer = null; _tapSide = null; }, 320);
        }
      });
    }
  }

  function _vpTryPiP() {
    try {
      if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
      const iframe = document.getElementById('vp-iframe');
      const vid = iframe?.contentDocument?.querySelector('video');
      if (vid?.requestPictureInPicture) { vid.requestPictureInPicture().catch(() => {}); return; }
    } catch (e) {}
    toast('Picture-in-Picture not available for this video', 'info', 2500);
  }

  function openVideoPlayer(groupId, itemId, _directItem) {
    let group = null, item = null;
    if (_directItem) {
      item = _directItem;
    } else {
      group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
      item = group.items.find(i => i.id === itemId); if (!item) return;
    }
    if (!item.url) return;

    document.getElementById('vp-overlay')?.remove();
    const el = document.createElement('div');
    el.id = 'vp-overlay';
    el.innerHTML = _buildPlayerOverlay(item, group, groupId, itemId);
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    _vpInitPlayer(el);
    _startEyeBreakTimer();
    if (item.videoId) { loadYTApi(); setTimeout(tryBindYTPlayer, 900); }
  }

  function openQuickPlayer(url) {
    const { videoId, playlistId } = parseYouTubeUrl(url);
    const type = (playlistId && !videoId) ? 'playlist' : videoId ? 'video' : 'external';
    const title = type === 'external' ? extractSiteName(url) : type === 'playlist' ? 'Playlist' : 'Video';
    const item = { id: '__quick__', title, url, videoId: videoId || null, playlistId: playlistId || null, type, notes: [], description: '' };
    openVideoPlayer(null, null, item);
  }

  function closeVideoPlayer() {
    stopVfm();
    _stopEyeBreakTimer();
    _ytPlayer = null; _ytPlayerReady = false; _ytPlayerState = -1;
    clearTimeout(_vpHudTimer); _vpHudTimer = null; _vpCinema = false;
    if (_vpKeyHandler) { document.removeEventListener('keydown', _vpKeyHandler); _vpKeyHandler = null; }
    const el = document.getElementById('vp-overlay'); if (!el) return;
    el.classList.add('vp-closing');
    setTimeout(() => { el.remove(); document.body.style.overflow = ''; lockPortrait(); }, 210);
  }

  function switchVideoInPlayer(groupId, itemId) {
    const group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
    const item = group.items.find(i => i.id === itemId); if (!item) return;
    const embedUrl = buildEmbedUrl(item);
    if (!embedUrl) { window.open(item.url, '_blank', 'noopener'); return; }
    const isExternal = item.type === 'external';
    const typeLabel = item.type === 'playlist' ? '📋 Playlist' : isExternal ? `🌐 ${extractSiteName(item.url)}` : '🎬 Video';

    // Swap iframe
    const iframe = document.getElementById('vp-iframe');
    if (iframe) iframe.src = embedUrl;

    // Update header
    const hTitle = document.querySelector('.vp-header-title');
    if (hTitle) hTitle.textContent = item.title;
    const ytBtn = document.querySelector('.vp-yt-btn');
    if (ytBtn) ytBtn.href = item.url;

    // Update info block
    const infoType  = document.querySelector('.vp-info-type');
    const infoTitle = document.querySelector('.vp-info-title');
    const infoDesc  = document.querySelector('.vp-info-desc');
    if (infoType)  infoType.textContent  = typeLabel;
    if (infoTitle) infoTitle.textContent = item.title;
    if (infoDesc)  { infoDesc.textContent = item.description || ''; infoDesc.style.display = item.description ? '' : 'none'; }

    // Update playlist active state
    document.querySelectorAll('.vp-playlist-item').forEach(el => {
      const isActive = el.dataset.iid === itemId;
      el.classList.toggle('vp-active', isActive);
      el.dataset.act = isActive ? '' : 'vp-switch';
      const right = el.querySelector('.vp-now-playing, .vp-playlist-play');
      if (right) right.outerHTML = isActive
        ? `<div class="vp-now-playing"><div class="vp-now-playing-dot"></div>Playing</div>`
        : `<div class="vp-playlist-play">${SVG_PLAY}</div>`;
    });

    // Update both notes columns (desktop col + mobile)
    const newNotes = vpNotesHTML(groupId, item);
    const desktopCol = document.getElementById('vp-notes-col');
    if (desktopCol) desktopCol.innerHTML = newNotes;
    const mobileNotes = document.querySelector('.vp-notes-mobile');
    if (mobileNotes) mobileNotes.innerHTML = newNotes;

    // Rebind YT player to new video
    _ytPlayer = null; _ytPlayerReady = false; _ytPlayerState = -1;
    if (item.videoId) setTimeout(tryBindYTPlayer, 900);

    // Scroll main panel back to top
    document.querySelector('#vp-overlay .vp-main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ========== Revision ==========
  function renderRevision() {
    const view = document.getElementById('view-revision'); if (!view) return;
    const dueItems = dueRevisionItems(), upcoming = upcomingRevisionItems(8);
    view.innerHTML = `<div class="page-header"><h1>Revision</h1><div class="subtitle">Spaced repetition schedule</div></div><div class="section-head"><h2>Due Today${dueItems.length ? ` (${dueItems.length})` : ''}</h2></div>${!dueItems.length ? `<div class="empty">No revisions due — great work!</div>` : `<div class="list">${dueItems.map(item => `<div class="card card-row revision-item is-overdue"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px">${item.daysOverdue > 0 ? `<span class="pill pill-overdue">${item.daysOverdue}d overdue</span>` : `<span class="pill pill-today">Due today</span>`}</div></div><div style="display:flex;gap:6px"><button class="btn btn-sm" data-act="rev-done" data-rev="${item.revisionId}" data-off="${item.step.offset}">${ic('check')}</button><button class="menu-btn" data-act="rev-dismiss" data-rev="${item.revisionId}">${ic('trash')}</button></div></div>`).join('')}</div>`}<div class="section-head"><h2>Upcoming</h2></div>${!upcoming.length ? `<div class="empty">No upcoming revisions scheduled.</div>` : `<div class="list">${upcoming.map(item => `<div class="card card-row revision-item upcoming"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px"><span class="pill pill-upcoming">In ${item.daysUntil}d · ${formatDate(item.step.dueDate)}</span></div></div></div>`).join('')}</div>`}`;
  }

  // ========== Rank System ==========
  const RANK_TIERS = [
    { label: 'Seeker',      icon: '🌱', color: '#94a3b8', glow: 'rgba(148,163,184,0.45)', minHrs: 0,    maxHrs: 5,    group: 'Novice'  },
    { label: 'Apprentice',  icon: '📖', color: '#6ee7b7', glow: 'rgba(110,231,183,0.45)', minHrs: 5,    maxHrs: 15,   group: 'Novice'  },
    { label: 'Disciple',    icon: '🕯️', color: '#67e8f9', glow: 'rgba(103,232,249,0.45)', minHrs: 15,   maxHrs: 30,   group: 'Novice'  },
    { label: 'Scholar',     icon: '🎓', color: '#93c5fd', glow: 'rgba(147,197,253,0.45)', minHrs: 30,   maxHrs: 50,   group: 'Adept'   },
    { label: 'Tactician',   icon: '♟️', color: '#818cf8', glow: 'rgba(129,140,248,0.5)',  minHrs: 50,   maxHrs: 75,   group: 'Adept'   },
    { label: 'Sage',        icon: '🔮', color: '#c084fc', glow: 'rgba(192,132,252,0.5)',  minHrs: 75,   maxHrs: 100,  group: 'Adept'   },
    { label: 'Catalyst',    icon: '⚡', color: '#e879f9', glow: 'rgba(232,121,249,0.55)', minHrs: 100,  maxHrs: 150,  group: 'Elite'   },
    { label: 'Visionary',   icon: '🌙', color: '#f9a8d4', glow: 'rgba(249,168,212,0.55)', minHrs: 150,  maxHrs: 200,  group: 'Elite'   },
    { label: 'Artisan',     icon: '🛠️', color: '#fde68a', glow: 'rgba(253,230,138,0.55)', minHrs: 200,  maxHrs: 250,  group: 'Elite'   },
    { label: 'Grandmaster', icon: '👑', color: '#fbbf24', glow: 'rgba(251,191,36,0.6)',   minHrs: 250,  maxHrs: 350,  group: 'Master'  },
    { label: 'Sovereign',   icon: '🏛️', color: '#f97316', glow: 'rgba(249,115,22,0.6)',   minHrs: 350,  maxHrs: 500,  group: 'Master'  },
    { label: 'Ascendant',   icon: '🌟', color: '#f87171', glow: 'rgba(248,113,113,0.6)',  minHrs: 500,  maxHrs: 750,  group: 'Master'  },
    { label: 'Paragon',     icon: '💎', color: '#60a5fa', glow: 'rgba(96,165,250,0.65)',  minHrs: 750,  maxHrs: 1000, group: 'Legend'  },
    { label: 'Immortal',    icon: '🔱', color: '#a78bfa', glow: 'rgba(167,139,250,0.65)', minHrs: 1000, maxHrs: 1500, group: 'Legend'  },
    { label: 'Eternal',     icon: '♾️', color: '#f0f6ff', glow: 'rgba(240,246,255,0.75)', minHrs: 1500, maxHrs: null, group: 'Legend'  },
  ];

  function calculateRank(totalHours) {
    let tierIdx = 0;
    for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
      if (totalHours >= RANK_TIERS[i].minHrs) { tierIdx = i; break; }
    }
    const tier = RANK_TIERS[tierIdx];
    const next = RANK_TIERS[tierIdx + 1] || null;
    const span = next ? (next.minHrs - tier.minHrs) : 1;
    const pct  = next ? Math.min(100, Math.round(((totalHours - tier.minHrs) / span) * 100)) : 100;
    const hrsToNext = next ? Math.max(0, Math.ceil(next.minHrs - totalHours)) : 0;
    return { ...tier, tierIndex: tierIdx, next, pct, hrsToNext };
  }

  let _lastRankIdx  = -1;
  let _hmViewDate   = null;  // Tracks which month the calendar is showing


  // ========== Stats (Enhanced A-Z Analysis) ==========
  function renderStats() {
    const view = document.getElementById('view-stats'); if (!view) return;
    const overall = overallProgress();
    let totalTopics = 0, doneTopics = 0, totalChapters = 0, doneChapters = 0, totalWeak = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) {
      totalChapters++; if (isChapterEffectivelyDone(ch)) doneChapters++;
      for (const t of ch.topics) { totalTopics++; if (t.done) doneTopics++; if (isWeakTopic(t)) totalWeak++; }
    }

    // Activity: 14-day bars (local-timezone keys)
    const days14Keys = buildDateRange(14);
    const days14 = days14Keys.map(k => {
      const d = new Date(k + 'T00:00:00');
      return { k, count: state.activity[k] || 0, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) };
    });
    const maxAct = Math.max(1, ...days14.map(d => d.count));

    // Focus stats
    const todayStr = todayKey();
    const totalFocusSessions = Object.values(state.focusStats.sessions || {}).reduce((a, b) => a + b, 0);
    const totalFocusMin = Object.values(state.focusStats.minutesByDate || {}).reduce((a, b) => a + b, 0);
    const todaySessions = state.focusStats.sessions[todayStr] || 0;
    const todayFocusMin = state.focusStats.minutesByDate[todayStr] || 0;

    // Streak stats (local-timezone keys)
    const bestStreak = state.streak.best || state.streak.count || 0;
    const last30Keys = buildDateRange(30);
    const activeDays30 = last30Keys.filter(k => (state.activity[k] || 0) > 0).length;

    // Off-day / missed-day tracking (since install date)
    const installDate30 = (state.burnout && state.burnout.installDate) || todayKey();
    const daysSinceInstall = Math.min(30, Math.max(0, daysBetween(installDate30, todayKey())));
    const missedDays30 = (() => {
      let c = 0;
      for (let i = 1; i <= daysSinceInstall; i++) {
        if ((state.activity[addDaysISO(todayKey(), -i)] || 0) === 0) c++;
      }
      return c;
    })();

    // Revisions
    const totalRevDone = state.revisions.reduce((a, r) => a + r.schedule.filter(s => s.done).length, 0);
    const totalRevPending = dueRevisionItems().length;

    // Most studied (by completed topics count)
    const subjectRankings = state.subjects.map(sub => {
      let topTot = 0, topDn = 0, revCount = 0;
      for (const ch of sub.chapters) for (const t of ch.topics) { topTot++; if (t.done) topDn++; }
      for (const r of state.revisions) if (r.subId === sub.id) revCount += r.schedule.filter(s => s.done).length;
      return { sub, topTot, topDn, revCount, score: topDn + revCount };
    }).sort((a, b) => b.score - a.score);

    // Per-subject detailed stats
    const subjectCards = state.subjects.length ? state.subjects.map(sub => {
      let tot = 0, dn = 0, topTot = 0, topDn = 0, weakCount = 0, revCount = 0;
      for (const ch of sub.chapters) {
        tot++; if (isChapterEffectivelyDone(ch)) dn++;
        for (const t of ch.topics) { topTot++; if (t.done) topDn++; if (isWeakTopic(t)) weakCount++; }
      }
      for (const r of state.revisions) if (r.subId === sub.id) revCount += r.schedule.filter(s => s.done).length;
      const pct = tot ? Math.round((dn/tot)*100) : 0;
      const tpct = topTot ? Math.round((topDn/topTot)*100) : 0;
      const pri = sub.priority;
      const priPill = pri ? `<span class="pill pill-${pri === 'high' ? 'high' : pri === 'medium' ? 'med' : 'low'}">${pri}</span>` : '';
      return `<div class="card stats-subject-card" style="padding:13px 14px;margin-bottom:10px;border-left:3px solid ${sub.color}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="color-dot" style="background:${sub.color}"></span>
          <span style="font-weight:700;flex:1;font-size:15px">${escapeHTML(sub.name)}</span>
          ${priPill}<span style="font-weight:800;color:var(--primary);font-size:17px">${pct}%</span>
        </div>
        <div class="progress" style="margin-bottom:4px"><span style="width:${pct}%"></span></div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">${dn}/${tot} chapters · ${topDn}/${topTot} topics</div>
        <div class="stats-subject-grid">
          <div class="stat-mini"><div class="v">${tpct}%</div><div class="k">Topics</div></div>
          <div class="stat-mini"><div class="v" style="${weakCount > 0 ? 'color:#f59e0b' : ''}">${weakCount}</div><div class="k">Weak</div></div>
          <div class="stat-mini"><div class="v" style="color:var(--primary)">${revCount}</div><div class="k">Revisions</div></div>
          <div class="stat-mini"><div class="v">${dn}/${tot}</div><div class="k">Chapters</div></div>
        </div>
        ${sub.notes ? `<div class="notes" style="margin-top:8px;font-size:12px">${escapeHTML(sub.notes)}</div>` : ''}
      </div>`;
    }).join('') : `<div class="empty">No subjects yet.</div>`;

    // Study consistency (% of tracked days active, using installDate as floor)
    const consistencyPct = daysSinceInstall === 0 ? 0 : Math.min(100, Math.round((activeDays30 / daysSinceInstall) * 100));
    const consistencyLabel = consistencyPct >= 80 ? '🔥 Excellent' : consistencyPct >= 50 ? '👍 Good' : consistencyPct >= 25 ? '📈 Building' : '🌱 Just Starting';

    // Topic health breakdown
    let topicDone = 0, topicWeak = 0, topicRemaining = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) for (const t of ch.topics) {
      if (t.done) topicDone++;
      else if (isWeakTopic(t)) topicWeak++;
      else topicRemaining++;
    }
    const topicTotal = topicDone + topicWeak + topicRemaining || 1;

    // 7-day focus trend — LOCAL timezone keys only, zero day-offset guarantee
    const videoMins = state.focusStats.videoMinutes || {};
    const days7Keys = buildDateRange(7); // [6-days-ago … today], all local-ISO
    const days7 = days7Keys.map(k => {
      const d = new Date(k + 'T00:00:00');
      return {
        k,
        min:      state.focusStats.minutesByDate[k] || 0,
        vmin:     videoMins[k] || 0,
        sessions: state.focusStats.sessions[k] || 0,
        label:    d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)
      };
    });
    const maxFocus7 = Math.max(1, ...days7.map(d => d.min));

    // Classroom time stats
    const classroomMinToday = videoMins[todayStr] || 0;
    const classroomMinWeek  = days7.reduce((a, d) => a + d.vmin, 0);
    const classroomMinTotal = Object.values(videoMins).reduce((a, b) => a + b, 0);
    const classroomFmt = m => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
    const avgFocusMin = days7.length ? Math.round(days7.reduce((a, b) => a + b.min, 0) / days7.length) : 0;

    // Best study day of week (last 60 days) — local-timezone keys
    const dayTotals = [0,0,0,0,0,0,0]; const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const last60Keys = buildDateRange(60);
    last60Keys.forEach(k => { const dow = new Date(k + 'T00:00:00').getDay(); dayTotals[dow] += (state.activity[k] || 0); });
    const bestDayIdx = dayTotals.indexOf(Math.max(...dayTotals));
    const bestDay = dayNames[bestDayIdx];

    // Exam readiness cards
    const examCards = state.exams.length ? state.exams.map(ex => {
      const daysLeft = Math.ceil((new Date(ex.date + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000);
      const risk = daysLeft < 7 ? 'high' : daysLeft < 21 ? 'medium' : 'low';
      const riskColor = risk === 'high' ? '#f47364' : risk === 'medium' ? '#f59e0b' : '#22c55e';
      const riskLabel = risk === 'high' ? '⚠️ Urgent' : risk === 'medium' ? '⏳ On Track' : '✅ Comfortable';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${escapeHTML(ex.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${ex.date} · ${daysLeft > 0 ? daysLeft + 'd left' : daysLeft === 0 ? 'Today!' : Math.abs(daysLeft) + 'd ago'}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${riskColor};background:${riskColor}18;border-radius:99px;padding:3px 9px">${riskLabel}</span>
      </div>`;
    }).join('') : '';

    // Best & worst subject
    const rankedByPct = state.subjects.map(sub => {
      let tot = sub.chapters.length, dn = sub.chapters.filter(c => isChapterEffectivelyDone(c)).length;
      return { sub, pct: tot ? Math.round((dn/tot)*100) : 0 };
    }).filter(x => x.sub.chapters.length > 0).sort((a, b) => b.pct - a.pct);
    const bestSub = rankedByPct[0];
    const worstSub = rankedByPct[rankedByPct.length - 1];

    // Most studied subjects chart
    const mostStudiedHtml = subjectRankings.length ? `
      <h2 style="margin:16px 0 10px">Subject Progress</h2>
      <div class="card" style="padding:13px 14px">
        ${subjectRankings.map((sr, i) => {
          const pct = sr.topTot ? Math.round((sr.topDn / sr.topTot) * 100) : 0;
          const chPct = sr.sub.chapters.length ? Math.round((sr.sub.chapters.filter(c => isChapterEffectivelyDone(c)).length / sr.sub.chapters.length) * 100) : 0;
          return `<div style="margin-bottom:${i < subjectRankings.length - 1 ? '14px' : '0'}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span class="color-dot" style="background:${sr.sub.color}"></span>
              <span style="font-size:13px;font-weight:700;flex:1">${escapeHTML(sr.sub.name)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${sr.topDn}/${sr.topTot} topics</span>
              <span style="font-size:13px;font-weight:800;color:${sr.sub.color}">${chPct}%</span>
            </div>
            <div class="progress"><span style="width:${chPct}%;background:${sr.sub.color}"></span></div>
          </div>`;
        }).join('')}
      </div>` : '';

    // A-Z Syllabus Progress
    const syllabusProgressHtml = `
      <h2 style="margin:16px 0 10px">Syllabus Overview</h2>
      <div class="card" style="padding:13px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:14px;font-weight:700">Overall Completion</span>
          <span style="font-size:22px;font-weight:900;color:var(--primary)">${overall}%</span>
        </div>
        <div class="progress" style="height:10px;margin-bottom:12px"><span style="width:${overall}%"></span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:14px">
          <div><div style="font-size:18px;font-weight:800;color:#22c55e">${doneTopics}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Topics Done</div></div>
          <div><div style="font-size:18px;font-weight:800;color:#f59e0b">${totalWeak}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Weak</div></div>
          <div><div style="font-size:18px;font-weight:800">${totalTopics - doneTopics - totalWeak}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Not Started</div></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:5px;font-weight:600">TOPIC HEALTH</div>
        <div style="display:flex;height:10px;border-radius:99px;overflow:hidden;gap:2px">
          <div style="flex:${topicDone};background:#22c55e;border-radius:99px;transition:flex 0.4s"></div>
          <div style="flex:${topicWeak};background:#f59e0b;border-radius:99px;transition:flex 0.4s"></div>
          <div style="flex:${topicRemaining};background:#334155;border-radius:99px;transition:flex 0.4s"></div>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--text-muted)">
          <span><span style="color:#22c55e">■</span> Done ${Math.round(topicDone/topicTotal*100)}%</span>
          <span><span style="color:#f59e0b">■</span> Weak ${Math.round(topicWeak/topicTotal*100)}%</span>
          <span><span style="color:#475569">■</span> Remaining ${Math.round(topicRemaining/topicTotal*100)}%</span>
        </div>
      </div>`;

    // ── Premium stats extra computations ─────────────────────────
    const totalFocusHours = totalFocusMin / 60;
    const testHrs = state.rankTestHours || 0;
    const rank = calculateRank(totalFocusHours + testHrs);
    const focusDisplay = totalFocusMin >= 60
      ? `${Math.floor(totalFocusMin / 60)}h${totalFocusMin % 60 ? ' ' + (totalFocusMin % 60) + 'm' : ''}`
      : `${totalFocusMin}m`;

    // Neon palette for subject distribution — distinct colors regardless of stored subject color
    const NEON_PALETTE = ['#00e5ff','#ff4d9e','#00ff88','#ffd600','#7c4dff','#ff6d00','#40c4ff','#f50057','#69ff47','#ff9100'];

    // Pie: subjects with completed chapters, using distinct neon colors by index
    const pieSubjects = state.subjects.map((sub, idx) => {
      let done = 0;
      for (const ch of sub.chapters) if (isChapterEffectivelyDone(ch)) done++;
      return { name: sub.name, done, color: NEON_PALETTE[idx % NEON_PALETTE.length] };
    }).filter(s => s.done > 0);

    const planTasks = getActivePlanTasks();
    const planDone = planTasks.filter(t => t.done).length;
    const planTotal = planTasks.length;
    const taskEffPct = planTotal > 0 ? Math.min(100, Math.round((planDone / planTotal) * 100)) : 0;
    const focusEffPct = Math.min(100, Math.round((todayFocusMin / 120) * 100));
    const efficiencyPct = Math.round(taskEffPct * 0.5 + focusEffPct * 0.5);
    const effColor = efficiencyPct >= 80 ? '#4ade80' : efficiencyPct >= 50 ? '#38bdf8' : efficiencyPct >= 25 ? '#f59e0b' : '#f87171';
    const effLabel = efficiencyPct >= 80 ? '🔥 Outstanding — keep pushing!' : efficiencyPct >= 50 ? '👍 Good — steady progress!' : efficiencyPct >= 25 ? '📈 Building momentum' : '🌱 Get started — you\'ve got this!';

    view.innerHTML = `
      <div class="page-header"><h1>Stats</h1><div class="subtitle">Premium study analytics</div></div>

      <div class="stats-glass-row">
        <div class="stats-glass-card" style="border-color:${rank.color}44">
          <div class="sgc-icon">⏱</div>
          <div class="sgc-value">${focusDisplay || '0m'}</div>
          <div class="sgc-label">Total Focus</div>
        </div>
        <div class="stats-glass-card">
          <div class="sgc-icon">🍅</div>
          <div class="sgc-value">${totalFocusSessions}</div>
          <div class="sgc-label">Pomodoros</div>
        </div>
        <div class="stats-glass-card sgc-rank-card" style="border-color:${rank.color}44">
          <div class="sgc-icon" style="filter:drop-shadow(0 0 7px ${rank.glow})">${rank.icon}</div>
          <div class="sgc-value sgc-rank" style="color:${rank.color}">${rank.label}</div>
          <div class="sgc-label">${rank.group} Tier</div>
        </div>
      </div>

      <div class="rank-showcase" id="rank-showcase" style="--rc:${rank.color};--rg:${rank.glow}">
        <div class="rs-left">
          <div class="rs-badge" id="rs-badge">${rank.icon}</div>
          <div class="rs-group-pill" style="background:${rank.color}22;color:${rank.color}">${rank.group}</div>
        </div>
        <div class="rs-body">
          <div class="rs-name-row">
            <span class="rs-name" style="color:${rank.color}">${rank.label}</span>
            <span class="rs-tier-idx" style="color:${rank.color}99">#${rank.tierIndex + 1}&thinsp;/&thinsp;${RANK_TIERS.length}</span>
          </div>
          <div class="rs-next">${rank.next
            ? `${rank.hrsToNext}h more unlocks ${rank.next.icon} <strong style="color:${rank.next.color}">${rank.next.label}</strong>`
            : `<span style="color:${rank.color}">✦ Maximum rank achieved — you are Eternal ✦</span>`
          }</div>
          <div class="rs-bar-track">
            <div class="rs-bar-fill" style="width:${rank.pct}%;background:linear-gradient(90deg,${rank.color}88,${rank.color})"></div>
          </div>
          <div class="rs-bar-labels">
            <span>${rank.minHrs}h</span>
            <span style="color:${rank.color};font-weight:700">${rank.pct}%</span>
            ${rank.next ? `<span>${rank.next.minHrs}h</span>` : ''}
          </div>
        </div>
      </div>

      <div class="stats-section-head" style="margin-top:10px"><span>⚡ Daily Efficiency</span><span class="stats-section-meta">${efficiencyPct >= 80 ? '🔥 On fire!' : efficiencyPct >= 50 ? '👍 Good' : '📈 Keep going'}</span></div>
      <div class="stats-chart-card efficiency-card">
        <div class="eff-score-row">
          <div class="eff-score-circle">
            <svg viewBox="0 0 56 56" class="eff-svg">
              <circle class="eff-track" cx="28" cy="28" r="22"/>
              <circle class="eff-fill" cx="28" cy="28" r="22" stroke-dasharray="${(2*Math.PI*22).toFixed(1)}" stroke-dashoffset="${((1-efficiencyPct/100)*2*Math.PI*22).toFixed(1)}" style="stroke:${effColor}"/>
            </svg>
            <span class="eff-pct-label" style="color:${effColor}">${efficiencyPct}%</span>
          </div>
          <div class="eff-breakdown">
            <div class="eff-row"><span>Tasks</span><div class="eff-mini-bar"><div style="width:${taskEffPct}%;background:#a78bfa"></div></div><span>${taskEffPct}%</span></div>
            <div class="eff-row"><span>Focus</span><div class="eff-mini-bar"><div style="width:${focusEffPct}%;background:#38bdf8"></div></div><span>${focusEffPct}%</span></div>
          </div>
        </div>
        <div class="eff-label">${escapeHTML(effLabel)}</div>
      </div>

      <div class="stats-chart-pair">
        <div class="stats-chart-half">
          <div class="stats-section-head"><span>Weekly Focus (HRS)</span><span class="stats-section-meta stats-weekly-meta">${minsToHrs(days7.reduce((a, b) => a + b.min, 0))} this week</span></div>
          <div class="stats-chart-card"><div class="stats-chart-wrap"><canvas id="stats-weekly-chart"></canvas></div></div>
        </div>
        <div class="stats-chart-half">
          <div class="stats-section-head"><span>Subject Distribution</span><span class="stats-section-meta">by chapters done</span></div>
          <div class="stats-chart-card">${pieSubjects.length
            ? `<div class="stats-pie-wrap"><canvas id="stats-pie-chart"></canvas></div>`
            : `<div class="stats-empty-chart">Complete topics to see distribution</div>`}</div>
        </div>
      </div>

      <div class="stats-section-head" style="margin-top:18px"><span>🎓 Classroom Time</span><span class="stats-section-meta stats-classroom-meta">${classroomFmt(classroomMinToday)} today</span></div>
      <div class="stats-chart-card">
        <div class="stats-chart-wrap"><canvas id="stats-classroom-chart"></canvas></div>
        <div class="stats-row" style="margin-top:10px">
          <div class="stat-tile"><div class="v">${classroomFmt(classroomMinToday)}</div><div class="k">Today</div></div>
          <div class="stat-tile"><div class="v">${classroomFmt(classroomMinWeek)}</div><div class="k">This Week</div></div>
          <div class="stat-tile"><div class="v">${classroomFmt(classroomMinTotal)}</div><div class="k">All Time</div></div>
        </div>
      </div>

      ${(() => {
        const subjectMins = state.focusStats.minutesBySubject || {};
        const entries = state.subjects
          .filter(s => (subjectMins[s.id] || 0) > 0)
          .map(s => ({ name: s.name, color: s.color, min: subjectMins[s.id] }))
          .sort((a, b) => b.min - a.min);
        if (!entries.length) return '';
        const maxMin = entries[0].min;
        return `<div class="stats-section-head" style="margin-top:18px"><span>🎯 Focus by Subject</span><span class="stats-section-meta">all time</span></div>
        <div class="stats-chart-card" style="padding:14px 16px">
          ${entries.map(e => `<div style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span class="color-dot" style="background:${e.color}"></span>
              <span style="font-size:13px;font-weight:700;flex:1">${escapeHTML(e.name)}</span>
              <span style="font-size:12px;font-weight:800;color:${e.color}">${minsToHrs(e.min)}</span>
            </div>
            <div class="progress" style="height:7px"><span style="width:${Math.round(e.min/maxMin*100)}%;background:${e.color}"></span></div>
          </div>`).join('')}
        </div>`;
      })()}

      <div class="stats-section-head"><span>📅 Focus Calendar</span><span class="stats-section-meta" id="cal-focus-summary"></span></div>
      <div class="stats-chart-card stats-cal-card">
        <div class="cal-header">
          <button class="cal-nav-btn" id="cal-prev" aria-label="Previous month">&#8249;</button>
          <span class="cal-month-label" id="cal-month-label"></span>
          <button class="cal-nav-btn" id="cal-next" aria-label="Next month">&#8250;</button>
        </div>
        <div class="cal-day-headers">
          <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
        </div>
        <div class="cal-grid" id="cal-grid" role="grid" aria-label="Focus calendar"></div>
        <div class="cal-tooltip" id="cal-tooltip"></div>
        <div class="stats-hm-legend" style="margin-top:10px">
          <div class="hm-off-legend"><div class="shm-cell lv-off"></div><span>Off Day</span></div>
          <span class="hm-lgd-txt" style="margin-left:4px">Less</span>
          <div class="shm-cell lv0"></div><div class="shm-cell lv1"></div><div class="shm-cell lv2"></div><div class="shm-cell lv3"></div><div class="shm-cell lv4"></div><div class="shm-cell lv5"></div>
          <span class="hm-lgd-txt">More</span>
          <div class="hm-lgd-scale"><span style="color:rgba(248,113,113,.75)">Off</span><span>0h</span><span style="color:rgba(167,108,255,.95)">1–3h</span><span style="color:rgba(6,182,212,.95)">3–6h</span><span style="color:#4ade80">6–9h</span><span style="color:#f97316">9–12h</span><span style="color:#ef4444">12h+</span></div>
        </div>
      </div>

      <div class="stats-row" style="margin-top:16px">
        <div class="stat-tile"><div class="v">${overall}%</div><div class="k">Overall</div></div>
        <div class="stat-tile" data-live="streak"><div class="v live-streak-count">${state.streak.count} 🔥</div><div class="k">Streak</div></div>
        <div class="stat-tile"><div class="v">${consistencyPct}%</div><div class="k">Consistency</div></div>
        <div class="stat-tile"><div class="v">${activeDays30}/${daysSinceInstall || 1}</div><div class="k">Active Days</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${doneTopics}/${totalTopics}</div><div class="k">Topics</div></div>
        <div class="stat-tile"><div class="v">${doneChapters}/${totalChapters}</div><div class="k">Chapters</div></div>
        <div class="stat-tile" style="${totalWeak > 0 ? 'border-color:#f59e0b33' : ''}"><div class="v" style="${totalWeak > 0 ? 'color:#f59e0b' : ''}">${totalWeak}</div><div class="k">Weak Topics</div></div>
        <div class="stat-tile"><div class="v">${totalRevDone}</div><div class="k">Revisions</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${todaySessions}</div><div class="k">Today Sessions</div></div>
        <div class="stat-tile" data-live="today-focus"><div class="v">${minsToHrs(todayFocusMin)}</div><div class="k">Today Focus</div></div>
        <div class="stat-tile"><div class="v">${totalFocusSessions}</div><div class="k">All Sessions</div></div>
        <div class="stat-tile" data-live="total-focus"><div class="v">${minsToHrs(avgFocusMin)}</div><div class="k">Avg / Day</div></div>
      </div>

      ${syllabusProgressHtml}

      ${bestSub || worstSub ? `
      <h2 style="margin:16px 0 10px">Subject Highlights</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${bestSub ? `<div class="card" style="padding:12px 13px;border-left:3px solid #22c55e">
          <div style="font-size:10px;color:#22c55e;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Leading</div>
          <div style="font-weight:700;font-size:13px">${escapeHTML(bestSub.sub.name)}</div>
          <div style="font-size:20px;font-weight:900;color:#22c55e;margin-top:2px">${bestSub.pct}%</div>
        </div>` : ''}
        ${worstSub && worstSub !== bestSub ? `<div class="card" style="padding:12px 13px;border-left:3px solid #f59e0b">
          <div style="font-size:10px;color:#f59e0b;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Needs Focus</div>
          <div style="font-weight:700;font-size:13px">${escapeHTML(worstSub.sub.name)}</div>
          <div style="font-size:20px;font-weight:900;color:#f59e0b;margin-top:2px">${worstSub.pct}%</div>
        </div>` : ''}
      </div>` : ''}

      <h2 style="margin:16px 0 10px">Study Consistency</h2>
      <div class="card" style="padding:13px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div><div style="font-size:13px;font-weight:700">${daysSinceInstall <= 1 ? 'Today' : `Last ${daysSinceInstall} Days`}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${consistencyLabel}</div></div>
          <div style="font-size:24px;font-weight:900;color:var(--primary)">${consistencyPct}%</div>
        </div>
        <div class="progress" style="height:8px"><span style="width:${consistencyPct}%"></span></div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--text-muted)">
          <span>${activeDays30} active · <span style="color:rgba(248,113,113,.8)">${missedDays30} off-day${missedDays30 !== 1 ? 's' : ''}</span></span>
          <span>Best day: ${bestDay}</span>
        </div>
      </div>

      ${state.exams.length ? `
      <h2 style="margin:16px 0 10px">Exam Readiness</h2>
      <div class="card" style="padding:4px 14px">${examCards}</div>` : ''}

      ${mostStudiedHtml}

      <h2 style="margin:16px 0 8px">Activity (14 days)</h2>
      <div class="card" style="padding:13px 14px">
        <div class="bars">${days14.map(d => `<div class="bar" style="height:${Math.max(8, Math.round((d.count / maxAct) * 100))}%;opacity:${d.count ? '0.9' : '0.2'}" title="${d.k}: ${d.count} actions"></div>`).join('')}</div>
        <div class="lbls">${days14.map(d => `<div class="lbl">${d.label}</div>`).join('')}</div>
      </div>

      <h2 style="margin:16px 0 10px">By Subject</h2>
      ${subjectCards}

      <h2 style="margin:16px 0 10px">🏅 Achievements</h2>
      ${(() => {
        const tierDefs = [
          { key: 'easy',   label: 'Easy',   medal: '🥉', color: '#22c55e', xp: 50  },
          { key: 'medium', label: 'Medium', medal: '🥈', color: '#38bdf8', xp: 150 },
          { key: 'hard',   label: 'Hard',   medal: '🥇', color: '#f59e0b', xp: 500 },
        ];
        return tierDefs.map(tier => {
          const tierAchs = ACHIEVEMENTS.filter(a => a.tier === tier.key);
          const unlockedCount = tierAchs.filter(a => !!(state.badges && state.badges[a.id])).length;
          return `<div class="ach-tier-section">
            <div class="ach-tier-header" style="--tc:${tier.color}">
              <span class="ach-tier-medal">${tier.medal}</span>
              <span class="ach-tier-name">${tier.label}</span>
              <span class="ach-tier-xp">+${tier.xp} XP each</span>
              <span class="ach-tier-count" style="color:${tier.color}">${unlockedCount}/${tierAchs.length}</span>
            </div>
            <div class="badge-grid">
              ${tierAchs.map(a => {
                const unlocked = !!(state.badges && state.badges[a.id]);
                const dateStr = unlocked ? new Date(state.badges[a.id].unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                return `<div class="badge-card ${unlocked ? 'badge-unlocked' : 'badge-locked'}" style="${unlocked ? `--bc:${tier.color};border-color:${tier.color}44;background:${tier.color}0d` : ''}">
                  <div class="badge-icon" style="${unlocked ? `filter:drop-shadow(0 0 6px ${tier.color}88)` : ''}">${a.icon}</div>
                  <div class="badge-name">${escapeHTML(a.name)}</div>
                  <div class="badge-desc">${escapeHTML(a.desc)}</div>
                  ${unlocked ? `<div class="badge-date" style="color:${tier.color}">${dateStr}</div>` : `<div class="badge-locked-label">🔒 +${a.xp} XP</div>`}
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('');
      })()}

      <div class="backup-glass-card">
        <div class="bgc-header">
          <span class="bgc-icon">🛡️</span>
          <div>
            <div class="bgc-title">Data Backup &amp; Restore</div>
            <div class="bgc-sub">${hasBackupToday() ? '✅ Backed up today — your progress is safe.' : '⚠️ No backup today — protect your progress.'}</div>
          </div>
        </div>
        <div class="bgc-status-bar ${hasBackupToday() ? 'backed' : 'not-backed'}">
          ${hasBackupToday() ? `Last backup: ${todayKey()}` : 'Tap Download Backup to save your data'}
        </div>
        <div class="bgc-actions">
          <button class="bgc-btn bgc-btn-primary" data-act="backup-export">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Backup
          </button>
          <label class="bgc-btn bgc-btn-ghost" style="cursor:pointer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Restore Backup
            <input type="file" accept=".json" style="display:none" id="stats-import-file"/>
          </label>
        </div>
        <div class="bgc-hint">Exports all subjects, topics, focus stats, goals &amp; classroom data as a JSON file you can restore anytime.</div>
      </div>`;

    initStatsCharts(days7, pieSubjects, days7);
    generateCalendarHeatmap();
    checkBadges();

    // Rank-up glow: animate badge when rank tier increases
    if (rank.tierIndex > _lastRankIdx && _lastRankIdx >= 0) {
      const badge = document.getElementById('rs-badge');
      const card  = document.getElementById('rank-showcase');
      if (badge) { badge.classList.remove('rankup-pop'); void badge.offsetWidth; badge.classList.add('rankup-pop'); }
      if (card)  { card.classList.remove('rankup-glow');  void card.offsetWidth;  card.classList.add('rankup-glow');  }
    }
    _lastRankIdx = rank.tierIndex;
  }

  // ========== Full Calendar Heatmap ==========
  function generateCalendarHeatmap() {
    const grid = document.getElementById('cal-grid');
    if (!grid) return;

    const todayStr      = todayKey();
    const installStr    = (state.burnout && state.burnout.installDate) || todayStr;
    const now           = new Date();
    const currentYear   = now.getFullYear();
    const currentMonth  = now.getMonth();

    // Default to current month on first call
    if (!_hmViewDate) _hmViewDate = new Date(currentYear, currentMonth, 1);

    const viewYear  = _hmViewDate.getFullYear();
    const viewMonth = _hmViewDate.getMonth();

    // ── Month label & summary ──────────────────────────────────
    const labelEl = document.getElementById('cal-month-label');
    if (labelEl) labelEl.textContent = _hmViewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const monthPrefix = `${String(viewYear).padStart(4,'0')}-${String(viewMonth+1).padStart(2,'0')}`;
    let monthMin = 0;
    Object.entries(state.focusStats.minutesByDate || {}).forEach(([k, v]) => { if (k.startsWith(monthPrefix)) monthMin += v; });
    const summaryEl = document.getElementById('cal-focus-summary');
    if (summaryEl) summaryEl.textContent = monthMin > 0 ? minsToHrs(monthMin) + ' this month' : '';

    // ── Nav button states ──────────────────────────────────────
    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');
    const installDate  = new Date(installStr + 'T00:00:00');
    if (prevBtn) prevBtn.disabled = (viewYear < installDate.getFullYear() || (viewYear === installDate.getFullYear() && viewMonth <= installDate.getMonth()));
    if (nextBtn) nextBtn.disabled = (viewYear > currentYear || (viewYear === currentYear && viewMonth >= currentMonth));

    // ── Build cell data ────────────────────────────────────────
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    // ISO weekday offset: 0=Mon … 6=Sun
    const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null); // empty padding

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr   = `${monthPrefix}-${String(d).padStart(2,'0')}`;
      const isFuture  = dateStr > todayStr;
      const isToday   = dateStr === todayStr;
      const min       = state.focusStats.minutesByDate[dateStr] || 0;
      const hrs       = min / 60;
      const isOffDay  = !isFuture && !isToday && min === 0 && dateStr >= installStr;
      const lvl = isFuture  ? 'future'
        : isOffDay  ? 'lv-off'
        : min === 0 ? 'lv0'
        : hrs < 3   ? 'lv1'
        : hrs < 6   ? 'lv2'
        : hrs < 9   ? 'lv3'
        : hrs < 12  ? 'lv4'
        : 'lv5';
      const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const timeLabel = isFuture  ? '—'
        : isOffDay  ? 'No data recorded · Off-day'
        : min === 0 ? 'No focus yet'
        : min < 60  ? `${min}m focused`
        : `${Math.floor(min/60)}h${min%60 ? ' '+min%60+'m' : ''} focused`;
      cells.push({ d, dateStr, isFuture, isToday, isOffDay, lvl, dateLabel, timeLabel });
    }

    // ── Render grid ────────────────────────────────────────────
    grid.innerHTML = cells.map(c => {
      if (!c) return `<div class="cal-cell empty" aria-hidden="true"></div>`;
      const cls = ['cal-cell', c.lvl, c.isToday ? 'today' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" data-date="${c.dateStr}" data-date-label="${escapeHTML(c.dateLabel)}" data-time-label="${escapeHTML(c.timeLabel)}" role="gridcell" aria-label="${escapeHTML(c.dateLabel + ' · ' + c.timeLabel)}" tabindex="${c.isFuture ? -1 : 0}">${c.d}</div>`;
    }).join('');

    // ── Tooltip ────────────────────────────────────────────────
    const tooltip = document.getElementById('cal-tooltip');
    let _tipTimer = null;

    const showTip = (cell) => {
      if (!tooltip) return;
      clearTimeout(_tipTimer);
      tooltip.innerHTML = `<div class="ct-date">${cell.dataset.dateLabel}</div><div class="ct-time">${cell.dataset.timeLabel}</div>`;
      const rect = cell.getBoundingClientRect();
      let tx = rect.left + rect.width / 2 - 75;
      let ty = rect.top - 72;
      if (ty < 8) ty = rect.bottom + 8;
      if (tx < 8) tx = 8;
      if (tx + 160 > window.innerWidth) tx = window.innerWidth - 168;
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
      tooltip.classList.add('visible');
    };
    const hideTip = (delay = 0) => {
      _tipTimer = setTimeout(() => { if (tooltip) tooltip.classList.remove('visible'); }, delay);
    };

    grid.querySelectorAll('.cal-cell:not(.empty):not(.future)').forEach(cell => {
      cell.addEventListener('mouseenter', () => showTip(cell));
      cell.addEventListener('mouseleave', () => hideTip(120));
      cell.addEventListener('focus',      () => showTip(cell));
      cell.addEventListener('blur',       () => hideTip(200));
      cell.addEventListener('click',      () => { showTip(cell); hideTip(2500); });
    });

    // ── Nav buttons ────────────────────────────────────────────
    if (prevBtn) {
      prevBtn.onclick = () => {
        _hmViewDate = new Date(_hmViewDate.getFullYear(), _hmViewDate.getMonth() - 1, 1);
        generateCalendarHeatmap();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        _hmViewDate = new Date(_hmViewDate.getFullYear(), _hmViewDate.getMonth() + 1, 1);
        generateCalendarHeatmap();
      };
    }
  }

  function initStatsCharts(days7, pieSubjects, days7cls) {
    if (!window.Chart) { setTimeout(() => initStatsCharts(days7, pieSubjects, days7cls), 300); return; }

    // Shared chart defaults
    const CHART_ANIMATION = { duration: 600, easing: 'easeOutQuart' };
    const todayIdx = 6; // days7[6] is always today by construction

    // Helper: build per-bar colours with gradient-like brightness for current day
    function focusBarColors(arr, todayColor, pastColor, emptyColor) {
      return arr.map((d, i) => {
        if (i === todayIdx) return todayColor;
        const val = typeof d.min !== 'undefined' ? d.min : (d.vmin || 0);
        return val > 0 ? pastColor : emptyColor;
      });
    }

    // ── Weekly Focus bar chart ────────────────────────────────────────────────
    const weeklyCanvas = document.getElementById('stats-weekly-chart');
    if (weeklyCanvas) {
      const prev = Chart.getChart(weeklyCanvas); if (prev) prev.destroy();
      new Chart(weeklyCanvas, {
        type: 'bar',
        data: {
          labels: days7.map(d => d.label),
          datasets: [{
            data: days7.map(d => parseFloat((d.min / 60).toFixed(2))),
            backgroundColor: focusBarColors(days7, 'rgba(77,168,255,0.92)', 'rgba(77,168,255,0.44)', 'rgba(77,168,255,0.12)'),
            borderColor:     days7.map((_, i) => i === todayIdx ? '#4da8ff' : 'transparent'),
            borderWidth:     days7.map((_, i) => i === todayIdx ? 2 : 0),
            borderRadius:    8,
            borderSkipped:   false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: CHART_ANIMATION,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0d1b2a', borderColor: 'rgba(77,168,255,0.5)', borderWidth: 1,
              titleColor: '#f0f6ff', bodyColor: '#94a3b8', padding: 12,
              callbacks: {
                title: ctx => {
                  const d = days7[ctx[0].dataIndex];
                  const fullDay = new Date(d.k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
                  return `${fullDay}  (${d.k})`;
                },
                label: ctx => {
                  const d = days7[ctx.dataIndex];
                  const hrs = (d.min / 60).toFixed(1);
                  const s = d.sessions || 0;
                  return ` ${hrs}h  •  ${s} session${s !== 1 ? 's' : ''}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false }, border: { display: false },
              ticks: {
                color: days7.map((_, i) => i === todayIdx ? '#4da8ff' : 'rgba(148,163,184,0.75)'),
                font: { size: 11, weight: '600' }
              }
            },
            y: {
              min: 0, suggestedMax: 6,
              grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false },
              ticks: { color: 'rgba(148,163,184,0.6)', font: { size: 10 }, maxTicksLimit: 5, callback: v => v + 'h' }
            }
          }
        }
      });
    }

    // ── Classroom Time bar chart (lime / green) ───────────────────────────────
    const classroomCanvas = document.getElementById('stats-classroom-chart');
    if (classroomCanvas && days7cls) {
      const prev = Chart.getChart(classroomCanvas); if (prev) prev.destroy();
      // Build colours based on vmin (classroom has vmin, not min)
      const clsColors = days7cls.map((d, i) => {
        if (i === todayIdx)        return 'rgba(163,230,53,0.92)';
        if ((d.vmin || 0) > 0)    return 'rgba(163,230,53,0.44)';
        return 'rgba(163,230,53,0.12)';
      });
      new Chart(classroomCanvas, {
        type: 'bar',
        data: {
          labels: days7cls.map(d => d.label),
          datasets: [{
            data: days7cls.map(d => parseFloat(((d.vmin || 0) / 60).toFixed(2))),
            backgroundColor: clsColors,
            borderColor:     days7cls.map((_, i) => i === todayIdx ? '#a3e635' : 'transparent'),
            borderWidth:     days7cls.map((_, i) => i === todayIdx ? 2 : 0),
            borderRadius:    8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: CHART_ANIMATION,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0d1b2a', borderColor: 'rgba(163,230,53,0.5)', borderWidth: 1,
              titleColor: '#f0f6ff', bodyColor: '#94a3b8', padding: 12,
              callbacks: {
                title: ctx => {
                  const d = days7cls[ctx[0].dataIndex];
                  const fullDay = new Date(d.k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
                  return `${fullDay}  (${d.k})`;
                },
                label: ctx => {
                  const d = days7cls[ctx.dataIndex];
                  const mins = d.vmin || 0;
                  const hrs = (mins / 60).toFixed(1);
                  const sessions = d.sessions || 0;
                  return ` ${hrs}h  •  ${sessions} session${sessions !== 1 ? 's' : ''}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false }, border: { display: false },
              ticks: {
                color: days7cls.map((_, i) => i === todayIdx ? '#a3e635' : 'rgba(148,163,184,0.75)'),
                font: { size: 11, weight: '600' }
              }
            },
            y: {
              min: 0, beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false },
              ticks: { color: 'rgba(148,163,184,0.6)', font: { size: 10 }, maxTicksLimit: 4, callback: v => v + 'h' }
            }
          }
        }
      });
    }

    // Doughnut chart — each segment gets a distinct neon color
    const pieCanvas = document.getElementById('stats-pie-chart');
    if (pieCanvas && pieSubjects.length) {
      const prev = Chart.getChart(pieCanvas); if (prev) prev.destroy();
      new Chart(pieCanvas, {
        type: 'doughnut',
        data: {
          labels: pieSubjects.map(s => s.name),
          datasets: [{
            data: pieSubjects.map(s => s.done),
            backgroundColor: pieSubjects.map(s => s.color + 'cc'),
            borderColor: pieSubjects.map(s => s.color),
            borderWidth: 2,
            hoverOffset: 12
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: 'rgba(148,163,184,0.9)', font: { size: 12, weight: '700' }, padding: 16, usePointStyle: true, pointStyleWidth: 10 }
            },
            tooltip: {
              backgroundColor: '#0d1b2a', borderColor: 'rgba(77,168,255,0.4)', borderWidth: 1,
              titleColor: '#f0f6ff', bodyColor: '#94a3b8', padding: 10,
              callbacks: {
                label: ctx => ` ${ctx.label}: ${ctx.parsed} chapter${ctx.parsed !== 1 ? 's' : ''} done`,
                labelColor: ctx => ({ borderColor: pieSubjects[ctx.dataIndex]?.color || '#fff', backgroundColor: pieSubjects[ctx.dataIndex]?.color || '#fff' })
              }
            }
          }
        }
      });
    }
  }

  // ========== Settings Modal ==========
  function modalSettings() {
    const sr = state.smartReminder, mr = state.motivationReminders, mi = state.motivationInterval, perm = notifPermission();
    let permCls = 'warn', permText = 'Permission not yet requested.';
    if (perm === 'unsupported') { permCls = 'warn'; permText = 'Notifications not supported on this browser.'; }
    else if (perm === 'granted')  { permCls = 'ok';   permText = 'Notifications are allowed.'; }
    else if (perm === 'denied')   { permCls = 'err';  permText = 'Notifications are blocked. Enable in browser settings.'; }
    const chips = (which, list) => list.map((t, i) => `<span class="time-chip"><button type="button" class="time-chip-edit" data-act="open-time-picker" data-which="${which}" data-i="${i}">${escapeHTML(formatTime12(t))}</button><button type="button" class="time-chip-del" data-act="del-time-slot" data-which="${which}" data-i="${i}">×</button></span>`).join('');
    const _authUser = _auth ? _auth.currentUser : null;
    const avatarPreview = state.profile.avatarDataUrl
      ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="auth-avatar-img" alt=""/>`
      : (_authUser && _authUser.photoURL
          ? `<img src="${escapeHTML(_authUser.photoURL)}" class="auth-avatar-img" alt=""/>`
          : `<div class="auth-avatar-initial">${(_authUser ? (_authUser.email || '?')[0] : '?').toUpperCase()}</div>`);
    const isEmailUser = _authUser && _authUser.providerData && _authUser.providerData.some(p => p.providerId === 'password');
    const accountSection = _authUser
      ? `<div class="settings-section settings-auth-section">
          <h4>☁️ Account</h4>
          <div class="auth-profile-row">
            ${avatarPreview}
            <div class="auth-profile-info">
              ${_authUser.displayName ? `<div class="auth-profile-name">${escapeHTML(_authUser.displayName)}</div>` : ''}
              <div class="auth-profile-email">${escapeHTML(_authUser.email || 'Anonymous')}</div>
              <div class="auth-sync-badge">☁️ Cloud sync active</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            ${isEmailUser ? `<button class="btn btn-ghost" style="flex:1" data-act="change-password">🔑 Change Password</button>` : ''}
            <button class="btn btn-ghost" style="flex:1;color:#ef4444;border-color:rgba(239,68,68,.25)" data-act="auth-logout">Sign Out</button>
          </div>
        </div>`
      : `<div class="settings-section settings-auth-section">
          <h4>☁️ Account</h4>
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">Sign in to sync your study data across devices.</p>
          <button class="btn btn-block" data-act="auth-show-modal">Sign In / Sign Up</button>
        </div>`;
    openModal(`<h3>Settings</h3>
      ${accountSection}
      <div class="settings-section" id="profile-settings-section">
        <h4>👤 Profile</h4>
        <div class="avatar-upload-row">
          ${state.profile.avatarDataUrl
            ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="avatar-preview-img" alt=""/>`
            : `<div class="avatar-preview-placeholder">${(state.profile.name || '?')[0].toUpperCase()}</div>`}
          <div class="avatar-upload-btns">
            <label class="btn btn-sm btn-ghost" style="cursor:pointer">📷 Upload Photo<input type="file" accept="image/*" id="avatar-file-input" style="display:none"/></label>
            ${state.profile.avatarDataUrl ? `<button class="btn btn-sm btn-ghost" data-act="remove-avatar" style="color:#ef4444">✕ Remove</button>` : ''}
          </div>
        </div>
        <div class="field" style="margin-top:12px"><label>Your Name</label><input id="set-profile-name" placeholder="Enter your name…" maxlength="40" value="${escapeHTML(state.profile.name)}"/></div>
        <div class="field"><label>Tagline</label><input id="set-profile-tagline" placeholder="e.g. CSE'26, BUET" maxlength="60" value="${escapeHTML(state.profile.tagline)}"/></div>
        <div style="margin-top:10px"><button class="btn btn-block" data-act="save-profile">Save Profile</button></div>
      </div>
      <div class="settings-section"><h4>🛍️ XP Shop</h4><p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">Spend earned XP on themes, titles &amp; visual effects.</p><button class="btn btn-block" data-act="open-shop">Open XP Shop</button></div>
      <div class="settings-section"><h4>Daily Study Reminder</h4><div class="settings-row"><div class="label">Notify when tasks aren't done<div class="sub">Multiple reminder times supported.</div></div><label class="switch"><input type="checkbox" id="set-sr-toggle" ${sr.enabled ? 'checked' : ''} data-act="toggle-smart-reminder"/><span class="slider"></span></label></div><div class="time-chip-row" style="${sr.enabled ? '' : 'opacity:.55;pointer-events:none'}">${sr.times.length ? chips('reminder', sr.times) : '<span class="muted">No times set.</span>'}<button type="button" class="time-chip add" data-act="open-time-picker" data-which="reminder" data-i="-1">+ Add</button></div></div>
      <div class="settings-section"><h4>Motivation Notifications</h4><div class="settings-row"><div class="label">Motivational push messages<div class="sub">Random quote at each scheduled time.</div></div><label class="switch"><input type="checkbox" id="set-mr-toggle" ${mr.enabled ? 'checked' : ''} data-act="toggle-motivation"/><span class="slider"></span></label></div><div class="time-chip-row" style="${mr.enabled ? '' : 'opacity:.55;pointer-events:none'}">${mr.times.length ? chips('motivation', mr.times) : '<span class="muted">No times set.</span>'}<button type="button" class="time-chip add" data-act="open-time-picker" data-which="motivation" data-i="-1">+ Add</button></div></div>
      <div class="settings-section"><h4>🔔 Interval Reminders</h4><div class="settings-row"><div class="label">Motivational boost every few hours<div class="sub">Smart quotes — urgent tone when you are behind on studying.</div></div><label class="switch"><input type="checkbox" id="set-mi-toggle" ${mi.enabled ? 'checked' : ''} data-act="toggle-motivation-interval"/><span class="slider"></span></label></div><div class="moti-interval-row" style="${mi.enabled ? '' : 'opacity:.55;pointer-events:none'}"><span class="moti-interval-label">Every</span><div class="moti-interval-btns">${[1, 2, 3, 4, 6].map(h => `<button type="button" class="tp-chip${mi.intervalHours === h ? ' on' : ''}" data-act="set-motivation-interval" data-h="${h}">${h}h</button>`).join('')}</div></div></div>
      <div class="settings-section"><h4>Notifications Status</h4><div class="notif-status ${permCls}">${escapeHTML(permText)}</div>${(perm === 'default' || perm === 'denied') ? `<div style="margin-top:9px"><button class="btn btn-block" data-act="sr-request-perm">${perm === 'denied' ? 'Try requesting again' : 'Allow notifications'}</button></div>` : ''}</div>
      <div class="settings-section"><h4>My Motivation Quotes</h4><p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">These quotes appear on the home screen and in Full Focus mode. Add as many as you like.</p><div class="quote-list">${state.motivationQuotes.length ? state.motivationQuotes.map((q, i) => `<div class="quote-row"><div class="text">${escapeHTML(q)}</div><button class="menu-btn" data-act="del-quote" data-i="${i}">${ic('trash')}</button></div>`).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No quotes yet. Add one below!</div>'}</div><div class="quote-add-row"><input id="set-new-quote" placeholder="Add a motivation quote…" maxlength="200"/><button class="btn" data-act="add-quote">${ic('plus')}</button></div></div>
      <div class="settings-section"><h4>🌙 Night Study Mode</h4><div class="settings-row"><div class="label">Warm amber overlay — reduces eye strain<div class="sub">Also reminds you to take a 20-second eye break every 40 min of video watching.</div></div><label class="switch"><input type="checkbox" id="set-eye-care" ${state.eyeCareMode ? 'checked' : ''} data-act="toggle-eye-care"/><span class="slider"></span></label></div></div>
      <div class="settings-section"><h4>⏰ Alarm Clock</h4><p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">Wake up to your saved motivations with an escalating alarm. Dismiss by catching the moving button!</p><button class="btn btn-block" data-act="open-alarm-manager">⏰ Manage Alarms${(state.alarms||[]).filter(a=>a.enabled).length ? ` <span style="background:rgba(239,68,68,.2);color:#f87171;padding:2px 8px;border-radius:999px;font-size:11px;margin-left:6px">${(state.alarms||[]).filter(a=>a.enabled).length} active</span>` : ''}</button></div>
      <div class="settings-section"><h4>Data</h4><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" data-act="export-data">${ic('download')} Export Backup</button><label class="btn btn-ghost" style="cursor:pointer">${ic('upload')} Import Backup<input type="file" accept=".json" style="display:none" id="import-file-input"/></label></div></div>
      <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>`,
      root => {
        root.querySelector('#import-file-input').onchange = e => { importData(e.target.files[0]); closeModal(); };
        const avatarInput = root.querySelector('#avatar-file-input');
        if (avatarInput) avatarInput.onchange = e => { closeModal(); _handleAvatarUpload(e.target.files[0]); };
      });
  }
  function refreshSettingsIfOpen() { const h = document.querySelector('#modal-root .modal h3'); if (h && h.textContent.trim() === 'Settings') modalSettings(); }

  function modalSetReminderTime(which, index) {
    const target = which === 'motivation' ? state.motivationReminders : state.smartReminder;
    const isAdd = index == null || index < 0;
    const initial = isAdd ? (target.times[target.times.length - 1] || '09:00') : (target.times[index] || '09:00');
    let [h, m] = initial.split(':').map(Number); if (isNaN(h)) h = 9; if (isNaN(m)) m = 0;
    h = Math.max(0, Math.min(23, h)); m = Math.max(0, Math.min(59, m));
    const titlePrefix = which === 'motivation' ? 'Motivation' : 'Reminder';
    openModal(`<h3>${titlePrefix} Time</h3><div class="tp-wrap-min"><div class="tp-display"><span class="tp-h">${String(((h+11)%12)+1).padStart(2,'0')}</span><span class="tp-sep">:</span><span class="tp-m">${String(m).padStart(2,'0')}</span><span class="tp-ampm-lbl">${h<12?'AM':'PM'}</span></div><div class="tp-steppers"><div class="tp-stepper"><div class="tp-s-label">Hour</div><div class="tp-s-row"><button class="tp-s-btn" data-tp="h-down">−</button><div class="tp-s-val tp-val-h">${String(h).padStart(2,'0')}</div><button class="tp-s-btn" data-tp="h-up">+</button></div></div><div class="tp-stepper"><div class="tp-s-label">Minute</div><div class="tp-s-row"><button class="tp-s-btn" data-tp="m-down">−</button><div class="tp-s-val tp-val-m">${String(m).padStart(2,'0')}</div><button class="tp-s-btn" data-tp="m-up">+</button></div></div></div><div class="tp-ampm"><button class="tp-chip ${h<12?'on':''}" data-tp-ampm="AM">AM</button><button class="tp-chip ${h>=12?'on':''}" data-tp-ampm="PM">PM</button></div><div class="tp-presets"><button class="tp-chip" data-tp-set="07:00">7 AM</button><button class="tp-chip" data-tp-set="09:00">9 AM</button><button class="tp-chip" data-tp-set="12:00">12 PM</button><button class="tp-chip" data-tp-set="18:00">6 PM</button><button class="tp-chip" data-tp-set="20:00">8 PM</button><button class="tp-chip" data-tp-set="22:00">10 PM</button></div></div><div class="actions" style="margin-top:14px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="tp-save">${isAdd ? 'Add Time' : 'Save'}</button></div>`,
      root => {
        function update() { h = ((h%24)+24)%24; m = ((m%60)+60)%60; const h12=((h+11)%12)+1, ampm=h<12?'AM':'PM'; root.querySelector('.tp-h').textContent=String(h12).padStart(2,'0'); root.querySelector('.tp-m').textContent=String(m).padStart(2,'0'); root.querySelector('.tp-ampm-lbl').textContent=ampm; root.querySelector('.tp-val-h').textContent=String(h).padStart(2,'0'); root.querySelector('.tp-val-m').textContent=String(m).padStart(2,'0'); root.querySelectorAll('[data-tp-ampm]').forEach(b=>b.classList.toggle('on',b.dataset.tpAmpm===ampm)); }
        root.querySelectorAll('[data-tp]').forEach(btn => { let ti=null,ri=null; const fn=()=>{const tp=btn.dataset.tp;if(tp==='h-up')h++;else if(tp==='h-down')h--;else if(tp==='m-up')m++;else m--;update();}; btn.addEventListener('pointerdown',e=>{e.preventDefault();fn();ti=setTimeout(()=>{ri=setInterval(fn,80);},350);}); const stop=()=>{clearTimeout(ti);clearInterval(ri);}; btn.addEventListener('pointerup',stop);btn.addEventListener('pointerleave',stop);btn.addEventListener('pointercancel',stop); });
        root.querySelectorAll('[data-tp-ampm]').forEach(btn=>btn.addEventListener('click',()=>{const t=btn.dataset.tpAmpm;if(t==='AM'&&h>=12)h-=12;if(t==='PM'&&h<12)h+=12;update();}));
        root.querySelectorAll('[data-tp-set]').forEach(btn=>btn.addEventListener('click',()=>{const[hh,mm]=btn.dataset.tpSet.split(':').map(Number);h=hh;m=mm;update();}));
        root.querySelector('#tp-save').addEventListener('click',()=>{const v=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;if(isAdd){if(!target.times.includes(v))target.times.push(v);}else target.times[index]=v;target.times.sort();target.times=[...new Set(target.times)];saveState();scheduleAllNotifications();closeModal();modalSettings();toast(`${titlePrefix} time ${isAdd?'added':'updated'}`, 'success');});
      });
  }

  // ========== Exam Modal ==========
  function modalAddExam(existing) {
    openModal(`<h3>${existing ? 'Edit Exam' : 'Add Exam'}</h3><div class="field"><label>Exam name</label><input id="m-name" placeholder="e.g. Final Exam" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="60"/></div><div class="field"><label>Date</label><input id="m-date" type="date" value="${existing ? existing.date : nextDateISO(30)}"/></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Exam'}</button></div>`,
      root => {
        root.querySelector('#m-save').onclick = () => { const name = root.querySelector('#m-name').value.trim(), date = root.querySelector('#m-date').value; if (!name) { toast('Name required', 'warn'); return; } if (!date) { toast('Date required', 'warn'); return; } if (existing) { existing.name = name; existing.date = date; } else state.exams.push({ id: uid(), name, date }); saveState(); closeModal(); renderAll(); toast(existing ? 'Exam updated' : 'Exam added', 'success'); };
        const delBtn = root.querySelector('#m-del'); if (delBtn) delBtn.onclick = () => { state.exams = state.exams.filter(e => e.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Exam deleted', 'danger'); };
      });
  }

  // ========== Plan pickers ==========
  function bindPlanPickers() {
    const selSub = document.getElementById('plan-pick-sub'), selCh = document.getElementById('plan-pick-ch'), selT = document.getElementById('plan-pick-t');
    if (!selSub) return;
    selSub.onchange = () => {
      const subId = selSub.value;
      selCh.innerHTML = '<option value="">Chapter…</option>';
      selT.innerHTML = '<option value="">Topic (optional)…</option>';
      selCh.disabled = !subId; selT.disabled = true;
      if (!subId) return;
      const sub = findSubject(subId);
      if (sub) for (const ch of sub.chapters) selCh.innerHTML += `<option value="${ch.id}">${escapeHTML(ch.name)}</option>`;
    };
    selCh.onchange = () => {
      const subId = selSub.value, chId = selCh.value;
      selT.innerHTML = '<option value="">All topics…</option>';
      selT.disabled = !chId;
      if (!chId) return;
      const ch = findChapter(subId, chId);
      if (ch) for (const t of ch.topics) selT.innerHTML += `<option value="${t.id}">${escapeHTML(t.name)}${t.done ? ' ✓' : ''}</option>`;
    };
  }

  // ========== Event Delegation ==========
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      closeDropdown(); return;
    }
    const act = el.dataset.act;

    if (el.hasAttribute('data-close')) { closeModal(); return; }
    if (act === 'open-settings')    { modalSettings(); return; }
    if (act === 'auth-toggle-form') { _authToggleMode(); return; }
    if (act === 'auth-submit')      { _authSubmit(); return; }
    if (act === 'auth-forgot')      { _authForgotPassword(); return; }
    if (act === 'auth-logout')      { _authSignOut(); closeModal(); return; }
    if (act === 'auth-show-modal')  { _authSkipped = false; try { localStorage.removeItem('stk_auth_skipped'); } catch(_) {} closeModal(); showAuthModal(); return; }
    if (act === 'auth-use-offline') { _authSkipped = true; try { localStorage.setItem('stk_auth_skipped', '1'); } catch(_) {} hideAuthModal(); toast('Using app offline — sign in anytime via ⚙️ Settings', 'info', 4500); return; }
    if (act === 'save-profile') {
      const root = document.querySelector('#modal-root .modal');
      if (root) {
        const name    = (root.querySelector('#set-profile-name')?.value  || '').trim();
        const tagline = (root.querySelector('#set-profile-tagline')?.value || '').trim();
        if (!name) { toast('Name is required', 'warn'); return; }
        state.profile.name    = name;
        state.profile.tagline = tagline;
        saveState();
        renderAll();
        toast('Profile saved ✓', 'success');
      }
      return;
    }
    if (act === 'fs-toggle-landscape' || act === 'vp-toggle-landscape') { toggleOrientLock(); return; }

    if (act === 'open-dashboard') { switchTab('dashboard'); renderDashboard(); return; }
    if (act === 'open-syllabus')  { switchTab('syllabus');  renderSyllabus();  return; }
    if (act === 'open-plan') { closeModal(); switchTab('home'); renderHome(); return; }
    if (act === 'burnout-go-plan') { closeModal(); switchTab('home'); renderHome(); return; }
    if (act === 'switch-to-syllabus') { switchTab('syllabus'); renderSyllabus(); return; }
    if (act === 'burnout-popup') { showBurnoutPopup(); return; }
    if (act === 'burnout-dismiss-banner') { state.burnout.bannerDismissedDate = todayKey(); saveState(); renderDashboard(); return; }

    // Exams
    if (act === 'add-exam') { modalAddExam(null); return; }
    if (act === 'edit-exam') { const exam = state.exams.find(e => e.id === el.dataset.id); if (exam) modalAddExam(exam); return; }

    // Goals
    if (act === 'add-goal') { modalAddGoal(null); return; }
    if (act === 'edit-goal') { const g = (state.goals || []).find(g => g.id === el.dataset.id); if (g) modalAddGoal(g); return; }

    // Plan
    if (act === 'regen-plan') { closeModal(); const k = todayKey(); if (state.dailyPlans[k]) { state.dailyPlans[k].generated = false; state.dailyPlans[k].auto = []; state.dailyPlans[k].custom = state.dailyPlans[k].custom.filter(c => !c.rolledOver); } saveState(); ensureTodayPlan(); renderDashboard(); toast('Plan regenerated', 'info'); return; }
    if (act === 'toggle-plan-task') {
      const type = el.dataset.type;
      if (type === 'auto') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { const wasDone = t.done; t.done = !t.done; if (t.done) { bumpActivity(); gamificationManager.addTaskXP(el); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); _justPoppedKey = `auto:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`; } else onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, false); const tasks = getActivePlanTasks(); if (tasks.length > 0 && tasks.every(x => x.done) && !wasDone) _justCompletedDay = todayKey(); saveState(); renderAll(); } }
      else { const plan = state.dailyPlans[todayKey()]; if (plan) { const ct = plan.custom.find(c => c.id === el.dataset.id); if (ct) { ct.done = !ct.done; if (ct.done) { bumpActivity(); gamificationManager.addTaskXP(el); } saveState(); renderAll(); } } }
      return;
    }
    if (act === 'remove-plan-task') {
      const type = el.dataset.type, plan = state.dailyPlans[todayKey()]; if (!plan) return;
      if (type === 'auto') { const key = autoKey(el.dataset.sub, el.dataset.ch, el.dataset.t); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.skipCount = (t.skipCount || 0) + 1; t.lastSkippedAt = todayKey(); } if (!plan.removed.includes(key)) plan.removed.push(key); saveState(); renderAll(); }
      else {
        const rid = el.dataset.rid;
        if (rid) {
          confirmModal('This is a daily recurring task. Remove it forever so it stops repeating?', () => {
            state.recurringTasks = (state.recurringTasks || []).filter(r => r.id !== rid);
            plan.custom = plan.custom.filter(c => c.id !== el.dataset.id);
            saveState(); renderAll();
          }, { title: 'Stop Recurring Task?', yesLabel: 'Remove Forever', yesClass: 'btn', noLabel: 'Keep' });
        } else {
          plan.custom = plan.custom.filter(c => c.id !== el.dataset.id);
          saveState(); renderAll();
        }
      }
      return;
    }
    if (act === 'toggle-add-recurring') {
      _addTaskRecurring = !_addTaskRecurring;
      const btn = document.getElementById('plan-recurring-btn');
      if (btn) btn.classList.toggle('active', _addTaskRecurring);
      const addCard = btn?.closest('.plan-add-card');
      if (addCard) {
        let hint = addCard.querySelector('.plan-recurring-hint');
        if (_addTaskRecurring && !hint) { hint = document.createElement('div'); hint.className = 'plan-recurring-hint'; hint.textContent = '↻ This task will repeat every day'; addCard.appendChild(hint); }
        else if (!_addTaskRecurring && hint) hint.remove();
      }
      return;
    }
    if (act === 'add-plan-task') {
      const input = document.getElementById('plan-new-task'), text = input ? input.value.trim() : '';
      if (!text) { toast('Enter a task first', 'warn'); return; }
      const plan = ensureTodayPlan();
      if (_addTaskRecurring) {
        if (!Array.isArray(state.recurringTasks)) state.recurringTasks = [];
        const rt = { id: uid(), text, frequency: 'daily', lastResetDate: todayKey() };
        state.recurringTasks.push(rt);
        plan.custom.push({ id: uid(), text, done: false, recurringId: rt.id });
        _addTaskRecurring = false;
        toast('↻ Daily recurring task added — it will reset automatically each morning', 'success', 4000);
      } else {
        plan.custom.push({ id: uid(), text, done: false });
      }
      if (input) input.value = '';
      saveState(); renderDashboard();
      return;
    }
    if (act === 'add-plan-from-syllabus') {
      const subId = document.getElementById('plan-pick-sub')?.value,
            chId  = document.getElementById('plan-pick-ch')?.value,
            tId   = document.getElementById('plan-pick-t')?.value;
      if (!subId || !chId) { toast('Select at least a subject and chapter', 'warn'); return; }
      const plan = ensureTodayPlan();
      const sub = findSubject(subId), ch = findChapter(subId, chId);
      if (!ch) { toast('Chapter not found', 'warn'); return; }
      let added = 0;

      // Chapter with no topics — add chapter as custom task directly
      if (!ch.topics.length) {
        const label = `📖 ${ch.name}`;
        const meta = sub ? sub.name : '';
        const full = meta ? `${label} (${meta})` : label;
        if (!plan.custom.find(c => c.text === full)) {
          plan.custom.push({ id: uid(), text: full, done: false });
          added++;
        }
        saveState(); renderDashboard();
        toast(added > 0 ? `Chapter task added to plan` : 'Already in today\'s plan', added > 0 ? 'success' : 'info');
        return;
      }

      const addOneTopic = t => {
        if (t.done) {
          const label = `📖 Revise: ${t.name}`;
          const meta  = `${sub ? sub.name : ''} · ${ch.name}`;
          const full  = `${label} (${meta})`;
          if (!plan.custom.find(c => c.text === full)) {
            plan.custom.push({ id: uid(), text: full, done: false });
            added++;
          }
        } else {
          const key = autoKey(subId, chId, t.id);
          plan.removed = plan.removed.filter(k => k !== key);
          if (!plan.auto.find(a => a.subId === subId && a.chId === chId && a.tId === t.id)) {
            plan.auto.push({ subId, chId, tId: t.id }); added++;
          }
        }
      };
      if (tId) { const t = findTopic(subId, chId, tId); if (t) addOneTopic(t); }
      else { for (const t of ch.topics) addOneTopic(t); }
      saveState(); renderDashboard();
      toast(added > 0 ? `${added} task${added > 1 ? 's' : ''} added to plan` : 'Already in today\'s plan', added > 0 ? 'success' : 'info');
      return;
    }

    // Subjects
    if (act === 'toggle-subject') { const id = el.dataset.id; openSubjects.has(id) ? openSubjects.delete(id) : openSubjects.add(id); renderSyllabus(); return; }
    if (act === 'add-subject') { modalAddSubject(null); return; }
    if (act === 'open-subject-menu') { e.stopPropagation(); showSubjectMenu(el.dataset.id); return; }
    if (act === 'edit-subject') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) modalAddSubject(sub); return; }
    if (act === 'del-subject') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) confirmModal(`Delete "${sub.name}" and all chapters?`, () => { state.subjects = state.subjects.filter(s => s.id !== sub.id); saveState(); renderAll(); toast('Subject deleted', 'danger'); }); return; }

    // Chapters
    if (act === 'toggle-chapter') { const id = el.dataset.id; openChapters.has(id) ? openChapters.delete(id) : openChapters.add(id); renderSyllabus(); return; }
    if (act === 'toggle-chapter-done') { const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) { const nowDone = !isChapterEffectivelyDone(ch); for (const t of ch.topics) { if (t.done !== nowDone) { t.done = nowDone; onTopicDoneChanged(el.dataset.sub, el.dataset.ch, t.id, nowDone); } } ch.done = nowDone; if (nowDone) bumpActivity(); saveState(); renderAll(); toast(nowDone ? 'Chapter marked done' : 'Chapter reopened', nowDone ? 'success' : 'info'); } return; }
    if (act === 'add-chapter') { closeDropdown(); modalAddChapter(el.dataset.sub, null); return; }
    if (act === 'open-chapter-menu') { e.stopPropagation(); showChapterMenu(el.dataset.sub, el.dataset.ch); return; }
    if (act === 'edit-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) modalAddChapter(el.dataset.sub, ch); return; }
    if (act === 'del-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) confirmModal(`Delete "${ch.name}"?`, () => { const sub = findSubject(el.dataset.sub); if (sub) sub.chapters = sub.chapters.filter(c => c.id !== ch.id); saveState(); renderAll(); toast('Chapter deleted', 'danger'); }); return; }
    if (act === 'schedule-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (!ch) return; openModal(`<h3>Schedule Chapter</h3><div class="field"><label>Date</label><input id="m-date" type="date" value="${ch.scheduledDate || todayKey()}"/></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Schedule</button></div>`, root => { root.querySelector('#m-save').onclick = () => { ch.scheduledDate = root.querySelector('#m-date').value || null; saveState(); closeModal(); renderAll(); toast('Chapter scheduled', 'success'); }; }); return; }

    // Topics
    if (act === 'toggle-topic-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = !t.done; if (t.done) bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, t.done); saveState(); renderAll(); } return; }
    if (act === 'add-topic') { closeDropdown(); modalAddTopic(el.dataset.sub, el.dataset.ch, null); return; }
    if (act === 'open-topic-menu') { e.stopPropagation(); showTopicMenu(el.dataset.sub, el.dataset.ch, el.dataset.t); return; }
    if (act === 'edit-topic') { closeDropdown(); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) modalAddTopic(el.dataset.sub, el.dataset.ch, t); return; }
    if (act === 'del-topic') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) { ch.topics = ch.topics.filter(t => t.id !== el.dataset.t); saveState(); renderAll(); toast('Topic deleted', 'danger'); } return; }

    // Notes & Priority — separated
    if (act === 'open-subject-notes') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) modalQuickNote(sub, sub.name, renderSyllabus); return; }
    if (act === 'open-subject-priority') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) modalQuickPriority(sub, sub.name, renderSyllabus); return; }
    if (act === 'open-chapter-notes') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) modalQuickNote(ch, ch.name, renderSyllabus); return; }
    if (act === 'open-chapter-priority') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) modalQuickPriority(ch, ch.name, renderSyllabus); return; }
    if (act === 'open-topic-notes') { closeDropdown(); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) modalQuickNote(t, t.name, renderSyllabus); return; }
    if (act === 'open-topic-priority') { closeDropdown(); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) modalQuickPriority(t, t.name, renderSyllabus); return; }

    // Focus sub-tab
    if (act === 'focus-subtab') { focusSubTab = el.dataset.stab; renderFocus(); return; }

    // Focus timer
    if (act === 'focus-mode') {
      const newMode = el.dataset.mode;
      if (!focusRunning) { focusMode = newMode; focusSeconds = customDurations[newMode] * 60; renderFocus(); }
      else { if (confirm('Stop current timer and switch mode?')) { clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusStartTime = null; focusStartSeconds = null; focusMode = newMode; focusSeconds = customDurations[newMode] * 60; renderFocus(); document.title = 'Syllabus Tracker'; updateMiniTimer(); } }
      return;
    }
    // ── Social Study System ──────────────────────────────────────────────
    if (act === 'social-create') { _sJoinRoom(el.dataset.code).catch(() => {}); return; }
    if (act === 'social-join')   { const inp = document.getElementById('social-join-input'); _sJoinRoom(inp ? inp.value.trim().toUpperCase() : '').catch(() => {}); return; }
    if (act === 'social-leave')  { _sLeaveRoom(); return; }
    if (act === 'social-rejoin') { _sJoinRoom(el.dataset.code).catch(() => {}); return; }
    if (act === 'social-remove-group') {
      const code_ = el.dataset.code;
      _myGroupCodes = _myGroupCodes.filter(c => c !== code_);
      try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
      if (_db && _userId) _db.collection('users').doc(_userId).update({ joinedRooms: _myGroupCodes }).catch(() => {});
      renderSocial(); return;
    }
    if (act === 'view-profile')  { _viewMemberProfile(el.dataset.uid); return; }
    if (act === 'view-profile-global') { _viewGlobalProfile(el.dataset.uid, el.dataset.name); return; }
    if (act === 'social-admin')  { _openAdminSettings(); return; }
    if (act === 'social-room-settings') { _openRoomSettings(); return; }
    if (act === 'social-copy-code') {
      const code = _socialRoomCode || _socialLobbyCode || '';
      if (code) {
        navigator.clipboard.writeText(code).then(() => toast(`Copied ${code}!`, 'success')).catch(() => {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = code; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
          toast(`Copied ${code}!`, 'success');
        });
      }
      return;
    }
    if (act === 'admin-toggle-privacy') {
      if (!_db || !_socialRoomCode) return;
      const newPriv = !(_socialRoomData && _socialRoomData.private);
      _db.collection('groups').doc(_socialRoomCode).update({ private: newPriv })
        .then(() => { toast(newPriv ? '🔒 Room is now private' : '🌐 Room is now public', 'success'); closeModal(); })
        .catch(() => toast('Failed to update privacy', 'danger'));
      return;
    }
    if (act === 'member-notif-toggle') {
      state.socialNotif = !(state.socialNotif !== false);
      saveState();
      closeModal();
      toast(state.socialNotif ? '🔔 Notifications on' : '🔕 Notifications off', 'info');
      return;
    }
    if (act === 'admin-kick')    { const uid_ = el.dataset.uid, name = el.dataset.name; confirmModal(`Kick ${name} from the room?`, () => _adminKickMember(uid_, name), { title: 'Kick Member?', yesLabel: 'Kick', yesClass: 'btn btn-danger', noLabel: 'Cancel' }); return; }
    if (act === 'admin-close-room') { confirmModal('Close and delete this room? All members will be sent back to the lobby.', () => _adminCloseRoom(), { title: 'Close Room?', yesLabel: 'Close Room', yesClass: 'btn btn-danger', noLabel: 'Cancel' }); return; }
    if (act === 'voice-join')    { _voiceJoin(); return; }
    if (act === 'voice-leave')   { _voiceLeave(false); return; }
    if (act === 'voice-mute')    { _voiceMuteToggle(); return; }
    if (act === 'lb-view') {
      _lbView = el.dataset.v || 'group';
      if (_lbView === 'global') { _loadGlobalLeaderboard().catch(() => {}); }
      renderSocial(); return;
    }
    if (act === 'theme-gallery') { _themeGalleryModal(); return; }
    if (act === 'theme-equip')   { applyTheme(el.dataset.tid); closeModal(); toast(`✨ Theme activated!`, 'success'); return; }
    if (act === 'social-nudge')  { _sNudge(el.dataset.uid, el.dataset.name).catch(() => {}); return; }
    if (act === 'social-duel')   { _sChallengeDuel(el.dataset.uid, el.dataset.name).catch(() => {}); return; }
    if (act === 'change-password') { closeModal(); _handleChangePassword(); return; }
    if (act === 'open-shop') { closeModal(); switchTab('shop'); renderShop(); return; }
    if (act === 'shop-back') { switchTab('home'); renderHome(); return; }
    if (act === 'remove-avatar') {
      state.profile.avatarDataUrl = null;
      saveState(); _scheduledCloudSync(); renderAll(); toast('Avatar removed', 'info'); modalSettings(); return;
    }
    if (act === 'social-add-goal') {
      const t = (document.getElementById('gg-title-input')?.value || '').trim();
      const h = parseFloat(document.getElementById('gg-hours-input')?.value || '0');
      if (!t) { toast('Enter a goal title', 'warn'); return; }
      if (!h || h < 1) { toast('Enter target hours (min 1)', 'warn'); return; }
      _sAddGroupGoal(t, h).catch(() => {}); return;
    }
    if (act === 'social-del-goal') { _sRemoveGroupGoal(el.dataset.gid).catch(() => {}); return; }
    if (act === 'social-vault-donate') {
      const inp = document.getElementById('vault-xp-input');
      const amt = inp ? parseInt(inp.value, 10) : 0;
      if (!amt || amt < 1) { toast('Enter a valid XP amount', 'warn'); return; }
      _sDonateToVault(amt).catch(() => {});
      return;
    }
    if (act === 'social-vault-create') { _sCreateVault().catch(() => {}); return; }
    if (act === 'vault-celebrate') { _triggerVaultCelebration(); return; }
    if (act === 'vault-claim-reward') { _sClaimVaultReward().catch(() => {}); return; }
    if (act === 'vault-history-toggle') {
      const list = document.getElementById('vault-history-list');
      const arrow = document.getElementById('vht-arrow');
      if (list) {
        const isOpen = list.classList.toggle('vault-history-open');
        if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
      }
      return;
    }
    // ── XP Shop ──────────────────────────────────────────────────────────
    if (act === 'shop-cat') {
      _shopCategory = el.dataset.cat || 'profile';
      renderShop();
      return;
    }
    if (act === 'shop-buy')         { _shopBuy(el.dataset.iid);        return; }
    if (act === 'shop-confirm-buy') { _shopConfirmBuy(el.dataset.iid); return; }
    if (act === 'shop-equip')       { _shopEquip(el.dataset.iid);      return; }
    if (act === 'shop-unequip')     { _shopUnequip(el.dataset.iid);    return; }
    // ── Daily Quests ─────────────────────────────────────────────────────
    if (act === 'quest-claim')      { _claimQuestXP(el.dataset.qid);   return; }
    if (act === 'focus-toggle') {
      if (focusRunning) {
        // Partial-credit: save elapsed minutes for work sessions stopped early
        if (focusMode === 'work' && focusStartTime !== null) {
          const elapsedMin = Math.floor((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            _recordSubjectMinutes(elapsedMin);
            saveState();
          }
        }
        if (_socialRoomCode && focusMode === 'work' && focusSeconds > 0) _sHandleFocusBounty().catch(() => {});
        if (_socialRoomCode) _sUpdatePresence('break').catch(() => {});
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
        updateMiniTimer();
      } else if (focusOvertime) {
        // User ending overtime — save extra minutes then switch to break

        finishOvertimeAndSwitch();
        renderFocus(); return;
      } else {
        // Count the session the moment the user hits Start
        if (focusMode === 'work') {
          const todayStr = todayKey();
          focusSessions++;
          state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
          saveState();
          checkBadges({ sessionStartHour: new Date().getHours() });
        }
        if (notifPermission() === 'default') requestNotifPermission();
        focusRunning = true;
        pickNewQuote();
        focusStartTime = Date.now();
        focusStartSeconds = focusSeconds;
        focusTimer = setInterval(focusTick, 1000);
        if (_socialRoomCode) _sUpdatePresence('focusing').catch(() => {});
        resumeAmbientIfNeeded();
      }
      renderFocus(); return;
    }
    if (act === 'focus-reset') { stopOvertimeMode(); clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusStartTime = null; focusStartSeconds = null; focusSeconds = customDurations[focusMode] * 60; focusMultitaskMode = false; renderFocus(); document.title = 'Syllabus Tracker'; updateMiniTimer(); return; }
    if (act === 'focus-lock') { focusMultitaskMode = false; focusLocked = !focusLocked; renderFocus(); toast(focusLocked ? '🔒 Lock Mode on — other tabs are restricted' : '🔓 Lock Mode off', focusLocked ? 'warn' : 'info'); return; }
    if (act === 'focus-multitask') { focusMultitaskMode = !focusMultitaskMode; if (focusMultitaskMode) { focusLocked = false; } renderFocus(); toast(focusMultitaskMode ? '🗒️ Multitask Mode on — navigate freely, timer keeps running' : '🔓 Multitask Mode off', 'info'); return; }
    if (act === 'focus-task-clear') { focusCurrentTaskKey = null; renderFocus(); return; }

    // Ambient sound
    if (act === 'ambient-select') { ambientMode = el.dataset.amode; startAmbient(ambientMode); renderFocus(); return; }
    if (act === 'binaural-toggle') { toggleBinaural(); return; }

    // Full Screen Session
    if (act === 'enter-full-session') { enterFullSession(); return; }
    if (act === 'exit-full-session') { if (focusOvertime) { finishOvertimeAndSwitch(); } exitFullSession(); stopAmbient(); ambientMode = 'none'; return; }
    if (act === 'fs-toggle') {
      if (focusRunning) {
        // Partial-credit: save elapsed minutes for work sessions stopped early
        if (focusMode === 'work' && focusStartTime !== null) {
          const elapsedMin = Math.floor((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            _recordSubjectMinutes(elapsedMin);
            saveState();
          }
        }
        if (_socialRoomCode && focusMode === 'work' && focusSeconds > 0) _sHandleFocusBounty().catch(() => {});
        if (_socialRoomCode) _sUpdatePresence('break').catch(() => {});
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
      } else if (focusOvertime) {
        // User ending overtime in full-session view — save extra minutes, switch to break

        finishOvertimeAndSwitch();
        renderFullSession(); return;
      } else {
        // Count the session the moment the user hits Start
        if (focusMode === 'work') {
          const todayStr = todayKey();
          focusSessions++;
          state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
          saveState();
          checkBadges({ sessionStartHour: new Date().getHours() });
        }
        if (notifPermission() === 'default') requestNotifPermission();
        focusRunning = true;
        pickNewQuote();
        focusStartTime = Date.now();
        focusStartSeconds = focusSeconds;
        focusTimer = setInterval(focusTick, 1000);
        if (_socialRoomCode) _sUpdatePresence('focusing').catch(() => {});
        resumeAmbientIfNeeded();
      }
      renderFullSession(); return;
    }
    if (act === 'fs-cycle-ambient') {
      const modes = ['none', ...SOUNDS.map(s => s.id)];
      ambientMode = modes[(modes.indexOf(ambientMode) + 1) % modes.length];
      startAmbient(ambientMode); renderFullSession(); return;
    }

    // Classroom — quick launch
    if (act === 'cls-open-url') {
      const input = document.getElementById('cls-url-input');
      const url = (input && input.value.trim()) || _classroomLastUrl;
      if (!url) { toast('Paste a URL first', 'warn'); return; }
      _classroomLastUrl = url;
      try { localStorage.setItem('cls_last_url', url); } catch(e) {}
      openQuickPlayer(url);
      return;
    }
    // Also handle Enter key in the URL input
    if (act === 'cls-url-go') {
      const input = document.getElementById('cls-url-input');
      const url = input && input.value.trim();
      if (!url) return;
      _classroomLastUrl = url;
      try { localStorage.setItem('cls_last_url', url); } catch(e) {}
      openQuickPlayer(url);
      return;
    }

    // Classroom
    if (act === 'add-classroom-group') { modalAddClassroomGroup(); return; }
    if (act === 'add-classroom-item') { modalAddClassroomItem(el.dataset.gid); return; }
    if (act === 'del-classroom-group') { const gid = el.dataset.gid; confirmModal('Delete this group and all its videos?', () => { state.classroom.groups = state.classroom.groups.filter(g => g.id !== gid); saveState(); renderFocus(); toast('Group deleted', 'danger'); }); return; }
    if (act === 'del-classroom-item') { e.stopPropagation(); const group = (state.classroom.groups || []).find(g => g.id === el.dataset.gid); if (group) { group.items = group.items.filter(i => i.id !== el.dataset.iid); saveState(); renderFocus(); toast('Video removed', 'info'); } return; }
    if (act === 'play-video')   { startVideoWatch(); openVideoPlayer(el.dataset.gid, el.dataset.iid); return; }
    if (act === 'vp-close') {
      if (_vfmActive && !_vfmComplete) {
        if (!window.confirm('Your focus session is still running. Exit the video anyway?')) return;
      }
      closeVideoPlayer(); return;
    }
    if (act === 'vp-switch')   { switchVideoInPlayer(el.dataset.gid, el.dataset.iid); return; }
    if (act === 'vp-cinema')     { _vpToggleCinema(); return; }
    if (act === 'eye-break-done'){ _dismissEyeBreak(); return; }
    if (act === 'vfm-start')   { openVfmPicker(); return; }
    if (act === 'vfm-minimize'){ minimizeVfm(); return; }
    if (act === 'vfm-expand')  { expandVfm(); return; }
    if (act === 'vfm-exit') {
      if (!_vfmComplete) { toast('Finish the session to unlock Exit! 💪', 'warn'); return; }
      closeVideoPlayer(); return;
    }
    if (act === 'vfm-abandon') {
      confirmModal('Abandon session? Any time already elapsed will be logged as Classroom Time.', () => { _saveVfmPartialTime(); stopVfm(); });
      return;
    }
    if (act === 'vfm-close') {
      if (_vfmComplete) { closeVideoPlayer(); return; }
      confirmModal('Abandon session? Any time already elapsed will be logged as Classroom Time.', () => { _saveVfmPartialTime(); stopVfm(); });
      return;
    }
    if (act === 'edit-classroom-item') { modalEditClassroomItem(el.dataset.gid, el.dataset.iid); return; }

    // Bookmark Moment
    if (act === 'vp-bookmark') {
      const form = document.getElementById('vp-bookmark-form');
      if (!form) return;
      const isOpen = form.style.display === 'flex';
      if (isOpen) { form.style.display = 'none'; return; }
      const curTime = getCurrentYTTime();
      const timeInput = document.getElementById('vp-bm-time');
      if (timeInput) timeInput.value = curTime !== null ? formatVpTs(curTime) : '';
      form.style.display = 'flex';
      setTimeout(() => { document.getElementById('vp-bm-label')?.focus(); }, 60);
      return;
    }
    if (act === 'vp-bm-cancel') {
      const form = document.getElementById('vp-bookmark-form');
      if (form) {
        form.style.display = 'none';
        const t = document.getElementById('vp-bm-time'); if (t) t.value = '';
        const l = document.getElementById('vp-bm-label'); if (l) l.value = '';
      }
      return;
    }
    if (act === 'vp-bm-save') {
      const form = document.getElementById('vp-bookmark-form');
      if (!form) return;
      const gid = form.dataset.gid, iid = form.dataset.iid;
      const timeVal = (document.getElementById('vp-bm-time')?.value || '').trim();
      const label   = (document.getElementById('vp-bm-label')?.value || '').trim();
      if (!label) { toast('Enter a label for this moment', 'warn'); return; }
      // Resolve timestamp: typed value → auto-capture → error (never silently save 0)
      let ts;
      if (timeVal) {
        const parsed = parseTsInput(timeVal);
        if (parsed === null) { toast('Use format 1:23 or 1:23:45', 'warn'); return; }
        ts = parsed;
      } else {
        const autoTs = getCurrentYTTime(); // null when API not ready
        if (autoTs === null) {
          toast('Enter a timestamp (e.g. 1:23)', 'warn');
          document.getElementById('vp-bm-time')?.focus();
          return;
        }
        ts = autoTs; // already Math.floor'd integer
      }
      const group = (state.classroom.groups || []).find(g => g.id === gid);
      const item  = group?.items.find(i => i.id === iid);
      if (!item) return;
      if (!Array.isArray(item.notes)) item.notes = [];
      item.notes.push({ id: uid(), ts, label });
      saveState();
      const notes = item.notes.slice().sort((a, b) => a.ts - b.ts);
      document.querySelectorAll('#vp-notes-list').forEach(nl => { nl.innerHTML = notes.map(n => vpNoteCardHTML(gid, iid, n)).join(''); });
      form.style.display = 'none';
      const t = document.getElementById('vp-bm-time'); if (t) t.value = '';
      const l = document.getElementById('vp-bm-label'); if (l) l.value = '';
      toast(`Saved at ${formatVpTs(ts)} ✓`, 'success');
      return;
    }
    if (act === 'vp-seek-note') {
      const ts = parseInt(el.dataset.ts, 10);
      if (!isNaN(ts)) seekVideoPlayer(ts);
      return;
    }
    if (act === 'vp-del-note') {
      e.stopPropagation();
      const { gid, iid, nid } = el.dataset;
      const group = (state.classroom.groups || []).find(g => g.id === gid);
      const item  = group?.items.find(i => i.id === iid);
      if (!item || !Array.isArray(item.notes)) return;
      item.notes = item.notes.filter(n => n.id !== nid);
      saveState();
      const notes = item.notes.slice().sort((a, b) => a.ts - b.ts);
      const emptyMsg = '<div class="vp-notes-empty">No bookmarks yet — tap Bookmark to save a moment</div>';
      document.querySelectorAll('#vp-notes-list').forEach(nl => {
        nl.innerHTML = notes.length ? notes.map(n => vpNoteCardHTML(gid, iid, n)).join('') : emptyMsg;
      });
      return;
    }

    // Calendar
    if (act === 'calendar-day') { modalCalendarDay(el.dataset.date); return; }
    if (act === 'cal-prev') { calendarViewDate.setMonth(calendarViewDate.getMonth() - 1); renderDashboard(); return; }
    if (act === 'cal-next') { calendarViewDate.setMonth(calendarViewDate.getMonth() + 1); renderDashboard(); return; }
    if (act === 'add-cal-task') {
      const date = el.dataset.date;
      const inp = document.getElementById('cal-new-task');
      const text = inp ? inp.value.trim() : '';
      if (!text) { toast('Enter a task', 'warn'); return; }
      if (!state.dailyPlans[date]) state.dailyPlans[date] = { auto: [], removed: [], custom: [], generated: false };
      state.dailyPlans[date].custom.push({ id: uid(), text, done: false });
      saveState(); modalCalendarDay(date); renderDashboard();
      return;
    }
    if (act === 'toggle-cal-task') {
      const date = el.dataset.date, i = parseInt(el.dataset.i, 10);
      const plan = state.dailyPlans[date];
      if (plan && plan.custom[i]) { plan.custom[i].done = !plan.custom[i].done; saveState(); modalCalendarDay(date); renderDashboard(); }
      return;
    }
    if (act === 'del-cal-task') {
      const date = el.dataset.date, i = parseInt(el.dataset.i, 10);
      const plan = state.dailyPlans[date];
      if (plan) { plan.custom.splice(i, 1); saveState(); modalCalendarDay(date); renderDashboard(); }
      return;
    }

    // Revision
    if (act === 'rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderDashboard(); toast('Revision marked done', 'success'); return; }
    if (act === 'rev-dismiss') { dismissRevisionEntry(el.dataset.rev); renderDashboard(); return; }

    // Smart suggestions
    if (act === 'suggest-rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderDashboard(); toast('Marked done', 'success'); return; }
    if (act === 'suggest-topic-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
    if (act === 'suggest-open') { openSubjects.add(el.dataset.sub); openChapters.add(el.dataset.ch); switchTab('syllabus'); renderSyllabus(); return; }

    // Weak areas
    if (act === 'weak-mark-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
    if (act === 'weak-reset') { resetWeakTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); saveState(); renderDashboard(); toast('Reset weak flag', 'info'); return; }

    // Settings actions
    if (act === 'toggle-smart-reminder') { state.smartReminder.enabled = el.checked; saveState(); refreshSettingsIfOpen(); scheduleAllNotifications(); return; }
    if (act === 'toggle-motivation') { state.motivationReminders.enabled = el.checked; saveState(); refreshSettingsIfOpen(); scheduleAllNotifications(); return; }
    if (act === 'toggle-motivation-interval') {
      state.motivationInterval.enabled = el.checked; saveState(); refreshSettingsIfOpen();
      if (state.motivationInterval.enabled) startMotivationIntervalLoop();
      else { if (_motivationIntervalTimer) { clearInterval(_motivationIntervalTimer); _motivationIntervalTimer = null; } }
      toast(state.motivationInterval.enabled ? '🔔 Interval reminders on' : 'Interval reminders off', 'info');
      return;
    }
    if (act === 'set-motivation-interval') {
      const h = parseInt(el.dataset.h, 10);
      state.motivationInterval.intervalHours = h; saveState(); refreshSettingsIfOpen();
      startMotivationIntervalLoop();
      toast(`Reminders set every ${h} hour${h > 1 ? 's' : ''} ✓`, 'success');
      return;
    }
    if (act === 'open-time-picker') { modalSetReminderTime(el.dataset.which, parseInt(el.dataset.i, 10)); return; }
    if (act === 'del-time-slot') { const target = el.dataset.which === 'motivation' ? state.motivationReminders : state.smartReminder; target.times.splice(parseInt(el.dataset.i, 10), 1); saveState(); refreshSettingsIfOpen(); scheduleAllNotifications(); return; }
    if (act === 'sr-request-perm') { requestNotifPermission().then(() => { refreshSettingsIfOpen(); scheduleAllNotifications(); }); return; }
    if (act === 'del-quote') { state.motivationQuotes.splice(parseInt(el.dataset.i, 10), 1); saveState(); if (_currentQuote && !state.motivationQuotes.includes(_currentQuote)) _currentQuote = null; _motivationIdx = 0; refreshSettingsIfOpen(); _refreshHomeMotiText(); toast('Quote removed', 'info'); return; }
    if (act === 'add-quote') { const input = document.getElementById('set-new-quote'), text = input ? input.value.trim() : ''; if (!text) { toast('Enter a quote first', 'warn'); return; } state.motivationQuotes.push(text); saveState(); _motivationIdx = state.motivationQuotes.length - 1; refreshSettingsIfOpen(); _refreshHomeMotiText(); if (input) input.value = ''; toast('Quote saved ✨', 'success'); return; }
    if (act === 'export-data') { closeModal(); exportData(); return; }
    if (act === 'backup-export') { exportData(); return; }
    if (act === 'toggle-eye-care') { state.eyeCareMode = el.checked; saveState(); applyEyCareMode(); refreshSettingsIfOpen(); toast(state.eyeCareMode ? '🌙 Night Study Mode on' : 'Night Study Mode off', 'info'); return; }
    // Alarm actions
    if (act === 'open-alarm-manager') { closeModal(); openAlarmManager(); return; }
    if (act === 'add-alarm') { closeModal(); openAddEditAlarm(null); return; }
    if (act === 'edit-alarm') { closeModal(); openAddEditAlarm(el.dataset.id); return; }
    if (act === 'del-alarm') {
      const al = (state.alarms||[]).find(a => a.id === el.dataset.id);
      if (al) confirmModal(`Delete alarm "${escapeHTML(al.label||'Alarm')}"?`, () => {
        state.alarms = (state.alarms||[]).filter(a => a.id !== al.id);
        const t = _alarmTimers.get(al.id); if (t) { clearTimeout(t); _alarmTimers.delete(al.id); }
        saveState(); openAlarmManager(); toast('Alarm deleted', 'danger');
      });
      return;
    }
    if (act === 'toggle-alarm') {
      const al = (state.alarms||[]).find(a => a.id === el.dataset.id);
      if (al) {
        al.enabled = el.checked; saveState();
        if (al.enabled) { _scheduleOneAlarm(al); toast(`⏰ Alarm enabled`, 'success'); }
        else { const t=_alarmTimers.get(al.id); if(t){clearTimeout(t);_alarmTimers.delete(al.id);} toast('Alarm disabled', 'info'); }
      }
      return;
    }
  });

  // Focus duration change (input)
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'focus-task-select') { focusCurrentTaskKey = el.value || null; if (fsSessionActive) renderFullSession(); else renderFocus(); return; }
    if (el.dataset.act === 'intensity-select') {
      const mode = el.value || 'none';
      startFocusIntensity(mode);
      renderFocus();
      if (mode !== 'none') {
        const t = FOCUS_INTENSITY_TRACKS.find(x => x.id === mode);
        toast(`${t.label} activated — use headphones for binaural effect 🎧`, 'info', 4000);
      }
      return;
    }
    if (el.id === 'ambient-vol-slider') { setAmbientVolume(parseFloat(el.value)); return; }
    if (el.id === 'binaural-vol-slider') { setBinauralVolume(el.value); return; }
    if (el.id === 'stats-import-file') { importData(el.files[0]); el.value = ''; return; }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'ambient-vol-slider') { setAmbientVolume(parseFloat(el.value)); return; }
    if (el.id === 'binaural-vol-slider') { setBinauralVolume(el.value); return; }
    if (el.dataset.act === 'focus-dur-change') {
      const dmode = el.dataset.dmode, val = parseInt(el.value, 10);
      if (dmode && !isNaN(val) && val >= 1 && val <= 120) {
        customDurations[dmode] = val;
        if (dmode === focusMode && !focusRunning) { focusSeconds = val * 60; updateFocusDisplay(); }
      }
    }
  });

  // Bottom nav click
  document.querySelector('.bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]'); if (!btn) return;
    const tab = btn.dataset.tab;
    switchTab(tab);
    if (tab === 'focus') renderFocus();
    else renderAll();
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('vp-overlay')) { closeVideoPlayer(); return; }
      if (fsSessionActive) { exitFullSession(); stopAmbient(); ambientMode = 'none'; }
      else closeModal();
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'social-join-input') {
      e.preventDefault();
      _sJoinRoom(e.target.value.trim().toUpperCase()).catch(() => {});
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'cls-url-input') {
      e.preventDefault();
      const url = e.target.value.trim();
      if (!url) return;
      _classroomLastUrl = url;
      try { localStorage.setItem('cls_last_url', url); } catch(ex) {}
      openQuickPlayer(url);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && fsSessionActive) { exitFullSession(); }
  });

  window.addEventListener('beforeunload', e => {
    if ((focusRunning && focusLocked) || (_vfmActive && !_vfmComplete)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Orientation & resize — force layout recalculation so CSS media queries reapply cleanly
  function onOrientationChange() {
    setTimeout(() => {
      // Sync --vh for any CSS that needs exact viewport height
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
      // Re-render the active view so grid/flex layouts recalculate
      const active = document.querySelector('.view.active');
      if (active) {
        if (active.id === 'view-focus') renderFocus();
        else if (active.id === 'view-stats') renderStats();
      }
    }, 350);
  }
  window.addEventListener('orientationchange', onOrientationChange);

  // Unlock screen rotation so the PWA can rotate freely in both orientations
  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (_) {}
  }

  // Debounced resize — avoids thrashing layout on every pixel change
  let _resizeRaf;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(_resizeRaf);
    _resizeRaf = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
    });
  });
  // Set initial value
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');

  // Mobile keyboard adjustment
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const kbH = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--kb-h', kbH + 'px');
      document.body.classList.toggle('kb-open', kbH > 80);
    });
  }

  // Page visibility — sync focus timer when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Sync timer to wall-clock elapsed time (fixes background throttling)
      if (focusRunning && focusStartTime !== null) {
        const elapsed = Math.floor((Date.now() - focusStartTime) / 1000);
        focusSeconds = Math.max(0, focusStartSeconds - elapsed);
        updateFocusDisplay();
        updateMiniTimer();
        // If timer expired while app was backgrounded, trigger completion now
        if (focusSeconds <= 0) focusTick();
      }
      // Re-validate notification schedule (catches any missed/expired timers)
      scheduleAllNotifications();
      // Re-acquire alarm wake lock if alarm is still active
      if (_activeAlarmId && !_alarmWakeLock && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(wl => { _alarmWakeLock = wl; }).catch(() => {});
      }
    }
  });

  // ========== Init ==========
  function init() {
    _migrateLegacyBadges();
    applyTheme(getActiveTheme());
    pruneRevisions();
    initMiniTimer();
    switchTab('home');
    renderAll();
    renderFocus();
    startTimers(); // calls scheduleAllNotifications() internally
    scheduleAllAlarms();
    applyEyCareMode();
    startMotivationRotation();
    startMotivationIntervalLoop();
    setTimeout(maybeAutoShowBurnoutPopup, 2500);
    maybeShowBackupReminder();
    _initFirebase();
    setTimeout(_sSocialInit, 3000); // resume social room after Firebase auth resolves
    // Enter key: handled natively by the form submit event (auth-submit is type="button",
    // so form submit fires on Enter in email/password fields via the showAuthModal listener).
  }

  function safeInit() {
    try { init(); }
    catch(e) {
      console.error('[Init error]', e);
      document.body.insertAdjacentHTML('afterbegin',
        `<div style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#c00;color:#fff;padding:12px;font-size:13px;word-break:break-all">
          App init error: ${e.message}<br><pre style="font-size:11px;margin:4px 0 0">${(e.stack||'').split('\n').slice(0,4).join('\n')}</pre>
        </div>`);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit);
  else safeInit();

})();
