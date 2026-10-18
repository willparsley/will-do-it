-- Apply before deploying the UI without Review. Old clients attempting to
-- write Review will receive a constraint error and must refresh.
begin;

lock table public.cards in share row exclusive mode;

-- These private, short-lived snapshots cannot restore a retired status.
delete from public.card_action_undos
where before_cards @> '[{"status":"review"}]'::jsonb
   or after_cards @> '[{"status":"review"}]'::jsonb;

update public.cards set status = 'in_progress' where status = 'review';

alter table public.cards drop constraint if exists cards_status_check;
alter table public.cards add constraint cards_status_check check (status in (
  'backlog', 'priority_backlog', 'research', 'waiting', 'in_progress', 'complete', 'canceled'
));

commit;
