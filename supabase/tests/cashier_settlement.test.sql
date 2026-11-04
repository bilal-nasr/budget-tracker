-- Disposable local database only; rollback keeps synthetic fixtures isolated.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
('caaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier-a@example.test'),
('cbbbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashier-b@example.test');
select set_config('request.jwt.claims','{"sub":"caaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.wallets(id,name,kind,currency) values
('c1000000-0000-4000-8000-000000000001','USD cash','cash','USD'),
('c1000000-0000-4000-8000-000000000002','LBP cash','cash','LBP'),
('c1000000-0000-4000-8000-000000000003','USD change','cash','USD');
create temp table cashier_input as select jsonb_build_object('kind','expense','occurredOn','2026-11-04','walletId','c1000000-0000-4000-8000-000000000001','amountMinor',1250,'categoryId',id,'note','Groceries') as value
from public.categories where kind='expense' and parent_id is null order by position limit 1;
grant all on cashier_input to authenticated;

select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000001',null,(select value from cashier_input),'[{"description":"Food","amountMinor":1000}]',
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000002","amountMinor":671250,"rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}}')$$,'save exact cross-currency purchase with partial breakdown');
set constraints all immediate;
set constraints all deferred;
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000001'),-2000::numeric,'tender leaves USD once');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000002'),671250::numeric,'actual change arrives in LBP');
select is((select amount_minor from public.transactions where id='c2000000-0000-4000-8000-000000000001'),1250::bigint,'expense amount remains purchase cost');
select is((select sum(amount_minor) from public.expense_items where transaction_id='c2000000-0000-4000-8000-000000000001'),1000::numeric,'partial items leave 250 cents unitemized');
select is((select sum(spent_minor) from public.month_category_spend('2026-11-01')),1250::numeric,'budget spends cost once');
select is((select count(*) from public.transactions where kind='income'),0::bigint,'returned change creates no income');
create temp table cashier_revision as select revision as value from public.transactions where id='c2000000-0000-4000-8000-000000000001';
grant all on cashier_revision to authenticated;
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000001',null,(select value from cashier_input),'[{"description":"Food","amountMinor":1000}]',
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000002","amountMinor":671250,"rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}}')$$,'identical create replay succeeds');
select is((select revision from public.transactions where id='c2000000-0000-4000-8000-000000000001'),(select value from cashier_revision),'replay does not touch revision or items');
select throws_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000001',null,(select value from cashier_input),'[{"description":"Food","amountMinor":1000}]','{}')$$,'BT003','transaction conflict','different settlement replay fails');

select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),(select value from cashier_input),null,
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000003","amountMinor":750}}')$$,'edit atomically switches receiving wallet and currency');
set constraints all immediate;
set constraints all deferred;
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000002'),0::numeric,'old change contribution removed');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000003'),750::numeric,'new change contribution applied once');
select throws_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),true)$$,'BT003','transaction conflict','stale delete fails exactly, never expected+1');
update cashier_revision set value=(select revision from public.transactions where id='c2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),true)$$,'delete settled purchase');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000001'),0::numeric,'delete removes tender debit');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000003'),0::numeric,'delete removes change credit');
select throws_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),true)$$,'BT003','transaction conflict','repeated delete with old revision fails');
update cashier_revision set value=(select revision from public.transactions where id='c2000000-0000-4000-8000-000000000001');
update public.wallets set archived_at=now() where id='c1000000-0000-4000-8000-000000000003';
select throws_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),false)$$,'P0001','wallet unavailable','archived receiving wallet blocks restore');
select throws_ok($$delete from public.wallets where id='c1000000-0000-4000-8000-000000000003'$$,'23503',null,'soft-deleted change history still protects physical wallet deletion');
select throws_ok($$update public.wallets set currency='LBP' where id='c1000000-0000-4000-8000-000000000003'$$,'P0001','wallet currency cannot change after it has transactions','change-only history locks currency');
update public.wallets set archived_at=null where id='c1000000-0000-4000-8000-000000000003';
select lives_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),false)$$,'restore replays both movements once');
update cashier_revision set value=(select revision from public.transactions where id='c2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000001',(select value from cashier_revision),(select value from cashier_input),null,'{}')$$,'explicit empty settlement clears to plain expense');
set constraints all immediate;
set constraints all deferred;
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000001'),-1250::numeric,'clearing debits cost only');

-- Deferred invariants must reject direct authenticated writes, not merely bad RPCs.
set constraints all immediate;
select throws_ok($$update public.transactions set tender_minor=2000 where id='c2000000-0000-4000-8000-000000000001'$$,'P0001','settlement mismatch','direct inconsistent tender blocked');
select throws_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000002',null,(select value from cashier_input),'[{"description":"Too much","amountMinor":1500}]','{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000001","amountMinor":750}}')$$,null,null,'items below tender but above cost fail atomically');
select is((select count(*) from public.transactions where id='c2000000-0000-4000-8000-000000000002'),0::bigint,'invalid items leave no parent');
select is(public.cashier_convert_minor(1,'LBP','USD','USD','LBP',200,1),1::bigint,'SQL half-up rounding matches domain helper');
select is(public.cashier_convert_minor(9999994999999,'SYP','USD','USD','SYP',999999999999999,1000000),999999::bigint,
  'large SYP quote stays below half without intermediate numeric division rounding');
select is(public.cashier_convert_minor(9999995000000,'SYP','USD','USD','SYP',999999999999999,1000000),1000000::bigint,
  'adjacent SYP quote boundary rounds up once');

select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000004',null,(select value from cashier_input),null,
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000001","amountMinor":750}}')$$,'same-wallet same-currency purchase');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000001'),-2500::numeric,'same-wallet tender and change net to cost');
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000005',null,(select value from cashier_input),null,'{"tenderMinor":1250,"change":null}')$$,'exact tender with no change');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000001'),-3750::numeric,'no-change tender is one cost debit');
insert into public.wallets(id,name,kind,currency) values ('c1000000-0000-4000-8000-000000000005','SYP pounds','cash','SYP');
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000006',null,(select value from cashier_input),null,
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000005","amountMinor":97500,"rate":{"base":"USD","quote":"SYP","quoteMajorNumerator":13000,"quoteMajorDenominator":1}}}')$$,'SYP direct quote uses whole-pound scale without a profile-rate fallback');
select is((select balance_minor from public.wallet_balances where wallet_id='c1000000-0000-4000-8000-000000000005'),97500::numeric,'actual pounds credited exactly');
select is(public.cashier_convert_minor(500,'SYP','LBP','LBP','SYP',1,100),50000::bigint,'fractional LBP/SYP quote uses exact rational math');
select is(public.cashier_convert_minor(750,'USD','SYP','USD','SYP',13000,1),97500::bigint,'reverse SYP conversion is explicit and scale-aware');
select throws_ok($$select public.cashier_convert_minor(100,'SYP','USD','USD','LBP',89500,1)$$,'P0001','invalid settlement rate','legacy USD/LBP quote cannot value SYP');
select throws_ok($$update public.transactions set change_currency='USD' where id='c2000000-0000-4000-8000-000000000006'$$,'P0001','settlement currency mismatch','direct forged receiving currency rejected');

-- Archived receiver metadata edits retain precisely the existing money. Use an
-- independent fixture so the replay/lifecycle regression sequence above stays unchanged.
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000008',null,(select value from cashier_input),
'[{"description":"Food","amountMinor":1000}]',
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000002","amountMinor":671250,"rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}}')$$,'create archived-receiver metadata fixture');
update public.wallets set archived_at=now() where id='c1000000-0000-4000-8000-000000000002';
select lives_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000008',
(select revision from public.transactions where id='c2000000-0000-4000-8000-000000000008'),
(select value || '{"note":"Metadata edited","occurredOn":"2026-11-03"}'::jsonb from cashier_input),
'[{"description":"Updated food","amountMinor":900}]',
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000002","amountMinor":671250,"rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}}')$$,'archived receiver allows name/date/items edits with identical cash snapshot');
select is((select jsonb_build_array(amount_minor,tender_minor,change_minor) from public.transactions where id='c2000000-0000-4000-8000-000000000008'),
'[1250,2000,671250]'::jsonb,'metadata edit preserves cost, tender and actual change exactly');
select throws_ok($$update public.transactions set amount_minor=1350,tender_minor=2100 where id='c2000000-0000-4000-8000-000000000008'$$,
'P0001','wallet unavailable','financially changed settlement still requires an active receiver');
select throws_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000009',null,(select value from cashier_input),null,
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000002","amountMinor":671250,"rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}}')$$,
'P0001','wallet unavailable','new/duplicated purchase cannot reuse an archived receiver');

select set_config('request.jwt.claims','{"sub":"cbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.transactions where id='c2000000-0000-4000-8000-000000000001'),0::bigint,'B cannot read A purchase');
select throws_ok($$select * from public.set_transaction_deleted('c2000000-0000-4000-8000-000000000001',1,true)$$,'BT003','transaction conflict','B cannot delete A purchase');
insert into public.wallets(id,name,kind,currency) values ('c1000000-0000-4000-8000-000000000004','B cash','cash','USD');
select throws_ok($$select * from public.save_transaction('c2000000-0000-4000-8000-000000000003',null,
jsonb_build_object('kind','expense','occurredOn','2026-11-04','walletId','c1000000-0000-4000-8000-000000000004','amountMinor',1250,'categoryId',(select id from public.categories where kind='expense' limit 1)),null,
'{"tenderMinor":2000,"change":{"walletId":"c1000000-0000-4000-8000-000000000003","amountMinor":750}}')$$,'P0001','wallet unavailable','B cannot receive change in A wallet');
select * from finish();
rollback;
