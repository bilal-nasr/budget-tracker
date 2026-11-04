-- Cashier settlement extends item 2's canonical purchase aggregate. Apply after
-- the currency/category/expense-items migrations, never before them.
alter table public.transactions
  add column tender_minor bigint check (tender_minor between 1 and 1000000000000000),
  add column change_wallet_id uuid references public.wallets(id),
  add column change_minor bigint check (change_minor between 1 and 1000000000000000),
  add column change_currency public.currency,
  add column change_rate_base public.currency,
  add column change_rate_quote public.currency,
  add column change_rate_numerator bigint check (change_rate_numerator between 1 and 1000000000000000),
  add column change_rate_denominator bigint check (change_rate_denominator between 1 and 1000000);
create index transactions_change_wallet_idx on public.transactions(change_wallet_id)
  where change_wallet_id is not null;

-- Exact quote-major/base-major rational conversion. Unsupported pairs fail,
-- including calls which attempt to reuse a USD/LBP quote for SYP.
create function public.cashier_convert_minor(p_minor bigint,p_from public.currency,p_to public.currency,
  p_base public.currency,p_quote public.currency,p_n bigint,p_d bigint)
returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric; d numeric; base_scale integer; quote_scale integer; result numeric;
begin
  if p_minor is null or p_minor not between 0 and 1000000000000000
     or p_n is null or p_n not between 1 and 1000000000000000
     or p_d is null or p_d not between 1 and 1000000 or 1000000 % p_d <> 0
     or p_n::numeric > 1000000000::numeric*p_d
     or p_from is null or p_to is null or p_base is null or p_quote is null
     or not ((p_base::text='USD' and p_quote::text in ('LBP','SYP')) or (p_base::text='LBP' and p_quote::text='SYP'))
     or not ((p_from=p_base and p_to=p_quote) or (p_from=p_quote and p_to=p_base))
     or (p_base::text='USD' and p_quote::text='LBP' and (p_d<>1 or p_n>10000000)) then
    raise exception 'invalid settlement rate';
  end if;
  -- Matches the ledger registry: USD cents, LBP whole lira, SYP qirsh.
  base_scale := case p_base::text when 'LBP' then 1 else 100 end;
  quote_scale := case p_quote::text when 'LBP' then 1 else 100 end;
  if p_from=p_base then
    n := p_minor::numeric*p_n*quote_scale; d := p_d::numeric*base_scale;
  else
    n := p_minor::numeric*p_d*base_scale; d := p_n::numeric*quote_scale;
  end if;
  -- numeric / may round a near-integer quotient before floor; div truncates
  -- the positive integer numerator/denominator exactly, matching BigInt.
  result := div(2*n+d,2*d);
  if result>1000000000000000 then raise exception 'invalid settlement rate'; end if;
  return result::bigint;
end;
$$;

-- Serialize wallet archive/delete/currency changes, including direct table writes.
-- Metadata-only updates/deletion remain possible for archived historical wallets.
create function public.transactions_cashier_wallets() returns trigger
language plpgsql set search_path='' as $$
declare w record; cw record; ids uuid[]; require_active boolean;
begin
  ids := array[new.wallet_id,new.to_wallet_id,new.change_wallet_id];
  if tg_op='UPDATE' then ids := ids || array[old.wallet_id,old.to_wallet_id,old.change_wallet_id]; end if;
  perform x.id from public.wallets x where x.id=any(ids) order by x.id for update;
  if new.tender_minor is null and new.change_wallet_id is null then
    if tg_op='INSERT' then return new; end if;
    if old.tender_minor is null and old.change_wallet_id is null then return new; end if;
  end if;
  select x.* into w from public.wallets x where x.id=new.wallet_id and x.user_id=new.user_id;
  if not found then raise exception 'wallet unavailable'; end if;
  new.currency := w.currency;
  require_active := tg_op='INSERT';
  if tg_op='UPDATE' then
    require_active := (old.deleted_at is not null and new.deleted_at is null)
      or (new.deleted_at is null and
        row(new.wallet_id,new.amount_minor,new.tender_minor,new.change_wallet_id,new.change_minor,
            new.change_rate_base,new.change_rate_quote,new.change_rate_numerator,new.change_rate_denominator)
        is distinct from
        row(old.wallet_id,old.amount_minor,old.tender_minor,old.change_wallet_id,old.change_minor,
            old.change_rate_base,old.change_rate_quote,old.change_rate_numerator,old.change_rate_denominator));
  end if;
  if require_active and w.archived_at is not null then raise exception 'wallet unavailable'; end if;
  if new.change_wallet_id is not null then
    select x.* into cw from public.wallets x where x.id=new.change_wallet_id and x.user_id=new.user_id;
    if not found or (require_active and cw.archived_at is not null) then raise exception 'wallet unavailable'; end if;
    if new.change_currency is not null and new.change_currency<>cw.currency then raise exception 'settlement currency mismatch'; end if;
    new.change_currency := cw.currency;
  end if;
  return new;
end;
$$;
create trigger transactions_cashier_wallets before insert or update on public.transactions
  for each row execute function public.transactions_cashier_wallets();

-- Final-state validation permits a simultaneous cost + item list + tender edit.
-- Checks also run for direct REST writes and for retained soft-deleted history.
create function public.transactions_cashier_check() returns trigger
language plpgsql set search_path='' as $$
declare t public.transactions; change_value bigint;
begin
  select x.* into t from public.transactions x where x.id=new.id;
  if not found then return null; end if;
  if t.tender_minor is null then
    if t.change_wallet_id is not null or t.change_minor is not null or t.change_currency is not null
       or t.change_rate_base is not null or t.change_rate_quote is not null or t.change_rate_numerator is not null
       or t.change_rate_denominator is not null then raise exception 'invalid settlement'; end if;
    return null;
  end if;
  if t.kind::text<>'expense' or t.source is not null or t.installment_id is not null then raise exception 'invalid settlement'; end if;
  if t.change_wallet_id is null then
    if t.change_minor is not null or t.change_currency is not null or t.change_rate_base is not null
       or t.change_rate_quote is not null or t.change_rate_numerator is not null or t.change_rate_denominator is not null then
      raise exception 'invalid settlement';
    end if;
    if t.tender_minor<>t.amount_minor then raise exception 'settlement mismatch'; end if;
    return null;
  end if;
  if t.change_minor is null or t.change_currency is null then raise exception 'invalid settlement'; end if;
  if t.change_currency=t.currency then
    if t.change_rate_base is not null or t.change_rate_quote is not null or t.change_rate_numerator is not null
       or t.change_rate_denominator is not null then raise exception 'invalid settlement rate'; end if;
    change_value := t.change_minor;
  else
    change_value := public.cashier_convert_minor(t.change_minor,t.change_currency,t.currency,
      t.change_rate_base,t.change_rate_quote,t.change_rate_numerator,t.change_rate_denominator);
  end if;
  if change_value<=0 or t.tender_minor-change_value<>t.amount_minor then raise exception 'settlement mismatch'; end if;
  return null;
end;
$$;
create constraint trigger transactions_cashier_check after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.transactions_cashier_check();

create function public.wallets_cashier_currency_locked() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.currency<>old.currency and exists(select 1 from public.transactions t
    where t.change_wallet_id=old.id or t.to_wallet_id=old.id) then
    raise exception 'wallet currency cannot change after it has transactions';
  end if;
  return new;
end;
$$;
create trigger wallets_cashier_currency_locked before update on public.wallets
  for each row execute function public.wallets_cashier_currency_locked();

create or replace view public.wallet_balances with (security_invoker=true) as
select w.id as wallet_id,w.user_id,
  w.opening_balance_minor
    + coalesce((select sum(case when t.kind::text='income' then t.amount_minor
                               when t.kind::text='expense' then -coalesce(t.tender_minor,t.amount_minor)
                               else -t.amount_minor end)
                from public.transactions t where t.wallet_id=w.id and t.deleted_at is null),0)
    + coalesce((select sum(t.to_amount_minor) from public.transactions t
                where t.to_wallet_id=w.id and t.kind::text='transfer' and t.deleted_at is null),0)
    + coalesce((select sum(t.change_minor) from public.transactions t
                where t.change_wallet_id=w.id and t.deleted_at is null),0) as balance_minor
from public.wallets w;

-- Canonical snapshot for exact replay comparison. It contains actual cash,
-- never values recomputed from a mutable profile rate.
create function public.cashier_snapshot(p public.transactions) returns jsonb
language sql immutable set search_path='' as $$
  select case when p.tender_minor is null then null else jsonb_build_object(
    'tenderMinor',p.tender_minor,'change',case when p.change_wallet_id is null then 'null'::jsonb
    else jsonb_strip_nulls(jsonb_build_object('walletId',p.change_wallet_id,'amountMinor',p.change_minor,
      'rate',case when p.change_rate_base is null then null else jsonb_build_object(
        'base',p.change_rate_base,'quote',p.change_rate_quote,
        'quoteMajorNumerator',p.change_rate_numerator,'quoteMajorDenominator',p.change_rate_denominator) end)) end) end;
$$;

-- Retain item 2's canonical input/item/revision guards without copying a stale
-- implementation. The private invoker helper is not exposed as a PostgREST RPC.
create schema if not exists cashier_private;
revoke all on schema cashier_private from public,anon;
grant usage on schema cashier_private to authenticated;
alter function public.save_transaction(uuid,integer,jsonb,jsonb) set schema cashier_private;
revoke all on function cashier_private.save_transaction(uuid,integer,jsonb,jsonb) from public,anon,authenticated;
revoke all on function transaction_private.save_transaction(uuid,integer,jsonb,jsonb) from public,anon,authenticated;

create function cashier_private.save_transaction_aggregate(p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,
  p_settlement jsonb default null) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
declare existing public.transactions; current_row public.transactions; requested public.transactions; replay boolean;
  tender bigint; receiver uuid; cash_change bigint; rate_base public.currency; rate_quote public.currency;
  rate_n bigint; rate_d bigint; change_input jsonb; rate_input jsonb; base_result record;
begin
  if auth.uid() is null or p_id is null then raise exception using errcode='BT003',message='transaction conflict'; end if;
  -- The same UUID serializes simultaneous create retries before either reaches
  -- the item writer. No sleeping, no application read-then-write race.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select t.* into existing from public.transactions t where t.id=p_id and t.user_id=auth.uid() for update;
  replay := found and p_expected_revision is null;
  if p_expected_revision is null then
    if replay then
      if existing.deleted_at is not null or not exists(
        select 1 from transaction_private.transaction_creation_receipts r where r.transaction_id=p_id
          and r.user_id=auth.uid() and r.creation_revision=existing.revision
      ) then raise exception using errcode='BT003',message='transaction conflict'; end if;
    elsif exists(select 1 from transaction_private.transaction_creation_receipts r where r.transaction_id=p_id and r.user_id=auth.uid()) then
      raise exception using errcode='BT003',message='transaction conflict';
    end if;
  end if;
  if p_settlement is not null and p_settlement<>'{}'::jsonb then
    if jsonb_typeof(p_settlement)<>'object' or p_settlement-array['tenderMinor','change']<>'{}'::jsonb
       or not (p_settlement ? 'tenderMinor' and p_settlement ? 'change')
       or jsonb_typeof(p_settlement->'tenderMinor')<>'number' then raise exception 'invalid settlement'; end if;
    tender := (p_settlement->>'tenderMinor')::bigint;
    change_input := p_settlement->'change';
    if change_input<>'null'::jsonb then
      if jsonb_typeof(change_input)<>'object' or change_input-array['walletId','amountMinor','rate']<>'{}'::jsonb
         or jsonb_typeof(change_input->'walletId') is distinct from 'string'
         or jsonb_typeof(change_input->'amountMinor') is distinct from 'number' then raise exception 'invalid settlement'; end if;
      receiver := (change_input->>'walletId')::uuid; cash_change := (change_input->>'amountMinor')::bigint;
      if change_input ? 'rate' then
        rate_input := change_input->'rate';
        if jsonb_typeof(rate_input)<>'object' or rate_input-array['base','quote','quoteMajorNumerator','quoteMajorDenominator']<>'{}'::jsonb
           or jsonb_typeof(rate_input->'base') is distinct from 'string'
           or jsonb_typeof(rate_input->'quote') is distinct from 'string'
           or jsonb_typeof(rate_input->'quoteMajorNumerator') is distinct from 'number'
           or jsonb_typeof(rate_input->'quoteMajorDenominator') is distinct from 'number' then raise exception 'invalid settlement rate'; end if;
        rate_base := (rate_input->>'base')::public.currency; rate_quote := (rate_input->>'quote')::public.currency;
        rate_n := (rate_input->>'quoteMajorNumerator')::bigint; rate_d := (rate_input->>'quoteMajorDenominator')::bigint;
      end if;
    end if;
  end if;
  requested.tender_minor:=tender; requested.change_wallet_id:=receiver; requested.change_minor:=cash_change;
  requested.change_rate_base:=rate_base; requested.change_rate_quote:=rate_quote;
  requested.change_rate_numerator:=rate_n; requested.change_rate_denominator:=rate_d;
  if replay and (existing.deleted_at is not null or public.cashier_snapshot(existing) is distinct from public.cashier_snapshot(requested)) then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  -- Parent lock first, then all old/new wallet locks in deterministic order.
  perform w.id from public.wallets w where w.user_id=auth.uid() and w.id=any(array[existing.wallet_id,existing.to_wallet_id,
    existing.change_wallet_id,(p_input->>'walletId')::uuid,receiver]) order by w.id for update;
  if receiver is not null and not exists(select 1 from public.wallets w where w.id=receiver
    and w.user_id=auth.uid()) then raise exception 'wallet unavailable'; end if;
  select * into base_result from transaction_private.save_transaction_rows(p_id,p_expected_revision,p_input,p_items);
  if not replay and p_settlement is not null then
    update public.transactions t set tender_minor=tender,change_wallet_id=receiver,change_minor=cash_change,
      change_currency=null,change_rate_base=rate_base,change_rate_quote=rate_quote,
      change_rate_numerator=rate_n,change_rate_denominator=rate_d where t.id=base_result.id;
  end if;
  set constraints public.transactions_cashier_check immediate;
  set constraints public.transactions_cashier_check deferred;
  select t.* into current_row from public.transactions t where t.id=base_result.id and t.user_id=auth.uid();
  -- Seal exactly once AFTER item touches, settlement update and final checks.
  -- Never rewrite a receipt on edit/revert, delete/restore or create replay.
  if p_expected_revision is null and not replay then
    insert into transaction_private.transaction_creation_receipts(transaction_id,user_id,creation_revision)
      values(current_row.id,auth.uid(),current_row.revision);
  end if;
  return query select current_row.id,current_row.revision;
end;
$$;

revoke execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb) from public,anon;
grant execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb) to authenticated;
create function public.save_transaction(p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,
  p_settlement jsonb default null) returns table(id uuid,revision integer)
language sql security invoker set search_path='' as $$
  select r.id,r.revision from cashier_private.save_transaction_aggregate(p_id,p_expected_revision,p_input,p_items,p_settlement) r;
$$;

-- Reuse item 2's exact-revision set_transaction_deleted unchanged. The wallet
-- trigger above adds active-wallet validation on restore; no expected+1 retry
-- exception or competing lifecycle API is introduced.
revoke execute on function public.transactions_cashier_wallets(),public.transactions_cashier_check(),public.wallets_cashier_currency_locked() from public,anon,authenticated;
revoke all on function public.cashier_snapshot(public.transactions),public.cashier_convert_minor(bigint,public.currency,public.currency,public.currency,public.currency,bigint,bigint),
  public.save_transaction(uuid,integer,jsonb,jsonb,jsonb),public.set_transaction_deleted(uuid,integer,boolean) from public,anon;
grant execute on function public.cashier_snapshot(public.transactions),public.cashier_convert_minor(bigint,public.currency,public.currency,public.currency,public.currency,bigint,bigint),
  public.save_transaction(uuid,integer,jsonb,jsonb,jsonb),public.set_transaction_deleted(uuid,integer,boolean) to authenticated;
