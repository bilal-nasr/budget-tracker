-- Bulk actions: one call, all rows or none. Synthetic fixtures only; run with pnpm db:test.
begin;
-- Explicit denomination snapshots for the synthetic fixtures.
select set_config('request.headers', jsonb_build_object('x-budget-units', '{"USD":2,"LBP":0,"SYP":0}')::text, true);
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id, email) values
  ('bd000000-0000-4000-8000-000000000001', 'bulk-a@example.test'),
  ('bd000000-0000-4000-8000-000000000002', 'bulk-b@example.test');
select set_config('request.jwt.claims', '{"sub":"bd000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
with fixture(id, name, kind, currency) as (values ('bd100000-0000-4000-8000-000000000001', 'Cash', 'cash', 'USD')), containers as (
  insert into public.wallets(id, user_id, name, kind, default_balance_id)
  select f.id::uuid, auth.uid()::uuid, f.name, f.kind::public.wallet_kind, f.id::uuid from fixture f returning id, user_id
)
insert into public.wallet_balances(id, user_id, wallet_id, currency, opening_balance_minor, position)
select case when cc.code = f.currency then c.id else gen_random_uuid() end, c.user_id, c.id, cc.code, 0, 0
from fixture f join containers c on c.id = f.id::uuid join public.currencies cc on cc.user_id = c.user_id and cc.disabled_at is null;

create function pg_temp.category(p_kind text, p_offset integer default 0) returns uuid language sql as $$
  select id from public.categories where kind::text = p_kind and parent_id is null and archived_at is null
  order by position, id limit 1 offset p_offset
$$;
create function pg_temp.txn(p_number integer) returns uuid language sql as $$
  select ('bd300000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid
$$;
create function pg_temp.rev(p_number integer) returns integer language sql as $$
  select revision from public.transactions where id = pg_temp.txn(p_number)
$$;
create function pg_temp.items(variadic p_numbers integer[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', pg_temp.txn(n), 'revision', pg_temp.rev(n))) from unnest(p_numbers) n
$$;
create function pg_temp.balance() returns numeric language sql as $$
  select balance_minor from public.wallet_balance_totals where balance_id = 'bd100000-0000-4000-8000-000000000001'
$$;

-- Three expenses (100, 200, 300) and one income (5000).
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select pg_temp.txn(n), 'expense', current_date, 'bd100000-0000-4000-8000-000000000001', n * 100, 'USD', pg_temp.category('expense')
from generate_series(1, 3) n;
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
values (pg_temp.txn(4), 'income', current_date, 'bd100000-0000-4000-8000-000000000001', 5000, 'USD', pg_temp.category('income'));
select is(pg_temp.balance(), 4400::numeric, 'fixture balance');

-- Delete several.
select throws_ok($$select * from public.set_transactions_deleted('[]'::jsonb, true)$$, '22023', 'invalid transaction input', 'an empty batch is invalid');
select throws_ok($$select * from public.set_transactions_deleted(pg_temp.items(1, 1), true)$$, '22023', 'invalid transaction input', 'a repeated row is invalid');
select throws_ok($$select * from public.set_transactions_deleted(pg_temp.items(1) || jsonb_build_array(jsonb_build_object('id', pg_temp.txn(2), 'revision', 99)), true)$$,
  'BT003', 'transaction conflict', 'one stale revision refuses the batch');
select is((select count(*) from public.transactions where deleted_at is not null), 0::bigint, 'a refused batch deletes nothing');
select is(pg_temp.balance(), 4400::numeric, 'a refused batch moves no money');

create temp table deleted_batch as select * from public.set_transactions_deleted(pg_temp.items(1, 2), true);
select is((select count(*) from deleted_batch), 2::bigint, 'the batch reports every row');
select is((select count(*) from public.transactions where deleted_at is not null), 2::bigint, 'both rows are deleted');
select is(pg_temp.balance(), 4700::numeric, 'deleted expenses return to the balance');
select is((select bool_and(d.revision = t.revision) from deleted_batch d join public.transactions t on t.id = d.id), true, 'reported revisions are the stored ones');

-- Undo with the reported revisions restores exactly those rows.
select lives_ok($$select * from public.set_transactions_deleted((select jsonb_agg(jsonb_build_object('id', id, 'revision', revision)) from deleted_batch), false)$$, 'undo the batch');
select is((select count(*) from public.transactions where deleted_at is not null), 0::bigint, 'undo restores every row');
select is(pg_temp.balance(), 4400::numeric, 'undo restores the balance');
select throws_ok($$select * from public.set_transactions_deleted((select jsonb_agg(jsonb_build_object('id', id, 'revision', revision)) from deleted_batch), false)$$,
  'BT003', 'transaction conflict', 'a spent undo token cannot be replayed');

-- Change category of several.
select throws_ok($$select * from public.set_transactions_category(pg_temp.items(1, 4), pg_temp.category('expense', 1))$$,
  '22023', 'invalid transaction input', 'an income cannot take an expense category, and the batch is refused');
select is((select count(*) from public.transactions where category_id = pg_temp.category('expense', 1)), 0::bigint, 'a refused batch changes no category');
create temp table before_move as select id, revision from public.transactions;
select lives_ok($$select * from public.set_transactions_category(pg_temp.items(1, 2, 3), pg_temp.category('expense', 1))$$, 'move three expenses');
select is((select count(*) from public.transactions where category_id = pg_temp.category('expense', 1)), 3::bigint, 'all three moved');
select is((select bool_and(t.revision = b.revision + 1) from public.transactions t join before_move b on b.id = t.id where t.kind::text = 'expense'), true, 'each moved row gets a new revision');
select is((select revision from public.transactions where id = pg_temp.txn(4)), (select revision from before_move where id = pg_temp.txn(4)), 'the income is untouched');
select is(pg_temp.balance(), 4400::numeric, 'a category change moves no money');
select throws_ok($$select * from public.set_transactions_category(jsonb_build_array(jsonb_build_object('id', pg_temp.txn(1), 'revision', 1)), pg_temp.category('expense'))$$,
  'BT003', 'transaction conflict', 'a stale revision cannot change a category');
select throws_ok($$select * from public.set_transactions_category(pg_temp.items(1), gen_random_uuid())$$, null, 'category_unavailable', 'an unknown category is refused');

-- Remove several categories: unused ones are deleted, used ones archived.
create temp table category_fixture as
  select pg_temp.category('expense', 1) as used_id, pg_temp.category('expense', 2) as unused_id, pg_temp.category('expense', 3) as template_id;
select is((select count(*) from public.remove_categories(array[(select used_id from category_fixture), (select unused_id from category_fixture)])), 2::bigint, 'the batch reports both categories');
select ok((select archived_at is not null from public.categories where id = (select used_id from category_fixture)), 'a category with history is archived');
select is((select count(*) from public.categories where id = (select unused_id from category_fixture)), 0::bigint, 'an unused category is deleted');

-- One blocked category stops the batch and nothing else is removed.
insert into public.fixed_expenses(name, amount_minor, balance_id, category_id, position)
values ('Synthetic rent', 1000, 'bd100000-0000-4000-8000-000000000001', (select template_id from category_fixture), 1);
create temp table spare as select pg_temp.category('expense', 4) as id;
select throws_ok($$select * from public.remove_categories(array[(select template_id from category_fixture), (select id from spare)])$$, null, 'category_in_use', 'a category used by a fixed expense refuses the batch');
select is((select count(*) from public.categories where id = (select id from spare) and archived_at is null), 1::bigint, 'the other category in a refused batch stays');
select throws_ok($$select * from public.remove_categories(array[]::uuid[])$$, null, 'category_not_found', 'an empty category batch is invalid');

-- Delete several client payments; one with a receipt refuses the batch.
select public.create_pending_payment(jsonb_build_object('requestId', 'bd400000-0000-4000-8000-00000000000' || n, 'client', 'Client ' || n,
  'project', 'Job ' || n, 'currency', 'USD', 'totalMinor', 10000, 'dueOn', null)) from generate_series(1, 3) n;
select public.record_pending_receipt(jsonb_build_object('requestId', 'bd500000-0000-4000-8000-000000000001', 'paymentId', 'bd400000-0000-4000-8000-000000000003',
  'balanceId', 'bd100000-0000-4000-8000-000000000001', 'categoryId', pg_temp.category('income'), 'amountMinor', 2500, 'occurredOn', public.loan_today()));
create function pg_temp.jobs(variadic p_numbers integer[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', p.id, 'revision', p.revision)) from public.pending_payments p
  where p.id in (select ('bd400000-0000-4000-8000-00000000000' || n)::uuid from unnest(p_numbers) n)
$$;
select throws_ok($$select public.delete_pending_payments(pg_temp.jobs(1, 3))$$, null, 'pending.inUse', 'a payment with a receipt refuses the batch');
select is((select count(*) from public.pending_payments where deleted_at is null), 3::bigint, 'a refused batch deletes no payment');
select lives_ok($$select public.delete_pending_payments(pg_temp.jobs(1, 2))$$, 'delete two unpaid payments');
select is((select count(*) from public.pending_payments where deleted_at is null), 1::bigint, 'only the payment with a receipt remains');
select throws_ok($$select public.delete_pending_payments('[]'::jsonb)$$, null, 'pending.invalid', 'an empty payment batch is invalid');

-- Another account can neither see nor batch-change these rows.
reset role;
select set_config('request.jwt.claims', '{"sub":"bd000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.set_transactions_deleted(jsonb_build_array(jsonb_build_object('id', 'bd300000-0000-4000-8000-000000000003', 'revision', 2)), true)$$,
  'BT003', 'transaction conflict', 'another account cannot delete these rows');
select throws_ok($$select * from public.remove_categories(array['bd300000-0000-4000-8000-000000000003'::uuid])$$, null, 'category_not_found', 'another account cannot remove foreign categories');

select * from finish();
rollback;
