begin;

-- Retain the original RPC for older clients. Both calls run in one transaction.
create or replace function public.create_recurring_card_with_notes(
  p_title text, p_stream_id uuid, p_status text, p_due_at timestamptz,
  p_remind_at timestamptz, p_frequency text, p_interval integer,
  p_weekdays jsonb, p_month_day integer, p_stack_missed boolean, p_timezone text,
  p_notes text
) returns public.cards language plpgsql security invoker set search_path = '' as $$
declare
  card public.cards;
begin
  card := public.create_recurring_card(p_title, p_stream_id, p_status, p_due_at,
    p_remind_at, p_frequency, p_interval, p_weekdays, p_month_day, p_stack_missed, p_timezone);
  update public.cards set notes = nullif(btrim(p_notes), '')
    where id = card.id and user_id = auth.uid() returning * into card;
  return card;
end;
$$;
revoke all on function public.create_recurring_card_with_notes(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text,text) from public;
grant execute on function public.create_recurring_card_with_notes(text,uuid,text,timestamptz,timestamptz,text,integer,jsonb,integer,boolean,text,text) to authenticated;

commit;
