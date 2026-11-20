-- Item calculator: every item gets a quantity, the same way invoice rows did (20261204000000).
-- The price stays the price of ONE unit; an item's total is price x quantity, and the list and
-- ticked totals are sums of those (per currency, never mixed). Items that existed before are
-- quantity 1, so their totals do not change.
--
-- A quantity is a whole number from 1 to 9999. The item total must stay inside the app's money
-- range, the same as a price on its own.

alter table public.shopping_items add column quantity integer not null default 1
  constraint shopping_items_quantity_check check (quantity between 1 and 9999);
-- numeric, so a huge price times a large quantity is refused cleanly instead of overflowing bigint.
alter table public.shopping_items add constraint shopping_items_total_check
  check (price_minor::numeric * quantity <= 1000000000000000);

-- shopping_items_integrity (20261130000000) plus quantity: a bought item is a record of what was
-- paid, so its quantity is locked together with its name and price.
create or replace function public.shopping_items_integrity() returns trigger language plpgsql set search_path = '' as $$
declare live_purchase boolean; previous uuid;
begin
  if new.user_id is distinct from auth.uid() then raise exception 'items.invalid'; end if;
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if (new.id, new.user_id, new.currency, new.created_at) is distinct from (old.id, old.user_id, old.currency, old.created_at) then
      raise exception 'items.invalid';
    end if;
    -- A bought item is a record of what was paid; correct the expense in Activity instead.
    select exists(select 1 from public.transactions t
      where t.id = old.bought_transaction_id and t.user_id = old.user_id and t.deleted_at is null) into live_purchase;
    if live_purchase and (new.name, new.price_minor, new.quantity) is distinct from (old.name, old.price_minor, old.quantity) then
      raise exception 'items.bought';
    end if;
    previous := old.bought_transaction_id;
    new.updated_at := now();
  end if;
  -- Linking (or relinking) to a purchase: it must be a live expense of this owner.
  if new.bought_transaction_id is not null and new.bought_transaction_id is distinct from previous then
    if not exists(select 1 from public.transactions t
      where t.id = new.bought_transaction_id and t.user_id = new.user_id and t.kind::text = 'expense' and t.deleted_at is null) then
      raise exception 'items.invalid';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.shopping_items_integrity() from public, anon, authenticated;

-- Reads go through the view; quantity is appended (a view can only grow at the end).
create or replace view public.shopping_item_status with (security_invoker = true) as
select i.id, i.user_id, i.name, i.currency, i.price_minor, i.created_at,
  t.id as transaction_id, t.occurred_on as bought_on, i.quantity
from public.shopping_items i
left join public.transactions t on t.id = i.bought_transaction_id and t.user_id = i.user_id and t.deleted_at is null;
grant select on public.shopping_item_status to authenticated;

-- "Delete selected": the ticked items go in one statement, so either all of them are deleted or
-- none is. Runs as the caller (row level security applies) and returns how many rows went; ids
-- that are already gone, or belong to someone else, are simply not counted. Purchases already
-- recorded stay in Activity, exactly as when one item is deleted.
create function public.delete_shopping_items(p_ids uuid[]) returns integer
language plpgsql security invoker set search_path = '' as $$
declare removed integer;
begin
  if auth.uid() is null or p_ids is null or coalesce(array_length(p_ids, 1), 0) not between 1 and 500 then
    raise exception 'items.invalid';
  end if;
  delete from public.shopping_items i where i.id = any(p_ids) and i.user_id = auth.uid();
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke execute on function public.delete_shopping_items(uuid[]) from public, anon;
grant execute on function public.delete_shopping_items(uuid[]) to authenticated;
