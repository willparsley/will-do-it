-- Apply after 202610140001. No existing cards are deleted or reclassified.
begin;

-- A failed rehome must never cascade-delete history or orphan a recurrence.
alter table public.cards drop constraint if exists cards_stream_id_fkey;
alter table public.cards add constraint cards_stream_id_fkey
  foreign key (stream_id) references public.streams(id) on delete no action;
alter table public.recurrence_sources drop constraint if exists recurrence_sources_stream_id_fkey;
alter table public.recurrence_sources add constraint recurrence_sources_stream_id_fkey
  foreign key (stream_id) references public.streams(id) on delete no action;

create or replace function public.guard_recurring_card_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
begin
  if TG_OP = 'UPDATE' then
    if new.recurrence_source_id is distinct from old.recurrence_source_id
       or new.recurrence_date is distinct from old.recurrence_date then
      raise exception 'A scheduled occurrence cannot change its recurrence identity';
    end if;
    -- Existing active duplicates remain editable so users can resolve them.
    if old.status not in ('complete', 'canceled') or new.status in ('complete', 'canceled') then
      return new;
    end if;
  end if;
  if new.recurrence_source_id is null then return new; end if;
  select * into source from public.recurrence_sources
    where id = new.recurrence_source_id and user_id = new.user_id for update;
  if not found then raise exception 'Recurrence source not found'; end if;
  if not coalesce(source.stack_missed, false)
     and new.status not in ('complete', 'canceled')
     and exists (select 1 from public.cards where recurrence_source_id = source.id
       and user_id = new.user_id and id <> new.id and status not in ('complete', 'canceled')) then
    raise exception 'This recurrence already has a pending card. Complete or cancel it before reopening another occurrence.' using errcode = '23505';
  end if;
  if TG_OP = 'INSERT' and new.due_at is not null then
    new.recurrence_date := coalesce(new.recurrence_date,
      (new.due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date);
    if exists (select 1 from public.cards where recurrence_source_id = source.id
      and user_id = new.user_id and recurrence_date is null
      and (due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date = new.recurrence_date) then
      raise exception 'This occurrence already exists' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cards_recurring_reopen on public.cards;
create trigger cards_recurring_reopen before update of status, recurrence_source_id, recurrence_date
  on public.cards for each row execute function public.guard_recurring_card_insert();

create or replace function public.promote_due_cards(p_timezone text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  promoted integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  update public.cards c set status = 'waiting'
  where c.user_id = auth.uid() and c.status in ('backlog', 'priority_backlog')
    and exists (
      select 1 from (select coalesce((
        select recurrence_timezone from public.recurrence_sources
        where id = c.recurrence_source_id and user_id = auth.uid()
      ), p_timezone) as tz) calendar
      where case when c.is_recurring then
        (c.due_at at time zone tz)::date <= (now() at time zone tz)::date
        or (c.remind_at at time zone tz)::date <= (now() at time zone tz)::date
      else
        (c.due_at at time zone tz)::date = (now() at time zone tz)::date
        or (c.remind_at at time zone tz)::date = (now() at time zone tz)::date
      end
    );
  get diagnostics promoted = row_count;
  return promoted;
end;
$$;

create or replace function public.delete_stream_rehoming(p_stream_id uuid, p_target_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  original public.streams;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  -- All stream lifecycle RPCs acquire stream locks in the same order.
  perform id from public.streams where user_id = auth.uid() order by id for update;
  select * into original from public.streams where id = p_stream_id and user_id = auth.uid();
  if not found then raise exception 'Stream not found'; end if;
  if original.title = 'Uncategorized' then raise exception 'Cannot delete the Uncategorized stream'; end if;
  if p_target_id = p_stream_id or not exists (
    select 1 from public.streams where id = p_target_id and user_id = auth.uid() and state = 'in_progress'
  ) then raise exception 'Choose an active stream to move cards to'; end if;
  perform id from public.recurrence_sources where user_id = auth.uid() and stream_id = p_stream_id order by id for update;
  update public.recurrence_sources set stream_id = p_target_id where stream_id = p_stream_id and user_id = auth.uid();
  update public.cards set stream_id = p_target_id where stream_id = p_stream_id and user_id = auth.uid();
  delete from public.streams where id = p_stream_id and user_id = auth.uid();
end;
$$;

revoke all on function public.promote_due_cards(text) from public;
revoke all on function public.delete_stream_rehoming(uuid, uuid) from public;
grant execute on function public.promote_due_cards(text) to authenticated;
grant execute on function public.delete_stream_rehoming(uuid, uuid) to authenticated;
commit;
