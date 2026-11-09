-- Invoice rows: the Undo id guard no longer takes any row lock. It is now two checks:
-- a lock-free pre-check in invoice_items_integrity (BEFORE INSERT) and a backstop in its own
-- AFTER INSERT trigger, invoice_items_a_id_guard.
--
-- The old guard took FOR KEY SHARE on any live row with the inserted id before it locked
-- the folder. That let a retried add of live row X into folder F deadlock with the owner
-- deleting F (the delete holds F, its cascade waits for the KEY SHARE on X, the add waits
-- for F), and let anyone who knew a live row's id (ids leak through Realtime DELETE events)
-- hold up another tenant's delete of that row for as long as their own statement waited.
--
-- Why the two checks are enough without a lock:
-- - BEFORE (pre-check): an insert of an id whose tombstone is committed and inside the Undo
--   window is refused before the row is written, so a squatted id never reaches the primary
--   key index (a squat there would make the victim's Undo wait on the squatter's
--   transaction), and the refusal comes before the column checks and the 500-row cap.
-- - AFTER (backstop): the only insert the pre-check misses is one whose pre-check ran while
--   the delete of that id was still uncommitted. That insert waits on the primary key index
--   until the delete ends. If it commits, the insert goes ahead and creates its row; the
--   AFTER trigger then runs a new query (a fresh snapshot in READ COMMITTED, the isolation
--   PostgREST uses), sees the committed tombstone and aborts the statement. If it rolls back,
--   the insert hits the live row: 23505, or nothing at all with ON CONFLICT DO NOTHING. Ids
--   leak only after a delete commits and other tenants' live ids are hidden by RLS, so this
--   race cannot be aimed at someone else's row.
-- - A retried add of a live row with ON CONFLICT DO NOTHING passes the pre-check (a live row
--   has no open tombstone) and inserts nothing, so the AFTER trigger never fires: still a
--   quiet no-op.
-- - restore_invoice_item marks its tombstone (restoring_txid) before re-inserting the row,
--   and that one insert passes both checks.
--
-- Everything else in invoice_items_integrity is unchanged. invoice_item_restorable and
-- restore_invoice_item are unchanged; their comments about the guard in
-- invoice_items_integrity now cover both checks.

-- SECURITY DEFINER so the row cap counts and locks the whole folder, not just what RLS shows,
-- and so the id pre-check can read tombstones in every folder.
-- A row re-inserted by restore_invoice_item takes every value from its tombstone, so no
-- client-supplied value decides its author or created_at.
create or replace function public.invoice_items_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); restored public.invoice_item_tombstones; is_restore boolean := false;
begin
  -- Deleting an account clears its authorship through ON DELETE SET NULL; allow exactly that.
  if tg_op = 'UPDATE'
    and (new.id, new.folder_id, new.name, new.currency, new.decimal_places, new.price_minor, new.created_at, new.updated_at)
      is not distinct from (old.id, old.folder_id, old.name, old.currency, old.decimal_places, old.price_minor, old.created_at, old.updated_at)
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
      new.created_at := restored.created_at;
      new.updated_at := restored.updated_at;
      -- An author whose account was deleted since shows as "Former member".
      new.created_by := (select u.id from auth.users u where u.id = restored.created_by);
      new.updated_by := (select u.id from auth.users u where u.id = restored.updated_by);
    else
      -- While a deleted row's Undo is open its id belongs to its tombstone (see
      -- invoice_items_id_guard for why and what it means for retries). Refused here, before
      -- the row is written and without any row lock, so a squatted id never sits in the
      -- primary key index where the victim's Undo would have to wait for it; and ahead of
      -- the column checks and the cap. invoice_items_a_id_guard (AFTER) is the backstop for
      -- an insert that ran this check while the delete of its id was still uncommitted.
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

-- Ids are chosen by clients and deleted ids leak through Realtime, so while a deleted row's
-- Undo is open its id belongs to its tombstone: no folder can take it, or the restore would
-- fail. Once the window ends the id is free (the tombstone may linger). An add retried after
-- its row was deleted within the window is refused too, whoever deleted it (the person
-- retrying included), which the app shows as "changed meanwhile". 42501, like the
-- membership check, so the app maps it to a conflict.
-- Two layers, neither taking a row lock (see the header): invoice_items_integrity refuses
-- the id before the row is written; this AFTER INSERT trigger is the backstop for an insert
-- whose pre-check ran while the delete of that id was still uncommitted (it waited on the
-- primary key, then finds the committed tombstone). It must stay VOLATILE (the default) so
-- its query takes a fresh snapshot. SECURITY DEFINER to read tombstones in every folder.
-- AFTER triggers fire in name order: the "a_" in the trigger name makes this fire before
-- invoice_items_currency, so on the backstop path too a squat in a currency the squatter
-- lacks reports 42501 (conflict) rather than the currency trigger's P0001 (currency
-- unavailable), the same as the pre-check.
create or replace function public.invoice_items_id_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.invoice_item_tombstones t
    where t.id = new.id
      and t.restoring_txid is distinct from txid_current()
      and public.invoice_item_restorable(t.deleted_at)) then
    raise exception using errcode = '42501', message = 'invoices.invalid';
  end if;
  return null;
end $$;
create trigger invoice_items_a_id_guard after insert on public.invoice_items
  for each row execute function public.invoice_items_id_guard();

revoke execute on function public.invoice_items_id_guard() from public, anon, authenticated;
