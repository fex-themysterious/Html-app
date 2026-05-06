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
- All data persisted in `localStorage` under key `syllabus_tracker_v2` — no backend DB
- Single large vanilla JS IIFE in `script.js` manages all state and rendering
- Service worker uses cache-first for static assets, special range-request handling for `/sounds/`
- Server falls back to `index.html` for unknown paths (SPA routing)

## Product
- Syllabus management: subjects → chapters → topics
- Daily plan generation with spaced repetition revision scheduling (offsets: 1, 3, 7 days)
- Pomodoro focus timer with ambient audio
- Streak and activity tracking
- Weak-topic detection
- Stats dashboard with Chart.js charts
- Offline support via PWA service worker

## User preferences
_Populate as you build_

## Gotchas
- Cache-busting query param on `script.js?v=22` and `style.css?v=24` — increment when making changes; SW cache is `syllabus-tracker-v29`
- Audio files need HTTP Range request support (already handled in `server.js` and `sw.js`)
- Global orientation is **portrait-locked** (manifest + JS `lock('portrait')` on startup). Full Focus Mode and Video Player expose a ⤢ landscape toggle button that calls `toggleOrientLock()`; exiting either mode calls `lockPortrait()` to restore portrait. `--real-vh` CSS var is set by JS on every `orientationchange`/`resize` for iOS Safari.
- Full Focus overlay portrait: flex column — `fs-header-row` (badge+dots left, task picker right), `fs-main-area` (timer + vertical `fs-ctrl-col` right), `fs-footer` (hint + motivation quote). Motivation quote set once in `startFullSession()` via `_fsMotiQuote`; landscape collapses to CSS grid with header+footer in left col and main-area spanning right col.

## Pointers
- Testing skill: `.local/skills/testing/SKILL.md`
- Workflows skill: `.local/skills/workflows/SKILL.md`
