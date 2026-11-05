begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
  ('da000000-0000-4000-8000-000000000001','delete-loan-a@example.test'),
  ('db000000-0000-4000-8000-000000000002','delete-loan-b@example.test');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency,opening_balance_minor) as (values ('da100000-0000-4000-8000-000000000001','Loan deletion cash','cash','USD',100000),
  ('da100000-0000-4000-8000-000000000002','Loan deletion bank','bank','USD',200000)), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then f.opening_balance_minor::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;
create function pg_temp.loan_args(direction text default 'borrowed',mode text default 'new') returns jsonb language sql as $$
  select jsonb_build_object('requestId',gen_random_uuid(),'name','Deletion fixture','direction',direction,
    'principalMinor',10000,'feeBps',1000,'balanceId','da100000-0000-4000-8000-000000000001',
    'feeCategoryId',(select id from public.categories where kind::text=case when direction='borrowed' then 'expense' else 'income' end and archived_at is null order by position,id limit 1),
    'openedOn',public.loan_today(),'creationMode',mode,'principalPaidBeforeMinor',0,'feePaidBeforeMinor',0)
$$;
create function pg_temp.pay(loan_id uuid,amount bigint,wallet text default 'da100000-0000-4000-8000-000000000001') returns uuid language sql as $$
  select id from public.record_loan_payment(jsonb_build_object('requestId',gen_random_uuid(),'loanId',loan_id,
    'balanceId',wallet,'amountMinor',amount,'occurredOn',public.loan_today()))
$$;
create temp table fixture(loan uuid,older uuid,later uuid);
insert into fixture(loan) select id from public.create_loan(pg_temp.loan_args());
update fixture set older=pg_temp.pay(loan,6000);
update fixture set later=pg_temp.pay(loan,5000,'da100000-0000-4000-8000-000000000002');
create temp table retired_payment as select loan_payload as payload from public.transactions where id=(select older from fixture);
create temp table retired_loan as select request_payload as payload from public.loans where id=(select loan from fixture);
select public.set_loan_archived((select loan from fixture),true);
select throws_ok($$select public.delete_loan_payment((select older from fixture),2)$$,null,'loan.conflict','stale revision cannot delete');
select is((select count(*) from public.transactions where loan_id=(select loan from fixture)),3::bigint,'conflict preserves every entry');
select throws_ok($$select public.delete_loan_payment((select id from public.transactions where loan_event='disbursement'),1)$$,null,'loan.invalid','individual principal movement deletion denied');
select lives_ok($$select public.delete_loan_payment((select older from fixture),1)$$,'older repayment can be permanently deleted despite newer active payment');
select is((select count(*) from public.transactions where id=(select older from fixture)),0::bigint,'older repayment physically removed');
select throws_ok($$select public.record_loan_payment((select payload from retired_payment))$$,null,'loan.conflict','an old request retry cannot resurrect the deleted payment');
select is((select remaining_minor from public.loan_progress where id=(select loan from fixture)),6000::bigint,'removed principal returns to remaining balance');
select is((select archived_at from public.loans where id=(select loan from fixture)),null::timestamptz,'archived loan reopened');
select is((select loan_fee_minor from public.transactions where id=(select later from fixture)),1000::bigint,'later payment keeps original fee allocation');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),110000::numeric,'only deleted repayment wallet effect reversed');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000002'),195000::numeric,'other wallet unchanged');
select throws_ok($$select public.delete_loan((select loan from fixture))$$,null,'loan.inUse','unarchived loan cannot be deleted');
select lives_ok($$select public.delete_loan_payment((select later from fixture),1)$$,'fee-bearing repayment deleted');
select is((select count(*) from public.reporting_entries),0::bigint,'deleted payment fee removed from reports');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000002'),200000::numeric,'second wallet restored');
-- Repay across two wallets, retain a voided entry, then delete the whole loan.
update fixture set older=pg_temp.pay(loan,1000);
select public.void_loan_payment((select older from fixture),1);
select pg_temp.pay((select loan from fixture),7000);
select pg_temp.pay((select loan from fixture),4000,'da100000-0000-4000-8000-000000000002');
select public.set_loan_archived((select loan from fixture),true);
-- RLS still blocks unrestricted hard deletes.
select lives_ok($$delete from public.loans where id=(select loan from fixture)$$,'direct delete silently blocked by RLS');
select is((select count(*) from public.loans),1::bigint,'direct delete did not remove loan');
select lives_ok($$delete from public.transactions where loan_id=(select loan from fixture)$$,'direct transaction delete blocked by RLS');
select is((select count(*) from public.transactions),4::bigint,'direct delete did not remove history');
select set_config('request.jwt.claims','{"sub":"db000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.delete_loan((select loan from fixture))$$,null,'loan.invalid','foreign loan deletion denied');
select throws_ok($$select public.delete_loan_payment((select older from fixture),2)$$,null,'loan.invalid','foreign payment deletion denied');
select set_config('request.jwt.claims','{"sub":"da000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.delete_loan((select loan from fixture))$$,'archived loan permanently removed');
set constraints all immediate;
set constraints all deferred;
select is((select count(*) from public.loans),0::bigint,'loan physically removed');
select is((select count(*) from public.transactions),0::bigint,'all linked entries including voided ones physically removed');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),100000::numeric,'principal and payments reversed in first wallet');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000002'),200000::numeric,'payments reversed in second wallet');
select is((select count(*) from public.reporting_entries),0::bigint,'loan fee reporting removed');
select throws_ok($$select public.create_loan((select payload from retired_loan))$$,null,'loan.conflict','an old create request cannot resurrect the deleted loan');
-- Lent and pre-existing loans have different principal cash-flow semantics.
truncate fixture;
insert into fixture(loan) select id from public.create_loan(pg_temp.loan_args('lent'));
select pg_temp.pay((select loan from fixture),11000);
select public.set_loan_archived((select loan from fixture),true);
select public.delete_loan((select loan from fixture));
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),100000::numeric,'lent loan deletion reverses principal and received payments');
truncate fixture;
insert into fixture(loan) select id from public.create_loan(pg_temp.loan_args('borrowed','existing'));
select pg_temp.pay((select loan from fixture),11000);
select public.set_loan_archived((select loan from fixture),true);
select public.delete_loan((select loan from fixture));
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),100000::numeric,'existing loan deletion reverses payments without inventing principal movement');
truncate fixture;
insert into fixture(loan) select id from public.create_loan(pg_temp.loan_args('borrowed','existing'));
update fixture set older=pg_temp.pay(loan,1000);
select public.void_loan_payment((select older from fixture),1);
select public.cancel_loan((select loan from fixture));
select lives_ok($$select public.delete_loan_payment((select older from fixture),2)$$,'voided repayment can be permanently removed from canceled loan');
select is((select count(*) from public.transactions where id=(select older from fixture)),0::bigint,'voided repayment physically removed');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),100000::numeric,'deleting voided repayment does not reverse its wallet effect twice');
select lives_ok($$select public.delete_loan((select loan from fixture))$$,'canceled existing loan can be deleted without archiving');
select is((select count(*) from public.loans),0::bigint,'canceled existing loan physically removed');
truncate fixture;
insert into fixture(loan) select id from public.create_loan(pg_temp.loan_args());
update fixture set older=pg_temp.pay(loan,1000);
select public.void_loan_payment((select older from fixture),1);
select public.cancel_loan((select loan from fixture));
select lives_ok($$select public.delete_loan((select loan from fixture))$$,'canceled new loan can be deleted with its voided principal movement and repayment');
select is((select count(*) from public.transactions),0::bigint,'canceled loan linked transactions physically removed');
select is((select balance_minor from public.wallet_balance_totals where balance_id='da100000-0000-4000-8000-000000000001'),100000::numeric,'canceled loan deletion does not reverse wallet movements twice');
select throws_ok($$select * from public.loan_deleted_requests$$,null,'permission denied for table loan_deleted_requests','request markers are private');
select is(has_function_privilege('authenticated','public.retire_loan_request(uuid,text,uuid)','execute'),false,'authenticated users cannot retire arbitrary requests');
select is(has_function_privilege('anon','public.delete_loan(uuid)','execute'),false,'anonymous loan deletion denied');
select is(has_function_privilege('anon','public.delete_loan_payment(uuid,integer)','execute'),false,'anonymous payment deletion denied');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.delete_loan(gen_random_uuid())$$,null,'loan.invalid','missing identity denied even with authenticated role');
set constraints all immediate;
select * from finish();
rollback;
