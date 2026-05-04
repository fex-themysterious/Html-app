# Syllabus Tracker PWA

A clean, offline-capable Progressive Web App for tracking study progress.
**Stack: pure HTML + CSS + Vanilla JS only — NO TypeScript, React, frameworks, or build tools.**

## Tech Stack
- **Frontend**: `index.html` + `style.css` + `script.js` — all plain, runs directly in browser
- **Server**: `server.js` — Node.js `http` module, port 5000, host `0.0.0.0`
- **Storage**: `localStorage` (key: `syllabus_tracker_v2`)
- **PWA**: `manifest.json` (SVG icons) + `sw.js` (cache-first, cache name: `syllabus-v4`)
- **Zoom**: enabled (`user-scalable=no` removed)

## File Structure
```
index.html        # App shell — 6 views, bottom nav, modal/toast anchors, lock-overlay
style.css         # All styles (dark theme, responsive, mobile landscape/portrait)
script.js         # Complete app logic — single IIFE, ~700 lines
manifest.json     # PWA manifest with SVG icons
sw.js             # Service worker — caches 7 files
server.js         # Static file server (unchanged)
icons/
  icon-192.svg    # PWA icon 192×192
  icon-512.svg    # PWA icon 512×512
```

## Tabs / Views
| Tab | View ID | Description |
|-----|---------|-------------|
| Home | `view-home` | Hero cards (exam countdown + progress ring), Today's Plan, Plan Adder |
| Dashboard (Board) | `view-dashboard` | Goals, Smart Suggestions, Weak Areas, Burnout Banner |
| Syllabus | `view-syllabus` | Subject/Chapter/Topic CRUD with expandable tree |
| Focus | `view-focus` | Sub-tabs: Timer (Pomodoro) + Classroom (YouTube) |
| Revision (Revise) | `view-revision` | Spaced repetition — due today + upcoming |
| Stats | `view-stats` | Activity bars, overall stats, per-subject breakdown |

## Focus Tab Features
- **Sub-tabs**: ⏱ Timer | 🎓 Classroom (toggle via `focus-sub-btn`)
- **Pomodoro Timer**: editable Work/Short/Long durations (click inputs), animated ring, Start/Pause/Reset
- **Lock Mode**: prevents switching tabs while timer runs; `beforeunload` warning
- **Ambient Sounds**: Web Audio API — Rain (lowpass white noise), Cafe (brown noise), Nature (bandpass), Focus (binaural 200/210Hz), White noise, Off. Volume slider.
- **Today's Tasks connector**: pick an incomplete task; prompted to mark done after work session
- **Session counter**: tracks sessions × work duration = minutes focused

## Classroom System
- **Groups**: create named groups (stored in `state.classroom.groups`)
- **Add videos/playlists**: paste any YouTube URL — `youtu.be/`, `?v=`, `?list=`
- **Thumbnails**: auto-loaded from `img.youtube.com/vi/{videoId}/mqdefault.jpg`
- **Playback**: iframe embed modal (autoplay); fallback to `window.open`
- **Storage**: `localStorage` under `state.classroom`

## Key Architecture
- **Navigation**: `switchTab(tab)` — hides all `.view`, shows `#view-{tab}`, sets `body.tab-{tab}`
- **Lock Mode guard**: `switchTab` checks `focusLocked && focusRunning` before allowing tab change
- **Settings gear**: only visible on Dashboard via `body:not(.tab-dashboard) .settings-btn { display: none }`
- **Event delegation**: single `document.addEventListener('click', …)` routes via `data-act` attributes
- **Spaced repetition**: offsets [1, 3, 7] days after topic marked done
- **Burnout detector**: inactivity ≥2 days or ≤1 active day in last 7
- **Weak topic**: skipped ≥3 times OR ≥7 days stale and not done
- **PWA cache**: caches `./`, `index.html`, `style.css`, `script.js`, `manifest.json`, both icons

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
  classroom: { groups: [{ id, name, items: [{ id, title, url, videoId, playlistId, type, addedAt }] }] }
}
```

## Running
Workflow: `Start application` → `node server.js` → port 5000
