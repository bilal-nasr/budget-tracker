-- Invoices: bulk actions on rows, and paying rows.
--
-- Bulk: delete, move to a category and Undo for many rows, each as ONE statement inside one
-- function call, so a batch is atomic and costs one round trip. They run with the caller's
-- rights, so row level security decides what a person can touch, exactly as for single rows.
--
-- Paying: a row can be marked paid by an ordinary expense in the payer's own ledger, the same
-- idea as shopping_items.bought_transaction_id. The expense itself is recorded through
-- public.save_transaction (the app's one transaction mutation path); here the row only links
-- to it. A row counts as paid only while that expense is live: deleting the expense in
-- Activity (or Undo) un-marks the row, and restoring it marks the row again.
--
-- A shared folder's people cannot read the payer's transactions, so the marker is kept on the
-- row itself: who (paid_by) and when (paid_on = the expense's date, paid_at = when it was
-- marked). No wallet, balance or amount of the payer is copied. paid_transaction_id is an
-- opaque id that other people cannot read anything through (transactions stay behind RLS).
--
-- Clients never decide the marker: on every change of these columns invoice_items_integrity
-- recomputes paid_by / paid_on / paid_at from the linked expense, refuses a link to anything
-- but the caller's own live expense, and refuses to replace or clear a link whose expense is
-- still live. A paid row's name, price, quantity and currency are frozen (it is a record of
-- what was paid; correct the expense in Activity instead); its category can still change and
-- it can still be deleted, which never touches Activity.

alter table public.invoice_items
  add column paid_transaction_id uuid references public.transactions(id) on delete set null,
  add column paid_by uuid references auth.users(id) on delete set null,
  add column paid_on date,
  add column paid_at timestamptz,
  add constraint invoice_items_paid_check
    check (paid_on is null or (paid_transaction_id is not null and paid_at is not null));
create index invoice_items_paid_transaction on public.invoice_items(paid_transaction_id) where paid_transaction_id is not null;
create index invoice_items_paid_by on public.invoice_items(paid_by) where paid_by is not null;

-- Undo of a delete returns a paid row still paid (when its expense still exists).
alter table public.invoice_item_tombstones
  add column paid_transaction_id uuid,
  add column paid_at timestamptz;

-- The latest invoice_items_integrity (20261204000000) plus the paid marker.
create or replace function public.invoice_items_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); restored public.invoice_item_tombstones; is_restore boolean := false;
  paid_touched boolean := false; v_owner uuid; v_on date; v_deleted timestamptz; v_marked timestamptz;
begin
  if tg_op = 'UPDATE' then
    paid_touched := (new.paid_transaction_id, new.paid_by, new.paid_on, new.paid_at)
      is distinct from (old.paid_transaction_id, old.paid_by, old.paid_on, old.paid_at);
  end if;
  -- Deleting an account clears its authorship through ON DELETE SET NULL; allow exactly that.
  if tg_op = 'UPDATE' and not paid_touched
    and (new.id, new.folder_id, new.category_id, new.name, new.currency, new.decimal_places, new.price_minor, new.quantity, new.created_at, new.updated_at)
      is not distinct from (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.quantity, old.created_at, old.updated_at)
    and (new.created_by is not distinct from old.created_by
      or (new.created_by is null and not exists(select 1 from auth.users u where u.id = old.created_by)))
    and (new.updated_by is not distinct from old.updated_by
      or (new.updated_by is null and not exists(select 1 from auth.users u where u.id = old.updated_by))) then
    return new;
  end if;

  -- The paid marker. It changes on its own, never together with an edit, and it is written by
  -- mark_invoice_items_paid (a new link), by transactions_sync_invoice_paid (the expense was
  -- deleted, restored or re-dated) and by ON DELETE SET NULL (the expense or the payer's
  -- account is gone). Whoever writes it, the values are recomputed here from the expense.
  -- No membership check: a payer who left the folder can still delete their expense, and a new
  -- link is already limited to members by row level security.
  if paid_touched then
    if (new.id, new.folder_id, new.category_id, new.name, new.currency, new.decimal_places, new.price_minor, new.quantity, new.created_by, new.updated_by, new.created_at)
      is distinct from (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.quantity, old.created_by, old.updated_by, old.created_at) then
      raise exception 'invoices.invalid';
    end if;
    v_marked := old.paid_at;
    if new.paid_transaction_id is distinct from old.paid_transaction_id then
      -- A row paid by a live expense keeps that link until the expense is deleted.
      if exists(select 1 from public.transactions t where t.id = old.paid_transaction_id and t.deleted_at is null) then
        raise exception 'invoices.paid';
      end if;
      if new.paid_transaction_id is not null and (uid is null or not exists(select 1 from public.transactions t
        where t.id = new.paid_transaction_id and t.user_id = uid and t.kind::text = 'expense' and t.deleted_at is null)) then
        raise exception using errcode = '42501', message = 'invoices.invalid';
      end if;
      v_marked := null;
    end if;
    select t.user_id, t.occurred_on, t.deleted_at into v_owner, v_on, v_deleted
      from public.transactions t where t.id = new.paid_transaction_id;
    if not found then
      new.paid_transaction_id := null; new.paid_by := null; new.paid_on := null; new.paid_at := null;
    else
      -- A payer whose account is being deleted shows as "Former member".
      new.paid_by := (select u.id from auth.users u where u.id = v_owner);
      if v_deleted is null then
        new.paid_on := v_on; new.paid_at := coalesce(v_marked, clock_timestamp());
      else
        new.paid_on := null; new.paid_at := null;
      end if;
    end if;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    return new;
  end if;

  if uid is null then raise exception 'invoices.invalid'; end if;
  if tg_op = 'INSERT' then
    select t.* into restored from public.invoice_item_tombstones t
      where t.id = new.id and t.restoring_txid = txid_current();
    if found then
      is_restore := true;
      new.folder_id := restored.folder_id;
      new.name := restored.name;
      new.currency := restored.currency;
      new.decimal_places := restored.decimal_places;
      new.price_minor := restored.price_minor;
      new.quantity := restored.quantity;
      new.created_at := restored.created_at;
      new.updated_at := restored.updated_at;
      new.category_id := coalesce(
        (select c.id from public.invoice_categories c where c.id = restored.category_id and c.folder_id = restored.folder_id),
        public.invoice_default_category(restored.folder_id));
      -- An author whose account was deleted since shows as "Former member".
      new.created_by := (select u.id from auth.users u where u.id = restored.created_by);
      new.updated_by := (select u.id from auth.users u where u.id = restored.updated_by);
      -- Still paid if its expense still exists; paid_on follows whether that expense is live.
      new.paid_transaction_id := null; new.paid_by := null; new.paid_on := null; new.paid_at := null;
      select t.user_id, t.occurred_on, t.deleted_at into v_owner, v_on, v_deleted
        from public.transactions t where t.id = restored.paid_transaction_id;
      if found then
        new.paid_transaction_id := restored.paid_transaction_id;
        new.paid_by := (select u.id from auth.users u where u.id = v_owner);
        if v_deleted is null then
          new.paid_on := v_on; new.paid_at := coalesce(restored.paid_at, clock_timestamp());
        end if;
      end if;
    else
      -- While a deleted row's Undo is open its id belongs to its tombstone (see
      -- invoice_items_id_guard in 20261201000100 for why and what it means for retries).
      if exists(select 1 from public.invoice_item_tombstones t
        where t.id = new.id and public.invoice_item_restorable(t.deleted_at)) then
        raise exception using errcode = '42501', message = 'invoices.invalid';
      end if;
      -- A new row is never born paid.
      new.paid_transaction_id := null; new.paid_by := null; new.paid_on := null; new.paid_at := null;
    end if;
  end if;
  if not public.is_invoice_member(new.folder_id) then
    raise exception using errcode = '42501', message = 'invoices.invalid';
  end if;
  new.name := btrim(new.name);
  if new.category_id is null then new.category_id := public.invoice_default_category(new.folder_id); end if;
  if tg_op = 'INSERT' then
    -- Serialize adds to one folder so the cap holds; NO KEY UPDATE does not block FK checks.
    perform 1 from public.invoice_folders f where f.id = new.folder_id for no key update;
    if (select count(*) from public.invoice_items i where i.folder_id = new.folder_id) >= 500 then
      raise exception 'invoices.limit';
    end if;
    if not is_restore then
      new.created_by := uid;
      new.updated_by := null;
      new.created_at := now();
      new.updated_at := now();
    end if;
  else
    if (new.id, new.folder_id, new.created_by, new.created_at) is distinct from (old.id, old.folder_id, old.created_by, old.created_at) then
      raise exception 'invoices.invalid';
    end if;
    -- A paid row is a record of what was paid: only its category may change.
    if old.paid_on is not null
      and (new.name, new.currency, new.decimal_places, new.price_minor, new.quantity)
        is distinct from (old.name, old.currency, old.decimal_places, old.price_minor, old.quantity) then
      raise exception 'invoices.paid';
    end if;
    new.updated_by := uid;
    -- Strictly later than the version it replaces (see invoice_folders_integrity); the screen
    -- compares versions to the microsecond and ignores one that is not newer.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;

-- Deleted rows remember their payment for Undo.
create or replace function public.invoice_items_tombstone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.invoice_folders f where f.id = old.folder_id) then return null; end if;
  insert into public.invoice_item_tombstones(id, folder_id, category_id, name, currency, decimal_places, price_minor, quantity,
    created_by, updated_by, created_at, updated_at, deleted_by, deleted_at, paid_transaction_id, paid_at)
  values (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.quantity,
    old.created_by, old.updated_by, old.created_at, old.updated_at, auth.uid(), now(), old.paid_transaction_id, old.paid_at)
  on conflict (id) do update set folder_id = excluded.folder_id, category_id = excluded.category_id, name = excluded.name,
    currency = excluded.currency, decimal_places = excluded.decimal_places, price_minor = excluded.price_minor,
    quantity = excluded.quantity, created_by = excluded.created_by, updated_by = excluded.updated_by,
    created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_by = excluded.deleted_by,
    deleted_at = excluded.deleted_at, restoring_txid = null,
    paid_transaction_id = excluded.paid_transaction_id, paid_at = excluded.paid_at
    where public.invoice_item_tombstones.folder_id = excluded.folder_id;
  return null;
end $$;

-- The expense behind paid rows was deleted, restored or re-dated in Activity: the rows follow.
-- The update only touches the marker; invoice_items_integrity recomputes it from the expense.
-- SECURITY DEFINER because the payer may no longer be in the folder. It can only ever reach
-- rows already linked to this very transaction.
create function public.transactions_sync_invoice_paid() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.invoice_items i
    set paid_on = case when new.deleted_at is null then new.occurred_on end
    where i.paid_transaction_id = new.id
      and i.paid_on is distinct from (case when new.deleted_at is null then new.occurred_on end);
  return null;
end $$;
create trigger transactions_sync_invoice_paid after update on public.transactions
  for each row when (old.deleted_at is distinct from new.deleted_at or old.occurred_on is distinct from new.occurred_on)
  execute function public.transactions_sync_invoice_paid();
revoke execute on function public.transactions_sync_invoice_paid() from public, anon, authenticated;

-- Marks rows of one folder as paid by the caller's own live expense. All or nothing: every row
-- must still be there, in one currency the caller has enabled with the same decimals, not paid
-- by another live expense, and the rows' total (price x quantity) must be exactly what the
-- expense cost. Calling it again with the same expense is a quiet no-op (a retry).
create function public.mark_invoice_items_paid(p_folder uuid, p_items uuid[], p_transaction uuid)
returns table(id uuid, updated_at timestamptz, paid_on date, paid_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid(); v_currency text; v_amount bigint;
  n_rows bigint; n_units bigint; n_taken bigint; v_code text; v_decimals smallint; v_total numeric;
begin
  if uid is null or p_folder is null or p_transaction is null or p_items is null
    or cardinality(p_items) not between 1 and 50
    or (select count(distinct x) from unnest(p_items) x) <> cardinality(p_items) then
    raise exception 'invoices.invalid';
  end if;
  select coalesce(t.cost_currency::text, t.currency::text), t.amount_minor into v_currency, v_amount
    from public.transactions t
    where t.id = p_transaction and t.user_id = uid and t.kind::text = 'expense' and t.deleted_at is null;
  if not found then raise exception 'invoices.invalid'; end if;
  -- Lock the rows in id order, so two people paying overlapping rows cannot deadlock.
  perform 1 from public.invoice_items i where i.folder_id = p_folder and i.id = any(p_items) order by i.id for update;
  select count(*), count(distinct i.currency || ':' || i.decimal_places::text), min(i.currency), min(i.decimal_places),
      sum(i.price_minor::numeric * i.quantity),
      count(*) filter (where i.paid_on is not null and i.paid_transaction_id is distinct from p_transaction)
    into n_rows, n_units, v_code, v_decimals, v_total, n_taken
    from public.invoice_items i where i.folder_id = p_folder and i.id = any(p_items);
  -- A row deleted meanwhile (or a folder the caller is not in): "changed meanwhile".
  if n_rows <> cardinality(p_items) then raise exception using errcode = '42501', message = 'invoices.invalid'; end if;
  if n_taken > 0 then raise exception 'invoices.paid'; end if;
  if n_units <> 1 or v_code <> v_currency or v_total <> v_amount
    or not exists(select 1 from public.currencies c
      where c.user_id = uid and c.code = v_code and c.decimal_places = v_decimals and c.disabled_at is null) then
    raise exception 'invoices.mismatch';
  end if;
  update public.invoice_items i set paid_transaction_id = p_transaction
    where i.folder_id = p_folder and i.id = any(p_items) and i.paid_transaction_id is distinct from p_transaction;
  return query select i.id, i.updated_at, i.paid_on, i.paid_at
    from public.invoice_items i where i.folder_id = p_folder and i.id = any(p_items);
end $$;

-- Bulk delete: one statement, so all of the caller's chosen rows go together. Rows already
-- gone (deleted by someone else meanwhile) are simply not in the answer. Each deleted row
-- leaves its tombstone, so restore_invoice_items can bring the batch back.
create function public.delete_invoice_items(p_folder uuid, p_items uuid[]) returns setof uuid
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or p_folder is null or p_items is null or cardinality(p_items) not between 1 and 500 then
    raise exception 'invoices.invalid';
  end if;
  return query delete from public.invoice_items i where i.folder_id = p_folder and i.id = any(p_items) returning i.id;
end $$;

-- Bulk move to one of the folder's categories: one statement. Answers with every chosen row
-- that still exists (also those already in that category, which are not touched), so the
-- caller learns which rows someone else deleted meanwhile. A category deleted meanwhile is
-- reported like a missing foreign key ("changed meanwhile").
create function public.move_invoice_items(p_folder uuid, p_items uuid[], p_category uuid)
returns table(id uuid, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or p_folder is null or p_category is null or p_items is null or cardinality(p_items) not between 1 and 500 then
    raise exception 'invoices.invalid';
  end if;
  if not exists(select 1 from public.invoice_categories c where c.id = p_category and c.folder_id = p_folder) then
    raise exception using errcode = '23503', message = 'invoices.category';
  end if;
  update public.invoice_items i set category_id = p_category
    where i.folder_id = p_folder and i.id = any(p_items) and i.category_id is distinct from p_category;
  return query select i.id, i.updated_at from public.invoice_items i where i.folder_id = p_folder and i.id = any(p_items);
end $$;

-- Undo of a bulk delete: every row comes back or none does (restore_invoice_item's rules apply
-- to each: active member, within 10 minutes, the 500-row cap).
create function public.restore_invoice_items(p_items uuid[])
returns table(id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_item uuid;
begin
  if auth.uid() is null or p_items is null or cardinality(p_items) not between 1 and 500 then
    raise exception 'invoices.invalid';
  end if;
  foreach v_item in array p_items loop
    perform public.restore_invoice_item(v_item);
  end loop;
  return query select i.id, i.created_at, i.updated_at from public.invoice_items i where i.id = any(p_items);
end $$;

revoke execute on function public.mark_invoice_items_paid(uuid, uuid[], uuid), public.delete_invoice_items(uuid, uuid[]),
  public.move_invoice_items(uuid, uuid[], uuid), public.restore_invoice_items(uuid[]) from public, anon;
grant execute on function public.mark_invoice_items_paid(uuid, uuid[], uuid), public.delete_invoice_items(uuid, uuid[]),
  public.move_invoice_items(uuid, uuid[], uuid), public.restore_invoice_items(uuid[]) to authenticated;
