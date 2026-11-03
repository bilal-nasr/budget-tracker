-- Run with: pnpm db:test  (supabase test db). Needs the local stack.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- The auth.users insert trigger seeds a profile and starter categories for each user.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

insert into public.wallets (id, name, kind, currency)
values ('a1000000-0000-4000-8000-000000000001', 'Cash', 'cash', 'USD');

create temp table cats as
  select id, row_number() over (order by position) as n
  from public.categories where kind = 'expense' and parent_id is null;
grant all on cats to authenticated;

-- A limit set in 2026-10 applies to 2026-11 and 2026-12.
insert into public.budgets (category_id, currency, starts_month, limit_minor)
select id, 'USD', '2026-10-01', 30000 from cats where n = 1;

select is((select limit_minor from public.month_budgets('2026-11-15') where category_id = (select id from cats where n = 1)),
  30000::bigint, 'an October limit applies in November');
select is((select limit_minor from public.month_budgets('2026-12-01') where category_id = (select id from cats where n = 1)),
  30000::bigint, 'and in December');

-- A new limit in December leaves November unchanged.
insert into public.budgets (category_id, currency, starts_month, limit_minor)
select id, 'USD', '2026-12-01', 50000 from cats where n = 1;
select is((select limit_minor from public.month_budgets('2026-11-01') where category_id = (select id from cats where n = 1)),
  30000::bigint, 'a later change does not rewrite an earlier month');
select is((select limit_minor from public.month_budgets('2026-12-20') where category_id = (select id from cats where n = 1)),
  50000::bigint, 'the new limit applies from its month');

-- A null row removes the budget from that month on.
insert into public.budgets (category_id, currency, starts_month, limit_minor)
select id, 'USD', '2027-01-01', null from cats where n = 1;
select is((select count(*) from public.month_budgets('2027-01-01') where category_id = (select id from cats where n = 1)),
  0::bigint, 'a null limit removes the budget');

-- Spending: expenses count; income and soft-deleted rows do not.
insert into public.transactions (kind, occurred_on, wallet_id, amount_minor, currency, category_id, deleted_at)
select 'expense', '2026-11-01', 'a1000000-0000-4000-8000-000000000001', amt, 'USD', (select id from cats where n = 1),
       case when del then now() end
from (values (1000, false), (2500, false), (9999, true)) v(amt, del);
insert into public.transactions (kind, occurred_on, wallet_id, amount_minor, currency, category_id)
select 'income', '2026-11-02', 'a1000000-0000-4000-8000-000000000001', 7777, 'USD', id
from public.categories where kind = 'income' limit 1;
-- Outside the month.
insert into public.transactions (kind, occurred_on, wallet_id, amount_minor, currency, category_id)
select 'expense', '2026-12-01', 'a1000000-0000-4000-8000-000000000001', 4242, 'USD', (select id from cats where n = 1);

select is((select spent_minor from public.month_category_spend('2026-11-20') where category_id = (select id from cats where n = 1)),
  3500::bigint, 'only live expenses inside the month count');

-- A budget on an income category is refused.
select throws_ok(
  $$insert into public.budgets (category_id, currency, starts_month, limit_minor)
    select id, 'USD', '2026-11-01', 100 from public.categories where kind = 'income' limit 1$$,
  null, 'budgets are for top-level expense categories', 'income categories cannot have a budget');

-- A start that is not the first of a month is refused.
select throws_ok(
  $$insert into public.budgets (category_id, currency, starts_month, limit_minor)
    select id, 'USD', '2026-11-15', 100 from cats where n = 2$$,
  null, null, 'starts_month must be the first of a month');

-- User B sees none of user A's budgets or spending.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.month_budgets('2026-11-01')), 0::bigint, 'user B sees no budgets');
select is((select count(*) from public.month_category_spend('2026-11-01')), 0::bigint, 'user B sees no spending');

select * from finish();
rollback;
