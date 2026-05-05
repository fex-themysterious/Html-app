# Syllabus Tracker PWA

A clean, offline-capable Progressive Web App for tracking study progress.
**Stack: pure HTML + CSS + Vanilla JS only — NO TypeScript, React, frameworks, or build tools.**

## Tech Stack
- **Frontend**: `index.html` + `style.css?v=6` + `script.js?v=6` — all plain, runs directly in browser
- **Server**: `server.js` — Node.js `http` module, port 5000, host `0.0.0.0`
- **Storage**: `localStorage` (key: `syllabus_tracker_v2`)
- **PWA**: `manifest.json` + `sw.js` (cache-first, cache name: `syllabus-tracker-v11`)
- **Charts**: Chart.js 4.4.7 loaded from CDN (jsdelivr) — degrades gracefully offline
- **Zoom**: enabled (`user-scalable=no` removed)

## File Structure
```
index.html        # App shell — 6 views, bottom nav, modal/toast anchors, lock-overlay
style.css         # All styles (dark theme, responsive, mobile landscape/portrait)
script.js         # Complete app logic — single IIFE, ~2100 lines
manifest.json     # PWA manifest with SVG icons
sw.js             # Service worker — cache-first, cache name v11
server.js         # Static file server (unchanged)
sounds/           # Ambient audio files (.mp3, .m4a)
```

## Tabs / Views
| Tab | View ID | Description |
|-----|---------|-------------|
| Home | `view-home` | Hero cards (exam countdown + progress ring), Today's Plan, Plan Adder |
| Dashboard (Board) | `view-dashboard` | Goals, Smart Suggestions, Weak Areas, Burnout Banner |
| Syllabus | `view-syllabus` | Subject/Chapter/Topic CRUD with expandable tree |
| Focus | `view-focus` | Sub-tabs: Timer (Pomodoro) + Classroom (YouTube) |
| Revision (Revise) | `view-revision` | Spaced repetition — due today + upcoming |
| Stats | `view-stats` | **Premium dashboard** — glass cards, Chart.js charts, heatmap, doughnut |

## Stats / Analytics Features (Premium)
- **3 Glassmorphism metric cards**: Total Focus Time, Pomodoros count, Student Rank
- **Rank system**: Rookie (<5h) → Scholar (5h) → Aviator (15h) → Captain (30h) → Commander (60h) → Ace Student (100h)
- **Weekly Focus Chart**: Chart.js bar chart, last 7 days of focus minutes (today highlighted)
- **Focus Heatmap**: 35-cell CSS grid (5 weeks, Sun–Sat aligned), color-coded by focus minutes
- **Subject Distribution Doughnut**: Chart.js doughnut chart by completed topic count per subject
- **Compact stat tiles**: 3 rows of 4 tiles each (overall %, streak, consistency, active days, topics, weak, revisions, sessions)
- **Study Consistency card**, **Exam Readiness**, **By Subject** cards all retained
- `initStatsCharts(days7, pieSubjects)` — called after `view.innerHTML` set; uses `Chart.getChart()` to destroy stale instances before re-creating

## Full Screen Focus Mode (In-Flight Animations)
- **`.fs-bg-earth`**: slow-rotating Earth background on overlay
- **`_genFsParticles()`**: floating star/cloud particles
- **`.fs-is-running` class**: added to `#fs-overlay` when timer is running — triggers subtle jitter on `.fs-timer-wrap`
- **`fs-time-glow` keyframe**: pulsing text glow on `.fs-time`
- `updateFocusDisplay()` updates `#fs-time-display` and `#fs-ring-circle` for the overlay timer

## Key Architecture
- **Navigation**: `switchTab(tab)` — hides all `.view`, shows `#view-{tab}`, sets `body.tab-{tab}`
- **Lock Mode guard**: `switchTab` checks `focusLocked && focusRunning` before allowing tab change
- **Settings gear**: only visible on Dashboard via `body:not(.tab-dashboard) .settings-btn { display: none }`
- **Event delegation**: single `document.addEventListener('click', …)` routes via `data-act` attributes
- **Spaced repetition**: offsets [1, 3, 7] days after topic marked done
- **Burnout detector**: inactivity ≥2 days or ≤1 active day in last 7
- **Weak topic**: skipped ≥3 times OR ≥7 days stale and not done
- **PWA cache**: cache-first for local assets; CDN resources (Chart.js, fonts) fetch from network

## State Shape
```js
{
  subjects: [{ id, name, color, notes, priority, chapters: [{ id, name, topics: [...] }] }],
  exams: [{ id, name, date }],
  motivationQuotes: [...],
  streak: { count, lastDate },
  activity: { 'YYYY-MM-DD': count },
  dailyPlans: { 'YYYY-MM-DD': { auto, removed, custom, generated } },
  smartReminder: { enabled, times, lastFired },
  motivationReminders: { enabled, times, lastFired },
  revisions: [...],
  burnout: { installDate, popupDismissedDate, bannerDismissedDate },
  goals: [...],
  classroom: { groups: [{ id, name, items: [...] }] },
  focusStats: { sessions: { 'YYYY-MM-DD': count }, minutesByDate: { 'YYYY-MM-DD': minutes } }
}
```

## Running
Workflow: `Start application` → `node server.js` → port 5000
