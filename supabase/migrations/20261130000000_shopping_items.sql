-- Item calculator: things the owner prices and may buy. An item is only a note
-- until it is bought; buying records an ordinary expense in the ledger
-- (public.save_transaction) and links it here. Items never move money themselves.
create table public.shopping_items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  currency text not null,
  price_minor bigint not null check (price_minor between 1 and 1000000000000000),
  -- The expense that bought this item. Items count as bought only while that
  -- expense is live, so deleting it from Activity (or Undo) puts the item back.
  bought_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id),
  foreign key(user_id, currency) references public.currencies(user_id, code) on update cascade
);
create index shopping_items_owner on public.shopping_items(user_id, created_at desc);
create index shopping_items_bought on public.shopping_items(bought_transaction_id) where bought_transaction_id is not null;

alter table public.shopping_items enable row level security;
create policy shopping_select on public.shopping_items for select using (user_id = (select auth.uid()));
create policy shopping_insert on public.shopping_items for insert with check (user_id = (select auth.uid()));
create policy shopping_update on public.shopping_items for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy shopping_delete on public.shopping_items for delete using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.shopping_items to authenticated;
revoke all on public.shopping_items from anon;

create function public.shopping_items_integrity() returns trigger language plpgsql set search_path = '' as $$
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
    if live_purchase and (new.name, new.price_minor) is distinct from (old.name, old.price_minor) then
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
create trigger shopping_items_integrity before insert or update on public.shopping_items
  for each row execute function public.shopping_items_integrity();
revoke execute on function public.shopping_items_integrity() from public, anon, authenticated;

-- Reads go through the view: `bought_on` is set only while the linked expense is live.
create view public.shopping_item_status with (security_invoker = true) as
select i.id, i.user_id, i.name, i.currency, i.price_minor, i.created_at,
  t.id as transaction_id, t.occurred_on as bought_on
from public.shopping_items i
left join public.transactions t on t.id = i.bought_transaction_id and t.user_id = i.user_id and t.deleted_at is null;
grant select on public.shopping_item_status to authenticated;
