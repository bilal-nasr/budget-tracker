begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('fb000000-0000-4000-8000-000000000001','fixed-a@example.test'),
 ('fb000000-0000-4000-8000-000000000002','fixed-b@example.test');
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.wallets(id,name,kind,currency) values
 ('fb100000-0000-4000-8000-000000000001','Fixed cash','cash','USD'),
 ('fb100000-0000-4000-8000-000000000002','Other currency','cash','LBP');
insert into public.fixed_expenses(id,name,amount_minor,wallet_id,category_id,items)
select 'fb200000-0000-4000-8000-000000000001','Household',5000,
 'fb100000-0000-4000-8000-000000000001',c.id,
 '[{"description":"Internet","amountMinor":2000},{"description":"Phone","amountMinor":1000}]'
from public.categories c where c.kind='expense' order by position limit 1;
select throws_ok($$update public.fixed_expenses set amount_minor=2999$$,
 'BT001','breakdown exceeds total','cannot reduce template below its breakdown');
select throws_ok($$update public.fixed_expenses set items='{}'$$,
 '22023','invalid fixed expense items','rejects non-array composition');
select throws_ok($$update public.fixed_expenses set items='[{"description":"","amountMinor":1}]'$$,
 '22023','invalid fixed expense items','rejects empty descriptions');
select throws_ok($$update public.fixed_expenses set items='[{"description":"Bad","amountMinor":1.5}]'$$,
 '22023','invalid fixed expense items','rejects fractional minor amounts');
select throws_ok($$update public.fixed_expenses set wallet_id='fb100000-0000-4000-8000-000000000002'$$,
 'BT002','breakdown currency locked','cannot reinterpret saved lines in another currency');
create temporary table payment as select * from public.pay_fixed_expense('fb200000-0000-4000-8000-000000000001');
select is((select count(*) from public.transactions),1::bigint,'one payment creates only one ledger entry');
select is((select balance_minor::bigint from public.wallet_balances where wallet_id='fb100000-0000-4000-8000-000000000001'),
 -5000::bigint,'only the parent total is deducted');
select is((select count(*) from public.expense_items),2::bigint,'copies both breakdown lines');
select is((select sum(amount_minor)::bigint from public.expense_items),3000::bigint,'partial breakdown remains partial');
select is((select t.revision from public.transactions t join payment p on t.id=p.id),
 (select revision from payment),'returns revision after all child writes');
update public.fixed_expenses set items='[{"description":"Replacement","amountMinor":4000}]';
select is((select description from public.expense_items where position=0),'Internet','template edits preserve historical payment items');
select lives_ok($$select public.set_transaction_deleted(p.id,p.revision,true) from payment p$$,'Undo accepts returned revision');
select is((select balance_minor::bigint from public.wallet_balances where wallet_id='fb100000-0000-4000-8000-000000000001'),
 0::bigint,'Undo restores the whole payment balance');
select set_config('request.jwt.claims','{"sub":"fb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select * from public.pay_fixed_expense('fb200000-0000-4000-8000-000000000001')$$,
 '22023','fixed expense not found','another owner cannot pay the template');
select is((select count(*) from public.fixed_expenses),0::bigint,'template lines remain owner-isolated');
select * from finish();
rollback;
