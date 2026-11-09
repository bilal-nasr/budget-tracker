-- Invoice rows get a quantity: item, price, quantity, category. The price stays the price of
-- ONE unit; a row's total is price x quantity, and folder, category and selection totals are
-- sums of those row totals (per currency, never mixed). Rows that existed before are quantity 1,
-- so their totals do not change.
--
-- A quantity is a whole number from 1 to 9999. The row total must stay inside the app's money
-- range, the same as a price on its own.

alter table public.invoice_items add column quantity integer not null default 1
  constraint invoice_items_quantity_check check (quantity between 1 and 9999);
-- numeric, so a huge price times a large quantity is refused cleanly instead of overflowing bigint.
alter table public.invoice_items add constraint invoice_items_total_check
  check (price_minor::numeric * quantity <= 1000000000000000);

-- Undo returns a deleted row with its quantity.
alter table public.invoice_item_tombstones add column quantity integer not null default 1;

-- The latest invoice_items_integrity (20261202000000) plus quantity: a change of quantity alone
-- is an edit (it must not be mistaken for the account-deletion case, which would skip the
-- version bump), and a restored row takes its quantity from its tombstone.
create or replace function public.invoice_items_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); restored public.invoice_item_tombstones; is_restore boolean := false;
begin
  -- Deleting an account clears its authorship through ON DELETE SET NULL; allow exactly that.
  if tg_op = 'UPDATE'
    and (new.id, new.folder_id, new.category_id, new.name, new.currency, new.decimal_places, new.price_minor, new.quantity, new.created_at, new.updated_at)
      is not distinct from (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.quantity, old.created_at, old.updated_at)
    and (new.created_by is not distinct from old.created_by
      or (new.created_by is null and not exists(select 1 from auth.users u where u.id = old.created_by)))
    and (new.updated_by is not distinct from old.updated_by
      or (new.updated_by is null and not exists(select 1 from auth.users u where u.id = old.updated_by))) then
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
    else
      -- While a deleted row's Undo is open its id belongs to its tombstone (see
      -- invoice_items_id_guard in 20261201000100 for why and what it means for retries).
      if exists(select 1 from public.invoice_item_tombstones t
        where t.id = new.id and public.invoice_item_restorable(t.deleted_at)) then
        raise exception using errcode = '42501', message = 'invoices.invalid';
      end if;
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
    new.updated_by := uid;
    -- Strictly later than the version it replaces (see invoice_folders_integrity); the screen
    -- compares versions to the microsecond and ignores one that is not newer.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;

-- Deleted rows remember their quantity for Undo.
create or replace function public.invoice_items_tombstone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.invoice_folders f where f.id = old.folder_id) then return null; end if;
  insert into public.invoice_item_tombstones(id, folder_id, category_id, name, currency, decimal_places, price_minor, quantity,
    created_by, updated_by, created_at, updated_at, deleted_by, deleted_at)
  values (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.quantity,
    old.created_by, old.updated_by, old.created_at, old.updated_at, auth.uid(), now())
  on conflict (id) do update set folder_id = excluded.folder_id, category_id = excluded.category_id, name = excluded.name,
    currency = excluded.currency, decimal_places = excluded.decimal_places, price_minor = excluded.price_minor,
    quantity = excluded.quantity, created_by = excluded.created_by, updated_by = excluded.updated_by,
    created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_by = excluded.deleted_by,
    deleted_at = excluded.deleted_at, restoring_txid = null
    where public.invoice_item_tombstones.folder_id = excluded.folder_id;
  return null;
end $$;
