-- One cash purchase can be paid with several amounts at once (for example
-- 3 USD and 1,300,000 LBP for a 10 USD item). The first tender stays where it
-- has always been: transactions.balance_id + transactions.tender_minor. Every
-- additional tender is one more row of the existing cashier leg collection,
-- marked leg='tender', so the mature projections, locks and guards that
-- already cover cashier_changes and change_balance_ids (activity filter,
-- monetary guard, currency intent, name snapshots, restore checks, wallet and
-- currency blockers) apply to it unchanged.
--
-- Data-preserving: no row is rewritten. Every historical leg is returned
-- change (the default), and a historical single tender is the one tender line
-- it has always been.
alter table public.cashier_changes
  add column leg text not null default 'change' check (leg in ('change','tender'));
alter table public.cashier_changes
  add constraint cashier_changes_tender_rate_shape check (leg='change' or rate_base is null);

-- A leg never changes direction; the aggregate replaces rows instead.
create function public.cashier_changes_leg_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.leg is distinct from old.leg then raise exception 'invalid settlement'; end if;
  return new;
end;
$$;
create trigger cashier_changes_leg_guard before update on public.cashier_changes
  for each row execute function public.cashier_changes_leg_guard();
revoke execute on function public.cashier_changes_leg_guard() from public,anon,authenticated;

-- Final-state validation. Amounts in different currencies are never added,
-- compared or converted: only the legs denominated in the purchase cost
-- currency reconcile, and only as far as the facts allow.
--   every leg in the cost currency          -> paid - returned = cost
--   some change in another currency         -> paid - returned > cost
--   some tender in another currency         -> paid - returned < cost
--   other currencies on both sides          -> recorded facts, nothing to check
create or replace function public.transactions_cashier_check() returns trigger
language plpgsql security definer set search_path='' as $$
declare tx_id uuid; owner_id uuid; t public.transactions; leg_count bigint;
  balance_ids uuid[]; min_position integer; max_position integer;
  c public.cashier_changes; effective_cost text;
  tender_same numeric; change_same numeric; tender_cross boolean; change_cross boolean;
begin
  if tg_table_name='transactions' then tx_id:=new.id; owner_id:=new.user_id;
  elsif tg_op='DELETE' then tx_id:=old.transaction_id; owner_id:=old.user_id;
  else tx_id:=new.transaction_id; owner_id:=new.user_id; end if;
  select x.* into t from public.transactions x where x.id=tx_id and x.user_id=owner_id;
  if not found then return null; end if;
  effective_cost:=coalesce(t.cost_currency,t.currency);
  select count(*),
    coalesce(array_agg(x.balance_id order by x.position),'{}'::uuid[]),min(x.position),max(x.position),
    coalesce(sum(x.amount_minor) filter (where x.leg='tender' and x.currency=effective_cost),0),
    coalesce(sum(x.amount_minor) filter (where x.leg='change' and x.currency=effective_cost),0),
    coalesce(bool_or(x.leg='tender' and x.currency<>effective_cost),false),
    coalesce(bool_or(x.leg='change' and x.currency<>effective_cost),false)
    into leg_count,balance_ids,min_position,max_position,tender_same,change_same,tender_cross,change_cross
  from public.cashier_changes x where x.transaction_id=tx_id and x.user_id=owner_id;
  if t.change_balance_ids is distinct from balance_ids
     or (leg_count>0 and (min_position<>0 or max_position<>leg_count-1)) then raise exception 'invalid settlement'; end if;
  if t.change_balance_id is not null or t.change_minor is not null or t.change_currency is not null
     or t.change_rate_base is not null or t.change_rate_quote is not null
     or t.change_rate_numerator is not null or t.change_rate_denominator is not null then raise exception 'invalid settlement'; end if;
  if t.tender_minor is null then
    if leg_count<>0 or effective_cost<>t.currency then raise exception 'invalid settlement'; end if;
    return null;
  end if;
  if t.kind::text<>'expense' or t.source is not null or t.installment_id is not null then raise exception 'invalid settlement'; end if;
  for c in select * from public.cashier_changes x where x.transaction_id=tx_id and x.user_id=owner_id loop
    if c.leg='tender' then
      if c.rate_base is not null then raise exception 'invalid settlement rate'; end if;
      continue;
    end if;
    if c.currency=t.currency and c.rate_base is not null then raise exception 'invalid settlement rate'; end if;
    if c.currency<>t.currency and c.rate_base is not null then
      perform public.cashier_convert_minor(c.amount_minor,c.currency,t.currency,
        c.rate_base,c.rate_quote,c.rate_numerator,c.rate_denominator);
    end if;
  end loop;
  -- The parent row is the first tender line.
  if t.currency=effective_cost then tender_same:=tender_same+t.tender_minor; else tender_cross:=true; end if;
  if not tender_cross and not change_cross then
    if tender_same-change_same<>t.amount_minor then raise exception 'settlement mismatch'; end if;
  elsif not tender_cross then
    if tender_same-change_same<=t.amount_minor then raise exception 'settlement mismatch'; end if;
  elsif not change_cross then
    if tender_same-change_same>=t.amount_minor then raise exception 'settlement mismatch'; end if;
  end if;
  return null;
end;
$$;

-- Canonical replay snapshot: every actual amount in stable position order.
create or replace function public.cashier_snapshot(p public.transactions) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when p.tender_minor is null then null else jsonb_build_object(
    'tenderMinor',p.tender_minor,
    'extraTenders',coalesce((select jsonb_agg(jsonb_build_object(
      'balanceId',c.balance_id,'amountMinor',c.amount_minor) order by c.position)
      from public.cashier_changes c
      where c.transaction_id=p.id and c.user_id=p.user_id and c.leg='tender'),'[]'::jsonb),
    'changes',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'balanceId',c.balance_id,'amountMinor',c.amount_minor,
      'rate',case when c.rate_base is null then null else jsonb_build_object(
        'base',c.rate_base,'quote',c.rate_quote,
        'quoteMajorNumerator',c.rate_numerator,'quoteMajorDenominator',c.rate_denominator) end
    )) order by c.position) from public.cashier_changes c
      where c.transaction_id=p.id and c.user_id=p.user_id and c.leg='change'),'[]'::jsonb)
  ) end;
$$;

-- The aggregate keeps its signature, wrapper chain, lock order, replay and
-- revision contracts. The settlement payload gains one optional key:
--   {"tenderMinor":n,"changes":[...],"extraTenders":[{"balanceId":..,"amountMinor":..}]}
-- A payload without extraTenders means exactly what it meant before.
create or replace function cashier_private.save_transaction_aggregate_without_cost_currency(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,p_settlement jsonb default null
) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare existing public.transactions; current_row public.transactions; base_result record; replay boolean;
  existing_found boolean;
  replace_settlement boolean:=p_settlement is not null; tender bigint; input_wallet uuid; input_amount bigint;
  normalized_changes jsonb:='[]'::jsonb; normalized_tenders jsonb:='[]'::jsonb;
  requested_snapshot jsonb; existing_snapshot jsonb;
  change_input jsonb; rate_input jsonb; receiver uuid; cash_change bigint; leg_position integer:=0;
  rate_base text; rate_quote text; rate_n bigint; rate_d bigint;
  receiver_ids uuid[]:='{}'::uuid[]; tender_ids uuid[]:='{}'::uuid[]; require_active boolean;
begin
  set constraints public.transactions_cashier_check, public.cashier_changes_valid deferred;
  perform ledger_private.lock_owner();
  if auth.uid() is null or p_id is null then raise exception using errcode='BT003',message='transaction conflict'; end if;
  begin
    input_wallet:=(p_input->>'balanceId')::uuid;
    input_amount:=(p_input->>'amountMinor')::bigint;
  exception when others then
    raise exception using errcode='22023',message='invalid transaction input';
  end;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select t.* into existing from public.transactions t where t.id=p_id and t.user_id=auth.uid() for update;
  existing_found:=found;
  replay:=existing_found and p_expected_revision is null;
  if p_expected_revision is null then
    if replay then
      if existing.deleted_at is not null or not exists(select 1 from transaction_private.transaction_creation_receipts r
        where r.transaction_id=p_id and r.user_id=auth.uid() and r.creation_revision=existing.revision) then
        raise exception using errcode='BT003',message='transaction conflict';
      end if;
    elsif exists(select 1 from transaction_private.transaction_creation_receipts r
      where r.transaction_id=p_id and r.user_id=auth.uid()) then
      raise exception using errcode='BT003',message='transaction conflict';
    end if;
  end if;
  if existing_found then existing_snapshot:=public.cashier_snapshot(existing); end if;

  if p_settlement is null then
    requested_snapshot:=case when p_expected_revision is null then null else existing_snapshot end;
    normalized_changes:=coalesce(requested_snapshot->'changes','[]'::jsonb);
    normalized_tenders:=coalesce(requested_snapshot->'extraTenders','[]'::jsonb);
    tender:=case when requested_snapshot is null then null else (requested_snapshot->>'tenderMinor')::bigint end;
  elsif p_settlement='{}'::jsonb then
    requested_snapshot:=null; tender:=null;
  else
    if jsonb_typeof(p_settlement)<>'object' or p_settlement-array['tenderMinor','changes','extraTenders']<>'{}'::jsonb
       or not (p_settlement ?& array['tenderMinor','changes'])
       or jsonb_typeof(p_settlement->'tenderMinor')<>'number'
       or jsonb_typeof(p_settlement->'changes')<>'array'
       or (p_settlement ? 'extraTenders' and jsonb_typeof(p_settlement->'extraTenders')<>'array') then
      raise exception 'invalid settlement';
    end if;
    begin tender:=(p_settlement->>'tenderMinor')::bigint; exception when others then raise exception 'invalid settlement'; end;
    if tender not between 1 and 1000000000000000 then raise exception 'invalid settlement'; end if;
    for change_input in select x.value from jsonb_array_elements(p_settlement->'changes') with ordinality x(value,ordinality) order by x.ordinality loop
      rate_base:=null;rate_quote:=null;rate_n:=null;rate_d:=null;
      if jsonb_typeof(change_input)<>'object' or change_input-array['balanceId','amountMinor','rate']<>'{}'::jsonb
         or not (change_input ?& array['balanceId','amountMinor'])
         or jsonb_typeof(change_input->'balanceId')<>'string'
         or jsonb_typeof(change_input->'amountMinor')<>'number' then raise exception 'invalid settlement'; end if;
      begin receiver:=(change_input->>'balanceId')::uuid; cash_change:=(change_input->>'amountMinor')::bigint;
      exception when others then raise exception 'invalid settlement'; end;
      if cash_change not between 1 and 1000000000000000 then raise exception 'invalid settlement'; end if;
      if change_input ? 'rate' then
        rate_input:=change_input->'rate';
        if jsonb_typeof(rate_input) is distinct from 'object'
          or rate_input-array['base','quote','quoteMajorNumerator','quoteMajorDenominator']<>'{}'::jsonb
          or not (rate_input ?& array['base','quote','quoteMajorNumerator','quoteMajorDenominator'])
          or jsonb_typeof(rate_input->'base') is distinct from 'string'
          or jsonb_typeof(rate_input->'quote') is distinct from 'string'
          or jsonb_typeof(rate_input->'quoteMajorNumerator') is distinct from 'number'
          or jsonb_typeof(rate_input->'quoteMajorDenominator') is distinct from 'number' then raise exception 'invalid settlement rate'; end if;
        begin
          rate_base:=(rate_input->>'base')::text;rate_quote:=(rate_input->>'quote')::text;
          rate_n:=(rate_input->>'quoteMajorNumerator')::bigint;rate_d:=(rate_input->>'quoteMajorDenominator')::bigint;
        exception when others then raise exception 'invalid settlement rate'; end;
      end if;
      normalized_changes:=normalized_changes||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'balanceId',receiver,'amountMinor',cash_change,
        'rate',case when rate_base is null then null else jsonb_build_object('base',rate_base,'quote',rate_quote,
          'quoteMajorNumerator',rate_n,'quoteMajorDenominator',rate_d) end)));
    end loop;
    if jsonb_array_length(coalesce(p_settlement->'extraTenders','[]'::jsonb))>20 then raise exception 'invalid settlement'; end if;
    for change_input in select x.value from jsonb_array_elements(coalesce(p_settlement->'extraTenders','[]'::jsonb)) with ordinality x(value,ordinality) order by x.ordinality loop
      if jsonb_typeof(change_input)<>'object' or change_input-array['balanceId','amountMinor']<>'{}'::jsonb
         or not (change_input ?& array['balanceId','amountMinor'])
         or jsonb_typeof(change_input->'balanceId')<>'string'
         or jsonb_typeof(change_input->'amountMinor')<>'number' then raise exception 'invalid settlement'; end if;
      begin receiver:=(change_input->>'balanceId')::uuid; cash_change:=(change_input->>'amountMinor')::bigint;
      exception when others then raise exception 'invalid settlement'; end;
      if cash_change not between 1 and 1000000000000000 then raise exception 'invalid settlement'; end if;
      normalized_tenders:=normalized_tenders||jsonb_build_array(jsonb_build_object(
        'balanceId',receiver,'amountMinor',cash_change));
    end loop;
    requested_snapshot:=jsonb_build_object('tenderMinor',tender,'extraTenders',normalized_tenders,'changes',normalized_changes);
  end if;

  if replay and existing_snapshot is distinct from requested_snapshot then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  select coalesce(array_agg((x.value->>'balanceId')::uuid order by x.ordinality),'{}'::uuid[])
    into receiver_ids from jsonb_array_elements(normalized_changes) with ordinality x(value,ordinality);
  select coalesce(array_agg((x.value->>'balanceId')::uuid order by x.ordinality),'{}'::uuid[])
    into tender_ids from jsonb_array_elements(normalized_tenders) with ordinality x(value,ordinality);
  perform w.id from ledger_private.balance_context w where w.id in (
    select existing.balance_id union select existing.to_balance_id
    union select c.balance_id from public.cashier_changes c where c.transaction_id=p_id and c.user_id=auth.uid()
    union select input_wallet union select unnest(receiver_ids) union select unnest(tender_ids)
  ) order by w.id for update;
  if exists(select 1 from unnest(receiver_ids||tender_ids) x(leg_balance) where not exists(
    select 1 from ledger_private.balance_context w where w.id=x.leg_balance and w.user_id=auth.uid())) then raise exception 'wallet unavailable'; end if;
  require_active:=not replay and (not existing_found or existing.balance_id is distinct from input_wallet
    or existing.amount_minor is distinct from input_amount or existing_snapshot is distinct from requested_snapshot);
  if require_active and exists(select 1 from jsonb_array_elements(normalized_changes) x(value) where x.value ? 'rate') then
    raise exception 'invalid settlement rate';
  end if;
  if require_active and exists(select 1 from unnest(receiver_ids||tender_ids) x(leg_balance)
    join ledger_private.balance_context w on w.id=x.leg_balance
    where w.archived_at is not null) then raise exception 'wallet unavailable'; end if;

  select * into base_result from transaction_private.save_transaction_rows(p_id,p_expected_revision,p_input,p_items);
  if not replay and replace_settlement and requested_snapshot is distinct from existing_snapshot then
    -- The derived parent array lists every leg balance in position order:
    -- returned change first, then the additional tenders.
    update public.transactions t set tender_minor=tender,change_balance_ids=receiver_ids||tender_ids,
      change_balance_id=null,change_minor=null,change_currency=null,change_rate_base=null,change_rate_quote=null,
      change_rate_numerator=null,change_rate_denominator=null where t.id=base_result.id and t.user_id=auth.uid();
    delete from public.cashier_changes c where c.transaction_id=base_result.id and c.user_id=auth.uid();
    leg_position:=0;
    for change_input in select x.value from jsonb_array_elements(normalized_changes) with ordinality x(value,ordinality) order by x.ordinality loop
      receiver:=(change_input->>'balanceId')::uuid;cash_change:=(change_input->>'amountMinor')::bigint;
      rate_input:=change_input->'rate';
      insert into public.cashier_changes(user_id,transaction_id,balance_id,amount_minor,currency,position,leg,
        rate_base,rate_quote,rate_numerator,rate_denominator)
      select auth.uid(),base_result.id,receiver,cash_change,w.currency,leg_position,'change',
        case when rate_input is null then null else (rate_input->>'base')::text end,
        case when rate_input is null then null else (rate_input->>'quote')::text end,
        case when rate_input is null then null else (rate_input->>'quoteMajorNumerator')::bigint end,
        case when rate_input is null then null else (rate_input->>'quoteMajorDenominator')::bigint end
      from ledger_private.balance_context w where w.id=receiver and w.user_id=auth.uid();
      leg_position:=leg_position+1;
    end loop;
    for change_input in select x.value from jsonb_array_elements(normalized_tenders) with ordinality x(value,ordinality) order by x.ordinality loop
      receiver:=(change_input->>'balanceId')::uuid;cash_change:=(change_input->>'amountMinor')::bigint;
      insert into public.cashier_changes(user_id,transaction_id,balance_id,amount_minor,currency,position,leg)
      select auth.uid(),base_result.id,receiver,cash_change,w.currency,leg_position,'tender'
      from ledger_private.balance_context w where w.id=receiver and w.user_id=auth.uid();
      leg_position:=leg_position+1;
    end loop;
  end if;
  set constraints public.transactions_cashier_check,public.cashier_changes_valid immediate;
  set constraints public.transactions_cashier_check,public.cashier_changes_valid deferred;
  select t.* into current_row from public.transactions t where t.id=base_result.id and t.user_id=auth.uid();
  if p_expected_revision is null and not replay then
    insert into transaction_private.transaction_creation_receipts(transaction_id,user_id,creation_revision)
      values(current_row.id,auth.uid(),current_row.revision);
  end if;
  return query select current_row.id,current_row.revision;
end;
$$;
revoke execute on function cashier_private.save_transaction_aggregate_without_cost_currency(uuid,integer,jsonb,jsonb,jsonb)
  from public,anon,authenticated;

-- Wallet balances: the parent still debits the first tender once; every leg
-- row credits (returned change) or debits (additional tender) its own balance.
create or replace view public.wallet_balance_totals with(security_invoker=true) as
select b.id balance_id,b.wallet_id,b.user_id,b.currency,b.opening_balance_minor
 +coalesce((select sum(case when t.kind::text='income' or(t.kind::text='loan' and t.loan_flow='in') then t.amount_minor when t.kind::text='expense' then -coalesce(t.tender_minor,t.amount_minor) else -t.amount_minor end) from public.transactions t where t.balance_id=b.id and t.deleted_at is null),0)
 +coalesce((select sum(t.to_amount_minor) from public.transactions t where t.to_balance_id=b.id and t.kind::text='transfer' and t.deleted_at is null),0)
 +coalesce((select sum(case when c.leg='tender' then -c.amount_minor else c.amount_minor end) from public.cashier_changes c join public.transactions t on (t.id,t.user_id)=(c.transaction_id,c.user_id) where c.balance_id=b.id and t.kind::text='expense' and t.deleted_at is null),0) balance_minor
from public.wallet_balances b;
grant select on public.wallet_balance_totals to authenticated;
