-- Installments: a total to pay off over time. Each payment is an ordinary
-- expense transaction linked by transactions.installment_id (source = 'installment'),
-- so it deducts from its wallet, shows in Activity and counts toward budgets.
-- An installment has one currency, copied from its default wallet and locked;
-- a payment may come from any active wallet in that currency.

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  total_minor bigint not null check (total_minor between 1 and 1000000000000000),
  -- Paid before the app existed; no fake transactions are created for it.
  paid_before_minor bigint not null default 0 check (paid_before_minor >= 0),
  -- Set from the default wallet by the trigger below.
  currency public.currency not null,
  wallet_id uuid not null references public.wallets (id),
  category_id uuid not null references public.categories (id),
  monthly_minor bigint check (monthly_minor is null or monthly_minor between 1 and 1000000000000000),
  due_day smallint check (due_day is null or due_day between 1 and 31),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (paid_before_minor <= total_minor)
);

create index installments_user_idx on public.installments (user_id, position, created_at);

alter table public.transactions
  add column installment_id uuid references public.installments (id) on delete set null;

alter table public.transactions drop constraint transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check
  check (source is null or source in ('salary', 'fixed', 'installment'));

create index transactions_installment_idx on public.transactions (installment_id, occurred_on desc)
  where installment_id is not null and deleted_at is null;

-- Installment rules. RLS applies to the lookups, so another user's wallet or
-- category simply "does not exist".
create function public.installments_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  w record;
  c record;
  paid bigint;
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

  if tg_op = 'INSERT' then
    new.currency := w.currency;
  else
    if new.currency <> old.currency then
      raise exception 'currency cannot change';
    end if;
    if w.currency <> new.currency then
      raise exception 'wallet currency does not match the installment';
    end if;
  end if;

  select id, kind into c from public.categories where id = new.category_id;
  if not found or c.kind::text <> 'expense' then
    raise exception 'category must be an expense category';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(t.amount_minor), 0) into paid
    from public.transactions t
    where t.installment_id = new.id and t.deleted_at is null;
    if new.total_minor < new.paid_before_minor + paid then
      raise exception 'total below paid';
    end if;
  end if;
  return new;
end;
$$;

create trigger installments_integrity
  before insert or update on public.installments
  for each row execute function public.installments_integrity();

-- A payment must be an expense in the installment's currency and may not take
-- the paid amount above the total. Named so it fires before
-- transactions_integrity (alphabetical), which is why the currency is read
-- from the wallet here rather than from new.currency.
create function public.transactions_installment_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  i record;
  w record;
  others bigint;
begin
  if new.installment_id is null then
    return new;
  end if;

  if new.kind::text <> 'expense' then
    raise exception 'installment payments must be expenses';
  end if;

  -- Lock the installment so two payments cannot both fit the same remainder.
  select id, currency, total_minor, paid_before_minor into i
  from public.installments where id = new.installment_id for update;
  if not found then
    raise exception 'installment not found';
  end if;

  select currency into w from public.wallets where id = new.wallet_id;
  if not found then
    raise exception 'wallet not found';
  end if;
  if w.currency <> i.currency then
    raise exception 'wallet currency does not match the installment';
  end if;

  if new.deleted_at is null then
    select coalesce(sum(t.amount_minor), 0) into others
    from public.transactions t
    where t.installment_id = new.installment_id
      and t.deleted_at is null
      and t.id <> new.id;
    if i.paid_before_minor + others + new.amount_minor > i.total_minor then
      raise exception 'exceeds remaining';
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_installment_check
  before insert or update on public.transactions
  for each row execute function public.transactions_installment_check();

alter table public.installments enable row level security;

create policy installments_select on public.installments
  for select using (user_id = (select auth.uid()));
create policy installments_insert on public.installments
  for insert with check (user_id = (select auth.uid()));
create policy installments_update on public.installments
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy installments_delete on public.installments
  for delete using (user_id = (select auth.uid()));

-- Paid so far (before the app plus live payments) and what is left.
create view public.installment_progress
with (security_invoker = true) as
select
  i.id as installment_id,
  i.user_id,
  i.paid_before_minor + coalesce(p.paid, 0) as paid_minor,
  i.total_minor - i.paid_before_minor - coalesce(p.paid, 0) as remaining_minor,
  coalesce(p.payment_count, 0) as payment_count,
  p.last_paid_on
from public.installments i
left join lateral (
  select sum(t.amount_minor) as paid, count(*) as payment_count, max(t.occurred_on) as last_paid_on
  from public.transactions t
  where t.installment_id = i.id and t.deleted_at is null
) p on true;

revoke execute on function public.installments_integrity() from public, anon, authenticated;
revoke execute on function public.transactions_installment_check() from public, anon, authenticated;
