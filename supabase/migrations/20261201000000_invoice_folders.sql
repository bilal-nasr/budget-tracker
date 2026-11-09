-- Invoices: named folders ("PC build") of things paid for, each row with its own price,
-- currency and the decimal places it was saved with. They are notes only: nothing here
-- touches wallets, balances or the ledger, and totals are always read per currency.
--
-- A folder can be shared by link, so access is "owner or active member of the folder"
-- instead of the usual `user_id = auth.uid()`. Membership is written only by the
-- security-definer functions below (joining needs a token and respects the cap); clients
-- may change nothing in invoice_members except their own display name, and never write
-- invoice_links directly.

create table public.invoice_folders (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_folders_owner on public.invoice_folders(owner_id, created_at desc);

-- One row per person in a folder, the owner included (added by a trigger). Removing a
-- person keeps the row with removed_at set, so a removed person cannot rejoin; leaving
-- deletes the row, so a person who left can rejoin with a working link.
create table public.invoice_members (
  folder_id uuid not null references public.invoice_folders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text check (char_length(btrim(display_name)) between 1 and 30),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (folder_id, user_id)
);
create index invoice_members_user on public.invoice_members(user_id);

-- At most one link per folder; replacing the token invalidates the old one.
create table public.invoice_links (
  folder_id uuid primary key references public.invoice_folders(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

-- Authorship survives leaving or removal; deleting an account clears it ("Former member").
create table public.invoice_items (
  id uuid primary key,
  folder_id uuid not null references public.invoice_folders(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  currency text not null check (currency ~ '^[A-Z][A-Z0-9]{0,11}$'),
  decimal_places smallint not null check (decimal_places between 0 and 8),
  price_minor bigint not null check (price_minor between 1 and 1000000000000000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_items_folder on public.invoice_items(folder_id, created_at desc, id desc);
create index invoice_items_created_by on public.invoice_items(created_by) where created_by is not null;
create index invoice_items_updated_by on public.invoice_items(updated_by) where updated_by is not null;

-- Deleted rows, kept briefly so Undo can put a row back exactly as it was (same author,
-- same created_at) through public.restore_invoice_item. Clients never read or write this
-- table: RLS is on with no policies and no grants; only the functions below touch it.
-- No foreign keys: a tombstone outlives its row, and restore re-checks folder and authors.
-- restoring_txid marks the one row a restore is re-inserting in the current transaction.
create table public.invoice_item_tombstones (
  id uuid primary key,
  folder_id uuid not null,
  name text not null,
  currency text not null,
  decimal_places smallint not null,
  price_minor bigint not null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  restoring_txid bigint
);
create index invoice_item_tombstones_folder on public.invoice_item_tombstones(folder_id);
create index invoice_item_tombstones_deleted on public.invoice_item_tombstones(deleted_at);
alter table public.invoice_item_tombstones enable row level security;
revoke all on public.invoice_item_tombstones from anon, authenticated;

-- Access helpers. SECURITY DEFINER so policies can consult membership without RLS
-- recursing into invoice_members' own policy.
create function public.is_invoice_member(folder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.invoice_members m
    where m.folder_id = folder and m.user_id = (select auth.uid()) and m.removed_at is null)
$$;
create function public.is_invoice_owner(folder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.invoice_folders f
    where f.id = folder and f.owner_id = (select auth.uid()))
$$;
revoke execute on function public.is_invoice_member(uuid), public.is_invoice_owner(uuid) from public, anon;
grant execute on function public.is_invoice_member(uuid), public.is_invoice_owner(uuid) to authenticated;

-- Row level security ------------------------------------------------------------------
alter table public.invoice_folders enable row level security;
-- The owner clause lets INSERT ... RETURNING see the new folder before its member row exists.
create policy invoice_folders_select on public.invoice_folders for select
  using (owner_id = (select auth.uid()) or public.is_invoice_member(id));
create policy invoice_folders_insert on public.invoice_folders for insert with check (owner_id = (select auth.uid()));
create policy invoice_folders_update on public.invoice_folders for update
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy invoice_folders_delete on public.invoice_folders for delete using (owner_id = (select auth.uid()));
revoke all on public.invoice_folders from anon, authenticated;
grant select, insert, update, delete on public.invoice_folders to authenticated;

alter table public.invoice_members enable row level security;
-- Members see the people in their folders; only the owner also sees who was removed.
create policy invoice_members_select on public.invoice_members for select
  using (public.is_invoice_member(folder_id) and (removed_at is null or public.is_invoice_owner(folder_id)));
create policy invoice_members_update on public.invoice_members for update
  using (user_id = (select auth.uid()) and removed_at is null)
  with check (user_id = (select auth.uid()) and removed_at is null);
revoke all on public.invoice_members from anon, authenticated;
grant select on public.invoice_members to authenticated;
grant update (display_name) on public.invoice_members to authenticated;

alter table public.invoice_links enable row level security;
create policy invoice_links_select on public.invoice_links for select using (public.is_invoice_owner(folder_id));
revoke all on public.invoice_links from anon, authenticated;
grant select on public.invoice_links to authenticated;

alter table public.invoice_items enable row level security;
create policy invoice_items_select on public.invoice_items for select using (public.is_invoice_member(folder_id));
create policy invoice_items_insert on public.invoice_items for insert with check (public.is_invoice_member(folder_id));
create policy invoice_items_update on public.invoice_items for update
  using (public.is_invoice_member(folder_id)) with check (public.is_invoice_member(folder_id));
create policy invoice_items_delete on public.invoice_items for delete using (public.is_invoice_member(folder_id));
revoke all on public.invoice_items from anon, authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;

-- Integrity triggers ------------------------------------------------------------------
create function public.invoice_folders_integrity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from auth.uid() then raise exception 'invoices.invalid'; end if;
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    -- Serialize one owner's creates so the cap holds under concurrency.
    perform pg_advisory_xact_lock(hashtextextended('invoice_folders:' || new.owner_id::text, 0));
    if (select count(*) from public.invoice_folders f where f.owner_id = new.owner_id) >= 100 then
      raise exception 'invoices.limit';
    end if;
    new.created_at := now();
    new.updated_at := now();
  else
    if (new.id, new.owner_id, new.created_at) is distinct from (old.id, old.owner_id, old.created_at) then
      raise exception 'invoices.invalid';
    end if;
    -- Strictly later than the version it replaces: now() is the transaction start, so two
    -- overlapping writes could otherwise commit in the opposite order of their timestamps.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end $$;
create trigger invoice_folders_integrity before insert or update on public.invoice_folders
  for each row execute function public.invoice_folders_integrity();

-- The owner is the folder's first member.
create function public.invoice_folders_add_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invoice_members(folder_id, user_id) values (new.id, new.owner_id);
  return null;
end $$;
create trigger invoice_folders_add_owner after insert on public.invoice_folders
  for each row execute function public.invoice_folders_add_owner();

create function public.invoice_members_integrity() returns trigger language plpgsql set search_path = '' as $$
begin
  new.display_name := btrim(new.display_name);
  if tg_op = 'UPDATE' then
    if (new.folder_id, new.user_id, new.joined_at) is distinct from (old.folder_id, old.user_id, old.joined_at)
      or (old.display_name is not null and new.display_name is null) then
      raise exception 'invoices.invalid';
    end if;
  end if;
  return new;
end $$;
create trigger invoice_members_integrity before insert or update on public.invoice_members
  for each row execute function public.invoice_members_integrity();

-- Undo lasts 10 minutes. The one definition for restore_invoice_item and for the id guard in
-- invoice_items_integrity, so the two windows cannot drift apart.
create function public.invoice_item_restorable(p_deleted_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_deleted_at >= now() - interval '10 minutes'
$$;

-- SECURITY DEFINER so the row cap counts and locks the whole folder, not just what RLS shows,
-- and so the id guard can read tombstones in every folder.
-- A row re-inserted by restore_invoice_item takes every value from its tombstone, so no
-- client-supplied value decides its author or created_at.
create function public.invoice_items_integrity() returns trigger language plpgsql security definer set search_path = '' as $$
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
      -- Ids are chosen by clients and deleted ids leak through Realtime, so while a deleted
      -- row's Undo is open its id belongs to its tombstone: no folder can take it, or the
      -- restore would fail. Once the window ends the id is free (the tombstone may linger).
      -- This runs before ON CONFLICT is checked. A retried add of a live row passes (a live
      -- row has no open tombstone) and DO NOTHING still skips it; an add retried after
      -- someone else deleted that row within the window is refused, which the app shows as
      -- "changed meanwhile". 42501, like the membership check, so the app maps it to conflict.
      -- A delete of this id still in flight holds the row lock: waiting on it here means the
      -- check below (a fresh snapshot in READ COMMITTED) sees its tombstone once it commits.
      perform 1 from public.invoice_items i where i.id = new.id for key share;
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
create trigger invoice_items_integrity before insert or update on public.invoice_items
  for each row execute function public.invoice_items_integrity();

-- A row's currency (and its decimals) must be one the person saving it has enabled.
-- Editing name or price of someone else's row in a currency the editor lacks is fine.
-- A restored row keeps the currency it was saved with, whoever restores it.
-- AFTER, so the plain column checks (e.g. decimal_places 0..8) report first. SECURITY
-- DEFINER only to see the restore marker; the catalog lookup is pinned to auth.uid().
create function public.invoice_items_currency() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.currency, new.decimal_places) is not distinct from (old.currency, old.decimal_places) then
    return null;
  end if;
  if tg_op = 'INSERT' and exists(select 1 from public.invoice_item_tombstones t
    where t.id = new.id and t.restoring_txid = txid_current()) then
    return null;
  end if;
  if not exists(select 1 from public.currencies c
    where c.user_id = auth.uid() and c.code = new.currency and c.decimal_places = new.decimal_places and c.disabled_at is null) then
    raise exception 'invoices.invalid';
  end if;
  return null;
end $$;
create trigger invoice_items_currency after insert or update of currency, decimal_places on public.invoice_items
  for each row execute function public.invoice_items_currency();

-- Every deleted row leaves a tombstone for Undo, unless its folder is being deleted too
-- (folder or account deletion): then there is nothing to restore into.
-- Ids are global and deleted ids leak through realtime DELETE events, so a delete in one
-- folder never overwrites another folder's tombstone (that delete still succeeds).
create function public.invoice_items_tombstone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.invoice_folders f where f.id = old.folder_id) then return null; end if;
  insert into public.invoice_item_tombstones(id, folder_id, name, currency, decimal_places, price_minor,
    created_by, updated_by, created_at, updated_at, deleted_by, deleted_at)
  values (old.id, old.folder_id, old.name, old.currency, old.decimal_places, old.price_minor,
    old.created_by, old.updated_by, old.created_at, old.updated_at, auth.uid(), now())
  on conflict (id) do update set folder_id = excluded.folder_id, name = excluded.name, currency = excluded.currency,
    decimal_places = excluded.decimal_places, price_minor = excluded.price_minor, created_by = excluded.created_by,
    updated_by = excluded.updated_by, created_at = excluded.created_at, updated_at = excluded.updated_at,
    deleted_by = excluded.deleted_by, deleted_at = excluded.deleted_at, restoring_txid = null
    where public.invoice_item_tombstones.folder_id = excluded.folder_id;
  return null;
end $$;
create trigger invoice_items_tombstone after delete on public.invoice_items
  for each row execute function public.invoice_items_tombstone();

-- Undo lasts 10 minutes; tombstones older than an hour are purged on the next delete.
create function public.invoice_items_purge_tombstones() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invoice_item_tombstones t where t.deleted_at < now() - interval '1 hour';
  return null;
end $$;
create trigger invoice_items_purge_tombstones after delete on public.invoice_items
  for each statement execute function public.invoice_items_purge_tombstones();

-- A deleted folder's tombstones go with it, so a folder later created with the same id
-- can never receive the old rows.
create function public.invoice_folders_clear_tombstones() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invoice_item_tombstones t where t.folder_id = old.id;
  return null;
end $$;
create trigger invoice_folders_clear_tombstones after delete on public.invoice_folders
  for each row execute function public.invoice_folders_clear_tombstones();

revoke execute on function public.invoice_folders_integrity(), public.invoice_folders_add_owner(),
  public.invoice_members_integrity(), public.invoice_items_integrity(), public.invoice_items_currency(),
  public.invoice_items_tombstone(), public.invoice_items_purge_tombstones(), public.invoice_folders_clear_tombstones(),
  public.invoice_item_restorable(timestamptz)
  from public, anon, authenticated;

-- Link and membership RPCs ------------------------------------------------------------
-- Any token that does not work for the caller (unknown, replaced, switched off, folder
-- full, or caller removed) looks the same, so a link never reveals whether a folder exists.

-- The folder name for the join page, or null when the link would not work for the caller.
create function public.invoice_link_preview(p_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_folder public.invoice_folders; v_removed timestamptz;
begin
  if uid is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select f.* into v_folder from public.invoice_links l join public.invoice_folders f on f.id = l.folder_id where l.token = p_token;
  if not found then return null; end if;
  select m.removed_at into v_removed from public.invoice_members m where m.folder_id = v_folder.id and m.user_id = uid;
  if found then
    return case when v_removed is null then v_folder.name end;
  end if;
  if (select count(*) from public.invoice_members m
    where m.folder_id = v_folder.id and m.user_id <> v_folder.owner_id and m.removed_at is null) >= 20 then
    return null;
  end if;
  return v_folder.name;
end $$;

-- Joins the folder behind a token and returns its id. Joining again (or the owner opening
-- their own link) just returns the id.
create function public.join_invoice_folder(p_token text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_folder public.invoice_folders; v_removed timestamptz; v_name text := btrim(p_name);
begin
  if uid is null then raise exception 'invoices.invalid'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invoices.link'; end if;
  -- Locking the folder serializes joins so the cap and "one row per person" hold.
  select f.* into v_folder from public.invoice_links l join public.invoice_folders f on f.id = l.folder_id
    where l.token = p_token for no key update of f;
  if not found then raise exception 'invoices.link'; end if;
  select m.removed_at into v_removed from public.invoice_members m where m.folder_id = v_folder.id and m.user_id = uid;
  if found then
    if v_removed is not null then raise exception 'invoices.link'; end if;
    return v_folder.id;
  end if;
  if v_name is null or char_length(v_name) not between 1 and 30 then raise exception 'invoices.invalid'; end if;
  if (select count(*) from public.invoice_members m
    where m.folder_id = v_folder.id and m.user_id <> v_folder.owner_id and m.removed_at is null) >= 20 then
    raise exception 'invoices.full';
  end if;
  insert into public.invoice_members(folder_id, user_id, display_name) values (v_folder.id, uid, v_name);
  return v_folder.id;
end $$;

-- Owner only: creates the folder's link or replaces it (the old token stops working).
-- The owner's name is asked once, the first time they share.
create function public.rotate_invoice_link(p_folder uuid, p_owner_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_name text := btrim(p_owner_name); v_token text;
begin
  perform 1 from public.invoice_folders f where f.id = p_folder and f.owner_id = uid for no key update;
  if uid is null or not found then raise exception 'invoices.invalid'; end if;
  if exists(select 1 from public.invoice_members m where m.folder_id = p_folder and m.user_id = uid and m.display_name is null) then
    if v_name is null or char_length(v_name) not between 1 and 30 then raise exception 'invoices.invalid'; end if;
    update public.invoice_members m set display_name = v_name where m.folder_id = p_folder and m.user_id = uid;
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invoice_links(folder_id, token) values (p_folder, v_token)
    on conflict (folder_id) do update set token = excluded.token, created_at = now();
  return v_token;
end $$;

-- Owner only: nobody new can join; people already in stay.
create function public.disable_invoice_link(p_folder uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform 1 from public.invoice_folders f where f.id = p_folder and f.owner_id = uid for no key update;
  if uid is null or not found then raise exception 'invoices.invalid'; end if;
  delete from public.invoice_links l where l.folder_id = p_folder;
end $$;

-- Owner only: the person loses access at once and cannot rejoin; their rows stay.
create function public.remove_invoice_member(p_folder uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform 1 from public.invoice_folders f where f.id = p_folder and f.owner_id = uid for no key update;
  if uid is null or not found or p_user is null or p_user = uid then raise exception 'invoices.invalid'; end if;
  update public.invoice_members m set removed_at = now()
    where m.folder_id = p_folder and m.user_id = p_user and m.removed_at is null;
end $$;

-- A member leaves; their rows stay. The owner cannot leave, and a removed person's row is
-- kept so leaving never undoes a removal.
create function public.leave_invoice_folder(p_folder uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or exists(select 1 from public.invoice_folders f where f.id = p_folder and f.owner_id = uid) then
    raise exception 'invoices.invalid';
  end if;
  delete from public.invoice_members m where m.folder_id = p_folder and m.user_id = uid and m.removed_at is null;
end $$;

-- Undo of a row delete: puts the row back exactly as it was (original author, created_at
-- and values) for any active member, within 10 minutes. It keeps its currency even if the
-- restorer lacks it, but the 500-row cap still applies. A retry after success is a no-op.
create function public.restore_invoice_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); t public.invoice_item_tombstones;
begin
  if uid is null or p_item is null then raise exception 'invoices.invalid'; end if;
  select * into t from public.invoice_item_tombstones x where x.id = p_item for update;
  if not found then
    -- Already restored: quiet for members, and no hint about other folders' rows.
    if exists(select 1 from public.invoice_items i where i.id = p_item and public.is_invoice_member(i.folder_id)) then
      return;
    end if;
    raise exception 'invoices.invalid';
  end if;
  if not public.is_invoice_member(t.folder_id) or not public.invoice_item_restorable(t.deleted_at) then
    raise exception 'invoices.invalid';
  end if;
  perform 1 from public.invoice_folders f where f.id = t.folder_id for no key update;
  if not found then raise exception 'invoices.invalid'; end if;
  if exists(select 1 from public.invoice_items i where i.id = p_item) then
    -- Already back in this folder: a quiet no-op. Taken by another folder (someone
    -- squatting a leaked id): fail loudly and keep the tombstone for a later retry.
    -- invoice_items_integrity refuses both while the window is open; this stays as a backstop.
    if not exists(select 1 from public.invoice_items i where i.id = p_item and i.folder_id = t.folder_id) then
      raise exception 'invoices.invalid';
    end if;
    delete from public.invoice_item_tombstones x where x.id = p_item;
    return;
  end if;
  -- Mark the tombstone so the item triggers take its values instead of the caller's.
  update public.invoice_item_tombstones x set restoring_txid = txid_current() where x.id = p_item;
  insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
    values (t.id, t.folder_id, t.name, t.currency, t.decimal_places, t.price_minor);
  delete from public.invoice_item_tombstones x where x.id = p_item;
end $$;

revoke execute on function public.invoice_link_preview(text), public.join_invoice_folder(text, text),
  public.rotate_invoice_link(uuid, text), public.disable_invoice_link(uuid),
  public.remove_invoice_member(uuid, uuid), public.leave_invoice_folder(uuid),
  public.restore_invoice_item(uuid) from public, anon;
grant execute on function public.invoice_link_preview(text), public.join_invoice_folder(text, text),
  public.rotate_invoice_link(uuid, text), public.disable_invoice_link(uuid),
  public.remove_invoice_member(uuid, uuid), public.leave_invoice_folder(uuid),
  public.restore_invoice_item(uuid) to authenticated;

-- Live updates for an open folder. Realtime applies the subscriber's SELECT policies to
-- inserts and updates, so a removed person stops receiving those. DELETE events carry only
-- the primary key and are NOT filtered by RLS, so only tables whose key reveals nothing
-- (random row ids) are published: members (folder id + user id pairs), links and
-- tombstones stay out. Clients drop deleted rows by id and refetch on focus.
alter publication supabase_realtime add table public.invoice_folders, public.invoice_items;
