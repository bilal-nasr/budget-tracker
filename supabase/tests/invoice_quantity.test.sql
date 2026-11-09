-- Invoice rows carry a quantity: whole numbers 1..9999, default 1, price x quantity inside the
-- money range, a quantity change is an edit, and Undo brings the quantity back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id, email) values ('f9000000-0000-4000-8000-0000000000a1', 'quantity-a@example.test');
create function pg_temp.login(p_user uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

set local role authenticated;
select pg_temp.login('f9000000-0000-4000-8000-0000000000a1');
insert into public.invoice_folders(id, name) values ('f9100000-0000-4000-8000-0000000000a1', 'PC build');

select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-0000000000a1', 'Fans', 'USD', 2, 1500)$$,
  'a row without a quantity is added');
select is((select quantity from public.invoice_items where id = 'f9200000-0000-4000-8000-000000000001'), 1, 'its quantity is 1');

select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values ('f9200000-0000-4000-8000-000000000002', 'f9100000-0000-4000-8000-0000000000a1', 'Screws', 'USD', 2, 50, 9999)$$,
  'a quantity of 9999 is accepted');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values (gen_random_uuid(), 'f9100000-0000-4000-8000-0000000000a1', 'X', 'USD', 2, 100, 0)$$, '23514', null, 'a quantity of 0 is refused');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values (gen_random_uuid(), 'f9100000-0000-4000-8000-0000000000a1', 'X', 'USD', 2, 100, 10000)$$, '23514', null, 'a quantity of 10000 is refused');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values (gen_random_uuid(), 'f9100000-0000-4000-8000-0000000000a1', 'X', 'USD', 2, 100, null)$$, '23502', null, 'a missing quantity is refused when given as null');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values (gen_random_uuid(), 'f9100000-0000-4000-8000-0000000000a1', 'X', 'USD', 2, 1000000000000000, 2)$$, '23514', null,
  'a row total above the money range is refused, without overflowing');
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity)
  values ('f9200000-0000-4000-8000-000000000003', 'f9100000-0000-4000-8000-0000000000a1', 'Edge', 'USD', 2, 100000000000000, 10)$$,
  'a row total exactly at the range limit is accepted');

-- A quantity change alone is an edit: newer version, editor recorded.
create temp table stamps(label text primary key, at timestamptz not null);
grant all on stamps to authenticated;
insert into stamps select 'before', updated_at from public.invoice_items where id = 'f9200000-0000-4000-8000-000000000001';
update public.invoice_items set quantity = 3 where id = 'f9200000-0000-4000-8000-000000000001';
select ok((select i.quantity = 3 and i.updated_at > s.at and i.updated_by = 'f9000000-0000-4000-8000-0000000000a1'
  from public.invoice_items i, stamps s where i.id = 'f9200000-0000-4000-8000-000000000001' and s.label = 'before'),
  'changing only the quantity bumps the version');
select throws_ok($$update public.invoice_items set quantity = 100 where id = 'f9200000-0000-4000-8000-000000000003'$$, '23514', null,
  'raising the quantity cannot push the row total out of range');

-- Undo returns the row with its quantity.
delete from public.invoice_items where id = 'f9200000-0000-4000-8000-000000000001';
select lives_ok($$select public.restore_invoice_item('f9200000-0000-4000-8000-000000000001')$$, 'a deleted row is restored');
select is((select quantity from public.invoice_items where id = 'f9200000-0000-4000-8000-000000000001'), 3, 'with the quantity it had');

select * from finish();
rollback;
