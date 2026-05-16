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

  // ── Data ─────────────────────────────────────────────────────────────────
  function scLoad() {
    try {
      const raw = localStorage.getItem(SC_KEY);
      const d = raw ? JSON.parse(raw) : {};
      return {
        groups: Array.isArray(d.groups) ? d.groups : [],
        tasks:  Array.isArray(d.tasks)  ? d.tasks  : [],
        notes:  Array.isArray(d.notes)  ? d.notes  : [],
      };
    } catch(_) { return { groups: [], tasks: [], notes: [] }; }
  }
  function scSave(d) { try { localStorage.setItem(SC_KEY, JSON.stringify(d)); } catch(_) {} }

  // ── State ─────────────────────────────────────────────────────────────────
  let _tab           = 'rooms';
  let _groupView     = null;
  let _lbPeriod      = 'daily';
  let _roomFilter    = 'new';
  let _roomPublicOnly = false;
  let _roomWithSpace  = false;
  let _destroyed     = false;

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
      'Exams':   { bg:'rgba(245,158,11,.18)',  text:'#fbbf24', border:'rgba(245,158,11,.3)'  },
      'Language':{ bg:'rgba(59,130,246,.18)',  text:'#60a5fa', border:'rgba(59,130,246,.3)'  },
      'Tech':    { bg:'rgba(56,189,248,.18)',  text:'#38bdf8', border:'rgba(56,189,248,.3)'  },
      'Science': { bg:'rgba(34,197,94,.18)',   text:'#4ade80', border:'rgba(34,197,94,.3)'   },
      'Arts':    { bg:'rgba(244,114,182,.18)', text:'#f472b6', border:'rgba(244,114,182,.3)' },
      'General': { bg:'rgba(124,58,237,.18)',  text:'#a78bfa', border:'rgba(124,58,237,.3)'  },
    };
    return map[cat] || { bg:'rgba(148,163,184,.12)', text:'#94a3b8', border:'rgba(148,163,184,.2)' };
  }

  function _avatarColor(name) {
    const cols = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2'];
    let h = 0;
    for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return cols[h % cols.length];
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function renderSocial() {
    if (_destroyed) return;
    const view = document.getElementById('view-social');
    if (!view) return;
    try {
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
      { id:'tasks',       label:'Tasks',    emoji:'✅' },
      { id:'notes',       label:'Notes',    emoji:'📝' },
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

  function _renderTabContent() {
    try {
      switch (_tab) {
        case 'rooms':       return _renderRooms();
        case 'groups':      return _renderGroups();
        case 'leaderboard': return _renderLeaderboard();
        case 'tasks':       return _renderTasks();
        case 'notes':       return _renderNotes();
        default:            return _renderRooms();
      }
    } catch(e) {
      console.error('[Social] tab error:', e);
      return `<div class="sc-error-state"><div class="sc-error-icon">⚠️</div><div class="sc-error-title">Could not load section</div></div>`;
    }
  }

  // ── Rooms / Discovery ─────────────────────────────────────────────────────
  const FILTER_TABS = [
    { id:'new',          label:'New' },
    { id:'most-members', label:'Most Members' },
    { id:'most-study',   label:'Most Study Time' },
    { id:'cam',          label:'📷 Cam Study' },
  ];

  function _renderRooms() {
    const sc  = scLoad();
    const ms  = getMainState();
    const studying  = isStudying();
    const todayMins = (ms.focusStats?.minutesByDate || {})[todayKey()] || 0;

    // Sync today's study time into each local group
    if ((todayMins > 0 || studying) && sc.groups.length > 0) {
      let dirty = false;
      sc.groups.forEach(g => {
        if (g._lastDateKey !== todayKey()) {
          g.dailyMinsTotal = todayMins;
          g._lastDateKey   = todayKey();
          if (studying && todayMins > 0)
            g.attendancePct = Math.min(100, Math.round(1 / Math.max(1, (g.members||[]).length) * 100));
          dirty = true;
        }
      });
      if (dirty) scSave(sc);
    }

    // Filter
    let groups = [...sc.groups];
    if (_roomPublicOnly) groups = groups.filter(g => !g.isPrivate);
    if (_roomWithSpace)  groups = groups.filter(g => (g.members||[]).length < (g.maxMembers||50));
    if (_roomFilter === 'cam') groups = groups.filter(g => g.camStudy);

    // Sort
    if (_roomFilter === 'most-members')
      groups.sort((a, b) => (b.members||[]).length - (a.members||[]).length);
    else if (_roomFilter === 'most-study')
      groups.sort((a, b) => (b.dailyMinsTotal||0) - (a.dailyMinsTotal||0));
    else
      groups.sort((a, b) => (b.createdAt||0) - (a.createdAt||0));

    const filterTabsHtml = FILTER_TABS.map(f =>
      `<button class="sc-filter-tab${_roomFilter === f.id ? ' sc-ftab-active' : ''}"
               data-sc="room-filter" data-filter="${f.id}">${f.label}</button>`
    ).join('');

    const emptyHtml = `
      <div class="sc-disc-empty">
        <div class="sc-disc-empty-icon">🌍</div>
        <div class="sc-disc-empty-title">${sc.groups.length === 0 ? 'No Study Groups Yet' : 'No Groups Match'}</div>
        <div class="sc-disc-empty-sub">${sc.groups.length === 0
          ? 'Create your first group and invite others to study together globally.'
          : 'Try adjusting the filters above.'}</div>
        ${sc.groups.length === 0
          ? `<button class="sc-btn sc-btn-primary sc-disc-create-btn" data-sc="create-group">${ICON.plus} Create a Group</button>`
          : ''}
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
    const memberCount    = (g.members||[]).length;
    const maxMembers     = g.maxMembers    || 50;
    const dailyGoalHrs   = g.dailyGoalHrs  || 8;
    const leader         = g.leader        || (g.members?.[0]?.name) || 'Unknown';
    const category       = g.category      || 'General';
    const camStudy       = !!g.camStudy;
    const promoted       = !!g.promoted;
    const createdAt      = g.createdAt     || Date.now();
    const dailyMinsTotal = g.dailyMinsTotal || (studying ? todayMins : 0);
    const attendancePct  = g.attendancePct
      || ((studying && memberCount > 0) ? Math.min(100, Math.round(1 / memberCount * 100)) : 0);
    const col            = _catColor(category);
    const isAdmin        = g.role === 'admin';
    const promoHTML      = promoted ? ' · <span class="sc-promo-badge">Promoted</span>' : '';

    return `
      <div class="sc-disc-card" data-sc="enter-room" data-gid="${esc(g.id)}" role="button" tabindex="0">
        <div class="sc-disc-toprow">
          <span class="sc-cat-tag" style="background:${col.bg};color:${col.text};border-color:${col.border}">${esc(category)}</span>
          <span class="sc-disc-time">${esc(_timeAgo(createdAt))}${promoHTML}</span>
        </div>

        <div class="sc-disc-title">${esc(g.name)}</div>
        ${g.description ? `<div class="sc-disc-desc">${esc(g.description)}</div>` : ''}

        <div class="sc-disc-stats-row">
          <span class="sc-dstat"><span class="sc-dstat-icon">🎯</span>${dailyGoalHrs}h goal</span>
          <span class="sc-dstat-sep"></span>
          <span class="sc-dstat"><span class="sc-dstat-icon">👥</span>${memberCount}/${maxMembers} people</span>
          <span class="sc-dstat-sep"></span>
          <span class="sc-dstat sc-dstat-leader"><span class="sc-dstat-icon">👑</span>${esc(leader)}</span>
          ${camStudy ? `<span class="sc-dstat-sep"></span><span class="sc-dstat sc-dstat-cam">📷 Cam</span>` : ''}
        </div>

        <div class="sc-disc-perf-row">
          <span class="sc-dperf">⏱ <strong>${minsToHrs(dailyMinsTotal)}</strong> today</span>
          <span class="sc-dperf-dot">·</span>
          <span class="sc-dperf">📊 <strong>${attendancePct}%</strong> attendance</span>
        </div>

        <div class="sc-disc-footer">
          <span class="sc-disc-date">Started ${esc(_formatDate(createdAt))}</span>
          <span class="sc-disc-role ${isAdmin ? 'sc-role-admin' : 'sc-role-member'}">${isAdmin ? '👑 Admin' : '✓ Member'}</span>
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
            const mc = (g.members||[]).length;
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
    const sc = scLoad();
    const studying = isStudying();

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Rankings</span>
          <div class="sc-toggle-row">
            <button class="sc-toggle-btn${_lbPeriod==='daily'?' sc-active':''}" data-sc="lb-period" data-period="daily">Daily</button>
            <button class="sc-toggle-btn${_lbPeriod==='weekly'?' sc-active':''}" data-sc="lb-period" data-period="weekly">Weekly</button>
          </div>
        </div>
        <div class="sc-lb-you-card">
          <div class="sc-lb-you-label">Your Study Time ${_lbPeriod==='daily'?'Today':'This Week'}</div>
          <div class="sc-lb-you-time">${minsToHrs(displayMins)}</div>
          ${studying ? '<div class="sc-lb-studying-badge">● Currently Studying</div>' : ''}
          <div class="sc-lb-progress-wrap">
            <div class="sc-lb-progress-bar" style="width:${Math.min(100,(displayMins/(_lbPeriod==='daily'?480:3360))*100).toFixed(1)}%"></div>
          </div>
          <div class="sc-lb-goal-label">Goal: ${_lbPeriod==='daily'?'8h / day':'56h / week'}</div>
        </div>
        ${sc.groups.length > 0 ? `
          <div class="sc-lb-groups">
            <div class="sc-block-title" style="margin-bottom:10px">My Groups</div>
            ${sc.groups.map((g,i) => `
              <div class="sc-lb-row">
                <span class="sc-lb-rank">#${i+1}</span>
                <span class="sc-lb-gicon">${g.icon||'📚'}</span>
                <span class="sc-lb-gname">${esc(g.name)}</span>
                <span class="sc-lb-gmeta">${(g.members||[]).length} members</span>
              </div>`).join('')}
          </div>` : `
          <div class="sc-lb-info-card">
            <div class="sc-lb-info-icon">${ICON.trophy}</div>
            <div class="sc-lb-info-text"><strong>Group leaderboards</strong><br>Create or join a group to compete.</div>
          </div>`}
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
  const CATEGORIES = ['General','Exams','Language','Tech','Science','Arts'];

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
        <label class="sc-checkbox-row">
          <input id="sc-grp-cam" type="checkbox" class="sc-checkbox"/>
          <span>📷 Cam Study room</span>
        </label>
        <label class="sc-checkbox-row" style="margin-top:8px">
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
      const camEl    = root.querySelector('#sc-grp-cam');
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
        const ms = getMainState();
        const myName = ms.profile?.name || 'You';
        sc.groups.push({
          id: genId(), name, icon: selectedIcon,
          code: genCode(), isPrivate: privEl.checked,
          description: descEl.value.trim(),
          category:     selectedCat,
          dailyGoalHrs: Math.max(1, Math.min(24, parseInt(goalEl.value)||8)),
          maxMembers:   Math.max(2, Math.min(500, parseInt(maxEl.value)||50)),
          leader:       myName,
          camStudy:     camEl.checked,
          promoted:     false,
          createdAt:    Date.now(),
          dailyMinsTotal: 0,
          attendancePct:  0,
          role: 'admin',
          members: [{ id:'me', name:myName, role:'admin', joinedAt:Date.now() }],
        });
        scSave(sc);
        closeModal();
        toast(`"${name}" created! 🎉`, 'success');
        _tab = 'rooms';
        renderSocial();
      };

      submitEl.addEventListener('click', doCreate);
      nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
    });
  }

  function _modalJoinGroup() {
    openModal(`
      <h3 class="sc-modal-title">Join a Group</h3>
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
      const doJoin = () => {
        const code = codeEl.value.trim().toUpperCase();
        if (code.length < 4) { errEl.textContent = 'Enter a valid invite code (4–8 characters).'; errEl.style.display=''; return; }
        const sc = scLoad();
        if (sc.groups.find(g => g.code === code)) { errEl.textContent = 'You already belong to a group with this code.'; errEl.style.display=''; return; }
        const ms = getMainState();
        const myName = ms.profile?.name || 'You';
        sc.groups.push({
          id: genId(), name: `Group ${code}`, icon: '📚',
          code, isPrivate: false, description: '',
          category: 'General', dailyGoalHrs: 8, maxMembers: 50,
          leader: 'Admin', camStudy: false, promoted: false,
          createdAt: Date.now(), dailyMinsTotal: 0, attendancePct: 0,
          role: 'member',
          members: [{ id:'me', name:myName, role:'member', joinedAt:Date.now() }],
        });
        scSave(sc);
        closeModal();
        toast('Group joined!', 'success');
        _tab = 'rooms';
        renderSocial();
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
    if (el.dataset.sc === 'filter-public') { _roomPublicOnly = el.checked; renderSocial(); }
    else if (el.dataset.sc === 'filter-space') { _roomWithSpace = el.checked; renderSocial(); }
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
        renderSocial();
        break;

      case 'lb-period':
        _lbPeriod = el.dataset.period || 'daily';
        renderSocial();
        break;

      case 'create-group': _modalCreateGroup(); break;
      case 'join-group':   _modalJoinGroup();   break;

      case 'open-group':
      case 'enter-room':
        _tab = 'groups';
        _groupView = el.dataset.gid;
        renderSocial();
        break;

      case 'close-group':
        _groupView = null;
        renderSocial();
        break;

      case 'leave-group': {
        const gid = el.dataset.gid;
        const sc  = scLoad();
        const g   = sc.groups.find(x => x.id === gid);
        if (!g) break;
        confirmModal(`Leave "${g.name}"? Local group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks  = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes  = sc2.notes.filter(n => n.groupId !== gid);
          scSave(sc2); _groupView = null;
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

      default: break;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    window._socialRender = renderSocial;
    window._socialFocusUpdate = () => { if (window._currentTab === 'social') renderSocial(); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
