-- Notification-only preferences: card dates and calendar-day promotion stay intact.
create table if not exists public.reminder_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_reminder_time time not null default '09:00' check (
    default_reminder_time < time '24:00' and extract(second from default_reminder_time) = 0),
  timezone text not null
);
alter table public.reminder_preferences enable row level security;
drop policy if exists own_reminder_preferences on public.reminder_preferences;
create policy own_reminder_preferences on public.reminder_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.reminder_preferences from anon, authenticated;
grant select, insert, update on public.reminder_preferences to authenticated;
grant all on public.reminder_preferences to service_role;

create or replace function public.validate_reminder_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid reminder timezone';
  end if;
  return new;
end;
$$;
drop trigger if exists reminder_preferences_timezone on public.reminder_preferences;
create trigger reminder_preferences_timezone before insert or update on public.reminder_preferences
for each row execute function public.validate_reminder_timezone();

-- Midnight is the existing date-field convention for an omitted time.
-- Recurrences use their pinned timezone; ordinary cards use the account timezone.
-- Adding the local time before converting to an instant respects daylight saving.
create or replace function public.card_push_time(p_card public.cards)
returns timestamptz language sql stable set search_path = '' as $$
  select case when not timezone_known then null
    when local_value::time = time '00:00'
    then (local_value::date + reminder_time) at time zone zone
    else instant end
  from (
    select coalesce(p_card.remind_at, p_card.due_at) as instant,
      coalesce(p_card.remind_at, p_card.due_at) at time zone
        coalesce(r.recurrence_timezone, p.timezone, 'UTC') as local_value,
      coalesce(r.recurrence_timezone, p.timezone, 'UTC') as zone,
      (r.recurrence_timezone is not null or p.timezone is not null) as timezone_known,
      coalesce(p.default_reminder_time, time '09:00') as reminder_time
    from (select 1) seed
    left join public.reminder_preferences p on p.user_id = p_card.user_id
    left join public.recurrence_sources r on r.id = p_card.recurrence_source_id
      and r.user_id = p_card.user_id
  ) times;
$$;
revoke all on function public.card_push_time(public.cards) from public, anon;
grant execute on function public.card_push_time(public.cards) to authenticated, service_role;

-- Keep raw date identity separate from notification time so changing the default
-- reschedules pending delivery without duplicating notifications already sent.
alter table public.push_deliveries add column if not exists original_at timestamptz;
update public.push_deliveries set original_at = scheduled_at where original_at is null;
alter table public.push_deliveries alter column original_at set not null;
create unique index if not exists push_delivery_original_date
  on public.push_deliveries(subscription_id, card_id, original_at);

create or replace function public.claim_push_reminders()
returns table (delivery_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
declare
  account record;
  previous_sub text := current_setting('request.jwt.claim.sub', true);
begin
  -- Reuse the existing locked recurrence generator, impersonating only subscribed
  -- owners inside this service-only transaction. Legacy sources default to UTC.
  for account in
    select s.user_id from public.push_subscriptions s
    group by s.user_id order by min(coalesce(s.last_generation_at, '-infinity'::timestamptz)) limit 100
  loop
    perform set_config('request.jwt.claim.sub', account.user_id::text, true);
    perform public.generate_recurring_instances('UTC');
    update public.push_subscriptions s set last_generation_at = now() where s.user_id = account.user_id;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  -- Re-time unsent notifications when a profile default changes. A sent card's
  -- original date identity remains reserved, preventing a second notification.
  update public.push_deliveries d set scheduled_at = public.card_push_time(c)
  from public.cards c where c.id = d.card_id and d.sent_at is null
    and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    and coalesce(c.remind_at, c.due_at) = d.original_at
    and public.card_push_time(c) is not null
    and public.card_push_time(c) is distinct from d.scheduled_at;

  insert into public.push_deliveries (subscription_id, card_id, scheduled_at, original_at)
  select s.id, c.id, public.card_push_time(c), coalesce(c.remind_at, c.due_at)
  from public.cards c join public.push_subscriptions s on s.user_id = c.user_id
  where c.status not in ('complete', 'canceled')
    and public.card_push_time(c) between greatest(s.enabled_at, now() - interval '24 hours') and now()
    and not exists (select 1 from public.push_deliveries d
      where d.subscription_id = s.id and d.card_id = c.id
        and d.original_at = coalesce(c.remind_at, c.due_at))
  order by public.card_push_time(c)
  limit 1000
  on conflict do nothing;

  return query
  with pending as (
    select d.id from public.push_deliveries d
    join public.cards c on c.id = d.card_id
    where d.sent_at is null and d.attempts < 8
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
      and c.status not in ('complete', 'canceled')
      and coalesce(c.remind_at, c.due_at) = d.original_at
      and public.card_push_time(c) = d.scheduled_at
      and d.scheduled_at between now() - interval '24 hours' and now()
    order by d.scheduled_at limit 100 for update of d skip locked
  ), claimed as (
    update public.push_deliveries d set claimed_at = now(), attempts = attempts + 1
    from pending p where d.id = p.id returning d.id, d.subscription_id
  )
  select d.id, s.id, s.endpoint, s.p256dh, s.auth
  from claimed d join public.push_subscriptions s on s.id = d.subscription_id;
end;
$$;
revoke all on function public.claim_push_reminders() from public, anon, authenticated;
grant execute on function public.claim_push_reminders() to service_role;
