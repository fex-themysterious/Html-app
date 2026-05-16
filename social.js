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
        if (_srTab === 'home') _startSrTicker(_groupView);
        if (_srTab === 'chat') setTimeout(() => {
          const msgs = document.getElementById('sr-chat-msgs');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 60);
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

  // ── Study Room Helpers ────────────────────────────────────────────────────
  function _fmtSecs(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }

  function _srMemberIsActive(m) {
    if (m.id === 'me') return ui().focusIsRunning?.() === true;
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
    return (m.todayKey === tk ? (m.todayMins || 0) : 0) * 60;
  }

  function _startSrTicker(gid) {
    _stopSrTicker();
    _srTickInterval = setInterval(() => {
      const view = document.getElementById('view-social');
      if (!view || !view.querySelector('.sr-room')) { _stopSrTicker(); return; }
      const sc = scLoad();
      const g  = sc.groups.find(x => x.id === gid);
      if (!g) { _stopSrTicker(); return; }
      (g.members || []).forEach(m => {
        const el = view.querySelector(`[data-sr-timer="${m.id}"]`);
        if (el) el.textContent = _fmtSecs(_srMemberSeconds(m));
      });
      const me = (g.members || []).find(x => x.id === 'me');
      const activeCnt = (me && _srMemberIsActive(me)) ? 1 : 0;
      const cntEl = view.querySelector('.sr-studying-count');
      if (cntEl) cntEl.textContent = activeCnt;
      if (me) {
        const myCard = view.querySelector(`[data-sr-card="${me.id}"]`);
        if (myCard) {
          const isActive     = myCard.classList.contains('sr-card-active');
          const shouldActive = _srMemberIsActive(me);
          if (isActive !== shouldActive) { _stopSrTicker(); renderSocial(); }
        }
      }
    }, 1000);
  }

  function _stopSrTicker() {
    if (_srTickInterval !== null) { clearInterval(_srTickInterval); _srTickInterval = null; }
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

  // ── Group Leader Settings Panel ───────────────────────────────────────────
  function _renderGroupSettings(g, sc) {
    const isAdmin      = g.role === 'admin';
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

    const ch  = `<svg class="sgs-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const div = `<div class="sgs-row-divider"></div>`;

    const row = (label, hint, act) => `
      <button class="sgs-row" data-sc="${act}" data-gid="${esc(g.id)}">
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta">${hint ? `<span class="sgs-row-hint">${hint}</span>` : ''}${ch}</span>
      </button>`;

    const toggleRow = (label, on, act) => `
      <button class="sgs-row" data-sc="${act}" data-gid="${esc(g.id)}">
        <span class="sgs-row-label">${label}</span>
        <span class="sgs-row-meta"><span class="sgs-toggle ${on ? 'sgs-toggle-on' : 'sgs-toggle-off'}">${on ? 'ON' : 'OFF'}</span>${ch}</span>
      </button>`;

    return `
      <div class="sgs-page">
        <div class="sgs-topbar">
          <button class="sgs-back-btn" data-sc="sgs-back" data-gid="${esc(g.id)}" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="sgs-topbar-title">Group Info/Settings</span>
          <div style="width:40px"></div>
        </div>

        <div class="sgs-scroll">

          <div class="sgs-section-label">Personal Settings</div>
          <div class="sgs-card">
            ${row('Group Profile', '', 'sgs-group-profile')}
            ${div}
            ${row('Group notification settings', '', 'sgs-notif')}
          </div>

          <div class="sgs-card">
            <button class="sgs-row" data-sc="sgs-challenges" data-gid="${esc(g.id)}">
              <span class="sgs-row-label">Group Challenge</span>
              <span class="sgs-row-meta"><span class="sgs-count">0</span>${ch}</span>
            </button>
            ${div}
            <button class="sgs-row" data-sc="sgs-missions" data-gid="${esc(g.id)}">
              <span class="sgs-row-label">Legacy Group missions</span>
              <span class="sgs-row-meta"><span class="sgs-count">0</span>${ch}</span>
            </button>
          </div>

          ${isAdmin ? `
          <div class="sgs-section-label">Group Leader Menu</div>
          <div class="sgs-card">
            ${row('Change Group Name', '', 'sgs-change-name')}
            ${div}
            ${row('Group Introduction/Rules', g.description ? '' : 'No rules', 'sgs-change-rules')}
            ${div}
            ${row('Change Category', esc(category), 'sgs-change-category')}
            ${div}
            ${row('Change Daily Goal', (g.dailyGoalHrs || 8) + 'h', 'sgs-change-goal')}
            ${div}
            ${row('Change Capacity', maxMembers + ' people', 'sgs-change-capacity')}
            ${div}
            ${row('How to Join', joinMode === 'approval' ? 'Join after approval' : 'Join immediately', 'sgs-join-mode')}
            ${div}
            ${toggleRow('Sign Up Questions', signupQOn, 'sgs-signup-question')}
            ${div}
            ${toggleRow('Nickname Rules', nicknameReq, 'sgs-nickname-rules')}
            ${div}
            ${row('Change Password', hasPassword ? 'Protected' : 'Public', 'sgs-change-password')}
          </div>

          <div class="sgs-card">
            ${row('Waiting Room', requests.length > 0 ? requests.length + ' pending' : '', 'sgs-waiting-room')}
            ${div}
            ${row('Manage Group Members', (g.members || []).length + ' member' + ((g.members||[]).length !== 1 ? 's' : ''), 'sgs-manage-members')}
            ${div}
            ${row('Nudge everyone at once', '', 'sgs-nudge-all')}
            ${div}
            <button class="sgs-row" data-sc="sgs-toggle-chat" data-gid="${esc(g.id)}">
              <span class="sgs-row-label">Group Chat</span>
              <span class="sgs-row-meta"><span class="sgs-toggle ${chatEnabled ? 'sgs-toggle-on' : 'sgs-toggle-off'}" style="font-size:13px;font-weight:600">${chatEnabled ? 'on' : 'off'}</span>${ch}</span>
            </button>
            ${div}
            ${row('Promote group', promotedAgo || '', 'sgs-promote')}
          </div>

          <div class="sgs-card sgs-card-danger" style="margin-top:16px">
            <button class="sgs-row" data-sc="sgs-delete-group" data-gid="${esc(g.id)}">
              <span class="sgs-row-label sgs-label-danger">Delete Group</span>
            </button>
          </div>

          ` : `
          <div class="sgs-card sgs-card-danger" style="margin-top:16px">
            <button class="sgs-row" data-sc="sgs-leave-group-settings" data-gid="${esc(g.id)}">
              <span class="sgs-row-label sgs-label-danger">Leave Group</span>
            </button>
          </div>
          `}

          <div style="height:40px"></div>
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
    const me       = members.find(x => x.id === 'me');
    const meActive = me ? _srMemberIsActive(me) : false;
    const activeCount = meActive ? 1 : 0;
    const memberCards = members.map(m => {
      const active      = m.id === 'me' ? meActive : false;
      const secs        = _srMemberSeconds(m);
      const name        = m.name || 'Unknown';
      const displayName = name.length > 10 ? name.slice(0, 9) + '…' : name;
      return `
        <div class="sr-member-card ${active ? 'sr-card-active' : 'sr-card-idle'}" data-sr-card="${esc(m.id)}">
          <div class="sr-card-icon">${active ? SR_ACTIVE_DESK : SR_IDLE_DESK}</div>
          <div class="sr-card-name">${esc(displayName)}</div>
          <div class="sr-card-timer${active ? ' sr-timer-live' : ''}" data-sr-timer="${esc(m.id)}">${_fmtSecs(secs)}</div>
        </div>`;
    });
    return `
      <div class="sr-home-view">
        <div class="sr-studying-header">
          <span class="sr-studying-label">Studying</span>
          <span class="sr-studying-badge">
            <span class="sr-studying-count">${activeCount}</span> member${activeCount !== 1 ? 's' : ''}
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
    const members = g.members || [];
    const days    = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      days.push({ key, label: String(d.getDate()).padStart(2,'0') });
    }
    return `
      <div class="sr-att-view">
        <div class="sr-section-head">Attendance — Last 14 Days</div>
        ${members.length === 0
          ? `<div class="sr-empty-grid">No members yet.</div>`
          : members.map(m => {
              const shortName = (m.name||'?').length > 9 ? (m.name||'?').slice(0,8)+'…' : (m.name||'?');
              const cells = days.map(day => {
                const mins    = m.id === 'me' ? (mbd[day.key] || 0) : 0;
                const present = mins > 0;
                const tip     = present ? `${Math.floor(mins/60)}h${mins%60}m` : '—';
                return `<div class="sr-att-cell${present ? ' sr-att-present' : ''}" title="${day.key}: ${tip}">${day.label}</div>`;
              }).join('');
              return `
                <div class="sr-att-member-row">
                  <div class="sr-att-member-av" style="background:${_avatarColor(m.name||'')}">${(m.name||'?')[0].toUpperCase()}</div>
                  <div class="sr-att-member-name">${esc(shortName)}</div>
                  <div class="sr-att-cells">${cells}</div>
                </div>`;
            }).join('')}
      </div>`;
  }

  function _renderSrRankings(g, sc) {
    const ms      = getMainState(), tk = todayKey();
    const members = g.members || [];
    const ft      = ui().focusStartTime?.();
    const ranked  = members.map(m => {
      let secs = 0;
      if (m.id === 'me') {
        const storedMins = (((ms.focusStats || {}).minutesByDate) || {})[tk] || 0;
        const elapsed    = ft ? Math.floor((Date.now() - ft) / 1000) : 0;
        secs = storedMins * 60 + elapsed;
      } else {
        secs = (m.todayKey === tk ? (m.todayMins || 0) : 0) * 60;
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
                    <div class="sr-rank-name">${esc(m.name||'Unknown')}${m.id==='me' ? ` <span class="sr-rank-you">you</span>` : ''}</div>
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
            <div class="sr-invite-stat-val">${(g.members||[]).length}</div>
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
    const ms     = getMainState();
    const myName = ms.profile?.name || 'You';
    const msgs   = (sc.chats || {})[g.id] || [];
    return `
      <div class="sr-chat-view">
        <div class="sr-chat-messages" id="sr-chat-msgs">
          ${msgs.length === 0
            ? `<div class="sr-chat-empty">No messages yet — say hello! 👋</div>`
            : msgs.map(msg => {
                const isMe = msg.authorId === 'me';
                return `
                  <div class="sr-chat-row ${isMe ? 'sr-chat-mine' : 'sr-chat-theirs'}">
                    ${!isMe ? `<div class="sr-chat-av" style="background:${_avatarColor(msg.author||'')}">${(msg.author||'?')[0].toUpperCase()}</div>` : ''}
                    <div class="sr-chat-col">
                      ${!isMe ? `<div class="sr-chat-author">${esc(msg.author||'Unknown')}</div>` : ''}
                      <div class="sr-chat-bubble">${esc(msg.text)}</div>
                      <div class="sr-chat-ts">${_chatTimeAgo(msg.ts)}</div>
                    </div>
                  </div>`;
              }).join('')}
        </div>
        <div class="sr-chat-input-area">
          <input class="sr-chat-input" id="sr-chat-input" type="text" placeholder="Type a message…"
                 maxlength="300" autocomplete="off"/>
          <button class="sr-chat-send-btn" data-sc="sr-send-chat" data-gid="${esc(g.id)}" data-author="${esc(myName)}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
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
        _groupView    = null;
        _settingsView = false;
        _srTab        = 'home';
        _stopSrTicker();
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
          if (sc2.chats) delete sc2.chats[gid];
          scSave(sc2); _groupView = null; _srTab = 'home'; _stopSrTicker();
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

      case 'sr-tab':
        if (_srTab !== (el.dataset.tab || 'home')) {
          _srTab = el.dataset.tab || 'home';
          _stopSrTicker();
          renderSocial();
        }
        break;

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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
        const others = (g.members||[]).filter(m => m.id !== 'me');
        if (!others.length) { toast('No other members to nudge yet', 'info'); break; }
        toast(`📣 Nudged ${others.length} member${others.length!==1?'s':''}! They'll be notified to study.`, 'success', 3500);
        break;
      }

      case 'sgs-toggle-chat': {
        const sc = scLoad();
        const g  = sc.groups.find(x => x.id === el.dataset.gid);
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
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
        if (!g || g.role !== 'admin') break;
        const gid = g.id;
        confirmModal(`Permanently delete "${g.name}"? This cannot be undone. All group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups   = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks    = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes    = sc2.notes.filter(n => n.groupId !== gid);
          if (sc2.chats)    delete sc2.chats[gid];
          if (sc2.requests) delete sc2.requests[gid];
          scSave(sc2);
          _groupView = null; _settingsView = false; _srTab = 'home'; _stopSrTicker();
          toast(`"${g.name}" deleted`, 'info');
          renderSocial();
        }, { title:'Delete Group?', yesLabel:'Delete', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      case 'sgs-leave-group-settings': {
        const sc  = scLoad();
        const gid = el.dataset.gid;
        const g   = sc.groups.find(x => x.id === gid);
        if (!g) break;
        confirmModal(`Leave "${g.name}"? Your local group data will be removed.`, () => {
          const sc2 = scLoad();
          sc2.groups = sc2.groups.filter(x => x.id !== gid);
          sc2.tasks  = sc2.tasks.filter(t => t.groupId !== gid);
          sc2.notes  = sc2.notes.filter(n => n.groupId !== gid);
          if (sc2.chats) delete sc2.chats[gid];
          scSave(sc2);
          _groupView = null; _settingsView = false; _srTab = 'home'; _stopSrTicker();
          toast('Left group.', 'info'); renderSocial();
        }, { title:'Leave Group?', yesLabel:'Leave', yesClass:'btn btn-danger', noLabel:'Cancel' });
        break;
      }

      case 'sr-send-chat': {
        const input  = document.getElementById('sr-chat-input');
        const text   = input ? input.value.trim() : '';
        if (!text) break;
        const gid    = el.dataset.gid;
        const author = el.dataset.author || 'You';
        const sc = scLoad();
        if (!sc.chats) sc.chats = {};
        if (!sc.chats[gid]) sc.chats[gid] = [];
        sc.chats[gid].push({ id: genId(), authorId: 'me', author, text, ts: Date.now() });
        if (sc.chats[gid].length > 100) sc.chats[gid] = sc.chats[gid].slice(-100);
        scSave(sc); renderSocial();
        setTimeout(() => {
          const msgs = document.getElementById('sr-chat-msgs');
          if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }, 60);
        break;
      }

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
      if (window._currentTab === 'social') renderSocial();
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
