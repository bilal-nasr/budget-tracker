-- Two accounts must never see or touch each other's data. Run with: pnpm db:test
begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
create extension if not exists pgtap with schema extensions;
select plan(11);

-- The auth.users insert trigger seeds a profile and starter categories for each user.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');

-- User A creates one of everything.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('a1000000-0000-4000-8000-000000000001', 'A cash', 'cash', 'USD')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create temp table a_cat as
  select id from public.categories where kind = 'expense' and parent_id is null order by position limit 1;
grant all on a_cat to authenticated;

insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'expense', current_date, 'a1000000-0000-4000-8000-000000000001', 1000, 'USD', id from a_cat;
insert into public.fixed_expenses (name, amount_minor, balance_id, category_id)
select 'Rent', 5000, 'a1000000-0000-4000-8000-000000000001', id from a_cat;
insert into public.installments (name, total_minor, balance_id, category_id)
select 'Laptop', 100000, 'a1000000-0000-4000-8000-000000000001', id from a_cat;
insert into public.budgets (category_id, currency, starts_month, limit_minor)
select id, 'USD', date_trunc('month', current_date)::date, 30000 from a_cat;

-- User B sees none of it.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*) from public.wallets), 0::bigint, 'B sees no wallets of A');
select is((select count(*) from public.transactions), 0::bigint, 'B sees no transactions of A');
select is((select count(*) from public.fixed_expenses), 0::bigint, 'B sees no fixed expenses of A');
select is((select count(*) from public.installments), 0::bigint, 'B sees no installments of A');
select is((select count(*) from public.budgets), 0::bigint, 'B sees no budgets of A');
select is((select count(*) from public.wallet_balances), 0::bigint, 'B sees no wallet balances of A');
select is((select count(*) from public.profiles where user_id <> 'bbbbbbbb-0000-4000-8000-000000000002'), 0::bigint,
  'B sees only their own profile');
select is((select count(*) from public.categories where user_id <> 'bbbbbbbb-0000-4000-8000-000000000002'), 0::bigint,
  'B sees only their own categories');

-- B cannot use A's wallet or category.
select throws_ok(
  $$insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id)
    select 'expense', current_date, 'a1000000-0000-4000-8000-000000000001', 100, 'USD', id
    from public.categories where kind = 'expense' limit 1$$,
  null, 'balance.unavailable', 'B cannot post to A''s wallet');

select is((select count(*) from public.month_budgets(current_date)), 0::bigint, 'B sees no budget limits of A');
select is((select count(*) from public.month_category_spend(current_date)), 0::bigint, 'B sees no spending of A');

select * from finish();
rollback;
