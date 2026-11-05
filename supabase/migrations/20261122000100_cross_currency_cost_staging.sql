-- Stage the requested effective cost, then normalize it against the payer
-- currency derived under the existing aggregate's deterministic wallet lock.
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

create or replace function cashier_private.save_transaction_aggregate(
  p_id uuid,p_expected_revision integer,p_input jsonb,p_items jsonb,p_settlement jsonb default null
) returns table(id uuid,revision integer)
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); existing public.transactions;
  requested_cost public.currency; stripped_input jsonb; result record;
  explicit_cost boolean; replay boolean; existing_found boolean;
  effective_existing public.currency; input_wallet uuid;
begin
  if owner_id is null or p_id is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  explicit_cost:=p_input ? 'costCurrency';
  if explicit_cost and jsonb_typeof(p_input->'costCurrency') is distinct from 'string' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  begin
    input_wallet:=(p_input->>'walletId')::uuid;
    if explicit_cost then requested_cost:=(p_input->>'costCurrency')::public.currency; end if;
  exception when others then
    raise exception using errcode='22023',message='invalid transaction input';
  end;
  if not exists(select 1 from public.wallets w where w.id=input_wallet and w.user_id=owner_id) then
    raise exception 'wallet unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select t.* into existing from public.transactions t where t.id=p_id and t.user_id=owner_id for update;
  existing_found:=found;
  replay:=existing_found and p_expected_revision is null;
  if existing_found then effective_existing:=coalesce(existing.cost_currency,existing.currency); end if;
  if not explicit_cost and existing_found then requested_cost:=effective_existing; end if;
  -- NULL on create means follow the locked payer currency. Updates stage the
  -- preserved effective cost even when the caller omits costCurrency.
  if replay and requested_cost is distinct from effective_existing then
    raise exception using errcode='BT003',message='transaction conflict';
  end if;
  if existing_found and p_expected_revision is not null
     and requested_cost is distinct from effective_existing then
    if exists(select 1 from public.wallets w
      where w.user_id=owner_id and w.archived_at is not null
        and w.id=any(array[existing.wallet_id]||coalesce(existing.change_wallet_ids,'{}'::uuid[]))) then
      raise exception 'wallet unavailable';
    end if;
    if (p_settlement is null and exists(select 1 from public.cashier_changes c
          where c.transaction_id=p_id and c.user_id=owner_id and c.rate_base is not null))
       or (p_settlement is not null and jsonb_path_exists(p_settlement,'$.changes[*].rate')) then
      raise exception 'invalid settlement rate';
    end if;
  end if;

  insert into cashier_private.pending_transaction_costs(transaction_id,user_id,cost_currency)
    values(p_id,owner_id,requested_cost)
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

revoke execute on function cashier_private.apply_pending_transaction_cost() from public,anon,authenticated;
revoke execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb) from public,anon;
grant execute on function cashier_private.save_transaction_aggregate(uuid,integer,jsonb,jsonb,jsonb) to authenticated;
