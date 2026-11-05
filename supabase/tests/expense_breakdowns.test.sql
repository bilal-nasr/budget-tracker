-- Rollback-only synthetic fixtures. Run through pnpm db:test on a disposable local stack.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email) values
 ('aabbccdd-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','breakdown-a@example.test'),
 ('aabbccdd-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','breakdown-b@example.test');
select set_config('request.jwt.claims','{"sub":"aabbccdd-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('aabbccdd-1000-4000-8000-000000000001','Breakdown USD','cash','USD'),
 ('aabbccdd-1000-4000-8000-000000000002','Breakdown USD 2','cash','USD'),
 ('aabbccdd-1000-4000-8000-000000000003','Breakdown LBP','cash','LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create function pg_temp.breakdown_input(amount bigint default 5000, wallet uuid default 'aabbccdd-1000-4000-8000-000000000001')
returns jsonb language sql as $$
 select jsonb_build_object('kind','expense','occurredOn','2026-11-04','balanceId',wallet,
   'amountMinor',amount,'categoryId',(select id from public.categories where kind='expense' and parent_id is null order by position limit 1),
   'note','Sister');
$$;
create function pg_temp.breakdown_save(tx uuid, rev integer, amount bigint, items jsonb)
returns table (id uuid, revision integer) language sql as $$
 select * from public.save_transaction(tx,rev,pg_temp.breakdown_input(amount),items);
$$;

select lives_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',null,5000,
 '[{"description":"Phone credits","amountMinor":2000},{"description":"For sister","amountMinor":3000}]')$$,'save one parent with two descriptive items');
select is((select count(*) from public.transactions),1::bigint,'one ledger row');
select is((select count(*) from public.expense_items),2::bigint,'two descriptive rows');
select is((select note from public.transactions),'Sister','parent name preserved');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id='aabbccdd-1000-4000-8000-000000000001'),-5000::bigint,'wallet debited once');
select is((select sum(spent_minor)::bigint from public.month_category_spend('2026-11-01')),5000::bigint,'budget counts parent once');
create temp table saved_revision as select revision from public.transactions;
create temp table saved_items as select id from public.expense_items;

select lives_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',null,5000,
 '[{"description":"Phone credits","amountMinor":2000},{"description":"For sister","amountMinor":3000}]')$$,'identical create replay succeeds');
select is((select revision from public.transactions),(select revision from saved_revision),'replay does not increment revision');
select is((select count(*) from public.expense_items where id in (select id from saved_items)),2::bigint,'replay preserves child IDs');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',null,5001,'[]')$$,
 'BT003','transaction conflict','mismatching replay conflicts');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000002',null,5000,
 '[{"description":"Too much","amountMinor":5001}]')$$,'BT001','breakdown exceeds total','invalid create sum rejected');
select is((select count(*) from public.transactions),1::bigint,'invalid create leaves no parent');

select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',
 (select revision from saved_revision),4000,null)$$,'BT001','breakdown exceeds total','parent shrink with preserved items rejected');
select is((select amount_minor from public.transactions),5000::bigint,'invalid update leaves parent unchanged');
select is((select count(*) from public.expense_items where id in (select id from saved_items)),2::bigint,'invalid update retains all old items');
select lives_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',
 (select revision from saved_revision),4000,'[{"description":"Phone credits","amountMinor":2000}]')$$,'valid combined replacement allows remainder');
select is((select sum(amount_minor)::bigint from public.expense_items),2000::bigint,'partial itemization retained');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',
 (select revision from saved_revision),4000,'[]')$$,'BT003','transaction conflict','stale replacement fails');

select throws_ok($$select * from public.save_transaction('aabbccdd-2000-4000-8000-000000000001',
 (select revision from public.transactions),pg_temp.breakdown_input(4000,'aabbccdd-1000-4000-8000-000000000003')||'{"costCurrency":"LBP"}'::jsonb,'[]')$$,
 'BT002','breakdown currency locked','saved breakdown requires separate clear before currency change');
select lives_ok($$select * from public.save_transaction('aabbccdd-2000-4000-8000-000000000001',
 (select revision from public.transactions),pg_temp.breakdown_input(4000,'aabbccdd-1000-4000-8000-000000000002'),null)$$,'same currency wallet edit preserves items');

select throws_ok($$insert into public.expense_items(transaction_id,description,amount_minor,position)
 values ('aabbccdd-2000-4000-8000-000000000001','Overspend',3000,1);
 set constraints public.expense_items_valid,public.transactions_breakdown_valid immediate$$,
 'BT001','breakdown exceeds total','direct child overspend also rejected');
select throws_ok($$update public.transactions set amount_minor=1000;
 set constraints public.expense_items_valid,public.transactions_breakdown_valid immediate$$,
 'BT001','breakdown exceeds total','direct parent shrink also rejected');
select throws_ok($$update public.transactions set id='aabbccdd-2000-4000-8000-000000000099'$$,
 '22023','transaction identity cannot change','parent retry identity immutable');

create temp table before_delete as select revision from public.transactions;
select lives_ok($$select * from public.set_transaction_deleted('aabbccdd-2000-4000-8000-000000000001',
 (select revision from before_delete),true)$$,'guarded delete succeeds');
select is((select count(*) from public.expense_items),0::bigint,'deleted parent hides items');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id='aabbccdd-1000-4000-8000-000000000002'),0::bigint,'delete reverses parent debit');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000001',null,4000,
 '[{"description":"Phone credits","amountMinor":2000}]')$$,'BT003','transaction conflict','create replay cannot resurrect a deleted parent');
select throws_ok($$select * from public.set_transaction_deleted('aabbccdd-2000-4000-8000-000000000001',
 (select revision from before_delete),true)$$,'BT003','transaction conflict','stale same-state delete fails even at expected+1');
select lives_ok($$select * from public.set_transaction_deleted('aabbccdd-2000-4000-8000-000000000001',
 (select revision from public.transactions),false)$$,'restore with deletion result revision succeeds');
select is((select count(*) from public.expense_items),1::bigint,'restore reveals retained item');
select is((select balance_minor::bigint from public.wallet_balance_totals where balance_id='aabbccdd-1000-4000-8000-000000000002'),-4000::bigint,'restore debits only parent');

create temp table old_undo as select revision from public.transactions;
update public.transactions set note='Sister updated';
select throws_ok($$select * from public.set_transaction_deleted('aabbccdd-2000-4000-8000-000000000001',
 (select revision from old_undo),true)$$,'BT003','transaction conflict','old create Undo cannot delete later edit');

select throws_ok($$select * from public.save_transaction(null,null,pg_temp.breakdown_input(),'[]')$$,
 '22023','invalid transaction input','null create UUID rejected');
select throws_ok($$select * from public.save_transaction('aabbccdd-2000-4000-8000-000000000003',null,
 pg_temp.breakdown_input() || '{"userId":"forged"}','[]')$$,'22023','invalid transaction input','unknown parent ownership key rejected');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000003',null,5000,
 '[{"description":"x","amountMinor":1,"balanceId":"forged"}]')$$,'22023','invalid expense item','item ownership/financial keys rejected');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000003',null,5000,
 '[{"description":" ","amountMinor":1}]')$$,'22023','invalid expense item','blank description rejected');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000003',null,5000,
 '[{"description":"x","amountMinor":0.5}]')$$,'22023','invalid expense item','fractional minor units rejected');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000003',null,5000,
 (select jsonb_agg(jsonb_build_object('description','x','amountMinor',1)) from generate_series(1,51)))$$,
 '22023','invalid expense item','51 lines rejected');
select throws_ok($$select * from pg_temp.breakdown_save('aabbccdd-2000-4000-8000-000000000003',null,1000000000000000,
 (select jsonb_agg(jsonb_build_object('description','x','amountMinor',1000000000000000)) from generate_series(1,50)))$$,
 'BT001','breakdown exceeds total','large aggregate sum does not overflow before validation');

-- Switch to a second real tenant; all checks run as authenticated, never service role.
select set_config('request.jwt.claims','{"sub":"aabbccdd-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.expense_items),0::bigint,'other tenant sees no items');
select throws_ok($$insert into public.expense_items(transaction_id,description,amount_minor,position)
 values ('aabbccdd-2000-4000-8000-000000000001','Foreign parent',1,1)$$,
 'BT003','transaction conflict','other tenant cannot attach to foreign parent');
with changed as (update public.expense_items set description='Forged' returning id)
select is((select count(*) from changed),0::bigint,'other tenant updates no lines');
with changed as (delete from public.expense_items returning id)
select is((select count(*) from changed),0::bigint,'other tenant deletes no lines');
select throws_ok($$select * from public.set_transaction_deleted('aabbccdd-2000-4000-8000-000000000001',1,true)$$,
 'BT003','transaction conflict','foreign lifecycle does not succeed');

reset role;
set local role anon;
select throws_ok($$select * from public.save_transaction('aabbccdd-2000-4000-8000-000000000003',null,'{}','[]')$$,
 '42501',null,'anonymous cannot invoke save');
reset role;
select * from finish();
rollback;
