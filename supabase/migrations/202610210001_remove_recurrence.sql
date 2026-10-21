-- Explicitly removing recurrence retains cards and terminal history.
create or replace function public.guard_recurring_card_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  source public.recurrence_sources;
begin
  if TG_OP = 'UPDATE' then
    if old.recurrence_source_id is not null
       and old.status not in ('complete', 'canceled')
       and new.status = old.status
       and new.recurrence_source_id is null and new.recurrence_date is null
       and new.recurrence_revision = old.recurrence_revision and new.scheduled_date is null
       and not new.is_recurring
       and exists (select 1 from public.recurrence_sources
         where id = old.recurrence_source_id and user_id = auth.uid()
           and user_id = new.user_id and stopped_at is not null) then
      return new;
    end if;
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

-- Save removal and occurrence edits together; a failed save rolls everything back.
create or replace function public.save_card_without_recurrence(
  p_card_id uuid, p_changes jsonb, p_expected_status text, p_expected_source_id uuid
) returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform id from public.streams where user_id = auth.uid() order by id for update;
  perform id from public.recurrence_sources
    where id = p_expected_source_id and user_id = auth.uid() for update;
  if not found then raise exception 'Recurrence source not found'; end if;
  perform id from public.cards
    where recurrence_source_id = p_expected_source_id and user_id = auth.uid() order by id for update;
  select * into card from public.cards where id = p_card_id and user_id = auth.uid();
  if not found then raise exception 'Card not found'; end if;
  if card.status is distinct from p_expected_status
     or card.recurrence_source_id is distinct from p_expected_source_id then
    raise exception 'This card changed elsewhere. Refresh and try again.';
  end if;
  if card.status in ('complete', 'canceled') then
    raise exception 'Remove recurrence from a pending card to preserve completed history';
  end if;
  update public.recurrence_sources set stopped_at = coalesce(stopped_at, now()), updated_at = now()
    where id = p_expected_source_id and user_id = auth.uid();
  update public.cards set is_recurring = false, recurrence_source_id = null,
    recurrence_date = null, scheduled_date = null, updated_at = now()
    where recurrence_source_id = p_expected_source_id and user_id = auth.uid()
      and status not in ('complete', 'canceled');
  return public.save_card(p_card_id, p_changes, p_expected_status);
end;
$$;
revoke all on function public.save_card_without_recurrence(uuid,jsonb,text,uuid) from public;
grant execute on function public.save_card_without_recurrence(uuid,jsonb,text,uuid) to authenticated;
