// duel.js — Realtime Duel & Tournament System v2
// Self-contained module; exposes window.DuelSystem
// Works with existing Firestore setup in social.js + script.js

(() => {
  'use strict';

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  const HEARTBEAT_MS   = 5000;
  const INVITE_TTL_MS  = 5 * 60 * 1000;
  const MAX_WARNINGS   = 3;
  const BG_GRACE_SEC   = 45;
  const MIN_SESSION_MS = 60000; // minimum 1 min for anti-cheat

  const DUEL_MODES = [
    { id:'focus',    icon:'⏱️', label:'Focus Time',      desc:'Who studies longer' },
    { id:'pomodoro', icon:'🍅', label:'Pomodoro Battle', desc:'Most sessions completed' },
    { id:'xp',       icon:'⚡', label:'XP Battle',       desc:'Earn the most XP' },
    { id:'tasks',    icon:'✅', label:'Task Completion', desc:'Complete more tasks' },
  ];

  const DUEL_DURATIONS = [
    { label:'30 min',  ms: 30 * 60 * 1000 },
    { label:'1 hour',  ms: 60 * 60 * 1000 },
    { label:'3 hours', ms: 3  * 60 * 60 * 1000 },
    { label:'6 hours', ms: 6  * 60 * 60 * 1000 },
    { label:'12 hours',ms: 12 * 60 * 60 * 1000 },
    { label:'24 hours',ms: 24 * 60 * 60 * 1000 },
    { label:'Custom ✏️', ms: -1 },
  ];

  const TOURNAMENT_TYPES = [
    { id:'focus_time',    icon:'⏱️', label:'Focus Time',    desc:'Most total study minutes' },
    { id:'most_xp',       icon:'⚡', label:'Most XP',        desc:'Earn the most XP' },
    { id:'most_sessions', icon:'🍅', label:'Most Sessions',  desc:'Complete most focus sessions' },
    { id:'streak',        icon:'🔥', label:'Streak Battle',  desc:'Longest consecutive streak' },
    { id:'knockout',      icon:'⚔️', label:'Knockout Duels', desc:'Single-elimination bracket' },
    { id:'task_battle',   icon:'✅', label:'Task Battle',    desc:'Complete the most tasks' },
  ];

  // ─── MODULE STATE ────────────────────────────────────────────────────────────
  let _groupCode        = null;
  let _activeDuelId     = null;
  let _activeDuelData   = null;
  let _duelSub          = null;
  let _inviteSub        = null;
  let _tournSub         = null;
  let _tournDetailSub   = null;
  let _heartbeatTimer   = null;
  let _rafTimer         = null;
  let _duelStartLocal   = 0;
  let _duelStartServerMs= 0;
  let _pendingInvites   = new Set();
  let _invitePopupEl    = null;
  let _groupTournaments = [];
  let _duelHistory      = [];
  let _historyLoaded    = false;
  let _bgHideStart      = 0;
  let _bgHideCount      = 0;
  let _visHandler       = null;
  let _duelSubTab       = 'challenges';
  let _confettiInterval = null;
  let _taskSnapshotCache= 0;

  // ─── FIREBASE ACCESSORS ──────────────────────────────────────────────────────
  const _db   = () => { try { return window.appUI?.getDb?.() ?? null; } catch(_) { return null; } };
  const _uid  = () => { try { return window.appUI?.getUserId?.() ?? null; } catch(_) { return null; } };
  const _ms   = () => { try { return window.appUI?.state?.() ?? {}; } catch(_) { return {}; } };
  const _fb   = () => { try { return window.firebase ?? null; } catch(_) { return null; } };
  const _sts  = () => { const fb = _fb(); return fb?.firestore?.FieldValue?.serverTimestamp?.() ?? null; };
  const _inc  = (n) => { const fb = _fb(); return fb?.firestore?.FieldValue?.increment?.(n) ?? null; };

  // ─── UI BRIDGE ───────────────────────────────────────────────────────────────
  const _toast   = (m, t, d) => { try { window.appUI?.toast?.(m, t, d); } catch(_) {} };
  const _modal   = (h, cb)   => { try { window.appUI?.openModal?.(h, cb); } catch(_) {} };
  const _confirm = (m, cb, o)=> { try { window.appUI?.confirmModal?.(m, cb, o); } catch(_) {} };
  const _close   = ()        => { try { window.appUI?.closeModal?.(); } catch(_) {} };

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  const _esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const _genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const _fmtMs = ms => {
    if (!ms || ms < 0) return '0:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    return `${m}:${String(s%60).padStart(2,'0')}`;
  };
  const _todayKey = () => {
    try { return window.appUI?.todayKey?.() ?? new Date().toISOString().slice(0,10); }
    catch(_) { return new Date().toISOString().slice(0,10); }
  };
  const _myName = () => {
    const ms = _ms();
    if (ms.profile?.name && ms.profile.name !== 'You') return ms.profile.name.trim();
    try {
      const u = _fb()?.auth?.()?.currentUser;
      if (u?.displayName) return u.displayName.trim();
      if (u?.email) { const l = u.email.split('@')[0]; return l.charAt(0).toUpperCase() + l.slice(1); }
    } catch(_) {}
    return 'Studier';
  };
  const _avatarBg = name => {
    const COLS = ['#ff7a1a','#6366f1','#10b981','#f59e0b','#ec4899','#06b6d4','#8b5cf6','#f43f5e'];
    let h = 0;
    for (let i = 0; i < (name||'').length; i++) h = (h*31 + (name||'').charCodeAt(i)) & 0xffffffff;
    return COLS[Math.abs(h) % COLS.length];
  };
  const _getMyRole = g => {
    const uid = _uid();
    if (!uid || !g) return null;
    if (g.ownerUid === uid || g.createdByUid === uid || g.createdBy === uid) return 'owner';
    if ((g.admins || []).includes(uid)) return 'admin';
    return 'member';
  };
  const _toMs = ts => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds)  return ts.seconds * 1000;
    return 0;
  };
  const _rerender = () => {
    try { window._socialRender?.(); } catch(_) {}
  };

  // ─── CLEANUP HELPERS ─────────────────────────────────────────────────────────
  function _cleanDuel() {
    if (_duelSub)        { try { _duelSub(); }  catch(_) {} _duelSub = null; }
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    if (_rafTimer)       { cancelAnimationFrame(_rafTimer); _rafTimer = null; }
    if (_visHandler)     { document.removeEventListener('visibilitychange', _visHandler); _visHandler = null; }
    _stopConfetti();
    _activeDuelId    = null;
    _activeDuelData  = null;
    _duelStartLocal  = 0;
    _duelStartServerMs = 0;
    _bgHideCount     = 0;
    _bgHideStart     = 0;
  }

  function _cleanInvite() {
    if (_inviteSub) { try { _inviteSub(); } catch(_) {} _inviteSub = null; }
    _removeInvitePopup();
  }

  function _cleanTourn() {
    if (_tournSub) { try { _tournSub(); } catch(_) {} _tournSub = null; }
    if (_tournDetailSub) { try { _tournDetailSub(); } catch(_) {} _tournDetailSub = null; }
    _groupTournaments = [];
  }

  // ─── CONFETTI ────────────────────────────────────────────────────────────────
  function _launchConfetti() {
    _stopConfetti();
    const container = document.createElement('div');
    container.id = 'dt-confetti-wrap';
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
    document.body.appendChild(container);

    const colors = ['#ff7a1a','#6366f1','#10b981','#f59e0b','#ec4899','#ffd700','#ff4757'];
    let count = 0;
    const MAX = 120;

    const spawn = () => {
      if (count >= MAX) { _stopConfetti(); return; }
      count++;
      const el = document.createElement('div');
      const color = colors[Math.floor(Math.random() * colors.length)];
      const left  = Math.random() * 100;
      const size  = 6 + Math.random() * 8;
      const delay = Math.random() * 0.5;
      const dur   = 2.5 + Math.random() * 2;
      el.style.cssText = `position:absolute;left:${left}%;top:-10px;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random()>0.5?'50%':'2px'};animation:dtConfettiFall ${dur}s ${delay}s ease-in forwards;transform:rotate(${Math.random()*360}deg)`;
      container.appendChild(el);
    };

    _confettiInterval = setInterval(spawn, 30);
    setTimeout(_stopConfetti, 5000);
  }

  function _stopConfetti() {
    if (_confettiInterval) { clearInterval(_confettiInterval); _confettiInterval = null; }
    const el = document.getElementById('dt-confetti-wrap');
    if (el) el.remove();
  }

  // ─── INVITE POPUP ────────────────────────────────────────────────────────────
  function _removeInvitePopup() {
    if (_invitePopupEl) { _invitePopupEl.remove(); _invitePopupEl = null; }
  }

  function _showInvitePopup(duelId, data) {
    if (_pendingInvites.has(duelId)) return;
    _pendingInvites.add(duelId);
    _removeInvitePopup();

    const mode = DUEL_MODES.find(m => m.id === data.mode) || DUEL_MODES[0];
    const from = _esc(data.challengerName || 'Someone');

    const el = document.createElement('div');
    el.className = 'dt-invite-popup';
    el.setAttribute('role', 'alertdialog');
    el.innerHTML = `
      <div class="dt-invite-inner">
        <div class="dt-invite-top">
          <div class="dt-invite-av" style="background:${_avatarBg(data.challengerName||'')}">${(data.challengerName||'?')[0].toUpperCase()}</div>
          <div class="dt-invite-body">
            <div class="dt-invite-from"><strong>${from}</strong> challenged you!</div>
            <div class="dt-invite-meta">${mode.icon} ${mode.label} · ${_fmtMs(data.duration)}</div>
          </div>
        </div>
        <div class="dt-invite-actions">
          <button class="dt-btn dt-btn-ghost dt-btn-xs" id="dt-pop-decline-${_esc(duelId)}">Decline</button>
          <button class="dt-btn dt-btn-primary dt-btn-xs" id="dt-pop-accept-${_esc(duelId)}">⚔️ Accept</button>
        </div>
        <div class="dt-invite-timebar"><div class="dt-invite-timebar-fill" id="dt-ptf-${_esc(duelId)}"></div></div>
      </div>`;

    el.querySelector(`#dt-pop-accept-${duelId}`)?.addEventListener('click', () => {
      acceptDuel(duelId); _removeInvitePopup();
    });
    el.querySelector(`#dt-pop-decline-${duelId}`)?.addEventListener('click', () => {
      rejectDuel(duelId); _removeInvitePopup();
    });

    document.body.appendChild(el);
    _invitePopupEl = el;
    navigator.vibrate?.([60, 40, 60]);

    const fill  = el.querySelector(`#dt-ptf-${duelId}`);
    const start = Date.now();
    const TIMEOUT = 30000;
    const tick = () => {
      const pct = Math.max(0, 100 - (Date.now() - start) / TIMEOUT * 100);
      if (fill) fill.style.width = pct + '%';
      if (pct <= 0) { _removeInvitePopup(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ─── INVITE SUBSCRIPTION ────────────────────────────────────────────────────
  function _subscribeInvites(uid) {
    const db = _db();
    if (!db || !uid) return;
    if (_inviteSub) { try { _inviteSub(); } catch(_) {} _inviteSub = null; }

    try {
      _inviteSub = db.collection('duelInvites').doc(uid).collection('incoming')
        .limit(5)
        .onSnapshot(snap => {
          snap.docChanges().forEach(ch => {
            if (ch.type !== 'added') return;
            const id   = ch.doc.id;
            const data = ch.doc.data();
            if (_pendingInvites.has(id)) return;
            if (data.status && data.status !== 'pending') return;
            const sentMs = _toMs(data.sentAt);
            if (sentMs && Date.now() - sentMs > INVITE_TTL_MS) return;
            _showInvitePopup(id, data);
          });
        }, () => {});
    } catch(_) {}
  }

  // ─── SEND CHALLENGE ──────────────────────────────────────────────────────────
  function _sendChallenge(targetUid, targetName, mode, durationMs) {
    const db = _db(), uid = _uid(), fb = _fb();
    if (!db || !uid || !targetUid) { _toast('Cannot send challenge', 'warn'); return; }
    if (uid === targetUid) { _toast('Cannot challenge yourself', 'warn'); return; }
    if (_activeDuelId) { _toast('You already have an active duel', 'warn'); return; }
    if (durationMs < MIN_SESSION_MS) { _toast('Minimum duel duration is 1 minute', 'warn'); return; }

    const myName  = _myName();
    const duelId  = _genId();
    const sts     = _sts();
    const expires = new Date(Date.now() + INVITE_TTL_MS);

    const duelDoc = {
      groupCode:            _groupCode || '',
      mode, duration:       durationMs,
      challengerUid:        uid,   challengerName:       myName,
      opponentUid:          targetUid, opponentName:     targetName,
      state:                'pending',
      challengerFocusMs:    0, opponentFocusMs:          0,
      challengerIsStudying: false, opponentIsStudying:   false,
      challengerWarnings:   0, opponentWarnings:         0,
      challengerScore:      0, opponentScore:            0,
      challengerXP:         0, opponentXP:               0,
      challengerTasks:      0, opponentTasks:            0,
      challengerSessions:   0, opponentSessions:         0,
      challengerLastHb:     sts, opponentLastHb:         sts,
      startedAt:            null, endsAt:                null,
      startedAtMs:          null,
      winner:               null, forfeitBy:             null,
      createdAt:            sts,
    };

    const invite = {
      duelId, challengerUid: uid, challengerName: myName,
      opponentUid: targetUid, groupCode: _groupCode || '',
      mode, duration: durationMs,
      status: 'pending', expiresAt: expires, sentAt: sts,
    };

    const batch = db.batch();
    batch.set(db.collection('duels').doc(duelId), duelDoc);
    batch.set(db.collection('duelInvites').doc(targetUid).collection('incoming').doc(duelId), invite);

    batch.commit()
      .then(() => {
        _toast(`⚔️ Challenge sent to ${targetName}!`, 'success', 3000);
        _activeDuelId = duelId;
        _subscribeDuel(duelId, uid);
      })
      .catch(() => { _activeDuelId = null; _toast('Failed to send challenge', 'error'); });
  }

  // ─── SUBSCRIBE TO DUEL DOCUMENT ─────────────────────────────────────────────
  function _subscribeDuel(duelId, uid) {
    if (_duelSub) { try { _duelSub(); } catch(_) {} _duelSub = null; }
    const db = _db();
    if (!db) return;

    _duelSub = db.collection('duels').doc(duelId).onSnapshot(snap => {
      if (!snap.exists) { _cleanDuel(); _rerender(); return; }
      const data = snap.data();
      _activeDuelData = data;
      _activeDuelId   = duelId;

      if (data.state === 'active' && !_heartbeatTimer) {
        // Use server timestamp to calculate remaining time accurately
        const startMs = _toMs(data.startedAt) || (_toMs(data.startedAtMs)) || Date.now();
        _duelStartServerMs = startMs;
        _duelStartLocal    = Date.now() - (Date.now() - startMs);
        _startHeartbeat(duelId, uid);
      }
      if (data.state === 'completed' || data.state === 'cancelled') {
        _onDuelEnd(data, uid);
        return;
      }
      _updateBattleDOM();
      _rerender();
    }, () => { _cleanDuel(); _rerender(); });
  }

  // ─── ACCEPT / REJECT ─────────────────────────────────────────────────────────
  function acceptDuel(duelId) {
    const db = _db(), uid = _uid(), fb = _fb();
    if (!db || !uid) return;

    db.collection('duels').doc(duelId).get().then(snap => {
      if (!snap.exists) { _toast('Duel no longer available', 'warn'); return; }
      const data = snap.data();
      if (data.state !== 'pending') { _toast('Duel already started or expired', 'warn'); return; }

      const sts    = _sts();
      const nowMs  = Date.now();
      const endsAt = new Date(nowMs + data.duration);

      return db.collection('duels').doc(duelId).update({
        state: 'active', startedAt: sts, startedAtMs: nowMs, endsAt,
        opponentLastHb: sts,
      }).then(() => {
        db.collection('duelInvites').doc(uid).collection('incoming').doc(duelId)
          .delete().catch(() => {});
        _toast('⚔️ Duel accepted! Battle begins!', 'success', 3000);
        _activeDuelId = duelId;
        _subscribeDuel(duelId, uid);
        try { window._scSetSrTab?.('duels'); } catch(_) {}
      });
    }).catch(() => _toast('Failed to accept duel', 'error'));
  }

  function rejectDuel(duelId) {
    const db = _db(), uid = _uid();
    if (!db || !uid) return;
    db.collection('duels').doc(duelId).update({ state:'cancelled', winner:'challenger_win' }).catch(() => {});
    db.collection('duelInvites').doc(uid).collection('incoming').doc(duelId).delete().catch(() => {});
    _pendingInvites.delete(duelId);
    _toast('Duel declined', 'info');
  }

  // ─── HEARTBEAT + ANTI-CHEAT ──────────────────────────────────────────────────
  function _startHeartbeat(duelId, uid) {
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    if (!_duelStartLocal) _duelStartLocal = Date.now();

    _visHandler = () => {
      if (!_activeDuelId || _activeDuelData?.state !== 'active') return;
      if (document.hidden) {
        _bgHideStart = Date.now();
      } else if (_bgHideStart) {
        const hiddenSec = (Date.now() - _bgHideStart) / 1000;
        _bgHideStart = 0;
        if (hiddenSec > BG_GRACE_SEC) {
          _bgHideCount++;
          const db2 = _db();
          if (db2 && _activeDuelData) {
            const isCh = _activeDuelData.challengerUid === uid;
            const role = isCh ? 'challenger' : 'opponent';
            const newW = (_activeDuelData[`${role}Warnings`] || 0) + 1;
            db2.collection('duels').doc(duelId).update({ [`${role}Warnings`]: newW }).catch(() => {});
            _toast(`⚠️ Warning ${newW}/${MAX_WARNINGS} — app was hidden for ${Math.round(hiddenSec)}s`, 'warn', 4000);
            if (newW >= MAX_WARNINGS) _forfeit(uid, 'Exceeded app-switch limit');
          }
        }
      }
    };
    document.addEventListener('visibilitychange', _visHandler);

    const sendHb = () => {
      const db2 = _db();
      if (!db2 || !_activeDuelData) return;

      const isCh = _activeDuelData.challengerUid === uid;
      const role = isCh ? 'challenger' : 'opponent';
      const isStudying = window.appUI?.focusIsRunning?.() === true;

      // Use server-anchored timestamps to prevent local clock manipulation
      const nowMs   = Date.now();
      const startMs = _duelStartServerMs || _duelStartLocal;
      const elapsed = nowMs - startMs;
      const maxMs   = _activeDuelData.duration || Infinity;
      const focusMs = Math.min(Math.max(0, elapsed), maxMs);

      const today = _todayKey();
      const st    = _ms();
      let score = 0;
      if (_activeDuelData.mode === 'xp')       score = st.xp?.total || 0;
      if (_activeDuelData.mode === 'pomodoro')  score = ((st.focusStats?.sessions) || {})[today] || 0;
      if (_activeDuelData.mode === 'tasks')     score = _completedTasks();

      const endsMs   = _toMs(_activeDuelData.endsAt);
      const finished = endsMs && nowMs >= endsMs;

      // Validate: paused timers don't count for focus mode
      const effectiveFocusMs = (_activeDuelData.mode === 'focus' && !isStudying && elapsed > MIN_SESSION_MS)
        ? Math.min(focusMs, _activeDuelData[`${role}FocusMs`] || focusMs)
        : focusMs;

      const xpNow       = st.xp?.total || 0;
      const sessionsNow = ((st.focusStats?.sessions) || {})[today] || 0;
      const tasksNow    = _completedTasks();

      const patch = {
        [`${role}FocusMs`]:    effectiveFocusMs,
        [`${role}IsStudying`]: isStudying && !finished,
        [`${role}Score`]:      score,
        [`${role}XP`]:         xpNow,
        [`${role}Tasks`]:      tasksNow,
        [`${role}Sessions`]:   sessionsNow,
        [`${role}LastHb`]:     _sts(),
      };

      if (finished && _activeDuelData.state === 'active') {
        patch.state = 'completed';
        const myScore  = _activeDuelData.mode === 'focus' ? effectiveFocusMs : score;
        const oppField = isCh ? 'opponent' : 'challenger';
        const oppScore = _activeDuelData.mode === 'focus'
          ? _activeDuelData[`${oppField}FocusMs`]
          : _activeDuelData[`${oppField}Score`];
        const oppUid = _activeDuelData[`${oppField}Uid`];
        if (myScore > oppScore)      patch.winner = uid;
        else if (oppScore > myScore) patch.winner = oppUid;
        else                         patch.winner = 'draw';
      }

      db2.collection('duels').doc(duelId).update(patch).catch(() => {});
    };

    sendHb();
    _heartbeatTimer = setInterval(sendHb, HEARTBEAT_MS);
    _startBattleRAF();
  }

  function _forfeit(uid, reason) {
    if (!_activeDuelId || !_activeDuelData) return;
    const isCh  = _activeDuelData.challengerUid === uid;
    const winner = isCh ? _activeDuelData.opponentUid : _activeDuelData.challengerUid;
    const db2 = _db();
    db2?.collection('duels').doc(_activeDuelId).update({
      state:'completed', winner: winner||'draw', forfeitBy: uid
    }).catch(() => {});
    _toast(`Duel ended: ${reason}`, 'warn');
  }

  function _completedTasks() {
    try {
      const today = _todayKey();
      const plan  = _ms().dailyPlan || [];
      return plan.filter(t => t.done && (!t.date || t.date === today)).length;
    } catch(_) { return 0; }
  }

  // ─── TOURNAMENT SCORE UPDATE (called externally when tasks complete) ──────────
  function updateTournamentScore() {
    const uid = _uid();
    const db2 = _db();
    if (!uid || !db2 || !_groupCode) return;

    const active = _groupTournaments.filter(t => {
      const now = Date.now();
      const startMs = _toMs(t.startTime);
      const endMs   = _toMs(t.endTime);
      return t.status !== 'completed' && now >= startMs && now <= endMs;
    });

    active.forEach(t => {
      const st = _ms();
      const today = _todayKey();
      let score = 0;

      if (t.type === 'task_battle')   score = _completedTasks();
      if (t.type === 'most_xp')       score = st.xp?.total || 0;
      if (t.type === 'most_sessions')  score = ((st.focusStats?.sessions)||{})[today] || 0;
      if (t.type === 'streak')         score = st.streakCount || 0;
      if (t.type === 'focus_time')     score = st.focusStats?.totalMs || 0;

      if (score === 0 && t.type !== 'task_battle') return;

      db2.collection('tournaments').doc(t.id).collection('participants').doc(uid)
        .set({ score, updatedAt: _sts() }, { merge: true })
        .catch(() => {});
    });
  }

  // ─── BATTLE DOM RAF LOOP ─────────────────────────────────────────────────────
  function _startBattleRAF() {
    if (_rafTimer) cancelAnimationFrame(_rafTimer);
    const tick = () => {
      if (!_activeDuelId || !_activeDuelData || _activeDuelData.state !== 'active') return;
      _updateBattleDOM();
      _rafTimer = requestAnimationFrame(tick);
    };
    _rafTimer = requestAnimationFrame(tick);
  }

  function _updateBattleDOM() {
    if (!_activeDuelData) return;
    const uid     = _uid();
    const isCh    = _activeDuelData.challengerUid === uid;
    const endsMs  = _toMs(_activeDuelData.endsAt);
    const remaining = endsMs ? Math.max(0, endsMs - Date.now()) : 0;

    const cdEl = document.getElementById('dt-countdown');
    if (cdEl) {
      cdEl.textContent = _fmtMs(remaining);
      cdEl.classList.toggle('dt-countdown-urgent', remaining > 0 && remaining < 60000);
    }

    // Timer ring arc
    const ringEl = document.getElementById('dt-timer-ring-arc');
    if (ringEl && _activeDuelData.duration) {
      const pct    = 1 - Math.min(1, remaining / _activeDuelData.duration);
      const R      = 38;
      const CIRC   = 2 * Math.PI * R;
      const offset = CIRC * (1 - pct);
      ringEl.style.strokeDashoffset = offset;
    }

    const isTime  = _activeDuelData.mode === 'focus';
    const dur     = _activeDuelData.duration || 1;
    const myMs    = isCh ? _activeDuelData.challengerFocusMs : _activeDuelData.opponentFocusMs;
    const oppMs   = isCh ? _activeDuelData.opponentFocusMs   : _activeDuelData.challengerFocusMs;
    const myScr   = isCh ? _activeDuelData.challengerScore   : _activeDuelData.opponentScore;
    const oppScr  = isCh ? _activeDuelData.opponentScore     : _activeDuelData.challengerScore;
    const myVal   = isTime ? myMs  : myScr;
    const oppVal  = isTime ? oppMs : oppScr;
    const total   = Math.max(myVal + oppVal, 1);
    const myPct   = isTime ? Math.min(100, myVal  / dur * 100) : Math.min(100, myVal  / total * 100);
    const oppPct  = isTime ? Math.min(100, oppVal / dur * 100) : Math.min(100, oppVal / total * 100);

    const myBarEl  = document.getElementById('dt-my-bar');
    const oppBarEl = document.getElementById('dt-opp-bar');
    const myTimeEl = document.getElementById('dt-my-time');
    const oppTimeEl= document.getElementById('dt-opp-time');

    if (myBarEl)   { myBarEl.style.setProperty('--bar-pct',  myPct  + '%'); myBarEl.dataset.pct  = myPct; }
    if (oppBarEl)  { oppBarEl.style.setProperty('--bar-pct', oppPct + '%'); oppBarEl.dataset.pct = oppPct; }
    if (myTimeEl)  myTimeEl.textContent  = isTime ? _fmtMs(myVal)  : String(myVal);
    if (oppTimeEl) oppTimeEl.textContent = isTime ? _fmtMs(oppVal) : String(oppVal);

    // Live stats
    const d = _activeDuelData;
    const myXP   = (isCh ? d.challengerXP      : d.opponentXP)      || 0;
    const oppXP  = (isCh ? d.opponentXP         : d.challengerXP)    || 0;
    const myTasks= (isCh ? d.challengerTasks    : d.opponentTasks)   || 0;
    const oppTasks=(isCh ? d.opponentTasks       : d.challengerTasks) || 0;
    const mySess = (isCh ? d.challengerSessions  : d.opponentSessions)|| 0;
    const oppSess= (isCh ? d.opponentSessions    : d.challengerSessions)||0;
    const myStreak= _ms().streakCount || 0;

    const el = id => document.getElementById(id);
    if (el('dt-stat-my-xp'))      el('dt-stat-my-xp').textContent      = myXP;
    if (el('dt-stat-opp-xp'))     el('dt-stat-opp-xp').textContent     = oppXP;
    if (el('dt-stat-my-tasks'))   el('dt-stat-my-tasks').textContent   = myTasks;
    if (el('dt-stat-opp-tasks'))  el('dt-stat-opp-tasks').textContent  = oppTasks;
    if (el('dt-stat-my-sess'))    el('dt-stat-my-sess').textContent    = mySess;
    if (el('dt-stat-opp-sess'))   el('dt-stat-opp-sess').textContent   = oppSess;
    if (el('dt-stat-my-streak'))  el('dt-stat-my-streak').textContent  = myStreak;
    if (el('dt-stat-my-time'))    el('dt-stat-my-time').textContent    = _fmtMs(myMs);
    if (el('dt-stat-opp-time'))   el('dt-stat-opp-time').textContent   = _fmtMs(oppMs);
  }

  // ─── DUEL END ────────────────────────────────────────────────────────────────
  function _onDuelEnd(data, uid) {
    const wasActive = !!_heartbeatTimer;
    _cleanDuel();
    _activeDuelData = data;
    if (!wasActive) { _rerender(); return; }

    const won   = data.winner === uid;
    const draw  = data.winner === 'draw';
    const forfeited = !!data.forfeitBy;

    const xp = forfeited && data.forfeitBy !== uid ? 150
             : won  ? 200
             : draw ? 75
             : 25;

    try { window.appUI?.addXP?.(xp, 'duel_result'); } catch(_) {}
    if (won) { try { window.appUI?.checkBadges?.('duel_victor'); } catch(_) {} }

    _duelHistory.unshift({ ...data, _id: _activeDuelId });
    if (_duelHistory.length > 30) _duelHistory.pop();

    if (won) _launchConfetti();
    _showResultModal(data, uid, xp);
    _activeDuelData = null;
    _rerender();
  }

  function _showResultModal(data, uid, xpEarned) {
    const won   = data.winner === uid;
    const draw  = data.winner === 'draw';
    const isCh  = data.challengerUid === uid;
    const mode  = DUEL_MODES.find(m => m.id === data.mode) || DUEL_MODES[0];
    const myMs  = isCh ? data.challengerFocusMs : data.opponentFocusMs;
    const oppMs = isCh ? data.opponentFocusMs   : data.challengerFocusMs;
    const myScr = isCh ? data.challengerScore   : data.opponentScore;
    const oppScr= isCh ? data.opponentScore     : data.challengerScore;
    const myXP  = isCh ? (data.challengerXP||0) : (data.opponentXP||0);
    const oppXP = isCh ? (data.opponentXP||0)   : (data.challengerXP||0);
    const myTasks  = isCh ? (data.challengerTasks||0)   : (data.opponentTasks||0);
    const oppTasks = isCh ? (data.opponentTasks||0)     : (data.challengerTasks||0);
    const mySess   = isCh ? (data.challengerSessions||0): (data.opponentSessions||0);
    const oppSess  = isCh ? (data.opponentSessions||0)  : (data.challengerSessions||0);
    const opp   = _esc(isCh ? data.opponentName : data.challengerName);
    const isTime = data.mode === 'focus';
    const title  = draw ? '🤝 Draw!' : won ? '🏆 Victory!' : '💀 Defeat';
    const clr    = draw ? '#f59e0b' : won ? '#10b981' : '#ef4444';

    _modal(`
      <div class="dt-result-wrap">
        <div class="dt-result-badge" style="color:${clr};font-size:52px;text-align:center;margin-bottom:4px">${won ? '🏆' : draw ? '🤝' : '💀'}</div>
        <h2 class="dt-result-title" style="color:${clr};text-align:center;margin:0 0 4px">${title}</h2>
        <p class="dt-result-sub" style="text-align:center;color:var(--sc-muted,#8892a4);font-size:13px;margin:0 0 16px">${mode.icon} ${mode.label}${data.forfeitBy ? ' · Forfeit' : ''}</p>
        <div class="dt-result-vs">
          <div class="dt-rv-player${won || draw ? ' dt-rv-winner' : ''}">
            <div class="dt-rv-av" style="background:${_avatarBg(_myName())}">${(_myName()[0]||'?').toUpperCase()}</div>
            <div class="dt-rv-name">You</div>
            <div class="dt-rv-score">${isTime ? _fmtMs(myMs) : myScr}</div>
          </div>
          <div class="dt-rv-sep">VS</div>
          <div class="dt-rv-player${!won && !draw ? ' dt-rv-winner' : ''}">
            <div class="dt-rv-av" style="background:${_avatarBg(opp)}">${(opp[0]||'?').toUpperCase()}</div>
            <div class="dt-rv-name">${opp}</div>
            <div class="dt-rv-score">${isTime ? _fmtMs(oppMs) : oppScr}</div>
          </div>
        </div>
        <div class="dt-result-stats">
          <div class="dt-rstat-row">
            <span class="dt-rstat-label">⚡ XP</span>
            <span class="dt-rstat-me">${myXP}</span>
            <span class="dt-rstat-sep">vs</span>
            <span class="dt-rstat-opp">${oppXP}</span>
          </div>
          <div class="dt-rstat-row">
            <span class="dt-rstat-label">⏱️ Study Time</span>
            <span class="dt-rstat-me">${_fmtMs(myMs)}</span>
            <span class="dt-rstat-sep">vs</span>
            <span class="dt-rstat-opp">${_fmtMs(oppMs)}</span>
          </div>
          <div class="dt-rstat-row">
            <span class="dt-rstat-label">✅ Tasks</span>
            <span class="dt-rstat-me">${myTasks}</span>
            <span class="dt-rstat-sep">vs</span>
            <span class="dt-rstat-opp">${oppTasks}</span>
          </div>
          <div class="dt-rstat-row">
            <span class="dt-rstat-label">🍅 Sessions</span>
            <span class="dt-rstat-me">${mySess}</span>
            <span class="dt-rstat-sep">vs</span>
            <span class="dt-rstat-opp">${oppSess}</span>
          </div>
        </div>
        <div class="dt-result-xp" style="text-align:center;margin:14px 0 0;font-size:22px;font-weight:800;color:#f59e0b">+${xpEarned} XP</div>
        <button class="dt-btn dt-btn-primary" data-close style="margin-top:16px;width:100%">Continue</button>
      </div>`);
  }

  // ─── DUEL HISTORY ────────────────────────────────────────────────────────────
  function _loadHistory(uid) {
    if (_historyLoaded) return;
    _historyLoaded = true;
    const db2 = _db();
    if (!db2 || !uid) return;

    const merge = docs => {
      docs.forEach(d => {
        if (!_duelHistory.find(x => x._id === d.id)) {
          _duelHistory.push({ ...d.data(), _id: d.id });
        }
      });
      _duelHistory.sort((a, b) => _toMs(b.createdAt) - _toMs(a.createdAt));
    };

    db2.collection('duels').where('challengerUid', '==', uid).limit(8).get()
      .then(s => merge(s.docs)).catch(() => {});
    db2.collection('duels').where('opponentUid', '==', uid).limit(8).get()
      .then(s => merge(s.docs)).catch(() => {});
  }

  // ─── TOURNAMENT ───────────────────────────────────────────────────────────────
  function _subTournaments(groupCode) {
    const db2 = _db();
    if (!db2 || !groupCode) return;
    if (_tournSub) { try { _tournSub(); } catch(_) {} _tournSub = null; }

    try {
      _tournSub = db2.collection('tournaments')
        .where('groupCode', '==', groupCode)
        .limit(10)
        .onSnapshot(snap => {
          _groupTournaments = snap.docs.map(d => ({ ...d.data(), id: d.id }));
          // Auto-update ended tournaments
          const now = Date.now();
          _groupTournaments.forEach(t => {
            if (t.status === 'active' && _toMs(t.endTime) < now) {
              db2.collection('tournaments').doc(t.id).update({ status: 'completed' }).catch(() => {});
            }
            if (t.status === 'upcoming' && _toMs(t.startTime) <= now) {
              db2.collection('tournaments').doc(t.id).update({ status: 'active' }).catch(() => {});
            }
          });
          _rerender();
        }, () => {});
    } catch(_) {}
  }

  function _createTournament(groupCode, s) {
    const db2 = _db(), uid = _uid();
    if (!db2 || !uid) return;

    const tid   = _genId();
    const sts   = _sts();
    const batch = db2.batch();

    batch.set(db2.collection('tournaments').doc(tid), {
      groupCode,
      title:            s.title || 'Group Tournament',
      description:      s.desc  || '',
      type:             s.type  || 'focus_time',
      status:           'upcoming',
      startTime:        s.startTime ? new Date(s.startTime) : new Date(Date.now() + 60000),
      endTime:          s.endTime   ? new Date(s.endTime)   : new Date(Date.now() + 7*86400000),
      participantLimit: parseInt(s.limit) || 16,
      participantCount: 1,
      createdBy:        uid,
      createdByName:    _myName(),
      rewards:          s.rewards || '',
      rules:            s.rules   || '',
      createdAt:        sts,
    });
    batch.set(db2.collection('tournaments').doc(tid).collection('participants').doc(uid), {
      uid, name: _myName(), score: 0, rank: 1, joinedAt: sts,
    });

    batch.commit()
      .then(() => _toast('🏆 Tournament created!', 'success', 3000))
      .catch(() => _toast('Failed to create tournament', 'error'));
  }

  function _joinTournament(tid) {
    const db2 = _db(), uid = _uid();
    if (!db2 || !uid) return;

    const t = _groupTournaments.find(x => x.id === tid);
    if (t && t.status === 'completed') { _toast('Tournament has ended', 'warn'); return; }

    const batch = db2.batch();
    batch.set(
      db2.collection('tournaments').doc(tid).collection('participants').doc(uid),
      { uid, name: _myName(), score: 0, rank: 0, joinedAt: _sts() },
      { merge: true }
    );
    const inc = _inc(1);
    if (inc) batch.update(db2.collection('tournaments').doc(tid), { participantCount: inc });

    batch.commit()
      .then(() => { _toast('🏆 Joined tournament!', 'success'); updateTournamentScore(); })
      .catch(() => _toast('Already joined or failed', 'info'));
  }

  function _leaveTournament(tid) {
    const db2 = _db(), uid = _uid();
    if (!db2 || !uid) return;
    const batch = db2.batch();
    batch.delete(db2.collection('tournaments').doc(tid).collection('participants').doc(uid));
    const dec = _inc(-1);
    if (dec) batch.update(db2.collection('tournaments').doc(tid), { participantCount: dec });
    batch.commit().then(() => _toast('Left tournament', 'info')).catch(() => {});
  }

  // ─── CHECK FOR EXISTING ACTIVE DUEL ─────────────────────────────────────────
  function _checkActiveDuel(uid) {
    if (_activeDuelId) return;
    const db2 = _db();
    if (!db2 || !uid) return;

    const check = snap => {
      const active = snap.docs.find(d => ['pending','active'].includes(d.data().state));
      if (active && !_activeDuelId) _subscribeDuel(active.id, uid);
    };

    db2.collection('duels').where('challengerUid','==', uid).limit(5).get()
      .then(check).catch(() => {});
    db2.collection('duels').where('opponentUid','==', uid).limit(5).get()
      .then(check).catch(() => {});
  }

  // ─── RENDER: DUELS TAB ───────────────────────────────────────────────────────
  function renderDuelsTab(g) {
    const uid       = _uid();
    const hasDuel   = !!(_activeDuelId && _activeDuelData);
    const isActive  = hasDuel && _activeDuelData.state === 'active';
    const isPending = hasDuel && _activeDuelData.state === 'pending';

    if ((isActive || isPending) && _duelSubTab === 'challenges') _duelSubTab = 'active';

    const SUB_TABS = [
      { id:'challenges', icon:'⚔️',  label:'Challenges' },
      { id:'active',     icon:'🔥',  label:'Active',     badge: hasDuel ? '1' : '' },
      { id:'tournament', icon:'🏆',  label:'Tournament' },
      { id:'history',    icon:'📜',  label:'History' },
    ];

    let content = '';
    switch (_duelSubTab) {
      case 'active':
        content = isActive ? _renderArena() : isPending ? _renderPending() : _renderNoActiveDuel();
        break;
      case 'tournament':
        content = _renderTournamentSection(g);
        break;
      case 'history':
        content = _renderHistory(uid) || _renderNoHistory();
        break;
      default:
        content = _renderLobby(g);
    }

    const tabBar = SUB_TABS.map(t => `
      <button class="dt-sub-btn${_duelSubTab === t.id ? ' dt-sub-active' : ''}" data-sc="ds-sub-tab" data-sub="${t.id}">
        <span class="dt-sub-ico">${t.icon}</span>
        <span class="dt-sub-lbl">${t.label}</span>
        ${t.badge ? `<span class="dt-sub-badge">${t.badge}</span>` : ''}
      </button>`).join('');

    return `<div class="dt-tab">
      <div class="dt-sub-nav">${tabBar}</div>
      <div class="dt-sub-content">${content}</div>
    </div>`;
  }

  function _renderNoActiveDuel() {
    return `<div class="dt-empty">
      <div class="dt-empty-ico">⚔️</div>
      <div class="dt-empty-ttl">No active duel</div>
      <div class="dt-empty-sub">Go to Challenges and pick a member to start a duel.</div>
    </div>`;
  }

  function _renderNoHistory() {
    return `<div class="dt-empty">
      <div class="dt-empty-ico">📜</div>
      <div class="dt-empty-ttl">No duel history yet</div>
      <div class="dt-empty-sub">Complete your first duel — results will appear here.</div>
    </div>`;
  }

  function _renderArena() {
    const d   = _activeDuelData;
    const uid = _uid();
    if (!d) return '';
    const isCh  = d.challengerUid === uid;
    const myNm  = isCh ? d.challengerName  : d.opponentName;
    const opNm  = isCh ? d.opponentName    : d.challengerName;
    const mode  = DUEL_MODES.find(m => m.id === d.mode) || DUEL_MODES[0];
    const isTime= d.mode === 'focus';
    const dur   = d.duration || 1;
    const myMs  = isCh ? d.challengerFocusMs : d.opponentFocusMs;
    const opMs  = isCh ? d.opponentFocusMs   : d.challengerFocusMs;
    const myScr = isCh ? d.challengerScore   : d.opponentScore;
    const opScr = isCh ? d.opponentScore     : d.challengerScore;
    const myW   = isCh ? d.challengerWarnings: d.opponentWarnings;
    const opW   = isCh ? d.opponentWarnings  : d.challengerWarnings;
    const mySt  = isCh ? d.challengerIsStudying : d.opponentIsStudying;
    const opSt  = isCh ? d.opponentIsStudying   : d.challengerIsStudying;
    const myVal = isTime ? myMs  : myScr;
    const opVal = isTime ? opMs  : opScr;
    const myPct = isTime ? Math.min(100, myVal/dur*100) : (myVal+opVal>0 ? Math.min(100,myVal/(myVal+opVal)*100) : 50);
    const opPct = isTime ? Math.min(100, opVal/dur*100) : (myVal+opVal>0 ? Math.min(100,opVal/(myVal+opVal)*100) : 50);

    const endsMs    = _toMs(d.endsAt);
    const remaining = endsMs ? Math.max(0, endsMs - Date.now()) : d.duration || 0;
    const countdownStr = _fmtMs(remaining);
    const urgent    = remaining > 0 && remaining < 60000;

    const R    = 38;
    const CIRC = 2 * Math.PI * R;
    const arcPct  = dur > 0 ? Math.min(1, remaining / dur) : 1;
    const arcOffset = CIRC * (1 - arcPct);

    const warnStr = n => n > 0 ? `<div class="dt-warnings">${'⚠️'.repeat(Math.min(n, MAX_WARNINGS))}</div>` : '';

    const myXP    = (isCh ? d.challengerXP     : d.opponentXP)      || 0;
    const opXP    = (isCh ? d.opponentXP        : d.challengerXP)    || 0;
    const myTasks = (isCh ? d.challengerTasks   : d.opponentTasks)   || 0;
    const opTasks = (isCh ? d.opponentTasks      : d.challengerTasks) || 0;
    const mySess  = (isCh ? d.challengerSessions : d.opponentSessions)|| 0;
    const opSess  = (isCh ? d.opponentSessions   : d.challengerSessions)||0;

    return `
    <div class="dt-arena">
      <div class="dt-arena-hdr">
        <span class="dt-arena-mode">${mode.icon} ${mode.label}</span>
        <div class="dt-timer-ring-wrap">
          <svg class="dt-timer-ring-svg" viewBox="0 0 88 88" width="88" height="88">
            <circle cx="44" cy="44" r="${R}" fill="none" stroke="rgba(99,102,241,0.15)" stroke-width="6"/>
            <circle id="dt-timer-ring-arc" cx="44" cy="44" r="${R}" fill="none"
              stroke="url(#dtArcGrad)" stroke-width="6"
              stroke-dasharray="${CIRC}" stroke-dashoffset="${arcOffset}"
              stroke-linecap="round" transform="rotate(-90 44 44)"
              style="transition:stroke-dashoffset 0.8s ease"/>
            <defs>
              <linearGradient id="dtArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#6366f1"/>
                <stop offset="100%" stop-color="#ec4899"/>
              </linearGradient>
            </defs>
          </svg>
          <div class="dt-timer-ring-inner">
            <div class="dt-arena-cd${urgent ? ' dt-cd-urgent' : ''}" id="dt-countdown">${countdownStr}</div>
            <div class="dt-timer-label">left</div>
          </div>
        </div>
      </div>

      <div class="dt-vs-wrap">
        <div class="dt-side dt-side-me">
          <div class="dt-av-wrap">
            <div class="dt-av" style="background:${_avatarBg(myNm||'')}">${(myNm||'?')[0].toUpperCase()}</div>
            ${mySt ? '<div class="dt-pulse"></div>' : ''}
          </div>
          <div class="dt-side-name">${_esc(myNm)} <span class="dt-you-tag">You</span></div>
          ${warnStr(myW)}
          <div class="dt-focus-val" id="dt-my-time">${isTime ? _fmtMs(myVal) : String(myVal)}</div>
          <div class="dt-bar-track">
            <div class="dt-bar dt-bar-me dt-bar-animated" id="dt-my-bar" style="--bar-pct:${myPct}%"></div>
          </div>
          <div class="dt-status${mySt ? ' dt-status-on' : ''}">${mySt ? '🔥 Studying' : '⏸ Paused'}</div>
        </div>

        <div class="dt-vs-orb">VS</div>

        <div class="dt-side dt-side-opp">
          <div class="dt-av-wrap">
            <div class="dt-av" style="background:${_avatarBg(opNm||'')}">${(opNm||'?')[0].toUpperCase()}</div>
            ${opSt ? '<div class="dt-pulse dt-pulse-opp"></div>' : ''}
          </div>
          <div class="dt-side-name">${_esc(opNm)}</div>
          ${warnStr(opW)}
          <div class="dt-focus-val" id="dt-opp-time">${isTime ? _fmtMs(opVal) : String(opVal)}</div>
          <div class="dt-bar-track">
            <div class="dt-bar dt-bar-opp dt-bar-animated" id="dt-opp-bar" style="--bar-pct:${opPct}%"></div>
          </div>
          <div class="dt-status${opSt ? ' dt-status-on' : ''}">${opSt ? '🔥 Studying' : '⏸ Paused'}</div>
        </div>
      </div>

      <div class="dt-live-stats">
        <div class="dt-lst-header">📊 Live Stats</div>
        <div class="dt-lst-grid">
          <div class="dt-lst-col dt-lst-me">
            <div class="dt-lst-item"><span class="dt-lst-ico">⏱️</span><span id="dt-stat-my-time">${_fmtMs(myMs)}</span></div>
            <div class="dt-lst-item"><span class="dt-lst-ico">⚡</span><span id="dt-stat-my-xp">${myXP}</span></div>
            <div class="dt-lst-item"><span class="dt-lst-ico">✅</span><span id="dt-stat-my-tasks">${myTasks}</span></div>
            <div class="dt-lst-item"><span class="dt-lst-ico">🍅</span><span id="dt-stat-my-sess">${mySess}</span></div>
            <div class="dt-lst-item"><span class="dt-lst-ico">🔥</span><span id="dt-stat-my-streak">${_ms().streakCount||0}</span></div>
          </div>
          <div class="dt-lst-divider"></div>
          <div class="dt-lst-col dt-lst-opp">
            <div class="dt-lst-item"><span id="dt-stat-opp-time">${_fmtMs(opMs)}</span><span class="dt-lst-ico">⏱️</span></div>
            <div class="dt-lst-item"><span id="dt-stat-opp-xp">${opXP}</span><span class="dt-lst-ico">⚡</span></div>
            <div class="dt-lst-item"><span id="dt-stat-opp-tasks">${opTasks}</span><span class="dt-lst-ico">✅</span></div>
            <div class="dt-lst-item"><span id="dt-stat-opp-sess">${opSess}</span><span class="dt-lst-ico">🍅</span></div>
            <div class="dt-lst-item"><span>—</span><span class="dt-lst-ico">🔥</span></div>
          </div>
        </div>
      </div>

      <div class="dt-arena-tip">${mode.desc} • Study now to gain ground!</div>
      <button class="dt-btn dt-btn-ghost dt-btn-sm dt-forfeit-btn" data-sc="ds-surrender">🏳 Surrender</button>
    </div>`;
  }

  function _renderPending() {
    const d   = _activeDuelData;
    const uid = _uid();
    if (!d) return '';
    const isCh  = d.challengerUid === uid;
    const mode  = DUEL_MODES.find(m => m.id === d.mode) || DUEL_MODES[0];
    const oppNm = isCh ? d.opponentName : d.challengerName;

    return `
    <div class="dt-pending">
      <div class="dt-pending-icon">⚔️</div>
      <div class="dt-pending-title">${isCh ? `Waiting for ${_esc(oppNm)}…` : `${_esc(oppNm)} challenged you!`}</div>
      <div class="dt-pending-meta">${mode.icon} ${mode.label} · ${_fmtMs(d.duration)}</div>
      ${isCh
        ? `<button class="dt-btn dt-btn-ghost dt-btn-sm" data-sc="ds-cancel-duel" style="margin-top:12px">Cancel Challenge</button>`
        : `<div class="dt-pending-btns">
             <button class="dt-btn dt-btn-ghost" data-sc="ds-reject-duel">Decline</button>
             <button class="dt-btn dt-btn-primary" data-sc="ds-accept-duel">⚔️ Accept</button>
           </div>`}
    </div>`;
  }

  function _renderLobby(g) {
    const uid     = _uid();
    const members = Object.entries(window._scLiveMembers?.() || {})
      .filter(([mUid]) => mUid !== uid)
      .map(([mUid, d]) => ({ uid:mUid, name:d.displayName||'Member', studying:d.isStudying }));

    if (!members.length) {
      return `<div class="dt-empty">
        <div class="dt-empty-ico">⚔️</div>
        <div class="dt-empty-ttl">No members to challenge</div>
        <div class="dt-empty-sub">Other members appear here when they join the group.</div>
      </div>`;
    }

    const cards = members.map(m => `
      <div class="dt-chal-card">
        <div class="dt-chal-av" style="background:${_avatarBg(m.name)}">${(m.name[0]||'?').toUpperCase()}</div>
        <div class="dt-chal-info">
          <div class="dt-chal-name">${_esc(m.name)}</div>
          <div class="dt-chal-st">${m.studying ? '🔥 Studying now' : '⏸ Online'}</div>
        </div>
        <button class="dt-btn dt-btn-duel" data-sc="ds-open-challenge" data-uid="${_esc(m.uid)}" data-name="${_esc(m.name)}">⚔️ Duel</button>
      </div>`).join('');

    return `
    <div class="dt-lobby">
      <div class="dt-sec-hd"><span class="dt-sec-ico">⚔️</span><span class="dt-sec-title">Challenge a Member</span></div>
      <div class="dt-chal-list">${cards}</div>
    </div>`;
  }

  function _renderHistory(uid) {
    const items = _duelHistory.filter(d => d.state === 'completed').slice(0, 5);
    if (!items.length) return '';

    const rows = items.map(d => {
      const won   = d.winner === uid;
      const draw  = d.winner === 'draw';
      const isCh  = d.challengerUid === uid;
      const opp   = _esc(isCh ? d.opponentName : d.challengerName);
      const mode  = DUEL_MODES.find(m => m.id === d.mode) || DUEL_MODES[0];
      const ic    = won ? '🏆' : draw ? '🤝' : '💀';
      const cls   = won ? 'dt-hist-w' : draw ? 'dt-hist-d' : 'dt-hist-l';
      return `<div class="dt-hist-row">
        <span class="dt-hist-ic ${cls}">${ic}</span>
        <span class="dt-hist-nm">${opp}</span>
        <span class="dt-hist-mo">${mode.icon}</span>
        <span class="dt-hist-res ${cls}">${won?'Won':draw?'Draw':'Lost'}</span>
      </div>`;
    }).join('');

    return `<div class="dt-hist-sec">
      <div class="dt-sec-hd"><span class="dt-sec-title">Recent Duels</span></div>
      <div class="dt-hist-list">${rows}</div>
    </div>`;
  }

  // ─── RENDER: TOURNAMENT SECTION ──────────────────────────────────────────────
  function _renderTournamentSection(g) {
    const uid      = _uid();
    const canAdmin = _getMyRole(g) === 'owner' || _getMyRole(g) === 'admin';

    // Sort: active first, then upcoming, then completed
    const sorted = [..._groupTournaments].sort((a, b) => {
      const order = { active: 0, upcoming: 1, completed: 2 };
      return (order[a.status] ?? 1) - (order[b.status] ?? 1);
    });

    const cards = sorted.map(t => _renderTournCard(t, uid)).join('');

    return `<div class="tn-tab">
      ${canAdmin ? `<button class="dt-btn dt-btn-primary tn-new-btn" data-sc="ds-create-tournament" data-gid="${_esc(g.id)}">🏆 Create Tournament</button>` : ''}
      ${sorted.length
        ? `<div class="tn-cards-list">${cards}</div>`
        : `<div class="dt-empty">
             <div class="dt-empty-ico">🏆</div>
             <div class="dt-empty-ttl">No tournaments yet</div>
             <div class="dt-empty-sub">${canAdmin ? 'Create one to motivate your group!' : 'Ask an admin to start a tournament.'}</div>
           </div>`}
    </div>`;
  }

  function _renderTournCard(t, uid) {
    const type    = TOURNAMENT_TYPES.find(x => x.id === t.type) || TOURNAMENT_TYPES[0];
    const startMs = _toMs(t.startTime);
    const endMs   = _toMs(t.endTime);
    const now     = Date.now();

    const isActive    = t.status === 'active' || (t.status !== 'completed' && now >= startMs && now <= endMs);
    const isCompleted = t.status === 'completed' || now > endMs;
    const isUpcoming  = !isActive && !isCompleted;

    const statusLabel = isCompleted ? 'ENDED' : isActive ? 'LIVE' : 'SOON';
    const stCls       = isCompleted ? 'tn-badge-done' : isActive ? 'tn-badge-live' : 'tn-badge-soon';

    const fmtDate = ms => {
      if (!ms) return 'TBD';
      return new Date(ms).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    };

    // Countdown for active tournaments
    let timeHint = '';
    if (isActive && endMs) {
      const left = endMs - now;
      timeHint = `<div class="tn-time-left">⏱ ${_fmtMs(left)} remaining</div>`;
    } else if (isUpcoming && startMs) {
      const toStart = startMs - now;
      timeHint = `<div class="tn-time-left tn-time-soon">🕐 Starts in ${_fmtMs(toStart)}</div>`;
    }

    const cardCls = isActive ? 'tn-card tn-card-active' : isCompleted ? 'tn-card tn-card-done' : 'tn-card tn-card-upcoming';

    return `
    <div class="${cardCls}">
      ${isActive ? '<div class="tn-glow-border"></div>' : ''}
      <div class="tn-card-hdr">
        <span class="tn-card-type">${type.icon} ${type.label}</span>
        <span class="tn-badge ${stCls}">${statusLabel}</span>
      </div>
      <div class="tn-card-title">${_esc(t.title)}</div>
      ${t.description ? `<div class="tn-card-desc">${_esc(t.description.slice(0,80))}${t.description.length>80?'…':''}</div>` : ''}
      <div class="tn-card-meta">
        <span>📅 ${fmtDate(startMs)}</span>
        <span>→ ${fmtDate(endMs)}</span>
        <span>👥 ${t.participantCount||0}${t.participantLimit ? '/'+t.participantLimit : ''}</span>
      </div>
      ${timeHint}
      ${t.rewards ? `<div class="tn-reward">🎁 ${_esc(t.rewards.slice(0,60))}</div>` : ''}
      <div class="tn-card-acts">
        <button class="dt-btn dt-btn-sm dt-btn-outline" data-sc="ds-view-tournament" data-tid="${_esc(t.id)}">📊 Leaderboard</button>
        ${!isCompleted ? `<button class="dt-btn dt-btn-sm dt-btn-primary" data-sc="ds-join-tournament" data-tid="${_esc(t.id)}">Join</button>` : ''}
      </div>
    </div>`;
  }

  // ─── MODALS ──────────────────────────────────────────────────────────────────
  function openChallengeModal(targetUid, targetName) {
    if (_activeDuelId)  { _toast('You already have an active duel', 'warn'); return; }
    if (!_uid())        { _toast('Sign in to challenge', 'warn'); return; }
    if (!targetUid || targetUid === _uid()) { _toast('Cannot challenge yourself', 'warn'); return; }

    let selMode = 'focus';
    let selDur  = 60 * 60 * 1000;
    let isCustom= false;

    const modeGrid = DUEL_MODES.map(m => `
      <button class="dt-mode-chip${m.id===selMode?' dt-chip-on':''}" data-mode="${m.id}" type="button">
        <span class="dt-chip-ico">${m.icon}</span>
        <span class="dt-chip-lbl">${m.label}</span>
        <span class="dt-chip-sub">${m.desc}</span>
      </button>`).join('');

    const durRow = DUEL_DURATIONS.map(d => `
      <button class="dt-dur-chip${d.ms===selDur?' dt-chip-on':''}" data-dur="${d.ms}" type="button">${d.label}</button>
    `).join('');

    _modal(`
      <div class="dt-chal-modal">
        <h3 class="sc-modal-title">⚔️ Challenge ${_esc(targetName)}</h3>
        <label class="sc-label" style="margin-top:10px">Battle Mode</label>
        <div class="dt-mode-grid" id="dt-mgrid">${modeGrid}</div>
        <label class="sc-label" style="margin-top:14px">Duration</label>
        <div class="dt-dur-row" id="dt-drow">${durRow}</div>
        <div id="dt-custom-dur-wrap" style="display:none;margin-top:10px;background:rgba(99,102,241,0.08);border-radius:10px;padding:12px;gap:10px;flex-direction:column">
          <div style="display:flex;gap:8px;align-items:center">
            <div style="flex:1">
              <label class="sc-label" style="font-size:11px">Hours</label>
              <input id="dt-cust-h" type="number" min="0" max="23" value="1" class="sc-input" style="text-align:center"/>
            </div>
            <div style="flex:1">
              <label class="sc-label" style="font-size:11px">Minutes</label>
              <input id="dt-cust-m" type="number" min="0" max="59" value="0" class="sc-input" style="text-align:center"/>
            </div>
          </div>
          <div>
            <label class="sc-label" style="font-size:11px">Or exact end time</label>
            <input id="dt-cust-time" type="datetime-local" class="sc-input"/>
          </div>
        </div>
        <div class="actions" style="margin-top:18px">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn sc-modal-submit" id="dt-send-btn">⚔️ Send Challenge</button>
        </div>
      </div>`, root => {
        root.querySelector('#dt-mgrid').addEventListener('click', e => {
          const b = e.target.closest('[data-mode]'); if (!b) return;
          selMode = b.dataset.mode;
          root.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('dt-chip-on', x.dataset.mode === selMode));
        });
        root.querySelector('#dt-drow').addEventListener('click', e => {
          const b = e.target.closest('[data-dur]'); if (!b) return;
          const ms = parseInt(b.dataset.dur);
          root.querySelectorAll('[data-dur]').forEach(x => x.classList.toggle('dt-chip-on', parseInt(x.dataset.dur) === ms));
          if (ms === -1) {
            isCustom = true;
            root.querySelector('#dt-custom-dur-wrap').style.display = 'flex';
          } else {
            isCustom = false;
            selDur   = ms;
            root.querySelector('#dt-custom-dur-wrap').style.display = 'none';
          }
        });
        root.querySelector('#dt-send-btn').addEventListener('click', () => {
          if (isCustom) {
            const exactEl = root.querySelector('#dt-cust-time');
            if (exactEl.value) {
              const endTs = new Date(exactEl.value).getTime();
              selDur = endTs - Date.now();
            } else {
              const h = parseInt(root.querySelector('#dt-cust-h').value) || 0;
              const m = parseInt(root.querySelector('#dt-cust-m').value) || 0;
              selDur  = (h * 60 + m) * 60 * 1000;
            }
          }
          if (!selDur || selDur < MIN_SESSION_MS) { _toast('Minimum duration is 1 minute', 'warn'); return; }
          _close();
          _sendChallenge(targetUid, targetName, selMode, selDur);
        });
      });
  }

  function _openCreateTournamentModal(groupCode) {
    let selType = 'focus_time';

    const typeGrid = TOURNAMENT_TYPES.map((t, i) => `
      <button class="dt-mode-chip${i===0?' dt-chip-on':''}" data-ttype="${t.id}" type="button">
        <span class="dt-chip-ico">${t.icon}</span>
        <span class="dt-chip-lbl">${t.label}</span>
        <span class="dt-chip-sub">${t.desc}</span>
      </button>`).join('');

    const ds = new Date(Date.now() + 3600000).toISOString().slice(0,16);
    const de = new Date(Date.now() + 8*86400000).toISOString().slice(0,16);

    _modal(`
      <div class="dt-chal-modal">
        <h3 class="sc-modal-title">🏆 Create Tournament</h3>
        <div class="sc-field">
          <label class="sc-label">Tournament Name *</label>
          <input id="tn-t" type="text" maxlength="50" class="sc-input" placeholder="e.g. November Focus Marathon" autocomplete="off"/>
        </div>
        <label class="sc-label" style="margin-top:10px">Type</label>
        <div class="dt-mode-grid dt-mode-grid-sm" id="tn-type-g">${typeGrid}</div>
        <div class="sc-field sc-field-row" style="margin-top:12px">
          <div style="flex:1"><label class="sc-label">Start</label><input id="tn-s" type="datetime-local" class="sc-input" value="${ds}"/></div>
          <div style="flex:1"><label class="sc-label">End</label><input id="tn-e" type="datetime-local" class="sc-input" value="${de}"/></div>
        </div>
        <div class="sc-field">
          <label class="sc-label">Max Participants</label>
          <input id="tn-lim" type="number" min="2" max="64" value="16" class="sc-input" style="text-align:center"/>
        </div>
        <div class="sc-field">
          <label class="sc-label">Rewards (optional)</label>
          <input id="tn-rew" type="text" maxlength="80" class="sc-input" placeholder="e.g. Top 3 earn XP bonus + badge"/>
        </div>
        <div class="sc-field">
          <label class="sc-label">Rules (optional)</label>
          <textarea id="tn-rul" rows="2" maxlength="200" class="sc-textarea" placeholder="Any special rules…"></textarea>
        </div>
        <div class="actions" style="margin-top:18px">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn sc-modal-submit" id="tn-go">🏆 Create</button>
        </div>
      </div>`, root => {
        root.querySelector('#tn-type-g').addEventListener('click', e => {
          const b = e.target.closest('[data-ttype]'); if (!b) return;
          selType = b.dataset.ttype;
          root.querySelectorAll('[data-ttype]').forEach(x => x.classList.toggle('dt-chip-on', x.dataset.ttype === selType));
        });
        root.querySelector('#tn-go').addEventListener('click', () => {
          const title = root.querySelector('#tn-t').value.trim();
          if (!title) { _toast('Enter a tournament name', 'warn'); return; }
          _close();
          _createTournament(groupCode, {
            title, type: selType,
            startTime: root.querySelector('#tn-s').value,
            endTime:   root.querySelector('#tn-e').value,
            limit:     root.querySelector('#tn-lim').value,
            rewards:   root.querySelector('#tn-rew').value,
            rules:     root.querySelector('#tn-rul').value,
          });
        });
      });
  }

  function _openTournamentDetail(tid) {
    const t = _groupTournaments.find(x => x.id === tid);
    if (!t) return;
    const type = TOURNAMENT_TYPES.find(x => x.id === t.type) || TOURNAMENT_TYPES[0];
    const isCompleted = t.status === 'completed' || _toMs(t.endTime) < Date.now();

    _modal(`
      <div class="dt-chal-modal dt-tourn-detail">
        <h3 class="sc-modal-title">${type.icon} ${_esc(t.title)}</h3>
        ${t.description ? `<p style="color:var(--sc-muted,#8892a4);font-size:13px;margin:4px 0 12px">${_esc(t.description)}</p>` : ''}
        ${t.rewards ? `<div class="tn-reward" style="margin-bottom:12px">🎁 ${_esc(t.rewards)}</div>` : ''}
        ${t.rules ? `<div class="tn-rules">📜 ${_esc(t.rules)}</div>` : ''}
        <div class="tn-lb-header">
          <span>🏆 Live Leaderboard</span>
          <span class="tn-lb-badge${isCompleted ? ' tn-lb-done' : ' tn-lb-live'}">${isCompleted ? 'FINAL' : '● LIVE'}</span>
        </div>
        <div id="tn-part-list" class="tn-rank-list-wrap"><div class="dt-loading-msg">Loading…</div></div>
        <div class="actions" style="margin-top:16px">
          <button class="btn btn-ghost" data-close>Close</button>
          ${!isCompleted ? `<button class="btn sc-modal-submit" id="tn-join-modal" data-tid="${_esc(tid)}">Join</button>` : ''}
        </div>
      </div>`, root => {
        root.querySelector('#tn-join-modal')?.addEventListener('click', () => {
          _close(); _joinTournament(tid);
        });

        const db2 = _db();
        if (!db2) return;

        const renderList = snap => {
          const uid = _uid();
          const docs = snap.docs || snap;
          const parts = docs.map(d => ({ ...d.data(), _id: d.id }));
          parts.sort((a, b) => (b.score||0) - (a.score||0));

          const rows = parts.map((p, i) => {
            const isMe = p.uid === uid;
            const crown = i === 0 ? '<span class="tn-crown">👑</span>' : `<span class="tn-rank-pos">#${i+1}</span>`;
            const scoreFmt = t.type === 'focus_time' ? _fmtMs(p.score||0) : String(p.score||0);
            return `<div class="tn-rank-row${isMe?' tn-rank-me':''}${i===0?' tn-rank-first':''}">
              ${crown}
              <div class="tn-rank-av" style="background:${_avatarBg(p.name||'')}">${(p.name||'?')[0].toUpperCase()}</div>
              <span class="tn-rank-nm">${_esc(p.name||'Unknown')}${isMe?' <span class="dt-you-tag">You</span>':''}</span>
              <div class="tn-rank-right">
                <span class="tn-rank-sc">${scoreFmt}</span>
                <div class="tn-rank-bar-track"><div class="tn-rank-bar" style="width:${parts[0].score > 0 ? Math.min(100, (p.score||0)/parts[0].score*100) : 0}%"></div></div>
              </div>
            </div>`;
          }).join('');

          const el = root.querySelector('#tn-part-list');
          if (el) el.innerHTML = `<div class="tn-rank-list">${rows||'<div class="dt-loading-msg">No participants yet</div>'}</div>`;
        };

        // Realtime leaderboard
        if (_tournDetailSub) { try { _tournDetailSub(); } catch(_) {} _tournDetailSub = null; }
        _tournDetailSub = db2.collection('tournaments').doc(tid).collection('participants')
          .orderBy('score', 'desc').limit(30)
          .onSnapshot(renderList, () => {
            const el = root.querySelector('#tn-part-list');
            if (el) el.innerHTML = '<div class="dt-loading-msg">Unable to load</div>';
          });

        // Clean up when modal closes
        root.addEventListener('modal-close', () => {
          if (_tournDetailSub) { try { _tournDetailSub(); } catch(_) {} _tournDetailSub = null; }
        });
      });
  }

  // ─── EVENT HANDLER ───────────────────────────────────────────────────────────
  function handleEvent(act, el, g) {
    const uid = _uid();
    switch (act) {
      case 'ds-sub-tab': {
        const sub = el.dataset.sub;
        if (sub) { _duelSubTab = sub; _rerender(); }
        break;
      }
      case 'ds-open-challenge': {
        const tuid = el.dataset.uid, tname = el.dataset.name || 'Member';
        if (!tuid || tuid === uid) { _toast('Cannot challenge yourself', 'warn'); break; }
        openChallengeModal(tuid, tname);
        break;
      }
      case 'ds-surrender': {
        _confirm('Surrender the duel? Your opponent wins.', () => _forfeit(uid, 'Surrendered'),
          { title:'Surrender?', yesLabel:'Surrender', yesClass:'btn btn-danger' });
        break;
      }
      case 'ds-cancel-duel': {
        if (_activeDuelId) {
          _db()?.collection('duels').doc(_activeDuelId).update({ state:'cancelled', winner:'no_contest' }).catch(() => {});
          _cleanDuel(); _rerender(); _toast('Challenge cancelled', 'info');
        }
        break;
      }
      case 'ds-accept-duel': {
        if (_activeDuelId && _activeDuelData?.state === 'pending') acceptDuel(_activeDuelId);
        break;
      }
      case 'ds-reject-duel': {
        if (_activeDuelId) { rejectDuel(_activeDuelId); _cleanDuel(); _rerender(); }
        break;
      }
      case 'ds-create-tournament': {
        _openCreateTournamentModal(_groupCode || g?.code || '');
        break;
      }
      case 'ds-join-tournament': {
        const tid = el.dataset.tid;
        if (tid) _joinTournament(tid);
        break;
      }
      case 'ds-view-tournament': {
        const tid = el.dataset.tid;
        if (tid) _openTournamentDetail(tid);
        break;
      }
      case 'ds-leave-tournament': {
        const tid = el.dataset.tid;
        if (tid) _confirm('Leave this tournament?', () => _leaveTournament(tid),
          { title:'Leave Tournament?', yesLabel:'Leave', yesClass:'btn btn-danger' });
        break;
      }
    }
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────────
  function onGroupEnter(groupCode) {
    if (_groupCode === groupCode) return;

    if (_groupCode) { _cleanTourn(); _historyLoaded = false; }
    _groupCode = groupCode;

    const uid = _uid();
    if (uid) {
      _subscribeInvites(uid);
      _loadHistory(uid);
    }
    _subTournaments(groupCode);
    _checkActiveDuel(uid);
  }

  function destroy() {
    _cleanDuel(); _cleanInvite(); _cleanTourn();
    _groupCode = null; _duelHistory = [];
    _pendingInvites.clear(); _historyLoaded = false;
  }

  function setDuelSubTab(tab) {
    _duelSubTab = tab;
    window._socialRender?.();
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────────
  window.DuelSystem = {
    onGroupEnter, destroy,
    renderDuelsTab,
    setDuelSubTab,
    handleEvent, acceptDuel, rejectDuel,
    openChallengeModal,
    updateTournamentScore,
  };

  window._scChallengeDuelLegacy = openChallengeModal;

})();
