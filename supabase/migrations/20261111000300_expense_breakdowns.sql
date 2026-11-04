-- Descriptive, one-level expense composition. Only transactions affect money.
-- This migration deliberately leaves the existing category/currency/source
-- integrity functions and wallet/budget projections in place.

alter table public.transactions
  add column revision integer not null default 1 check (revision > 0),
  add constraint transactions_id_user_key unique (id, user_id);

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  description text not null check (
    description = btrim(description, E' \t\n\r\f\013')
    and char_length(description) between 1 and 140
  ),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  position smallint not null check (position between 0 and 49),
  constraint expense_items_transaction_owner_fkey foreign key (transaction_id, user_id)
    references public.transactions(id, user_id) on delete cascade,
  constraint expense_items_transaction_position_key unique (transaction_id, position)
);
create index expense_items_user_parent_idx on public.expense_items(user_id, transaction_id, position);

-- Private immutable creation receipts. Keep tombstones after a physical parent
-- purge; only actual account deletion removes them. Legacy rows are NOT backfilled.
create schema if not exists transaction_private;
revoke all on schema transaction_private from public,anon;
grant usage on schema transaction_private to authenticated;
create table transaction_private.transaction_creation_receipts (
  transaction_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  creation_revision integer not null check (creation_revision > 0),
  primary key(transaction_id,user_id)
);
alter table transaction_private.transaction_creation_receipts enable row level security;
revoke all on transaction_private.transaction_creation_receipts from public,anon,authenticated;
create function transaction_private.creation_receipts_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  raise exception using errcode='22023',message='creation receipt immutable';
end;
$$;
create trigger creation_receipts_immutable before update or delete on transaction_private.transaction_creation_receipts
  for each row execute function transaction_private.creation_receipts_immutable();
revoke execute on function transaction_private.creation_receipts_immutable() from public,anon,authenticated;

alter table public.expense_items enable row level security;
create policy expense_items_select on public.expense_items for select using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.transactions t where t.id = transaction_id
      and t.user_id = (select auth.uid()) and t.kind::text = 'expense' and t.deleted_at is null
  )
);
create policy expense_items_insert on public.expense_items for insert with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.transactions t where t.id = transaction_id
      and t.user_id = (select auth.uid()) and t.kind::text = 'expense' and t.deleted_at is null
  )
);
create policy expense_items_update on public.expense_items for update using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.transactions t where t.id = transaction_id
      and t.user_id = (select auth.uid()) and t.kind::text = 'expense' and t.deleted_at is null
  )
) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.transactions t where t.id = transaction_id
      and t.user_id = (select auth.uid()) and t.kind::text = 'expense' and t.deleted_at is null
  )
);
create policy expense_items_delete on public.expense_items for delete using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.transactions t where t.id = transaction_id
      and t.user_id = (select auth.uid()) and t.kind::text = 'expense' and t.deleted_at is null
  )
);
grant select, insert, update, delete on public.expense_items to authenticated;
revoke all on public.expense_items from anon;

create function public.transactions_revision_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception using errcode = '22023', message = 'transaction identity cannot change';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
create trigger transactions_revision
  before insert or update on public.transactions
  for each row execute function public.transactions_revision_guard();

-- A narrow definer trigger can see retained items even after soft deletion.
-- It cannot be invoked as an RPC and only inspects the triggering row's owner.
create function public.transactions_breakdown_currency_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  destination_currency public.currency;
begin
  if exists (select 1 from public.expense_items i where i.transaction_id = old.id and i.user_id = old.user_id) then
    select w.currency into destination_currency from public.wallets w
      where w.id = new.wallet_id and w.user_id = old.user_id;
    if not found then
      raise exception using errcode = 'BT003', message = 'transaction conflict';
    end if;
    if destination_currency is distinct from old.currency then
      raise exception using errcode = 'BT002', message = 'breakdown currency locked';
    end if;
  end if;
  return new;
end;
$$;
create trigger transactions_breakdown_currency
  before update on public.transactions
  for each row execute function public.transactions_breakdown_currency_guard();

create function public.expense_items_lock_parent()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_id uuid;
  owner_id uuid;
  parent public.transactions%rowtype;
begin
  -- FK/account cascades must clean up even retained soft-deleted lines. A
  -- direct DELETE is depth 1 and still passes all normal ownership checks.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or new.transaction_id is distinct from old.transaction_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception using errcode = '22023', message = 'expense item identity cannot change';
  end if;
  if tg_op = 'DELETE' then parent_id := old.transaction_id; owner_id := old.user_id;
  else parent_id := new.transaction_id; owner_id := new.user_id; end if;
  select t.* into parent from public.transactions t
    where t.id = parent_id and t.user_id = owner_id for update;
  if not found then
    raise exception using errcode = 'BT003', message = 'transaction conflict';
  end if;
  if parent.deleted_at is not null or parent.kind::text <> 'expense' then
    raise exception using errcode = '22023', message = 'items require a live expense';
  end if;
  -- All authenticated direct line writes invalidate open whole-list editors.
  update public.transactions t set updated_at = now() where t.id = parent_id and t.user_id = owner_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger expense_items_lock_parent
  before insert or update or delete on public.expense_items
  for each row execute function public.expense_items_lock_parent();

create function public.expense_breakdown_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  parent_id uuid;
  owner_id uuid;
  parent public.transactions%rowtype;
  item_count bigint;
  total numeric;
begin
  if tg_table_name = 'transactions' then parent_id := new.id; owner_id := new.user_id;
  elsif tg_op = 'DELETE' then parent_id := old.transaction_id; owner_id := old.user_id;
  else parent_id := new.transaction_id; owner_id := new.user_id; end if;
  select t.* into parent from public.transactions t where t.id = parent_id and t.user_id = owner_id;
  if not found then return null; end if; -- Physical parent/account cascade.
  select count(*), coalesce(sum(i.amount_minor), 0) into item_count, total
    from public.expense_items i where i.transaction_id = parent_id and i.user_id = owner_id;
  if item_count > 50 or total > parent.amount_minor then
    raise exception using errcode = 'BT001', message = 'breakdown exceeds total';
  end if;
  if item_count > 0 and parent.kind::text <> 'expense' then
    raise exception using errcode = '22023', message = 'items require a live expense';
  end if;
  return null;
end;
$$;
create constraint trigger expense_items_valid
  after insert or update or delete on public.expense_items
  deferrable initially deferred for each row execute function public.expense_breakdown_check();
create constraint trigger transactions_breakdown_valid
  after insert or update on public.transactions
  deferrable initially deferred for each row execute function public.expense_breakdown_check();

-- Canonical manual expense/income aggregate save. Item 4 appends an optional
-- settlement parameter to this API; source generators keep their own inserts.
create function transaction_private.save_transaction_rows(
  p_id uuid,
  p_expected_revision integer,
  p_input jsonb,
  p_items jsonb
)
returns table (id uuid, revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  parent public.transactions%rowtype;
  inserted_id uuid;
  input_kind public.txn_kind;
  input_date date;
  input_wallet uuid;
  input_category uuid;
  input_amount numeric;
  input_note text;
  wallet_currency public.currency;
  wallet_archived timestamptz;
  category_kind text;
  normalized_items jsonb := '[]'::jsonb;
  existing_items jsonb;
  item jsonb;
  item_description text;
  item_amount numeric;
  item_total numeric := 0;
  item_position smallint := 0;
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  if p_id is null or (p_expected_revision is not null and p_expected_revision < 1)
    or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid transaction input';
  end if;
  if not (p_input ?& array['kind','occurredOn','walletId','amountMinor','categoryId'])
    or exists (select 1 from jsonb_object_keys(p_input) k where k <> all(array['kind','occurredOn','walletId','amountMinor','categoryId','note']))
    or jsonb_typeof(p_input->'kind') is distinct from 'string'
    or (p_input->>'kind') not in ('expense','income')
    or jsonb_typeof(p_input->'occurredOn') is distinct from 'string'
    or (p_input->>'occurredOn') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_input->'walletId') is distinct from 'string'
    or jsonb_typeof(p_input->'categoryId') is distinct from 'string'
    or jsonb_typeof(p_input->'amountMinor') is distinct from 'number'
    or (p_input ? 'note' and jsonb_typeof(p_input->'note') not in ('string','null')) then
    raise exception using errcode = '22023', message = 'invalid transaction input';
  end if;
  begin
    input_kind := (p_input->>'kind')::public.txn_kind;
    input_date := (p_input->>'occurredOn')::date;
    input_wallet := (p_input->>'walletId')::uuid;
    input_category := (p_input->>'categoryId')::uuid;
    input_amount := (p_input->>'amountMinor')::numeric;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'invalid transaction input';
  end;
  input_note := nullif(btrim(p_input->>'note', E' \t\n\r\f\013'), '');
  if input_date < date '2000-01-01' or input_amount < 1 or input_amount > 1000000000000000
    or input_amount <> trunc(input_amount) or char_length(input_note) > 140 then
    raise exception using errcode = '22023', message = 'invalid transaction input';
  end if;

  if p_items is not null then
    if jsonb_typeof(p_items) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid expense item';
    end if;
    if jsonb_array_length(p_items) > 50 then
      raise exception using errcode = '22023', message = 'invalid expense item';
    end if;
    for item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(item) is distinct from 'object' then
        raise exception using errcode = '22023', message = 'invalid expense item';
      end if;
      if not (item ?& array['description','amountMinor'])
        or exists (select 1 from jsonb_object_keys(item) k where k <> all(array['description','amountMinor']))
        or jsonb_typeof(item->'description') is distinct from 'string'
        or jsonb_typeof(item->'amountMinor') is distinct from 'number' then
        raise exception using errcode = '22023', message = 'invalid expense item';
      end if;
      item_description := btrim(item->>'description', E' \t\n\r\f\013');
      item_amount := (item->>'amountMinor')::numeric;
      if char_length(item_description) not between 1 and 140 or item_amount < 1
        or item_amount > 1000000000000000 or item_amount <> trunc(item_amount) then
        raise exception using errcode = '22023', message = 'invalid expense item';
      end if;
      item_total := item_total + item_amount;
      normalized_items := normalized_items || jsonb_build_array(jsonb_build_object('description',item_description,'amountMinor',item_amount::bigint));
    end loop;
    if item_total > input_amount then
      raise exception using errcode = 'BT001', message = 'breakdown exceeds total';
    end if;
    if input_kind::text <> 'expense' and jsonb_array_length(normalized_items) > 0 then
      raise exception using errcode = '22023', message = 'items require a live expense';
    end if;
  end if;

  if p_expected_revision is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-create:' || p_id::text, 0));
  end if;
  select t.* into parent from public.transactions t where t.id = p_id and t.user_id = owner_id for update;
  if found then
    if parent.deleted_at is not null then
      raise exception using errcode = 'BT003', message = 'transaction conflict';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('description',i.description,'amountMinor',i.amount_minor) order by i.position),'[]'::jsonb)
      into existing_items from public.expense_items i where i.transaction_id = p_id and i.user_id = owner_id;
    if p_expected_revision is null then
      if parent.source is not null or parent.fixed_expense_id is not null or parent.installment_id is not null
        or parent.kind is distinct from input_kind or parent.occurred_on is distinct from input_date
        or parent.wallet_id is distinct from input_wallet or parent.category_id is distinct from input_category
        or parent.amount_minor is distinct from input_amount or parent.note is distinct from input_note
        or existing_items is distinct from normalized_items then
        raise exception using errcode = 'BT003', message = 'transaction conflict';
      end if;
      return query select parent.id, parent.revision;
      return; -- Read-only identical replay, including a now-archived original wallet.
    end if;
    if parent.revision <> p_expected_revision or parent.kind::text not in ('expense','income') then
      raise exception using errcode = 'BT003', message = 'transaction conflict';
    end if;
    if parent.source is not null and parent.kind is distinct from input_kind then
      raise exception using errcode = '22023', message = 'source transaction kind cannot change';
    end if;
    -- The receipt aggregate runs with narrow definer capability to private
    -- storage. Every preserved monetary/source reference must still be owned.
    if not exists(select 1 from public.wallets w where w.id=parent.wallet_id and w.user_id=owner_id)
      or (parent.installment_id is not null and not exists(select 1 from public.installments i where i.id=parent.installment_id and i.user_id=owner_id))
      or (parent.fixed_expense_id is not null and not exists(select 1 from public.fixed_expenses f where f.id=parent.fixed_expense_id and f.user_id=owner_id)) then
      raise exception using errcode='BT003',message='transaction conflict';
    end if;
    if p_items is null then
      normalized_items := existing_items;
      select coalesce(sum(i.amount_minor),0) into item_total from public.expense_items i
        where i.transaction_id = p_id and i.user_id = owner_id;
      if item_total > input_amount then
        raise exception using errcode = 'BT001', message = 'breakdown exceeds total';
      end if;
      if input_kind::text <> 'expense' and jsonb_array_length(normalized_items) > 0 then
        raise exception using errcode = '22023', message = 'items require a live expense';
      end if;
    end if;
  elsif p_expected_revision is not null then
    raise exception using errcode = 'BT003', message = 'transaction conflict';
  end if;

  -- Explicit ownership checks complement RLS and keep privileged maintenance
  -- from associating another account's wallet/category with this parent.
  select w.currency,w.archived_at into wallet_currency,wallet_archived from public.wallets w
    where w.id = input_wallet and w.user_id = owner_id for update;
  if not found or (wallet_archived is not null and (p_expected_revision is null or input_wallet is distinct from parent.wallet_id)) then
    raise exception using errcode = '22023', message = 'wallet unavailable';
  end if;
  select c.kind::text into category_kind from public.categories c where c.id = input_category and c.user_id = owner_id;
  if not found or category_kind <> input_kind::text then
    raise exception using errcode = '22023', message = 'category unavailable';
  end if;
  if p_expected_revision is not null and jsonb_array_length(existing_items) > 0
    and wallet_currency is distinct from parent.currency then
    raise exception using errcode = 'BT002', message = 'breakdown currency locked';
  end if;

  if p_expected_revision is null then
    insert into public.transactions as t (id,user_id,kind,occurred_on,wallet_id,amount_minor,currency,category_id,note)
      values (p_id,owner_id,input_kind,input_date,input_wallet,input_amount::bigint,wallet_currency,input_category,input_note)
      on conflict on constraint transactions_pkey do nothing returning t.id into inserted_id;
    if inserted_id is null then
      raise exception using errcode = 'BT003', message = 'transaction conflict';
    end if;
  else
    if p_items is not null then delete from public.expense_items i where i.transaction_id = p_id and i.user_id = owner_id; end if;
    update public.transactions t set kind=input_kind,occurred_on=input_date,wallet_id=input_wallet,
      amount_minor=input_amount::bigint,category_id=input_category,note=input_note
      where t.id=p_id and t.user_id=owner_id;
  end if;
  if p_expected_revision is null or p_items is not null then
    for item in select value from jsonb_array_elements(normalized_items) loop
      insert into public.expense_items(user_id,transaction_id,description,amount_minor,position)
        values (owner_id,p_id,item->>'description',(item->>'amountMinor')::bigint,item_position);
      item_position := item_position + 1;
    end loop;
  end if;
  -- Surface deferred invariant failures inside the RPC/savepoint, not after a
  -- reported result; all parent/child mutations still share one transaction.
  set constraints public.expense_items_valid, public.transactions_breakdown_valid immediate;
  set constraints public.expense_items_valid, public.transactions_breakdown_valid deferred;
  return query select t.id,t.revision from public.transactions t where t.id=p_id and t.user_id=owner_id;
end;
$$;

-- Only complete aggregate entry points may call the unreceipted row writer.
revoke execute on function transaction_private.save_transaction_rows(uuid,integer,jsonb,jsonb) from public,anon,authenticated;
create function transaction_private.save_transaction(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb
) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); current_row public.transactions; replay boolean; result record;
begin
  if caller is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_id is null then raise exception using errcode='22023',message='invalid transaction input'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transaction-create:'||p_id::text,0));
  select t.* into current_row from public.transactions t where t.id=p_id and t.user_id=caller for update;
  replay:=found and p_expected_revision is null;
  if p_expected_revision is null then
    if replay then
      if current_row.deleted_at is not null or not exists(
        select 1 from transaction_private.transaction_creation_receipts r where r.transaction_id=p_id
          and r.user_id=caller and r.creation_revision=current_row.revision
      ) then raise exception using errcode='BT003',message='transaction conflict'; end if;
    elsif exists(select 1 from transaction_private.transaction_creation_receipts r where r.transaction_id=p_id and r.user_id=caller) then
      raise exception using errcode='BT003',message='transaction conflict';
    end if;
  end if;
  select * into result from transaction_private.save_transaction_rows(p_id,p_expected_revision,p_input,p_items);
  if p_expected_revision is null and not replay then
    insert into transaction_private.transaction_creation_receipts(transaction_id,user_id,creation_revision)
      values(p_id,caller,result.revision);
  end if;
  return query select result.id,result.revision;
end;
$$;
revoke execute on function transaction_private.save_transaction(uuid,integer,jsonb,jsonb) from public,anon;
grant execute on function transaction_private.save_transaction(uuid,integer,jsonb,jsonb) to authenticated;
create function public.save_transaction(p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb)
returns table(id uuid,revision integer) language sql security invoker set search_path='' as $$
  select r.id,r.revision from transaction_private.save_transaction(p_id,p_expected_revision,p_input,p_items) r;
$$;

create function public.set_transaction_deleted(p_id uuid,p_expected_revision integer,p_deleted boolean)
returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  parent public.transactions%rowtype;
begin
  if owner_id is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision < 1 or p_deleted is null then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  select t.* into parent from public.transactions t where t.id=p_id and t.user_id=owner_id for update;
  if not found or parent.revision <> p_expected_revision then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  if (parent.deleted_at is not null) = p_deleted then
    return query select parent.id,parent.revision;
    return;
  end if;
  update public.transactions t set deleted_at=case when p_deleted then now() else null end
    where t.id=p_id and t.user_id=owner_id;
  set constraints public.expense_items_valid, public.transactions_breakdown_valid immediate;
  set constraints public.expense_items_valid, public.transactions_breakdown_valid deferred;
  return query select t.id,t.revision from public.transactions t where t.id=p_id and t.user_id=owner_id;
end;
$$;

revoke execute on function public.transactions_revision_guard() from public,anon,authenticated;
revoke execute on function public.transactions_breakdown_currency_guard() from public,anon,authenticated;
revoke execute on function public.expense_items_lock_parent() from public,anon,authenticated;
revoke execute on function public.expense_breakdown_check() from public,anon,authenticated;
revoke execute on function public.save_transaction(uuid,integer,jsonb,jsonb) from public,anon;
revoke execute on function public.set_transaction_deleted(uuid,integer,boolean) from public,anon;
grant execute on function public.save_transaction(uuid,integer,jsonb,jsonb) to authenticated;
grant execute on function public.set_transaction_deleted(uuid,integer,boolean) to authenticated;

-- Revision-bearing transfer boundary. Preserve the currency writer and its
-- profile-first -> ordered-wallet lock order; only enrich its atomic result.
create schema if not exists transaction_private;
revoke all on schema transaction_private from public,anon;
grant usage on schema transaction_private to authenticated;
alter function public.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) set schema transaction_private;
revoke execute on function transaction_private.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) from public,anon;
grant execute on function transaction_private.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) to authenticated;

create function public.record_transfer(
  p_occurred_on date,
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_from_amount_minor bigint,
  p_to_amount_minor bigint,
  p_note text default null,
  p_usd_lbp_rate integer default null
) returns table(id uuid,revision integer)
language plpgsql security invoker set search_path = '' as $$
declare created_id uuid;
begin
  select transaction_private.record_transfer(p_occurred_on,p_from_wallet_id,p_to_wallet_id,
    p_from_amount_minor,p_to_amount_minor,p_note,p_usd_lbp_rate) into created_id;
  return query select t.id,t.revision from public.transactions t
    where t.id=created_id and t.user_id=auth.uid();
  if not found then raise exception using errcode='BT003',message='transaction conflict'; end if;
end;
$$;
revoke execute on function public.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) from public,anon;
grant execute on function public.record_transfer(date,uuid,uuid,bigint,bigint,text,integer) to authenticated;
