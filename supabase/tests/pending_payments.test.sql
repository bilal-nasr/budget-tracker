begin;
-- Explicit denomination snapshots for the synthetic legacy fixtures.
select set_config('request.headers',jsonb_build_object('x-budget-units','{"USD":2,"LBP":0,"SYP":0}')::text,true);
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
  ('ee000000-0000-4000-8000-000000000001','pending-a@example.test'),
  ('ee000000-0000-4000-8000-000000000002','pending-b@example.test');
select set_config('request.jwt.claims','{"sub":"ee000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('ee100000-0000-4000-8000-000000000001','Cash','cash','USD'),
  ('ee100000-0000-4000-8000-000000000002','Lira','cash','LBP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
create function pg_temp.job() returns jsonb language sql as $$
  select jsonb_build_object('requestId','ee200000-0000-4000-8000-000000000001','client','Client','project','Website','currency','USD','totalMinor',10000,'dueOn',null)
$$;
create function pg_temp.receipt(request text,amount bigint) returns jsonb language sql as $$
  select jsonb_build_object('requestId',request,'paymentId','ee200000-0000-4000-8000-000000000001',
    'balanceId','ee100000-0000-4000-8000-000000000001','categoryId',(select id from public.categories where kind::text='income' and archived_at is null limit 1),
    'amountMinor',amount,'occurredOn',public.loan_today())
$$;
select lives_ok($$select public.create_pending_payment(pg_temp.job())$$,'create job');
select lives_ok($$select public.create_pending_payment(pg_temp.job())$$,'create replay is safe');
select is((select count(*) from public.pending_payments),1::bigint,'one job');
select is((select count(*) from public.transactions),0::bigint,'unpaid work creates no income');
select is((select count(*) from public.reporting_entries),0::bigint,'unpaid work is excluded from reports');
select lives_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000001',2500))$$,'first partial receipt');
select lives_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000001',2500))$$,'receipt replay safe');
select is((select remaining_minor from public.pending_payment_progress),7500::bigint,'remaining updated');
select is((select sum(amount_minor) from public.reporting_entries where kind='income'),2500::numeric,'received work is ordinary income in reports');
select is((select balance_minor from public.wallet_balance_totals where balance_id='ee100000-0000-4000-8000-000000000001'),2500::numeric,'only receipt enters wallet');
select throws_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000001',3000))$$,null,'pending.conflict','same ID cannot carry a different amount');
select throws_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000002',7501))$$,null,'pending.exceedsRemaining','overpayment blocked');
select throws_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000002',1000)||'{"balanceId":"ee100000-0000-4000-8000-000000000002"}')$$,null,'pending.walletUnavailable','currency mismatch blocked');
select throws_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000002',1000)||'{"occurredOn":"2099-01-01"}')$$,null,'pending.invalid','future receipts rejected');
select throws_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000001',1,pg_temp.job()||'{"totalMinor":2000}')$$,null,'pending.totalBelowPaid','total cannot drop below received');
select throws_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000001',1,'{}',true)$$,null,'pending.inUse','receipt history prevents job deletion');
select lives_ok($$update public.transactions set amount_minor=3000 where id='ee300000-0000-4000-8000-000000000001'$$,'generic income edit updates progress');
select is((select remaining_minor from public.pending_payment_progress),7000::bigint,'edited amount reflected');
select throws_ok($$update public.transactions set amount_minor=10001 where id='ee300000-0000-4000-8000-000000000001'$$,null,'pending.exceedsRemaining','generic edit cap enforced');
select throws_ok($$update public.transactions set pending_payment_id=null,pending_receipt_payload=null where id='ee300000-0000-4000-8000-000000000001'$$,null,'pending.conflict','receipt cannot be detached');
select lives_ok($$select public.set_transaction_deleted('ee300000-0000-4000-8000-000000000001',2,true)$$,'existing delete contract works');
select is((select remaining_minor from public.pending_payment_progress),10000::bigint,'deletion restores amount owed');
select is((select has_receipt_history from public.pending_payment_progress),true,'deletion eligibility retains soft-deleted receipt history');
select lives_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000001',2500))$$,'retry after edit/delete acknowledges original receipt');
select is((select remaining_minor from public.pending_payment_progress),10000::bigint,'retry does not resurrect deleted income');
select lives_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000002',10000))$$,'full remaining receipt settles job');
select is((select remaining_minor from public.pending_payment_progress),0::bigint,'settled');
select lives_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000001',1,pg_temp.job()||'{"client":"Renamed","totalMinor":12000}')$$,'job details and total editable after receipts');
select is((select remaining_minor from public.pending_payment_progress),2000::bigint,'increased total reopens remaining balance');
select throws_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000001',1,pg_temp.job())$$,null,'pending.conflict','stale job edit blocked');
select throws_ok($$select public.set_transaction_deleted('ee300000-0000-4000-8000-000000000001',3,false)$$,null,'pending.exceedsRemaining','Undo cannot overpay after another receipt');
select set_config('request.jwt.claims','{"sub":"ee000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.pending_payment_progress),0::bigint,'another owner cannot see jobs');
select throws_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000003',1000))$$,null,'pending.invalid','foreign receipt blocked');
select throws_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000001',1,pg_temp.job())$$,null,'pending.conflict','foreign edit blocked');
select set_config('request.jwt.claims','{"sub":"ee000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.create_pending_payment(pg_temp.job()||'{"requestId":"ee200000-0000-4000-8000-000000000002","currency":"LBP"}')$$,'whole-pound job supported');
select lives_ok($$select public.record_pending_receipt(pg_temp.receipt('ee300000-0000-4000-8000-000000000003',2500)||'{"paymentId":"ee200000-0000-4000-8000-000000000002","balanceId":"ee100000-0000-4000-8000-000000000002"}')$$,'whole-pound partial receipt supported');
select is((select balance_minor from public.wallet_balance_totals where balance_id='ee100000-0000-4000-8000-000000000002'),2500::numeric,'currencies accounted separately');
select lives_ok($$select public.create_pending_payment(pg_temp.job()||'{"requestId":"ee200000-0000-4000-8000-000000000003","currency":"SYP"}')$$,'Syrian-pound job supported');
select lives_ok($$select public.update_pending_payment('ee200000-0000-4000-8000-000000000003',1,'{}',true)$$,'job without receipts can be deleted');
select throws_ok($$select public.create_pending_payment(pg_temp.job()||'{"requestId":"ee200000-0000-4000-8000-000000000003","currency":"SYP"}')$$,null,'pending.conflict','create retry cannot resurrect deleted job');
select * from finish();
rollback;
