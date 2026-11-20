-- Invoices: bulk delete / move / Undo in one call, and paying rows with an ordinary expense.
-- A row is paid only while its expense is live; the marker cannot be forged; the expense
-- stays private to the payer while the marker is visible to the folder's people.
begin;
select set_config('request.headers', jsonb_build_object('x-budget-units', '{"USD":2,"LBP":0,"SYP":0}')::text, true);
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users(id, email) values
  ('fa000000-0000-4000-8000-0000000000a1', 'pay-owner@example.test'),
  ('fa000000-0000-4000-8000-0000000000b1', 'pay-member@example.test'),
  ('fa000000-0000-4000-8000-0000000000c1', 'pay-stranger@example.test');
create function pg_temp.login(p_user uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
create temp table tokens(label text primary key, token text not null);
grant all on tokens to authenticated;

-- Owner: a wallet, a folder with a second category, five rows, and a link.
set local role authenticated;
select pg_temp.login('fa000000-0000-4000-8000-0000000000a1');
with fixture(id, name, kind, currency) as (values ('fa100000-0000-4000-8000-0000000000a1', 'Cash', 'cash', 'USD')), containers as (
  insert into public.wallets(id, user_id, name, kind, default_balance_id)
  select f.id::uuid, auth.uid()::uuid, f.name, f.kind::public.wallet_kind, f.id::uuid from fixture f returning id, user_id
)
insert into public.wallet_balances(id, user_id, wallet_id, currency, opening_balance_minor, position)
select case when cc.code = f.currency then c.id else gen_random_uuid() end, c.user_id, c.id, cc.code, 0, 0
from fixture f join containers c on c.id = f.id::uuid join public.currencies cc on cc.user_id = c.user_id and cc.disabled_at is null;

insert into public.invoice_folders(id, name) values ('fa200000-0000-4000-8000-000000000001', 'PC build');
insert into public.invoice_categories(id, folder_id, name) values ('fa300000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'Parts');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, quantity) values
  ('fa400000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001', 'CPU', 'USD', 2, 25000, 1),
  ('fa400000-0000-4000-8000-000000000002', 'fa200000-0000-4000-8000-000000000001', 'Fans', 'USD', 2, 1500, 3),
  ('fa400000-0000-4000-8000-000000000003', 'fa200000-0000-4000-8000-000000000001', 'Cables', 'LBP', 0, 900000, 1),
  ('fa400000-0000-4000-8000-000000000004', 'fa200000-0000-4000-8000-000000000001', 'Paste', 'USD', 2, 800, 1),
  ('fa400000-0000-4000-8000-000000000005', 'fa200000-0000-4000-8000-000000000001', 'Screws', 'USD', 2, 200, 1);
insert into tokens values ('link', public.rotate_invoice_link('fa200000-0000-4000-8000-000000000001', 'Owner'));

-- A member joins, with a wallet of their own.
select pg_temp.login('fa000000-0000-4000-8000-0000000000b1');
select public.join_invoice_folder((select token from tokens where label = 'link'), 'Karim');
with fixture(id, name, kind, currency) as (values ('fa100000-0000-4000-8000-0000000000b1', 'Cash', 'cash', 'USD')), containers as (
  insert into public.wallets(id, user_id, name, kind, default_balance_id)
  select f.id::uuid, auth.uid()::uuid, f.name, f.kind::public.wallet_kind, f.id::uuid from fixture f returning id, user_id
)
insert into public.wallet_balances(id, user_id, wallet_id, currency, opening_balance_minor, position)
select case when cc.code = f.currency then c.id else gen_random_uuid() end, c.user_id, c.id, cc.code, 0, 0
from fixture f join containers c on c.id = f.id::uuid join public.currencies cc on cc.user_id = c.user_id and cc.disabled_at is null;

-- Bulk move ---------------------------------------------------------------------------
select pg_temp.login('fa000000-0000-4000-8000-0000000000a1');
select is((select count(*) from public.move_invoice_items('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002', gen_random_uuid()]::uuid[],
  'fa300000-0000-4000-8000-000000000001')), 2::bigint, 'move answers with the rows that exist; an unknown id is skipped');
select is((select count(*) from public.invoice_items where category_id = 'fa300000-0000-4000-8000-000000000001'), 2::bigint, 'both rows moved');
select throws_ok($$select * from public.move_invoice_items('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001']::uuid[], gen_random_uuid())$$, '23503', 'invoices.category', 'a category that is not in the folder is refused');
select throws_ok($$select * from public.move_invoice_items('fa200000-0000-4000-8000-000000000001', array[]::uuid[], 'fa300000-0000-4000-8000-000000000001')$$,
  null, 'invoices.invalid', 'an empty batch is refused');

-- Paying ------------------------------------------------------------------------------
-- The owner pays CPU + Fans (250.00 + 3 x 15.00 = 295.00) with one expense.
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'fa500000-0000-4000-8000-000000000001', 'expense', current_date - 1, 'fa100000-0000-4000-8000-0000000000a1', 29500, 'USD', id
from public.categories where kind = 'expense' and parent_id is null and archived_at is null order by position limit 1;
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'fa500000-0000-4000-8000-000000000002', 'expense', current_date, 'fa100000-0000-4000-8000-0000000000a1', 100, 'USD', id
from public.categories where kind = 'expense' and parent_id is null and archived_at is null order by position limit 1;

select throws_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002']::uuid[], 'fa500000-0000-4000-8000-000000000002')$$,
  null, 'invoices.mismatch', 'the rows must add up to exactly what the expense cost');
select throws_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000003']::uuid[], 'fa500000-0000-4000-8000-000000000001')$$,
  null, 'invoices.mismatch', 'rows in two currencies are never paid by one expense');
select throws_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', gen_random_uuid()]::uuid[], 'fa500000-0000-4000-8000-000000000001')$$,
  '42501', 'invoices.invalid', 'a row that is gone refuses the whole batch');
select is((select count(*) from public.invoice_items where paid_transaction_id is not null), 0::bigint, 'nothing was marked by the refused calls');

select is((select count(*) from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002']::uuid[], 'fa500000-0000-4000-8000-000000000001')),
  2::bigint, 'both rows are marked paid');
select ok((select bool_and(paid_on = current_date - 1 and paid_at is not null and paid_by = 'fa000000-0000-4000-8000-0000000000a1')
  from public.invoice_items where id in ('fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002')),
  'the marker carries the payer and the expense date');
select lives_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002']::uuid[], 'fa500000-0000-4000-8000-000000000001')$$,
  'a retry with the same expense is a quiet no-op');

-- A paid row is frozen, except for its category.
select throws_ok($$update public.invoice_items set price_minor = 1 where id = 'fa400000-0000-4000-8000-000000000001'$$, null, 'invoices.paid', 'a paid price is locked');
select throws_ok($$update public.invoice_items set quantity = 9 where id = 'fa400000-0000-4000-8000-000000000002'$$, null, 'invoices.paid', 'a paid quantity is locked');
select lives_ok($$update public.invoice_items set category_id = (select c.id from public.invoice_categories c where c.folder_id = invoice_items.folder_id and c.is_default) where id = 'fa400000-0000-4000-8000-000000000001'$$,
  'a paid row can still change category');

-- The marker cannot be forged or cleared by hand.
select throws_ok($$update public.invoice_items set paid_transaction_id = null where id = 'fa400000-0000-4000-8000-000000000001'$$, null, 'invoices.paid',
  'a live payment cannot be cleared by hand');
update public.invoice_items set paid_on = date '2001-01-01', paid_by = 'fa000000-0000-4000-8000-0000000000b1' where id = 'fa400000-0000-4000-8000-000000000001';
select ok((select paid_on = current_date - 1 and paid_by = 'fa000000-0000-4000-8000-0000000000a1' from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000001'),
  'hand-written marker values are replaced by the expense''s own');
update public.invoice_items set paid_on = current_date where id = 'fa400000-0000-4000-8000-000000000004';
select ok((select paid_on is null and paid_at is null and paid_by is null from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000004'),
  'an unpaid row cannot be given a paid date');
insert into public.invoice_items(id, folder_id, name, currency, decimal_places, price_minor, paid_transaction_id)
  values ('fa400000-0000-4000-8000-000000000008', 'fa200000-0000-4000-8000-000000000001', 'Born paid', 'USD', 2, 100, 'fa500000-0000-4000-8000-000000000002');
select ok((select paid_transaction_id is null and paid_on is null from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000008'), 'a new row is never born paid');
delete from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000008';

-- The member sees the marker but not the expense, and cannot pay the same row again.
select pg_temp.login('fa000000-0000-4000-8000-0000000000b1');
select is((select count(*) from public.invoice_items where paid_on is not null), 2::bigint, 'the member sees which rows are paid');
select is((select count(*) from public.transactions), 0::bigint, 'the member sees none of the payer''s expenses');
insert into public.transactions(id, kind, occurred_on, balance_id, amount_minor, currency, category_id)
select 'fa500000-0000-4000-8000-0000000000b1', 'expense', current_date, 'fa100000-0000-4000-8000-0000000000b1', 25000, 'USD', id
from public.categories where kind = 'expense' and parent_id is null and archived_at is null order by position limit 1;
select throws_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001']::uuid[], 'fa500000-0000-4000-8000-0000000000b1')$$, null, 'invoices.paid', 'a row someone already paid is refused');
select throws_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000004']::uuid[], 'fa500000-0000-4000-8000-000000000001')$$, null, 'invoices.invalid', 'nobody can pay with another person''s expense');
select throws_ok($$update public.invoice_items set paid_transaction_id = 'fa500000-0000-4000-8000-000000000001' where id = 'fa400000-0000-4000-8000-000000000004'$$,
  '42501', 'invoices.invalid', 'nor link a row to it by hand');

-- A stranger can do none of it.
select pg_temp.login('fa000000-0000-4000-8000-0000000000c1');
select is((select count(*) from public.delete_invoice_items('fa200000-0000-4000-8000-000000000001', array['fa400000-0000-4000-8000-000000000004']::uuid[])),
  0::bigint, 'a stranger''s bulk delete removes nothing');
select throws_ok($$select * from public.move_invoice_items('fa200000-0000-4000-8000-000000000001', array['fa400000-0000-4000-8000-000000000004']::uuid[],
  'fa300000-0000-4000-8000-000000000001')$$, '23503', 'invoices.category', 'a stranger cannot move rows (the category is invisible to them)');

-- Deleting the expense un-marks the rows; restoring it marks them again; re-dating follows.
select pg_temp.login('fa000000-0000-4000-8000-0000000000a1');
create temp table stamps(label text primary key, at timestamptz not null);
grant all on stamps to authenticated;
insert into stamps select 'paid', updated_at from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000002';
update public.transactions set deleted_at = now() where id = 'fa500000-0000-4000-8000-000000000001';
select ok((select bool_and(i.paid_on is null and i.paid_at is null) and bool_and(i.updated_at > s.at or i.id <> 'fa400000-0000-4000-8000-000000000002')
  from public.invoice_items i, stamps s where s.label = 'paid' and i.id in ('fa400000-0000-4000-8000-000000000001', 'fa400000-0000-4000-8000-000000000002')),
  'deleting the expense un-marks its rows with a newer version');
select lives_ok($$update public.invoice_items set quantity = 2 where id = 'fa400000-0000-4000-8000-000000000002'$$, 'an un-marked row is editable again');
update public.invoice_items set quantity = 3 where id = 'fa400000-0000-4000-8000-000000000002';
update public.transactions set deleted_at = null where id = 'fa500000-0000-4000-8000-000000000001';
select is((select count(*) from public.invoice_items where paid_on = current_date - 1), 2::bigint, 'restoring the expense marks them again');
select lives_ok($$update public.transactions set occurred_on = current_date - 2 where id = 'fa500000-0000-4000-8000-000000000001'$$, 'the expense date is corrected');
select is((select count(*) from public.invoice_items i join public.transactions t on t.id = i.paid_transaction_id where i.paid_on = t.occurred_on), 2::bigint,
  'correcting the expense date moves the paid date');

-- Bulk delete and Undo: paid rows may be deleted (Activity is untouched) and come back paid.
select is((select count(*) from public.delete_invoice_items('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000004', gen_random_uuid()]::uuid[])), 2::bigint,
  'bulk delete answers with the rows it removed');
select is((select count(*) from public.transactions where id = 'fa500000-0000-4000-8000-000000000001' and deleted_at is null), 1::bigint,
  'deleting a paid row leaves its expense in Activity');
select is((select count(*) from public.restore_invoice_items(array['fa400000-0000-4000-8000-000000000002', 'fa400000-0000-4000-8000-000000000004']::uuid[])),
  2::bigint, 'Undo brings the whole batch back');
select ok((select paid_on is not null and paid_by = 'fa000000-0000-4000-8000-0000000000a1' from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000002'),
  'a restored paid row is still paid');
select ok((select paid_on is null from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000004'), 'a restored unpaid row is still unpaid');
select throws_ok($$select * from public.restore_invoice_items(array['fa400000-0000-4000-8000-000000000005', gen_random_uuid()]::uuid[])$$,
  null, 'invoices.invalid', 'Undo of a batch is all or nothing');

-- A row un-marked by a deleted expense can be paid again, by anyone in the folder.
update public.transactions set deleted_at = now() where id = 'fa500000-0000-4000-8000-000000000001';
select pg_temp.login('fa000000-0000-4000-8000-0000000000b1');
select lives_ok($$select * from public.mark_invoice_items_paid('fa200000-0000-4000-8000-000000000001',
  array['fa400000-0000-4000-8000-000000000001']::uuid[], 'fa500000-0000-4000-8000-0000000000b1')$$, 'the member pays a row whose first payment was deleted');
select pg_temp.login('fa000000-0000-4000-8000-0000000000a1');
select ok((select paid_by = 'fa000000-0000-4000-8000-0000000000b1' and paid_on = current_date from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000001'),
  'the owner sees who paid and when');
update public.transactions set deleted_at = null where id = 'fa500000-0000-4000-8000-000000000001';
select ok((select paid_by = 'fa000000-0000-4000-8000-0000000000b1' from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000001'),
  'restoring the first expense does not take the row back');

-- The payer is removed from the folder, then deletes the expense: the row is still un-marked.
select public.remove_invoice_member('fa200000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-0000000000b1');
select pg_temp.login('fa000000-0000-4000-8000-0000000000b1');
update public.transactions set deleted_at = now() where id = 'fa500000-0000-4000-8000-0000000000b1';
select pg_temp.login('fa000000-0000-4000-8000-0000000000a1');
select ok((select paid_on is null from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000001'),
  'a removed payer deleting their expense still un-marks the row');

-- A hard-deleted expense (account deletion) clears the link entirely.
reset role;
delete from public.transactions where id = 'fa500000-0000-4000-8000-0000000000b1';
select ok((select paid_transaction_id is null and paid_by is null and paid_on is null and paid_at is null
  from public.invoice_items where id = 'fa400000-0000-4000-8000-000000000001'), 'a deleted expense leaves no marker behind');

select * from finish();
rollback;
