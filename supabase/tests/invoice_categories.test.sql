-- Invoice categories: each folder has its own list, every member manages it, rows always sit
-- in one category of their own folder, and deleting a category moves its rows to "Other".
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- A owns the folder, B joins it, C is a stranger, D owns a different folder.
insert into auth.users(id, email) values
  ('f5000000-0000-4000-8000-0000000000a1', 'categories-a@example.test'),
  ('f5000000-0000-4000-8000-0000000000b1', 'categories-b@example.test'),
  ('f5000000-0000-4000-8000-0000000000c1', 'categories-c@example.test'),
  ('f5000000-0000-4000-8000-0000000000d1', 'categories-d@example.test');
create function pg_temp.login(p_user uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

set local role authenticated;

select pg_temp.login('f5000000-0000-4000-8000-0000000000d1');
insert into public.invoice_folders(id, name) values ('f6000000-0000-4000-8000-0000000000d1', 'Garden');

select pg_temp.login('f5000000-0000-4000-8000-0000000000a1');
insert into public.invoice_folders(id, name) values ('f6000000-0000-4000-8000-0000000000a1', 'PC build');
select is((select count(*) from public.invoice_categories where folder_id = 'f6000000-0000-4000-8000-0000000000a1'), 1::bigint,
  'a new folder starts with one category');
select ok((select is_default and name = 'Other' from public.invoice_categories where folder_id = 'f6000000-0000-4000-8000-0000000000a1'),
  'it is the default, "Other"');

-- B joins A's folder directly (the join function is covered in invoice_folders.test.sql).
reset role;
insert into public.invoice_members(folder_id, user_id, display_name) values ('f6000000-0000-4000-8000-0000000000a1', 'f5000000-0000-4000-8000-0000000000b1', 'Bea');
set local role authenticated;

-- ------------------------------------------------------------------ add, rename
select pg_temp.login('f5000000-0000-4000-8000-0000000000a1');
select lives_ok($$insert into public.invoice_categories(id, folder_id, name) values ('f7000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1', '  Case & Cooling ')$$,
  'the owner adds a category');
select is((select name from public.invoice_categories where id = 'f7000000-0000-4000-8000-000000000001'), 'Case & Cooling', 'the name is trimmed');
select ok((select not is_default from public.invoice_categories where id = 'f7000000-0000-4000-8000-000000000001'), 'an added category is not the default');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'case & cooling')$$,
  '23505', null, 'a name already in the folder is refused, ignoring case');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'OTHER')$$,
  '23505', null, 'so is the name of the default category');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', '   ')$$,
  '23514', null, 'a blank name is refused');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', repeat('x', 41))$$,
  '23514', null, 'an over-length name is refused');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name, is_default) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'Sneaky', true)$$,
  '42501', null, 'a client cannot make a category the default');

select pg_temp.login('f5000000-0000-4000-8000-0000000000b1');
select lives_ok($$insert into public.invoice_categories(id, folder_id, name) values ('f7000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-0000000000a1', 'Storage')$$,
  'a member adds a category');
select is((select count(*) from public.invoice_categories where folder_id = 'f6000000-0000-4000-8000-0000000000a1'), 3::bigint, 'the member sees all three categories');
update public.invoice_categories set name = 'Cooling' where id = 'f7000000-0000-4000-8000-000000000001';
select is((select name from public.invoice_categories where id = 'f7000000-0000-4000-8000-000000000001'), 'Cooling', 'a member renames a category made by someone else');
select throws_ok($$update public.invoice_categories set name = 'Mine' where is_default$$, 'P0001', 'invoices.invalid', 'the default category cannot be renamed');
select throws_ok($$update public.invoice_categories set is_default = true where id = 'f7000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'nor can a client change which one is the default');

-- ------------------------------------------------------------------ strangers
select pg_temp.login('f5000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.invoice_categories), 0::bigint, 'a stranger sees no categories');
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'Intruder')$$,
  '42501', null, 'a stranger cannot add one');
select throws_ok($$select public.delete_invoice_category('f7000000-0000-4000-8000-000000000002')$$, 'P0001', 'invoices.invalid', 'a stranger cannot delete one');

-- ------------------------------------------------------------------ rows
select pg_temp.login('f5000000-0000-4000-8000-0000000000a1');
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f8000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-0000000000a1', 'Thermal paste', 'USD', 2, 900)$$,
  'a row without a category is added');
select is((select c.is_default from public.invoice_items i join public.invoice_categories c on c.id = i.category_id where i.id = 'f8000000-0000-4000-8000-000000000001'), true,
  'it lands in "Other"');
select lives_ok($$insert into public.invoice_items(id, folder_id, category_id, name, currency, decimal_places, price_minor)
  values ('f8000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-0000000000a1', 'f7000000-0000-4000-8000-000000000001',
  'MSI MAG Forge 120A Airflow Mid-Tower (6× Fans, 330mm GPU support)', 'USD', 2, 5000)$$,
  'a row with a 65-character name goes into a chosen category');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', repeat('x', 201), 'USD', 2, 100)$$, '23514', null, 'a name over 200 characters is refused');

reset role;
select throws_ok($$insert into public.invoice_items(id, folder_id, category_id, name, currency, decimal_places, price_minor, created_by)
  values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', (select id from public.invoice_categories where folder_id = 'f6000000-0000-4000-8000-0000000000d1'), 'X', 'USD', 2, 100, 'f5000000-0000-4000-8000-0000000000a1')$$,
  '23503', null, 'a row cannot name a category of another folder');
set local role authenticated;
select pg_temp.login('f5000000-0000-4000-8000-0000000000a1');

-- Moving a row to another category counts as an edit: it gets a newer version.
create temp table stamps(label text primary key, at timestamptz not null);
grant all on stamps to authenticated;
insert into stamps select 'before', updated_at from public.invoice_items where id = 'f8000000-0000-4000-8000-000000000001';
update public.invoice_items set category_id = 'f7000000-0000-4000-8000-000000000002' where id = 'f8000000-0000-4000-8000-000000000001';
select ok((select i.updated_at > s.at and i.updated_by = 'f5000000-0000-4000-8000-0000000000a1'
  from public.invoice_items i, stamps s where i.id = 'f8000000-0000-4000-8000-000000000001' and s.label = 'before'),
  'moving a row to another category bumps its version');

-- ------------------------------------------------------------------ delete
select pg_temp.login('f5000000-0000-4000-8000-0000000000b1');
select throws_ok($$delete from public.invoice_categories where id = 'f7000000-0000-4000-8000-000000000002'$$, '42501', null, 'categories cannot be deleted directly');
select lives_ok($$select public.delete_invoice_category('f7000000-0000-4000-8000-000000000002')$$, 'a member deletes a category through the function');
select ok((select c.is_default from public.invoice_items i join public.invoice_categories c on c.id = i.category_id where i.id = 'f8000000-0000-4000-8000-000000000001'),
  'its row moved to "Other"');
select throws_ok($$select public.delete_invoice_category((select id from public.invoice_categories where is_default and folder_id = 'f6000000-0000-4000-8000-0000000000a1'))$$,
  'P0001', 'invoices.invalid', '"Other" cannot be deleted');
select lives_ok($$select public.delete_invoice_category('f7000000-0000-4000-8000-000000000002')$$, 'deleting a category that is already gone is quiet');

-- Undo of a deleted row returns it to its category, or to "Other" if the category is gone.
select lives_ok($$delete from public.invoice_items where id = 'f8000000-0000-4000-8000-000000000002'$$, 'a row in a category is deleted');
select lives_ok($$select public.restore_invoice_item('f8000000-0000-4000-8000-000000000002')$$, 'and restored');
select is((select category_id from public.invoice_items where id = 'f8000000-0000-4000-8000-000000000002'), 'f7000000-0000-4000-8000-000000000001'::uuid,
  'it is back in its own category');
delete from public.invoice_items where id = 'f8000000-0000-4000-8000-000000000002';
select public.delete_invoice_category('f7000000-0000-4000-8000-000000000001');
select public.restore_invoice_item('f8000000-0000-4000-8000-000000000002');
select ok((select c.is_default from public.invoice_items i join public.invoice_categories c on c.id = i.category_id where i.id = 'f8000000-0000-4000-8000-000000000002'),
  'if the category was deleted meanwhile, the restored row goes to "Other"');

-- Cap: 30 categories per folder.
select pg_temp.login('f5000000-0000-4000-8000-0000000000a1');
insert into public.invoice_categories(id, folder_id, name)
select gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'Cap ' || n from generate_series(1, 29) n;
select throws_ok($$insert into public.invoice_categories(id, folder_id, name) values (gen_random_uuid(), 'f6000000-0000-4000-8000-0000000000a1', 'One too many')$$,
  'P0001', 'invoices.limit', 'a folder holds at most 30 categories');

-- Deleting the folder takes its categories along.
select lives_ok($$delete from public.invoice_folders where id = 'f6000000-0000-4000-8000-0000000000a1'$$, 'the folder is deleted with its categories and rows');
reset role;
select is((select count(*) from public.invoice_categories where folder_id = 'f6000000-0000-4000-8000-0000000000a1'), 0::bigint, 'no category is left behind');

select * from finish();
rollback;
