-- Phase 3: wallets and transactions (expense / income). Transfers and
-- exchanges arrive in Phase 5. Amounts are integer minor units: USD cents,
-- LBP whole lira. Currencies are never mixed.

create type public.currency as enum ('USD', 'LBP');
create type public.wallet_kind as enum ('cash', 'bank', 'card');
create type public.txn_kind as enum ('expense', 'income');

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind public.wallet_kind not null,
  currency public.currency not null,
  -- May be negative (a card in debt).
  opening_balance_minor bigint not null default 0
    check (abs(opening_balance_minor) <= 1000000000000000),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallets_user_idx on public.wallets (user_id, position)
  where archived_at is null;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind public.txn_kind not null,
  occurred_on date not null check (occurred_on >= date '2000-01-01'),
  wallet_id uuid not null references public.wallets (id),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  -- Copied from the wallet by the trigger below; never trusted from the client.
  currency public.currency not null,
  category_id uuid not null references public.categories (id),
  note text check (note is null or char_length(note) <= 140),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Keyset pagination order for the activity list.
create index transactions_feed_idx
  on public.transactions (user_id, occurred_on desc, created_at desc, id desc)
  where deleted_at is null;
create index transactions_wallet_idx on public.transactions (wallet_id)
  where deleted_at is null;
create index transactions_category_idx on public.transactions (category_id)
  where deleted_at is null;

-- Integrity: wallet and category must be the caller's own, the category kind
-- must match, new activity cannot go into an archived wallet, and the
-- currency always comes from the wallet. RLS applies to these lookups, so
-- another user's ids simply "do not exist".
create function public.transactions_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  w record;
  c record;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'user_id cannot change';
  end if;

  select id, currency, archived_at into w from public.wallets where id = new.wallet_id;
  if not found then
    raise exception 'wallet not found';
  end if;
  if w.archived_at is not null
     and (tg_op = 'INSERT' or new.wallet_id is distinct from old.wallet_id) then
    raise exception 'wallet is archived';
  end if;
  new.currency := w.currency;

  select id, kind into c from public.categories where id = new.category_id;
  if not found then
    raise exception 'category not found';
  end if;
  if c.kind::text <> new.kind::text then
    raise exception 'category kind does not match transaction kind';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger transactions_integrity
  before insert or update on public.transactions
  for each row execute function public.transactions_integrity();

-- A wallet's currency cannot change once it has history.
create function public.wallets_currency_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency <> old.currency
     and exists (select 1 from public.transactions t where t.wallet_id = old.id) then
    raise exception 'wallet currency cannot change after it has transactions';
  end if;
  if new.user_id <> old.user_id then
    raise exception 'user_id cannot change';
  end if;
  return new;
end;
$$;

create trigger wallets_currency_locked
  before update on public.wallets
  for each row execute function public.wallets_currency_locked();

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;

create policy wallets_select on public.wallets
  for select using (user_id = (select auth.uid()));
create policy wallets_insert on public.wallets
  for insert with check (user_id = (select auth.uid()));
create policy wallets_update on public.wallets
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No delete policy: wallets are archived, never deleted.

create policy transactions_select on public.transactions
  for select using (user_id = (select auth.uid()));
create policy transactions_insert on public.transactions
  for insert with check (user_id = (select auth.uid()));
create policy transactions_update on public.transactions
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No delete policy: deletion is soft (deleted_at) so it can be undone.

-- Current balance per wallet: opening + income - expenses (soft-deleted ignored).
create view public.wallet_balances
with (security_invoker = true) as
select
  w.id as wallet_id,
  w.user_id,
  w.opening_balance_minor
    + coalesce(sum(case t.kind when 'income' then t.amount_minor else -t.amount_minor end), 0)
    as balance_minor
from public.wallets w
left join public.transactions t
  on t.wallet_id = w.id and t.deleted_at is null
group by w.id;

revoke execute on function public.transactions_integrity() from public, anon, authenticated;
revoke execute on function public.wallets_currency_locked() from public, anon, authenticated;
