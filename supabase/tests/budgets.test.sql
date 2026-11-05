-- Run with: pnpm db:test  (supabase test db). Needs the local stack.
begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
create extension if not exists pgtap with schema extensions;
select plan(10);

-- The auth.users insert trigger seeds a profile and starter categories for each user.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('a1000000-0000-4000-8000-000000000001', 'Cash', 'cash', 'USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

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
insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id, deleted_at)
select 'expense', '2026-11-01', 'a1000000-0000-4000-8000-000000000001', amt, 'USD', (select id from cats where n = 1),
       case when del then now() end
from (values (1000, false), (2500, false), (9999, true)) v(amt, del);
insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'income', '2026-11-02', 'a1000000-0000-4000-8000-000000000001', 7777, 'USD', id
from public.categories where kind = 'income' limit 1;
-- Outside the month.
insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id)
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
