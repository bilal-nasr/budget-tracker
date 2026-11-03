-- Fixed (monthly) expenses: a template with an amount, a wallet and a
-- category. Pressing "Paid" records a real expense transaction from it.
-- Nothing is paid automatically.

create table public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000000),
  wallet_id uuid not null references public.wallets (id),
  category_id uuid not null references public.categories (id),
  -- Day of the month it is usually due. A hint only.
  due_day smallint check (due_day is null or due_day between 1 and 31),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index fixed_expenses_user_idx on public.fixed_expenses (user_id, position, created_at);

-- Wallet and category must be the caller's own, the category must be an
-- expense category, and a new or moved item cannot use an archived wallet.
create function public.fixed_expenses_integrity()
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

  select id, archived_at into w from public.wallets where id = new.wallet_id;
  if not found then
    raise exception 'wallet not found';
  end if;
  if w.archived_at is not null
     and (tg_op = 'INSERT' or new.wallet_id is distinct from old.wallet_id) then
    raise exception 'wallet is archived';
  end if;

  select id, kind into c from public.categories where id = new.category_id;
  if not found or c.kind <> 'expense' then
    raise exception 'category must be an expense category';
  end if;
  return new;
end;
$$;

create trigger fixed_expenses_integrity
  before insert or update on public.fixed_expenses
  for each row execute function public.fixed_expenses_integrity();

alter table public.fixed_expenses enable row level security;

create policy fixed_expenses_select on public.fixed_expenses
  for select using (user_id = (select auth.uid()));
create policy fixed_expenses_insert on public.fixed_expenses
  for insert with check (user_id = (select auth.uid()));
create policy fixed_expenses_update on public.fixed_expenses
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy fixed_expenses_delete on public.fixed_expenses
  for delete using (user_id = (select auth.uid()));

-- Link each recorded payment to its template. Deleting a template keeps the
-- payments it made (the link just becomes empty).
alter table public.transactions
  add column fixed_expense_id uuid references public.fixed_expenses (id) on delete set null;

alter table public.transactions drop constraint transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check check (source is null or source in ('salary', 'fixed'));

create index transactions_fixed_idx on public.transactions (fixed_expense_id, occurred_on desc)
  where fixed_expense_id is not null and deleted_at is null;

revoke execute on function public.fixed_expenses_integrity() from public, anon, authenticated;
