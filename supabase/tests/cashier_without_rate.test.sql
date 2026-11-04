begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
('ceaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cash-no-rate@example.test');
select set_config('request.jwt.claims','{"sub":"ceaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.wallets(id,name,kind,currency) values
('ce100000-0000-4000-8000-000000000001','USD cash','cash','USD'),
('ce100000-0000-4000-8000-000000000002','LBP cash','cash','LBP'),
('ce100000-0000-4000-8000-000000000003','SYP cash','cash','SYP');

-- Every directed currency pair uses actual amounts, without a rate or conversion.
select lives_ok(format('select * from public.save_transaction(%L,null,%L::jsonb,null,%L::jsonb)',
  gen_random_uuid(),
  jsonb_build_object('kind','expense','occurredOn','2026-11-04','walletId',payer.id,'amountMinor',400,
    'categoryId',(select id from public.categories where kind='expense' and parent_id is null limit 1)),
  jsonb_build_object('tenderMinor',500,'change',jsonb_build_object('walletId',receiver.id,'amountMinor',10000))),
  payer.currency || ' paid and ' || receiver.currency || ' change need no quote')
from public.wallets payer cross join public.wallets receiver
where payer.id<>receiver.id;
set constraints all immediate;
select is(balance_minor,19000::numeric,currency || ' balance debits 500 twice and credits 10000 twice')
from public.wallet_balances b join public.wallets w on w.id=b.wallet_id;
select is(count(*),6::bigint,'all pairs retain cash without an exchange-rate snapshot')
from public.transactions where tender_minor=500 and change_minor=10000 and change_rate_base is null;

-- A rate-free aggregate can be edited, deleted and restored with exact movements.
select lives_ok($$update public.transactions set tender_minor=600
  where currency='USD' and change_currency='LBP'$$,'edit actual paid amount');
select is((select balance_minor from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.currency='USD'),18900::numeric,'edit updates paid wallet exactly');
select lives_ok($$select public.set_transaction_deleted(id,revision,true)
  from public.transactions where currency='USD' and change_currency='LBP'$$,'delete rate-free payment');
select is((select balance_minor from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.currency='USD'),19500::numeric,'delete reverses cash paid');
select is((select balance_minor from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.currency='LBP'),9000::numeric,'delete reverses actual change');
select lives_ok($$select public.set_transaction_deleted(id,revision,false)
  from public.transactions where currency='USD' and change_currency='LBP'$$,'restore rate-free payment');
select is((select balance_minor from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.currency='USD'),18900::numeric,'restore reapplies cash paid');
select is((select balance_minor from public.wallet_balances b join public.wallets w on w.id=b.wallet_id where w.currency='LBP'),19000::numeric,'restore reapplies actual change');
select throws_ok($$update public.transactions set tender_minor=amount_minor
  where currency='USD' and change_currency='LBP'$$,'P0001','settlement mismatch','change requires cash above purchase cost');
select throws_ok($$update public.transactions set change_rate_base='USD'
  where currency='USD' and change_currency='LBP'$$,'P0001','invalid settlement rate','partial historical quotes remain invalid');
select * from finish();
rollback;
