-- Keep payment ordering facts in the initial list without downloading all events.
-- These facts also govern Cancel/Void/Restore when only one history page is visible.
create view public.loan_overview with (security_invoker=true) as
select l.*,p.live_payment_count,p.latest_payment_on,
  latest.id as latest_payment_id,latest.revision as latest_payment_revision,
  latest.loan_event_seq as latest_payment_sequence
from public.loan_progress l
left join lateral (
  select count(*) as live_payment_count,max(t.occurred_on) as latest_payment_on
  from public.transactions t
  where t.loan_id=l.id and t.loan_event='repayment' and t.deleted_at is null
) p on true
left join lateral (
  select t.id,t.revision,t.loan_event_seq from public.transactions t
  where t.loan_id=l.id and t.loan_event='repayment' and t.deleted_at is null
  order by t.loan_event_seq desc limit 1
) latest on true;
grant select on public.loan_overview to authenticated;
