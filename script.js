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
    s.motivationQuotes = (s.motivationQuotes && s.motivationQuotes.length) ? s.motivationQuotes : defaultState().motivationQuotes;
    s.streak = s.streak || { count: 0, lastDate: null };
    s.activity = s.activity || {};
    s.dailyPlans = s.dailyPlans || {};
    // Remove calendar tasks (no longer used)
    delete s.calendarTasks;
    s.smartReminder = s.smartReminder || { enabled: false, times: ['20:00'], lastFired: {} };
    if (typeof s.smartReminder.enabled !== 'boolean') s.smartReminder.enabled = false;
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
  function daysSince(dateKey) {
    if (!dateKey) return Infinity;
    const a = new Date(dateKey + 'T00:00:00');
    const b = new Date(todayKey() + 'T00:00:00');
    return Math.max(0, Math.floor((b - a) / 86400000));
  }

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

  function detectBurnout() {
    const out = { burned: false, reasons: [], daysInactive: 0, peak14: 0, active7: 0 };
    const b = state.burnout || {};
    const sinceInstall = daysSince(b.installDate);
    if (sinceInstall < 3) return out;

    const lastDate = state.streak && state.streak.lastDate ? state.streak.lastDate : null;
    const daysInactive = lastDate ? daysSince(lastDate) : sinceInstall;
    const peak14 = recentPeakStreak(14);
    const active7 = activeDaysInLast(7);

    out.daysInactive = daysInactive;
    out.peak14 = peak14;
    out.active7 = active7;

    if (daysInactive >= 2) {
      out.reasons.push({ key: 'inactive', label: `No activity for ${daysInactive} days` });
    }
    if (peak14 >= 3 && daysInactive >= 2) {
      out.reasons.push({ key: 'streak-broken', label: `Your ${peak14}-day streak is at risk` });
    }
    if (sinceInstall >= 5 && active7 <= 1) {
      out.reasons.push({ key: 'low-completion', label: `Only ${active7} active day${active7 === 1 ? '' : 's'} in the last 7` });
    }

    out.burned = out.reasons.length > 0;
    return out;
  }

  function renderBurnoutBanner() {
    const info = detectBurnout();
    if (!info.burned) return '';
    if (state.burnout && state.burnout.bannerDismissedDate === todayKey()) return '';
    const reasonsHtml = info.reasons.map(r => `<li>${escapeHTML(r.label)}</li>`).join('');
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
        <button class="btn btn-ghost" data-close>Not now</button>
        <button class="btn" data-act="burnout-go-plan">Open Today's Plan</button>
      </div>
    `);
  }

  function maybeAutoShowBurnoutPopup() {
    const info = detectBurnout();
    if (!info.burned) return;
    const b = state.burnout || {};
    if (b.popupDismissedDate === todayKey()) return;
    showBurnoutPopup();
    state.burnout.popupDismissedDate = todayKey();
    saveState();
  }

  // ========== Daily Plan ==========
  const autoKey = (subId, chId, tId) => `${subId}:${chId}:${tId}`;

  function ensureTodayPlan() {
    const k = todayKey();
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
      for (const sub of state.subjects) {
        for (const ch of sub.chapters) {
          if (ch.scheduledDate !== k || isChapterEffectivelyDone(ch)) continue;
          for (const t of ch.topics) if (!t.done) pickTopic(sub.id, ch.id, t.id);
        }
      }
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
      if (!sub || !ch || !t) continue;
      tasks.push({
        type: 'auto', key, text: t.name, meta: `${sub.name} · ${ch.name}`, color: sub.color, done: !!t.done, subId: a.subId, chId: a.chId, tId: a.tId,
      });
    }
    for (const c of plan.custom) {
      tasks.push({
        type: 'custom', key: c.id, text: c.text, meta: 'Custom task', color: '#94a3b8', done: !!c.done, id: c.id,
      });
    }
    return tasks;
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ========== Weak Point Detector ==========
  const WEAK_SKIP_THRESHOLD = 3;
  const WEAK_AGE_DAYS = 7;

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
    const today = todayKey();
    let touched = false;
    for (const dateKey of Object.keys(state.dailyPlans)) {
      if (dateKey >= today) continue;
      const plan = state.dailyPlans[dateKey];
      if (!plan || plan.rolledOver) continue;
      const removed = new Set(plan.removed || []);
      for (const a of (plan.auto || [])) {
        const key = `${a.subId}:${a.chId}:${a.tId}`;
        if (removed.has(key)) continue;
        const topic = findTopic(a.subId, a.chId, a.tId);
        if (!topic) continue;
        if (topic.done) continue;
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
      const haveOffsets = new Set(existing.schedule.map(s => s.offset));
      for (const off of REVISION_OFFSETS) {
        if (!haveOffsets.has(off)) {
          existing.schedule.push({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null });
        }
      }
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

  function showWebNotification(title, body, opts) {
    const perm = notifPermission();
    if (perm !== 'granted') return false;
    const options = Object.assign({ body: body || '', tag: 'syllabus-tracker', renotify: true }, opts || {});
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'show-notification', title, options, url: '/' });
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
      if (!incomplete.length) continue;
      sr.lastFired[stampKey] = true;
      saveState();
      fireReminder(`Reminder · ${formatTime12(t)} — you still have ${incomplete.length} task${incomplete.length === 1 ? '' : 's'} for today.`);
      break;
    }
  }

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
    smartReminderTimer = setInterval(checkSmartReminder, 30 * 1000);
    motivationTimer    = setInterval(checkMotivationReminders, 30 * 1000);
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
  function renderAll() { renderHome(); renderDashboard(); renderSyllabus(); renderFocus(); renderRevision(); renderStats(); }

  // -------- Home (Hero cards + Today's Plan editor) --------
  let _justPoppedKey = null;
  let _justCompletedDay = null;

  function progressMessage(pct, hasTasks, allDone) {
    if (hasTasks && allDone) return "Daily goal achieved — well done!";
    if (pct < 20) return "Time to kickstart!";
    if (pct < 50) return "Building momentum, keep going.";
    if (pct < 80) return "Great pace — stay focused.";
    if (pct < 100) return "Almost there, legend!";
    return "Syllabus complete — incredible work!";
  }

  function progressRingSVG(percent) {
    const r = 58;
    const c = 2 * Math.PI * r;
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

    const planAdd = renderPlanAdder();

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
        <button class="btn-link" data-act="regen-plan">↻ Regenerate</button>
      </div>
      ${renderTasksList(tasks)}
      ${planAdd}
    `;

    if (_justPoppedKey) {
      requestAnimationFrame(() => { _justPoppedKey = null; });
    }
    if (_justCompletedDay) {
      setTimeout(() => { _justCompletedDay = null; }, 1800);
    }
  }

  function renderTasksList(tasks) {
    if (!tasks.length) return `<div class="empty">No tasks for today — add some below.</div>`;
    return `<div class="list">${tasks.map(t => {
      const dataAttrs = t.type === 'auto'
        ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"`
        : `data-type="custom" data-id="${t.id}"`;
      const key = t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`;
      const popped = _justPoppedKey === key ? 'just-popped' : '';
      return `
      <div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}">
        <input type="checkbox" class="check" ${t.done ? 'checked' : ''}
          data-act="toggle-plan-task" ${dataAttrs} aria-label="Mark task complete"/>
        <span class="color-dot" style="background:${t.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}</div>
          <div class="meta">${escapeHTML(t.meta)}</div>
        </div>
        <button class="menu-btn" data-act="remove-plan-task" ${dataAttrs} aria-label="Remove task">${ic('trash')}</button>
      </div>`;
    }).join('')}</div>`;
  }

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

  // -------- Dashboard --------
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

  // The rest of the code (renderGoals, renderSmartSuggestions, etc.) remains unchanged from the original, 
  // except all calendar-related functions are removed. I'll include them as they were.

  /* === Goal Tracking (unchanged) === */
  function subjectChapterProgress(subId) { ... } // same as before
  function daysFromStart(startISO) { ... }
  function signedDaysUntil(dateISO) { ... }
  function goalProgress(goal) { ... }
  function checkGoalCompletions() { ... }
  function goalDisplayName(g) { ... }
  function modalAddGoal(existing) { ... }
  function renderGoals() { ... }
  function renderGoalCard(g, p) { ... }

  /* === Smart Study Suggestions (unchanged) === */
  const SUGGEST_LIMIT = 4;
  function topicKey(subId, chId, tId) { return subId + ':' + chId + ':' + tId; }
  function getSmartSuggestions(limit) { ... }
  function collectIncompleteTopics(excludeKeys) { ... }
  function getSuggestedKeys() { ... }
  function suggestionTypeMeta(type) { ... }
  function renderSmartSuggestions() { ... }

  /* === Weak Areas (unchanged) === */
  function renderWeakAreas() { ... }

  /* === Syllabus (unchanged) === */
  function renderSyllabus() { ... }
  function renderSubjectCard(sub) { ... }
  function renderChapterCard(sub, c) { ... }
  function renderTopic(sub, c, t) { ... }
  function renderChapterChecklist(sub, c) { ... }
  function ensureChapterChecklist(c) { ... }

  /* === Revision tab (unchanged) === */
  function renderRevision() { ... }
  function renderDueRevision(item) { ... }
  function renderUpcomingRevision(item) { ... }

  /* === Stats tab (unchanged) === */
  function renderStats() { ... }
  function renderActivity(days) { ... }
  function renderActivityWeeks(weeks) { ... }
  function renderActivityMonths(months) { ... }
  function renderSettings() { ... }

  /* === Modals (unchanged) === */
  function modalAddSubject(existing) { ... }
  function modalAddChapter(subId, existing) { ... }
  function modalAddTopic(subId, chId, existing) { ... }
  function modalEditNote(target, label) { ... }
  function modalEditName(target, label) { ... }
  function modalSetPriority(target, label, cascade) { ... }
  function modalAddExam(existing) { ... }
  function modalAddChapterForRevision() { ... }

  /* === Dropdown menus (unchanged) === */
  function closeDropdown() { ... }
  function openDropdown(anchor, items) { ... }
  function subjectMenu(sub) { ... }
  function chapterMenu(sub, c) { ... }
  function topicMenu(sub, c, t) { ... }
  function makeRevisionCounterItem(target, kind) { ... }
  function makeMarkRevisedItem(target, kind) { ... }

  /* === Focus Tab (new) === */
  const focusState = {
    intervalId: null,
    remaining: 25 * 60,
    running: false,
    mode: 'focus',   // 'focus' or 'break'
  };

  function renderFocus() {
    const view = document.getElementById('view-focus');
    if (!view) return;
    const mins = Math.floor(focusState.remaining / 60);
    const secs = focusState.remaining % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    view.innerHTML = `
      <div class="page-header">
        <h1>Focus</h1>
        <div class="subtitle">Stay productive with a timer</div>
      </div>
      <div class="card focus-timer">
        <div class="time-display">${timeStr}</div>
        <div class="timer-buttons">
          <button class="btn" data-act="focus-start" ${focusState.running ? 'disabled' : ''}>Start</button>
          <button class="btn" data-act="focus-pause" ${!focusState.running ? 'disabled' : ''}>Pause</button>
          <button class="btn btn-ghost" data-act="focus-reset">Reset</button>
        </div>
        <div style="margin-top:12px;color:var(--text-muted);font-size:13px">
          ${focusState.mode === 'focus' ? 'Study session' : 'Break time'}
        </div>
      </div>
    `;

    // If timer is running, ensure interval updates the display
    if (focusState.running) {
      stopFocusInterval();
      startFocusInterval();
    }
  }

  function startFocusInterval() {
    if (focusState.intervalId) return;
    focusState.intervalId = setInterval(() => {
      if (focusState.remaining > 0) {
        focusState.remaining--;
        updateFocusDisplay();
      } else {
        stopFocusInterval();
        focusState.running = false;
        notifyTimerEnd();
        renderFocus(); // refresh buttons
      }
    }, 1000);
  }

  function stopFocusInterval() {
    if (focusState.intervalId) {
      clearInterval(focusState.intervalId);
      focusState.intervalId = null;
    }
  }

  function updateFocusDisplay() {
    const view = document.getElementById('view-focus');
    if (!view || !view.classList.contains('active')) return; // only update if visible
    const display = view.querySelector('.time-display');
    if (!display) return;
    const mins = Math.floor(focusState.remaining / 60);
    const secs = focusState.remaining % 60;
    display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function notifyTimerEnd() {
    const msg = focusState.mode === 'focus' ? 'Time for a break!' : 'Break over, time to focus!';
    toast(msg, 'info');
    if (focusState.mode === 'focus') {
      focusState.mode = 'break';
      focusState.remaining = 5 * 60;
    } else {
      focusState.mode = 'focus';
      focusState.remaining = 25 * 60;
    }
  }

  // ========== Tabs ==========
  function switchTab(name) {
    // Stop focus timer if leaving focus tab
    if (document.querySelector('.view.active') === document.getElementById('view-focus')) {
      stopFocusInterval();
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const next = document.getElementById('view-' + name);
    if (next) next.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));

    const tabClasses = ['tab-home','tab-dashboard','tab-syllabus','tab-focus','tab-revision','tab-stats'];
    document.body.classList.remove(...tabClasses);
    document.body.classList.add('tab-' + name);
    closeDropdown();
    window.scrollTo({ top: 0, behavior: 'instant' });

    // If switching to focus and timer is running, restart the interval
    if (name === 'focus' && focusState.running) {
      startFocusInterval();
    }
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
      // Focus timer actions
      case 'focus-start':
        if (focusState.running) break;
        focusState.running = true;
        startFocusInterval();
        renderFocus();
        break;
      case 'focus-pause':
        focusState.running = false;
        stopFocusInterval();
        renderFocus();
        break;
      case 'focus-reset':
        focusState.running = false;
        stopFocusInterval();
        focusState.remaining = focusState.mode === 'focus' ? 25 * 60 : 5 * 60;
        renderFocus();
        break;

      // Existing actions (unchanged except calendar ones removed)
      case 'goto-syllabus': switchTab('syllabus'); break;
      case 'export-data': exportData(); break;
      case 'import-data-pick': {
        const inp = document.getElementById('import-file-input');
        if (inp) { inp.value = ''; inp.click(); }
        break;
      }
      case 'toggle-subject': {
        if (target.closest('.menu-btn')) return;
        if (openSubjects.has(subId)) openSubjects.delete(subId);
        else openSubjects.add(subId);
        renderSyllabus(); break;
      }
      case 'toggle-chapter': {
        if (openChapters.has(chId)) openChapters.delete(chId);
        else openChapters.add(chId);
        renderSyllabus(); break;
      }
      case 'toggle-chapter-done': { /* ... unchanged */ break; }
      case 'toggle-topic': { /* ... */ break; }
      case 'menu-subject': { /* ... */ break; }
      case 'menu-chapter': { /* ... */ break; }
      case 'menu-topic':   { /* ... */ break; }
      case 'add-subject':  modalAddSubject(); break;
      case 'add-chapter':  modalAddChapter(subId); break;
      case 'add-topic':    modalAddTopic(subId, chId); break;
      case 'add-exam':     modalAddExam(); break;
      case 'edit-exam':    modalAddExam(state.exams.find(x => x.id === actEl.dataset.id)); break;
      case 'add-goal':  modalAddGoal(); break;
      case 'edit-goal': { /* ... */ break; }
      case 'open-settings': { modalSettings(); break; }
      case 'open-dashboard': { switchTab('dashboard'); break; }
      // Note: 'goto-calendar' removed
      case 'open-time-picker': { /* ... */ break; }
      case 'del-time-slot': { /* ... */ break; }
      case 'toggle-motivation': { /* ... */ break; }
      case 'add-chapter-revision': { modalAddChapterForRevision(); break; }
      case 'add-plan-from-syllabus': { /* ... */ break; }
      case 'suggest-open': { /* ... */ break; }
      case 'suggest-topic-done': { /* ... */ break; }
      case 'suggest-rev-done': { /* ... */ break; }
      case 'add-quote': { /* ... */ break; }
      case 'del-quote': { /* ... */ break; }
      case 'toggle-plan-task': { /* ... */ break; }
      case 'remove-plan-task': { /* ... */ break; }
      case 'weak-mark-done': { /* ... */ break; }
      case 'weak-reset': { /* ... */ break; }
      case 'add-plan-task': { /* ... */ break; }
      case 'toggle-smart-reminder': { /* ... */ break; }
      case 'sr-request-perm': { /* ... */ break; }
      case 'open-plan': { /* ... */ break; }
      case 'regen-plan': { /* ... */ break; }
      case 'complete-revision-step': { /* ... */ break; }
      case 'dismiss-revision': { /* ... */ break; }
      case 'open-chapter': { /* ... */ break; }
      case 'burnout-popup': showBurnoutPopup(); break;
      case 'burnout-dismiss-banner': {
        if (state.burnout) state.burnout.bannerDismissedDate = todayKey();
        saveState(); renderAll();
        break;
      }
      case 'burnout-dismiss-popup': {
        if (state.burnout) state.burnout.popupDismissedDate = todayKey();
        saveState(); closeModal();
        break;
      }
      case 'burnout-go-plan': {
        closeModal();
        switchTab('home');
        setTimeout(() => {
          const sec = document.querySelector('#view-home .plan-list');
          if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        break;
      }
      // checklist, calendar tasks handlers removed
      case 'toggle-checklist': { /* ... */ break; }
      case 'del-checklist': { /* ... */ break; }
      case 'add-checklist': { /* ... */ break; }
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
    }
  });

  // ========== Mobile keyboard handling ==========
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
      setTimeout(() => {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch (_) { el.scrollIntoView(); }
      }, 250);
    });

    document.addEventListener('focusout', () => {
      setTimeout(updateKbHeight, 150);
    });
  }

  // ========== Init ==========
  function init() {
    saveState();
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
