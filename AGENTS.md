# Will Do It - AGENTS.md

## Project Overview
Will Do It is a calm, visual personal productivity app for managing to-dos as cards under "Streams" (organizational containers, similar to epics but lighter).

**Core Metaphor:**
- Streams = rows
- Statuses = columns
- Cards = draggable items that move between streams and statuses

**Key Principles:**
- Statuses replace most traditional scheduling.
- Recurring tasks are smart and non-annoying (configurable stacking).
- Work and Personal areas on Streams with easy filtering.
- Easy to use on desktop and mobile (PWA).
- History is preserved (no data loss on complete/cancel).

## Tech Stack
- **Framework**: Next.js (App Router, TypeScript)
- **Hosting**: Vercel
- **Backend/DB/Auth**: Supabase (Postgres + RLS + Auth)
- **Styling**: Tailwind CSS + custom React components (calm, easy-on-the-eyes design with light/dark mode)
- **Drag & Drop**: @dnd-kit (for custom matrix grid)
- **Dates**: date-fns or native
- **Forms**: React Hook Form + Zod (future)

**PWA**: Installable web app. Reminders work via in-app visuals + auto-promotion. Push notifications planned as future enhancement.

## Current Status (as of Oct 2026)
Supabase-backed Streams/Cards CRUD, matrix drag-and-drop, transactional recurrence generation/lifecycle, reminders, and grouped archive views are implemented. PWA installation and push notifications remain future work.

## Core Data Model (High Level)

### streams
- id, user_id, title
- state: in_progress | complete | canceled
- area: work | personal | neutral
- notes (plain text + markdown)
- position (for row ordering)

Special: "Uncategorized" stream is always `in_progress`, fixed at bottom, slightly different background, no user-editable notes (possible system default note).

### cards
- id, user_id, stream_id
- title, notes
- status: backlog | priority_backlog | research | waiting | in_progress | review | complete | canceled
- due_at, remind_at
- position (within cell)
- is_recurring
- recurrence_source_id, recurrence_date (immutable scheduled occurrence identity)
- recurrence_revision (immutable schedule revision for that occurrence), scheduled_date (current scheduled slot)
- auto_promoted_from (Backlog/Priority Backlog origin while automatically Waiting; null for manual/unknown origin)
- completed_at (for archive filtering)

### recurrence_sources
- id, user_id, stream_id (current target)
- base_title
- frequency, interval, weekdays, month_day, stack_missed
- end_date, stopped_at
- last_completed_at
- recurrence_timezone, generated_through (calendar generation cursor)
- schedule_revision (incremented when the recurrence pattern changes)

**Important Behaviors:**
- Dragging a recurring card updates the recurrence source's stream (future instances follow).
- Pending cards move automatically when source moves.
- Grouping in Completed view is by `recurrence_source_id` (not current stream).
- Completed recurring cards display under the *current* stream of the source.

## Statuses

**Card Statuses:**
- Backlog
- Priority Backlog
- Research
- Waiting
- In Progress
- Review
- Complete
- Canceled

**Main Activated View:** Research | Waiting | In Progress | Review

**Backlog View:** Backlog | Priority Backlog | Research (3 columns for easy promotion)

**Archive:** Complete + Canceled with time filters (Past month default, Past 1 year, All time). Filters on `completed_at`.

**Stream States:** in_progress (active) | complete | canceled

## Key Features & Rules

### Streams
- Rows in the matrix.
- Ordered alphabetically (case-insensitive), with Uncategorized pinned at the very bottom.
- Manual drag to reorder is not implemented yet. Future direction: a layered sort — Uncategorized always pinned, rule-based alphabetical default, with optional user drag overrides on top.
- Uncategorized always at bottom, special treatment.
- Hidden if no cards in current view/filter.
- Work/Personal filter applies to streams.

### Cards & Movement
- Every card must be in a stream.
- Drag cards between streams (rows) and statuses (columns) with grid highlighting.
- Quick-add allows choosing stream + status.
- On hover, a card shows two quick actions (stacked, top-right): a green check to complete it, and an arrow to advance it one step along `STATUS_FLOW` (backlog → priority_backlog → research → waiting → in_progress → review → complete). Advancing into Complete runs the full completion path (stamps `completed_at`, handles recurrence).

### Recurring Tasks
- Configurable per source: frequency patterns (daily, every N days, specific weekdays, monthly 1st/last, etc.).
- Edit a recurrence via the recurrence icon on any occurrence (including archived cards), or the Edit recurrence button in the card editor. The editor supports title, stream, pattern, stacking, end date, and stopping/resuming generation.
- Source title and pattern changes update pending occurrences. Completed/canceled storage stays unchanged. Rescheduled automatic Waiting cards return to their prior backlog status only if neither their new due nor reminder day has arrived; manual/unknown Waiting and other active statuses are retained.
- `stack_missed`: true = accumulate missed periods; false = only one active.
- Auto-generate titles based on pattern when appropriate.
- Generation + auto-promotion runs on app load/refresh and after card creation, edits, and drag/status changes (no manual button). Users can force via pull-to-refresh or F5.
- Auto-promote generated cards to Waiting on their due day.
- "Last completed on X date" shown on active recurring cards after first completion.
- When moving a recurring card via drag: updates recurrence source (seamless, no prompt).
- When changing a Stream's status to Complete/Canceled: warning if recurrences would still generate. Options: move recurrence (pending cards move auto) or stop recurrence. Per-recurrence.

### Reminders / Time-Sensitive
- due_at + optional separate remind_at.
- Visuals: Badges with color coding (Overdue=red, Due today=orange, etc.) + bell icon for cards with reminder set.
- Auto-promote to Waiting if either due/reminder day is today or earlier (only from Backlog and Priority Backlog), for both recurring and ordinary cards. Promotion is calendar-day based, not an exact-time scheduler.
- In Completed view: due info not shown on card; reminders cleared on complete/cancel.
- Works in PWA (visuals + auto-promotion).
- Future: Push notifications (undecided on full strategy: push/email/etc.).

### Views & Filters
- Active is the default view. The selected view, area filter, and archive period are remembered per user in browser storage and restored on refresh; invalid or unavailable storage falls back to the defaults.
- Global: All / Work Area / Personal Area.
- Streams with cards only shown.
- No global "due soon" filter (badges + auto-promotion surface them).

### Other
- Notes on cards and streams (simple markdown).
- Full history preserved.
- Calm, easy-on-the-eyes UI with light/dark mode.

## Git Workflow
- Feature branches (`feat/`, `fix/`, `chore/`, etc.)
- Conventional Commits
- PRs for changes (even solo) for previews + clean history
- Squash merge to main preferred for clean main history
- **Commit early and often.** Commit each self-contained change as soon as it
  works (and type-checks) instead of batching. Don't let many features stack up
  in one working tree for a single giant commit — if a batch does accumulate,
  split it into logical commits before pushing. Agents: make a commit as part of
  finishing a piece of work, and ask before leaving large uncommitted changes.

## Build Order (Current Plan)
1. Project setup + auth + basic Supabase
2. Streams + Cards CRUD + basic views
3. Matrix grid + drag & drop
4. Status/stream movement + auto-promotion
5. Recurring logic
6. Reminders + visuals
7. Archive + grouping + polish
8. PWA + edge cases

## Future / Deferred
- Push notifications
- Richer notes
- Advanced search/filters
- Offline capabilities beyond PWA shell
- Email/SMS for reminders

## Decisions Log
- Tailwind uses the standard PostCSS integration for both Turbopack and Webpack. Dropdown browser regressions must exercise the actual Next production output (`npm run build` then `npm run test:dropdowns`), including light/dark surfaces and small mobile modal bounds.
- Dropdowns use the shared React Aria `AppSelect` with custom-rendered menus on desktop and mobile. Triggers and portaled options explicitly use Geist Sans and the app theme tokens. Dropdown layout/surface styles live in a CSS module imported by the component so its styling is an explicit bundle dependency; default triggers match 42px form controls and touch menu items are at least 44px. Pass disabled/saving state explicitly; open menus consume Escape before enclosing dialogs.
- Terminology: Streams (not epics/areas/projects)
- Grouping by recurrence source (survives stream changes)
- Auto-promotion conservative for time-sensitive items
- Recurrence generation runs through the Supabase `generate_recurring_instances` RPC with per-source row locks, immutable `(recurrence_source_id, recurrence_revision, recurrence_date)` occurrence keys, and a persisted `generated_through` cursor. Apply SQL migrations before deploying dependent UI changes.
- Recurrence edits use the transactional `save_recurrence` RPC with settings-version checks. Pattern edits increment the source revision, reschedule pending cards in order, and move the generation cursor to the revised horizon. Monthly changes retain the pending occurrence's month when the interval allows; weekly changes retain its week when possible; every-N-day changes adjust by the interval difference. Other pattern changes start on the next match from the old scheduled day. Multiple pending cards are retained and assigned distinct dates under the new pattern. Reminder day offsets and local times follow the new due dates. Existing occurrence identities remain immutable and `scheduled_date` reserves their new slots against generation. Turning off stacking is blocked until at most one pending card remains. End dates and stopping limit new generation without deleting pending cards.
- Automatic promotion stores the originating backlog status in `auto_promoted_from`, including initial/generated recurring occurrences. Manual status changes clear that provenance. Legacy Waiting origins remain unknown and are never inferred. Opening the source editor fetches current settings; jumping from a dirty card form requires discarding its unsaved edits explicitly.
- Pattern edits without pending cards preserve the existing generation boundary. Completion/history cursors are not rescheduled as pending slots, so the new interval is applied only once on generation, including when resuming a stopped recurrence.
- Archive filters use `completed_at` (calendar month/year lookback); legacy records with no completion date are retained in All time. Recurrence groups follow the current source stream and area without rewriting completed-card storage. Due badges compare calendar days in the source timezone; terminal cards hide due/reminder and last-completed metadata.
- datetime-local controls display local calendar fields and preserve unchanged stored instants, including seconds and DST repeated hours. Weekly recurrence intervals are explicitly visible.
- Initial recurring cards receive a scheduled date when none is supplied: daily/every-N-days starts today; weekly/monthly starts on the next matching day, including today. Explicit initial due dates are retained. Recurring creation is atomic.
- Stream closure queries live recurrence sources and requires a separate move-or-stop choice for every source that could still generate. Card/source moves and stream edits are atomic; pending siblings follow the source and completed storage stays intact. Stale card status actions are rejected.
- Recurrence timezone is pinned at creation (legacy sources on first generation). Stacking catches up distinct missed dates and keeps one future instance (1000-period cap per refresh); non-stacking keeps one pending instance and schedules late completions from their completion day. Existing duplicate history is preserved for manual review.
- Non-stacking recurrence reopening is blocked while another occurrence is pending. Refresh promotion updates current database rows conditionally; both recurring and ordinary overdue due/reminder days catch up. Creation, edits, and drag/status changes run the same refresh/promotion path for all cards. Stream deletion must atomically rehome cards and sources; foreign keys prevent cascading history loss.
- A database trigger stamps/clears `completed_at`, clears terminal-card reminders, and updates recurrence completion bookkeeping for all status-change paths.
- Button-based card advances and completions show an eight-second Undo toast. Successful drag-and-drop moves are silent; failed moves still show an error toast. `save_card_with_undo` records the action and recurrence generation atomically; `undo_card_action` restores card/reminder/provenance and source state, removes only untouched successors created by that action, and rejects undo after intervening card/source changes. Undo refreshes data without immediately re-running promotion. Apply the toast-undo SQL migration before deploying the UI.
- No manual "process recurrences" button
- Full-screen workspace loading is only for initial load. Refreshes after mutations keep the board and open editors mounted while updating data in place.
- Uncategorized is special but participates in normal visibility/movement
- Streams have no "backlog" state — only active (in_progress), complete, canceled. Legacy `backlog` rows auto-migrate to active on load.
- Stream status is edited inside the stream edit modal (with area/rename/delete), not inline on the row. Rows show a subtle badge only when complete/canceled.

---

**This document should be updated as we build.** Add new decisions, ADRs, or clarifications here.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
