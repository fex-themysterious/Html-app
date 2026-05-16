/* ═══════════════════════════════════════════════════════
   Live Study Mode Engine
   - Count-up timer alongside existing Pomodoro
   - XP system, subject tracking, particles, character
   - 100% localStorage — no server needed
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────── */
  const LS_KEY         = 'liveStudy_v1';
  const MAIN_LS_KEY    = 'syllabus_tracker_v2';   // main app storage key
  const XP_PER_MINUTE  = 10;
  const STATUS_MSGS    = ['Focusing', 'Deep Work', 'Locked In', 'In The Zone', 'Grind Mode'];
  const DEEPWORK_MINS  = 25;

  const DEFAULT_SUBJECTS = [
    { id: 'math',    icon: '📐', name: 'Mathematics' },
    { id: 'sci',     icon: '🔬', name: 'Science' },
    { id: 'eng',     icon: '📖', name: 'English' },
    { id: 'hist',    icon: '🏛️', name: 'History' },
    { id: 'code',    icon: '💻', name: 'Coding' },
    { id: 'art',     icon: '🎨', name: 'Art' },
    { id: 'music',   icon: '🎵', name: 'Music' },
    { id: 'lang',    icon: '🌏', name: 'Language' },
    { id: 'free',    icon: '📝', name: 'Free Study' },
  ];

  const ALLOWED_APPS = [
    { id: 'notes',   icon: '📝', name: 'Notes' },
    { id: 'calc',    icon: '🔢', name: 'Calculator' },
    { id: 'dict',    icon: '📚', name: 'Dictionary' },
    { id: 'timer',   icon: '⏱️', name: 'Timer' },
    { id: 'music',   icon: '🎵', name: 'Music' },
    { id: 'pdf',     icon: '📄', name: 'PDF Reader' },
    { id: 'cam',     icon: '📷', name: 'Camera' },
    { id: 'none',    icon: '🚫', name: 'None' },
  ];

  /* ── State ─────────────────────────────────────────── */
  let state = {
    mode: 'pomodoro',
    running: false,
    sessionElapsed: 0,       // ms — total elapsed this session (persisted accurately)
    subjectElapsed: 0,       // ms — current subject total today
    todayElapsed: 0,         // ms — all subjects today
    sessionStart: null,      // wall-clock ms when last (re)started
    subject: null,
    currentTask: null,       // { key, text, meta, type, done } — selected today's-plan task
    xp: 0,                   // = mainAppXP + sessionXPEarned (display value)
    level: 1,
    streak: 0,
    lastStudyDate: null,
    lastXPMinute: 0,
    lastCommittedMins: 0,    // minutes already written to main app today
    sessionXPEarned: 0,      // XP earned in current live-study session (delta only)
    lastCommittedXP: 0,      // sessionXPEarned already written to main app
    mainAppXP: 0,            // main app XP at session start (base for display)
    subjectTimes: {},        // { subjectId: totalMs } accumulated per-subject today
    dday: { label: 'D-Day', date: null },
    allowedApps: [],
    customSubjects: [],
  };

  /* ── DOM refs ───────────────────────────────────────── */
  let overlay, timerEl, statusEl, subjectTimeEl, todayTimeEl;
  let pauseBtn, xpValEl, levelValEl, streakValEl, boostBadgeEl;
  let ddayBadge, ddayCount, characterSvg, auraEl;
  let pCanvas, pCtx, particleAnim, particles = [];
  let tickInterval = null;
  let statusRotateInterval = null;
  let statusIdx = 0;
  let isOnFocusTab = false;
  let focusViewObserver = null;

  /* ═══════════════════════════════════════════════════
     DATE HELPERS — must match main app's localISO()
  ═══════════════════════════════════════════════════ */
  // FIX: pad month and day so format is YYYY-MM-DD (matches main app)
  function todayStr() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // Study-day boundary is 6 AM: before 6am counts as the previous calendar day.
  function studyDayKey() {
    const d = new Date();
    if (d.getHours() < 6) d.setDate(d.getDate() - 1);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function calcStreak(prev, lastDate) {
    if (!lastDate) return 0;
    const today = todayStr();
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const ymm = String(yd.getMonth() + 1).padStart(2, '0');
    const ydd = String(yd.getDate()).padStart(2, '0');
    const yesterday = `${yd.getFullYear()}-${ymm}-${ydd}`;
    if (lastDate === yesterday) return (prev || 0) + 1;
    if (lastDate === today)     return prev || 0;
    return 0;
  }

  /* ═══════════════════════════════════════════════════
     XP BOOST — reads from main app shopBooster
  ═══════════════════════════════════════════════════ */
  function isBoosterActive() {
    try {
      const raw = localStorage.getItem(MAIN_LS_KEY);
      if (!raw) return false;
      const ms = JSON.parse(raw);
      const exp = ms.shopBooster && ms.shopBooster.expiresAt;
      return !!(exp && Date.now() < exp);
    } catch (_) { return false; }
  }

  /* ═══════════════════════════════════════════════════
     XP / LEVEL HELPERS  (mirrors gamificationManager)
  ═══════════════════════════════════════════════════ */
  function calcLevelFromXP(totalXP) {
    let level = 1, threshold = 0;
    while (true) {
      const needed = level * 100;
      if (totalXP < threshold + needed) return level;
      threshold += needed;
      level++;
      if (level > 9999) break;
    }
    return 9999;
  }

  // Read XP, level, streak from the main app's localStorage (source of truth).
  function syncBaseFromMainApp() {
    try {
      const raw = localStorage.getItem(MAIN_LS_KEY);
      if (!raw) return;
      const ms = JSON.parse(raw);
      state.mainAppXP = (ms.xp && typeof ms.xp.total === 'number') ? ms.xp.total : 0;
      state.streak    = (ms.streak && typeof ms.streak.count === 'number') ? ms.streak.count : 0;
      // Recompute display XP = mainAppXP + XP earned this session
      state.xp    = state.mainAppXP + (state.sessionXPEarned || 0);
      state.level = calcLevelFromXP(state.xp);
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════ */
  function init() {
    loadState();
    buildOverlay();
    injectModeSwitcher();
    watchFocusView();
    watchTabSwitches();

    // Recover from crash / page close without pause
    if (state.mode === 'live' && state.running && state.sessionStart) {
      const extra = Date.now() - state.sessionStart;
      state.sessionElapsed += extra;
      state.todayElapsed   += extra;   // FIX: also update today + subject
      state.subjectElapsed += extra;
      state.sessionStart = null;
      state.running = false;
      saveState();
    }

    updateOverlayState();
    updateTimerDisplay();
    updateXPDisplay();
    updateDDayDisplay();
  }

  /* ═══════════════════════════════════════════════════
     PERSISTENCE
  ═══════════════════════════════════════════════════ */
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const studyDay = studyDayKey();
        if (saved.lastStudyDate !== studyDay) {
          // New study-day (resets at 6 AM) — reset all daily counters
          saved.subjectElapsed    = 0;
          saved.todayElapsed      = 0;
          saved.lastXPMinute      = 0;
          saved.lastCommittedMins = 0;
          saved.sessionXPEarned   = 0;
          saved.lastCommittedXP   = 0;
          saved.subjectTimes      = {};
        }
        // sessionElapsed always starts fresh each time the overlay is opened
        saved.sessionElapsed  = 0;
        saved.sessionXPEarned = 0;
        saved.lastCommittedXP = 0;
        saved.lastXPMinute    = 0;
        Object.assign(state, saved);
        if (!state.subjectTimes || typeof state.subjectTimes !== 'object') state.subjectTimes = {};
      }
    } catch (_) {}
    // Always pull XP / level / streak from main app — it is the source of truth
    syncBaseFromMainApp();
  }

  function saveState() {
    state.lastStudyDate = studyDayKey();
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     SYNC TO MAIN APP
     Writes accumulated minutes + XP into syllabus_tracker_v2
     so stats, XP bar, streak, charts and heatmap all update.
  ═══════════════════════════════════════════════════ */
  function commitToMainApp() {
    const now = Date.now();
    const runningDelta = (state.running && state.sessionStart) ? now - state.sessionStart : 0;
    const totalTodayMs   = state.todayElapsed + runningDelta;
    const totalTodayMins = Math.floor(totalTodayMs / 60000);

    const minDelta = totalTodayMins - (state.lastCommittedMins || 0);
    const xpDelta  = (state.sessionXPEarned || 0) - (state.lastCommittedXP || 0);

    if (minDelta < 1 && xpDelta < 1) return;  // nothing new

    if (minDelta >= 1) state.lastCommittedMins = totalTodayMins;
    if (xpDelta  >= 1) state.lastCommittedXP   = state.sessionXPEarned;
    saveState();

    const today = todayStr();

    // ── Write to main app localStorage ────────────────
    try {
      const raw = localStorage.getItem(MAIN_LS_KEY);
      if (raw) {
        const ms = JSON.parse(raw);

        // Focus minutes
        if (!ms.focusStats) ms.focusStats = {};
        if (!ms.focusStats.minutesByDate) ms.focusStats.minutesByDate = {};
        if (!ms.focusStats.sessions)      ms.focusStats.sessions = {};
        if (minDelta >= 1) {
          ms.focusStats.minutesByDate[today] = (ms.focusStats.minutesByDate[today] || 0) + minDelta;
          ms.focusStats.sessions[today]      = (ms.focusStats.sessions[today] || 0) + 1;
        }

        // XP total
        if (xpDelta >= 1) {
          if (!ms.xp || typeof ms.xp !== 'object') ms.xp = { total: 0 };
          ms.xp.total = (ms.xp.total || 0) + xpDelta;
        }

        // Streak
        if (!ms.streak || typeof ms.streak !== 'object') ms.streak = { count: 0, lastDate: null };
        if (ms.streak.lastDate !== today) {
          const prevDate = ms.streak.lastDate;
          const yd = new Date(); yd.setDate(yd.getDate() - 1);
          const yesterday = `${yd.getFullYear()}-${String(yd.getMonth()+1).padStart(2,'0')}-${String(yd.getDate()).padStart(2,'0')}`;
          ms.streak.count    = (prevDate === yesterday) ? (ms.streak.count || 0) + 1 : 1;
          ms.streak.lastDate = today;
          if (!ms.streak.best || ms.streak.count > ms.streak.best) ms.streak.best = ms.streak.count;
        }

        // Activity flag
        if (!ms.activity) ms.activity = {};
        ms.activity[today] = (ms.activity[today] || 0) + 1;

        localStorage.setItem(MAIN_LS_KEY, JSON.stringify(ms));

        // Update live-study streak display to match main app
        state.streak = ms.streak.count;
        updateXPDisplay();
      }
    } catch (_) {}

    // ── Live-sync main app's in-memory state via the global bridge ──
    try {
      if (typeof window._lsSync === 'function') {
        window._lsSync({ xpEarned: xpDelta >= 1 ? xpDelta : 0, minutesEarned: minDelta >= 1 ? minDelta : 0, today });
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════
     BUILD OVERLAY DOM
  ═══════════════════════════════════════════════════ */
  function buildOverlay() {
    if (document.getElementById('lsm-overlay')) return;

    overlay = document.createElement('div');
    overlay.id = 'lsm-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    overlay.innerHTML = `
      <canvas id="lsm-particles" aria-hidden="true"></canvas>
      <div class="lsm-inner">

        <!-- TOP BAR -->
        <div class="lsm-top-bar">
          <button class="lsm-exit-btn" id="lsm-exit-btn" title="Exit">✕ Exit</button>
        </div>

        <!-- STATUS + TIMER -->
        <div class="lsm-status-area">
          <div class="lsm-status-text" id="lsm-status">Focusing</div>
          <div class="lsm-timer lsm-paused" id="lsm-timer">0:00:00</div>
          <div class="lsm-stats-row">
            <div class="lsm-stat-item">
              <div class="lsm-stat-label" id="lsm-subject-label">Subject</div>
              <div class="lsm-stat-value" id="lsm-subject-time">0:00:00</div>
            </div>
            <div class="lsm-stat-divider"></div>
            <div class="lsm-stat-item">
              <div class="lsm-stat-label">Today</div>
              <div class="lsm-stat-value" id="lsm-today-time">0:00:00</div>
            </div>
          </div>
        </div>

        <!-- XP HUD -->
        <div class="lsm-xp-hud">
          <div class="lsm-xp-item">
            <span class="lsm-xp-icon">⚡</span>
            <span>XP</span>
            <span class="lsm-xp-val" id="lsm-xp-val">0</span>
          </div>
          <div class="lsm-xp-divider"></div>
          <div class="lsm-xp-item">
            <span class="lsm-xp-icon">🏅</span>
            <span>Lv</span>
            <span class="lsm-xp-val" id="lsm-level-val">1</span>
          </div>
          <div class="lsm-xp-divider"></div>
          <div class="lsm-xp-item">
            <span class="lsm-xp-icon">🔥</span>
            <span>Streak</span>
            <span class="lsm-xp-val" id="lsm-streak-val">0</span>
          </div>
          <div class="lsm-boost-badge" id="lsm-boost-badge" style="display:none">
            <span>⚡ 2×</span>
          </div>
        </div>

        <!-- TODAY LOG — per-subject accumulated time -->
        <div class="lsm-today-log" id="lsm-today-log"></div>

        <!-- CURRENT TASK CHIP -->
        <div class="lsm-task-chip" id="lsm-task-chip">
          <span class="lsm-task-chip-icon">📋</span>
          <span class="lsm-task-chip-text" id="lsm-task-chip-text">Tap to select today's task</span>
          <span class="lsm-task-chip-arrow">›</span>
        </div>

        <!-- CHARACTER -->
        <div class="lsm-character-wrap">
          <div class="lsm-aura lsm-dim" id="lsm-aura"></div>
          ${buildCharacterSVG()}
        </div>

        <!-- CONTROLS -->
        <div class="lsm-controls">
          <button class="lsm-pause-btn" id="lsm-pause-btn" aria-label="Start / Pause">
            ${pauseIconSVG(false)}
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    /* Cache DOM refs */
    timerEl       = document.getElementById('lsm-timer');
    statusEl      = document.getElementById('lsm-status');
    subjectTimeEl = document.getElementById('lsm-subject-time');
    todayTimeEl   = document.getElementById('lsm-today-time');
    pauseBtn      = document.getElementById('lsm-pause-btn');
    xpValEl       = document.getElementById('lsm-xp-val');
    levelValEl    = document.getElementById('lsm-level-val');
    streakValEl   = document.getElementById('lsm-streak-val');
    boostBadgeEl  = document.getElementById('lsm-boost-badge');
    characterSvg  = overlay.querySelector('.lsm-character-svg');
    auraEl        = document.getElementById('lsm-aura');
    pCanvas       = document.getElementById('lsm-particles');
    pCtx          = pCanvas ? pCanvas.getContext('2d') : null;

    /* Events */
    pauseBtn.addEventListener('click', onPauseClick);
    document.getElementById('lsm-exit-btn').addEventListener('click', onExitClick);
    document.getElementById('lsm-task-chip').addEventListener('click', openTaskPicker);

    /* Restore task chip label if a task was previously selected */
    updateTaskChip();

    /* Canvas resize */
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { passive: true });
  }

  function buildCharacterSVG() {
    return `
    <svg class="lsm-character-svg" viewBox="0 0 200 170" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      <line x1="28" y1="132" x2="172" y2="132" stroke="var(--lsm-accent)" stroke-width="2.8" stroke-linecap="round"/>
      <line x1="45"  y1="132" x2="45"  y2="155" stroke="var(--lsm-accent)" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="155" y1="132" x2="155" y2="155" stroke="var(--lsm-accent)" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="110" y="116" width="38" height="4"  rx="1.5" fill="rgba(255,122,26,0.5)" stroke="var(--lsm-accent)" stroke-width="1.5"/>
      <rect x="112" y="111" width="34" height="4"  rx="1.5" fill="rgba(255,122,26,0.35)" stroke="var(--lsm-accent)" stroke-width="1.5"/>
      <rect x="115" y="106" width="28" height="4"  rx="1.5" fill="rgba(255,122,26,0.2)" stroke="var(--lsm-accent)" stroke-width="1.5"/>
      <line x1="90" y1="93"  x2="90" y2="128" stroke="var(--lsm-accent)" stroke-width="3" stroke-linecap="round"/>
      <g class="lsm-char-head">
        <circle cx="90" cy="76" r="16" stroke="var(--lsm-accent)" stroke-width="2.5"/>
        <path d="M78 70 Q82 60 90 62 Q98 60 102 70" stroke="var(--lsm-accent)" stroke-width="2" stroke-linecap="round" fill="none"/>
      </g>
      <line x1="90" y1="105" x2="55"  y2="126" stroke="var(--lsm-accent)" stroke-width="2.5" stroke-linecap="round"/>
      <g class="lsm-arm-r">
        <line x1="90" y1="105" x2="120" y2="124" stroke="var(--lsm-accent)" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="120" y1="124" x2="126" y2="130" stroke="var(--lsm-accent)" stroke-width="1.8" stroke-linecap="round"/>
      </g>
      <rect x="58" y="120" width="44" height="11" rx="2" fill="rgba(255,122,26,0.12)" stroke="var(--lsm-accent)" stroke-width="1.5"/>
      <line x1="63" y1="124" x2="96" y2="124" stroke="var(--lsm-accent)" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
      <line x1="63" y1="127" x2="88" y2="127" stroke="var(--lsm-accent)" stroke-width="1" stroke-linecap="round" opacity="0.3"/>
      <line x1="148" y1="132" x2="148" y2="86" stroke="var(--lsm-accent)" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="148" y1="86" x2="124" y2="72" stroke="var(--lsm-accent)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M114 72 Q124 58 134 72 Z" stroke="var(--lsm-accent)" stroke-width="2" stroke-linejoin="round" fill="rgba(255,122,26,0.18)"/>
      <circle cx="124" cy="75" r="14" fill="rgba(255,122,26,0.06)" class="lsm-lamp-glow"/>
      <circle class="lsm-dot" cx="62" cy="62" r="3.5" fill="var(--lsm-accent)" opacity="0.7"/>
      <circle class="lsm-dot" cx="52" cy="50" r="4.5" fill="var(--lsm-accent)" opacity="0.8"/>
      <circle class="lsm-dot" cx="40" cy="37" r="6"   fill="var(--lsm-accent)" opacity="0.9"/>
    </svg>`;
  }

  function pauseIconSVG(isRunning) {
    if (isRunning) {
      return `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
  }

  function resizeCanvas() {
    if (!pCanvas) return;
    pCanvas.width  = window.innerWidth;
    pCanvas.height = window.innerHeight;
  }

  /* ═══════════════════════════════════════════════════
     MODE SWITCHER injection into Focus view
  ═══════════════════════════════════════════════════ */
  function injectModeSwitcher() {
    const view = document.getElementById('view-focus');
    if (!view) return;
    removeModeSwitcher();
    const sw = document.createElement('div');
    sw.className = 'lsm-mode-switcher';
    sw.id = 'lsm-mode-switcher';
    sw.innerHTML = `
      <button class="lsm-mode-btn ${state.mode === 'pomodoro' ? 'active' : ''}" data-lsm-mode="pomodoro">⏱ Pomodoro</button>
      <button class="lsm-mode-btn ${state.mode === 'live'     ? 'active' : ''}" data-lsm-mode="live">▶ Live Study</button>
    `;
    sw.addEventListener('click', e => {
      const btn = e.target.closest('[data-lsm-mode]');
      if (!btn) return;
      setMode(btn.dataset.lsmMode);
    });
    view.insertBefore(sw, view.firstChild);
  }

  function removeModeSwitcher() {
    const existing = document.getElementById('lsm-mode-switcher');
    if (existing) existing.remove();
  }

  /* ═══════════════════════════════════════════════════
     MODE SWITCHING
  ═══════════════════════════════════════════════════ */
  function setMode(mode) {
    state.mode = mode;
    saveState();
    updateModeSwitcherUI();
    if (mode === 'live') {
      showOverlay();
    } else {
      hideOverlay();
    }
  }

  function updateModeSwitcherUI() {
    const sw = document.getElementById('lsm-mode-switcher');
    if (!sw) return;
    sw.querySelectorAll('.lsm-mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.lsmMode === state.mode);
    });
  }

  function showOverlay() {
    if (!overlay) return;
    overlay.classList.add('lsm-active');
    overlay.setAttribute('aria-hidden', 'false');
    if (pCanvas && pCtx) startParticles();
    updateOverlayState();
    updateTimerDisplay();
    updateXPDisplay();
    updateTodayLog();
  }

  // Exit: save progress, switch mode back to pomodoro, update switcher UI
  function onExitClick() {
    if (state.running) {
      pauseTimer();   // flush elapsed into state + updates subjectTimes
    }
    commitToMainApp();  // write to main app
    // Reset session-specific counters — today/subject accumulators are kept
    state.sessionElapsed  = 0;
    state.lastXPMinute    = 0;
    state.sessionXPEarned = 0;
    state.lastCommittedXP = 0;
    state.sessionStart    = null;
    syncBaseFromMainApp(); // re-sync XP base so next session starts fresh
    state.mode = 'pomodoro';
    saveState();
    updateModeSwitcherUI();
    hideOverlay();
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove('lsm-active');
    overlay.setAttribute('aria-hidden', 'true');
    stopParticles();
  }

  /* ═══════════════════════════════════════════════════
     TIMER ENGINE
  ═══════════════════════════════════════════════════ */
  function startTimer() {
    if (state.running) return;
    state.running      = true;
    state.sessionStart = Date.now();
    saveState();
    tickInterval = setInterval(tick, 1000);
    startStatusRotation();
    updateOverlayState();
  }

  function pauseTimer() {
    if (!state.running) return;
    clearInterval(tickInterval); tickInterval = null;
    const now   = Date.now();
    const delta = now - state.sessionStart;
    state.sessionElapsed  += delta;
    state.subjectElapsed  += delta;
    state.todayElapsed    += delta;
    // Persist per-subject time
    if (state.subject) {
      const sid = state.subject.id || state.subject.name;
      state.subjectTimes[sid] = state.subjectElapsed;
    }
    state.sessionStart    = null;
    state.running         = false;
    stopStatusRotation();
    commitToMainApp();   // ← write minutes to main app on every pause
    saveState();
    updateOverlayState();
    updateTodayLog();
  }

  function tick() {
    if (!state.running || !state.sessionStart) return;
    const now   = Date.now();
    const delta = now - state.sessionStart;

    // Live display values
    const totalSession = state.sessionElapsed + delta;
    const totalToday   = state.todayElapsed   + delta;
    const totalSubject = state.subjectElapsed + delta;

    updateTimerRaw(totalSession);
    if (subjectTimeEl) subjectTimeEl.textContent = formatHMS(totalSubject);
    if (todayTimeEl)   todayTimeEl.textContent   = formatHMS(totalToday);

    // XP: award every complete minute of SESSION time (doubled if XP Boost active)
    const elapsedMins = Math.floor(totalSession / 60000);
    if (elapsedMins > state.lastXPMinute) {
      const base   = (elapsedMins - state.lastXPMinute) * XP_PER_MINUTE;
      const earned = isBoosterActive() ? base * 2 : base;
      state.lastXPMinute = elapsedMins;
      awardXP(earned);
      commitToMainApp();   // ← write to main app every minute
    }

    // Deep work visual state
    if (elapsedMins >= DEEPWORK_MINS) {
      overlay.classList.add('lsm-deepwork');
    } else {
      overlay.classList.remove('lsm-deepwork');
    }

    // Periodic save every 30s — also update per-subject time map
    if (Math.floor(totalSession / 1000) % 30 === 0) {
      state.sessionElapsed = totalSession;
      state.todayElapsed   = totalToday;
      state.subjectElapsed = totalSubject;
      state.sessionStart   = now;
      // Persist per-subject accumulated time
      if (state.subject) {
        const sid = state.subject.id || state.subject.name;
        state.subjectTimes[sid] = totalSubject;
      }
      saveState();
      updateTodayLog();
    }
  }

  function updateTimerRaw(ms) {
    if (timerEl) timerEl.textContent = formatHMS(ms);
  }

  function updateTimerDisplay() {
    if (!timerEl) return;
    timerEl.textContent = formatHMS(state.sessionElapsed);
    if (subjectTimeEl) subjectTimeEl.textContent = formatHMS(state.subjectElapsed);
    if (todayTimeEl)   todayTimeEl.textContent   = formatHMS(state.todayElapsed);
  }

  function formatHMS(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h  = Math.floor(totalSec / 3600);
    const m  = Math.floor((totalSec % 3600) / 60);
    const s  = totalSec % 60;
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════════════════
     PAUSE BUTTON
  ═══════════════════════════════════════════════════ */
  function onPauseClick(e) {
    const btn  = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const rip  = document.createElement('span');
    rip.className = 'lsm-ripple';
    const size = Math.max(btn.offsetWidth, btn.offsetHeight);
    rip.style.cssText = `width:${size}px;height:${size}px;top:${e.clientY-rect.top-size/2}px;left:${e.clientX-rect.left-size/2}px`;
    btn.appendChild(rip);
    setTimeout(() => rip.remove(), 600);
    if (state.running) pauseTimer();
    else               startTimer();
  }

  function updateOverlayState() {
    if (!overlay) return;
    overlay.classList.toggle('lsm-is-paused', !state.running);
    if (!pauseBtn) return;
    pauseBtn.classList.toggle('lsm-is-running', state.running);
    pauseBtn.innerHTML = pauseIconSVG(state.running);
    if (timerEl)      timerEl.classList.toggle('lsm-paused', !state.running);
    if (statusEl)     statusEl.classList.toggle('lsm-running', state.running);
    if (auraEl)       auraEl.classList.toggle('lsm-dim', !state.running);
    if (characterSvg) characterSvg.classList.toggle('lsm-paused', !state.running);
  }

  /* ═══════════════════════════════════════════════════
     STATUS TEXT ROTATION
  ═══════════════════════════════════════════════════ */
  function startStatusRotation() {
    stopStatusRotation();
    statusIdx = 0;
    if (statusEl) statusEl.textContent = STATUS_MSGS[statusIdx];
    statusRotateInterval = setInterval(() => {
      statusIdx = (statusIdx + 1) % STATUS_MSGS.length;
      if (statusEl) {
        statusEl.style.opacity = '0';
        setTimeout(() => {
          if (statusEl) {
            statusEl.textContent = STATUS_MSGS[statusIdx];
            statusEl.style.opacity = '1';
          }
        }, 300);
      }
    }, 8000);
  }

  function stopStatusRotation() {
    clearInterval(statusRotateInterval);
    statusRotateInterval = null;
    if (statusEl) statusEl.textContent = 'Focusing';
  }

  /* ═══════════════════════════════════════════════════
     XP SYSTEM — synced with main app
  ═══════════════════════════════════════════════════ */
  function awardXP(amount) {
    if (!amount || amount <= 0) return;
    state.sessionXPEarned = (state.sessionXPEarned || 0) + amount;
    // Display value = main app base + everything earned this session
    state.xp    = (state.mainAppXP || 0) + state.sessionXPEarned;
    state.level = calcLevelFromXP(state.xp);
    updateXPDisplay();
    showXPPopup(amount);
    saveState();
  }

  function updateXPDisplay() {
    // XP shows only what was earned THIS session (starts at 0)
    const earned = state.sessionXPEarned || 0;
    if (xpValEl)     xpValEl.textContent     = earned >= 1000 ? (earned/1000).toFixed(1)+'k' : earned;
    if (levelValEl)  levelValEl.textContent  = state.level;
    if (streakValEl) streakValEl.textContent = state.streak;
    // Show/hide XP boost badge
    if (boostBadgeEl) {
      const active = isBoosterActive();
      boostBadgeEl.style.display = active ? 'flex' : 'none';
    }
  }

  function showXPPopup(amount) {
    if (!overlay || !overlay.classList.contains('lsm-active')) return;
    const el = document.createElement('div');
    el.className = 'lsm-xp-popup';
    const boostLabel = isBoosterActive() ? ' ⚡2×' : '';
    el.textContent = `+${amount} XP${boostLabel}`;
    el.style.cssText = `top:${40 + Math.random()*30}%;left:${30+Math.random()*40}%`;
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  /* ═══════════════════════════════════════════════════
     TODAY LOG — per-subject breakdown panel
  ═══════════════════════════════════════════════════ */
  function updateTodayLog() {
    const el = document.getElementById('lsm-today-log');
    if (!el) return;
    const times = state.subjectTimes || {};
    const allSubjects = [...DEFAULT_SUBJECTS, ...(state.customSubjects || [])];

    // Only list subjects with non-zero time today
    const studied = allSubjects.filter(s => times[s.id] && times[s.id] > 0);
    if (studied.length === 0) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }

    const totalMs = Object.values(times).reduce((a, b) => a + b, 0);
    const maxMs   = Math.max(...studied.map(s => times[s.id]));

    const rows = studied.map(s => {
      const ms  = times[s.id];
      const pct = maxMs > 0 ? Math.round((ms / maxMs) * 100) : 0;
      return `
        <div class="lsm-log-row">
          <span class="lsm-log-icon">${s.icon}</span>
          <div class="lsm-log-bar-wrap">
            <div class="lsm-log-label">${s.name}</div>
            <div class="lsm-log-bar-track">
              <div class="lsm-log-bar-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <span class="lsm-log-time">${formatHMS(ms)}</span>
        </div>`;
    }).join('');

    el.style.display = 'block';
    el.innerHTML = `
      <div class="lsm-log-header">📊 Today's Study Log</div>
      ${rows}
      <div class="lsm-log-total">
        <span>Total</span>
        <span>${formatHMS(totalMs)}</span>
      </div>`;
  }

  /* ═══════════════════════════════════════════════════
     D-DAY
  ═══════════════════════════════════════════════════ */
  function updateDDayDisplay() {
    if (!ddayCount || !ddayBadge) return;
    if (!state.dday.date) {
      ddayCount.textContent = '—';
      const lbl = document.getElementById('lsm-dday-label');
      if (lbl) lbl.textContent = 'D-Day';
      return;
    }
    const target = new Date(state.dday.date);
    const now    = new Date();
    const diff   = Math.ceil((target - now) / (1000*60*60*24));
    const lbl = document.getElementById('lsm-dday-label');
    if (lbl) lbl.textContent = state.dday.label || 'D-Day';
    if (diff > 0)        ddayCount.textContent = `-${diff}`;
    else if (diff === 0) ddayCount.textContent = 'TODAY';
    else                 ddayCount.textContent = `+${Math.abs(diff)}`;
  }

  function openDDayModal() {
    const modal = createModal('Set Exam Date', `
      <p class="lsm-dday-info">Set your exam date to track how many days remain.</p>
      <input class="lsm-modal-input" type="text" id="lsm-dday-name" placeholder="Exam name (e.g. Mid-Term)" value="${state.dday.label || ''}"/>
      <input class="lsm-modal-input" type="date" id="lsm-dday-date" value="${state.dday.date || ''}"/>
      <button class="lsm-modal-btn" id="lsm-dday-save">Save</button>
    `);
    document.getElementById('lsm-dday-save').addEventListener('click', () => {
      state.dday.label = document.getElementById('lsm-dday-name').value.trim() || 'D-Day';
      state.dday.date  = document.getElementById('lsm-dday-date').value;
      saveState();
      updateDDayDisplay();
      closeModal(modal);
    });
  }

  /* ═══════════════════════════════════════════════════
     TASK CHIP DISPLAY
  ═══════════════════════════════════════════════════ */
  function updateTaskChip() {
    const el = document.getElementById('lsm-task-chip-text');
    if (!el) return;
    if (state.currentTask) {
      const done = state.currentTask.done ? '✅ ' : '';
      el.textContent = done + state.currentTask.text;
      const chip = document.getElementById('lsm-task-chip');
      if (chip) {
        chip.classList.toggle('lsm-task-done', !!state.currentTask.done);
        chip.querySelector('.lsm-task-chip-icon').textContent = state.currentTask.done ? '✅' : '📌';
      }
    } else {
      el.textContent = "Tap to select today's task";
      const chip = document.getElementById('lsm-task-chip');
      if (chip) {
        chip.classList.remove('lsm-task-done');
        chip.querySelector('.lsm-task-chip-icon').textContent = '📋';
      }
    }
  }

  /* ═══════════════════════════════════════════════════
     READ TODAY'S PLAN TASKS FROM MAIN APP LOCALSTORAGE
  ═══════════════════════════════════════════════════ */
  function getTodayTasks() {
    try {
      const raw = localStorage.getItem(MAIN_LS_KEY);
      if (!raw) return [];
      const ms = JSON.parse(raw);

      // Build a today key matching the main app's localISO()
      const d   = new Date();
      const mm  = String(d.getMonth() + 1).padStart(2, '0');
      const dd2 = String(d.getDate()).padStart(2, '0');
      const today = `${d.getFullYear()}-${mm}-${dd2}`;

      const plan = ms.dailyPlans && ms.dailyPlans[today];
      if (!plan) return [];

      const tasks = [];
      const subjectsArr = ms.subjects || [];

      // Helper finders
      const findSub = id => subjectsArr.find(s => s.id === id);
      const findCh  = (sId, cId) => { const s = findSub(sId); return s && s.chapters.find(c => c.id === cId); };
      const findTop = (sId, cId, tId) => { const c = findCh(sId, cId); return c && c.topics.find(t => t.id === tId); };

      // Auto tasks (from syllabus)
      for (const a of (plan.auto || [])) {
        if ((plan.removed || []).includes(`${a.subId}:${a.chId}:${a.tId}`)) continue;
        const sub = findSub(a.subId), ch = findCh(a.subId, a.chId), t = findTop(a.subId, a.chId, a.tId);
        if (!sub || !ch || !t) continue;
        tasks.push({
          type: 'auto',
          key:  `${a.subId}:${a.chId}:${a.tId}`,
          text: t.name,
          meta: `${sub.name} · ${ch.name}`,
          color: sub.color || '#ff7a1a',
          done:  !!t.done,
        });
      }

      // Custom tasks
      for (const c of (plan.custom || [])) {
        tasks.push({
          type:  'custom',
          key:   c.id,
          text:  c.text,
          meta:  c.rolledOver ? 'Rolled over' : c.recurringId ? 'Daily task' : 'Custom task',
          color: c.rolledOver ? '#f59e0b' : c.recurringId ? '#818cf8' : '#94a3b8',
          done:  !!c.done,
        });
      }
      return tasks;
    } catch (_) { return []; }
  }

  /* ═══════════════════════════════════════════════════
     TASK PICKER MODAL
  ═══════════════════════════════════════════════════ */
  function openTaskPicker() {
    const tasks = getTodayTasks();

    let bodyHTML;
    if (tasks.length === 0) {
      bodyHTML = `<div class="lsm-task-empty">
        <div class="lsm-task-empty-icon">📭</div>
        <div class="lsm-task-empty-msg">No tasks in today's plan yet.<br>Add tasks from the Dashboard tab first.</div>
      </div>`;
    } else {
      const rows = tasks.map(t => `
        <div class="lsm-modal-row lsm-task-row ${state.currentTask?.key === t.key ? 'active' : ''} ${t.done ? 'lsm-task-row-done' : ''}"
             data-task-key="${t.key}">
          <span class="lsm-task-row-dot" style="background:${t.color}"></span>
          <div class="lsm-modal-row-body">
            <div class="lsm-modal-row-title">${t.done ? '<s>' : ''}${t.text}${t.done ? '</s>' : ''}</div>
            <div class="lsm-modal-row-sub">${t.meta}</div>
          </div>
          <span class="lsm-modal-check">${t.done ? '✅' : (state.currentTask?.key === t.key ? '✓' : '')}</span>
        </div>
      `).join('');
      bodyHTML = rows + `
        <div class="lsm-task-clear-wrap">
          <button class="lsm-task-clear-btn" id="lsm-task-clear">Clear selection</button>
        </div>`;
    }

    const modal = createModal("Today's Tasks", bodyHTML);

    modal.querySelectorAll('[data-task-key]').forEach(row => {
      row.addEventListener('click', () => {
        const key  = row.dataset.taskKey;
        const task = tasks.find(t => t.key === key);
        if (!task) return;
        state.currentTask = task;
        // Auto-sync subject label with task subject
        const metaParts = task.meta.split(' · ');
        if (metaParts[0]) {
          const lbl = document.getElementById('lsm-subject-label');
          if (lbl) lbl.textContent = metaParts[0];
        }
        saveState();
        updateTaskChip();
        closeModal(modal);
      });
    });

    const clearBtn = document.getElementById('lsm-task-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        state.currentTask = null;
        saveState();
        updateTaskChip();
        closeModal(modal);
      });
    }
  }

  /* ═══════════════════════════════════════════════════
     SUBJECT PICKER
  ═══════════════════════════════════════════════════ */
  function openSubjectPicker() {
    const all = [...DEFAULT_SUBJECTS, ...state.customSubjects];
    const rows = all.map(s => `
      <div class="lsm-modal-row ${state.subject?.id === s.id ? 'active' : ''}" data-subject-id="${s.id}">
        <span class="lsm-modal-row-icon">${s.icon}</span>
        <div class="lsm-modal-row-body">
          <div class="lsm-modal-row-title">${s.name}</div>
          <div class="lsm-modal-row-sub">${formatHMS((state.subjectTimes && state.subjectTimes[s.id]) || 0)} today</div>
        </div>
        <span class="lsm-modal-check">✓</span>
      </div>
    `).join('');

    const modal = createModal('Choose Subject', `
      ${rows}
      <div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:14px">
        <input class="lsm-modal-input" type="text" id="lsm-new-subj" placeholder="➕ Add custom subject..."/>
        <button class="lsm-modal-btn" id="lsm-add-subj-btn" style="background:rgba(255,255,255,0.08);box-shadow:none">Add Subject</button>
      </div>
    `);

    modal.querySelectorAll('[data-subject-id]').forEach(row => {
      row.addEventListener('click', () => {
        const subj = all.find(s => s.id === row.dataset.subjectId);
        if (!subj) return;
        if (!state.subject || state.subject.id !== subj.id) {
          // Restore accumulated time for this subject (0 if never studied today)
          state.subjectElapsed = (state.subjectTimes && state.subjectTimes[subj.id]) || 0;
        }
        state.subject = subj;
        const lbl = document.getElementById('lsm-subject-label');
        if (lbl) lbl.textContent = subj.name;
        saveState();
        closeModal(modal);
      });
    });

    document.getElementById('lsm-add-subj-btn').addEventListener('click', () => {
      const name = document.getElementById('lsm-new-subj').value.trim();
      if (!name) return;
      const custom = { id: 'c_' + Date.now(), icon: '📓', name };
      state.customSubjects.push(custom);
      saveState();
      closeModal(modal);
      openSubjectPicker();
    });
  }

  /* ═══════════════════════════════════════════════════
     ALLOWED APPS MODAL
  ═══════════════════════════════════════════════════ */
  function openAllowedApps() {
    const items = ALLOWED_APPS.map(a => `
      <div class="lsm-app-item ${state.allowedApps.includes(a.id) ? 'selected' : ''}" data-app-id="${a.id}">
        <div class="lsm-app-icon">${a.icon}</div>
        <div class="lsm-app-name">${a.name}</div>
      </div>
    `).join('');

    const modal = createModal('Allowed Apps', `
      <p class="lsm-dday-info">Select apps allowed during study session.</p>
      <div class="lsm-apps-grid">${items}</div>
      <button class="lsm-modal-btn" id="lsm-apps-save">Done</button>
    `);

    modal.querySelectorAll('[data-app-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.appId;
        item.classList.toggle('selected');
        if (state.allowedApps.includes(id)) {
          state.allowedApps = state.allowedApps.filter(a => a !== id);
        } else {
          state.allowedApps.push(id);
        }
      });
    });

    document.getElementById('lsm-apps-save').addEventListener('click', () => {
      saveState();
      closeModal(modal);
    });
  }

  /* ═══════════════════════════════════════════════════
     MODAL HELPERS
  ═══════════════════════════════════════════════════ */
  function createModal(title, bodyHTML) {
    const backdrop = document.createElement('div');
    backdrop.className = 'lsm-modal-backdrop';
    backdrop.innerHTML = `
      <div class="lsm-modal">
        <div class="lsm-modal-handle"></div>
        <div class="lsm-modal-title">${title}</div>
        ${bodyHTML}
      </div>
    `;
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeModal(backdrop);
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function closeModal(el) {
    if (el && el.parentNode) el.remove();
  }

  /* ═══════════════════════════════════════════════════
     PARTICLE SYSTEM
  ═══════════════════════════════════════════════════ */
  function startParticles() {
    stopParticles();
    particles = Array.from({ length: window.innerWidth < 480 ? 18 : 28 }, () => makeParticle());
    function loop() {
      if (!pCtx || !pCanvas) return;
      pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
      const r=255, g=122, b=26;
      particles.forEach(p => {
        p.y  += p.vy;
        p.x  += p.vx;
        p.life -= p.decay;
        if (p.life <= 0) Object.assign(p, makeParticle());
        pCtx.save();
        pCtx.globalAlpha = Math.max(0, p.life) * 0.6;
        pCtx.shadowBlur  = 8;
        pCtx.shadowColor = `rgba(${r},${g},${b},0.9)`;
        pCtx.fillStyle   = `rgba(${r},${Math.min(255,g+80)},0,1)`;
        pCtx.beginPath();
        pCtx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        pCtx.fill();
        pCtx.globalAlpha *= 0.35;
        pCtx.beginPath();
        pCtx.arc(p.x - p.vx*3, p.y - p.vy*3, p.size * 0.7, 0, Math.PI*2);
        pCtx.fill();
        pCtx.restore();
      });
      particleAnim = requestAnimationFrame(loop);
    }
    loop();
  }

  function stopParticles() {
    if (particleAnim) { cancelAnimationFrame(particleAnim); particleAnim = null; }
    if (pCtx && pCanvas) pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
  }

  function makeParticle() {
    const W = window.innerWidth, H = window.innerHeight;
    return {
      x:    Math.random() * W,
      y:    H * 0.3 + Math.random() * H * 0.6,
      vx:   (Math.random() - 0.5) * 0.5,
      vy:   -(0.3 + Math.random() * 0.9),
      size: 1 + Math.random() * 2,
      life: 0.4 + Math.random() * 0.6,
      decay: 0.003 + Math.random() * 0.004,
    };
  }

  /* ═══════════════════════════════════════════════════
     FOCUS VIEW OBSERVER
  ═══════════════════════════════════════════════════ */
  function watchFocusView() {
    const view = document.getElementById('view-focus');
    if (!view) { setTimeout(watchFocusView, 300); return; }
    let debounce = null;
    focusViewObserver = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!document.getElementById('lsm-mode-switcher')) injectModeSwitcher();
        if (state.mode === 'live') updateModeSwitcherUI();
        if (state.subject && document.getElementById('lsm-subject-label')) {
          document.getElementById('lsm-subject-label').textContent = state.subject.name;
        }
      }, 60);
    });
    focusViewObserver.observe(view, { childList: true, subtree: false });
  }

  /* ═══════════════════════════════════════════════════
     TAB WATCHER
  ═══════════════════════════════════════════════════ */
  function watchTabSwitches() {
    const bodyObs = new MutationObserver(() => {
      const onFocus = document.body.classList.contains('tab-focus');
      if (onFocus && !isOnFocusTab) {
        isOnFocusTab = true;
        if (state.mode === 'live') showOverlay();
        if (!document.getElementById('lsm-mode-switcher')) injectModeSwitcher();
      } else if (!onFocus && isOnFocusTab) {
        isOnFocusTab = false;
        if (state.mode === 'live' && state.running) {
          // Keep timer running in background, just hide overlay
          overlay.classList.remove('lsm-active');
          stopParticles();
        } else {
          hideOverlay();
        }
      }
    });
    bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    isOnFocusTab = document.body.classList.contains('tab-focus');
  }

  /* ═══════════════════════════════════════════════════
     PAGE LIFECYCLE — crash protection
  ═══════════════════════════════════════════════════ */

  // FIX: save elapsed on page hide (reload, tab close, back button)
  window.addEventListener('pagehide', () => {
    if (state.mode === 'live' && state.running && state.sessionStart) {
      const extra = Date.now() - state.sessionStart;
      state.sessionElapsed += extra;
      state.todayElapsed   += extra;
      state.subjectElapsed += extra;
      state.sessionStart = Date.now();  // reset so recovery works
      // Commit minutes + XP to main app synchronously on page hide
      commitToMainApp();
      saveState();
    }
  });

  // FIX: re-sync elapsed on tab return (handles background throttling)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Re-sync: nothing special needed since tick() uses wall-clock delta
      if (state.mode === 'live' && state.running) {
        // Just update display immediately
        if (state.sessionStart) {
          const delta = Date.now() - state.sessionStart;
          updateTimerRaw(state.sessionElapsed + delta);
          if (subjectTimeEl) subjectTimeEl.textContent = formatHMS(state.subjectElapsed + delta);
          if (todayTimeEl)   todayTimeEl.textContent   = formatHMS(state.todayElapsed   + delta);
        }
      }
    } else {
      // Going to background: flush to main app
      if (state.mode === 'live' && state.running) {
        commitToMainApp();
      }
    }
  });

  /* ═══════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════ */
  function boot() {
    init();
    if (document.body.classList.contains('tab-focus') && state.mode === 'live') {
      showOverlay();
    }
  }

  function maybeAutoNav() {
    const hash = window.location.hash;
    if (hash === '#focus' || hash === '#live') {
      setTimeout(() => {
        const btn = document.querySelector('.nav-btn[data-tab="focus"]');
        if (btn) btn.click();
        if (hash === '#live') setTimeout(() => setMode('live'), 200);
      }, 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(boot, 200); maybeAutoNav(); });
  } else {
    setTimeout(boot, 200);
    maybeAutoNav();
  }

})();
