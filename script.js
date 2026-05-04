(() => {
  'use strict';

  // ========== State ==========
  const STORAGE_KEY = 'syllabus_tracker_v2';
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const DEFAULT_CHECKLIST_LABELS = ['Basic', 'MCQ', 'CQ', 'SQ'];
  function makeDefaultChecklist() {
    return DEFAULT_CHECKLIST_LABELS.map(label => ({ id: uid(), label, checked: false }));
  }

  function defaultState() {
    return {
      subjects: [
        seedSubject('Mathematics', '#38bdf8', [
          { name: 'Differential Calculus', priority: 'high', topics: ['Limits', 'Derivatives', 'Applications'] },
          { name: 'Matrices & Determinants', priority: 'high', topics: ['Operations', 'Inverse', 'Rank'] },
          { name: 'Sequences & Series', priority: 'medium', topics: ['AP/GP', 'Convergence'] },
        ]),
        seedSubject('Biology', '#34d399', [
          { name: 'Cell Biology', priority: 'high', topics: ['Cell Structure', 'Cell Cycle'] },
          { name: 'Genetics', priority: 'medium', topics: ['Mendel Laws', 'DNA Structure'] },
        ]),
        seedSubject('Physics', '#a78bfa', [
          { name: 'Mechanics', priority: 'medium', topics: ['Kinematics', 'Newton Laws'] },
        ])
      ],
      exams: [{ id: uid(), name: 'Mid-Term Exam', date: nextDateISO(30) }],
      motivationQuotes: [
        "Small steps every day lead to big results.",
        "Discipline beats motivation.",
        "You don't have to be perfect, just consistent.",
        "Future you is watching. Make them proud.",
        "One topic at a time. Keep going.",
      ],
      streak: { count: 1, lastDate: todayKey() },
      activity: { [todayKey()]: 0 },
      dailyPlans: {},
      calendarTasks: {},
      smartReminder: { enabled: false, times: ['20:00'], lastFired: {} },
      motivationReminders: { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} },
      revisions: [],
      burnout: {
        installDate: todayKey(),
        popupDismissedDate: null,
        bannerDismissedDate: null,
      },
      goals: []
    };
  }

  function seedSubject(name, color, chapters) {
    return {
      id: uid(), name, color, notes: '', priority: null,
      revisionCount: 0, lastRevisedAt: null,
      checklist: makeDefaultChecklist(),
      chapters: chapters.map(c => ({
        id: uid(), name: c.name, notes: '', priority: c.priority || null,
        revisionCount: 0, lastRevisedAt: null, done: false, scheduledDate: null,
        checklist: makeDefaultChecklist(),
        topics: (c.topics || []).map(t => ({ id: uid(), name: t, notes: '', done: false, priority: null, revisionCount: 0, lastRevisedAt: null, skipCount: 0, firstSeenAt: todayKey(), lastSkippedAt: null }))
      }))
    };
  }
  function nextDateISO(d) { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('Load state failed:', e);
      return defaultState();
    }
  }
  function migrate(s) {
    s.subjects = (s.subjects || []).map(sub => ({
      id: sub.id || uid(),
      name: sub.name || 'Subject',
      color: sub.color || '#38bdf8',
      notes: sub.notes || '',
      priority: sub.priority || null,
      revisionCount: sub.revisionCount || 0,
      lastRevisedAt: sub.lastRevisedAt || null,
      checklist: Array.isArray(sub.checklist) && sub.checklist.length
        ? sub.checklist.map(it => ({
            id: it.id || uid(),
            label: typeof it.label === 'string' ? it.label : 'Item',
            checked: !!it.checked,
          }))
        : makeDefaultChecklist(),
      chapters: (sub.chapters || []).map(c => ({
        id: c.id || uid(),
        name: c.name || 'Chapter',
        notes: c.notes || '',
        priority: c.priority || null,
        revisionCount: c.revisionCount || 0,
        lastRevisedAt: c.lastRevisedAt || null,
        done: !!c.done,
        scheduledDate: c.scheduledDate || null,
        checklist: Array.isArray(c.checklist) && c.checklist.length
          ? c.checklist.map(it => ({
              id: it.id || uid(),
              label: typeof it.label === 'string' ? it.label : 'Item',
              checked: !!it.checked,
            }))
          : makeDefaultChecklist(),
        topics: (c.topics || []).map(t => ({
          id: t.id || uid(),
          name: t.name || 'Topic',
          notes: t.notes || '',
          done: !!t.done,
          priority: t.priority || null,
          revisionCount: t.revisionCount || 0,
          lastRevisedAt: t.lastRevisedAt || null,
          skipCount: typeof t.skipCount === 'number' ? t.skipCount : 0,
          firstSeenAt: t.firstSeenAt || todayKey(),
          lastSkippedAt: t.lastSkippedAt || null,
        }))
      }))
    }));
    s.exams = s.exams || [];
    delete s.reminders;
    s.motivationQuotes = (s.motivationQuotes && s.motivationQuotes.length) ? s.motivationQuotes : defaultState().motivationQuotes;
    s.streak = s.streak || { count: 0, lastDate: null };
    s.activity = s.activity || {};
    s.dailyPlans = s.dailyPlans || {};
    s.calendarTasks = s.calendarTasks && typeof s.calendarTasks === 'object' ? s.calendarTasks : {};
    for (const k in s.calendarTasks) {
      s.calendarTasks[k] = (s.calendarTasks[k] || []).map(t => ({
        id: t.id || uid(),
        text: typeof t.text === 'string' ? t.text : '',
        done: !!t.done,
        createdAt: t.createdAt || todayKey(),
      }));
    }
    s.smartReminder = s.smartReminder || { enabled: false, times: ['20:00'], lastFired: {} };
    if (typeof s.smartReminder.enabled !== 'boolean') s.smartReminder.enabled = false;
    // Migrate old single-time format → multi-time array.
    if (!Array.isArray(s.smartReminder.times)) {
      s.smartReminder.times = s.smartReminder.time ? [s.smartReminder.time] : ['20:00'];
    }
    if (!s.smartReminder.times.length) s.smartReminder.times = ['20:00'];
    delete s.smartReminder.time;
    if (!s.smartReminder.lastFired || typeof s.smartReminder.lastFired !== 'object') {
      s.smartReminder.lastFired = {};
    }
    delete s.smartReminder.lastFiredDate;

    s.motivationReminders = s.motivationReminders || { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} };
    if (typeof s.motivationReminders.enabled !== 'boolean') s.motivationReminders.enabled = false;
    if (!Array.isArray(s.motivationReminders.times) || !s.motivationReminders.times.length) {
      s.motivationReminders.times = ['09:00', '14:00', '20:00'];
    }
    if (!s.motivationReminders.lastFired || typeof s.motivationReminders.lastFired !== 'object') {
      s.motivationReminders.lastFired = {};
    }

    // Strip legacy gamification (XP / level / badges) — feature removed.
    delete s.gamification;
    s.burnout = s.burnout || {};
    if (!s.burnout.installDate) {
      const actDates = Object.keys(s.activity || {}).sort();
      s.burnout.installDate = actDates[0] || todayKey();
    }
    if (typeof s.burnout.popupDismissedDate === 'undefined') s.burnout.popupDismissedDate = null;
    if (typeof s.burnout.bannerDismissedDate === 'undefined') s.burnout.bannerDismissedDate = null;
    s.goals = Array.isArray(s.goals) ? s.goals.map(g => ({
      id: g.id || uid(),
      name: g.name || '',
      subjectId: g.subjectId || null,
      durationDays: Math.max(1, parseInt(g.durationDays, 10) || 1),
      startDate: g.startDate || todayKey(),
      targetDate: g.targetDate || addDaysISO(g.startDate || todayKey(), Math.max(1, parseInt(g.durationDays, 10) || 1)),
      createdAt: g.createdAt || todayKey(),
      completedAt: g.completedAt || null,
    })) : [];
    s.revisions = (s.revisions || []).map(r => ({
      id: r.id || uid(),
      subId: r.subId, chId: r.chId, tId: r.tId,
      completedAt: r.completedAt || todayKey(),
      schedule: (r.schedule || []).map(st => ({
        offset: st.offset, dueDate: st.dueDate, done: !!st.done,
        completedAt: st.completedAt || null,
      })),
    }));
    return s;
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.error('saveState failed:', e); }
  }

  // ========== Helpers ==========
  // Smoothly scroll an element into view after the next paint.
  function scrollToElement(selectorOrEl, opts) {
    const o = Object.assign({ behavior: 'smooth', block: 'center' }, opts || {});
    requestAnimationFrame(() => {
      const el = typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl) : selectorOrEl;
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView(o); } catch (_) { el.scrollIntoView(); }
      }
    });
  }

  // ========== Export / Import ==========
  const EXPORT_VERSION = 1;

  function exportData() {
    try {
      const payload = {
        app: 'syllabus-tracker',
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        storageKey: STORAGE_KEY,
        state: state,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = url;
      a.download = `syllabus-tracker-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Exported backup file', 'success');
    } catch (e) {
      console.error('exportData failed:', e);
      toast('Export failed: ' + (e && e.message ? e.message : 'unknown error'), 'danger');
    }
  }

  function importData(file) {
    if (!file) { toast('No file selected', 'warn'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10 MB)', 'danger'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read file', 'danger');
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (e) {
        toast('Invalid JSON file', 'danger');
        return;
      }
      // Accept either a wrapped backup { state: {...} } or a raw state object
      const candidate = (parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object')
        ? parsed.state
        : parsed;

      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        toast('Invalid backup: expected an object', 'danger');
        return;
      }
      if (!Array.isArray(candidate.subjects)) {
        toast('Invalid backup: missing "subjects" array', 'danger');
        return;
      }

      const subjCount = candidate.subjects.length;
      const chCount = candidate.subjects.reduce((a, s) => a + ((s && Array.isArray(s.chapters)) ? s.chapters.length : 0), 0);
      confirmModal(
        `This will overwrite your current data: ${state.subjects.length} subject(s) replaced with ${subjCount} subject(s) (${chCount} chapter(s)).`,
        () => {
          try {
            const next = migrate(JSON.parse(JSON.stringify(candidate)));
            state = next;
            saveState();
            renderAll();
            toast(`Import complete · ${subjCount} subject(s)`, 'success');
          } catch (e) {
            console.error('Import migrate failed:', e);
            toast('Import failed during migration', 'danger');
          }
        },
        { title: 'Replace all data?', yesLabel: 'Import & Replace', yesClass: 'btn' }
      );
    };
    reader.readAsText(file);
  }

  function bumpActivity() {
    const k = todayKey();
    state.activity[k] = (state.activity[k] || 0) + 1;
    if (state.streak.lastDate !== k) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yk = y.toISOString().slice(0, 10);
      state.streak.count = (state.streak.lastDate === yk) ? (state.streak.count + 1) : 1;
      state.streak.lastDate = k;
    }
    checkGoalCompletions();
  }
  function chapterProgress(c) {
    if (!c.topics || !c.topics.length) return c.done ? 100 : 0;
    const done = c.topics.filter(t => t.done).length;
    return Math.round((done / c.topics.length) * 100);
  }
  function isChapterEffectivelyDone(c) {
    if (!c.topics || !c.topics.length) return c.done;
    return c.topics.every(t => t.done);
  }
  function findSubject(id) { return state.subjects.find(s => s.id === id); }
  function findChapter(subId, chId) { const s = findSubject(subId); return s && s.chapters.find(c => c.id === chId); }
  function findTopic(subId, chId, tId) { const c = findChapter(subId, chId); return c && c.topics.find(t => t.id === tId); }

  // ========== Burnout Detector ==========
  // Counts calendar days between two YYYY-MM-DD strings (today - then), >= 0.
  function daysSince(dateKey) {
    if (!dateKey) return Infinity;
    const a = new Date(dateKey + 'T00:00:00');
    const b = new Date(todayKey() + 'T00:00:00');
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

  // Longest consecutive run of active days in the last `windowDays` days.
  function recentPeakStreak(windowDays) {
    const today = new Date(todayKey() + 'T00:00:00');
    let peak = 0, cur = 0;
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      if ((state.activity[k] || 0) > 0) { cur++; if (cur > peak) peak = cur; }
      else { cur = 0; }
    }
    return peak;
  }

  function activeDaysInLast(n) {
    const today = new Date(todayKey() + 'T00:00:00');
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      if ((state.activity[k] || 0) > 0) count++;
    }
    return count;
  }

  // Returns { burned, reasons:[{key,label}], daysInactive, peak14, active7 }.
  // Designed to avoid false alerts: requires the user to have been around for
  // >= 3 days before any signal can fire.
  function detectBurnout() {
    const out = { burned: false, reasons: [], daysInactive: 0, peak14: 0, active7: 0 };
    const b = state.burnout || {};
    const sinceInstall = daysSince(b.installDate);
    if (sinceInstall < 3) return out; // grace period for new users

    const lastDate = state.streak && state.streak.lastDate ? state.streak.lastDate : null;
    const daysInactive = lastDate ? daysSince(lastDate) : sinceInstall;
    const peak14 = recentPeakStreak(14);
    const active7 = activeDaysInLast(7);

    out.daysInactive = daysInactive;
    out.peak14 = peak14;
    out.active7 = active7;

    if (daysInactive >= 2) {
      out.reasons.push({
        key: 'inactive',
        label: `No activity for ${daysInactive} days`,
      });
    }
    if (peak14 >= 3 && daysInactive >= 2) {
      out.reasons.push({
        key: 'streak-broken',
        label: `Your ${peak14}-day streak is at risk`,
      });
    }
    // Low completion: at most 1 active day in the last 7 (and the user has had
    // at least 5 days to build a habit).
    if (sinceInstall >= 5 && active7 <= 1) {
      out.reasons.push({
        key: 'low-completion',
        label: `Only ${active7} active day${active7 === 1 ? '' : 's'} in the last 7`,
      });
    }

    out.burned = out.reasons.length > 0;
    return out;
  }

  function renderBurnoutBanner() {
    const info = detectBurnout();
    if (!info.burned) return '';
    if (state.burnout && state.burnout.bannerDismissedDate === todayKey()) return '';
    const reasonsHtml = info.reasons
      .map(r => `<li>${escapeHTML(r.label)}</li>`)
      .join('');
    return `
      <div class="burnout-banner" role="alert">
        <div class="burnout-banner-icon">⚠️</div>
        <div class="burnout-banner-body">
          <div class="burnout-banner-title">You are losing consistency ⚠️ Get back on track!</div>
          <ul class="burnout-banner-reasons">${reasonsHtml}</ul>
          <div class="burnout-banner-actions">
            <button class="btn btn-warn" data-act="burnout-popup">Get Motivated</button>
            <button class="btn-link" data-act="burnout-dismiss-banner">Hide for today</button>
          </div>
        </div>
      </div>
    `;
  }

  function showBurnoutPopup() {
    const info = detectBurnout();
    const quote = state.motivationQuotes && state.motivationQuotes.length
      ? state.motivationQuotes[Math.floor(Math.random() * state.motivationQuotes.length)]
      : "One small step today beats zero steps tomorrow.";
    const reasonLine = info.reasons.length
      ? info.reasons.map(r => escapeHTML(r.label)).join(' · ')
      : 'You are slipping a bit — let\'s reset.';
    openModal(`
      <h3>⚠️ You are losing consistency</h3>
      <div class="burnout-modal-sub">${reasonLine}</div>
      <div class="burnout-modal-quote">"${escapeHTML(quote)}"</div>
      <div class="burnout-modal-tip">Tip: open today's plan and finish just one topic. Momentum follows.</div>
      <div class="actions">
        <button class="btn btn-ghost" data-act="burnout-dismiss-popup">Not now</button>
        <button class="btn" data-act="burnout-go-plan">Open Today's Plan</button>
      </div>
    `);
  }

  function maybeAutoShowBurnoutPopup() {
    const info = detectBurnout();
    if (!info.burned) return;
    const b = state.burnout || {};
    if (b.popupDismissedDate === todayKey()) return; // shown / dismissed already today
    showBurnoutPopup();
    state.burnout.popupDismissedDate = todayKey();
    saveState();
  }

  // ========== Daily Plan ==========
  const autoKey = (subId, chId, tId) => `${subId}:${chId}:${tId}`;

  function ensureTodayPlan() {
    const k = todayKey();
    // First, roll over any past-day plans into skip counts (idempotent).
    rolloverYesterdayPlanSkips();
    let plan = state.dailyPlans[k];
    if (!plan) {
      plan = { auto: [], removed: [], custom: [], generated: false };
      state.dailyPlans[k] = plan;
    }
    if (!plan.generated) {
      const picked = new Set();
      const auto = [];
      const pickTopic = (subId, chId, tId) => {
        const key = autoKey(subId, chId, tId);
        if (picked.has(key)) return;
        picked.add(key);
        auto.push({ subId, chId, tId });
      };
      // 1) Topics from chapters scheduled today
      for (const sub of state.subjects) {
        for (const ch of sub.chapters) {
          if (ch.scheduledDate !== k || isChapterEffectivelyDone(ch)) continue;
          for (const t of ch.topics) if (!t.done) pickTopic(sub.id, ch.id, t.id);
        }
      }
      // 2) Top up with high-priority chapters' incomplete topics
      if (auto.length < 5) {
        for (const sub of state.subjects) {
          for (const ch of sub.chapters) {
            if (ch.priority !== 'high' || isChapterEffectivelyDone(ch)) continue;
            for (const t of ch.topics) {
              if (!t.done && auto.length < 8) pickTopic(sub.id, ch.id, t.id);
            }
          }
        }
      }
      // 3) Fallback: any incomplete topic
      if (auto.length === 0) {
        for (const sub of state.subjects) {
          for (const ch of sub.chapters) {
            for (const t of ch.topics) {
              if (!t.done && auto.length < 5) pickTopic(sub.id, ch.id, t.id);
            }
          }
        }
      }
      plan.auto = auto;
      plan.generated = true;
      saveState();
    }
    return plan;
  }

  function getActivePlanTasks() {
    const plan = ensureTodayPlan();
    const tasks = [];
    for (const a of plan.auto) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if (plan.removed.includes(key)) continue;
      const sub = findSubject(a.subId);
      const ch = findChapter(a.subId, a.chId);
      const t = findTopic(a.subId, a.chId, a.tId);
      if (!sub || !ch || !t) continue; // underlying item deleted
      tasks.push({
        type: 'auto',
        key,
        text: t.name,
        meta: `${sub.name} · ${ch.name}`,
        color: sub.color,
        done: !!t.done,
        subId: a.subId, chId: a.chId, tId: a.tId,
      });
    }
    for (const c of plan.custom) {
      tasks.push({
        type: 'custom',
        key: c.id,
        text: c.text,
        meta: 'Custom task',
        color: '#94a3b8',
        done: !!c.done,
        id: c.id,
      });
    }
    return tasks;
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ========== Weak Point Detector ==========
  const WEAK_SKIP_THRESHOLD = 3;       // skipped 3+ times → weak
  const WEAK_AGE_DAYS = 7;             // not done after 7+ days since first seen → weak

  function topicAgeDays(topic) {
    if (!topic.firstSeenAt) return 0;
    return Math.max(0, daysBetween(topic.firstSeenAt, todayKey()));
  }

  function isWeakTopic(topic) {
    if (!topic) return false;
    if (topic.done) return false;
    if ((topic.skipCount || 0) >= WEAK_SKIP_THRESHOLD) return true;
    if (topicAgeDays(topic) >= WEAK_AGE_DAYS) return true;
    return false;
  }

  function weakReason(topic) {
    const reasons = [];
    if ((topic.skipCount || 0) >= WEAK_SKIP_THRESHOLD) reasons.push(`Skipped ×${topic.skipCount}`);
    const age = topicAgeDays(topic);
    if (age >= WEAK_AGE_DAYS) reasons.push(`${age}d old, still pending`);
    return reasons.join(' · ') || 'Needs attention';
  }

  function bumpSkipCount(subId, chId, tId) {
    const t = findTopic(subId, chId, tId); if (!t) return;
    t.skipCount = (t.skipCount || 0) + 1;
    t.lastSkippedAt = todayKey();
  }

  function rolloverYesterdayPlanSkips() {
    // For each past day's plan, count any auto-task that was neither completed nor removed as a skip
    // for the underlying topic. Mark the day as "rolledOver" so we never double-count.
    const today = todayKey();
    let touched = false;
    for (const dateKey of Object.keys(state.dailyPlans)) {
      if (dateKey >= today) continue; // only past days
      const plan = state.dailyPlans[dateKey];
      if (!plan || plan.rolledOver) continue;
      const removed = new Set(plan.removed || []);
      for (const a of (plan.auto || [])) {
        const key = `${a.subId}:${a.chId}:${a.tId}`;
        if (removed.has(key)) continue; // already counted as skip on removal
        const topic = findTopic(a.subId, a.chId, a.tId);
        if (!topic) continue;
        if (topic.done) continue; // they finished it later — not a skip
        topic.skipCount = (topic.skipCount || 0) + 1;
        topic.lastSkippedAt = dateKey;
        touched = true;
      }
      plan.rolledOver = true;
    }
    if (touched) saveState();
  }

  function getWeakTopics() {
    const out = [];
    for (const sub of state.subjects) {
      for (const ch of sub.chapters) {
        for (const t of ch.topics) {
          if (isWeakTopic(t)) {
            out.push({ sub, ch, topic: t, reason: weakReason(t), age: topicAgeDays(t), skips: t.skipCount || 0 });
          }
        }
      }
    }
    // Sort: more skips first, then older
    out.sort((a, b) => (b.skips - a.skips) || (b.age - a.age));
    return out;
  }

  function resetWeakTopic(subId, chId, tId) {
    const t = findTopic(subId, chId, tId); if (!t) return;
    t.skipCount = 0;
    t.firstSeenAt = todayKey();
    t.lastSkippedAt = null;
  }

  // ========== Spaced Repetition Revisions ==========
  const REVISION_OFFSETS = [1, 3, 7];

  function addDaysISO(baseISO, days) {
    const d = new Date(baseISO + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function scheduleRevisionsForTopic(subId, chId, tId) {
    if (!findTopic(subId, chId, tId)) return;
    const today = todayKey();
    const existing = state.revisions.find(r => r.tId === tId);
    if (existing) {
      // Re-schedule: keep done steps (we still credit prior reviews) and add any missing offsets.
      const haveOffsets = new Set(existing.schedule.map(s => s.offset));
      for (const off of REVISION_OFFSETS) {
        if (!haveOffsets.has(off)) {
          existing.schedule.push({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null });
        }
      }
      // If all steps were done previously, reset (topic was un-done then redone)
      if (existing.schedule.every(s => s.done)) {
        existing.completedAt = today;
        existing.schedule = REVISION_OFFSETS.map(off => ({
          offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null
        }));
      }
      existing.subId = subId; existing.chId = chId;
      return;
    }
    state.revisions.push({
      id: uid(), subId, chId, tId,
      completedAt: today,
      schedule: REVISION_OFFSETS.map(off => ({
        offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null
      }))
    });
  }

  function cancelRevisionsForTopic(tId) {
    // Remove only entries with no completed steps yet — preserve history of completed reviews.
    state.revisions = state.revisions.filter(r => {
      if (r.tId !== tId) return true;
      return r.schedule.some(s => s.done);
    });
  }

  function onTopicDoneChanged(subId, chId, tId, isDone) {
    if (isDone) scheduleRevisionsForTopic(subId, chId, tId);
    else cancelRevisionsForTopic(tId);
  }

  function pruneRevisions() {
    // Drop entries whose underlying topic no longer exists, and entries whose steps are all done.
    state.revisions = state.revisions.filter(r => {
      if (!findTopic(r.subId, r.chId, r.tId)) return false;
      if (r.schedule.length && r.schedule.every(s => s.done)) return false;
      return true;
    });
  }

  function dueRevisionItems() {
    pruneRevisions();
    const today = todayKey();
    const items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId);
      const ch = findChapter(r.subId, r.chId);
      for (const step of r.schedule) {
        if (step.done) continue;
        if (step.dueDate <= today) {
          items.push({ revisionId: r.id, sub, ch, topic, step, daysOverdue: daysBetween(step.dueDate, today) });
        }
      }
    }
    // Sort: most overdue first, then by subject name
    items.sort((a, b) => (b.daysOverdue - a.daysOverdue) || a.sub.name.localeCompare(b.sub.name));
    return items;
  }

  function upcomingRevisionItems(limit = 10) {
    pruneRevisions();
    const today = todayKey();
    const items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId);
      const ch = findChapter(r.subId, r.chId);
      for (const step of r.schedule) {
        if (step.done) continue;
        if (step.dueDate > today) {
          items.push({ revisionId: r.id, sub, ch, topic, step, daysUntil: daysBetween(today, step.dueDate) });
        }
      }
    }
    items.sort((a, b) => a.step.dueDate.localeCompare(b.step.dueDate));
    return items.slice(0, limit);
  }

  function daysBetween(aISO, bISO) {
    const a = new Date(aISO + 'T00:00:00');
    const b = new Date(bISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function completeRevisionStep(revisionId, offset) {
    const r = state.revisions.find(x => x.id === revisionId); if (!r) return;
    const step = r.schedule.find(s => s.offset === offset); if (!step || step.done) return;
    step.done = true;
    step.completedAt = todayKey();
    bumpActivity();
    // If all steps done, drop the entry entirely (auto-remove completed revisions)
    if (r.schedule.every(s => s.done)) {
      state.revisions = state.revisions.filter(x => x.id !== r.id);
    }
    saveState();
  }

  function dismissRevisionEntry(revisionId) {
    state.revisions = state.revisions.filter(x => x.id !== revisionId);
    saveState();
  }

  // ========== Smart Reminder & Web Notifications ==========
  const NOTIF_SUPPORTED = (typeof window !== 'undefined') && ('Notification' in window);
  let smartReminderTimer = null;
  let dueTaskTimer = null;
  let lastReminderCheckMinute = '';
  // Tracks which due-task notifications we've already fired today so we don't
  // re-notify on every poll. Reset each calendar day.
  let dueTaskNotifiedDate = null;
  const dueTaskNotified = new Set();

  function notifPermission() {
    try { return NOTIF_SUPPORTED ? Notification.permission : 'unsupported'; }
    catch (e) { return 'unsupported'; }
  }

  function requestNotifPermission() {
    return new Promise((resolve) => {
      if (!NOTIF_SUPPORTED) return resolve('unsupported');
      try {
        const p = Notification.requestPermission((res) => resolve(res));
        if (p && typeof p.then === 'function') p.then(resolve).catch(() => resolve('denied'));
      } catch (e) { resolve('denied'); }
    });
  }

  // Generic notification sender that prefers the Service Worker (works while
  // app is in the background) and falls back to a foreground-only Notification.
  function showWebNotification(title, body, opts) {
    const perm = notifPermission();
    if (perm !== 'granted') return false;
    const options = Object.assign({
      body: body || '',
      tag: 'syllabus-tracker',
      renotify: true,
    }, opts || {});
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'show-notification',
          title,
          options,
          url: '/',
        });
        return true;
      }
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          if (reg && reg.showNotification) reg.showNotification(title, options);
          else new Notification(title, options);
        }).catch(() => { try { new Notification(title, options); } catch (_) {} });
        return true;
      }
      new Notification(title, options);
      return true;
    } catch (e) {
      try { new Notification(title, options); return true; } catch (_) { return false; }
    }
  }

  // Public helper: trigger a notification that a task is due. Checks permission
  // first, requests it if not yet granted, and shows the alert.
  function notifyTaskDue(task) {
    const title = (task && task.title) || 'Task due';
    const body = (task && task.body) || 'You have a study task due now.';
    if (!NOTIF_SUPPORTED) {
      toast(`${title} — ${body}`, 'warn');
      return Promise.resolve(false);
    }
    const perm = notifPermission();
    if (perm === 'granted') {
      const ok = showWebNotification(title, body, { tag: (task && task.tag) || 'syllabus-task-due' });
      if (!ok) toast(`${title} — ${body}`, 'warn');
      return Promise.resolve(ok);
    }
    if (perm === 'denied') {
      toast(`${title} — ${body}`, 'warn');
      return Promise.resolve(false);
    }
    return requestNotifPermission().then(res => {
      if (res === 'granted') {
        const ok = showWebNotification(title, body, { tag: (task && task.tag) || 'syllabus-task-due' });
        if (!ok) toast(`${title} — ${body}`, 'warn');
        return ok;
      }
      toast(`${title} — ${body}`, 'warn');
      return false;
    });
  }

  // Poll due revisions so the user is alerted as soon as one becomes due,
  // even if the app is left open in the background.
  function checkDueTasks() {
    const today = todayKey();
    if (dueTaskNotifiedDate !== today) {
      dueTaskNotified.clear();
      dueTaskNotifiedDate = today;
    }
    const due = (typeof dueRevisionItems === 'function') ? dueRevisionItems() : [];
    for (const item of due) {
      const key = `${item.revisionId}:${item.step.offset}`;
      if (dueTaskNotified.has(key)) continue;
      dueTaskNotified.add(key);
      notifyTaskDue({
        title: 'Revision due',
        body: `${item.topic.name} (${item.sub.name})`,
        tag: `rev-${key}`,
      });
    }
  }

  function startDueTaskLoop() {
    if (dueTaskTimer) clearInterval(dueTaskTimer);
    dueTaskTimer = setInterval(checkDueTasks, 60 * 1000);
    setTimeout(checkDueTasks, 1500);
  }

  function fireReminder(msg) {
    const perm = notifPermission();
    if (perm === 'granted') {
      const ok = showWebNotification('Syllabus Tracker', msg, { tag: 'syllabus-smart-reminder' });
      if (ok) return;
    }
    showInAppReminder(msg);
  }

  function showInAppReminder(msg) {
    openModal(`
      <h3>⏰ Study Reminder</h3>
      <div style="margin:8px 0 16px;color:var(--text);font-size:15px;line-height:1.5">${escapeHTML(msg)}</div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Dismiss</button>
        <button class="btn" data-act="open-plan">Open Today's Plan</button>
      </div>
    `);
    toast(msg, 'warn', 5000);
  }

  function checkSmartReminder() {
    const sr = state.smartReminder;
    if (!sr || !sr.enabled || !Array.isArray(sr.times) || !sr.times.length) return;
    const now = new Date();
    const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of sr.times) {
      if (t !== cur) continue;
      const stampKey = today + 'T' + t;
      if (sr.lastFired && sr.lastFired[stampKey]) continue;
      const tasks = getActivePlanTasks();
      const incomplete = tasks.filter(x => !x.done);
      if (!incomplete.length) continue; // nothing to nag about
      sr.lastFired[stampKey] = true;
      saveState();
      fireReminder(`Reminder · ${formatTime12(t)} — you still have ${incomplete.length} task${incomplete.length === 1 ? '' : 's'} for today.`);
      break;
    }
  }

  // Multi-time motivation push: shows a quote (rotated through the user's list)
  // at each configured time. Falls back to a default quote if list is empty.
  let motivationTimer = null;
  function pickMotivationQuote() {
    const list = (state.motivationQuotes && state.motivationQuotes.length)
      ? state.motivationQuotes
      : ["Keep going. One step at a time."];
    return list[Math.floor(Math.random() * list.length)];
  }
  function checkMotivationReminders() {
    const mr = state.motivationReminders;
    if (!mr || !mr.enabled || !Array.isArray(mr.times) || !mr.times.length) return;
    const now = new Date();
    const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of mr.times) {
      if (t !== cur) continue;
      const stampKey = today + 'T' + t;
      if (mr.lastFired && mr.lastFired[stampKey]) continue;
      mr.lastFired[stampKey] = true;
      saveState();
      const quote = pickMotivationQuote();
      const perm = notifPermission();
      if (perm === 'granted') {
        showWebNotification('💪 Stay focused', quote, { tag: `mot-${stampKey}` });
      } else {
        toast(`💪 ${quote}`, 'info', 5000);
      }
      break;
    }
  }

  function startSmartReminderLoop() {
    if (smartReminderTimer) clearInterval(smartReminderTimer);
    if (motivationTimer)    clearInterval(motivationTimer);
    // Check every 30s — covers the 1-minute window reliably and is light.
    smartReminderTimer = setInterval(checkSmartReminder, 30 * 1000);
    motivationTimer    = setInterval(checkMotivationReminders, 30 * 1000);
    // Also check immediately on startup in case the app was opened right at the time.
    setTimeout(() => { checkSmartReminder(); checkMotivationReminders(); }, 1000);
  }

  // ========== Toast ==========
  function toast(msg, kind = 'info', ms = 3800) {
    const wrap = document.getElementById('toast-container');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = `<div style="flex:1">${escapeHTML(msg)}</div>`;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ========== Modal ==========
  function openModal(html, onMount) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const backdrop = root.firstElementChild;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    if (onMount) onMount(backdrop.querySelector('.modal'));
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  function confirmModal(msg, onYes, opts) {
    const o = opts || {};
    const yesLabel = o.yesLabel || 'Delete';
    const yesClass = o.yesClass || 'btn-danger';
    const title = o.title || 'Are you sure?';
    openModal(`
      <h3>${escapeHTML(title)}</h3>
      <div style="margin:6px 0 14px;color:var(--text-muted);font-size:14px;white-space:pre-line">${escapeHTML(msg)}</div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn ${yesClass}" id="m-yes">${escapeHTML(yesLabel)}</button>
      </div>
    `, root => {
      root.querySelector('#m-yes').onclick = () => { closeModal(); onYes(); };
    });
  }

  // ========== Icons ==========
  const ICONS = {
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
    chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    flame: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-2.5-3.5-3-5 1 1 5 5 5 8a3 3 0 0 0 3 3 3 3 0 0 0 3-3c0-3-2-5-5-9 1 5-3 7-5 10z"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    revisit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  };
  const ic = (n) => ICONS[n] || '';

  // ========== UI state ==========
  const openSubjects = new Set();
  const openChapters = new Set();
  let activeDropdown = null;

  // ========== Render ==========
  function renderAll() { renderHome(); renderDashboard(); renderSyllabus(); renderCalendar(); renderRevision(); renderStats(); }

  // -------- Home (slim — overview + entry point to Dashboard) --------
  // Module-scope flags for one-shot animations driven by re-renders.
  let _justPoppedKey = null;        // key of the plan task just toggled (for pop animation)
  let _justCompletedDay = null;     // 'YYYY-MM-DD' if today's plan was just fully completed
  let _lastAllDoneShown = false;    // tracks whether confetti has already burst this session

  function progressMessage(pct, hasTasks, allDone) {
    if (hasTasks && allDone) return "Daily goal achieved — well done!";
    if (pct < 20) return "Time to kickstart!";
    if (pct < 50) return "Building momentum, keep going.";
    if (pct < 80) return "Great pace — stay focused.";
    if (pct < 100) return "Almost there, legend!";
    return "Syllabus complete — incredible work!";
  }

  // SVG progress ring. r=58 → C ≈ 364.4. We animate stroke-dashoffset via CSS.
  function progressRingSVG(percent) {
    const r = 58;
    const c = 2 * Math.PI * r;            // ~364.42
    const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return `
      <svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"  stop-color="#38bdf8"/>
            <stop offset="55%" stop-color="#a78bfa"/>
            <stop offset="100%" stop-color="#f472b6"/>
          </linearGradient>
        </defs>
        <circle class="ring-track" cx="70" cy="70" r="${r}"></circle>
        <circle class="ring-fill"  cx="70" cy="70" r="${r}"
                stroke-dasharray="${c.toFixed(2)}"
                stroke-dashoffset="${off.toFixed(2)}"></circle>
      </svg>`;
  }

  function renderConfettiBurst() {
    // 18 lightweight DOM pieces, randomized via inline style. Pure CSS animation.
    const colors = ['#38bdf8','#a78bfa','#f472b6','#facc15','#34d399','#fb7185'];
    let pieces = '';
    for (let i = 0; i < 18; i++) {
      const left = Math.random() * 100;
      const delay = (Math.random() * 0.25).toFixed(2);
      const dur = (1.0 + Math.random() * 0.9).toFixed(2);
      const rot = Math.floor(Math.random() * 360);
      const color = colors[i % colors.length];
      const w = 6 + Math.floor(Math.random() * 6);
      pieces += `<i style="left:${left}%;background:${color};width:${w}px;height:${w * 1.6}px;animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
    }
    return `<div class="confetti" aria-hidden="true">${pieces}</div>`;
  }

  function renderHome() {
    const view = document.getElementById('view-home');
    const exam = nextExam();
    const overall = overallProgress();
    const tasks = getActivePlanTasks();
    const doneCount = tasks.filter(t => t.done).length;
    const totalCount = tasks.length;
    const allDone = totalCount > 0 && doneCount === totalCount;

    // Build hero row: large Next Exam card + Overall Progress card.
    const examDays = exam ? daysUntil(exam.date) : null;
    const urgent = exam && examDays !== null && examDays <= 7 && examDays >= 0;
    const examHero = exam ? `
      <article class="hero-card hero-exam ${urgent ? 'urgent' : ''}" data-act="add-exam" role="button" aria-label="Edit next exam">
        ${urgent ? `<span class="urgent-badge">${examDays === 0 ? 'TODAY' : examDays === 1 ? 'TOMORROW' : 'SOON'}</span>` : ''}
        <div class="hero-eyebrow">${ic('cal')}<span>NEXT EXAM</span></div>
        <h2 class="hero-title">${escapeHTML(exam.name)}</h2>
        <div class="hero-sub">${formatDate(exam.date)}</div>
        <div class="hero-bignum">${examDays}<span class="hero-bignum-unit">d</span></div>
        <div class="hero-bignum-lbl">days remaining</div>
        <div class="hero-actions">
          <button class="btn-link" data-act="edit-exam" data-id="${exam.id}">Edit</button>
          <button class="btn-link" data-act="add-exam">+ Add</button>
        </div>
      </article>
    ` : `
      <article class="hero-card hero-exam empty">
        <div class="hero-eyebrow">${ic('cal')}<span>NEXT EXAM</span></div>
        <h2 class="hero-title">No exam scheduled</h2>
        <div class="hero-sub">Add one to start the countdown.</div>
        <button class="btn" style="margin-top:14px" data-act="add-exam">${ic('plus')} Add Exam</button>
      </article>
    `;

    const progressHero = `
      <article class="hero-card hero-progress" data-act="open-dashboard" role="button" aria-label="Open dashboard">
        <div class="hero-eyebrow">${ic('check')}<span>OVERALL PROGRESS</span></div>
        <div class="ring-wrap">
          ${progressRingSVG(overall)}
          <div class="ring-center">
            <div class="ring-pct">${overall}<span>%</span></div>
            <div class="ring-lbl">complete</div>
          </div>
        </div>
        <div class="hero-progress-foot">
          <span><strong>${state.streak.count}</strong> day streak 🔥</span>
          <span>${doneCount}/${totalCount} today</span>
        </div>
      </article>
    `;

    const dailyAchievedBadge = allDone ? `
      <div class="daily-achieved" role="status">
        ${_justCompletedDay === todayKey() ? renderConfettiBurst() : ''}
        <span class="da-glyph">🏆</span>
        <div class="da-body">
          <div class="da-title">Daily Goal Achieved!</div>
          <div class="da-sub">All ${totalCount} task${totalCount === 1 ? '' : 's'} done for today.</div>
        </div>
      </div>
    ` : '';

    view.innerHTML = `
      <div class="page-header">
        <h1>Home</h1>
        <div class="subtitle">${greeting()}, let's study</div>
        <div class="motivation-line ${overall >= 80 ? 'is-hot' : overall < 20 ? 'is-cold' : ''}">${escapeHTML(progressMessage(overall, totalCount > 0, allDone))}</div>
      </div>

      <div class="hero-grid">
        ${examHero}
        ${progressHero}
      </div>

      <button type="button" class="dashboard-cta glass" data-act="open-dashboard" aria-label="Open Dashboard">
        <span class="ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        </span>
        <span class="body">
          <span class="title">Open Dashboard</span>
          <span class="meta">Goals · Smart Suggestions · Weak Areas</span>
        </span>
        <span class="arrow">›</span>
      </button>

      ${dailyAchievedBadge}

      <div class="section-head">
        <h2>Today's Plan</h2>
        <button class="btn-link glass-pill" data-act="goto-calendar">Open Calendar →</button>
      </div>
      ${renderHomeTodayPlan(tasks)}
    `;

    // Clear the one-shot pop key after this render cycle so it only animates once.
    if (_justPoppedKey) {
      requestAnimationFrame(() => { _justPoppedKey = null; });
    }
    // Confetti only bursts once per completion event.
    if (_justCompletedDay) {
      setTimeout(() => { _justCompletedDay = null; }, 1800);
    }
  }

  // Compact, read-only mirror of today's plan for the Home page.
  function renderHomeTodayPlan(tasks) {
    if (!tasks.length) {
      return `<div class="empty">No tasks for today yet — add some from the Calendar.</div>`;
    }
    const slice = tasks.slice(0, 5);
    const more = tasks.length - slice.length;
    return `
      <div class="list home-plan-list">
        ${slice.map(t => {
          const key = t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`;
          const popped = _justPoppedKey === key ? 'just-popped' : '';
          return `
          <div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}">
            <input type="checkbox" class="check" ${t.done ? 'checked' : ''}
              data-act="toggle-plan-task"
              ${t.type === 'auto'
                ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"`
                : `data-type="custom" data-id="${t.id}"`}
              aria-label="Mark task complete"/>
            <span class="color-dot" style="background:${t.color}"></span>
            <div style="flex:1;min-width:0">
              <div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}</div>
              <div class="meta">${escapeHTML(t.meta)}</div>
            </div>
          </div>
        `;}).join('')}
      </div>
      ${more > 0 ? `<button class="btn-link" data-act="goto-calendar" style="margin-top:8px">+${more} more in Calendar</button>` : ''}
    `;
  }

  // -------- Dashboard (Goals · Smart Suggestions · Weak Areas) --------
  function renderDashboard() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;
    view.innerHTML = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <div class="subtitle">Your study control center</div>
      </div>

      ${renderGoals()}

      ${renderSmartSuggestions()}

      ${renderWeakAreas()}
    `;
  }

  function renderDailyPlan() {
    const tasks = getActivePlanTasks();
    const doneCount = tasks.filter(t => t.done).length;
    const suggestedKeys = getSuggestedKeys();
    const adder = renderPlanAdder();
    if (!tasks.length) {
      return `
        <div class="empty">No tasks for today</div>
        ${adder}
      `;
    }
    return `
      <div class="muted" style="margin:-4px 0 8px">${doneCount}/${tasks.length} done today</div>
      <div class="list plan-list">
        ${tasks.map(t => renderPlanTask(t, suggestedKeys)).join('')}
      </div>
      ${adder}
    `;
  }

  // Cascading Subject → Chapter → Topic picker plus a free-text fallback so
  // the user can quickly add planned items pulled from their syllabus.
  function renderPlanAdder() {
    const subjects = state.subjects || [];
    const subjOptions = subjects.map(s =>
      `<option value="${s.id}">${escapeHTML(s.name)}</option>`
    ).join('');

    return `
      <div class="plan-add-card">
        <div class="plan-add-title">Add to Today's Plan</div>
        <div class="plan-add-grid">
          <select class="plan-sel" id="plan-pick-sub" data-plan-pick="sub">
            <option value="">Subject…</option>
            ${subjOptions}
          </select>
          <select class="plan-sel" id="plan-pick-ch" data-plan-pick="ch" disabled>
            <option value="">Chapter…</option>
          </select>
          <select class="plan-sel" id="plan-pick-t" data-plan-pick="t" disabled>
            <option value="">Topic (optional)…</option>
          </select>
        </div>
        <div class="plan-add-actions">
          <button class="btn btn-block" data-act="add-plan-from-syllabus">${ic('plus')} Add from Syllabus</button>
        </div>
        <div class="plan-add-divider"><span>or write a custom task</span></div>
        <div class="row plan-add-row">
          <input id="plan-new-task" placeholder="Custom task for today…" maxlength="120"
            style="flex:1;background:#0b1327;border:1px solid var(--border);color:var(--text);padding:11px;border-radius:10px;font:inherit"/>
          <button class="btn" data-act="add-plan-task" aria-label="Add custom task">${ic('plus')}</button>
        </div>
      </div>
    `;
  }

  function renderPlanTask(task, suggestedKeys) {
    const dataAttrs = task.type === 'auto'
      ? `data-type="auto" data-sub="${task.subId}" data-ch="${task.chId}" data-t="${task.tId}"`
      : `data-type="custom" data-id="${task.id}"`;
    const isSuggested = task.type === 'auto' && suggestedKeys
      && suggestedKeys.has(task.subId + ':' + task.chId + ':' + task.tId);
    const key = task.type === 'auto' ? `auto:${task.subId}:${task.chId}:${task.tId}` : `custom:${task.id}`;
    const popped = _justPoppedKey === key ? 'just-popped' : '';
    return `
      <div class="card card-row plan-task ${task.done ? 'is-done' : ''} ${isSuggested ? 'plan-task-suggested' : ''} ${popped}">
        <input type="checkbox" class="check" ${task.done ? 'checked' : ''}
          data-act="toggle-plan-task" ${dataAttrs} aria-label="Mark task complete"/>
        <span class="color-dot" style="background:${task.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title ${task.done ? 'done' : ''}">${escapeHTML(task.text)}${isSuggested ? ' <span class="pill pill-suggested">⭐ Suggested</span>' : ''}</div>
          <div class="meta">${escapeHTML(task.meta)}</div>
        </div>
        <button class="menu-btn" data-act="remove-plan-task" ${dataAttrs} aria-label="Remove task">${ic('trash')}</button>
      </div>`;
  }

  function renderTodayItem(item) {
    const sub = findSubject(item.subjectId);
    const c = item.chapter;
    const pct = chapterProgress(c);
    return `
      <div class="card card-row tap" data-act="open-chapter" data-sub="${sub.id}" data-ch="${c.id}">
        <span class="color-dot" style="background:${sub.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title">${escapeHTML(c.name)}</div>
          <div class="meta">Chapter · ${escapeHTML(sub.name)} · ${pct}% done</div>
          ${c.notes ? `<div class="notes">${escapeHTML(c.notes)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          ${c.priority ? priorityPill(c.priority) : ''}
          <span class="pill pill-today">TODAY</span>
        </div>
      </div>`;
  }
  function priorityPill(p) {
    const cls = p === 'high' ? 'pill-high' : p === 'medium' ? 'pill-med' : 'pill-low';
    return `<span class="pill ${cls}">${p.toUpperCase()}</span>`;
  }
  function nextExam() {
    if (!state.exams.length) return null;
    const today = todayKey();
    const upcoming = [...state.exams].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] || [...state.exams].sort((a, b) => a.date.localeCompare(b.date)).pop();
  }
  function daysUntil(date) {
    const d = new Date(date + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d - now) / 86400000));
  }
  function formatDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  function todaysItems() {
    const today = todayKey();
    const out = [];
    const seen = new Set();
    for (const sub of state.subjects) {
      for (const ch of sub.chapters) {
        if (isChapterEffectivelyDone(ch)) continue;
        if (ch.scheduledDate === today) { out.push({ subjectId: sub.id, chapter: ch }); seen.add(ch.id); }
      }
    }
    if (out.length < 3) {
      for (const sub of state.subjects) {
        for (const ch of sub.chapters) {
          if (isChapterEffectivelyDone(ch)) continue;
          if (ch.priority === 'high' && !seen.has(ch.id)) {
            out.push({ subjectId: sub.id, chapter: ch }); seen.add(ch.id);
            if (out.length >= 5) return out;
          }
        }
      }
    }
    return out;
  }
  function overallProgress() {
    let total = 0, done = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) {
      total++; if (isChapterEffectivelyDone(ch)) done++;
    }
    return total ? Math.round((done / total) * 100) : 0;
  }

  // -------- Syllabus --------
  function renderSyllabus() {
    const view = document.getElementById('view-syllabus');
    view.innerHTML = `
      <div class="page-header">
        <h1>Syllabus</h1>
        <div class="subtitle">${state.subjects.length} subject${state.subjects.length === 1 ? '' : 's'}</div>
      </div>
      <button class="btn btn-block" data-act="add-subject" style="margin-bottom:14px">${ic('plus')} Add Subject</button>
      <div class="list">
        ${state.subjects.map(renderSubjectCard).join('') || `<div class="empty">No subjects yet. Tap + to add one.</div>`}
      </div>
    `;
  }

  function renderSubjectCard(sub) {
    const totalCh = sub.chapters.length;
    const doneCh = sub.chapters.filter(isChapterEffectivelyDone).length;
    const open = openSubjects.has(sub.id);
    const subRev = sub.revisionCount || 0;
    return `
      <div class="card subject-card" data-sub-card="${sub.id}">
        <div class="subject-head tap" data-act="toggle-subject" data-sub="${sub.id}">
          <span class="color-dot" style="background:${sub.color}"></span>
          <div style="flex:1;min-width:0">
            <div class="subject-name">${escapeHTML(sub.name)}</div>
            <div class="muted" style="margin-top:2px">
              ${doneCh}/${totalCh} chapters
              ${sub.priority ? ` · ${sub.priority.toUpperCase()}` : ''}
            </div>
            ${subRev ? `<div class="badges" style="margin-top:6px"><span class="pill pill-rev" title="Revised ${subRev} time${subRev === 1 ? '' : 's'}">Revised: ${subRev} time${subRev === 1 ? '' : 's'}</span></div>` : ''}
            ${sub.notes ? `<div class="notes">${escapeHTML(sub.notes)}</div>` : ''}
          </div>
          <button class="menu-btn" data-act="menu-subject" data-sub="${sub.id}">${ic('dots')}</button>
          <span class="chevron ${open ? 'open' : ''}">${ic('chev')}</span>
        </div>
        ${open ? `<div class="chapter-list">
          ${sub.chapters.map(c => renderChapterCard(sub, c)).join('') || `<div class="muted" style="padding:8px 4px">No chapters yet.</div>`}
          <button class="btn btn-ghost" data-act="add-chapter" data-sub="${sub.id}" style="margin-top:6px">${ic('plus')} Add Chapter</button>
        </div>` : ''}
      </div>
    `;
  }

  function renderChapterCard(sub, c) {
    const pct = chapterProgress(c);
    const open = openChapters.has(c.id);
    const effDone = isChapterEffectivelyDone(c);
    const revCount = c.revisionCount || 0;
    return `
      <div class="chapter" data-ch-card="${c.id}">
        <div class="chapter-row">
          <input type="checkbox" class="check" ${effDone ? 'checked' : ''}
                 data-act="toggle-chapter-done" data-sub="${sub.id}" data-ch="${c.id}" />
          <div class="title-row">
            <div style="flex:1;min-width:0">
              <div class="name ${effDone ? 'done' : ''}">${escapeHTML(c.name)}</div>
              ${c.notes ? `<div class="notes">${escapeHTML(c.notes)}</div>` : ''}
              <div class="badges">
                ${c.priority ? priorityPill(c.priority) : ''}
                ${revCount ? `<span class="pill pill-rev" title="Revised ${revCount} time${revCount === 1 ? '' : 's'}">Revised: ${revCount} time${revCount === 1 ? '' : 's'}</span>` : ''}
                ${c.scheduledDate === todayKey() ? `<span class="pill pill-today">Today</span>` : ''}
                <span class="muted">${pct}%</span>
              </div>
            </div>
            <button class="menu-btn" data-act="menu-chapter" data-sub="${sub.id}" data-ch="${c.id}">${ic('dots')}</button>
            <button class="menu-btn" data-act="toggle-chapter" data-ch="${c.id}"><span class="chevron ${open ? 'open' : ''}">${ic('chev')}</span></button>
          </div>
        </div>
        <div class="progress" style="margin-top:8px"><span style="width:${pct}%"></span></div>
        ${open ? `<div class="topic-list">
          ${renderChapterChecklist(sub, c)}
          ${c.topics.map(t => renderTopic(sub, c, t)).join('')}
          <button class="btn btn-ghost" data-act="add-topic" data-sub="${sub.id}" data-ch="${c.id}">${ic('plus')} Add Topic</button>
        </div>` : ''}
      </div>
    `;
  }

  function renderTopic(sub, c, t) {
    const weak = isWeakTopic(t);
    const revCount = t.revisionCount || 0;
    return `
      <div class="topic ${weak ? 'topic-weak' : ''}" data-t-card="${t.id}">
        <input type="checkbox" class="check" ${t.done ? 'checked' : ''}
               data-act="toggle-topic" data-sub="${sub.id}" data-ch="${c.id}" data-t="${t.id}" />
        <div style="flex:1;min-width:0">
          <div class="name ${t.done ? 'done' : ''}">${weak ? `<span class="weak-icon" title="${escapeHTML(weakReason(t))}">${ic('warn')}</span> ` : ''}${escapeHTML(t.name)}</div>
          ${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>` : ''}
          ${(t.priority || revCount || weak) ? `<div class="badges">${t.priority ? priorityPill(t.priority) : ''}${revCount ? `<span class="pill pill-rev" title="Revised ${revCount} time${revCount === 1 ? '' : 's'}">Revised: ${revCount} time${revCount === 1 ? '' : 's'}</span>` : ''}${weak ? `<span class="pill pill-weak">Weak · ${escapeHTML(weakReason(t))}</span>` : ''}</div>` : ''}
        </div>
        <button class="menu-btn" data-act="menu-topic" data-sub="${sub.id}" data-ch="${c.id}" data-t="${t.id}">${ic('dots')}</button>
      </div>
    `;
  }

  // Format a stored timestamp (ms or ISO string) for compact display.
  function formatRevisedAt(stamp) {
    try {
      const d = new Date(stamp);
      if (isNaN(d.getTime())) return '';
      const today = new Date(); today.setHours(0,0,0,0);
      const that = new Date(d); that.setHours(0,0,0,0);
      const diffDays = Math.round((today - that) / 86400000);
      const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      if (diffDays === 0) return `Today, ${time}`;
      if (diffDays === 1) return `Yesterday, ${time}`;
      if (diffDays > 0 && diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_) { return ''; }
  }

  // -------- Chapter Checklist (Basic / MCQ / CQ / SQ + custom, per chapter) --------
  function ensureChapterChecklist(c) {
    if (!Array.isArray(c.checklist)) c.checklist = makeDefaultChecklist();
    return c.checklist;
  }

  function renderChapterChecklist(sub, c) {
    const items = ensureChapterChecklist(c);
    const total = items.length;
    const done = items.filter(x => x.checked).length;
    return `
      <div class="chapter-checklist" data-checklist-ch="${c.id}">
        <div class="checklist-head">
          <span class="checklist-title">Checklist</span>
          <span class="checklist-meta">${done}/${total}</span>
        </div>
        <div class="checklist-list">
          ${items.length ? items.map(it => `
            <div class="checklist-item ${it.checked ? 'is-checked' : ''}">
              <label class="checklist-label">
                <input type="checkbox" class="check" ${it.checked ? 'checked' : ''}
                  data-act="toggle-checklist" data-sub="${sub.id}" data-ch="${c.id}" data-id="${it.id}"/>
                <span class="checklist-text">${escapeHTML(it.label)}</span>
              </label>
              <button type="button" class="checklist-del" aria-label="Delete checklist item"
                data-act="del-checklist" data-sub="${sub.id}" data-ch="${c.id}" data-id="${it.id}">${ic('trash')}</button>
            </div>
          `).join('') : `<div class="muted" style="padding:6px 2px;font-size:13px">No items. Add one below.</div>`}
        </div>
        <div class="checklist-add">
          <input type="text" class="checklist-input" placeholder="Add item (e.g. Practice)"
            id="checklist-input-${c.id}" maxlength="60"
            data-checklist-input data-sub="${sub.id}" data-ch="${c.id}"/>
          <button type="button" class="btn btn-sm" data-act="add-checklist" data-sub="${sub.id}" data-ch="${c.id}">${ic('plus')}</button>
        </div>
      </div>
    `;
  }

  function renderWeakAreas() {
    const weak = getWeakTopics();
    return `
      <div class="section-head">
        <h2>Weak Areas</h2>
        ${weak.length ? `<span class="muted">${weak.length} flagged</span>` : ''}
      </div>
      ${weak.length ? `<div class="list">${weak.map(w => `
        <div class="card weak-card">
          <div class="row" style="gap:10px;align-items:flex-start">
            <div class="weak-icon-lg">${ic('warn')}</div>
            <div style="flex:1;min-width:0">
              <div class="title">${escapeHTML(w.topic.name)}</div>
              <div class="meta">${escapeHTML(w.sub.name)} · ${escapeHTML(w.ch.name)}</div>
              <div class="badges" style="margin-top:6px">
                ${w.skips >= WEAK_SKIP_THRESHOLD ? `<span class="pill pill-weak">Skipped ×${w.skips}</span>` : ''}
                ${w.age >= WEAK_AGE_DAYS ? `<span class="pill pill-stale">${w.age}d stale</span>` : ''}
              </div>
            </div>
            <div class="row" style="gap:4px">
              <button class="menu-btn" data-act="weak-mark-done" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}" title="Mark complete">${ic('check')}</button>
              <button class="menu-btn" data-act="weak-reset" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}" title="Reset weak flag">${ic('refresh')}</button>
            </div>
          </div>
        </div>`).join('')}</div>`
        : `<div class="empty">No weak topics — keep it up!</div>`}
    `;
  }

  // ========== Goal Tracking ==========
  // A goal is a self-imposed deadline ("Finish Mathematics in 20 days") that
  // tracks progress automatically by reading existing chapter-completion data.

  // Progress for a single subject, expressed in chapters done.
  function subjectChapterProgress(subId) {
    const sub = findSubject(subId);
    if (!sub) return { done: 0, total: 0, percent: 0 };
    let total = 0, done = 0;
    for (const ch of sub.chapters) {
      total++;
      if (isChapterEffectivelyDone(ch)) done++;
    }
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  // Inclusive day delta: today - startDate. >= 0.
  function daysFromStart(startISO) {
    const a = new Date(startISO + 'T00:00:00');
    const t = new Date(todayKey() + 'T00:00:00');
    return Math.max(0, Math.round((t - a) / 86400000));
  }

  // daysUntil() already exists and clamps to >= 0; we also need the signed
  // value so we can show "Overdue by N".
  function signedDaysUntil(dateISO) {
    const d = new Date(dateISO + 'T00:00:00');
    const t = new Date(todayKey() + 'T00:00:00');
    return Math.round((d - t) / 86400000);
  }

  // Computes everything the UI needs about a goal in one call.
  function goalProgress(goal) {
    const prog = goal.subjectId
      ? subjectChapterProgress(goal.subjectId)
      : (() => {
          let total = 0, done = 0;
          for (const sub of state.subjects) for (const ch of sub.chapters) {
            total++;
            if (isChapterEffectivelyDone(ch)) done++;
          }
          return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
        })();

    const totalDays = goal.durationDays;
    const elapsed = Math.min(totalDays, daysFromStart(goal.startDate));
    const signedLeft = signedDaysUntil(goal.targetDate);
    const daysLeft = Math.max(0, signedLeft);
    const overdueBy = signedLeft < 0 ? -signedLeft : 0;
    const isComplete = prog.total > 0 && prog.done >= prog.total;
    const isOverdue = !isComplete && signedLeft < 0;
    // Pace: where the user "should" be by now if linear.
    const expectedPercent = totalDays > 0
      ? Math.min(100, Math.round((elapsed / totalDays) * 100))
      : 0;

    return {
      done: prog.done,
      total: prog.total,
      percent: prog.percent,
      totalDays,
      elapsed,
      daysLeft,
      overdueBy,
      isComplete,
      isOverdue,
      expectedPercent,
    };
  }

  // After any activity we re-check every goal and stamp completedAt the first
  // time it reaches 100%. Idempotent — safe to call repeatedly.
  function checkGoalCompletions() {
    let changed = false;
    for (const g of state.goals || []) {
      const p = goalProgress(g);
      if (p.isComplete && !g.completedAt) {
        g.completedAt = todayKey();
        changed = true;
        setTimeout(() => {
          toast(`Goal reached: ${escapeHTML(goalDisplayName(g))} 🎯`, 'success');
        }, 100);
      } else if (!p.isComplete && g.completedAt) {
        // User un-marked a chapter that had pushed us to 100%; re-open the goal.
        g.completedAt = null;
        changed = true;
      }
    }
    if (changed) saveState();
  }

  function goalDisplayName(g) {
    if (g.name && g.name.trim()) return g.name.trim();
    const sub = g.subjectId ? findSubject(g.subjectId) : null;
    const target = sub ? sub.name : 'All subjects';
    return `Finish ${target} in ${g.durationDays} day${g.durationDays === 1 ? '' : 's'}`;
  }

  // ----- Goal modal (add / edit) -----
  function modalAddGoal(existing) {
    const subjects = state.subjects;
    const subjOptions = ['<option value="">All subjects</option>']
      .concat(subjects.map(s => `<option value="${s.id}" ${existing && existing.subjectId === s.id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`))
      .join('');
    const presets = [7, 14, 20, 30, 60, 90];
    const curDur = existing ? existing.durationDays : 20;
    const presetChips = presets.map(d => `
      <button type="button" class="chip-pick" data-dur="${d}" ${d === curDur ? 'data-active="1"' : ''}>${d}d</button>
    `).join('');

    openModal(`
      <h3>${existing ? 'Edit Goal' : 'New Goal'}</h3>
      <div class="field">
        <label>Goal name (optional)</label>
        <input id="m-name" placeholder="e.g. Finish Math before exam" value="${existing ? escapeHTML(existing.name || '') : ''}" maxlength="60"/>
      </div>
      <div class="field">
        <label>Subject</label>
        <select id="m-subject">${subjOptions}</select>
      </div>
      <div class="field">
        <label>Duration (days)</label>
        <input id="m-duration" type="number" min="1" max="365" value="${curDur}"/>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${presetChips}</div>
      </div>
      <div class="field">
        <label>Start date</label>
        <input id="m-start" type="date" value="${existing ? existing.startDate : todayKey()}"/>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Goal'}</button>
      </div>
    `, root => {
      // Quick-pick chips
      root.querySelectorAll('.chip-pick').forEach(chip => {
        chip.onclick = () => {
          root.querySelector('#m-duration').value = chip.dataset.dur;
          root.querySelectorAll('.chip-pick').forEach(c => c.removeAttribute('data-active'));
          chip.setAttribute('data-active', '1');
        };
      });
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        const subjectId = root.querySelector('#m-subject').value || null;
        const duration = parseInt(root.querySelector('#m-duration').value, 10);
        const startDate = root.querySelector('#m-start').value || todayKey();
        if (!duration || duration < 1 || duration > 365) {
          toast('Duration must be 1–365 days', 'warn'); return;
        }
        if (!startDate) { toast('Start date required', 'warn'); return; }
        const targetDate = addDaysISO(startDate, duration);
        if (existing) {
          Object.assign(existing, { name, subjectId, durationDays: duration, startDate, targetDate });
          // Re-check completion in case subject changed.
          existing.completedAt = null;
        } else {
          state.goals.push({
            id: uid(), name, subjectId, durationDays: duration,
            startDate, targetDate,
            createdAt: todayKey(), completedAt: null,
          });
        }
        checkGoalCompletions();
        saveState(); closeModal(); renderAll();
        toast(existing ? 'Goal updated' : 'Goal added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => {
        state.goals = state.goals.filter(g => g.id !== existing.id);
        saveState(); closeModal(); renderAll();
        toast('Goal deleted', 'danger');
      };
    });
  }

  // ----- Goal section render -----
  function renderGoals() {
    checkGoalCompletions();
    const goals = state.goals || [];
    if (!goals.length) {
      return `
        <div class="section-head">
          <h2>Goals</h2>
          <button class="btn-link" data-act="add-goal">+ Add Goal</button>
        </div>
        <div class="empty empty-goals">
          <div style="font-size:32px;margin-bottom:6px">🎯</div>
          <div>No goals yet. Set a target like <em>"Finish Math in 20 days"</em> and track progress automatically.</div>
          <button class="btn" style="margin-top:12px" data-act="add-goal">${ic('plus')} Add your first goal</button>
        </div>
      `;
    }
    // Active first (sorted by daysLeft asc), completed at the bottom.
    const decorated = goals.map(g => ({ g, p: goalProgress(g) }));
    decorated.sort((a, b) => {
      if (a.p.isComplete !== b.p.isComplete) return a.p.isComplete ? 1 : -1;
      if (a.p.isOverdue !== b.p.isOverdue) return a.p.isOverdue ? -1 : 1;
      return a.p.daysLeft - b.p.daysLeft;
    });
    const cards = decorated.map(({ g, p }) => renderGoalCard(g, p)).join('');
    return `
      <div class="section-head">
        <h2>Goals</h2>
        <button class="btn-link" data-act="add-goal">+ Add Goal</button>
      </div>
      <div class="goal-list">${cards}</div>
    `;
  }

  function renderGoalCard(g, p) {
    const sub = g.subjectId ? findSubject(g.subjectId) : null;
    const subjectLabel = sub ? sub.name : 'All subjects';
    const subjectColor = sub ? sub.color : 'var(--primary)';
    let statusLabel, statusClass;
    if (p.isComplete) { statusLabel = 'Completed'; statusClass = 'goal-status-done'; }
    else if (p.isOverdue) { statusLabel = `Overdue by ${p.overdueBy}d`; statusClass = 'goal-status-overdue'; }
    else if (p.daysLeft === 0) { statusLabel = 'Due today'; statusClass = 'goal-status-today'; }
    else { statusLabel = `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`; statusClass = 'goal-status-active'; }
    // Pace indicator: ahead / on-track / behind
    let paceLabel = '';
    if (!p.isComplete && p.total > 0) {
      const diff = p.percent - p.expectedPercent;
      if (diff >= 5) paceLabel = `<span class="goal-pace ahead">▲ ${diff}% ahead of pace</span>`;
      else if (diff <= -5) paceLabel = `<span class="goal-pace behind">▼ ${-diff}% behind pace</span>`;
      else paceLabel = `<span class="goal-pace ontrack">● on pace</span>`;
    }
    const progressClass = p.isComplete ? 'progress-done' : (p.isOverdue ? 'progress-overdue' : '');
    const completedNote = p.isComplete && g.completedAt
      ? `<div class="goal-meta">🎉 Completed on ${formatDate(g.completedAt)}</div>` : '';

    return `
      <div class="card goal-card ${p.isComplete ? 'is-complete' : ''} ${p.isOverdue ? 'is-overdue' : ''}" data-goal="${g.id}">
        <span class="goal-color-bar" style="background:${subjectColor}"></span>
        <div class="goal-header">
          <div class="goal-title">${escapeHTML(goalDisplayName(g))}</div>
          <button class="menu-btn" data-act="edit-goal" data-id="${g.id}" aria-label="Edit goal">${ic('edit')}</button>
        </div>
        <div class="goal-pills">
          <span class="goal-pill" style="background:${sub ? sub.color + '22' : 'rgba(56,189,248,0.14)'};color:${subjectColor}">📚 ${escapeHTML(subjectLabel)}</span>
          <span class="goal-pill goal-pill-status ${statusClass}">${escapeHTML(statusLabel)}</span>
          ${paceLabel}
        </div>
        <div class="goal-progress-row">
          <div class="goal-progress-text">
            <span class="goal-percent">${p.percent}%</span>
            <span class="goal-fraction">${p.done} / ${p.total} chapter${p.total === 1 ? '' : 's'}</span>
          </div>
          <div class="goal-day-counter">Day ${p.elapsed} of ${p.totalDays}</div>
        </div>
        <div class="progress goal-progress ${progressClass}">
          <span style="width:${p.percent}%"></span>
        </div>
        <div class="goal-meta">
          ${formatDate(g.startDate)} → ${formatDate(g.targetDate)}
        </div>
        ${completedNote}
      </div>
    `;
  }

  // ========== Smart Study Suggestions ==========
  // Builds a prioritized list of "what to study right now" by combining
  // overdue revisions, weak topics, and incomplete topics. The same logic
  // that powers the suggestion card also exposes a Set of topic-keys so the
  // existing daily plan / weak-areas list can highlight recommended items.
  const SUGGEST_LIMIT = 4;

  function topicKey(subId, chId, tId) { return subId + ':' + chId + ':' + tId; }

  // Returns an ordered array of suggestion objects:
  //   { type: 'revision'|'weak'|'incomplete', sub, ch, topic, label, meta,
  //     priority, action: { ... }, key }
  function getSmartSuggestions(limit) {
    if (typeof limit !== 'number') limit = SUGGEST_LIMIT;
    const out = [];
    const seen = new Set();

    // 1) Revisions that are due or overdue (highest priority).
    const due = dueRevisionItems();
    for (const item of due) {
      if (out.length >= limit) break;
      const k = topicKey(item.sub.id, item.ch.id, item.topic.id);
      if (seen.has(k)) continue;
      seen.add(k);
      const overdue = item.daysOverdue || 0;
      out.push({
        type: 'revision',
        key: k,
        sub: item.sub, ch: item.ch, topic: item.topic,
        label: 'Revise ' + item.ch.name,
        meta: overdue > 0
          ? (overdue + ' day' + (overdue === 1 ? '' : 's') + ' overdue · ' + item.sub.name)
          : ('Due today · ' + item.sub.name),
        priority: 1,
        action: {
          kind: 'revision',
          revisionId: item.revisionId,
          offset: item.step.offset,
          subId: item.sub.id, chId: item.ch.id, tId: item.topic.id,
        },
      });
    }

    // 2) Weak topics (skipped many times or stale) — exclude any already covered.
    const weak = getWeakTopics();
    for (const w of weak) {
      if (out.length >= limit) break;
      const k = topicKey(w.sub.id, w.ch.id, w.topic.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        type: 'weak',
        key: k,
        sub: w.sub, ch: w.ch, topic: w.topic,
        label: 'Study ' + w.topic.name + ' today',
        meta: w.reason + ' · ' + w.sub.name,
        priority: 2,
        action: {
          kind: 'topic',
          subId: w.sub.id, chId: w.ch.id, tId: w.topic.id,
        },
      });
    }

    // 3) Incomplete topics — prefer chapters scheduled today and high-priority.
    if (out.length < limit) {
      const incomplete = collectIncompleteTopics(seen);
      for (const it of incomplete) {
        if (out.length >= limit) break;
        seen.add(it.key);
        out.push({
          type: 'incomplete',
          key: it.key,
          sub: it.sub, ch: it.ch, topic: it.topic,
          label: 'Continue ' + it.topic.name,
          meta: it.reason + ' · ' + it.sub.name,
          priority: 3,
          action: {
            kind: 'topic',
            subId: it.sub.id, chId: it.ch.id, tId: it.topic.id,
          },
        });
      }
    }

    return out;
  }

  // Walks the syllabus and returns incomplete topics with a "why" reason,
  // skipping anything already in `excludeKeys`. Sorted by usefulness:
  // (a) chapter scheduled today, (b) high-priority chapter, (c) other.
  function collectIncompleteTopics(excludeKeys) {
    const today = todayKey();
    const buckets = { today: [], high: [], rest: [] };
    for (const sub of state.subjects) {
      for (const ch of sub.chapters) {
        if (isChapterEffectivelyDone(ch)) continue;
        for (const t of ch.topics) {
          if (t.done) continue;
          const k = topicKey(sub.id, ch.id, t.id);
          if (excludeKeys && excludeKeys.has(k)) continue;
          const item = { sub, ch, topic: t, key: k, reason: '' };
          if (ch.scheduledDate === today) {
            item.reason = 'Scheduled for today · ' + ch.name;
            buckets.today.push(item);
          } else if (ch.priority === 'high') {
            item.reason = 'High priority · ' + ch.name;
            buckets.high.push(item);
          } else {
            item.reason = 'In progress · ' + ch.name;
            buckets.rest.push(item);
          }
        }
      }
    }
    return buckets.today.concat(buckets.high, buckets.rest);
  }

  // Set of topic keys that are currently "recommended", used to highlight
  // matching items in the existing Today's Plan & Weak Areas lists.
  function getSuggestedKeys() {
    const set = new Set();
    for (const s of getSmartSuggestions(SUGGEST_LIMIT)) set.add(s.key);
    return set;
  }

  function suggestionTypeMeta(type) {
    if (type === 'revision') return { icon: '🔁', tag: 'Revision due', cls: 'sug-revision' };
    if (type === 'weak')     return { icon: '⚠️', tag: 'Weak topic',    cls: 'sug-weak' };
    return                          { icon: '📘', tag: 'Continue',       cls: 'sug-incomplete' };
  }

  function renderSmartSuggestions() {
    const items = getSmartSuggestions(SUGGEST_LIMIT);
    if (!items.length) {
      return `
        <div class="suggestion-card empty-suggestion">
          <div class="suggestion-card-header">
            <span class="suggestion-card-icon">💡</span>
            <h3>Smart Suggestions</h3>
          </div>
          <div class="empty">All caught up — no suggestions right now. Add topics or schedule chapters to get personalized study tips.</div>
        </div>
      `;
    }
    const list = items.map(s => {
      const meta = suggestionTypeMeta(s.type);
      const subColor = s.sub.color || 'var(--primary)';
      const isRev = s.action.kind === 'revision';
      const doneAttrs = isRev
        ? `data-act="suggest-rev-done" data-rev="${s.action.revisionId}" data-off="${s.action.offset}"`
        : `data-act="suggest-topic-done" data-sub="${s.action.subId}" data-ch="${s.action.chId}" data-t="${s.action.tId}"`;
      return `
        <div class="suggestion-item ${meta.cls}">
          <span class="suggestion-color-bar" style="background:${subColor}"></span>
          <div class="suggestion-icon">${meta.icon}</div>
          <div class="suggestion-body">
            <div class="suggestion-tag">${meta.tag}</div>
            <div class="suggestion-text">${escapeHTML(s.label)}</div>
            <div class="suggestion-meta">${escapeHTML(s.meta)}</div>
          </div>
          <div class="suggestion-actions">
            <button class="btn btn-ghost btn-sm" data-act="suggest-open" data-sub="${s.sub.id}" data-ch="${s.ch.id}">Open</button>
            <button class="btn btn-sm" ${doneAttrs} title="Mark done">${ic('check')}</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="suggestion-card">
        <div class="suggestion-card-header">
          <span class="suggestion-card-icon">💡</span>
          <h3>Smart Suggestions</h3>
          <span class="suggestion-card-sub">Auto-updated</span>
        </div>
        <div class="suggestion-list">${list}</div>
      </div>
    `;
  }

  // -------- Time helpers --------
  function formatTime12(hhmm) {
    if (!hhmm || !hhmm.includes(':')) return hhmm || '';
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return hhmm;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // -------- Reminder Time Picker (minimal — no clock icon) --------
  // `which` is 'reminder' or 'motivation' (which times[] array we are editing).
  // `index` is the index in the times[] array to update; -1 means "add new".
  function modalSetReminderTime(which, index) {
    const target = which === 'motivation' ? state.motivationReminders : state.smartReminder;
    const isAdd = (index == null || index < 0);
    const initial = isAdd
      ? (target.times[target.times.length - 1] || '09:00')
      : (target.times[index] || '09:00');
    let [h, m] = initial.split(':').map(Number);
    if (isNaN(h)) h = 9;
    if (isNaN(m)) m = 0;
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));

    const titlePrefix = which === 'motivation' ? 'Motivation' : 'Reminder';
    const titleVerb   = isAdd ? 'Add' : 'Edit';

    openModal(`
      <h3>${titleVerb} ${titlePrefix} Time</h3>
      <div class="tp-wrap-min">
        <div class="tp-display">
          <span class="tp-h">${String(((h + 11) % 12) + 1).padStart(2, '0')}</span>
          <span class="tp-sep">:</span>
          <span class="tp-m">${String(m).padStart(2, '0')}</span>
          <span class="tp-ampm-lbl">${h < 12 ? 'AM' : 'PM'}</span>
        </div>

        <div class="tp-steppers">
          <div class="tp-stepper">
            <div class="tp-s-label">Hour</div>
            <div class="tp-s-row">
              <button class="tp-s-btn" data-tp="h-down" type="button" aria-label="Hour down">−</button>
              <div class="tp-s-val tp-val-h">${String(h).padStart(2, '0')}</div>
              <button class="tp-s-btn" data-tp="h-up" type="button" aria-label="Hour up">+</button>
            </div>
          </div>
          <div class="tp-stepper">
            <div class="tp-s-label">Minute</div>
            <div class="tp-s-row">
              <button class="tp-s-btn" data-tp="m-down" type="button" aria-label="Minute down">−</button>
              <div class="tp-s-val tp-val-m">${String(m).padStart(2, '0')}</div>
              <button class="tp-s-btn" data-tp="m-up" type="button" aria-label="Minute up">+</button>
            </div>
          </div>
        </div>

        <div class="tp-ampm">
          <button class="tp-chip ${h < 12 ? 'on' : ''}" data-tp-ampm="AM" type="button">AM</button>
          <button class="tp-chip ${h >= 12 ? 'on' : ''}" data-tp-ampm="PM" type="button">PM</button>
        </div>

        <div class="tp-presets">
          <button class="tp-chip" data-tp-set="07:00" type="button">7:00 AM</button>
          <button class="tp-chip" data-tp-set="09:00" type="button">9:00 AM</button>
          <button class="tp-chip" data-tp-set="12:00" type="button">12:00 PM</button>
          <button class="tp-chip" data-tp-set="18:00" type="button">6:00 PM</button>
          <button class="tp-chip" data-tp-set="20:00" type="button">8:00 PM</button>
          <button class="tp-chip" data-tp-set="21:00" type="button">9:00 PM</button>
        </div>
      </div>

      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close type="button">Cancel</button>
        <button class="btn btn-primary" id="tp-save" type="button">${isAdd ? 'Add Time' : 'Save'}</button>
      </div>
    `, () => {
      const root = document.getElementById('modal-root');

      function update() {
        h = ((h % 24) + 24) % 24;
        m = ((m % 60) + 60) % 60;
        const h12 = ((h + 11) % 12) + 1;
        const ampm = h < 12 ? 'AM' : 'PM';
        root.querySelector('.tp-h').textContent = String(h12).padStart(2, '0');
        root.querySelector('.tp-m').textContent = String(m).padStart(2, '0');
        root.querySelector('.tp-ampm-lbl').textContent = ampm;
        root.querySelector('.tp-val-h').textContent = String(h).padStart(2, '0');
        root.querySelector('.tp-val-m').textContent = String(m).padStart(2, '0');
        root.querySelectorAll('[data-tp-ampm]').forEach(b => {
          b.classList.toggle('on', b.dataset.tpAmpm === ampm);
        });
      }

      function attachHold(btn, fn) {
        let timer = null, repeat = null, active = false;
        function start(e) {
          if (active) return;
          active = true;
          e.preventDefault();
          try { btn.setPointerCapture(e.pointerId); } catch (_) {}
          fn();
          timer = setTimeout(() => { repeat = setInterval(fn, 80); }, 350);
        }
        function stop() {
          if (!active) return;
          active = false;
          if (timer) { clearTimeout(timer); timer = null; }
          if (repeat) { clearInterval(repeat); repeat = null; }
        }
        btn.addEventListener('pointerdown', start);
        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointerleave', stop);
        btn.addEventListener('pointercancel', stop);
      }

      root.querySelectorAll('[data-tp]').forEach(btn => {
        const tp = btn.dataset.tp;
        const fn = () => {
          if (tp === 'h-up') h++;
          else if (tp === 'h-down') h--;
          else if (tp === 'm-up') m++;
          else if (tp === 'm-down') m--;
          update();
        };
        attachHold(btn, fn);
      });

      root.querySelectorAll('[data-tp-ampm]').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.dataset.tpAmpm;
          if (t === 'AM' && h >= 12) h -= 12;
          if (t === 'PM' && h < 12) h += 12;
          update();
        });
      });

      root.querySelectorAll('[data-tp-set]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [hh, mm] = btn.dataset.tpSet.split(':').map(Number);
          h = hh; m = mm;
          update();
        });
      });

      const saveBtn = document.getElementById('tp-save');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (isAdd) {
          if (!target.times.includes(v)) target.times.push(v);
        } else {
          target.times[index] = v;
        }
        target.times.sort();
        // De-dupe just in case.
        target.times = Array.from(new Set(target.times));
        // Allow re-fire today if the new time hasn't passed yet.
        target.lastFired = target.lastFired || {};
        saveState();
        closeModal();
        modalSettings();
        toast(`${titlePrefix} time ${isAdd ? 'added' : 'updated'} (${formatTime12(v)})`, 'success');
      });
    });
  }

  // -------- Settings Modal --------
  function modalSettings() {
    const sr = state.smartReminder;
    const mr = state.motivationReminders;
    const perm = notifPermission();
    let permCls, permText;
    if (perm === 'unsupported') { permCls = 'warn'; permText = 'Notifications are not supported on this browser. The app will use an in-app alert instead.'; }
    else if (perm === 'granted') { permCls = 'ok'; permText = 'Notifications are allowed on this device.'; }
    else if (perm === 'denied')  { permCls = 'err'; permText = 'Notifications are blocked. Enable them in your browser/site settings, or the app will fall back to an in-app alert.'; }
    else                          { permCls = 'warn'; permText = 'Notification permission has not been requested yet.'; }

    const renderTimeChips = (which, list) => list.map((t, i) => `
      <span class="time-chip">
        <button type="button" class="time-chip-edit" data-act="open-time-picker"
          data-which="${which}" data-i="${i}" aria-label="Edit time">${escapeHTML(formatTime12(t))}</button>
        <button type="button" class="time-chip-del" data-act="del-time-slot"
          data-which="${which}" data-i="${i}" aria-label="Remove time">×</button>
      </span>
    `).join('');

    openModal(`
      <h3>Settings</h3>

      <div class="settings-section">
        <h4>Daily Study Reminder</h4>
        <div class="settings-row">
          <div class="label">
            Notify me if today's tasks aren't done
            <div class="sub">You can set multiple reminder times.</div>
          </div>
          <label class="switch" aria-label="Toggle reminder">
            <input type="checkbox" id="set-sr-toggle" ${sr.enabled ? 'checked' : ''} data-act="toggle-smart-reminder"/>
            <span class="slider"></span>
          </label>
        </div>
        <div class="time-chip-row" style="${sr.enabled ? '' : 'opacity:.55;pointer-events:none'}">
          ${sr.times.length ? renderTimeChips('reminder', sr.times) : `<span class="muted" style="font-size:12.5px">No times set.</span>`}
          <button type="button" class="time-chip add" data-act="open-time-picker" data-which="reminder" data-i="-1">+ Add time</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>Motivation Notifications</h4>
        <div class="settings-row">
          <div class="label">
            Send motivational push messages
            <div class="sub">A random quote at each scheduled time.</div>
          </div>
          <label class="switch" aria-label="Toggle motivation">
            <input type="checkbox" id="set-mr-toggle" ${mr.enabled ? 'checked' : ''} data-act="toggle-motivation"/>
            <span class="slider"></span>
          </label>
        </div>
        <div class="time-chip-row" style="${mr.enabled ? '' : 'opacity:.55;pointer-events:none'}">
          ${mr.times.length ? renderTimeChips('motivation', mr.times) : `<span class="muted" style="font-size:12.5px">No times set.</span>`}
          <button type="button" class="time-chip add" data-act="open-time-picker" data-which="motivation" data-i="-1">+ Add time</button>
        </div>
      </div>

      <div class="settings-section">
        <h4>Notifications Status</h4>
        <div class="notif-status ${permCls}">${escapeHTML(permText)}</div>
        ${(perm === 'default' || perm === 'denied') && perm !== 'unsupported' ? `
          <div style="margin-top:10px">
            <button class="btn btn-block" data-act="sr-request-perm">
              ${perm === 'denied' ? 'Try requesting again' : 'Allow notifications'}
            </button>
          </div>
        ` : ''}
        <div class="muted" style="font-size:12px;margin-top:8px">
          Notifications use your browser's built-in system and a service worker so they can fire even when this tab is in the background. On phones, allow notifications when prompted.
        </div>
      </div>

      <div class="settings-section">
        <h4>Motivation Quotes</h4>
        <div class="muted" style="font-size:12.5px">These quotes are randomly chosen for motivation notifications.</div>
        <div class="quote-list">
          ${state.motivationQuotes.length
            ? state.motivationQuotes.map((q, i) => `
              <div class="quote-row">
                <div class="text">${escapeHTML(q)}</div>
                <button class="menu-btn" data-act="del-quote" data-i="${i}" aria-label="Delete quote">${ic('trash')}</button>
              </div>`).join('')
            : `<div class="muted" style="margin-top:8px">No quotes yet.</div>`}
        </div>
        <div class="quote-add-row">
          <input id="set-new-quote" placeholder="Add a motivation quote..." maxlength="200"/>
          <button class="btn" data-act="add-quote" aria-label="Add quote">${ic('plus')}</button>
        </div>
      </div>

      <div class="actions" style="margin-top:18px">
        <button class="btn btn-ghost" data-close>Close</button>
      </div>
    `);
  }

  function isSettingsModalOpen() {
    const root = document.getElementById('modal-root');
    if (!root) return false;
    const h = root.querySelector('.modal h3');
    return !!(h && h.textContent.trim() === 'Settings');
  }
  function refreshSettingsIfOpen() {
    if (isSettingsModalOpen()) modalSettings();
  }

  // -------- Calendar View --------
  // Tracks the currently viewed month. Initialized to today.
  const _calNow = new Date();
  let calView = { year: _calNow.getFullYear(), month: _calNow.getMonth() }; // month: 0-11

  function isoFromYMD(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Classify a calendar cell relative to today and install date.
  // Returns one of: 'today' | 'completed' | 'missed' | 'future' | 'empty'
  function classifyCalDay(iso) {
    const today = todayKey();
    if (iso === today) return 'today';
    if (iso > today) return 'future';
    const installDate = (state.burnout && state.burnout.installDate) || null;
    if (installDate && iso < installDate) return 'empty';
    return ((state.activity[iso] || 0) > 0) ? 'completed' : 'missed';
  }

  function renderCalendar() {
    const view = document.getElementById('view-calendar');
    if (!view) return;

    const y = calView.year, m = calView.month;
    const firstDay = new Date(y, m, 1);
    const startWeekday = firstDay.getDay(); // 0 = Sun
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const monthLabel = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    // Build cells (leading blanks + days)
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ empty: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoFromYMD(y, m, d);
      cells.push({ day: d, iso, kind: classifyCalDay(iso) });
    }
    // Pad trailing so we keep complete weeks (nicer look)
    while (cells.length % 7 !== 0) cells.push({ empty: true });

    // Stats for this month (only past + today, capped at install date)
    const installDate = (state.burnout && state.burnout.installDate) || null;
    const today = todayKey();
    let completed = 0, missed = 0, eligible = 0;
    for (const c of cells) {
      if (!c.iso) continue;
      if (c.iso > today) continue;
      if (installDate && c.iso < installDate) continue;
      eligible++;
      if (c.kind === 'completed' || (c.iso === today && (state.activity[today] || 0) > 0)) completed++;
      else if (c.kind === 'missed') missed++;
    }
    const pct = eligible ? Math.round((completed / eligible) * 100) : 0;

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    view.innerHTML = `
      <div class="page-header">
        <h1>Calendar</h1>
        <div class="subtitle">Tap a day to see what you studied</div>
      </div>

      <div class="section-head">
        <h2>Today's Plan</h2>
        <button class="btn-link" data-act="regen-plan" title="Re-generate from incomplete topics">↻ Regenerate</button>
      </div>
      ${renderDailyPlan()}

      <div class="card" style="margin-top:18px">
        <div class="cal-toolbar">
          <button class="cal-nav-btn" data-act="cal-prev" aria-label="Previous month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="cal-title">${escapeHTML(monthLabel)}</div>
          <button class="cal-nav-btn" data-act="cal-next" aria-label="Next month">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button class="cal-today-btn" data-act="cal-today">Today</button>
        </div>

        <div class="cal-weekdays">
          ${weekdays.map(w => `<div>${w}</div>`).join('')}
        </div>

        <div class="cal-grid">
          ${cells.map(c => {
            if (c.empty) return `<div class="cal-day empty"></div>`;
            const cls = ['cal-day', c.kind];
            const interactive = c.kind !== 'empty';
            const dot = (c.kind === 'completed' || c.kind === 'missed') ? '<span class="cal-dot"></span>' : '';
            return `<div class="${cls.join(' ')}" ${interactive ? `data-act="cal-day" data-date="${c.iso}"` : ''}>
              <span class="cal-num">${c.day}</span>${dot}
            </div>`;
          }).join('')}
        </div>

        <div class="cal-legend">
          <span class="lg"><span class="sw completed"></span>Completed</span>
          <span class="lg"><span class="sw missed"></span>Missed</span>
          <span class="lg"><span class="sw today"></span>Today</span>
        </div>
      </div>

      <div class="cal-summary">
        <div class="stat-tile"><div class="v">${completed}</div><div class="k">Completed</div></div>
        <div class="stat-tile"><div class="v">${missed}</div><div class="k">Missed</div></div>
        <div class="stat-tile"><div class="v">${pct}%</div><div class="k">Consistency</div></div>
      </div>
    `;
  }

  // -------- Per-date calendar tasks (state.calendarTasks[iso]) --------
  function ensureCalendarTaskList(iso) {
    if (!state.calendarTasks) state.calendarTasks = {};
    if (!Array.isArray(state.calendarTasks[iso])) state.calendarTasks[iso] = [];
    return state.calendarTasks[iso];
  }
  function getCalendarTasks(iso) {
    if (!state.calendarTasks) return [];
    return state.calendarTasks[iso] || [];
  }
  function addCalendarTask(iso, text) {
    const list = ensureCalendarTaskList(iso);
    list.push({ id: uid(), text, done: false, createdAt: todayKey() });
    saveState();
  }
  function toggleCalendarTask(iso, id) {
    const list = getCalendarTasks(iso);
    const it = list.find(x => x.id === id); if (!it) return;
    it.done = !it.done;
    if (it.done && iso === todayKey()) bumpActivity();
    saveState();
  }
  function deleteCalendarTask(iso, id) {
    if (!state.calendarTasks || !state.calendarTasks[iso]) return;
    state.calendarTasks[iso] = state.calendarTasks[iso].filter(x => x.id !== id);
    if (state.calendarTasks[iso].length === 0) delete state.calendarTasks[iso];
    saveState();
  }

  // Build a list of items studied / planned for a specific date.
  function getStudiedForDate(iso) {
    const plan = state.dailyPlans[iso] || null;
    const auto = []; // { sub, ch, topic, doneNow }
    const custom = []; // { text, done }
    if (plan) {
      const removed = new Set(plan.removed || []);
      for (const a of (plan.auto || [])) {
        const key = autoKey(a.subId, a.chId, a.tId);
        if (removed.has(key)) continue;
        const sub = findSubject(a.subId);
        const ch = findChapter(a.subId, a.chId);
        const topic = findTopic(a.subId, a.chId, a.tId);
        if (!sub || !ch || !topic) continue;
        auto.push({ sub, ch, topic, doneNow: !!topic.done });
      }
      for (const c of (plan.custom || [])) {
        custom.push({ text: c.text, done: !!c.done });
      }
    }
    return { auto, custom };
  }

  function modalCalendarDay(iso) {
    const kind = classifyCalDay(iso);
    const activityCount = state.activity[iso] || 0;
    const { auto, custom } = getStudiedForDate(iso);
    const completedAuto = auto.filter(x => x.doneNow);
    const pendingAuto = auto.filter(x => !x.doneNow);
    const completedCustom = custom.filter(x => x.done);
    const pendingCustom = custom.filter(x => !x.done);
    const calTasks = getCalendarTasks(iso);

    const statusLabel = {
      today: 'Today',
      completed: 'Studied',
      missed: 'Missed',
      future: 'Upcoming',
      empty: 'Before you started',
    }[kind] || '';

    const renderItem = (sub, ch, topic, done) => `
      <div class="cal-day-item ${done ? '' : 'muted'}">
        <span class="bar" style="background:${sub.color}"></span>
        <div class="body">
          <div class="title">
            ${escapeHTML(topic.name)}
            <span class="pill ${done ? 'done' : 'pending'}">${done ? 'Done' : 'Pending'}</span>
          </div>
          <div class="meta">${escapeHTML(sub.name)} · ${escapeHTML(ch.name)}</div>
        </div>
      </div>
    `;
    const renderCustom = (c) => `
      <div class="cal-day-item ${c.done ? '' : 'muted'}">
        <span class="bar" style="background:#94a3b8"></span>
        <div class="body">
          <div class="title">
            ${escapeHTML(c.text)}
            <span class="pill ${c.done ? 'done' : 'pending'}">${c.done ? 'Done' : 'Pending'}</span>
          </div>
          <div class="meta">Custom task</div>
        </div>
      </div>
    `;

    // Editable tasks bound to this specific date (state.calendarTasks[iso]).
    const renderCalTask = (t) => `
      <div class="cal-task-row ${t.done ? 'is-done' : ''}">
        <input type="checkbox" class="check" ${t.done ? 'checked' : ''}
          data-act="cal-toggle-task" data-date="${iso}" data-id="${t.id}" aria-label="Toggle task done"/>
        <span class="cal-task-text">${escapeHTML(t.text)}</span>
        <button type="button" class="menu-btn" aria-label="Delete task"
          data-act="cal-del-task" data-date="${iso}" data-id="${t.id}">${ic('trash')}</button>
      </div>
    `;

    const tasksDone = calTasks.filter(t => t.done).length;
    const tasksHeading = `Tasks for this day (${tasksDone}/${calTasks.length})`;
    const tasksSection = `
      <div class="cal-day-section-title">${tasksHeading}</div>
      <div class="cal-task-list">
        ${calTasks.length
          ? calTasks.map(renderCalTask).join('')
          : `<div class="muted" style="font-size:13px;padding:6px 2px">No tasks added for this day yet.</div>`}
      </div>
      <div class="cal-task-add">
        <input type="text" class="cal-task-input" id="cal-task-input-${iso}"
          placeholder="Add a task or subject for ${escapeHTML(formatDate(iso))}" maxlength="120"
          data-cal-task-input data-date="${iso}"/>
        <button type="button" class="btn btn-sm" data-act="cal-add-task" data-date="${iso}">${ic('plus')}</button>
      </div>
    `;

    let activityBody = '';
    if (kind === 'future') {
      activityBody = `<div class="muted" style="margin-top:8px">This day hasn't happened yet — you can still add tasks below.</div>`;
    } else if (kind === 'empty') {
      activityBody = `<div class="muted" style="margin-top:8px">No prior activity — this date is before you started using the tracker.</div>`;
    } else {
      const hasAny = auto.length || custom.length || activityCount > 0;
      if (hasAny) {
        const stats = `
          <div class="kv-row" style="margin-top:6px">
            <span>Topics marked done</span><span class="v">${activityCount}</span>
          </div>
        `;
        const completedSection = (completedAuto.length || completedCustom.length) ? `
          <div class="cal-day-section-title">Tasks completed (${completedAuto.length + completedCustom.length})</div>
          <div class="cal-day-list">
            ${completedAuto.map(x => renderItem(x.sub, x.ch, x.topic, true)).join('')}
            ${completedCustom.map(renderCustom).join('')}
          </div>
        ` : '';
        const plannedSection = (pendingAuto.length || pendingCustom.length) ? `
          <div class="cal-day-section-title">Planned but not done (${pendingAuto.length + pendingCustom.length})</div>
          <div class="cal-day-list">
            ${pendingAuto.map(x => renderItem(x.sub, x.ch, x.topic, false)).join('')}
            ${pendingCustom.map(renderCustom).join('')}
          </div>
        ` : '';
        activityBody = stats + completedSection + plannedSection;
      }
    }

    openModal(`
      <h3 style="margin-bottom:6px">${escapeHTML(formatDate(iso))}</h3>
      <span class="cal-day-status ${kind}">${escapeHTML(statusLabel)}</span>
      ${activityBody}
      ${tasksSection}
      <div class="actions" style="margin-top:18px">
        <button class="btn btn-ghost" data-close>Close</button>
      </div>
    `, root => {
      const inp = root.querySelector(`#cal-task-input-${iso}`);
      if (inp) inp.focus();
    });
  }

  function renderRevision() {
    const view = document.getElementById('view-revision');
    if (!view) return;
    const due = dueRevisionItems();
    const upcoming = upcomingRevisionItems(10);
    const totalEntries = state.revisions.length;
    const totalScheduledSteps = state.revisions.reduce((s, r) => s + r.schedule.filter(x => !x.done).length, 0);

    view.innerHTML = `
      <div class="page-header">
        <h1>Revision</h1>
        <div class="subtitle">Spaced repetition · 1d · 3d · 7d</div>
      </div>

      <div class="stats-row">
        <div class="stat-tile"><div class="v">${due.length}</div><div class="k">Due now</div></div>
        <div class="stat-tile"><div class="v">${totalScheduledSteps}</div><div class="k">Scheduled steps</div></div>
      </div>

      <button type="button" class="btn btn-block" data-act="add-chapter-revision" style="margin-bottom:14px">
        ${ic('plus')} Add Chapter for Revision
      </button>

      <div class="section-head"><h2>Revision Due</h2>
        <span class="muted" style="font-size:12px">${totalEntries} topic${totalEntries === 1 ? '' : 's'} tracked</span>
      </div>
      ${due.length
        ? `<div class="list">${due.map(renderDueRevision).join('')}</div>`
        : `<div class="empty">No revisions due. Mark topics as complete to schedule them automatically.</div>`}

      <div class="section-head" style="margin-top:18px"><h2>Upcoming</h2></div>
      ${upcoming.length
        ? `<div class="list">${upcoming.map(renderUpcomingRevision).join('')}</div>`
        : `<div class="empty">Nothing coming up.</div>`}

      <div class="card" style="margin-top:14px">
        <h3>How it works</h3>
        <div class="muted" style="margin-top:6px;font-size:13px;line-height:1.55">
          When you mark a topic as complete, three reviews are scheduled automatically:
          <strong>+1 day</strong>, <strong>+3 days</strong>, and <strong>+7 days</strong>.
          Tick each step here when you've revised it. Once all three are done, the entry is removed automatically.
        </div>
      </div>
    `;
  }

  function offsetLabel(off) {
    return off === 1 ? '1d' : off === 3 ? '3d' : off === 7 ? '7d' : `${off}d`;
  }
  function dueLabel(daysOverdue, dueDate) {
    if (daysOverdue === 0) return 'Due today';
    if (daysOverdue === 1) return '1 day overdue';
    return `${daysOverdue} days overdue`;
  }
  function untilLabel(daysUntil) {
    if (daysUntil === 1) return 'Tomorrow';
    return `In ${daysUntil} days`;
  }

  function renderDueRevision(item) {
    const { revisionId, sub, ch, topic, step, daysOverdue } = item;
    return `
      <div class="card card-row revision-item ${daysOverdue > 0 ? 'is-overdue' : ''}">
        <input type="checkbox" class="check"
          data-act="complete-revision-step"
          data-rev="${revisionId}" data-off="${step.offset}"
          aria-label="Mark revision complete"/>
        <span class="color-dot" style="background:${sub.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title">${escapeHTML(topic.name)}</div>
          <div class="meta">${escapeHTML(sub.name)} · ${escapeHTML(ch.name)}</div>
          <div class="badges" style="margin-top:6px">
            <span class="pill rev-pill">Review ${offsetLabel(step.offset)}</span>
            <span class="pill ${daysOverdue > 0 ? 'pill-overdue' : 'pill-today'}">${dueLabel(daysOverdue, step.dueDate)}</span>
          </div>
        </div>
        <button class="menu-btn" data-act="dismiss-revision" data-rev="${revisionId}" aria-label="Remove revision">${ic('trash')}</button>
      </div>`;
  }

  function renderUpcomingRevision(item) {
    const { sub, ch, topic, step, daysUntil } = item;
    return `
      <div class="card card-row revision-item upcoming">
        <span class="color-dot" style="background:${sub.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title">${escapeHTML(topic.name)}</div>
          <div class="meta">${escapeHTML(sub.name)} · ${escapeHTML(ch.name)}</div>
          <div class="badges" style="margin-top:6px">
            <span class="pill rev-pill">Review ${offsetLabel(step.offset)}</span>
            <span class="pill pill-upcoming">${untilLabel(daysUntil)}</span>
          </div>
        </div>
        <span class="muted" style="font-size:12px">${formatDate(step.dueDate)}</span>
      </div>`;
  }

  // -------- Stats --------
  function renderStats() {
    const view = document.getElementById('view-stats');
    const totalCh = state.subjects.reduce((s, x) => s + x.chapters.length, 0);
    const doneCh = state.subjects.reduce((s, x) => s + x.chapters.filter(isChapterEffectivelyDone).length, 0);
    const totalT = state.subjects.reduce((s, x) => s + x.chapters.reduce((a, c) => a + c.topics.length, 0), 0);
    const doneT = state.subjects.reduce((s, x) => s + x.chapters.reduce((a, c) => a + c.topics.filter(t => t.done).length, 0), 0);
    const totalRev = state.subjects.reduce((s, x) =>
      s + (x.revisionCount || 0) + x.chapters.reduce((a, c) =>
        a + (c.revisionCount || 0) + c.topics.reduce((b, t) => b + (t.revisionCount || 0), 0), 0), 0);

    const tPct = totalT ? Math.round((doneT / totalT) * 100) : 0;
    const circ = 2 * Math.PI * 42;
    const off = circ * (1 - tPct / 100);

    view.innerHTML = `
      <div class="page-header"><h1>Statistics</h1><div class="subtitle">Your study insights</div></div>

      <div class="stats-row">
        <div class="stat-tile"><div class="v">${doneCh}/${totalCh}</div><div class="k">Chapters done</div></div>
        <div class="stat-tile"><div class="v">${doneT}/${totalT}</div><div class="k">Topics done</div></div>
      </div>

      <div class="card">
        <h3>Topic Progress</h3>
        <div class="ring-wrap" style="margin-top:10px">
          <svg class="ring" viewBox="0 0 100 100">
            <circle class="bg" cx="50" cy="50" r="42"/>
            <circle class="fg" cx="50" cy="50" r="42" stroke-dasharray="${circ}" stroke-dashoffset="${off}"/>
            <text x="50" y="55" text-anchor="middle">${tPct}%</text>
          </svg>
          <div>
            <div class="title">${tPct}% complete</div>
            <div class="meta">${doneT} of ${totalT} topics finished</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>By Subject</h3>
        ${state.subjects.map(sub => {
          const tot = sub.chapters.length;
          const dn = sub.chapters.filter(isChapterEffectivelyDone).length;
          const pct = tot ? Math.round((dn / tot) * 100) : 0;
          return `<div style="margin-top:12px">
            <div class="row"><span class="color-dot" style="background:${sub.color}"></span>
              <span style="flex:1;font-weight:600">${escapeHTML(sub.name)}</span>
              <span class="muted">${dn}/${tot} · ${pct}%</span></div>
            <div class="progress" style="margin-top:6px"><span style="width:${pct}%"></span></div>
          </div>`;
        }).join('') || `<div class="muted">No subjects.</div>`}
      </div>

      <div class="card">
        <h3>Chapter Status</h3>
        <div class="chip-grid" style="margin-top:10px">
          ${state.subjects.flatMap(s => s.chapters.map(c => `
            <span class="chip ${isChapterEffectivelyDone(c) ? 'done' : ''} ${c.priority === 'high' && !isChapterEffectivelyDone(c) ? 'high' : ''}">${escapeHTML(c.name)}</span>
          `)).join('') || `<div class="muted">No chapters.</div>`}
        </div>
      </div>

      <div class="card">
        <h3>Daily Activity (7d)</h3>
        ${renderActivity(7)}
      </div>
      <div class="card">
        <h3>Weekly Activity (4w)</h3>
        ${renderActivityWeeks(4)}
      </div>
      <div class="card">
        <h3>Monthly Activity (6m)</h3>
        ${renderActivityMonths(6)}
      </div>

      <div class="card">
        <h3>Revisions</h3>
        <div class="kv-row"><span>Total revisions logged</span><span class="v">${totalRev}</span></div>
        <hr class="sep"/>
        <div style="max-height:220px;overflow:auto">
          ${state.subjects.flatMap(s => s.chapters.filter(c => c.revisionCount > 0).map(c => `
            <div class="kv-row"><span>${escapeHTML(s.name)} · ${escapeHTML(c.name)}</span><span class="v">×${c.revisionCount}</span></div>
          `)).join('') || `<div class="muted">No revisions yet.</div>`}
        </div>
      </div>

      <div class="card">
        <h3>Completed Chapters</h3>
        <div style="max-height:220px;overflow:auto">
          ${state.subjects.flatMap(s => s.chapters.filter(isChapterEffectivelyDone).map(c => `
            <div class="kv-row"><span>${escapeHTML(s.name)} · ${escapeHTML(c.name)}</span><span class="muted">done</span></div>
          `)).join('') || `<div class="muted">Nothing completed yet.</div>`}
        </div>
      </div>

      ${renderSettings()}
    `;
  }

  function renderSettings() {
    const sizeKB = (() => {
      try { return (new Blob([JSON.stringify(state)]).size / 1024).toFixed(1); }
      catch { return '?'; }
    })();
    return `
      <div class="card settings-card">
        <h3>Settings</h3>
        <div class="muted" style="margin-top:4px">Backup or restore everything: subjects, chapters, topics, progress, XP, level, streak.</div>

        <div class="settings-actions">
          <button class="btn btn-block" data-act="export-data">
            ${ic('download')} <span>Export Data (JSON)</span>
          </button>
          <button class="btn btn-ghost btn-block" data-act="import-data-pick">
            ${ic('upload')} <span>Import Data (JSON)</span>
          </button>
          <input type="file" id="import-file-input" accept="application/json,.json" style="display:none" data-act="import-file-change"/>
        </div>

        <div class="settings-meta">
          <div class="kv-row"><span>Storage key</span><span class="v">${escapeHTML(STORAGE_KEY)}</span></div>
          <div class="kv-row"><span>Current size</span><span class="v">${sizeKB} KB</span></div>
        </div>
      </div>
    `;
  }

  function renderActivity(days) {
    const counts = [], labels = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      counts.push(state.activity[d.toISOString().slice(0, 10)] || 0);
      labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2));
    }
    const max = Math.max(1, ...counts);
    return `<div class="bars">${counts.map(c => `<div class="bar" style="height:${(c / max) * 100}%"></div>`).join('')}</div>
      <div class="lbls">${labels.map(l => `<div class="lbl">${l}</div>`).join('')}</div>`;
  }
  function renderActivityWeeks(weeks) {
    const counts = [], labels = [];
    for (let w = weeks - 1; w >= 0; w--) {
      let total = 0;
      for (let d = 0; d < 7; d++) {
        const dt = new Date(); dt.setDate(dt.getDate() - (w * 7 + d));
        total += state.activity[dt.toISOString().slice(0, 10)] || 0;
      }
      counts.push(total); labels.push(`W${weeks - w}`);
    }
    const max = Math.max(1, ...counts);
    return `<div class="bars">${counts.map(c => `<div class="bar" style="height:${(c / max) * 100}%"></div>`).join('')}</div>
      <div class="lbls">${labels.map(l => `<div class="lbl">${l}</div>`).join('')}</div>`;
  }
  function renderActivityMonths(months) {
    const counts = [], labels = [];
    const now = new Date();
    for (let m = months - 1; m >= 0; m--) {
      const month = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
      let total = 0;
      for (const k in state.activity) {
        const d = new Date(k + 'T00:00:00');
        if (d >= month && d < next) total += state.activity[k];
      }
      counts.push(total);
      labels.push(month.toLocaleDateString(undefined, { month: 'short' }));
    }
    const max = Math.max(1, ...counts);
    return `<div class="bars">${counts.map(c => `<div class="bar" style="height:${(c / max) * 100}%"></div>`).join('')}</div>
      <div class="lbls">${labels.map(l => `<div class="lbl">${l}</div>`).join('')}</div>`;
  }

  // ========== Modals ==========
  function modalAddSubject(existing) {
    openModal(`
      <h3>${existing ? 'Edit Subject' : 'New Subject'}</h3>
      <div class="field"><label>Name</label><input id="m-name" value="${existing ? escapeHTML(existing.name) : ''}" placeholder="e.g. Mathematics"/></div>
      <div class="field"><label>Color</label><input id="m-color" type="color" value="${existing ? existing.color : '#38bdf8'}" style="height:48px;padding:4px"/></div>
      <div class="field"><label>Notes (optional)</label><textarea id="m-notes" placeholder="Anything to remember">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add'}</button>
      </div>
    `, root => {
      root.querySelector('#m-name').focus();
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name is required', 'warn'); return; }
        const color = root.querySelector('#m-color').value;
        const notes = root.querySelector('#m-notes').value.trim();
        let newId = null;
        if (existing) Object.assign(existing, { name, color, notes });
        else {
          newId = uid();
          state.subjects.push({ id: newId, name, color, notes, priority: null, revisionCount: 0, lastRevisedAt: null, checklist: makeDefaultChecklist(), chapters: [] });
          openSubjects.add(newId);
        }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Subject updated' : 'Subject added', 'success');
        if (newId) setTimeout(() => scrollToElement(`[data-sub-card="${newId}"]`), 60);
      };
    });
  }

  function modalAddChapter(subId, existing) {
    const sub = findSubject(subId); if (!sub) return;
    openModal(`
      <h3>${existing ? 'Edit Chapter' : 'New Chapter'} · ${escapeHTML(sub.name)}</h3>
      <div class="field"><label>Name</label><input id="m-name" value="${existing ? escapeHTML(existing.name) : ''}" placeholder="Chapter name"/></div>
      <div class="field"><label>Notes (optional)</label><textarea id="m-notes" placeholder="Quick note">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="field"><label>Schedule for date <span class="muted" style="font-size:11px">(optional)</span></label><input id="m-date" type="date" value="${existing && existing.scheduledDate ? existing.scheduledDate : ''}"/></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add'}</button>
      </div>
    `, root => {
      root.querySelector('#m-name').focus();
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name required', 'warn'); return; }
        const notes = root.querySelector('#m-notes').value.trim();
        const date = root.querySelector('#m-date').value || null;
        let newId = null;
        if (existing) Object.assign(existing, { name, notes, scheduledDate: date });
        else {
          newId = uid();
          sub.chapters.push({ id: newId, name, notes, priority: null, revisionCount: 0, lastRevisedAt: null, done: false, scheduledDate: date, checklist: makeDefaultChecklist(), topics: [] });
          openSubjects.add(sub.id);
          openChapters.add(newId);
        }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Chapter updated' : 'Chapter added', 'success');
        if (newId) setTimeout(() => scrollToElement(`[data-ch-card="${newId}"]`), 60);
      };
    });
  }

  function modalAddTopic(subId, chId, existing) {
    const c = findChapter(subId, chId); if (!c) return;
    openModal(`
      <h3>${existing ? 'Edit Topic' : 'New Topic'}</h3>
      <div class="field"><label>Name</label><input id="m-name" value="${existing ? escapeHTML(existing.name) : ''}" placeholder="Topic name"/></div>
      <div class="field"><label>Notes (optional)</label><textarea id="m-notes" placeholder="Quick note">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add'}</button>
      </div>
    `, root => {
      root.querySelector('#m-name').focus();
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name required', 'warn'); return; }
        const notes = root.querySelector('#m-notes').value.trim();
        let newId = null;
        if (existing) Object.assign(existing, { name, notes });
        else {
          newId = uid();
          c.topics.push({ id: newId, name, notes, done: false, priority: null, revisionCount: 0, skipCount: 0, firstSeenAt: todayKey(), lastSkippedAt: null });
          openSubjects.add(subId);
          openChapters.add(chId);
        }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Topic updated' : 'Topic added', 'success');
        if (newId) setTimeout(() => scrollToElement(`[data-t-card="${newId}"]`), 60);
      };
    });
  }

  function modalEditNote(target, label) {
    openModal(`
      <h3>Note · ${escapeHTML(label)}</h3>
      <div class="field"><label>Note</label><textarea id="m-notes" placeholder="Write a quick note">${escapeHTML(target.notes || '')}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="m-save">Save</button>
      </div>
    `, root => {
      root.querySelector('#m-notes').focus();
      root.querySelector('#m-save').onclick = () => {
        target.notes = root.querySelector('#m-notes').value.trim();
        saveState(); closeModal(); renderAll(); toast('Note saved', 'success');
      };
    });
  }

  function modalEditName(target, label) {
    openModal(`
      <h3>Rename · ${escapeHTML(label)}</h3>
      <div class="field"><label>Name</label><input id="m-name" value="${escapeHTML(target.name)}"/></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="m-save">Save</button>
      </div>
    `, root => {
      const inp = root.querySelector('#m-name'); inp.focus(); inp.select();
      root.querySelector('#m-save').onclick = () => {
        const v = inp.value.trim();
        if (!v) { toast('Name required', 'warn'); return; }
        target.name = v;
        saveState(); closeModal(); renderAll(); toast('Renamed', 'success');
      };
    });
  }

  function modalSetPriority(target, label, cascade) {
    const sel = (p) => target.priority === p ? `sel-${p === 'high' ? 'high' : p === 'medium' ? 'med' : 'low'}` : '';
    openModal(`
      <h3>Set Priority · ${escapeHTML(label)}</h3>
      <div class="priority-row">
        <button data-p="high" class="${sel('high')}">HIGH</button>
        <button data-p="medium" class="${sel('medium')}">MEDIUM</button>
        <button data-p="low" class="${sel('low')}">LOW</button>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Close</button>
        <button class="btn-link" id="m-clear">Clear priority</button>
      </div>
    `, root => {
      root.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
        target.priority = b.dataset.p;
        if (cascade && target.chapters) target.chapters.forEach(c => c.priority = b.dataset.p);
        saveState(); closeModal(); renderAll(); toast('Priority set', 'success');
      });
      root.querySelector('#m-clear').onclick = () => {
        target.priority = null;
        if (cascade && target.chapters) target.chapters.forEach(c => c.priority = null);
        saveState(); closeModal(); renderAll(); toast('Priority cleared', 'info');
      };
    });
  }

  function modalAddExam(existing) {
    openModal(`
      <h3>${existing ? 'Edit Exam' : 'Add Exam'}</h3>
      <div class="field"><label>Name</label><input id="m-name" value="${existing ? escapeHTML(existing.name) : ''}" placeholder="e.g. Final Exam"/></div>
      <div class="field"><label>Date</label><input id="m-date" type="date" value="${existing ? existing.date : ''}"/></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add'}</button>
      </div>
    `, root => {
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        const date = root.querySelector('#m-date').value;
        if (!name || !date) { toast('Name & date required', 'warn'); return; }
        if (existing) Object.assign(existing, { name, date });
        else state.exams.push({ id: uid(), name, date });
        saveState(); closeModal(); renderAll(); toast(existing ? 'Exam updated' : 'Exam added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => {
        state.exams = state.exams.filter(e => e.id !== existing.id);
        saveState(); closeModal(); renderAll(); toast('Exam deleted', 'danger');
      };
    });
  }

  // -------- Add Chapter (or chapter+topics) for spaced revision --------
  // Lets the user pick any chapter from any subject and immediately schedule
  // its topics into the spaced-repetition queue (1 d / 3 d / 7 d).
  function modalAddChapterForRevision() {
    const subjects = (state.subjects || []).filter(s => (s.chapters || []).length);
    if (!subjects.length) {
      toast('Add a subject and chapter first', 'warn');
      return;
    }
    const subjOpts = subjects.map(s =>
      `<option value="${s.id}">${escapeHTML(s.name)}</option>`
    ).join('');

    openModal(`
      <h3>Add Chapter for Revision</h3>
      <div class="muted" style="font-size:12.5px;margin-bottom:10px">
        Schedules every selected topic into spaced revision (1 / 3 / 7 days).
      </div>
      <div class="field">
        <label>Subject</label>
        <select id="rv-sub" class="plan-sel">
          <option value="">Choose subject…</option>
          ${subjOpts}
        </select>
      </div>
      <div class="field">
        <label>Chapter</label>
        <select id="rv-ch" class="plan-sel" disabled>
          <option value="">Choose chapter…</option>
        </select>
      </div>
      <div class="field" id="rv-topics-wrap" style="display:none">
        <label>Topics to schedule</label>
        <div id="rv-topics" class="rv-topic-list"></div>
        <div style="margin-top:6px">
          <button type="button" class="btn-link" id="rv-all">Select all</button>
          <button type="button" class="btn-link" id="rv-none" style="margin-left:10px">None</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="rv-save" disabled>Add to Revision</button>
      </div>
    `, root => {
      const subSel = root.querySelector('#rv-sub');
      const chSel  = root.querySelector('#rv-ch');
      const tWrap  = root.querySelector('#rv-topics-wrap');
      const tList  = root.querySelector('#rv-topics');
      const save   = root.querySelector('#rv-save');

      function refreshTopics() {
        const sub = findSubject(subSel.value);
        const ch  = sub ? sub.chapters.find(c => c.id === chSel.value) : null;
        if (!ch || !(ch.topics || []).length) {
          tWrap.style.display = 'none';
          tList.innerHTML = '';
          save.disabled = true;
          return;
        }
        tWrap.style.display = '';
        tList.innerHTML = ch.topics.map(t => `
          <label class="rv-topic-row">
            <input type="checkbox" class="rv-topic-cb" data-tid="${t.id}" checked/>
            <span>${escapeHTML(t.name)}</span>
          </label>
        `).join('');
        save.disabled = false;
      }

      subSel.onchange = () => {
        const sub = findSubject(subSel.value);
        chSel.innerHTML = `<option value="">Choose chapter…</option>` + (sub
          ? sub.chapters.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')
          : '');
        chSel.disabled = !sub;
        tWrap.style.display = 'none';
        save.disabled = true;
      };
      chSel.onchange = refreshTopics;

      root.querySelector('#rv-all').onclick = () => {
        tList.querySelectorAll('.rv-topic-cb').forEach(cb => { cb.checked = true; });
      };
      root.querySelector('#rv-none').onclick = () => {
        tList.querySelectorAll('.rv-topic-cb').forEach(cb => { cb.checked = false; });
      };

      save.onclick = () => {
        const subId = subSel.value, chId = chSel.value;
        if (!subId || !chId) return;
        const picked = Array.from(tList.querySelectorAll('.rv-topic-cb'))
          .filter(cb => cb.checked).map(cb => cb.dataset.tid);
        if (!picked.length) { toast('Pick at least one topic', 'warn'); return; }
        picked.forEach(tId => scheduleRevisionsForTopic(subId, chId, tId));
        saveState(); closeModal(); renderAll();
        toast(`Added ${picked.length} topic${picked.length === 1 ? '' : 's'} to revision`, 'success');
      };
    });
  }

  // ========== Dropdown menus ==========
  function closeDropdown() { if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; } }

  function openDropdown(anchor, items) {
    closeDropdown();
    const dd = document.createElement('div');
    dd.className = 'dropdown';

    // Renders the menu HTML. Called on first open and again whenever an
    // in-menu counter changes so the displayed count updates without
    // closing the dropdown.
    function paint() {
      dd.innerHTML = items.map((it, i) => {
        if (it.type === 'counter') {
          const v = it.getValue ? it.getValue() : (it.value || 0);
          const sub = it.subLabel ? `<div class="dd-counter-sub">${escapeHTML(it.subLabel())}</div>` : '';
          return `
            <div class="dd-counter" data-i="${i}">
              <div class="dd-counter-head">
                <span class="dd-counter-label">${escapeHTML(it.label)}</span>
              </div>
              <div class="dd-counter-row">
                <button type="button" class="dd-rev-btn" data-rev-act="dec" ${v <= 0 ? 'disabled' : ''} aria-label="Decrease revision count">−1</button>
                <span class="dd-rev-count" aria-live="polite">${v}</span>
                <button type="button" class="dd-rev-btn" data-rev-act="inc" aria-label="Increase revision count">+1</button>
              </div>
              ${sub}
            </div>
          `;
        }
        return `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}">${ic(it.icon || 'edit')}<span>${escapeHTML(it.label)}</span></button>`;
      }).join('');
    }
    paint();

    const host = anchor.closest('.card, .chapter, .topic') || document.body;
    host.appendChild(dd);
    activeDropdown = dd;

    dd.addEventListener('click', e => {
      // Counter +1 / −1 — keep menu open, re-render in place.
      const counterBtn = e.target.closest('[data-rev-act]');
      if (counterBtn) {
        e.stopPropagation();
        if (counterBtn.disabled) return;
        const wrap = counterBtn.closest('[data-i]');
        const idx = +wrap.dataset.i;
        const op = counterBtn.dataset.revAct;
        const it = items[idx];
        if (it && typeof it.onChange === 'function') {
          it.onChange(op);
          paint();
        }
        return;
      }
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      e.stopPropagation();
      const idx = +b.dataset.i;
      closeDropdown();
      const it = items[idx];
      if (it && typeof it.onClick === 'function') it.onClick();
    });

    setTimeout(() => {
      document.addEventListener('click', closeDropdown, { once: true });
    }, 0);
  }

  function subjectMenu(sub) {
    return [
      { label: 'Edit Name', icon: 'edit', onClick: () => modalEditName(sub, sub.name) },
      { label: 'Take Note', icon: 'note', onClick: () => modalEditNote(sub, sub.name) },
      { label: 'Set Priority', icon: 'flag', onClick: () => modalSetPriority(sub, sub.name, true) },
      makeRevisionCounterItem(sub, 'subject'),
      makeMarkRevisedItem(sub, 'subject'),
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
        confirmModal(`Delete subject "${sub.name}" and all its chapters?`, () => {
          state.subjects = state.subjects.filter(s => s.id !== sub.id);
          openSubjects.delete(sub.id);
          saveState(); renderAll(); toast('Subject deleted', 'danger');
        });
      }},
    ];
  }
  // Build a "Revision" counter item for the dropdown menu.
  // `target` is the chapter or topic object. `kind` is "chapter" | "topic".
  function makeRevisionCounterItem(target, kind) {
    return {
      type: 'counter',
      label: 'Revisions',
      getValue: () => target.revisionCount || 0,
      subLabel: () => target.lastRevisedAt
        ? `Last revised: ${formatRevisedAt(target.lastRevisedAt)}`
        : 'Not revised yet',
      onChange: (op) => {
        if (op === 'inc') {
          target.revisionCount = (target.revisionCount || 0) + 1;
          saveState(); renderSyllabus();
        } else if (op === 'dec') {
          if ((target.revisionCount || 0) <= 0) return;
          target.revisionCount = (target.revisionCount || 0) - 1;
          saveState(); renderSyllabus();
        }
      },
    };
  }

  function makeMarkRevisedItem(target, kind) {
    const kindLabel = kind === 'subject' ? 'Subject' : kind === 'chapter' ? 'Chapter' : 'Topic';
    return {
      label: 'Mark as Revised',
      icon: 'revisit',
      onClick: () => {
        target.revisionCount = (target.revisionCount || 0) + 1;
        target.lastRevisedAt = new Date().toISOString();
        bumpActivity();
        saveState(); renderAll();
        toast(`${kindLabel} revised — count: ${target.revisionCount}`, 'success');
      },
    };
  }

  function chapterMenu(sub, c) {
    return [
      { label: 'Edit Name', icon: 'edit', onClick: () => modalEditName(c, c.name) },
      { label: 'Take Note', icon: 'note', onClick: () => modalEditNote(c, c.name) },
      { label: 'Set Priority', icon: 'flag', onClick: () => modalSetPriority(c, c.name, false) },
      { label: 'Schedule Date', icon: 'cal', onClick: () => modalAddChapter(sub.id, c) },
      makeRevisionCounterItem(c, 'chapter'),
      makeMarkRevisedItem(c, 'chapter'),
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
        confirmModal(`Delete chapter "${c.name}"?`, () => {
          sub.chapters = sub.chapters.filter(x => x.id !== c.id);
          openChapters.delete(c.id);
          saveState(); renderAll(); toast('Chapter deleted', 'danger');
        });
      }},
    ];
  }
  function topicMenu(sub, c, t) {
    return [
      { label: 'Edit Name', icon: 'edit', onClick: () => modalEditName(t, t.name) },
      { label: 'Take Note', icon: 'note', onClick: () => modalEditNote(t, t.name) },
      { label: 'Set Priority', icon: 'flag', onClick: () => modalSetPriority(t, t.name, false) },
      makeRevisionCounterItem(t, 'topic'),
      makeMarkRevisedItem(t, 'topic'),
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => {
        confirmModal(`Delete topic "${t.name}"?`, () => {
          c.topics = c.topics.filter(x => x.id !== t.id);
          saveState(); renderAll(); toast('Topic deleted', 'danger');
        });
      }},
    ];
  }

  // ========== Tabs ==========
  function switchTab(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const next = document.getElementById('view-' + name);
    if (next) next.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    // Tag the body so CSS can show/hide the floating settings button only on the Dashboard tab.
    const tabClasses = ['tab-home','tab-dashboard','tab-syllabus','tab-calendar','tab-revision','tab-stats'];
    document.body.classList.remove(...tabClasses);
    document.body.classList.add('tab-' + name);
    closeDropdown();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ========== Event delegation ==========
  document.addEventListener('click', (e) => {
    const target = e.target;

    if (target.closest('[data-close]')) { closeModal(); return; }

    const navBtn = target.closest('.nav-btn');
    if (navBtn && navBtn.dataset.tab) { switchTab(navBtn.dataset.tab); return; }

    const actEl = target.closest('[data-act]');
    if (!actEl) return;

    const act = actEl.dataset.act;
    const subId = actEl.dataset.sub;
    const chId = actEl.dataset.ch;
    const tId = actEl.dataset.t;

    switch (act) {
      case 'goto-syllabus': switchTab('syllabus'); break;
      case 'cal-prev': {
        let m = calView.month - 1, y = calView.year;
        if (m < 0) { m = 11; y--; }
        calView = { year: y, month: m };
        renderCalendar();
        break;
      }
      case 'cal-next': {
        let m = calView.month + 1, y = calView.year;
        if (m > 11) { m = 0; y++; }
        calView = { year: y, month: m };
        renderCalendar();
        break;
      }
      case 'cal-today': {
        const n = new Date();
        calView = { year: n.getFullYear(), month: n.getMonth() };
        renderCalendar();
        break;
      }
      case 'cal-day': {
        const iso = actEl.dataset.date;
        if (iso) modalCalendarDay(iso);
        break;
      }
      case 'export-data': exportData(); break;
      case 'import-data-pick': {
        const inp = document.getElementById('import-file-input');
        if (inp) { inp.value = ''; inp.click(); }
        break;
      }
      case 'toggle-subject': {
        if (target.closest('.menu-btn')) return;
        if (openSubjects.has(subId)) openSubjects.delete(subId); else openSubjects.add(subId);
        renderSyllabus(); break;
      }
      case 'toggle-chapter': {
        if (openChapters.has(chId)) openChapters.delete(chId); else openChapters.add(chId);
        renderSyllabus(); break;
      }
      case 'toggle-chapter-done': {
        const c = findChapter(subId, chId); if (!c) break;
        const newVal = !isChapterEffectivelyDone(c);
        c.done = newVal;
        c.topics.forEach(t => {
          const wasDone = t.done;
          t.done = newVal;
          if (wasDone !== newVal) onTopicDoneChanged(subId, chId, t.id, newVal);
        });
        if (newVal) bumpActivity();
        saveState(); renderAll();
        toast(newVal ? 'Chapter completed 🎉 — revisions scheduled' : 'Marked incomplete', newVal ? 'success' : 'info');
        break;
      }
      case 'toggle-topic': {
        const t = findTopic(subId, chId, tId); if (!t) break;
        t.done = !t.done; if (t.done) bumpActivity();
        onTopicDoneChanged(subId, chId, tId, t.done);
        saveState(); renderAll();
        if (t.done) toast('Topic done — revisions scheduled', 'success');
        break;
      }
      case 'menu-subject': { e.stopPropagation(); openDropdown(actEl, subjectMenu(findSubject(subId))); break; }
      case 'menu-chapter': { e.stopPropagation(); openDropdown(actEl, chapterMenu(findSubject(subId), findChapter(subId, chId))); break; }
      case 'menu-topic':   { e.stopPropagation(); openDropdown(actEl, topicMenu(findSubject(subId), findChapter(subId, chId), findTopic(subId, chId, tId))); break; }
      case 'add-subject':  modalAddSubject(); break;
      case 'add-chapter':  modalAddChapter(subId); break;
      case 'add-topic':    modalAddTopic(subId, chId); break;
      case 'add-exam':     modalAddExam(); break;
      case 'edit-exam':    modalAddExam(state.exams.find(x => x.id === actEl.dataset.id)); break;
      case 'add-goal':  modalAddGoal(); break;
      case 'edit-goal': {
        const g = (state.goals || []).find(x => x.id === actEl.dataset.id);
        if (g) modalAddGoal(g);
        break;
      }
      case 'open-settings': { modalSettings(); break; }
      case 'open-dashboard': { switchTab('dashboard'); break; }
      case 'goto-calendar': { switchTab('calendar'); break; }
      case 'open-time-picker': {
        const which = actEl.dataset.which || 'reminder';
        const i = actEl.dataset.i != null ? parseInt(actEl.dataset.i, 10) : -1;
        modalSetReminderTime(which, i);
        break;
      }
      case 'del-time-slot': {
        const which = actEl.dataset.which;
        const i = parseInt(actEl.dataset.i, 10);
        const target = which === 'motivation' ? state.motivationReminders : state.smartReminder;
        if (Number.isInteger(i) && i >= 0 && i < target.times.length) {
          target.times.splice(i, 1);
          saveState();
          modalSettings();
        }
        break;
      }
      case 'toggle-motivation': {
        const cb = document.getElementById('set-mr-toggle');
        const next = cb ? cb.checked : !state.motivationReminders.enabled;
        state.motivationReminders.enabled = next;
        saveState();
        if (next) {
          const perm = notifPermission();
          if (perm === 'default') {
            requestNotifPermission().then((res) => {
              refreshSettingsIfOpen();
              if (res === 'granted') toast('Motivation notifications enabled', 'success');
              else toast('Motivation notifications saved', 'info');
            });
          } else {
            toast('Motivation notifications enabled', 'success');
            refreshSettingsIfOpen();
          }
        } else {
          toast('Motivation notifications off', 'info');
          refreshSettingsIfOpen();
        }
        break;
      }
      case 'add-chapter-revision': { modalAddChapterForRevision(); break; }
      case 'add-plan-from-syllabus': {
        const subSel = document.getElementById('plan-pick-sub');
        const chSel  = document.getElementById('plan-pick-ch');
        const tSel   = document.getElementById('plan-pick-t');
        const sId = subSel && subSel.value;
        const cId = chSel && chSel.value;
        const tIdSel = tSel && tSel.value;
        if (!sId || !cId) { toast('Pick a subject and chapter', 'warn'); return; }
        const sub = findSubject(sId), ch = findChapter(sId, cId);
        if (!sub || !ch) { toast('Selection not found', 'warn'); return; }
        const plan = ensureTodayPlan();
        if (tIdSel) {
          const t = findTopic(sId, cId, tIdSel);
          if (!t) { toast('Topic not found', 'warn'); return; }
          plan.custom.push({
            id: uid(),
            text: `${sub.name} · ${ch.name} · ${t.name}`,
            done: false,
            link: { subId: sId, chId: cId, tId: tIdSel }
          });
        } else {
          // No specific topic — add the chapter itself.
          plan.custom.push({
            id: uid(),
            text: `${sub.name} · ${ch.name}`,
            done: false,
            link: { subId: sId, chId: cId }
          });
        }
        saveState(); renderAll();
        toast('Added to today\'s plan', 'success');
        // After re-render, scroll the plan list into view so the new item is visible.
        setTimeout(() => scrollToElement('.plan-list .plan-task:last-child'), 60);
        break;
      }
      case 'suggest-open': {
        switchTab('syllabus');
        openSubjects.add(subId); openChapters.add(chId);
        renderSyllabus();
        setTimeout(() => {
          const el = document.querySelector(`[data-ch-card="${chId}"]`);
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        break;
      }
      case 'suggest-topic-done': {
        const t = findTopic(subId, chId, tId); if (!t) break;
        if (!t.done) {
          t.done = true; bumpActivity();
          onTopicDoneChanged(subId, chId, tId, true);
          saveState(); renderAll();
          toast('Topic done — revisions scheduled', 'success');
        } else {
          toast('Already complete', 'info');
        }
        break;
      }
      case 'suggest-rev-done': {
        const revId = actEl.dataset.rev;
        const off = parseInt(actEl.dataset.off, 10);
        completeRevisionStep(revId, off);
        bumpActivity();
        saveState(); renderAll();
        toast('Revision marked complete 🎉', 'success');
        break;
      }
      case 'add-quote': {
        const inp = document.getElementById('set-new-quote');
        const v = (inp && inp.value || '').trim();
        if (!v) { toast('Enter a quote', 'warn'); return; }
        state.motivationQuotes.push(v);
        saveState();
        refreshSettingsIfOpen();
        toast('Quote added', 'success');
        break;
      }
      case 'del-quote': {
        const i = +actEl.dataset.i;
        state.motivationQuotes.splice(i, 1);
        saveState();
        refreshSettingsIfOpen();
        break;
      }
      case 'toggle-plan-task': {
        const plan = ensureTodayPlan();
        const type = actEl.dataset.type;
        const beforeTasks = getActivePlanTasks();
        const beforeAllDone = beforeTasks.length > 0 && beforeTasks.every(x => x.done);
        let nowDone = false;
        if (type === 'auto') {
          const t = findTopic(subId, chId, tId); if (!t) break;
          t.done = !t.done; nowDone = t.done; if (t.done) bumpActivity();
          onTopicDoneChanged(subId, chId, tId, t.done);
          _justPoppedKey = `auto:${subId}:${chId}:${tId}`;
          saveState();
        } else {
          const id = actEl.dataset.id;
          const item = plan.custom.find(x => x.id === id); if (!item) break;
          item.done = !item.done; nowDone = item.done; if (item.done) bumpActivity();
          _justPoppedKey = `custom:${id}`;
          saveState();
        }
        // Detect transition into "all done" for confetti burst.
        const afterTasks = getActivePlanTasks();
        const afterAllDone = afterTasks.length > 0 && afterTasks.every(x => x.done);
        if (afterAllDone && !beforeAllDone) {
          _justCompletedDay = todayKey();
        }
        renderAll();
        if (type === 'auto' && nowDone) toast('Topic done — revisions scheduled', 'success');
        break;
      }
      case 'remove-plan-task': {
        const plan = ensureTodayPlan();
        const type = actEl.dataset.type;
        if (type === 'auto') {
          const key = autoKey(subId, chId, tId);
          if (!plan.removed.includes(key)) {
            plan.removed.push(key);
            // Count this as a skip on the underlying topic
            bumpSkipCount(subId, chId, tId);
          }
        } else {
          const id = actEl.dataset.id;
          plan.custom = plan.custom.filter(x => x.id !== id);
        }
        saveState(); renderAll(); toast('Task removed', 'info');
        break;
      }
      case 'weak-mark-done': {
        const t = findTopic(subId, chId, tId); if (!t) break;
        if (!t.done) {
          t.done = true;
          bumpActivity();
          onTopicDoneChanged(subId, chId, tId, true);
        }
        saveState(); renderAll(); toast('Marked complete', 'success');
        break;
      }
      case 'weak-reset': {
        confirmModal('Reset weak flag for this topic? Skip count will go back to 0.', () => {
          resetWeakTopic(subId, chId, tId);
          saveState(); renderAll(); toast('Weak flag reset', 'info');
        });
        break;
      }
      case 'add-plan-task': {
        const inp = document.getElementById('plan-new-task');
        const v = (inp && inp.value || '').trim();
        if (!v) { toast('Enter a task', 'warn'); return; }
        const plan = ensureTodayPlan();
        plan.custom.push({ id: uid(), text: v, done: false });
        saveState(); renderAll(); toast('Task added', 'success');
        const focusInp = document.getElementById('plan-new-task');
        if (focusInp) focusInp.focus();
        break;
      }
      case 'toggle-smart-reminder': {
        const cb = document.getElementById('set-sr-toggle');
        const next = cb ? cb.checked : !state.smartReminder.enabled;
        state.smartReminder.enabled = next;
        saveState();
        if (next) {
          const perm = notifPermission();
          if (perm === 'default') {
            requestNotifPermission().then((res) => {
              refreshSettingsIfOpen();
              if (res === 'granted') toast('Reminder enabled with notifications', 'success');
              else if (res === 'denied') toast('Notifications blocked — in-app alert will be used', 'warn');
              else toast('Reminder enabled', 'success');
            });
          } else if (perm === 'denied') {
            toast('Notifications blocked — in-app alert will be used', 'warn');
            refreshSettingsIfOpen();
          } else if (perm === 'unsupported') {
            toast('Notifications not supported — in-app alert will be used', 'warn');
            refreshSettingsIfOpen();
          } else {
            toast('Reminder enabled', 'success');
            refreshSettingsIfOpen();
          }
        } else {
          toast('Reminder turned off', 'info');
          refreshSettingsIfOpen();
        }
        break;
      }
      case 'sr-request-perm': {
        requestNotifPermission().then((res) => {
          refreshSettingsIfOpen();
          if (res === 'granted') toast('Notifications allowed', 'success');
          else if (res === 'denied') toast('Notifications blocked — in-app alert will be used', 'warn');
          else toast('Permission not changed', 'info');
        });
        break;
      }
      case 'open-plan': {
        closeModal();
        switchTab('dashboard');
        setTimeout(() => {
          const sec = document.querySelector('#view-dashboard .plan-list, #view-dashboard .empty');
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        break;
      }
      case 'regen-plan': {
        const k = todayKey();
        const existing = state.dailyPlans[k] || { custom: [] };
        state.dailyPlans[k] = { auto: [], removed: [], custom: existing.custom || [], generated: false };
        ensureTodayPlan();
        renderAll(); toast('Plan regenerated', 'success');
        break;
      }
      case 'complete-revision-step': {
        const revId = actEl.dataset.rev;
        const off = +actEl.dataset.off;
        completeRevisionStep(revId, off);
        renderAll();
        toast('Revision complete 🎯', 'success');
        break;
      }
      case 'dismiss-revision': {
        const revId = actEl.dataset.rev;
        confirmModal('Remove this revision and all its remaining steps?', () => {
          dismissRevisionEntry(revId);
          renderAll();
          toast('Revision removed', 'info');
        });
        break;
      }
      case 'open-chapter': {
        switchTab('syllabus');
        openSubjects.add(subId); openChapters.add(chId);
        renderSyllabus();
        setTimeout(() => {
          const el = document.querySelector(`[data-ch-card="${chId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        break;
      }

      // ===== Chapter Checklist (Basic / MCQ / CQ / SQ + custom) =====
      case 'toggle-checklist': {
        const c = findChapter(subId, chId); if (!c) break;
        const list = ensureChapterChecklist(c);
        const it = list.find(x => x.id === actEl.dataset.id); if (!it) break;
        it.checked = !it.checked;
        saveState(); renderSyllabus();
        break;
      }
      case 'del-checklist': {
        const c = findChapter(subId, chId); if (!c) break;
        const list = ensureChapterChecklist(c);
        const idx = list.findIndex(x => x.id === actEl.dataset.id);
        if (idx === -1) break;
        list.splice(idx, 1);
        saveState(); renderSyllabus();
        toast('Checklist item removed', 'info');
        break;
      }
      case 'add-checklist': {
        const c = findChapter(subId, chId); if (!c) break;
        const inp = document.getElementById(`checklist-input-${chId}`);
        const v = (inp && inp.value || '').trim();
        if (!v) { toast('Enter an item label', 'warn'); return; }
        const list = ensureChapterChecklist(c);
        list.push({ id: uid(), label: v, checked: false });
        saveState(); renderSyllabus();
        const focusInp = document.getElementById(`checklist-input-${chId}`);
        if (focusInp) focusInp.focus();
        break;
      }

      // ===== Calendar tasks per date =====
      case 'cal-add-task': {
        const iso = actEl.dataset.date;
        const inp = document.getElementById(`cal-task-input-${iso}`);
        const v = (inp && inp.value || '').trim();
        if (!iso || !v) { toast('Enter a task', 'warn'); return; }
        addCalendarTask(iso, v);
        renderCalendar();
        modalCalendarDay(iso);
        break;
      }
      case 'cal-toggle-task': {
        const iso = actEl.dataset.date;
        const id = actEl.dataset.id;
        toggleCalendarTask(iso, id);
        renderCalendar();
        modalCalendarDay(iso);
        break;
      }
      case 'cal-del-task': {
        const iso = actEl.dataset.date;
        const id = actEl.dataset.id;
        deleteCalendarTask(iso, id);
        renderCalendar();
        modalCalendarDay(iso);
        break;
      }
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.id === 'import-file-input') {
      const file = t.files && t.files[0];
      importData(file);
      t.value = '';
      return;
    }

    // Cascading Subject → Chapter → Topic for the Today's Plan adder.
    if (t && t.dataset && t.dataset.planPick) {
      const subSel = document.getElementById('plan-pick-sub');
      const chSel  = document.getElementById('plan-pick-ch');
      const tSel   = document.getElementById('plan-pick-t');
      if (!subSel || !chSel || !tSel) return;

      if (t.dataset.planPick === 'sub') {
        const sub = findSubject(subSel.value);
        chSel.innerHTML = `<option value="">Chapter…</option>` + (sub
          ? sub.chapters.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')
          : '');
        chSel.disabled = !sub || !sub.chapters.length;
        tSel.innerHTML = `<option value="">Topic (optional)…</option>`;
        tSel.disabled = true;
      } else if (t.dataset.planPick === 'ch') {
        const sub = findSubject(subSel.value);
        const ch  = sub && sub.chapters.find(c => c.id === chSel.value);
        tSel.innerHTML = `<option value="">Topic (optional)…</option>` + (ch
          ? (ch.topics || []).map(tp => `<option value="${tp.id}">${escapeHTML(tp.name)}</option>`).join('')
          : '');
        tSel.disabled = !ch || !(ch.topics || []).length;
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t || !t.tagName) return;
    if (t.id === 'plan-new-task') {
      e.preventDefault();
      const v = (t.value || '').trim();
      if (!v) { toast('Enter a task', 'warn'); return; }
      const plan = ensureTodayPlan();
      plan.custom.push({ id: uid(), text: v, done: false });
      saveState(); renderAll(); toast('Task added', 'success');
      const focusInp = document.getElementById('plan-new-task');
      if (focusInp) focusInp.focus();
    } else if (t.id === 'set-new-quote') {
      e.preventDefault();
      const v = (t.value || '').trim();
      if (!v) { toast('Enter a quote', 'warn'); return; }
      state.motivationQuotes.push(v);
      saveState();
      refreshSettingsIfOpen();
      toast('Quote added', 'success');
    } else if (t.dataset && t.dataset.checklistInput !== undefined) {
      e.preventDefault();
      const subId = t.dataset.sub;
      const chId = t.dataset.ch;
      const c = findChapter(subId, chId); if (!c) return;
      const v = (t.value || '').trim();
      if (!v) { toast('Enter an item label', 'warn'); return; }
      ensureChapterChecklist(c).push({ id: uid(), label: v, checked: false });
      saveState(); renderSyllabus();
      const focusInp = document.getElementById(`checklist-input-${chId}`);
      if (focusInp) focusInp.focus();
    } else if (t.dataset && t.dataset.calTaskInput !== undefined) {
      e.preventDefault();
      const iso = t.dataset.date;
      const v = (t.value || '').trim();
      if (!iso || !v) { toast('Enter a task', 'warn'); return; }
      addCalendarTask(iso, v);
      renderCalendar();
      modalCalendarDay(iso);
    }
  });

  // ========== Mobile keyboard handling ==========
  // When the on-screen keyboard opens it covers the bottom of the viewport.
  // We:
  //   1. Track visualViewport height and expose the keyboard height as a
  //      CSS custom property `--kb-h`, used to push the modal up.
  //   2. On focusin of any text input/textarea, smoothly scroll the field
  //      into view so it stays visible above the keyboard.
  function setupKeyboardHandling() {
    const root = document.documentElement;
    root.style.setProperty('--kb-h', '0px');

    function updateKbHeight() {
      const vv = window.visualViewport;
      if (!vv) return;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb-h', kb + 'px');
      if (kb > 0) document.body.classList.add('kb-open');
      else document.body.classList.remove('kb-open');
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateKbHeight);
      window.visualViewport.addEventListener('scroll', updateKbHeight);
      updateKbHeight();
    }

    function isFieldEl(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag !== 'input') return false;
      const type = (el.type || 'text').toLowerCase();
      const skip = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'hidden'];
      return !skip.includes(type);
    }

    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!isFieldEl(el)) return;
      // Wait for the keyboard animation, then scroll the field into view.
      setTimeout(() => {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {
          el.scrollIntoView();
        }
      }, 250);
    });

    document.addEventListener('focusout', () => {
      // Reset kb height shortly after blur so layout settles.
      setTimeout(updateKbHeight, 150);
    });
  }

  // ========== Init ==========
  function init() {
    saveState();
    // Default tab is Home — tag body so tab-aware CSS (e.g., settings gear) works on first paint.
    document.body.classList.add('tab-home');
    renderAll();
    setupKeyboardHandling();
    startSmartReminderLoop();
    startDueTaskLoop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
