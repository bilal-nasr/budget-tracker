-- Category lifecycle. No financial rows are reassigned or deleted by management.
-- Existing transaction/wallet/installment guards remain installed and unchanged.

create function public.category_normalize_name(p_name text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(p_name, U&'[\0009\000A\000B\000C\000D\0020\00A0]+', ' ', 'g')), '');
$$;
create function public.category_name_key(p_name text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(public.category_normalize_name(p_name), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
$$;

-- Fail safely for unexpected legacy records; never rename or recategorize them.
do $$
declare conflicts text;
begin
  select string_agg(ids, '; ') into conflicts from (
    select string_agg(id::text, ', ') as ids from public.categories
    where archived_at is null and name_en is not null
    group by user_id, kind, parent_id, public.category_name_key(name_en) having count(*) > 1
    union all
    select string_agg(id::text, ', ') from public.categories
    where archived_at is null and name_ar is not null
    group by user_id, kind, parent_id, public.category_name_key(name_ar) having count(*) > 1
  ) duplicates;
  if conflicts is not null then
    raise exception 'category migration: resolve duplicate names for IDs %', conflicts;
  end if;
  if exists (
    select 1 from public.categories c join public.categories p on p.id=c.parent_id
    where c.id=p.id or p.parent_id is not null or c.user_id<>p.user_id or c.kind<>p.kind
  ) or exists (
    select 1 from (
      select user_id,category_id from public.transactions where category_id is not null
      union all select user_id,category_id from public.fixed_expenses
      union all select user_id,category_id from public.installments
      union all select user_id,category_id from public.budgets
    ) refs join public.categories c on c.id=refs.category_id where refs.user_id<>c.user_id
  ) then
    raise exception 'category migration: resolve invalid legacy ownership or hierarchy before retrying';
  end if;
end;
$$;

update public.categories set name_en=public.category_normalize_name(name_en), name_ar=public.category_normalize_name(name_ar);

create unique index categories_active_name_en_unique on public.categories
  (user_id, kind, parent_id, public.category_name_key(name_en)) nulls not distinct
  where archived_at is null and name_en is not null;
create unique index categories_active_name_ar_unique on public.categories
  (user_id, kind, parent_id, public.category_name_key(name_ar)) nulls not distinct
  where archived_at is null and name_ar is not null;

-- NO ACTION checks at statement end allow account-wide auth cascades, but never
-- let deleting a category itself cascade children or budget history.
alter table public.categories drop constraint categories_parent_id_fkey;
alter table public.categories add constraint categories_parent_id_fkey
  foreign key(parent_id) references public.categories(id) on delete no action;
alter table public.budgets drop constraint budgets_category_id_fkey;
alter table public.budgets add constraint budgets_category_id_fkey
  foreign key(category_id) references public.categories(id) on delete no action;

create or replace function public.categories_one_level()
returns trigger language plpgsql set search_path = '' as $$
declare p record;
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.kind is distinct from old.kind or new.parent_id is distinct from old.parent_id) then
    raise exception 'category_identity_immutable';
  end if;
  new.name_en := public.category_normalize_name(new.name_en);
  new.name_ar := public.category_normalize_name(new.name_ar);
  if new.parent_id is not null then
    if new.parent_id=new.id then raise exception 'category_parent_invalid'; end if;
    select id,user_id,kind,parent_id,archived_at into p from public.categories where id=new.parent_id for share;
    if not found or p.user_id<>new.user_id or p.kind<>new.kind or p.parent_id is not null then
      raise exception 'category_parent_invalid';
    end if;
    if p.archived_at is not null and (tg_op='INSERT' or (old.archived_at is not null and new.archived_at is null)) then
      raise exception 'category_unavailable';
    end if;
  end if;
  if tg_op='UPDATE' and old.archived_at is null and new.archived_at is not null then
    if exists(select 1 from public.categories where parent_id=new.id)
       or exists(select 1 from public.fixed_expenses where category_id=new.id)
       or exists(select 1 from public.installments where category_id=new.id) then
      raise exception 'category_in_use';
    end if;
  end if;
  return new;
end;
$$;

-- A narrow definer trigger sees all references, even malformed legacy data.
-- It cannot be invoked through the API. Only actual auth-user cleanup bypasses
-- reference protection; the deleted account no longer exists at cascade time.
create function public.categories_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  if exists(select 1 from public.transactions where category_id=old.id)
     or exists(select 1 from public.fixed_expenses where category_id=old.id)
     or exists(select 1 from public.installments where category_id=old.id)
     or exists(select 1 from public.budgets where category_id=old.id)
     or exists(select 1 from public.categories where parent_id=old.id) then
    raise exception 'category_in_use';
  end if;
  return old;
end;
$$;
create trigger categories_delete_guard before delete on public.categories
  for each row execute function public.categories_delete_guard();

-- Separate from the incumbent guards so later transaction/itemization changes
-- cannot accidentally remove category ownership/archive checks by replacing one.
create function public.category_reference_integrity()
returns trigger language plpgsql set search_path = '' as $$
declare c record; is_new_reference boolean;
begin
  if new.category_id is null then return new; end if; -- transfers have none
  select id,user_id,kind,parent_id,archived_at into c
    from public.categories where id=new.category_id for share;
  if not found or c.user_id<>new.user_id then raise exception 'category_not_found'; end if;
  if tg_table_name='transactions' then
    -- Later dedicated ledger kinds (such as loan repayments) validate their own
    -- category direction in their domain trigger; all still get owner/archive checks.
    if new.kind::text in ('expense','income') and c.kind::text<>new.kind::text then raise exception 'category kind does not match transaction kind'; end if;
  elsif c.kind::text<>'expense' then
    raise exception 'category must be an expense category';
  end if;
  if tg_table_name='budgets' then
    if c.parent_id is not null then raise exception 'budgets are for top-level expense categories'; end if;
    if c.archived_at is not null and new.limit_minor is not null then raise exception 'category_unavailable'; end if;
  else
    is_new_reference := tg_op='INSERT';
    if tg_op='UPDATE' then is_new_reference := new.category_id is distinct from old.category_id; end if;
    if c.archived_at is not null and is_new_reference then raise exception 'category_unavailable'; end if;
  end if;
  return new;
end;
$$;
create trigger zz_category_reference_integrity before insert or update on public.transactions
  for each row execute function public.category_reference_integrity();
create trigger zz_category_reference_integrity before insert or update on public.fixed_expenses
  for each row execute function public.category_reference_integrity();
create trigger zz_category_reference_integrity before insert or update on public.installments
  for each row execute function public.category_reference_integrity();
create trigger zz_category_reference_integrity before insert or update on public.budgets
  for each row execute function public.category_reference_integrity();

create function public.remove_category(p_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'category_not_found'; end if;
  -- FOR UPDATE conflicts with every reference writer's FOR SHARE lock. Reference
  -- predicates below are separate statements, taking fresh READ COMMITTED views.
  select id,archived_at into c from public.categories
    where id=p_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'category_not_found'; end if;
  if exists(select 1 from public.categories where parent_id=p_id)
     or exists(select 1 from public.fixed_expenses where category_id=p_id)
     or exists(select 1 from public.installments where category_id=p_id) then
    raise exception 'category_in_use';
  end if;
  if c.archived_at is not null then return 'archived'; end if;
  if exists(select 1 from public.transactions where category_id=p_id)
     or exists(select 1 from public.budgets where category_id=p_id) then
    update public.categories set archived_at=now() where id=p_id and user_id=(select auth.uid());
    return 'archived';
  end if;
  delete from public.categories where id=p_id and user_id=(select auth.uid());
  return 'deleted';
end;
$$;

revoke all on function public.category_normalize_name(text), public.category_name_key(text) from public,anon;
grant execute on function public.category_normalize_name(text), public.category_name_key(text) to authenticated;
revoke execute on function public.categories_one_level(), public.categories_delete_guard(), public.category_reference_integrity() from public,anon,authenticated;
revoke all on function public.remove_category(uuid) from public,anon;
grant execute on function public.remove_category(uuid) to authenticated;
