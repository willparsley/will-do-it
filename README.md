# Will Do It

A calm, visual productivity app built with Next.js, Supabase, and Vercel.

Cards live under **Streams** in a flexible matrix view (Streams as rows, statuses as columns).

## Features (MVP)
- Streams with Work/Personal areas
- Rich status workflow (including split backlogs)
- Drag & drop between streams and statuses
- Smart recurring tasks (with stacking control)
- Time-sensitive reminders + auto-promotion
- Full history in Archive

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in your Supabase credentials.
2. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database migrations and recurrence

For a fresh database, run `supabase/schema.sql`, then apply the SQL files in
`supabase/migrations/` in filename order. For an existing database, apply only
migrations that have not yet been run.

**Apply all pending migrations before deploying this app version.** After
`202610140001_recurrence_idempotency.sql`, the migrations are:

1. `202610140002_recurrence_safety.sql` — safe promotion, reopening guards, and atomic stream deletion/rehome.
2. `202610140003_recurrence_lifecycle.sql` — atomic card/stream edits, per-source closure choices, source movement, and calendar scheduling.
3. `202610140004_ordinary_card_promotion.sql` — overdue catch-up for ordinary due dates and reminders.
4. `202610140005_edit_recurrence.sql` — recurrence editing, pending-card rescheduling, schedule revisions, and automatic-promotion provenance.
5. `202610140006_recurrence_edit_cursor.sql` — preserve the generation boundary during pattern edits when no pending occurrence exists. If 001–005 are already applied, only run 006.

Migrations preserve existing cards, including duplicate history.
`supabase/audit_recurrence_duplicates.sql` provides read-only queries for reviewing
existing copies. Refresh older open app tabs after deploying the matching UI.

Generation is serialized per source and keyed by an immutable schedule revision and occurrence date.
Non-stacking sources keep one pending instance; stacking sources catch up distinct
missed dates and keep one future instance (at most 1000 dates per refresh).
New sources use their creator's timezone; legacy sources pin it on first
generation so devices in different timezones agree. Direct inserts from older
clients also acquire the source lock and receive an occurrence key. Non-stacking late completions schedule from the completion day;
stacking continues from its generation cursor without skipping missed periods.
Future instances enter Backlog; occurrences due today or earlier enter Waiting.
Undated initial daily/every-N-days occurrences start today; weekly/monthly ones
start on the next matching day, including today. Explicit initial due dates are
preserved. Existing undated pending occurrences are scheduled from source creation.
Both recurring and ordinary backlog cards promote to Waiting when either their
due day or reminder day is today or earlier. Processing runs on load/refresh and
after card creation, edits, and drag/status changes. Future and undated cards stay
put, as do cards outside Backlog and Priority Backlog. Promotion is day-based,
not scheduled to an exact clock time. Reopening an old non-stacking occurrence is
blocked while another is pending.

Closing a stream offers a separate move-or-stop choice for every source that can
still generate. Moving a recurrence also moves all pending siblings. Archived
occurrences retain their stored history but display under the current source
stream, grouped by source ID. In both All and Archive, recurring Complete and
Canceled histories collapse into compact title-and-count rows. Expand a group to
view and edit individual cards, newest completion first. This applies to both
stacking modes; ordinary cards remain individual. Archive defaults to Past month, with Past 1 year and
All time available; legacy records without completion dates remain in All time.

Click a card's recurrence icon, or **Edit recurrence** in its card editor, to edit
the source title, stream, frequency, interval, weekdays/monthly day, stacking,
end date, and whether generation is enabled. Source settings are loaded fresh
and stale saves are rejected. Saving refreshes generation and promotion.
Title and pattern edits update pending cards while preserving completed/canceled
rows and occurrence identities. Monthly date changes reschedule within each
pending month when allowed by the interval; other pattern changes assign pending
cards distinct dates in order. Reminder offsets and local times follow the new
due dates. Automatically promoted Waiting cards return to their original backlog
status when both new dates are in the future; manual or legacy/unknown Waiting
cards retain their status, as do Research, In Progress, and Review cards.
Turning off stacking requires completing/canceling extra pending occurrences.
Stopping or setting an end date retains existing cards and limits new generation.

Run `npm test` for isolated PostgreSQL, component, and handler regression tests. These use PGlite and do
not connect to Supabase or modify application data. PGlite serializes submitted
queries; production multi-connection exclusion relies on PostgreSQL row locks
and the unique occurrence index.

## Project Context
See `AGENTS.md` for full decisions, data model, and contribution guidelines.

## Tech
- Next.js (App Router)
- Supabase (Auth + Postgres + RLS)
- Tailwind + calm design system
- @dnd-kit for the matrix

Core CRUD, authentication, recurrence generation, and archive history persist in Supabase. PWA installation and push notifications remain future work.

### Dropdown browser checks

After installing dependencies, install test browsers with `npx playwright install chromium firefox`.
Run `npm run build` followed by `npm run test:dropdowns` (or build with `npm run build -- --webpack` to verify that pipeline).
The checks serve the actual production HTML, JavaScript, and CSS from `.next`, mock all Supabase requests, and verify dropdown sizes, surfaces, fonts, viewport bounds, touch targets, and selection in desktop/mobile layouts and both themes. Use the same public Supabase environment values for the build and browser tests; `.env.local` is loaded when needed. Screenshots are saved under `test-results/`.

### Card form redesign migration

Apply `supabase/migrations/202610150002_card_creation_notes.sql` before deploying the card form redesign. It adds `create_recurring_card_with_notes` for atomic creation with notes and preserves the original creation RPC for existing clients. Notes belong to the initial occurrence; future occurrences do not inherit them.

### Card prerequisites

Apply `supabase/migrations/202610150003_card_prerequisites.sql` before deploying this version. Add or edit a card and expand **Prerequisite** to search cards by title or stream, then select one prerequisite. Choose **No prerequisite** to remove it.

Unfinished cards have a softened title and a muted red “Blocked by” label (with separate shades for light and dark themes) until their prerequisite is Complete. Canceled prerequisites still block. This indicator is advisory; movement and completion remain available. Links use the full workspace regardless of view filters. A recurring card’s link belongs to that occurrence only. Circular links are rejected. Referenced cards cannot be deleted until their incoming links are removed.
