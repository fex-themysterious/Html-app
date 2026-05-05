(() => {
  'use strict';

  const STORAGE_KEY = 'syllabus_tracker_v2';
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const uid = () => Math.random().toString(36).slice(2, 10);

  function addDaysISO(base, days) {
    const d = new Date(base + 'T00:00:00'); d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
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
      motivationQuotes: [
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
      ],
      streak: { count: 1, lastDate: todayKey() },
      activity: { [todayKey()]: 0 },
      dailyPlans: {},
      smartReminder: { enabled: false, times: ['20:00'], lastFired: {} },
      motivationReminders: { enabled: false, times: ['09:00', '14:00', '20:00'], lastFired: {} },
      revisions: [],
      burnout: { installDate: todayKey(), popupDismissedDate: null, bannerDismissedDate: null },
      goals: [],
      classroom: { groups: [] },
      focusStats: { sessions: {}, minutesByDate: {} }
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
    s.motivationQuotes = (s.motivationQuotes && s.motivationQuotes.length) ? s.motivationQuotes : defaultState().motivationQuotes;
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
    if (!s.classroom || typeof s.classroom !== 'object') s.classroom = { groups: [] };
    if (!Array.isArray(s.classroom.groups)) s.classroom.groups = [];
    s.classroom.groups = s.classroom.groups.map(g => ({
      id: g.id || uid(), name: g.name || 'Group',
      items: Array.isArray(g.items) ? g.items.map(it => ({
        id: it.id || uid(), title: it.title || 'Video', url: it.url || '',
        videoId: it.videoId || null, playlistId: it.playlistId || null,
        type: it.type || 'video', addedAt: it.addedAt || todayKey(),
        description: it.description || ''
      })) : []
    }));
    return s;
  }

  function loadState() {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? migrate(JSON.parse(r)) : defaultState(); }
    catch (e) { return defaultState(); }
  }
  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }

  let state = loadState();

  // ========== Helpers ==========
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
  function overallProgress() {
    let total = 0, done = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) {
      if (!ch.topics || !ch.topics.length) { total++; if (ch.done) done++; }
      else for (const t of ch.topics) { total++; if (t.done) done++; }
    }
    return total ? Math.round((done / total) * 100) : 0;
  }
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
  }

  // ========== Export / Import ==========
  function exportData() {
    try {
      const blob = new Blob([JSON.stringify({ app: 'syllabus-tracker', version: 1, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `syllabus-backup-${todayKey()}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Backup exported', 'success');
    } catch (e) { toast('Export failed', 'danger'); }
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
    const today = new Date(todayKey() + 'T00:00:00'); let count = 0;
    for (let i = 0; i < n; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      if ((state.activity[d.toISOString().slice(0, 10)] || 0) > 0) count++;
    }
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
    const quote = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : "One small step today.";
    openModal(`
      <h3>⚠️ Losing consistency</h3>
      <p style="color:var(--text-muted);font-size:13px;margin:-6px 0 12px">${info.reasons.map(r => escapeHTML(r.label)).join(' · ')}</p>
      <div style="background:var(--surface-2);border-left:3px solid var(--primary);padding:10px 12px;border-radius:8px;font-style:italic;font-size:14px;margin-bottom:10px">"${escapeHTML(quote)}"</div>
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
  function ensureTodayPlan() {
    const k = todayKey();
    if (!state.dailyPlans[k]) state.dailyPlans[k] = { auto: [], removed: [], custom: [], generated: false };
    const plan = state.dailyPlans[k];
    if (!plan.generated) {
      const picked = new Set(), auto = [];
      const pick = (subId, chId, tId) => { const key = autoKey(subId, chId, tId); if (!picked.has(key)) { picked.add(key); auto.push({ subId, chId, tId }); } };
      for (const sub of state.subjects) for (const ch of sub.chapters) if (ch.scheduledDate === k && !isChapterEffectivelyDone(ch)) for (const t of ch.topics) if (!t.done) pick(sub.id, ch.id, t.id);
      if (auto.length < 5) for (const sub of state.subjects) for (const ch of sub.chapters) if (ch.priority === 'high' && !isChapterEffectivelyDone(ch)) for (const t of ch.topics) if (!t.done && auto.length < 8) pick(sub.id, ch.id, t.id);
      if (!auto.length) for (const sub of state.subjects) for (const ch of sub.chapters) for (const t of ch.topics) if (!t.done && auto.length < 5) pick(sub.id, ch.id, t.id);
      plan.auto = auto; plan.generated = true; saveState();
    }
    return plan;
  }
  function getActivePlanTasks() {
    const plan = ensureTodayPlan(); const tasks = [];
    for (const a of plan.auto) {
      const key = autoKey(a.subId, a.chId, a.tId);
      if (plan.removed.includes(key)) continue;
      const sub = findSubject(a.subId), ch = findChapter(a.subId, a.chId), t = findTopic(a.subId, a.chId, a.tId);
      if (!sub || !ch || !t) continue;
      tasks.push({ type: 'auto', key, text: t.name, meta: `${sub.name} · ${ch.name}`, color: sub.color, done: !!t.done, subId: a.subId, chId: a.chId, tId: a.tId });
    }
    for (const c of plan.custom) tasks.push({ type: 'custom', key: c.id, text: c.text, meta: 'Custom task', color: '#94a3b8', done: !!c.done, id: c.id });
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
    pruneRevisions(); const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
      for (const step of r.schedule) if (!step.done && step.dueDate <= today) items.push({ revisionId: r.id, sub, ch, topic, step, daysOverdue: daysBetween(step.dueDate, today) });
    }
    return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }
  function upcomingRevisionItems(limit = 8) {
    pruneRevisions(); const today = todayKey(), items = [];
    for (const r of state.revisions) {
      const topic = findTopic(r.subId, r.chId, r.tId); if (!topic) continue;
      const sub = findSubject(r.subId), ch = findChapter(r.subId, r.chId);
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
  let smartReminderTimer = null, motivationTimer = null, dueTaskTimer = null;
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
      const quotes = state.motivationQuotes; const quote = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : "Keep going!";
      if (notifPermission() === 'granted') showWebNotification('💪 Stay focused', quote, { tag: `mot-${stampKey}` });
      else toast(`💪 ${quote}`, 'info', 5000);
      break;
    }
  }
  function startTimers() {
    clearInterval(smartReminderTimer); clearInterval(motivationTimer); clearInterval(dueTaskTimer);
    smartReminderTimer = setInterval(checkSmartReminder, 30000);
    motivationTimer = setInterval(checkMotivationReminders, 30000);
    dueTaskTimer = setInterval(() => {
      const today = todayKey(); if (dueTaskNotifiedDate !== today) { dueTaskNotified.clear(); dueTaskNotifiedDate = today; }
      for (const item of dueRevisionItems()) {
        const key = `${item.revisionId}:${item.step.offset}`; if (dueTaskNotified.has(key)) continue;
        dueTaskNotified.add(key);
        if (notifPermission() === 'granted') showWebNotification('Revision due', `${item.topic.name} (${item.sub.name})`, { tag: `rev-${key}` });
      }
    }, 60000);
  }

  // ========== Toast ==========
  function toast(msg, kind = 'info', ms = 3800) {
    const wrap = document.getElementById('toast-container'); if (!wrap) return;
    const t = document.createElement('div'); t.className = 'toast ' + kind;
    t.textContent = msg; wrap.appendChild(t);
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
  let _motivationIdx = Math.floor(Math.random() * 10);
  let _motivationRotateTimer = null;

  function getRotatingQuote() {
    const quotes = state.motivationQuotes;
    if (!quotes || !quotes.length) return "Keep going!";
    _motivationIdx = _motivationIdx % quotes.length;
    return quotes[_motivationIdx];
  }
  function nextMotivationQuote() {
    const quotes = state.motivationQuotes;
    if (!quotes || !quotes.length) return;
    _motivationIdx = (_motivationIdx + 1) % quotes.length;
    // Refresh motivation line in home if on home tab
    const homeView = document.getElementById('view-home');
    if (homeView && homeView.classList.contains('active')) {
      const line = homeView.querySelector('.motivation-line');
      if (line) {
        const overall = overallProgress();
        const tasks = getActivePlanTasks();
        const allDone = tasks.length > 0 && tasks.every(t => t.done);
        const newMsg = getRotatingQuote();
        line.className = `motivation-line ${overall >= 80 ? 'is-hot' : overall < 20 ? 'is-cold' : ''}`;
        line.textContent = newMsg;
      }
    }
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
  const customDurations = { work: 25, short: 5, long: 15 };

  // ========== Ambient Sound (MP3-based) ==========
  let ambientAudio = null;
  let ambientMode = 'none', ambientVolume = 0.5;

  function stopAmbient() {
    if (ambientAudio) {
      ambientAudio.pause();
      ambientAudio.currentTime = 0;
      ambientAudio = null;
    }
  }
  function startAmbient(mode) {
    stopAmbient();
    if (mode === 'none') return;
    const src = mode === 'rain' ? './sounds/rain.mp3' : './sounds/soft.mp3';
    ambientAudio = new Audio(src);
    ambientAudio.loop = true;
    ambientAudio.volume = ambientVolume;
    // Attempt playback — triggered by a direct user gesture so should succeed
    const playPromise = ambientAudio.play();
    if (playPromise) playPromise.catch(() => {});
  }
  function resumeAmbientIfNeeded() {
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
  function ytEmbedUrl(item) {
    if (item.type === 'playlist' && item.playlistId) return `https://www.youtube.com/embed/videoseries?list=${item.playlistId}&autoplay=1`;
    if (item.videoId) return `https://www.youtube.com/embed/${item.videoId}?autoplay=1`;
    return '';
  }
  async function fetchYouTubeTitle(url) {
    try {
      const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
      const resp = await fetch(endpoint, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data && data.title ? data.title : null;
    } catch (e) { return null; }
  }

  // ========== Navigation ==========
  const openSubjects = new Set(), openChapters = new Set();
  let activeDropdown = null;
  let _justPoppedKey = null, _justCompletedDay = null;
  let calendarViewDate = new Date();

  function switchTab(tab) {
    if (focusLocked && focusRunning && tab !== 'focus') {
      if (!confirm('Lock Mode is on and timer is running. Leave Focus tab?')) return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const view = document.getElementById('view-' + tab); if (view) view.classList.add('active');
    const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`); if (btn) btn.classList.add('active');
    document.body.className = 'tab-' + tab;
    closeDropdown();
    // Rotate motivation quote when returning to home
    if (tab === 'home') nextMotivationQuote();
  }
  function closeDropdown() { if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; } }

  // ========== Render All ==========
  function renderAll() { renderHome(); renderDashboard(); renderSyllabus(); renderRevision(); renderStats(); }

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
  function renderHome() {
    const view = document.getElementById('view-home'); if (!view) return;
    const exam = nextExam(), overall = overallProgress();
    const tasks = getActivePlanTasks(), doneCount = tasks.filter(t => t.done).length, totalCount = tasks.length;
    const allDone = totalCount > 0 && doneCount === totalCount;
    const examDays = exam ? daysUntil(exam.date) : null;
    const urgent = exam && examDays !== null && examDays <= 7 && examDays >= 0;
    const examHero = exam ? `<article class="hero-card ${urgent ? 'urgent' : ''}" data-act="add-exam" role="button">${urgent ? `<span class="urgent-badge">${examDays === 0 ? 'TODAY' : examDays === 1 ? 'TOMORROW' : 'SOON'}</span>` : ''}<div class="hero-eyebrow">${ic('cal')}<span>NEXT EXAM</span></div><h2 class="hero-title">${escapeHTML(exam.name)}</h2><div class="hero-sub">${formatDate(exam.date)}</div><div class="hero-bignum">${examDays}<span class="hero-bignum-unit">d</span></div><div class="hero-bignum-lbl">days remaining</div><div class="hero-actions"><button class="btn-link" data-act="edit-exam" data-id="${exam.id}">Edit</button><button class="btn-link" data-act="add-exam">+ Add</button></div></article>` :
      `<article class="hero-card empty"><div class="hero-eyebrow">${ic('cal')}<span>NEXT EXAM</span></div><h2 class="hero-title">No exam yet</h2><div class="hero-sub">Add one to start the countdown.</div><button class="btn" style="margin-top:12px" data-act="add-exam">${ic('plus')} Add Exam</button></article>`;
    const progressHero = `<article class="hero-card" data-act="open-dashboard" role="button"><div class="hero-eyebrow">${ic('check')}<span>OVERALL</span></div><div class="ring-wrap">${progressRingSVG(overall)}<div class="ring-center"><div class="ring-pct">${overall}<span>%</span></div><div class="ring-lbl">complete</div></div></div><div class="hero-progress-foot"><span><strong>${state.streak.count}</strong> day streak 🔥</span><span>${doneCount}/${totalCount} today</span></div></article>`;
    const achievedBadge = allDone ? `<div class="daily-achieved" role="status">${_justCompletedDay === todayKey() ? renderConfettiBurst() : ''}<span class="da-glyph">🏆</span><div><div class="da-title">Daily Goal Achieved!</div><div class="da-sub">All ${totalCount} task${totalCount === 1 ? '' : 's'} done!</div></div></div>` : '';
    const motivationMsg = getRotatingQuote();
    view.innerHTML = `<div class="page-header"><h1>Home</h1><div class="subtitle">${greeting()}, let's study</div><div class="motivation-line ${overall >= 80 ? 'is-hot' : overall < 20 ? 'is-cold' : ''}">${escapeHTML(motivationMsg)}</div></div><div class="hero-grid">${examHero}${progressHero}</div><button type="button" class="dashboard-cta" data-act="open-dashboard"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg></span><span class="body"><span class="title">Open Dashboard</span><span class="meta">Plan · Goals · Calendar · Suggestions</span></span><span class="arrow">›</span></button>${achievedBadge}<div class="section-head"><h2>Today's Tasks</h2><button class="btn-link" data-act="open-dashboard">+ Add tasks ›</button></div>${renderTasksList(tasks)}`;
    if (_justPoppedKey) requestAnimationFrame(() => { _justPoppedKey = null; });
    if (_justCompletedDay) setTimeout(() => { _justCompletedDay = null; }, 1800);
  }
  function renderTasksList(tasks) {
    if (!tasks.length) return `<div class="empty">No tasks for today — add some below.</div>`;
    return `<div class="list">${tasks.map(t => {
      const dataAttrs = t.type === 'auto' ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"` : `data-type="custom" data-id="${t.id}"`;
      const popped = _justPoppedKey === (t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`) ? 'just-popped' : '';
      return `<div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-plan-task" ${dataAttrs}/><span class="color-dot" style="background:${t.color}"></span><div style="flex:1;min-width:0"><div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}</div><div class="meta">${escapeHTML(t.meta)}</div></div><button class="menu-btn" data-act="remove-plan-task" ${dataAttrs}>${ic('trash')}</button></div>`;
    }).join('')}</div>`;
  }
  function renderPlanAdder() {
    const subjOptions = state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    return `<div class="plan-add-card"><div class="plan-add-title">Add to Today's Plan</div><div class="plan-add-grid"><select class="plan-sel" id="plan-pick-sub"><option value="">Subject…</option>${subjOptions}</select><select class="plan-sel" id="plan-pick-ch" disabled><option value="">Chapter…</option></select><select class="plan-sel" id="plan-pick-t" disabled><option value="">Topic (optional)…</option></select></div><div class="plan-add-actions"><button class="btn btn-block" data-act="add-plan-from-syllabus">${ic('plus')} Add from Syllabus</button></div><div class="plan-add-divider"><span>or custom task</span></div><div class="row" style="gap:7px;margin-top:4px"><input id="plan-new-task" placeholder="Custom task for today…" maxlength="120" style="flex:1;background:#0b1327;border:1px solid var(--border);color:var(--text);padding:10px 11px;border-radius:9px;font:inherit;font-size:14px"/><button class="btn" data-act="add-plan-task">${ic('plus')}</button></div></div>`;
  }

  // ========== Dashboard ==========
  function renderDashboard() {
    const view = document.getElementById('view-dashboard'); if (!view) return;
    const tasks = getActivePlanTasks(), doneCount = tasks.filter(t => t.done).length;
    view.innerHTML = `<div class="page-header"><h1>Dashboard</h1><div class="subtitle">Your study control center</div></div>${renderBurnoutBanner()}<div class="section-head"><h2>Today's Plan</h2><div style="display:flex;gap:8px;align-items:center"><span class="muted" style="font-size:13px">${doneCount}/${tasks.length} done</span><button class="btn-link" data-act="regen-plan">↻ Regen</button></div></div>${renderTasksList(tasks)}${renderPlanAdder()}<div class="section-head" style="margin-top:20px"><h2>Study Calendar</h2></div>${renderCalendar()}${renderGoals()}${renderSmartSuggestions()}${renderWeakAreas()}`;
    bindPlanPickers();
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
  function renderCalendar() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const today = todayKey();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = firstDay.getDay();
    const monthLabel = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell cal-empty"></div>`;
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateISO = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateISO === today;
      const isPast = dateISO < today;
      const plan = state.dailyPlans[dateISO];
      const customTasks = plan ? (plan.custom || []) : [];
      const total = customTasks.length;
      const done = customTasks.filter(t => t.done).length;
      let dotHtml = '';
      if (total > 0) {
        const allDone = done === total;
        dotHtml = `<span class="cal-dot${allDone ? ' cal-dot-done' : ''}"></span>`;
      }
      cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast && !isToday ? ' cal-past' : ''}" data-act="calendar-day" data-date="${dateISO}" role="button" aria-label="${dateISO}${total ? `, ${total} task${total>1?'s':''}` : ''}"><span class="cal-day-num">${d}</span>${dotHtml}</div>`;
    }
    return `<div class="cal-wrap"><div class="cal-nav"><button class="cal-nav-btn" data-act="cal-prev" aria-label="Previous month">‹</button><span class="cal-title">${monthLabel}</span><button class="cal-nav-btn" data-act="cal-next" aria-label="Next month">›</button></div><div class="cal-grid"><div class="cal-dow-row">${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div><div class="cal-cells">${cells}</div></div></div>`;
  }

  function modalCalendarDay(dateISO) {
    const today = todayKey();
    const label = dateISO === today ? 'Today — ' + formatDate(dateISO) : formatDate(dateISO);
    if (!state.dailyPlans[dateISO]) state.dailyPlans[dateISO] = { auto: [], removed: [], custom: [], generated: false };
    const plan = state.dailyPlans[dateISO];
    const tasks = plan.custom || [];
    const taskRows = tasks.length ? tasks.map((t, i) => `<div class="card card-row plan-task${t.done ? ' is-done' : ''}" style="margin-bottom:6px"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-cal-task" data-date="${dateISO}" data-i="${i}"/><div style="flex:1;min-width:0;font-size:14px;padding:0 8px;${t.done ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${escapeHTML(t.text)}</div><button class="menu-btn" data-act="del-cal-task" data-date="${dateISO}" data-i="${i}">${ic('trash')}</button></div>`).join('') : `<div class="empty" style="padding:10px 0">No tasks planned for this day.</div>`;
    openModal(`<h3>📅 ${escapeHTML(label)}</h3><div style="max-height:200px;overflow-y:auto;margin-bottom:10px">${taskRows}</div><div class="cal-add-row"><input id="cal-new-task" placeholder="Add a task for this day…" maxlength="120" autofocus/><button class="btn" data-act="add-cal-task" data-date="${dateISO}">${ic('plus')}</button></div><div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-close>Done</button>${dateISO === today ? `<button class="btn" data-act="regen-plan" data-close>↻ Regen Today</button>` : ''}</div>`,
      root => {
        const inp = root.querySelector('#cal-new-task');
        if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const btn = root.querySelector('[data-act="add-cal-task"]'); if (btn) btn.click(); } });
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
    return `<div class="card subject-card" data-sub-id="${sub.id}" style="position:relative"><div class="subject-head" data-act="toggle-subject" data-id="${sub.id}"><span class="color-dot" style="background:${sub.color}"></span><span class="subject-name">${escapeHTML(sub.name)}</span>${pp}<span class="muted">${done}/${tot}</span><button class="menu-btn" data-act="open-subject-menu" data-id="${sub.id}" style="z-index:2" onclick="event.stopPropagation()">${ic('dots')}</button><span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span></div><div class="progress" style="margin-bottom:${isOpen?'7px':'3px'}"><span style="width:${pct}%"></span></div>${sub.notes ? `<div class="notes">${escapeHTML(sub.notes)}</div>` : ''}${isOpen ? `<div class="chapter-list">${sub.chapters.map(ch => renderChapterCard(sub, ch)).join('')}<button class="btn btn-ghost btn-block" style="margin-top:4px" data-act="add-chapter" data-sub="${sub.id}">${ic('plus')} Add Chapter</button></div>` : ''}</div>`;
  }
  function renderChapterCard(sub, ch) {
    const isOpen = openChapters.has(ch.id), isDone = isChapterEffectivelyDone(ch), pct = chapterProgress(ch), today = todayKey();
    const pp = ch.priority ? `<span class="pill pill-${ch.priority === 'high' ? 'high' : ch.priority === 'medium' ? 'med' : 'low'}">${ch.priority}</span>` : '';
    return `<div class="chapter" data-ch-id="${ch.id}" style="position:relative"><div class="chapter-row"><input type="checkbox" class="check" ${isDone ? 'checked' : ''} data-act="toggle-chapter-done" data-sub="${sub.id}" data-ch="${ch.id}"/><div style="flex:1;min-width:0"><div class="row" style="cursor:pointer" data-act="toggle-chapter" data-id="${ch.id}"><span class="name ${isDone ? 'done' : ''}">${escapeHTML(ch.name)}</span><span class="chevron ${isOpen ? 'open' : ''}">${ic('chev')}</span></div><div class="badges">${pp}${ch.scheduledDate === today ? `<span class="pill pill-today">Today</span>` : ''}${pct > 0 && pct < 100 ? `<span class="muted">${pct}%</span>` : ''}</div>${ch.notes ? `<div class="notes">${escapeHTML(ch.notes)}</div>` : ''}</div><button class="menu-btn" data-act="open-chapter-menu" data-sub="${sub.id}" data-ch="${ch.id}" onclick="event.stopPropagation()">${ic('dots')}</button></div>${isOpen && ch.topics.length ? `<div class="topic-list">${ch.topics.map(t => renderTopicRow(sub, ch, t)).join('')}</div>` : ''}${isOpen ? `<div style="padding-left:26px;margin-top:6px"><button class="btn-link" data-act="add-topic" data-sub="${sub.id}" data-ch="${ch.id}">${ic('plus')} Add Topic</button></div>` : ''}</div>`;
  }
  function renderTopicRow(sub, ch, t) {
    const pp = t.priority ? `<span class="pill pill-${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'med' : 'low'}">${t.priority}</span>` : '';
    return `<div class="topic" style="position:relative"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-topic-done" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}"/><div style="flex:1;min-width:0"><div class="name ${t.done ? 'done' : ''}">${escapeHTML(t.name)}</div>${t.notes ? `<div class="notes">${escapeHTML(t.notes)}</div>` : ''}${pp || isWeakTopic(t) ? `<div style="display:flex;gap:4px;margin-top:3px">${pp}${isWeakTopic(t) ? `<span class="pill pill-weak">Weak</span>` : ''}</div>` : ''}</div><button class="menu-btn" data-act="open-topic-menu" data-sub="${sub.id}" data-ch="${ch.id}" data-t="${t.id}" onclick="event.stopPropagation()">${ic('dots')}</button></div>`;
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
    openModal(`<h3>${existing ? 'Edit Subject' : 'New Subject'}</h3><div class="field"><label>Name</label><input id="m-name" placeholder="e.g. Mathematics" value="${existing ? escapeHTML(existing.name) : ''}" maxlength="60"/></div><div class="field"><label>Color</label><input id="m-color" type="color" value="${existing ? existing.color : '#38bdf8'}" style="width:56px;height:38px;padding:3px;border-radius:8px;border:1px solid var(--border);background:#0b1327;cursor:pointer"/></div><div class="field"><label>Priority</label>${makePriorityRow(existing)}</div><div class="field"><label>Notes</label><textarea id="m-notes" placeholder="Optional notes…" maxlength="500">${existing ? escapeHTML(existing.notes || '') : ''}</textarea></div><div class="actions"><button class="btn btn-ghost" data-close>Cancel</button>${existing ? `<button class="btn btn-danger" id="m-del">Delete</button>` : ''}<button class="btn" id="m-save">${existing ? 'Save' : 'Add Subject'}</button></div>`,
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
    closeDropdown();
    const btn = document.querySelector(`[data-act="open-subject-menu"][data-id="${subId}"]`);
    if (!btn) return;
    const d = document.createElement('div'); d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-subject" data-id="${subId}">${ic('edit')} Edit Subject</button>
      <button data-act="open-subject-notes" data-id="${subId}">${ic('note')} Notes</button>
      <button data-act="open-subject-priority" data-id="${subId}">${ic('star')} Priority</button>
      <button data-act="add-chapter" data-sub="${subId}">${ic('plus')} Add Chapter</button>
      <button data-act="del-subject" data-id="${subId}" class="danger">${ic('trash')} Delete</button>`;
    const card = btn.closest('.card') || btn.closest('.subject-card') || document.body;
    card.appendChild(d); activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  }
  function showChapterMenu(subId, chId) {
    closeDropdown();
    const btn = document.querySelector(`[data-act="open-chapter-menu"][data-sub="${subId}"][data-ch="${chId}"]`);
    if (!btn) return;
    const d = document.createElement('div'); d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-chapter" data-sub="${subId}" data-ch="${chId}">${ic('edit')} Edit Chapter</button>
      <button data-act="open-chapter-notes" data-sub="${subId}" data-ch="${chId}">${ic('note')} Notes</button>
      <button data-act="open-chapter-priority" data-sub="${subId}" data-ch="${chId}">${ic('star')} Priority</button>
      <button data-act="add-topic" data-sub="${subId}" data-ch="${chId}">${ic('plus')} Add Topic</button>
      <button data-act="schedule-chapter" data-sub="${subId}" data-ch="${chId}">${ic('cal')} Schedule</button>
      <button data-act="del-chapter" data-sub="${subId}" data-ch="${chId}" class="danger">${ic('trash')} Delete</button>`;
    const parent = btn.closest('.chapter') || document.body;
    parent.appendChild(d); activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  }
  function showTopicMenu(subId, chId, tId) {
    closeDropdown();
    const btn = document.querySelector(`[data-act="open-topic-menu"][data-sub="${subId}"][data-ch="${chId}"][data-t="${tId}"]`);
    if (!btn) return;
    const d = document.createElement('div'); d.className = 'dropdown';
    d.innerHTML = `
      <button data-act="edit-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('edit')} Edit Topic</button>
      <button data-act="open-topic-notes" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('note')} Notes</button>
      <button data-act="open-topic-priority" data-sub="${subId}" data-ch="${chId}" data-t="${tId}">${ic('star')} Priority</button>
      <button data-act="del-topic" data-sub="${subId}" data-ch="${chId}" data-t="${tId}" class="danger">${ic('trash')} Delete</button>`;
    const parent = btn.closest('.topic') || document.body;
    parent.appendChild(d); activeDropdown = d;
    setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
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
    const total = customDurations[focusMode] * 60;
    const r = 96, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const isBreak = focusMode !== 'work';
    const tasks = getActivePlanTasks().filter(t => !t.done);
    const taskOptions = tasks.map(t => `<option value="${t.key}" ${focusCurrentTaskKey === t.key ? 'selected' : ''}>${escapeHTML(t.text)}</option>`).join('');
    const currentTask = focusCurrentTaskKey ? tasks.find(t => t.key === focusCurrentTaskKey) : null;
    const ambientOpts = ['none', 'rain', 'soft'];
    const ambientLabels = { none: '🔇 Off', rain: '🌧 Rain', soft: '🎵 Soft' };
    return `<div class="focus-view">
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
      <div class="focus-ring-wrap">
        <svg class="focus-ring-svg" viewBox="0 0 220 220" aria-hidden="true">
          <circle class="focus-ring-track" cx="110" cy="110" r="${r}"/>
          <circle class="focus-ring-fill ${isBreak ? 'break-mode' : ''}" id="focus-ring-circle" cx="110" cy="110" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
        </svg>
        <div class="focus-ring-center">
          <div class="focus-ring-time" id="focus-time-display">${formatFocusTime(focusSeconds)}</div>
          <div class="focus-ring-mode">${focusMode === 'work' ? 'Focus Time' : focusMode === 'short' ? 'Short Break' : 'Long Break'}</div>
        </div>
      </div>
      <div class="focus-buttons">
        <button class="btn btn-ghost" data-act="focus-reset">Reset</button>
        <button class="btn" style="min-width:110px" data-act="focus-toggle">${focusRunning ? '⏸ Pause' : '▶ Start'}</button>
        <button class="focus-lock-btn ${focusLocked ? 'locked' : ''}" data-act="focus-lock">${focusLocked ? ic('lock') : ic('unlock')} ${focusLocked ? 'Locked' : 'Lock'}</button>
      </div>
      <div class="ambient-bar">
        ${ambientOpts.map(m => `<button class="ambient-btn ${ambientMode === m ? 'active' : ''}" data-act="ambient-select" data-amode="${m}">${ambientLabels[m]}</button>`).join('')}
        <div class="ambient-vol" style="${ambientMode !== 'none' ? '' : 'display:none'}">
          <span style="font-size:11px;color:var(--text-muted)">Vol</span>
          <input id="ambient-vol-slider" type="range" min="0" max="1" step="0.05" value="${ambientVolume}"/>
        </div>
      </div>
      <div class="focus-task-bar">
        <label>Current Task</label>
        ${currentTask ? `<div class="focus-current-task"><span class="dot"></span>${escapeHTML(currentTask.text)}<button class="btn-link" data-act="focus-task-clear" style="margin-left:auto;font-size:12px">Clear</button></div>` :
          tasks.length ? `<select data-act="focus-task-select"><option value="">— Pick a task —</option>${taskOptions}</select>` :
          `<div style="color:var(--text-muted);font-size:13px">No tasks for today yet.</div>`}
      </div>
      <div class="focus-sessions-info">
        <div class="grid">
          <div><div class="v">${focusSessions}</div><div class="k">Sessions today</div></div>
          <div><div class="v">${state.focusStats.minutesByDate[todayKey()] || 0}m</div><div class="k">Minutes focused</div></div>
        </div>
      </div>
      <button class="btn fs-enter-btn" data-act="enter-full-session">🚀 Enter Full Focus Mode</button>
    </div>`;
  }

  function formatFocusTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

  function updateFocusDisplay() {
    const el = document.getElementById('focus-time-display'); if (el) el.textContent = formatFocusTime(focusSeconds);
    const total = customDurations[focusMode] * 60;
    const r = 96, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const ring = document.getElementById('focus-ring-circle'); if (ring) ring.style.strokeDashoffset = off.toFixed(2);
    const m = Math.floor(focusSeconds / 60), s = focusSeconds % 60;
    document.title = focusRunning ? `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} — Focus` : 'Syllabus Tracker';
  }

  function focusTick() {
    if (focusSeconds > 0) { focusSeconds--; updateFocusDisplay(); return; }
    clearInterval(focusTimer); focusTimer = null; focusRunning = false;
    document.title = 'Syllabus Tracker';
    if (focusMode === 'work') {
      focusSessions++;
      const todayStr = todayKey();
      state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
      state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + customDurations.work;
      bumpActivity(); saveState();
      const task = focusCurrentTaskKey ? getActivePlanTasks().find(t => t.key === focusCurrentTaskKey) : null;
      if (task && !task.done) {
        confirmModal(`Session complete! Mark "${task.text}" as done?`, () => {
          if (task.type === 'auto') { const t = findTopic(task.subId, task.chId, task.tId); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(task.subId, task.chId, task.tId, true); saveState(); renderAll(); } }
          else { const plan = state.dailyPlans[todayKey()]; if (plan) { const ct = plan.custom.find(c => c.id === task.id); if (ct) { ct.done = true; bumpActivity(); saveState(); renderAll(); } } }
        }, { title: 'Session done!', yesLabel: 'Mark done', yesClass: 'btn' });
      } else {
        toast(`Session ${focusSessions} complete! 🎉`, 'success', 4000);
      }
    }
    focusMode = focusMode === 'work' ? (focusSessions % 4 === 0 ? 'long' : 'short') : 'work';
    focusSeconds = customDurations[focusMode] * 60;
    if (fsSessionActive) renderFullSession(); else renderFocus();
  }

  // ========== Full Screen Session ==========
  function enterFullSession() {
    fsSessionActive = true;
    let overlay = document.getElementById('fs-overlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'fs-overlay'; document.body.appendChild(overlay); }
    renderFullSession();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  function exitFullSession() {
    fsSessionActive = false;
    const overlay = document.getElementById('fs-overlay'); if (overlay) overlay.remove();
    document.title = 'Syllabus Tracker';
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    renderFocus();
  }
  function renderFullSession() {
    const overlay = document.getElementById('fs-overlay'); if (!overlay) return;
    const total = customDurations[focusMode] * 60;
    const r = 120, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const isBreak = focusMode !== 'work';
    const tasks = getActivePlanTasks().filter(t => !t.done);
    const currentTask = focusCurrentTaskKey ? tasks.find(t => t.key === focusCurrentTaskKey) : null;
    const taskOpts = tasks.map(t => `<option value="${t.key}" ${focusCurrentTaskKey === t.key ? 'selected':''}>${escapeHTML(t.text)}</option>`).join('');
    const ambientLabels = { none: '🔇', rain: '🌧', soft: '🎵' };
    const sessionDots = Array.from({length: Math.min(focusSessions, 8)}, () => `<span class="fs-dot"></span>`).join('');
    overlay.innerHTML = `<div class="fs-bg"></div>
      <div class="fs-content">
        <div class="fs-top">
          <div class="fs-mode-badge ${isBreak ? 'fs-mode-break' : ''}">${focusMode === 'work' ? '🎯 Focus Time' : focusMode === 'short' ? '☕ Short Break' : '🛌 Long Break'}</div>
          ${focusSessions > 0 ? `<div class="fs-session-dots">${sessionDots}<span class="fs-sessions-label">${focusSessions} session${focusSessions !== 1 ? 's' : ''}</span></div>` : ''}
        </div>
        <div class="fs-timer-wrap">
          <svg class="fs-ring-svg" viewBox="0 0 290 290" aria-hidden="true">
            <defs><linearGradient id="fsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${isBreak ? '#34d399' : '#38bdf8'}"/><stop offset="100%" stop-color="${isBreak ? '#86efac' : '#a78bfa'}"/></linearGradient></defs>
            <circle class="fs-ring-track" cx="145" cy="145" r="${r}"/>
            <circle class="fs-ring-fill" id="fs-ring-circle" cx="145" cy="145" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>
          </svg>
          <div class="fs-ring-center">
            <div class="fs-time" id="fs-time-display">${formatFocusTime(focusSeconds)}</div>
            <div class="fs-ring-sub">${formatFocusTime(customDurations[focusMode] * 60)} total</div>
          </div>
        </div>
        <div class="fs-task-box">
          <div class="fs-task-label">Current Task</div>
          ${currentTask ? `<div class="fs-task-name">${escapeHTML(currentTask.text)}</div>${currentTask.meta ? `<div class="fs-task-meta">${escapeHTML(currentTask.meta)}</div>` : ''}` : (tasks.length ? `<select class="fs-task-select" data-act="focus-task-select"><option value="">— Pick a task —</option>${taskOpts}</select>` : `<div class="fs-task-empty">No tasks today</div>`)}
        </div>
        <div class="fs-controls">
          <button class="fs-ctrl-btn fs-side-btn" data-act="fs-cycle-ambient" title="Toggle sound">${ambientLabels[ambientMode] || '🔇'}</button>
          <button class="fs-ctrl-btn fs-main-btn" data-act="fs-toggle">${focusRunning ? '⏸' : '▶'}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-exit-btn" data-act="exit-full-session" title="Exit full screen">✕</button>
        </div>
        <div class="fs-hint">Press Esc to exit · ${ambientMode !== 'none' ? '🎵 Sound on' : '🔇 Sound off'}</div>
      </div>`;
  }

  // ========== Classroom ==========
  function renderClassroom() {
    const groups = (state.classroom && state.classroom.groups) || [];
    return `<div class="classroom-view"><div class="section-head"><h2>Classroom</h2><button class="btn" data-act="add-classroom-group">${ic('plus')} New Group</button></div>${!groups.length ? `<div class="classroom-empty"><div style="font-size:32px;margin-bottom:8px">🎓</div><div>Save YouTube videos and playlists for quick access during study sessions.</div><button class="btn" style="margin-top:12px" data-act="add-classroom-group">${ic('plus')} Create a group</button></div>` : groups.map(g => renderClassroomGroup(g)).join('')}</div>`;
  }
  function renderClassroomGroup(group) {
    return `<div class="classroom-group"><div class="classroom-group-head"><span class="classroom-group-icon">📂</span><h3>${escapeHTML(group.name)}</h3><button class="menu-btn" data-act="add-classroom-item" data-gid="${group.id}" title="Add video">${ic('plus')}</button><button class="menu-btn" data-act="del-classroom-group" data-gid="${group.id}" title="Delete group">${ic('trash')}</button></div>${!group.items.length ? `<div class="muted" style="font-size:13px;padding:8px 0">No videos yet. Click + to add one.</div>` : `<div class="video-grid">${group.items.map(item => renderVideoCard(group.id, item)).join('')}</div>`}</div>`;
  }
  function renderVideoCard(groupId, item) {
    const thumb = item.videoId ? ytThumb(item.videoId) : null;
    return `<div class="video-card" data-act="play-video" data-gid="${groupId}" data-iid="${item.id}">
      <button class="video-del-btn" data-act="del-classroom-item" data-gid="${groupId}" data-iid="${item.id}" onclick="event.stopPropagation()" title="Remove">×</button>
      <button class="video-edit-btn" data-act="edit-classroom-item" data-gid="${groupId}" data-iid="${item.id}" onclick="event.stopPropagation()" title="Edit">✏️</button>
      ${thumb ? `<img class="video-thumb" src="${thumb}" alt="${escapeHTML(item.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="video-thumb-placeholder" style="display:none">${item.type === 'playlist' ? '📋' : '▶️'}</div>` : `<div class="video-thumb-placeholder">${item.type === 'playlist' ? '📋' : '▶️'}</div>`}
      <div class="video-info">
        <div class="video-title">${escapeHTML(item.title)}</div>
        ${item.description ? `<div class="video-desc">${escapeHTML(item.description)}</div>` : ''}
        <div class="video-type">${item.type === 'playlist' ? '📋 Playlist' : '🎬 Video'}</div>
      </div>
    </div>`;
  }
  function modalEditClassroomItem(groupId, itemId) {
    const group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
    const item = group.items.find(i => i.id === itemId); if (!item) return;
    openModal(`<h3>✏️ Edit Video / Playlist</h3>
      <div class="field"><label>Title</label><input id="m-title" value="${escapeHTML(item.title)}" maxlength="120" placeholder="Custom title"/></div>
      <div class="field"><label>YouTube URL</label><input id="m-url" type="url" value="${escapeHTML(item.url)}" placeholder="https://youtube.com/watch?v=..."/></div>
      <div class="field"><label>Description / Notes (optional)</label><textarea id="m-desc" maxlength="300" placeholder="Add notes, timestamps, what to focus on…">${escapeHTML(item.description || '')}</textarea></div>
      <div class="field"><label>Preview</label>${item.videoId ? `<img src="${ytThumb(item.videoId)}" style="width:100%;border-radius:8px;margin-top:4px" alt="thumb"/>` : '<span style="color:var(--text-muted);font-size:13px">No preview (playlist or no video ID)</span>'}</div>
      <div class="actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn" id="m-save">Save Changes</button></div>`,
      root => {
        root.querySelector('#m-save').onclick = () => {
          const title = root.querySelector('#m-title').value.trim();
          const url = root.querySelector('#m-url').value.trim();
          if (!title) { toast('Title required', 'warn'); return; }
          if (!url) { toast('URL required', 'warn'); return; }
          const { videoId, playlistId } = parseYouTubeUrl(url);
          item.title = title; item.url = url;
          item.videoId = videoId || null; item.playlistId = playlistId || null;
          item.type = (playlistId && !videoId) ? 'playlist' : 'video';
          item.description = root.querySelector('#m-desc').value.trim();
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
    openModal(`<h3>Add Video / Playlist</h3>
      <div class="add-video-form">
        <div class="field">
          <label>YouTube URL</label>
          <input id="m-url" type="url" placeholder="https://youtube.com/watch?v=... or youtu.be/..."/>
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

        urlInput.addEventListener('input', () => {
          clearTimeout(fetchTimeout);
          fetchTimeout = setTimeout(async () => {
            const url = urlInput.value.trim();
            if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) return;
            statusEl.textContent = '⏳ Fetching title…';
            const title = await fetchYouTubeTitle(url);
            if (title && !titleInput.value.trim()) {
              titleInput.value = title;
              statusEl.textContent = '✅ Auto-fetched';
            } else if (!title) {
              statusEl.textContent = '⚠️ Could not fetch — enter manually';
            } else {
              statusEl.textContent = '';
            }
          }, 600);
        });

        root.querySelector('#m-save').onclick = () => {
          const url = urlInput.value.trim();
          if (!url) { toast('Enter a YouTube URL', 'warn'); return; }
          const { videoId, playlistId } = parseYouTubeUrl(url);
          if (!videoId && !playlistId) { toast('Could not find a YouTube video or playlist ID in that URL', 'danger'); return; }
          const type = (playlistId && !videoId) ? 'playlist' : 'video';
          const titleVal = titleInput.value.trim();
          const title = titleVal || (type === 'playlist' ? 'Playlist' : 'Video');
          const description = root.querySelector('#m-desc').value.trim();
          group.items.push({ id: uid(), title, url, videoId: videoId || null, playlistId: playlistId || null, type, addedAt: todayKey(), description });
          saveState(); closeModal(); renderFocus(); toast('Added to classroom', 'success');
        };
      });
  }
  function modalPlayVideo(groupId, itemId) {
    const group = (state.classroom.groups || []).find(g => g.id === groupId); if (!group) return;
    const item = group.items.find(i => i.id === itemId); if (!item) return;
    const embedUrl = ytEmbedUrl(item);
    if (!embedUrl) { window.open(item.url, '_blank', 'noopener'); return; }
    openModal(`<h3>${escapeHTML(item.title)}</h3>${item.description ? `<div style="color:var(--text-muted);font-size:13px;margin:-8px 0 10px;font-style:italic">${escapeHTML(item.description)}</div>` : ''}<div class="yt-embed-wrap"><iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="${escapeHTML(item.title)}"></iframe></div><div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-close>Close</button><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener" class="btn">Open in YouTube</a></div>`);
  }

  // ========== Revision ==========
  function renderRevision() {
    const view = document.getElementById('view-revision'); if (!view) return;
    const dueItems = dueRevisionItems(), upcoming = upcomingRevisionItems(8);
    view.innerHTML = `<div class="page-header"><h1>Revision</h1><div class="subtitle">Spaced repetition schedule</div></div><div class="section-head"><h2>Due Today${dueItems.length ? ` (${dueItems.length})` : ''}</h2></div>${!dueItems.length ? `<div class="empty">No revisions due — great work!</div>` : `<div class="list">${dueItems.map(item => `<div class="card card-row revision-item is-overdue"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px">${item.daysOverdue > 0 ? `<span class="pill pill-overdue">${item.daysOverdue}d overdue</span>` : `<span class="pill pill-today">Due today</span>`}</div></div><div style="display:flex;gap:6px"><button class="btn btn-sm" data-act="rev-done" data-rev="${item.revisionId}" data-off="${item.step.offset}">${ic('check')}</button><button class="menu-btn" data-act="rev-dismiss" data-rev="${item.revisionId}">${ic('trash')}</button></div></div>`).join('')}</div>`}<div class="section-head"><h2>Upcoming</h2></div>${!upcoming.length ? `<div class="empty">No upcoming revisions scheduled.</div>` : `<div class="list">${upcoming.map(item => `<div class="card card-row revision-item upcoming"><span class="color-dot" style="background:${item.sub ? item.sub.color : 'var(--primary)'}"></span><div style="flex:1;min-width:0"><div class="title">${escapeHTML(item.topic ? item.topic.name : '?')}</div><div class="meta">${escapeHTML(item.sub ? item.sub.name : '')} · ${escapeHTML(item.ch ? item.ch.name : '')}</div><div style="margin-top:4px"><span class="pill pill-upcoming">In ${item.daysUntil}d · ${formatDate(item.step.dueDate)}</span></div></div></div>`).join('')}</div>`}`;
  }

  // ========== Stats (Enhanced A-Z Analysis) ==========
  function renderStats() {
    const view = document.getElementById('view-stats'); if (!view) return;
    const overall = overallProgress();
    let totalTopics = 0, doneTopics = 0, totalChapters = 0, doneChapters = 0, totalWeak = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) {
      totalChapters++; if (isChapterEffectivelyDone(ch)) doneChapters++;
      for (const t of ch.topics) { totalTopics++; if (t.done) doneTopics++; if (isWeakTopic(t)) totalWeak++; }
    }

    // Activity: 14-day bars
    const today = new Date(todayKey() + 'T00:00:00'); const days14 = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); days14.push({ k, count: state.activity[k] || 0, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) }); }
    const maxAct = Math.max(1, ...days14.map(d => d.count));

    // Focus stats
    const todayStr = todayKey();
    const totalFocusSessions = Object.values(state.focusStats.sessions || {}).reduce((a, b) => a + b, 0);
    const totalFocusMin = Object.values(state.focusStats.minutesByDate || {}).reduce((a, b) => a + b, 0);
    const todaySessions = state.focusStats.sessions[todayStr] || 0;
    const todayFocusMin = state.focusStats.minutesByDate[todayStr] || 0;

    // Streak stats
    const bestStreak = state.streak.best || state.streak.count || 0;
    const activeDays30 = (() => { let c = 0; for (let i = 0; i < 30; i++) { const d = new Date(today); d.setDate(d.getDate() - i); if ((state.activity[d.toISOString().slice(0,10)] || 0) > 0) c++; } return c; })();

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

    // Most studied subjects chart
    const mostStudiedHtml = subjectRankings.length ? `
      <h2 style="margin:16px 0 10px">Most Studied Subjects</h2>
      <div class="card" style="padding:13px 14px">
        ${subjectRankings.map((sr, i) => {
          const pct = sr.topTot ? Math.round((sr.topDn / sr.topTot) * 100) : 0;
          return `<div style="margin-bottom:${i < subjectRankings.length - 1 ? '12px' : '0'}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:13px;font-weight:700;flex:1">${i+1}. ${escapeHTML(sr.sub.name)}</span>
              <span style="font-size:12px;color:var(--text-muted)">${sr.topDn}/${sr.topTot} done</span>
              <span style="font-size:13px;font-weight:800;color:${sr.sub.color}">${pct}%</span>
            </div>
            <div class="progress"><span style="width:${pct}%;background:${sr.sub.color}"></span></div>
          </div>`;
        }).join('')}
      </div>` : '';

    // A-Z Syllabus Progress
    const syllabusProgressHtml = `
      <h2 style="margin:16px 0 10px">A–Z Syllabus Progress</h2>
      <div class="card" style="padding:13px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:14px;font-weight:700">Overall Completion</span>
          <span style="font-size:22px;font-weight:900;color:var(--primary)">${overall}%</span>
        </div>
        <div class="progress" style="height:10px;margin-bottom:10px"><span style="width:${overall}%"></span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
          <div><div style="font-size:18px;font-weight:800">${doneTopics}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Topics Done</div></div>
          <div><div style="font-size:18px;font-weight:800">${totalTopics - doneTopics}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Remaining</div></div>
          <div><div style="font-size:18px;font-weight:800">${doneChapters}/${totalChapters}</div><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">Chapters</div></div>
        </div>
      </div>`;

    view.innerHTML = `
      <div class="page-header"><h1>Stats</h1><div class="subtitle">A–Z study analysis</div></div>

      <div class="stats-row">
        <div class="stat-tile"><div class="v">${overall}%</div><div class="k">Overall</div></div>
        <div class="stat-tile"><div class="v">${state.streak.count} 🔥</div><div class="k">Streak</div></div>
        <div class="stat-tile"><div class="v">${bestStreak}</div><div class="k">Best Streak</div></div>
        <div class="stat-tile"><div class="v">${activeDays30}</div><div class="k">Active / 30d</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${doneTopics}/${totalTopics}</div><div class="k">Topics</div></div>
        <div class="stat-tile"><div class="v">${doneChapters}/${totalChapters}</div><div class="k">Chapters</div></div>
        <div class="stat-tile" style="${totalWeak > 0 ? 'border-color:#f59e0b33' : ''}"><div class="v" style="${totalWeak > 0 ? 'color:#f59e0b' : ''}">${totalWeak}</div><div class="k">Weak Topics</div></div>
        <div class="stat-tile" style="${totalRevPending > 0 ? 'border-color:#f4736433' : ''}"><div class="v" style="${totalRevPending > 0 ? 'color:#f47364' : ''}">${totalRevPending}</div><div class="k">Rev. Due</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${todaySessions}</div><div class="k">Sessions Today</div></div>
        <div class="stat-tile"><div class="v">${todayFocusMin}m</div><div class="k">Focus Today</div></div>
        <div class="stat-tile"><div class="v">${totalFocusSessions}</div><div class="k">Total Sessions</div></div>
        <div class="stat-tile"><div class="v">${totalFocusMin >= 60 ? Math.round(totalFocusMin/60) + 'h' : totalFocusMin + 'm'}</div><div class="k">Total Focus</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${totalRevDone}</div><div class="k">Revisions Done</div></div>
        <div class="stat-tile"><div class="v">${state.revisions.length}</div><div class="k">Tracked Topics</div></div>
        <div class="stat-tile"><div class="v">${(state.goals||[]).filter(g=>g.completedAt).length}/${(state.goals||[]).length}</div><div class="k">Goals Done</div></div>
        <div class="stat-tile"><div class="v">${state.exams.length}</div><div class="k">Exams</div></div>
      </div>

      ${syllabusProgressHtml}

      ${mostStudiedHtml}

      <h2 style="margin:16px 0 8px">Activity (14 days)</h2>
      <div class="card" style="padding:13px 14px">
        <div class="bars">${days14.map(d => `<div class="bar" style="height:${Math.max(8, Math.round((d.count/maxAct)*100))}%;opacity:${d.count?'0.9':'0.2'}" title="${d.k}: ${d.count} actions"></div>`).join('')}</div>
        <div class="lbls">${days14.map(d => `<div class="lbl">${d.label}</div>`).join('')}</div>
      </div>

      <h2 style="margin:16px 0 10px">By Subject</h2>
      ${subjectCards}`;
  }

  // ========== Settings Modal ==========
  function modalSettings() {
    const sr = state.smartReminder, mr = state.motivationReminders, perm = notifPermission();
    let permCls = 'warn', permText = 'Permission not yet requested.';
    if (perm === 'unsupported') { permCls = 'warn'; permText = 'Notifications not supported on this browser.'; }
    else if (perm === 'granted')  { permCls = 'ok';   permText = 'Notifications are allowed.'; }
    else if (perm === 'denied')   { permCls = 'err';  permText = 'Notifications are blocked. Enable in browser settings.'; }
    const chips = (which, list) => list.map((t, i) => `<span class="time-chip"><button type="button" class="time-chip-edit" data-act="open-time-picker" data-which="${which}" data-i="${i}">${escapeHTML(formatTime12(t))}</button><button type="button" class="time-chip-del" data-act="del-time-slot" data-which="${which}" data-i="${i}">×</button></span>`).join('');
    openModal(`<h3>Settings</h3>
      <div class="settings-section"><h4>Daily Study Reminder</h4><div class="settings-row"><div class="label">Notify when tasks aren't done<div class="sub">Multiple reminder times supported.</div></div><label class="switch"><input type="checkbox" id="set-sr-toggle" ${sr.enabled ? 'checked' : ''} data-act="toggle-smart-reminder"/><span class="slider"></span></label></div><div class="time-chip-row" style="${sr.enabled ? '' : 'opacity:.55;pointer-events:none'}">${sr.times.length ? chips('reminder', sr.times) : '<span class="muted">No times set.</span>'}<button type="button" class="time-chip add" data-act="open-time-picker" data-which="reminder" data-i="-1">+ Add</button></div></div>
      <div class="settings-section"><h4>Motivation Notifications</h4><div class="settings-row"><div class="label">Motivational push messages<div class="sub">Random quote at each scheduled time.</div></div><label class="switch"><input type="checkbox" id="set-mr-toggle" ${mr.enabled ? 'checked' : ''} data-act="toggle-motivation"/><span class="slider"></span></label></div><div class="time-chip-row" style="${mr.enabled ? '' : 'opacity:.55;pointer-events:none'}">${mr.times.length ? chips('motivation', mr.times) : '<span class="muted">No times set.</span>'}<button type="button" class="time-chip add" data-act="open-time-picker" data-which="motivation" data-i="-1">+ Add</button></div></div>
      <div class="settings-section"><h4>Notifications Status</h4><div class="notif-status ${permCls}">${escapeHTML(permText)}</div>${(perm === 'default' || perm === 'denied') ? `<div style="margin-top:9px"><button class="btn btn-block" data-act="sr-request-perm">${perm === 'denied' ? 'Try requesting again' : 'Allow notifications'}</button></div>` : ''}</div>
      <div class="settings-section"><h4>Motivation Quotes</h4><div class="quote-list">${state.motivationQuotes.map((q, i) => `<div class="quote-row"><div class="text">${escapeHTML(q)}</div><button class="menu-btn" data-act="del-quote" data-i="${i}">${ic('trash')}</button></div>`).join('')}</div><div class="quote-add-row"><input id="set-new-quote" placeholder="Add a motivation quote…" maxlength="200"/><button class="btn" data-act="add-quote">${ic('plus')}</button></div></div>
      <div class="settings-section"><h4>Data</h4><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" data-act="export-data">${ic('download')} Export Backup</button><label class="btn btn-ghost" style="cursor:pointer">${ic('upload')} Import Backup<input type="file" accept=".json" style="display:none" id="import-file-input"/></label></div></div>
      <div class="actions" style="margin-top:16px"><button class="btn btn-ghost" data-close>Close</button></div>`,
      root => { root.querySelector('#import-file-input').onchange = e => { importData(e.target.files[0]); closeModal(); }; });
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
        root.querySelector('#tp-save').addEventListener('click',()=>{const v=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;if(isAdd){if(!target.times.includes(v))target.times.push(v);}else target.times[index]=v;target.times.sort();target.times=[...new Set(target.times)];saveState();closeModal();modalSettings();toast(`${titlePrefix} time ${isAdd?'added':'updated'}`, 'success');});
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
    if (act === 'open-settings') { modalSettings(); return; }

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

    // Plan
    if (act === 'regen-plan') { const k = todayKey(); if (state.dailyPlans[k]) { state.dailyPlans[k].generated = false; state.dailyPlans[k].auto = []; } saveState(); renderHome(); renderDashboard(); toast('Plan regenerated', 'info'); return; }
    if (act === 'toggle-plan-task') {
      const type = el.dataset.type;
      if (type === 'auto') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { const wasDone = t.done; t.done = !t.done; if (t.done) { bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); _justPoppedKey = `auto:${el.dataset.sub}:${el.dataset.ch}:${el.dataset.t}`; } else onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, false); const tasks = getActivePlanTasks(); if (tasks.length > 0 && tasks.every(x => x.done) && !wasDone) _justCompletedDay = todayKey(); saveState(); renderHome(); renderSyllabus(); renderRevision(); } }
      else { const plan = state.dailyPlans[todayKey()]; if (plan) { const ct = plan.custom.find(c => c.id === el.dataset.id); if (ct) { ct.done = !ct.done; if (ct.done) bumpActivity(); saveState(); renderHome(); renderDashboard(); } } }
      return;
    }
    if (act === 'remove-plan-task') { const type = el.dataset.type, plan = state.dailyPlans[todayKey()]; if (!plan) return; if (type === 'auto') { const key = autoKey(el.dataset.sub, el.dataset.ch, el.dataset.t); const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.skipCount = (t.skipCount || 0) + 1; t.lastSkippedAt = todayKey(); } if (!plan.removed.includes(key)) plan.removed.push(key); } else plan.custom = plan.custom.filter(c => c.id !== el.dataset.id); saveState(); renderHome(); renderDashboard(); return; }
    if (act === 'add-plan-task') { const input = document.getElementById('plan-new-task'), text = input ? input.value.trim() : ''; if (!text) { toast('Enter a task first', 'warn'); return; } ensureTodayPlan().custom.push({ id: uid(), text, done: false }); if (input) input.value = ''; saveState(); renderHome(); renderDashboard(); return; }
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
        saveState(); renderHome(); renderDashboard();
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
      saveState(); renderHome(); renderDashboard();
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
      else { if (confirm('Stop current timer and switch mode?')) { clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusMode = newMode; focusSeconds = customDurations[newMode] * 60; renderFocus(); document.title = 'Syllabus Tracker'; } }
      return;
    }
    if (act === 'focus-toggle') {
      if (focusRunning) {
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
      } else {
        focusRunning = true;
        focusTimer = setInterval(focusTick, 1000);
        // Resume ambient sound on Start (user gesture = autoplay allowed)
        resumeAmbientIfNeeded();
      }
      renderFocus(); return;
    }
    if (act === 'focus-reset') { clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusSeconds = customDurations[focusMode] * 60; renderFocus(); document.title = 'Syllabus Tracker'; return; }
    if (act === 'focus-lock') { focusLocked = !focusLocked; renderFocus(); toast(focusLocked ? '🔒 Lock Mode on — other tabs are restricted' : '🔓 Lock Mode off', focusLocked ? 'warn' : 'info'); return; }
    if (act === 'focus-task-clear') { focusCurrentTaskKey = null; renderFocus(); return; }

    // Ambient sound
    if (act === 'ambient-select') { ambientMode = el.dataset.amode; startAmbient(ambientMode); renderFocus(); return; }

    // Full Screen Session
    if (act === 'enter-full-session') { enterFullSession(); return; }
    if (act === 'exit-full-session') { exitFullSession(); stopAmbient(); ambientMode = 'none'; return; }
    if (act === 'fs-toggle') {
      if (focusRunning) { clearInterval(focusTimer); focusTimer = null; focusRunning = false; }
      else {
        focusRunning = true; focusTimer = setInterval(focusTick, 1000);
        resumeAmbientIfNeeded();
      }
      renderFullSession(); return;
    }
    if (act === 'fs-cycle-ambient') {
      const modes = ['none', 'rain', 'soft'];
      ambientMode = modes[(modes.indexOf(ambientMode) + 1) % modes.length];
      startAmbient(ambientMode); renderFullSession(); return;
    }

    // Classroom
    if (act === 'add-classroom-group') { modalAddClassroomGroup(); return; }
    if (act === 'add-classroom-item') { modalAddClassroomItem(el.dataset.gid); return; }
    if (act === 'del-classroom-group') { const gid = el.dataset.gid; confirmModal('Delete this group and all its videos?', () => { state.classroom.groups = state.classroom.groups.filter(g => g.id !== gid); saveState(); renderFocus(); toast('Group deleted', 'danger'); }); return; }
    if (act === 'del-classroom-item') { e.stopPropagation(); const group = (state.classroom.groups || []).find(g => g.id === el.dataset.gid); if (group) { group.items = group.items.filter(i => i.id !== el.dataset.iid); saveState(); renderFocus(); toast('Video removed', 'info'); } return; }
    if (act === 'play-video') { modalPlayVideo(el.dataset.gid, el.dataset.iid); return; }
    if (act === 'edit-classroom-item') { modalEditClassroomItem(el.dataset.gid, el.dataset.iid); return; }

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
      saveState(); modalCalendarDay(date); renderDashboard(); renderHome();
      return;
    }
    if (act === 'toggle-cal-task') {
      const date = el.dataset.date, i = parseInt(el.dataset.i, 10);
      const plan = state.dailyPlans[date];
      if (plan && plan.custom[i]) { plan.custom[i].done = !plan.custom[i].done; saveState(); modalCalendarDay(date); renderDashboard(); renderHome(); }
      return;
    }
    if (act === 'del-cal-task') {
      const date = el.dataset.date, i = parseInt(el.dataset.i, 10);
      const plan = state.dailyPlans[date];
      if (plan) { plan.custom.splice(i, 1); saveState(); modalCalendarDay(date); renderDashboard(); }
      return;
    }

    // Revision
    if (act === 'rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderRevision(); renderDashboard(); toast('Revision marked done', 'success'); return; }
    if (act === 'rev-dismiss') { dismissRevisionEntry(el.dataset.rev); renderRevision(); return; }

    // Smart suggestions
    if (act === 'suggest-rev-done') { completeRevisionStep(el.dataset.rev, parseInt(el.dataset.off, 10)); renderDashboard(); renderRevision(); toast('Marked done', 'success'); return; }
    if (act === 'suggest-topic-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
    if (act === 'suggest-open') { openSubjects.add(el.dataset.sub); openChapters.add(el.dataset.ch); switchTab('syllabus'); renderSyllabus(); return; }

    // Weak areas
    if (act === 'weak-mark-done') { const t = findTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(el.dataset.sub, el.dataset.ch, el.dataset.t, true); saveState(); renderAll(); toast('Marked done', 'success'); } return; }
    if (act === 'weak-reset') { resetWeakTopic(el.dataset.sub, el.dataset.ch, el.dataset.t); saveState(); renderDashboard(); toast('Reset weak flag', 'info'); return; }

    // Settings actions
    if (act === 'toggle-smart-reminder') { state.smartReminder.enabled = el.checked; saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'toggle-motivation') { state.motivationReminders.enabled = el.checked; saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'open-time-picker') { modalSetReminderTime(el.dataset.which, parseInt(el.dataset.i, 10)); return; }
    if (act === 'del-time-slot') { const target = el.dataset.which === 'motivation' ? state.motivationReminders : state.smartReminder; target.times.splice(parseInt(el.dataset.i, 10), 1); saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'sr-request-perm') { requestNotifPermission().then(() => refreshSettingsIfOpen()); return; }
    if (act === 'del-quote') { state.motivationQuotes.splice(parseInt(el.dataset.i, 10), 1); saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'add-quote') { const input = document.getElementById('set-new-quote'), text = input ? input.value.trim() : ''; if (!text) { toast('Enter a quote first', 'warn'); return; } state.motivationQuotes.push(text); saveState(); refreshSettingsIfOpen(); return; }
    if (act === 'export-data') { closeModal(); exportData(); return; }
  });

  // Focus duration change (input)
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'focus-task-select') { focusCurrentTaskKey = el.value || null; if (fsSessionActive) renderFullSession(); else renderFocus(); return; }
    if (el.id === 'ambient-vol-slider') { setAmbientVolume(parseFloat(el.value)); return; }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'ambient-vol-slider') { setAmbientVolume(parseFloat(el.value)); return; }
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
      if (fsSessionActive) { exitFullSession(); stopAmbient(); ambientMode = 'none'; }
      else closeModal();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && fsSessionActive) { exitFullSession(); }
  });

  window.addEventListener('beforeunload', e => { if (focusRunning && focusLocked) { e.preventDefault(); e.returnValue = 'Focus timer is running. Leave?'; } });

  // Mobile keyboard adjustment
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const kbH = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--kb-h', kbH + 'px');
      document.body.classList.toggle('kb-open', kbH > 80);
    });
  }

  // Page visibility — refresh quote when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const homeView = document.getElementById('view-home');
      if (homeView && homeView.classList.contains('active')) {
        nextMotivationQuote();
      }
    }
  });

  // ========== Init ==========
  function init() {
    switchTab('home');
    renderAll();
    renderFocus();
    startTimers();
    startMotivationRotation();
    setTimeout(maybeAutoShowBurnoutPopup, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
