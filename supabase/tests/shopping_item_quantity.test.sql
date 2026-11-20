-- Item calculator quantity: whole numbers 1..9999, default 1, price x quantity inside the money
-- range, locked once bought, kept through Undo; and "Delete selected" in one statement.
begin;
select set_config('request.headers', jsonb_build_object('x-budget-units', '{"USD":2,"LBP":0,"SYP":0}')::text, true);
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id, email) values
  ('fa000000-0000-4000-8000-000000000001', 'item-quantity-a@example.test'),
  ('fa000000-0000-4000-8000-000000000002', 'item-quantity-b@example.test');
create function pg_temp.login(p_user uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

set local role authenticated;
select pg_temp.login('fa000000-0000-4000-8000-000000000001');
with fixture(id, name, kind, currency) as (values ('fa100000-0000-4000-8000-000000000001', 'Cash', 'cash', 'USD')), containers as (
  insert into public.wallets(id, user_id, name, kind, default_balance_id)
  select f.id::uuid, auth.uid()::uuid, f.name, f.kind::public.wallet_kind, f.id::uuid from fixture f returning id, user_id
)
insert into public.wallet_balances(id, user_id, wallet_id, currency, opening_balance_minor, position)
select case when cc.code = f.currency then c.id else gen_random_uuid() end, c.user_id, c.id, cc.code, 0, 0
from fixture f join containers c on c.id = f.id::uuid join public.currencies cc on cc.user_id = c.user_id and cc.disabled_at is null;

select lives_ok($$insert into public.shopping_items(id, name, currency, price_minor)
  values ('fa200000-0000-4000-8000-000000000001', 'Milk', 'USD', 350)$$, 'an item without a quantity is added');
select is((select quantity from public.shopping_item_status where id = 'fa200000-0000-4000-8000-000000000001'), 1, 'its quantity is 1');
select lives_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values ('fa200000-0000-4000-8000-000000000002', 'Screws', 'USD', 50, 9999)$$, 'a quantity of 9999 is accepted');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values (gen_random_uuid(), 'X', 'USD', 100, 0)$$, '23514', null, 'a quantity of 0 is refused');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values (gen_random_uuid(), 'X', 'USD', 100, 10000)$$, '23514', null, 'a quantity of 10000 is refused');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values (gen_random_uuid(), 'X', 'USD', 100, null)$$, '23502', null, 'a null quantity is refused');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values (gen_random_uuid(), 'X', 'USD', 1000000000000000, 2)$$, '23514', null, 'an item total above the money range is refused, without overflowing');
select lives_ok($$insert into public.shopping_items(id, name, currency, price_minor, quantity)
  values ('fa200000-0000-4000-8000-000000000003', 'Edge', 'USD', 100000000000000, 10)$$, 'an item total exactly at the range limit is accepted');
select throws_ok($$update public.shopping_items set quantity = 100 where id = 'fa200000-0000-4000-8000-000000000003'$$, '23514', null,
  'raising the quantity cannot push the item total out of range');
select lives_ok($$update public.shopping_items set quantity = 3 where id = 'fa200000-0000-4000-8000-000000000001'$$, 'the quantity of an unbought item can change');

-- Buying 3 x 3.50: the quantity is locked while the purchase is live, and survives Undo.
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'fa300000-0000-4000-8000-000000000001', 'expense', current_date, 'fa100000-0000-4000-8000-000000000001', 1050, 'USD', id
from public.categories where kind = 'expense' and parent_id is null and archived_at is null order by position limit 1;
update public.shopping_items set bought_transaction_id = 'fa300000-0000-4000-8000-000000000001' where id = 'fa200000-0000-4000-8000-000000000001';
select throws_ok($$update public.shopping_items set quantity = 5 where id = 'fa200000-0000-4000-8000-000000000001'$$, null, 'items.bought', 'a bought quantity is locked');
update public.transactions set deleted_at = now() where id = 'fa300000-0000-4000-8000-000000000001';
select is((select quantity from public.shopping_item_status where id = 'fa200000-0000-4000-8000-000000000001' and bought_on is null), 3,
  'undoing the purchase returns the item with its quantity');
select lives_ok($$update public.shopping_items set quantity = 2 where id = 'fa200000-0000-4000-8000-000000000001'$$, 'unbought again, the quantity is editable');

-- Delete selected: one statement, own rows only.
select throws_ok($$select public.delete_shopping_items('{}'::uuid[])$$, null, 'items.invalid', 'an empty selection is refused');
select throws_ok($$select public.delete_shopping_items(null)$$, null, 'items.invalid', 'a missing selection is refused');
select is(public.delete_shopping_items(array['fa200000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000002', 'fa900000-0000-4000-8000-000000000009']::uuid[]),
  2, 'two items are deleted together; an unknown id is not counted');
select is((select array_agg(id::text) from public.shopping_items), array['fa200000-0000-4000-8000-000000000003'], 'the unticked item stays');

reset role;
set local role authenticated;
select pg_temp.login('fa000000-0000-4000-8000-000000000002');
select is(public.delete_shopping_items(array['fa200000-0000-4000-8000-000000000003']::uuid[]), 0, 'another account deletes nothing');
reset role;
select is((select count(*) from public.shopping_items where id = 'fa200000-0000-4000-8000-000000000003'), 1::bigint, 'and the item is still there');
select is((select count(*) from public.transactions where id = 'fa300000-0000-4000-8000-000000000001'), 1::bigint, 'the recorded purchase is untouched');

select * from finish();
rollback;
