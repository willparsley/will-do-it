-- One small account-owned row, changed only on an explicit reorder/reset.
-- NULL retains the alphabetical default. New streams append automatically.
create table public.stream_orders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ordered_ids uuid[],
  revision bigint not null default 0
);
alter table public.stream_orders enable row level security;
create policy "Read own stream order" on public.stream_orders
  for select to authenticated using (user_id = auth.uid());
revoke all on public.stream_orders from anon, authenticated;
grant select on public.stream_orders to authenticated;

create function public.get_stream_order() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('ordered_ids', ordered_ids, 'revision', revision)
  from public.stream_orders where user_id = auth.uid()
$$;

create function public.move_stream(
  p_stream_id uuid default null, p_target_id uuid default null,
  p_after boolean default false, p_reset boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid := auth.uid();
  saved uuid[];
  result_ids uuid[];
  target_index integer;
  result_revision bigint;
  locked_count integer;
begin
  if owner_id is null then raise exception 'Not authenticated'; end if;
  -- Serializes operations for this account. A stale device submits a relative
  -- move, never a full replacement of the other device's ordering.
  insert into public.stream_orders(user_id) values(owner_id) on conflict do nothing;
  select ordered_ids into saved from public.stream_orders where user_id = owner_id for update;
  if p_reset then
    result_ids := null;
  else
    if p_stream_id is null or p_target_id is null or p_after is null
      or p_stream_id = p_target_id then raise exception 'Invalid stream move'; end if;
    perform id from public.streams where user_id = owner_id
      and id in (p_stream_id, p_target_id) and title <> 'Uncategorized'
      order by id for key share;
    get diagnostics locked_count = row_count;
    if locked_count <> 2 then raise exception 'Stream unavailable or pinned'; end if;
    select coalesce(array_agg(id order by array_position(saved, id) nulls last, lower(title) collate "C", id), '{}'::uuid[])
      into result_ids from public.streams
      where user_id = owner_id and title <> 'Uncategorized' and id <> p_stream_id;
    target_index := array_position(result_ids, p_target_id);
    if p_after then target_index := target_index + 1; end if;
    result_ids := coalesce(result_ids[1:target_index-1], '{}'::uuid[])
      || array[p_stream_id] || coalesce(result_ids[target_index:cardinality(result_ids)], '{}'::uuid[]);
  end if;
  update public.stream_orders set ordered_ids = result_ids, revision = revision + 1
    where user_id = owner_id returning revision into result_revision;
  return jsonb_build_object('ordered_ids', result_ids, 'revision', result_revision);
end $$;
revoke all on function public.get_stream_order() from public;
revoke all on function public.move_stream(uuid,uuid,boolean,boolean) from public;
grant execute on function public.get_stream_order() to authenticated;
grant execute on function public.move_stream(uuid,uuid,boolean,boolean) to authenticated;

-- Realtime is optional: focus/visibility refresh also works without it.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.stream_orders;
  end if;
end $$;
