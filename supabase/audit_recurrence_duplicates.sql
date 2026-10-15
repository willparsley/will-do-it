-- Read-only. Run as the affected user or in the Supabase SQL editor.
-- Non-stacking sources with multiple pending cards (no cards are modified).
select s.id as recurrence_source_id, s.base_title, s.stack_missed,
  jsonb_agg(jsonb_build_object(
    'id', c.id, 'title', c.title, 'status', c.status,
    'due_at', c.due_at, 'created_at', c.created_at
  ) order by c.created_at) as pending_cards
from public.recurrence_sources s
join public.cards c on c.recurrence_source_id = s.id and c.user_id = s.user_id
where not coalesce(s.stack_missed, false) and c.status not in ('complete', 'canceled')
group by s.id
having count(*) > 1;

-- Repeated scheduled dates, including legacy cards without occurrence keys.
-- Before a source's timezone is pinned, UTC is only an audit approximation.
select s.id as recurrence_source_id, s.base_title,
  coalesce(c.recurrence_date,
    (c.due_at at time zone coalesce(s.recurrence_timezone, 'UTC'))::date) as scheduled_date,
  jsonb_agg(jsonb_build_object(
    'id', c.id, 'status', c.status, 'due_at', c.due_at,
    'completed_at', c.completed_at, 'created_at', c.created_at
  ) order by c.created_at) as cards
from public.recurrence_sources s
join public.cards c on c.recurrence_source_id = s.id and c.user_id = s.user_id
where c.recurrence_date is not null or c.due_at is not null
group by s.id, scheduled_date
having count(*) > 1;
