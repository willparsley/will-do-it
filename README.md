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

## Project Context
See `agents.md` for full decisions, data model, and contribution guidelines.

## Tech
- Next.js (App Router)
- Supabase (Auth + Postgres + RLS)
- Tailwind + calm design system
- @dnd-kit for the matrix

This is currently a working UI prototype. Real data persistence and auth integration are next.