-- Invoice categories: every folder has its own list of categories ("Case & Cooling"), and every
-- row sits in exactly one of them. A new folder starts with one default category, "Other",
-- which cannot be renamed or deleted; rows without a choice land there. Everybody in the
-- folder (owner and joined members alike) can add, rename and delete categories, the same
-- as rows. Deleting a category moves its rows to "Other". Notes only, like the rest of
-- invoices: nothing here touches wallets or the ledger.
--
-- Also lengthens row names from 60 to 200 characters: a product title such as
-- "MSI MAG Forge 120A Airflow Mid-Tower (6× Fans, 330mm GPU support)" is 65 characters.

create table public.invoice_categories (
  id uuid primary key,
  folder_id uuid not null references public.invoice_folders(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- Shown under the app's own word for "Other" in the viewer's language; the stored name is a fallback.
  is_default boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (folder_id, id)
);
create unique index invoice_categories_one_default on public.invoice_categories(folder_id) where is_default;
create unique index invoice_categories_name on public.invoice_categories(folder_id, lower(btrim(name)));
create index invoice_categories_created_by on public.invoice_categories(created_by) where created_by is not null;

create function public.invoice_default_category(p_folder uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.invoice_categories c where c.folder_id = p_folder and c.is_default
$$;
revoke execute on function public.invoice_default_category(uuid) from public, anon, authenticated;

-- Every folder that exists gets its "Other", and every existing row lands in it. Triggers are
-- off for the backfill: it runs without a signed-in person and must not touch updated_at.
insert into public.invoice_categories(id, folder_id, name, is_default, created_by, created_at, updated_at)
select gen_random_uuid(), f.id, 'Other', true, f.owner_id, f.created_at, f.created_at from public.invoice_folders f;

alter table public.invoice_items add column category_id uuid;
alter table public.invoice_items disable trigger user;
update public.invoice_items i set category_id = public.invoice_default_category(i.folder_id);
alter table public.invoice_items enable trigger user;
alter table public.invoice_items alter column category_id set not null;
-- Composite, so a row can only name a category of its own folder.
alter table public.invoice_items add constraint invoice_items_category_fk
  foreign key (folder_id, category_id) references public.invoice_categories(folder_id, id);
create index invoice_items_category on public.invoice_items(folder_id, category_id);

alter table public.invoice_items drop constraint invoice_items_name_check;
alter table public.invoice_items add constraint invoice_items_name_check check (char_length(btrim(name)) between 1 and 200);

alter table public.invoice_item_tombstones add column category_id uuid;

-- Row level security -----------------------------------------------------------------
alter table public.invoice_categories enable row level security;
create policy invoice_categories_select on public.invoice_categories for select using (public.is_invoice_member(folder_id));
create policy invoice_categories_insert on public.invoice_categories for insert with check (public.is_invoice_member(folder_id));
create policy invoice_categories_update on public.invoice_categories for update
  using (public.is_invoice_member(folder_id)) with check (public.is_invoice_member(folder_id));
revoke all on public.invoice_categories from anon, authenticated;
-- No client column grant for is_default, and no delete: deleting goes through delete_invoice_category
-- so the rows in the category move to "Other" in the same step.
grant select on public.invoice_categories to authenticated;
grant insert (id, folder_id, name) on public.invoice_categories to authenticated;
grant update (name) on public.invoice_categories to authenticated;

-- Integrity ------------------------------------------------------------------------------
-- SECURITY DEFINER so the cap counts and locks the whole folder. A client can only supply id,
-- folder and name (column grants), so is_default is always false and created_by the caller;
-- the default category is made by invoice_folders_add_default_category. Membership is
-- enforced by the row level security policies.
create function public.invoice_categories_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    -- Serialize adds to one folder so the cap holds; NO KEY UPDATE does not block FK checks.
    perform 1 from public.invoice_folders f where f.id = new.folder_id for no key update;
    if (select count(*) from public.invoice_categories c where c.folder_id = new.folder_id) >= 30 then
      raise exception 'invoices.limit';
    end if;
    new.created_at := now();
    new.updated_at := now();
  else
    if (new.id, new.folder_id, new.is_default, new.created_by, new.created_at)
      is distinct from (old.id, old.folder_id, old.is_default, old.created_by, old.created_at) then
      -- Deleting an account clears authorship through ON DELETE SET NULL; allow exactly that.
      if not ((new.id, new.folder_id, new.is_default, new.created_at) is not distinct from (old.id, old.folder_id, old.is_default, old.created_at)
        and new.created_by is null and not exists(select 1 from auth.users u where u.id = old.created_by)) then
        raise exception 'invoices.invalid';
      end if;
      return new;
    end if;
    if old.is_default and new.name is distinct from old.name then raise exception 'invoices.invalid'; end if;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;
create trigger invoice_categories_integrity before insert or update on public.invoice_categories
  for each row execute function public.invoice_categories_integrity();

-- A new folder starts with "Other".
create function public.invoice_folders_add_default_category() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invoice_categories(id, folder_id, name, is_default, created_by)
  values (gen_random_uuid(), new.id, 'Other', true, new.owner_id);
  return null;
end $$;
create trigger invoice_folders_add_default_category after insert on public.invoice_folders
  for each row execute function public.invoice_folders_add_default_category();

revoke execute on function public.invoice_categories_integrity(), public.invoice_folders_add_default_category()
  from public, anon, authenticated;

-- Rows --------------------------------------------------------------------------------------
-- The latest invoice_items_integrity (20261201000100) plus: a row without a category gets the
-- folder's default; a restored row returns to its category, or to the default when that
-- category was deleted meanwhile; and a move between categories counts as an edit (it must
-- not be mistaken for the account-deletion case, which would skip the version bump).
create or replace function public.invoice_items_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); restored public.invoice_item_tombstones; is_restore boolean := false;
begin
  -- Deleting an account clears its authorship through ON DELETE SET NULL; allow exactly that.
  if tg_op = 'UPDATE'
    and (new.id, new.folder_id, new.category_id, new.name, new.currency, new.decimal_places, new.price_minor, new.created_at, new.updated_at)
      is not distinct from (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor, old.created_at, old.updated_at)
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

-- Deleted rows remember their category for Undo.
create or replace function public.invoice_items_tombstone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.invoice_folders f where f.id = old.folder_id) then return null; end if;
  insert into public.invoice_item_tombstones(id, folder_id, category_id, name, currency, decimal_places, price_minor,
    created_by, updated_by, created_at, updated_at, deleted_by, deleted_at)
  values (old.id, old.folder_id, old.category_id, old.name, old.currency, old.decimal_places, old.price_minor,
    old.created_by, old.updated_by, old.created_at, old.updated_at, auth.uid(), now())
  on conflict (id) do update set folder_id = excluded.folder_id, category_id = excluded.category_id, name = excluded.name,
    currency = excluded.currency, decimal_places = excluded.decimal_places, price_minor = excluded.price_minor,
    created_by = excluded.created_by, updated_by = excluded.updated_by, created_at = excluded.created_at,
    updated_at = excluded.updated_at, deleted_by = excluded.deleted_by, deleted_at = excluded.deleted_at, restoring_txid = null
    where public.invoice_item_tombstones.folder_id = excluded.folder_id;
  return null;
end $$;

-- Owner or member: deletes a category and moves its rows to "Other" in one step. "Other"
-- itself stays. A category already gone is a quiet no-op for members.
create function public.delete_invoice_category(p_category uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_cat public.invoice_categories; v_default uuid;
begin
  if uid is null or p_category is null then raise exception 'invoices.invalid'; end if;
  select c.* into v_cat from public.invoice_categories c where c.id = p_category;
  if not found then return; end if;
  if not public.is_invoice_member(v_cat.folder_id) or v_cat.is_default then raise exception 'invoices.invalid'; end if;
  -- Locking the folder serializes this with adds, so no row lands in the category being removed.
  perform 1 from public.invoice_folders f where f.id = v_cat.folder_id for no key update;
  if not found then raise exception 'invoices.invalid'; end if;
  v_default := public.invoice_default_category(v_cat.folder_id);
  update public.invoice_items i set category_id = v_default where i.category_id = p_category;
  delete from public.invoice_categories c where c.id = p_category;
end $$;
revoke execute on function public.delete_invoice_category(uuid) from public, anon;
grant execute on function public.delete_invoice_category(uuid) to authenticated;

-- Live: categories appear for the others as they are added or renamed. Deletes carry only the
-- random id, which reveals nothing; the moved rows arrive as row updates.
alter publication supabase_realtime add table public.invoice_categories;
