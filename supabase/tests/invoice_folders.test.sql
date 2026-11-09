-- Invoice folders: shared by link, so access is "owner or active member of the folder".
-- A stranger, a removed member and a member of a different folder must see nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(149);

-- A owns the folder, B joins it, C is a stranger (later a member), D owns a different
-- folder, E tests the folder cap, and twenty fillers test the member cap.
insert into auth.users(id, email) values
  ('f0000000-0000-4000-8000-0000000000a1', 'invoices-a@example.test'),
  ('f0000000-0000-4000-8000-0000000000b1', 'invoices-b@example.test'),
  ('f0000000-0000-4000-8000-0000000000c1', 'invoices-c@example.test'),
  ('f0000000-0000-4000-8000-0000000000d1', 'invoices-d@example.test'),
  ('f0000000-0000-4000-8000-0000000000e1', 'invoices-e@example.test');
insert into auth.users(id, email)
select format('f0000000-0000-4000-8000-%s', lpad((100 + n)::text, 12, '0'))::uuid, format('invoices-guest-%s@example.test', n)
from generate_series(1, 20) n;

create temp table tokens(label text primary key, token text not null);
grant all on tokens to authenticated;
-- Remembers a row's updated_at so a later one can be compared with it (clock-independent).
create temp table stamps(label text primary key, at timestamptz not null);
grant all on stamps to authenticated;
-- Signs in as a user for the rest of the transaction.
create function pg_temp.login(p_user uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
-- Runs a statement and returns how many rows it touched (RLS hides rows silently).
create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;

set local role authenticated;

-- D owns a different folder with one item.
select pg_temp.login('f0000000-0000-4000-8000-0000000000d1');
insert into public.invoice_folders(id, name) values ('f1000000-0000-4000-8000-0000000000d1', 'Garden');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values ('f2000000-0000-4000-8000-000000000004', 'f1000000-0000-4000-8000-0000000000d1', 'Hose', 'USD', 2, 1500);

-- ---------------------------------------------------------------- owner and validation
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select lives_ok($$insert into public.invoice_folders(id, name) values ('f1000000-0000-4000-8000-0000000000a1', '  PC build ') returning id$$,
  'owner creates a folder (insert with returning)');
select is((select name from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000a1'), 'PC build', 'folder name is trimmed');
select is((select owner_id from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000a1'), 'f0000000-0000-4000-8000-0000000000a1'::uuid, 'owner_id defaults to the caller');
select is((select count(*) from public.invoice_members where folder_id = 'f1000000-0000-4000-8000-0000000000a1'
  and user_id = 'f0000000-0000-4000-8000-0000000000a1' and removed_at is null), 1::bigint, 'owner is a member automatically');
select throws_ok($$insert into public.invoice_folders(id, name) values (gen_random_uuid(), '   ')$$, '23514', null, 'blank folder name rejected');
select throws_ok($$insert into public.invoice_folders(id, name) values (gen_random_uuid(), repeat('x', 61))$$, '23514', null, 'over-length folder name rejected');
select throws_ok($$insert into public.invoice_folders(id, owner_id, name) values (gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000b1', 'Spoof')$$,
  null, 'invoices.invalid', 'cannot create a folder for someone else');

select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-0000000000a1', ' CPU ', 'USD', 2, 25000)$$, 'owner adds an item');
select ok((select name = 'CPU' and created_by = 'f0000000-0000-4000-8000-0000000000a1' and updated_by is null
  from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000001'), 'item name is trimmed and the author recorded');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', '   ', 'USD', 2, 100)$$, '23514', null, 'blank item name rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', repeat('x', 61), 'USD', 2, 100)$$, '23514', null, 'over-length item name rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Free', 'USD', 2, 0)$$, '23514', null, 'price 0 rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Huge', 'USD', 2, 1000000000000001)$$, '23514', null, 'price over MAX_MINOR rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Odd', 'USD', 9, 100)$$, '23514', null, 'decimal_places 9 rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Odd', 'USD', -1, 100)$$, '23514', null, 'decimal_places -1 rejected');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Odd', 'XYZ', 2, 100)$$, null, 'invoices.invalid', 'currency must be enabled in the adder''s catalog');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Odd', 'USD', 3, 100)$$, null, 'invoices.invalid', 'decimal places must match the adder''s catalog');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-0000000000a1', 'Case', 'LBP', 0, 9000000);
-- A's second folder, never shared.
insert into public.invoice_folders(id, name) values ('f1000000-0000-4000-8000-0000000000a2', 'Private');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values ('f2000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-0000000000a2', 'Secret', 'USD', 2, 700);

-- ---------------------------------------------------------------- link management
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select throws_ok($$select public.rotate_invoice_link('f1000000-0000-4000-8000-0000000000a1', 'Bob')$$, null, 'invoices.invalid', 'only the owner makes a link');
select throws_ok($$select public.disable_invoice_link('f1000000-0000-4000-8000-0000000000a1')$$, null, 'invoices.invalid', 'only the owner turns a link off');

select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select throws_ok($$select public.rotate_invoice_link('f1000000-0000-4000-8000-0000000000a1', '  ')$$, null, 'invoices.invalid', 'first share needs the owner''s name');
insert into tokens select 'first', public.rotate_invoice_link('f1000000-0000-4000-8000-0000000000a1', ' Alice ');
select matches((select token from tokens where label = 'first'), '^[0-9a-f]{64}$', 'owner gets a 64-character random token');
select is((select display_name from public.invoice_members where folder_id = 'f1000000-0000-4000-8000-0000000000a1'
  and user_id = 'f0000000-0000-4000-8000-0000000000a1'), 'Alice', 'sharing sets the owner''s name');
select is((select count(*) from public.invoice_links), 1::bigint, 'owner reads their link');

-- ---------------------------------------------------------------- stranger C sees nothing
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.invoice_folders), 0::bigint, 'stranger sees no folder');
select is((select count(*) from public.invoice_members), 0::bigint, 'stranger sees no member');
select is((select count(*) from public.invoice_links), 0::bigint, 'stranger sees no link');
select is((select count(*) from public.invoice_items), 0::bigint, 'stranger sees no item');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Sneak', 'USD', 2, 100)$$, '42501', null, 'stranger cannot add an item');
select is(pg_temp.affected($$update public.invoice_items set name = 'Hacked'$$), 0::bigint, 'stranger cannot edit items');
select is(pg_temp.affected($$delete from public.invoice_items$$), 0::bigint, 'stranger cannot delete items');
select is(pg_temp.affected($$update public.invoice_folders set name = 'Hacked'$$), 0::bigint, 'stranger cannot rename folders');

-- ---------------------------------------------------------------- B joins
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select is(public.invoice_link_preview((select token from tokens where label = 'first')), 'PC build', 'preview shows the folder name');
select is(public.invoice_link_preview('nope'), null, 'preview of a bad token is null');
select is(public.invoice_link_preview(repeat('0', 64)), null, 'preview of an unknown token is null');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'first'), '  ')$$, null, 'invoices.invalid', 'joining needs a name');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'first'), repeat('x', 31))$$, null, 'invoices.invalid', 'joining name is at most 30 characters');
select is(public.join_invoice_folder((select token from tokens where label = 'first'), ' Bob '), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'B joins with the link');
select is((select count(*) from public.invoice_items), 2::bigint, 'member reads the folder''s items');
select is((select count(*) from public.invoice_links), 0::bigint, 'member cannot read the link');
select is(public.join_invoice_folder((select token from tokens where label = 'first'), 'Bob again'), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'joining twice just opens the folder');
select is((select count(*) from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000b1'), 1::bigint, 'joining twice leaves one member row');
select is((select display_name from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000b1'), 'Bob', 'member name is trimmed and kept');
select is((select count(*) from public.invoice_members), 2::bigint, 'member sees everyone in the folder');

-- Joining one folder opens nothing else of the owner's.
select is((select count(*) from public.invoice_folders), 1::bigint, 'member sees only the joined folder');
select is((select count(*) from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000a2'), 0::bigint, 'member sees not the owner''s other folder');
select is((select count(*) from public.invoice_items where folder_id = 'f1000000-0000-4000-8000-0000000000a2'), 0::bigint, 'member sees no item of the owner''s other folder');
select is((select count(*) from public.invoice_members where folder_id = 'f1000000-0000-4000-8000-0000000000a2'), 0::bigint, 'member sees no member of the owner''s other folder');
select is((select count(*) from public.currencies where user_id = 'f0000000-0000-4000-8000-0000000000a1'), 0::bigint, 'member sees none of the owner''s currencies');
select is((select count(*) from public.categories where user_id = 'f0000000-0000-4000-8000-0000000000a1'), 0::bigint, 'member sees none of the owner''s categories');
select is((select count(*) from public.profiles where user_id = 'f0000000-0000-4000-8000-0000000000a1'), 0::bigint, 'member sees not the owner''s profile');

select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select is(public.join_invoice_folder((select token from tokens where label = 'first'), null), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'owner opening their own link gets the folder');
select is((select count(*) from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000a1'
  and folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 1::bigint, 'owner opening their own link adds no row');

-- ---------------------------------------------------------------- shared cart as B
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-0000000000a1', 'GPU', 'USD', 2, 45000)$$, 'member adds an item');
select is(pg_temp.affected($$update public.invoice_items set name = 'Ryzen CPU', price_minor = 26000, updated_at = '2000-01-01'
  where id = 'f2000000-0000-4000-8000-000000000001'$$), 1::bigint, 'member edits an item the owner added');
select ok((select updated_by = 'f0000000-0000-4000-8000-0000000000b1' and updated_at >= now() and created_by = 'f0000000-0000-4000-8000-0000000000a1'
  from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000001'), 'update records updated_by and updated_at');
select throws_ok($$update public.invoice_items set created_by = 'f0000000-0000-4000-8000-0000000000b1' where id = 'f2000000-0000-4000-8000-000000000001'$$,
  null, 'invoices.invalid', 'created_by cannot be changed');
select throws_ok($$update public.invoice_items set folder_id = 'f1000000-0000-4000-8000-0000000000d1' where id = 'f2000000-0000-4000-8000-000000000001'$$,
  null, 'invoices.invalid', 'an item cannot move to another folder');
select is(pg_temp.affected($$delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000003'$$), 1::bigint, 'member deletes an item the owner added');
select is(pg_temp.affected($$update public.invoice_folders set name = 'Mine now'$$), 0::bigint, 'member cannot rename the folder');
select is(pg_temp.affected($$delete from public.invoice_folders$$), 0::bigint, 'member cannot delete the folder');
select throws_ok($$insert into public.invoice_members(folder_id, user_id) values ('f1000000-0000-4000-8000-0000000000d1', 'f0000000-0000-4000-8000-0000000000b1')$$,
  '42501', null, 'member cannot insert a member row directly');
select is(pg_temp.affected($$update public.invoice_members set display_name = ' Bobby ' where user_id = 'f0000000-0000-4000-8000-0000000000b1'$$), 1::bigint, 'member renames themselves');
select is((select display_name from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000b1'), 'Bobby', 'member name is trimmed on update');
select is(pg_temp.affected($$update public.invoice_members set display_name = 'Boss' where user_id = 'f0000000-0000-4000-8000-0000000000a1'$$), 0::bigint, 'member cannot rename someone else');
select throws_ok($$update public.invoice_members set removed_at = null, joined_at = now() where user_id = 'f0000000-0000-4000-8000-0000000000b1'$$,
  '42501', null, 'member can only change their own name');
select throws_ok($$delete from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000b1'$$, '42501', null, 'member cannot delete member rows directly');
select throws_ok($$select public.remove_invoice_member('f1000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000a1')$$,
  null, 'invoices.invalid', 'only the owner removes people');

-- ---------------------------------------------------------------- versions only move forward
-- now() is the transaction start, so two writes in one transaction (or two overlapping ones)
-- would share or reverse their updated_at; every update must strictly increase it.
insert into stamps select 'item', updated_at from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000001';
update public.invoice_items set name = 'Ryzen 7 CPU' where id = 'f2000000-0000-4000-8000-000000000001';
select ok((select i.updated_at > s.at from public.invoice_items i, stamps s
  where i.id = 'f2000000-0000-4000-8000-000000000001' and s.label = 'item'), 'a second update in one transaction moves an item''s updated_at strictly forward');
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
update public.invoice_folders set name = 'Private 2' where id = 'f1000000-0000-4000-8000-0000000000a2';
insert into stamps select 'folder', updated_at from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000a2';
update public.invoice_folders set name = 'Private' where id = 'f1000000-0000-4000-8000-0000000000a2';
select ok((select f.updated_at > s.at from public.invoice_folders f, stamps s
  where f.id = 'f1000000-0000-4000-8000-0000000000a2' and s.label = 'folder'), 'a second rename in one transaction moves a folder''s updated_at strictly forward');
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');

-- ---------------------------------------------------------------- undo a delete
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select public.create_currency('XAU', 'XAU', 3);
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor) values
  ('f2000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-0000000000a1', 'Gold leaf', 'XAU', 3, 1234),
  ('f2000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-0000000000a1', 'Cable', 'USD', 2, 500);
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select is(pg_temp.affected($$delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000006'$$), 1::bigint, 'member deletes a row in a currency they lack');
select throws_ok($$select count(*) from public.invoice_item_tombstones$$, '42501', null, 'clients cannot read tombstones');
select throws_ok($$insert into public.invoice_item_tombstones(id, folder_id, name, currency, decimal_places, price_minor, created_by, created_at, updated_at)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Forged', 'USD', 2, 1, 'f0000000-0000-4000-8000-0000000000a1', now(), now())$$,
  '42501', null, 'clients cannot write tombstones');
reset role;
select ok((select created_by = 'f0000000-0000-4000-8000-0000000000a1' and deleted_by = 'f0000000-0000-4000-8000-0000000000b1'
  from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-000000000006'), 'the tombstone keeps the author and who deleted it');
update public.invoice_item_tombstones set created_at = '2026-01-01T00:00:00Z', updated_at = '2026-01-02T00:00:00Z'
where id = 'f2000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select throws_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000006')$$, null, 'invoices.invalid', 'a stranger cannot restore');
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select ok(not exists(select 1 from public.currencies where code = 'XAU'), 'the restorer has no XAU in their catalog');
select lives_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000006')$$, 'a member restores a row the owner added, in a currency they lack');
select ok((select created_by = 'f0000000-0000-4000-8000-0000000000a1' and created_at = '2026-01-01T00:00:00Z' and updated_at = '2026-01-02T00:00:00Z'
  and name = 'Gold leaf' and currency = 'XAU' and decimal_places = 3 and price_minor = 1234
  from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000006'), 'the restored row keeps its author, created_at and values');
select lives_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000006')$$, 'restoring twice is a no-op');
select is((select count(*) from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000006'), 1::bigint, 'restoring twice leaves one row');
reset role;
select is((select count(*) from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-000000000006'), 0::bigint, 'restoring removes the tombstone');
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000006';
reset role;
update public.invoice_item_tombstones set deleted_at = now() - interval '11 minutes' where id = 'f2000000-0000-4000-8000-000000000006';
set local role authenticated;
select throws_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000006')$$, null, 'invoices.invalid', 'a tombstone older than 10 minutes cannot be restored');
reset role;
update public.invoice_item_tombstones set deleted_at = now() - interval '2 hours' where id = 'f2000000-0000-4000-8000-000000000006';
set local role authenticated;
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000007';
reset role;
select is((select count(*) from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-000000000006'), 0::bigint, 'tombstones older than an hour are purged on the next delete');
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');

-- A restored row keeps its saved times, and the next edit still moves forward from them, even
-- when the saved updated_at is ahead of the server clock.
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values ('f2000000-0000-4000-8000-000000000008', 'f1000000-0000-4000-8000-0000000000a1', 'Clock', 'USD', 2, 300);
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000008';
reset role;
update public.invoice_item_tombstones set created_at = '2026-01-01T00:00:00Z', updated_at = '2999-01-01T00:00:00Z'
where id = 'f2000000-0000-4000-8000-000000000008';
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select public.restore_invoice_item('f2000000-0000-4000-8000-000000000008');
select ok((select created_at = '2026-01-01T00:00:00Z' and updated_at = '2999-01-01T00:00:00Z'
  from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000008'), 'a restored row keeps its original created_at and updated_at');
update public.invoice_items set name = 'Clock 2' where id = 'f2000000-0000-4000-8000-000000000008';
select ok((select updated_at = '2999-01-01T00:00:00.000001Z' and updated_by = 'f0000000-0000-4000-8000-0000000000b1'
  from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000008'), 'an update never moves updated_at backwards, even from a time ahead of the clock');

-- Deleted ids leak through realtime DELETE events, and ids are global. D (another folder's
-- owner) must not be able to cancel or hijack the Undo of a row deleted from A's folder.
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000a1', 'Monitor', 'USD', 2, 19900);
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000009';
-- Attack A: D squats the id in their own folder. While the Undo is open the id is refused.
select pg_temp.login('f0000000-0000-4000-8000-0000000000d1');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000d1', 'Squat', 'USD', 2, 1)$$,
  '42501', 'invoices.invalid', 'a deleted id cannot be taken by another folder while its Undo is open');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000d1', 'Squat', 'USD', 2, 1) on conflict (id) do nothing$$,
  '42501', 'invoices.invalid', 'not even through an insert that ignores duplicates');
-- The trigger runs before ON CONFLICT, so an add retried after someone else deleted that row
-- (same folder, same id) is refused too; the app shows it as "changed meanwhile".
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000a1', 'Monitor', 'USD', 2, 19900) on conflict (id) do nothing$$,
  '42501', 'invoices.invalid', 'an add retried after its row was deleted meanwhile is refused while the Undo is open');
reset role;
select ok((select folder_id = 'f1000000-0000-4000-8000-0000000000a1' and name = 'Monitor' and price_minor = 19900
  and deleted_by = 'f0000000-0000-4000-8000-0000000000b1' and restoring_txid is null
  from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-000000000009'), 'the victim''s tombstone is untouched by the attempts');
-- The guard and restore share one window: at its very end the id is still held, and Undo still works.
update public.invoice_item_tombstones set deleted_at = now() - interval '10 minutes' where id = 'f2000000-0000-4000-8000-000000000009';
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000d1');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000d1', 'Squat', 'USD', 2, 1)$$,
  '42501', 'invoices.invalid', 'at the very end of the Undo window the id is still held');
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select lives_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000009')$$, 'the victim restores after the squat attempts');
select ok((select folder_id = 'f1000000-0000-4000-8000-0000000000a1' and name = 'Monitor' and price_minor = 19900
  and created_by = 'f0000000-0000-4000-8000-0000000000a1' from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000009'),
  'the original row comes back');
-- A retried add of a live row (or of one Undo already put back) is still a quiet no-op.
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000a1', 'Monitor dup', 'USD', 2, 1) on conflict (id) do nothing$$,
  'an add retried while its row is live is still a quiet no-op');
select is((select name from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000009'), 'Monitor', 'the live row is left as it is');
-- Attack B: once the window is over the id is free again, but the expired tombstone lingers
-- (up to an hour); another folder's insert-then-delete must not overwrite it.
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000009';
reset role;
update public.invoice_item_tombstones set deleted_at = now() - interval '10 minutes 1 second' where id = 'f2000000-0000-4000-8000-000000000009';
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000d1');
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values ('f2000000-0000-4000-8000-000000000009', 'f1000000-0000-4000-8000-0000000000d1', 'Fake', 'USD', 2, 1)$$,
  'once the Undo window is over the id can be used again');
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000009';
reset role;
select ok((select folder_id = 'f1000000-0000-4000-8000-0000000000a1' and name = 'Monitor' and price_minor = 19900
  and created_by = 'f0000000-0000-4000-8000-0000000000a1' and deleted_by = 'f0000000-0000-4000-8000-0000000000b1'
  from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-000000000009'), 'another folder''s delete never overwrites a tombstone');
-- Restore still refuses an id held by another folder and quietly drops a tombstone whose row
-- is already back. The id guard makes both states unreachable through the API, so the test
-- builds them directly.
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor) values
  ('f2000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a2', 'Held', 'USD', 2, 100),
  ('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000000a1', 'Back', 'USD', 2, 100);
reset role;
insert into public.invoice_item_tombstones(id, folder_id, name, currency, decimal_places, price_minor, created_by, created_at, updated_at, deleted_by)
values ('f2000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1', 'Held', 'USD', 2, 100,
    'f0000000-0000-4000-8000-0000000000a1', now(), now(), 'f0000000-0000-4000-8000-0000000000b1'),
  ('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000000a1', 'Back old', 'USD', 2, 100,
    'f0000000-0000-4000-8000-0000000000a1', now(), now(), 'f0000000-0000-4000-8000-0000000000b1');
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select throws_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-00000000000a')$$, null, 'invoices.invalid',
  'restore fails loudly when the id is taken in another folder');
select lives_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-00000000000b')$$, 'restoring an id already back in the same folder is quiet');
select is((select name from public.invoice_items where id = 'f2000000-0000-4000-8000-00000000000b'), 'Back', 'the existing row is left as it is');
reset role;
select ok((select count(*) = 1 from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.invoice_item_tombstones where id = 'f2000000-0000-4000-8000-00000000000b'),
  'a squatted id keeps its tombstone for a later retry; a stale one is removed');
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');

-- ---------------------------------------------------------------- a different folder stays private
select is((select count(*) from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000d1'), 0::bigint, 'member sees no other folder');
select is((select count(*) from public.invoice_items where folder_id = 'f1000000-0000-4000-8000-0000000000d1'), 0::bigint, 'member sees no item of another folder');
select pg_temp.login('f0000000-0000-4000-8000-0000000000d1');
select is((select count(*) from public.invoice_items), 1::bigint, 'another folder''s owner sees only their own item');
select is((select count(*) from public.invoice_members), 1::bigint, 'another folder''s owner sees only their own membership');

-- ---------------------------------------------------------------- rotate and disable
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
insert into tokens select 'second', public.rotate_invoice_link('f1000000-0000-4000-8000-0000000000a1', null);
select isnt((select token from tokens where label = 'second'), (select token from tokens where label = 'first'), 'rotating issues a new token');
select is((select count(*) from public.invoice_links), 1::bigint, 'a folder keeps one link');
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'first'), 'Cara')$$, null, 'invoices.link', 'old token fails after rotating');
select is(public.invoice_link_preview((select token from tokens where label = 'first')), null, 'old token has no preview');
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select lives_ok($$select public.disable_invoice_link('f1000000-0000-4000-8000-0000000000a1')$$, 'owner turns the link off');
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'second'), 'Cara')$$, null, 'invoices.link', 'token fails after it is turned off');
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
insert into tokens select 'third', public.rotate_invoice_link('f1000000-0000-4000-8000-0000000000a1', null);

-- ---------------------------------------------------------------- remove B
select lives_ok($$select public.remove_invoice_member('f1000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000b1')$$, 'owner removes B');
select is((select count(*) from public.invoice_members where removed_at is not null), 1::bigint, 'owner still sees the removed person');
select is((select count(*) from public.invoice_items where created_by = 'f0000000-0000-4000-8000-0000000000b1'), 1::bigint, 'removed person''s items stay with created_by');
select throws_ok($$select public.remove_invoice_member('f1000000-0000-4000-8000-0000000000a1', 'f0000000-0000-4000-8000-0000000000a1')$$,
  null, 'invoices.invalid', 'owner cannot remove themselves');
select throws_ok($$select public.leave_invoice_folder('f1000000-0000-4000-8000-0000000000a1')$$, null, 'invoices.invalid', 'owner cannot leave');

select pg_temp.login('f0000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.invoice_folders), 0::bigint, 'removed person sees no folder');
select is((select count(*) from public.invoice_items), 0::bigint, 'removed person sees no item');
select is((select count(*) from public.invoice_members), 0::bigint, 'removed person sees no member');
select is(pg_temp.affected($$update public.invoice_items set name = 'Revenge'$$), 0::bigint, 'removed person cannot edit items');
select throws_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000007')$$, null, 'invoices.invalid', 'removed person cannot restore');
select is(public.invoice_link_preview((select token from tokens where label = 'third')), null, 'removed person gets no preview');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'third'), 'Bob')$$, null, 'invoices.link', 'removed person cannot rejoin with a fresh link');
select lives_ok($$select public.leave_invoice_folder('f1000000-0000-4000-8000-0000000000a1')$$, 'leaving after removal is a no-op');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'third'), 'Bob')$$, null, 'invoices.link', 'leaving does not clear a removal');

-- ---------------------------------------------------------------- leave and rejoin
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select is(public.join_invoice_folder((select token from tokens where label = 'third'), 'Cara'), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'C joins');
select lives_ok($$select public.leave_invoice_folder('f1000000-0000-4000-8000-0000000000a1')$$, 'C leaves');
select is((select count(*) from public.invoice_folders), 0::bigint, 'after leaving C sees no folder');
select is(public.join_invoice_folder((select token from tokens where label = 'third'), 'Cara'), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'C rejoins after leaving');

-- ---------------------------------------------------------------- member cap: 20 people besides the owner
reset role;
insert into public.invoice_members(folder_id, user_id, display_name)
select 'f1000000-0000-4000-8000-0000000000a1', format('f0000000-0000-4000-8000-%s', lpad((100 + n)::text, 12, '0'))::uuid, 'Guest'
from generate_series(1, 19) n;
set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-000000000120');
select is(public.invoice_link_preview((select token from tokens where label = 'third')), null, 'a full folder shows no preview');
select throws_ok($$select public.join_invoice_folder((select token from tokens where label = 'third'), 'Late')$$, null, 'invoices.full', 'the 21st person cannot join');
select pg_temp.login('f0000000-0000-4000-8000-0000000000c1');
select is(public.join_invoice_folder((select token from tokens where label = 'third'), 'Cara'), 'f1000000-0000-4000-8000-0000000000a1'::uuid, 'a member still opens a full folder');

-- ---------------------------------------------------------------- item cap: 500 per folder
select lives_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  select gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Part ' || n, 'USD', 2, 100
  from generate_series(1, 500 - (select count(*) from public.invoice_items where folder_id = 'f1000000-0000-4000-8000-0000000000a1')) n$$,
  'a folder fills to 500 items');
select throws_ok($$insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
  values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'One more', 'USD', 2, 100)$$, null, 'invoices.limit', 'the 501st item is rejected');
-- Undo cannot push a full folder past the cap either.
delete from public.invoice_items where id = 'f2000000-0000-4000-8000-000000000001';
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor)
values (gen_random_uuid(), 'f1000000-0000-4000-8000-0000000000a1', 'Replacement', 'USD', 2, 100);
select throws_ok($$select public.restore_invoice_item('f2000000-0000-4000-8000-000000000001')$$, null, 'invoices.limit', 'restoring into a full folder is rejected');

-- ---------------------------------------------------------------- folder cap: 100 per owner
select pg_temp.login('f0000000-0000-4000-8000-0000000000e1');
select lives_ok($$insert into public.invoice_folders(id, name) select gen_random_uuid(), 'Folder ' || n from generate_series(1, 100) n$$, 'an owner creates 100 folders');
select throws_ok($$insert into public.invoice_folders(id, name) values (gen_random_uuid(), 'One more')$$, null, 'invoices.limit', 'the 101st folder is rejected');

-- ---------------------------------------------------------------- account deletion and folder deletion
reset role;
delete from auth.users where id = 'f0000000-0000-4000-8000-0000000000c1';
select is((select count(*) from public.invoice_items where folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 500::bigint, 'a deleted account''s items stay in the folder');
select is((select count(*) from public.invoice_members where user_id = 'f0000000-0000-4000-8000-0000000000c1'), 0::bigint, 'a deleted account leaves its folders');
delete from auth.users where id = 'f0000000-0000-4000-8000-0000000000d1';
select is((select count(*) from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000d1'), 0::bigint, 'a deleted account''s folders are deleted');
select is((select count(*) from public.invoice_item_tombstones where folder_id = 'f1000000-0000-4000-8000-0000000000d1'), 0::bigint, 'a deleted account''s folders leave no tombstones');

set local role authenticated;
select pg_temp.login('f0000000-0000-4000-8000-0000000000a1');
select is(pg_temp.affected($$delete from public.invoice_folders where id = 'f1000000-0000-4000-8000-0000000000a1'$$), 1::bigint, 'owner deletes the folder');
reset role;
select is((select count(*) from public.invoice_items where folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'deleting a folder removes its items');
select is((select count(*) from public.invoice_members where folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'deleting a folder removes its members');
select is((select count(*) from public.invoice_links where folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'deleting a folder removes its link');
select is((select count(*) from public.invoice_item_tombstones where folder_id = 'f1000000-0000-4000-8000-0000000000a1'), 0::bigint, 'deleting a folder leaves no restorable tombstones');

-- ---------------------------------------------------------------- grants and realtime
select ok(not has_function_privilege('anon', 'public.join_invoice_folder(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.invoice_link_preview(text)', 'execute')
  and not has_function_privilege('anon', 'public.is_invoice_member(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.join_invoice_folder(text, text)', 'execute'), 'RPCs are for signed-in users only');
select ok(not has_table_privilege('anon', 'public.invoice_items', 'select')
  and not has_table_privilege('anon', 'public.invoice_folders', 'select')
  and not has_table_privilege('authenticated', 'public.invoice_links', 'insert')
  and not has_table_privilege('authenticated', 'public.invoice_links', 'update')
  and not has_table_privilege('authenticated', 'public.invoice_links', 'delete'), 'anon reads nothing and links are written only through RPCs');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('invoice_folders', 'invoice_items')), 2::bigint, 'folders and items publish live changes');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('invoice_members', 'invoice_links', 'invoice_item_tombstones')), 0::bigint, 'members, links and tombstones are not published (deletes bypass RLS)');
select ok(not has_function_privilege('anon', 'public.restore_invoice_item(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.restore_invoice_item(uuid)', 'execute'), 'restore is for signed-in users only');

select * from finish();
rollback;
