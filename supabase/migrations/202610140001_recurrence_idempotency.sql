-- Apply before deploying the corresponding app changes. Existing cards/history
-- are preserved; legacy duplicates are intentionally not deleted or relabeled.
begin;

alter table public.cards add column if not exists recurrence_date date;
alter table public.recurrence_sources add column if not exists recurrence_timezone text;
alter table public.recurrence_sources add column if not exists generated_through date;

-- This identity is separate from due_at, which users can edit.
create unique index if not exists cards_recurrence_occurrence_key
  on public.cards (recurrence_source_id, recurrence_date)
  where recurrence_source_id is not null and recurrence_date is not null;

-- Guard direct inserts too, including tabs still running the older client.
create or replace function public.guard_recurring_card_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
begin
  if new.recurrence_source_id is null then return new; end if;
  select * into source from public.recurrence_sources
    where id = new.recurrence_source_id and user_id = new.user_id for update;
  if not found then raise exception 'Recurrence source not found'; end if;
  if not coalesce(source.stack_missed, false)
     and new.status not in ('complete', 'canceled')
     and exists (select 1 from public.cards where recurrence_source_id = source.id
       and user_id = new.user_id and status not in ('complete', 'canceled')) then
    raise exception 'This recurrence already has a pending card' using errcode = '23505';
  end if;
  if new.due_at is not null then
    new.recurrence_date := coalesce(new.recurrence_date,
      (new.due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date);
    -- Legacy rows have no occurrence keys. They still reserve their due dates.
    if exists (select 1 from public.cards where recurrence_source_id = source.id
      and user_id = new.user_id and recurrence_date is null
      and (due_at at time zone coalesce(source.recurrence_timezone, 'UTC'))::date = new.recurrence_date) then
      raise exception 'This occurrence already exists' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cards_recurring_insert on public.cards;
create trigger cards_recurring_insert before insert on public.cards
  for each row execute function public.guard_recurring_card_insert();

create or replace function public.stamp_card_completion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('complete', 'canceled') then
    if TG_OP = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status not in ('complete', 'canceled') then
      new.completed_at := now();
    end if;
    new.remind_at := null;
    if new.recurrence_source_id is not null and new.status = 'complete' then
      update public.recurrence_sources
      set last_completed_at = greatest(last_completed_at, new.completed_at)
      where id = new.recurrence_source_id and user_id = new.user_id;
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists cards_completion on public.cards;
create trigger cards_completion before insert or update of status on public.cards
  for each row execute function public.stamp_card_completion();

-- Calendar arithmetic uses the timezone pinned to the source on first refresh.
create or replace function public.next_recurrence_date(
  p_after date, p_source public.recurrence_sources
) returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  step integer := greatest(coalesce(p_source.interval, 1), 1);
  anchor date := (p_source.created_at at time zone p_source.recurrence_timezone)::date;
  candidate date;
  month_start date;
  last_day integer;
  pin integer;
  months_since integer;
begin
  case coalesce(p_source.frequency, 'daily')
    when 'monthly' then
      pin := coalesce(nullif(p_source.month_day, 0), extract(day from anchor)::integer);
      months_since := (extract(year from p_after)::integer - extract(year from anchor)::integer) * 12
        + extract(month from p_after)::integer - extract(month from anchor)::integer;
      month_start := (date_trunc('month', anchor) + make_interval(months => greatest(0, months_since / step) * step))::date;
      loop
        last_day := extract(day from month_start + interval '1 month - 1 day')::integer;
        candidate := month_start + (case when pin = -1 then last_day else least(greatest(pin, 1), last_day) end - 1);
        if candidate > p_after then return candidate; end if;
        month_start := (month_start + make_interval(months => step))::date;
      end loop;
    when 'weekly' then
      candidate := p_after + 1;
      loop
        if ((candidate - extract(dow from candidate)::integer
              - (anchor - extract(dow from anchor)::integer)) / 7) % step = 0
           and (
             (coalesce(jsonb_array_length(p_source.weekdays), 0) = 0
               and extract(dow from candidate) = extract(dow from anchor))
             or p_source.weekdays @> to_jsonb(array[extract(dow from candidate)::integer])
           ) then
          return candidate;
        end if;
        candidate := candidate + 1;
      end loop;
    else
      return p_after + step;
  end case;
end;
$$;

create or replace function public.generate_recurring_instances(p_timezone text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
  cursor_date date;
  next_date date;
  today date;
  legacy_due date;
  last_completion date;
  inserted integer;
  total integer := 0;
  batch_count integer;
  generated_title text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;

  -- Serialize callers per source and always re-check current database state.
  for source in
    select * from public.recurrence_sources
    where user_id = auth.uid() and stopped_at is null
    order by id for update
  loop
    if source.stream_id is null then continue; end if;
    -- Source creation and the initial manual card are separate requests today.
    -- Do not generate in the window before that initial card has been saved.
    if source.generated_through is null and not exists (
      select 1 from public.cards where recurrence_source_id = source.id and user_id = auth.uid()
    ) then continue; end if;
    source.recurrence_timezone := coalesce(source.recurrence_timezone, p_timezone);
    today := (now() at time zone source.recurrence_timezone)::date;

    if not coalesce(source.stack_missed, false) and exists (
      select 1 from public.cards where recurrence_source_id = source.id
        and user_id = auth.uid() and status not in ('complete', 'canceled')
    ) then continue; end if;

    -- Persist before inserting so the insert guard and legacy-date comparisons
    -- use the same calendar timezone as this generator.
    update public.recurrence_sources set recurrence_timezone = source.recurrence_timezone
      where id = source.id;

    select max((due_at at time zone source.recurrence_timezone)::date),
           max((completed_at at time zone source.recurrence_timezone)::date)
      into legacy_due, last_completion
      from public.cards where recurrence_source_id = source.id and user_id = auth.uid();

    -- Bootstrap from legacy cards without rewriting their history. For stacking,
    -- completion must not jump the cursor past ungenerated missed periods.
    cursor_date := coalesce(source.generated_through,
      greatest(legacy_due, last_completion,
        (source.last_completed_at at time zone source.recurrence_timezone)::date,
        (source.created_at at time zone source.recurrence_timezone)::date));
    if not coalesce(source.stack_missed, false) then
      cursor_date := greatest(cursor_date, last_completion,
        (source.last_completed_at at time zone source.recurrence_timezone)::date);
    end if;

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

      insert into public.cards (user_id, stream_id, title, status, due_at,
        is_recurring, recurrence_source_id, recurrence_date, position)
      values (auth.uid(), source.stream_id, generated_title,
        case when next_date <= today then 'waiting' else 'backlog' end,
        next_date::timestamp at time zone source.recurrence_timezone,
        true, source.id, next_date, 0)
      on conflict (recurrence_source_id, recurrence_date)
        where recurrence_source_id is not null and recurrence_date is not null
      do nothing;
      get diagnostics inserted = row_count;
      total := total + inserted;
      cursor_date := next_date;
      batch_count := batch_count + 1;
      -- One pending for non-stacking; stacking catches up and keeps one future
      -- instance. Bound very old sources to 1000 periods per refresh.
      if not coalesce(source.stack_missed, false) or next_date > today or batch_count >= 1000 then exit; end if;
    end loop;

    update public.recurrence_sources
      set generated_through = cursor_date, recurrence_timezone = source.recurrence_timezone
      where id = source.id;
  end loop;
  return total;
end;
$$;

revoke all on function public.generate_recurring_instances(text) from public;
grant execute on function public.generate_recurring_instances(text) to authenticated;
commit;
