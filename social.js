// social.js — Study Community System v1
// Clean-room rebuild. Completely isolated from old social system.
// Uses: window.appUI (set by script.js bridge), localStorage sc_v1

(() => {
  'use strict';

  const SC_KEY = 'sc_v1';
  const genId  = () => Math.random().toString(36).slice(2, 10);
  const genCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  // ── UI Utilities (via bridge, with safe fallbacks) ──────────────────────
  const ui       = () => window.appUI || {};
  const toast    = (msg, type, dur) => { try { ui().toast?.(msg, type, dur); } catch(e) {} };
  const openModal   = (html, cb)     => { try { ui().openModal?.(html, cb); }   catch(e) {} };
  const closeModal  = ()             => { try { ui().closeModal?.();  }          catch(e) {} };
  const confirmModal= (msg, cb, o)   => { try { ui().confirmModal?.(msg, cb, o); } catch(e) {} };
  const esc         = (s) => {
    try {
      return ui().html?.(String(s)) ?? String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    } catch(e) { return String(s ?? ''); }
  };
  const minsToHrs = (m) => { try { return ui().minsToHrs?.(m) ?? (m < 60 ? m+'m' : Math.floor(m/60)+'h '+(m%60||'')+'m').trim(); } catch(e) { return m+'m'; } };
  const todayKey  = () => { try { return ui().todayKey?.() ?? new Date().toISOString().slice(0,10); } catch(e) { return new Date().toISOString().slice(0,10); } };
  const getMainState = () => { try { return ui().state?.() ?? {}; } catch(e) { return {}; } };

  // ── Data Layer ──────────────────────────────────────────────────────────
  function scLoad() {
    try {
      const raw = localStorage.getItem(SC_KEY);
      const d = raw ? JSON.parse(raw) : {};
      return {
        groups: Array.isArray(d.groups) ? d.groups : [],
        tasks:  Array.isArray(d.tasks)  ? d.tasks  : [],
        notes:  Array.isArray(d.notes)  ? d.notes  : [],
      };
    } catch(e) { return { groups: [], tasks: [], notes: [] }; }
  }
  function scSave(d) {
    try { localStorage.setItem(SC_KEY, JSON.stringify(d)); } catch(e) {}
  }

  // ── State ───────────────────────────────────────────────────────────────
  let _tab      = 'rooms';   // 'rooms'|'groups'|'leaderboard'|'tasks'|'notes'
  let _groupView = null;     // null = list view; string = group id for detail view
  let _lbPeriod  = 'daily';  // 'daily'|'weekly'
  let _destroyed = false;    // cleanup guard

  // ── Focus Status ────────────────────────────────────────────────────────
  const isStudying = () => {
    try { return window._focusActive === true; } catch(e) { return false; }
  };

  // ── SVG Icons ───────────────────────────────────────────────────────────
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

  // ── Main Render ──────────────────────────────────────────────────────────
  function renderSocial() {
    if (_destroyed) return;
    const view = document.getElementById('view-social');
    if (!view) return;

    try {
      view.innerHTML = `
        <div class="sc-page" role="main">
          ${_renderSubNav()}
          <div class="sc-body">
            ${_renderTabContent()}
          </div>
        </div>
      `;
      _bindEvents(view);
    } catch(err) {
      console.error('[Social] Render error:', err);
      view.innerHTML = `
        <div class="sc-page">
          <div class="sc-error-state">
            <div class="sc-error-icon">⚠️</div>
            <div class="sc-error-title">Something went wrong</div>
            <div class="sc-error-sub">The community tab encountered an error.</div>
            <button class="sc-btn sc-btn-primary" onclick="if(window._socialRender)window._socialRender()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  // ── Sub-Nav ──────────────────────────────────────────────────────────────
  function _renderSubNav() {
    const tabs = [
      { id:'rooms',       label:'Rooms',    emoji:'🏠' },
      { id:'groups',      label:'Groups',   emoji:'👥' },
      { id:'leaderboard', label:'Rankings', emoji:'🏆' },
      { id:'tasks',       label:'Tasks',    emoji:'✅' },
      { id:'notes',       label:'Notes',    emoji:'📝' },
    ];
    return `
      <nav class="sc-subnav" role="tablist" aria-label="Community sections">
        ${tabs.map(t => `
          <button class="sc-subnav-btn${_tab === t.id ? ' sc-active' : ''}"
                  data-sc="tab" data-tab="${t.id}"
                  role="tab" aria-selected="${_tab === t.id}">
            <span class="sc-subnav-emoji">${t.emoji}</span>
            <span class="sc-subnav-label">${t.label}</span>
          </button>
        `).join('')}
      </nav>
    `;
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
      console.error('[Social] Tab render error:', e);
      return `<div class="sc-error-state"><div class="sc-error-icon">⚠️</div><div class="sc-error-title">Could not load this section</div></div>`;
    }
  }

  // ── Rooms ────────────────────────────────────────────────────────────────
  function _renderRooms() {
    const sc = scLoad();
    const studying = isStudying();

    if (sc.groups.length === 0) {
      return `
        <div class="sc-empty-state">
          <div class="sc-empty-icon">🏠</div>
          <div class="sc-empty-title">No Study Rooms Yet</div>
          <div class="sc-empty-sub">Create a group to get your own study room, or join one with an invite code.</div>
          <div class="sc-empty-actions">
            <button class="sc-btn sc-btn-primary" data-sc="create-group">${ICON.plus} Create Group</button>
            <button class="sc-btn sc-btn-outline" data-sc="join-group">${ICON.join} Join via Invite Code</button>
          </div>
        </div>
      `;
    }

    const ms = getMainState();
    const profileName = ms.profile?.name || 'You';
    const focusStats  = ms.focusStats || {};
    const minutesToday = (focusStats.minutesByDate || {})[todayKey()] || 0;

    const cards = sc.groups.map(g => {
      const memberCount = (g.members || []).length;
      return `
        <div class="sc-room-card" data-sc="enter-room" data-gid="${esc(g.id)}" role="button" tabindex="0">
          <div class="sc-room-top">
            <div class="sc-room-icon-wrap">
              <span class="sc-room-icon">${g.icon || '📚'}</span>
            </div>
            <div class="sc-room-info">
              <div class="sc-room-name">${esc(g.name)}</div>
              <div class="sc-room-meta">
                ${g.isPrivate ? '🔒 Private' : '🌐 Public'} &middot; ${memberCount} member${memberCount !== 1 ? 's' : ''}
              </div>
            </div>
            <span class="sc-status-dot ${studying ? 'sc-dot-on' : 'sc-dot-off'}"
                  title="${studying ? 'Studying now' : 'Offline'}">
              ${studying ? '● Studying' : '● Offline'}
            </span>
          </div>
          ${g.description ? `<div class="sc-room-desc">${esc(g.description)}</div>` : ''}
          <div class="sc-room-bottom">
            <div class="sc-room-code-row">
              <span class="sc-code-label">Code</span>
              <span class="sc-code-value">${esc(g.code)}</span>
              <button class="sc-copy-btn" data-sc="copy-code" data-code="${esc(g.code)}"
                      title="Copy invite code" aria-label="Copy code" onclick="event.stopPropagation()">
                ${ICON.copy}
              </button>
            </div>
            <div class="sc-room-stats">
              <span class="sc-room-stat">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${minsToHrs(minutesToday)} today
              </span>
            </div>
          </div>
        </div>
      `;
    });

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Study Rooms</span>
          <button class="sc-icon-btn" data-sc="create-group" title="Create room">${ICON.plus}</button>
        </div>
        <div class="sc-rooms-list">${cards.join('')}</div>
        <button class="sc-join-row-btn" data-sc="join-group">${ICON.join} Join via Invite Code</button>
      </div>
    `;
  }

  // ── Groups ───────────────────────────────────────────────────────────────
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
        </div>
      `;
    }

    const cards = sc.groups.map(g => {
      const mc = (g.members || []).length;
      return `
        <div class="sc-group-card" data-sc="open-group" data-gid="${esc(g.id)}" role="button" tabindex="0">
          <div class="sc-group-icon">${g.icon || '📚'}</div>
          <div class="sc-group-info">
            <div class="sc-group-name">${esc(g.name)}</div>
            <div class="sc-group-meta">
              ${g.isPrivate ? '🔒 Private' : '🌐 Public'} &middot;
              ${mc} member${mc !== 1 ? 's' : ''} &middot;
              Code: <strong>${esc(g.code)}</strong>
            </div>
            ${g.description ? `<div class="sc-group-desc-preview">${esc(g.description)}</div>` : ''}
          </div>
          <div class="sc-chevron">${ICON.chevron}</div>
        </div>
      `;
    });

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Your Groups</span>
          <button class="sc-icon-btn" data-sc="create-group" title="Create group">${ICON.plus}</button>
        </div>
        <div class="sc-groups-list">${cards.join('')}</div>
        <button class="sc-join-row-btn" data-sc="join-group">${ICON.join} Join via Invite Code</button>
      </div>
    `;
  }

  function _renderGroupDetail(g, sc) {
    const members   = g.members || [];
    const gTasks    = sc.tasks.filter(t => t.groupId === g.id);
    const gNotes    = sc.notes.filter(n => n.groupId === g.id);
    const pending   = gTasks.filter(t => !t.done).length;

    const memberHTML = members.length === 0
      ? `<div class="sc-empty-mini">No members listed.</div>`
      : members.map(m => `
          <div class="sc-member-row">
            <div class="sc-member-av" style="background:${_avatarColor(m.name)}">${(m.name||'?')[0].toUpperCase()}</div>
            <span class="sc-member-name">${esc(m.name || 'Unknown')}</span>
            <span class="sc-member-badge sc-badge-${m.role === 'admin' ? 'admin' : 'member'}">${m.role === 'admin' ? 'Admin' : 'Member'}</span>
          </div>
        `).join('');

    const taskHTML = gTasks.length === 0
      ? `<div class="sc-empty-mini">No group tasks yet.</div>`
      : gTasks.map(t => _taskRow(t)).join('');

    const noteHTML = gNotes.length === 0
      ? `<div class="sc-empty-mini">No group notes yet.</div>`
      : gNotes.map(n => _noteCard(n)).join('');

    return `
      <div class="sc-detail">
        <div class="sc-detail-header">
          <button class="sc-back-btn" data-sc="close-group" aria-label="Back">${ICON.back}</button>
          <span class="sc-detail-icon">${g.icon || '📚'}</span>
          <span class="sc-detail-name">${esc(g.name)}</span>
          <button class="sc-icon-btn sc-btn-danger-icon" data-sc="leave-group" data-gid="${esc(g.id)}" title="Leave group">${ICON.leave}</button>
        </div>

        <div class="sc-detail-meta">
          <span class="sc-meta-chip">${g.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
          <span class="sc-meta-chip">
            Code: <strong>${esc(g.code)}</strong>
            <button class="sc-copy-inline" data-sc="copy-code" data-code="${esc(g.code)}">Copy</button>
          </span>
        </div>

        ${g.description ? `<p class="sc-detail-desc">${esc(g.description)}</p>` : ''}

        <div class="sc-detail-block">
          <div class="sc-block-header">
            <span class="sc-block-title">Members (${members.length})</span>
          </div>
          <div class="sc-members-list">${memberHTML}</div>
        </div>

        <div class="sc-detail-block">
          <div class="sc-block-header">
            <span class="sc-block-title">Group Tasks (${pending} pending)</span>
            <button class="sc-icon-btn" data-sc="add-task" data-gid="${esc(g.id)}" title="Add task">${ICON.plus}</button>
          </div>
          <div class="sc-tasks-list">${taskHTML}</div>
        </div>

        <div class="sc-detail-block">
          <div class="sc-block-header">
            <span class="sc-block-title">Group Notes (${gNotes.length})</span>
            <button class="sc-icon-btn" data-sc="add-note" data-gid="${esc(g.id)}" title="Add note">${ICON.plus}</button>
          </div>
          <div class="sc-notes-list">${noteHTML}</div>
        </div>
      </div>
    `;
  }

  // ── Leaderboard ──────────────────────────────────────────────────────────
  function _renderLeaderboard() {
    const ms     = getMainState();
    const fStats = ms.focusStats || {};
    const mins   = fStats.minutesByDate || {};
    const today  = todayKey();

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
            <button class="sc-toggle-btn${_lbPeriod === 'daily'  ? ' sc-active' : ''}" data-sc="lb-period" data-period="daily">Daily</button>
            <button class="sc-toggle-btn${_lbPeriod === 'weekly' ? ' sc-active' : ''}" data-sc="lb-period" data-period="weekly">Weekly</button>
          </div>
        </div>

        <div class="sc-lb-you-card">
          <div class="sc-lb-you-label">Your Study Time ${_lbPeriod === 'daily' ? 'Today' : 'This Week'}</div>
          <div class="sc-lb-you-time">${minsToHrs(displayMins)}</div>
          ${studying ? '<div class="sc-lb-studying-badge">● Currently Studying</div>' : ''}
          <div class="sc-lb-progress-wrap">
            <div class="sc-lb-progress-bar" style="width:${Math.min(100, (displayMins / (_lbPeriod === 'daily' ? 480 : 3360)) * 100).toFixed(1)}%"></div>
          </div>
          <div class="sc-lb-goal-label">Goal: ${_lbPeriod === 'daily' ? '8h / day' : '56h / week'}</div>
        </div>

        ${sc.groups.length > 0 ? `
          <div class="sc-lb-groups">
            <div class="sc-block-title" style="margin-bottom:10px">My Groups</div>
            ${sc.groups.map((g, i) => `
              <div class="sc-lb-row">
                <span class="sc-lb-rank">#${i+1}</span>
                <span class="sc-lb-gicon">${g.icon || '📚'}</span>
                <span class="sc-lb-gname">${esc(g.name)}</span>
                <span class="sc-lb-gmeta">${(g.members||[]).length} members</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="sc-lb-info-card">
            <div class="sc-lb-info-icon">${ICON.trophy}</div>
            <div class="sc-lb-info-text">
              <strong>Group leaderboards</strong><br>
              Create or join a group to compete with study partners.
            </div>
          </div>
        `}

        <div class="sc-lb-streaks">
          <div class="sc-block-title" style="margin-bottom:10px">Your Stats</div>
          <div class="sc-stats-grid">
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${minsToHrs(todayMins)}</div>
              <div class="sc-stat-label">Today</div>
            </div>
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${minsToHrs(weekMins)}</div>
              <div class="sc-stat-label">This Week</div>
            </div>
            <div class="sc-stat-chip">
              <div class="sc-stat-value">${ms.streak?.current ?? ms.currentStreak ?? 0}🔥</div>
              <div class="sc-stat-label">Streak</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  function _renderTasks() {
    const sc = scLoad();
    const personalTasks = sc.tasks.filter(t => !t.groupId);
    const pendingPersonal = personalTasks.filter(t => !t.done).length;

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Tasks</span>
          <button class="sc-icon-btn" data-sc="add-task" data-gid="" title="Add personal task">${ICON.plus}</button>
        </div>

        <div class="sc-tasks-group">
          <div class="sc-tasks-label">Personal (${pendingPersonal} pending)</div>
          ${personalTasks.length === 0
            ? `<div class="sc-empty-mini">No tasks yet — tap + to add one.</div>`
            : personalTasks.map(t => _taskRow(t)).join('')
          }
          <button class="sc-add-inline-btn" data-sc="add-task" data-gid="">
            ${ICON.plus} Add personal task
          </button>
        </div>

        ${sc.groups.map(g => {
          const gTasks = sc.tasks.filter(t => t.groupId === g.id);
          const gPending = gTasks.filter(t => !t.done).length;
          return `
            <div class="sc-tasks-group">
              <div class="sc-tasks-label">${esc(g.icon||'📚')} ${esc(g.name)} (${gPending} pending)</div>
              ${gTasks.length === 0
                ? `<div class="sc-empty-mini">No group tasks yet.</div>`
                : gTasks.map(t => _taskRow(t)).join('')
              }
              <button class="sc-add-inline-btn" data-sc="add-task" data-gid="${esc(g.id)}">
                ${ICON.plus} Add group task
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function _taskRow(t) {
    return `
      <div class="sc-task-row${t.done ? ' sc-task-done' : ''}">
        <button class="sc-task-check${t.done ? ' sc-checked' : ''}"
                data-sc="toggle-task" data-tid="${esc(t.id)}"
                aria-label="${t.done ? 'Mark incomplete' : 'Mark complete'}">
          ${t.done ? ICON.check : ''}
        </button>
        <span class="sc-task-text">${esc(t.title)}</span>
        ${t.dueDate ? `<span class="sc-task-due">${esc(t.dueDate)}</span>` : ''}
        <button class="sc-task-del" data-sc="delete-task" data-tid="${esc(t.id)}" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  function _renderNotes() {
    const sc = scLoad();
    const personalNotes = sc.notes.filter(n => !n.groupId);

    if (personalNotes.length === 0 && sc.groups.every(g => sc.notes.filter(n => n.groupId === g.id).length === 0)) {
      return `
        <div class="sc-empty-state">
          <div class="sc-empty-icon">📝</div>
          <div class="sc-empty-title">No Notes Yet</div>
          <div class="sc-empty-sub">Jot down formulas, ideas, and revision notes.</div>
          <button class="sc-btn sc-btn-primary" data-sc="add-note" data-gid="">${ICON.plus} Add First Note</button>
        </div>
      `;
    }

    return `
      <div class="sc-section">
        <div class="sc-section-header">
          <span class="sc-section-title">Notes</span>
          <button class="sc-icon-btn" data-sc="add-note" data-gid="" title="Add note">${ICON.plus}</button>
        </div>

        <div class="sc-notes-group">
          <div class="sc-tasks-label">Personal (${personalNotes.length})</div>
          ${personalNotes.length === 0
            ? `<div class="sc-empty-mini">No personal notes yet.</div>`
            : personalNotes.map(n => _noteCard(n)).join('')
          }
          <button class="sc-add-inline-btn" data-sc="add-note" data-gid="">
            ${ICON.plus} Add note
          </button>
        </div>

        ${sc.groups.map(g => {
          const gNotes = sc.notes.filter(n => n.groupId === g.id);
          return `
            <div class="sc-notes-group">
              <div class="sc-tasks-label">${esc(g.icon||'📚')} ${esc(g.name)}</div>
              ${gNotes.length === 0
                ? `<div class="sc-empty-mini">No group notes yet.</div>`
                : gNotes.map(n => _noteCard(n)).join('')
              }
              <button class="sc-add-inline-btn" data-sc="add-note" data-gid="${esc(g.id)}">
                ${ICON.plus} Add group note
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function _noteCard(n) {
    const preview = (n.content || '').slice(0, 140) + ((n.content || '').length > 140 ? '…' : '');
    return `
      <div class="sc-note-card">
        <div class="sc-note-top">
          <div class="sc-note-title">${esc(n.title || 'Untitled')}</div>
          <div class="sc-note-actions">
            <button class="sc-note-btn" data-sc="edit-note" data-nid="${esc(n.id)}" title="Edit">${ICON.edit}</button>
            <button class="sc-note-btn sc-note-del" data-sc="delete-note" data-nid="${esc(n.id)}" title="Delete">${ICON.trash}</button>
          </div>
        </div>
        ${preview ? `<div class="sc-note-body">${esc(preview)}</div>` : ''}
      </div>
    `;
  }

  // ── Modals ───────────────────────────────────────────────────────────────
  const ICONS_LIST = ['📚','🎯','⚡','🔥','🚀','🧠','💡','🌟','🎓','💪','🏆','✨','🎨','🔬','🧪','📖'];

  function _modalCreateGroup() {
    let selectedIcon = '📚';
    const iconBtns = ICONS_LIST.map(ic => `
      <button class="sc-icon-pick${ic === selectedIcon ? ' sc-icon-active' : ''}"
              data-icon="${ic}" type="button">${ic}</button>
    `).join('');

    openModal(`
      <h3 class="sc-modal-title">Create Study Group</h3>
      <div class="sc-field">
        <label class="sc-label">Group Name</label>
        <input id="sc-grp-name" type="text" maxlength="40" placeholder="e.g. NEET 2026 Prep"
               class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Description <span class="sc-opt">(optional)</span></label>
        <input id="sc-grp-desc" type="text" maxlength="100" placeholder="What are you studying?"
               class="sc-input" autocomplete="off"/>
      </div>
      <div class="sc-field">
        <label class="sc-label">Icon</label>
        <div id="sc-icon-grid" class="sc-icon-grid">${iconBtns}</div>
      </div>
      <div class="sc-field">
        <label class="sc-checkbox-row">
          <input id="sc-grp-private" type="checkbox" class="sc-checkbox"/>
          <span>Private group (invite only)</span>
        </label>
      </div>
      <div id="sc-grp-err" class="sc-field-err" style="display:none"></div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-create">Create Group</button>
      </div>
    `, root => {
      const nameEl = root.querySelector('#sc-grp-name');
      const descEl = root.querySelector('#sc-grp-desc');
      const privEl = root.querySelector('#sc-grp-private');
      const errEl  = root.querySelector('#sc-grp-err');
      const submitEl = root.querySelector('#sc-do-create');
      nameEl.focus();

      root.querySelector('#sc-icon-grid').addEventListener('click', e => {
        const btn = e.target.closest('.sc-icon-pick');
        if (!btn) return;
        selectedIcon = btn.dataset.icon;
        root.querySelectorAll('.sc-icon-pick').forEach(b => b.classList.toggle('sc-icon-active', b.dataset.icon === selectedIcon));
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
          createdAt: Date.now(), role: 'admin',
          members: [{ id: 'me', name: myName, role: 'admin', joinedAt: Date.now() }]
        });
        scSave(sc);
        closeModal();
        toast(`Group "${name}" created! 🎉`, 'success');
        _tab = 'groups';
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
      const codeEl = root.querySelector('#sc-join-code');
      const errEl  = root.querySelector('#sc-join-err');
      const submitEl = root.querySelector('#sc-do-join');
      codeEl.focus();
      codeEl.addEventListener('input', () => { codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g,''); });

      const doJoin = () => {
        const code = codeEl.value.trim().toUpperCase();
        if (code.length < 4) { errEl.textContent = 'Enter a valid invite code (4–8 characters).'; errEl.style.display = ''; return; }
        const sc = scLoad();
        if (sc.groups.find(g => g.code === code)) { errEl.textContent = 'You already belong to a group with this code.'; errEl.style.display = ''; return; }
        const ms = getMainState();
        const myName = ms.profile?.name || 'You';
        sc.groups.push({
          id: genId(), name: `Group ${code}`, icon: '📚',
          code, isPrivate: false, description: '',
          createdAt: Date.now(), role: 'member',
          members: [{ id: 'me', name: myName, role: 'member', joinedAt: Date.now() }]
        });
        scSave(sc);
        closeModal();
        toast('Group joined!', 'success');
        _tab = 'groups';
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
        <input id="sc-task-title" type="text" maxlength="100"
               placeholder="e.g. Complete Chapter 5 MCQs"
               class="sc-input" autocomplete="off"/>
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
      const submitEl = root.querySelector('#sc-do-add-task');
      titleEl.focus();
      const doAdd = () => {
        const title = titleEl.value.trim();
        if (!title) { titleEl.style.borderColor = '#ef4444'; return; }
        const sc2 = scLoad();
        sc2.tasks.push({ id: genId(), title, groupId: groupId || null, done: false, dueDate: dueEl.value || null, createdAt: Date.now() });
        scSave(sc2);
        closeModal();
        toast('Task added!', 'success');
        renderSocial();
      };
      submitEl.addEventListener('click', doAdd);
      titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
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
        <label class="sc-label">Content <span class="sc-opt">(Markdown supported)</span></label>
        <textarea id="sc-note-body" rows="5" placeholder="Write here…" class="sc-textarea"></textarea>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-add-note">Save Note</button>
      </div>
    `, root => {
      const titleEl = root.querySelector('#sc-note-title');
      const bodyEl  = root.querySelector('#sc-note-body');
      const submitEl = root.querySelector('#sc-do-add-note');
      titleEl.focus();
      submitEl.addEventListener('click', () => {
        const sc2 = scLoad();
        sc2.notes.push({ id: genId(), title: titleEl.value.trim() || 'Untitled', content: bodyEl.value.trim(), groupId: groupId || null, createdAt: Date.now(), updatedAt: Date.now() });
        scSave(sc2);
        closeModal();
        toast('Note saved!', 'success');
        renderSocial();
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
        <textarea id="sc-enote-body" rows="6" class="sc-textarea">${esc(n.content || '')}</textarea>
      </div>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn sc-modal-submit" id="sc-do-edit-note">Save Changes</button>
      </div>
    `, root => {
      const titleEl = root.querySelector('#sc-enote-title');
      const bodyEl  = root.querySelector('#sc-enote-body');
      const submitEl = root.querySelector('#sc-do-edit-note');
      titleEl.focus();
      submitEl.addEventListener('click', () => {
        const sc2 = scLoad();
        const note = sc2.notes.find(x => x.id === noteId);
        if (note) { note.title = titleEl.value.trim() || 'Untitled'; note.content = bodyEl.value.trim(); note.updatedAt = Date.now(); scSave(sc2); }
        closeModal();
        toast('Note updated!', 'success');
        renderSocial();
      });
    });
  }

  // ── Event Handling ───────────────────────────────────────────────────────
  function _bindEvents(root) {
    root.addEventListener('click', _onClick);
  }

  function _onClick(e) {
    const el = e.target.closest('[data-sc]');
    if (!el) return;
    const act = el.dataset.sc;
    e.stopPropagation();
    try { _dispatch(act, el); } catch(err) { console.error('[Social] Action error:', act, err); }
  }

  function _dispatch(act, el) {
    switch (act) {
      case 'tab':
        _tab = el.dataset.tab || _tab;
        _groupView = null;
        renderSocial();
        break;

      case 'lb-period':
        _lbPeriod = el.dataset.period || 'daily';
        renderSocial();
        break;

      case 'create-group':
        _modalCreateGroup();
        break;

      case 'join-group':
        _modalJoinGroup();
        break;

      case 'open-group':
      case 'enter-room': {
        const gid = el.dataset.gid;
        if (act === 'enter-room') { _tab = 'groups'; }
        _groupView = gid;
        renderSocial();
        break;
      }

      case 'close-group':
        _groupView = null;
        renderSocial();
        break;

      case 'leave-group': {
        const gid = el.dataset.gid;
        const sc = scLoad();
        const g = sc.groups.find(x => x.id === gid);
        if (!g) break;
        confirmModal(
          `Leave "${g.name}"? Your local group data will be removed.`,
          () => {
            const sc2 = scLoad();
            sc2.groups = sc2.groups.filter(x => x.id !== gid);
            sc2.tasks  = sc2.tasks.filter(t => t.groupId !== gid);
            sc2.notes  = sc2.notes.filter(n => n.groupId !== gid);
            scSave(sc2);
            _groupView = null;
            toast('Left group.', 'info');
            renderSocial();
          },
          { title: 'Leave Group?', yesLabel: 'Leave', yesClass: 'btn btn-danger', noLabel: 'Cancel' }
        );
        break;
      }

      case 'copy-code': {
        const code = el.dataset.code || '';
        if (code) {
          navigator.clipboard.writeText(code)
            .then(() => toast(`Code ${code} copied!`, 'success'))
            .catch(() => toast(`Code: ${code}`, 'info'));
        }
        break;
      }

      case 'add-task':
        _modalAddTask(el.dataset.gid || null);
        break;

      case 'toggle-task': {
        const sc = scLoad();
        const t = sc.tasks.find(x => x.id === el.dataset.tid);
        if (t) { t.done = !t.done; scSave(sc); renderSocial(); }
        break;
      }

      case 'delete-task': {
        const sc = scLoad();
        sc.tasks = sc.tasks.filter(x => x.id !== el.dataset.tid);
        scSave(sc);
        renderSocial();
        break;
      }

      case 'add-note':
        _modalAddNote(el.dataset.gid || null);
        break;

      case 'edit-note':
        _modalEditNote(el.dataset.nid);
        break;

      case 'delete-note':
        confirmModal('Delete this note?', () => {
          const sc = scLoad();
          sc.notes = sc.notes.filter(n => n.id !== el.dataset.nid);
          scSave(sc);
          renderSocial();
        }, { title: 'Delete Note', yesLabel: 'Delete', yesClass: 'btn btn-danger', noLabel: 'Cancel' });
        break;

      default:
        break;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function _avatarColor(name) {
    const colors = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#7c3aed','#0891b2'];
    let hash = 0;
    for (let i = 0; i < (name||'').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return colors[hash % colors.length];
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    window._socialRender = renderSocial;
    // Expose focus bridge: called when focus timer changes state
    window._socialFocusUpdate = () => {
      if (window._currentTab === 'social') renderSocial();
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
