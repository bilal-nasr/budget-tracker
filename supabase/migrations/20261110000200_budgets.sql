-- Monthly budgets: a limit per expense category per currency. A limit applies
-- from the month it is set until a newer row for the same category and
-- currency replaces it, so past months keep their old limits and new months
-- inherit the latest one. A row with a null limit means "no budget from this
-- month on".

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  currency public.currency not null,
  -- First day of the month the limit starts applying.
  starts_month date not null check (extract(day from starts_month) = 1),
  limit_minor bigint check (limit_minor is null or limit_minor between 1 and 1000000000000000),
  created_at timestamptz not null default now(),
  unique (user_id, category_id, currency, starts_month)
);

create index budgets_user_idx on public.budgets (user_id, category_id, currency, starts_month desc);

-- The category must be the caller's own, a top-level expense category.
-- RLS applies to the lookup, so another user's category "does not exist".
create function public.budgets_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c record;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'user_id cannot change';
  end if;
  select id, kind, parent_id into c from public.categories where id = new.category_id;
  if not found then
    raise exception 'category not found';
  end if;
  if c.kind::text <> 'expense' or c.parent_id is not null then
    raise exception 'budgets are for top-level expense categories';
  end if;
  return new;
end;
$$;

create trigger budgets_integrity
  before insert or update on public.budgets
  for each row execute function public.budgets_integrity();

alter table public.budgets enable row level security;

create policy budgets_select on public.budgets
  for select using (user_id = (select auth.uid()));
create policy budgets_insert on public.budgets
  for insert with check (user_id = (select auth.uid()));
create policy budgets_update on public.budgets
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy budgets_delete on public.budgets
  for delete using (user_id = (select auth.uid()));

-- The limit in force for each category and currency in the given month.
-- Combinations whose newest row has a null limit are left out.
create function public.month_budgets(p_month date)
returns table (category_id uuid, currency public.currency, limit_minor bigint, starts_month date)
language sql
stable
security invoker
set search_path = ''
as $$
  select latest.category_id, latest.currency, latest.limit_minor, latest.starts_month
  from (
    select distinct on (b.category_id, b.currency)
      b.category_id, b.currency, b.limit_minor, b.starts_month
    from public.budgets b
    where b.starts_month <= date_trunc('month', p_month)::date
    order by b.category_id, b.currency, b.starts_month desc
  ) latest
  where latest.limit_minor is not null;
$$;

-- Expense totals per top-level category and currency for the month.
-- Subcategory spending counts under its parent; transfers, income and
-- soft-deleted rows are not spending.
create function public.month_category_spend(p_month date)
returns table (category_id uuid, currency public.currency, spent_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(c.parent_id, c.id) as category_id, t.currency, sum(t.amount_minor)::bigint as spent_minor
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.kind::text = 'expense'
    and t.deleted_at is null
    and t.occurred_on >= date_trunc('month', p_month)::date
    and t.occurred_on < (date_trunc('month', p_month) + interval '1 month')::date
  group by coalesce(c.parent_id, c.id), t.currency;
$$;

revoke execute on function public.budgets_integrity() from public, anon, authenticated;
grant execute on function public.month_budgets(date), public.month_category_spend(date) to authenticated;
