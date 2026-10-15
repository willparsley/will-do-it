-- Apply after 202610140003. Ordinary and recurring backlog cards now both
-- catch up when either their due day or reminder day is today or earlier.
-- No rows are changed by this migration; processing runs on the next refresh.
begin;

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
  update public.cards c set status = 'waiting'
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

revoke all on function public.promote_due_cards(text) from public;
grant execute on function public.promote_due_cards(text) to authenticated;
commit;
