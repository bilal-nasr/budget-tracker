-- One purchase can return several actual cash amounts. The child collection is
-- canonical; the parent array exists only for indexed Activity wallet filters.
alter table public.transactions
  add column change_wallet_ids uuid[] not null default '{}'::uuid[]
  check (array_position(change_wallet_ids,null) is null);

create table public.cashier_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  wallet_id uuid not null references public.wallets(id),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  currency public.currency not null,
  position integer not null check (position >= 0),
  rate_base public.currency,
  rate_quote public.currency,
  rate_numerator bigint check (rate_numerator between 1 and 1000000000000000),
  rate_denominator bigint check (rate_denominator between 1 and 1000000),
  constraint cashier_changes_transaction_owner_fkey foreign key (transaction_id,user_id)
    references public.transactions(id,user_id) on delete cascade,
  constraint cashier_changes_position_key unique(transaction_id,position),
  constraint cashier_changes_rate_shape check (
    num_nonnulls(rate_base,rate_quote,rate_numerator,rate_denominator) in (0,4)
  )
);
create index cashier_changes_user_parent_idx on public.cashier_changes(user_id,transaction_id,position);
create index cashier_changes_wallet_idx on public.cashier_changes(wallet_id,transaction_id);
create index transactions_change_wallet_ids_idx on public.transactions using gin(change_wallet_ids);

alter table public.cashier_changes enable row level security;
create policy cashier_changes_select on public.cashier_changes for select using (user_id=(select auth.uid()));
grant select on public.cashier_changes to authenticated;
revoke all on public.cashier_changes from anon;

-- Migrate every historical single change, including deleted rows and archived
-- wallets, before the legacy parent fields are cleared.
insert into public.cashier_changes(user_id,transaction_id,wallet_id,amount_minor,currency,position,
  rate_base,rate_quote,rate_numerator,rate_denominator)
select user_id,id,change_wallet_id,change_minor,change_currency,0,
  change_rate_base,change_rate_quote,change_rate_numerator,change_rate_denominator
from public.transactions where change_wallet_id is not null;

drop trigger transactions_cashier_wallets on public.transactions;
drop trigger transactions_cashier_check on public.transactions;
drop trigger wallets_cashier_currency_locked on public.wallets;

-- This representation-only migration must not invalidate exact-replay receipts
-- or open editor revision tokens.
alter table public.transactions disable trigger transactions_revision;
update public.transactions t set
  change_wallet_ids=coalesce((select array_agg(c.wallet_id order by c.position) from public.cashier_changes c
    where c.transaction_id=t.id and c.user_id=t.user_id),'{}'::uuid[]),
  change_wallet_id=null,change_minor=null,change_currency=null,
  change_rate_base=null,change_rate_quote=null,change_rate_numerator=null,change_rate_denominator=null
where t.change_wallet_id is not null;
alter table public.transactions enable trigger transactions_revision;

-- Child rows can only be replaced through the aggregate RPC. This guard still
-- protects migrations/service writes and derives currency from the wallet.
create function public.cashier_changes_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare tx_id uuid; owner_id uuid; parent public.transactions; receiver public.wallets;
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.transaction_id is distinct from old.transaction_id
      or new.user_id is distinct from old.user_id) then
    raise exception 'cashier change identity cannot change';
  end if;
  if tg_op='DELETE' then tx_id:=old.transaction_id; owner_id:=old.user_id;
  else tx_id:=new.transaction_id; owner_id:=new.user_id; end if;
  select t.* into parent from public.transactions t where t.id=tx_id and t.user_id=owner_id for update;
  if not found then
    if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  if parent.kind::text<>'expense' or parent.deleted_at is not null then raise exception 'invalid settlement'; end if;
  if tg_op='DELETE' then return old; end if;
  select w.* into receiver from public.wallets w where w.id=new.wallet_id and w.user_id=owner_id for update;
  if not found then raise exception 'wallet unavailable'; end if;
  new.currency:=receiver.currency;
  return new;
end;
$$;
create trigger cashier_changes_guard before insert or update or delete on public.cashier_changes
  for each row execute function public.cashier_changes_guard();

-- Parent changes lock every wallet role in UUID order. Metadata-only edits may
-- retain archived receivers; new/restored/financially changed money may not.
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
  require_active:=tg_op='INSERT';
  if tg_op='UPDATE' then
    require_active:=(old.deleted_at is not null and new.deleted_at is null)
      or row(new.wallet_id,new.amount_minor,new.tender_minor,new.change_wallet_ids)
         is distinct from row(old.wallet_id,old.amount_minor,old.tender_minor,old.change_wallet_ids);
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
create trigger transactions_cashier_wallets before insert or update on public.transactions
  for each row execute function public.transactions_cashier_wallets();

-- Validate parent and child final state together, including service/direct DML.
create or replace function public.transactions_cashier_check() returns trigger
language plpgsql security definer set search_path='' as $$
declare tx_id uuid; owner_id uuid; t public.transactions; change_count bigint; same_total numeric;
  has_cross boolean; wallet_ids uuid[]; min_position integer; max_position integer; c public.cashier_changes;
begin
  if tg_table_name='transactions' then tx_id:=new.id; owner_id:=new.user_id;
  elsif tg_op='DELETE' then tx_id:=old.transaction_id; owner_id:=old.user_id;
  else tx_id:=new.transaction_id; owner_id:=new.user_id; end if;
  select x.* into t from public.transactions x where x.id=tx_id and x.user_id=owner_id;
  if not found then return null; end if;
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
    if change_count<>0 then raise exception 'invalid settlement'; end if;
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
  if has_cross then
    if t.tender_minor-same_total<=t.amount_minor then raise exception 'settlement mismatch'; end if;
  elsif t.tender_minor-same_total<>t.amount_minor then raise exception 'settlement mismatch'; end if;
  return null;
end;
$$;
create constraint trigger transactions_cashier_check after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.transactions_cashier_check();
create constraint trigger cashier_changes_valid after insert or update or delete on public.cashier_changes
  deferrable initially deferred for each row execute function public.transactions_cashier_check();

create or replace function public.wallets_cashier_currency_locked() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.currency<>old.currency and (exists(select 1 from public.cashier_changes c where c.wallet_id=old.id)
      or exists(select 1 from public.transactions t where t.to_wallet_id=old.id)) then
    raise exception 'wallet currency cannot change after it has transactions';
  end if;
  return new;
end;
$$;
create trigger wallets_cashier_currency_locked before update on public.wallets
  for each row execute function public.wallets_cashier_currency_locked();

-- Canonical replay snapshot: actual amounts in stable position order. Currency
-- is read-only metadata and is intentionally absent from the write payload.
create or replace function public.cashier_snapshot(p public.transactions) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when p.tender_minor is null then null else jsonb_build_object(
    'tenderMinor',p.tender_minor,
    'changes',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'walletId',c.wallet_id,'amountMinor',c.amount_minor,
      'rate',case when c.rate_base is null then null else jsonb_build_object(
        'base',c.rate_base,'quote',c.rate_quote,
        'quoteMajorNumerator',c.rate_numerator,'quoteMajorDenominator',c.rate_denominator) end
    )) order by c.position) from public.cashier_changes c
      where c.transaction_id=p.id and c.user_id=p.user_id),'[]'::jsonb)
  ) end;
$$;

-- Keep the public/cycle wrapper chain and its lock ordering unchanged; replace
-- only cashier's aggregate implementation behind the preserved signature.
create or replace function cashier_private.save_transaction_aggregate(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,p_settlement jsonb default null
) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
declare existing public.transactions; current_row public.transactions; base_result record; replay boolean;
  existing_found boolean;
  replace_settlement boolean:=p_settlement is not null; tender bigint; input_wallet uuid; input_amount bigint;
  normalized_changes jsonb:='[]'::jsonb; requested_snapshot jsonb; existing_snapshot jsonb;
  change_input jsonb; rate_input jsonb; receiver uuid; cash_change bigint; position integer:=0;
  rate_base public.currency; rate_quote public.currency; rate_n bigint; rate_d bigint;
  receiver_ids uuid[]:='{}'::uuid[]; require_active boolean;
begin
  if auth.uid() is null or p_id is null then raise exception using errcode='BT003',message='transaction conflict'; end if;
  begin
    input_wallet:=(p_input->>'walletId')::uuid;
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
    tender:=case when requested_snapshot is null then null else (requested_snapshot->>'tenderMinor')::bigint end;
  elsif p_settlement='{}'::jsonb then
    requested_snapshot:=null; tender:=null;
  else
    if jsonb_typeof(p_settlement)<>'object' or p_settlement-array['tenderMinor','changes']<>'{}'::jsonb
       or not (p_settlement ?& array['tenderMinor','changes'])
       or jsonb_typeof(p_settlement->'tenderMinor')<>'number'
       or jsonb_typeof(p_settlement->'changes')<>'array' then raise exception 'invalid settlement'; end if;
    begin tender:=(p_settlement->>'tenderMinor')::bigint; exception when others then raise exception 'invalid settlement'; end;
    if tender not between 1 and 1000000000000000 then raise exception 'invalid settlement'; end if;
    for change_input in select value from jsonb_array_elements(p_settlement->'changes') loop
      rate_base:=null;rate_quote:=null;rate_n:=null;rate_d:=null;
      if jsonb_typeof(change_input)<>'object' or change_input-array['walletId','amountMinor','rate']<>'{}'::jsonb
         or not (change_input ?& array['walletId','amountMinor'])
         or jsonb_typeof(change_input->'walletId')<>'string'
         or jsonb_typeof(change_input->'amountMinor')<>'number' then raise exception 'invalid settlement'; end if;
      begin receiver:=(change_input->>'walletId')::uuid; cash_change:=(change_input->>'amountMinor')::bigint;
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
          rate_base:=(rate_input->>'base')::public.currency;rate_quote:=(rate_input->>'quote')::public.currency;
          rate_n:=(rate_input->>'quoteMajorNumerator')::bigint;rate_d:=(rate_input->>'quoteMajorDenominator')::bigint;
        exception when others then raise exception 'invalid settlement rate'; end;
      end if;
      normalized_changes:=normalized_changes||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'walletId',receiver,'amountMinor',cash_change,
        'rate',case when rate_base is null then null else jsonb_build_object('base',rate_base,'quote',rate_quote,
          'quoteMajorNumerator',rate_n,'quoteMajorDenominator',rate_d) end)));
    end loop;
    requested_snapshot:=jsonb_build_object('tenderMinor',tender,'changes',normalized_changes);
  end if;

  if replay and existing_snapshot is distinct from requested_snapshot then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  select coalesce(array_agg((x.value->>'walletId')::uuid order by x.ordinality),'{}'::uuid[])
    into receiver_ids from jsonb_array_elements(normalized_changes) with ordinality x(value,ordinality);
  perform w.id from public.wallets w where w.id in (
    select existing.wallet_id union select existing.to_wallet_id
    union select c.wallet_id from public.cashier_changes c where c.transaction_id=p_id and c.user_id=auth.uid()
    union select input_wallet union select unnest(receiver_ids)
  ) order by w.id for update;
  if exists(select 1 from unnest(receiver_ids) x(id) where not exists(
    select 1 from public.wallets w where w.id=x.id and w.user_id=auth.uid())) then raise exception 'wallet unavailable'; end if;
  require_active:=not replay and (not existing_found or existing.wallet_id is distinct from input_wallet
    or existing.amount_minor is distinct from input_amount or existing_snapshot is distinct from requested_snapshot);
  if require_active and exists(select 1 from jsonb_array_elements(normalized_changes) x(value) where x.value ? 'rate') then
    raise exception 'invalid settlement rate';
  end if;
  if require_active and exists(select 1 from unnest(receiver_ids) x(id) join public.wallets w on w.id=x.id
    where w.archived_at is not null) then raise exception 'wallet unavailable'; end if;

  select * into base_result from transaction_private.save_transaction_rows(p_id,p_expected_revision,p_input,p_items);
  if not replay and replace_settlement then
    update public.transactions t set tender_minor=tender,change_wallet_ids=receiver_ids,
      change_wallet_id=null,change_minor=null,change_currency=null,change_rate_base=null,change_rate_quote=null,
      change_rate_numerator=null,change_rate_denominator=null where t.id=base_result.id and t.user_id=auth.uid();
    delete from public.cashier_changes c where c.transaction_id=base_result.id and c.user_id=auth.uid();
    position:=0;
    for change_input in select value from jsonb_array_elements(normalized_changes) loop
      receiver:=(change_input->>'walletId')::uuid;cash_change:=(change_input->>'amountMinor')::bigint;
      rate_input:=change_input->'rate';
      insert into public.cashier_changes(user_id,transaction_id,wallet_id,amount_minor,currency,position,
        rate_base,rate_quote,rate_numerator,rate_denominator)
      select auth.uid(),base_result.id,receiver,cash_change,w.currency,position,
        case when rate_input is null then null else (rate_input->>'base')::public.currency end,
        case when rate_input is null then null else (rate_input->>'quote')::public.currency end,
        case when rate_input is null then null else (rate_input->>'quoteMajorNumerator')::bigint end,
        case when rate_input is null then null else (rate_input->>'quoteMajorDenominator')::bigint end
      from public.wallets w where w.id=receiver and w.user_id=auth.uid();
      position:=position+1;
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

-- Preserve the final loan-aware balance formula and replace only cashier credit.
create or replace view public.wallet_balances with(security_invoker=true) as
select w.id as wallet_id,w.user_id,w.opening_balance_minor
  +coalesce((select sum(case
    when t.kind::text='income' then t.amount_minor
    when t.kind::text='loan' and t.loan_flow='in' then t.amount_minor
    when t.kind::text='expense' then -coalesce(t.tender_minor,t.amount_minor)
    else -t.amount_minor end) from public.transactions t where t.wallet_id=w.id and t.deleted_at is null),0)
  +coalesce((select sum(t.to_amount_minor) from public.transactions t
    where t.to_wallet_id=w.id and t.kind::text='transfer' and t.deleted_at is null),0)
  +coalesce((select sum(c.amount_minor) from public.cashier_changes c join public.transactions t
    on t.id=c.transaction_id and t.user_id=c.user_id
    where c.wallet_id=w.id and t.kind::text='expense' and t.deleted_at is null),0) as balance_minor
from public.wallets w;

-- Retained child references protect physical wallet deletion.
create or replace function public.delete_wallet(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare caller uuid:=auth.uid(); w public.wallets;
begin
  if caller is null or p_id is null then raise exception 'wallet.invalid'; end if;
  perform 1 from public.profiles p where p.user_id=caller for update;
  if not found then raise exception 'wallet.invalid'; end if;
  select x.* into w from public.wallets x where x.id=p_id and x.user_id=caller for update;
  if not found or w.archived_at is null then raise exception 'wallet.invalid'; end if;
  if exists(select 1 from public.transactions t where t.wallet_id=p_id or t.to_wallet_id=p_id)
     or exists(select 1 from public.cashier_changes c where c.wallet_id=p_id) then raise exception 'wallet.hasTransactions'; end if;
  if exists(select 1 from public.fixed_expenses f where f.wallet_id=p_id)
    or exists(select 1 from public.installments i where i.wallet_id=p_id)
    or exists(select 1 from public.loans l where l.wallet_id=p_id) then raise exception 'wallet.inUse'; end if;
  update public.profiles p set salary_amount_minor=null,salary_wallet_id=null where p.user_id=caller and p.salary_wallet_id=p_id;
  delete from public.wallets x where x.id=p_id and x.user_id=caller;
  if not found then raise exception 'wallet.invalid'; end if;
end;
$$;

revoke execute on function public.cashier_changes_guard(),public.transactions_cashier_wallets(),
  public.transactions_cashier_check(),public.wallets_cashier_currency_locked() from public,anon,authenticated;
revoke all on function public.cashier_snapshot(public.transactions) from public,anon;
grant execute on function public.cashier_snapshot(public.transactions) to authenticated;
