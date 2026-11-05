-- A purchase cost can be denominated independently from the wallet used at
-- the cashier. NULL preserves the historical meaning: cost follows payer.
alter table public.transactions
  add column cost_currency public.currency;

create table cashier_private.pending_transaction_costs (
  transaction_id uuid not null,
  user_id uuid not null,
  cost_currency public.currency,
  primary key (transaction_id,user_id)
);
revoke all on cashier_private.pending_transaction_costs from public,anon,authenticated;

-- Teach the existing itemized row writer that a staged purchase denomination,
-- rather than the payer-wallet denomination, is what an itemized edit locks.
do $rows$
declare definition text;
begin
  select pg_get_functiondef(
    'transaction_private.save_transaction_rows(uuid,integer,jsonb,jsonb)'::regprocedure
  ) into definition;
  definition:=replace(definition,
    'wallet_currency is distinct from parent.currency',
    'coalesce((select pc.cost_currency from cashier_private.pending_transaction_costs pc where pc.transaction_id=p_id and pc.user_id=owner_id),wallet_currency) is distinct from coalesce(parent.cost_currency,parent.currency)');
  execute definition;
end;
$rows$;

-- The aggregate stages the normalized cost before its existing row writer
-- runs. This trigger makes cost and payer changes one parent-row revision.
create function cashier_private.apply_pending_transaction_cost() returns trigger
language plpgsql security definer set search_path='' as $$
declare pending_found boolean; pending_currency public.currency;
begin
  select true,p.cost_currency into pending_found,pending_currency
  from cashier_private.pending_transaction_costs p
  where p.transaction_id=new.id and p.user_id=new.user_id;
  if pending_found then new.cost_currency:=pending_currency; end if;
  return new;
end;
$$;
create trigger transactions_apply_pending_cost
  before insert or update on public.transactions
  for each row execute function cashier_private.apply_pending_transaction_cost();

-- Itemized expenses lock the denomination of the purchase cost, not the
-- denomination of the wallet that happened to pay it.
create or replace function public.transactions_breakdown_currency_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.expense_items i
    where i.transaction_id=old.id and i.user_id=old.user_id)
    and coalesce(new.cost_currency,new.currency)
      is distinct from coalesce(old.cost_currency,old.currency) then
    raise exception using errcode='BT002',message='breakdown currency locked';
  end if;
  return new;
end;
$$;

-- Cost-denomination edits are financial edits: all involved wallets must be
-- active just as they must be for amount, payer, tender, and change edits.
create or replace function public.transactions_cashier_wallets() returns trigger
language plpgsql set search_path='' as $$
declare payer public.wallets; ids uuid[]; require_active boolean;
begin
  if new.change_wallet_id is not null or new.change_minor is not null or new.change_currency is not null
     or new.change_rate_base is not null or new.change_rate_quote is not null
     or new.change_rate_numerator is not null or new.change_rate_denominator is not null then
    raise exception 'invalid settlement';
  end if;
  ids:=array[new.wallet_id,new.to_wallet_id]||coalesce(new.change_wallet_ids,'{}'::uuid[]);
  if tg_op='UPDATE' then ids:=ids||array[old.wallet_id,old.to_wallet_id]||coalesce(old.change_wallet_ids,'{}'::uuid[]); end if;
  perform w.id from public.wallets w where w.id=any(ids) order by w.id for update;
  select w.* into payer from public.wallets w where w.id=new.wallet_id and w.user_id=new.user_id;
  if not found then raise exception 'wallet unavailable'; end if;
  new.currency:=payer.currency;
  if new.cost_currency=new.currency then new.cost_currency:=null; end if;
  require_active:=tg_op='INSERT';
  if tg_op='UPDATE' then
    require_active:=(old.deleted_at is not null and new.deleted_at is null)
      or row(new.wallet_id,new.amount_minor,new.tender_minor,new.change_wallet_ids,
             coalesce(new.cost_currency,new.currency))
         is distinct from row(old.wallet_id,old.amount_minor,old.tender_minor,old.change_wallet_ids,
             coalesce(old.cost_currency,old.currency));
  end if;
  if require_active and payer.archived_at is not null then raise exception 'wallet unavailable'; end if;
  if exists(select 1 from unnest(new.change_wallet_ids) x(id) where not exists(
      select 1 from public.wallets w where w.id=x.id and w.user_id=new.user_id
        and (not require_active or w.archived_at is null))) then
    raise exception 'wallet unavailable';
  end if;
  return new;
end;
$$;

-- Same-currency cashier events still reconcile exactly. When the purchase
-- cost is in another currency, tender and returned cash are recorded facts;
-- no exchange rate or derived purchase amount is invented.
create or replace function public.transactions_cashier_check() returns trigger
language plpgsql security definer set search_path='' as $$
declare tx_id uuid; owner_id uuid; t public.transactions; change_count bigint; same_total numeric;
  has_cross boolean; wallet_ids uuid[]; min_position integer; max_position integer;
  c public.cashier_changes; effective_cost public.currency;
begin
  if tg_table_name='transactions' then tx_id:=new.id; owner_id:=new.user_id;
  elsif tg_op='DELETE' then tx_id:=old.transaction_id; owner_id:=old.user_id;
  else tx_id:=new.transaction_id; owner_id:=new.user_id; end if;
  select x.* into t from public.transactions x where x.id=tx_id and x.user_id=owner_id;
  if not found then return null; end if;
  effective_cost:=coalesce(t.cost_currency,t.currency);
  select count(*),coalesce(sum(case when x.currency=t.currency then x.amount_minor else 0 end),0),
    coalesce(bool_or(x.currency<>t.currency),false),
    coalesce(array_agg(x.wallet_id order by x.position),'{}'::uuid[]),min(x.position),max(x.position)
    into change_count,same_total,has_cross,wallet_ids,min_position,max_position
  from public.cashier_changes x where x.transaction_id=tx_id and x.user_id=owner_id;
  if t.change_wallet_ids is distinct from wallet_ids
     or (change_count>0 and (min_position<>0 or max_position<>change_count-1)) then raise exception 'invalid settlement'; end if;
  if t.change_wallet_id is not null or t.change_minor is not null or t.change_currency is not null
     or t.change_rate_base is not null or t.change_rate_quote is not null
     or t.change_rate_numerator is not null or t.change_rate_denominator is not null then raise exception 'invalid settlement'; end if;
  if t.tender_minor is null then
    if change_count<>0 or effective_cost<>t.currency then raise exception 'invalid settlement'; end if;
    return null;
  end if;
  if t.kind::text<>'expense' or t.source is not null or t.installment_id is not null then raise exception 'invalid settlement'; end if;
  for c in select * from public.cashier_changes x where x.transaction_id=tx_id and x.user_id=owner_id loop
    if c.currency=t.currency and c.rate_base is not null then raise exception 'invalid settlement rate'; end if;
    if c.currency<>t.currency and c.rate_base is not null then
      perform public.cashier_convert_minor(c.amount_minor,c.currency,t.currency,
        c.rate_base,c.rate_quote,c.rate_numerator,c.rate_denominator);
    end if;
  end loop;
  if effective_cost<>t.currency then return null; end if;
  if has_cross then
    if t.tender_minor-same_total<=t.amount_minor then raise exception 'settlement mismatch'; end if;
  elsif t.tender_minor-same_total<>t.amount_minor then raise exception 'settlement mismatch'; end if;
  return null;
end;
$$;

-- Keep the public five-argument RPC unchanged. The former implementation is
-- retained privately and receives the strict legacy payload after this layer
-- validates and removes only costCurrency.
do $clone$
declare definition text;
begin
  select pg_get_functiondef(
    'cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb)'::regprocedure
  ) into definition;
  definition:=replace(definition,
    'cashier_private.save_transaction_aggregate(',
    'cashier_private.save_transaction_aggregate_without_cost_currency(');
  definition:=replace(definition,'AS $function$','AS $function$'||E'\n#variable_conflict use_variable');
  execute definition;
end;
$clone$;

create or replace function cashier_private.save_transaction_aggregate(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,p_settlement jsonb default null
) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); existing public.transactions; payer_currency public.currency;
  requested_cost public.currency; normalized_cost public.currency; stripped_input jsonb;
  result record; explicit_cost boolean; replay boolean; effective_existing public.currency;
begin
  if owner_id is null or p_id is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  explicit_cost:=p_input ? 'costCurrency';
  if explicit_cost and jsonb_typeof(p_input->'costCurrency') is distinct from 'string' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  begin
    if explicit_cost then requested_cost:=(p_input->>'costCurrency')::public.currency; end if;
    perform (p_input->>'walletId')::uuid;
  exception when others then
    raise exception using errcode='22023',message='invalid transaction input';
  end;
  select w.currency into payer_currency from public.wallets w
  where w.id=(p_input->>'walletId')::uuid and w.user_id=owner_id;
  if not found then raise exception 'wallet unavailable'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select t.* into existing from public.transactions t where t.id=p_id and t.user_id=owner_id for update;
  replay:=found and p_expected_revision is null;
  if found then effective_existing:=coalesce(existing.cost_currency,existing.currency); end if;
  if not explicit_cost then
    requested_cost:=case when found then effective_existing else payer_currency end;
  end if;
  normalized_cost:=case when requested_cost=payer_currency then null else requested_cost end;
  if replay and requested_cost is distinct from effective_existing then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  if found and p_expected_revision is not null
     and requested_cost is distinct from effective_existing
     and exists(select 1 from public.wallets w
       where w.user_id=owner_id and w.archived_at is not null
         and w.id=any(array[existing.wallet_id]||coalesce(existing.change_wallet_ids,'{}'::uuid[]))) then
    raise exception 'wallet unavailable';
  end if;

  insert into cashier_private.pending_transaction_costs(transaction_id,user_id,cost_currency)
    values(p_id,owner_id,normalized_cost)
    on conflict(transaction_id,user_id) do update set cost_currency=excluded.cost_currency;
  stripped_input:=p_input-'costCurrency';
  begin
    select * into result from cashier_private.save_transaction_aggregate_without_cost_currency(
      p_id,p_expected_revision,stripped_input,p_items,p_settlement);
  exception when others then
    delete from cashier_private.pending_transaction_costs where transaction_id=p_id and user_id=owner_id;
    raise;
  end;
  delete from cashier_private.pending_transaction_costs where transaction_id=p_id and user_id=owner_id;
  return query select result.id,result.revision;
end;
$$;

-- Purchase reporting follows the cashier's stated cost; wallet balances keep
-- following the independently recorded tender and returned-cash legs.
create or replace view public.reporting_entries with(security_invoker=true) as
select t.id as transaction_id,t.user_id,t.occurred_on,coalesce(t.cost_currency,t.currency) as currency,
  t.category_id,t.kind::text as kind,t.amount_minor
from public.transactions t where t.deleted_at is null and t.kind::text in ('expense','income')
union all
select t.id,t.user_id,t.occurred_on,t.currency,t.category_id,
  case when t.loan_flow='out' then 'expense' else 'income' end,t.loan_fee_minor
from public.transactions t where t.deleted_at is null and t.kind::text='loan'
  and t.loan_event='repayment' and t.loan_fee_minor>0;

revoke execute on function cashier_private.apply_pending_transaction_cost() from public,anon,authenticated;
revoke execute on function cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
revoke execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb)
  to authenticated;
