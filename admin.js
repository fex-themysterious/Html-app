'use strict';

document.addEventListener('DOMContentLoaded', () => {

  // ── Firebase Config (same project as main app) ──────────────────────────
  const FB_CONFIG = {
    apiKey:            'AIzaSyCRg1W9ueQp80kfDbS-o5VdDZmW7I9AbMQ',
    authDomain:        'study-hub-app-f3431.firebaseapp.com',
    projectId:         'study-hub-app-f3431',
    storageBucket:     'study-hub-app-f3431.firebasestorage.app',
    messagingSenderId: '18536531099',
    appId:             '1:18536531099:web:6b691f03283530c927f23e'
  };

  // ── State ──────────────────────────────────────────────────────────────
  let db, auth;
  let me = null;           // { uid, email, name, role }
  let _page = 'dashboard';
  let _unsubs = [];        // Firestore listeners to clean up
  let _charts = {};        // Chart.js instances
  let _reportTab = 'pending';
  let _usersLast = null;   // last doc for pagination
  let _usersSearch = '';
  let _pendingReports = 0;

  // ── Nav definition ─────────────────────────────────────────────────────
  const NAV = [
    { id: 'dashboard',     label: 'Dashboard',     svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { id: 'users',         label: 'Users',          svg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'groups',        label: 'Groups',         svg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { id: 'reports',       label: 'Reports',        svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>', badge: true },
    { id: 'announcements', label: 'Announcements',  svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
    { id: 'ads',           label: 'Ads Control',    svg: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' },
    { id: 'config',        label: 'Remote Config',  svg: '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>' },
    { id: 'analytics',     label: 'Analytics',      svg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
    { id: 'storage',       label: 'Storage',        svg: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
  ];

  // ── Init ───────────────────────────────────────────────────────────────
  function init() {
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    db   = firebase.firestore();
    auth = firebase.auth();

    auth.onAuthStateChanged(handleAuthState);

    // UI bindings
    $('a-btn').onclick = doLogin;
    $('a-pass').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('a-email').onkeydown = e => { if (e.key === 'Enter') $('a-pass').focus(); };
    $('logout-btn').onclick = doLogout;
    $('mob-menu').onclick = openSidebar;
    $('sidebar-close').onclick = closeSidebar;
    $('sidebar-bd').onclick = closeSidebar;
    $('refresh-btn').onclick = () => switchPage(_page);
    $('modal-bd').onclick = closeModal;
    $('modal-cls').onclick = closeModal;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }
  function fmtNum(n) {
    if (n === undefined || n === null) return '—';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return String(n);
  }
  function ago(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const s = Math.floor((Date.now() - d) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400)return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }
  function unsubAll() { _unsubs.forEach(u => { try { u(); } catch(_) {} }); _unsubs = []; }
  function destroyCharts() { Object.values(_charts).forEach(c => { try { c.destroy(); } catch(_) {} }); _charts = {}; }
  function setConn(ok) { $('conn-dot').className = 'conn-dot ' + (ok ? 'connected' : 'disconnected'); }

  // ── Auth ───────────────────────────────────────────────────────────────
  async function handleAuthState(user) {
    if (!user) { showLogin(); return; }
    try {
      const snap = await db.collection('admins').doc(user.uid).get();
      if (!snap.exists) { await auth.signOut(); showLogin('Access denied. You are not an authorized admin.'); return; }
      const data = snap.data();
      me = { uid: user.uid, email: user.email, name: data.name || user.email.split('@')[0], role: data.role || 'admin' };
      showApp();
    } catch (e) {
      showLogin('Error checking access: ' + e.message);
    }
  }

  async function doLogin() {
    const email = $('a-email').value.trim();
    const pass  = $('a-pass').value;
    if (!email || !pass) { showLoginErr('Please fill in all fields.'); return; }
    const btn = $('a-btn'); btn.textContent = 'Signing in…'; btn.disabled = true;
    hideLoginErr();
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
      showLoginErr(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
        ? 'Invalid email or password.' : e.message);
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  }

  function doLogout() {
    unsubAll(); destroyCharts();
    auth.signOut().then(() => { $('app').style.display = 'none'; showLogin(); });
  }

  function showLogin(err) {
    $('auth-wrap').style.display = '';
    $('a-btn').textContent = 'Sign In'; $('a-btn').disabled = false;
    if (err) showLoginErr(err);
  }
  function showLoginErr(msg) { const e = $('a-error'); e.textContent = msg; e.style.display = ''; }
  function hideLoginErr()    { $('a-error').style.display = 'none'; }

  // ── App setup ──────────────────────────────────────────────────────────
  function showApp() {
    $('auth-wrap').style.display = 'none';
    $('app').style.display = '';
    $('admin-av').textContent = (me.name[0] || 'A').toUpperCase();
    $('admin-name').textContent = me.name;
    $('admin-role').textContent = roleLabel(me.role);
    renderNav();
    watchPendingReports();
    setConn(true);
    switchPage('dashboard');
  }

  function roleLabel(r) {
    return { super_admin: 'Super Admin', admin: 'Admin', moderator: 'Moderator' }[r] || r;
  }

  function renderNav() {
    const nav = $('sidebar-nav');
    nav.innerHTML = '';
    NAV.forEach(item => {
      const a = el('div', 'nav-item' + (_page === item.id ? ' active' : ''));
      a.dataset.id = item.id;
      a.innerHTML = `<span class="nav-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${item.svg}</svg></span>
        <span class="nav-label">${item.label}</span>
        ${item.badge && _pendingReports > 0 ? `<span class="nav-badge">${_pendingReports}</span>` : ''}`;
      a.onclick = () => { switchPage(item.id); closeSidebar(); };
      nav.appendChild(a);
    });
  }

  function switchPage(id) {
    _page = id;
    $('page-title').textContent = NAV.find(n => n.id === id)?.label || id;
    renderNav();
    unsubAll(); destroyCharts();
    const pages = {
      dashboard: renderDashboard, users: renderUsers, groups: renderGroups,
      reports: renderReports, announcements: renderAnnouncements,
      ads: renderAds, config: renderConfig, analytics: renderAnalytics,
      storage: renderStorage,
    };
    (pages[id] || renderDashboard)();
  }

  function openSidebar()  { $('sidebar').classList.add('open'); $('sidebar-bd').classList.add('open'); }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-bd').classList.remove('open'); }

  // ── Pending reports badge ──────────────────────────────────────────────
  function watchPendingReports() {
    const unsub = db.collection('reports').where('status','==','pending')
      .onSnapshot(snap => { _pendingReports = snap.size; renderNav(); }, () => {});
    _unsubs.push(unsub);
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: DASHBOARD
  // ═══════════════════════════════════════════════════════════
  async function renderDashboard() {
    const c = $('page-content');
    c.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    try {
      const [userSnap, groupSnap, reportSnap, lbSnap] = await Promise.all([
        db.collection('user_index').limit(1000).get(),
        db.collection('groups').limit(500).get(),
        db.collection('reports').where('status','==','pending').get(),
        db.collection('global_lb').limit(1000).get(),
      ]);

      const totalUsers   = userSnap.size;
      const totalGroups  = groupSnap.size;
      const pendingReps  = reportSnap.size;
      const totalLb      = lbSnap.size;

      const now = Date.now();
      const day = 86400000;
      const activeToday = userSnap.docs.filter(d => {
        const la = d.data().lastActive;
        if (!la) return false;
        const t = la.toDate ? la.toDate().getTime() : la;
        return (now - t) < day;
      }).length;

      const bannedCount = userSnap.docs.filter(d => d.data().banned).length;

      // Recent activity
      const recentReps = reportSnap.docs.slice(0, 5);

      c.innerHTML = `
        <div class="stats-grid">
          ${statCard('Total Users', fmtNum(totalUsers), 'blue', userIcon())}
          ${statCard('Active Today', fmtNum(activeToday), 'green', actIcon())}
          ${statCard('Study Groups', fmtNum(totalGroups), 'purple', grpIcon())}
          ${statCard('Leaderboard', fmtNum(totalLb), 'orange', lbIcon())}
          ${statCard('Pending Reports', fmtNum(pendingReps), pendingReps > 0 ? 'red' : 'green', flagIcon())}
          ${statCard('Banned Users', fmtNum(bannedCount), bannedCount > 0 ? 'red' : 'green', banIcon())}
        </div>
        <div class="grid-2">
          <div class="card">
            <div class="card-hdr">
              <div class="card-title">Recent Reports</div>
              <button class="btn btn-sm btn-secondary" onclick="adminSwitchPage('reports')">View All</button>
            </div>
            <div id="recent-reps">
              ${pendingReps === 0
                ? '<div class="empty-state" style="padding:30px"><p>No pending reports</p></div>'
                : recentReps.map(d => {
                    const r = d.data();
                    return `<div class="activity-item">
                      <div class="activity-dot" style="background:var(--danger)"></div>
                      <div class="activity-text"><strong>${esc(r.reason||'Report')}</strong><br><span class="text-muted text-sm">${esc(r.targetType)} · ${esc(r.reporterEmail||'—')}</span></div>
                      <div class="activity-time">${ago(r.createdAt)}</div>
                    </div>`;
                  }).join('')
              }
            </div>
          </div>
          <div class="card">
            <div class="card-hdr"><div class="card-title">Quick Actions</div></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="btn btn-secondary w-full" onclick="adminSwitchPage('announcements')">📢 Send Announcement</button>
              <button class="btn btn-secondary w-full" onclick="adminSwitchPage('config')">⚙️ Remote Config</button>
              <button class="btn btn-secondary w-full" onclick="adminSwitchPage('ads')">💰 Ads Control</button>
              <button class="btn btn-secondary w-full" onclick="adminSwitchPage('users')">👥 User Management</button>
              <button class="btn btn-secondary w-full" onclick="adminSwitchPage('analytics')">📈 View Analytics</button>
            </div>
          </div>
        </div>
        <div class="mt-4">
          <div class="card">
            <div class="card-hdr"><div class="card-title">System Status</div></div>
            <div class="card-body">
              <div class="info-row"><label>Firebase Auth</label><span class="badge badge-success">Operational</span></div>
              <div class="info-row"><label>Firestore Database</label><span class="badge badge-success">Operational</span></div>
              <div class="info-row"><label>Admin Panel</label><span class="badge badge-success">Online</span></div>
              <div class="info-row"><label>Logged in as</label><span>${esc(me.email)} <span class="badge badge-accent">${esc(roleLabel(me.role))}</span></span></div>
            </div>
          </div>
        </div>`;

      window.adminSwitchPage = switchPage;
    } catch (e) {
      c.innerHTML = errState(e.message);
    }
  }

  function statCard(label, val, color, icon) {
    return `<div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon ${color}">${icon}</div>
      </div>
      <div class="stat-val">${val}</div>
      <div class="stat-label">${label}</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: USERS
  // ═══════════════════════════════════════════════════════════
  async function renderUsers() {
    const c = $('page-content');
    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">User Management</div>
        <div class="section-actions">
          <div class="search-bar">
            <span class="search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
            <input class="search-input" id="user-search" placeholder="Search by name or email…" value="${esc(_usersSearch)}">
          </div>
          <button class="btn btn-secondary" id="add-admin-btn">+ Add Admin</button>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>User</th><th>Level / XP</th><th>Streak</th><th>Last Active</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody id="users-tbody"><tr><td colspan="6" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
        <div class="pagination" id="users-pagination"></div>
      </div>`;

    $('user-search').oninput = debounce(e => { _usersSearch = e.target.value.trim(); _usersLast = null; loadUsers(); }, 400);
    $('add-admin-btn').onclick = () => showAddAdminModal();
    _usersLast = null;
    loadUsers();
  }

  async function loadUsers(direction) {
    const tbody = $('users-tbody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>';

    try {
      let q = db.collection('user_index').orderBy('lastActive', 'desc').limit(25);
      if (_usersSearch) {
        q = db.collection('user_index')
          .where('email', '>=', _usersSearch)
          .where('email', '<=', _usersSearch + '\uf8ff')
          .limit(25);
      }
      if (direction === 'next' && _usersLast) q = q.startAfter(_usersLast);

      const snap = await q.get();

      if (snap.empty) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>No users found</p><small>Users appear here after first login.</small></div></td></tr>';
        return;
      }

      _usersLast = snap.docs[snap.docs.length - 1];

      tbody.innerHTML = snap.docs.map(doc => {
        const u = doc.data();
        const uid = doc.id;
        const banned = u.banned;
        return `<tr>
          <td>
            <div style="font-weight:500">${esc(u.displayName || u.name || '—')}</div>
            <div class="text-muted text-sm">${esc(u.email || '—')}</div>
            <div class="text-sm" style="color:var(--dim);font-size:10px">${uid.slice(0,14)}…</div>
          </td>
          <td>Lv ${u.level||1} · <span style="color:var(--warning)">${fmtNum(u.xpTotal||0)} XP</span></td>
          <td>${u.studyStreak||0} 🔥</td>
          <td>${ago(u.lastActive)}</td>
          <td>${banned
            ? '<span class="badge badge-danger">Banned</span>'
            : '<span class="badge badge-success">Active</span>'}</td>
          <td><div class="actions-cell">
            <button class="btn btn-sm btn-secondary" onclick="adminViewUser('${uid}')">View</button>
            <button class="btn btn-sm ${banned ? 'btn-success' : 'btn-warning'}" onclick="adminToggleBan('${uid}','${esc(u.displayName||u.email||uid)}',${banned})">
              ${banned ? 'Unban' : 'Ban'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="adminDeleteUser('${uid}','${esc(u.displayName||u.email||uid)}')">Del</button>
          </div></td>
        </tr>`;
      }).join('');

      // Expose global handlers
      window.adminViewUser    = viewUser;
      window.adminToggleBan   = toggleBan;
      window.adminDeleteUser  = deleteUser;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>${esc(e.message)}</p><small>Make sure user_index collection exists.</small></div></td></tr>`;
    }
  }

  async function viewUser(uid) {
    openModal('User Profile', '<div class="loading-row"><div class="spinner"></div></div>', '');
    try {
      const [uSnap, lbSnap] = await Promise.all([
        db.collection('user_index').doc(uid).get(),
        db.collection('global_lb').doc(uid).get(),
      ]);
      const u  = uSnap.exists  ? uSnap.data()  : {};
      const lb = lbSnap.exists ? lbSnap.data() : {};

      $('modal-body').innerHTML = `
        <div class="profile-grid">
          <div class="profile-field"><label>Display Name</label><value>${esc(u.displayName||u.name||'—')}</value></div>
          <div class="profile-field"><label>Email</label><value>${esc(u.email||'—')}</value></div>
          <div class="profile-field"><label>UID</label><value style="font-size:11px;word-break:break-all">${uid}</value></div>
          <div class="profile-field"><label>Level</label><value>${u.level||1}</value></div>
          <div class="profile-field"><label>XP Total</label><value>${fmtNum(u.xpTotal||lb.xpTotal||0)}</value></div>
          <div class="profile-field"><label>Weekly XP</label><value>${fmtNum(lb.weeklyXP||0)}</value></div>
          <div class="profile-field"><label>Study Streak</label><value>${u.studyStreak||0} days 🔥</value></div>
          <div class="profile-field"><label>Focus Minutes</label><value>${fmtNum(lb.totalFocusMinutes||0)}</value></div>
          <div class="profile-field"><label>Joined</label><value>${fmtDate(u.createdAt)}</value></div>
          <div class="profile-field"><label>Last Active</label><value>${fmtTime(u.lastActive)}</value></div>
          <div class="profile-field"><label>Status</label><value>${u.banned ? '<span class="text-danger">Banned</span>' : '<span class="text-success">Active</span>'}</value></div>
          <div class="profile-field"><label>Ban Reason</label><value>${esc(u.banReason||'—')}</value></div>
        </div>`;
      $('modal-foot').innerHTML = `
        <button class="btn btn-secondary" onclick="closeAdminModal()">Close</button>
        <button class="btn ${u.banned ? 'btn-success':'btn-warning'}" onclick="adminToggleBan('${uid}','${esc(u.displayName||u.email||uid)}',${u.banned});closeAdminModal()">
          ${u.banned ? 'Unban' : 'Ban User'}
        </button>`;
      window.closeAdminModal = closeModal;
    } catch (e) {
      $('modal-body').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    }
  }

  function toggleBan(uid, name, isBanned) {
    if (isBanned) {
      db.collection('user_index').doc(uid).update({ banned: false, banReason: '' })
        .then(() => { toast(`${name} unbanned.`, 'success'); loadUsers(); })
        .catch(e => toast(e.message, 'error'));
    } else {
      openModal('Ban User', `
        <p>Ban <strong>${esc(name)}</strong>? They will lose access to cloud sync and social features.</p>
        <div class="form-group"><label class="form-label">Reason (optional)</label>
          <input id="ban-reason" class="form-input" placeholder="Spam, abuse, etc.">
        </div>`,
        `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
         <button class="btn btn-danger" onclick="confirmBan('${uid}','${esc(name)}')">Confirm Ban</button>`
      );
      window.confirmBan = (uid, name) => {
        const reason = $('ban-reason')?.value || '';
        db.collection('user_index').doc(uid).update({ banned: true, banReason: reason })
          .then(() => { toast(`${name} banned.`, 'success'); closeModal(); loadUsers(); })
          .catch(e => toast(e.message, 'error'));
      };
      window.closeAdminModal = closeModal;
    }
  }

  function deleteUser(uid, name) {
    openModal('Delete User', `<p class="text-danger">Permanently delete <strong>${esc(name)}</strong>? This removes their user_index record. Firestore data under users/${uid} will remain until manually deleted.</p>`,
      `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
       <button class="btn btn-danger" onclick="confirmDeleteUser('${uid}','${esc(name)}')">Delete</button>`
    );
    window.confirmDeleteUser = (uid, name) => {
      db.collection('user_index').doc(uid).delete()
        .then(() => { toast(`${name} deleted from index.`, 'success'); closeModal(); loadUsers(); })
        .catch(e => toast(e.message, 'error'));
    };
    window.closeAdminModal = closeModal;
  }

  function showAddAdminModal() {
    openModal('Add Admin', `
      <p class="text-muted text-sm" style="margin-bottom:10px">Enter the Firebase UID and details of the admin to add. The user must have a Firebase account.</p>
      <div class="form-group"><label class="form-label">Firebase UID</label><input id="new-uid" class="form-input" placeholder="Firebase UID"></div>
      <div class="form-group"><label class="form-label">Name</label><input id="new-name" class="form-input" placeholder="Admin name"></div>
      <div class="form-group"><label class="form-label">Email</label><input id="new-email" class="form-input" placeholder="Email address"></div>
      <div class="form-group"><label class="form-label">Role</label>
        <select id="new-role" class="form-input">
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>`,
      `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
       <button class="btn btn-primary" onclick="confirmAddAdmin()">Add Admin</button>`
    );
    window.closeAdminModal = closeModal;
    window.confirmAddAdmin = () => {
      const uid   = $('new-uid')?.value.trim();
      const name  = $('new-name')?.value.trim();
      const email = $('new-email')?.value.trim();
      const role  = $('new-role')?.value;
      if (!uid || !name || !email) { toast('Fill all fields.', 'error'); return; }
      db.collection('admins').doc(uid).set({ name, email, role, addedAt: firebase.firestore.FieldValue.serverTimestamp(), addedBy: me.uid })
        .then(() => { toast('Admin added successfully.', 'success'); closeModal(); })
        .catch(e => toast(e.message, 'error'));
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: GROUPS
  // ═══════════════════════════════════════════════════════════
  async function renderGroups() {
    const c = $('page-content');
    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">Group Management</div>
        <div class="section-actions">
          <div class="search-bar">
            <span class="search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span>
            <input class="search-input" id="grp-search" placeholder="Search by room code or name…">
          </div>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Room</th><th>Created By</th><th>Members</th><th>Created</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody id="groups-tbody"><tr><td colspan="6" style="text-align:center;padding:40px"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('grp-search').oninput = debounce(loadGroups, 400);
    loadGroups();
  }

  async function loadGroups() {
    const tbody = $('groups-tbody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr>';
    const search = ($('grp-search')?.value || '').trim().toUpperCase();

    try {
      const snap = await db.collection('groups').orderBy('createdAt', 'desc').limit(100).get();

      const docs = search
        ? snap.docs.filter(d => d.id.includes(search) || (d.data().roomName||'').toUpperCase().includes(search))
        : snap.docs;

      if (!docs.length) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:40px"><p>No groups found</p></div></td></tr>';
        return;
      }

      tbody.innerHTML = docs.map(doc => {
        const g = doc.data();
        const closed = g.closed;
        return `<tr>
          <td>
            <div style="font-weight:600;font-family:monospace">${doc.id}</div>
            <div class="text-muted text-sm">${esc(g.roomName||'Unnamed')}</div>
          </td>
          <td class="text-sm">${esc(g.createdBy||'—').slice(0,16)}…</td>
          <td>${(g.kickedMembers||[]).length ? `<span title="${(g.kickedMembers||[]).length} kicked" class="text-warning">⚠ ${(g.kickedMembers||[]).length} kicked</span><br>` : ''}</td>
          <td class="text-sm">${fmtDate(g.createdAt)}</td>
          <td>${closed ? '<span class="badge badge-danger">Closed</span>' : '<span class="badge badge-success">Active</span>'}</td>
          <td><div class="actions-cell">
            <button class="btn btn-sm btn-secondary" onclick="adminViewGroup('${doc.id}')">View</button>
            <button class="btn btn-sm ${closed ? 'btn-success':'btn-warning'}" onclick="adminToggleGroup('${doc.id}',${closed})">${closed ? 'Reopen':'Close'}</button>
            <button class="btn btn-sm btn-danger" onclick="adminDeleteGroup('${doc.id}')">Del</button>
          </div></td>
        </tr>`;
      }).join('');

      window.adminViewGroup   = viewGroup;
      window.adminToggleGroup = toggleGroup;
      window.adminDeleteGroup = deleteGroup;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>${esc(e.message)}</p></div></td></tr>`;
    }
  }

  async function viewGroup(code) {
    openModal(`Group: ${code}`, '<div class="loading-row"><div class="spinner"></div></div>', '');
    try {
      const [gSnap, memSnap, msgSnap] = await Promise.all([
        db.collection('groups').doc(code).get(),
        db.collection('groups').doc(code).collection('members').get(),
        db.collection('groups').doc(code).collection('messages').orderBy('sentAt','desc').limit(5).get(),
      ]);
      const g = gSnap.data() || {};
      $('modal-body').innerHTML = `
        <div class="info-row"><label>Room Code</label><span style="font-family:monospace;font-weight:700">${code}</span></div>
        <div class="info-row"><label>Name</label><span>${esc(g.roomName||'—')}</span></div>
        <div class="info-row"><label>Description</label><span>${esc(g.description||'—')}</span></div>
        <div class="info-row"><label>Creator UID</label><span style="font-size:11px">${esc(g.createdBy||'—')}</span></div>
        <div class="info-row"><label>Created</label><span>${fmtDate(g.createdAt)}</span></div>
        <div class="info-row"><label>Status</label><span>${g.closed ? '<span class="text-danger">Closed</span>' : '<span class="text-success">Active</span>'}</span></div>
        <div class="info-row"><label>Private</label><span>${g.private ? 'Yes' : 'No'}</span></div>
        <div class="info-row"><label>Members (persistent)</label><span>${memSnap.size}</span></div>
        <div class="info-row"><label>Kicked Members</label><span>${(g.kickedMembers||[]).length}</span></div>
        <div class="info-row"><label>Chat Enabled</label><span>${g.chatEnabled !== false ? 'Yes' : 'No'}</span></div>
        <div class="info-row"><label>Recent Messages</label><span>${msgSnap.size}</span></div>`;
      $('modal-foot').innerHTML = `<button class="btn btn-secondary" onclick="closeAdminModal()">Close</button>`;
      window.closeAdminModal = closeModal;
    } catch (e) {
      $('modal-body').innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`;
    }
  }

  function toggleGroup(code, isClosed) {
    db.collection('groups').doc(code).update({ closed: !isClosed })
      .then(() => { toast(`Group ${code} ${isClosed ? 'reopened' : 'closed'}.`, 'success'); loadGroups(); })
      .catch(e => toast(e.message, 'error'));
  }

  function deleteGroup(code) {
    openModal('Delete Group', `<p class="text-danger">Delete group <strong>${code}</strong>? This only removes the group document. Subcollections (messages, presence) must be deleted from Firebase Console.</p>`,
      `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
       <button class="btn btn-danger" onclick="confirmDeleteGroup('${code}')">Delete Group</button>`
    );
    window.confirmDeleteGroup = (c) => {
      db.collection('groups').doc(c).delete()
        .then(() => { toast(`Group ${c} deleted.`, 'success'); closeModal(); loadGroups(); })
        .catch(e => toast(e.message, 'error'));
    };
    window.closeAdminModal = closeModal;
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: REPORTS
  // ═══════════════════════════════════════════════════════════
  function renderReports() {
    const c = $('page-content');
    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">Report Queue</div>
      </div>
      <div class="tabs">
        <div class="tab ${_reportTab==='pending' ? 'active':''}" onclick="setReportTab('pending')">Pending <span id="rep-pending-count"></span></div>
        <div class="tab ${_reportTab==='resolved'? 'active':''}" onclick="setReportTab('resolved')">Resolved</div>
        <div class="tab ${_reportTab==='rejected'? 'active':''}" onclick="setReportTab('rejected')">Rejected</div>
      </div>
      <div id="reports-content"></div>`;
    window.setReportTab = (tab) => { _reportTab = tab; renderReports(); };
    loadReports();
  }

  async function loadReports() {
    const rc = $('reports-content'); if (!rc) return;
    rc.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    try {
      const snap = await db.collection('reports').where('status','==',_reportTab)
        .orderBy('createdAt','desc').limit(50).get();

      if (_reportTab === 'pending') {
        const pc = $('rep-pending-count');
        if (pc) pc.innerHTML = snap.size > 0 ? `<span class="nav-badge" style="margin-left:6px">${snap.size}</span>` : '';
      }

      if (snap.empty) {
        rc.innerHTML = '<div class="empty-state" style="padding:60px"><p>No ' + _reportTab + ' reports</p></div>';
        return;
      }

      rc.innerHTML = snap.docs.map(doc => {
        const r = doc.data();
        const rid = doc.id;
        return `<div class="report-card">
          <div class="report-hdr">
            <div>
              <div style="font-weight:600">${esc(r.reason||'No reason given')}</div>
              <div class="report-meta">
                ${esc(r.targetType||'Unknown')} report · by ${esc(r.reporterEmail||r.reporterId||'—')} · ${ago(r.createdAt)}
              </div>
            </div>
            <span class="badge ${r.status==='pending'?'badge-warning':r.status==='resolved'?'badge-success':'badge-danger'}">${r.status}</span>
          </div>
          <div class="report-body">
            <strong>Target:</strong> ${esc(r.targetId||'—')}<br>
            <strong>Content:</strong> ${esc(r.targetContent||'—')}
          </div>
          ${r.moderatorNote ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">📝 ${esc(r.moderatorNote)}</div>` : ''}
          ${r.status === 'pending' ? `
          <div class="report-actions">
            <button class="btn btn-sm btn-success" onclick="resolveReport('${rid}','resolved')">✓ Resolve</button>
            <button class="btn btn-sm btn-danger" onclick="resolveReport('${rid}','rejected')">✗ Reject</button>
            <button class="btn btn-sm btn-secondary" onclick="resolveWithNote('${rid}')">📝 Note & Resolve</button>
          </div>` : `
          <div class="text-sm text-muted">Handled by ${esc(r.resolvedBy||'admin')} · ${fmtDate(r.resolvedAt)}</div>`}
        </div>`;
      }).join('');

      window.resolveReport = (rid, status) => {
        db.collection('reports').doc(rid).update({
          status, resolvedAt: firebase.firestore.FieldValue.serverTimestamp(), resolvedBy: me.email
        }).then(() => { toast('Report ' + status + '.', 'success'); loadReports(); })
          .catch(e => toast(e.message, 'error'));
      };
      window.resolveWithNote = (rid) => {
        openModal('Add Note & Resolve', `
          <div class="form-group"><label class="form-label">Moderator Note</label>
            <textarea id="mod-note" class="form-input" placeholder="Action taken, reason…"></textarea>
          </div>`,
          `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
           <button class="btn btn-primary" onclick="confirmResolveNote('${rid}')">Resolve</button>`
        );
        window.closeAdminModal = closeModal;
        window.confirmResolveNote = (rid) => {
          const note = $('mod-note')?.value || '';
          db.collection('reports').doc(rid).update({
            status: 'resolved', moderatorNote: note,
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp(), resolvedBy: me.email
          }).then(() => { toast('Report resolved.', 'success'); closeModal(); loadReports(); })
            .catch(e => toast(e.message, 'error'));
        };
      };
    } catch (e) {
      rc.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><small>Create a 'reports' collection in Firestore to get started.</small></div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: ADS CONTROL
  // ═══════════════════════════════════════════════════════════
  async function renderAds() {
    const c = $('page-content');
    c.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    let cfg = {};
    try {
      const snap = await db.collection('admin_config').doc('ads').get();
      cfg = snap.exists ? snap.data() : {};
    } catch (_) {}

    const def = (key, fallback) => cfg[key] !== undefined ? cfg[key] : fallback;

    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">Ads Control</div>
        <div class="section-actions">
          <button class="btn btn-primary" id="save-ads-btn">Save Changes</button>
        </div>
      </div>

      <!-- Global switch -->
      <div class="config-section">
        <div class="config-section-hdr">🌐 Global Ad Settings</div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">All Ads</div><div class="config-desc">Master switch — disables all ad types when off</div></div>
          <label class="toggle"><input type="checkbox" id="ads-enabled" ${def('enabled',true)?'checked':''}><span class="toggle-track"></span></label>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Test Mode</div><div class="config-desc">Show test/dummy ads (for development)</div></div>
          <label class="toggle"><input type="checkbox" id="ads-test" ${def('testMode',false)?'checked':''}><span class="toggle-track"></span></label>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Ad Cooldown (seconds)</div><div class="config-desc">Minimum wait between consecutive ads</div></div>
          <input type="number" class="form-input" id="ads-cooldown" value="${def('cooldown',300)}" min="0" max="3600" style="width:100px;text-align:center">
        </div>
      </div>

      <!-- Ad types -->
      <div class="ads-grid">
        ${adTypeCard('Banner',       'banner',       cfg)}
        ${adTypeCard('Interstitial', 'interstitial', cfg)}
        ${adTypeCard('Rewarded',     'rewarded',     cfg)}
        ${adTypeCard('Native',       'native',       cfg)}
      </div>

      <!-- Stats -->
      <div class="config-section">
        <div class="config-section-hdr">📊 Ad Performance (stored in Firestore)</div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Impressions</div></div>
          <span class="font-600">${fmtNum(cfg.impressions||0)}</span>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Clicks</div></div>
          <span class="font-600">${fmtNum(cfg.clicks||0)}</span>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Rewarded Completions</div></div>
          <span class="font-600">${fmtNum(cfg.rewardedCompletions||0)}</span>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Est. Revenue</div></div>
          <span class="font-600 text-success">$${(cfg.estRevenue||0).toFixed(2)}</span>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Reset Stats</div></div>
          <button class="btn btn-sm btn-danger" id="reset-ad-stats">Reset</button>
        </div>
      </div>`;

    $('save-ads-btn').onclick = saveAds;
    $('reset-ad-stats').onclick = () => {
      openModal('Reset Ad Stats', '<p class="text-danger">This will reset all impression, click, and revenue counters to zero.</p>',
        `<button class="btn btn-secondary" onclick="closeAdminModal()">Cancel</button>
         <button class="btn btn-danger" onclick="confirmResetAds()">Reset</button>`
      );
      window.closeAdminModal = closeModal;
      window.confirmResetAds = () => {
        db.collection('admin_config').doc('ads').set({ impressions:0, clicks:0, rewardedCompletions:0, estRevenue:0 }, { merge:true })
          .then(() => { toast('Stats reset.', 'success'); closeModal(); renderAds(); })
          .catch(e => toast(e.message,'error'));
      };
    };
  }

  function adTypeCard(label, key, cfg) {
    const t = cfg[key] || {};
    const enabled = t.enabled !== false;
    return `<div class="ad-card">
      <div class="ad-card-top">
        <div class="ad-type-name">${label}</div>
        <label class="toggle"><input type="checkbox" id="ad-${key}-enabled" ${enabled?'checked':''}><span class="toggle-track"></span></label>
      </div>
      <div class="form-group">
        <label class="form-label">Frequency (per session)</label>
        <input type="number" class="form-input" id="ad-${key}-freq" value="${t.frequency||3}" min="1" max="20">
      </div>
      <div class="form-group" style="margin-top:8px">
        <label class="form-label">Placement</label>
        <select class="form-input" id="ad-${key}-placement">
          <option value="default" ${(t.placement||'default')==='default'?'selected':''}>Default</option>
          <option value="top" ${t.placement==='top'?'selected':''}>Top</option>
          <option value="bottom" ${t.placement==='bottom'?'selected':''}>Bottom</option>
          <option value="feed" ${t.placement==='feed'?'selected':''}>In-Feed</option>
        </select>
      </div>
    </div>`;
  }

  function saveAds() {
    const data = {
      enabled:  $('ads-enabled').checked,
      testMode: $('ads-test').checked,
      cooldown: parseInt($('ads-cooldown').value)||300,
      banner:       { enabled: $('ad-banner-enabled').checked,       frequency: parseInt($('ad-banner-freq').value)||3,       placement: $('ad-banner-placement').value },
      interstitial: { enabled: $('ad-interstitial-enabled').checked, frequency: parseInt($('ad-interstitial-freq').value)||3, placement: $('ad-interstitial-placement').value },
      rewarded:     { enabled: $('ad-rewarded-enabled').checked,     frequency: parseInt($('ad-rewarded-freq').value)||3,     placement: $('ad-rewarded-placement').value },
      native:       { enabled: $('ad-native-enabled').checked,       frequency: parseInt($('ad-native-freq').value)||3,       placement: $('ad-native-placement').value },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: me.email,
    };
    db.collection('admin_config').doc('ads').set(data, { merge: true })
      .then(() => toast('Ads config saved. Changes apply on next app load.', 'success'))
      .catch(e => toast(e.message, 'error'));
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: REMOTE CONFIG
  // ═══════════════════════════════════════════════════════════
  async function renderConfig() {
    const c = $('page-content');
    c.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    let cfg = {};
    try {
      const snap = await db.collection('admin_config').doc('remote').get();
      cfg = snap.exists ? snap.data() : {};
    } catch (_) {}

    const def = (k, fb) => cfg[k] !== undefined ? cfg[k] : fb;

    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">Remote Config</div>
        <div class="section-actions">
          <button class="btn btn-primary" id="save-cfg-btn">Save & Push</button>
        </div>
      </div>
      <div style="background:var(--warning-bg);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12.5px;color:var(--warning)">
        ⚠ Changes apply immediately to all app users. Double-check before saving.
      </div>

      <div class="config-section">
        <div class="config-section-hdr">🚨 App Status</div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Maintenance Mode</div><div class="config-desc">Shows a maintenance screen and blocks app usage</div></div>
          <label class="toggle"><input type="checkbox" id="cfg-maintenance" ${def('maintenanceMode',false)?'checked':''}><span class="toggle-track"></span></label>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Maintenance Message</div></div>
          <input class="form-input" id="cfg-maint-msg" value="${esc(def('maintenanceMessage','We are down for maintenance. Back soon!'))}" style="width:260px">
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Force Update</div><div class="config-desc">Blocks app until user updates</div></div>
          <label class="toggle"><input type="checkbox" id="cfg-force-update" ${def('forceUpdate',false)?'checked':''}><span class="toggle-track"></span></label>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Min Required Version</div></div>
          <input class="form-input" id="cfg-min-version" value="${esc(def('minVersion','1.0.0'))}" style="width:120px">
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Update Message</div></div>
          <input class="form-input" id="cfg-update-msg" value="${esc(def('updateMessage','A new version is available. Please update the app.'))}" style="width:260px">
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-hdr">🎛 Feature Flags</div>
        ${cfgToggle('Social Study Rooms', 'cfg-social', def('socialEnabled',true), 'Enable/disable the Social tab entirely')}
        ${cfgToggle('Focus Timer',        'cfg-focus',  def('focusEnabled',true),  'Enable/disable the Focus tab')}
        ${cfgToggle('Shop / Marketplace', 'cfg-shop',   def('shopEnabled',true),   'Enable/disable the item shop')}
        ${cfgToggle('Cloud Sync',         'cfg-sync',   def('syncEnabled',true),   'Enable/disable Firebase cloud sync for users')}
        ${cfgToggle('Leaderboards',       'cfg-lb',     def('leaderboardEnabled',true), 'Show/hide global leaderboard')}
        ${cfgToggle('Push Notifications', 'cfg-notifs', def('notifsEnabled',true), 'Enable/disable scheduled notifications')}
        ${cfgToggle('Ads',                'cfg-ads',    def('adsEnabled',true),    'Global ad toggle (also in Ads Control)')}
      </div>

      <div class="config-section">
        <div class="config-section-hdr">📣 Announcement Banner</div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Show Banner</div><div class="config-desc">Show a sticky banner at top of app</div></div>
          <label class="toggle"><input type="checkbox" id="cfg-banner-show" ${def('showBanner',false)?'checked':''}><span class="toggle-track"></span></label>
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Banner Text</div></div>
          <input class="form-input" id="cfg-banner-text" value="${esc(def('bannerText',''))}" placeholder="Banner message…" style="width:260px">
        </div>
        <div class="config-row">
          <div class="config-info"><div class="config-name">Banner Type</div></div>
          <select class="form-input" id="cfg-banner-type" style="width:140px">
            <option value="info"    ${def('bannerType','info')==='info'?'selected':''}>Info (blue)</option>
            <option value="success" ${def('bannerType','info')==='success'?'selected':''}>Success (green)</option>
            <option value="warning" ${def('bannerType','info')==='warning'?'selected':''}>Warning (orange)</option>
            <option value="danger"  ${def('bannerType','info')==='danger'?'selected':''}>Danger (red)</option>
          </select>
        </div>
      </div>`;

    $('save-cfg-btn').onclick = saveConfig;
  }

  function cfgToggle(label, id, checked, desc) {
    return `<div class="config-row">
      <div class="config-info"><div class="config-name">${label}</div>${desc ? `<div class="config-desc">${desc}</div>` : ''}</div>
      <label class="toggle"><input type="checkbox" id="${id}" ${checked?'checked':''}><span class="toggle-track"></span></label>
    </div>`;
  }

  function saveConfig() {
    const data = {
      maintenanceMode:    $('cfg-maintenance').checked,
      maintenanceMessage: $('cfg-maint-msg').value,
      forceUpdate:        $('cfg-force-update').checked,
      minVersion:         $('cfg-min-version').value,
      updateMessage:      $('cfg-update-msg').value,
      socialEnabled:      $('cfg-social').checked,
      focusEnabled:       $('cfg-focus').checked,
      shopEnabled:        $('cfg-shop').checked,
      syncEnabled:        $('cfg-sync').checked,
      leaderboardEnabled: $('cfg-lb').checked,
      notifsEnabled:      $('cfg-notifs').checked,
      adsEnabled:         $('cfg-ads').checked,
      showBanner:         $('cfg-banner-show').checked,
      bannerText:         $('cfg-banner-text').value,
      bannerType:         $('cfg-banner-type').value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: me.email,
    };
    db.collection('admin_config').doc('remote').set(data, { merge: true })
      .then(() => toast('Remote config pushed. App users will see changes on next load.', 'success'))
      .catch(e => toast(e.message, 'error'));
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: ANNOUNCEMENTS
  // ═══════════════════════════════════════════════════════════
  async function renderAnnouncements() {
    const c = $('page-content');
    c.innerHTML = `
      <div class="section-hdr">
        <div class="section-title">Announcements</div>
      </div>

      <div class="compose-box card-hdr" style="padding:0;margin-bottom:18px">
        <div class="card-hdr" style="border-bottom:1px solid var(--border)"><div class="card-title">Compose Announcement</div></div>
        <div style="padding:18px;display:flex;flex-direction:column;gap:14px">
          <div class="compose-row">
            <div class="form-group" style="flex:2">
              <label class="form-label">Title</label>
              <input class="form-input" id="ann-title" placeholder="Announcement title…">
            </div>
            <div class="form-group">
              <label class="form-label">Type</label>
              <select class="form-input" id="ann-type">
                <option value="info">📘 Info</option>
                <option value="success">✅ Success</option>
                <option value="warning">⚠️ Warning</option>
                <option value="danger">🚨 Alert</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Audience</label>
              <select class="form-input" id="ann-audience">
                <option value="all">All Users</option>
                <option value="active">Active Users</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Message</label>
            <textarea class="form-input" id="ann-body" placeholder="Write your announcement…" rows="3"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-secondary" id="ann-preview-btn">Preview</button>
            <button class="btn btn-primary" id="ann-send-btn">Send Announcement</button>
          </div>
        </div>
      </div>

      <div class="section-hdr" style="margin-top:0">
        <div class="section-title">Sent Announcements</div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Sent</th><th>By</th><th>Actions</th></tr></thead>
            <tbody id="ann-tbody"><tr><td colspan="6" style="text-align:center;padding:30px"><div class="spinner"></div></td></tr></tbody>
          </table>
        </div>
      </div>`;

    $('ann-send-btn').onclick = sendAnnouncement;
    $('ann-preview-btn').onclick = previewAnnouncement;
    loadAnnouncements();
  }

  function previewAnnouncement() {
    const title = $('ann-title').value.trim();
    const body  = $('ann-body').value.trim();
    const type  = $('ann-type').value;
    const colors = { info:'var(--info)', success:'var(--success)', warning:'var(--warning)', danger:'var(--danger)' };
    openModal('Preview', `
      <div style="border:1px solid ${colors[type]};border-radius:10px;padding:14px;background:rgba(0,0,0,0.3)">
        <div style="font-weight:600;margin-bottom:6px;color:${colors[type]}">${esc(title||'Untitled')}</div>
        <div style="font-size:13px;color:var(--text)">${esc(body||'No content.')}</div>
      </div>`, `<button class="btn btn-secondary" onclick="closeAdminModal()">Close</button>`);
    window.closeAdminModal = closeModal;
  }

  async function sendAnnouncement() {
    const title    = $('ann-title').value.trim();
    const body     = $('ann-body').value.trim();
    const type     = $('ann-type').value;
    const audience = $('ann-audience').value;
    if (!title || !body) { toast('Title and message are required.', 'error'); return; }

    const btn = $('ann-send-btn'); btn.textContent = 'Sending…'; btn.disabled = true;
    try {
      await db.collection('announcements').add({
        title, body, type, audience, status: 'sent',
        sentAt: firebase.firestore.FieldValue.serverTimestamp(),
        sentBy: me.email,
      });
      toast('Announcement sent!', 'success');
      $('ann-title').value = ''; $('ann-body').value = '';
      loadAnnouncements();
    } catch (e) { toast(e.message, 'error'); }
    btn.textContent = 'Send Announcement'; btn.disabled = false;
  }

  async function loadAnnouncements() {
    const tbody = $('ann-tbody'); if (!tbody) return;
    try {
      const snap = await db.collection('announcements').orderBy('sentAt','desc').limit(50).get();
      if (snap.empty) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:30px"><p>No announcements yet</p></div></td></tr>'; return; }
      const typeIcon = { info:'📘', success:'✅', warning:'⚠️', danger:'🚨' };
      tbody.innerHTML = snap.docs.map(doc => {
        const a = doc.data();
        return `<tr>
          <td style="font-weight:500">${esc(a.title)}</td>
          <td>${typeIcon[a.type]||''} ${esc(a.type)}</td>
          <td>${esc(a.audience)}</td>
          <td>${fmtTime(a.sentAt)}</td>
          <td class="text-sm text-muted">${esc(a.sentBy||'—')}</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteAnn('${doc.id}')">Delete</button></td>
        </tr>`;
      }).join('');
      window.deleteAnn = (id) => {
        db.collection('announcements').doc(id).delete()
          .then(() => { toast('Deleted.', 'success'); loadAnnouncements(); })
          .catch(e => toast(e.message,'error'));
      };
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>${esc(e.message)}</p></div></td></tr>`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: ANALYTICS
  // ═══════════════════════════════════════════════════════════
  async function renderAnalytics() {
    const c = $('page-content');
    c.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    let users = [], lbData = [];
    try {
      const [uSnap, lbSnap] = await Promise.all([
        db.collection('user_index').limit(500).get(),
        db.collection('global_lb').orderBy('weeklyXP','desc').limit(10).get(),
      ]);
      users  = uSnap.docs.map(d => d.data());
      lbData = lbSnap.docs.map(d => ({ name: d.data().name||d.id.slice(0,8), xp: d.data().weeklyXP||0 }));
    } catch (_) {}

    // Compute daily active users for last 7 days
    const now = Date.now();
    const day = 86400000;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const start = now - (i + 1) * day;
      const end   = now - i * day;
      const label = new Date(end).toLocaleDateString('en-GB', { weekday:'short' });
      const count = users.filter(u => {
        const la = u.lastActive;
        if (!la) return false;
        const t = la.toDate ? la.toDate().getTime() : la;
        return t >= start && t < end;
      }).length;
      days.push({ label, count });
    }

    const levelDist = {};
    users.forEach(u => { const l = u.level || 1; levelDist[l] = (levelDist[l]||0) + 1; });

    const totalFocusMin = users.reduce((s,u) => s + (u.totalFocusMinutes||0), 0);
    const avgStreak = users.length ? (users.reduce((s,u) => s + (u.studyStreak||0), 0) / users.length).toFixed(1) : 0;

    c.innerHTML = `
      <div class="stats-grid" style="margin-bottom:20px">
        ${statCard('Total Users',     users.length,           'blue',   userIcon())}
        ${statCard('Focus Minutes',   fmtNum(totalFocusMin),  'orange', focIcon())}
        ${statCard('Avg Streak',      avgStreak + ' days',    'green',  strIcon())}
        ${statCard('Top LB Users',    lbData.length,          'purple', lbIcon())}
      </div>
      <div class="grid-2">
        <div class="chart-card">
          <div class="chart-card-hdr">Daily Active Users (Last 7 Days)</div>
          <div class="chart-body"><canvas id="ch-dau"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-hdr">Weekly XP Leaderboard (Top 10)</div>
          <div class="chart-body"><canvas id="ch-lb"></canvas></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="chart-card">
          <div class="chart-card-hdr">User Level Distribution</div>
          <div class="chart-body"><canvas id="ch-lvl"></canvas></div>
        </div>
        <div class="card">
          <div class="card-hdr"><div class="card-title">Top Users by Weekly XP</div></div>
          <div>
            ${lbData.slice(0,8).map((u,i) => `
              <div class="activity-item">
                <div class="activity-dot" style="background:var(--accent)"></div>
                <div class="activity-text"><strong>#${i+1}</strong> ${esc(u.name)}</div>
                <div class="activity-time text-warning font-600">${fmtNum(u.xp)} XP</div>
              </div>`).join('') || '<div class="empty-state" style="padding:30px"><p>No leaderboard data</p></div>'}
          </div>
        </div>
      </div>`;

    // Build charts
    const chartDefaults = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
    };
    const gridColor = 'rgba(255,255,255,0.05)';
    const tickColor = '#7a7a96';

    _charts['dau'] = new Chart($('ch-dau'), {
      type: 'line',
      data: {
        labels: days.map(d => d.label),
        datasets: [{ data: days.map(d => d.count), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', tension: 0.4, fill: true, pointBackgroundColor: '#6366f1', pointRadius: 4 }]
      },
      options: { ...chartDefaults, scales: { y: { beginAtZero:true, grid:{ color:gridColor }, ticks:{ color:tickColor } }, x: { grid:{ display:false }, ticks:{ color:tickColor } } } }
    });

    _charts['lb'] = new Chart($('ch-lb'), {
      type: 'bar',
      data: {
        labels: lbData.map(u => u.name.slice(0,10)),
        datasets: [{ data: lbData.map(u => u.xp), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4 }]
      },
      options: { ...chartDefaults, scales: { y: { beginAtZero:true, grid:{ color:gridColor }, ticks:{ color:tickColor } }, x: { grid:{ display:false }, ticks:{ color:tickColor, font:{ size:10 } } } } }
    });

    const lvlLabels = Object.keys(levelDist).sort((a,b)=>a-b).map(l => `Lv ${l}`);
    const lvlVals   = lvlLabels.map((_, i) => levelDist[Object.keys(levelDist).sort((a,b)=>a-b)[i]]);
    _charts['lvl'] = new Chart($('ch-lvl'), {
      type: 'doughnut',
      data: {
        labels: lvlLabels,
        datasets: [{ data: lvlVals, backgroundColor: ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#a855f7','#ec4899','#14b8a6'].slice(0, lvlLabels.length) }]
      },
      options: { ...chartDefaults, plugins: { legend: { display: true, labels: { color: tickColor, font:{ size:11 } } } } }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  PAGE: STORAGE
  // ═══════════════════════════════════════════════════════════
  async function renderStorage() {
    const c = $('page-content');
    c.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

    let users = 0, groups = 0, lbCount = 0, reports = 0, anns = 0;
    try {
      const [uS, gS, lS, rS, aS] = await Promise.all([
        db.collection('user_index').limit(2000).get(),
        db.collection('groups').limit(2000).get(),
        db.collection('global_lb').limit(2000).get(),
        db.collection('reports').limit(2000).get(),
        db.collection('announcements').limit(2000).get(),
      ]);
      users = uS.size; groups = gS.size; lbCount = lS.size; reports = rS.size; anns = aS.size;
    } catch (_) {}

    const userDataSize = users * 8;   // rough kb estimate: ~8kb per user doc (incl full state)
    const groupsSize   = groups * 2;
    const lbSize       = lbCount * 1;
    const total = userDataSize + groupsSize + lbSize;

    c.innerHTML = `
      <div class="section-hdr"><div class="section-title">Storage & Database</div></div>
      <div class="stats-grid">
        ${statCard('User Documents', users,    'blue',   userIcon())}
        ${statCard('Group Docs',     groups,   'purple', grpIcon())}
        ${statCard('LB Entries',     lbCount,  'orange', lbIcon())}
        ${statCard('Reports',        reports,  'red',    flagIcon())}
        ${statCard('Announcements',  anns,     'green',  bellIcon())}
        ${statCard('Est. KB Used',   fmtNum(total), 'blue', dbIcon())}
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-hdr"><div class="card-title">Collection Sizes</div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
          ${storageRow('users (cloud state)',  userDataSize, total)}
          ${storageRow('groups',               groupsSize,   total)}
          ${storageRow('global_lb',            lbSize,       total)}
          ${storageRow('reports',              reports,      total)}
          ${storageRow('announcements',        anns,         total)}
        </div>
      </div>

      <div class="card">
        <div class="card-hdr"><div class="card-title">Data Management</div></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <div class="info-row"><label>Purge resolved reports (30d+)</label>
            <button class="btn btn-sm btn-secondary" onclick="purgeOldReports()">Purge</button>
          </div>
          <div class="info-row"><label>Remove old announcements (90d+)</label>
            <button class="btn btn-sm btn-secondary" onclick="purgeOldAnn()">Purge</button>
          </div>
          <div style="font-size:12px;color:var(--dim);padding-top:6px">
            Note: Actual Firestore storage is shown in the Firebase Console. Estimates above are approximate.
          </div>
        </div>
      </div>`;

    window.purgeOldReports = async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000);
      const snap = await db.collection('reports').where('status','!=','pending').where('resolvedAt','<',cutoff).limit(200).get();
      if (snap.empty) { toast('Nothing to purge.', 'info'); return; }
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit().catch(e => toast(e.message,'error'));
      toast(`Purged ${snap.size} resolved reports.`, 'success');
    };
    window.purgeOldAnn = async () => {
      const cutoff = new Date(Date.now() - 90 * 86400000);
      const snap = await db.collection('announcements').where('sentAt','<',cutoff).limit(200).get();
      if (snap.empty) { toast('Nothing to purge.', 'info'); return; }
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit().catch(e => toast(e.message,'error'));
      toast(`Purged ${snap.size} old announcements.`, 'success');
    };
  }

  function storageRow(name, val, total) {
    const pct = total > 0 ? Math.min(100, (val/total*100)).toFixed(1) : 0;
    return `<div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12.5px">
        <span>${name}</span><span class="text-muted">${fmtNum(val)} KB (~${pct}%)</span>
      </div>
      <div class="storage-bar"><div class="storage-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  MODAL
  // ═══════════════════════════════════════════════════════════
  function openModal(title, body, foot) {
    $('modal-ttl').textContent = title;
    $('modal-body').innerHTML = body;
    $('modal-foot').innerHTML = foot || '';
    $('modal').style.display = '';
  }
  function closeModal() { $('modal').style.display = 'none'; }

  // ═══════════════════════════════════════════════════════════
  //  TOAST
  // ═══════════════════════════════════════════════════════════
  function toast(msg, type = 'info') {
    const wrap = $('toasts');
    const t = el('div', `toast-msg ${type}`);
    const icons = { success:'✓', error:'✗', warning:'⚠', info:'ℹ' };
    t.textContent = (icons[type]||'•') + '  ' + msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ═══════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════
  function errState(msg) {
    return `<div class="empty-state"><p>Error loading data</p><small>${esc(msg)}</small></div>`;
  }
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ── SVG Icons ──────────────────────────────────────────────
  function svgIcon(path) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${path}</svg>`; }
  function userIcon()  { return svgIcon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'); }
  function actIcon()   { return svgIcon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'); }
  function grpIcon()   { return svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'); }
  function flagIcon()  { return svgIcon('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'); }
  function lbIcon()    { return svgIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'); }
  function banIcon()   { return svgIcon('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'); }
  function focIcon()   { return svgIcon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'); }
  function strIcon()   { return svgIcon('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'); }
  function bellIcon()  { return svgIcon('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'); }
  function dbIcon()    { return svgIcon('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'); }

  // ── Start ─────────────────────────────────────────────────
  init();
});
