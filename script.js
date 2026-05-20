(() => {
  'use strict';

  // ── Cloud sync / auth state ──────────────────────────────────────────────
  let _db             = null;
  let _auth           = null;
  let _userId         = null;
  let _cloudSyncTimer = null;
  let _cloudRestoreInProgress = false; // blocks cloud writes during initial restore
  let _userHasCloudData = false;       // true once we confirm the user has a valid Firestore document
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
      streak: { count: 0, lastDate: null },
      activity: { [todayKey()]: 0 },
      dailyPlans: {},
      smartReminder: { enabled: false, times: ['20:00'], lastFired: {} },
      motivationReminders: { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} },
      notificationPrefs: {
        studyReminder: true, pomodoroEnd: true, groupInvite: true,
        groupMessage: false, challengeRequest: true, mention: true,
        dailyGoal: true, streakWarning: true, taskDeadline: true,
        liveInvite: true, xpReward: true, achievement: true,
        sound: true, vibrate: true,
      },
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
    // Ensure syllabus array exists on all plan entries
    for (const key of Object.keys(s.dailyPlans)) {
      if (!s.dailyPlans[key].syllabus) s.dailyPlans[key].syllabus = [];
    }
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
    if (!s.focusStats.topicsCompletedByDate) s.focusStats.topicsCompletedByDate = {};
    if (!s.focusStats.completedTaskKeys) s.focusStats.completedTaskKeys = {};
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
    // taskAwards: map of taskKey → XP amount awarded, used to reverse XP on uncheck/delete
    if (!s.xp.taskAwards || typeof s.xp.taskAwards !== 'object') s.xp.taskAwards = {};
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
    // XP Marketplace state
    if (!s.shopBooster || typeof s.shopBooster !== 'object') s.shopBooster = { expiresAt: null };
    if (typeof s.focusMusicUnlocked !== 'boolean') s.focusMusicUnlocked = false;
    if (typeof s.themeUnlocked !== 'boolean') s.themeUnlocked = false;
    if (typeof s.selectedTheme !== 'string') s.selectedTheme = 'default';
    // Migrate legacy theme ID
    if (s.selectedTheme === 'buet-blue') s.selectedTheme = 'aurora-blue';
    if (typeof s.selectedBadge !== 'string') s.selectedBadge = '';
    if (typeof s.customBadgeOwned !== 'boolean') s.customBadgeOwned = false;
    if (!s.notificationPrefs || typeof s.notificationPrefs !== 'object') {
      s.notificationPrefs = {
        studyReminder: true, pomodoroEnd: true, groupInvite: true,
        groupMessage: false, challengeRequest: true, mention: true,
        dailyGoal: true, streakWarning: true, taskDeadline: true,
        liveInvite: true, xpReward: true, achievement: true,
        sound: true, vibrate: true,
      };
    }
    const _npDefaults = { studyReminder:true,pomodoroEnd:true,groupInvite:true,groupMessage:false,challengeRequest:true,mention:true,dailyGoal:true,streakWarning:true,taskDeadline:true,liveInvite:true,xpReward:true,achievement:true,sound:true,vibrate:true };
    Object.keys(_npDefaults).forEach(k => { if (typeof s.notificationPrefs[k] === 'undefined') s.notificationPrefs[k] = _npDefaults[k]; });
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
    // Stamp a local timestamp so conflict resolution can compare against cloud updatedAt
    state._savedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    _scheduledCloudSync();
  }

  // ── Offline/Skip Auth ────────────────────────────────────────────────────
  let _authSkipped = false; // Guest mode removed — authentication is required

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

  // Show the login modal. For returning users Firebase fires onAuthStateChanged soon,
  // so we give it a short window (1.5 s) before forcing the screen. For new users
  // (no persisted session) we show immediately after a tiny DOM-ready delay.
  function _scheduleModal() {
    if (_modalDelayTimer) { clearTimeout(_modalDelayTimer); _modalDelayTimer = null; }
    const delay = (!_redirectCheckDone && _wasLoggedIn()) ? 1500 : 400;
    _modalDelayTimer = setTimeout(() => {
      _modalDelayTimer = null;
      if (_auth && _auth.currentUser) return;
      showAuthModal();
    }, delay);
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
      _scheduleModal();
      _showAuthError('Connection issue — please refresh or try again later.');
    }
  }

  // ── Local snapshot: save current state before any cloud restore so the user
  //    can always recover their last local version if something goes wrong.
  const SNAPSHOT_KEY = 'stk_pre_restore_snapshot';
  function _takeLocalSnapshot() {
    try {
      const snap = { takenAt: Date.now(), state: JSON.parse(JSON.stringify(state)) };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      console.log('[Snapshot] Local snapshot taken before cloud restore');
    } catch (_) {}
  }
  function _getLocalSnapshot() {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null'); } catch (_) { return null; }
  }

  function _scheduledCloudSync() {
    if (!_db || !_userId || !(_auth && _auth.currentUser)) return;
    if (_cloudRestoreInProgress) return; // never upload local state while a cloud restore is in flight
    // Safety net: if we know this user has real cloud data but local state looks empty
    // (e.g. fresh tab, corrupted localStorage), refuse to upload and let the next
    // onAuthStateChanged cycle restore from cloud instead.
    if (_userHasCloudData && (!Array.isArray(state.subjects) || state.subjects.length === 0)) {
      console.warn('[Firestore] Blocked upload: user has cloud data but local subjects array is empty — skipping to protect cloud data.');
      return;
    }
    clearTimeout(_cloudSyncTimer);
    const uid = _userId;
    _cloudSyncTimer = setTimeout(() => {
      if (!uid || _cloudRestoreInProgress) return;
      // Final empty-state guard inside the timeout (state could change in the 3 s window)
      if (_userHasCloudData && (!Array.isArray(state.subjects) || state.subjects.length === 0)) {
        console.warn('[Firestore] Blocked deferred upload: empty subjects, cloud data exists — skipping.');
        return;
      }
      // Use merge:true to never accidentally wipe fields (e.g. joinedRooms) that are
      // managed by separate join/leave operations. Only update data + metadata here.
      // joinedRooms is only written when it actually changes (join/leave group logic).
      _db.collection('users').doc(uid).set({
        data:      JSON.stringify(state),
        uid:       uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(e => {
        console.warn('[Firestore] Write failed:', e.message);
      });
    }, 3000);
  }

  // ── Force-restore from cloud: manual recovery triggered from Settings ─────
  async function _forceRestoreFromCloud() {
    if (!_db || !_userId) { toast('Sign in first to restore from cloud.', 'warn'); return; }
    try {
      toast('Fetching your cloud data…', 'info', 2500);
      const snap = await _db.collection('users').doc(_userId).get();
      if (!snap.exists || !snap.data() || !snap.data().data) {
        toast('No cloud data found for your account.', 'warn', 4000); return;
      }
      const parsed = JSON.parse(snap.data().data);
      if (!parsed || !Array.isArray(parsed.subjects)) {
        toast('Cloud data is unreadable — please contact support.', 'danger', 5000); return;
      }
      // Snapshot local state before overwriting
      _takeLocalSnapshot();
      _cloudRestoreInProgress = true;
      clearTimeout(_cloudSyncTimer);
      state = migrate(JSON.parse(JSON.stringify(parsed)));
      state._savedAt = Date.now();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      _userHasCloudData = true;
      _cloudRestoreInProgress = false;
      renderAll();
      closeModal();
      const subCount = parsed.subjects.length;
      const xpTotal  = parsed.xp ? parsed.xp.total : 0;
      toast(`✅ Restored! ${subCount} subject${subCount !== 1 ? 's' : ''} · ${xpTotal} XP recovered from cloud.`, 'success', 6000);
      console.log('[Restore] Manual cloud restore complete. Subjects:', subCount, '| XP:', xpTotal);
      // Restore group memberships too
      const savedRooms = snap.data().joinedRooms;
      if (Array.isArray(savedRooms) && savedRooms.length) {
        _myGroupCodes = Array.from(new Set([..._myGroupCodes, ...savedRooms]));
        try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
      }
    } catch (e) {
      _cloudRestoreInProgress = false;
      console.warn('[Restore] Manual restore failed:', e.message);
      toast('Restore failed: ' + e.message, 'danger', 5000);
    }
  }

  async function _restoreFromCloud() {
    if (!_db || !_userId) return;
    try {
      const snap = await _db.collection('users').doc(_userId).get();
      if (!snap.exists) return;
      const raw = snap.data().data;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.subjects)) return;
      state = migrate(JSON.parse(JSON.stringify(parsed)));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      renderAll();
    } catch (e) {
      console.warn('[Firestore] Restore failed:', e.message);
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
      refreshSettingsIfOpen();
      console.log('[Auth] Signed in:', user.email || user.uid);
      // Kick off FCM + notification permission after login (non-blocking)
      setTimeout(() => {
        _requestNotifPermissionFlow();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') _initFCM();
      }, 1000);
      if (!_db) return;
      // ── GUARD: block all cloud writes until restore is complete ──────────
      _cloudRestoreInProgress = true;
      clearTimeout(_cloudSyncTimer);
      try {
        const snap = await _db.collection('users').doc(user.uid).get();
        if (snap.exists && snap.data() && snap.data().data) {
          const parsed = JSON.parse(snap.data().data);
          if (parsed && Array.isArray(parsed.subjects)) {
            // ── Conflict resolution: prefer whichever copy is newer ──────
            // Cloud timestamp (Firestore serverTimestamp stored as seconds)
            const cloudTs = (snap.data().updatedAt && snap.data().updatedAt.seconds)
              ? snap.data().updatedAt.seconds * 1000
              : 0;
            // Local timestamp stored by saveState on every user action
            const localTs = state._savedAt || 0;
            // Always use cloud data if it has any real content, regardless of
            // timestamp — empty local state must NEVER win over existing cloud data.
            const localHasRealData = Array.isArray(state.subjects) && state.subjects.length > 0;
            const cloudHasRealData = Array.isArray(parsed.subjects) && parsed.subjects.length > 0;
            const useCloud = cloudHasRealData || !localHasRealData || cloudTs >= localTs;
            // Mark that this user definitely has cloud data — guards future empty-state uploads
            _userHasCloudData = true;
            if (useCloud) {
              console.log('[Auth] Restoring from cloud data (cloudTs=' + cloudTs + ', localTs=' + localTs + ')');
              // Snapshot local state before overwriting so the user can recover it if needed
              _takeLocalSnapshot();
              state = migrate(JSON.parse(JSON.stringify(parsed)));
              try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
            } else {
              console.log('[Auth] Local data is newer — will sync to cloud after restore guard lifts');
            }
            // Restore joined rooms from Firestore profile
            const savedRooms = snap.data().joinedRooms;
            if (Array.isArray(savedRooms) && savedRooms.length) {
              _myGroupCodes = Array.from(new Set([..._myGroupCodes, ...savedRooms]));
              try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
            }
            // Also fetch rooms where this user is admin/creator (may not be in joinedRooms)
            try {
              const createdSnap = await _db.collection('groups').where('createdBy', '==', user.uid).get();
              createdSnap.forEach(d => {
                if (!_myGroupCodes.includes(d.id)) {
                  _myGroupCodes.push(d.id);
                  _myGroupRoomMeta[d.id] = { roomName: d.data().roomName || null, description: d.data().description || '', memberCount: null };
                }
              });
              try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
              if (_db && user.uid) _db.collection('users').doc(user.uid).set({ joinedRooms: _myGroupCodes }, { merge: true }).catch(() => {});
            } catch(_) {}
            _cloudRestoreInProgress = false;
            renderAll();
            if (_currentTab === 'social') renderSocial();
            // If local was newer, now push it up to cloud
            if (!useCloud) _scheduledCloudSync();
            // Re-run group restoration so sc_v1 is repopulated even if user wasn't
            // logged in when social.js first initialised (auth modal was showing).
            setTimeout(() => { if (window._socialRestoreGroups) window._socialRestoreGroups(); }, 800);
            // Reconcile presence: writes real today-minutes to all group member docs
            // so stale 0-minute entries are corrected immediately after sign-in.
            setTimeout(() => { if (window._socialReconcilePresence) window._socialReconcilePresence(); }, 1200);
            // Check for duplicate username and force re-entry if clashing
            setTimeout(() => _checkAndEnforceUniqueUsername().catch(() => {}), 2500);
            return;
          }
        }
        // Restore joinedRooms from whatever cloud doc exists (even without app data)
        const existingRooms = snap.exists && snap.data() && snap.data().joinedRooms;
        if (Array.isArray(existingRooms) && existingRooms.length) {
          _myGroupCodes = Array.from(new Set([..._myGroupCodes, ...existingRooms]));
          try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        }
        // Fetch admin-created rooms even if no cloud app data exists yet
        try {
          const createdSnap = await _db.collection('groups').where('createdBy', '==', user.uid).get();
          createdSnap.forEach(d => {
            if (!_myGroupCodes.includes(d.id)) {
              _myGroupCodes.push(d.id);
              _myGroupRoomMeta[d.id] = { roomName: d.data().roomName || null, description: d.data().description || '', memberCount: null };
            }
          });
          try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        } catch(_) {}
        // Only upload local state for genuinely new users (no Firestore doc yet).
        // NEVER overwrite an existing cloud document — that would destroy real data.
        if (!snap.exists) {
          _cloudRestoreInProgress = false;
          await _db.collection('users').doc(user.uid).set({
            data:        JSON.stringify(state),
            uid:         user.uid,
            joinedRooms: _myGroupCodes,
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
          });
          toast('\u2705 Account linked! Data saved to cloud.', 'success', 4000);
        } else {
          // Doc exists but app data was missing or unreadable — preserve it,
          // just update the joinedRooms and uid fields safely.
          console.warn('[Auth] Cloud doc exists but app data was unreadable — preserving cloud data.');
          _cloudRestoreInProgress = false;
          if (_myGroupCodes.length) {
            _db.collection('users').doc(user.uid).set({
              uid:         user.uid,
              joinedRooms: _myGroupCodes,
              updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => {});
          }
        }
        // Check for duplicate username even for new accounts
        setTimeout(() => _checkAndEnforceUniqueUsername().catch(() => {}), 2500);
      } catch (e) {
        console.warn('[Auth] Sync error:', e.message);
        _cloudRestoreInProgress = false; // always clear guard on error
      }
    } else {
      _userId = null;
      _userHasCloudData = false; // reset so next sign-in re-confirms cloud data existence
      // Leave room and clean up all social listeners on sign-out
      if (_socialRoomCode) _sLeaveRoom();
      if (_globalLbUnsub) { _globalLbUnsub(); _globalLbUnsub = null; }
      // Reset social group state on sign-out so next sign-in loads fresh from Firestore
      _myGroupCodes = [];
      _myGroupRoomMeta = {};
      _publicRooms = [];
      _publicRoomsLoading = false;
      try { localStorage.removeItem('my_group_codes'); } catch(_) {}
      _scheduleModal();
      refreshSettingsIfOpen();
    }
  }

  // ── Auth UI Helpers ──────────────────────────────────────────────────────
  function showAuthModal() {
    const el = document.getElementById('auth-overlay');
    if (!el) return;
    el.classList.remove('hidden');

    // Always clear fields and reset state when the login screen appears
    const emailEl = document.getElementById('auth-email');
    const passEl  = document.getElementById('auth-password');
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';
    _setAuthLoading(false);
    _clearAuthError();

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
  // Deletes every document in a Firestore subcollection, paginating if needed.
  async function _deleteSubcollection(colRef) {
    let lastDoc = null;
    for (;;) {
      let q = colRef.limit(200);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get().catch(() => null);
      if (!snap || snap.empty) break;
      await Promise.allSettled(snap.docs.map(d => d.ref.delete()));
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < 200) break;
    }
  }

  // Wipes ALL traces of a user from every group they ever joined:
  // messages, presence, members, voice, join requests and active duels.
  async function _wipeUserFromAllGroups(uid) {
    if (!_db || !uid) return;
    // Gather all group codes from memory + Firestore
    let groupCodes = Array.from(new Set([
      ..._myGroupCodes,
      ...(_socialRoomCode ? [_socialRoomCode] : [])
    ]));
    try {
      const userSnap = await _db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        const stored = userSnap.data().joinedRooms;
        if (Array.isArray(stored)) groupCodes = Array.from(new Set([...groupCodes, ...stored]));
      }
    } catch(_) {}
    // Include groups this user created
    try {
      const createdSnap = await _db.collection('groups').where('createdBy', '==', uid).get();
      createdSnap.forEach(d => { groupCodes = Array.from(new Set([...groupCodes, d.id])); });
    } catch(_) {}

    await Promise.allSettled(groupCodes.map(async code => {
      const groupRef = _db.collection('groups').doc(code);
      try {
        const roomSnap = await groupRef.get();
        if (roomSnap.exists && roomSnap.data().createdBy === uid) {
          // Creator → delete the entire group including all subcollections
          await Promise.allSettled([
            _deleteSubcollection(groupRef.collection('presence')),
            _deleteSubcollection(groupRef.collection('members')),
            _deleteSubcollection(groupRef.collection('messages')),
            _deleteSubcollection(groupRef.collection('joinRequests')),
            _deleteSubcollection(groupRef.collection('voice_signals')),
            _deleteSubcollection(groupRef.collection('voice_presence')),
          ]);
          await groupRef.delete().catch(() => {});
          return;
        }
      } catch(_) {}

      // Not creator — remove only this user's traces
      const ops = [
        groupRef.collection('presence').doc(uid).delete(),
        groupRef.collection('members').doc(uid).delete(),
        groupRef.collection('joinRequests').doc(uid).delete(),
        groupRef.collection('voice_presence').doc(uid).delete(),
      ];
      // Delete voice signaling doc if it exists
      try { ops.push(groupRef.collection('voice_signals').doc(uid).delete()); } catch(_) {}
      // Delete all messages sent by this user
      try {
        const msgsSnap = await groupRef.collection('messages').where('uid', '==', uid).get();
        msgsSnap.forEach(d => ops.push(d.ref.delete()));
      } catch(_) {}
      // Cancel active duels involving this user
      try {
        const roomSnap = await groupRef.get();
        if (roomSnap.exists) {
          const currentDuels = roomSnap.data().duels || [];
          const updatedDuels = currentDuels.map(d => {
            if (!d.winner && d.duelState !== 'COMPLETED' && (d.challenger === uid || d.opponent === uid)) {
              return { ...d, winner: 'cancelled', duelState: 'COMPLETED' };
            }
            return d;
          });
          if (updatedDuels.some((d, i) => d !== currentDuels[i])) {
            ops.push(groupRef.update({ duels: updatedDuels }));
          }
        }
      } catch(_) {}
      await Promise.allSettled(ops);
      // Recount actual members after this user's doc was removed
      try { window._socialRecalcMemberCount?.(code); } catch(_) {}
    }));

    // Delete the user's global active-session doc (cross-group presence)
    try { await _db.collection('activeSessions').doc(uid).delete(); } catch(_) {}
    // Flush the social layer's in-memory state for this UID so group renders
    // stop showing the deleted user immediately without waiting for snapshots
    try { window._socialCascadeCleanupUid?.(uid); } catch(_) {}
  }

  // Clears all local app data from localStorage after account deletion
  function _wipeLocalData() {
    try {
      const keysToRemove = [
        STORAGE_KEY, 'stk_logged_in', 'stk_auth_skipped',
        'social_room_code', 'my_group_codes',
        'live_study_state', 'themeStore_v1',
      ];
      keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
    } catch(_) {}
  }

  async function _authDeleteAccount() {
    const user = _auth && _auth.currentUser;
    if (!user) return;
    const isEmailUser = user.providerData && user.providerData.some(p => p.providerId === 'password');
    // Helper: run full Firebase + local wipe then delete the Auth account
    const _doFullDelete = async (uid, setStatus) => {
      if (_db && uid) {
        setStatus('Deleting groups…');
        // Wipe created groups AND membership in all other groups
        await _wipeUserFromAllGroups(uid);
        setStatus('Deleting account data…');
        // Wipe top-level user documents
        await Promise.allSettled([
          _db.collection('users').doc(uid).delete(),
          _db.collection('global_lb').doc(uid).delete(),
        ]);
      }
      setStatus('Removing account…');
      await user.delete();
      // Clear local data so the app resets cleanly
      _wipeLocalData();
    };

    // Confirm intent first
    confirmModal(
      'This will permanently delete your account, all your cloud data, and all groups you created. This cannot be undone.',
      () => {
        if (isEmailUser) {
          // Need password for re-authentication
          openModal(`<h3>Confirm Delete</h3>
            <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Enter your password to permanently delete your account and all associated data.</p>
            <div class="field"><label>Password</label><input id="del-pw-input" type="password" placeholder="Your password" autocomplete="current-password"/></div>
            <div id="del-status" style="color:var(--text-muted);font-size:12px;margin-top:6px;display:none"></div>
            <div id="del-err" style="color:#ef4444;font-size:12px;margin-top:6px;display:none"></div>
            <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" id="del-confirm-btn">Delete Account</button></div>`,
            root => {
              const input   = root.querySelector('#del-pw-input');
              const errEl   = root.querySelector('#del-err');
              const statusEl= root.querySelector('#del-status');
              const btn     = root.querySelector('#del-confirm-btn');
              const setStatus = msg => { statusEl.textContent = msg; statusEl.style.display = msg ? '' : 'none'; };
              const doDelete = async () => {
                const pw = input.value;
                if (!pw) { errEl.textContent = 'Password is required.'; errEl.style.display = ''; return; }
                btn.disabled = true; btn.textContent = 'Deleting…';
                errEl.style.display = 'none';
                try {
                  const cred = firebase.auth.EmailAuthProvider.credential(user.email, pw);
                  await user.reauthenticateWithCredential(cred);
                  const uid = _userId;
                  await _doFullDelete(uid, setStatus);
                  closeModal();
                  toast('Account and all data permanently deleted.', 'info', 5000);
                  setTimeout(() => location.reload(), 1200);
                } catch(e) {
                  btn.disabled = false; btn.textContent = 'Delete Account';
                  setStatus('');
                  errEl.textContent = e.code === 'auth/wrong-password' ? 'Incorrect password.' : (e.message || 'Failed to delete account.');
                  errEl.style.display = '';
                }
              };
              btn.onclick = doDelete;
              input.addEventListener('keydown', e => { if (e.key === 'Enter') doDelete(); });
            });
        } else {
          // Non-email provider: attempt delete directly
          (async () => {
            try {
              const uid = _userId;
              await _doFullDelete(uid, () => {});
              toast('Account and all data permanently deleted.', 'info', 5000);
              setTimeout(() => location.reload(), 1200);
            } catch(e) {
              if (e.code === 'auth/requires-recent-login') {
                toast('Please sign out and sign back in, then try deleting again.', 'warn', 5000);
              } else {
                toast(e.message || 'Failed to delete account.', 'danger');
              }
            }
          })();
        }
      },
      { title: 'Delete Account?', yesLabel: 'Continue', yesClass: 'btn btn-danger', noLabel: 'Cancel' }
    );
  }

  async function _authSignOut() {
    if (!_auth) return;
    try {
      // Save full state to Firestore before signing out so data is never lost
      if (_db && _userId) {
        clearTimeout(_cloudSyncTimer);
        const uid = _userId;
        try {
          await _db.collection('users').doc(uid).set({
            data:        JSON.stringify(state),
            uid:         uid,
            joinedRooms: _myGroupCodes,
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { console.warn('[Auth] Pre-signout sync failed:', e.message); }
      }
      try { localStorage.removeItem('stk_logged_in'); } catch(_) {}
      await _auth.signOut();
    } catch (e) { console.warn('[Auth] Sign out error:', e.message); }
    // Clear login form fields and reset button state after sign-out
    const emailEl = document.getElementById('auth-email');
    const passEl  = document.getElementById('auth-password');
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';
    _setAuthLoading(false);
    _clearAuthError();
  }

  // ── FCM / Push Notifications ──────────────────────────────────────────
  let _messaging  = null;
  let _fcmToken   = null;

  async function _getFCMVapidKey() {
    try {
      const r = await fetch('/api/config');
      if (r.ok) { const d = await r.json(); return d.vapidKey || null; }
    } catch(_) {}
    return null;
  }

  async function _initFCM() {
    if (_messaging) return _messaging;
    if (!window.firebase || !firebase.messaging) return null;
    try {
      _messaging = firebase.messaging();
      const vapidKey = await _getFCMVapidKey();
      const token = await _messaging.getToken(vapidKey ? { vapidKey } : undefined);
      if (token) {
        _fcmToken = token;
        await _registerFCMToken(token);
        console.log('[FCM] Token registered');
      }
      _messaging.onMessage(payload => {
        const n = payload.notification || {};
        const data = payload.data || {};
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notif = new Notification(n.title || 'Study Hub', {
            body:  n.body  || '',
            icon:  n.icon  || '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data:  { url: data.url || '/' },
            tag:   data.tag || 'sh-fg',
          });
          notif.onclick = () => { window.focus(); _handleFCMNavigate(data.url || '/'); notif.close(); };
        }
      });
      // Listen for clicks from bg notifications via SW
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', e => {
          if (e.data && e.data.type === 'FCM_NAVIGATE') _handleFCMNavigate(e.data.url);
        });
      }
      return _messaging;
    } catch (e) {
      console.warn('[FCM] Init failed:', e.message);
      return null;
    }
  }

  async function _registerFCMToken(token) {
    if (!_db || !_userId || !token) return;
    try {
      await _db.collection('users').doc(_userId).set(
        { fcmTokens: firebase.firestore.FieldValue.arrayUnion(token) },
        { merge: true }
      );
    } catch(e) { console.warn('[FCM] Token registration failed:', e.message); }
  }

  function _handleFCMNavigate(url) {
    if (!url) return;
    const tab = url.startsWith('/social') ? 'social' :
                url.startsWith('/focus')  ? 'focus'  :
                url.startsWith('/stats')  ? 'stats'  :
                url.startsWith('/dash')   ? 'dashboard' : 'home';
    switchTab(tab);
  }

  function _requestNotifPermissionFlow() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') return; // Already granted
    let asked = false;
    try { asked = localStorage.getItem('stk_notif_asked') === '1'; } catch(_) {}
    if (asked) return;
    // Show permission modal
    _showNotifPermModal();
  }

  function _showNotifPermModal() {
    openModal(`
      <div style="text-align:center;padding:8px 0 4px">
        <div style="font-size:40px;margin-bottom:12px">🔔</div>
        <div style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:8px">Stay On Track</div>
        <div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:20px">
          Get reminders for study sessions, pomodoro ends, group invites,
          streak warnings, and daily goals — even when the app is closed.
        </div>
        <button class="btn" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#ff7a1a,#ff4d00);border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:600" data-act="notif-perm-allow">
          Enable Notifications
        </button>
        <button class="stg-btn" style="width:100%;border-radius:12px;padding:11px;font-size:13px;color:#64748b;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)" data-act="notif-perm-skip">
          Not now
        </button>
      </div>
    `);
  }

  // ======================================================================
  // ========== Social Community Bridge ===================================
  // ======================================================================
  // Old social system removed. New lightweight system lives in social.js.
  // These stubs keep all existing references intact and prevent any errors.

  let _socialRoomCode       = null;
  let _socialMembers        = {};
  let _socialRoomMembersList= {};
  let _socialRoomData       = null;
  let _myGroupCodes         = (() => { try { return JSON.parse(localStorage.getItem('my_group_codes') || '[]'); } catch(_) { return []; } })();
  let _myGroupRoomMeta      = {};
  let _globalLbUnsub        = null;
  let _publicRooms          = [];
  let _publicRoomsLoading   = false;
  let _lbView               = 'group';
  let _socialRoomTab        = 'members';
  let _socialIsBg           = false;
  let _chatMessages         = [];
  let _chatScrollAtBottom   = true;
  let _chatReplyTarget      = null;
  let _socialPaneAnimPlayed = false;
  let _socialRoomAnimPlayed = false;
  let _socialReconnectTimer = null;
  let _socialReconnectAttempts = 0;
  let _socialLastInputAt    = Date.now();
  let _socialUnsubPresence  = null;
  let _socialUnsubRoom      = null;
  let _socialUnsubChat      = null;
  let _socialUnsubMembers   = null;
  let _socialHeartbeatId    = null;
  let _socialLobbyCode      = null;
  let _socialLiveTimerId    = null;
  let _globalLbData         = [];
  let _voicePeers           = {};
  let _localStream          = null;
  let _inVoice              = false;
  let _voiceMuted           = false;
  let _effData              = { weekly: [], monthly: [] };
  let _effGraphMode         = 'weekly';
  let _socialSyncTimer      = null;
  let _processedDuelIds     = new Set();
  let _socialIdleBump       = null;

  function _stopSocialLiveTimers()     {}
  function _sUpdatePresence(status) {
    try {
      if (!_db || !_userId || !_socialRoomCode || typeof firebase === 'undefined') return Promise.resolve();
      const isStudying = (status === 'focusing');
      const tk = todayKey();
      const todayMins = ((state.focusStats || {}).minutesByDate || {})[tk] || 0;
      const userName = (state.profile && state.profile.name) ||
        (firebase.auth().currentUser && firebase.auth().currentUser.displayName) ||
        'Anonymous';
      const update = {
        uid:              _userId,
        displayName:      userName,
        isStudying:       isStudying,
        elapsedTimeToday: todayMins,
        currentSubject:   null,
        dateKey:          tk,
        lastUpdated:      firebase.firestore.FieldValue.serverTimestamp(),
      };
      if (isStudying) update.studyStartedAt = Date.now();
      return _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
        .set(update, { merge: true }).catch(() => {});
    } catch (_) { return Promise.resolve(); }
  }
  function _sContributeToGoals()       { return Promise.resolve(); }
  function _sHandleFocusBounty()       { return Promise.resolve(); }
  function _updateGlobalLb()           {}
  function _loadPublicRooms()          {}
  function _loadGlobalLeaderboard()    { return Promise.resolve(); }
  function _debouncedSocialSync()      {}
  function _sSocialInit()              { return Promise.resolve(); }
  function _sJoinRoom()                { return Promise.resolve(); }
  function _sLeaveRoom()               {}
  function _sSubscribe()               {}
  function _sSetHeartbeatRate()        {}
  function _sSubscribeChat()           {}
  function _sSendMessage()             { return Promise.resolve(); }
  function _sChatDeleteMessage()       { return Promise.resolve(); }
  function _sChatEditMessage()         { return Promise.resolve(); }
  function _sChatPinMessage()          { return Promise.resolve(); }
  function _showChatMsgMenu()          {}
  function _sChatReact()               { return Promise.resolve(); }
  function _sNudge()                   { return Promise.resolve(); }
  function _sChallengeDuel()           { return Promise.resolve(); }
  function _sAddGroupGoal()            { return Promise.resolve(); }
  function _sRemoveGroupGoal()         { return Promise.resolve(); }
  function _sDonateToVault()           { return Promise.resolve(); }
  function _sCreateVault()             { return Promise.resolve(); }
  function _sClaimVaultReward()        { return Promise.resolve(); }
  function _triggerVaultCelebration()  {}
  function _adminKickMember()          {}
  function _adminClearAllMessages()    { return Promise.resolve(); }
  function _adminCloseRoom()           {}
  function _voiceJoin()                {}
  function _voiceLeave()               {}
  function _voiceMuteToggle()          {}
  function _viewMemberProfile()        {}
  function _viewGlobalProfile()        {}
  function _openAdminSettings()        {}
  function _openRoomSettings()         {}
  function _checkAndEnforceUniqueUsername() { return Promise.resolve(); }
  function _dedupedGlobalLb()          { return []; }
  function _sDisplayName() {
    if (state && state.profile && state.profile.name) return state.profile.name;
    const u = _auth && _auth.currentUser;
    if (u) return u.displayName || (u.email && u.email.split('@')[0]) || 'Studier';
    return 'Studier';
  }
  function _sInitials(name) {
    const p = (name || 'S').trim().split(/\s+/);
    return (p.length >= 2 ? p[0][0] + p[1][0] : (name || 'S').slice(0, 2)).toUpperCase();
  }
  function _sAvatarColor() { return '#7c3aed'; }
  function _sGenerateCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
  function _sStatusOf()    { return 'offline'; }

  // New renderSocial — bridges to social.js
  function renderSocial() {
    try { if (window._socialRender) window._socialRender(); }
    catch(e) { console.warn('[Social]', e); }
  }

  // Expose app utilities to social.js
  setTimeout(function() {
    window.appUI = {
      toast:             function(m,t,d)  { toast(m,t,d); },
      openModal:         function(h,cb)   { openModal(h,cb); },
      closeModal:        function()       { closeModal(); },
      confirmModal:      function(m,cb,o) { confirmModal(m,cb,o); },
      html:              function(s)      { return escapeHTML(s); },
      state:             function()       { return state; },
      todayKey:          function()       { return todayKey(); },
      minsToHrs:         function(m)      { return minsToHrs(m); },
      focusIsRunning:    function()       { return focusRunning === true; },
      focusStartTime:    function()       { return focusRunning ? focusStartTime : null; },
      getDb:             function()       { return _db; },
      getUserId:         function()       { return _userId; },
      getUserName:       function()       {
        return (state.profile && state.profile.name) ||
          (typeof firebase !== 'undefined' && firebase.auth().currentUser && firebase.auth().currentUser.displayName) ||
          'Anonymous';
      },
    };
  }, 0);

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
    // 5 s interval (was 2 s) — reduces DOM queries by 60% for mobile battery
    _socialLiveTimerId = setInterval(() => {
      if (document.hidden) return;  // skip entirely when backgrounded
      const now = Date.now();
      document.querySelectorAll('.sm-elapsed[data-focusat], .grm-elapsed[data-focusat]').forEach(el => {
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
    }, 5000);
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

  // Called once on app load — resets streak to 0 if last study was before yesterday
  function _checkStreakReset() {
    if (!state.streak || !state.streak.lastDate) return;
    const today = todayKey();
    const yesterday = addDaysISO(today, -1);
    if (state.streak.lastDate !== today && state.streak.lastDate !== yesterday) {
      // Auto-consume a Streak Freeze if the user owns one
      const freezeQty = (state.inventory || {}).streak_freeze || 0;
      if (freezeQty > 0) {
        if (!state.inventory) state.inventory = {};
        state.inventory.streak_freeze = freezeQty - 1;
        // Pretend they studied yesterday so next bumpActivity continues the streak
        state.streak.lastDate = yesterday;
        saveState();
        setTimeout(() => toast('🧊 Streak Freeze used! Your streak is protected.', 'success', 5000), 1200);
      } else {
        state.streak.count = 0;
        saveState();
      }
    }
  }

  function bumpSyllabusCompletion(n) {
    const k = todayKey();
    if (!state.focusStats.topicsCompletedByDate) state.focusStats.topicsCompletedByDate = {};
    state.focusStats.topicsCompletedByDate[k] = Math.max(0, (state.focusStats.topicsCompletedByDate[k] || 0) + (n || 1));
  }

  function trackCompletion(key, done) {
    const today = todayKey();
    if (!state.focusStats.completedTaskKeys) state.focusStats.completedTaskKeys = {};
    if (!Array.isArray(state.focusStats.completedTaskKeys[today])) state.focusStats.completedTaskKeys[today] = [];
    const arr = state.focusStats.completedTaskKeys[today];
    const idx = arr.indexOf(key);
    if (done && idx === -1) arr.push(key);
    else if (!done && idx !== -1) arr.splice(idx, 1);
    if (!state.focusStats.topicsCompletedByDate) state.focusStats.topicsCompletedByDate = {};
    state.focusStats.topicsCompletedByDate[today] = arr.length;
  }

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
      // Push updated stats to Firebase instantly so social LB reflects new XP
      _debouncedSocialSync();
      return amount;
    },

    // Focus XP: 10 XP per minute, doubled if booster active
    addFocusXP(elapsedMin, dateStr) {
      if (!elapsedMin || elapsedMin <= 0) return;
      const base = Math.max(1, Math.round(elapsedMin * 10));
      const mult = _isBoosterActive() ? 2 : 1;
      const amount = base * mult;
      this.addXP(amount, 'focus');
      this._updateFocusStreak(elapsedMin, dateStr);
      this.checkStreakBonus();
      // Float near the timer ring (works in both normal and full-session views)
      const ringEl = document.querySelector('.focus-ring-center') ||
                     document.querySelector('.fs-timer-wrap')     ||
                     document.querySelector('.focus-ring-wrap');
      showXPFloat(amount, ringEl);
    },

    // Task XP: 50 XP per completed task, doubled if booster active.
    // taskKey uniquely identifies the task so the exact award can be reversed on uncheck/delete.
    addTaskXP(taskKey, sourceEl) {
      if (!state.xp || typeof state.xp !== 'object') state.xp = { total: 0, streakBonusDate: null, taskAwards: {} };
      if (!state.xp.taskAwards) state.xp.taskAwards = {};
      // Duplicate-award guard: if this key is already recorded, XP was already given
      if (state.xp.taskAwards[taskKey]) return;
      const mult = _isBoosterActive() ? 2 : 1;
      const amount = 50 * mult;
      state.xp.taskAwards[taskKey] = amount;   // record so we can reverse it exactly
      this.addXP(amount, 'task');
      showXPFloat(amount, sourceEl || null);
    },

    // Remove the exact XP that was awarded for taskKey (called on uncheck or task delete)
    removeTaskXP(taskKey, sourceEl) {
      if (!state.xp || !state.xp.taskAwards) return;
      const amount = state.xp.taskAwards[taskKey];
      if (!amount) return;                      // task was never awarded XP — nothing to do
      delete state.xp.taskAwards[taskKey];
      state.xp.total = Math.max(0, (state.xp.total || 0) - amount);
      this._updateXPBar();
      _debouncedSocialSync();
      if (sourceEl) showXPFloat(-amount, sourceEl);
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
      // Header XP bar (focus / dashboard header)
      const badge = document.querySelector('.xp-level-badge');
      const fill  = document.querySelector('.xp-bar-fill');
      const label = document.querySelector('.xp-label');
      if (badge) badge.textContent = `Lv.${info.level}`;
      if (fill)  fill.style.width  = `${info.percent}%`;
      if (label) label.textContent = `${info.currentLevelXP}/${info.nextLevelXP} XP`;
      // Home tab XP board — patch in-place so tab switch isn't needed
      const homeLv   = document.querySelector('.xp-board-lv-num');
      const homeBar  = document.querySelector('.xp-board-bar-fill');
      const homeLbls = document.querySelectorAll('.xp-board-bar-label span');
      if (homeLv)  homeLv.textContent   = info.level;
      if (homeBar) { homeBar.style.width = `${info.percent}%`; homeBar.style.minWidth = info.percent > 0 ? '4px' : ''; }
      if (homeLbls.length >= 2) { homeLbls[0].textContent = `${info.currentLevelXP} XP earned`; homeLbls[1].textContent = `${info.nextLevelXP} XP next`; }
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

  // ── XP Booster helpers ────────────────────────────────────────────────────
  function _isBoosterActive() {
    const exp = state.shopBooster && state.shopBooster.expiresAt;
    return !!(exp && Date.now() < exp);
  }
  function _boosterRemaining() {
    if (!_isBoosterActive()) return 0;
    return Math.max(0, state.shopBooster.expiresAt - Date.now());
  }
  function _activateBooster() {
    if (!state.shopBooster || typeof state.shopBooster !== 'object') state.shopBooster = {};
    state.shopBooster.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    saveState();
  }
  function _boosterCountdownStr() {
    const ms = _boosterRemaining();
    if (ms <= 0) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m remaining`;
  }

  // ── Theme application ─────────────────────────────────────────────────────
  // Keys must match the CSS custom-property names used throughout style.css
  const PREMIUM_THEMES = {
    'default':     { label:'Default Dark', '--bg':'#05080f', '--surface':'#0b1220', '--surface-2':'#111b2c', '--surface-3':'#192436', '--primary':'#5badff', '--primary-dim':'rgba(91,173,255,0.14)', '--primary-dark':'#1a7cd6', '--primary-glow':'rgba(91,173,255,0.35)', '--violet':'#b197fc', '--violet-dim':'rgba(177,151,252,0.13)', '--violet-glow':'rgba(177,151,252,0.3)' },
    'dark-gold':   { label:'Dark Gold',    '--bg':'#0a0800', '--surface':'#150f00', '--surface-2':'#1e1600', '--surface-3':'#261c00', '--primary':'#f59e0b', '--primary-dim':'rgba(245,158,11,0.14)', '--primary-dark':'#b45309', '--primary-glow':'rgba(245,158,11,0.35)', '--violet':'#fbbf24', '--violet-dim':'rgba(251,191,36,0.13)', '--violet-glow':'rgba(251,191,36,0.3)' },
    'aurora-blue': { label:'Aurora Blue',  '--bg':'#00050f', '--surface':'#001020', '--surface-2':'#001533', '--surface-3':'#002040', '--primary':'#0ea5e9', '--primary-dim':'rgba(14,165,233,0.14)', '--primary-dark':'#0369a1', '--primary-glow':'rgba(14,165,233,0.35)', '--violet':'#38bdf8', '--violet-dim':'rgba(56,189,248,0.13)', '--violet-glow':'rgba(56,189,248,0.3)' },
    'neon-night':  { label:'Neon Night',   '--bg':'#050010', '--surface':'#0c0020', '--surface-2':'#100028', '--surface-3':'#160035', '--primary':'#a855f7', '--primary-dim':'rgba(168,85,247,0.14)', '--primary-dark':'#7c3aed', '--primary-glow':'rgba(168,85,247,0.35)', '--violet':'#d946ef', '--violet-dim':'rgba(217,70,239,0.13)', '--violet-glow':'rgba(217,70,239,0.3)' },
  };
  function _applyTheme(themeId) {
    const theme = PREMIUM_THEMES[themeId] || PREMIUM_THEMES['default'];
    const root = document.documentElement;
    Object.entries(theme).forEach(([k, v]) => {
      if (k !== 'label') root.style.setProperty(k, v);
    });
    // Keep body data-theme in sync so other listeners (group theme gallery) still work
    if (!themeId || themeId === 'default') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', themeId);
  }
  function _initTheme() {
    const t = (state.themeUnlocked && state.selectedTheme) ? state.selectedTheme : 'default';
    _applyTheme(t);
  }

  // ── Shop booster live-timer interval ─────────────────────────────────────
  let _shopBoosterInterval = null;
  function _startShopBoosterTimer() {
    clearInterval(_shopBoosterInterval);
    _shopBoosterInterval = setInterval(() => {
      if (document.hidden) return;
      const el = document.querySelector('.mkt-booster-countdown');
      if (!el) { clearInterval(_shopBoosterInterval); return; }
      if (_isBoosterActive()) {
        el.textContent = _boosterCountdownStr();
      } else {
        el.closest('.mkt-booster-active-banner') && el.closest('.mkt-booster-active-banner').remove();
        clearInterval(_shopBoosterInterval);
        if (_currentTab === 'shop') renderShop();
      }
    }, 60000);
  }

  // ═══════════════════════════════════════════════════════════════
  // GLOBAL XP MARKETPLACE — ITEM CATALOGUE
  // ═══════════════════════════════════════════════════════════════
  var SHOP_ITEMS = [
    // Profile borders
    { id:'border_flame',      name:'Flame Border',      cat:'profile',  rarity:'epic',      cost:2000,  icon:'🔥', desc:'Animated fire ring pulses around your avatar',        equip:'border' },
    { id:'border_galaxy',     name:'Galaxy Frame',      cat:'profile',  rarity:'legendary', cost:5000,  icon:'🌌', desc:'Swirling galaxy frame — the rarest border',           equip:'border' },
    { id:'border_crystal',    name:'Crystal Aura',      cat:'profile',  rarity:'rare',      cost:1500,  icon:'💎', desc:'Shimmering crystal ring — elegant & rare',            equip:'border' },
    // Profile titles
    { id:'title_botany',      name:'Botany Expert',     cat:'profile',  rarity:'rare',      cost:1200,  icon:'🌿', desc:'Custom title shown in Social rooms',                  equip:'title'  },
    { id:'title_night',       name:'Night Scholar',     cat:'profile',  rarity:'rare',      cost:1200,  icon:'🌙', desc:'For those who study after midnight',                  equip:'title'  },
    { id:'title_focus',       name:'Focus Master',      cat:'profile',  rarity:'epic',      cost:2500,  icon:'⚡', desc:'Elite title — only for the truly dedicated',          equip:'title'  },
    { id:'title_grind',       name:'The Grinder',       cat:'profile',  rarity:'legendary', cost:5000,  icon:'💀', desc:'Legendary status — earned through relentless grind',  equip:'title'  },
    // Visual auras
    { id:'aura_fire',         name:'Fire Aura',         cat:'visual',   rarity:'epic',      cost:3000,  icon:'🔥', desc:'Blazing aura pulses when you\'re online',            equip:'aura'   },
    { id:'aura_lightning',    name:'Lightning Pulse',   cat:'visual',   rarity:'epic',      cost:3500,  icon:'⚡', desc:'Electric pulse rings during focus sessions',         equip:'aura'   },
    { id:'aura_galaxy',       name:'Galaxy Orb',        cat:'visual',   rarity:'legendary', cost:7500,  icon:'🌌', desc:'Orbital galaxy effect — rarest visual in the shop',  equip:'aura'   },
    { id:'aura_leaf',         name:'Leaf Animation',    cat:'visual',   rarity:'common',    cost:800,   icon:'🍃', desc:'Peaceful floating leaves during study sessions',     equip:'aura'   },
    // Utility — stackable / timed
    { id:'streak_freeze',     name:'Streak Freeze',     cat:'utility',  rarity:'rare',      cost:500,   icon:'🧊', desc:'Protects your streak for 1 missed day. Stackable.',   equip:null, stackable:true },
    { id:'xp_boost_2x',       name:'XP Booster 2×',    cat:'utility',  rarity:'rare',      cost:1500,  icon:'⚡', desc:'Doubles ALL earned XP for 24 hours — tasks & focus both.',  equip:null, timed:true },
    // Premium items
    { id:'custom_badge',      name:'Custom Badge',      cat:'premium',  rarity:'legendary', cost:4000,  icon:'🏅', desc:'Equip an animated profile badge: Verified Learner, Hardworker, or Top Grinder.' },
    { id:'theme_unlocker',    name:'Theme Unlocker',    cat:'premium',  rarity:'legendary', cost:3000,  icon:'🎨', desc:'Unlock premium app themes: Dark Gold, Aurora Blue & Neon Night.' },
    // Music tracks — buy individually in Music tab
    { id:'music_soft_rain',   name:'Soft Rain',         cat:'music_track', rarity:'rare',      cost:10000, icon:'🌧️', desc:'Gentle pink-noise rainfall — soft and soothing for long study sessions.' },
    { id:'music_piano_study', name:'Piano Study',       cat:'music_track', rarity:'epic',      cost:10000, icon:'🎹', desc:'Soft piano melody in C major pentatonic — a calming study companion.' },
    { id:'music_forest_calm', name:'Forest Calm',       cat:'music_track', rarity:'rare',      cost:10000, icon:'🌿', desc:'Forest ambience with brown noise, gentle breeze & distant bird calls.' },
    { id:'music_deep_focus',  name:'Deep Focus',        cat:'music_track', rarity:'legendary', cost:10000, icon:'🔮', desc:'Sub-bass drone with slow breathing LFO — engineered for deep concentration.' },
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

  // ═══════════════════════════════════════════════════════════════
  // COSMETIC HELPERS — apply equipped items everywhere
  // ═══════════════════════════════════════════════════════════════

  // Returns border CSS class(es) string for an equipped border item
  function _cmkBorderClass(equippedItems) {
    const b = (equippedItems || {}).border;
    if (!b) return '';
    const key = b.replace('border_', '');
    return `cmk-border cmk-border-${key}`;
  }

  // Returns title HTML badge for an equipped title item
  function _cmkTitleHTML(equippedItems) {
    const tid = (equippedItems || {}).title;
    if (!tid) return '';
    const item = SHOP_ITEMS.find(i => i.id === tid);
    if (!item) return '';
    const key = tid.replace('title_', '');
    return `<span class="cmk-title cmk-title-${key}">${item.icon} ${item.name}</span>`;
  }

  // Returns aura CSS class for the card wrapper
  function _cmkAuraClass(equippedItems) {
    const a = (equippedItems || {}).aura;
    if (!a) return '';
    const key = a.replace('aura_', '');
    return `cmk-aura cmk-aura-${key}`;
  }

  // Returns HTML for the equipped custom badge (shown in profile + social cards)
  var _BADGE_DEFS = {
    verified:   { label: 'Verified Learner', icon: '✅', color: '#34d399', glow: 'rgba(52,211,153,0.45)' },
    hardworker: { label: 'Hardworker',        icon: '💪', color: '#f59e0b', glow: 'rgba(245,158,11,0.45)' },
    grinder:    { label: 'Top Grinder',       icon: '🏆', color: '#fbbf24', glow: 'rgba(251,191,36,0.5)'  },
  };
  function _cmkBadgeHTML(badgeId) {
    if (!badgeId) return '';
    const b = _BADGE_DEFS[badgeId];
    if (!b) return '';
    return `<span class="cmk-badge cmk-badge-${badgeId}" style="--badge-color:${b.color};--badge-glow:${b.glow}">${b.icon} ${b.label}</span>`;
  }

  // Expose to social.js (loaded after this IIFE)
  window._cmkBadgeHTML  = _cmkBadgeHTML;
  window._cmkTitleHTML  = _cmkTitleHTML;
  window._BADGE_DEFS    = _BADGE_DEFS;
  // Returns the current user's equipped badge id, or '' if none
  window._lsGetMyBadge  = () => (state.customBadgeOwned && state.selectedBadge) ? state.selectedBadge : '';

  // Convenience: get current user's equipped items object
  function _myEquipped() { return state.equippedItems || {}; }

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

  // ── Render a single marketplace card ────────────────────────────────────
  function _mktCard(it, bal) {
    const owned    = _itemOwned(it.id);
    const equipped = _itemEquipped(it.id);
    const canAfford = bal >= it.cost;
    const rarityLabel = it.rarity.charAt(0).toUpperCase() + it.rarity.slice(1);

    // Determine item-specific state
    let locked = false, specialHTML = '', btnHTML = '';

    if (it.id === 'xp_boost_2x') {
      if (_isBoosterActive()) {
        specialHTML = `<div class="mkt-booster-active-banner"><span class="mkt-booster-pulse"></span>BOOST ACTIVE — <span class="mkt-booster-countdown">${_boosterCountdownStr()}</span></div>`;
        btnHTML = `<button class="mkt-btn mkt-btn-active" disabled>⚡ BOOST ACTIVE</button>`;
      } else if (canAfford) {
        btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP</button>`;
      } else {
        locked = true;
        btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP</button>`;
      }
    } else if (it.cat === 'music_track') {
      if (owned) {
        btnHTML = `<button class="mkt-btn mkt-btn-owned" disabled>🎵 UNLOCKED</button>`;
      } else if (canAfford) {
        btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP</button>`;
      } else {
        locked = true;
        btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP</button>`;
      }
    } else if (it.id === 'custom_badge') {
      if (state.customBadgeOwned) {
        const badgeBtns = Object.entries(_BADGE_DEFS).map(([id, b]) => {
          const isActive = state.selectedBadge === id;
          return `<button class="mkt-badge-pill${isActive ? ' active' : ''}" data-act="shop-select-badge" data-bid="${id}" style="${isActive ? `--badge-color:${b.color};border-color:${b.color};color:${b.color};box-shadow:0 0 10px ${b.glow}` : ''}">${b.icon} ${b.label}${isActive ? ' ✓' : ''}</button>`;
        }).join('');
        const activeBadge = _BADGE_DEFS[state.selectedBadge];
        const badgePreview = activeBadge ? `<div class="mkt-badge-preview">${_cmkBadgeHTML(state.selectedBadge)}</div>` : '';
        specialHTML = `<div class="mkt-badge-picker">${badgePreview}<div class="mkt-badge-label">Choose your badge:</div><div class="mkt-badge-pills">${badgeBtns}</div></div>`;
        const activeLbl = activeBadge ? activeBadge.label : 'None equipped';
        btnHTML = `<button class="mkt-btn mkt-btn-owned" disabled>🏅 ${escapeHTML(activeLbl)}</button>`;
      } else if (canAfford) {
        btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP</button>`;
      } else {
        locked = true;
        btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP</button>`;
      }
    } else if (it.id === 'theme_unlocker') {
      if (state.themeUnlocked) {
        const allThemes = Object.entries(PREMIUM_THEMES);
        const themeBtns = allThemes.map(([id, t]) => {
          const isActive = (state.selectedTheme || 'default') === id;
          return `<button class="mkt-theme-pill${isActive ? ' active' : ''}" data-act="shop-select-theme" data-tid="${id}">${t.label}${isActive ? ' ✓' : ''}</button>`;
        }).join('');
        specialHTML = `<div class="mkt-badge-picker"><div class="mkt-badge-label">Choose theme:</div><div class="mkt-badge-pills">${themeBtns}</div></div>`;
        const activeThemeName = (PREMIUM_THEMES[state.selectedTheme] || PREMIUM_THEMES['default']).label;
        btnHTML = `<button class="mkt-btn mkt-btn-owned" disabled>🎨 ${escapeHTML(activeThemeName)} Active</button>`;
      } else if (canAfford) {
        btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP</button>`;
      } else {
        locked = true;
        btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP</button>`;
      }
    } else if (it.stackable) {
      const qty = _itemQty(it.id);
      if (canAfford) {
        btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP${qty > 0 ? ` <span class="mkt-qty">×${qty}</span>` : ''}</button>`;
      } else {
        locked = true;
        btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP${qty > 0 ? ` <span class="mkt-qty">×${qty}</span>` : ''}</button>`;
      }
    } else if (equipped) {
      btnHTML = `<button class="mkt-btn mkt-btn-equip" data-act="shop-unequip" data-iid="${it.id}">✓ Equipped — Unequip</button>`;
    } else if (owned) {
      btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-equip" data-iid="${it.id}">Equip</button>`;
    } else if (canAfford) {
      btnHTML = `<button class="mkt-btn mkt-btn-buy" data-act="shop-buy" data-iid="${it.id}">⚡ ${it.cost.toLocaleString()} XP</button>`;
    } else {
      locked = true;
      btnHTML = `<button class="mkt-btn mkt-btn-locked" disabled>⚡ ${it.cost.toLocaleString()} XP</button>`;
    }

    return `<div class="mkt-card rarity-${it.rarity}${locked ? ' mkt-card--locked' : ''}${equipped ? ' mkt-card--equipped' : ''}">
      <div class="mkt-card-glow"></div>
      <div class="mkt-rarity-bar rarity-${it.rarity}"></div>
      <div class="mkt-card-head">
        <div class="mkt-icon rarity-${it.rarity}">${it.icon}</div>
        <div class="mkt-meta">
          <div class="mkt-name">${escapeHTML(it.name)}</div>
          <div class="mkt-rarity-pill rarity-${it.rarity}">${rarityLabel}</div>
        </div>
        ${locked ? `<div class="mkt-lock-icon">🔒</div>` : ''}
      </div>
      <div class="mkt-desc">${escapeHTML(it.desc)}</div>
      ${specialHTML}
      ${btnHTML}
    </div>`;
  }

  function renderShop() {
    const view = document.getElementById('view-shop');
    if (!view) return;
    if (!_userId) {
      view.innerHTML = `<div class="social-gate"><div class="social-gate-icon">🛒</div><h2 class="social-gate-title">Global XP Marketplace</h2><p class="social-gate-sub">Sign in to spend your earned XP on exclusive items, effects &amp; themes.</p><button class="btn" data-act="auth-show-modal">Sign In to Continue</button></div>`;
      return;
    }
    const bal      = _xpBalance();
    const lifetime = (state.xp && state.xp.total) || 0;
    const spent    = (state.xp && state.xp.spent)  || 0;

    const cats = [
      { id:'profile',     label:'Profile', icon:'👤' },
      { id:'visual',      label:'Visual',  icon:'✨' },
      { id:'utility',     label:'Utility', icon:'🛠️' },
      { id:'premium',     label:'Premium', icon:'💎' },
      { id:'music_track', label:'Music',   icon:'🎵' },
    ];
    const catTabs = cats.map(c =>
      `<button class="mkt-cat-btn${c.id === _shopCategory ? ' active' : ''}" data-act="shop-cat" data-cat="${c.id}">${c.icon} ${c.label}</button>`
    ).join('');

    const items = SHOP_ITEMS.filter(it => it.cat === _shopCategory);
    const itemsHTML = items.map(it => _mktCard(it, bal)).join('') ||
      '<div class="mkt-empty">No items in this category yet.</div>';

    const ownedItems = SHOP_ITEMS.filter(it => _itemOwned(it.id) || state.themeUnlocked && it.id === 'theme_unlocker' || state.customBadgeOwned && it.id === 'custom_badge');
    const invPreview = ownedItems.slice(0, 8).map(it => `<span class="inv-icon" title="${escapeHTML(it.name)}">${it.icon}</span>`).join('')
                       || '<span style="color:var(--text-muted);font-size:12px">Buy something below to start your collection!</span>';

    const boosterBannerHTML = _isBoosterActive()
      ? `<div class="mkt-global-boost"><span class="mkt-boost-pulse"></span>⚡ 2× XP BOOST ACTIVE — <span class="mkt-booster-countdown">${_boosterCountdownStr()}</span></div>`
      : '';

    const questsHTML = renderDailyQuestsHTML();

    view.innerHTML = `<div class="mkt-page">
      <div class="mkt-header">
        <button class="mkt-back-btn" data-act="shop-back" aria-label="Back">←</button>
        <div class="mkt-header-left">
          <div class="mkt-title">🛒 Global XP Marketplace</div>
          <div class="mkt-subtitle">Spend your XP on premium rewards</div>
        </div>
        <div class="mkt-bal-pill"><span class="mkt-bal-icon">⚡</span><span class="mkt-bal-num">${bal.toLocaleString()}</span> XP</div>
      </div>
      ${boosterBannerHTML}
      <div class="mkt-stats-row">
        <div class="mkt-stat"><span class="mkt-stat-val">${lifetime.toLocaleString()}</span><span class="mkt-stat-lbl">Lifetime XP</span></div>
        <div class="mkt-stat-div"></div>
        <div class="mkt-stat"><span class="mkt-stat-val">${spent.toLocaleString()}</span><span class="mkt-stat-lbl">Spent</span></div>
        <div class="mkt-stat-div"></div>
        <div class="mkt-stat"><span class="mkt-stat-val">${bal.toLocaleString()}</span><span class="mkt-stat-lbl">Available</span></div>
      </div>
      <div class="mkt-earn-info">
        <div class="mkt-earn-row"><span class="mkt-earn-icon">✅</span><span>1 task completed = <strong>50 XP</strong>${_isBoosterActive() ? ' → <strong style="color:#fbbf24">100 XP</strong>' : ''}</span></div>
        <div class="mkt-earn-row"><span class="mkt-earn-icon">⏱</span><span>1 minute focused = <strong>10 XP</strong>${_isBoosterActive() ? ' → <strong style="color:#fbbf24">20 XP</strong>' : ''}</span></div>
      </div>
      <div class="mkt-inv-row"><span class="mkt-inv-label">🎒 Collection</span><div class="mkt-inv-icons">${invPreview}</div></div>
      ${questsHTML}
      <div class="mkt-cats">${catTabs}</div>
      <div class="mkt-grid">${itemsHTML}</div>
    </div>`;

    // Start live booster timer if active
    if (_isBoosterActive()) _startShopBoosterTimer();
  }

  // ── Purchase confirmation modal ─────────────────────────────────────────
  function _shopBuy(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it) return;
    const bal = _xpBalance();
    if (bal < it.cost) {
      toast('❌ Not enough XP!', 'warn', 3000);
      // Error shake on balance pill
      const pill = document.querySelector('.mkt-bal-pill');
      if (pill) { pill.classList.add('mkt-bal-shake'); setTimeout(() => pill.classList.remove('mkt-bal-shake'), 600); }
      return;
    }
    const rarityLabel = it.rarity.charAt(0).toUpperCase() + it.rarity.slice(1);
    openModal(`<div class="mkt-confirm-modal">
      <div class="mkt-confirm-icon rarity-${it.rarity}">${it.icon}</div>
      <div class="mkt-confirm-title">Confirm Purchase</div>
      <div class="mkt-confirm-name">${escapeHTML(it.name)}</div>
      <div class="mkt-rarity-pill rarity-${it.rarity}" style="display:inline-block;margin-bottom:12px">${rarityLabel}</div>
      <div class="mkt-confirm-desc">${escapeHTML(it.desc)}</div>
      <div class="mkt-confirm-cost">⚡ ${it.cost.toLocaleString()} XP</div>
      <div class="mkt-confirm-after">Balance after: ⚡ ${(bal - it.cost).toLocaleString()} XP</div>
      <div class="mkt-confirm-btns">
        <button class="mkt-modal-cancel" data-act="close-modal">Cancel</button>
        <button class="mkt-modal-buy" data-act="shop-confirm-buy" data-iid="${itemId}">Buy Now ⚡</button>
      </div>
    </div>`);
  }

  // ── Execute purchase ────────────────────────────────────────────────────
  let _buyInProgress = false;
  function _shopConfirmBuy(itemId) {
    if (_buyInProgress) return;
    _buyInProgress = true;
    setTimeout(() => { _buyInProgress = false; }, 2000);
    closeModal();
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it) { _buyInProgress = false; return; }
    if (_xpBalance() < it.cost) { toast('❌ Not enough XP!', 'warn', 3000); _buyInProgress = false; return; }
    // Deduct XP
    if (!state.xp) state.xp = { total: 0 };
    if (typeof state.xp.spent !== 'number') state.xp.spent = 0;
    state.xp.spent += it.cost;
    if (!state.inventory) state.inventory = {};

    // Item-specific activation
    if (it.id === 'xp_boost_2x') {
      _activateBooster();
      toast('⚡ XP Booster 2× activated! All XP doubled for 24 hours!', 'success', 5000);
      gamificationManager._flashGlow('rgba(251,191,36,0.22)');
    } else if (it.cat === 'music_track') {
      state.inventory[it.id] = 1;
      toast(`${it.icon} ${it.name} unlocked! Play it in the Focus tab.`, 'success', 4000);
      saveState(); gamificationManager._updateXPBar();
      const balEl2 = document.querySelector('.mkt-bal-num');
      if (balEl2) { showXPFloat(-it.cost, balEl2); balEl2.textContent = _xpBalance().toLocaleString(); }
      renderShop(); renderFocus(); return;
    } else if (it.id === 'custom_badge') {
      state.customBadgeOwned = true;
      if (!state.selectedBadge) state.selectedBadge = 'verified';
      toast('🏅 Custom Badge unlocked! Choose your badge below.', 'success', 4000);
    } else if (it.id === 'theme_unlocker') {
      state.themeUnlocked = true;
      if (!state.selectedTheme || state.selectedTheme === 'default') state.selectedTheme = 'dark-gold';
      _applyTheme(state.selectedTheme);
      toast('🎨 Theme Unlocker activated! Choose your theme below.', 'success', 4000);
    } else {
      state.inventory[it.id] = (state.inventory[it.id] || 0) + 1;
      if (it.equip && !it.stackable) {
        if (!state.equippedItems) state.equippedItems = {};
        state.equippedItems[it.equip] = it.id;
      }
      toast(`${it.icon} ${it.name} purchased & equipped!`, 'success', 3500);
    }

    saveState();
    if (it.equip && !it.stackable) _cmkSyncAfterEquip();
    gamificationManager._updateXPBar();
    const balEl = document.querySelector('.mkt-bal-num');
    if (balEl) { showXPFloat(-it.cost, balEl); balEl.textContent = _xpBalance().toLocaleString(); }
    renderShop();
  }

  function _shopEquip(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it || !it.equip || !_itemOwned(it.id)) return;
    if (!state.equippedItems) state.equippedItems = {};
    state.equippedItems[it.equip] = it.id;
    saveState();
    _cmkSyncAfterEquip();
    toast(`${it.icon} ${it.name} equipped!`, 'success', 2500);
    renderShop();
  }

  function _shopUnequip(itemId) {
    const it = SHOP_ITEMS.find(i => i.id === itemId);
    if (!it || !it.equip) return;
    if (!state.equippedItems) state.equippedItems = {};
    delete state.equippedItems[it.equip];
    saveState();
    _cmkSyncAfterEquip();
    toast('Unequipped', 'info', 2000);
    renderShop();
  }

  // Push cosmetic changes to Firebase presence + global LB instantly
  function _cmkSyncAfterEquip() {
    _updateGlobalLb();
    if (_socialRoomCode && _userId) {
      const curStatus = (_socialMembers[_userId] && _socialMembers[_userId].status) || 'break';
      _sUpdatePresence(curStatus).catch(() => {});
    }
    // Re-render the current tab so cosmetics (border/aura/title) show immediately
    if (_currentTab === 'home')   renderHome();
    else if (_currentTab === 'social') renderSocial();
  }

  // ── Badge & theme selectors ──────────────────────────────────────────────
  function _shopSelectBadge(badgeId) {
    if (!state.customBadgeOwned) return;
    // Toggle off if already selected
    if (state.selectedBadge === badgeId) {
      state.selectedBadge = '';
      saveState();
      toast('Badge removed', 'info', 2000);
    } else {
      state.selectedBadge = badgeId;
      saveState();
      const b = _BADGE_DEFS[badgeId];
      toast(`🏅 Badge equipped: ${b ? b.label : badgeId}`, 'success', 2500);
    }
    // Sync cosmetics to social presence + re-render current tab
    _cmkSyncAfterEquip();
    renderShop();
  }

  function _shopSelectTheme(themeId) {
    if (!state.themeUnlocked) return;
    state.selectedTheme = themeId;
    _applyTheme(themeId);
    saveState();
    const t = PREMIUM_THEMES[themeId];
    toast(`🎨 Theme activated: ${t ? t.label : themeId}`, 'success', 2500);
    // Flash the whole UI so the user sees the change
    gamificationManager._flashGlow('rgba(99,102,241,0.12)');
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
    resumeAudioContext();
    // Repeating chime for alarm clock: play every 4 s until dismissed
    _playChime(0.75);
    let _rep = 0;
    _alarmRampTimer = setInterval(() => {
      _rep++;
      _playChime(0.75);
      if (_rep >= 30) { clearInterval(_alarmRampTimer); _alarmRampTimer = null; } // cap at 2 min
    }, 4000);
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

  // Stored so they can be cleared if startTimers() is ever called again
  let _backupCheckInterval  = null;
  let _midnightCheckInterval = null;

  function startTimers() {
    // Clear any previously running intervals to prevent leaks
    clearInterval(dueTaskTimer);
    clearInterval(_backupCheckInterval);
    clearInterval(_midnightCheckInterval);

    _backupCheckInterval = setInterval(() => {
      if (document.hidden) return;
      checkBackupBannerWindow();
    }, 60000);
    // Check for date change every 60s — triggers midnight rollover
    _midnightCheckInterval = setInterval(() => {
      if (document.hidden) return;
      const now = todayKey();
      if (now !== _planDateKey) { _planDateKey = now; onMidnightReset(); }
    }, 60000);
    dueTaskTimer = setInterval(() => {
      if (document.hidden) return;
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
  function toast(msg, kind = 'info', ms = 1500) {
    const wrap = document.getElementById('toast-container'); if (!wrap) return;
    // Deduplicate — skip if same text already visible
    const existing = wrap.querySelectorAll('.toast');
    for (const el of existing) { if (el.dataset.msg === msg) return; }
    // Cap at 3 simultaneous toasts (remove oldest)
    if (existing.length >= 3) existing[0].remove();
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.dataset.msg = msg;
    t.textContent = msg;
    wrap.appendChild(t);
    const fadeOut = ms - 300;
    if (fadeOut > 0) setTimeout(() => t.classList.add('toast-fade'), fadeOut);
    setTimeout(() => t.remove(), ms);
  }

  // ── XP Float: golden pill that rises from a tapped element ──────────────
  function showXPFloat(amount, anchorEl) {
    const el = document.createElement('div');
    const isNeg = amount < 0;
    el.className = 'xp-float' + (isNeg ? ' xp-float--neg' : '');
    el.textContent = (isNeg ? '' : '+') + amount + ' XP';
    let cx, cy;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      // Clamp so the float is always well inside the viewport (avoids bottom-nav bleed)
      cx = Math.min(Math.max(r.left + r.width / 2, 60), window.innerWidth - 60);
      cy = Math.min(Math.max(r.top + r.height / 4, 80), window.innerHeight - 140);
    } else {
      cx = window.innerWidth  / 2;
      cy = window.innerHeight * 0.42;
    }
    el.style.left = Math.round(cx) + 'px';
    el.style.top  = Math.round(cy) + 'px';
    document.body.appendChild(el);
    // Fallback removal in case animationend doesn't fire (e.g. prefers-reduced-motion)
    const cleanup = () => el.remove();
    el.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 2000);
  }

  // ========== Modal ==========
  function openModal(html, onMount, opts) {
    // Prevent the view behind the modal from scrolling
    document.body.classList.add('modal-open');
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const backdrop = root.firstElementChild;
    if (!(opts && opts.unclosable)) {
      backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    }
    if (onMount) onMount(backdrop.querySelector('.modal'));
  }
  function closeModal() {
    document.body.classList.remove('modal-open');
    const r = document.getElementById('modal-root');
    if (r) r.innerHTML = '';
  }
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
    _motivationRotateTimer = setInterval(() => {
      if (document.hidden) return;
      nextMotivationQuote();
    }, 30000);
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

  // ── Live Study Timer state ────────────────────────────────────────────
  let focusTopMode    = 'pomodoro'; // 'pomodoro' | 'live'
  let _lsRunning      = false;
  let _lsTimer        = null;
  let _lsStartTime    = null;       // Date.now() when current run segment began
  let _lsElapsedBase  = 0;          // seconds accumulated before current segment
  let _lsSubjectId    = null;       // selected subject id
  let _lsChapterId    = null;       // selected chapter id
  let _lsTopicId      = null;       // selected topic id
  let _lsOverlayActive = false;
  let _lsFbTick       = 0;          // throttle counter for Firebase writes
  let _lsParticleRAF  = null;       // requestAnimationFrame handle for particle canvas
  let _lsVisibilityHandler = null;  // visibilitychange listener reference
  let _lsHeartbeatTick = 0;         // heartbeat counter
  let _lsCurrentAvatarStage = -1;   // tracks current avatar evolution stage
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
  const FOCUS_INTENSITY_TRACKS = [];
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
  // 5 soft study-friendly WAV tracks — 1 free, 4 premium (10,000 XP each)

  const SOUNDS = [
    { id: 'none',         label: '🔇 Off',          cat: null },
    // ── Free track ──────────────────────────────────────────────────────────
    { id: 'ocean_waves',  label: '🌊 Ocean Waves',   src: '/sounds/ocean_waves.wav',  cat: 'music' },
    // ── Premium tracks (unlock each for 10,000 XP in the Music shop tab) ──
    { id: 'soft_rain',    label: '🌧️ Soft Rain',      src: '/sounds/soft_rain.mp3',    cat: 'music', premium: true, shopId: 'music_soft_rain'   },
    { id: 'piano_study',  label: '🎹 Piano Study',    src: '/sounds/piano_study.wav',  cat: 'music', premium: true, shopId: 'music_piano_study' },
    { id: 'forest_calm',  label: '🌿 Forest Calm',    src: '/sounds/forest_calm.wav',  cat: 'music', premium: true, shopId: 'music_forest_calm' },
    { id: 'deep_focus',   label: '🔮 Deep Focus',     src: '/sounds/deep_focus.mp3',   cat: 'music', premium: true, shopId: 'music_deep_focus'  },
  ];
  function soundById(id) { return SOUNDS.find(s => s.id === id) || SOUNDS[0]; }

  function _createNoiseAmbient() { return null; }

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
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
      v.style.setProperty('display', 'none', 'important');
      v.style.pointerEvents = 'none';
      v.style.zIndex = '0';
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const view = document.getElementById('view-' + tab);
    if (view) {
      view.classList.add('active');
      view.style.removeProperty('display');
      view.style.pointerEvents = 'auto';
      view.style.zIndex = '10';
      // Reset scroll position on every tab switch so content starts at top
      requestAnimationFrame(() => { view.scrollTop = 0; });
    }
    const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`); if (btn) btn.classList.add('active');
    // Preserve non-tab body classes (kb-open, page-bg, modal-open, etc.)
    // Old code: document.body.className = 'tab-' + tab — that wiped all other classes
    [...document.body.classList].filter(c => c.startsWith('tab-')).forEach(c => document.body.classList.remove(c));
    document.body.classList.add('tab-' + tab);
    _currentTab = tab;
    closeDropdown();
    // Remove any stray body-level overlays that social/chat code appends directly to document.body.
    // If the user navigates away rapidly before a pointerdown-once handler fires, these get stuck.
    document.getElementById('chat-ctx-backdrop')?.remove();
    document.querySelectorAll('.chat-ctx-menu').forEach(el => el.remove());
    // Remove celebration/confetti overlays — these have async auto-remove timeouts (up to 9s)
    // and will block interaction on other tabs if the user navigates away before they expire.
    if (tab !== 'social') {
      document.querySelectorAll('.vault-celeb-overlay').forEach(el => el.remove());
      document.querySelectorAll('.confetti-piece').forEach(el => el.remove());
    }
    // Stop social live timers when leaving the social tab to prevent ghost DOM queries
    if (tab !== 'social') _stopSocialLiveTimers();
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
    try {
    const view = document.getElementById('view-home'); if (!view) return;
    const overall = overallProgress();
    const tasks = getActivePlanTasks(), doneCount = tasks.filter(t => t.done).length, totalCount = tasks.length;
    const allDone = totalCount > 0 && doneCount === totalCount;
    const achievedBadge = allDone ? `<div class="daily-achieved" role="status">${_justCompletedDay === todayKey() ? renderConfettiBurst() : ''}<span class="da-glyph">🏆</span><div><div class="da-title">Daily Goal Achieved!</div><div class="da-sub">All ${totalCount} task${totalCount === 1 ? '' : 's'} done!</div></div></div>` : '';
    const motivationMsg = getRotatingQuote();
    const profName    = state.profile.name    || '';
    const profTagline = state.profile.tagline || '';
    const profInitial = profName ? profName.trim().charAt(0).toUpperCase() : '?';
    const _eq = _myEquipped();
    const _borderClass = _cmkBorderClass(_eq);
    const _auraClass   = _cmkAuraClass(_eq);
    const _titleHTML   = _cmkTitleHTML(_eq);
    const _profAvatarEl = state.profile.avatarDataUrl
      ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="home-profile-avatar home-profile-avatar--img${_borderClass ? ' ' + _borderClass : ''}" alt="Avatar"/>`
      : `<div class="home-profile-avatar${_borderClass ? ' ' + _borderClass : ''}">${profInitial}</div>`;
    const profAvatarHTML = _auraClass
      ? `<div class="${_auraClass}">${_profAvatarEl}</div>`
      : _profAvatarEl;
    const _badgeHTML  = _cmkBadgeHTML(state.customBadgeOwned ? state.selectedBadge : '');
    const nameHtml    = profName
      ? `<div class="home-profile-name">${escapeHTML(profName)}${_titleHTML ? ' ' + _titleHTML : ''}</div>${_badgeHTML ? `<div class="home-profile-badge">${_badgeHTML}</div>` : ''}`
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
    } catch(e) { console.error('renderHome error', e); }
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

  function _safe(fn, fallback) {
    try { return fn(); } catch(e) { console.warn('[safe]', e); return fallback !== undefined ? fallback : ''; }
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
    if (!plan) return { total: 0, done: 0, subjects: [] };
    let total = 0, done = 0;
    const seenSubColors = new Map();
    for (const a of plan.auto || []) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if ((plan.removed || []).includes(key)) continue;
      const t = findTopic(a.subId, a.chId, a.tId);
      if (!t) continue;
      total++;
      if (t.done) done++;
      const sub = findSubject(a.subId);
      if (sub && !seenSubColors.has(sub.id)) seenSubColors.set(sub.id, sub.color);
    }
    for (const c of plan.custom || []) {
      total++;
      if (c.done) done++;
    }
    for (const s of plan.syllabus || []) {
      total++;
      if (s.done) done++;
      if (s.subjectId && !seenSubColors.has(s.subjectId)) seenSubColors.set(s.subjectId, s.subjectColor || '#4da8ff');
    }
    return { total, done, subjects: [...seenSubColors.values()].slice(0, 3) };
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
      const { total, done, subjects } = getDayPlanStatus(dateISO);
      const allDone = total > 0 && done === total;

      let colourClass = '';
      if (!isFuture && total > 0) {
        colourClass = allDone ? ' cal-completed' : (isPast ? ' cal-incomplete' : '');
      }

      // Progress ring for cells with tasks
      let progressHtml = '';
      if (total > 0) {
        const pct = Math.round((done / total) * 100);
        const r = 13, circ = 2 * Math.PI * r;
        const offset = circ - (pct / 100) * circ;
        const ringColor = allDone ? '#22c55e' : (isPast ? '#ef4444' : '#4da8ff');
        progressHtml = `<svg class="cal-ring" viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="2.5"/><circle cx="16" cy="16" r="${r}" fill="none" stroke="${ringColor}" stroke-width="2.5" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 16 16)" style="opacity:0.85"/></svg>`;
      }

      // Subject color dots
      const subDotsHtml = subjects.length > 0
        ? `<div class="cal-sub-dots">${subjects.map(c => `<span class="cal-sub-dot" style="background:${c}"></span>`).join('')}</div>`
        : '';

      const ariaLabel = `${dateISO}${total ? `, ${done}/${total} tasks` : ''}`;
      const isSelected = dateISO === _selectedCalDate;
      cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast && !isToday ? ' cal-past' : ''}${colourClass}${isSelected ? ' cal-selected' : ''}" data-act="calendar-day" data-date="${dateISO}" role="button" aria-label="${ariaLabel}">${progressHtml}<span class="cal-day-num">${d}</span>${subDotsHtml}</div>`;
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

    const dateObj = new Date(dateISO + 'T00:00:00');
    const label = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (!state.dailyPlans[dateISO]) state.dailyPlans[dateISO] = { auto: [], removed: [], custom: [], syllabus: [], generated: false };
    const plan = state.dailyPlans[dateISO];
    if (!plan.syllabus) plan.syllabus = [];

    // Analytics (shown in header area)
    const focusMin = (state.focusStats.minutesByDate || {})[dateISO] || 0;
    const sessions = (state.focusStats.sessions || {})[dateISO] || 0;
    const fmtMin = m => { if (m <= 0) return '0m'; const h = Math.floor(m / 60), rem = m % 60; return h > 0 ? (rem > 0 ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`; };
    const analyticsStrip = (focusMin > 0 || sessions > 0)
      ? `<div class="dps-analytics-strip">${focusMin > 0 ? `<span class="dps-anlyt-pill dps-anlyt-focus">⏱ ${fmtMin(focusMin)}</span>` : ''}${sessions > 0 ? `<span class="dps-anlyt-pill dps-anlyt-pomo">🍅 ${sessions}</span>` : ''}</div>`
      : '';

    openModal(`
      <div class="dps-drag-handle"></div>
      <div class="dps-header">
        <div class="dps-header-left">
          <div class="dps-date-label">${escapeHTML(label)}</div>
          ${analyticsStrip}
        </div>
        <button class="dps-close-btn" data-close>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div id="dps-task-section"></div>

      <div class="dps-tabs">
        <button class="dps-tab dps-tab-active" data-dps-tab="syllabus">📚 Syllabus Task</button>
        <button class="dps-tab" data-dps-tab="custom">✏️ Custom Task</button>
      </div>

      <div id="dps-panel-syllabus" class="dps-panel">
        <div id="dps-wizard"></div>
      </div>

      <div id="dps-panel-custom" class="dps-panel" style="display:none">
        <div class="dps-custom-wrap">
          <input id="dps-custom-inp" class="dps-custom-input" placeholder="Add a task for this day…" maxlength="120" autocomplete="off"/>
          <button class="dps-custom-submit" id="dps-custom-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
    `, root => {
      // ── Wizard state ────────────────────────────────────────────────
      let wStep = 1, wSubject = null, wChapter = null, wTopicIds = new Set(), wChSearch = '';

      // ── Render task recap section ───────────────────────────────────
      function renderTaskSection() {
        const sec = root.querySelector('#dps-task-section');
        if (!sec) return;

        const allTasks = [];
        for (const a of plan.auto || []) {
          const key = autoKey(a.subId, a.chId, a.tId);
          if ((plan.removed || []).includes(key)) continue;
          const sub = findSubject(a.subId), ch = findChapter(a.subId, a.chId), t = findTopic(a.subId, a.chId, a.tId);
          if (!sub || !ch || !t) continue;
          allTasks.push({ type: 'auto', text: t.name, subject: sub.name, chapter: ch.name, color: sub.color, done: !!t.done, subId: a.subId, chId: a.chId, tId: a.tId });
        }
        for (let i = 0; i < (plan.syllabus || []).length; i++) {
          const s = plan.syllabus[i];
          allTasks.push({ type: 'syllabus', idx: i, text: s.topicName, subject: s.subjectName, chapter: s.chapterName, color: s.subjectColor || '#4da8ff', done: !!s.done, estMin: s.estimatedMinutes || 0, subjectId: s.subjectId, chapterId: s.chapterId, topicId: s.topicId });
        }
        for (let i = 0; i < (plan.custom || []).length; i++) {
          const c = plan.custom[i];
          allTasks.push({ type: 'custom', idx: i, text: c.text, subject: c.recurringId ? 'Daily recurring' : c.rolledOver ? 'Rolled over' : 'Custom', chapter: '', color: '#ff7a1a', done: !!c.done });
        }

        const totalT = allTasks.length, doneT = allTasks.filter(t => t.done).length;

        if (!totalT) {
          sec.innerHTML = `<div class="dps-empty-state">
            <div class="dps-empty-emoji">🗓️</div>
            <div class="dps-empty-title">No tasks planned</div>
            <div class="dps-empty-hint">Add tasks from your syllabus or create a custom task below</div>
          </div>`;
          return;
        }

        const pct = Math.round((doneT / totalT) * 100);
        const doneLabel = doneT === totalT ? '🎉 All done!' : `${doneT} of ${totalT} completed`;
        sec.innerHTML = `
          <div class="dps-recap-header">
            <div class="dps-recap-info">
              <div class="dps-recap-left">
                <span class="dps-recap-label">📋 Tasks</span>
                <span class="dps-recap-done-lbl">${doneLabel}</span>
              </div>
              <span class="dps-recap-fraction">${pct}%</span>
            </div>
            <div class="dps-recap-bar-wrap">
              <div class="dps-recap-bar" style="width:${Math.max(pct, doneT > 0 ? 3 : 0)}%"></div>
            </div>
          </div>
          <div class="dps-task-cards">
            ${allTasks.map((t, i) => {
              const estHtml   = t.estMin > 0 ? `<span class="dps-est-badge">⏱ ${t.estMin}m</span>` : '';
              const typeBadge = `<span class="dps-type-badge dps-type-badge-${t.type}">${t.type === 'auto' ? 'Revision' : t.type === 'syllabus' ? 'Syllabus' : 'Custom'}</span>`;
              const subLine   = t.subject
                ? `<div class="dps-task-subject"><span class="dps-subject-dot" style="background:${t.color}"></span><span class="dps-subject-name">${escapeHTML(t.subject)}</span>${t.chapter ? `<span class="dps-subject-sep"> · </span><span class="dps-chapter-name">${escapeHTML(t.chapter)}</span>` : ''}</div>`
                : '';
              const delBtn    = t.type !== 'auto'
                ? `<button class="dps-del-task" data-type="${t.type}" data-idx="${t.idx}" title="Remove task" aria-label="Delete task">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                   </button>`
                : '<div class="dps-del-placeholder"></div>';
              return `<div class="dps-task-card dps-type-${t.type}${t.done ? ' dps-task-done' : ''}" style="--tc:${t.color}">
                <button class="dps-toggle-btn" data-type="${t.type}" data-idx="${t.idx !== undefined ? t.idx : ''}" data-sub="${t.subId || ''}" data-ch="${t.chId || ''}" data-tid="${t.tId || ''}" data-subid="${t.subjectId || ''}" data-chid="${t.chapterId || ''}" data-topicid="${t.topicId || ''}">
                  <span class="dps-toggle-ring">
                    ${t.done ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
                  </span>
                </button>
                <div class="dps-task-body">
                  <div class="dps-task-name">${escapeHTML(t.text)}</div>
                  ${subLine}
                  <div class="dps-task-badges">${typeBadge}${estHtml}</div>
                </div>
                ${delBtn}
              </div>`;
            }).join('')}
          </div>`;

        // Toggle handlers
        sec.querySelectorAll('.dps-toggle-btn').forEach(btn => {
          btn.onclick = () => {
            const type = btn.dataset.type;
            if (type === 'auto') {
              const t = findTopic(btn.dataset.sub, btn.dataset.ch, btn.dataset.tid);
              if (t) { t.done = !t.done; bumpActivity(); saveState(); renderTaskSection(); renderDashboard(); }
            } else if (type === 'syllabus') {
              const i = parseInt(btn.dataset.idx, 10);
              if (!isNaN(i) && plan.syllabus[i]) {
                plan.syllabus[i].done = !plan.syllabus[i].done;
                if (plan.syllabus[i].done) {
                  const t = findTopic(plan.syllabus[i].subjectId, plan.syllabus[i].chapterId, plan.syllabus[i].topicId);
                  if (t && !t.done) { t.done = true; trackCompletion(`topic:${plan.syllabus[i].subjectId}:${plan.syllabus[i].chapterId}:${plan.syllabus[i].topicId}`, true); onTopicDoneChanged(plan.syllabus[i].subjectId, plan.syllabus[i].chapterId, plan.syllabus[i].topicId, true); }
                }
                bumpActivity(); saveState(); renderTaskSection(); renderDashboard();
              }
            } else if (type === 'custom') {
              const i = parseInt(btn.dataset.idx, 10);
              if (!isNaN(i) && plan.custom[i]) { plan.custom[i].done = !plan.custom[i].done; bumpActivity(); saveState(); renderTaskSection(); renderDashboard(); }
            }
          };
        });

        // Delete handlers
        sec.querySelectorAll('.dps-del-task').forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            const type = btn.dataset.type, i = parseInt(btn.dataset.idx, 10);
            if (type === 'syllabus' && !isNaN(i)) { plan.syllabus.splice(i, 1); saveState(); renderTaskSection(); renderDashboard(); toast('Task removed', 'info'); }
            else if (type === 'custom' && !isNaN(i)) { plan.custom.splice(i, 1); saveState(); renderTaskSection(); renderDashboard(); toast('Task removed', 'info'); }
          };
        });
      }

      // ── Render syllabus wizard ──────────────────────────────────────
      function renderWizard() {
        const wiz = root.querySelector('#dps-wizard');
        if (!wiz) return;
        const subjects = state.subjects || [];

        if (wStep === 1) {
          if (!subjects.length) {
            wiz.innerHTML = `<div class="dps-wiz-empty"><div class="dps-empty-emoji">📚</div><div class="dps-empty-title">No subjects yet</div><div class="dps-empty-hint">Add subjects in the Study tab first</div></div>`;
            return;
          }

          // Recently used subject IDs for this date
          const recentIds = new Set((plan.syllabus || []).map(s => s.subjectId));

          wiz.innerHTML = `
            <div class="dps-step-hint">Step 1 of 3 · Choose a subject</div>
            <div class="dps-sub-grid">
              ${subjects.map(sub => {
                const done = sub.chapters.filter(c => isChapterEffectivelyDone(c)).length;
                const pct = sub.chapters.length ? Math.round((done / sub.chapters.length) * 100) : 0;
                const isRecent = recentIds.has(sub.id);
                return `<button class="dps-sub-chip${isRecent ? ' dps-sub-chip-recent' : ''}" data-sub-id="${sub.id}">
                  <span class="dps-chip-dot" style="background:${sub.color}"></span>
                  <span class="dps-chip-name">${escapeHTML(sub.name)}</span>
                  <span class="dps-chip-pct" style="color:${sub.color}">${pct}%</span>
                  ${isRecent ? '<span class="dps-chip-recent-badge">Recent</span>' : ''}
                </button>`;
              }).join('')}
            </div>`;

          wiz.querySelectorAll('.dps-sub-chip').forEach(btn => {
            btn.onclick = () => { wSubject = findSubject(btn.dataset.subId); wChapter = null; wTopicIds = new Set(); wStep = 2; renderWizard(); };
          });

        } else if (wStep === 2 && wSubject) {
          const chapters = wSubject.chapters || [];
          const filtered = wChSearch ? chapters.filter(c => c.name.toLowerCase().includes(wChSearch.toLowerCase())) : chapters;

          wiz.innerHTML = `
            <div class="dps-step-nav">
              <button class="dps-back-btn" id="dps-back1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div class="dps-breadcrumb">
                <span class="dps-bc-dot" style="background:${wSubject.color}"></span>
                <span class="dps-bc-text">${escapeHTML(wSubject.name)}</span>
              </div>
              <span class="dps-step-hint-inline">Step 2 of 3</span>
            </div>
            <div class="dps-search-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="dps-search-inp" id="dps-ch-search" placeholder="Search chapters…" value="${escapeHTML(wChSearch)}" autocomplete="off"/>
            </div>
            <div class="dps-ch-list">
              ${!filtered.length
                ? `<div class="dps-wiz-empty-sm">No chapters found</div>`
                : filtered.map(ch => {
                    const isDone = isChapterEffectivelyDone(ch);
                    const pct = chapterProgress(ch);
                    return `<button class="dps-ch-row${isDone ? ' dps-ch-done' : ''}" data-ch-id="${ch.id}">
                      <span class="dps-ch-status">${isDone ? '✅' : '📖'}</span>
                      <div class="dps-ch-body">
                        <div class="dps-ch-name">${escapeHTML(ch.name)}</div>
                        ${pct > 0 ? `<div class="dps-ch-bar-wrap"><div class="dps-ch-bar" style="width:${pct}%;background:${wSubject.color}"></div></div>` : ''}
                      </div>
                      <svg class="dps-ch-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>`;
                  }).join('')}
            </div>`;

          root.querySelector('#dps-back1').onclick = () => { wStep = 1; wSubject = null; wChSearch = ''; renderWizard(); };
          const si = root.querySelector('#dps-ch-search');
          if (si) { si.addEventListener('input', e => { wChSearch = e.target.value; renderWizard(); }); setTimeout(() => si.focus(), 80); }
          wiz.querySelectorAll('.dps-ch-row').forEach(btn => {
            btn.onclick = () => { wChapter = wSubject.chapters.find(c => c.id === btn.dataset.chId); wTopicIds = new Set(); wStep = 3; renderWizard(); };
          });

        } else if (wStep === 3 && wSubject && wChapter) {
          const topics = wChapter.topics || [];
          const existingIds = new Set((plan.syllabus || []).filter(s => s.date === dateISO).map(s => s.topicId));
          const selCount = wTopicIds.size;
          const estTotal = selCount * 20;

          wiz.innerHTML = `
            <div class="dps-step-nav">
              <button class="dps-back-btn" id="dps-back2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div class="dps-breadcrumb">
                <span class="dps-bc-dot" style="background:${wSubject.color}"></span>
                <span class="dps-bc-text">${escapeHTML(wChapter.name)}</span>
              </div>
              <span class="dps-step-hint-inline">Step 3 of 3</span>
            </div>
            <div class="dps-step-hint-sub">Select topics to add · ${selCount > 0 ? `<b>${selCount} selected</b>` : 'none selected'}</div>
            <div class="dps-topic-list">
              ${!topics.length
                ? `<div class="dps-wiz-empty-sm">No topics in this chapter</div>`
                : topics.map(t => {
                    const added = existingIds.has(t.id);
                    const checked = wTopicIds.has(t.id);
                    return `<label class="dps-topic-row${added ? ' dps-topic-added' : ''}${t.done ? ' dps-topic-completed' : ''}">
                      <span class="dps-topic-cb-wrap${checked ? ' dps-cb-checked' : ''}" style="${checked ? `--cbcolor:${wSubject.color}` : ''}">
                        <input type="checkbox" class="dps-topic-cb" data-tid="${t.id}" ${checked ? 'checked' : ''} ${added ? 'disabled' : ''} style="display:none">
                        ${checked ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
                      </span>
                      <div class="dps-topic-info">
                        <span class="dps-topic-name${t.done ? ' dps-topic-name-done' : ''}">${escapeHTML(t.name)}</span>
                        <div class="dps-topic-tags">
                          ${t.done ? `<span class="dps-tag dps-tag-done">✓ Done</span>` : ''}
                          ${added ? `<span class="dps-tag dps-tag-added">Already added</span>` : ''}
                          ${t.priority ? `<span class="dps-tag dps-tag-${t.priority}">${t.priority}</span>` : ''}
                        </div>
                      </div>
                    </label>`;
                  }).join('')}
            </div>
            ${topics.length ? `
            <div class="dps-wiz-footer">
              <div class="dps-est-row">
                <span class="dps-est-label">Estimated time</span>
                <div class="dps-est-input-wrap">
                  <input type="number" id="dps-est-inp" class="dps-est-input" min="5" max="600" step="5" value="${estTotal}" placeholder="0"/>
                  <span class="dps-est-unit">min</span>
                </div>
              </div>
              <button class="dps-add-btn${selCount > 0 ? ' dps-add-btn-on' : ''}" id="dps-add-syl-btn" ${selCount === 0 ? 'disabled' : ''}>
                ${selCount > 0 ? `Add ${selCount} topic${selCount > 1 ? 's' : ''} to this day` : 'Select topics above'}
              </button>
            </div>` : ''}`;

          root.querySelector('#dps-back2').onclick = () => { wStep = 2; wChapter = null; wTopicIds = new Set(); renderWizard(); };

          wiz.querySelectorAll('.dps-topic-cb').forEach(cb => {
            cb.onchange = () => { if (cb.checked) wTopicIds.add(cb.dataset.tid); else wTopicIds.delete(cb.dataset.tid); renderWizard(); };
            // Also make the label's checkbox work
            cb.closest('label').onclick = e => {
              if (cb.disabled) return;
              if (e.target.tagName === 'INPUT') return;
              cb.checked = !cb.checked;
              if (cb.checked) wTopicIds.add(cb.dataset.tid); else wTopicIds.delete(cb.dataset.tid);
              renderWizard();
            };
          });

          const addBtn = root.querySelector('#dps-add-syl-btn');
          if (addBtn) {
            addBtn.onclick = () => {
              if (!wTopicIds.size) return;
              const estInp = root.querySelector('#dps-est-inp');
              const totalEst = estInp ? (parseInt(estInp.value, 10) || 0) : 0;
              const perTopic = wTopicIds.size > 0 ? Math.max(5, Math.round(totalEst / wTopicIds.size)) : 20;
              let added = 0;
              for (const tId of wTopicIds) {
                const t = wChapter.topics.find(tp => tp.id === tId);
                if (!t) continue;
                if ((plan.syllabus || []).some(s => s.topicId === tId && s.date === dateISO)) continue;
                plan.syllabus.push({ id: uid(), date: dateISO, subjectId: wSubject.id, subjectName: wSubject.name, subjectColor: wSubject.color, chapterId: wChapter.id, chapterName: wChapter.name, topicId: t.id, topicName: t.name, estimatedMinutes: perTopic, done: false, source: 'syllabus' });
                added++;
              }
              if (added > 0) {
                saveState();
                toast(`${added} topic${added > 1 ? 's' : ''} added to ${isToday ? 'today' : 'this day'} ✓`, 'success');
                wStep = 1; wSubject = null; wChapter = null; wTopicIds = new Set(); wChSearch = '';
                renderWizard(); renderTaskSection(); renderDashboard();
              } else {
                toast('All selected topics already added', 'warn');
              }
            };
          }
        }
      }

      // ── Tab switching ───────────────────────────────────────────────
      root.querySelectorAll('.dps-tab').forEach(btn => {
        btn.onclick = () => {
          root.querySelectorAll('.dps-tab').forEach(b => b.classList.remove('dps-tab-active'));
          btn.classList.add('dps-tab-active');
          const tab = btn.dataset.dpsTab;
          root.querySelector('#dps-panel-syllabus').style.display = tab === 'syllabus' ? '' : 'none';
          root.querySelector('#dps-panel-custom').style.display = tab === 'custom' ? '' : 'none';
        };
      });

      // ── Custom task submit ──────────────────────────────────────────
      const cInp = root.querySelector('#dps-custom-inp');
      const cBtn = root.querySelector('#dps-custom-btn');
      const submitCustom = () => {
        const text = cInp ? cInp.value.trim() : '';
        if (!text) { toast('Enter a task first', 'warn'); return; }
        plan.custom.push({ id: uid(), text, done: false });
        saveState(); renderTaskSection(); renderDashboard();
        if (cInp) cInp.value = '';
        toast('Task added', 'success');
        // Briefly animate the task section
        const sec = root.querySelector('#dps-task-section');
        if (sec) { sec.style.transition = 'opacity 0.15s'; sec.style.opacity = '0.5'; setTimeout(() => { sec.style.opacity = '1'; }, 160); }
      };
      if (cBtn) cBtn.onclick = submitCustom;
      if (cInp) cInp.addEventListener('keydown', e => { if (e.key === 'Enter') submitCustom(); });

      // ── Swipe-to-close ──────────────────────────────────────────────
      const dragHandle = root.querySelector('.dps-drag-handle');
      let _swipeStartY = 0;
      const onTouchStart = e => { _swipeStartY = e.touches[0].clientY; };
      const onTouchEnd = e => { if (e.changedTouches[0].clientY - _swipeStartY > 72) closeModal(); };
      root.addEventListener('touchstart', onTouchStart, { passive: true });
      root.addEventListener('touchend', onTouchEnd, { passive: true });

      // Initial render
      renderTaskSection();
      renderWizard();
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
    // Re-sync focusSessions from state on every render (handles Firebase restore + cross-device updates)
    focusSessions = (state.focusStats.sessions && state.focusStats.sessions[todayKey()]) || 0;
    const view = document.getElementById('view-focus'); if (!view) return;
    const topPills = `<div class="focus-top-pills">
      <button class="ftp-pill${focusTopMode === 'pomodoro' ? ' ftp-pill--active' : ''}" data-act="focus-top-mode" data-mode="pomodoro">⏱ Pomodoro</button>
      <button class="ftp-pill${focusTopMode === 'live' ? ' ftp-pill--live' : ''}" data-act="focus-top-mode" data-mode="live">▶ Live Study</button>
    </div>`;
    if (focusTopMode === 'live') {
      view.innerHTML = topPills + renderLiveStudySetup();
    } else {
      view.innerHTML = topPills +
        `<div class="page-header"><h1>Focus</h1><div class="subtitle">Pomodoro timer & study materials</div></div>` +
        `<div class="focus-sub-nav"><button class="focus-sub-btn ${focusSubTab === 'timer' ? 'active' : ''}" data-act="focus-subtab" data-stab="timer">⏱ Timer</button><button class="focus-sub-btn ${focusSubTab === 'classroom' ? 'active' : ''}" data-act="focus-subtab" data-stab="classroom">🎓 Classroom</button></div>` +
        `${focusSubTab === 'timer' ? renderFocusTimer() : renderClassroom()}`;
    }
  }

  function _renderSCTSelector() {
    const subjects   = state.subjects || [];
    const curSubObj  = _lsSubjectId  ? subjects.find(s => s.id === _lsSubjectId)  : null;
    const chapters   = curSubObj ? (curSubObj.chapters || []) : [];
    const curChapObj = _lsChapterId ? chapters.find(c => c.id === _lsChapterId)   : null;
    const topics     = curChapObj ? (curChapObj.topics || []) : [];
    const curTopic   = _lsTopicId  ? topics.find(t => t.id === _lsTopicId)        : null;

    const subRow = `
      <div class="sct-row">
        <span class="sct-row-lbl">Subject</span>
        <div class="sct-row-ctrl">
          <button class="sct-pick-btn${curSubObj ? ' sct-pick-btn--set' : ''}" data-act="sct-open-sub">
            ${curSubObj
              ? `<span class="sct-dot" style="background:${curSubObj.color||'#ff7a1a'}"></span>
                 <span class="sct-pick-name">${escapeHTML(curSubObj.name)}</span>`
              : `<span class="sct-pick-placeholder">Select Subject</span>`}
            <span class="sct-chev">›</span>
          </button>
          ${curSubObj ? `<button class="sct-clear-btn" data-act="sct-clear-sub" title="Clear">✕</button>` : ''}
        </div>
      </div>`;

    const hasChapters = chapters.length > 0;
    const chapDisabled = !curSubObj || !hasChapters;
    const chapPlaceholder = !curSubObj ? 'Select Chapter' : (!hasChapters ? 'No chapters available' : 'Select Chapter');
    const chapRow = `
      <div class="sct-row">
        <span class="sct-row-lbl">Chapter</span>
        <div class="sct-row-ctrl">
          <button class="sct-pick-btn${chapDisabled ? ' sct-pick-btn--disabled' : (curChapObj ? ' sct-pick-btn--set' : '')}"
                  ${chapDisabled ? 'disabled' : 'data-act="sct-open-chap"'}>
            ${curChapObj
              ? `<span class="sct-pick-name">${escapeHTML(curChapObj.name)}</span>`
              : `<span class="sct-pick-placeholder">${chapPlaceholder}</span>`}
            ${(!chapDisabled) ? '<span class="sct-chev">›</span>' : ''}
          </button>
          ${curChapObj ? `<button class="sct-clear-btn" data-act="sct-clear-chap" title="Clear">✕</button>` : ''}
        </div>
      </div>`;

    const hasTopics = topics.length > 0;
    const topicDisabled = !curChapObj || !hasTopics;
    const topicPlaceholder = !curChapObj ? 'Select Topic' : (!hasTopics ? 'No topics available' : 'Select Topic');
    const topicRow = `
      <div class="sct-row">
        <span class="sct-row-lbl">Topic</span>
        <div class="sct-row-ctrl">
          <button class="sct-pick-btn${topicDisabled ? ' sct-pick-btn--disabled' : (curTopic ? ' sct-pick-btn--set' : '')}"
                  ${topicDisabled ? 'disabled' : 'data-act="sct-open-topic"'}>
            ${curTopic
              ? `<span class="sct-pick-name">${escapeHTML(curTopic.name)}</span>`
              : `<span class="sct-pick-placeholder">${topicPlaceholder}</span>`}
            ${(!topicDisabled) ? '<span class="sct-chev">›</span>' : ''}
          </button>
          ${curTopic ? `<button class="sct-clear-btn" data-act="sct-clear-topic" title="Clear">✕</button>` : ''}
        </div>
      </div>`;

    const warn = !_lsSubjectId
      ? `<div class="sct-warn">⚠ Select a subject to start the timer</div>`
      : curTopic
        ? `<div class="sct-ready">✓ Ready — <strong>${escapeHTML(curSubObj.name)}</strong> · ${escapeHTML(curTopic.name)}</div>`
        : curChapObj
          ? `<div class="sct-ready">✓ Ready — <strong>${escapeHTML(curSubObj.name)}</strong> · ${escapeHTML(curChapObj.name)}</div>`
          : `<div class="sct-ready">✓ Ready — <strong>${escapeHTML(curSubObj.name)}</strong></div>`;

    return `<div class="focus-sct-card">
      <div class="focus-sct-label">📚 STUDYING</div>
      ${subRow}${chapRow}${topicRow}${warn}
    </div>`;
  }

  function _sctOpenSheet(title, items, currentId, onPick) {
    if (document.getElementById('sct-sheet-ov')) return;
    if (!items.length) { toast('Study tab-এ subject যোগ করুন', 'info'); return; }
    const ov = document.createElement('div');
    ov.id = 'sct-sheet-ov';
    ov.className = 'lss-ov';
    const renderRows = (filter) => items
      .filter(item => !filter || item.name.toLowerCase().includes(filter.toLowerCase()))
      .map(item => `
        <button class="lss-sheet-row${currentId === item.id ? ' lss-sheet-row--on' : ''}" data-sid="${escapeHTML(item.id)}">
          <span class="lss-sheet-dot" style="background:${item.color||'#7c3aed'}"></span>
          <span class="lss-sheet-nm">${escapeHTML(item.name)}</span>
          <span class="lss-sheet-tick">${currentId === item.id ? '✓' : ''}</span>
        </button>`).join('');
    ov.innerHTML = `
      <div class="lss-sheet" id="sct-sheet">
        <div class="lss-sheet-bar"></div>
        <div class="lss-sheet-ttl">${title}</div>
        <div class="sct-search-wrap">
          <span class="sct-search-icon">🔍</span>
          <input class="sct-search-input" id="sct-search" placeholder="Search…" autocomplete="off" spellcheck="false"/>
        </div>
        <div class="lss-sheet-list" id="sct-sheet-list">${renderRows('')}</div>
      </div>`;
    const close = () => { ov.classList.remove('lss-ov--in'); setTimeout(() => ov.remove(), 280); };
    ov.addEventListener('click',    e => { if (e.target === ov) close(); });
    ov.addEventListener('touchend', e => { if (e.target === ov) { e.preventDefault(); close(); } }, { passive: false });
    const bindRows = () => {
      ov.querySelectorAll('.lss-sheet-row').forEach(btn => {
        const pick = () => { close(); onPick(btn.dataset.sid); setTimeout(() => renderFocus(), 290); };
        let touched = false;
        btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); touched = true; pick(); setTimeout(() => { touched = false; }, 500); }, { passive: false });
        btn.addEventListener('click',    e => { e.stopPropagation(); if (!touched) pick(); });
      });
    };
    bindRows();
    // Realtime search filter
    ov.querySelector('#sct-search').addEventListener('input', function() {
      const list = ov.querySelector('#sct-sheet-list');
      list.innerHTML = renderRows(this.value);
      bindRows();
    });
    document.body.appendChild(ov);
    requestAnimationFrame(() => {
      ov.classList.add('lss-ov--in');
      setTimeout(() => { const inp = ov.querySelector('#sct-search'); if (inp) inp.focus(); }, 320);
    });
  }

  function _sctOpenSubSheet() {
    const subjects = state.subjects || [];
    if (!subjects.length) { toast('Study tab-এ subject যোগ করুন', 'info'); return; }
    _sctOpenSheet('Subject বেছে নিন', subjects, _lsSubjectId, sid => {
      if (sid !== _lsSubjectId) { _lsChapterId = null; _lsTopicId = null; }
      _lsSubjectId = sid;
    });
  }

  function _sctOpenChapSheet() {
    const sub = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    if (!sub) { toast('আগে Subject বেছে নিন', 'info'); return; }
    const chapters = sub.chapters || [];
    if (!chapters.length) { toast('এই subject-এ কোনো chapter নেই', 'info'); return; }
    _sctOpenSheet('Chapter বেছে নিন', chapters, _lsChapterId, cid => {
      if (cid !== _lsChapterId) _lsTopicId = null;
      _lsChapterId = cid;
    });
  }

  function _sctOpenTopicSheet() {
    const sub  = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    const chap = sub && _lsChapterId ? (sub.chapters || []).find(c => c.id === _lsChapterId) : null;
    if (!chap) { toast('আগে Chapter বেছে নিন', 'info'); return; }
    const topics = chap.topics || [];
    if (!topics.length) { toast('এই chapter-এ কোনো topic নেই', 'info'); return; }
    _sctOpenSheet('Topic বেছে নিন', topics, _lsTopicId, tid => { _lsTopicId = tid; });
  }

  function renderFocusTimer() {
    if (!_currentQuote) pickNewQuote();
    const total = customDurations[focusMode] * 60;
    const r = 96, c = 2 * Math.PI * r, off = c * (1 - _ringFillPct(focusSeconds, total));
    const isBreak = focusMode !== 'work';
    return `<div class="focus-view">
      <div class="focus-col-left">
        <div class="focus-mode-tabs">
          <button class="focus-mode-btn ${focusMode === 'work' ? 'active' : ''}" data-act="focus-mode" data-mode="work">Work</button>
          <button class="focus-mode-btn ${focusMode === 'short' ? 'active' : ''}" data-act="focus-mode" data-mode="short">Short Break</button>
          <button class="focus-mode-btn ${focusMode === 'long' ? 'active' : ''}" data-act="focus-mode" data-mode="long">Long Break</button>
        </div>
        <div class="focus-mode-edit">
          <div class="focus-mode-edit-item"><label>Work</label><input type="number" min="1" max="2000" id="focus-dur-work" value="${customDurations.work}" data-act="focus-dur-change" data-dmode="work"/><span>min</span></div>
          <div class="focus-mode-edit-item"><label>Short</label><input type="number" min="1" max="60" id="focus-dur-short" value="${customDurations.short}" data-act="focus-dur-change" data-dmode="short"/><span>min</span></div>
          <div class="focus-mode-edit-item"><label>Long</label><input type="number" min="1" max="120" id="focus-dur-long" value="${customDurations.long}" data-act="focus-dur-change" data-dmode="long"/><span>min</span></div>
        </div>
        <div class="focus-ring-wrap${focusIntensityMode !== 'none' ? ' intensity-active' : ''}">
          <svg class="focus-ring-svg" viewBox="0 0 220 220" aria-hidden="true">
            <circle class="focus-ring-track" cx="110" cy="110" r="${r}"/>
            <circle class="focus-ring-fill ${isBreak ? 'break-mode' : ''}${focusOvertime ? ' overtime-mode' : ''}" id="focus-ring-circle" cx="110" cy="110" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${focusOvertime ? c.toFixed(2) : off.toFixed(2)}"/>
          </svg>
          <div class="focus-ring-center">
            <div class="focus-ring-time${focusOvertime ? ' fs-overtime-text' : _timeSizeClass(formatFocusTime(focusSeconds))}" id="focus-time-display">${focusOvertime ? `+${String(Math.floor(focusOvertimeSeconds/60)).padStart(2,'0')}:${String(focusOvertimeSeconds%60).padStart(2,'0')}` : formatFocusTime(focusSeconds)}</div>
            <div class="focus-ring-mode">${focusOvertime ? '⚠ Overtime' : focusMode === 'work' ? 'Focus Time' : focusMode === 'short' ? 'Short Break' : 'Long Break'}</div>
          </div>
        </div>
        <div class="focus-buttons">
          <button class="btn btn-ghost" data-act="focus-reset">Reset</button>
          <button class="btn${focusOvertime ? ' btn-overtime' : ''}" style="min-width:110px" data-act="focus-toggle">${focusRunning ? '⏸ Pause' : (focusOvertime ? '⏹ End Session' : '▶ Start')}</button>
        </div>
      </div>
      <div class="focus-col-right">
        <div class="focus-sessions-info">
          <div class="grid">
            <div><div class="v">${focusSessions}</div><div class="k">Sessions today</div></div>
            <div class="live-focus-today-wrap"><div class="v live-focus-today">${minsToHrs(state.focusStats.minutesByDate[todayKey()] || 0)}</div><div class="k">Focus today</div></div>
          </div>
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
        ${(()=>{
          const offSound    = SOUNDS.find(s => s.id === 'none');
          const freeSounds  = SOUNDS.filter(s => s.cat && !s.premium);
          const premSounds  = SOUNDS.filter(s => s.premium);
          const offBtn = offSound
            ? `<button class="ambient-btn ambient-btn--off${ambientMode === 'none' ? ' active' : ''}" data-act="ambient-select" data-amode="none">${offSound.label}</button>`
            : '';
          const freeBtns = freeSounds.map(s =>
            `<button class="ambient-btn${ambientMode === s.id ? ' active' : ''}" data-act="ambient-select" data-amode="${s.id}">${s.label}</button>`
          ).join('');
          const premBtns = premSounds.map(s => {
            const owned = _itemOwned(s.shopId);
            if (owned) {
              return `<button class="ambient-btn${ambientMode === s.id ? ' active' : ''}" data-act="ambient-select" data-amode="${s.id}">${s.label}</button>`;
            }
            return `<button class="ambient-btn ambient-btn--locked" disabled title="Buy for 10,000 XP in Music Shop">🔒 ${s.label}</button>`;
          }).join('');
          const lockedCount = premSounds.filter(s => !_itemOwned(s.shopId)).length;
          const volRow = ambientMode !== 'none'
            ? `<div class="fac-vol-row"><span>🔊</span><input type="range" id="ambient-vol-slider" min="0" max="1" step="0.05" value="${ambientVolume}" class="bb-vol-slider"/></div>`
            : '';
          const shopHint = lockedCount
            ? `<div class="fac-premium-hint">🔒 ${lockedCount} premium track${lockedCount > 1 ? 's' : ''} — <button class="btn-link" data-act="open-music-shop">unlock in XP Shop ⚡ 10,000 XP each</button></div>`
            : '';
          return `<div class="focus-ambient-card"><div class="fac-title">🎵 Ambient Sound</div><div class="ambient-grid">${offBtn}${freeBtns}${premBtns}</div>${volRow}${shopHint}</div>`;
        })()}
        ${_renderSCTSelector()}
        <button class="btn fs-enter-btn" data-act="enter-full-session">🚀 Enter Full Focus Mode</button>
      </div>
    </div>`;
  }

  // ========== Live Study Timer ==========

  function _secsToHMS(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
    return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`;
  }

  function renderLiveStudySetup() {
    const subjects = state.subjects || [];
    const todayMins = state.focusStats.minutesByDate[todayKey()] || 0;
    const curSub    = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    const streak    = (state.streak && state.streak.count) || 0;
    const mult      = _isBoosterActive() ? 2 : 1;

    // Subject bar label
    let subBarHTML;
    if (!subjects.length) {
      subBarHTML = `<div class="lss-sub-bar lss-sub-bar--empty">
        <span class="lss-sub-icon">📚</span>
        <span class="lss-sub-placeholder">Study tab-এ subject যোগ করুন</span>
      </div>`;
    } else if (curSub) {
      subBarHTML = `<div class="lss-sub-bar" id="lss-sub-bar" data-act="ls-open-sheet">
        <span class="lss-sub-dot" style="background:${curSub.color||'#ff7a1a'}"></span>
        <span class="lss-sub-name">${escapeHTML(curSub.name)}</span>
        <span class="lss-sub-chev">›</span>
      </div>`;
    } else {
      subBarHTML = `<div class="lss-sub-bar" id="lss-sub-bar" data-act="ls-open-sheet">
        <span class="lss-sub-icon">📚</span>
        <span class="lss-sub-placeholder">Subject বেছে নিন</span>
        <span class="lss-sub-chev">›</span>
      </div>`;
    }

    return `<div class="ls-setup-wrap">
      <div class="ls-setup-header">
        <div class="ls-setup-title">Live Study Timer</div>
        <div class="ls-setup-sub">Real-time tracking with Firebase sync</div>
      </div>
      <div class="ls-stat-row">
        <div class="ls-stat-item"><div class="ls-stat-val">${minsToHrs(todayMins)}</div><div class="ls-stat-key">Today</div></div>
        <div class="ls-stat-item"><div class="ls-stat-val">${focusSessions}</div><div class="ls-stat-key">Sessions</div></div>
        <div class="ls-stat-item"><div class="ls-stat-val">${streak} 🔥</div><div class="ls-stat-key">Streak</div></div>
        <div class="ls-stat-item"><div class="ls-stat-val" style="color:#ff7a1a">${mult}×</div><div class="ls-stat-key">Multiplier</div></div>
      </div>
      <div class="ls-subject-section">
        <div class="ls-section-label">📌 Subject</div>
        ${subBarHTML}
      </div>
      <button class="ls-start-btn" data-act="ls-enter">▶ Start Live Study</button>
    </div>`;
  }

  /* ── Subject bottom-sheet for Live Study setup ── */
  function _lsOpenSheet() {
    if (document.getElementById('lss-sheet-ov')) return;
    const subjects = state.subjects || [];
    if (!subjects.length) { toast('Study tab-এ subject যোগ করুন', 'info'); return; }

    const ov = document.createElement('div');
    ov.id = 'lss-sheet-ov';
    ov.className = 'lss-ov';
    ov.innerHTML = `
      <div class="lss-sheet" id="lss-sheet">
        <div class="lss-sheet-bar"></div>
        <div class="lss-sheet-ttl">Subject বেছে নিন</div>
        <div class="lss-sheet-list">
          ${subjects.map(s => `
            <button class="lss-sheet-row${_lsSubjectId === s.id ? ' lss-sheet-row--on' : ''}" data-sid="${escapeHTML(s.id)}">
              <span class="lss-sheet-dot" style="background:${s.color||'#ff7a1a'}"></span>
              <span class="lss-sheet-nm">${escapeHTML(s.name)}</span>
              <span class="lss-sheet-tick">${_lsSubjectId === s.id ? '✓' : ''}</span>
            </button>`).join('')}
        </div>
      </div>`;

    // close on backdrop tap
    const close = () => { ov.classList.remove('lss-ov--in'); setTimeout(() => ov.remove(), 280); };
    ov.addEventListener('click',    e => { if (e.target === ov) close(); });
    ov.addEventListener('touchend', e => { if (e.target === ov) { e.preventDefault(); close(); } }, { passive: false });

    // row tap
    ov.querySelectorAll('.lss-sheet-row').forEach(btn => {
      const pick = () => {
        const sid = btn.dataset.sid;
        if (sid !== _lsSubjectId) { _lsChapterId = null; _lsTopicId = null; }
        _lsSubjectId = sid;
        close();
        setTimeout(() => renderFocus(), 290);
      };
      let touched = false;
      btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); touched = true; pick(); setTimeout(() => { touched = false; }, 500); }, { passive: false });
      btn.addEventListener('click',    e => { e.stopPropagation(); if (!touched) pick(); });
    });

    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('lss-ov--in'));
  }

  function _lsGetElapsed() {
    if (!_lsRunning || _lsStartTime === null) return _lsElapsedBase;
    return _lsElapsedBase + Math.floor((Date.now() - _lsStartTime) / 1000);
  }

  function _lsTick() {
    if (!_lsRunning) return;
    _lsFbTick++;
    _lsHeartbeatTick++;
    _lsUpdateDisplay();
    if (_lsFbTick % 10 === 0) _lsBroadcastFb();
    // Heartbeat: save session state to localStorage every 5 s for crash recovery
    if (_lsHeartbeatTick % 5 === 0) {
      try {
        localStorage.setItem('_ls_heartbeat', JSON.stringify({
          startTime:   _lsStartTime,
          elapsedBase: _lsElapsedBase,
          subjectId:   _lsSubjectId,
          ts:          Date.now()
        }));
      } catch (_) {}
    }
    updateMiniTimer();
  }

  function _weekStartKey() {
    const d = new Date(), day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }

  function _computeWeekMins(todayOverride) {
    const today = todayKey();
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      total += (key === today && todayOverride !== undefined)
        ? todayOverride
        : (state.focusStats.minutesByDate[key] || 0);
    }
    return total;
  }

  function _lsBroadcastFb() {
    if (!_db || !_userId || typeof firebase === 'undefined') return;
    const elapsed = _lsGetElapsed();
    const curSub = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    const avStageNow = _lsCurrentAvatarStage >= 0 ? _lsCurrentAvatarStage : 0;
    _db.collection('users').doc(_userId).set({
      liveSession: {
        isStudying: true,
        currentSubject: curSub ? curSub.name : null,
        currentSubjectId: _lsSubjectId || null,
        currentSessionSeconds: elapsed,
        avatarStage: avStageNow,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true }).catch(() => {});
    // Also update global leaderboard with live running total
    const today = todayKey();
    const storedMins = state.focusStats.minutesByDate[today] || 0;
    const liveMins   = Math.round(elapsed / 60);
    const totalDaily = storedMins + liveMins;
    const totalWeekly = _computeWeekMins(totalDaily);
    const userName = (state.profile && state.profile.name) ||
      (typeof firebase !== 'undefined' && firebase.auth().currentUser && firebase.auth().currentUser.displayName) ||
      'Anonymous';
    _db.collection('global_lb').doc(_userId).set({
      dailyStudyTime:  totalDaily,
      dailyResetDate:  today,
      weeklyStudyTime: totalWeekly,
      weeklyResetDate: _weekStartKey(),
      name:            userName,
      lastActive:      today,
      avatarStage:     avStageNow,
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    // Keep group presence alive while the live timer is running on any tab.
    // Only update isStudying + elapsed — never overwrite studyStartedAt here
    // (that is set once by _sUpdatePresence when focusing begins).
    if (_socialRoomCode) {
      _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
        .set({
          isStudying:       true,
          elapsedTimeToday: storedMins,
          lastUpdated:      firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
    }
  }

  function _lsUpdateDisplay() {
    const overlay = document.getElementById('ls-overlay'); if (!overlay) return;
    const elapsed = _lsGetElapsed();
    const storedMin = state.focusStats.minutesByDate[todayKey()] || 0;
    const todaySecs = storedMin * 60 + elapsed;
    const subStoredMin = _lsSubjectId ? (state.focusStats.minutesBySubject[_lsSubjectId] || 0) : 0;
    const subSecs = subStoredMin * 60 + elapsed;
    const elEl = overlay.querySelector('#ls-elapsed');
    if (elEl) elEl.textContent = _secsToHMS(elapsed);
    const todayEl = overlay.querySelector('#ls-today-val');
    if (todayEl) todayEl.textContent = _secsToHMS(todaySecs);
    const subEl = overlay.querySelector('#ls-sub-val');
    if (subEl) subEl.textContent = _secsToHMS(subSecs);
    const subRowEl = overlay.querySelector('#ls-sub-row-time');
    if (subRowEl) subRowEl.textContent = _secsToHMS(subSecs);
    const logTotalEl = overlay.querySelector('#ls-log-total-val');
    if (logTotalEl) logTotalEl.textContent = _secsToHMS(todaySecs);
    if (_lsSubjectId) {
      const logRowEl = overlay.querySelector(`[data-ls-log-sub="${_lsSubjectId}"]`);
      if (logRowEl) {
        const logTimeEl = logRowEl.querySelector('.lsf-log-time');
        if (logTimeEl) logTimeEl.textContent = _secsToHMS(subSecs);
        const barEl = logRowEl.querySelector('.lsf-log-bar');
        if (barEl && todaySecs > 0) barEl.style.width = Math.min(100, Math.round((subSecs / todaySecs) * 100)) + '%';
      }
    }
    document.title = `${_secsToHMS(elapsed)} — Live Study`;
    // Avatar stage auto-advance with smooth transition
    const newStage = _lsGetAvatarStage(elapsed);
    if (newStage !== _lsCurrentAvatarStage) {
      _lsCurrentAvatarStage = newStage;
      const avWrap = overlay.querySelector('#ls-av-wrap');
      if (avWrap) {
        const svgEl = avWrap.querySelector('.ls-av-svg');
        if (svgEl) {
          svgEl.classList.add('ls-av-pop');
          setTimeout(() => {
            svgEl.outerHTML = _lsAvatarSVG(newStage);
            const freshSvg = avWrap.querySelector('.ls-av-svg');
            if (freshSvg) {
              freshSvg.classList.add('ls-av-appear');
              requestAnimationFrame(() => requestAnimationFrame(() => freshSvg.classList.remove('ls-av-appear')));
            }
          }, 220);
        }
        const stageEl = avWrap.querySelector('#ls-av-stage');
        if (stageEl) stageEl.textContent = _LS_AV_LABELS[newStage] || 'LEGENDARY';
      }
    }
  }

  function enterLiveSession() {
    if (_lsOverlayActive) return;

    // ── Session recovery: check for an interrupted session ─────────────
    let recoveredElapsed = 0;
    try {
      const hb = JSON.parse(localStorage.getItem('_ls_heartbeat') || 'null');
      if (hb && hb.ts && hb.startTime && (Date.now() - hb.ts) < 3_600_000) {
        // Compute true elapsed from stored start + elapsed base + time since last heartbeat
        const recoveredSecs = hb.elapsedBase + Math.floor((Date.now() - hb.startTime) / 1000);
        if (recoveredSecs > 60) {
          recoveredElapsed = recoveredSecs;
          // Restore subject if it still exists
          if (hb.subjectId && !_lsSubjectId) {
            const sub = findSubject(hb.subjectId);
            if (sub) _lsSubjectId = hb.subjectId;
          }
          toast(`Recovered session: ${_secsToHMS(recoveredSecs)}`, 'info');
        }
      }
    } catch (_) {}

    _lsOverlayActive         = true;
    _lsRunning               = true;
    _lsElapsedBase           = recoveredElapsed;
    _lsStartTime             = Date.now();
    _lsFbTick                = 0;
    _lsHeartbeatTick         = 0;
    _lsCurrentAvatarStage    = -1;
    window._focusActive      = true;

    let overlay = document.getElementById('ls-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ls-overlay';
      document.body.appendChild(overlay);
    }
    renderLiveOverlay();
    _lsTimer = setInterval(_lsTick, 1000);

    // ── Visibility change: keep time accurate when app goes to background ──
    _lsVisibilityHandler = () => {
      if (!document.hidden && _lsRunning && _lsStartTime !== null) {
        // Recalculate elapsed from wall-clock time — prevents timer drift
        // when the browser throttles intervals in the background.
        // Nothing to do here since _lsGetElapsed() already uses Date.now().
      }
    };
    document.addEventListener('visibilitychange', _lsVisibilityHandler);

    if (typeof window._socialFocusUpdate === 'function') { try { window._socialFocusUpdate(); } catch(_) {} }
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    overlay.addEventListener('touchstart', e => { _fsSwipeStartX = e.touches[0].clientX; _fsSwipeStartY = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _fsSwipeStartX;
      const dy = e.changedTouches[0].clientY - _fsSwipeStartY;
      if (Math.sqrt(dx * dx + dy * dy) >= 65) exitLiveSession(true);
    }, { passive: true });
    _lsBroadcastFb();
  }

  function exitLiveSession(save) {
    if (!_lsOverlayActive) return;
    clearInterval(_lsTimer); _lsTimer = null;
    _lsStopParticles();
    const elapsed = _lsGetElapsed();
    _lsRunning = false;
    _lsOverlayActive = false;
    _lsElapsedBase = 0;
    _lsStartTime = null;
    _lsHeartbeatTick = 0;
    window._focusActive = false;
    // Remove visibility listener
    if (_lsVisibilityHandler) {
      document.removeEventListener('visibilitychange', _lsVisibilityHandler);
      _lsVisibilityHandler = null;
    }
    // Clear heartbeat
    try { localStorage.removeItem('_ls_heartbeat'); } catch (_) {}
    const overlay = document.getElementById('ls-overlay'); if (overlay) overlay.remove();
    document.title = 'Syllabus Tracker';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    lockPortrait();
    if (save !== false && elapsed >= 60) {
      const elapsedMin = Math.round(elapsed / 60);
      const todayStr = todayKey();
      state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
      try { if (window._socialOnStudyTimeUpdate) window._socialOnStudyTimeUpdate(state.focusStats.minutesByDate[todayStr]); } catch(_) {}
      if (_lsSubjectId) {
        if (!state.focusStats.minutesBySubject) state.focusStats.minutesBySubject = {};
        state.focusStats.minutesBySubject[_lsSubjectId] = (state.focusStats.minutesBySubject[_lsSubjectId] || 0) + elapsedMin;
      }
      // ── Count the session — always, regardless of Firebase login ──
      focusSessions++;
      if (!state.focusStats.sessions) state.focusStats.sessions = {};
      state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
      awardXP(elapsedMin, todayStr);
      _sContributeToGoals(elapsedMin).catch(() => {});
      checkBadges({ sessionMinutes: elapsedMin });
      saveState();
      toast(`Saved ${elapsedMin}m live study session!`, 'success');
      if (document.getElementById('view-stats') && document.getElementById('view-stats').classList.contains('active')) renderStats();
    } else if (save !== false && elapsed > 0 && elapsed < 60) {
      toast('Session under 1 min — not saved', 'warn');
    }
    _lsSaveToFirebase(elapsed);
    if (typeof window._socialFocusUpdate === 'function') { try { window._socialFocusUpdate(); } catch(_) {} }
    renderFocus();
  }

  function _lsSaveToFirebase(totalSecs) {
    if (!_db || !_userId || typeof firebase === 'undefined') return;
    const uid = _userId;
    _db.collection('users').doc(uid).set({ liveSession: { isStudying: false, currentSessionSeconds: 0 } }, { merge: true }).catch(() => {});
    const elapsedMin = Math.round(totalSecs / 60);
    if (elapsedMin < 1) return;
    const curSub = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    const curChapLog = _lsSubjectId && _lsChapterId ? (curSub ? (curSub.chapters||[]).find(c=>c.id===_lsChapterId) : null) : null;
    const curTopicLog = curChapLog && _lsTopicId ? (curChapLog.topics||[]).find(t=>t.id===_lsTopicId) : null;
    _db.collection('users').doc(uid).collection('syllabus_logs').doc().set({
      date: todayKey(), subjectId: _lsSubjectId || null,
      subjectName: curSub ? curSub.name : null,
      chapterId: _lsChapterId || null,
      chapterName: curChapLog ? curChapLog.name : null,
      topicId: _lsTopicId || null,
      topicName: curTopicLog ? curTopicLog.name : null,
      minutes: elapsedMin, seconds: totalSecs,
      type: 'live_study', createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
    const todayStr2 = todayKey();
    const finalDailyMins  = state.focusStats.minutesByDate[todayStr2] || 0;
    const finalWeeklyMins = _computeWeekMins(finalDailyMins);
    const saveName = (state.profile && state.profile.name) ||
      (typeof firebase !== 'undefined' && firebase.auth().currentUser && firebase.auth().currentUser.displayName) ||
      'Anonymous';
    _db.collection('global_lb').doc(uid).set({
      dailyStudyTime:  finalDailyMins,
      dailyResetDate:  todayStr2,
      weeklyStudyTime: finalWeeklyMins,
      weeklyResetDate: _weekStartKey(),
      name:            saveName,
      lastActive:      todayStr2,
      avatarStage:     _lsCurrentAvatarStage >= 0 ? _lsCurrentAvatarStage : 0,
      updatedAt:       firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    // ── Save today's session count to Firebase for real-time cross-device sync ──
    const todaySessions = state.focusStats.sessions ? (state.focusStats.sessions[todayStr2] || 0) : 0;
    _db.collection('users').doc(uid).set({
      sessionStats: { [todayStr2]: todaySessions },
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }

  // ── Focus Evolution Avatar System ─────────────────────────────────────────
  const _LS_AV_THRESHOLDS = [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 36000];
  const _LS_AV_LABELS     = ['IDLE','FOCUSED','STUDYING','DEEP STUDY','SCHOLAR','SAGE','WARRIOR','BLAZING','INFERNO','LEGENDARY'];
  // Expose for social.js
  window._lsAvLabels            = _LS_AV_LABELS;
  window._lsGetCurrentAvStage   = () => (_lsCurrentAvatarStage >= 0 ? _lsCurrentAvatarStage : 0);

  function _lsGetAvatarStage(secs) {
    let s = 0;
    for (let i = 0; i < _LS_AV_THRESHOLDS.length; i++) {
      if (secs >= _LS_AV_THRESHOLDS[i]) s = i;
    }
    return s;
  }

  function _lsNinjaBase() {
    return `<line x1="20" y1="92" x2="120" y2="92" stroke="#d4d4d8" stroke-width="3" stroke-linecap="round"/>
    <line x1="30" y1="92" x2="28" y2="118" stroke="#d4d4d8" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="110" y1="92" x2="112" y2="118" stroke="#d4d4d8" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M38 91 Q52 78 70 81 L70 92" fill="#f0ede6" stroke="#9ca3af" stroke-width="1.2"/>
    <path d="M102 91 Q88 78 70 81 L70 92" fill="#e8e5de" stroke="#9ca3af" stroke-width="1.2"/>
    <line x1="70" y1="81" x2="70" y2="92" stroke="#6b7280" stroke-width="1.5"/>
    <line x1="46" y1="85" x2="62" y2="84" stroke="#9ca3af" stroke-width="0.9"/>
    <line x1="45" y1="88" x2="63" y2="87" stroke="#9ca3af" stroke-width="0.9"/>
    <line x1="78" y1="84" x2="94" y2="85" stroke="#9ca3af" stroke-width="0.9"/>
    <line x1="79" y1="87" x2="96" y2="88" stroke="#9ca3af" stroke-width="0.9"/>
    <path d="M57 70 Q54 82 52 92 H88 Q86 82 83 70 Q77 74 70 74 Q63 74 57 70Z" fill="#111827" stroke="#6b7280" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M64 70 L68 80 L72 80 L76 70" stroke="#374151" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
    <path d="M83 74 Q93 80 94 92" stroke="#6b7280" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M57 74 Q47 82 46 92" stroke="#6b7280" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <line x1="94" y1="88" x2="97" y2="80" stroke="#d4d4d8" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="65" y="62" width="10" height="9" rx="2" fill="#111827" stroke="#4b5563" stroke-width="1.2"/>
    <ellipse cx="70" cy="44" rx="17" ry="19" fill="#111827" stroke="#6b7280" stroke-width="2"/>
    <path d="M54 36 C52 24 58 16 60 24 C62 16 65 12 68 22 C70 14 72 12 74 22 C76 14 79 18 80 26 C82 16 88 22 86 36" fill="#111827" stroke="#4b5563" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M54 36 L46 28 L54 38" fill="#111827" stroke="#4b5563" stroke-width="1.2"/>
    <path d="M54 38 Q70 44 86 38" stroke="#374151" stroke-width="2" fill="none"/>
    <rect x="66" y="35" width="8" height="5" rx="1" fill="#1a1a2e" stroke="#4b5563" stroke-width="1"/>
    <path d="M57 43 Q60 39 64 43" stroke="#e5e7eb" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M76 43 Q80 39 83 43" stroke="#e5e7eb" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="61" cy="42" rx="2" ry="2.5" fill="#0f172a"/>
    <ellipse cx="79" cy="42" rx="2" ry="2.5" fill="#0f172a"/>
    <circle cx="62" cy="41" r="1" fill="white"/>
    <circle cx="80" cy="41" r="1" fill="white"/>
    <path d="M53 50 Q53 62 70 62 Q87 62 87 50 Q80 56 70 56 Q60 56 53 50Z" fill="#0d0d0d" stroke="#374151" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M55 55 Q70 60 85 55" stroke="#1f2937" stroke-width="1.2" fill="none"/>`;
  }

  function _lsAuraLayer(s) {
    const E = (cx,cy,r,col,cls) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" class="lsf-ember ${cls}"/>`;
    const K = (d,col,cls) => `<path d="${d}" fill="${col}" class="lsf-ember ${cls}"/>`;
    switch(s) {
      case 0: return { behind: '',
        front: `${E(82,16,2.5,'rgba(200,200,200,0.22)','lsf-ember-1')}${E(90,9,2,'rgba(200,200,200,0.15)','lsf-ember-2')}${E(96,21,2,'rgba(200,200,200,0.12)','lsf-ember-3')}` };
      case 1: return { behind: '',
        front: `${E(44,24,2.5,'rgba(255,255,255,0.28)','lsf-ember-2')}${E(98,28,2,'rgba(255,255,255,0.22)','lsf-ember-4')}${E(50,46,2,'rgba(255,255,255,0.18)','lsf-ember-3')}${K('M40 18L41 13L42 18L47 19L42 20L41 25L40 20L35 19Z','rgba(255,255,255,0.42)','lsf-ember-1')}${K('M98 22L99 18L100 22L104 23L100 24L99 28L98 24L94 23Z','rgba(255,255,255,0.32)','lsf-ember-3')}` };
      case 2: return {
        behind: `<ellipse cx="70" cy="58" rx="42" ry="40" fill="rgba(255,200,100,0.05)"/>`,
        front: `${E(40,20,3,'rgba(255,220,140,0.30)','lsf-ember-1')}${E(102,24,2.5,'rgba(255,220,140,0.25)','lsf-ember-3')}${E(32,42,2,'rgba(255,200,100,0.22)','lsf-ember-2')}${K('M38 16L39 11L40 16L45 17L40 18L39 23L38 18L33 17Z','rgba(255,200,110,0.52)','lsf-ember-2')}${K('M100 18L101 14L102 18L106 19L102 20L101 24L100 20L96 19Z','rgba(255,200,110,0.42)','lsf-ember-4')}${E(110,36,2,'rgba(255,180,80,0.35)','lsf-ember-5')}` };
      case 3: return {
        behind: `<ellipse cx="70" cy="56" rx="46" ry="44" fill="rgba(255,122,26,0.07)"/>`,
        front: `${E(36,18,4,'rgba(255,160,60,0.35)','lsf-ember-1')}${E(106,22,3,'rgba(255,150,50,0.28)','lsf-ember-3')}${E(42,48,2.5,'rgba(255,130,30,0.25)','lsf-ember-2')}${E(112,42,2,'rgba(255,120,26,0.30)','lsf-ember-5')}${K('M33 14L34 8L35 14L41 15L35 16L34 22L33 16L27 15Z','rgba(255,180,80,0.62)','lsf-ember-2')}${K('M104 16L105 11L106 16L111 17L106 18L105 23L104 18L99 17Z','rgba(255,170,70,0.54)','lsf-ember-4')}${E(28,34,2,'rgba(255,140,40,0.38)','lsf-ember-3')}` };
      case 4: return {
        behind: `<ellipse cx="70" cy="55" rx="54" ry="52" fill="rgba(255,122,26,0.09)"/><ellipse cx="70" cy="46" rx="30" ry="28" fill="rgba(255,160,70,0.07)"/>`,
        front: `${E(34,16,5,'rgba(255,160,60,0.40)','lsf-ember-1')}${E(108,20,4,'rgba(255,150,50,0.34)','lsf-ember-3')}${E(116,38,3,'rgba(255,130,30,0.38)','lsf-ember-5')}${E(24,38,3,'rgba(255,140,40,0.35)','lsf-ember-4')}${K('M30 12L31 6L32 12L38 13L32 14L31 20L30 14L24 13Z','rgba(255,190,80,0.68)','lsf-ember-2')}${K('M106 14L107 9L108 14L113 15L108 16L107 21L106 16L101 15Z','rgba(255,180,70,0.60)','lsf-ember-4')}${E(20,52,2.5,'rgba(255,120,26,0.42)','lsf-ember-1')}${E(118,56,2.5,'rgba(255,130,36,0.38)','lsf-ember-3')}` };
      case 5: return {
        behind: `<ellipse cx="68" cy="65" rx="54" ry="44" fill="rgba(220,220,230,0.06)"/><ellipse cx="70" cy="52" rx="42" ry="40" fill="rgba(255,122,26,0.10)"/><ellipse cx="70" cy="44" rx="26" ry="24" fill="rgba(255,160,70,0.08)"/><path d="M18 70Q34 56 50 68Q65 56 80 68Q96 56 120 68" stroke="rgba(200,200,220,0.14)" stroke-width="7" fill="none"/>`,
        front: `${E(30,14,5.5,'rgba(255,180,80,0.52)','lsf-ember-1')}${E(110,12,4.5,'rgba(255,180,70,0.46)','lsf-ember-3')}${E(120,30,3.5,'rgba(255,140,40,0.58)','lsf-ember-5')}${E(20,28,3.5,'rgba(255,150,50,0.54)','lsf-ember-4')}${E(22,50,3,'rgba(255,120,26,0.48)','lsf-ember-1')}${E(118,54,3,'rgba(255,130,30,0.44)','lsf-ember-2')}${K('M28 10L29 4L30 10L36 11L30 12L29 18L28 12L22 11Z','rgba(255,200,90,0.72)','lsf-ember-2')}${K('M108 12L109 7L110 12L115 13L110 14L109 19L108 14L103 13Z','rgba(255,190,80,0.64)','lsf-ember-4')}` };
      case 6: return {
        behind: `<ellipse cx="70" cy="54" rx="60" ry="58" fill="rgba(255,100,20,0.12)"/><circle cx="70" cy="48" r="30" fill="none" stroke="rgba(255,122,26,0.24)" stroke-width="3"/><path d="M58 38Q54 20 62 10Q64 24 66 16Q68 8 70 18Q72 8 74 16Q76 24 78 10Q86 20 82 38" fill="rgba(255,100,20,0.20)"/>`,
        front: `${E(26,12,6,'rgba(255,190,80,0.65)','lsf-ember-1')}${E(112,10,5,'rgba(255,180,70,0.58)','lsf-ember-3')}${E(122,26,4,'rgba(255,140,40,0.68)','lsf-ember-5')}${E(18,24,4,'rgba(255,150,50,0.64)','lsf-ember-4')}${E(16,48,3.5,'rgba(255,120,26,0.56)','lsf-ember-2')}${E(124,52,3.5,'rgba(255,130,30,0.52)','lsf-ember-3')}${E(20,68,3,'rgba(255,100,18,0.46)','lsf-ember-5')}${E(120,70,3,'rgba(255,110,20,0.42)','lsf-ember-1')}${K('M24 8L25 2L26 8L32 9L26 10L25 16L24 10L18 9Z','rgba(255,210,90,0.78)','lsf-ember-2')}${K('M110 10L111 5L112 10L117 11L112 12L111 17L110 12L105 11Z','rgba(255,200,80,0.70)','lsf-ember-4')}` };
      case 7: return {
        behind: `<ellipse cx="70" cy="60" rx="64" ry="62" fill="rgba(255,80,10,0.14)"/><circle cx="70" cy="48" r="34" fill="none" stroke="rgba(255,150,50,0.32)" stroke-width="4"/><circle cx="70" cy="48" r="46" fill="none" stroke="rgba(255,80,10,0.16)" stroke-width="2"/><path d="M52 38Q44 16 54 4Q56 22 60 12Q62 4 66 16Q68 4 70 14Q72 4 74 16Q78 4 80 12Q84 22 86 4Q96 16 88 38" fill="rgba(255,90,10,0.30)"/><path d="M56 38Q50 22 57 14Q60 26 64 18Q68 8 70 20Q72 8 76 18Q80 26 83 14Q90 22 84 38" fill="rgba(255,140,30,0.20)"/>`,
        front: `${E(22,10,6.5,'rgba(255,200,90,0.78)','lsf-ember-1')}${E(116,8,5.5,'rgba(255,190,80,0.70)','lsf-ember-3')}${E(124,22,5,'rgba(255,150,40,0.76)','lsf-ember-5')}${E(16,20,5,'rgba(255,160,50,0.72)','lsf-ember-4')}${E(12,44,4,'rgba(255,120,26,0.64)','lsf-ember-2')}${E(128,48,4,'rgba(255,130,30,0.60)','lsf-ember-3')}${E(14,66,3.5,'rgba(255,100,18,0.54)','lsf-ember-5')}${E(126,68,3.5,'rgba(255,110,22,0.50)','lsf-ember-1')}${E(28,8,3,'rgba(255,230,110,0.72)','lsf-ember-2')}${E(110,10,3,'rgba(255,220,100,0.66)','lsf-ember-4')}${K('M20 6L21 0L22 6L28 7L22 8L21 14L20 8L14 7Z','rgba(255,220,100,0.84)','lsf-ember-2')}${K('M108 8L109 3L110 8L115 9L110 10L109 15L108 10L103 9Z','rgba(255,210,90,0.76)','lsf-ember-4')}` };
      case 8: return {
        behind: `<ellipse cx="70" cy="60" rx="68" ry="65" fill="rgba(255,60,0,0.16)"/><circle cx="70" cy="48" r="38" fill="none" stroke="rgba(255,160,50,0.42)" stroke-width="5"/><circle cx="70" cy="48" r="52" fill="none" stroke="rgba(255,80,0,0.18)" stroke-width="3"/><path d="M44 40Q32 8 46-4Q48 16 54 6Q56-2 60 14Q62 2 66 16Q68-2 70 12Q72-2 74 16Q78 2 80 14Q84-2 86 6Q92 16 94-4Q108 8 96 40" fill="rgba(255,70,0,0.38)"/><path d="M50 40Q42 18 50 8Q54 24 58 14Q62 6 66 18Q68 6 70 16Q72 6 74 18Q78 6 82 14Q86 24 90 8Q98 18 90 40" fill="rgba(255,140,30,0.26)"/><path d="M56 40Q52 26 56 18Q60 28 64 20Q67 12 70 22Q73 12 76 20Q80 28 84 18Q88 26 84 40" fill="rgba(255,190,70,0.16)"/>`,
        front: `${E(18,8,7,'rgba(255,210,100,0.88)','lsf-ember-1')}${E(118,6,6,'rgba(255,200,90,0.80)','lsf-ember-3')}${E(126,18,5.5,'rgba(255,160,40,0.84)','lsf-ember-5')}${E(14,16,5.5,'rgba(255,170,50,0.80)','lsf-ember-4')}${E(10,40,4.5,'rgba(255,130,26,0.72)','lsf-ember-2')}${E(130,44,4.5,'rgba(255,140,30,0.68)','lsf-ember-3')}${E(12,64,4,'rgba(255,100,16,0.62)','lsf-ember-5')}${E(128,66,4,'rgba(255,110,20,0.58)','lsf-ember-1')}${E(24,6,3.5,'rgba(255,240,130,0.80)','lsf-ember-1')}${E(114,8,3.5,'rgba(255,240,120,0.74)','lsf-ember-4')}${K('M16 4L17-2L18 4L24 5L18 6L17 12L16 6L10 5Z','rgba(255,230,110,0.90)','lsf-ember-2')}${K('M112 6L113 1L114 6L119 7L114 8L113 13L112 8L107 7Z','rgba(255,220,100,0.82)','lsf-ember-4')}` };
      default: return { // LEGENDARY 10h+
        behind: `<ellipse cx="70" cy="65" rx="70" ry="68" fill="rgba(255,50,0,0.18)"/><circle cx="70" cy="48" r="42" fill="none" stroke="rgba(255,200,70,0.52)" stroke-width="6"/><circle cx="70" cy="48" r="56" fill="none" stroke="rgba(255,100,0,0.26)" stroke-width="4"/><circle cx="70" cy="48" r="66" fill="none" stroke="rgba(255,60,0,0.12)" stroke-width="2"/><path d="M36 42Q18 4 38-10Q40 12 48 0Q50-8 55 12Q57-2 62 14Q64-4 70 8Q76-4 78 14Q83-2 85 12Q90-8 102 0Q110 12 104-10Q124 4 104 42" fill="rgba(255,60,0,0.44)"/><path d="M44 42Q30 14 44 2Q48 18 54 8Q58 0 64 16Q66 4 70 14Q74 4 76 16Q82 0 86 8Q92 18 96 2Q110 14 96 42" fill="rgba(255,140,30,0.32)"/><path d="M52 42Q44 24 52 12Q56 28 60 18Q64 10 70 22Q76 10 80 18Q84 28 88 12Q96 24 88 42" fill="rgba(255,200,80,0.20)"/><path d="M60 22L62 12L64 22L66 14L68 22L70 8L72 22L74 14L76 22L78 12L80 22" stroke="rgba(255,220,80,0.72)" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`,
        front: `${E(14,6,7.5,'rgba(255,230,110,0.92)','lsf-ember-1')}${E(122,4,6.5,'rgba(255,220,100,0.84)','lsf-ember-3')}${E(128,14,6,'rgba(255,180,50,0.88)','lsf-ember-5')}${E(12,14,6,'rgba(255,190,60,0.84)','lsf-ember-4')}${E(8,38,5,'rgba(255,140,30,0.78)','lsf-ember-2')}${E(132,42,5,'rgba(255,150,40,0.74)','lsf-ember-3')}${E(10,62,4.5,'rgba(255,110,18,0.68)','lsf-ember-5')}${E(130,64,4.5,'rgba(255,120,24,0.64)','lsf-ember-1')}${E(20,4,4,'rgba(255,250,140,0.84)','lsf-ember-1')}${E(118,6,4,'rgba(255,250,130,0.78)','lsf-ember-4')}${E(12,26,3.5,'rgba(255,230,100,0.72)','lsf-ember-2')}${E(128,28,3.5,'rgba(255,220,90,0.66)','lsf-ember-5')}${K('M12 2L13-4L14 2L20 3L14 4L13 10L12 4L6 3Z','rgba(255,240,120,0.94)','lsf-ember-2')}${K('M110 4L111-1L112 4L117 5L112 6L111 11L110 6L105 5Z','rgba(255,230,110,0.86)','lsf-ember-4')}`
      };
    }
  }

  function _lsAvatarSVG(stageIdx) {
    const aura = _lsAuraLayer(stageIdx);
    return `<svg viewBox="0 0 140 128" fill="none" class="ls-av-svg" xmlns="http://www.w3.org/2000/svg">
      ${aura.behind}
      ${_lsNinjaBase()}
      ${aura.front}
    </svg>`;
  }

  function _lsInitParticles() {
    _lsStopParticles();
    const canvas = document.getElementById('ls-particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();

    // Premium ember particles — varied sizes, hues, speeds
    const particles = [];
    const N = 55;
    for (let i = 0; i < N; i++) {
      const big = Math.random() < 0.18; // rare large glows
      particles.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        r:       big ? (Math.random() * 4 + 4) : (Math.random() * 2.4 + 0.5),
        speed:   big ? (Math.random() * 0.22 + 0.06) : (Math.random() * 0.42 + 0.10),
        opacity: Math.random() * 0.5 + 0.08,
        opTarget:Math.random() * 0.6 + 0.15,
        drift:   (Math.random() - 0.5) * 0.30,
        hue:     [28, 33, 38, 45, 18][Math.floor(Math.random() * 5)], // orange/amber palette
        phase:   Math.random() * Math.PI * 2,
        big
      });
    }

    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      for (const p of particles) {
        // Float upward with sinusoidal drift
        p.y -= p.speed;
        p.x += p.drift + Math.sin(frame * 0.016 + p.phase) * 0.22;
        // Smooth opacity breathing toward target
        p.opacity += (p.opTarget - p.opacity) * 0.022;
        if (Math.abs(p.opacity - p.opTarget) < 0.02) p.opTarget = Math.random() * 0.6 + 0.1;

        // Recycle when off-screen
        if (p.y < -16) { p.y = canvas.height + 8; p.x = Math.random() * canvas.width; }
        if (p.x < -16 || p.x > canvas.width + 16) { p.x = Math.random() * canvas.width; }

        ctx.save();
        ctx.globalAlpha = Math.max(0.04, Math.min(0.85, p.opacity));
        const gR = p.big ? p.r * 5 : p.r * 4;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gR);
        grad.addColorStop(0,    `hsla(${p.hue}, 100%, 74%, 1)`);
        grad.addColorStop(0.30, `hsla(${p.hue}, 96%, 58%, 0.65)`);
        grad.addColorStop(0.65, `hsla(${p.hue}, 88%, 42%, 0.22)`);
        grad.addColorStop(1,    `hsla(${p.hue}, 80%, 30%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, gR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      _lsParticleRAF = requestAnimationFrame(draw);
    };
    draw();
  }

  function _lsStopParticles() {
    if (_lsParticleRAF) { cancelAnimationFrame(_lsParticleRAF); _lsParticleRAF = null; }
  }

  // ── Cascading Subject→Chapter→Topic picker for the live overlay ──────────
  function _buildLSPicker(ov, step) {
    const existing = ov.querySelector('.lsf-sub-picker');
    if (existing) existing.remove();
    const subjects = (state.syllabus || []).filter(s => !s._deleted);
    const picker = document.createElement('div');
    picker.className = 'lsf-sub-picker';

    const addTouchClick = (el, fn) => {
      let touched = false;
      el.addEventListener('touchend', (ev) => { ev.preventDefault(); ev.stopPropagation(); touched = true; fn(ev); setTimeout(() => { touched = false; }, 400); }, { passive: false });
      el.addEventListener('click', (ev) => { ev.stopPropagation(); if (!touched) fn(ev); });
    };

    if (step === 'subject' || !step) {
      if (!subjects.length) { toast('Add subjects in the Study tab first', 'info'); return; }
      picker.innerHTML = `
        <div class="lsf-sub-picker-title">Select Subject</div>
        ${subjects.map(s => `<button class="lsf-sub-picker-item${_lsSubjectId === s.id ? ' lsf-sub-picker-active' : ''}" data-sid="${escapeHTML(s.id)}" style="border-left:3px solid ${s.color||'#ff7a1a'}"><span>${escapeHTML(s.name)}</span><span class="lsf-pick-chev">›</span></button>`).join('')}
      `;
      picker.querySelectorAll('button[data-sid]').forEach(btn => {
        addTouchClick(btn, () => {
          const newSub = btn.dataset.sid;
          if (newSub !== _lsSubjectId) { _lsChapterId = null; _lsTopicId = null; }
          _lsSubjectId = newSub;
          const sub = findSubject(_lsSubjectId);
          const chaps = sub && sub.chapters ? sub.chapters.filter(c => !c._deleted) : [];
          if (chaps.length) { _buildLSPicker(ov, 'chapter'); } else { picker.remove(); renderLiveOverlay(); }
        });
      });
    } else if (step === 'chapter') {
      const sub = findSubject(_lsSubjectId);
      const chaps = sub && sub.chapters ? sub.chapters.filter(c => !c._deleted) : [];
      picker.innerHTML = `
        <div class="lsf-sub-picker-nav"><button class="lsf-sub-picker-back" id="lsf-back">‹ ${sub ? escapeHTML(sub.name.slice(0,14)) : 'Back'}</button><span class="lsf-sub-picker-step">Chapter</span></div>
        <button class="lsf-sub-picker-item${!_lsChapterId ? ' lsf-sub-picker-active' : ''}" data-cid="">— All chapters —</button>
        ${chaps.map(c => `<button class="lsf-sub-picker-item${_lsChapterId === c.id ? ' lsf-sub-picker-active' : ''}" data-cid="${escapeHTML(c.id)}"><span>${escapeHTML(c.name)}</span><span class="lsf-pick-chev">›</span></button>`).join('')}
      `;
      addTouchClick(picker.querySelector('#lsf-back'), () => _buildLSPicker(ov, 'subject'));
      picker.querySelectorAll('button[data-cid]').forEach(btn => {
        addTouchClick(btn, () => {
          const newChap = btn.dataset.cid || null;
          if (newChap !== _lsChapterId) _lsTopicId = null;
          _lsChapterId = newChap;
          if (!_lsChapterId) { picker.remove(); renderLiveOverlay(); return; }
          const chap = findChapter(_lsSubjectId, _lsChapterId);
          const tops = chap && chap.topics ? chap.topics.filter(t => !t._deleted) : [];
          if (tops.length) { _buildLSPicker(ov, 'topic'); } else { picker.remove(); renderLiveOverlay(); }
        });
      });
    } else if (step === 'topic') {
      const chap = findChapter(_lsSubjectId, _lsChapterId);
      const tops = chap && chap.topics ? chap.topics.filter(t => !t._deleted) : [];
      picker.innerHTML = `
        <div class="lsf-sub-picker-nav"><button class="lsf-sub-picker-back" id="lsf-back">‹ ${chap ? escapeHTML(chap.name.slice(0,14)) : 'Back'}</button><span class="lsf-sub-picker-step">Topic</span></div>
        <button class="lsf-sub-picker-item${!_lsTopicId ? ' lsf-sub-picker-active' : ''}" data-tid="">— All topics —</button>
        ${tops.map(t => `<button class="lsf-sub-picker-item${_lsTopicId === t.id ? ' lsf-sub-picker-active' : ''}" data-tid="${escapeHTML(t.id)}">${escapeHTML(t.name)}</button>`).join('')}
      `;
      addTouchClick(picker.querySelector('#lsf-back'), () => _buildLSPicker(ov, 'chapter'));
      picker.querySelectorAll('button[data-tid]').forEach(btn => {
        addTouchClick(btn, () => {
          _lsTopicId = btn.dataset.tid || null;
          picker.remove();
          renderLiveOverlay();
        });
      });
    }
    ov.appendChild(picker);
  }

  function renderLiveOverlay() {
    const overlay = document.getElementById('ls-overlay'); if (!overlay) return;
    const elapsed = _lsGetElapsed();
    const storedMin = state.focusStats.minutesByDate[todayKey()] || 0;
    const todaySecs = storedMin * 60 + elapsed;
    const subStoredMin = _lsSubjectId ? (state.focusStats.minutesBySubject[_lsSubjectId] || 0) : 0;
    const subSecs = subStoredMin * 60 + elapsed;
    const curSub = _lsSubjectId ? findSubject(_lsSubjectId) : null;
    const curChap = (curSub && _lsChapterId) ? findChapter(_lsSubjectId, _lsChapterId) : null;
    const curTopic = (curChap && _lsTopicId) ? findTopic(_lsSubjectId, _lsChapterId, _lsTopicId) : null;
    const xpTot = (state.xp && state.xp.total) || 0;
    const lvInfo = gamificationManager.calculateLevel(xpTot);
    const streak = (state.streak && state.streak.count) || 0;
    const mult = _isBoosterActive() ? 2 : 1;
    const subjectLog = Object.entries(state.focusStats.minutesBySubject || {})
      .map(([sid, mins]) => { const s = findSubject(sid); return s ? { id: sid, name: s.name, color: s.color || '#ff7a1a', mins: mins + (sid === _lsSubjectId ? Math.round(elapsed / 60) : 0) } : null; })
      .filter(Boolean).sort((a, b) => b.mins - a.mins).slice(0, 5);
    if (!subjectLog.length && curSub) subjectLog.push({ id: curSub.id, name: curSub.name, color: curSub.color || '#ff7a1a', mins: Math.round(elapsed / 60) });
    const logTotalMins = Math.max(1, subjectLog.reduce((a, b) => a + b.mins, 0));
    overlay.className = _lsRunning ? 'ls-running' : 'ls-paused';
    const avNick = escapeHTML((state.profile && state.profile.name) ||
      (typeof firebase !== 'undefined' && firebase.auth().currentUser && firebase.auth().currentUser.displayName) || '');
    const avStage = _lsGetAvatarStage(elapsed);
    if (_lsCurrentAvatarStage < 0) _lsCurrentAvatarStage = avStage;
    overlay.innerHTML = `
    <canvas class="lsf-particle-canvas" id="ls-particles"></canvas>
    <div class="lsf-wrap">
      <div class="lsf-top-bar">
        <span class="lsf-mode-label">Focusing</span>
        <button class="lsf-exit-btn" data-act="ls-exit">✕ Exit</button>
      </div>
      <div class="lsf-clock-area">
        <div class="lsf-elapsed${!_lsRunning ? ' lsf-paused-clock' : ''}" id="ls-elapsed">${_secsToHMS(elapsed)}</div>
        ${!_lsRunning ? '<div class="lsf-paused-badge">⏸ Paused</div>' : ''}
      </div>
      <div class="lsf-split-row">
        <div class="lsf-split-item">
          <div class="lsf-split-label">${curSub ? escapeHTML(curSub.name.toUpperCase().slice(0, 14)) : 'SUBJECT'}</div>
          <div class="lsf-split-val" id="ls-sub-val">${_secsToHMS(subSecs)}</div>
        </div>
        <div class="lsf-split-div"></div>
        <div class="lsf-split-item">
          <div class="lsf-split-label">TODAY</div>
          <div class="lsf-split-val" id="ls-today-val">${_secsToHMS(todaySecs)}</div>
        </div>
      </div>
      <div class="lsf-illustration ls-av-wrap" id="ls-av-wrap">
        ${_lsAvatarSVG(avStage)}
        <div class="ls-av-info">
          ${avNick ? `<span class="ls-av-name">${avNick}</span>` : ''}
          <span class="ls-av-stage-lbl" id="ls-av-stage">${_LS_AV_LABELS[avStage]}</span>
        </div>
      </div>
      <div class="lsf-subject-row" id="ls-sub-row">
        <span class="lsf-sub-icon">📚</span>
        <div class="lsf-sub-info">
          ${curSub
            ? `<span class="lsf-sub-name">${escapeHTML(curSub.name)}</span>${curChap ? `<span class="lsf-sub-breadcrumb">${escapeHTML(curChap.name)}${curTopic ? ' › ' + escapeHTML(curTopic.name) : ''}</span>` : ''}`
            : `<span class="lsf-sub-name lsf-sub-placeholder">Tap to select subject</span>`}
        </div>
        ${curSub ? `<span class="lsf-sub-time" id="ls-sub-row-time">${_secsToHMS(subSecs)}</span>` : ''}
        <span class="lsf-sub-chev">›</span>
      </div>
      <div class="lsf-play-wrap">
        <button class="lsf-play-btn" id="ls-play-btn" data-act="ls-play-pause">
          <span class="lsf-play-icon">${_lsRunning ? '⏸' : '▶'}</span>
          <span class="lsf-ripple-ring" id="ls-ripple"></span>
        </button>
      </div>
    </div>`;

    // Use the cascading picker
    const _openPickerFn = () => {
      const ov = document.getElementById('ls-overlay'); if (!ov) return;
      const existing = ov.querySelector('.lsf-sub-picker');
      if (existing) { existing.remove(); return; }
      _buildLSPicker(ov, 'subject');
    };
    window._lsOpenPicker = _openPickerFn;

    // Attach click + touchend directly to the subject row for reliable mobile taps
    const subRowEl = overlay.querySelector('#ls-sub-row');
    if (subRowEl) {
      let _subRowTouched = false;
      subRowEl.addEventListener('touchend', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _subRowTouched = true;
        _openPickerFn();
        setTimeout(() => { _subRowTouched = false; }, 400);
      }, { passive: false });
      subRowEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (_subRowTouched) return;
        _openPickerFn();
      });
    }

    requestAnimationFrame(() => _lsInitParticles());
  }

  function formatFocusTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

  // For long sessions (> 60 min) the ring cycles per hour so progress stays visible.
  // Returns the fill fraction (0–1) to use for strokeDashoffset.
  function _ringFillPct(sec, total) {
    if (total <= 3600) return Math.max(0, Math.min(1, sec / total));
    const elapsed = Math.max(0, total - sec);
    return 1 - (elapsed % 3600) / 3600;
  }

  // Returns an extra CSS class for the time display based on character count.
  function _timeSizeClass(str) {
    if (str.length >= 8) return ' frt-xxs';
    if (str.length >= 7) return ' frt-xs';
    if (str.length >= 6) return ' frt-sm';
    return '';
  }

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
  // Tracks active oscillators so we can stop them immediately on demand
  let _activeOscillators = [];

  // Beautiful 3-bell chime via Web Audio API — no file needed
  function _playChime(vol) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const freqs = [523.25, 659.25, 783.99]; // C5 → E5 → G5
    freqs.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.38;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const osc2  = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc.type  = 'sine';  osc.frequency.setValueAtTime(freq, t);
      osc2.type = 'sine';  osc2.frequency.setValueAtTime(freq * 2.756, t);
      const v = (vol !== undefined ? vol : 0.72);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(v, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(v * 0.22, t + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc.connect(gain);   gain.connect(ctx.destination);
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc.start(t);  osc.stop(t + 2.8);
      osc2.start(t); osc2.stop(t + 1.6);
      _activeOscillators.push(osc, osc2);
    });
    // Auto-clean refs after chime fully fades
    setTimeout(() => { _activeOscillators = []; }, 3500);
  }

  function stopOvertimeAlarm() {
    if (_alarmStopTimer)    { clearTimeout(_alarmStopTimer);    _alarmStopTimer = null; }
    // Stop any scheduled oscillator nodes immediately
    _activeOscillators.forEach(o => { try { o.stop(); } catch (_) {} });
    _activeOscillators = [];
    _alarmAudio = null;
  }

  // Play once — 5 s natural fade, stops instantly if timer is killed
  function playOvertimeAlarm() {
    stopOvertimeAlarm();
    resumeAudioContext();
    _playChime(0.80);
    // Auto-silence after 5 s even if nothing stops it
    _alarmStopTimer = setTimeout(() => stopOvertimeAlarm(), 5000);
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
        try { if (window._socialOnStudyTimeUpdate) window._socialOnStudyTimeUpdate(state.focusStats.minutesByDate[todayKey()]); } catch(_) {}
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
    // Keep social.js isStudying() in sync
    window._focusActive = focusRunning && focusMode === 'work';
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
    if (el) {
      el.textContent = formatted;
      el.className = 'focus-ring-time' + _timeSizeClass(formatted);
    }
    const ring = document.getElementById('focus-ring-circle');
    if (ring) { const r = 96, c = 2 * Math.PI * r; ring.style.strokeDashoffset = (c * (1 - _ringFillPct(focusSeconds, total))).toFixed(2); }
    const fsEl = document.getElementById('fs-time-display');
    if (fsEl) {
      fsEl.textContent = formatted;
      el.className = 'fs-time' + _timeSizeClass(formatted);
    }
    const fsRing = document.getElementById('fs-ring-circle');
    if (fsRing) { const rr = 120, cc = 2 * Math.PI * rr; fsRing.style.strokeDashoffset = (cc * (1 - _ringFillPct(focusSeconds, total))).toFixed(2); }
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
      try { if (window._socialOnStudyTimeUpdate) window._socialOnStudyTimeUpdate(state.focusStats.minutesByDate[todayStr]); } catch(_) {}
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
          if (task.type === 'auto') { const t = findTopic(task.subId, task.chId, task.tId); if (t) { t.done = true; bumpActivity(); trackCompletion(`topic:${task.subId}:${task.chId}:${task.tId}`, true); onTopicDoneChanged(task.subId, task.chId, task.tId, true); saveState(); renderAll(); } }
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
    window._focusActive = false;
    const overlay = document.getElementById('fs-overlay'); if (overlay) overlay.remove();
    document.title = 'Syllabus Tracker';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    lockPortrait();
    // Notify social.js of focus end so group stats update
    if (typeof window._socialFocusUpdate === 'function') {
      try { window._socialFocusUpdate(); } catch(_) {}
    }
    renderFocus();
  }
  function _genFsParticles() {
    const out = [];
    // Reduce particle count on mobile to lower GPU load and heat
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    const starCount  = isMobile ? 4 : 7;
    const blobCount  = isMobile ? 2 : 5;
    // Small bright stars (drift fast across)
    for (let i = 0; i < starCount; i++) {
      const sz   = (1.5 + Math.random() * 3).toFixed(1);
      const top  = (4  + Math.random() * 82).toFixed(1);
      const dur  = (14 + Math.random() * 16).toFixed(1);
      const del  = -(Math.random() * 28).toFixed(1);
      const dy   = ((Math.random() - 0.5) * 60).toFixed(0);
      const op   = (0.35 + Math.random() * 0.45).toFixed(2);
      out.push(`<div class="fs-particle" style="width:${sz}px;height:${sz}px;top:${top}%;--drift-y:${dy}px;animation-duration:${dur}s;animation-delay:${del}s;--op:${op}"></div>`);
    }
    // Larger soft cloud blobs (drift slow)
    for (let i = 0; i < blobCount; i++) {
      const sz   = (28 + Math.random() * 55).toFixed(1);
      const top  = (5  + Math.random() * 80).toFixed(1);
      const dur  = (24 + Math.random() * 22).toFixed(1);
      const del  = -(Math.random() * 40).toFixed(1);
      const dy   = ((Math.random() - 0.5) * 80).toFixed(0);
      const op   = (0.02 + Math.random() * 0.045).toFixed(3);
      out.push(`<div class="fs-particle" style="width:${sz}px;height:${sz}px;top:${top}%;--drift-y:${dy}px;animation-duration:${dur}s;animation-delay:${del}s;--op:${op}"></div>`);
    }
    return out.join('');
  }

  function renderFullSession() {
    const overlay = document.getElementById('fs-overlay'); if (!overlay) return;
    const total = customDurations[focusMode] * 60;
    const r = 120, c = 2 * Math.PI * r, off = c * (1 - _ringFillPct(focusSeconds, total));
    const isBreak = focusMode !== 'work';
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

        <!-- ── Glowing ring timer (grid-area: ring) ── -->
        <div class="fs-timer-wrap">
          <svg class="fs-ring-svg" viewBox="0 0 290 290" aria-hidden="true">
            <defs><linearGradient id="fsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${isBreak ? '#34d399' : '#38bdf8'}"/><stop offset="100%" stop-color="${isBreak ? '#86efac' : '#a78bfa'}"/></linearGradient></defs>
            <circle class="fs-ring-track" cx="145" cy="145" r="${r}"/>
            <circle class="fs-ring-fill" id="fs-ring-circle" cx="145" cy="145" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
          </svg>
          <div class="fs-ring-center">
            <div class="fs-time${focusOvertime ? ' fs-overtime-text' : _timeSizeClass(_fsTimeStr)}" id="fs-time-display">${_fsTimeStr}</div>
            <div class="fs-ring-sub">${_fsRingSub}</div>
          </div>
        </div>

        <!-- ── Vertical controls: Play · Sound · Landscape · Exit (grid-area: ctrl) ── -->
        <div class="fs-ctrl-col">
          <button class="fs-ctrl-btn fs-main-btn${focusOvertime ? ' fs-overtime-btn' : ''}" data-act="fs-toggle">${focusRunning ? '⏸' : (focusOvertime ? '⏹' : '▶')}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-sound-btn${ambientMode !== 'none' ? ' fs-sound-btn--on' : ''}" data-act="fs-cycle-ambient" title="Cycle ambient sound">${ambientIcon}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-orient-btn" data-act="fs-toggle-landscape" title="Toggle landscape">${orientIcon}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-exit-btn" data-act="exit-full-session" title="Exit">✕</button>
        </div>

        <!-- ── Motivation quote (grid-area: moti) ── -->
        <div class="fs-motivation-box">${escapeHTML(_fsMotiQuote)}</div>

        <!-- ── Footer: swipe hint (grid-area: foot) ── -->
        <div class="fs-footer">
          <div class="fs-hint">${('ontouchstart' in window) ? 'Swipe to exit' : 'Press Esc to exit'}</div>
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
          saveState(); closeModal(); renderFocus();
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
      <div class="vp-header" id="vp-header">
        <button class="vp-back-btn" data-act="vp-close" aria-label="Back">${SVG_BACK}</button>
        <div class="vp-header-title">${escapeHTML(item.title)}</div>
        <div id="vp-header-timer" class="vp-header-timer-wrap" style="display:none">
          <span class="vp-header-timer-icon">⏱</span>
          <span id="vp-header-timer-text" class="vp-header-timer-text">0:00</span>
          <button class="vp-header-timer-stop" data-act="vfm-close" title="Stop focus session">✕</button>
        </div>
        <button class="vp-yt-btn vfm-start-vp-btn" data-act="vfm-start" title="Start Focus Mode" aria-label="Focus Mode">⏱</button>
        <button class="vp-yt-btn vp-orient-btn" data-act="vp-toggle-landscape" title="Toggle landscape" aria-label="Toggle landscape">${SVG_ORIENT_LANDSCAPE}</button>
        <a href="${escapeHTML(item.url)}" target="_blank" rel="noopener" class="vp-yt-btn" title="Open externally">${SVG_EXTLINK}</a>
      </div>
      <div class="vp-split">
        <div class="vp-main">
          <div class="vp-embed-wrap">
            <iframe id="vp-iframe" src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" title="${escapeHTML(item.title)}" style="pointer-events:auto"></iframe>
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
      `;
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
    _vfmRunning = !(_ytPlayerReady && (_ytPlayerState === 2 || _ytPlayerState === 5 || _ytPlayerState === -1));
    document.getElementById('vfm-overlay')?.remove();
    document.getElementById('vfm-bubble')?.remove();
    // Show compact timer in the player header bar
    const timerWrap = document.getElementById('vp-header-timer');
    if (timerWrap) {
      timerWrap.style.display = 'flex';
      const timerText = document.getElementById('vp-header-timer-text');
      if (timerText) timerText.textContent = _fmtVfm(_vfmRemaining);
    }
    const vpFocusBtn = document.querySelector('.vfm-start-vp-btn');
    if (vpFocusBtn) { vpFocusBtn.style.display = 'none'; }
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
    const timerWrap = document.getElementById('vp-header-timer');
    if (timerWrap) timerWrap.style.display = 'none';
    const vpFocusBtn = document.querySelector('.vfm-start-vp-btn');
    if (vpFocusBtn) { vpFocusBtn.style.display = ''; vpFocusBtn.title = 'Start Focus Mode'; }
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
    // Update floating overlay (shown only on completion)
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
    // Update compact header timer
    const headerTimerText = document.getElementById('vp-header-timer-text');
    if (headerTimerText) {
      headerTimerText.textContent = _fmtVfm(_vfmRemaining);
      headerTimerText.style.color = !_vfmRunning ? '#f59e0b' : '';
    }
  }

  function onVfmComplete() {
    _vfmComplete = true; _vfmRunning = false;
    clearInterval(_vfmTimer); _vfmTimer = null;
    // Hide header timer pill, show full completion overlay
    const timerWrap = document.getElementById('vp-header-timer');
    if (timerWrap) timerWrap.style.display = 'none';
    const vpFocusBtn = document.querySelector('.vfm-start-vp-btn');
    if (vpFocusBtn) vpFocusBtn.style.display = '';
    // Show the completion overlay
    document.getElementById('vfm-overlay')?.remove();
    document.getElementById('vfm-bubble')?.remove();
    const el = document.createElement('div');
    el.id = 'vfm-overlay';
    el.innerHTML = _vfmOverlayHTML();
    document.body.appendChild(el);
    _bindVfmDrag(el);
    updateVfmDisplay();
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
    // Save focus stats
    const todayStr = todayKey();
    const mins = Math.round(_vfmDuration / 60);
    state.focusStats.minutesByDate = state.focusStats.minutesByDate || {};
    state.focusStats.sessions      = state.focusStats.sessions || {};
    state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + mins;
    try { if (window._socialOnStudyTimeUpdate) window._socialOnStudyTimeUpdate(state.focusStats.minutesByDate[todayStr]); } catch(_) {}
    state.focusStats.sessions[todayStr]      = (state.focusStats.sessions[todayStr] || 0) + 1;
    state.focusStats.videoMinutes = state.focusStats.videoMinutes || {};
    state.focusStats.videoMinutes[todayStr]  = (state.focusStats.videoMinutes[todayStr]  || 0) + mins;
    awardXP(mins, todayStr);
    bumpActivity();
    checkBadges({ sessionMinutes: mins });
    saveState();
    _updateLiveStats();
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
    _vpResetAutoHide();
  }

  function _vpResetAutoHide() {
    const overlay = document.getElementById('vp-overlay');
    if (!overlay) return;
    overlay.classList.remove('vp-hud-hidden');
    clearTimeout(_vpHudTimer);
    _vpHudTimer = setTimeout(() => {
      const el = document.getElementById('vp-overlay');
      if (el) el.classList.add('vp-hud-hidden');
    }, 3000);
  }

  function _vpInitPlayer(overlay) {
    _vpCinema = false;
    _vpHudTimer = null;
    const onActivity = () => _vpResetAutoHide();
    overlay.addEventListener('mousemove', onActivity, { passive: true });
    overlay.addEventListener('touchstart', onActivity, { passive: true });
    overlay.addEventListener('click', onActivity, { passive: true });
    // Start auto-hide immediately
    _vpResetAutoHide();
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
        case 'p': case 'P': _vpTryPiP(); break;
      }
    };
    document.addEventListener('keydown', _vpKeyHandler);
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

  // ── Video Pinch-to-Zoom & Pan ───────────────────────────────
  function _initVideoZoom(wrapEl) {
    if (!wrapEl) return;
    const iframe = wrapEl.querySelector('iframe');
    if (!iframe) return;

    // Transparent layer on top of iframe — pointer-events:none at 1x so YouTube controls work;
    // enabled only when zoomed in (for panning) or when a 2-finger pinch is detected.
    const layer = document.createElement('div');
    layer.id = 'vp-zoom-layer';
    wrapEl.appendChild(layer);

    // State
    let scale = 1, tx = 0, ty = 0;
    let isPinching = false;
    let pinchStartDist = 0, pinchStartScale = 1;
    let pinchStartTx = 0, pinchStartTy = 0, pinchMidX = 0, pinchMidY = 0;
    let lastTapTime = 0;
    let hudTimer = null, panRafId = null;
    let panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;

    function applyTransform(animate) {
      if (animate) {
        iframe.style.transition = 'transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)';
        setTimeout(() => { iframe.style.transition = ''; }, 310);
      } else {
        iframe.style.transition = '';
      }
      iframe.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
      // Enable layer for panning only when zoomed; otherwise let touches reach the iframe
      layer.style.pointerEvents = scale > 1.02 ? 'auto' : 'none';
    }

    function clampTranslation() {
      const maxTx = wrapEl.offsetWidth  * (scale - 1) / 2;
      const maxTy = wrapEl.offsetHeight * (scale - 1) / 2;
      tx = Math.max(-maxTx, Math.min(maxTx, tx));
      ty = Math.max(-maxTy, Math.min(maxTy, ty));
    }

    function showHud(s) {
      const vpEl = document.getElementById('vp-overlay'); if (!vpEl) return;
      let hud = document.getElementById('vp-zoom-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'vp-zoom-hud';
        vpEl.appendChild(hud);
      }
      hud.textContent = Math.round(s * 100) + '%';
      hud.className = 'vp-zoom-hud-visible';
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => { if (hud) hud.className = ''; }, 1100);
    }

    function resetZoom(animate) {
      scale = 1; tx = 0; ty = 0;
      applyTransform(animate !== false);
      const hud = document.getElementById('vp-zoom-hud');
      if (hud) hud.className = '';
    }

    // ── Pinch detection via capture-phase on the wrap element.
    // Because the iframe absorbs touches in its own document, we intercept in the
    // capture phase of the parent — this fires before the event reaches the iframe.
    wrapEl.addEventListener('touchstart', function(e) {
      if (e.touches.length >= 2) {
        // 2-finger → always intercept for pinch; stop iframe receiving it
        e.preventDefault();
        isPinching = true;
        layer.style.pointerEvents = 'auto';
        const t0 = e.touches[0], t1 = e.touches[1];
        pinchStartDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartScale = scale;
        pinchStartTx = tx; pinchStartTy = ty;
        const rect = wrapEl.getBoundingClientRect();
        // Pinch midpoint in container-centre coordinates (so math stays correct at any scale)
        pinchMidX = ((t0.clientX + t1.clientX) / 2) - rect.left  - rect.width  / 2;
        pinchMidY = ((t0.clientY + t1.clientY) / 2) - rect.top   - rect.height / 2;
      } else if (e.touches.length === 1 && scale <= 1.02) {
        // Single tap at 1x — track timing for a double-tap-to-reset attempt at 1x
        const now = Date.now();
        lastTapTime = (now - lastTapTime < 280) ? 0 : now;
      }
    }, { passive: false, capture: true });

    wrapEl.addEventListener('touchmove', function(e) {
      if (!isPinching || e.touches.length < 2) return;
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist     = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const newScale = Math.max(1, Math.min(4, pinchStartScale * (dist / pinchStartDist)));
      // Keep the pinch midpoint visually stationary while scaling
      const ratio = newScale / pinchStartScale;
      tx = pinchMidX * (1 - ratio) + pinchStartTx * ratio;
      ty = pinchMidY * (1 - ratio) + pinchStartTy * ratio;
      scale = newScale;
      clampTranslation();
      applyTransform(false);
      showHud(scale);
    }, { passive: false, capture: true });

    wrapEl.addEventListener('touchend', function(e) {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        if (scale < 1.08) resetZoom(true); // snap back if barely zoomed
      }
    }, { passive: true, capture: true });

    // ── Pan & double-tap (layer is active only when scale > 1) ──
    layer.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1 || isPinching) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastTapTime < 280 && lastTapTime !== 0) {
        // Double-tap → smooth reset to 1×
        resetZoom(true);
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      panStartX  = e.touches[0].clientX; panStartY  = e.touches[0].clientY;
      panStartTx = tx;                   panStartTy = ty;
    }, { passive: false });

    layer.addEventListener('touchmove', function(e) {
      if (e.touches.length !== 1 || isPinching) return;
      e.preventDefault();
      const nx = panStartTx + (e.touches[0].clientX - panStartX);
      const ny = panStartTy + (e.touches[0].clientY - panStartY);
      if (panRafId !== null) cancelAnimationFrame(panRafId);
      panRafId = requestAnimationFrame(() => {
        panRafId = null;
        tx = nx; ty = ny;
        clampTranslation();
        applyTransform(false);
      });
    }, { passive: false });

    layer.addEventListener('touchend', function() {
      if (panRafId !== null) { cancelAnimationFrame(panRafId); panRafId = null; }
    }, { passive: true });

    // Expose a reset handle on the element so switchVideoInPlayer can call it
    wrapEl._zoomReset = resetZoom;
  }

  function _resetVideoZoom() {
    const wrap = document.querySelector('#vp-overlay .vp-embed-wrap');
    if (wrap && typeof wrap._zoomReset === 'function') wrap._zoomReset(false);
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
    _initVideoZoom(el.querySelector('.vp-embed-wrap'));
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

    // Reset zoom when switching videos
    _resetVideoZoom();

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

    // ── Study Efficiency Graph computations ───────────────────────────────────
    const _buildEffData = keys => keys.map(k => {
      const fMin = state.focusStats.minutesByDate[k] || 0;
      const fHrs = parseFloat((fMin / 60).toFixed(2));
      const comp = (state.focusStats.topicsCompletedByDate && state.focusStats.topicsCompletedByDate[k]) || 0;
      const prod = fHrs > 0 ? parseFloat((comp / fHrs).toFixed(2)) : 0;
      const lbl  = new Date(k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
      return { k, label: lbl, focusHrs: fHrs, completions: comp, productivity: prod };
    });
    const effWeekData  = _buildEffData(buildDateRange(7));
    const effMonthData = _buildEffData(buildDateRange(30));
    _effData = { weekly: effWeekData, monthly: effMonthData };

    let effBestDay = null, effBestScore = 0;
    effMonthData.forEach(d => { if (d.focusHrs >= 0.25 && d.productivity > effBestScore) { effBestScore = d.productivity; effBestDay = d; } });

    const _subMinsEff = state.focusStats.minutesBySubject || {};
    let effMostEffSub = null, effMostEffScore = 0;
    for (const sub of state.subjects) {
      let done = 0;
      for (const ch of sub.chapters) for (const t of ch.topics) { if (t.done) done++; }
      const hrs = (_subMinsEff[sub.id] || 0) / 60;
      const eff = hrs > 0.1 ? done / hrs : 0;
      if (eff > effMostEffScore) { effMostEffScore = eff; effMostEffSub = sub; }
    }
    const effMostEffSubName = effMostEffSub ? effMostEffSub.name : null;
    const effAvgSpeed = totalFocusMin > 0 ? parseFloat((doneTopics / (totalFocusMin / 60)).toFixed(1)) : 0;
    const effFocusDays30 = buildDateRange(30).filter(k => (state.focusStats.minutesByDate[k] || 0) > 0).length;
    const effConsistencyPct = Math.round((effFocusDays30 / 30) * 100);
    const effAiInsight = effBestDay
      ? `${new Date(effBestDay.k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })} showed your highest efficiency with ${effBestScore.toFixed(1)}x completion rate.`
      : totalFocusMin > 0
        ? 'Keep logging study sessions to unlock your efficiency profile!'
        : 'Start your first focus session to see your efficiency analytics here.';

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

      <div class="stats-section-head" style="margin-top:22px"><span>📊 Study Efficiency</span><span class="stats-section-meta">Focus vs Completion</span></div>
      <div class="eff-graph-card" id="eff-graph-card">
        <div class="eff-graph-header">
          <div>
            <div class="eff-graph-title">Study Efficiency Graph</div>
            <div class="eff-graph-sub">Focus vs Completion Ratio</div>
          </div>
          <span class="eff-live-badge">LIVE</span>
        </div>
        <div class="eff-toggle-row">
          <button class="eff-toggle-btn eff-toggle-active" id="eff-btn-weekly" data-act="eff-toggle" data-mode="weekly">Weekly</button>
          <button class="eff-toggle-btn" id="eff-btn-monthly" data-act="eff-toggle" data-mode="monthly">Monthly</button>
        </div>
        <div class="eff-graph-wrap"><canvas id="eff-graph-canvas"></canvas></div>
        <div class="eff-ai-insight">
          <span class="eff-ai-icon">✦</span>
          <span class="eff-ai-text">${escapeHTML(effAiInsight)}</span>
        </div>
        <div class="eff-metrics-grid">
          <div class="eff-metric-card">
            <div class="eff-metric-icon">🏆</div>
            <div class="eff-metric-val" style="font-size:${effMostEffSubName && effMostEffSubName.length > 9 ? '11' : '14'}px">${effMostEffSubName ? escapeHTML(effMostEffSubName) : '—'}</div>
            <div class="eff-metric-lbl">Most Efficient Subject</div>
          </div>
          <div class="eff-metric-card">
            <div class="eff-metric-icon">⚡</div>
            <div class="eff-metric-val" style="color:#a855f7">${effAvgSpeed}<span style="font-size:10px;color:rgba(148,163,184,0.6);font-weight:600"> /hr</span></div>
            <div class="eff-metric-lbl">Topics / Hour</div>
          </div>
          <div class="eff-metric-card">
            <div class="eff-metric-icon">🎯</div>
            <div class="eff-metric-val" style="color:#4ade80">${effConsistencyPct}%</div>
            <div class="eff-metric-lbl">Focus Consistency (30d)</div>
          </div>
          <div class="eff-metric-card">
            <div class="eff-metric-icon">🔥</div>
            <div class="eff-metric-val" style="color:#f97316">${effFocusDays30}<span style="font-size:10px;color:rgba(148,163,184,0.6);font-weight:600"> days</span></div>
            <div class="eff-metric-lbl">Active Days (30d)</div>
          </div>
        </div>
        <div class="eff-streak-section">
          <div class="eff-streak-label">14-Day Study Heatmap</div>
          <div class="eff-streak-dots">
            ${buildDateRange(14).map(k => {
              const hasF = (state.focusStats.minutesByDate[k] || 0) > 0;
              const hasA = (state.activity[k] || 0) > 0;
              const cls  = hasF ? 'eff-dot-focus' : hasA ? 'eff-dot-activity' : 'eff-dot-empty';
              const tip  = new Date(k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
              return `<div class="eff-dot ${cls}" title="${tip}"></div>`;
            }).join('')}
          </div>
          <div class="eff-dot-legend">
            <span><div class="eff-dot eff-dot-focus"></div>Focus day</span>
            <span><div class="eff-dot eff-dot-activity"></div>Active</span>
            <span><div class="eff-dot eff-dot-empty"></div>Off day</span>
          </div>
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

  function _initEffChart(data) {
    const canvas = document.getElementById('eff-graph-canvas');
    if (!canvas || !window.Chart) return;
    const prev = Chart.getChart(canvas); if (prev) prev.destroy();
    if (!data || !data.length) return;
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Focus Hours',
            data: data.map(d => parseFloat(d.focusHrs.toFixed(2))),
            borderColor: '#00e5ff',
            backgroundColor: ctx => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 190);
              g.addColorStop(0, 'rgba(0,229,255,0.38)');
              g.addColorStop(1, 'rgba(0,229,255,0.02)');
              return g;
            },
            fill: true, tension: 0.42, borderWidth: 2.5,
            pointBackgroundColor: '#00e5ff', pointBorderColor: '#070f1e', pointBorderWidth: 2,
            pointRadius: 5, pointHoverRadius: 8, yAxisID: 'yLeft'
          },
          {
            label: 'Completions',
            data: data.map(d => d.completions),
            borderColor: '#a855f7',
            backgroundColor: ctx => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 190);
              g.addColorStop(0, 'rgba(168,85,247,0.28)');
              g.addColorStop(1, 'rgba(168,85,247,0.02)');
              return g;
            },
            fill: true, tension: 0.42, borderWidth: 2, borderDash: [5, 3],
            pointBackgroundColor: '#a855f7', pointBorderColor: '#070f1e', pointBorderWidth: 2,
            pointRadius: 4, pointHoverRadius: 7, yAxisID: 'yRight'
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true, position: 'top',
            labels: { color: 'rgba(148,163,184,0.88)', font: { size: 11, weight: '700' }, usePointStyle: true, pointStyleWidth: 8, padding: 14 }
          },
          tooltip: {
            backgroundColor: '#0d1b2a', borderColor: 'rgba(0,229,255,0.35)', borderWidth: 1,
            titleColor: '#e8f4ff', bodyColor: '#94a3b8', padding: 12,
            callbacks: {
              title: ctx => {
                const d = data[ctx[0].dataIndex];
                if (!d) return '';
                return d.k
                  ? new Date(d.k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
                  : d.label;
              },
              label: ctx => {
                const d = data[ctx.dataIndex];
                if (!d) return '';
                if (ctx.dataset.yAxisID === 'yLeft') {
                  const ratio = d.productivity > 0 ? `  ·  ${d.productivity.toFixed(1)}x ratio` : '';
                  return ` 🕐 Focus: ${d.focusHrs.toFixed(1)}h${ratio}`;
                }
                return ` ✅ Completions: ${d.completions}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false }, border: { display: false },
            ticks: { color: 'rgba(148,163,184,0.65)', font: { size: 10, weight: '600' }, maxTicksLimit: 8 }
          },
          yLeft: {
            position: 'left', min: 0,
            grid: { color: 'rgba(0,229,255,0.07)' }, border: { display: false },
            ticks: { color: 'rgba(0,229,255,0.65)', font: { size: 10 }, maxTicksLimit: 5, callback: v => v + 'h' }
          },
          yRight: {
            position: 'right', min: 0,
            grid: { display: false }, border: { display: false },
            ticks: { color: 'rgba(168,85,247,0.65)', font: { size: 10 }, maxTicksLimit: 5, precision: 0 }
          }
        }
      }
    });
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

    // ── Study Efficiency Graph chart ─────────────────────────────────────────
    _effGraphMode = 'weekly';
    _initEffChart(_effData.weekly);
  }

  // ========== Settings Modal ==========
  function _notifPrefRow(key, label, desc) {
    const on = state.notificationPrefs[key] !== false;
    return `<div class="stg-row stg-row-sm">
      <div class="stg-row-info">
        <div class="stg-row-ttl">${label}</div>
        ${desc ? `<div class="stg-row-sub">${desc}</div>` : ''}
      </div>
      <label class="switch switch-sm"><input type="checkbox" ${on?'checked':''} data-act="toggle-notif-pref" data-key="${key}"/><span class="slider"></span></label>
    </div>`;
  }

  function modalSettings() {
    const sr = state.smartReminder, mr = state.motivationReminders, mi = state.motivationInterval, perm = notifPermission();
    let permCls = 'warn', permText = 'Permission not yet requested.';
    if (perm === 'unsupported') { permCls = 'warn'; permText = 'Notifications not supported on this browser.'; }
    else if (perm === 'granted')  { permCls = 'ok';   permText = 'Notifications are allowed.'; }
    else if (perm === 'denied')   { permCls = 'err';  permText = 'Notifications are blocked. Enable in browser settings.'; }

    const chips = (which, list) => list.map((t, i) => `
      <span class="stg-chip">
        <button type="button" class="stg-chip-val" data-act="open-time-picker" data-which="${which}" data-i="${i}">${escapeHTML(formatTime12(t))}</button>
        <button type="button" class="stg-chip-del" data-act="del-time-slot" data-which="${which}" data-i="${i}">×</button>
      </span>`).join('');

    const _authUser = _auth ? _auth.currentUser : null;
    const isEmailUser = _authUser && _authUser.providerData && _authUser.providerData.some(p => p.providerId === 'password');

    const acAvatarHTML = state.profile.avatarDataUrl
      ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="stg-av-img" alt=""/>`
      : (_authUser && _authUser.photoURL
          ? `<img src="${escapeHTML(_authUser.photoURL)}" class="stg-av-img" alt=""/>`
          : `<div class="stg-av-init">${(_authUser ? (_authUser.email || '?') : (state.profile.name || '?'))[0].toUpperCase()}</div>`);

    const profAvatarHTML = state.profile.avatarDataUrl
      ? `<img src="${escapeHTML(state.profile.avatarDataUrl)}" class="stg-av-img" alt=""/>`
      : `<div class="stg-av-init">${(state.profile.name || '?')[0].toUpperCase()}</div>`;

    // Use Firebase displayName, fall back to saved profile name
    const displayName = (_authUser && _authUser.displayName) || state.profile.name || '';

    const accountCard = _authUser
      ? `<div class="stg-card stg-card-account">
          <div class="stg-card-lbl">☁️ Account</div>
          <div class="stg-ac-row">
            <div class="stg-ac-av">${acAvatarHTML}</div>
            <div class="stg-ac-info">
              ${displayName ? `<div class="stg-ac-name">${escapeHTML(displayName)}</div>` : ''}
              ${state.customBadgeOwned && state.selectedBadge ? `<div class="stg-ac-badge">${_cmkBadgeHTML(state.selectedBadge)}</div>` : ''}
              <div class="stg-ac-email">${escapeHTML(_authUser.email || 'Anonymous')}</div>
              <div class="stg-sync-pill">☁️ Cloud sync active</div>
            </div>
          </div>
          <div class="stg-btn-row" style="margin-top:12px">
            ${isEmailUser ? `<button class="stg-btn stg-btn-ghost" data-act="change-password">🔑 Change Password</button>` : ''}
            <button class="stg-btn stg-btn-danger-soft" data-act="auth-logout">Sign Out</button>
          </div>
          <button class="stg-btn stg-btn-ghost stg-btn-block" style="margin-top:8px" data-act="restore-from-cloud">🔄 Restore All Data from Cloud</button>
          <button class="stg-btn stg-btn-ghost stg-btn-block" style="margin-top:6px" data-act="export-data-now">💾 Download Local Backup</button>
          <button class="stg-btn stg-btn-ghost stg-btn-block stg-del-btn" style="margin-top:8px" data-act="delete-account">🗑️ Delete Account</button>
        </div>`
      : `<div class="stg-card">
          <div class="stg-card-lbl">☁️ Account</div>
          <p class="stg-muted">Sign in to sync your study data across devices.</p>
          <button class="stg-btn stg-btn-primary stg-btn-block" data-act="auth-show-modal">Sign In / Sign Up</button>
        </div>`;

    const activeAlarms = (state.alarms||[]).filter(a=>a.enabled).length;

    openModal(`<h3>Settings</h3>
      <div class="stg-page">
        ${accountCard}

        <div class="stg-card" id="profile-settings-section">
          <div class="stg-card-lbl">👤 Profile</div>
          <div class="stg-av-row">
            <div class="stg-av-wrap">${profAvatarHTML}</div>
            <div class="stg-av-btns">
              <label class="stg-btn stg-btn-ghost" style="cursor:pointer">📷 Upload Photo<input type="file" accept="image/*" id="avatar-file-input" style="display:none"/></label>
              ${state.profile.avatarDataUrl ? `<button class="stg-btn stg-btn-ghost stg-btn-remove" data-act="remove-avatar">✕ Remove</button>` : ''}
            </div>
          </div>
          <div class="stg-field">
            <label class="stg-lbl">Your Name</label>
            <input class="stg-input" id="set-profile-name" placeholder="Enter your name…" maxlength="40" value="${escapeHTML(state.profile.name)}"/>
          </div>
          <div class="stg-field">
            <label class="stg-lbl">Tagline</label>
            <input class="stg-input" id="set-profile-tagline" placeholder="e.g. CSE'26, BUET" maxlength="60" value="${escapeHTML(state.profile.tagline)}"/>
          </div>
          <button class="stg-btn stg-btn-primary stg-btn-block" style="margin-top:4px" data-act="save-profile">Save Profile</button>
          ${(()=>{
            const eq = state.equippedItems || {};
            const chips = [];
            if (eq.border) {
              const it = SHOP_ITEMS.find(i => i.id === eq.border);
              if (it) chips.push(`<button class="stg-equipped-chip" data-act="stg-unequip" data-iid="${it.id}">${it.icon} ${escapeHTML(it.name)}<span class="stg-eq-x">×</span></button>`);
            }
            if (eq.title) {
              const it = SHOP_ITEMS.find(i => i.id === eq.title);
              if (it) chips.push(`<button class="stg-equipped-chip" data-act="stg-unequip" data-iid="${it.id}">${it.icon} ${escapeHTML(it.name)}<span class="stg-eq-x">×</span></button>`);
            }
            if (eq.aura) {
              const it = SHOP_ITEMS.find(i => i.id === eq.aura);
              if (it) chips.push(`<button class="stg-equipped-chip" data-act="stg-unequip" data-iid="${it.id}">${it.icon} ${escapeHTML(it.name)}<span class="stg-eq-x">×</span></button>`);
            }
            if (state.customBadgeOwned && state.selectedBadge) {
              const bd = _BADGE_DEFS[state.selectedBadge];
              if (bd) chips.push(`<button class="stg-equipped-chip stg-badge-chip" data-act="open-shop" style="border-color:${bd.color};color:${bd.color}">${bd.icon} ${bd.label}<span class="stg-eq-x">✎</span></button>`);
            }
            if (chips.length === 0) return '';
            return `<div class="stg-equipped-lbl">Equipped cosmetics &amp; badges</div><div class="stg-equipped-row">${chips.join('')}</div>`;
          })()}
        </div>

        <div class="stg-card stg-shop-banner" data-act="open-shop" style="cursor:pointer">
          <div class="ssc-glow"></div>
          <div class="ssc-inner">
            <div class="ssc-top-row">
              <div class="ssc-left">
                <div class="ssc-icon">🛍️</div>
                <div class="ssc-info">
                  <div class="ssc-title">XP Shop</div>
                  <div class="ssc-sub">Themes, titles &amp; effects</div>
                </div>
              </div>
              <div class="ssc-bal-wrap">
                <div class="ssc-bal">⚡ ${Math.max(0,((state.xp&&state.xp.total)||0)-((state.xp&&state.xp.spent)||0)).toLocaleString()}</div>
                <div class="ssc-avail">Available</div>
              </div>
            </div>
            <div class="ssc-divider"></div>
            <div class="ssc-bottom-row">
              <div class="ssc-hint">✨ Unlock premium themes &amp; effects</div>
              <div class="ssc-btn">Shop Now →</div>
            </div>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">Daily Study Reminder</div>
          <div class="stg-row">
            <div class="stg-row-info">
              <div class="stg-row-title">Notify when tasks aren't done</div>
              <div class="stg-row-sub">Multiple reminder times supported.</div>
            </div>
            <label class="switch"><input type="checkbox" id="set-sr-toggle" ${sr.enabled ? 'checked' : ''} data-act="toggle-smart-reminder"/><span class="slider"></span></label>
          </div>
          <div class="stg-chips" style="${sr.enabled ? '' : 'opacity:.45;pointer-events:none'}">
            ${sr.times.length ? chips('reminder', sr.times) : '<span class="stg-muted-sm">No times set.</span>'}
            <button type="button" class="stg-chip-add" data-act="open-time-picker" data-which="reminder" data-i="-1">+ Add</button>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">Motivation Notifications</div>
          <div class="stg-row">
            <div class="stg-row-info">
              <div class="stg-row-title">Motivational push messages</div>
              <div class="stg-row-sub">Random quote at each scheduled time.</div>
            </div>
            <label class="switch"><input type="checkbox" id="set-mr-toggle" ${mr.enabled ? 'checked' : ''} data-act="toggle-motivation"/><span class="slider"></span></label>
          </div>
          <div class="stg-chips" style="${mr.enabled ? '' : 'opacity:.45;pointer-events:none'}">
            ${mr.times.length ? chips('motivation', mr.times) : '<span class="stg-muted-sm">No times set.</span>'}
            <button type="button" class="stg-chip-add" data-act="open-time-picker" data-which="motivation" data-i="-1">+ Add</button>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">🔔 Interval Reminders</div>
          <div class="stg-row">
            <div class="stg-row-info">
              <div class="stg-row-title">Motivational boost every few hours</div>
              <div class="stg-row-sub">Smart quotes when you're behind on studying.</div>
            </div>
            <label class="switch"><input type="checkbox" id="set-mi-toggle" ${mi.enabled ? 'checked' : ''} data-act="toggle-motivation-interval"/><span class="slider"></span></label>
          </div>
          <div class="stg-interval" style="${mi.enabled ? '' : 'opacity:.45;pointer-events:none'}">
            <span class="stg-interval-lbl">Every</span>
            <div class="stg-interval-btns">
              ${[1,2,3,4,5,6].map(h => `<button type="button" class="stg-interval-btn${mi.intervalHours===h?' active':''}" data-act="set-motivation-interval" data-h="${h}">${h}h</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">Notifications Status</div>
          <div class="stg-notif-badge stg-notif-${permCls}">${escapeHTML(permText)}</div>
          ${(perm === 'default' || perm === 'denied') ? `<button class="stg-btn stg-btn-primary stg-btn-block" style="margin-top:10px" data-act="sr-request-perm">${perm === 'denied' ? 'Try requesting again' : 'Allow notifications'}</button>` : ''}
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">Notification Preferences</div>
          <p class="stg-muted" style="margin-bottom:10px">Choose what you get notified about.</p>
          <div class="stg-notif-pref-section">
            <div class="stg-notif-pref-group-lbl">Study</div>
            ${_notifPrefRow('studyReminder', 'Study Reminders', 'Daily smart study reminders')}
            ${_notifPrefRow('pomodoroEnd',   'Pomodoro End',    'When your focus session completes')}
            ${_notifPrefRow('dailyGoal',     'Daily Goal',      'Progress toward your daily target')}
            ${_notifPrefRow('streakWarning', 'Streak Warning',  'Don\'t break your study streak')}
            ${_notifPrefRow('taskDeadline',  'Task Deadlines',  'Upcoming task due reminders')}
          </div>
          <div class="stg-notif-pref-section" style="margin-top:8px">
            <div class="stg-notif-pref-group-lbl">Social</div>
            ${_notifPrefRow('groupInvite',       'Group Invites',     'Someone invites you to a room')}
            ${_notifPrefRow('groupMessage',       'Group Messages',    'New messages in your rooms')}
            ${_notifPrefRow('challengeRequest',   'Challenges',        'New group challenge activity')}
            ${_notifPrefRow('mention',            'Mentions',          'When someone @mentions you')}
            ${_notifPrefRow('liveInvite',         'Live Session Invite','Friend starts a live session')}
          </div>
          <div class="stg-notif-pref-section" style="margin-top:8px">
            <div class="stg-notif-pref-group-lbl">Rewards</div>
            ${_notifPrefRow('xpReward',    'XP Rewards',    'When you earn XP bonuses')}
            ${_notifPrefRow('achievement', 'Achievements',  'Badges and milestone unlocks')}
          </div>
          <div class="stg-notif-pref-section" style="margin-top:8px">
            <div class="stg-notif-pref-group-lbl">Device</div>
            ${_notifPrefRow('sound',    'Sound',     'Play alert sound with notifications')}
            ${_notifPrefRow('vibrate',  'Vibration', 'Vibrate on notification (mobile)')}
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">My Motivation Quotes</div>
          <p class="stg-muted">Appear on home screen and in Full Focus mode.</p>
          <div class="stg-quote-list">
            ${state.motivationQuotes.length
              ? state.motivationQuotes.map((q, i) => `<div class="stg-quote-row"><div class="stg-quote-txt">${escapeHTML(q)}</div><button class="stg-icon-btn" data-act="del-quote" data-i="${i}">${ic('trash')}</button></div>`).join('')
              : '<div class="stg-muted-sm">No quotes yet. Add one below!</div>'}
          </div>
          <div class="stg-quote-add">
            <input class="stg-input" id="set-new-quote" placeholder="Add a motivation quote…" maxlength="200"/>
            <button class="stg-btn stg-btn-primary stg-add-btn" data-act="add-quote">${ic('plus')}</button>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-row" style="padding:0">
            <div class="stg-row-info">
              <div class="stg-card-lbl" style="margin-bottom:2px">🌙 Night Study Mode</div>
              <div class="stg-row-sub">Warm amber overlay — reduces eye strain</div>
            </div>
            <label class="switch"><input type="checkbox" id="set-eye-care" ${state.eyeCareMode ? 'checked' : ''} data-act="toggle-eye-care"/><span class="slider"></span></label>
          </div>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">⏰ Alarm Clock</div>
          <p class="stg-muted">Wake up with an escalating alarm. Dismiss by catching the moving button!</p>
          <button class="stg-btn stg-btn-primary stg-btn-block" data-act="open-alarm-manager">
            ⏰ Manage Alarms
            ${activeAlarms ? `<span class="stg-alarm-pill">${activeAlarms} active</span>` : ''}
          </button>
        </div>

        <div class="stg-card">
          <div class="stg-card-lbl">Data</div>
          <div class="stg-btn-row">
            <button class="stg-btn stg-btn-ghost" style="flex:1" data-act="export-data">${ic('download')} Export Backup</button>
            <label class="stg-btn stg-btn-ghost" style="flex:1;cursor:pointer">${ic('upload')} Import Backup<input type="file" accept=".json" style="display:none" id="import-file-input"/></label>
          </div>
        </div>

        <button class="stg-btn stg-btn-ghost stg-btn-block" style="margin-top:4px;margin-bottom:8px" data-close>Close</button>
      </div>`,
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
    if (act === 'auth-show-modal')  { closeModal(); showAuthModal(); return; }
    if (act === 'auth-use-offline') { return; }
    if (act === 'notif-perm-allow') {
      closeModal();
      try { localStorage.setItem('stk_notif_asked', '1'); } catch(_) {}
      if ('Notification' in window) {
        Notification.requestPermission().then(async perm => {
          if (perm === 'granted') { await _initFCM(); scheduleAllNotifications(); toast('Notifications enabled ✅', 'success'); }
          else { toast('Notifications blocked. Enable in browser settings to get push alerts.', 'warn', 4500); }
          refreshSettingsIfOpen();
        });
      }
      return;
    }
    if (act === 'notif-perm-skip') {
      closeModal();
      try { localStorage.setItem('stk_notif_asked', '1'); } catch(_) {}
      return;
    }
    if (act === 'save-profile') {
      const root = document.querySelector('#modal-root .modal');
      if (root) {
        const name    = (root.querySelector('#set-profile-name')?.value  || '').trim();
        const tagline = (root.querySelector('#set-profile-tagline')?.value || '').trim();
        if (!name) { toast('Name is required', 'warn'); return; }
        const doSave = () => {
          state.profile.name    = name;
          state.profile.tagline = tagline;
          saveState();
          renderAll();
          toast('Profile saved ✓', 'success');
          if (_socialRoomCode) {
            const curSt = (typeof focusRunning !== 'undefined' && focusRunning && focusStartTime !== null) ? 'focusing' : 'break';
            _sUpdatePresence(curSt).catch(() => {});
          }
          _updateGlobalLb();
          // Push new display name to all group member docs in real-time
          window._socialSyncProfile?.();
        };
        const nameChanged = name.toLowerCase() !== (state.profile.name || '').toLowerCase();
        if (nameChanged && _db && _userId) {
          const saveBtn = root.querySelector('[data-act="save-profile"]');
          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Checking…'; }
          // Use nameLower field for case-insensitive uniqueness check
          _db.collection('global_lb').where('nameLower', '==', name.toLowerCase()).limit(5).get()
            .then(snap => {
              const conflict = snap.docs.find(d => d.id !== _userId);
              if (conflict) {
                toast(`"${name}" is already taken. Please choose a different name.`, 'warn', 4500);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Profile'; }
              } else {
                doSave();
              }
            })
            .catch(() => { doSave(); });
        } else {
          doSave();
        }
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
      if (type === 'auto') {
        const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
        if (t) {
          const wasDone = t.done;
          t.done = !t.done;
          const _ck = `topic:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`;
          if (t.done) {
            bumpActivity();
            trackCompletion(_ck, true);
            gamificationManager.addTaskXP(_ck, el);
            onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true);
            _justPoppedKey = `auto:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`;
          } else {
            gamificationManager.removeTaskXP(_ck, el);
            trackCompletion(_ck, false);
            onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, false);
          }
          const tasks = getActivePlanTasks();
          if (tasks.length > 0 && tasks.every(x => x.done) && !wasDone) _justCompletedDay = todayKey();
          saveState();
          renderAll();
        }
      } else {
        const plan = state.dailyPlans[todayKey()];
        if (plan) {
          const ct = plan.custom.find(c => c.id === el.dataset.id);
          if (ct) {
            ct.done = !ct.done;
            const _ck = `custom:${ct.id}`;
            if (ct.done) {
              bumpActivity();
              gamificationManager.addTaskXP(_ck, el);
            } else {
              gamificationManager.removeTaskXP(_ck, el);
            }
            saveState();
            renderAll();
          }
        }
      }
      return;
    }
    if (act === 'remove-plan-task') {
      const type = el.dataset.type, plan = state.dailyPlans[todayKey()]; if (!plan) return;
      if (type === 'auto') {
        const key = autoKey(el.dataset.sub, el.dataset.ch, el.dataset.t);
        const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
        if (t) {
          // If the topic was done, reverse its XP award before removing
          if (t.done) gamificationManager.removeTaskXP(`topic:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`);
          t.skipCount = (t.skipCount || 0) + 1;
          t.lastSkippedAt = todayKey();
        }
        if (!plan.removed.includes(key)) plan.removed.push(key);
        saveState(); renderAll();
      } else {
        const rid = el.dataset.rid;
        if (rid) {
          confirmModal('This is a daily recurring task. Remove it forever so it stops repeating?', () => {
            const cTask = plan.custom.find(c => c.id === el.dataset.id);
            if (cTask && cTask.done) gamificationManager.removeTaskXP(`custom:${cTask.id}`);
            state.recurringTasks = (state.recurringTasks || []).filter(r => r.id !== rid);
            plan.custom = plan.custom.filter(c => c.id !== el.dataset.id);
            saveState(); renderAll();
          }, { title: 'Stop Recurring Task?', yesLabel: 'Remove Forever', yesClass: 'btn', noLabel: 'Keep' });
        } else {
          const cTask = plan.custom.find(c => c.id === el.dataset.id);
          if (cTask && cTask.done) gamificationManager.removeTaskXP(`custom:${cTask.id}`);
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
    if (act === 'toggle-chapter-done') { const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) { const nowDone = !isChapterEffectivelyDone(ch); for (const t of ch.topics) { if (t.done !== nowDone) { t.done = nowDone; trackCompletion(`topic:${el.dataset.sub}:${el.dataset.ch}:${t.id}`, nowDone); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, t.id, nowDone); } } if (!ch.topics.length) { trackCompletion(`chapter:${el.dataset.sub}:${el.dataset.ch}`, nowDone); } ch.done = nowDone; if (nowDone) { bumpActivity(); } saveState(); renderAll(); toast(nowDone ? 'Chapter marked done' : 'Chapter reopened', nowDone ? 'success' : 'info'); } return; }
    if (act === 'add-chapter') { closeDropdown(); modalAddChapter(el.dataset.sub, null); return; }
    if (act === 'open-chapter-menu') { e.stopPropagation(); showChapterMenu(el.dataset.sub, el.dataset.ch); return; }
    if (act === 'edit-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) modalAddChapter(el.dataset.sub, ch); return; }
    if (act === 'del-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) confirmModal(`Delete "${ch.name}"?`, () => { const sub = findSubject(el.dataset.sub); if (sub) sub.chapters = sub.chapters.filter(c => c.id !== ch.id); saveState(); renderAll(); toast('Chapter deleted', 'danger'); }); return; }
    if (act === 'schedule-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (!ch) return; openModal(`<h3>Schedule Chapter</h3><div class="field"><label>Date</label><input id="m-date" type="date" value="${ch.scheduledDate || todayKey()}"/></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Schedule</button></div>`, root => { root.querySelector('#m-save').onclick = () => { ch.scheduledDate = root.querySelector('#m-date').value || null; saveState(); closeModal(); renderAll(); toast('Chapter scheduled', 'success'); }; }); return; }

    // Topics
    if (act === 'toggle-topic-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = !t.done; const _ck = `topic:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`; if (t.done) { bumpActivity(); trackCompletion(_ck, true); } else { trackCompletion(_ck, false); } onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, t.done); saveState(); renderAll(); } return; }
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

    // Focus top-mode pills (Pomodoro / Live Study)
    if (act === 'focus-top-mode') { focusTopMode = el.dataset.mode; renderFocus(); return; }

    // Live Study — subject sheet
    if (act === 'ls-open-sheet') { _lsOpenSheet(); return; }

    // Subject→Chapter→Topic bottom-sheet pickers in Pomodoro timer
    if (act === 'sct-open-sub')   { _sctOpenSubSheet();   return; }
    if (act === 'sct-open-chap')  { _sctOpenChapSheet();  return; }
    if (act === 'sct-open-topic') { _sctOpenTopicSheet(); return; }
    // Clear buttons
    if (act === 'sct-clear-sub')   { _lsSubjectId = null; _lsChapterId = null; _lsTopicId = null; renderFocus(); return; }
    if (act === 'sct-clear-chap')  { _lsChapterId = null; _lsTopicId  = null; renderFocus(); return; }
    if (act === 'sct-clear-topic') { _lsTopicId   = null; renderFocus(); return; }

    // Live Study Timer
    if (act === 'ls-subject-change') {
      const sel = document.getElementById('ls-subject-sel');
      if (sel) { _lsSubjectId = sel.value || null; renderFocus(); }
      return;
    }
    if (act === 'ls-enter') { enterLiveSession(); return; }
    if (act === 'ls-exit') { exitLiveSession(true); return; }
    if (act === 'ls-select-subject') {
      const overlay = document.getElementById('ls-overlay'); if (!overlay) return;
      const existing = overlay.querySelector('.lsf-sub-picker');
      if (existing) { existing.remove(); return; }
      const subjects = (state.syllabus || []).filter(s => !s._deleted);
      if (!subjects.length) { toast('Add subjects in the Study tab first', 'info'); return; }
      const picker = document.createElement('div');
      picker.className = 'lsf-sub-picker';
      picker.innerHTML = `
        <div class="lsf-sub-picker-title">Select Subject</div>
        <button class="lsf-sub-picker-item${!_lsSubjectId ? ' lsf-sub-picker-active' : ''}" data-act="ls-pick-sub" data-sid="">No subject</button>
        ${subjects.map(s => `<button class="lsf-sub-picker-item${_lsSubjectId === s.id ? ' lsf-sub-picker-active' : ''}" data-act="ls-pick-sub" data-sid="${escapeHTML(s.id)}" style="border-left:3px solid ${s.color||'#ff7a1a'}">${escapeHTML(s.name)}</button>`).join('')}
      `;
      overlay.appendChild(picker);
      return;
    }
    if (act === 'ls-pick-sub') {
      _lsSubjectId = el.dataset.sid || null;
      const overlay = document.getElementById('ls-overlay');
      const picker = overlay && overlay.querySelector('.lsf-sub-picker');
      if (picker) picker.remove();
      renderLiveOverlay();
      return;
    }
    if (act === 'ls-play-pause') {
      // Ripple animation
      const pb = document.getElementById('ls-play-btn');
      if (pb) {
        pb.classList.add('lsf-ripple-active');
        setTimeout(() => pb.classList.remove('lsf-ripple-active'), 600);
      }
      if (_lsRunning) {
        _lsElapsedBase = _lsGetElapsed();
        _lsStartTime = null;
        _lsRunning = false;
        clearInterval(_lsTimer); _lsTimer = null;
        if (pb) {
          const icon = pb.querySelector('.lsf-play-icon');
          if (icon) icon.textContent = '▶';
          pb.style.animation = 'none';
        }
        const overlay = document.getElementById('ls-overlay');
        if (overlay) overlay.className = 'ls-paused';
        const elEl = document.getElementById('ls-elapsed');
        if (elEl) elEl.classList.add('lsf-paused-clock');
        window._focusActive = false;
        // Show paused badge
        const ca = document.querySelector('.lsf-clock-area');
        if (ca && !ca.querySelector('.lsf-paused-badge')) {
          const badge = document.createElement('div');
          badge.className = 'lsf-paused-badge'; badge.textContent = '⏸ Paused';
          ca.appendChild(badge);
        }
      } else {
        _lsRunning = true;
        _lsStartTime = Date.now();
        _lsTimer = setInterval(_lsTick, 1000);
        if (pb) {
          const icon = pb.querySelector('.lsf-play-icon');
          if (icon) icon.textContent = '⏸';
          pb.style.animation = '';
        }
        const overlay = document.getElementById('ls-overlay');
        if (overlay) overlay.className = 'ls-running';
        const elEl = document.getElementById('ls-elapsed');
        if (elEl) elEl.classList.remove('lsf-paused-clock');
        // Remove paused badge
        const badge = document.querySelector('.lsf-paused-badge');
        if (badge) badge.remove();
        window._focusActive = true;
      }
      return;
    }

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
    if (act === 'social-leave')  { closeModal(); _sLeaveRoom(); return; }
    if (act === 'social-rejoin') { _sJoinRoom(el.dataset.code).catch(() => {}); return; }
    if (act === 'chat-react') {
      const msgId = el.dataset.msgid, emoji = el.dataset.emoji;
      if (msgId && emoji) _sChatReact(msgId, emoji).catch(() => {});
      return;
    }
    if (act === 'chat-msg-menu') {
      const msgId = el.dataset.msgid;
      _showChatMsgMenu(msgId);
      return;
    }
    if (act === 'chat-menu-react') {
      const msgId = el.dataset.msgid, emoji = el.dataset.emoji;
      closeModal();
      if (msgId && emoji) _sChatReact(msgId, emoji).catch(() => {});
      return;
    }
    if (act === 'chat-menu-reply') {
      closeModal();
      _chatReplyTarget = { id: el.dataset.msgid, name: el.dataset.mname, text: el.dataset.mtext };
      const bar = document.getElementById('chat-reply-bar');
      const barName = document.getElementById('chat-reply-bar-name');
      const barText = document.getElementById('chat-reply-bar-text');
      if (bar) bar.style.display = 'flex';
      if (barName) barName.textContent = `Replying to ${el.dataset.mname || 'Unknown'}`;
      if (barText) barText.textContent = el.dataset.mtext || '';
      setTimeout(() => { const inp = document.getElementById('chat-text-input'); if (inp) inp.focus(); }, 100);
      return;
    }
    if (act === 'chat-reply-cancel') {
      _chatReplyTarget = null;
      const bar = document.getElementById('chat-reply-bar');
      if (bar) bar.style.display = 'none';
      return;
    }
    if (act === 'chat-menu-edit') {
      const msgId = el.dataset.msgid;
      const origMsg = _chatMessages.find(m => m.id === msgId);
      const origText = (origMsg && origMsg.text) || '';
      closeModal();
      openModal(`<h3>Edit Message</h3>
        <textarea id="chat-edit-inp" style="width:100%;box-sizing:border-box;min-height:80px;padding:10px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:var(--text);font-family:inherit;font-size:14px;resize:none;outline:none">${escapeHTML(origText)}</textarea>
        <div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="chat-edit-save">Save</button></div>`,
        root => {
          const inp = root.querySelector('#chat-edit-inp');
          if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
          root.querySelector('#chat-edit-save').onclick = () => { const val = inp ? inp.value : ''; closeModal(); _sChatEditMessage(msgId, val).catch(() => {}); };
        });
      return;
    }
    if (act === 'chat-menu-delete-all') {
      const msgId = el.dataset.msgid;
      closeModal();
      confirmModal('Delete this message for everyone?', () => _sChatDeleteMessage(msgId, true).catch(() => {}), { title: 'Delete Message', yesLabel: 'Delete', yesClass: 'btn btn-danger', noLabel: 'Cancel' });
      return;
    }
    if (act === 'chat-emoji-toggle') {
      const picker = document.getElementById('chat-emoji-picker');
      if (picker) picker.classList.toggle('grm2-emoji-open');
      return;
    }
    if (act === 'chat-emoji-insert') {
      const inp = document.getElementById('chat-text-input');
      if (inp) {
        const s = inp.selectionStart, e2 = inp.selectionEnd;
        inp.value = inp.value.slice(0, s) + el.dataset.emoji + inp.value.slice(e2);
        inp.selectionStart = inp.selectionEnd = s + (el.dataset.emoji || '').length;
        inp.focus();
        inp.dispatchEvent(new Event('input'));
      }
      const picker = document.getElementById('chat-emoji-picker');
      if (picker) picker.classList.remove('grm2-emoji-open');
      return;
    }
    if (act === 'chat-send') {
      const inp = document.getElementById('chat-text-input');
      if (inp && inp.value.trim()) { _sSendMessage(inp.value).catch(() => {}); inp.value = ''; inp.style.height = 'auto'; }
      return;
    }
    if (act === 'chat-scroll-bottom') {
      const chatEl = document.getElementById('chat-messages');
      if (chatEl) { chatEl.scrollTop = chatEl.scrollHeight; _chatScrollAtBottom = true; }
      const pill = document.getElementById('chat-new-pill');
      if (pill) pill.style.display = 'none';
      return;
    }
    if (act === 'chat-menu-pin') {
      const msgId = el.dataset.msgid;
      closeModal();
      if (msgId) _sChatPinMessage(msgId).catch(() => {});
      return;
    }
    if (act === 'chat-unpin') {
      if (_db && _socialRoomCode) {
        _db.collection('groups').doc(_socialRoomCode).update({ pinnedMessage: firebase.firestore.FieldValue.delete() })
          .then(() => toast('Message unpinned', 'success')).catch(() => toast('Could not unpin', 'danger'));
      }
      return;
    }
    if (act === 'social-lb-refresh') {
      const btn = el;
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.classList.add('spin');
      _updateGlobalLb();
      _loadGlobalLeaderboard()
        .then(() => { toast('Leaderboard updated ✓', 'success', 2000); })
        .catch(() => { toast('Failed to refresh. Try again.', 'warn', 3000); })
        .finally(() => { btn.disabled = false; btn.style.opacity = ''; btn.classList.remove('spin'); });
      return;
    }
    if (act === 'social-pub-refresh') { _publicRooms = []; _publicRoomsLoading = false; _loadPublicRooms(); return; }
    if (act === 'social-join-pub') { _sJoinRoom(el.dataset.code).catch(() => {}); return; }
    if (act === 'social-copy-lobby-code') {
      const c_ = el.dataset.code || '';
      if (c_) { navigator.clipboard.writeText(c_).then(() => toast(`Copied ${c_}!`, 'success')).catch(() => { const ta = document.createElement('textarea'); ta.value = c_; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast(`Copied ${c_}!`, 'success'); }); }
      return;
    }
    if (act === 'social-remove-group') {
      const code_ = el.dataset.code;
      _myGroupCodes = _myGroupCodes.filter(c => c !== code_);
      try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
      if (_db && _userId) _db.collection('users').doc(_userId).update({ joinedRooms: _myGroupCodes }).catch(() => {});
      renderSocial(); return;
    }
    if (act === 'social-delete-group') {
      const code_ = el.dataset.code;
      confirmModal(`Delete room ${code_}? This will permanently wipe all room data from the server.`, async () => {
        _myGroupCodes = _myGroupCodes.filter(c => c !== code_);
        try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        if (_db && _userId) _db.collection('users').doc(_userId).update({ joinedRooms: _myGroupCodes }).catch(() => {});
        if (_db) {
          try {
            const groupRef = _db.collection('groups').doc(code_);
            const presSnap = await groupRef.collection('presence').get();
            const batch = _db.batch();
            presSnap.docs.forEach(d => batch.delete(d.ref));
            batch.delete(groupRef);
            await batch.commit();
            toast('Room deleted', 'success');
          } catch(e) { toast('Removed from your list', 'info'); }
        }
        renderSocial();
      }, { title: 'Delete Room?', yesLabel: 'Delete', yesClass: 'btn btn-danger', noLabel: 'Cancel' });
      return;
    }
    if (act === 'view-profile')  { _viewMemberProfile(el.dataset.uid); return; }
    if (act === 'view-profile-global') { _viewGlobalProfile(el.dataset.uid, el.dataset.name); return; }
    if (act === 'social-admin')  { _openAdminSettings(); return; }
    if (act === 'social-room-settings') { _openRoomSettings(); return; }
    if (act === 'social-room-settings-lobby') {
      const c_ = el.dataset.code;
      const meta_ = _myGroupRoomMeta[c_] || {};
      const roomName_ = meta_.roomName || c_;
      confirmModal(`Leave "${roomName_}"? You'll be removed from the group. Public rooms will still be visible to join again.`, async () => {
        _myGroupCodes = _myGroupCodes.filter(c => c !== c_);
        delete _myGroupRoomMeta[c_];
        try { localStorage.setItem('my_group_codes', JSON.stringify(_myGroupCodes)); } catch(_) {}
        if (_db && _userId) {
          _db.collection('users').doc(_userId).update({ joinedRooms: _myGroupCodes }).catch(() => {});
          // Remove presence and membership from Firestore
          const groupRef = _db.collection('groups').doc(c_);
          groupRef.collection('presence').doc(_userId).delete().catch(() => {});
          groupRef.collection('members').doc(_userId).delete().catch(() => {});
        }
        // Refresh public rooms so the left group reappears there if public
        _publicRooms = []; _publicRoomsLoading = false;
        _loadPublicRooms();
        renderSocial();
      }, { title: 'Leave Room?', yesLabel: 'Leave', yesClass: 'btn btn-danger', noLabel: 'Cancel' });
      return;
    }
    if (act === 'admin-rename-room') {
      if (!_db || !_socialRoomCode) return;
      const current = (_socialRoomData && _socialRoomData.roomName) || '';
      const newName = prompt('Enter a new name for this room:', current);
      if (newName && newName.trim()) {
        const _renameCode2 = _socialRoomCode;
        const _trimmedName = newName.trim();
        _db.collection('groups').doc(_renameCode2).update({ roomName: _trimmedName })
          .then(() => {
            if (_myGroupRoomMeta[_renameCode2]) _myGroupRoomMeta[_renameCode2].roomName = _trimmedName;
            const pr2 = _publicRooms.find(r => r.id === _renameCode2);
            if (pr2) pr2.roomName = _trimmedName;
            toast('Room renamed!', 'success'); closeModal();
          })
          .catch(() => toast('Failed to rename', 'danger'));
      }
      return;
    }
    if (act === 'grm-name-inline-edit') {
      const display = document.getElementById('grm-name-display');
      const form    = document.getElementById('grm-name-edit-form');
      const inp     = document.getElementById('grm-name-input');
      if (display) display.style.display = 'none';
      if (form)    form.style.display = 'flex';
      if (inp)     { inp.focus(); inp.select(); }
      return;
    }
    if (act === 'grm-name-inline-save') {
      const inp = document.getElementById('grm-name-input');
      const newName = (inp ? inp.value : '').trim();
      if (!newName) { toast('Enter a room name', 'warn'); return; }
      if (!_db || !_socialRoomCode) return;
      const _renameCode = _socialRoomCode;
      _db.collection('groups').doc(_renameCode).update({ roomName: newName })
        .then(() => {
          if (_myGroupRoomMeta[_renameCode]) _myGroupRoomMeta[_renameCode].roomName = newName;
          const pr = _publicRooms.find(r => r.id === _renameCode);
          if (pr) pr.roomName = newName;
          toast('Room renamed!', 'success'); renderSocial();
        })
        .catch(() => toast('Failed to rename', 'danger'));
      return;
    }
    if (act === 'grm-name-inline-cancel') {
      const display = document.getElementById('grm-name-display');
      const form    = document.getElementById('grm-name-edit-form');
      if (display) display.style.display = '';
      if (form)    form.style.display = 'none';
      return;
    }
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
    if (act === 'admin-edit-description') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can edit the description', 'warn'); return; }
      const curDesc = (_socialRoomData && _socialRoomData.description) || '';
      closeModal();
      openModal(`<h3>Room Description</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">Write a short bio for your study room. Members and anyone browsing public rooms will see this.</p>
        <div class="field">
          <textarea id="desc-input" maxlength="150" placeholder="e.g. NEET 2026 prep group — Biology &amp; Chemistry focus 🔬" style="width:100%;min-height:80px;resize:vertical;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;color:var(--text);font-size:13px;font-family:inherit;box-sizing:border-box">${escapeHTML(curDesc)}</textarea>
          <div id="desc-counter" style="text-align:right;font-size:11px;color:var(--text-muted);margin-top:4px">${curDesc.length}/150</div>
        </div>
        <div id="desc-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none"></div>
        <div class="actions">
          <button class="btn btn-ghost" data-close>Cancel</button>
          ${curDesc ? `<button class="btn btn-ghost" id="desc-clear-btn" style="color:#ef4444">Clear</button>` : ''}
          <button class="btn" id="desc-save-btn">Save</button>
        </div>`,
        root => {
          const ta  = root.querySelector('#desc-input');
          const ctr = root.querySelector('#desc-counter');
          const err = root.querySelector('#desc-err');
          const saveBtn  = root.querySelector('#desc-save-btn');
          const clearBtn = root.querySelector('#desc-clear-btn');
          ta.addEventListener('input', () => { ctr.textContent = `${ta.value.length}/150`; });
          const doSave = async (val) => {
            saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ description: val });
              if (_socialRoomData) _socialRoomData.description = val;
              if (_myGroupRoomMeta[_socialRoomCode]) _myGroupRoomMeta[_socialRoomCode].description = val;
              closeModal();
              toast(val ? '📝 Description saved' : 'Description cleared', 'success');
            } catch(e) {
              saveBtn.disabled = false; saveBtn.textContent = 'Save';
              err.textContent = 'Failed to save. Please try again.'; err.style.display = '';
            }
          };
          saveBtn.onclick = () => doSave(ta.value.trim());
          if (clearBtn) clearBtn.onclick = () => doSave('');
        });
      return;
    }
    // ── New admin setting handlers ───────────────────────────────────────────
    if (act === 'admin-change-name') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can rename the group', 'warn'); return; }
      const cur = (_socialRoomData && _socialRoomData.roomName) || '';
      closeModal();
      openModal(`<h3>Change Group Name</h3>
        <div class="field"><label>Group Name</label><input id="gname-input" type="text" maxlength="40" value="${escapeHTML(cur)}" placeholder="Enter group name…" autocomplete="off"/></div>
        <div id="gname-err" style="color:#ef4444;font-size:12px;margin-bottom:8px;display:none"></div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="gname-save">Save</button></div>`,
        root => {
          const inp = root.querySelector('#gname-input');
          const errEl = root.querySelector('#gname-err');
          const save = root.querySelector('#gname-save');
          inp.focus(); inp.select();
          const doSave = async () => {
            const v = inp.value.trim();
            if (!v) { errEl.textContent = 'Name cannot be empty.'; errEl.style.display = ''; return; }
            save.disabled = true; save.textContent = 'Saving…';
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ roomName: v });
              if (_socialRoomData) _socialRoomData.roomName = v;
              if (_myGroupRoomMeta[_socialRoomCode]) _myGroupRoomMeta[_socialRoomCode].roomName = v;
              closeModal(); toast('✏️ Group renamed!', 'success'); renderSocial();
            } catch(e) { save.disabled = false; save.textContent = 'Save'; errEl.textContent = 'Failed. Try again.'; errEl.style.display = ''; }
          };
          save.onclick = doSave;
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); });
        });
      return;
    }
    if (act === 'admin-change-category') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const CATS = ['General','NEET','JEE','Board Exam','Medical','Language','Coding','Science','Arts'];
      const cur = (_socialRoomData && _socialRoomData.category) || '';
      closeModal();
      openModal(`<h3>Category</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Choose the category that best describes your group.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${CATS.map(c => `<button class="btn ${c === cur ? 'btn-primary' : 'btn-ghost'} adm-cat-btn" style="text-align:left;padding:10px 14px;justify-content:flex-start" data-cat="${c}">${c === cur ? '✓ ' : ''}${escapeHTML(c)}</button>`).join('')}
          <button class="btn btn-ghost adm-cat-btn" style="text-align:left;padding:10px 14px;color:#ef4444" data-cat="">Clear</button>
        </div>`,
        root => {
          root.querySelectorAll('.adm-cat-btn').forEach(btn => {
            btn.onclick = async () => {
              const val = btn.dataset.cat;
              try {
                await _db.collection('groups').doc(_socialRoomCode).update({ category: val });
                if (_socialRoomData) _socialRoomData.category = val;
                closeModal(); toast(val ? `🏷️ Category set to "${val}"` : 'Category cleared', 'success');
              } catch(e) { toast('Failed to save', 'danger'); }
            };
          });
        });
      return;
    }
    if (act === 'admin-change-daily-goal') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const cur = (_socialRoomData && _socialRoomData.dailyGoalHours) || 0;
      closeModal();
      openModal(`<h3>Daily Goal</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Set how many hours per day your group aims to study.</p>
        <div class="field"><label>Hours per day (1–24)</label><input id="dgoal-input" type="number" min="0" max="24" step="0.5" value="${cur || ''}" placeholder="e.g. 6"/></div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ghost" id="dgoal-clear" style="color:#ef4444">Clear</button><button class="btn" id="dgoal-save">Save</button></div>`,
        root => {
          const inp = root.querySelector('#dgoal-input');
          const doSave = async (val) => {
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ dailyGoalHours: val });
              if (_socialRoomData) _socialRoomData.dailyGoalHours = val;
              closeModal(); toast(val ? `🎯 Daily goal set to ${val} hrs` : 'Daily goal cleared', 'success');
            } catch(e) { toast('Failed to save', 'danger'); }
          };
          root.querySelector('#dgoal-save').onclick = () => {
            const v = parseFloat(inp.value);
            if (!inp.value || isNaN(v) || v < 1 || v > 24) { toast('Enter a value between 1 and 24', 'warn'); return; }
            doSave(v);
          };
          root.querySelector('#dgoal-clear').onclick = () => doSave(0);
        });
      return;
    }
    if (act === 'admin-change-capacity') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const cur = (_socialRoomData && _socialRoomData.capacity) || 0;
      closeModal();
      openModal(`<h3>Max Capacity</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Limit how many members can join this group (2–200). Leave 0 for unlimited.</p>
        <div class="field"><label>Max members</label><input id="cap-input" type="number" min="2" max="200" value="${cur || ''}" placeholder="e.g. 20 (0 = unlimited)"/></div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ghost" id="cap-clear" style="color:#ef4444">Unlimited</button><button class="btn" id="cap-save">Save</button></div>`,
        root => {
          const inp = root.querySelector('#cap-input');
          const doSave = async (val) => {
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ capacity: val });
              if (_socialRoomData) _socialRoomData.capacity = val;
              closeModal(); toast(val ? `👥 Capacity set to ${val}` : 'Capacity set to unlimited', 'success');
            } catch(e) { toast('Failed to save', 'danger'); }
          };
          root.querySelector('#cap-save').onclick = () => {
            const v = parseInt(inp.value);
            if (!inp.value || isNaN(v) || v < 2 || v > 200) { toast('Enter a value between 2 and 200', 'warn'); return; }
            doSave(v);
          };
          root.querySelector('#cap-clear').onclick = () => doSave(0);
        });
      return;
    }
    if (act === 'admin-toggle-join-mode') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const newMode = ((_socialRoomData && _socialRoomData.joinMode) || 'open') === 'approval' ? 'open' : 'approval';
      _db.collection('groups').doc(_socialRoomCode).update({ joinMode: newMode })
        .then(() => {
          if (_socialRoomData) _socialRoomData.joinMode = newMode;
          toast(newMode === 'approval' ? '⏳ Approval required to join' : '🚪 Room is now open to join', 'success');
          closeModal();
        }).catch(() => toast('Failed to update', 'danger'));
      return;
    }
    if (act === 'admin-change-join-password') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const cur = (_socialRoomData && _socialRoomData.joinPassword) || '';
      closeModal();
      openModal(`<h3>Join Password</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">New members must enter this password to join. Leave blank for no password.</p>
        <div class="field"><label>Password</label><input id="jpw-input" type="text" maxlength="30" value="${escapeHTML(cur)}" placeholder="Leave blank for no password" autocomplete="off"/></div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ghost" id="jpw-clear" style="color:#ef4444">Remove</button><button class="btn" id="jpw-save">Save</button></div>`,
        root => {
          const inp = root.querySelector('#jpw-input');
          const doSave = async (val) => {
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ joinPassword: val });
              if (_socialRoomData) _socialRoomData.joinPassword = val;
              closeModal(); toast(val ? '🔐 Password set' : 'Password removed', 'success');
            } catch(e) { toast('Failed to save', 'danger'); }
          };
          root.querySelector('#jpw-save').onclick = () => doSave(inp.value.trim());
          root.querySelector('#jpw-clear').onclick = () => doSave('');
        });
      return;
    }
    if (act === 'admin-change-join-question') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const cur = (_socialRoomData && _socialRoomData.joinQuestion) || '';
      closeModal();
      openModal(`<h3>Sign Up Question</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">Ask new members a question when they request to join (e.g. "Why do you want to join?").</p>
        <div class="field">
          <textarea id="jq-input" maxlength="120" placeholder="e.g. What subject are you preparing for?" style="width:100%;min-height:70px;resize:vertical;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px;color:var(--text);font-size:13px;font-family:inherit;box-sizing:border-box">${escapeHTML(cur)}</textarea>
        </div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-ghost" id="jq-clear" style="color:#ef4444">Remove</button><button class="btn" id="jq-save">Save</button></div>`,
        root => {
          const ta = root.querySelector('#jq-input');
          const doSave = async (val) => {
            try {
              await _db.collection('groups').doc(_socialRoomCode).update({ joinQuestion: val });
              if (_socialRoomData) _socialRoomData.joinQuestion = val;
              closeModal(); toast(val ? '❓ Question saved' : 'Question removed', 'success');
            } catch(e) { toast('Failed to save', 'danger'); }
          };
          root.querySelector('#jq-save').onclick = () => doSave(ta.value.trim());
          root.querySelector('#jq-clear').onclick = () => doSave('');
        });
      return;
    }
    if (act === 'admin-toggle-nickname-rules') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const newVal = !(_socialRoomData && _socialRoomData.nicknameRequired);
      _db.collection('groups').doc(_socialRoomCode).update({ nicknameRequired: newVal })
        .then(() => {
          if (_socialRoomData) _socialRoomData.nicknameRequired = newVal;
          toast(newVal ? '📛 Display name required' : 'Nickname rule removed', 'success');
          closeModal();
        }).catch(() => toast('Failed to update', 'danger'));
      return;
    }
    if (act === 'admin-toggle-chat') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const newVal = (_socialRoomData && _socialRoomData.chatEnabled) === false ? true : false;
      _db.collection('groups').doc(_socialRoomCode).update({ chatEnabled: newVal })
        .then(() => {
          if (_socialRoomData) _socialRoomData.chatEnabled = newVal;
          toast(newVal ? '💬 Group chat enabled' : '💬 Group chat disabled', 'success');
          closeModal(); renderSocial();
        }).catch(() => toast('Failed to update', 'danger'));
      return;
    }
    if (act === 'admin-nudge-everyone') {
      if (!_db || !_userId || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      const others = _mergedMembers().filter(m => m.uid !== _userId && _sStatusOf(m) !== 'offline');
      if (!others.length) { toast('No one else is online right now', 'warn'); return; }
      let count = 0;
      others.forEach((m, i) => {
        setTimeout(() => {
          _sNudge(m.uid, m.displayName || 'Member').catch(() => {});
          count++;
          if (count === others.length) toast(`📣 Nudged ${count} member${count !== 1 ? 's' : ''}!`, 'success', 3000);
        }, i * 400);
      });
      closeModal();
      return;
    }
    if (act === 'admin-waiting-room') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Admin only', 'warn'); return; }
      closeModal();
      toast('Loading waiting room…', 'info', 1500);
      _db.collection('groups').doc(_socialRoomCode).collection('joinRequests').get()
        .then(snap => {
          if (snap.empty) { toast('No pending join requests', 'info'); return; }
          const rows = snap.docs.map(doc => {
            const r = doc.data();
            return `<div class="adm-member-row" style="margin-bottom:8px">
              <div class="adm-member-av-wrap">
                <div class="adm-member-av" style="background:${_sAvatarColor(r.uid)}">${_sInitials(r.displayName || '?')}</div>
              </div>
              <div class="adm-member-info" style="flex:1">
                <div class="adm-member-name">${escapeHTML(r.displayName || 'Anonymous')}</div>
                ${r.answer ? `<div class="adm-member-sub" style="font-style:italic">"${escapeHTML(r.answer)}"</div>` : ''}
                <div class="adm-member-sub" style="font-size:10px">${new Date(r.requestedAt).toLocaleString()}</div>
              </div>
              <button class="adm-row-btn" style="background:rgba(34,197,94,.15);color:#22c55e;border-color:rgba(34,197,94,.3);margin-right:4px" data-act="admin-approve-request" data-uid="${r.uid}" data-name="${escapeHTML(r.displayName||'Member')}">✓</button>
              <button class="adm-kick-btn" data-act="admin-reject-request" data-uid="${r.uid}">✕</button>
            </div>`;
          }).join('');
          openModal(`<h3>⏳ Waiting Room</h3>
            <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">${snap.size} pending request${snap.size !== 1 ? 's' : ''}</p>
            <div>${rows}</div>
            <div class="actions"><button class="btn btn-ghost" data-close>Close</button></div>`);
        })
        .catch(() => toast('Could not load requests', 'danger'));
      return;
    }
    if (act === 'admin-approve-request') {
      if (!_db || !_socialRoomCode) return;
      const uid_ = el.dataset.uid;
      const name_ = el.dataset.name || 'Member';
      _db.collection('groups').doc(_socialRoomCode).collection('joinRequests').doc(uid_).delete()
        .then(() => {
          _db.collection('groups').doc(_socialRoomCode).collection('members').doc(uid_).set({ uid: uid_, displayName: name_, joinedAt: Date.now() }, { merge: true }).catch(() => {});
          toast(`✓ ${escapeHTML(name_)} approved!`, 'success');
          el.closest('.adm-member-row').remove();
        }).catch(() => toast('Failed to approve', 'danger'));
      return;
    }
    if (act === 'admin-reject-request') {
      if (!_db || !_socialRoomCode) return;
      const uid_ = el.dataset.uid;
      _db.collection('groups').doc(_socialRoomCode).collection('joinRequests').doc(uid_).delete()
        .then(() => { toast('Request rejected', 'info'); el.closest('.adm-member-row').remove(); })
        .catch(() => toast('Failed', 'danger'));
      return;
    }
    if (act === 'admin-promote-group') {
      const rName = (_socialRoomData && _socialRoomData.roomName) || `Room ${_socialRoomCode}`;
      const rDesc = (_socialRoomData && _socialRoomData.description) || '';
      const shareText = `Join my study room "${rName}" on Syllabus Tracker!\nCode: ${_socialRoomCode}${rDesc ? '\n' + rDesc : ''}`;
      closeModal();
      if (navigator.share) {
        navigator.share({ title: rName, text: shareText }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareText).then(() => toast('📣 Invite text copied!', 'success')).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = shareText; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
          toast('📣 Invite text copied!', 'success');
        });
      }
      return;
    }
    if (act === 'admin-toggle-privacy') {
      if (!_db || !_socialRoomCode) return;
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can change privacy', 'warn'); return; }
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
      return;
    }
    if (act === 'admin-send-announcement') {
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can send announcements', 'warn'); return; }
      closeModal(); _openAnnouncementModal(); return;
    }
    if (act === 'admin-create-poll') {
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can create polls', 'warn'); return; }
      closeModal(); _openCreatePollModal(); return;
    }
    if (act === 'announcement-send') {
      const text = (document.getElementById('ann-text-input')?.value || '').trim();
      if (!text) { toast('Please enter announcement text', 'warn'); return; }
      _sSendAnnouncement(text).catch(() => {});
      closeModal();
      return;
    }
    if (act === 'poll-modal-send') {
      const q = (document.getElementById('poll-question-input')?.value || '').trim();
      const opts = Array.from(document.querySelectorAll('.poll-option-input')).map(i => i.value.trim()).filter(Boolean);
      if (!q) { toast('Please enter a question', 'warn'); return; }
      if (opts.length < 2) { toast('Please add at least 2 options', 'warn'); return; }
      _sSendPoll(q, opts).catch(() => {});
      closeModal();
      return;
    }
    if (act === 'poll-modal-add-option') {
      const list = document.getElementById('poll-options-list');
      const count = list ? list.querySelectorAll('.poll-option-input').length : 0;
      if (count >= 4) { toast('Maximum 4 options', 'warn'); return; }
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'poll-option-input modal-input';
      inp.placeholder = `Option ${count + 1}`; inp.maxLength = 80;
      list.appendChild(inp); inp.focus();
      return;
    }
    if (act === 'poll-vote') {
      const msgId = el.dataset.msgid;
      const idx = parseInt(el.dataset.idx, 10);
      if (msgId && !isNaN(idx)) _sPollVote(msgId, idx).catch(() => {});
      return;
    }
    if (act === 'admin-kick') {
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can kick members', 'warn'); return; }
      const uid_ = el.dataset.uid, name = el.dataset.name;
      confirmModal(`Kick ${name} from the room?`, () => _adminKickMember(uid_, name), { title: 'Kick Member?', yesLabel: 'Kick', yesClass: 'btn btn-danger', noLabel: 'Cancel' }); return;
    }
    if (act === 'admin-clear-messages') {
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can clear messages', 'warn'); return; }
      confirmModal('Delete all messages in this chat for everyone? This cannot be undone.', () => _adminClearAllMessages().catch(() => {}), { title: 'Clear All Messages?', yesLabel: 'Clear Chat', yesClass: 'btn btn-danger', noLabel: 'Cancel' }); return;
    }
    if (act === 'admin-close-room') {
      if (_userId !== (_socialRoomData && _socialRoomData.createdBy)) { toast('Only the room admin can close the room', 'warn'); return; }
      confirmModal('Close and delete this room? All members will be sent back to the lobby.', () => _adminCloseRoom(), { title: 'Close Room?', yesLabel: 'Close Room', yesClass: 'btn btn-danger', noLabel: 'Cancel' }); return;
    }
    if (act === 'voice-join')    { _voiceJoin(); return; }
    if (act === 'voice-leave')   { _voiceLeave(false); return; }
    if (act === 'voice-mute')    { _voiceMuteToggle(); return; }
    if (act === 'chat-mic') {
      // Handled by direct listener in renderSocial; just guard against fallthrough
      return;
    }
    if (act === 'grm-room-tab') {
      // Close any open context menu on tab switch
      document.getElementById('chat-ctx-menu')?.remove();
      document.getElementById('chat-ctx-backdrop')?.remove();
      _socialRoomTab = el.dataset.tab || 'members';
      // Allow the pane slide-in animation to play on intentional user tab switches
      _socialPaneAnimPlayed = false;
      if (_socialRoomTab === 'rankings' && _lbView === 'global') { _loadGlobalLeaderboard().catch(() => {}); }
      renderSocial(); return;
    }
    if (act === 'lb-view') {
      _lbView = el.dataset.v || 'group';
      // Allow pane animation when user explicitly switches leaderboard view
      _socialPaneAnimPlayed = false;
      if (_lbView === 'global') { _loadGlobalLeaderboard().catch(() => {}); }
      renderSocial(); return;
    }
    if (act === 'theme-gallery') { _themeGalleryModal(); return; }
    if (act === 'theme-equip')   { applyTheme(el.dataset.tid); closeModal(); toast(`✨ Theme activated!`, 'success'); return; }
    if (act === 'social-nudge')  { _sNudge(el.dataset.uid, el.dataset.name).catch(() => {}); return; }
    if (act === 'social-duel')   { _sChallengeDuel(el.dataset.uid, el.dataset.name).catch(() => {}); return; }
    if (act === 'change-password')      { closeModal(); _handleChangePassword(); return; }
    if (act === 'delete-account')       { closeModal(); _authDeleteAccount(); return; }
    if (act === 'restore-from-cloud')   { _forceRestoreFromCloud(); return; }
    if (act === 'export-data-now')      { exportData(); return; }
    if (act === 'open-shop') { closeModal(); switchTab('shop'); renderShop(); return; }
    if (act === 'open-music-shop') { closeModal(); _shopCategory = 'music_track'; switchTab('shop'); renderShop(); return; }
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
    if (act === 'shop-buy')          { _shopBuy(el.dataset.iid);           return; }
    if (act === 'shop-confirm-buy')  { _shopConfirmBuy(el.dataset.iid);    return; }
    if (act === 'shop-equip')        { _shopEquip(el.dataset.iid);         return; }
    if (act === 'shop-unequip')      { _shopUnequip(el.dataset.iid);       return; }
    if (act === 'stg-unequip')       { _shopUnequip(el.dataset.iid); refreshSettingsIfOpen(); return; }
    if (act === 'shop-select-badge') { _shopSelectBadge(el.dataset.bid);   return; }
    if (act === 'shop-select-theme') { _shopSelectTheme(el.dataset.tid);   return; }
    // ── Daily Quests ─────────────────────────────────────────────────────
    if (act === 'quest-claim')      { _claimQuestXP(el.dataset.qid);   return; }
    if (act === 'focus-toggle') {
      if (!focusRunning && !focusOvertime && !_lsSubjectId) {
        toast('Please select a subject first', 'warn'); return;
      }
      if (focusRunning) {
        // Partial-credit: save elapsed minutes for work sessions stopped early
        if (focusMode === 'work' && focusStartTime !== null) {
          const elapsedMin = Math.round((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            _recordSubjectMinutes(elapsedMin);
            awardXP(elapsedMin, todayStr);
            _sContributeToGoals(elapsedMin).catch(() => {});
            checkBadges({ sessionMinutes: elapsedMin });
            saveState();
          }
        }
        if (_socialRoomCode && focusMode === 'work' && focusSeconds > 0) _sHandleFocusBounty().catch(() => {});
        if (_socialRoomCode) _sUpdatePresence('break').catch(() => {});
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
        updateMiniTimer();
        if (_socialRoomCode && _currentTab === 'social') renderSocial();
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
        if (_socialRoomCode && _currentTab === 'social') renderSocial();
      }
      renderFocus(); return;
    }
    if (act === 'focus-reset') {
      // Save any elapsed time before wiping the timer
      if (focusMode === 'work' && focusRunning && focusStartTime !== null) {
        const elapsedMin = Math.round((Date.now() - focusStartTime) / 1000 / 60);
        if (elapsedMin > 0) {
          const todayStr = todayKey();
          state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
          _recordSubjectMinutes(elapsedMin);
          awardXP(elapsedMin, todayStr);
          _sContributeToGoals(elapsedMin).catch(() => {});
          checkBadges({ sessionMinutes: elapsedMin });
          saveState();
        }
        if (_socialRoomCode && focusSeconds > 0) _sHandleFocusBounty().catch(() => {});
        if (_socialRoomCode) _sUpdatePresence('break').catch(() => {});
      }
      stopOvertimeMode(); clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusStartTime = null; focusStartSeconds = null; focusSeconds = customDurations[focusMode] * 60; focusMultitaskMode = false;
      renderFocus(); document.title = 'Syllabus Tracker'; updateMiniTimer();
      if (document.getElementById('view-stats') && document.getElementById('view-stats').classList.contains('active')) renderStats();
      return;
    }
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
          const elapsedMin = Math.round((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            _recordSubjectMinutes(elapsedMin);
            awardXP(elapsedMin, todayStr);
            _sContributeToGoals(elapsedMin).catch(() => {});
            checkBadges({ sessionMinutes: elapsedMin });
            saveState();
          }
        }
        if (_socialRoomCode && focusMode === 'work' && focusSeconds > 0) _sHandleFocusBounty().catch(() => {});
        if (_socialRoomCode) _sUpdatePresence('break').catch(() => {});
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
        if (_socialRoomCode && _currentTab === 'social') renderSocial();
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
        if (_socialRoomCode && _currentTab === 'social') renderSocial();
      }
      renderFullSession(); return;
    }
    if (act === 'fs-cycle-ambient') {
      const modes = SOUNDS.filter(s => !s.premium || _itemOwned(s.shopId)).map(s => s.id);
      ambientMode = modes[(modes.indexOf(ambientMode) + 1) % modes.length];
      startAmbient(ambientMode);
      if (_lsOverlayActive) { renderLiveOverlay(); } else { renderFullSession(); }
      return;
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
    if (act === 'suggest-topic-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); trackCompletion(`topic:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`, true); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
    if (act === 'suggest-open') { openSubjects.add(el.dataset.sub); openChapters.add(el.dataset.ch); switchTab('syllabus'); renderSyllabus(); return; }

    // Weak areas
    if (act === 'weak-mark-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); trackCompletion(`topic:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`, true); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
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
    if (act === 'toggle-notif-pref') {
      const key = el.dataset.key;
      if (key && key in state.notificationPrefs) {
        state.notificationPrefs[key] = el.checked;
        saveState();
        // Reschedule if a timing pref changed
        if (['studyReminder','pomodoroEnd','dailyGoal','streakWarning','taskDeadline'].includes(key)) {
          scheduleAllNotifications();
        }
      }
      return;
    }
    if (act === 'del-quote') { state.motivationQuotes.splice(parseInt(el.dataset.i, 10), 1); saveState(); if (_currentQuote && !state.motivationQuotes.includes(_currentQuote)) _currentQuote = null; _motivationIdx = 0; refreshSettingsIfOpen(); _refreshHomeMotiText(); toast('Quote removed', 'info'); return; }
    if (act === 'add-quote') { const input = document.getElementById('set-new-quote'), text = input ? input.value.trim() : ''; if (!text) { toast('Enter a quote first', 'warn'); return; } state.motivationQuotes.push(text); saveState(); _motivationIdx = state.motivationQuotes.length - 1; refreshSettingsIfOpen(); _refreshHomeMotiText(); if (input) input.value = ''; toast('Quote saved ✨', 'success'); return; }
    if (act === 'export-data') { closeModal(); exportData(); return; }
    if (act === 'backup-export') { exportData(); return; }
    if (act === 'eff-toggle') {
      const mode = el.dataset.mode || 'weekly';
      if (_effGraphMode === mode) return;
      _effGraphMode = mode;
      document.querySelectorAll('.eff-toggle-btn').forEach(b => b.classList.toggle('eff-toggle-active', b.dataset.mode === mode));
      _initEffChart(_effData[mode]);
      return;
    }
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
      const maxForMode = dmode === 'work' ? 2000 : (dmode === 'long' ? 120 : 60);
      if (dmode && !isNaN(val) && val >= 1 && val <= maxForMode) {
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

  // ── Suppress native browser context menu on chat bubbles (prevents Android Chrome duplicate popup) ──
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('.chat-bubble')) e.preventDefault();
  });

  // ── Long-press on chat bubbles → single bottom-sheet action menu ──
  let _lp = null;
  let _lpFired = false; // blocks the click that follows a long-press
  document.addEventListener('touchstart', e => {
    const bubble = e.target.closest('.chat-bubble[data-act="chat-msg-menu"]');
    if (!bubble) return;
    _lpFired = false;
    _lp = setTimeout(() => {
      _lp = null;
      _lpFired = true; // prevent the imminent touchend→click from re-opening the menu
      const msgId = bubble.dataset.msgid;
      if (navigator.vibrate) navigator.vibrate(30);
      _showChatMsgMenu(msgId);
    }, 480);
  }, { passive: true });
  document.addEventListener('touchend',   () => { if (_lp) { clearTimeout(_lp); _lp = null; } }, { passive: true });
  document.addEventListener('touchmove',  () => { if (_lp) { clearTimeout(_lp); _lp = null; } }, { passive: true });
  document.addEventListener('touchcancel',() => { if (_lp) { clearTimeout(_lp); _lp = null; } }, { passive: true });

  // Block the click event that fires right after a long-press (prevents menu showing twice)
  document.addEventListener('click', e => {
    if (!_lpFired) return;
    const bubble = e.target.closest('.chat-bubble[data-act="chat-msg-menu"]');
    if (bubble) { e.stopImmediatePropagation(); _lpFired = false; }
  }, true /* capture — runs before delegation */);


  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('vp-overlay')) { closeVideoPlayer(); return; }
      if (fsSessionActive) { exitFullSession(); stopAmbient(); ambientMode = 'none'; }
      else closeModal();
    }
    if (e.target && e.target.id === 'chat-text-input') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const inp = e.target;
        if (inp.value.trim()) { _sSendMessage(inp.value).catch(() => {}); inp.value = ''; inp.style.height = 'auto'; }
      }
      return;
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

  // pagehide fires on iOS/mobile when the app is swiped away or killed — more reliable than beforeunload
  window.addEventListener('pagehide', () => {
    if (focusRunning && focusMode === 'work' && focusStartTime !== null) {
      const _phElapsedSec = Math.floor((Date.now() - focusStartTime) / 1000);
      const _phElapsedMin = Math.round(_phElapsedSec / 60);
      if (_phElapsedMin > 0) {
        const _phToday = todayKey();
        state.focusStats.minutesByDate[_phToday] = (state.focusStats.minutesByDate[_phToday] || 0) + _phElapsedMin;
        // Synchronous localStorage save — only reliable method on pagehide
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
      }
    }
    // Best-effort: clear group presence so others stop seeing us as active.
    // Firestore offline persistence queues this write and sends it on next open.
    if (_db && _userId && _socialRoomCode && typeof firebase !== 'undefined') {
      try {
        _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
          .set({ isStudying: false, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
          .catch(() => {});
      } catch (_) {}
    }
  });

  window.addEventListener('beforeunload', e => {
    if (focusRunning || (_vfmActive && !_vfmComplete)) {
      e.preventDefault();
      e.returnValue = 'Timer is running! Your progress will be saved, but are you sure you want to leave?';
    }
  });

  // Orientation & resize — force layout recalculation so CSS media queries reapply cleanly
  function onOrientationChange() {
    setTimeout(() => {
      // Sync --vh and --real-vh for any CSS that needs exact viewport height
      const _vh = (window.innerHeight * 0.01) + 'px';
      document.documentElement.style.setProperty('--vh', _vh);
      document.documentElement.style.setProperty('--real-vh', _vh);
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
      const _vh2 = (window.innerHeight * 0.01) + 'px';
      document.documentElement.style.setProperty('--vh', _vh2);
      document.documentElement.style.setProperty('--real-vh', _vh2);
    });
  });
  // Set initial value
  const _vhInit = (window.innerHeight * 0.01) + 'px';
  document.documentElement.style.setProperty('--vh', _vhInit);
  document.documentElement.style.setProperty('--real-vh', _vhInit);

  // Mobile keyboard adjustment
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const kbH = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--kb-h', kbH + 'px');
      document.body.classList.toggle('kb-open', kbH > 80);
    });
  }

  // Page visibility — sync focus timer and social presence on tab hide/show
  document.addEventListener('visibilitychange', () => {
    // Toggle page-bg class so CSS pauses all animations while app is backgrounded
    document.body.classList.toggle('page-bg', document.hidden);
    if (document.visibilityState === 'visible') {
      _socialIsBg = false;
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
      // Immediately check midnight rollover (avoids up-to-60s delay from guarded interval)
      const _fgNow = todayKey();
      if (_fgNow !== _planDateKey) { _planDateKey = _fgNow; onMidnightReset(); }
      // Re-acquire alarm wake lock if alarm is still active
      if (_activeAlarmId && !_alarmWakeLock && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(wl => { _alarmWakeLock = wl; }).catch(() => {});
      }
      // Foreground: force immediate resync to catch any missed events + restore fast heartbeat
      if (_db && _userId && _socialRoomCode) {
        _socialLastInputAt = Date.now(); // reset idle clock on return
        _sUpdatePresence((focusRunning && focusMode === 'work') ? 'focusing' : 'break', { lastInput: Date.now() });
        _sSetHeartbeatRate(SOCIAL_HEARTBEAT_FAST_MS);
        // Re-subscribe listeners in case they were killed by the browser while backgrounded
        if (!_socialUnsubPresence || !_socialUnsubRoom) _sSubscribe();
      }
    } else {
      _socialIsBg = true;
      // Background: save focus progress so session isn't lost if app is killed
      if (focusRunning && focusMode === 'work' && focusStartTime !== null) {
        const _bgElapsedSec = Math.floor((Date.now() - focusStartTime) / 1000);
        const _bgRemaindSec = Math.max(0, focusStartSeconds - _bgElapsedSec);
        const _bgElapsedMin = Math.round((_bgElapsedSec) / 60);
        if (_bgElapsedMin > 0) {
          const _bgToday = todayKey();
          state.focusStats.minutesByDate[_bgToday] = (state.focusStats.minutesByDate[_bgToday] || 0) + _bgElapsedMin;
          _recordSubjectMinutes(_bgElapsedMin);
          awardXP(_bgElapsedMin, _bgToday);
          _sContributeToGoals(_bgElapsedMin).catch(() => {});
          checkBadges({ sessionMinutes: _bgElapsedMin });
          // Reset baseline so we don't double-count when coming back to foreground
          focusStartTime = Date.now();
          focusStartSeconds = _bgRemaindSec;
          focusSeconds = _bgRemaindSec;
          saveState();
        }
      }
      // Background: write offline/studying status to the members collection and slow the heartbeat.
      // This fixes the ghost-presence bug where a backgrounded tab still showed as "1 ACTIVE".
      if (_db && _userId && _socialRoomCode && typeof firebase !== 'undefined') {
        const _bgFocusing = focusRunning && focusMode === 'work';
        _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
          .set({
            isStudying:  _bgFocusing,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          }, { merge: true })
          .catch(() => {});
        _sSetHeartbeatRate(SOCIAL_HEARTBEAT_SLOW_MS);
      }
    }
  });

  // Network online/offline — force immediate resync on reconnect
  window.addEventListener('online', () => {
    console.log('[Social] Network back online — resyncing');
    if (_db && _userId && _socialRoomCode) {
      // Cancel any pending reconnect timer; resubscribe fresh
      if (_socialReconnectTimer) { clearTimeout(_socialReconnectTimer); _socialReconnectTimer = null; }
      _socialReconnectAttempts = 0;
      _sSubscribe();
      _sUpdatePresence((focusRunning && focusMode === 'work') ? 'focusing' : 'break');
    }
    // Re-render social lobby to remove offline banner
    if (_currentTab === 'social' && !_socialRoomCode) renderSocial();
  });
  window.addEventListener('offline', () => {
    console.warn('[Social] Network lost — clearing group presence immediately');
    // Immediately mark as not-studying so others see us go offline.
    // Firestore queues this and sends when connection is restored.
    if (_db && _userId && _socialRoomCode && typeof firebase !== 'undefined') {
      try {
        _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
          .set({ isStudying: false, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
          .catch(() => {});
      } catch (_) {}
    }
    // Re-render social lobby to show offline banner
    if (_currentTab === 'social' && !_socialRoomCode) renderSocial();
  });

  // ── Global presence heartbeat ─────────────────────────────────────────────
  // Runs every 15 s regardless of which tab is active. Keeps lastUpdated fresh
  // so that other clients' stale-detection (35 s threshold) correctly shows us
  // as active while our Pomodoro is running. Without this, navigating away from
  // the Social tab would stop all heartbeats and we'd appear offline after 35 s.
  setInterval(() => {
    if (!_db || !_userId || !_socialRoomCode || typeof firebase === 'undefined') return;
    const _hbFocusing = focusRunning && focusMode === 'work';
    if (!_hbFocusing) return; // only heartbeat while actively studying
    _db.collection('groups').doc(_socialRoomCode).collection('members').doc(_userId)
      .set({
        isStudying:  true,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
  }, 15000);

  // ═══════════════════════════════════════════════════════════
  //  Live-Study ↔ Main-App Bridge
  //  Called by live-study.js whenever it commits focus minutes/XP.
  //  Updates the in-memory state so tab-switches show fresh data.
  // ═══════════════════════════════════════════════════════════
  // ── Profile helpers exposed for social.js ─────────────────────────────────
  window._sc_calculateLevel = xp  => gamificationManager.calculateLevel(xp);
  window._sc_calculateRank  = hrs => calculateRank(hrs);
  window._sc_ACHIEVEMENTS   = ACHIEVEMENTS;
  window._sc_getMyState     = ()  => state;

  window._lsSync = function (data) {
    try {
      const { xpEarned, minutesEarned, today } = data || {};
      let dirty = false;
      if (minutesEarned > 0) {
        if (!state.focusStats) state.focusStats = {};
        if (!state.focusStats.minutesByDate) state.focusStats.minutesByDate = {};
        if (!state.focusStats.sessions)      state.focusStats.sessions = {};
        state.focusStats.minutesByDate[today] = (state.focusStats.minutesByDate[today] || 0) + minutesEarned;
        state.focusStats.sessions[today]      = (state.focusStats.sessions[today] || 0) + 1;
        dirty = true;
      }
      if (xpEarned > 0) {
        if (!state.xp || typeof state.xp !== 'object') state.xp = { total: 0 };
        state.xp.total = (state.xp.total || 0) + xpEarned;
        gamificationManager._updateXPBar();
        dirty = true;
      }
      if (dirty) {
        bumpActivity();
        saveState();
        _updateLiveStats();
        const t = _currentTab;
        if (t === 'stats')     renderStats();
        else if (t === 'home') renderHome();
        else if (t === 'dashboard') renderDashboard();
      }
    } catch (e) { console.warn('[_lsSync]', e); }
  };

  // ========== Init ==========
  function init() {
    _checkStreakReset();
    _migrateLegacyBadges();
    _initTheme();
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
