-- Serialize catalogue writes per owner before any category row is locked. This
-- makes reorder/create/restore/archive/delete share one deadlock-safe boundary.
create function public.category_catalogue_write_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('category-catalogue:' || (select auth.uid())::text, 0)
    );
  end if;
  return null;
end;
$$;

create trigger aa_category_catalogue_write_lock
  before insert or update or delete on public.categories
  for each statement execute function public.category_catalogue_write_lock();

-- Root categories are always appended inside the serialized write statement.
-- Restoring an archive also appends it, avoiding a collision with normalized
-- active positions left behind while the category was archived.
create function public.category_append_position()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  should_append boolean := false;
begin
  if tg_op = 'INSERT' then
    should_append := new.parent_id is null;
  elsif tg_op = 'UPDATE' then
    should_append := new.parent_id is null and old.archived_at is not null and new.archived_at is null;
  end if;
  if should_append then
    select coalesce(max(position), 0) + 1 into new.position
    from public.categories
    where user_id = new.user_id
      and kind = new.kind
      and parent_id is null
      and archived_at is null
      and id is distinct from new.id;
  end if;
  return new;
end;
$$;

create trigger aa_category_append_position
  before insert or update on public.categories
  for each row execute function public.category_append_position();

-- Save a complete root-category order atomically. The shared catalogue lock
-- prevents a concurrent create or restore from changing the exact set.
create function public.reorder_categories(p_kind public.category_kind, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_count integer;
begin
  if (select auth.uid()) is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or (select count(distinct id) from unnest(p_ids) as requested(id)) <> cardinality(p_ids) then
    raise exception 'category_order_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('category-catalogue:' || (select auth.uid())::text, 0)
  );

  perform 1
  from public.categories
  where user_id = (select auth.uid())
    and kind = p_kind
    and parent_id is null
    and archived_at is null
  for update;

  select count(*) into expected_count
  from public.categories
  where user_id = (select auth.uid())
    and kind = p_kind
    and parent_id is null
    and archived_at is null;

  if expected_count <> cardinality(p_ids)
     or (select count(*)
         from unnest(p_ids) as requested(id)
         join public.categories c on c.id = requested.id
         where c.user_id = (select auth.uid())
           and c.kind = p_kind
           and c.parent_id is null
           and c.archived_at is null) <> expected_count then
    raise exception 'category_order_invalid';
  end if;

  update public.categories c
  set position = requested.position::integer
  from unnest(p_ids) with ordinality as requested(id, position)
  where c.id = requested.id
    and c.user_id = (select auth.uid());
end;
$$;

-- remove_category locks its target row before its eventual UPDATE/DELETE, so it
-- must join the same catalogue lock before that row lock to preserve lock order.
create or replace function public.remove_category(p_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare c record;
begin
  if auth.uid() is null then raise exception 'category_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('category-catalogue:' || (select auth.uid())::text, 0)
  );
  select id,archived_at into c from public.categories
    where id=p_id and user_id=(select auth.uid()) for update;
  if not found then raise exception 'category_not_found'; end if;
  if exists(select 1 from public.categories where parent_id=p_id)
     or exists(select 1 from public.fixed_expenses where category_id=p_id)
     or exists(select 1 from public.installments where category_id=p_id)
     or exists(select 1 from public.loans where fee_category_id=p_id and deleted_at is null) then
    raise exception 'category_in_use';
  end if;
  if c.archived_at is not null then return 'archived'; end if;
  if exists(select 1 from public.transactions where category_id=p_id)
     or exists(select 1 from public.budgets where category_id=p_id)
     or exists(select 1 from public.loans where fee_category_id=p_id) then
    update public.categories set archived_at=now() where id=p_id and user_id=(select auth.uid());
    return 'archived';
  end if;
  delete from public.categories where id=p_id and user_id=(select auth.uid());
  return 'deleted';
end;
$$;

revoke all on function public.reorder_categories(public.category_kind, uuid[]) from public, anon;
grant execute on function public.reorder_categories(public.category_kind, uuid[]) to authenticated;
revoke execute on function public.category_catalogue_write_lock(), public.category_append_position() from public, anon, authenticated;
