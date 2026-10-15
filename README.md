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

**Apply `202610140001_recurrence_idempotency.sql` before deploying this app
version.** It adds the recurrence generation RPC and completion trigger required
by the UI. The migration preserves existing cards, including duplicates.
`supabase/audit_recurrence_duplicates.sql` provides read-only queries for reviewing
those copies before deciding which pending cards to cancel.

Generation is serialized per source and keyed by an immutable scheduled date.
Non-stacking sources keep one pending instance; stacking sources catch up distinct
missed dates and keep one future instance (at most 1000 dates per refresh).
New sources use their creator's timezone; legacy sources pin it on first
generation so devices in different timezones agree. Direct inserts from older
clients also acquire the source lock and receive an occurrence key. Non-stacking late completions schedule from the completion day;
stacking continues from its generation cursor without skipping missed periods.
Future instances enter Backlog; occurrences due today or earlier enter Waiting.

Run `npm test` for isolated PostgreSQL regression tests. These use PGlite and do
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

This is currently a working UI prototype. Real data persistence and auth integration are next.