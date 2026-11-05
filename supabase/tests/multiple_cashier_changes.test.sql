-- Disposable local database only; rollback keeps synthetic fixtures isolated.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email) values
('d0aaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-cash-a@example.test'),
('d0bbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-cash-b@example.test');
select set_config('request.jwt.claims','{"sub":"d0aaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

insert into public.wallets(id,name,kind,currency) values
('d1000000-0000-4000-8000-000000000001','Paying USD','cash','USD'),
('d1000000-0000-4000-8000-000000000002','Returned USD','cash','USD'),
('d1000000-0000-4000-8000-000000000003','Returned LBP','cash','LBP');

create temp table multi_cash_input as
select jsonb_build_object('kind','expense','occurredOn','2026-11-05',
  'walletId','d1000000-0000-4000-8000-000000000001','amountMinor',1250,
  'categoryId',id,'note','Mixed change') as value
from public.categories where kind='expense' and parent_id is null order by position limit 1;
grant all on multi_cash_input to authenticated;

create function pg_temp.multi_cash_settlement(usd_change bigint default 500, lbp_change bigint default 223750)
returns jsonb language sql as $$
  select jsonb_build_object('tenderMinor',2000,'changes',jsonb_build_array(
    jsonb_build_object('walletId','d1000000-0000-4000-8000-000000000002','amountMinor',usd_change),
    jsonb_build_object('walletId','d1000000-0000-4000-8000-000000000003','amountMinor',lbp_change)
  ));
$$;

select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'save USD 20 tender with USD 5 and LBP returned change');
set constraints all immediate;
set constraints all deferred;

select is((select amount_minor from public.transactions where id='d2000000-0000-4000-8000-000000000001'),1250::bigint,'expense keeps separately entered cost');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000001'),-2000::numeric,'paying wallet loses tender once');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000002'),500::numeric,'USD change wallet receives five dollars');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000003'),223750::numeric,'LBP wallet receives exact actual change');
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),2::bigint,'one expense owns two ordered change rows');
select is((select array_agg(currency::text order by position) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),array['USD','LBP'],'change currency comes from each wallet');
select is((select change_wallet_ids from public.transactions where id='d2000000-0000-4000-8000-000000000001'),
  array['d1000000-0000-4000-8000-000000000002'::uuid,'d1000000-0000-4000-8000-000000000003'::uuid],
  'derived wallet filter includes every receiver');
select is((select sum(spent_minor) from public.month_category_spend('2026-11-01')),1250::numeric,'reporting counts purchase cost once');
select is((select count(*) from public.transactions where kind='income'),0::bigint,'returned change creates no income rows');
select is((select count(*) from public.transactions where change_wallet_id is not null or change_minor is not null),0::bigint,'legacy single-change columns are no longer canonical');

create temp table multi_cash_revision as select revision value from public.transactions where id='d2000000-0000-4000-8000-000000000001';
grant all on multi_cash_revision to authenticated;
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'identical create replay succeeds');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement(400,223750))$$,'BT003','transaction conflict','different multi-leg replay conflicts');

update public.wallets set archived_at=now() where id='d1000000-0000-4000-8000-000000000003';
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value || '{"note":"Metadata only"}'::jsonb from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'unchanged cash permits metadata edit with archived receiver');
update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value || '{"amountMinor":1300}'::jsonb from multi_cash_input),null,
  pg_temp.multi_cash_settlement(400,223750))$$,'P0001','wallet unavailable','financial edit requires every receiver active');
update public.wallets set archived_at=null where id='d1000000-0000-4000-8000-000000000003';

select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000002',null,(select value from multi_cash_input),null,
  '{"tenderMinor":2000,"changes":[
    {"walletId":"d1000000-0000-4000-8000-000000000001","amountMinor":250},
    {"walletId":"d1000000-0000-4000-8000-000000000001","amountMinor":500}
  ]}')$$,'repeated same-wallet change rows are accepted');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000001'),-3250::numeric,
  'same wallet receives both returned rows exactly once');

update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('d2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),true)$$,'delete multi-leg purchase');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000002'),0::numeric,'delete reverses USD change');
select is((select balance_minor from public.wallet_balances where wallet_id='d1000000-0000-4000-8000-000000000003'),0::numeric,'delete reverses LBP change');
update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('d2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),false)$$,'restore reapplies all legs');

select throws_ok($$update public.wallets set currency='SYP' where id='d1000000-0000-4000-8000-000000000003'$$,
  'P0001','wallet currency cannot change after it has transactions','change history locks wallet currency');
update public.wallets set archived_at=now() where id='d1000000-0000-4000-8000-000000000003';
select throws_ok($$select public.delete_wallet('d1000000-0000-4000-8000-000000000003')$$,
  'P0001','wallet.hasTransactions','change history protects wallet deletion');
update public.wallets set archived_at=null where id='d1000000-0000-4000-8000-000000000003';

update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value from multi_cash_input),null,'{}')$$,'explicit clear removes all change rows');
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),0::bigint,'clear removes child rows atomically');

select set_config('request.jwt.claims','{"sub":"d0bbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000002'),0::bigint,'another owner cannot read change rows');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000003',null,
  jsonb_build_object('kind','expense','occurredOn','2026-11-05','walletId','d1000000-0000-4000-8000-000000000001','amountMinor',1250,
    'categoryId',(select id from public.categories where kind='expense' limit 1)),null,
  pg_temp.multi_cash_settlement())$$,'P0001','wallet unavailable','another owner cannot use the first owner wallets');

select * from finish();
rollback;
