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

**Apply all pending migrations before deploying this app version.** If you
already applied `202610140001_recurrence_idempotency.sql`, run these next in order:

1. `202610140002_recurrence_safety.sql` — safe promotion, reopening guards, and atomic stream deletion/rehome.
2. `202610140003_recurrence_lifecycle.sql` — atomic card/stream edits, per-source closure choices, source movement, and calendar scheduling.

Migrations preserve existing cards, including duplicate history.
`supabase/audit_recurrence_duplicates.sql` provides read-only queries for reviewing
existing copies. Refresh older open app tabs after deploying the matching UI.

Generation is serialized per source and keyed by an immutable scheduled date.
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
Missed recurring due days catch up on refresh; ordinary reminders promote only on
their due/reminder day. Reopening an old non-stacking occurrence is blocked while
another is pending.

Closing a stream offers a separate move-or-stop choice for every source that can
still generate. Moving a recurrence also moves all pending siblings. Archived
occurrences retain their stored history but display under the current source
stream, grouped by source ID. Archive defaults to Past month, with Past 1 year and
All time available; legacy records without completion dates remain in All time.

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