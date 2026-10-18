-- Apply before deploying the account-isolation changes. Invalid legacy links
-- stop this migration for explicit repair; no cards or history are deleted.
begin;
lock table public.streams, public.recurrence_sources, public.cards in share row exclusive mode;

do $$ begin
  if exists (
    select 1 from public.cards c left join public.streams s on s.id = c.stream_id
    where s.id is null or s.user_id <> c.user_id
  ) or exists (
    select 1 from public.recurrence_sources r left join public.streams s on s.id = r.stream_id
    where r.stream_id is not null and (s.id is null or s.user_id <> r.user_id)
  ) then
    raise exception 'Stream ownership mismatch. Repair cross-account card/recurrence stream links before applying this migration.';
  end if;
end $$;

create unique index if not exists streams_id_user_id_key on public.streams(id, user_id);
create index if not exists cards_stream_owner_idx on public.cards(stream_id, user_id);
create index if not exists recurrence_sources_stream_owner_idx on public.recurrence_sources(stream_id, user_id);

alter table public.cards drop constraint if exists cards_stream_id_fkey;
alter table public.cards drop constraint if exists cards_stream_owner_fkey;
alter table public.cards add constraint cards_stream_owner_fkey
  foreign key (stream_id, user_id) references public.streams(id, user_id) on delete no action;

alter table public.recurrence_sources drop constraint if exists recurrence_sources_stream_id_fkey;
alter table public.recurrence_sources drop constraint if exists recurrence_sources_stream_owner_fkey;
alter table public.recurrence_sources add constraint recurrence_sources_stream_owner_fkey
  foreign key (stream_id, user_id) references public.streams(id, user_id) on delete no action;
commit;
