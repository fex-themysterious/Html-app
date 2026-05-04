# Syllabus Tracker

A client-side syllabus and study tracker built with vanilla HTML, CSS, and JavaScript. Data is stored in the browser via localStorage.

## Project Structure

- `index.html` — Main entry point, defines the app shell, bottom navigation, and view containers.
- `style.css` — All styling for the app.
- `script.js` — Application logic (state management, views, modals, persistence).
- `server.js` — Minimal Node.js static file server for development on Replit.

## Development

The app runs as a static site served by a tiny Node.js HTTP server.

- Workflow: **Start application** runs `node server.js` and serves the site on port `5000` (host `0.0.0.0`).
- The server sets `Cache-Control: no-store` headers so changes show up immediately in the Replit preview iframe.

## Deployment

Configured as a **static** deployment with the project root as the public directory.

## Features

### Dashboard Tab
A dedicated bottom-nav tab (`renderDashboard()` rendering into `#view-dashboard`) that consolidates planning surfaces:
- **Goals** (`renderGoals()`)
- **Smart Suggestions** (`renderSmartSuggestions()`)
- **Weak Areas** (`renderWeakAreas()`)

Home stays slim and shows two redesigned hero cards (Next Exam + Overall Progress) in a Flexbox/Grid `.hero-grid` layout, an "Open Dashboard" CTA, and a compact, read-only mirror of **Today's Plan** (`renderHomeTodayPlan()` — first 5 tasks plus an "Open Calendar →" link). Today's Plan editing now lives on the **Calendar** tab (above the month grid) via `renderDailyPlan()` and the new `renderPlanAdder()`. Re-renders are driven by `renderAll()`, which calls all six views together.

#### Home visual polish
- **Hero cards** use stacked radial + linear gradients with a CSS `::before` masked rim that simulates a soft glowing border. Hover lifts the card and intensifies the glow.
- **Bolded numbers**: 76px / 900-weight days-remaining + 44px / 900-weight ring percent.
- **Animated circular progress ring** (`progressRingSVG(percent)`): SVG `<circle>` whose `stroke-dasharray = 2πr` and `stroke-dashoffset = c*(1-pct/100)`. Animated via CSS transition + a one-shot `@keyframes ringDraw` on render. Gradient stroke uses `<linearGradient id="ringGrad">` (cyan → violet → pink) with a `drop-shadow` filter for a neon feel.
- **Motivational dynamic text** under the greeting — `progressMessage(pct, hasTasks, allDone)` returns one of: *"Time to kickstart!"*, *"Building momentum, keep going."*, *"Great pace — stay focused."*, *"Almost there, legend!"*, *"Syllabus complete — incredible work!"*, or *"Daily goal achieved — well done!"*. Coloured cyan when low (`<20%`) and rendered with a gradient text-clip when hot (`>=80%`).
- **Urgency state** on the Next Exam card: when `daysUntil(exam) <= 7` and `>= 0`, the card gets `.urgent` (orange/red gradient + `@keyframes heroPulse` shadow pulse) and a pill **"TODAY" / "TOMORROW" / "SOON"** badge that gently pulses (`@keyframes badgeBlink`).
- **Daily Goal Achieved badge**: when `totalCount > 0 && doneCount === totalCount`, `.daily-achieved` renders above Today's Plan with a 🏆 glyph, title, sub-line, and (only on the toggle that *causes* the transition) a one-shot **CSS confetti burst** — 18 absolutely-positioned `<i>` pieces with randomized colour/left/duration/rotation, animating once via `@keyframes confettiFall`. Tracked by module-scope `_justCompletedDay` flag, cleared by `setTimeout` after 1.8 s.
- **Pop animation on plan-task check**: module-scope `_justPoppedKey` is set in the `toggle-plan-task` handler before `renderAll()`. Both `renderHomeTodayPlan` and `renderPlanTask` add a `.just-popped` class to the matching row, which triggers `@keyframes rowPop` (scale + green-glow shadow) and `@keyframes checkPop` on the checkbox. Cleared via `requestAnimationFrame` so the animation only plays once per click.
- **Glassmorphism**: `.dashboard-cta.glass` (Open Dashboard) and `.btn-link.glass-pill` (Open Calendar →) use semi-transparent gradient backgrounds + `backdrop-filter: blur(14px) saturate(140%)` + soft white inset highlight + lift-on-hover. The dashboard icon tile became a cyan-to-violet gradient with a coloured shadow. Note: a global `svg { width:24px !important; height:24px !important }` rule forced `.ring-svg` to override sizing with `!important` — kept in mind for any future SVGs that need to fill their container.

### Today's Plan Adder (cascading picker)
`renderPlanAdder()` shows three `<select>`s — Subject → Chapter → Topic — wired by a `change` delegate keyed on `[data-plan-pick]`. Picking a subject populates chapters; picking a chapter populates topics. The action button (`add-plan-from-syllabus`) appends a custom plan task referencing the selection (`{ id, text, done, link:{subId, chId, tId?} }`). A "+ custom task" input still exists below a divider for free-text tasks. After adding, the page re-renders and `scrollToElement('.plan-list .plan-task:last-child')` scrolls the new item into view.

### Settings Modal (Dashboard-only gear)
The gear (`#settings-btn`, `data-act="open-settings"`) is hidden everywhere except the Dashboard tab via the body class set by `switchTab()` (`body.tab-<name>`). CSS rule `body:not(.tab-dashboard) .settings-btn { display: none; }`. The modal `modalSettings()` has four sections:
1. **Daily Study Reminder** — toggle + multi-time slot row. Each time is a chip (`.time-chip`) with edit/×; "+ Add time" opens the simplified picker.
2. **Motivation Notifications** — toggle + multi-time chip row, same pattern. Sends a random quote at each scheduled time.
3. **Notifications Status** — colour-coded permission read-out + "Allow notifications" button.
4. **Motivation Quotes** — list/add/delete `state.motivationQuotes`.

State shapes:
- `state.smartReminder = { enabled, times: ['HH:MM', …], lastFired: { 'HH:MM': 'YYYY-MM-DD' } }`
- `state.motivationReminders = { enabled, times: ['HH:MM', …], lastFired: { 'HH:MM': 'YYYY-MM-DD' } }`

`checkSmartReminder()` and `checkMotivationReminders()` iterate every entry in `times[]`, fire once per slot per day, and dedupe via `lastFired[time]`. Both are kicked from `startSmartReminderLoop()` (60-second tick).

### Reminder Time Picker (no clock face)
`modalSetReminderTime(which, index)` opens a minimal picker (`.tp-wrap-min`): big HH:MM display, +/− steppers for hour/minute, AM/PM chips, six preset chips. `which` is `'reminder'` or `'motivation'`; `index` is the slot to edit (`-1` = add new). Save updates `state[which].times[]` (sorted, deduped) then re-opens the settings modal. The old SVG clock face has been removed.

### Add Chapter for Revision
A primary "Add Chapter for Revision" button on the **Revision** tab opens `modalAddChapterForRevision()` — Subject → Chapter cascading selects, then a topic checklist (Select all / None). Save calls `scheduleRevisionsForTopic(subId, chId, tId)` per picked topic to push 1d/3d/7d steps into `state.revisions`.

### Auto-scroll to new items
`scrollToElement(selector)` (smooth `scrollIntoView({block:'center'})`). Used after `modalAddSubject` (`[data-sub-card]`), `modalAddChapter` (`[data-ch-card]`), `modalAddTopic` (`[data-t-card]` — added to the topic row), and `add-plan-from-syllabus`/`add-plan-task` so newly added items are immediately visible.

### Chapter date defaults
`modalAddChapter`'s "Schedule for date" field is now optional and defaults to empty (no auto today-date). Seeded chapters in `seedSubject` likewise have `scheduledDate: null`.

### Removed: XP / Level / Badge System
All gamification has been removed: `XP_PER_TASK`, `XP_PER_LEVEL`, `BADGE_DEFS`, `getLevel`, `getXpInLevel`, `getXpPercent`, `awardXp`, `checkBadges`, the Profile card render, and `state.gamification`. The state migration in `loadState()` drops `s.gamification` from older saves. The streak counter survives and is shown inside the new Overall Progress hero card.

### Smart Study Suggestions
A prioritized "what to study now" engine in `script.js` that synthesizes the user's existing study data (revisions, weak topics, incomplete topics) into a single actionable card on the homepage.

- **Engine** (`getSmartSuggestions(limit)`): collects up to N items in strict priority order:
  1. **Revision due** — items returned by `dueRevisionItems()` (overdue first).
  2. **Weak topics** — items from `getWeakTopics()` (skipped 3+ times or stale).
  3. **Incomplete topics** — `collectIncompleteTopics()` walks the syllabus, preferring chapters scheduled today, then high-priority chapters, then the rest.
  - Each suggestion carries `{ type, sub, ch, topic, label, meta, action }`. Duplicates are de-duped across categories so a topic only appears in its highest-priority bucket.
- **UI**:
  - `renderSmartSuggestions()` — card placed above "Today's Plan" with subject-colored left bars, an icon, type tag (Revision Due / Weak / Continue), human-readable label (e.g. *"Revise Organic Chemistry"*, *"Study Integration today"*), context line, and per-row Open + Mark-Done buttons.
  - **Highlighting** — `getSuggestedKeys()` returns a Set of `subId:chId:tId` strings; `renderPlanTask()` adds a `plan-task-suggested` class and a ⭐ Suggested pill to matching items in Today's Plan so the recommendations stay visible even when the user scrolls past the card.
- **Dynamic updates**: re-runs on every `renderHome()` / `renderAll()`, which fires after any state change (topic toggled, revision completed, plan regenerated, etc.), so the list always reflects the latest data.

### Goal Tracking System
A self-imposed deadline system in `script.js` (e.g. *"Finish Math in 20 days"*) that automatically tracks chapter-completion progress against the user's chosen target date.

- **Data shape** (`state.goals[]`): `{ id, name, subjectId|null, durationDays, startDate, targetDate, createdAt, completedAt }`. Persisted in localStorage; migrated and normalized on load.
- **Engine**:
  - `subjectChapterProgress(subId)` — chapters done / total for a subject.
  - `goalProgress(goal)` — returns `{ done, total, percent, totalDays, elapsed, daysLeft, overdueBy, isComplete, isOverdue, expectedPercent }` in one call. `subjectId === null` means "all subjects" (overall syllabus).
  - `signedDaysUntil(date)` — used to compute "Overdue by N" past target date.
  - `checkGoalCompletions()` — stamps `completedAt` the first time a goal hits 100%; clears it if the user un-completes a chapter. Called from `bumpActivity()` and on every render so completion is detected immediately after the action that triggers it.
- **Auto-update daily**: progress is recomputed on every `renderGoals()`, which is invoked by `renderHome()` / `renderAll()` — fired after any state change *and* on app open. Days-left always reflects the current `todayKey()`, so opening the app the next morning shows fresh numbers without any timer.
- **UI** (homepage, above Smart Suggestions):
  - Goal cards with a subject-color left bar, large % readout, fraction (e.g. *2 / 3 chapters*), gradient progress bar, day counter (*Day 8 of 20*), and start → target dates.
  - Status pill colored by state: **active** (cyan), **due today** (amber), **overdue** (red), **completed** (green). The progress bar gradient also shifts to green/red for completed/overdue.
  - **Pace indicator** compares `percent` vs `expectedPercent` (linear pace): *▲ ahead*, *● on pace*, *▼ behind*.
  - Cards sort: active (by daysLeft asc) → overdue → completed.
  - Empty state with bullseye icon and a primary "+ Add your first goal" CTA.
- **Modal** (`modalAddGoal`): name (optional), subject `<select>` (with "All subjects" option), duration number input + quick-pick chips (7/14/20/30/60/90), start date picker. Edit/Delete supported via the same modal (header pencil button on each card).
- **Handlers**: `add-goal` (section header + empty-state CTA + FAB on home), `edit-goal` (per-card pencil button).

### Study Calendar View
A monthly calendar at the **Calendar** tab (5th item in the bottom nav) that visualises study consistency from `state.activity` and shows what was studied per day from `state.dailyPlans`.

- **Data sources** (read-only, no new tracking):
  - `state.activity[YYYY-MM-DD]` — count of topic-completions for that day (already maintained by `bumpActivity()`).
  - `state.dailyPlans[YYYY-MM-DD]` — `{ auto: [{subId, chId, tId}], custom: [{id, text, done}], removed: [...] }` for that day.
  - `state.burnout.installDate` — anchors the "missed" classification so days before the user installed are not flagged red.
- **Day classification** (`classifyCalDay(iso)`):
  - `today` — outlined in cyan.
  - `future` — muted, non-interactive.
  - `empty` — before install date, no styling.
  - `completed` (green) — `state.activity[iso] > 0`.
  - `missed` (red) — past day, on/after install, `state.activity[iso]` is 0/missing.
- **UI**:
  - `renderCalendar()` builds a `Sun…Sat` 7-column grid for the viewed month, padding leading/trailing blanks for full weeks. Mobile-responsive via `aspect-ratio: 1/1` and a `@media (max-width:380px)` tweak.
  - Toolbar with **‹** / **›** month navigation, month label, and a **Today** quick-jump.
  - Legend (Completed / Missed / Today) and a 3-tile summary (`Completed`, `Missed`, `Consistency %`) computed only over eligible days (install → today inclusive, excluding the future).
  - FAB on this view also jumps the calendar back to the current month.
- **Day-detail modal** (`modalCalendarDay(iso)`): header with the formatted date and a status pill, then:
  - "Topics marked done" count for that day (from `state.activity`).
  - "Tasks completed" — `dailyPlans[iso].auto` topics whose underlying topic is now `done`, plus `custom` tasks with `done:true`.
  - "Planned but not done" — same lists for items still pending.
  - Subject-colored left bar on each row + Done/Pending pill. Friendly empty-state strings for past-with-no-plan, future, and pre-install dates.
- **State**: `calView = { year, month }` (in-memory only) tracks the viewed month. Re-renders on every `renderAll()` so highlights stay accurate after any topic toggle.
- **Handlers**: `cal-prev`, `cal-next`, `cal-today`, `cal-day` (with `data-date="YYYY-MM-DD"`).
- **Per-date tasks** (new): `state.calendarTasks[iso] = [{id, text, done, createdAt}]`. The day modal shows an editable "Tasks for this day" list (toggle/delete) plus an input + add button. Works for past, today, and future dates. Helpers: `ensureCalendarTaskList`, `addCalendarTask`, `toggleCalendarTask`, `deleteCalendarTask`. Handlers: `cal-add-task`, `cal-toggle-task`, `cal-del-task`. Calendar FAB now opens today's day modal directly.

### Revision Management (chapter & topic, in-menu)
Revision controls live inside the 3-dots dropdown of every **chapter** and **topic** card — the menu is hidden until the dots are tapped. State (`revisionCount`, `lastRevisedAt` ISO) lives on the chapter/topic object itself. The dropdown supports a custom item type `counter` (built by `makeRevisionCounterItem`) which renders an inline `−1` / live count / `+1` row plus a "Last revised: …" sub-line; the `+1`/`−1` buttons `stopPropagation` and call `paint()` to re-render the count without closing the menu. A separate **Mark as Revised** entry (`makeMarkRevisedItem`) increments the count, stamps `lastRevisedAt`, calls `bumpActivity()`, saves and re-renders. Outside the menu, every chapter card and topic row that has been revised at least once shows a `Revised: N time(s)` pill via `formatRevisedAt()`-friendly labelling. The previous always-visible inline counter row on topics has been removed.

### Chapter-level Default Checklist (Basic / MCQ / CQ / SQ)
When a chapter is expanded (inside an expanded subject), a checklist card appears above its topic list. Defaults are seeded by `makeDefaultChecklist()` (Basic, MCQ, CQ, SQ) on chapter creation (in `seedSubject` and `modalAddChapter`) and back-filled for older chapters via migration (`ensureChapterChecklist()`). Users can toggle items, delete any item (including defaults), and add custom items with the inline add row. State: `chapter.checklist = [{id, label, checked}]` — persisted independently per chapter. Handlers: `toggle-checklist`, `del-checklist`, `add-checklist` (all chapter-scoped via `findChapter(subId, chId)` and input id `checklist-input-${chId}`). Enter key in the input also commits.

### Web Notifications + Service Worker
- `sw.js` registered from `index.html` after `window load`. Handles `install` / `activate` (skipWaiting + claim), a `message` event (`{type:'show-notification', title, options, url}`) so the page can ask the SW to display a notification, and `notificationclick` to focus / open the app at the supplied URL.
- `showWebNotification(title, body, opts)` — generic helper that prefers `serviceWorker.controller.postMessage`, falls back to `registration.showNotification`, then to `new Notification`.
- `notifyTaskDue(task)` — checks `Notification.permission`; if `default`, requests permission, then displays a "task due" notification (toast fallback when denied/unsupported).
- `checkDueTasks()` polls `dueRevisionItems()` every 60s (and once 1.5s after init) via `startDueTaskLoop()`, firing one notification per due step per day (deduped via in-memory `Set`, reset at date change).
- Existing `fireReminder()` was refactored to use `showWebNotification()` for the daily smart reminder.

### Mobile Keyboard Handling
`setupKeyboardHandling()` (called from `init()`):
- Listens to `visualViewport` `resize` / `scroll` events, computes the keyboard height as `window.innerHeight - vv.height - vv.offsetTop`, and exposes it as the CSS variable `--kb-h` on `:root`. Also toggles `body.kb-open`.
- CSS uses `--kb-h` to lift the FAB and add bottom padding/`max-height` to the modal so the open keyboard never overlaps inputs.
- A `focusin` delegate scrolls the focused field into view (`scrollIntoView({behavior:'smooth', block:'center'})`) after a 250ms delay so the page settles after the keyboard animation. `focusout` resets shortly after blur.

### Removed: Reminders Section
The standalone Reminders section (and the `+` Add Reminder icon) on Home was removed. State `state.reminders` is dropped via load-time migration (`delete s.reminders`). Notifications for studying are now driven by the smart-reminder + due-task systems above.
