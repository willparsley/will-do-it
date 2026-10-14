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
- **Styling**: Tailwind CSS + shadcn/ui (calm, easy-on-the-eyes design with light/dark mode)
- **Drag & Drop**: @dnd-kit (for custom matrix grid)
- **Dates**: date-fns or native
- **Forms**: React Hook Form + Zod (future)

**PWA**: Installable web app. Reminders work via in-app visuals + auto-promotion. Push notifications planned as future enhancement.

## Current Status (as of Oct 2026)
Project freshly initialized with Next.js + Tailwind.

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
- recurrence_source_id
- completed_at (for archive filtering)

### recurrence_sources
- id, user_id, stream_id (current target)
- base_title
- frequency, interval, weekdays, month_day, stack_missed
- end_date, stopped_at
- last_completed_at

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
- `stack_missed`: true = accumulate missed periods; false = only one active.
- Auto-generate titles based on pattern when appropriate.
- Generation + auto-promotion runs on app load/refresh (no manual button). Users can force via pull-to-refresh or F5.
- Auto-promote generated cards to Waiting on their due day.
- "Last completed on X date" shown on active recurring cards after first completion.
- When moving a recurring card via drag: updates recurrence source (seamless, no prompt).
- When changing a Stream's status to Complete/Canceled: warning if recurrences would still generate. Options: move recurrence (pending cards move auto) or stop recurrence. Per-recurrence.

### Reminders / Time-Sensitive
- due_at + optional separate remind_at.
- Visuals: Badges with color coding (Overdue=red, Due today=orange, etc.) + bell icon for cards with reminder set.
- Auto-promote to Waiting if due/reminder is "today" (only from backlogs).
- In Completed view: due info not shown on card; reminders cleared on complete/cancel.
- Works in PWA (visuals + auto-promotion).
- Future: Push notifications (undecided on full strategy: push/email/etc.).

### Views & Filters
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
- Terminology: Streams (not epics/areas/projects)
- Grouping by recurrence source (survives stream changes)
- Auto-promotion conservative for time-sensitive items
- No manual "process recurrences" button
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
