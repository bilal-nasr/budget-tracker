-- Run with: pnpm db:test  (supabase test db). Needs the local stack.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Two users. The auth.users insert trigger seeds a profile and starter
-- categories for each. User A gets two USD wallets and one LBP wallet.
insert into auth.users (id, instance_id, aud, role, email)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.test');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('a1000000-0000-4000-8000-000000000001', 'Bank', 'bank', 'USD'),
  ('a1000000-0000-4000-8000-000000000002', 'Cash', 'cash', 'USD'),
  ('a1000000-0000-4000-8000-000000000003', 'Cash LBP', 'cash', 'LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select c.id,c.user_id,c.id,f.currency,0::bigint,0 from fixture f join containers c on c.id=f.id::uuid;

insert into public.installments (id, name, total_minor, balance_id, category_id)
select 'a2000000-0000-4000-8000-000000000001', 'Laptop', 100000, 'a1000000-0000-4000-8000-000000000001', c.id
from public.categories c where c.kind = 'expense' limit 1;

select is((select currency::text from public.installments where name = 'Laptop'), 'USD',
  'currency is copied from the default wallet');

create function pg_temp.pay(w uuid, amount bigint) returns void language sql as $f$
  -- These tests deliberately record another payment to exercise the principal
  -- cap. Supply the actual current receipt and acknowledge the last live payment
  -- so the newer repeat guard does not mask the principal/currency assertions.
  insert into public.transactions (kind, occurred_on, balance_id, amount_minor, currency, category_id,
    source, installment_id, salary_cycle_id, installment_override_of)
  select 'expense', current_date, w, amount, 'USD', i.category_id, 'installment', i.id, s.id, p.id
  from public.installments i
  left join lateral (
    select t.id from public.transactions t
    where t.user_id = i.user_id and t.source = 'salary' and t.kind::text = 'income' and t.deleted_at is null
    order by t.created_at desc,t.id desc limit 1
  ) s on true
  left join lateral (
    select t.id from public.transactions t
    where t.user_id = i.user_id and t.installment_id = i.id and t.deleted_at is null
      and t.salary_cycle_id is not distinct from s.id
    order by t.created_at desc,t.id desc limit 1
  ) p on true
  where i.name = 'Laptop'
$f$;

select lives_ok($$select pg_temp.pay('a1000000-0000-4000-8000-000000000001', 40000)$$, 'first payment fits');
select lives_ok($$select pg_temp.pay('a1000000-0000-4000-8000-000000000002', 60000)$$,
  'second payment, from another USD wallet, fits');
select throws_ok($$select pg_temp.pay('a1000000-0000-4000-8000-000000000001', 1)$$, null, 'exceeds remaining',
  'a payment above the remainder is refused');

select is((select remaining_minor from public.installment_progress), 0::numeric, 'nothing left');

-- Raising a payment above the remainder is refused too; soft-deleting frees the room.
select throws_ok($$update public.transactions set amount_minor = 40001 where amount_minor = 40000$$, null,
  'exceeds remaining', 'editing a payment upwards respects the remainder');
select lives_ok($$update public.transactions set deleted_at = now() where amount_minor = 40000$$, 'soft delete');
select lives_ok($$select pg_temp.pay('a1000000-0000-4000-8000-000000000001', 40000)$$, 'room is free again');

select throws_ok(
  $$select pg_temp.pay('a1000000-0000-4000-8000-000000000003', 100)$$,
  null, 'wallet currency does not match the installment', 'a payment from an LBP wallet is refused');

select throws_ok($$update public.installments set total_minor = 50000 where name = 'Laptop'$$, null,
  'total below paid', 'the total cannot go below what is paid');

-- User B cannot see user A's installment or progress.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.installments), 0::bigint, 'user B sees no installments');
select is((select count(*) from public.installment_progress), 0::bigint, 'user B sees no progress');

select * from finish();
rollback;
