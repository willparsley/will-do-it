-- Apply after 202610140002. Stream/card lifecycle operations are transactional.
begin;

create or replace function public.next_recurrence_date(
  p_after date, p_source public.recurrence_sources
) returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  step integer := greatest(coalesce(p_source.interval, 1), 1);
  anchor date := (coalesce(p_source.created_at, now()) at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date;
  candidate date;
  month_start date;
  last_day integer;
  pin integer;
  months_since integer;
begin
  if p_source.frequency = 'weekly' and p_source.weekdays is not null then
    if jsonb_typeof(p_source.weekdays) <> 'array' then raise exception 'Invalid weekdays'; end if;
    if exists (select 1 from jsonb_array_elements(p_source.weekdays) value where value::text not in ('0','1','2','3','4','5','6')) then raise exception 'Invalid weekdays'; end if;
  end if;
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


-- A generation cursor records scheduled periods, never late completion times
-- for stacking sources. With legacy data, start at the first scheduled card and
-- scan forward, skipping existing dates instead of losing holes in the history.
create or replace function public.recurrence_cursor(p_source public.recurrence_sources)
returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  scheduled date;
  completed date;
  tz text := coalesce(p_source.recurrence_timezone, 'UTC');
  result date;
begin
  select case when coalesce(p_source.stack_missed, false)
           then min(coalesce(recurrence_date, (due_at at time zone tz)::date))
           else max(coalesce(recurrence_date, (due_at at time zone tz)::date)) end,
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

create or replace function public.first_recurrence_date(p_source public.recurrence_sources)
returns date language plpgsql stable security invoker set search_path = '' as $$
declare
  anchor date := (coalesce(p_source.created_at, now()) at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date;
begin
  if p_source.frequency in ('weekly', 'monthly') then
    return public.next_recurrence_date(anchor - 1, p_source);
  end if;
  return anchor;
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
      and coalesce(recurrence_date, (due_at at time zone coalesce(p_source.recurrence_timezone, 'UTC'))::date) = candidate) then
      return true;
    end if;
    candidate := public.next_recurrence_date(candidate, p_source);
  end loop;
  return false;
end;
$$;

create or replace function public.recurrences_for_stream(p_stream_id uuid, p_timezone text)
returns setof public.recurrence_sources language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone'; end if;
  perform id from public.streams where user_id = auth.uid() order by id for update;
  for source in select * from public.recurrence_sources
    where stream_id = p_stream_id and user_id = auth.uid() order by id for update
  loop
    if source.recurrence_timezone is null then
      source.recurrence_timezone := p_timezone;
      update public.recurrence_sources set recurrence_timezone = p_timezone where id = source.id and user_id = auth.uid();
    end if;
    if public.recurrence_can_generate(source) then return next source; end if;
  end loop;
end;
$$;

create or replace function public.move_pending_recurrence_cards()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.stream_id is not distinct from old.stream_id then return new; end if;
  if not exists (select 1 from public.streams where id = new.stream_id
    and user_id = new.user_id and state = 'in_progress') then
    raise exception 'Choose an active stream for this recurrence';
  end if;
  update public.cards set stream_id = new.stream_id
    where recurrence_source_id = new.id and user_id = new.user_id
      and status not in ('complete', 'canceled') and stream_id is distinct from new.stream_id;
  return new;
end;
$$;
drop trigger if exists recurrence_stream_move on public.recurrence_sources;
create trigger recurrence_stream_move after update of stream_id on public.recurrence_sources
  for each row execute function public.move_pending_recurrence_cards();

create or replace function public.guard_stream_closure()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title = 'Uncategorized' and (new.state <> 'in_progress' or new.area <> 'neutral') then
    raise exception 'Uncategorized must remain active and neutral';
  end if;
  if new.state <> 'in_progress' and old.state = 'in_progress' and exists (
    select 1 from public.recurrence_sources s where s.stream_id = new.id and s.user_id = new.user_id
      and public.recurrence_can_generate(s)
  ) then raise exception 'Choose move or stop for every active recurrence before closing this stream'; end if;
  return new;
end;
$$;
drop trigger if exists streams_closure on public.streams;
create trigger streams_closure before update on public.streams for each row execute function public.guard_stream_closure();

create or replace function public.save_card(p_card_id uuid, p_changes jsonb, p_expected_status text)
returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
  source public.recurrence_sources;
  updated public.cards;
  target uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_changes) <> 'object' or p_changes - array['title','notes','stream_id','status','due_at','remind_at','position'] <> '{}'::jsonb then
    raise exception 'Invalid card changes';
  end if;
  perform id from public.streams where user_id = auth.uid() order by id for update;
  select * into card from public.cards where id = p_card_id and user_id = auth.uid();
  if not found then raise exception 'Card not found'; end if;
  if card.recurrence_source_id is not null then
    select * into source from public.recurrence_sources where id = card.recurrence_source_id and user_id = auth.uid() for update;
    if not found then raise exception 'Recurrence source not found'; end if;
  end if;
  select * into card from public.cards where id = p_card_id and user_id = auth.uid() for update;
  if not found then raise exception 'Card not found'; end if;
  if card.status is distinct from p_expected_status then
    raise exception 'This card changed elsewhere. Refresh and try again.';
  end if;
  target := case when p_changes ? 'stream_id' then (p_changes->>'stream_id')::uuid else card.stream_id end;
  if target is null or (target <> card.stream_id and not exists (
    select 1 from public.streams where id = target and user_id = auth.uid() and state = 'in_progress'
  )) then raise exception 'Choose an active stream'; end if;
  update public.cards set
    title = case when p_changes ? 'title' then p_changes->>'title' else title end,
    notes = case when p_changes ? 'notes' then p_changes->>'notes' else notes end,
    stream_id = target,
    status = case when p_changes ? 'status' then p_changes->>'status' else status end,
    due_at = case when p_changes ? 'due_at' then (p_changes->>'due_at')::timestamptz else due_at end,
    remind_at = case when p_changes ? 'remind_at' then (p_changes->>'remind_at')::timestamptz else remind_at end,
    position = case when p_changes ? 'position' then (p_changes->>'position')::integer else position end,
    updated_at = now()
    where id = p_card_id and user_id = auth.uid() returning * into updated;
  if card.recurrence_source_id is not null and p_changes ? 'stream_id' and target is distinct from source.stream_id then
    update public.recurrence_sources set stream_id = target where id = source.id and user_id = auth.uid();
  end if;
  return updated;
end;
$$;

create or replace function public.save_stream(
  p_stream_id uuid, p_title text, p_area text, p_notes text, p_state text, p_recurrences jsonb default '[]'
) returns public.streams language plpgsql security invoker set search_path = '' as $$
declare
  original public.streams;
  source public.recurrence_sources;
  decision jsonb;
  updated public.streams;
  target uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_recurrences) <> 'array' then raise exception 'Invalid recurrence choices'; end if;
  perform id from public.streams where user_id = auth.uid() order by id for update;
  select * into original from public.streams where id = p_stream_id and user_id = auth.uid();
  if not found then raise exception 'Stream not found'; end if;
  if original.title = 'Uncategorized' then raise exception 'Cannot edit the Uncategorized stream'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'A title is required'; end if;
  if p_state <> 'in_progress' then
    for source in select * from public.recurrence_sources
      where stream_id = p_stream_id and user_id = auth.uid() order by id for update
    loop
      if not public.recurrence_can_generate(source) then continue; end if;
      select value into decision from jsonb_array_elements(p_recurrences)
        where value->>'source_id' = source.id::text;
      if decision is null then raise exception 'Choose move or stop for every active recurrence'; end if;
      if decision->>'action' = 'stop' then
        update public.recurrence_sources set stopped_at = now() where id = source.id and user_id = auth.uid();
      elsif decision->>'action' = 'move' then
        target := (decision->>'stream_id')::uuid;
        if target = p_stream_id or not exists (select 1 from public.streams where id = target and user_id = auth.uid() and state = 'in_progress') then
          raise exception 'Choose another active stream for this recurrence';
        end if;
        update public.recurrence_sources set stream_id = target where id = source.id and user_id = auth.uid();
      else raise exception 'Choose move or stop for every active recurrence'; end if;
    end loop;
  end if;
  update public.streams set title = btrim(p_title), area = p_area, notes = p_notes, state = p_state, updated_at = now()
    where id = p_stream_id and user_id = auth.uid() returning * into updated;
  return updated;
end;
$$;

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
      (now() at time zone coalesce(source.recurrence_timezone, 'UTC'))::date then new.status := 'waiting'; end if;
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
        and user_id = auth.uid() and coalesce(recurrence_date,
          (due_at at time zone source.recurrence_timezone)::date) = next_date) then
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


create or replace function public.create_recurring_card(
  p_title text, p_stream_id uuid, p_status text, p_due_at timestamptz,
  p_remind_at timestamptz, p_frequency text, p_interval integer,
  p_weekdays jsonb, p_month_day integer, p_stack_missed boolean, p_timezone text
) returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  source_id uuid;
  card public.cards;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone'; end if;
  if p_frequency not in ('daily','every_n_days','weekly','monthly') or p_frequency is null
    or p_interval is null or p_interval < 1 then raise exception 'Invalid recurrence pattern'; end if;
  if p_weekdays is not null then
    if jsonb_typeof(p_weekdays) <> 'array' then raise exception 'Invalid weekdays'; end if;
    if exists (select 1 from jsonb_array_elements(p_weekdays) value where value::text not in ('0','1','2','3','4','5','6')) then raise exception 'Invalid weekdays'; end if;
  end if;
  if p_month_day is not null and p_month_day <> -1 and p_month_day not between 1 and 31 then raise exception 'Invalid monthly day'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'A title is required'; end if;
  perform id from public.streams where user_id = auth.uid() order by id for update;
  if not exists (select 1 from public.streams where id = p_stream_id and user_id = auth.uid() and state = 'in_progress') then raise exception 'Choose an active stream'; end if;
  insert into public.recurrence_sources (user_id, stream_id, base_title, frequency, interval, weekdays, month_day, stack_missed, recurrence_timezone)
    values (auth.uid(), p_stream_id, btrim(p_title), p_frequency, p_interval, p_weekdays, p_month_day, p_stack_missed, p_timezone)
    returning id into source_id;
  insert into public.cards (user_id, stream_id, title, status, due_at, remind_at, is_recurring, recurrence_source_id, position)
    values (auth.uid(), p_stream_id, btrim(p_title), p_status, p_due_at, p_remind_at, true, source_id, 0)
    returning * into card;
  return card;
end;
$$;

revoke all on function public.recurrences_for_stream(uuid,text) from public;
revoke all on function public.save_card(uuid,jsonb,text) from public;
revoke all on function public.save_stream(uuid,text,text,text,text,jsonb) from public;
revoke all on function public.create_recurring_card(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text) from public;
grant execute on function public.recurrences_for_stream(uuid,text) to authenticated;
grant execute on function public.save_card(uuid,jsonb,text) to authenticated;
grant execute on function public.save_stream(uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function public.create_recurring_card(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text) to authenticated;
commit;
