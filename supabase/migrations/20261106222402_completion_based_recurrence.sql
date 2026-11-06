-- Completion-based intervals for non-stacking sources; stacking keeps its calendar.
-- Existing pending cards and archived history are not rewritten.
begin;

-- Calendar rules still place initial cards and reschedule pending pattern edits.
-- Generation uses elapsed intervals for non-stacking sources, in local dates.
create or replace function public.next_generated_recurrence_date(
  p_after date, p_source public.recurrence_sources
) returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  step integer := greatest(coalesce(p_source.interval, 1), 1);
begin
  if coalesce(p_source.stack_missed, false) then
    return public.next_recurrence_date(p_after, p_source);
  end if;
  case coalesce(p_source.frequency, 'daily')
    when 'weekly' then return p_after + step * 7;
    when 'monthly' then return (p_after + make_interval(months => step))::date;
    else return p_after + step;
  end case;
end;
$$;

revoke all on function public.next_generated_recurrence_date(date, public.recurrence_sources) from public;
grant execute on function public.next_generated_recurrence_date(date, public.recurrence_sources) to authenticated, service_role;

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
  -- Once the only pending occurrence is finished (or canceled), even an
  -- early finish starts a fresh interval. While pending, retain the generated
  -- horizon for pattern edits and stream-closure checks.
  if not coalesce(p_source.stack_missed, false) and not exists (
    select 1 from public.cards where recurrence_source_id = p_source.id
      and user_id = auth.uid() and status not in ('complete', 'canceled')
  ) then
    completed := greatest(completed, (p_source.last_completed_at at time zone tz)::date);
    if completed is not null then return completed; end if;
  end if;
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
  candidate := public.next_generated_recurrence_date(public.recurrence_cursor(p_source), p_source);
  while candidate <= last_day loop
    if not exists (select 1 from public.cards where recurrence_source_id = p_source.id and user_id = auth.uid()
      and coalesce(scheduled_date, recurrence_date, (due_at at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date) = candidate) then
      return true;
    end if;
    candidate := public.next_generated_recurrence_date(candidate, p_source);
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
      next_date := public.next_generated_recurrence_date(cursor_date, source);
      if source.end_date is not null and
         next_date > (source.end_date at time zone source.recurrence_timezone)::date then exit; end if;

      generated_title := source.base_title;

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

commit;
