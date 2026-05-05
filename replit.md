# Syllabus Tracker PWA

A clean, offline-capable Progressive Web App for tracking study progress.
**Stack: pure HTML + CSS + Vanilla JS only — NO TypeScript, React, frameworks, or build tools.**

## Tech Stack
- **Frontend**: `index.html` + `style.css?v=11` + `script.js?v=11` — all plain, runs directly in browser
- **Server**: `server.js` — Node.js `http` module, port 5000, host `0.0.0.0`
- **Storage**: `localStorage` (key: `syllabus_tracker_v2`); `cls_last_url` for Quick Launch memory
- **PWA**: `manifest.json` + `sw.js` (cache-first, cache name: `syllabus-tracker-v15`)
- **Charts**: Chart.js 4.4.7 loaded from CDN (jsdelivr) — degrades gracefully offline

## File Structure
```
index.html        # App shell — 6 views, bottom nav, modal/toast anchors, lock-overlay
style.css         # All styles (dark theme, responsive, split-screen player, quick-launch bar)
script.js         # Complete app logic — single IIFE, ~2510 lines
manifest.json     # PWA manifest with SVG icons
sw.js             # Service worker — cache-first, cache name v14
server.js         # Static file server (unchanged)
sounds/           # Ambient audio files (.mp3, .m4a)
```

## Tabs / Views
| Tab | View ID | Description |
|-----|---------|-------------|
| Home | `view-home` | Hero cards (exam countdown + progress ring), Today's Plan, Plan Adder |
| Dashboard (Board) | `view-dashboard` | Goals, Smart Suggestions, Weak Areas, Burnout Banner |
| Syllabus | `view-syllabus` | Subject/Chapter/Topic CRUD with expandable tree |
| Focus | `view-focus` | Sub-tabs: Timer (Pomodoro) + Classroom |
| Revision (Revise) | `view-revision` | Spaced repetition — due today + upcoming |
| Stats | `view-stats` | **Premium dashboard** — glass cards, Chart.js charts, heatmap, doughnut |

## Classroom: Universal Web-Player
- **Quick Launch bar** (`cls-quicklaunch`): Glassmorphic URL input at top of Classroom — paste any URL (YouTube, Udemy, Coursera, etc.) → press Enter or ▶ Open
- **Remember Last Link**: `_classroomLastUrl` backed by `localStorage.getItem('cls_last_url')` — pre-fills input on revisit
- **`buildEmbedUrl(item)`**: returns YT embed URL for YouTube items, raw `item.url` for `type:'external'`
- **`openQuickPlayer(url)`**: detects YouTube vs external, builds synthetic item, calls `openVideoPlayer`
- **`openVideoPlayer(groupId, itemId, _directItem?)`**: 3rd optional param allows direct item (no state lookup) for quick-launch
- **Split-Screen Player**: `#vp-overlay` → `.vp-header` + `.vp-split` → `.vp-main` (scrollable, left) + `.vp-notes-col` (right, 340–380px on ≥700px screens); `.vp-notes-mobile` shown on mobile, hidden on desktop
- **External type**: `type:'external'` stored for non-YouTube links; shown with 🌐 icon + domain name; iframe `sandbox` attribute added for safety; embedding-blocked hint shown (`vp-ext-hint`)
- **Add/Edit modals**: Accept any URL, auto-detect YouTube vs external; external links auto-fill domain as title

## Classroom: Bookmark Moment Feature
- **`🔖 Bookmark` button** in `.vp-notes-section` (inside `.vp-notes-col` on desktop, `.vp-notes-mobile` on mobile)
- **YT IFrame API**: `loadYTApi()` → `tryBindYTPlayer()` → `YT.Player` on `#vp-iframe`; auto-capture time from `getCurrentYTTime()`
- **Dual-column sync**: `document.querySelectorAll('#vp-notes-list')` — both desktop col and mobile section updated on save/delete
- **Storage**: `item.notes: [{ id, ts, label }]`

## Full Screen Focus Mode
- **`.fs-bg-earth`** rotating Earth, `_genFsParticles()` stars, `.fs-is-running` jitter, `fs-time-glow` pulse
- Mini floating timer bubble (`#focus-mini-timer`) shown when Multitask Mode is active

## Key Architecture
- **Navigation**: `switchTab(tab)` — hides all `.view`, shows `#view-{tab}`, sets `body.tab-{tab}`
- **Lock Mode guard**: `switchTab` checks `focusLocked && focusRunning`
- **Event delegation**: single `document.addEventListener('click', …)` routes via `data-act`
- **Enter key** on `#cls-url-input` triggers quick-launch via `keydown` listener
- **Spaced repetition**: offsets [1, 3, 7] days; **Burnout detector**: inactivity ≥2 days
- **PWA cache**: cache-first local; CDN fetch from network

## State Shape (key fields)
```js
{
  classroom: { groups: [{ id, name, items: [{ id, title, url, videoId, playlistId,
    type ('video'|'playlist'|'external'), addedAt, description, thumbnailUrl,
    notes: [{ id, ts, label }] }] }] },
  focusStats: { sessions: { 'YYYY-MM-DD': count }, minutesByDate: { 'YYYY-MM-DD': minutes } }
}
```
`cls_last_url` stored separately in localStorage (not in state).

## Landscape Mode (No-Scroll Design)
`@media (orientation: landscape) and (max-height: 500px)` — targets Samsung Galaxy F23 5G and all phones in landscape (~852×360px usable):
- **Nav Rail**: `.bottom-nav` becomes a left-side 52px vertical icon-only rail; active indicator moves to left edge
- **#app**: `padding-left: 52px`, no bottom padding; each `.view` gets `height: 100dvh; overflow-y: auto`
- **Focus Timer** (`.focus-view`): CSS grid 2-col — left (mode tabs + ring + buttons), right (task + sessions + ambient)
- **Fullscreen Focus** (`#fs-overlay .fs-content`): CSS grid 2-col — left (badge + ring), right (task + controls + hint)
- **Stats**: 6-col glass card row; `.stats-chart-pair` (Weekly Focus + Subject Distribution) renders side-by-side via grid; stat tiles go 4-across
- **Stats JS**: `renderStats()` wraps Weekly Focus + Subject Distribution in `<div class="stats-chart-pair"><div class="stats-chart-half">…</div></div>`; Heatmap stays full-width below
- **Video Player**: `.vp-split` forced `flex-direction: row`, 70/30 ratio; `.vp-notes-mobile` hidden

## Running
Workflow: `Start application` → `node server.js` → port 5000
