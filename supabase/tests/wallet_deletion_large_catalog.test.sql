begin;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values ('cf770000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-large-catalog@example.test');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cf770000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin for n in 1..65 loop perform public.create_currency('EDGE'||lpad(n::text,3,'0'),'E',0); end loop; end $$;
create temp table review65_ids(label text primary key,id uuid);
insert into review65_ids values('source',public.create_wallet('Review65 source','cash','USD',0)),('target',public.create_wallet('Review65 target','cash','USD',0));
do $$ declare b record; cat uuid; begin
 select id into cat from public.categories where kind='income' and parent_id is null order by position limit 1;
 for b in select * from public.wallet_balances where wallet_id=(select id from review65_ids where label='source') and currency like 'EDGE%' loop
  perform set_config('request.headers',jsonb_build_object('x-budget-units',jsonb_build_object(b.currency,0)::text)::text,true);
  insert into public.transactions(kind,occurred_on,balance_id,currency,amount_minor,category_id) values('income','2026-11-05',b.id,b.currency,1,cat);
 end loop;
end $$;
create temp table review65_plan as select jsonb_agg(jsonb_build_object('balanceId',b.id,'counterpartBalanceId',case when t.balance_minor<>0 then dest.id else null end,'expectedAmountMinor',t.balance_minor,'expectedUnit',jsonb_build_object('code',c.code,'decimalPlaces',c.decimal_places)) order by b.id) payload
 from public.wallet_balances b join public.wallet_balance_totals t on t.balance_id=b.id join public.currencies c on(c.user_id,c.code)=(b.user_id,b.currency)
 join public.wallet_balances dest on dest.wallet_id=(select id from review65_ids where label='target') and dest.currency=b.currency where b.wallet_id=(select id from review65_ids where label='source');
-- The confirmed plan covers65 nonzero currencies plus the automatic zero rows.
select is((select count(*) from public.wallet_balance_totals where wallet_id=(select id from review65_ids where label='source') and balance_minor=1),65::bigint,'fixture has65 separately funded currencies');
select is((select jsonb_array_length(payload) from review65_plan),(select count(*)::integer from public.currencies),'plan includes every currency, including automatic zeros');
select set_config('request.headers',jsonb_build_object('x-budget-units','{"EDGE001":8}')::text,true);
select throws_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),(select payload from review65_plan))$q$,'BT003','currency.intentConflict','large deletion still honors an explicitly stale incoming unit');
select set_config('request.headers',jsonb_build_object('x-budget-units',(select jsonb_object_agg(code,decimal_places)::text from public.currencies where code like 'EDGE%'))::text,true);
select throws_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),(select payload from review65_plan))$q$,'BT003','currency.intentConflict','public incoming unit map remains capped at64');
select set_config('request.headers','{}',true);
select throws_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),jsonb_set((select payload from review65_plan),array[(select (jsonb_array_length(payload)-1)::text from review65_plan),'expectedAmountMinor'],'999'))$q$,'P0001','wallet.deletionConflict','an invalid final entry is rejected before any of the65 settlement legs');
select is((select count(*) from public.transactions where note='Wallet settlement'),0::bigint,'rejected full plans and headers produce no partial settlement legs');
select set_config('request.headers','{"x-budget-units":"{\"USD\":2}","x-fixture-context":"preserve"}',true);
select lives_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),(select payload from review65_plan))$q$,'valid65-currency signed deletion completes atomically');
select is((select count(*) from public.wallet_balance_totals where wallet_id=(select id from review65_ids where label='source') and currency like 'EDGE%' and balance_minor=0),65::bigint,'all65 formerly nonzero source currencies settle to zero');
select is((select sum(abs(balance_minor)) from public.wallet_balance_totals where wallet_id=(select id from review65_ids where label='source')),0::numeric,'all source balances including automatic rows are exactly zero');
select ok((select deleted_at is not null from public.wallets where id=(select id from review65_ids where label='source')),'source wallet is tombstoned after every leg');
select is((select count(*) from public.wallet_balance_totals where wallet_id=(select id from review65_ids where label='target') and currency like 'EDGE%' and balance_minor=1),65::bigint,'all65 exact counterparts receive one minor unit');
select is((select count(*) from public.transactions where note='Wallet settlement'),65::bigint,'exactly65 settlement events were created');
select is((select count(*) from public.transactions t join public.wallet_balances source on source.id=t.balance_id join public.wallet_balances dest on dest.id=t.to_balance_id where t.note='Wallet settlement' and source.wallet_id=(select id from review65_ids where label='source') and dest.wallet_id=(select id from review65_ids where label='target') and source.currency=dest.currency and t.currency=source.currency and t.amount_minor=1 and t.to_amount_minor=1),65::bigint,'every leg preserves exact source/destination identity, amount and denomination');
select is(current_setting('request.headers')::jsonb,'{"x-budget-units":"{\"USD\":2}","x-fixture-context":"preserve"}'::jsonb,'internal per-leg headers restore the original request context');
select lives_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),(select payload from review65_plan))$q$,'successful65-currency receipt replays before tombstone restrictions');
select is((select count(*) from public.transactions where note='Wallet settlement'),65::bigint,'exact replay creates no additional legs');
select throws_ok($q$select public.settle_and_delete_wallet('cf770000-0000-4000-8000-000000000002',(select id from review65_ids where label='source'),jsonb_set((select payload from review65_plan),'{0,expectedAmountMinor}','999'))$q$,'P0001','wallet.deletionConflict','successful large deletion token rejects a changed payload');
select is((select count(*) from public.transactions where note='Wallet settlement'),65::bigint,'changed-payload conflict leaves the original65 legs unchanged');
set constraints all immediate;
select * from finish();
rollback;
