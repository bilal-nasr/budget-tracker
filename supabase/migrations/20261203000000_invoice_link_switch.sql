-- A joining switch for a folder's link. Off: nobody new can join with the link (and the preview
-- shows nothing), but the link itself is kept so switching it back on needs no new URL. People
-- already in the folder are untouched: opening the link still takes them to their folder.
-- Replacing the link (rotate_invoice_link) swaps the token and leaves the switch where it is.
-- This replaces disable_invoice_link, which deleted the link.

alter table public.invoice_links add column enabled boolean not null default true;

-- The folder name for the join page, or null when the link would not work for the caller.
create or replace function public.invoice_link_preview(p_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_folder public.invoice_folders; v_removed timestamptz; v_enabled boolean;
begin
  if uid is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select f.* into v_folder from public.invoice_links l join public.invoice_folders f on f.id = l.folder_id where l.token = p_token;
  if not found then return null; end if;
  select m.removed_at into v_removed from public.invoice_members m where m.folder_id = v_folder.id and m.user_id = uid;
  if found then
    return case when v_removed is null then v_folder.name end;
  end if;
  select l.enabled into v_enabled from public.invoice_links l where l.folder_id = v_folder.id;
  if not v_enabled then return null; end if;
  if (select count(*) from public.invoice_members m
    where m.folder_id = v_folder.id and m.user_id <> v_folder.owner_id and m.removed_at is null) >= 20 then
    return null;
  end if;
  return v_folder.name;
end $$;

-- Joins the folder behind a token and returns its id. Joining again (or the owner opening
-- their own link) just returns the id, also while the switch is off.
create or replace function public.join_invoice_folder(p_token text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_folder public.invoice_folders; v_removed timestamptz; v_enabled boolean; v_name text := btrim(p_name);
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
  select l.enabled into v_enabled from public.invoice_links l where l.folder_id = v_folder.id;
  if not v_enabled then raise exception 'invoices.link'; end if;
  if v_name is null or char_length(v_name) not between 1 and 30 then raise exception 'invoices.invalid'; end if;
  if (select count(*) from public.invoice_members m
    where m.folder_id = v_folder.id and m.user_id <> v_folder.owner_id and m.removed_at is null) >= 20 then
    raise exception 'invoices.full';
  end if;
  insert into public.invoice_members(folder_id, user_id, display_name) values (v_folder.id, uid, v_name);
  return v_folder.id;
end $$;

-- Owner only: switches joining on or off. A folder without a link has nothing to switch.
create function public.set_invoice_link_enabled(p_folder uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  perform 1 from public.invoice_folders f where f.id = p_folder and f.owner_id = uid for no key update;
  if uid is null or not found or p_enabled is null then raise exception 'invoices.invalid'; end if;
  update public.invoice_links l set enabled = p_enabled where l.folder_id = p_folder;
  if not found then raise exception 'invoices.invalid'; end if;
end $$;

drop function public.disable_invoice_link(uuid);

revoke execute on function public.set_invoice_link_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_invoice_link_enabled(uuid, boolean) to authenticated;
