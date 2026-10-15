begin;

-- Keep links within the same account, including writes outside the UI.
alter table public.cards add column if not exists prerequisite_card_id uuid;
create unique index if not exists cards_id_user_id_key on public.cards(id, user_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cards_prerequisite_owner_fkey' and conrelid = 'public.cards'::regclass) then
    alter table public.cards add constraint cards_prerequisite_owner_fkey
      foreign key (prerequisite_card_id, user_id) references public.cards(id, user_id) on delete restrict;
  end if;
end $$;
create index if not exists cards_prerequisite_idx on public.cards(prerequisite_card_id) where prerequisite_card_id is not null;

create or replace function public.guard_card_prerequisite()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.prerequisite_card_id is null then return new; end if;
  -- Match the workspace lock order used by save_card, serializing link changes.
  perform id from public.streams where user_id = new.user_id order by id for update;
  if not exists (select 1 from public.cards where id = new.prerequisite_card_id and user_id = new.user_id) then
    raise exception 'Choose one of your cards as the prerequisite';
  end if;
  if new.prerequisite_card_id = new.id or exists (
    with recursive chain as (
      select id, prerequisite_card_id from public.cards where id = new.prerequisite_card_id and user_id = new.user_id
      union
      select c.id, c.prerequisite_card_id from public.cards c join chain on c.id = chain.prerequisite_card_id where c.user_id = new.user_id
    ) select 1 from chain where id = new.id
  ) then raise exception 'Prerequisites cannot form a cycle'; end if;
  return new;
end;
$$;
drop trigger if exists cards_guard_prerequisite on public.cards;
create trigger cards_guard_prerequisite before insert or update of prerequisite_card_id, user_id on public.cards
  for each row execute function public.guard_card_prerequisite();

create or replace function public.save_card(p_card_id uuid, p_changes jsonb, p_expected_status text)
returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
  source public.recurrence_sources;
  updated public.cards;
  target uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_changes) <> 'object' or p_changes - array['title','notes','stream_id','status','due_at','remind_at','position','prerequisite_card_id'] <> '{}'::jsonb then
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
    prerequisite_card_id = case when p_changes ? 'prerequisite_card_id' then (p_changes->>'prerequisite_card_id')::uuid else prerequisite_card_id end,
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

create or replace function public.create_recurring_card_with_prerequisite(
  p_title text, p_stream_id uuid, p_status text, p_due_at timestamptz,
  p_remind_at timestamptz, p_frequency text, p_interval integer,
  p_weekdays jsonb, p_month_day integer, p_stack_missed boolean, p_timezone text,
  p_notes text, p_prerequisite_card_id uuid
) returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
begin
  card := public.create_recurring_card(p_title, p_stream_id, p_status, p_due_at,
    p_remind_at, p_frequency, p_interval, p_weekdays, p_month_day, p_stack_missed, p_timezone);
  update public.cards set notes = nullif(btrim(p_notes), ''), prerequisite_card_id = p_prerequisite_card_id
    where id = card.id and user_id = auth.uid() returning * into card;
  return card;
end;
$$;
revoke all on function public.create_recurring_card_with_prerequisite(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text,text,uuid) from public;
grant execute on function public.create_recurring_card_with_prerequisite(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text,text,uuid) to authenticated;

create or replace function public.undo_card_action(p_undo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  action public.card_action_undos;
  current_cards jsonb;
  current_source jsonb;
  saved public.cards;
  saved_source public.recurrence_sources;
begin
  if owner_id is null then raise exception 'Not authenticated'; end if;
  perform id from public.streams where user_id = owner_id order by id for update;
  select * into action from public.card_action_undos where id = p_undo_id and user_id = owner_id for update;
  if not found or action.expires_at < now() then raise exception 'Undo is no longer available'; end if;
  perform id from public.recurrence_sources where id = action.source_id and user_id = owner_id for update;
  perform id from public.cards where user_id = owner_id
    and (id = action.card_id or recurrence_source_id = action.source_id) order by id for update;
  select to_jsonb(s) - 'updated_at' into current_source from public.recurrence_sources s
    where id = action.source_id and user_id = owner_id;
  select jsonb_agg(to_jsonb(c) - 'updated_at' order by c.id) into current_cards
    from public.cards c where user_id = owner_id and (id = action.card_id or recurrence_source_id = action.source_id);
  if current_cards is distinct from action.after_cards or current_source is distinct from action.after_source then
    raise exception 'This card or recurrence changed since then. Undo is no longer available.';
  end if;
  -- Check original destinations before any changes, including pending siblings.
  if exists (select 1 from jsonb_populate_recordset(null::public.cards, action.before_cards) c
    left join public.streams s on s.id = c.stream_id and s.user_id = owner_id
    where s.id is null or (s.state <> 'in_progress' and c.status not in ('complete','canceled')
      and exists (select 1 from public.cards live where live.id = c.id and
        (live.stream_id <> c.stream_id or live.status in ('complete','canceled'))))) then
    raise exception 'The original stream is no longer active. Reopen it before undoing.';
  end if;
  -- Only remove untouched instances created by this action, never old history.
  delete from public.cards c where user_id = owner_id
    and (id = action.card_id or recurrence_source_id = action.source_id)
    and not exists (select 1 from jsonb_array_elements(action.before_cards) b where (b->>'id')::uuid = c.id);

  if action.source_id is not null then
    saved_source := jsonb_populate_record(null::public.recurrence_sources, action.before_source);
    update public.recurrence_sources set stream_id = saved_source.stream_id,
      generated_through = saved_source.generated_through,
      last_completed_at = saved_source.last_completed_at,
      recurrence_timezone = saved_source.recurrence_timezone
      where id = action.source_id and user_id = owner_id;
  end if;
  for saved in select * from jsonb_populate_recordset(null::public.cards, action.before_cards)
  loop
    -- Do not fire completion/reopening triggers on unchanged historical siblings.
    if exists (select 1 from public.cards c where c.id = saved.id and
      to_jsonb(c) - 'updated_at' is distinct from to_jsonb(saved) - 'updated_at') then
      update public.cards set stream_id = saved.stream_id, status = saved.status,
        title = saved.title, notes = saved.notes, due_at = saved.due_at,
        prerequisite_card_id = saved.prerequisite_card_id,
        remind_at = saved.remind_at, position = saved.position, updated_at = clock_timestamp()
        where id = saved.id and user_id = owner_id;
      -- Restore metadata after status triggers have run.
      update public.cards set completed_at = saved.completed_at, remind_at = saved.remind_at,
        auto_promoted_from = saved.auto_promoted_from
        where id = saved.id and user_id = owner_id;
    end if;
  end loop;
  -- Completion triggers may have touched the source while restoring statuses.
  if action.source_id is not null then
    update public.recurrence_sources set last_completed_at = saved_source.last_completed_at
      where id = action.source_id and user_id = owner_id;
  end if;
  delete from public.card_action_undos where id = action.id and user_id = owner_id;
end;
$$;

commit;
