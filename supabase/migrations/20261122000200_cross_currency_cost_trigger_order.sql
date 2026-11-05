-- On UPDATE the pending-cost trigger runs before the wallet trigger, so
-- NEW.currency still describes the old payer. Stage the requested effective
-- cost verbatim; transactions_cashier_wallets derives the locked new payer
-- currency immediately afterward and performs the one correct normalization.
create or replace function cashier_private.apply_pending_transaction_cost() returns trigger
language plpgsql security definer set search_path='' as $$
declare pending_found boolean; requested_currency public.currency;
begin
  select true,p.cost_currency into pending_found,requested_currency
  from cashier_private.pending_transaction_costs p
  where p.transaction_id=new.id and p.user_id=new.user_id;
  if pending_found then new.cost_currency:=requested_currency; end if;
  return new;
end;
$$;
revoke execute on function cashier_private.apply_pending_transaction_cost() from public,anon,authenticated;
