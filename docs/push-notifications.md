# Push reminder setup

The app implementation needs the database migration, Edge Function, VAPID keys,
and scheduler below before notifications can deliver. Nothing here is deployed
by a Vercel Git deployment alone. Existing visual/day-based promotion is unchanged.

## Behavior

- Profile → Push notifications → Enable on this device. Permission is requested
  only after tapping. HTTPS is required (localhost also works for testing).
- Each subscribed device receives one notification at `remind_at`, or `due_at`
  when no reminder exists. An explicit reminder replaces the due notification.
- Explicit times keep their exact stored instants; the scheduler checks every minute.
  Date-only values remain stored at midnight for generation and promotion, but
  push delivery defaults to **9:00 AM**. Profile → Reminder preferences changes
  the default across devices. Ordinary cards use the saved profile timezone;
  recurring cards use the source's pinned timezone. DST is handled on the date
  being notified. Midnight retains the date picker's existing "no time" meaning.
- Profile initializes the account timezone from the first device, preserving it
  on other devices; it is displayed beside the profile time setting.
  Existing subscriptions must open Profile once after this upgrade; ordinary
  pushes are withheld until the timezone is known, avoiding midnight guesses.
- Changing the default reschedules unsent notifications but does not send a card
  again if its current reminder/due date has already been delivered.
- All unfinished statuses can notify, including Waiting and In Progress.
  Complete/Canceled cards and removed/rescheduled reminders are excluded at claim.
- Enabling skips dates before opt-in. Outages catch up at most 24 hours.
- Generic notification text keeps titles off lock screens. Tapping opens `/`.
- Logout revokes the browser subscription; each device opts in separately.
- The service-only claim RPC generates subscribed accounts' recurring cards using
  the existing row-locked generator. Existing source timezones are respected;
  legacy sources without a pinned timezone get UTC. Current recurrence generation
  creates future occurrences at midnight; their push notifications use the
  profile default. Per-source custom reminder times remain future work.
- Delivery is at least once: a process failure after the provider accepts a push
  may retry it. Stable notification tags replace duplicates still on screen.
  Transport failures retry after five minutes, up to eight attempts. Expired
  endpoints (404/410) are removed. Devices/OS/network can delay or suppress delivery.
- Batches generate up to 100 subscribed accounts (least recently processed first),
  enqueue 1000 deliveries and send 100 per tick. This is intended for this personal
  app; monitor throughput if many devices/accounts are added.

## Deployment

1. Apply `supabase/migrations/202610190001_push_reminders.sql`, then
   `supabase/migrations/202610190002_default_reminder_time.sql` after earlier migrations.
2. Generate a VAPID key pair once, e.g. `npx web-push generate-vapid-keys`.
   Keep the private key server-side. Retain the pair across deployments; changing
   it requires devices to disable and re-enable notifications.
3. Set Vercel `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the public key and rebuild.
4. Set Supabase Edge Function secrets using the dashboard or `supabase secrets set`:
   `VAPID_PUBLIC_KEY` (same public key), `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (a real `mailto:` contact or HTTPS URL), and
   `PUSH_CRON_SECRET` (a long random secret). Supabase supplies `SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY`; never expose the service key to the browser.
5. Deploy `supabase functions deploy send-reminders --no-verify-jwt`.
   This endpoint performs its own bearer-secret check. Do not remove that check.
6. Enable Supabase Cron (`pg_cron`), `pg_net`, and Vault in the dashboard.
   Create Vault secrets named `push_function_url` (the full URL, such as
   `https://PROJECT.supabase.co/functions/v1/send-reminders`) and
   `push_cron_secret` (the same `PUSH_CRON_SECRET`). Then run:

```sql
select cron.schedule('send-card-reminders', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
```

Check Cron run history, `net._http_response`, and Edge Function logs for successful
responses. Sent/failed counts are returned without private subscription details.
For retention, schedule `delete from public.push_deliveries where scheduled_at <
now() - interval '7 days'` daily. No card history is deleted.

## Validation

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
Check the Edge Function separately with `deno check --node-modules-dir=none supabase/functions/send-reminders/index.ts`.
On a deployed HTTPS build, save a default reminder time on Profile and verify
a date-only reminder waits until that time (including a recurrence and a DST date).
Then enable push on Profile, create an ordinary card with
an explicit reminder two minutes ahead, close the app, and verify it arrives
no earlier than that instant. Repeat with a due time and no reminder, then with
completion, rescheduling, disable, logout, multiple devices, and account switching.
On iPhone/iPad use iOS/iPadOS 16.4+ and launch the Home Screen installation first.
An already-open app may need all windows closed once to activate the new worker.

References: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Next.js Web Push](https://nextjs.org/docs/app/guides/progressive-web-apps),
[Apple Home Screen push](https://webkit.org/blog/13878/).
