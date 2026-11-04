-- Cashier columns are guaranteed by the earlier migrations. Typed predicates
-- allow the existing wallet-role indexes to serve these correlated aggregates.
-- Preserve the security-invoker contract and the exact existing balance formula.
create or replace view public.wallet_balances with (security_invoker=true) as
select w.id as wallet_id, w.user_id, w.opening_balance_minor
  + coalesce((select sum(case
      when t.kind::text='income' then t.amount_minor
      when t.kind::text='loan' and t.loan_flow='in' then t.amount_minor
      when t.kind::text='expense' then -coalesce(t.tender_minor,t.amount_minor)
      else -t.amount_minor end)
    from public.transactions t where t.wallet_id=w.id and t.deleted_at is null),0)
  + coalesce((select sum(t.to_amount_minor) from public.transactions t
    where t.to_wallet_id=w.id and t.kind::text='transfer' and t.deleted_at is null),0)
  + coalesce((select sum(t.change_minor) from public.transactions t
    where t.change_wallet_id=w.id and t.kind::text='expense' and t.deleted_at is null),0) as balance_minor
from public.wallets w;
