(() => {
  'use strict';

  const STORAGE_KEY = 'syllabus_tracker_v2';
  const BACKUP_DATE_KEY = 'backup_last_date';
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
        <div class="brb-title">Keep your progress safe, Tajwar!</div>
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

    // Custom tasks that were not done yesterday
    const customRollover = [];
    for (const c of prevPlan.custom || []) {
      if (!c.done) customRollover.push({ id: uid(), text: c.text, done: false, rolledOver: true });
    }

    return { autoRollover, customRollover };
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
    for (const c of plan.custom) tasks.push({ type: 'custom', key: c.id, text: c.text, meta: c.rolledOver ? 'Rolled over from yesterday' : 'Custom task', color: c.rolledOver ? '#f59e0b' : '#94a3b8', done: !!c.done, id: c.id, rolledOver: !!c.rolledOver });
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
    clearInterval(smartReminderTimer); clearInterval(motivationTimer); clearInterval(dueTaskTimer);
    smartReminderTimer = setInterval(checkSmartReminder, 30000);
    motivationTimer = setInterval(checkMotivationReminders, 30000);
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
  let focusStartTime = null;
  let focusStartSeconds = null;
  let focusMultitaskMode = false;

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
  const FOCUS_QUOTES = [
    'Every Pomodoro brings you closer to BUET. 🎯',
    'Study like a pilot — aim for the stars, Tajwar. ✈️',
    'Stay focused, Tajwar. CSE\'26 is your destiny.',
    'One session at a time. One chapter at a time.',
    'The best engineers were the best students first.',
    'Your future BUET self is watching. Don\'t let them down.',
    'No shortcut to the top — only the grind knows the way.',
    'Every minute of focus today is a step toward your dream campus.',
    'Concentration is the root of all higher abilities in man.',
    'You\'re building the foundation of your engineering career — right now.',
    'Stay consistent. Champions are forged in hours no one sees.',
    'BUET doesn\'t wait. Neither should you.',
    'Focus first. Celebrate later.',
    'Discipline today = freedom tomorrow.',
    'Each tick of this timer is a vote for the engineer you want to become.',
    'You don\'t need motivation every day — you need discipline every day.',
    'Tajwar, you\'ve got this. Lock in. 🔒',
    'Dream big, study bigger.',
    'Silence the noise. Hear only the work.',
    'Progress, not perfection. Keep moving forward.',
    'Hard work beats talent when talent doesn\'t work hard.',
    'The pain of studying is temporary. Regret lasts forever.',
    'One concept mastered today is one less obstacle tomorrow.',
    'Code, conquer, repeat. That\'s the CSE way. 💻',
    'This might be the session that makes it all click. 🌟',
  ];
  let _currentQuote = null;
  let customFocusQuotes = (() => {
    try { return JSON.parse(localStorage.getItem('focus_custom_quotes') || '[]'); } catch (e) { return []; }
  })();
  function saveCustomFocusQuotes() { localStorage.setItem('focus_custom_quotes', JSON.stringify(customFocusQuotes)); }
  function pickNewQuote() {
    const pool = [...FOCUS_QUOTES, ...customFocusQuotes];
    if (!pool.length) { _currentQuote = ''; return; }
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
    if (item.type === 'playlist' && item.playlistId) return `https://www.youtube.com/embed/videoseries?list=${item.playlistId}&autoplay=1`;
    if (item.videoId) return `https://www.youtube.com/embed/${item.videoId}?autoplay=1&enablejsapi=1`;
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
  let activeDropdown = null;
  let _justPoppedKey = null, _justCompletedDay = null;
  let calendarViewDate = new Date();

  function switchTab(tab) {
    if (focusLocked && !focusMultitaskMode && focusRunning && tab !== 'focus') {
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
    // Show/hide mini timer bubble
    updateMiniTimer();
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
    view.innerHTML = `<div class="home-profile"><div class="home-profile-avatar">T</div><div class="home-profile-info"><div class="home-profile-name">Tajwar</div><div class="home-profile-sub">CSE'26, BUET</div></div><span class="home-profile-greeting">${greeting()} 👋</span></div><div class="motivation-line ${overall >= 80 ? 'is-hot' : overall < 20 ? 'is-cold' : ''}">${escapeHTML(motivationMsg)}</div><div class="hero-grid" style="margin-top:16px">${examHero}${progressHero}</div><button type="button" class="dashboard-cta" data-act="open-dashboard"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg></span><span class="body"><span class="title">Open Dashboard</span><span class="meta">Plan · Goals · Calendar · Suggestions</span></span><span class="arrow">›</span></button>${achievedBadge}<div class="section-head"><h2>Today's Tasks</h2><button class="btn-link" data-act="open-dashboard">+ Add tasks ›</button></div>${renderTasksList(tasks)}`;
    if (_justPoppedKey) requestAnimationFrame(() => { _justPoppedKey = null; });
    if (_justCompletedDay) setTimeout(() => { _justCompletedDay = null; }, 1800);
  }
  function renderTasksList(tasks) {
    if (!tasks.length) return `<div class="empty">No tasks for today — add some below.</div>`;
    return `<div class="list">${tasks.map(t => {
      const dataAttrs = t.type === 'auto' ? `data-type="auto" data-sub="${t.subId}" data-ch="${t.chId}" data-t="${t.tId}"` : `data-type="custom" data-id="${t.id}"`;
      const popped = _justPoppedKey === (t.type === 'auto' ? `auto:${t.subId}:${t.chId}:${t.tId}` : `custom:${t.id}`) ? 'just-popped' : '';
      const rolloverBadge = t.rolledOver ? `<span style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);vertical-align:middle;letter-spacing:0.03em">↩ yesterday</span>` : '';
      return `<div class="card card-row plan-task ${t.done ? 'is-done' : ''} ${popped}"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-plan-task" ${dataAttrs}/><span class="color-dot" style="background:${t.color}"></span><div style="flex:1;min-width:0"><div class="title ${t.done ? 'done' : ''}">${escapeHTML(t.text)}${rolloverBadge}</div><div class="meta">${escapeHTML(t.meta)}</div></div><button class="menu-btn" data-act="remove-plan-task" ${dataAttrs}>${ic('trash')}</button></div>`;
    }).join('')}</div>`;
  }
  function renderPlanAdder() {
    const subjOptions = state.subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
    return `<div class="plan-add-card"><div class="plan-add-title">Add to Today's Plan</div><div class="plan-add-grid"><select class="plan-sel" id="plan-pick-sub"><option value="">Subject…</option>${subjOptions}</select><select class="plan-sel" id="plan-pick-ch" disabled><option value="">Chapter…</option></select><select class="plan-sel" id="plan-pick-t" disabled><option value="">Topic (optional)…</option></select></div><div class="plan-add-actions"><button class="btn btn-block" data-act="add-plan-from-syllabus">${ic('plus')} Add from Syllabus</button></div><div class="plan-add-divider"><span>or custom task</span></div><div class="row" style="gap:7px;margin-top:4px"><input id="plan-new-task" placeholder="Custom task for today…" maxlength="120" style="flex:1;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:10px 11px;border-radius:9px;font:inherit;font-size:14px"/><button class="btn" data-act="add-plan-task">${ic('plus')}</button></div></div>`;
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
    const startDow = firstDay.getDay();
    const monthLabel = firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
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
      cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast && !isToday ? ' cal-past' : ''}${colourClass}" data-act="calendar-day" data-date="${dateISO}" role="button" aria-label="${ariaLabel}"><span class="cal-day-num">${d}</span>${dotHtml}</div>`;
    }
    return `<div class="cal-wrap"><div class="cal-nav"><button class="cal-nav-btn" data-act="cal-prev" aria-label="Previous month">‹</button><span class="cal-title">${monthLabel}</span><button class="cal-nav-btn" data-act="cal-next" aria-label="Next month">›</button></div><div class="cal-grid"><div class="cal-dow-row">${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}</div><div class="cal-cells">${cells}</div></div></div>`;
  }

  function modalCalendarDay(dateISO) {
    const today = todayKey();
    const label = dateISO === today ? 'Today — ' + formatDate(dateISO) : formatDate(dateISO);
    if (!state.dailyPlans[dateISO]) state.dailyPlans[dateISO] = { auto: [], removed: [], custom: [], generated: false };
    const plan = state.dailyPlans[dateISO];
    const tasks = plan.custom || [];
    const taskRows = tasks.length
      ? tasks.map((t, i) => `<div class="cal-task-card${t.done ? ' cal-task-done' : ''}"><input type="checkbox" class="check" ${t.done ? 'checked' : ''} data-act="toggle-cal-task" data-date="${dateISO}" data-i="${i}"/><span class="cal-task-text">${escapeHTML(t.text)}</span><button class="menu-btn" data-act="del-cal-task" data-date="${dateISO}" data-i="${i}">${ic('trash')}</button></div>`).join('')
      : `<div class="cal-empty-state">No tasks planned yet.<span>Add one below ↓</span></div>`;
    openModal(`<h3>📅 ${escapeHTML(label)}</h3><div class="cal-task-list">${taskRows}</div><div class="cal-add-row"><input id="cal-new-task" placeholder="Add a task for this day…" maxlength="120" autofocus/><button class="btn btn-sm" data-act="add-cal-task" data-date="${dateISO}">${ic('plus')}</button></div><div class="actions" style="margin-top:12px"><button class="btn btn-ghost" data-close>Done</button>${dateISO === today ? `<button class="btn" data-act="regen-plan" data-close>↻ Regen Today</button>` : ''}</div>`,
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
            <div><div class="v">${state.focusStats.minutesByDate[todayKey()] || 0}m</div><div class="k">Minutes focused</div></div>
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

  function updateMiniTimer() {
    const bubble = document.getElementById('focus-mini-timer');
    if (!bubble) return;
    const onFocusTab = document.body.classList.contains('tab-focus');
    if (focusRunning && !onFocusTab) {
      bubble.style.display = 'flex';
      const timeEl = document.getElementById('fmt-time');
      if (timeEl) timeEl.textContent = formatFocusTime(focusSeconds);
    } else {
      bubble.style.display = 'none';
    }
  }

  function updateFocusDisplay() {
    const formatted = formatFocusTime(focusSeconds);
    const total = customDurations[focusMode] * 60;
    const m = Math.floor(focusSeconds / 60), s = focusSeconds % 60;
    document.title = focusRunning ? `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} — Focus` : 'Syllabus Tracker';

    // Regular focus view
    const el = document.getElementById('focus-time-display'); if (el) el.textContent = formatted;
    const r = 96, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const ring = document.getElementById('focus-ring-circle'); if (ring) ring.style.strokeDashoffset = off.toFixed(2);

    // Full-session overlay — update timer + ring without re-rendering
    const fsEl = document.getElementById('fs-time-display'); if (fsEl) fsEl.textContent = formatted;
    const rr = 120, cc = 2 * Math.PI * rr, oo = cc * (1 - Math.max(0, Math.min(1, focusSeconds / total)));
    const fsRing = document.getElementById('fs-ring-circle'); if (fsRing) fsRing.style.strokeDashoffset = oo.toFixed(2);

    // Toggle running state for animations
    const overlay = document.getElementById('fs-overlay');
    if (overlay) overlay.classList.toggle('fs-is-running', focusRunning);
  }

  function focusTick() {
    // Timestamp-based calculation — stays accurate when tab is backgrounded/throttled
    if (focusStartTime !== null) {
      const elapsed = Math.floor((Date.now() - focusStartTime) / 1000);
      focusSeconds = Math.max(0, focusStartSeconds - elapsed);
    }
    if (focusSeconds > 0) { updateFocusDisplay(); updateMiniTimer(); return; }

    clearInterval(focusTimer); focusTimer = null; focusRunning = false;
    focusStartTime = null; focusStartSeconds = null;
    document.title = 'Syllabus Tracker';
    updateMiniTimer();

    if (focusMode === 'work') {
      const todayStr = todayKey();
      // Sessions already counted on Start; add the full session's minutes now
      const elapsedMin = focusStartSeconds !== null
        ? Math.floor(focusStartSeconds / 60)
        : customDurations.work;
      state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
      bumpActivity(); saveState();
      renderStats(); // keep Stats view in sync with every completed session

      // Push notification — fires even if the user is in another app
      showWebNotification('🎉 Focus Session Complete!', `Session ${focusSessions} done! Time for a break.`, { tag: 'focus-complete', requireInteraction: false });

      const task = focusCurrentTaskKey ? getActivePlanTasks().find(t => t.key === focusCurrentTaskKey) : null;
      if (task && !task.done) {
        confirmModal(`Session complete! Mark "${task.text}" as done?`, () => {
          if (task.type === 'auto') { const t = findTopic(task.subId, task.chId, task.tId); if (t) { t.done = true; bumpActivity(); onTopicDoneChanged(task.subId, task.chId, task.tId, true); saveState(); renderAll(); } }
          else { const plan = state.dailyPlans[todayKey()]; if (plan) { const ct = plan.custom.find(c => c.id === task.id); if (ct) { ct.done = true; bumpActivity(); saveState(); renderAll(); } } }
        }, { title: 'Session done!', yesLabel: 'Mark done', yesClass: 'btn' });
      } else {
        toast(`Session ${focusSessions} complete! 🎉`, 'success', 4000);
      }

      // Auto-backup: after completing a full Pomodoro cycle (every 4th session)
      if (focusSessions > 0 && focusSessions % 4 === 0 && !hasBackupToday()) {
        setTimeout(() => {
          confirmModal(
            `You've completed ${focusSessions} focus sessions today — amazing work! 🚀\n\nAuto-downloading your backup now to keep your progress safe.`,
            () => exportData(),
            { title: '🛡️ Backup Your Progress', yesLabel: 'Download Backup', yesClass: 'btn', noLabel: 'Skip' }
          );
        }, 1200);
      }
    } else {
      // Break ended notification
      showWebNotification('🚀 Break Over!', 'Time to get back to work. You\'ve got this!', { tag: 'focus-break-end', requireInteraction: false });
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
    overlay.className = focusRunning ? 'fs-is-running' : '';
    overlay.innerHTML = `<div class="fs-bg"><div class="fs-bg-earth"></div>${_genFsParticles()}</div>
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
          <button class="fs-ctrl-btn fs-side-btn" data-act="fs-cycle-ambient" title="Toggle sound">${ambientIcon}</button>
          <button class="fs-ctrl-btn fs-main-btn" data-act="fs-toggle">${focusRunning ? '⏸' : '▶'}</button>
          <button class="fs-ctrl-btn fs-side-btn fs-exit-btn" data-act="exit-full-session" title="Exit full screen">✕</button>
        </div>
        <div class="fs-hint">Press Esc to exit · ${ambientMode !== 'none' ? '♪ ' + escapeHTML(_curSound.label) : '🔇 Sound off'}</div>
      </div>`;
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

  /* ── Bookmark / YT-API helpers ── */
  let _ytPlayer      = null;
  let _ytPlayerReady = false;   // true only after onReady fires with e.target
  let _ytPlayerState = -1;      // mirrors YT player state (-1 unstarted, 1 playing, 2 paused…)

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
        <a href="${escapeHTML(item.url)}" target="_blank" rel="noopener" class="vp-yt-btn" title="Open externally">${SVG_EXTLINK}</a>
      </div>
      <div class="vp-split">
        <div class="vp-main">
          <div class="vp-embed-wrap">
            <iframe id="vp-iframe" src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowfullscreen sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" title="${escapeHTML(item.title)}"></iframe>
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
      </div>`;
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
    _ytPlayer = null; _ytPlayerReady = false; _ytPlayerState = -1;
    const el = document.getElementById('vp-overlay'); if (!el) return;
    el.classList.add('vp-closing');
    setTimeout(() => { el.remove(); document.body.style.overflow = ''; }, 210);
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

    // Study consistency (% of last 30 days active)
    const consistencyPct = Math.round((activeDays30 / 30) * 100);
    const consistencyLabel = consistencyPct >= 80 ? '🔥 Excellent' : consistencyPct >= 50 ? '👍 Good' : consistencyPct >= 25 ? '📈 Building' : '🌱 Just Starting';

    // Topic health breakdown
    let topicDone = 0, topicWeak = 0, topicRemaining = 0;
    for (const sub of state.subjects) for (const ch of sub.chapters) for (const t of ch.topics) {
      if (t.done) topicDone++;
      else if (isWeakTopic(t)) topicWeak++;
      else topicRemaining++;
    }
    const topicTotal = topicDone + topicWeak + topicRemaining || 1;

    // 7-day focus trend
    const days7 = []; const todayD = new Date(todayKey() + 'T00:00:00');
    for (let i = 6; i >= 0; i--) { const d = new Date(todayD); d.setDate(d.getDate() - i); const k = d.toISOString().slice(0, 10); days7.push({ k, min: state.focusStats.minutesByDate[k] || 0, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) }); }
    const maxFocus7 = Math.max(1, ...days7.map(d => d.min));
    const avgFocusMin = days7.length ? Math.round(days7.reduce((a, b) => a + b.min, 0) / days7.length) : 0;

    // Best study day of week (last 60 days)
    const dayTotals = [0,0,0,0,0,0,0]; const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = 0; i < 60; i++) { const d = new Date(todayD); d.setDate(d.getDate()-i); const k = d.toISOString().slice(0,10); dayTotals[d.getDay()] += (state.activity[k]||0); }
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
    const rank = totalFocusHours >= 20 ? { label: 'Flight Commander', icon: '🚀', color: '#a78bfa' }
      : totalFocusHours >= 5  ? { label: 'Pilot',   icon: '👨‍✈️', color: '#38bdf8' }
      : { label: 'Rookie', icon: '🌱', color: '#94a3b8' };
    const focusDisplay = totalFocusMin >= 60
      ? `${Math.floor(totalFocusMin / 60)}h${totalFocusMin % 60 ? ' ' + (totalFocusMin % 60) + 'm' : ''}`
      : `${totalFocusMin}m`;

    // Heatmap: 5 complete weeks (Sun → Sat), aligned to Sun column
    const hmTodayKey = todayKey();
    const hmDow = today.getDay();
    const hmStart = new Date(today); hmStart.setDate(hmStart.getDate() - (hmDow + 28));
    const heatmapCells = Array.from({ length: 35 }, (_, i) => {
      const d = new Date(hmStart); d.setDate(d.getDate() + i);
      const k = d.toISOString().slice(0, 10);
      const isFuture = k > hmTodayKey;
      const isToday = k === hmTodayKey;
      // Always read fresh from state.focusStats (same source as timer)
      const min = isFuture ? 0 : (state.focusStats.minutesByDate[k] || 0);
      const lvl = isFuture ? 'future' : min === 0 ? 'lv0' : min <= 30 ? 'lv1' : min <= 60 ? 'lv2' : min <= 120 ? 'lv3' : 'lv4';
      return { k, min, lvl, isToday, title: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ': ' + (isFuture ? '—' : min + 'm focused') };
    });

    // Neon palette for subject distribution — distinct colors regardless of stored subject color
    const NEON_PALETTE = ['#00e5ff','#ff4d9e','#00ff88','#ffd600','#7c4dff','#ff6d00','#40c4ff','#f50057','#69ff47','#ff9100'];

    // Pie: subjects with completed chapters, using distinct neon colors by index
    const pieSubjects = state.subjects.map((sub, idx) => {
      let done = 0;
      for (const ch of sub.chapters) if (ch.done) done++;
      return { name: sub.name, done, color: NEON_PALETTE[idx % NEON_PALETTE.length] };
    }).filter(s => s.done > 0);

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
        <div class="stats-glass-card" style="border-color:${rank.color}44">
          <div class="sgc-icon">${rank.icon}</div>
          <div class="sgc-value sgc-rank" style="color:${rank.color}">${rank.label}</div>
          <div class="sgc-label">Your Rank</div>
        </div>
      </div>

      <div class="stats-chart-pair">
        <div class="stats-chart-half">
          <div class="stats-section-head"><span>Weekly Focus</span><span class="stats-section-meta">${days7.reduce((a, b) => a + b.min, 0)}m this week</span></div>
          <div class="stats-chart-card"><div class="stats-chart-wrap"><canvas id="stats-weekly-chart"></canvas></div></div>
        </div>
        <div class="stats-chart-half">
          <div class="stats-section-head"><span>Subject Distribution</span><span class="stats-section-meta">by chapters done</span></div>
          <div class="stats-chart-card">${pieSubjects.length
            ? `<div class="stats-pie-wrap"><canvas id="stats-pie-chart"></canvas></div>`
            : `<div class="stats-empty-chart">Complete topics to see distribution</div>`}</div>
        </div>
      </div>

      <div class="stats-section-head"><span>Focus Heatmap</span><span class="stats-section-meta">Last 5 weeks</span></div>
      <div class="stats-chart-card stats-heatmap-card">
        <div class="stats-hm-day-labels"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
        <div class="stats-heatmap">${heatmapCells.map(c => `<div class="shm-cell ${c.lvl}${c.isToday ? ' shm-today' : ''}" title="${c.title}"></div>`).join('')}</div>
        <div class="stats-hm-legend"><span>Less</span><div class="shm-cell lv0"></div><div class="shm-cell lv1"></div><div class="shm-cell lv2"></div><div class="shm-cell lv3"></div><div class="shm-cell lv4"></div><span>More</span></div>
      </div>

      <div class="stats-row" style="margin-top:16px">
        <div class="stat-tile"><div class="v">${overall}%</div><div class="k">Overall</div></div>
        <div class="stat-tile"><div class="v">${state.streak.count} 🔥</div><div class="k">Streak</div></div>
        <div class="stat-tile"><div class="v">${consistencyPct}%</div><div class="k">Consistency</div></div>
        <div class="stat-tile"><div class="v">${activeDays30}/30</div><div class="k">Active Days</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${doneTopics}/${totalTopics}</div><div class="k">Topics</div></div>
        <div class="stat-tile"><div class="v">${doneChapters}/${totalChapters}</div><div class="k">Chapters</div></div>
        <div class="stat-tile" style="${totalWeak > 0 ? 'border-color:#f59e0b33' : ''}"><div class="v" style="${totalWeak > 0 ? 'color:#f59e0b' : ''}">${totalWeak}</div><div class="k">Weak Topics</div></div>
        <div class="stat-tile"><div class="v">${totalRevDone}</div><div class="k">Revisions</div></div>
      </div>

      <div class="stats-row" style="margin-top:8px">
        <div class="stat-tile"><div class="v">${todaySessions}</div><div class="k">Today Sessions</div></div>
        <div class="stat-tile"><div class="v">${todayFocusMin}m</div><div class="k">Today Focus</div></div>
        <div class="stat-tile"><div class="v">${totalFocusSessions}</div><div class="k">All Sessions</div></div>
        <div class="stat-tile"><div class="v">${avgFocusMin}m</div><div class="k">Avg / Day</div></div>
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
          <div><div style="font-size:13px;font-weight:700">Last 30 Days</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${consistencyLabel}</div></div>
          <div style="font-size:24px;font-weight:900;color:var(--primary)">${consistencyPct}%</div>
        </div>
        <div class="progress" style="height:8px"><span style="width:${consistencyPct}%"></span></div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--text-muted)">
          <span>${activeDays30} active days out of 30</span>
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

    initStatsCharts(days7, pieSubjects);
  }

  function initStatsCharts(days7, pieSubjects) {
    if (!window.Chart) { setTimeout(() => initStatsCharts(days7, pieSubjects), 300); return; }

    // Weekly bar chart
    const weeklyCanvas = document.getElementById('stats-weekly-chart');
    if (weeklyCanvas) {
      const prev = Chart.getChart(weeklyCanvas); if (prev) prev.destroy();
      new Chart(weeklyCanvas, {
        type: 'bar',
        data: {
          labels: days7.map(d => d.label),
          datasets: [{
            data: days7.map(d => d.min),
            backgroundColor: days7.map((d, i) => {
              if (i === 6) return 'rgba(77,168,255,0.90)';       // today — bright
              if (d.min > 0) return 'rgba(77,168,255,0.42)';      // past with data
              return 'rgba(77,168,255,0.14)';                      // past, no data
            }),
            borderColor: days7.map((_, i) => i === 6 ? '#4da8ff' : 'transparent'),
            borderWidth: days7.map((_, i) => i === 6 ? 2 : 0),
            borderRadius: 8,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#0d1b2a', borderColor: 'rgba(77,168,255,0.4)', borderWidth: 1,
              titleColor: '#f0f6ff', bodyColor: '#94a3b8', padding: 10,
              callbacks: { label: ctx => ` ${ctx.parsed.y} min` }
            }
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(148,163,184,0.75)', font: { size: 11, weight: '600' } } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false }, ticks: { color: 'rgba(148,163,184,0.6)', font: { size: 10 }, callback: v => v + 'm', maxTicksLimit: 4 }, beginAtZero: true }
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
      <div class="settings-section"><h4>Focus Timer Quotes</h4><p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">${FOCUS_QUOTES.length} built-in · ${customFocusQuotes.length} custom. A fresh quote appears every time you start the timer.</p><div class="quote-list">${customFocusQuotes.length ? customFocusQuotes.map((q, i) => `<div class="quote-row"><div class="text">${escapeHTML(q)}</div><button class="menu-btn" data-act="del-focus-quote" data-i="${i}">${ic('trash')}</button></div>`).join('') : '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No custom quotes yet.</div>'}</div><div class="quote-add-row"><input id="set-focus-quote" placeholder="Add your own focus quote…" maxlength="200"/><button class="btn" data-act="add-focus-quote">${ic('plus')}</button></div></div>
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
    if (act === 'regen-plan') { const k = todayKey(); if (state.dailyPlans[k]) { state.dailyPlans[k].generated = false; state.dailyPlans[k].auto = []; state.dailyPlans[k].custom = state.dailyPlans[k].custom.filter(c => !c.rolledOver); } saveState(); ensureTodayPlan(); renderHome(); renderDashboard(); toast('Plan regenerated', 'info'); return; }
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
      else { if (confirm('Stop current timer and switch mode?')) { clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusStartTime = null; focusStartSeconds = null; focusMode = newMode; focusSeconds = customDurations[newMode] * 60; renderFocus(); document.title = 'Syllabus Tracker'; updateMiniTimer(); } }
      return;
    }
    if (act === 'focus-toggle') {
      if (focusRunning) {
        // Partial-credit: save elapsed minutes for work sessions stopped early
        if (focusMode === 'work' && focusStartTime !== null) {
          const elapsedMin = Math.floor((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            saveState();
          }
        }
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
        updateMiniTimer();
      } else {
        // Count the session the moment the user hits Start
        if (focusMode === 'work') {
          const todayStr = todayKey();
          focusSessions++;
          state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
          saveState();
        }
        if (notifPermission() === 'default') requestNotifPermission();
        focusRunning = true;
        pickNewQuote();
        focusStartTime = Date.now();
        focusStartSeconds = focusSeconds;
        focusTimer = setInterval(focusTick, 1000);
        resumeAmbientIfNeeded();
      }
      renderFocus(); return;
    }
    if (act === 'focus-reset') { clearInterval(focusTimer); focusTimer = null; focusRunning = false; focusStartTime = null; focusStartSeconds = null; focusSeconds = customDurations[focusMode] * 60; focusMultitaskMode = false; renderFocus(); document.title = 'Syllabus Tracker'; updateMiniTimer(); return; }
    if (act === 'focus-lock') { focusMultitaskMode = false; focusLocked = !focusLocked; renderFocus(); toast(focusLocked ? '🔒 Lock Mode on — other tabs are restricted' : '🔓 Lock Mode off', focusLocked ? 'warn' : 'info'); return; }
    if (act === 'focus-multitask') { focusMultitaskMode = !focusMultitaskMode; if (focusMultitaskMode) { focusLocked = false; } renderFocus(); toast(focusMultitaskMode ? '🗒️ Multitask Mode on — navigate freely, timer keeps running' : '🔓 Multitask Mode off', 'info'); return; }
    if (act === 'focus-task-clear') { focusCurrentTaskKey = null; renderFocus(); return; }

    // Ambient sound
    if (act === 'ambient-select') { ambientMode = el.dataset.amode; startAmbient(ambientMode); renderFocus(); return; }
    if (act === 'binaural-toggle') { toggleBinaural(); return; }

    // Full Screen Session
    if (act === 'enter-full-session') { enterFullSession(); return; }
    if (act === 'exit-full-session') { exitFullSession(); stopAmbient(); ambientMode = 'none'; return; }
    if (act === 'fs-toggle') {
      if (focusRunning) {
        // Partial-credit: save elapsed minutes for work sessions stopped early
        if (focusMode === 'work' && focusStartTime !== null) {
          const elapsedMin = Math.floor((Date.now() - focusStartTime) / 1000 / 60);
          if (elapsedMin > 0) {
            const todayStr = todayKey();
            state.focusStats.minutesByDate[todayStr] = (state.focusStats.minutesByDate[todayStr] || 0) + elapsedMin;
            saveState();
          }
        }
        clearInterval(focusTimer); focusTimer = null; focusRunning = false;
        focusStartTime = null; focusStartSeconds = null;
      } else {
        // Count the session the moment the user hits Start
        if (focusMode === 'work') {
          const todayStr = todayKey();
          focusSessions++;
          state.focusStats.sessions[todayStr] = (state.focusStats.sessions[todayStr] || 0) + 1;
          saveState();
        }
        if (notifPermission() === 'default') requestNotifPermission();
        focusRunning = true;
        focusStartTime = Date.now();
        focusStartSeconds = focusSeconds;
        focusTimer = setInterval(focusTick, 1000);
        resumeAmbientIfNeeded();
      }
      renderFullSession(); return;
    }
    if (act === 'fs-cycle-ambient') {
      const modes = SOUNDS.map(s => s.id);
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
    if (act === 'play-video')   { openVideoPlayer(el.dataset.gid, el.dataset.iid); return; }
    if (act === 'vp-close')    { closeVideoPlayer(); return; }
    if (act === 'vp-switch')   { switchVideoInPlayer(el.dataset.gid, el.dataset.iid); return; }
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
    if (act === 'del-focus-quote') { const idx = parseInt(el.dataset.i, 10); customFocusQuotes.splice(idx, 1); saveCustomFocusQuotes(); if (_currentQuote && !customFocusQuotes.includes(_currentQuote) && !FOCUS_QUOTES.includes(_currentQuote)) _currentQuote = null; refreshSettingsIfOpen(); toast('Quote removed', 'info'); return; }
    if (act === 'add-focus-quote') { const inp = document.getElementById('set-focus-quote'), text = inp ? inp.value.trim() : ''; if (!text) { toast('Enter a quote first', 'warn'); return; } customFocusQuotes.push(text); saveCustomFocusQuotes(); refreshSettingsIfOpen(); toast('Focus quote added ✨', 'success'); return; }
    if (act === 'export-data') { closeModal(); exportData(); return; }
    if (act === 'backup-export') { exportData(); return; }
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

  window.addEventListener('beforeunload', e => { if (focusRunning && focusLocked) { e.preventDefault(); e.returnValue = 'Focus timer is running. Leave?'; } });

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

  // Page visibility — refresh quote + sync focus timer when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const homeView = document.getElementById('view-home');
      if (homeView && homeView.classList.contains('active')) {
        nextMotivationQuote();
      }
      // Sync timer to wall-clock elapsed time (fixes background throttling)
      if (focusRunning && focusStartTime !== null) {
        const elapsed = Math.floor((Date.now() - focusStartTime) / 1000);
        focusSeconds = Math.max(0, focusStartSeconds - elapsed);
        updateFocusDisplay();
        updateMiniTimer();
        // If timer expired while app was backgrounded, trigger completion now
        if (focusSeconds <= 0) focusTick();
      }
    }
  });

  // ========== Init ==========
  function init() {
    initMiniTimer();
    switchTab('home');
    renderAll();
    renderFocus();
    startTimers();
    startMotivationRotation();
    setTimeout(maybeAutoShowBurnoutPopup, 2500);
    maybeShowBackupReminder();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
