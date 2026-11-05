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
('d0aaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-cash-a@example.test'),
('d0bbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-cash-b@example.test');
select set_config('request.jwt.claims','{"sub":"d0aaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('d1000000-0000-4000-8000-000000000001','Paying USD','cash','USD'),
('d1000000-0000-4000-8000-000000000002','Returned USD','cash','USD'),
('d1000000-0000-4000-8000-000000000003','Returned LBP','cash','LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create temp table multi_cash_input as
select jsonb_build_object('kind','expense','occurredOn','2026-11-05',
  'balanceId','d1000000-0000-4000-8000-000000000001','amountMinor',1250,
  'categoryId',id,'note','Mixed change') as value
from public.categories where kind='expense' and parent_id is null order by position limit 1;
grant all on multi_cash_input to authenticated;

create function pg_temp.multi_cash_settlement(usd_change bigint default 500, lbp_change bigint default 223750)
returns jsonb language sql as $$
  select jsonb_build_object('tenderMinor',2000,'changes',jsonb_build_array(
    jsonb_build_object('balanceId','d1000000-0000-4000-8000-000000000002','amountMinor',usd_change),
    jsonb_build_object('balanceId','d1000000-0000-4000-8000-000000000003','amountMinor',lbp_change)
  ));
$$;

select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'save USD 20 tender with USD 5 and LBP returned change');
set constraints all immediate;
set constraints all deferred;

select is((select amount_minor from public.transactions where id='d2000000-0000-4000-8000-000000000001'),1250::bigint,'expense keeps separately entered cost');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000001'),-2000::numeric,'paying wallet loses tender once');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000002'),500::numeric,'USD change wallet receives five dollars');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000003'),223750::numeric,'LBP wallet receives exact actual change');
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),2::bigint,'one expense owns two ordered change rows');
select is((select array_agg(currency::text order by position) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),array['USD','LBP'],'change currency comes from each wallet');
select is((select change_balance_ids from public.transactions where id='d2000000-0000-4000-8000-000000000001'),
  array['d1000000-0000-4000-8000-000000000002'::uuid,'d1000000-0000-4000-8000-000000000003'::uuid],
  'derived wallet filter includes every receiver');
select is((select sum(spent_minor) from public.month_category_spend('2026-11-01')),1250::numeric,'reporting counts purchase cost once');
select is((select count(*) from public.transactions where kind='income'),0::bigint,'returned change creates no income rows');
select is((select count(*) from public.transactions where change_balance_id is not null or change_minor is not null),0::bigint,'legacy single-change columns are no longer canonical');

create temp table multi_cash_revision as select revision value from public.transactions where id='d2000000-0000-4000-8000-000000000001';
grant all on multi_cash_revision to authenticated;
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'identical create replay succeeds');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',null,(select value from multi_cash_input),null,
  pg_temp.multi_cash_settlement(400,223750))$$,'BT003','transaction conflict','different multi-leg replay conflicts');

select pg_temp.seed_needs_attention('d1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value || '{"note":"Metadata only"}'::jsonb from multi_cash_input),null,
  pg_temp.multi_cash_settlement())$$,'unchanged cash permits metadata edit with archived receiver');
update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value || '{"amountMinor":1300}'::jsonb from multi_cash_input),null,
  pg_temp.multi_cash_settlement(400,223750))$$,'P0001','wallet unavailable','financial edit requires every receiver active');
select pg_temp.seed_needs_attention('d1000000-0000-4000-8000-000000000003',false);

select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000002',null,(select value from multi_cash_input),null,
  '{"tenderMinor":2000,"changes":[
    {"balanceId":"d1000000-0000-4000-8000-000000000001","amountMinor":250},
    {"balanceId":"d1000000-0000-4000-8000-000000000001","amountMinor":500}
  ]}')$$,'repeated same-wallet change rows are accepted');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000001'),-3250::numeric,
  'same wallet receives both returned rows exactly once');

update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('d2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),true)$$,'delete multi-leg purchase');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000002'),0::numeric,'delete reverses USD change');
select is((select balance_minor from public.wallet_balance_totals where balance_id='d1000000-0000-4000-8000-000000000003'),0::numeric,'delete reverses LBP change');
update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('d2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),false)$$,'restore reapplies all legs');

select throws_ok($$update public.wallet_balances set currency='SYP' where id='d1000000-0000-4000-8000-000000000003'$$,
  'P0001','balance.immutable','change history locks wallet currency');
select pg_temp.seed_needs_attention('d1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.delete_wallet('d1000000-0000-4000-8000-000000000003')$$,
  'P0001','wallet.nonzero','nonzero change balance blocks wallet deletion');
select pg_temp.seed_needs_attention('d1000000-0000-4000-8000-000000000003',false);

update multi_cash_revision set value=(select revision from public.transactions where id='d2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000001',(select value from multi_cash_revision),
  (select value from multi_cash_input),null,'{}')$$,'explicit clear removes all change rows');
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000001'),0::bigint,'clear removes child rows atomically');

select set_config('request.jwt.claims','{"sub":"d0bbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.cashier_changes where transaction_id='d2000000-0000-4000-8000-000000000002'),0::bigint,'another owner cannot read change rows');
select throws_ok($$select * from public.save_transaction(
  'd2000000-0000-4000-8000-000000000003',null,
  jsonb_build_object('kind','expense','occurredOn','2026-11-05','balanceId','d1000000-0000-4000-8000-000000000001','amountMinor',1250,
    'categoryId',(select id from public.categories where kind='expense' limit 1)),null,
  pg_temp.multi_cash_settlement())$$,'P0001','wallet unavailable','another owner cannot use the first owner wallets');

select * from finish();
rollback;
