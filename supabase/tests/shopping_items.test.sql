begin;
-- Explicit denomination snapshots for the synthetic fixtures.
select set_config('request.headers', jsonb_build_object('x-budget-units', '{"USD":2,"LBP":0,"SYP":0}')::text, true);
create extension if not exists pgtap with schema extensions;
select plan(15);
insert into auth.users(id, email) values
  ('ef000000-0000-4000-8000-000000000001', 'items-a@example.test'),
  ('ef000000-0000-4000-8000-000000000002', 'items-b@example.test');
select set_config('request.jwt.claims', '{"sub":"ef000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
with fixture(id, name, kind, currency) as (values ('ef100000-0000-4000-8000-000000000001', 'Cash', 'cash', 'USD')), containers as (
  insert into public.wallets(id, user_id, name, kind, default_balance_id)
  select f.id::uuid, auth.uid()::uuid, f.name, f.kind::public.wallet_kind, f.id::uuid from fixture f returning id, user_id
)
insert into public.wallet_balances(id, user_id, wallet_id, currency, opening_balance_minor, position)
select case when cc.code = f.currency then c.id else gen_random_uuid() end, c.user_id, c.id, cc.code, 0, 0
from fixture f join containers c on c.id = f.id::uuid join public.currencies cc on cc.user_id = c.user_id and cc.disabled_at is null;

select lives_ok($$insert into public.shopping_items(id, name, currency, price_minor) values ('ef200000-0000-4000-8000-000000000001', '  Milk ', 'USD', 350)$$, 'create item');
select is((select name from public.shopping_items), 'Milk', 'name is trimmed');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor) values (gen_random_uuid(), 'Free', 'USD', 0)$$, '23514', null, 'price must be positive');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor) values (gen_random_uuid(), '   ', 'USD', 100)$$, '23514', null, 'name must not be blank');
select throws_ok($$insert into public.shopping_items(id, name, currency, price_minor) values (gen_random_uuid(), 'Odd', 'XXX', 100)$$, '23503', null, 'currency must be in the catalog');
select lives_ok($$update public.shopping_items set name = 'Oat milk', price_minor = 400 where id = 'ef200000-0000-4000-8000-000000000001'$$, 'edit an unbought item');
select throws_ok($$update public.shopping_items set currency = 'LBP' where id = 'ef200000-0000-4000-8000-000000000001'$$, null, 'items.invalid', 'currency is fixed');
select is((select count(*) from public.shopping_item_status where bought_on is null), 1::bigint, 'unbought item has no purchase date');
select is((select count(*) from public.transactions), 0::bigint, 'an item alone creates no ledger entry');

-- Buying: an ordinary expense, then the link.
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'ef300000-0000-4000-8000-000000000001', 'expense', current_date, 'ef100000-0000-4000-8000-000000000001', 400, 'USD', id
from public.categories where kind = 'expense' and parent_id is null and archived_at is null order by position limit 1;
select lives_ok($$update public.shopping_items set bought_transaction_id = 'ef300000-0000-4000-8000-000000000001' where id = 'ef200000-0000-4000-8000-000000000001'$$, 'link the expense');
select is((select count(*) from public.shopping_item_status where bought_on is not null), 1::bigint, 'item reads as bought');
select throws_ok($$update public.shopping_items set price_minor = 999 where id = 'ef200000-0000-4000-8000-000000000001'$$, null, 'items.bought', 'bought price is locked');

-- Deleting the expense (Undo) returns the item to the list and unlocks it.
update public.transactions set deleted_at = now() where id = 'ef300000-0000-4000-8000-000000000001';
select is((select count(*) from public.shopping_item_status where bought_on is null), 1::bigint, 'deleted purchase returns the item');
select lives_ok($$update public.shopping_items set price_minor = 450 where id = 'ef200000-0000-4000-8000-000000000001'$$, 'unbought again, editable');

-- Another account cannot see or touch these items.
reset role;
select set_config('request.jwt.claims', '{"sub":"ef000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.shopping_items), 0::bigint, 'second account sees nothing');

select * from finish();
rollback;
