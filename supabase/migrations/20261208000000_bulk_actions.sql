-- Bulk actions. Every batch is ONE function call, so one statement and one
-- transaction: any failing row raises and the whole batch rolls back. Nothing
-- here reimplements a single-row rule; each loop delegates to the existing
-- canonical entry point (exact-revision delete/restore, remove_category,
-- update_pending_payment) so the per-row guards, locks and triggers still decide.
-- Rows are processed in id order so two overlapping batches take row locks in
-- the same order.

-- Delete or restore (Undo) several activity rows. p_items is
-- [{"id": uuid, "revision": int}, ...] with the revision each row was read at;
-- the result carries the new revision of every row, which is what Undo sends back.
-- A managed loan movement, a stale revision or any other refusal of the
-- single-row function aborts the whole batch with that function's own error.
create function public.set_transactions_deleted(p_items jsonb, p_deleted boolean)
returns table(id uuid, revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  item record;
  item_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_deleted is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 200
     or exists(select 1 from jsonb_to_recordset(p_items) as x(id uuid, revision integer)
               where x.id is null or x.revision is null or x.revision < 1)
     or (select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid, revision integer)) <> item_count then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  for item in
    select x.id as item_id, x.revision as item_revision
    from jsonb_to_recordset(p_items) as x(id uuid, revision integer) order by x.id
  loop
    return query select r.id, r.revision
      from public.set_transaction_deleted(item.item_id, item.item_revision, p_deleted) r;
  end loop;
end;
$$;

-- Move several plain expenses, or several plain incomes, to one category.
-- "Plain" means entered by hand: not a salary, fixed-expense, installment or
-- loan row, whose category belongs to its own screen. (A client-payment receipt
-- is ordinary income that Activity already lets you edit, so it qualifies.) The
-- category must be live and of the same kind as every row. Amounts, wallets, dates,
-- items and cashier settlements are untouched; the row triggers still run and
-- bump each revision.
create function public.set_transactions_category(p_items jsonb, p_category_id uuid)
returns table(id uuid, revision integer)
language plpgsql security invoker set search_path = '' as $$
declare
  item record;
  parent record;
  target record;
  item_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if p_category_id is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 200
     or exists(select 1 from jsonb_to_recordset(p_items) as x(id uuid, revision integer)
               where x.id is null or x.revision is null or x.revision < 1)
     or (select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid, revision integer)) <> item_count then
    raise exception using errcode='22023',message='invalid transaction input';
  end if;
  select c.id, c.kind::text as kind, c.archived_at into target
    from public.categories c where c.id = p_category_id and c.user_id = auth.uid() for share;
  if not found or target.archived_at is not null then raise exception 'category_unavailable'; end if;
  for item in
    select x.id as item_id, x.revision as item_revision
    from jsonb_to_recordset(p_items) as x(id uuid, revision integer) order by x.id
  loop
    -- Same lock order as every other transaction write: profile, then the row.
    perform cycle_private.lock_transaction_scope(item.item_id);
    select t.revision, t.kind::text as kind, t.deleted_at, t.source, t.installment_id,
           t.fixed_expense_id, t.loan_id, t.category_id
      into parent
      from public.transactions t where t.id = item.item_id and t.user_id = auth.uid() for update;
    if not found or parent.revision <> item.item_revision or parent.deleted_at is not null then
      raise exception using errcode='BT003',message='transaction conflict';
    end if;
    if parent.kind not in ('expense','income') or parent.kind <> target.kind
       or parent.source is not null or parent.installment_id is not null or parent.fixed_expense_id is not null
       or parent.loan_id is not null then
      raise exception using errcode='22023',message='invalid transaction input';
    end if;
    if parent.category_id is distinct from p_category_id then
      update public.transactions t set category_id = p_category_id
        where t.id = item.item_id and t.user_id = auth.uid();
    end if;
    return query select t.id, t.revision from public.transactions t
      where t.id = item.item_id and t.user_id = auth.uid();
  end loop;
end;
$$;

-- Remove several categories: each one is deleted when unused or archived when
-- it has history, exactly as remove_category decides. One that is still used by
-- a fixed expense, installment or open loan stops the whole batch, and the
-- error detail names it so the screen can say which one.
create function public.remove_categories(p_ids uuid[])
returns table(id uuid, outcome text)
language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
  ordered uuid[];
begin
  if auth.uid() is null then raise exception 'category_not_found'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'category_not_found';
  end if;
  select array_agg(x order by x) into ordered from unnest(p_ids) x;
  foreach target in array ordered loop
    begin
      id := target;
      outcome := public.remove_category(target);
    exception when raise_exception then
      if sqlerrm = 'category_in_use' then
        raise exception 'category_in_use' using detail = target::text;
      end if;
      raise;
    end;
    return next;
  end loop;
end;
$$;

-- Delete several client payments that never received money. p_items is
-- [{"id": uuid, "revision": int}, ...]. A payment with receipts, or a stale
-- revision, stops the whole batch through update_pending_payment's own rules.
create function public.delete_pending_payments(p_items jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  item record;
  item_count integer;
begin
  if auth.uid() is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'pending.invalid'; end if;
  item_count := jsonb_array_length(p_items);
  if item_count < 1 or item_count > 100
     or exists(select 1 from jsonb_to_recordset(p_items) as x(id uuid, revision integer)
               where x.id is null or x.revision is null or x.revision < 1)
     or (select count(distinct x.id) from jsonb_to_recordset(p_items) as x(id uuid, revision integer)) <> item_count then
    raise exception 'pending.invalid';
  end if;
  for item in
    select x.id as item_id, x.revision as item_revision
    from jsonb_to_recordset(p_items) as x(id uuid, revision integer) order by x.id
  loop
    perform public.update_pending_payment(item.item_id, item.item_revision, '{}'::jsonb, true);
  end loop;
end;
$$;

revoke execute on function public.set_transactions_deleted(jsonb, boolean),
  public.set_transactions_category(jsonb, uuid),
  public.remove_categories(uuid[]),
  public.delete_pending_payments(jsonb) from public, anon;
grant execute on function public.set_transactions_deleted(jsonb, boolean),
  public.set_transactions_category(jsonb, uuid),
  public.remove_categories(uuid[]),
  public.delete_pending_payments(jsonb) to authenticated;
