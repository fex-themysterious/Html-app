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
- Streak and activity tracking
- Weak-topic detection
- Stats dashboard with Chart.js charts, daily efficiency score, focus-by-subject bars, and achievement badge grid
- Offline support via PWA service worker
- Social Study Rooms (5th tab in nav): 6-digit room codes, live focus map (onSnapshot presence), XP Focus Bounty (−50 XP on early quit → distributed to online members), XP Duel (1v1, 2-hour countdown, Duel Victor badge), Subject Mastery Leaderboard, Weekly Friend Leaderboard, Group Challenges with progress bar, and Nudge/Poke system
- Navigation (6 tabs): Home → Dashboard → Syllabus → Focus → Social → Stats. Home is the default landing tab.
- Home tab: Welcome greeting, XP/level bar, progress bento grid, Today's Plan (task list with checkboxes + delete only — NO add-from-syllabus), motivational quote at bottom.
- Dashboard tab: Study Calendar/Heatmap, Goals, Smart Suggestions, Weak Areas, Revision Zone (Due Today + Upcoming). Plan adder (add from syllabus) stays on Dashboard only.

## User preferences
_Populate as you build_

## Date / Timezone Architecture
- **`localISO(d)`** — canonical date formatter. Uses `d.getFullYear() / getMonth() / getDate()` (local fields). NEVER use `toISOString().slice(0,10)` for date keys — it returns UTC and causes off-by-one on UTC+ devices.
- **`todayKey()`** — returns `localISO(new Date())`. All storage keys (`minutesByDate`, `sessions`, `videoMinutes`, `activity`) are local-timezone YYYY-MM-DD strings.
- **`addDaysISO(base, days)`** — uses `localISO()` for the result. Safe for revision scheduling, streak maths, etc.
- **`buildDateRange(n)`** — returns array of last N local-date keys, ascending, ending with today. Used for all chart loops (no `for` loop with `toISOString`).
- **Migration** — runs once at startup (`_migrateStatsToLocalDates`): re-keys any old UTC-midnight keys to their local-date equivalent, then persists.
- **Chart instant update** — focus session end (`onVfmComplete`) AND Pomodoro session end both call `renderStats()` if the Stats tab is visible. No page refresh needed.

## Gotchas
- Cache-busting query param on `script.js?v=134` and `style.css?v=97` — increment when making changes; SW cache is `syllabus-tracker-v131`
- Audio files need HTTP Range request support (already handled in `server.js` and `sw.js`)
- Global orientation is **portrait-locked** (manifest + JS `lock('portrait')` on startup). Full Focus Mode and Video Player expose a ⤢ landscape toggle button that calls `toggleOrientLock()`; exiting either mode calls `lockPortrait()` to restore portrait. `--real-vh` CSS var is set by JS on every `orientationchange`/`resize` for iOS Safari.
- Full Focus overlay uses a **flat CSS Grid** layout. Direct children of `.fs-content`: `fs-top` (badge+dots), `fs-task-box`, `fs-timer-wrap`, `fs-ctrl-col`, `fs-motivation-box`, `fs-footer` (hint only). Portrait grid: `"top task" / "ring ctrl" / "moti moti" / "foot foot"`. Landscape grid (both mobile ≤500px and desktop): 3-column `"top ring task" / "moti ring ctrl" / "foot foot foot"` — left=navy motivation panel, center=dominant timer (270px/76px mobile, 300px/80px desktop), right=indigo panel (task top + controls bottom, `border-top: none` to appear seamless). `_fsMotiQuote` set once in `startFullSession()`.

## Pointers
- Testing skill: `.local/skills/testing/SKILL.md`
- Workflows skill: `.local/skills/workflows/SKILL.md`
