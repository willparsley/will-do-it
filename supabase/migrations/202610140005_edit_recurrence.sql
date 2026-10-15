-- Apply before deploying the recurrence editor. Terminal history and occurrence
-- identities are immutable; pending cards can be rescheduled without duplicates.
begin;

alter table public.cards add column if not exists auto_promoted_from text
  check (auto_promoted_from in ('backlog','priority_backlog'));
alter table public.cards add column if not exists scheduled_date date;
alter table public.cards add column if not exists recurrence_revision integer not null default 1;
alter table public.recurrence_sources add column if not exists schedule_revision integer not null default 1;
-- Keep this separate from due_at: editing one card's due date does not release
-- its scheduled slot. Revisions let a new schedule reuse dates from an old one.
drop index if exists public.cards_recurrence_occurrence_key;
create unique index cards_recurrence_occurrence_key
  on public.cards (recurrence_source_id, recurrence_revision, recurrence_date)
  where recurrence_source_id is not null and recurrence_date is not null;

create or replace function public.track_card_promotion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if not (new.status = 'waiting' and old.status in ('backlog','priority_backlog')
            and new.auto_promoted_from = old.status) then
      new.auto_promoted_from := null;
    end if;
  end if;
  if new.status <> 'waiting' then new.auto_promoted_from := null; end if;
  return new;
end;
$$;
drop trigger if exists cards_track_promotion on public.cards;
create trigger cards_track_promotion before insert or update on public.cards
  for each row execute function public.track_card_promotion();

create or replace function public.rescheduled_recurrence_date(
  p_day date, p_old public.recurrence_sources, p_new public.recurrence_sources
) returns date language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_new.frequency = 'monthly' and p_old.frequency = 'monthly' then
    return public.next_recurrence_date(date_trunc('month', p_day)::date - 1, p_new);
  elsif p_new.frequency = 'weekly' and p_old.frequency = 'weekly' then
    return public.next_recurrence_date(p_day - extract(dow from p_day)::integer - 1, p_new);
  elsif p_new.frequency in ('daily','every_n_days') and p_old.frequency in ('daily','every_n_days') then
    return p_day - greatest(coalesce(p_old.interval, 1), 1) + p_new.interval;
  else
    return public.next_recurrence_date(p_day - 1, p_new);
  end if;
end;
$$;

-- Only settings changes invalidate an open editor. Refreshing the generation
-- cursor or completion bookkeeping must not cause spurious edit conflicts.
create or replace function public.stamp_recurrence_settings()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if row(new.stream_id, new.base_title, new.frequency, new.interval, new.weekdays,
         new.month_day, new.stack_missed, new.end_date, new.stopped_at)
     is distinct from
     row(old.stream_id, old.base_title, old.frequency, old.interval, old.weekdays,
         old.month_day, old.stack_missed, old.end_date, old.stopped_at) then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists recurrence_settings_updated on public.recurrence_sources;
create trigger recurrence_settings_updated before update on public.recurrence_sources
  for each row execute function public.stamp_recurrence_settings();

create or replace function public.save_recurrence(
  p_source_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_timezone text
) returns public.recurrence_sources language plpgsql security invoker set search_path = '' as $$
declare
  original public.recurrence_sources;
  edited public.recurrence_sources;
  end_day date;
  pattern_changed boolean;
  pending public.cards;
  old_day date;
  new_day date;
  last_day date;
  new_due timestamptz;
  new_reminder timestamptz;
  next_state text;
  today date;
  cursor_day date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or
     p_changes - array['base_title','stream_id','frequency','interval','weekdays',
       'month_day','stack_missed','end_date','enabled'] <> '{}'::jsonb then
    raise exception 'Invalid recurrence changes';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  -- Match the stream -> source lock order used by generation and stream edits.
  perform id from public.streams where user_id = auth.uid() order by id for update;
  select * into original from public.recurrence_sources
    where id = p_source_id and user_id = auth.uid() for update;
  if not found then raise exception 'Recurrence source not found'; end if;
  if original.updated_at is distinct from p_expected_updated_at then
    raise exception 'This recurrence changed elsewhere. Close and reopen the recurrence editor.';
  end if;

  edited := jsonb_populate_record(original, p_changes - array['end_date','enabled']);
  edited.recurrence_timezone := coalesce(original.recurrence_timezone, p_timezone);
  if p_changes ? 'enabled' then
    if jsonb_typeof(p_changes->'enabled') <> 'boolean' then raise exception 'Invalid recurrence state'; end if;
    edited.stopped_at := case when (p_changes->>'enabled')::boolean then null else coalesce(original.stopped_at, now()) end;
  end if;
  if p_changes ? 'end_date' then
    end_day := (p_changes->>'end_date')::date;
    -- Keep the original instant if the source's local end day is unchanged.
    if end_day is distinct from (original.end_date at time zone edited.recurrence_timezone)::date then
      edited.end_date := end_day::timestamp at time zone edited.recurrence_timezone;
    end if;
  end if;
  if edited.base_title is null or btrim(edited.base_title) = '' then raise exception 'A title is required'; end if;
  if edited.frequency is null or edited.frequency not in ('daily','every_n_days','weekly','monthly')
     or edited.interval is null or edited.interval < 1 then raise exception 'Invalid recurrence pattern'; end if;
  if edited.frequency = 'daily' then edited.interval := 1; end if;
  if edited.weekdays is not null then
    if jsonb_typeof(edited.weekdays) <> 'array' then raise exception 'Invalid weekdays'; end if;
    if exists (select 1 from jsonb_array_elements(edited.weekdays) value
      where value::text not in ('0','1','2','3','4','5','6')) then raise exception 'Invalid weekdays'; end if;
  end if;
  if edited.month_day is not null and edited.month_day <> -1 and edited.month_day not between 1 and 31 then
    raise exception 'Invalid monthly day';
  end if;
  if edited.stack_missed is null then raise exception 'Choose whether to stack missed occurrences'; end if;
  if edited.stream_id is null or not exists (select 1 from public.streams where id = edited.stream_id
    and user_id = auth.uid() and (state = 'in_progress' or
      (id = original.stream_id and edited.stopped_at is not null))) then
    raise exception 'Choose an active stream before enabling or moving this recurrence';
  end if;
  if coalesce(original.stack_missed, false) and not edited.stack_missed and
     (select count(*) from public.cards where recurrence_source_id = original.id
       and user_id = auth.uid() and status not in ('complete','canceled')) > 1 then
    raise exception 'Complete or cancel extra pending occurrences before turning off stacking';
  end if;

  today := (now() at time zone edited.recurrence_timezone)::date;
  pattern_changed := coalesce(original.frequency, 'daily') is distinct from edited.frequency
    or greatest(coalesce(original.interval, 1), 1) <> edited.interval
    or (edited.frequency = 'weekly' and coalesce(original.weekdays, '[]'::jsonb)
        is distinct from coalesce(edited.weekdays, '[]'::jsonb))
    or (edited.frequency = 'monthly' and
        coalesce(nullif(original.month_day, 0), extract(day from original.created_at at time zone edited.recurrence_timezone)::integer)
        is distinct from coalesce(nullif(edited.month_day, 0), extract(day from edited.created_at at time zone edited.recurrence_timezone)::integer));
  if pattern_changed then
    edited.schedule_revision := original.schedule_revision + 1;
    cursor_day := public.rescheduled_recurrence_date(public.recurrence_cursor(original), original, edited);
  end if;

  update public.recurrence_sources set base_title = btrim(edited.base_title),
    stream_id = edited.stream_id, frequency = edited.frequency, interval = edited.interval,
    weekdays = edited.weekdays, month_day = edited.month_day, stack_missed = edited.stack_missed,
    end_date = edited.end_date, stopped_at = edited.stopped_at,
    recurrence_timezone = edited.recurrence_timezone, schedule_revision = edited.schedule_revision
    where id = original.id and user_id = auth.uid() returning * into edited;

  for pending in select * from public.cards where recurrence_source_id = original.id
    and user_id = auth.uid() and status not in ('complete','canceled')
    order by coalesce(scheduled_date, recurrence_date,
      (due_at at time zone edited.recurrence_timezone)::date), created_at, id for update
  loop
    old_day := coalesce(pending.scheduled_date, pending.recurrence_date,
      (pending.due_at at time zone edited.recurrence_timezone)::date, today);
    new_day := old_day;
    new_due := pending.due_at;
    new_reminder := pending.remind_at;
    next_state := pending.status;
    if pattern_changed then
      new_day := public.rescheduled_recurrence_date(old_day, original, edited);
      if last_day is not null and new_day <= last_day then
        new_day := public.next_recurrence_date(last_day, edited);
      end if;
      last_day := new_day;
      cursor_day := greatest(cursor_day, new_day);
      new_due := (new_day + coalesce((pending.due_at at time zone edited.recurrence_timezone)::time, time '00:00'))
        at time zone edited.recurrence_timezone;
      if pending.remind_at is not null then
        new_reminder := (new_day + ((pending.remind_at at time zone edited.recurrence_timezone)::date
          - coalesce((pending.due_at at time zone edited.recurrence_timezone)::date, old_day))
          + (pending.remind_at at time zone edited.recurrence_timezone)::time)
          at time zone edited.recurrence_timezone;
      end if;
      if pending.status = 'waiting' and pending.auto_promoted_from is not null
         and (new_due at time zone edited.recurrence_timezone)::date > today
         and (new_reminder is null or (new_reminder at time zone edited.recurrence_timezone)::date > today) then
        next_state := pending.auto_promoted_from;
      end if;
    end if;
    if pattern_changed or edited.base_title is distinct from original.base_title then
      update public.cards set
        title = edited.base_title || ' - ' || case edited.frequency
          when 'monthly' then to_char(new_day, 'FMMonth YYYY')
          when 'weekly' then 'Week of ' || to_char(new_day, 'YYYY-MM-DD')
          else to_char(new_day, 'YYYY-MM-DD') end,
        due_at = new_due, remind_at = new_reminder, scheduled_date = new_day,
        status = next_state, updated_at = now()
        where id = pending.id and user_id = auth.uid();
    end if;
  end loop;
  if pattern_changed then
    update public.recurrence_sources set generated_through = cursor_day
      where id = original.id and user_id = auth.uid() returning * into edited;
  end if;
  perform public.promote_due_cards(p_timezone);
  return edited;
end;
$$;

create or replace function public.promote_due_cards(p_timezone text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  promoted integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  -- Keep the status predicate on the updated row, so stale refreshes cannot
  -- reopen completed/canceled cards or move other active statuses backwards.
  update public.cards c set status = 'waiting', auto_promoted_from = c.status
  where c.user_id = auth.uid() and c.status in ('backlog', 'priority_backlog')
    and exists (
      select 1 from (select coalesce((
        select recurrence_timezone from public.recurrence_sources
        where id = c.recurrence_source_id and user_id = auth.uid()
      ), p_timezone) as tz) calendar
      where (c.due_at at time zone tz)::date <= (now() at time zone tz)::date
         or (c.remind_at at time zone tz)::date <= (now() at time zone tz)::date
    );
  get diagnostics promoted = row_count;
  return promoted;
end;
$$;

create or replace function public.guard_recurring_card_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
begin
  if TG_OP = 'UPDATE' then
    if new.recurrence_revision is distinct from old.recurrence_revision
       or new.recurrence_source_id is distinct from old.recurrence_source_id
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
  if TG_OP = 'INSERT' then
    new.recurrence_revision := source.schedule_revision;
    new.scheduled_date := coalesce(new.scheduled_date, new.recurrence_date, (new.due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date);
  end if;
  if not coalesce(source.stack_missed, false)
     and new.status not in ('complete', 'canceled')
     and exists (select 1 from public.cards where recurrence_source_id = source.id
       and user_id = new.user_id and id <> new.id and status not in ('complete', 'canceled')) then
    raise exception 'This recurrence already has a pending card. Complete or cancel it before reopening another occurrence.' using errcode = '23505';
  end if;
  if TG_OP = 'INSERT' and not exists (
    select 1 from public.streams where id = new.stream_id and user_id = new.user_id and state = 'in_progress'
  ) then raise exception 'Choose an active stream'; end if;
  if TG_OP = 'INSERT' and source.generated_through is null and not exists (
    select 1 from public.cards where recurrence_source_id = source.id and user_id = new.user_id
  ) then
    new.due_at := coalesce(new.due_at, public.first_recurrence_date(source)::timestamp
      at time zone coalesce(source.recurrence_timezone, 'UTC'));
    new.recurrence_date := (new.due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date;
    update public.recurrence_sources set generated_through = new.recurrence_date where id = source.id and user_id = new.user_id;
    if new.status in ('backlog', 'priority_backlog') and new.recurrence_date <=
      (now() at time zone coalesce(source.recurrence_timezone, 'UTC'))::date then
      new.auto_promoted_from := new.status;
      new.status := 'waiting';
    end if;
    new.scheduled_date := new.recurrence_date;
  end if;
  if TG_OP = 'INSERT' and new.due_at is not null then
    new.recurrence_date := coalesce(new.recurrence_date,
      (new.due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date);
    if exists (select 1 from public.cards where recurrence_source_id = source.id
      and user_id = new.user_id
      and (recurrence_date is null or recurrence_revision <> new.recurrence_revision)
      and coalesce(scheduled_date, recurrence_date,
        (due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date) = new.recurrence_date) then
      raise exception 'This occurrence already exists' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.recurrence_cursor(p_source public.recurrence_sources)
returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  scheduled date;
  completed date;
  tz text := coalesce(p_source.recurrence_timezone, 'UTC');
  result date;
begin
  select case when coalesce(p_source.stack_missed, false)
           then min(coalesce(scheduled_date, recurrence_date, (due_at at time zone tz)::date))
           else max(coalesce(scheduled_date, recurrence_date, (due_at at time zone tz)::date)) end,
         max((completed_at at time zone tz)::date)
    into scheduled, completed from public.cards
    where recurrence_source_id = p_source.id and user_id = auth.uid();
  result := coalesce(p_source.generated_through, scheduled,
    (p_source.created_at at time zone tz)::date, (now() at time zone tz)::date);
  if not coalesce(p_source.stack_missed, false) then
    result := greatest(result, completed, (p_source.last_completed_at at time zone tz)::date);
  end if;
  return result;
end;
$$;

create or replace function public.recurrence_can_generate(p_source public.recurrence_sources)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare
  candidate date;
  last_day date;
begin
  if p_source.stopped_at is not null or p_source.stream_id is null then return false; end if;
  if p_source.end_date is null then return true; end if;
  last_day := (p_source.end_date at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date;
  candidate := public.next_recurrence_date(public.recurrence_cursor(p_source), p_source);
  while candidate <= last_day loop
    if not exists (select 1 from public.cards where recurrence_source_id = p_source.id and user_id = auth.uid()
      and coalesce(scheduled_date, recurrence_date, (due_at at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date) = candidate) then
      return true;
    end if;
    candidate := public.next_recurrence_date(candidate, p_source);
  end loop;
  return false;
end;
$$;

create or replace function public.generate_recurring_instances(p_timezone text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
  cursor_date date;
  next_date date;
  today date;
  inserted integer;
  total integer := 0;
  batch_count integer;
  generated_title text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;

  -- Use a consistent stream -> source -> card lock order in all lifecycle RPCs.
  perform id from public.streams where user_id = auth.uid() order by id for update;
  -- Serialize callers per source and always re-check current database state.
  for source in
    select * from public.recurrence_sources
    where user_id = auth.uid() and stopped_at is null
    order by id for update
  loop
    if not exists (select 1 from public.streams where id = source.stream_id and user_id = auth.uid() and state = 'in_progress') then continue; end if;
    -- Older clients may create the source and initial card separately.
    -- Do not generate in the window before that initial card has been saved.
    if source.generated_through is null and not exists (
      select 1 from public.cards where recurrence_source_id = source.id and user_id = auth.uid()
    ) then continue; end if;
    source.recurrence_timezone := coalesce(source.recurrence_timezone, p_timezone);
    today := (now() at time zone source.recurrence_timezone)::date;

    -- Schedule legacy undated initial cards too; statuses are promoted by the
    -- conditional refresh RPC. Their stored history/identity is not rewritten.
    update public.cards set due_at = public.first_recurrence_date(source)::timestamp at time zone source.recurrence_timezone
      where recurrence_source_id = source.id and user_id = auth.uid() and due_at is null
        and recurrence_date is null and status not in ('complete', 'canceled');
    cursor_date := public.recurrence_cursor(source);
    update public.recurrence_sources set recurrence_timezone = source.recurrence_timezone, generated_through = cursor_date
      where id = source.id;
    if not coalesce(source.stack_missed, false) and exists (
      select 1 from public.cards where recurrence_source_id = source.id
        and user_id = auth.uid() and status not in ('complete', 'canceled')
    ) then continue; end if;

    batch_count := 0;
    loop
      -- A future occurrence already covers the horizon, even after refresh.
      if coalesce(source.stack_missed, false) and cursor_date > today then exit; end if;
      next_date := public.next_recurrence_date(cursor_date, source);
      if source.end_date is not null and
         next_date > (source.end_date at time zone source.recurrence_timezone)::date then exit; end if;

      generated_title := source.base_title || ' - ' || case source.frequency
        when 'monthly' then to_char(next_date, 'FMMonth YYYY')
        when 'weekly' then 'Week of ' || to_char(next_date, 'YYYY-MM-DD')
        else to_char(next_date, 'YYYY-MM-DD') end;

      -- Legacy occurrences reserve their scheduled dates even without a key.
      inserted := 0;
      if not exists (select 1 from public.cards where recurrence_source_id = source.id
        and user_id = auth.uid() and coalesce(scheduled_date, recurrence_date,
          (due_at at time zone source.recurrence_timezone)::date) = next_date) then
        insert into public.cards (user_id, stream_id, title, status, due_at,
          is_recurring, recurrence_source_id, recurrence_date, scheduled_date, recurrence_revision, auto_promoted_from, position)
        values (auth.uid(), source.stream_id, generated_title,
          case when next_date <= today then 'waiting' else 'backlog' end,
          next_date::timestamp at time zone source.recurrence_timezone,
          true, source.id, next_date, next_date, source.schedule_revision,
          case when next_date <= today then 'backlog' else null end, 0)
        on conflict (recurrence_source_id, recurrence_revision, recurrence_date)
          where recurrence_source_id is not null and recurrence_date is not null
        do nothing;
        get diagnostics inserted = row_count;
        total := total + inserted;
      end if;
      cursor_date := next_date;
      batch_count := batch_count + 1;
      -- One pending for non-stacking; stacking catches up and keeps one future
      -- instance. Bound very old sources to 1000 periods per refresh.
      if (not coalesce(source.stack_missed, false) and inserted > 0)
        or (coalesce(source.stack_missed, false) and next_date > today)
        or batch_count >= 1000 then exit; end if;
    end loop;

    update public.recurrence_sources
      set generated_through = cursor_date, recurrence_timezone = source.recurrence_timezone
      where id = source.id;
  end loop;
  return total;
end;
$$;

drop trigger if exists cards_recurring_reopen on public.cards;
create trigger cards_recurring_reopen before update of status, recurrence_source_id, recurrence_date, recurrence_revision
  on public.cards for each row execute function public.guard_recurring_card_insert();

revoke all on function public.save_recurrence(uuid,timestamptz,jsonb,text) from public;
grant execute on function public.save_recurrence(uuid,timestamptz,jsonb,text) to authenticated;
commit;
