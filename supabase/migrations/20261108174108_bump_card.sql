-- Occurrence-only deferral. Keep schedule slots and generation cursors intact.
begin;
create or replace function public.bump_card(
  p_card_id uuid, p_expected_updated_at timestamptz, p_amount integer,
  p_unit text, p_timezone text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
  tz text;
  today date;
  old_due timestamp;
  new_due timestamp;
  new_reminder timestamp;
  shift_days integer;
  target_status text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 3650
    or p_unit is null or p_unit not in ('days', 'weeks', 'months') then
    raise exception 'Choose 1–3650 days, weeks, or months';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  -- Match save_card_with_undo lock order before reading the dates we will change.
  perform id from public.streams where user_id = auth.uid() order by id for update;
  perform id from public.recurrence_sources where user_id = auth.uid() order by id for update;
  select * into card from public.cards where id = p_card_id and user_id = auth.uid() for update;
  if not found then raise exception 'Card not found'; end if;
  if card.updated_at is distinct from p_expected_updated_at then
    raise exception 'This card changed elsewhere. Close and try again.';
  end if;
  if card.status in ('complete', 'canceled') or card.due_at is null then
    raise exception 'Choose an unfinished card with a due date';
  end if;
  -- Legacy sources may not have a persisted calendar boundary yet. Establish
  -- their normal generation horizon from the original due date before deferring.
  if exists (select 1 from public.recurrence_sources where id = card.recurrence_source_id
    and user_id = auth.uid() and generated_through is null) then
    perform public.generate_recurring_instances(p_timezone);
  end if;
  select recurrence_timezone into tz from public.recurrence_sources
    where id = card.recurrence_source_id and user_id = auth.uid();
  tz := coalesce(tz, p_timezone);
  today := (now() at time zone tz)::date;
  old_due := card.due_at at time zone tz;
  new_due := greatest(old_due::date, today) + old_due::time;
  -- Timestamp calendar arithmetic preserves wall time across DST and clamps months.
  new_due := new_due + case p_unit
    when 'days' then make_interval(days => p_amount)
    when 'weeks' then make_interval(days => p_amount * 7)
    else make_interval(months => p_amount) end;
  shift_days := new_due::date - old_due::date;
  if card.remind_at is not null then
    new_reminder := (card.remind_at at time zone tz) + make_interval(days => shift_days);
    -- An old early reminder must not immediately re-promote a deferred card.
    if new_reminder::date <= today then new_reminder := new_due; end if;
  end if;
  target_status := case when card.status = 'priority_backlog' or card.auto_promoted_from = 'priority_backlog'
    then 'priority_backlog' else 'backlog' end;
  return public.save_card_with_undo(card.id, jsonb_build_object(
    'due_at', new_due at time zone tz,
    'remind_at', new_reminder at time zone tz,
    'status', target_status
  ), card.status, p_timezone);
end;
$$;
revoke all on function public.bump_card(uuid, timestamptz, integer, text, text) from public, anon;
grant execute on function public.bump_card(uuid, timestamptz, integer, text, text) to authenticated;
commit;
