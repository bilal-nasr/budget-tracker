-- Disposable local database only; rollback keeps synthetic fixtures isolated.
begin;
-- Only historical migration-state setup uses this administrator-owned helper.
-- Monetary tests still execute through authenticated production entry points.
-- Administrator-only seeding of the historical migration management state.
create function pg_temp.seed_needs_attention(p_id uuid,p_value boolean) returns void
language plpgsql security definer set search_path='' as $$ begin
 set constraints all immediate;
 set constraints public.wallet_order_guard deferred;
 alter table public.wallets disable trigger wallet_guard;
 update public.wallets set needs_attention=p_value where id=p_id and user_id=auth.uid();
 update public.wallets w set position=x.position from (select id,row_number() over(order by position,id)-1 position from public.wallets where user_id=auth.uid() and deleted_at is null and not needs_attention)x where w.id=x.id;
 set constraints public.wallet_order_guard immediate;
 alter table public.wallets enable trigger wallet_guard;
 set constraints all deferred;
end $$;

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email) values
('ccaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cross-cost-a@example.test'),
('ccbbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cross-cost-b@example.test');
select set_config('request.jwt.claims','{"sub":"ccaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('cc100000-0000-4000-8000-000000000001','Paying USD','cash','USD'),
('cc100000-0000-4000-8000-000000000002','Returned LBP','cash','LBP'),
('cc100000-0000-4000-8000-000000000003','Alternate SYP payer','cash','SYP'),
('cc100000-0000-4000-8000-000000000004','Same USD change','cash','USD'),
('cc100000-0000-4000-8000-000000000005','Alternate LBP payer','cash','LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create function pg_temp.expense_input(
  amount bigint default 340000,
  wallet uuid default 'cc100000-0000-4000-8000-000000000001',
  cost text default 'LBP',
  note text default 'Exact groceries'
) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind','expense','occurredOn','2026-11-05','balanceId',wallet,'amountMinor',amount,
    'costCurrency',cost,'categoryId',(select id from public.categories where kind='expense' and parent_id is null order by position limit 1),
    'note',note
  ));
$$;
create function pg_temp.cashier(change_amount bigint default 110000, receiver uuid default 'cc100000-0000-4000-8000-000000000002')
returns jsonb language sql as $$
  select jsonb_build_object('tenderMinor',500,'changes',case when change_amount is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('balanceId',receiver,'amountMinor',change_amount)) end);
$$;

select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000001',null,pg_temp.expense_input(),null,pg_temp.cashier())$$,
  'save LBP 340000 cost with USD 5 tender and LBP 110000 change without conversion');
set constraints all immediate;
set constraints all deferred;

select is((select amount_minor from public.transactions where id='cc200000-0000-4000-8000-000000000001'),340000::bigint,'parent keeps exact purchase cost');
select is((select currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000001'),'USD','storage currency remains payer wallet currency');
select is((select cost_currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000001'),'LBP','independent cost currency is stored');
select is((select balance_minor from public.wallet_balance_totals where balance_id='cc100000-0000-4000-8000-000000000001'),-500::numeric,'USD wallet loses exactly five dollars');
select is((select balance_minor from public.wallet_balance_totals where balance_id='cc100000-0000-4000-8000-000000000002'),110000::numeric,'LBP wallet receives exact returned change');
select is((select spent_minor from public.month_category_spend('2026-11-01') where currency='LBP'),340000::bigint,'LBP report counts exact purchase cost');
select is((select count(*) from public.month_category_spend('2026-11-01') where currency='USD'),0::bigint,'USD tender is not reported as USD spending');
select is((select count(*) from public.transactions),1::bigint,'one visible transaction records the event');
select is((select count(*) from public.transactions where kind in ('income','transfer')),0::bigint,'no income or transfer is invented');

select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000002',null,pg_temp.expense_input(note=>'Foreign tender without change'),null,pg_temp.cashier(null))$$,
  'cross-currency cost accepts exact foreign tender with no returned change');

select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000003',null,
  pg_temp.expense_input(400,'cc100000-0000-4000-8000-000000000001','USD','Same currency'),null,
  '{"tenderMinor":500,"changes":[{"balanceId":"cc100000-0000-4000-8000-000000000004","amountMinor":100}]}'::jsonb)$$,
  'same-currency reconciliation remains exact');
select throws_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000004',null,
  pg_temp.expense_input(400,'cc100000-0000-4000-8000-000000000001','USD','Bad same currency'),null,
  '{"tenderMinor":500,"changes":[{"balanceId":"cc100000-0000-4000-8000-000000000004","amountMinor":99}]}'::jsonb)$$,
  'P0001','settlement mismatch','same-currency mismatch is still rejected');

select throws_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000005',null,pg_temp.expense_input(),null,'{}')$$,
  'P0001','invalid settlement','differing cost currency requires cashier settlement');

select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000006',null,pg_temp.expense_input(),
  '[{"description":"Food","amountMinor":300000}]',pg_temp.cashier())$$,
  'itemized purchase uses independent cost currency');
create temp table item_revision as select revision value from public.transactions where id='cc200000-0000-4000-8000-000000000006';
grant all on item_revision to authenticated;
select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000006',(select value from item_revision),
  pg_temp.expense_input(340000,'cc100000-0000-4000-8000-000000000003','LBP','Changed payer'),null,
  pg_temp.cashier())$$,'payer wallet currency can change while item cost currency stays LBP');
select is((select currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000006'),'SYP','payer currency follows changed wallet');
select is((select cost_currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000006'),'LBP','item cost currency remains locked to LBP');

update item_revision set value=(select revision from public.transactions where id='cc200000-0000-4000-8000-000000000006');
select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000006',(select value from item_revision),
  pg_temp.expense_input(340000,'cc100000-0000-4000-8000-000000000005','LBP','Payer now matches cost'),null,
  '{"tenderMinor":450000,"changes":[{"balanceId":"cc100000-0000-4000-8000-000000000002","amountMinor":110000}]}')$$,
  'itemized payer can move into the cost currency without changing item denomination');
select is((select currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000006'),'LBP','payer currency moves to LBP');
select is((select cost_currency from public.transactions where id='cc200000-0000-4000-8000-000000000006'),null::text,
  'matching payer and cost normalize the override to null');

update item_revision set value=(select revision from public.transactions where id='cc200000-0000-4000-8000-000000000006');
select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000006',(select value from item_revision),
  pg_temp.expense_input(340000,'cc100000-0000-4000-8000-000000000001','LBP','Payer differs from old currency'),null,
  pg_temp.cashier())$$,'requested cost survives a payer change away from the old matching currency');
select is((select currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000006'),'USD','reverse payer edit derives USD');
select is((select cost_currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000006'),'LBP',
  'reverse payer edit keeps the explicitly requested LBP cost');

create temp table main_revision as select revision value from public.transactions where id='cc200000-0000-4000-8000-000000000001';
grant all on main_revision to authenticated;
select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000001',(select value from main_revision),
  pg_temp.expense_input() - 'costCurrency' || '{"note":"Metadata only"}'::jsonb,null,null)$$,
  'omitted cost currency preserves an existing override on update');
select is((select cost_currency::text from public.transactions where id='cc200000-0000-4000-8000-000000000001'),'LBP','omitted update retains LBP cost currency');
select throws_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000001',null,
  pg_temp.expense_input() || '{"costCurrency":"SYP"}'::jsonb,null,pg_temp.cashier())$$,
  'BT003','transaction conflict','create replay with different explicit cost currency conflicts');

update main_revision set value=(select revision from public.transactions where id='cc200000-0000-4000-8000-000000000001');
select pg_temp.seed_needs_attention('cc100000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000001',(select value from main_revision),
  pg_temp.expense_input() || '{"costCurrency":"SYP"}'::jsonb,null,pg_temp.cashier())$$,
  'P0001','wallet unavailable','cost-currency edit is financial and requires active receiver');
select pg_temp.seed_needs_attention('cc100000-0000-4000-8000-000000000002',false);

update main_revision set value=(select revision from public.transactions where id='cc200000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted(
  'cc200000-0000-4000-8000-000000000001',(select value from main_revision),true)$$,'delete reverses cross-currency purchase');
select is((select balance_minor from public.wallet_balance_totals where balance_id='cc100000-0000-4000-8000-000000000002'),110000::numeric,
  'delete removes only the deleted purchase change while other fixtures remain');
update main_revision set value=(select revision from public.transactions where id='cc200000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted(
  'cc200000-0000-4000-8000-000000000001',(select value from main_revision),false)$$,'restore reapplies exact cross-currency legs');

select lives_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000007',null,
  pg_temp.expense_input(400,'cc100000-0000-4000-8000-000000000001','USD','Plain expense')-'costCurrency',null)$$,
  'plain same-currency expense remains supported');
select throws_ok($$update public.transactions set cost_currency='SYP'
  where id='cc200000-0000-4000-8000-000000000007';
  set constraints all immediate$$,'P0001','invalid settlement','direct DML cannot forge a cross-currency cost on a plain expense');

select set_config('request.jwt.claims','{"sub":"ccbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.transactions),0::bigint,'another owner cannot read cross-currency purchases');
select throws_ok($$select * from public.save_transaction(
  'cc200000-0000-4000-8000-000000000099',null,pg_temp.expense_input(),null,pg_temp.cashier())$$,
  'P0001','wallet unavailable','another owner cannot reuse the first owner wallets');

select * from finish();
rollback;
