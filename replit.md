# Syllabus Tracker PWA

A clean, offline-capable Progressive Web App for tracking study progress — pure HTML + CSS + Vanilla JS, no frameworks or build tools.

## Stack
- **Frontend**: Single-file HTML + CSS + Vanilla JS (no React, no bundler)
- **Server**: Node.js `http` module (`server.js`), port 5000, host `0.0.0.0`
- **Storage**: `localStorage` (key: `syllabus_tracker_v2`)
- **PWA**: `manifest.json` + `sw.js` (cache-first strategy)

## Files
| File | Purpose |
|------|---------|
| `index.html` | App shell — views, nav, modal/toast anchors |
| `style.css` | All styles (dark theme, responsive, animations) |
| `script.js` | Complete app logic — state, render, events, init (single IIFE) |
| `manifest.json` | PWA manifest with inline SVG icon |
| `sw.js` | Service worker — caches 5 core files, handles notifications |
| `server.js` | Static file server (Node.js http module) |

## Tabs / Views
| Tab | View ID | Description |
|-----|---------|-------------|
| Home | `view-home` | Hero cards (exam countdown + progress ring), Today's Plan, Plan Adder |
| Dashboard | `view-dashboard` | Goals, Smart Suggestions, Weak Areas, Burnout Banner |
| Syllabus | `view-syllabus` | Subject/Chapter/Topic CRUD with expandable tree |
| Focus | `view-focus` | Pomodoro timer (Work 25m / Short 5m / Long 15m) |
| Revision | `view-revision` | Spaced repetition schedule (due today + upcoming) |
| Stats | `view-stats` | Activity bars, overall stats, per-subject breakdown |

## Key Architecture
- **Navigation**: `switchTab(tab)` — hides all `.view`, shows `#view-{tab}`, updates `.nav-btn.active`, sets `body.tab-{tab}`
- **Settings gear**: only visible on Dashboard tab via `body:not(.tab-dashboard) .settings-btn { display: none }`
- **Event delegation**: single `document.addEventListener('click', ...)` routes via `data-act` attributes
- **State**: `state` object with subjects, exams, goals, revisions, dailyPlans, streak, activity, smartReminder, motivationReminders, motivationQuotes, burnout
- **Spaced repetition**: offsets [1, 3, 7] days after topic marked done
- **Burnout detector**: checks inactivity, broken streaks, low weekly activity
- **Weak topic detector**: topics skipped ≥3 times OR ≥7 days old and not done
- **PWA cache**: only caches `./, ./index.html, ./style.css, ./script.js, ./manifest.json`
- **No calendar tab** — removed entirely; `migrate()` deletes `calendarTasks` from saved state

## Running
The `Start application` workflow runs `node server.js` on port 5000.
