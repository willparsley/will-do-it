-- Browser subscriptions are private and bound to the signed-in account.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) < 2048 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)/'),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 20 and 30),
  enabled_at timestamptz not null default now(),
  last_generation_at timestamptz
);
alter table public.push_subscriptions enable row level security;
drop policy if exists own_push_subscriptions on public.push_subscriptions;
create policy own_push_subscriptions on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
revoke update on public.push_subscriptions from authenticated;

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  scheduled_at timestamptz not null,
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  unique (subscription_id, card_id, scheduled_at)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
grant all on public.push_deliveries to service_role;
create index if not exists push_deliveries_pending on public.push_deliveries(claimed_at) where sent_at is null;
create index if not exists cards_push_time on public.cards((coalesce(remind_at, due_at)))
  where status not in ('complete', 'canceled');

-- Service-only, bounded queue. The explicit reminder replaces the due notification.
-- No old-card flood when enabling a device; allow up to 24h outage recovery.
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
  insert into public.push_deliveries (subscription_id, card_id, scheduled_at)
  select s.id, c.id, coalesce(c.remind_at, c.due_at)
  from public.cards c join public.push_subscriptions s on s.user_id = c.user_id
  where c.status not in ('complete', 'canceled')
    and coalesce(c.remind_at, c.due_at) between greatest(s.enabled_at, now() - interval '24 hours') and now()
    and not exists (select 1 from public.push_deliveries d
      where d.subscription_id = s.id and d.card_id = c.id
        and d.scheduled_at = coalesce(c.remind_at, c.due_at))
  order by coalesce(c.remind_at, c.due_at)
  limit 1000
  on conflict do nothing;

  return query
  with pending as (
    select d.id from public.push_deliveries d
    join public.cards c on c.id = d.card_id
    where d.sent_at is null and d.attempts < 8
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
      and c.status not in ('complete', 'canceled')
      and coalesce(c.remind_at, c.due_at) = d.scheduled_at
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
