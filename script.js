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

  function nextDateISO(d) {
    const x = new Date(); x.setDate(x.getDate() + d);
    return x.toISOString().slice(0, 10);
  }

  function addDaysISO(baseISO, days) {
    const d = new Date(baseISO + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(aISO, bISO) {
    return Math.round((new Date(bISO + 'T00:00:00') - new Date(aISO + 'T00:00:00')) / 86400000);
  }

  function daysSince(dateKey) {
    if (!dateKey) return Infinity;
    return Math.max(0, Math.floor((new Date(todayKey() + 'T00:00:00') - new Date(dateKey + 'T00:00:00')) / 86400000));
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
      burnout: { installDate: todayKey(), popupDismissedDate: null, bannerDismissedDate: null },
      goals: []
    };
  }

  function migrate(s) {
    s.subjects = (s.subjects || []).map(sub => ({
      id: sub.id || uid(), name: sub.name || 'Subject', color: sub.color || '#38bdf8',
      notes: sub.notes || '', priority: sub.priority || null,
      revisionCount: sub.revisionCount || 0, lastRevisedAt: sub.lastRevisedAt || null,
      checklist: Array.isArray(sub.checklist) && sub.checklist.length
        ? sub.checklist.map(it => ({ id: it.id || uid(), label: String(it.label || 'Item'), checked: !!it.checked }))
        : makeDefaultChecklist(),
      chapters: (sub.chapters || []).map(c => ({
        id: c.id || uid(), name: c.name || 'Chapter', notes: c.notes || '',
        priority: c.priority || null, revisionCount: c.revisionCount || 0,
        lastRevisedAt: c.lastRevisedAt || null, done: !!c.done, scheduledDate: c.scheduledDate || null,
        checklist: Array.isArray(c.checklist) && c.checklist.length
          ? c.checklist.map(it => ({ id: it.id || uid(), label: String(it.label || 'Item'), checked: !!it.checked }))
          : makeDefaultChecklist(),
        topics: (c.topics || []).map(t => ({
          id: t.id || uid(), name: t.name || 'Topic', notes: t.notes || '',
          done: !!t.done, priority: t.priority || null,
          revisionCount: t.revisionCount || 0, lastRevisedAt: t.lastRevisedAt || null,
          skipCount: typeof t.skipCount === 'number' ? t.skipCount : 0,
          firstSeenAt: t.firstSeenAt || todayKey(), lastSkippedAt: t.lastSkippedAt || null,
        }))
      }))
    }));
    s.exams = s.exams || [];
    s.motivationQuotes = (s.motivationQuotes && s.motivationQuotes.length) ? s.motivationQuotes : defaultState().motivationQuotes;
    s.streak = s.streak || { count: 0, lastDate: null };
    s.activity = s.activity || {};
    s.dailyPlans = s.dailyPlans || {};
    delete s.calendarTasks;
    s.smartReminder = s.smartReminder || { enabled: false, times: ['20:00'], lastFired: {} };
    if (typeof s.smartReminder.enabled !== 'boolean') s.smartReminder.enabled = false;
    if (!Array.isArray(s.smartReminder.times)) s.smartReminder.times = ['20:00'];
    if (!s.smartReminder.times.length) s.smartReminder.times = ['20:00'];
    if (!s.smartReminder.lastFired || typeof s.smartReminder.lastFired !== 'object') s.smartReminder.lastFired = {};
    delete s.smartReminder.time; delete s.smartReminder.lastFiredDate;
    s.motivationReminders = s.motivationReminders || { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} };
    if (typeof s.motivationReminders.enabled !== 'boolean') s.motivationReminders.enabled = false;
    if (!Array.isArray(s.motivationReminders.times) || !s.motivationReminders.times.length) s.motivationReminders.times = ['09:00', '14:00', '20:00'];
    if (!s.motivationReminders.lastFired || typeof s.motivationReminders.lastFired !== 'object') s.motivationReminders.lastFired = {};
    delete s.gamification;
    s.burnout = s.burnout || {};
    if (!s.burnout.installDate) { const d = Object.keys(s.activity || {}).sort(); s.burnout.installDate = d[0] || todayKey(); }
    if (s.burnout.popupDismissedDate === undefined) s.burnout.popupDismissedDate = null;
    if (s.burnout.bannerDismissedDate === undefined) s.burnout.bannerDismissedDate = null;
    s.goals = Array.isArray(s.goals) ? s.goals.map(g => ({
      id: g.id || uid(), name: g.name || '', subjectId: g.subjectId || null,
      durationDays: Math.max(1, parseInt(g.durationDays, 10) || 1),
      startDate: g.startDate || todayKey(),
      targetDate: g.targetDate || addDaysISO(g.startDate || todayKey(), Math.max(1, parseInt(g.durationDays, 10) || 1)),
      createdAt: g.createdAt || todayKey(), completedAt: g.completedAt || null,
    })) : [];
    s.revisions = (s.revisions || []).map(r => ({
      id: r.id || uid(), subId: r.subId, chId: r.chId, tId: r.tId,
      completedAt: r.completedAt || todayKey(),
      schedule: (r.schedule || []).map(st => ({
        offset: st.offset, dueDate: st.dueDate, done: !!st.done, completedAt: st.completedAt || null,
      })),
    }));
    return s;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) { return defaultState(); }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.error('saveState failed:', e); }
  }

  let state = loadState();

  // ========== Helpers ==========
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTime12(hhmm) {
    if (!hhmm || !hhmm.includes(':')) return hhmm || '';
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return hhmm;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function daysUntil(iso) {
    if (!iso) return null;
    return Math.ceil((new Date(iso + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000);
  }

  function signedDaysUntil(dateISO) {
    return Math.round((new Date(dateISO + 'T00:00:00') - new Date(todayKey() + 'T00:00:00')) / 86400000);
  }

  function daysFromStart(startISO) {
    return Math.max(0, Math.round((new Date(todayKey() + 'T00:00:00') - new Date(startISO + 'T00:00:00')) / 86400000));
  }

  function findSubject(id) { return state.subjects.find(s => s.id === id); }
  function findChapter(subId, chId) { const s = findSubject(subId); return s && s.chapters.find(c => c.id === chId); }
  function findTopic(subId, chId, tId) { const c = findChapter(subId, chId); return c && c.topics.find(t => t.id === tId); }

  function chapterProgress(c) {
    if (!c.topics || !c.topics.length) return c.done ? 100 : 0;
    return Math.round((c.topics.filter(t => t.done).length / c.topics.length) * 100);
  }

  function isChapterEffectivelyDone(c) {
    if (!c.topics || !c.topics.length) return c.done;
    return c.topics.every(t => t.done);
  }

  function overallProgress() {
    let total = 0, done = 0;
    for (const sub of state.subjects) {
      for (const ch of sub.chapters) {
        if (!ch.topics || !ch.topics.length) { total++; if (ch.done) done++; }
        else { for (const t of ch.topics) { total++; if (t.done) done++; } }
      }
    }
    return total ? Math.round((done / total) * 100) : 0;
  }

  function nextExam() {
    const today = todayKey();
    return state.exams
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }

  // ========== Activity & Streak ==========
  function bumpActivity() {
    const k = todayKey();
    state.activity[k] = (state.activity[k] || 0) + 1;
    if (state.streak.lastDate !== k) {
      const yk = addDaysISO(k, -1);
      state.streak.count = state.streak.lastDate === yk ? state.streak.count + 1 : 1;
      state.streak.lastDate = k;
    }
    checkGoalCompletions();
  }

  // ========== Export / Import ==========
  function exportData() {
    try {
      const payload = { app: 'syllabus-tracker', version: 1, exportedAt: new Date().toISOString(), state };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = url; a.download = `syllabus-backup-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Exported backup file', 'success');
    } catch (e) { toast('Export failed', 'danger'); }
  }

  function importData(file) {
    if (!file) { toast('No file selected', 'warn'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('File too large (max 10 MB)', 'danger'); return; }
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read file', 'danger');
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result || '')); } catch (e) { toast('Invalid JSON file', 'danger'); return; }
      const candidate = (parsed && parsed.state && typeof parsed.state === 'object') ? parsed.state : parsed;
      if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.subjects)) {
        toast('Invalid backup file', 'danger'); return;
      }
      const subjCount = candidate.subjects.length;
      confirmModal(
        `Replace current data with ${subjCount} subject(s) from backup?`,
        () => {
          try {
            state = migrate(JSON.parse(JSON.stringify(candidate)));
            saveState(); renderAll(); toast(`Import complete · ${subjCount} subject(s)`, 'success');
          } catch (e) { toast('Import failed', 'danger'); }
        },
        { title: 'Replace all data?', yesLabel: 'Import & Replace', yesClass: 'btn' }
      );
    };
    reader.readAsText(file);
  }

  // ========== Burnout Detector ==========
  function recentPeakStreak(windowDays) {
    const today = new Date(todayKey() + 'T00:00:00');
    let peak = 0, cur = 0;
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      if ((state.activity[k] || 0) > 0) { cur++; if (cur > peak) peak = cur; }
      else cur = 0;
    }
    return peak;
  }

  function activeDaysInLast(n) {
    const today = new Date(todayKey() + 'T00:00:00');
    let count = 0;
    for (let i = 0; i < n; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      if ((state.activity[d.toISOString().slice(0, 10)] || 0) > 0) count++;
    }
    return count;
  }

  function detectBurnout() {
    const out = { burned: false, reasons: [] };
    const b = state.burnout || {};
    if (daysSince(b.installDate) < 3) return out;
    const lastDate = state.streak && state.streak.lastDate;
    const daysInactive = lastDate ? daysSince(lastDate) : daysSince(b.installDate);
    const peak14 = recentPeakStreak(14);
    const active7 = activeDaysInLast(7);
    if (daysInactive >= 2) out.reasons.push({ key: 'inactive', label: `No activity for ${daysInactive} days` });
    if (peak14 >= 3 && daysInactive >= 2) out.reasons.push({ key: 'streak-broken', label: `Your ${peak14}-day streak is at risk` });
    if (daysSince(b.installDate) >= 5 && active7 <= 1) out.reasons.push({ key: 'low-completion', label: `Only ${active7} active day(s) in the last 7` });
    out.burned = out.reasons.length > 0;
    return out;
  }

  function renderBurnoutBanner() {
    const info = detectBurnout();
    if (!info.burned || (state.burnout && state.burnout.bannerDismissedDate === todayKey())) return '';
    return `
      <div class="burnout-banner" role="alert">
        <div class="burnout-banner-icon">⚠️</div>
        <div class="burnout-banner-body">
          <div class="burnout-banner-title">You are losing consistency — get back on track!</div>
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
    const quote = state.motivationQuotes.length ? state.motivationQuotes[Math.floor(Math.random() * state.motivationQuotes.length)] : "One small step today.";
    const reasonLine = info.reasons.length ? info.reasons.map(r => escapeHTML(r.label)).join(' · ') : "You are slipping a bit — let's reset.";
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
    if (state.burnout && state.burnout.popupDismissedDate === todayKey()) return;
    showBurnoutPopup();
    state.burnout.popupDismissedDate = todayKey();
    saveState();
  }

  // ========== Daily Plan ==========
  const autoKey = (subId, chId, tId) => `${subId}:${chId}:${tId}`;

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
        if (!topic || topic.done) continue;
        topic.skipCount = (topic.skipCount || 0) + 1;
        topic.lastSkippedAt = dateKey;
        touched = true;
      }
      plan.rolledOver = true;
    }
    if (touched) saveState();
  }

  function ensureTodayPlan() {
    const k = todayKey();
    rolloverYesterdayPlanSkips();
    let plan = state.dailyPlans[k];
    if (!plan) {
      plan = { auto: [], removed: [], custom: [], generated: false };
      state.dailyPlans[k] = plan;
    }
    if (!plan.generated) {
      const picked = new Set(), auto = [];
      const pick = (subId, chId, tId) => {
        const key = autoKey(subId, chId, tId);
        if (!picked.has(key)) { picked.add(key); auto.push({ subId, chId, tId }); }
      };
      for (const sub of state.subjects)
        for (const ch of sub.chapters)
          if (ch.scheduledDate === k && !isChapterEffectivelyDone(ch))
            for (const t of ch.topics) if (!t.done) pick(sub.id, ch.id, t.id);
      if (auto.length < 5)
        for (const sub of state.subjects)
          for (const ch of sub.chapters)
            if (ch.priority === 'high' && !isChapterEffectivelyDone(ch))
              for (const t of ch.topics) if (!t.done && auto.length < 8) pick(sub.id, ch.id, t.id);
      if (auto.length === 0)
        for (const sub of state.subjects)
          for (const ch of sub.chapters)
            for (const t of ch.topics) if (!t.done && auto.length < 5) pick(sub.id, ch.id, t.id);
      plan.auto = auto; plan.generated = true; saveState();
    }
    return plan;
  }

  function getActivePlanTasks() {
    const plan = ensureTodayPlan();
    const tasks = [];
    for (const a of plan.auto) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if (plan.removed.includes(key)) continue;
      const sub = findSubject(a.subId), ch = findChapter(a.subId, a.chId), t = findTopic(a.subId, a.chId, a.tId);
      if (!sub || !ch || !t) continue;
      tasks.push({ type: 'auto', key, text: t.name, meta: `${sub.name} · ${ch.name}`, color: sub.color, done: !!t.done, subId: a.subId, chId: a.chId, tId: a.tId });
    }
    for (const c of plan.custom) {
      tasks.push({ type: 'custom', key: c.id, text: c.text, meta: 'Custom task', color: '#94a3b8', done: !!c.done, id: c.id });
    }
    return tasks;
  }

  // ========== Weak Point Detector ==========
  const WEAK_SKIP_THRESHOLD = 3, WEAK_AGE_DAYS = 7;

  function topicAgeDays(topic) {
    return topic.firstSeenAt ? Math.max(0, daysBetween(topic.firstSeenAt, todayKey())) : 0;
  }
  function isWeakTopic(topic) {
    if (!topic || topic.done) return false;
    return (topic.skipCount || 0) >= WEAK_SKIP_THRESHOLD || topicAgeDays(topic) >= WEAK_AGE_DAYS;
  }
  function weakReason(topic) {
    const r = [];
    if ((topic.skipCount || 0) >= WEAK_SKIP_THRESHOLD) r.push(`Skipped ×${topic.skipCount}`);
    const age = topicAgeDays(topic);
    if (age >= WEAK_AGE_DAYS) r.push(`${age}d old, still pending`);
    return r.join(' · ') || 'Needs attention';
  }
  function getWeakTopics() {
    const out = [];
    for (const sub of state.subjects)
      for (const ch of sub.chapters)
        for (const t of ch.topics)
          if (isWeakTopic(t)) out.push({ sub, ch, topic: t, reason: weakReason(t), age: topicAgeDays(t), skips: t.skipCount || 0 });
    out.sort((a, b) => (b.skips - a.skips) || (b.age - a.age));
    return out;
  }
  function resetWeakTopic(subId, chId, tId) {
    const t = findTopic(subId, chId, tId); if (!t) return;
    t.skipCount = 0; t.firstSeenAt = todayKey(); t.lastSkippedAt = null;
  }

  // ========== Spaced Repetition ==========
  const REVISION_OFFSETS = [1, 3, 7];

  function scheduleRevisionsForTopic(subId, chId, tId) {
    if (!findTopic(subId, chId, tId)) return;
    const today = todayKey();
    const existing = state.revisions.find(r => r.tId === tId);
    if (existing) {
      const haveOffsets = new Set(existing.schedule.map(s => s.offset));
      for (const off of REVISION_OFFSETS)
        if (!haveOffsets.has(off)) existing.schedule.push({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null });
      if (existing.schedule.every(s => s.done)) {
        existing.schedule = REVISION_OFFSETS.map(off => ({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null }));
      }
      existing.subId = subId; existing.chId = chId;
      return;
    }
    state.revisions.push({
      id: uid(), subId, chId, tId, completedAt: today,
      schedule: REVISION_OFFSETS.map(off => ({ offset: off, dueDate: addDaysISO(today, off), done: false, completedAt: null }))
    });
  }

  function cancelRevisionsForTopic(tId) {
    state.revisions = state.revisions.filter(r => r.tId !== tId || r.schedule.some(s => s.done));
  }

  function onTopicDoneChanged(subId, chId, tId, isDone) {
    if (isDone) scheduleRevisionsForTopic(subId, chId, tId);
    else cancelRevisionsForTopic(tId);
  }

  function pruneRevisions() {
    state.revisions = state.revisions.filter(r => findTopic(r.subId, r.chId, r.tId) && !r.schedule.every(s => s.done));
  }

  function dueRevisionItems() {
    pruneRevisions();
    const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
      for (const step of r.schedule) {
        if (step.done) continue;
        if (step.dueDate <= today) items.push({ revisionId: r.id, sub, ch, topic, step, daysOverdue: daysBetween(step.dueDate, today) });
      }
    }
    items.sort((a, b) => (b.daysOverdue - a.daysOverdue));
    return items;
  }

  function upcomingRevisionItems(limit = 10) {
    pruneRevisions();
    const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
      for (const step of r.schedule) {
        if (!step.done && step.dueDate > today) items.push({ revisionId: r.id, sub, ch, topic, step, daysUntil: daysBetween(today, step.dueDate) });
      }
    }
    items.sort((a, b) => a.step.dueDate.localeCompare(b.step.dueDate));
    return items.slice(0, limit);
  }

  function completeRevisionStep(revisionId, offset) {
    const r = state.revisions.find(x => x.id === revisionId); if (!r) return;
    const step = r.schedule.find(s => s.offset === offset); if (!step || step.done) return;
    step.done = true; step.completedAt = todayKey();
    bumpActivity();
    if (r.schedule.every(s => s.done)) state.revisions = state.revisions.filter(x => x.id !== r.id);
    saveState();
  }

  function dismissRevisionEntry(revisionId) {
    state.revisions = state.revisions.filter(x => x.id !== revisionId);
    saveState();
  }

  // ========== Notifications ==========
  const NOTIF_SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;
  let smartReminderTimer = null, motivationTimer = null, dueTaskTimer = null;
  let dueTaskNotifiedDate = null;
  const dueTaskNotified = new Set();

  function notifPermission() {
    try { return NOTIF_SUPPORTED ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; }
  }

  function requestNotifPermission() {
    return new Promise(resolve => {
      if (!NOTIF_SUPPORTED) return resolve('unsupported');
      try {
        const p = Notification.requestPermission(res => resolve(res));
        if (p && typeof p.then === 'function') p.then(resolve).catch(() => resolve('denied'));
      } catch (e) { resolve('denied'); }
    });
  }

  function showWebNotification(title, body, opts) {
    if (notifPermission() !== 'granted') return false;
    const options = Object.assign({ body: body || '', tag: 'syllabus-tracker', renotify: true }, opts || {});
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'show-notification', title, options, url: './' });
        return true;
      }
      new Notification(title, options); return true;
    } catch (e) { return false; }
  }

  function fireReminder(msg) {
    if (notifPermission() === 'granted') {
      if (showWebNotification('Syllabus Tracker', msg, { tag: 'syllabus-smart-reminder' })) return;
    }
    openModal(`
      <h3>⏰ Study Reminder</h3>
      <div style="margin:8px 0 16px;font-size:15px;line-height:1.5">${escapeHTML(msg)}</div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Dismiss</button>
        <button class="btn" data-act="open-plan">Open Today's Plan</button>
      </div>
    `);
    toast(msg, 'warn', 5000);
  }

  function checkSmartReminder() {
    const sr = state.smartReminder;
    if (!sr || !sr.enabled || !sr.times.length) return;
    const now = new Date();
    const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of sr.times) {
      if (t !== cur) continue;
      const stampKey = today + 'T' + t;
      if (sr.lastFired && sr.lastFired[stampKey]) continue;
      const incomplete = getActivePlanTasks().filter(x => !x.done);
      if (!incomplete.length) continue;
      sr.lastFired[stampKey] = true; saveState();
      fireReminder(`Reminder · ${formatTime12(t)} — you still have ${incomplete.length} task(s) for today.`);
      break;
    }
  }

  function checkMotivationReminders() {
    const mr = state.motivationReminders;
    if (!mr || !mr.enabled || !mr.times.length) return;
    const now = new Date();
    const cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const today = todayKey();
    for (const t of mr.times) {
      if (t !== cur) continue;
      const stampKey = today + 'T' + t;
      if (mr.lastFired && mr.lastFired[stampKey]) continue;
      mr.lastFired[stampKey] = true; saveState();
      const quotes = state.motivationQuotes;
      const quote = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : "Keep going!";
      if (notifPermission() === 'granted') showWebNotification('💪 Stay focused', quote, { tag: `mot-${stampKey}` });
      else toast(`💪 ${quote}`, 'info', 5000);
      break;
    }
  }

  function checkDueTasks() {
    const today = todayKey();
    if (dueTaskNotifiedDate !== today) { dueTaskNotified.clear(); dueTaskNotifiedDate = today; }
    for (const item of dueRevisionItems()) {
      const key = `${item.revisionId}:${item.step.offset}`;
      if (dueTaskNotified.has(key)) continue;
      dueTaskNotified.add(key);
      if (notifPermission() === 'granted') showWebNotification('Revision due', `${item.topic.name} (${item.sub.name})`, { tag: `rev-${key}` });
    }
  }

  function startTimers() {
    clearInterval(smartReminderTimer); clearInterval(motivationTimer); clearInterval(dueTaskTimer);
    smartReminderTimer = setInterval(checkSmartReminder, 30000);
    motivationTimer = setInterval(checkMotivationReminders, 30000);
    dueTaskTimer = setInterval(checkDueTasks, 60000);
    setTimeout(() => { checkSmartReminder(); checkMotivationReminders(); checkDueTasks(); }, 1500);
  }

  // ========== Toast ==========
  function toast(msg, kind = 'info', ms = 3800) {
    const wrap = document.getElementById('toast-container'); if (!wrap) return;
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
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    if (onMount) onMount(backdrop.querySelector('.modal'));
  }
  function closeModal() { const r = document.getElementById('modal-root'); if (r) r.innerHTML = ''; }

  function confirmModal(msg, onYes, opts) {
    const o = opts || {};
    openModal(`
      <h3>${escapeHTML(o.title || 'Are you sure?')}</h3>
      <div style="margin:6px 0 14px;color:var(--text-muted);font-size:14px">${escapeHTML(msg)}</div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn ${o.yesClass || 'btn-danger'}" id="m-yes">${escapeHTML(o.yesLabel || 'Delete')}</button>
      </div>
    `, root => { root.querySelector('#m-yes').onclick = () => { closeModal(); onYes(); }; });
  }

  // ========== Icons ==========
  const ICONS = {
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
    chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    revisit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  };
  const ic = n => ICONS[n] || '';

  // ========== Navigation ==========
  const openSubjects = new Set();
  const openChapters = new Set();
  let activeDropdown = null;
  let _justPoppedKey = null, _justCompletedDay = null;

  function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const view = document.getElementById('view-' + tab);
    if (view) view.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    document.body.className = 'tab-' + tab;
    closeDropdown();
  }

  function closeDropdown() {
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
  }

  // ========== Render All ==========
  function renderAll() {
    renderHome();
    renderDashboard();
    renderSyllabus();
    renderRevision();
    renderStats();
  }

  // ========== Home ==========
  function progressRingSVG(percent) {
    const r = 58, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return `<svg class="ring-svg" viewBox="0 0 140 140" aria-hidden="true">
      <defs><linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8"/><stop offset="55%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#f472b6"/>
      </linearGradient></defs>
      <circle class="ring-track" cx="70" cy="70" r="${r}"></circle>
      <circle class="ring-fill" cx="70" cy="70" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"></circle>
    </svg>`;
  }

  function renderConfettiBurst() {
    const colors = ['#38bdf8','#a78bfa','#f472b6','#facc15','#34d399','#fb7185'];
    let p = '';
    for (let i = 0; i < 18; i++) {
      const left = Math.random() * 100, delay = (Math.random() * 0.25).toFixed(2), dur = (1 + Math.random() * 0.9).toFixed(2);
      const w = 6 + Math.floor(Math.random() * 6);
      p += `<i style="left:${left}%;background:${colors[i % colors.length]};width:${w}px;height:${w * 1.6}px;animation-delay:${delay}s;animation-duration:${dur}s"></i>`;
    }
    return `<div class="confetti" aria-hidden="true">${p}</div>`;
  }

  function progressMessage(pct, hasTasks, allDone) {
    if (hasTasks && allDone) return "Daily goal achieved — well done!";
    if (pct < 20) return "Time to kickstart!";
    if (pct < 50) return "Building momentum, keep going.";
    if (pct < 80) return "Great pace — stay focused.";
    if (pct < 100) return "Almost there, legend!";
    return "Syllabus complete — incredible work!";
  }

  function renderHome() {
    const view = document.getElementById('view-home'); if (!view) return;
    const exam = nextExam(), overall = overallProgress();
    const tasks = getActivePlanTasks();
    const doneCount = tasks.filter(t => t.done).length, totalCount = tasks.length;
    const allDone = totalCount > 0 && doneCount === totalCount;
    const examDays = exam ? daysUntil(exam.date) : null;
    const urgent = exam && examDays !== null && examDays <= 7 && examDays >= 0;

    const examHero = exam ? `
      <article class="hero-card ${urgent ? 'urgent' : ''}" data-act="add-exam" role="button">
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
      </article>` : `
      <article class="hero-card empty">
        <div class="hero-eyebrow">${ic('cal')}<span>NEXT EXAM</span></div>
        <h2 class="hero-title">No exam scheduled</h2>
        <div class="hero-sub">Add one to start the countdown.</div>
        <button class="btn" style="margin-top:14px" data-act="add-exam">${ic('plus')} Add Exam</button>
      </article>`;

    const progressHero = `
      <article class="hero-card" data-act="open-dashboard" role="button">
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
      </article>`;

    const achievedBadge = allDone ? `
      <div class="daily-achieved" role="status">
        ${_justCompletedDay === todayKey() ? renderConfettiBurst() : ''}
        <span class="da-glyph">🏆</span>
        <div class="da-body">
          <div class="da-title">Daily Goal Achieved!</div>
          <div class="da-sub">All ${totalCount} task${totalCount === 1 ? '' : 's'} done for today.</div>
        </div>
      </div>` : '';

    view.innerHTML = `
      <div class="page-header">
        <h1>Home</h1>
        <div class="subtitle">${greeting()}, let's study</div>
        <div class="motivation-line ${overall >= 80 ? 'is-hot' : overall < 20 ? 'is-cold' : ''}">${escapeHTML(progressMessage(overall, totalCount > 0, allDone))}</div>
      </div>
      <div class="hero-grid">${examHero}${progressHero}</div>
      <button type="button" class="dashboard-cta" data-act="open-dashboard">
        <span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg></span>
        <span class="body"><span class="title">Open Dashboard</span><span class="meta">Goals · Smart Suggestions · Weak Areas</span></span>
        <span class="arrow">›</span>
      </button>
      ${achievedBadge}
      <div class="section-head"><h2>Today's Plan</h2><button class="btn-link" data-act="regen-plan">↻ Regenerate</button></div>
      ${renderTasksList(tasks)}
      ${renderPlanAdder()}
    `;
    if (_justPoppedKey) requestAnimationFrame(() => { _justPoppedKey = null; });
    if (_justCompletedDay) setTimeout(() => { _justCompletedDay = null; }, 1800);
  }

  function renderTasksList(tasks) {
    if (!tasks.length) return `<div class="empty">No tasks for today — add some below.</div>`;
    return `<div class="list">${tasks.map(t => {
      const dataAttrs = t.type === 'auto'
        ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"`
        : `data-type="custom" data-id="${t.id}"`;
      const popped = _justPoppedKey === (t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`) ? 'just-popped' : '';
      return `
      <div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}">
        <input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-plan-task" ${dataAttrs}/>
        <span class="color-dot" style="background:${t.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}</div>
          <div class="meta">${escapeHTML(t.meta)}</div>
        </div>
        <button class="menu-btn" data-act="remove-plan-task" ${dataAttrs}>${ic('trash')}</button>
      </div>`;
    }).join('')}</div>`;
  }

  function renderPlanAdder() {
    const subjOptions = state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    return `
      <div class="plan-add-card">
        <div class="plan-add-title">Add to Today's Plan</div>
        <div class="plan-add-grid">
          <select class="plan-sel" id="plan-pick-sub"><option value="">Subject…</option>${subjOptions}</select>
          <select class="plan-sel" id="plan-pick-ch" disabled><option value="">Chapter…</option></select>
          <select class="plan-sel" id="plan-pick-t" disabled><option value="">Topic (optional)…</option></select>
        </div>
        <div class="plan-add-actions">
          <button class="btn btn-block" data-act="add-plan-from-syllabus">${ic('plus')} Add from Syllabus</button>
        </div>
        <div class="plan-add-divider"><span>or write a custom task</span></div>
        <div class="row" style="gap:8px;margin-top:4px">
          <input id="plan-new-task" placeholder="Custom task for today…" maxlength="120"
            style="flex:1;background:#0b1327;border:1px solid var(--border);color:var(--text);padding:11px;border-radius:10px;font:inherit"/>
          <button class="btn" data-act="add-plan-task">${ic('plus')}</button>
        </div>
      </div>`;
  }

  // ========== Dashboard ==========
  function renderDashboard() {
    const view = document.getElementById('view-dashboard'); if (!view) return;
    view.innerHTML = `
      <div class="page-header"><h1>Dashboard</h1><div class="subtitle">Your study control center</div></div>
      ${renderBurnoutBanner()}
      ${renderGoals()}
      ${renderSmartSuggestions()}
      ${renderWeakAreas()}
    `;
  }

  // --------- Goals ---------
  function subjectChapterProgress(subId) {
    const sub = findSubject(subId); if (!sub) return { done: 0, total: 0, percent: 0 };
    let total = 0, done = 0;
    for (const ch of sub.chapters) { total++; if (isChapterEffectivelyDone(ch)) done++; }
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  function goalProgress(goal) {
    const prog = goal.subjectId ? subjectChapterProgress(goal.subjectId) : (() => {
      let total = 0, done = 0;
      for (const sub of state.subjects) for (const ch of sub.chapters) { total++; if (isChapterEffectivelyDone(ch)) done++; }
      return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
    })();
    const totalDays = goal.durationDays, elapsed = Math.min(totalDays, daysFromStart(goal.startDate));
    const signedLeft = signedDaysUntil(goal.targetDate), daysLeft = Math.max(0, signedLeft);
    const overdueBy = signedLeft < 0 ? -signedLeft : 0;
    const isComplete = prog.total > 0 && prog.done >= prog.total;
    const isOverdue = !isComplete && signedLeft < 0;
    const expectedPercent = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0;
    return { ...prog, totalDays, elapsed, daysLeft, overdueBy, isComplete, isOverdue, expectedPercent };
  }

  function checkGoalCompletions() {
    let changed = false;
    for (const g of state.goals || []) {
      const p = goalProgress(g);
      if (p.isComplete && !g.completedAt) { g.completedAt = todayKey(); changed = true; setTimeout(() => toast(`Goal reached: ${goalDisplayName(g)} 🎯`, 'success'), 100); }
      else if (!p.isComplete && g.completedAt) { g.completedAt = null; changed = true; }
    }
    if (changed) saveState();
  }

  function goalDisplayName(g) {
    if (g.name && g.name.trim()) return g.name.trim();
    const sub = g.subjectId ? findSubject(g.subjectId) : null;
    return `Finish ${sub ? sub.name : 'All subjects'} in ${g.durationDays} day${g.durationDays === 1 ? '' : 's'}`;
  }

  function renderGoals() {
    checkGoalCompletions();
    const goals = state.goals || [];
    if (!goals.length) return `
      <div class="section-head"><h2>Goals</h2><button class="btn-link" data-act="add-goal">+ Add Goal</button></div>
      <div class="empty-goals"><div style="font-size:32px;margin-bottom:6px">🎯</div><div>No goals yet. Set a target to track progress automatically.</div><button class="btn" style="margin-top:12px" data-act="add-goal">${ic('plus')} Add your first goal</button></div>`;
    const decorated = goals.map(g => ({ g, p: goalProgress(g) }))
      .sort((a, b) => (a.p.isComplete ? 1 : -1) - (b.p.isComplete ? 1 : -1) || (b.p.isOverdue ? 1 : -1) - (a.p.isOverdue ? 1 : -1) || a.p.daysLeft - b.p.daysLeft);
    return `<div class="section-head"><h2>Goals</h2><button class="btn-link" data-act="add-goal">+ Add Goal</button></div>
      <div class="goal-list">${decorated.map(({ g, p }) => {
      const sub = g.subjectId ? findSubject(g.subjectId) : null;
      const subjectLabel = sub ? sub.name : 'All subjects';
      const subjectColor = sub ? sub.color : 'var(--primary)';
      let statusLabel, statusClass;
      if (p.isComplete) { statusLabel = 'Completed'; statusClass = 'goal-status-done'; }
      else if (p.isOverdue) { statusLabel = `Overdue by ${p.overdueBy}d`; statusClass = 'goal-status-overdue'; }
      else if (p.daysLeft === 0) { statusLabel = 'Due today'; statusClass = 'goal-status-today'; }
      else { statusLabel = `${p.daysLeft}d left`; statusClass = 'goal-status-active'; }
      let paceLabel = '';
      if (!p.isComplete && p.total > 0) {
        const diff = p.percent - p.expectedPercent;
        if (diff >= 5) paceLabel = `<span class="goal-pace ahead">▲ ${diff}% ahead</span>`;
        else if (diff <= -5) paceLabel = `<span class="goal-pace behind">▼ ${-diff}% behind</span>`;
        else paceLabel = `<span class="goal-pace ontrack">● on pace</span>`;
      }
      return `<div class="card goal-card ${p.isComplete ? 'is-complete' : ''}" data-goal="${g.id}">
        <span class="goal-color-bar" style="background:${subjectColor}"></span>
        <div class="goal-header"><div class="goal-title">${escapeHTML(goalDisplayName(g))}</div><button class="menu-btn" data-act="edit-goal" data-id="${g.id}">${ic('edit')}</button></div>
        <div class="goal-pills"><span class="goal-pill" style="background:${sub ? sub.color + '22' : 'rgba(56,189,248,0.14)'};color:${subjectColor}">📚 ${escapeHTML(subjectLabel)}</span><span class="goal-pill goal-pill-status ${statusClass}">${escapeHTML(statusLabel)}</span>${paceLabel}</div>
        <div class="goal-progress-row"><div><span class="goal-percent">${p.percent}%</span><span class="goal-fraction" style="margin-left:6px;font-size:12px;color:var(--text-muted)">${p.done}/${p.total} ch</span></div><div class="goal-day-counter">Day ${p.elapsed}/${p.totalDays}</div></div>
        <div class="progress ${p.isComplete ? 'progress-done' : p.isOverdue ? 'progress-overdue' : ''} goal-progress"><span style="width:${p.percent}%"></span></div>
        <div class="goal-meta">${formatDate(g.startDate)} → ${formatDate(g.targetDate)}${p.isComplete && g.completedAt ? ` · 🎉 Done ${formatDate(g.completedAt)}` : ''}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function modalAddGoal(existing) {
    const subjOptions = ['<option value="">All subjects</option>']
      .concat(state.subjects.map(s => `<option value="${s.id}" ${existing && existing.subjectId === s.id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`))
      .join('');
    const curDur = existing ? existing.durationDays : 20;
    const presets = [7, 14, 20, 30, 60, 90].map(d => `<button type="button" class="chip-pick" data-dur="${d}" ${d === curDur ? 'data-active="1"' : ''}>${d}d</button>`).join('');
    openModal(`
      <h3>${existing ? 'Edit Goal' : 'New Goal'}</h3>
      <div class="field"><label>Goal name (optional)</label><input id="m-name" placeholder="e.g. Finish Math before exam" value="${existing ? escapeHTML(existing.name || '') : ''}" maxlength="60"/></div>
      <div class="field"><label>Subject</label><select id="m-subject">${subjOptions}</select></div>
      <div class="field"><label>Duration (days)</label><input id="m-duration" type="number" min="1" max="365" value="${curDur}"/>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${presets}</div></div>
      <div class="field"><label>Start date</label><input id="m-start" type="date" value="${existing ? existing.startDate : todayKey()}"/></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Goal'}</button>
      </div>
    `, root => {
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

  // --------- Smart Suggestions ---------
  const SUGGEST_LIMIT = 4;
  function topicKey(subId, chId, tId) { return `${subId}:${chId}:${tId}`; }

  function getSmartSuggestions(limit = SUGGEST_LIMIT) {
    const out = [], seen = new Set();
    for (const item of dueRevisionItems()) {
      if (out.length >= limit) break;
      const k = topicKey(item.sub.id, item.ch.id, item.topic.id);
      if (seen.has(k)) continue; seen.add(k);
      const overdue = item.daysOverdue || 0;
      out.push({ type: 'revision', key: k, sub: item.sub, ch: item.ch, topic: item.topic, label: 'Revise ' + item.ch.name, meta: overdue > 0 ? `${overdue}d overdue · ${item.sub.name}` : `Due today · ${item.sub.name}`, action: { kind: 'revision', revisionId: item.revisionId, offset: item.step.offset, subId: item.sub.id, chId: item.ch.id, tId: item.topic.id } });
    }
    for (const w of getWeakTopics()) {
      if (out.length >= limit) break;
      const k = topicKey(w.sub.id, w.ch.id, w.topic.id);
      if (seen.has(k)) continue; seen.add(k);
      out.push({ type: 'weak', key: k, sub: w.sub, ch: w.ch, topic: w.topic, label: 'Study ' + w.topic.name + ' today', meta: w.reason + ' · ' + w.sub.name, action: { kind: 'topic', subId: w.sub.id, chId: w.ch.id, tId: w.topic.id } });
    }
    if (out.length < limit) {
      const today = todayKey(), buckets = { today: [], high: [], rest: [] };
      for (const sub of state.subjects) for (const ch of sub.chapters) {
        if (isChapterEffectivelyDone(ch)) continue;
        for (const t of ch.topics) {
          if (t.done) continue;
          const k = topicKey(sub.id, ch.id, t.id); if (seen.has(k)) continue;
          const item = { sub, ch, topic: t, key: k };
          if (ch.scheduledDate === today) { item.reason = 'Scheduled today'; buckets.today.push(item); }
          else if (ch.priority === 'high') { item.reason = 'High priority'; buckets.high.push(item); }
          else { item.reason = 'In progress'; buckets.rest.push(item); }
        }
      }
      for (const it of [...buckets.today, ...buckets.high, ...buckets.rest]) {
        if (out.length >= limit) break;
        seen.add(it.key);
        out.push({ type: 'incomplete', key: it.key, sub: it.sub, ch: it.ch, topic: it.topic, label: 'Continue ' + it.topic.name, meta: it.reason + ' · ' + it.sub.name, action: { kind: 'topic', subId: it.sub.id, chId: it.ch.id, tId: it.topic.id } });
      }
    }
    return out;
  }

  function renderSmartSuggestions() {
    const items = getSmartSuggestions();
    if (!items.length) return `<div class="suggestion-card empty-suggestion"><div class="suggestion-card-header"><span class="suggestion-card-icon">💡</span><h3>Smart Suggestions</h3></div><div class="empty">All caught up — no suggestions right now.</div></div>`;
    const typeMap = { revision: { icon: '🔁', tag: 'Revision due' }, weak: { icon: '⚠️', tag: 'Weak topic' }, incomplete: { icon: '📘', tag: 'Continue' } };
    return `<div class="suggestion-card"><div class="suggestion-card-header"><span class="suggestion-card-icon">💡</span><h3>Smart Suggestions</h3><span class="suggestion-card-sub">Auto-updated</span></div>
      <div class="suggestion-list">${items.map(s => {
      const meta = typeMap[s.type] || typeMap.incomplete;
      const isRev = s.action.kind === 'revision';
      const doneAttrs = isRev ? `data-act="suggest-rev-done" data-rev="${s.action.revisionId}" data-off="${s.action.offset}"` : `data-act="suggest-topic-done" data-sub="${s.action.subId}" data-ch="${s.action.chId}" data-t="${s.action.tId}"`;
      return `<div class="suggestion-item"><span class="suggestion-color-bar" style="background:${s.sub.color || 'var(--primary)'}"></span><div class="suggestion-icon">${meta.icon}</div><div class="suggestion-body"><div class="suggestion-tag">${meta.tag}</div><div class="suggestion-text">${escapeHTML(s.label)}</div><div class="suggestion-meta">${escapeHTML(s.meta)}</div></div><div class="suggestion-actions"><button class="btn btn-ghost btn-sm" data-act="suggest-open" data-sub="${s.sub.id}" data-ch="${s.ch.id}">Open</button><button class="btn btn-sm" ${doneAttrs}>${ic('check')}</button></div></div>`;
    }).join('')}</div></div>`;
  }

  // --------- Weak Areas ---------
  function renderWeakAreas() {
    const weak = getWeakTopics();
    return `<div class="section-head"><h2>Weak Areas</h2>${weak.length ? `<span class="muted">${weak.length} flagged</span>` : ''}</div>
      ${weak.length ? `<div class="list">${weak.map(w => `
      <div class="card weak-card" style="padding:12px 14px">
        <div class="row" style="align-items:flex-start">
          <div class="weak-icon-lg">⚠️</div>
          <div style="flex:1;min-width:0">
            <div class="title">${escapeHTML(w.topic.name)}</div>
            <div class="meta">${escapeHTML(w.sub.name)} · ${escapeHTML(w.ch.name)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
              ${w.skips >= WEAK_SKIP_THRESHOLD ? `<span class="pill pill-weak">Skipped ×${w.skips}</span>` : ''}
              ${w.age >= WEAK_AGE_DAYS ? `<span class="pill pill-stale">${w.age}d stale</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="menu-btn" data-act="weak-mark-done" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}" title="Mark complete">${ic('check')}</button>
            <button class="menu-btn" data-act="weak-reset" data-sub="${w.sub.id}" data-ch="${w.ch.id}" data-t="${w.topic.id}" title="Reset">${ic('refresh')}</button>
          </div>
        </div>
      </div>`).join('')}</div>` : `<div class="empty">No weak topics — keep it up!</div>`}`;
  }

  // ========== Syllabus ==========
  function renderSyllabus() {
    const view = document.getElementById('view-syllabus'); if (!view) return;
    const subjects = state.subjects;
    view.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between">
        <div><h1>Syllabus</h1><div class="subtitle">${subjects.length} subject${subjects.length === 1 ? '' : 's'}</div></div>
        <button class="btn" data-act="add-subject">${ic('plus')} Subject</button>
      </div>
      ${!subjects.length ? `<div class="empty">No subjects yet. Add one to get started.</div>` : `<div class="list">${subjects.map(sub => renderSubjectCard(sub)).join('')}</div>`}
    `;
    // Bind plan pickers if on home
    bindPlanPickers();
  }

  function renderSubjectCard(sub) {
    const isOpen = openSubjects.has(sub.id);
    const total = sub.chapters.length;
    const done = sub.chapters.filter(ch => isChapterEffectivelyDone(ch)).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const priorityPill = sub.priority ? `<span class="pill pill-${sub.priority === 'high' ? 'high' : sub.priority === 'medium' ? 'med' : 'low'}">${sub.priority}</span>` : '';
    return `<div class="card subject-card" data-sub-id="${sub.id}">
      <div class="subject-head" data-act="toggle-subject" data-id="${sub.id}">
        <span class="color-dot" style="background:${sub.color}"></span>
        <span class="subject-name">${escapeHTML(sub.name)}</span>
        ${priorityPill}
        <span class="muted" style="font-size:12px">${done}/${total}</span>
        <button class="menu-btn" data-act="open-subject-menu" data-id="${sub.id}" style="z-index:1" onclick="event.stopPropagation()">${ic('dots')}</button>
        <span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span>
      </div>
      <div class="progress" style="margin-bottom:${isOpen ? '8px' : '4px'}"><span style="width:${pct}%"></span></div>
      ${sub.notes ? `<div class="notes">${escapeHTML(sub.notes)}</div>` : ''}
      ${isOpen ? `<div class="chapter-list">${sub.chapters.map(ch => renderChapterCard(sub, ch)).join('')}
        <button class="btn btn-ghost btn-block" style="margin-top:4px" data-act="add-chapter" data-sub="${sub.id}">${ic('plus')} Add Chapter</button>
      </div>` : ''}
    </div>`;
  }

  function renderChapterCard(sub, ch) {
    const isOpen = openChapters.has(ch.id);
    const pct = chapterProgress(ch);
    const isDone = isChapterEffectivelyDone(ch);
    const today = todayKey();
    const priorityPill = ch.priority ? `<span class="pill pill-${ch.priority === 'high' ? 'high' : ch.priority === 'medium' ? 'med' : 'low'}">${ch.priority}</span>` : '';
    const todayPill = ch.scheduledDate === today ? `<span class="pill pill-today">Today</span>` : '';
    const revPill = ch.revisionCount > 0 ? `<span class="pill pill-rev">Rev ×${ch.revisionCount}</span>` : '';
    return `<div class="chapter" data-ch-id="${ch.id}">
      <div class="chapter-row">
        <input type="checkbox" class="check" ${isDone ? 'checked' : ''} data-act="toggle-chapter-done" data-sub="${sub.id}" data-ch="${ch.id}"/>
        <div style="flex:1;min-width:0">
          <div class="title-row" style="cursor:pointer" data-act="toggle-chapter" data-id="${ch.id}">
            <span class="name ${isDone ? 'done' : ''}">${escapeHTML(ch.name)}</span>
            <span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span>
          </div>
          <div class="badges">
            ${priorityPill}${todayPill}${revPill}
            ${pct > 0 && pct < 100 ? `<span class="muted">${pct}%</span>` : ''}
          </div>
          ${ch.notes ? `<div class="notes">${escapeHTML(ch.notes)}</div>` : ''}
        </div>
        <button class="menu-btn" data-act="open-chapter-menu" data-sub="${sub.id}" data-ch="${ch.id}">${ic('dots')}</button>
      </div>
      ${isOpen && ch.topics.length ? `<div class="topic-list">${ch.topics.map(t => renderTopicRow(sub, ch, t)).join('')}</div>` : ''}
      ${isOpen ? `<div style="padding-left:30px;margin-top:8px"><button class="btn-link" data-act="add-topic" data-sub="${sub.id}" data-ch="${ch.id}">${ic('plus')} Add Topic</button></div>` : ''}
    </div>`;
  }

  function renderTopicRow(sub, ch, t) {
    const priorityPill = t.priority ? `<span class="pill pill-${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'med' : 'low'}">${t.priority}</span>` : '';
    const weakBadge = isWeakTopic(t) ? `<span class="pill pill-weak">Weak</span>` : '';
    return `<div class="topic">
      <input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-topic-done" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}"/>
      <div style="flex:1;min-width:0">
        <div class="name ${t.done ? 'done' : ''}">${escapeHTML(t.name)}</div>
        ${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>` : ''}
        ${priorityPill || weakBadge ? `<div style="display:flex;gap:4px;margin-top:4px">${priorityPill}${weakBadge}</div>` : ''}
      </div>
      <button class="menu-btn" data-act="open-topic-menu" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}">${ic('dots')}</button>
    </div>`;
  }

  // --------- Syllabus Modals ---------
  function modalAddSubject(existing) {
    openModal(`
      <h3>${existing ? 'Edit Subject' : 'New Subject'}</h3>
      <div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Mathematics" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="60"/></div>
      <div class="field"><label>Color</label><input id="m-color" type="color" value="${existing ? existing.color : '#38bdf8'}" style="width:60px;height:40px;padding:4px;border-radius:8px;border:1px solid var(--border);background:#0b1327;cursor:pointer"/></div>
      <div class="field"><label>Priority</label>
        <div class="priority-row">
          <button type="button" data-prio="high" class="${existing && existing.priority === 'high' ? 'sel-high' : ''}">High</button>
          <button type="button" data-prio="medium" class="${existing && existing.priority === 'medium' ? 'sel-med' : ''}">Medium</button>
          <button type="button" data-prio="low" class="${existing && existing.priority === 'low' ? 'sel-low' : ''}">Low</button>
          <button type="button" data-prio="" class="${!existing || !existing.priority ? 'sel-low' : ''}">None</button>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="m-notes" placeholder="Optional notes…" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Subject'}</button>
      </div>
    `, root => {
      let priority = existing ? (existing.priority || '') : '';
      root.querySelectorAll('[data-prio]').forEach(btn => {
        btn.onclick = () => {
          priority = btn.dataset.prio;
          root.querySelectorAll('[data-prio]').forEach(b => b.className = '');
          btn.className = priority === 'high' ? 'sel-high' : priority === 'medium' ? 'sel-med' : priority === 'low' ? 'sel-low' : 'sel-low';
        };
      });
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name required', 'warn'); return; }
        const color = root.querySelector('#m-color').value;
        const notes = root.querySelector('#m-notes').value.trim();
        if (existing) { Object.assign(existing, { name, color, notes, priority: priority || null }); }
        else { state.subjects.push({ id: uid(), name, color, notes, priority: priority || null, revisionCount: 0, lastRevisedAt: null, checklist: makeDefaultChecklist(), chapters: [] }); }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Subject updated' : 'Subject added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => {
        confirmModal(`Delete "${existing.name}" and all its chapters?`, () => {
          state.subjects = state.subjects.filter(s => s.id !== existing.id);
          saveState(); closeModal(); renderAll(); toast('Subject deleted', 'danger');
        });
      };
    });
  }

  function modalAddChapter(subId, existing) {
    const sub = findSubject(subId); if (!sub) return;
    openModal(`
      <h3>${existing ? 'Edit Chapter' : 'New Chapter'}</h3>
      <div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Differential Calculus" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="80"/></div>
      <div class="field"><label>Priority</label>
        <div class="priority-row">
          <button type="button" data-prio="high" class="${existing && existing.priority === 'high' ? 'sel-high' : ''}">High</button>
          <button type="button" data-prio="medium" class="${existing && existing.priority === 'medium' ? 'sel-med' : ''}">Medium</button>
          <button type="button" data-prio="low" class="${existing && existing.priority === 'low' ? 'sel-low' : ''}">Low</button>
          <button type="button" data-prio="" class="${!existing || !existing.priority ? 'sel-low' : ''}">None</button>
        </div>
      </div>
      <div class="field"><label>Schedule date (optional)</label><input id="m-date" type="date" value="${existing && existing.scheduledDate ? existing.scheduledDate : ''}"/></div>
      <div class="field"><label>Notes</label><textarea id="m-notes" placeholder="Optional notes…" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Chapter'}</button>
      </div>
    `, root => {
      let priority = existing ? (existing.priority || '') : '';
      root.querySelectorAll('[data-prio]').forEach(btn => {
        btn.onclick = () => {
          priority = btn.dataset.prio;
          root.querySelectorAll('[data-prio]').forEach(b => b.className = '');
          btn.className = priority === 'high' ? 'sel-high' : priority === 'medium' ? 'sel-med' : priority === 'low' ? 'sel-low' : 'sel-low';
        };
      });
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name required', 'warn'); return; }
        const notes = root.querySelector('#m-notes').value.trim();
        const scheduledDate = root.querySelector('#m-date').value || null;
        if (existing) { Object.assign(existing, { name, notes, priority: priority || null, scheduledDate }); }
        else { sub.chapters.push({ id: uid(), name, notes, priority: priority || null, revisionCount: 0, lastRevisedAt: null, done: false, scheduledDate, checklist: makeDefaultChecklist(), topics: [] }); }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Chapter updated' : 'Chapter added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => {
        confirmModal(`Delete "${existing.name}" and all its topics?`, () => {
          sub.chapters = sub.chapters.filter(c => c.id !== existing.id);
          saveState(); closeModal(); renderAll(); toast('Chapter deleted', 'danger');
        });
      };
    });
  }

  function modalAddTopic(subId, chId, existing) {
    const ch = findChapter(subId, chId); if (!ch) return;
    openModal(`
      <h3>${existing ? 'Edit Topic' : 'New Topic'}</h3>
      <div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Limits" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="80"/></div>
      <div class="field"><label>Priority</label>
        <div class="priority-row">
          <button type="button" data-prio="high" class="${existing && existing.priority === 'high' ? 'sel-high' : ''}">High</button>
          <button type="button" data-prio="medium" class="${existing && existing.priority === 'medium' ? 'sel-med' : ''}">Medium</button>
          <button type="button" data-prio="low" class="${existing && existing.priority === 'low' ? 'sel-low' : ''}">Low</button>
          <button type="button" data-prio="" class="${!existing || !existing.priority ? 'sel-low' : ''}">None</button>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="m-notes" placeholder="Optional notes…" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Topic'}</button>
      </div>
    `, root => {
      let priority = existing ? (existing.priority || '') : '';
      root.querySelectorAll('[data-prio]').forEach(btn => {
        btn.onclick = () => {
          priority = btn.dataset.prio;
          root.querySelectorAll('[data-prio]').forEach(b => b.className = '');
          btn.className = priority === 'high' ? 'sel-high' : priority === 'medium' ? 'sel-med' : 'sel-low';
        };
      });
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        if (!name) { toast('Name required', 'warn'); return; }
        const notes = root.querySelector('#m-notes').value.trim();
        if (existing) { Object.assign(existing, { name, notes, priority: priority || null }); }
        else { ch.topics.push({ id: uid(), name, notes, done: false, priority: priority || null, revisionCount: 0, lastRevisedAt: null, skipCount: 0, firstSeenAt: todayKey(), lastSkippedAt: null }); }
        saveState(); closeModal(); renderAll(); toast(existing ? 'Topic updated' : 'Topic added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => {
        ch.topics = ch.topics.filter(t => t.id !== existing.id);
        saveState(); closeModal(); renderAll(); toast('Topic deleted', 'danger');
      };
    });
  }

  function showSubjectMenu(subId) {
    closeDropdown();
    const sub = findSubject(subId); if (!sub) return;
    const btn = document.querySelector(`[data-act="open-subject-menu"][data-id="${subId}"]`); if (!btn) return;
    const d = document.createElement('div');
    d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-subject" data-id="${subId}">${ic('edit')} Edit Subject</button>
      <button data-act="add-chapter" data-sub="${subId}">${ic('plus')} Add Chapter</button>
      <button data-act="del-subject" data-id="${subId}" class="danger">${ic('trash')} Delete Subject</button>
    `;
    btn.closest('.card').appendChild(d);
    activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  }

  function showChapterMenu(subId, chId) {
    closeDropdown();
    const ch = findChapter(subId, chId); if (!ch) return;
    const btn = document.querySelector(`[data-act="open-chapter-menu"][data-sub="${subId}"][data-ch="${chId}"]`); if (!btn) return;
    const d = document.createElement('div');
    d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-chapter" data-sub="${subId}" data-ch="${chId}">${ic('edit')} Edit Chapter</button>
      <button data-act="add-topic" data-sub="${subId}" data-ch="${chId}">${ic('plus')} Add Topic</button>
      <button data-act="schedule-chapter" data-sub="${subId}" data-ch="${chId}">${ic('cal')} Schedule</button>
      <button data-act="del-chapter" data-sub="${subId}" data-ch="${chId}" class="danger">${ic('trash')} Delete Chapter</button>
    `;
    btn.closest('.chapter').appendChild(d);
    activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  }

  function showTopicMenu(subId, chId, tId) {
    closeDropdown();
    const t = findTopic(subId, chId, tId); if (!t) return;
    const btn = document.querySelector(`[data-act="open-topic-menu"][data-sub="${subId}"][data-ch="${chId}"][data-t="${tId}"]`); if (!btn) return;
    const d = document.createElement('div');
    d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('edit')} Edit Topic</button>
      <button data-act="del-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}" class="danger">${ic('trash')} Delete Topic</button>
    `;
    btn.closest('.topic').appendChild(d);
    activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  }

  // ========== Focus Tab ==========
  const FOCUS_MODES = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };
  let focusMode = 'work', focusSeconds = FOCUS_MODES.work;
  let focusRunning = false, focusTimer = null, focusSessions = 0;

  function renderFocus() {
    const view = document.getElementById('view-focus'); if (!view) return;
    view.innerHTML = `
      <div class="page-header" style="text-align:center"><h1>Focus Timer</h1><div class="subtitle">Stay in the zone</div></div>
      <div class="focus-view">
        <div class="focus-mode-tabs">
          <button class="focus-mode-btn ${focusMode === 'work' ? 'active' : ''}" data-act="focus-mode" data-mode="work">Work</button>
          <button class="focus-mode-btn ${focusMode === 'short' ? 'active' : ''}" data-act="focus-mode" data-mode="short">Short Break</button>
          <button class="focus-mode-btn ${focusMode === 'long' ? 'active' : ''}" data-act="focus-mode" data-mode="long">Long Break</button>
        </div>
        <div class="focus-ring-wrap">
          ${renderFocusRing()}
          <div class="focus-ring-center">
            <div class="focus-ring-time" id="focus-time-display">${formatFocusTime(focusSeconds)}</div>
            <div class="focus-ring-mode">${focusMode === 'work' ? 'Focus' : focusMode === 'short' ? 'Short Break' : 'Long Break'}</div>
          </div>
        </div>
        <div class="focus-buttons">
          <button class="btn btn-ghost" data-act="focus-reset">Reset</button>
          <button class="btn" style="min-width:120px" data-act="focus-toggle">${focusRunning ? 'Pause' : 'Start'}</button>
        </div>
        <div class="focus-sessions-info">
          <div class="row" style="justify-content:space-between">
            <div><div class="v">${focusSessions}</div><div class="k">Sessions today</div></div>
            <div style="text-align:right"><div class="v">${focusSessions * 25}</div><div class="k">Minutes focused</div></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderFocusRing() {
    const total = FOCUS_MODES[focusMode];
    const r = 96, c = 2 * Math.PI * r;
    const pct = focusSeconds / total;
    const off = c * (1 - pct);
    return `<svg class="focus-ring-svg" viewBox="0 0 220 220" aria-hidden="true">
      <circle class="focus-ring-track" cx="110" cy="110" r="${r}"/>
      <circle class="focus-ring-fill" cx="110" cy="110" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
    </svg>`;
  }

  function formatFocusTime(secs) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function focusTick() {
    if (focusSeconds > 0) {
      focusSeconds--;
      updateFocusDisplay();
    } else {
      clearInterval(focusTimer); focusTimer = null; focusRunning = false;
      if (focusMode === 'work') {
        focusSessions++;
        bumpActivity(); saveState();
        toast('Focus session complete! 🎉 Take a break.', 'success', 6000);
        if (notifPermission() === 'granted') showWebNotification('Session complete! 🎉', 'Take a short break — you earned it.', { tag: 'focus-done' });
      } else {
        toast('Break over — time to focus!', 'info', 4000);
      }
      renderFocus();
    }
  }

  function updateFocusDisplay() {
    const timeEl = document.getElementById('focus-time-display');
    if (timeEl) timeEl.textContent = formatFocusTime(focusSeconds);
    const svg = document.querySelector('.focus-ring-svg');
    if (svg) {
      const circle = svg.querySelector('.focus-ring-fill');
      if (circle) {
        const r = 96, c = 2 * Math.PI * r;
        const off = c * (1 - focusSeconds / FOCUS_MODES[focusMode]);
        circle.setAttribute('stroke-dashoffset', off.toFixed(2));
      }
    }
    document.title = focusRunning ? `${formatFocusTime(focusSeconds)} — Study` : 'Syllabus Tracker';
  }

  // ========== Revision Tab ==========
  function renderRevision() {
    const view = document.getElementById('view-revision'); if (!view) return;
    const dueItems = dueRevisionItems();
    const upcoming = upcomingRevisionItems(8);
    view.innerHTML = `
      <div class="page-header"><h1>Revision</h1><div class="subtitle">Spaced repetition schedule</div></div>
      <div class="section-head"><h2>Due Today${dueItems.length ? ` (${dueItems.length})` : ''}</h2></div>
      ${!dueItems.length ? `<div class="empty">No revisions due — great job staying on top of it!</div>` : `<div class="list">${dueItems.map(item => `
        <div class="card card-row revision-item is-overdue">
          <span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span>
          <div style="flex:1;min-width:0">
            <div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div>
            <div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div>
            <div style="margin-top:4px">
              ${item.daysOverdue > 0 ? `<span class="pill pill-overdue">${item.daysOverdue}d overdue</span>` : `<span class="pill pill-today">Due today</span>`}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-sm" data-act="rev-done" data-rev="${item.revisionId}" data-off="${item.step.offset}" title="Mark done">${ic('check')}</button>
            <button class="menu-btn" data-act="rev-dismiss" data-rev="${item.revisionId}" title="Dismiss">${ic('trash')}</button>
          </div>
        </div>`).join('')}</div>`}
      <div class="section-head"><h2>Upcoming</h2></div>
      ${!upcoming.length ? `<div class="empty">No upcoming revisions scheduled.</div>` : `<div class="list">${upcoming.map(item => `
        <div class="card card-row revision-item upcoming">
          <span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span>
          <div style="flex:1;min-width:0">
            <div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div>
            <div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div>
            <div style="margin-top:4px"><span class="pill pill-upcoming">In ${item.daysUntil}d · ${formatDate(item.step.dueDate)}</span></div>
          </div>
        </div>`).join('')}</div>`}
    `;
  }

  // ========== Stats Tab ==========
  function renderStats() {
    const view = document.getElementById('view-stats'); if (!view) return;
    const overall = overallProgress();
    let totalTopics = 0, doneTopics = 0, totalChapters = 0, doneChapters = 0;
    for (const sub of state.subjects) {
      for (const ch of sub.chapters) {
        totalChapters++;
        if (isChapterEffectivelyDone(ch)) doneChapters++;
        for (const t of ch.topics) { totalTopics++; if (t.done) doneTopics++; }
      }
    }

    // Activity last 14 days
    const today = new Date(todayKey() + 'T00:00:00');
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      days.push({ k, count: state.activity[k] || 0, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) });
    }
    const maxAct = Math.max(1, ...days.map(d => d.count));

    const subjectRows = state.subjects.map(sub => {
      let tot = 0, dn = 0;
      for (const ch of sub.chapters) { tot++; if (isChapterEffectivelyDone(ch)) dn++; }
      const pct = tot ? Math.round((dn / tot) * 100) : 0;
      return `<div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="color-dot" style="background:${sub.color}"></span>
          <span style="font-weight:600;flex:1">${escapeHTML(sub.name)}</span>
          <span style="font-weight:700;color:var(--primary)">${pct}%</span>
        </div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <div class="muted" style="margin-top:4px">${dn}/${tot} chapters complete</div>
      </div>`;
    }).join('');

    view.innerHTML = `
      <div class="page-header"><h1>Stats</h1><div class="subtitle">Your study progress at a glance</div></div>
      <div class="stats-row">
        <div class="stat-tile"><div class="v">${overall}%</div><div class="k">Overall Progress</div></div>
        <div class="stat-tile"><div class="v">${state.streak.count}🔥</div><div class="k">Day Streak</div></div>
        <div class="stat-tile"><div class="v">${doneTopics}/${totalTopics}</div><div class="k">Topics Done</div></div>
        <div class="stat-tile"><div class="v">${doneChapters}/${totalChapters}</div><div class="k">Chapters Done</div></div>
      </div>
      <h2 style="margin:18px 0 8px">Activity (14 days)</h2>
      <div class="card" style="padding:14px 16px">
        <div class="bars">${days.map(d => `<div class="bar" style="height:${Math.max(8, Math.round((d.count / maxAct) * 100))}%;opacity:${d.count ? '0.9' : '0.3'}"></div>`).join('')}</div>
        <div class="lbls">${days.map(d => `<div class="lbl">${d.label}</div>`).join('')}</div>
      </div>
      <h2 style="margin:18px 0 8px">By Subject</h2>
      ${subjectRows || `<div class="empty">No subjects yet.</div>`}
    `;
  }

  // ========== Settings Modal ==========
  function modalSettings() {
    const sr = state.smartReminder, mr = state.motivationReminders;
    const perm = notifPermission();
    let permCls = 'warn', permText = 'Notification permission not yet requested.';
    if (perm === 'unsupported') { permCls = 'warn'; permText = 'Notifications not supported on this browser.'; }
    else if (perm === 'granted')  { permCls = 'ok';   permText = 'Notifications are allowed.'; }
    else if (perm === 'denied')   { permCls = 'err';  permText = 'Notifications are blocked. Enable them in browser settings.'; }
    const chips = (which, list) => list.map((t, i) => `<span class="time-chip"><button type="button" class="time-chip-edit" data-act="open-time-picker" data-which="${which}" data-i="${i}">${escapeHTML(formatTime12(t))}</button><button type="button" class="time-chip-del" data-act="del-time-slot" data-which="${which}" data-i="${i}">×</button></span>`).join('');
    openModal(`
      <h3>Settings</h3>
      <div class="settings-section">
        <h4>Daily Study Reminder</h4>
        <div class="settings-row">
          <div class="label">Notify if today's tasks aren't done<div class="sub">Set multiple reminder times.</div></div>
          <label class="switch"><input type="checkbox" id="set-sr-toggle" ${sr.enabled ? 'checked' : ''} data-act="toggle-smart-reminder"/><span class="slider"></span></label>
        </div>
        <div class="time-chip-row" style="${sr.enabled ? '' : 'opacity:.55;pointer-events:none'}">
          ${sr.times.length ? chips('reminder', sr.times) : '<span class="muted">No times set.</span>'}
          <button type="button" class="time-chip add" data-act="open-time-picker" data-which="reminder" data-i="-1">+ Add time</button>
        </div>
      </div>
      <div class="settings-section">
        <h4>Motivation Notifications</h4>
        <div class="settings-row">
          <div class="label">Motivational push messages<div class="sub">A random quote at each scheduled time.</div></div>
          <label class="switch"><input type="checkbox" id="set-mr-toggle" ${mr.enabled ? 'checked' : ''} data-act="toggle-motivation"/><span class="slider"></span></label>
        </div>
        <div class="time-chip-row" style="${mr.enabled ? '' : 'opacity:.55;pointer-events:none'}">
          ${mr.times.length ? chips('motivation', mr.times) : '<span class="muted">No times set.</span>'}
          <button type="button" class="time-chip add" data-act="open-time-picker" data-which="motivation" data-i="-1">+ Add time</button>
        </div>
      </div>
      <div class="settings-section">
        <h4>Notifications Status</h4>
        <div class="notif-status ${permCls}">${escapeHTML(permText)}</div>
        ${perm === 'default' || perm === 'denied' ? `<div style="margin-top:10px"><button class="btn btn-block" data-act="sr-request-perm">${perm === 'denied' ? 'Try requesting again' : 'Allow notifications'}</button></div>` : ''}
      </div>
      <div class="settings-section">
        <h4>Motivation Quotes</h4>
        <div class="quote-list">
          ${state.motivationQuotes.map((q, i) => `<div class="quote-row"><div class="text">${escapeHTML(q)}</div><button class="menu-btn" data-act="del-quote" data-i="${i}">${ic('trash')}</button></div>`).join('')}
        </div>
        <div class="quote-add-row"><input id="set-new-quote" placeholder="Add a motivation quote…" maxlength="200"/><button class="btn" data-act="add-quote">${ic('plus')}</button></div>
      </div>
      <div class="settings-section">
        <h4>Data</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost" data-act="export-data">${ic('download')} Export</button>
          <label class="btn btn-ghost" style="cursor:pointer">${ic('upload')} Import<input type="file" accept=".json" style="display:none" id="import-file-input"/></label>
        </div>
      </div>
      <div class="actions" style="margin-top:18px"><button class="btn btn-ghost" data-close>Close</button></div>
    `, root => {
      root.querySelector('#import-file-input').onchange = e => { importData(e.target.files[0]); closeModal(); };
    });
  }

  function refreshSettingsIfOpen() {
    const root = document.getElementById('modal-root');
    const h = root && root.querySelector('.modal h3');
    if (h && h.textContent.trim() === 'Settings') modalSettings();
  }

  function modalSetReminderTime(which, index) {
    const target = which === 'motivation' ? state.motivationReminders : state.smartReminder;
    const isAdd = index == null || index < 0;
    const initial = isAdd ? (target.times[target.times.length - 1] || '09:00') : (target.times[index] || '09:00');
    let [h, m] = initial.split(':').map(Number);
    if (isNaN(h)) h = 9; if (isNaN(m)) m = 0;
    h = Math.max(0, Math.min(23, h)); m = Math.max(0, Math.min(59, m));
    const titlePrefix = which === 'motivation' ? 'Motivation' : 'Reminder';
    openModal(`
      <h3>${titlePrefix} Time</h3>
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
              <button class="tp-s-btn" data-tp="h-down">−</button>
              <div class="tp-s-val tp-val-h">${String(h).padStart(2, '0')}</div>
              <button class="tp-s-btn" data-tp="h-up">+</button>
            </div>
          </div>
          <div class="tp-stepper">
            <div class="tp-s-label">Minute</div>
            <div class="tp-s-row">
              <button class="tp-s-btn" data-tp="m-down">−</button>
              <div class="tp-s-val tp-val-m">${String(m).padStart(2, '0')}</div>
              <button class="tp-s-btn" data-tp="m-up">+</button>
            </div>
          </div>
        </div>
        <div class="tp-ampm">
          <button class="tp-chip ${h < 12 ? 'on' : ''}" data-tp-ampm="AM">AM</button>
          <button class="tp-chip ${h >= 12 ? 'on' : ''}" data-tp-ampm="PM">PM</button>
        </div>
        <div class="tp-presets">
          <button class="tp-chip" data-tp-set="07:00">7:00 AM</button>
          <button class="tp-chip" data-tp-set="09:00">9:00 AM</button>
          <button class="tp-chip" data-tp-set="12:00">12:00 PM</button>
          <button class="tp-chip" data-tp-set="18:00">6:00 PM</button>
          <button class="tp-chip" data-tp-set="20:00">8:00 PM</button>
          <button class="tp-chip" data-tp-set="21:00">9:00 PM</button>
        </div>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn" id="tp-save">${isAdd ? 'Add Time' : 'Save'}</button>
      </div>
    `, root => {
      function update() {
        h = ((h % 24) + 24) % 24; m = ((m % 60) + 60) % 60;
        const h12 = ((h + 11) % 12) + 1, ampm = h < 12 ? 'AM' : 'PM';
        root.querySelector('.tp-h').textContent = String(h12).padStart(2, '0');
        root.querySelector('.tp-m').textContent = String(m).padStart(2, '0');
        root.querySelector('.tp-ampm-lbl').textContent = ampm;
        root.querySelector('.tp-val-h').textContent = String(h).padStart(2, '0');
        root.querySelector('.tp-val-m').textContent = String(m).padStart(2, '0');
        root.querySelectorAll('[data-tp-ampm]').forEach(b => b.classList.toggle('on', b.dataset.tpAmpm === ampm));
      }
      root.querySelectorAll('[data-tp]').forEach(btn => {
        let timer = null, repeat = null;
        const fn = () => { const tp = btn.dataset.tp; if (tp === 'h-up') h++; else if (tp === 'h-down') h--; else if (tp === 'm-up') m++; else m--; update(); };
        btn.addEventListener('pointerdown', e => { e.preventDefault(); fn(); timer = setTimeout(() => { repeat = setInterval(fn, 80); }, 350); });
        const stop = () => { clearTimeout(timer); clearInterval(repeat); };
        btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
      });
      root.querySelectorAll('[data-tp-ampm]').forEach(btn => {
        btn.addEventListener('click', () => { const t = btn.dataset.tpAmpm; if (t === 'AM' && h >= 12) h -= 12; if (t === 'PM' && h < 12) h += 12; update(); });
      });
      root.querySelectorAll('[data-tp-set]').forEach(btn => {
        btn.addEventListener('click', () => { const [hh, mm] = btn.dataset.tpSet.split(':').map(Number); h = hh; m = mm; update(); });
      });
      root.querySelector('#tp-save').addEventListener('click', () => {
        const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        if (isAdd) { if (!target.times.includes(v)) target.times.push(v); }
        else target.times[index] = v;
        target.times.sort(); target.times = [...new Set(target.times)];
        saveState(); closeModal(); modalSettings();
        toast(`${titlePrefix} time ${isAdd ? 'added' : 'updated'} (${formatTime12(v)})`, 'success');
      });
    });
  }

  // ========== Exam Modals ==========
  function modalAddExam(existing) {
    openModal(`
      <h3>${existing ? 'Edit Exam' : 'Add Exam'}</h3>
      <div class="field"><label>Exam name</label><input id="m-name" placeholder="e.g. Final Exam" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="60"/></div>
      <div class="field"><label>Date</label><input id="m-date" type="date" value="${existing ? existing.date : nextDateISO(30)}"/></div>
      <div class="actions">
        <button class="btn btn-ghost" data-close>Cancel</button>
        ${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}
        <button class="btn" id="m-save">${existing ? 'Save' : 'Add Exam'}</button>
      </div>
    `, root => {
      root.querySelector('#m-save').onclick = () => {
        const name = root.querySelector('#m-name').value.trim();
        const date = root.querySelector('#m-date').value;
        if (!name) { toast('Name required', 'warn'); return; }
        if (!date) { toast('Date required', 'warn'); return; }
        if (existing) { existing.name = name; existing.date = date; }
        else state.exams.push({ id: uid(), name, date });
        saveState(); closeModal(); renderAll(); toast(existing ? 'Exam updated' : 'Exam added', 'success');
      };
      const delBtn = root.querySelector('#m-del');
      if (delBtn) delBtn.onclick = () => { state.exams = state.exams.filter(e => e.id !== existing.id); saveState(); closeModal(); renderAll(); toast('Exam deleted', 'danger'); };
    });
  }

  // ========== Plan pickers binding ==========
  function bindPlanPickers() {
    const selSub = document.getElementById('plan-pick-sub');
    const selCh = document.getElementById('plan-pick-ch');
    const selT = document.getElementById('plan-pick-t');
    if (!selSub) return;
    selSub.onchange = () => {
      const subId = selSub.value;
      selCh.innerHTML = '<option value="">Chapter…</option>';
      selT.innerHTML = '<option value="">Topic (optional)…</option>';
      selCh.disabled = !subId; selT.disabled = true;
      if (!subId) return;
      const sub = findSubject(subId);
      if (!sub) return;
      for (const ch of sub.chapters) selCh.innerHTML += `<option value="${ch.id}">${escapeHTML(ch.name)}</option>`;
    };
    selCh.onchange = () => {
      const subId = selSub.value, chId = selCh.value;
      selT.innerHTML = '<option value="">Topic (optional)…</option>';
      selT.disabled = !chId;
      if (!chId) return;
      const ch = findChapter(subId, chId);
      if (!ch) return;
      for (const t of ch.topics) if (!t.done) selT.innerHTML += `<option value="${t.id}">${escapeHTML(t.name)}</option>`;
    };
  }

  // ========== Event Handling ==========
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) { closeDropdown(); return; }
    const act = el.dataset.act;

    if (act === 'open-settings') { modalSettings(); return; }
    if (el.hasAttribute('data-close')) { closeModal(); return; }
    if (el.hasAttribute('data-tab')) { switchTab(el.dataset.tab); return; }

    // Navigation shortcuts
    if (act === 'open-dashboard') { switchTab('dashboard'); renderDashboard(); return; }
    if (act === 'open-plan') { closeModal(); switchTab('home'); renderHome(); return; }
    if (act === 'burnout-go-plan') { closeModal(); switchTab('home'); renderHome(); return; }
    if (act === 'burnout-popup') { showBurnoutPopup(); return; }
    if (act === 'burnout-dismiss-banner') { state.burnout.bannerDismissedDate = todayKey(); saveState(); renderDashboard(); return; }

    // Exams
    if (act === 'add-exam') { modalAddExam(null); return; }
    if (act === 'edit-exam') { const exam = state.exams.find(e => e.id === el.dataset.id); if (exam) modalAddExam(exam); return; }

    // Goals
    if (act === 'add-goal') { modalAddGoal(null); return; }
    if (act === 'edit-goal') { const g = (state.goals || []).find(g => g.id === el.dataset.id); if (g) modalAddGoal(g); return; }

    // Plan tasks
    if (act === 'regen-plan') {
      const k = todayKey();
      if (state.dailyPlans[k]) { state.dailyPlans[k].generated = false; state.dailyPlans[k].auto = []; }
      saveState(); renderHome(); toast('Plan regenerated', 'info'); return;
    }
    if (act === 'toggle-plan-task') {
      const type = el.dataset.type;
      if (type === 'auto') {
        const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
        if (t) {
          const wasDone = t.done; t.done = !t.done;
          if (t.done) { bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); _justPoppedKey = `auto:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`; }
          else onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, false);
          const tasks = getActivePlanTasks(), allDone = tasks.length > 0 && tasks.every(x => x.done);
          if (allDone && !wasDone) _justCompletedDay = todayKey();
          saveState(); renderHome(); renderSyllabus(); renderRevision();
        }
      } else {
        const plan = state.dailyPlans[todayKey()];
        if (plan) {
          const ct = plan.custom.find(c => c.id === el.dataset.id);
          if (ct) { ct.done = !ct.done; if (ct.done) bumpActivity(); saveState(); renderHome(); }
        }
      }
      return;
    }
    if (act === 'remove-plan-task') {
      const type = el.dataset.type;
      const plan = state.dailyPlans[todayKey()];
      if (!plan) return;
      if (type === 'auto') {
        const key = autoKey(el.dataset.sub, el.dataset.ch, el.dataset.t);
        bumpSkipCount(el.dataset.sub, el.dataset.ch, el.dataset.t);
        if (!plan.removed.includes(key)) plan.removed.push(key);
      } else {
        plan.custom = plan.custom.filter(c => c.id !== el.dataset.id);
      }
      saveState(); renderHome(); return;
    }
    if (act === 'add-plan-task') {
      const input = document.getElementById('plan-new-task');
      const text = input ? input.value.trim() : '';
      if (!text) { toast('Enter a task first', 'warn'); return; }
      const plan = ensureTodayPlan();
      plan.custom.push({ id: uid(), text, done: false });
      saveState(); renderHome(); return;
    }
    if (act === 'add-plan-from-syllabus') {
      const subId = document.getElementById('plan-pick-sub')?.value;
      const chId = document.getElementById('plan-pick-ch')?.value;
      const tId = document.getElementById('plan-pick-t')?.value;
      if (!subId || !chId) { toast('Select at least a subject and chapter', 'warn'); return; }
      const plan = ensureTodayPlan();
      if (tId) {
        const key = autoKey(subId, chId, tId);
        plan.removed = plan.removed.filter(k => k !== key);
        if (!plan.auto.find(a => a.subId === subId && a.chId === chId && a.tId === tId)) plan.auto.push({ subId, chId, tId });
      } else {
        const ch = findChapter(subId, chId);
        if (ch) for (const t of ch.topics) {
          const key = autoKey(subId, chId, t.id);
          plan.removed = plan.removed.filter(k => k !== key);
          if (!plan.auto.find(a => a.tId === t.id)) plan.auto.push({ subId, chId, tId: t.id });
        }
      }
      saveState(); renderHome(); toast('Added to plan', 'success'); return;
    }

    // Subject
    if (act === 'toggle-subject') { const id = el.dataset.id; openSubjects.has(id) ? openSubjects.delete(id) : openSubjects.add(id); renderSyllabus(); return; }
    if (act === 'add-subject') { modalAddSubject(null); return; }
    if (act === 'open-subject-menu') { e.stopPropagation(); showSubjectMenu(el.dataset.id); return; }
    if (act === 'edit-subject') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) modalAddSubject(sub); return; }
    if (act === 'del-subject') { closeDropdown(); const sub = findSubject(el.dataset.id); if (sub) confirmModal(`Delete "${sub.name}" and all chapters?`, () => { state.subjects = state.subjects.filter(s => s.id !== sub.id); saveState(); renderAll(); toast('Subject deleted', 'danger'); }); return; }

    // Chapter
    if (act === 'toggle-chapter') { const id = el.dataset.id; openChapters.has(id) ? openChapters.delete(id) : openChapters.add(id); renderSyllabus(); return; }
    if (act === 'toggle-chapter-done') {
      const ch = findChapter(el.dataset.sub, el.dataset.ch);
      if (ch) {
        const sub = findSubject(el.dataset.sub);
        const nowDone = !isChapterEffectivelyDone(ch);
        for (const t of ch.topics) { if (t.done !== nowDone) { t.done = nowDone; onTopicDoneChanged(el.dataset.sub, el.dataset.ch, t.id, nowDone); } }
        ch.done = nowDone;
        if (nowDone) bumpActivity();
        saveState(); renderAll(); toast(nowDone ? 'Chapter marked done' : 'Chapter reopened', nowDone ? 'success' : 'info');
      }
      return;
    }
    if (act === 'add-chapter') { closeDropdown(); modalAddChapter(el.dataset.sub, null); return; }
    if (act === 'open-chapter-menu') { e.stopPropagation(); showChapterMenu(el.dataset.sub, el.dataset.ch); return; }
    if (act === 'edit-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) modalAddChapter(el.dataset.sub, ch); return; }
    if (act === 'del-chapter') { closeDropdown(); const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) confirmModal(`Delete "${ch.name}"?`, () => { const sub = findSubject(el.dataset.sub); if (sub) sub.chapters = sub.chapters.filter(c => c.id !== ch.id); saveState(); renderAll(); toast('Chapter deleted', 'danger'); }); return; }
    if (act === 'schedule-chapter') {
      closeDropdown();
      const ch = findChapter(el.dataset.sub, el.dataset.ch); if (!ch) return;
      openModal(`
        <h3>Schedule Chapter</h3>
        <div class="field"><label>Schedule for date</label><input id="m-date" type="date" value="${ch.scheduledDate || todayKey()}"/></div>
        <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Schedule</button></div>
      `, root => {
        root.querySelector('#m-save').onclick = () => { ch.scheduledDate = root.querySelector('#m-date').value || null; saveState(); closeModal(); renderAll(); toast('Chapter scheduled', 'success'); };
      });
      return;
    }

    // Topic
    if (act === 'toggle-topic-done') {
      const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
      if (t) {
        t.done = !t.done;
        if (t.done) bumpActivity();
        onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, t.done);
        saveState(); renderAll();
      }
      return;
    }
    if (act === 'add-topic') { closeDropdown(); modalAddTopic(el.dataset.sub, el.dataset.ch, null); return; }
    if (act === 'open-topic-menu') { e.stopPropagation(); showTopicMenu(el.dataset.sub, el.dataset.ch, el.dataset.t); return; }
    if (act === 'edit-topic') { closeDropdown(); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) modalAddTopic(el.dataset.sub, el.dataset.ch, t); return; }
    if (act === 'del-topic') { closeDropdown(); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { const ch = findChapter(el.dataset.sub, el.dataset.ch); if (ch) { ch.topics = ch.topics.filter(tp => tp.id !== t.id); saveState(); renderAll(); toast('Topic deleted', 'danger'); } } return; }

    // Focus
    if (act === 'focus-mode') {
      clearInterval(focusTimer); focusTimer = null; focusRunning = false;
      focusMode = el.dataset.mode; focusSeconds = FOCUS_MODES[focusMode];
      renderFocus(); document.title = 'Syllabus Tracker'; return;
    }
    if (act === 'focus-toggle') {
      if (focusRunning) { clearInterval(focusTimer); focusTimer = null; focusRunning = false; }
      else { focusRunning = true; focusTimer = setInterval(focusTick, 1000); }
      renderFocus(); return;
    }
    if (act === 'focus-reset') {
      clearInterval(focusTimer); focusTimer = null; focusRunning = false;
      focusSeconds = FOCUS_MODES[focusMode];
      renderFocus(); document.title = 'Syllabus Tracker'; return;
    }

    // Revision
    if (act === 'rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderRevision(); renderDashboard(); toast('Revision marked done', 'success'); return; }
    if (act === 'rev-dismiss') { dismissRevisionEntry(el.dataset.rev); renderRevision(); return; }

    // Smart suggestions
    if (act === 'suggest-rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderDashboard(); renderRevision(); toast('Marked done', 'success'); return; }
    if (act === 'suggest-topic-done') {
      const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
      if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); }
      return;
    }
    if (act === 'suggest-open') { openSubjects.add(el.dataset.sub); openChapters.add(el.dataset.ch); switchTab('syllabus'); renderSyllabus(); return; }

    // Weak areas
    if (act === 'weak-mark-done') {
      const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t);
      if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); }
      return;
    }
    if (act === 'weak-reset') { resetWeakTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); saveState(); renderDashboard(); toast('Reset weak flag', 'info'); return; }

    // Settings
    if (act === 'toggle-smart-reminder') { state.smartReminder.enabled = el.checked; saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'toggle-motivation') { state.motivationReminders.enabled = el.checked; saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'open-time-picker') { modalSetReminderTime(el.dataset.which, parseInt(el.dataset.i, 10)); return; }
    if (act === 'del-time-slot') {
      const target = el.dataset.which === 'motivation' ? state.motivationReminders : state.smartReminder;
      target.times.splice(parseInt(el.dataset.i, 10), 1); saveState(); refreshSettingsIfOpen(); return;
    }
    if (act === 'sr-request-perm') { requestNotifPermission().then(() => { saveState(); refreshSettingsIfOpen(); }); return; }
    if (act === 'del-quote') { state.motivationQuotes.splice(parseInt(el.dataset.i, 10), 1); saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'add-quote') {
      const input = document.getElementById('set-new-quote');
      const text = input ? input.value.trim() : '';
      if (!text) { toast('Enter a quote first', 'warn'); return; }
      state.motivationQuotes.push(text); saveState(); refreshSettingsIfOpen(); return;
    }
    if (act === 'export-data') { closeModal(); exportData(); return; }
  });

  // Handle nav button clicks separately (data-tab)
  document.querySelector('.bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'focus') renderFocus();
    else renderAll();
  });

  // ========== Helper: bumpSkipCount ==========
  function bumpSkipCount(subId, chId, tId) {
    const t = findTopic(subId, chId, tId); if (!t) return;
    t.skipCount = (t.skipCount || 0) + 1; t.lastSkippedAt = todayKey();
  }

  // ========== Keyboard shortcut (Escape closes modal) ==========
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // ========== Mobile keyboard adjustment ==========
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const kbH = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--kb-h', kbH + 'px');
      document.body.classList.toggle('kb-open', kbH > 80);
    });
  }

  // ========== Init ==========
  document.addEventListener('DOMContentLoaded', () => {
    switchTab('home');
    renderAll();
    renderFocus();
    startTimers();
    setTimeout(maybeAutoShowBurnoutPopup, 2000);
  });

  // Fallback in case DOMContentLoaded already fired
  if (document.readyState !== 'loading') {
    switchTab('home');
    renderAll();
    renderFocus();
    startTimers();
    setTimeout(maybeAutoShowBurnoutPopup, 2000);
  }

})();
