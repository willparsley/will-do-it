-- Plain titles for newly generated occurrences and source title/pattern edits.
-- No existing card data is rewritten by this migration.
begin;

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
    cursor_day := public.recurrence_cursor(original);
    -- A completion/history boundary is not an occurrence to reschedule. Only
    -- transform the horizon when there is a pending slot being moved below.
    if exists (select 1 from public.cards where recurrence_source_id = original.id
      and user_id = auth.uid() and status not in ('complete','canceled')) then
      cursor_day := public.rescheduled_recurrence_date(cursor_day, original, edited);
    end if;
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
        title = edited.base_title,
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

revoke all on function public.generate_recurring_instances(text) from public;
grant execute on function public.generate_recurring_instances(text) to authenticated;
revoke all on function public.save_recurrence(uuid,timestamptz,jsonb,text) from public;
grant execute on function public.save_recurrence(uuid,timestamptz,jsonb,text) to authenticated;
commit;
