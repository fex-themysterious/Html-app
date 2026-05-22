# Syllabus Tracker PWA

An offline-capable Progressive Web App for tracking study progress with spaced repetition, Pomodoro focus timer, syllabus management, and stats dashboard.

## Run & Operate
- **Start:** `npm start` (runs `node server.js` on port 5000)
- No environment variables required

## Stack
- **Frontend:** Vanilla HTML + CSS + JavaScript (single-page app)
- **Charts:** Chart.js 4.4.7 (CDN)
- **PWA:** Service worker (`sw.js`) with cache-first strategy + audio range support
- **Server:** Node.js `http` module static file server (`server.js`)
- **Runtime:** Node >= 20

## Where things live
- `index.html` — App shell with 6 views and bottom nav
- `style.css` — Dark theme styling
- `script.js` — All app logic (state, spaced repetition, timer, notifications, CRUD)
- `sw.js` — Service worker (offline caching, audio streaming)
- `manifest.json` — PWA manifest
- `server.js` — Static file server with HTTP Range support for audio
- `sounds/` — Ambient/focus audio files
- `duel.js` — Self-contained DuelSystem module (challenge flow, battle arena RAF loop, anti-cheat, XP awards, tournament CRUD)

## Architecture decisions
- All data persisted in `localStorage` under key `syllabus_tracker_v2` — primary store
- Cloud sync via Firebase Firestore v8 compat CDN + Firebase Auth v8 compat
- Auth: **Email/password only** (Google removed). `firebase.auth.Auth.Persistence.LOCAL` — users stay logged in across sessions. `onAuthStateChanged` drives all sync
- Signup: `createUserWithEmailAndPassword` → `onAuthStateChanged(user)` immediately grants Home tab access. No email verification gate.
- Login: `signInWithEmailAndPassword` → `onAuthStateChanged(user)` grants access instantly. Client-side email format validation (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) runs before any network call.
- On login: if user has Firestore data → restore it; if not → upload current local data. All Firestore writes under `users/{auth.uid}`
- Login modal: dark glassmorphism overlay (`#auth-overlay`) with Email + Password fields, Sign In / Sign Up toggle, Forgot Password link, Enter-key support. No Google button.
- Cloud sync icon (top-right, left of settings): gray=idle, amber-pulsing=syncing, green=saved, red=error. Only active when authenticated
- Settings modal shows ☁️ Account section at top: avatar + email + Sign Out button (or Sign In CTA if not logged in)
- Single large vanilla JS IIFE in `script.js` manages all state and rendering
- Service worker uses cache-first for static assets, special range-request handling for `/sounds/`
- Server falls back to `index.html` for unknown paths (SPA routing)

## Product
- Syllabus management: subjects → chapters → topics
- Daily plan generation with spaced repetition revision scheduling (offsets: 1, 3, 7 days)
- Pomodoro focus timer with ambient audio
- Live Study Timer (Focus tab top-mode switch): count-up elapsed clock, subject selector, split counters (subject total | today total), gamification badges (XP/Lv/Streak/Multiplier), today's study log card with progress bars, neon-orange stick-figure animation, play/pause button, Firebase real-time sync (`users/{uid}/liveSession`), session persistence to `syllabus_logs` subcollection, leaderboard `dailyStudyTime` increment in `global_lb`
- Streak and activity tracking
- Weak-topic detection
- Stats dashboard with Chart.js charts, daily efficiency score, focus-by-subject bars, and achievement badge grid
- Offline support via PWA service worker
- Social Study Rooms (5th tab in nav): 6-digit room codes, live focus map (onSnapshot presence), XP Focus Bounty (−50 XP on early quit → distributed to online members), Subject Mastery Leaderboard, Weekly Friend Leaderboard, Group Challenges with progress bar, and Nudge/Poke system
- **Duel Fight System** (`duel.js`): 1v1 challenge flow (send/accept/reject via `duelInvites/{uid}/incoming`), live battle arena with RAF progress loop, anti-cheat via visibilityAPI + 8s heartbeat, result modal with XP awards (winner +150 XP, loser +30 XP), Duel Victor badge; `/duels/{duelId}` Firestore doc with `participants`, `progress`, `status`, `startedAt`, `endsAt` fields
- **Tournament System** (`duel.js`): create/join/leave/delete tournaments (`/tournaments` collection); 6 types (focus time, XP, sessions, streak, knockout, task); realtime leaderboard via `participants` subcollection with `onSnapshot`; live member count tracked via separate count listener (`_partCountSubsMap` + `_tournParticipantCounts`); transaction-based join/leave prevents duplicates and race conditions; `data-tn-count` attr enables in-place DOM count updates without full re-render
- **Tournament XP Prize Pool** (`duel.js`): admin can set `prizePoolXP`, `rewardDistribution` (1st/2nd/3rd), `donatedBy`; XP deducted from admin on creation; auto-distributed to winners on end via `_distributePrizes()`; refunded if tournament deleted before end (`prizeStatus`: active → distributed/refunded); `rewardedUsers` array stores winners; leaderboard shows prize tip per eligible rank
- **Tournament Detail Modal** redesigned: hero header with type chip + live badge, meta row (start/end/count), countdown box (prominent timer), prize pool banner (split breakdown + winner chips), rules section ("No rules added yet" placeholder), full-height leaderboard with crown/medal icons + progress bars + rank-change animation + prize tips + You badge; sticky action footer; de-duplicated participant list; tie-breaking by join time
- Group room bottom nav now has 7 scrollable tabs: Members · Chat · Challenges · Leaderboard · Duels · Tournament · XP Bounty
- Duel/Tournament Firestore collections: `/duels/{duelId}`, `/duelInvites/{uid}/incoming/{duelId}`, `/tournaments/{tournamentId}`, `/tournaments/{tournamentId}/participants/{uid}`, `/tournaments/{tournamentId}/matches/{matchId}`
- Tournament Firestore fields: `prizePoolXP`, `rewardDistribution`, `donatedBy`, `prizeStatus`, `rewardedUsers`, `tournamentStatus`, `rules`, `description`
- `window.appUI` bridge extended with `addXP(amt, reason)` and `checkBadges(badgeId)` for cross-module gamification
- `window._scLiveMembers()` → live presence map; `window._scSetSrTab(tab)` → set group sub-tab programmatically; `window._socialRender()` → trigger social re-render (all exported from social.js)
- Navigation (6 tabs): Home → Dashboard → Syllabus → Focus → Social → Stats. Home is the default landing tab.
- Home tab: Welcome greeting, XP/level bar, progress bento grid, Today's Plan (task list with checkboxes + delete only — NO add-from-syllabus), motivational quote at bottom.
- Dashboard tab: Study Calendar/Heatmap, Goals, Smart Suggestions, Weak Areas, Revision Zone (Due Today + Upcoming). Plan adder (add from syllabus) stays on Dashboard only.

## User preferences
- Premium anime/wuxia dark UI aesthetic with orange accent (#ff7a1a) and black background
- Mobile-first, native Android app feeling
- Glassmorphism cards, smooth spring animations, floating particle backgrounds

## Theme Store Page
- `theme-store.html` — standalone Theme Store / Purchase page
- `theme-store.css` — all styles (CSS variables, glassmorphism, character art)
- `theme-store.js` — all logic (state, purchase flow, toggle, toast, confetti, particles)
- Access at `/theme-store.html`
- State persisted in localStorage under key `themeStore_v1`
- 8 theme variants (2 locked), purchase flow, dark/light toggle, heart favorite, swipe gallery

## Date / Timezone Architecture
- **`localISO(d)`** — canonical date formatter. Uses `d.getFullYear() / getMonth() / getDate()` (local fields). NEVER use `toISOString().slice(0,10)` for date keys — it returns UTC and causes off-by-one on UTC+ devices.
- **`todayKey()`** — returns `localISO(new Date())`. All storage keys (`minutesByDate`, `sessions`, `videoMinutes`, `activity`) are local-timezone YYYY-MM-DD strings.
- **`addDaysISO(base, days)`** — uses `localISO()` for the result. Safe for revision scheduling, streak maths, etc.
- **`buildDateRange(n)`** — returns array of last N local-date keys, ascending, ending with today. Used for all chart loops (no `for` loop with `toISOString`).
- **Migration** — runs once at startup (`_migrateStatsToLocalDates`): re-keys any old UTC-midnight keys to their local-date equivalent, then persists.
- **Chart instant update** — focus session end (`onVfmComplete`) AND Pomodoro session end both call `renderStats()` if the Stats tab is visible. No page refresh needed.

## Global Realtime Sync Engine (`sync-engine.js`)
- **File:** `sync-engine.js?v=1` — loaded before `script.js`, exposes `window.SyncEngine`
- **Cross-device listener:** `onSnapshot` on `users/{uid}` — detects remote state changes, merges if newer, calls `_onSyncEngineRemoteUpdate()` in script.js
- **Conflict resolution:** `_syncVersion` (incrementing counter) + `_savedAt` (timestamp) — cloud wins only if its version is strictly higher, or same version but >10 s newer
- **Priority write queue:** `IMMEDIATE` (0 ms), `FAST` (600 ms), `NORMAL` (handled by existing `_scheduledCloudSync`). Task completion and XP changes use `FAST`.
- **XP leaderboard sync:** `syncXPToLeaderboard(xpTotal)` — debounced 1.5 s write to `global_lb/{uid}` after every XP change. Called via `_debouncedSocialSync()` which is now active.
- **Offline queue:** mutations during offline stored in `localStorage._se_queue`, replayed on reconnect
- **Heartbeat:** 30 s writes to `users/{uid}._lastSeen + _online` for presence
- **Guards:** respects `_cloudRestoreInProgress`, `_userHasCloudData`, `hasPendingWrites`, `_myLastVersion` to avoid loops and stale overwrites
- **Window bridges:** `window._getSyncState()`, `window._isCloudRestoreInProgress()`, `window._getUserHasCloudData()` — allow SyncEngine to safely read IIFE-scoped state

## Background Timer Persistence (Android/OPPO/Realme/Vivo)
- **`timer-worker.js`** — Web Worker that fires a `tick` message every 500 ms; more resilient than UI-thread `setInterval` on aggressive battery optimisers
- **`_SharedWorkerTimer`** singleton in `script.js`: `add(id, fn)` / `remove(id)` / `restart()` — shared tick source for both Pomodoro and Live Study. Auto-starts the Worker on first listener; falls back to `setInterval` if Worker creation fails. 200 ms dedup window prevents double-fire when Worker + setInterval both tick.
- **Belt-and-suspenders**: both `setInterval` (existing) and Web Worker tick the same functions simultaneously. Since both `focusTick` and `_lsTick` are timestamp-based (not counter-based), calling them more frequently is idempotent — only the display updates faster.
- **`focusTick` guard**: `if (!focusRunning) return;` at the very top prevents double-completion and stale ticks from the Worker after session ends.
- **`_onTimerResume()`** global handler — called on `visibilitychange` (foreground), `pageshow` (bfcache), `window.focus` (OPPO app-switch), and `document.resume` (Chrome PWA thaw). Checks if timer completed in background → calls `focusTick()` directly. Calls `_SharedWorkerTimer.restart()` to revive a killed Worker.
- **WakeLock for Live Study** (`_lsWakeLock`): acquired on session start, auto-reacquired on `release` event if still running. Mirrors existing Pomodoro `_timerWakeLock` pattern.
- **Heartbeat**: Live Study saves `{startTime, elapsedBase, subjectId}` to `_ls_heartbeat` in localStorage every tick for crash/kill recovery. Pomodoro uses `OfflineSync._pom_timer_state` (timestamp-based, no per-second update needed).
- **Duplicate timer prevention**: `_SharedWorkerTimer.add()` is idempotent per id — re-registering the same id just overwrites the function reference. `focusTick` guard prevents double-fire.

## Gotchas
- Cache-busting: `script.js?v=212`, `sync-engine.js?v=1`, `social.js?v=37`, `style.css?v=134`, `social.css?v=26`, `duel.js?v=3` — increment when making changes; SW cache is `syllabus-tracker-v209`
- Audio files need HTTP Range request support (already handled in `server.js` and `sw.js`)
- Global orientation is **portrait-locked** (manifest + JS `lock('portrait')` on startup). Full Focus Mode and Video Player expose a ⤢ landscape toggle button that calls `toggleOrientLock()`; exiting either mode calls `lockPortrait()` to restore portrait. `--real-vh` CSS var is set by JS on every `orientationchange`/`resize` for iOS Safari.
- Full Focus overlay uses a **flat CSS Grid** layout. Direct children of `.fs-content`: `fs-top` (badge+dots), `fs-task-box`, `fs-timer-wrap`, `fs-ctrl-col`, `fs-motivation-box`, `fs-footer` (hint only). Portrait grid: `"top task" / "ring ctrl" / "moti moti" / "foot foot"`. Landscape grid (both mobile ≤500px and desktop): 3-column `"top ring task" / "moti ring ctrl" / "foot foot foot"` — left=navy motivation panel, center=dominant timer (270px/76px mobile, 300px/80px desktop), right=indigo panel (task top + controls bottom, `border-top: none` to appear seamless). `_fsMotiQuote` set once in `startFullSession()`.

## Pointers
- Testing skill: `.local/skills/testing/SKILL.md`
- Workflows skill: `.local/skills/workflows/SKILL.md`
