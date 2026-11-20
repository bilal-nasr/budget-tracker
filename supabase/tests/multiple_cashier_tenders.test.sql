-- Disposable local database only; rollback keeps synthetic fixtures isolated.
begin;
-- Explicit denomination snapshots for the synthetic fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);

create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email) values
('e0aaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-tender-a@example.test'),
('e0bbbbbb-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','multi-tender-b@example.test');
select set_config('request.jwt.claims','{"sub":"e0aaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

with fixture(id,name,kind,currency) as (values ('e1000000-0000-4000-8000-000000000001','Cash USD','cash','USD'),
('e1000000-0000-4000-8000-000000000002','Second USD','cash','USD'),
('e1000000-0000-4000-8000-000000000003','Cash LBP','cash','LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,0::bigint,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create function pg_temp.expense_input(amount bigint default 1000, note text default 'Mixed tender')
returns jsonb language sql as $$
  select jsonb_build_object('kind','expense','occurredOn','2026-11-05',
    'balanceId','e1000000-0000-4000-8000-000000000001','amountMinor',amount,
    'categoryId',(select id from public.categories where kind='expense' and parent_id is null order by position limit 1),
    'note',note);
$$;
-- The owner's example: a 10 USD item, 3 USD and 1,300,000 LBP handed over,
-- 5 USD and 10,000 LBP returned.
create function pg_temp.mixed_settlement(lbp_tender bigint default 1300000)
returns jsonb language sql as $$
  select jsonb_build_object('tenderMinor',300,
    'extraTenders',jsonb_build_array(
      jsonb_build_object('balanceId','e1000000-0000-4000-8000-000000000003','amountMinor',lbp_tender)),
    'changes',jsonb_build_array(
      jsonb_build_object('balanceId','e1000000-0000-4000-8000-000000000001','amountMinor',500),
      jsonb_build_object('balanceId','e1000000-0000-4000-8000-000000000003','amountMinor',10000)));
$$;

select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',null,pg_temp.expense_input(),null,pg_temp.mixed_settlement())$$,
  'save a 10 USD cost paid with 3 USD and 1,300,000 LBP, returning 5 USD and 10,000 LBP');
set constraints all immediate;
set constraints all deferred;

select is((select amount_minor from public.transactions where id='e2000000-0000-4000-8000-000000000001'),1000::bigint,'parent keeps the 10 USD purchase cost');
select is((select coalesce(cost_currency,currency) from public.transactions where id='e2000000-0000-4000-8000-000000000001'),'USD','cost stays in USD');
select is((select tender_minor from public.transactions where id='e2000000-0000-4000-8000-000000000001'),300::bigint,'parent keeps the first tender line');
select is((select spent_minor from public.month_category_spend('2026-11-01') where currency='USD'),1000::bigint,'reports count exactly 10 USD');
select is((select count(*) from public.month_category_spend('2026-11-01') where currency='LBP' and spent_minor<>0),0::bigint,'the LBP tender is not reported as LBP spending');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),200::numeric,'USD balance: 3 USD out, 5 USD back');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),-1290000::numeric,'LBP balance: 1,300,000 out, 10,000 back');
select is((select array_agg(leg||':'||currency||':'||amount_minor order by position) from public.cashier_changes where transaction_id='e2000000-0000-4000-8000-000000000001'),
  array['change:USD:500','change:LBP:10000','tender:LBP:1300000'],'legs keep exact amounts, currencies and order');
select is((select count(*) from public.cashier_changes where transaction_id='e2000000-0000-4000-8000-000000000001' and num_nonnulls(rate_base,rate_quote,rate_numerator,rate_denominator)>0),0::bigint,'no exchange rate is stored');
select is((select change_balance_ids from public.transactions where id='e2000000-0000-4000-8000-000000000001'),
  array['e1000000-0000-4000-8000-000000000001'::uuid,'e1000000-0000-4000-8000-000000000003'::uuid,'e1000000-0000-4000-8000-000000000003'::uuid],
  'derived filter array lists every leg balance');
select is((select count(*) from public.transactions),1::bigint,'one transaction records the event');
select is((select count(*) from public.transactions where kind in ('income','transfer')),0::bigint,'no income or transfer is invented');

-- Stable draft ID: an identical retry succeeds, a different one conflicts.
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',null,pg_temp.expense_input(),null,pg_temp.mixed_settlement())$$,'identical create replay succeeds');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',null,pg_temp.expense_input(),null,pg_temp.mixed_settlement(1200000))$$,
  'BT003','transaction conflict','replay with a different extra tender conflicts');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',null,pg_temp.expense_input(),null,
  pg_temp.mixed_settlement()-'extraTenders')$$,'BT003','transaction conflict','replay without the extra tender conflicts');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),-1290000::numeric,'replays never move money twice');

-- Canonical revision: edits replace every leg atomically.
create temp table tender_revision as select revision value from public.transactions where id='e2000000-0000-4000-8000-000000000001';
grant all on tender_revision to authenticated;
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',(select value from tender_revision),
  pg_temp.expense_input(note=>'Metadata only'),null,null)$$,'metadata edit preserves every tender and change');
select is((select count(*) from public.cashier_changes where transaction_id='e2000000-0000-4000-8000-000000000001'),3::bigint,'preserved legs stay in place');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',(select value from tender_revision),
  pg_temp.expense_input(),null,pg_temp.mixed_settlement(1250000))$$,'BT003','transaction conflict','a stale revision cannot edit tenders');
update tender_revision set value=(select revision from public.transactions where id='e2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',(select value from tender_revision),
  pg_temp.expense_input(),null,pg_temp.mixed_settlement(1250000))$$,'edit the LBP tender amount');
set constraints all immediate;
set constraints all deferred;
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),-1240000::numeric,'edited tender replaces, never adds to, the previous debit');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),200::numeric,'untouched USD legs are unchanged by the edit');

-- Exact-revision delete and Undo.
update tender_revision set value=(select revision from public.transactions where id='e2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('e2000000-0000-4000-8000-000000000001',(select value from tender_revision),true)$$,'delete the multi-tender purchase');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),0::numeric,'delete reverses the USD legs');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),0::numeric,'delete reverses the LBP legs');
select is((select coalesce(sum(spent_minor),0) from public.month_category_spend('2026-11-01')),0::numeric,'delete removes the reported cost');
update tender_revision set value=(select revision from public.transactions where id='e2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.set_transaction_deleted('e2000000-0000-4000-8000-000000000001',(select value from tender_revision),false)$$,'Undo restores the purchase');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),200::numeric,'Undo reapplies the USD legs');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),-1240000::numeric,'Undo reapplies the LBP legs');

-- A nonzero balance from a tender leg still blocks disabling its currency.
select throws_ok($$select public.set_currency_disabled('LBP',true)$$,'P0001','currency.nonzero','a tender leg balance blocks disabling its currency');

update tender_revision set value=(select revision from public.transactions where id='e2000000-0000-4000-8000-000000000001');
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000001',(select value from tender_revision),pg_temp.expense_input(),null,'{}')$$,'explicit clear removes every leg');
select is((select count(*) from public.cashier_changes where transaction_id='e2000000-0000-4000-8000-000000000001'),0::bigint,'clear removes tender and change rows atomically');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),-1000::numeric,'a standard expense debits its cost once');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000003'),0::numeric,'cleared LBP legs no longer move money');

-- Legacy single-tender shape: the payload and rows that existed before this
-- migration keep their exact meaning (one tender line, change legs only).
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000002',null,pg_temp.expense_input(1250,'Legacy shape'),null,
  '{"tenderMinor":2000,"changes":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":750}]}')$$,
  'a settlement without extraTenders saves as before');
set constraints all immediate;
set constraints all deferred;
select is((select array_agg(leg order by position) from public.cashier_changes where transaction_id='e2000000-0000-4000-8000-000000000002'),array['change'],'historical rows are change legs by default');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000001'),-3000::numeric,'single tender debits the paying balance once');
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000002'),750::numeric,'single change credits its balance');
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000002',null,pg_temp.expense_input(1250,'Legacy shape'),null,
  '{"tenderMinor":2000,"changes":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":750}]}')$$,
  'legacy-shaped replay still matches its stored snapshot');
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000002',null,pg_temp.expense_input(1250,'Legacy shape'),null,
  '{"tenderMinor":2000,"extraTenders":[],"changes":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":750}]}')$$,
  'an empty extraTenders list is the same settlement');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000003',null,pg_temp.expense_input(1250,'Legacy mismatch'),null,
  '{"tenderMinor":2000,"changes":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":700}]}')$$,
  'P0001','settlement mismatch','single-currency reconciliation is unchanged');

-- Same-currency sanity, generalised to several tenders. Nothing is converted.
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000004',null,pg_temp.expense_input(1000,'Two USD wallets'),null,
  '{"tenderMinor":600,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":400}],"changes":[]}')$$,
  'two USD tenders that add up to the USD cost are accepted');
set constraints all immediate;
set constraints all deferred;
select is((select balance_minor from public.wallet_balance_totals where balance_id='e1000000-0000-4000-8000-000000000002'),350::numeric,'second USD balance is debited exactly its tender');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000005',null,pg_temp.expense_input(1000,'Short'),null,
  '{"tenderMinor":600,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000002","amountMinor":300}],"changes":[]}')$$,
  'P0001','settlement mismatch','USD-only tenders must still equal the USD cost');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000006',null,pg_temp.expense_input(1000,'Overpaid'),null,
  '{"tenderMinor":1000,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000003","amountMinor":50000}],"changes":[]}')$$,
  'P0001','settlement mismatch','a second currency is refused when the cost currency already covers the cost');
select lives_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000007',null,pg_temp.expense_input(1000,'No change'),null,
  '{"tenderMinor":300,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000003","amountMinor":630000}],"changes":[]}')$$,
  'a mixed tender with no change is recorded as given');

-- Payload validation.
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000008',null,pg_temp.expense_input(),null,
  '{"tenderMinor":300,"extraTenders":{},"changes":[]}')$$,'P0001','invalid settlement','extraTenders must be a list');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000008',null,pg_temp.expense_input(),null,
  '{"tenderMinor":300,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000003","amountMinor":630000,"rate":{}}],"changes":[]}')$$,
  'P0001','invalid settlement','a tender line never carries an exchange rate');
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000008',null,pg_temp.expense_input(),null,
  '{"tenderMinor":300,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000003","amountMinor":0}],"changes":[]}')$$,
  'P0001','invalid settlement','a tender line needs a positive amount');
-- No update policy exists, so the API reaches no row; the leg guard covers privileged writers.
with touched as (update public.cashier_changes set leg='change' where leg='tender' returning 1)
select is((select count(*) from touched),0::bigint,'legs cannot be rewritten through the API');

select set_config('request.jwt.claims','{"sub":"e0bbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.cashier_changes),0::bigint,'another owner cannot read tender rows');
with container as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 values('e1000000-0000-4000-8000-00000000000b',auth.uid(),'Other owner','cash','e1000000-0000-4000-8000-00000000000b') returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code='USD' then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,0::bigint,0 from container c join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
select throws_ok($$select * from public.save_transaction(
  'e2000000-0000-4000-8000-000000000009',null,
  jsonb_build_object('kind','expense','occurredOn','2026-11-05','balanceId','e1000000-0000-4000-8000-00000000000b','amountMinor',1000,
    'categoryId',(select id from public.categories where kind='expense' and parent_id is null order by position limit 1)),null,
  '{"tenderMinor":300,"extraTenders":[{"balanceId":"e1000000-0000-4000-8000-000000000003","amountMinor":630000}],"changes":[]}')$$,
  'P0001','wallet unavailable','another owner cannot pay from the first owner balances');

select * from finish();
rollback;
