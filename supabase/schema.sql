-- Will Do It - Initial Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension if not already
create extension if not exists "uuid-ossp";

-- Streams
create table streams (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  state text not null check (state in ('backlog', 'in_progress', 'complete', 'canceled')),
  area text not null check (area in ('work', 'personal', 'neutral')),
  notes text,
  position integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Cards
create table cards (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  stream_id uuid references streams(id) on delete cascade not null,
  title text not null,
  notes text,
  status text not null,
  due_at timestamptz,
  remind_at timestamptz,
  position integer not null default 0,
  is_recurring boolean default false,
  recurrence_source_id uuid,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Recurrence Sources
create table recurrence_sources (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  stream_id uuid references streams(id) on delete set null,
  base_title text not null,
  frequency text,
  interval integer,
  weekdays jsonb,
  month_day integer,
  stack_missed boolean default false,
  end_date timestamptz,
  stopped_at timestamptz,
  last_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Basic RLS (expand later)
alter table streams enable row level security;
alter table cards enable row level security;
alter table recurrence_sources enable row level security;

create policy "Users can manage their own streams" on streams
  for all using (auth.uid() = user_id);

create policy "Users can manage their own cards" on cards
  for all using (auth.uid() = user_id);

create policy "Users can manage their own recurrences" on recurrence_sources
  for all using (auth.uid() = user_id);

-- Indexes for common queries
create index on cards (stream_id, status);
create index on cards (recurrence_source_id);
create index on cards (user_id, completed_at);