-- Read-only diagnostics. Run each section in the Supabase SQL editor.
-- No endpoints, encryption keys, authorization headers, or card titles are shown.
-- Times are database timestamptz values (normally displayed in UTC).

-- 1. Confirm schema/functions are installed. A missing item needs deployment.
select to_regclass('public.push_subscriptions') as subscriptions,
  to_regclass('public.push_deliveries') as deliveries,
  to_regclass('public.reminder_preferences') as preferences,
  to_regprocedure('public.claim_push_reminders()') as claim_function,
  to_regprocedure('public.card_push_time(public.cards)') as notification_time_function;

-- 2. Confirm the every-minute job is enabled. Requires pg_cron.
-- Do not select job.command: older installations might embed credentials there.
select jobid, jobname, schedule, active from cron.job
where jobname = 'send-card-reminders';
select r.jobid, r.status, r.start_time, r.end_time
from cron.job_run_details r join cron.job j on j.jobid = r.jobid
where j.jobname = 'send-card-reminders'
order by r.start_time desc limit 30;

-- Cron success only means HTTP was queued, not that the function succeeded.
-- 3. Recent HTTP results. Requires pg_net. Match request timing to the cron runs;
-- this table also includes requests made by other jobs. Avoid raw response bodies.
select id, status_code, timed_out, error_msg is not null as transport_error, created
from net._http_response order by created desc limit 30;

-- 4. Subscription health and preferences. Missing timezone prevents ordinary pushes.
-- Generation time should advance while the minute job is running.
select s.user_id, count(*) as devices, min(s.enabled_at) as first_enabled_at,
  max(s.last_generation_at) as last_generation_at,
  p.timezone, p.default_reminder_time
from public.push_subscriptions s
left join public.reminder_preferences p on p.user_id = s.user_id
 group by s.user_id, p.timezone, p.default_reminder_time;

-- 5. Current card eligibility and delivery history per device.
-- Replace NULL with an account UUID to narrow the report. Dates older than 24h
-- are outside catch-up; enabling after the delivery time intentionally skips it.
with scope as (select null::uuid as user_id)
select c.id as card_id, c.user_id, c.status, c.remind_at, c.due_at,
  public.card_push_time(c) as expected_push_at,
  s.id as subscription_id, s.enabled_at,
  d.scheduled_at, d.claimed_at, d.attempts,
  d.sent_at as provider_accepted_at,
  case
    when c.status in ('complete', 'canceled') then 'terminal card: no push'
    when s.id is null then 'no registered device'
    when public.card_push_time(c) is null then 'notification timezone missing'
    when d.sent_at is not null then 'provider accepted; phone display unconfirmed'
    when public.card_push_time(c) < s.enabled_at then 'before device opt-in: skipped'
    when public.card_push_time(c) < now() - interval '24 hours' then 'outside catch-up window'
    when public.card_push_time(c) > now() then 'scheduled in future'
    when d.attempts >= 8 then 'retry limit reached: inspect function logs'
    when d.claimed_at >= now() - interval '5 minutes' then 'claimed; awaiting send or retry'
    when d.id is not null then 'awaiting retry: inspect function logs'
    else 'eligible but not queued: inspect scheduler and function logs'
  end as diagnosis
from public.cards c cross join scope
left join public.push_subscriptions s on s.user_id = c.user_id
left join public.push_deliveries d on d.subscription_id = s.id
  and d.card_id = c.id and d.original_at = coalesce(c.remind_at, c.due_at)
where coalesce(c.remind_at, c.due_at) is not null
  and (scope.user_id is null or scope.user_id = c.user_id)
order by coalesce(c.remind_at, c.due_at) desc, c.id, s.id limit 200;

-- 6. Historical deliveries, including cleared reminders on completed cards.
-- Set title to an exact card title, or card_id to its UUID (leave other NULLs).
-- This joins by card ID, deliberately not by the current reminder/due value.
with scope as (select null::text as title, null::uuid as card_id)
select c.id as card_id, c.status, c.completed_at,
  d.id as delivery_id, d.subscription_id, d.original_at,
  d.scheduled_at, d.claimed_at, d.attempts,
  d.sent_at as provider_accepted_at
from public.cards c cross join scope
left join public.push_deliveries d on d.card_id = c.id
where (scope.title is null or c.title = scope.title)
  and (scope.card_id is null or c.id = scope.card_id)
order by d.scheduled_at desc nulls last, c.completed_at desc nulls last
limit 100;

-- 7. Optional reminder recovery from short-lived completion Undo snapshots.
-- These may already have been pruned by a later action. Do not select whole
-- snapshots: they include notes and other private data. Scope to a card UUID.
with scope as (select null::uuid as card_id)
select u.card_id, u.expires_at, b.value->>'remind_at' as previous_remind_at,
  b.value->>'due_at' as previous_due_at
from public.card_action_undos u cross join scope
cross join lateral jsonb_array_elements(u.before_cards) b(value)
where scope.card_id = u.card_id and b.value->>'id' = u.card_id::text
order by u.expires_at desc limit 10;
