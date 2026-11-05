begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
('ceaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cash-no-rate@example.test');
select set_config('request.jwt.claims','{"sub":"ceaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('ce100000-0000-4000-8000-000000000001','USD cash','cash','USD'),
('ce100000-0000-4000-8000-000000000002','LBP cash','cash','LBP'),
('ce100000-0000-4000-8000-000000000003','SYP cash','cash','SYP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

-- Every directed currency pair uses actual amounts, without a rate or conversion.
select lives_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,null,%L::jsonb)',
  gen_random_uuid(),
  jsonb_build_object('kind','expense','occurredOn','2026-11-04','balanceId',payer.id,'amountMinor',400,
    'categoryId',(select id from public.categories where kind='expense' and parent_id is null limit 1)),
  jsonb_build_object('tenderMinor',500,'changes',jsonb_build_array(jsonb_build_object('balanceId',receiver.id,'amountMinor',10000)))),
  payer.currency || ' paid and ' || receiver.currency || ' change need no quote')
from public.wallet_balances payer cross join public.wallet_balances receiver
where payer.id<>receiver.id and payer.id=payer.wallet_id and receiver.id=receiver.wallet_id;
set constraints all immediate;
select is(balance_minor,19000::numeric,b.currency || ' balance debits 500 twice and credits 10000 twice')
from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id;
select is(count(*),6::bigint,'all pairs retain cash without an exchange-rate snapshot')
from public.cashier_changes where amount_minor=10000 and rate_base is null;

-- A rate-free aggregate can be edited, deleted and restored with exact movements.
select lives_ok($$update public.transactions set tender_minor=600
  where currency='USD' and exists(select 1 from public.cashier_changes c where c.transaction_id=transactions.id and c.currency='LBP')$$,'edit actual paid amount');
select is((select balance_minor from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id and w.currency='USD'),18900::numeric,'edit updates paid wallet exactly');
select lives_ok($$select public.set_transaction_deleted(id,revision,true)
  from public.transactions t where currency='USD' and exists(select 1 from public.cashier_changes c where c.transaction_id=t.id and c.currency='LBP')$$,'delete rate-free payment');
select is((select balance_minor from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id and w.currency='USD'),19500::numeric,'delete reverses cash paid');
select is((select balance_minor from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id and w.currency='LBP'),9000::numeric,'delete reverses actual change');
select lives_ok($$select public.set_transaction_deleted(id,revision,false)
  from public.transactions t where currency='USD' and exists(select 1 from public.cashier_changes c where c.transaction_id=t.id and c.currency='LBP')$$,'restore rate-free payment');
select is((select balance_minor from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id and w.currency='USD'),18900::numeric,'restore reapplies cash paid');
select is((select balance_minor from public.wallet_balance_totals b join public.wallet_balances w on w.id=b.balance_id where w.id=w.wallet_id and w.currency='LBP'),19000::numeric,'restore reapplies actual change');
select throws_ok($$update public.transactions set tender_minor=amount_minor
  where currency='USD' and exists(select 1 from public.cashier_changes c where c.transaction_id=transactions.id and c.currency='LBP')$$,'P0001','settlement mismatch','change requires cash above purchase cost');
select throws_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,null,%L::jsonb)',
  gen_random_uuid(),
  jsonb_build_object('kind','expense','occurredOn','2026-11-04','balanceId','ce100000-0000-4000-8000-000000000001','amountMinor',400,
    'categoryId',(select id from public.categories where kind='expense' and parent_id is null limit 1)),
  '{"tenderMinor":500,"changes":[{"balanceId":"ce100000-0000-4000-8000-000000000002","amountMinor":10000,
    "rate":{"base":"USD","quote":"LBP","quoteMajorNumerator":89500,"quoteMajorDenominator":1}}]}'::jsonb),
  'P0001','invalid settlement rate','new actual-cash settlements reject rate metadata');
select * from finish();
rollback;
