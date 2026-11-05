-- Rollback-only synthetic account coverage. Run via the parent's disposable stack.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email) values
('ca000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loan-a@example.test'),
('cb000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loan-b@example.test');
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
with fixture(id,name,kind,currency) as (values ('ca100000-0000-4000-8000-000000000001','Loan test USD','cash','USD'),
('ca100000-0000-4000-8000-000000000002','Loan test LBP','cash','LBP'),
('ca100000-0000-4000-8000-000000000003','Second USD','bank','USD'),
('ca100000-0000-4000-8000-000000000004','Loan test SYP','cash','SYP')), containers as (
 insert into public.wallets(id,user_id,name,kind,default_balance_id)
 select f.id::uuid,auth.uid()::uuid,f.name,f.kind::public.wallet_kind,f.id::uuid from fixture f returning id,user_id
)
insert into public.wallet_balances(id,user_id,wallet_id,currency,opening_balance_minor,position)
select case when cc.code=f.currency then c.id else gen_random_uuid() end,c.user_id,c.id,cc.code,case when cc.code=f.currency then 0::bigint else 0 end,0 from fixture f join containers c on c.id=f.id::uuid join public.currencies cc on cc.user_id=c.user_id and cc.disabled_at is null;

create function pg_temp.loan_args(key_number integer,direction text default 'borrowed',mode text default 'new',principal bigint default 100000,bps integer default 725)
returns jsonb language sql as $$
  select jsonb_build_object('requestId',('ca200000-0000-4000-8000-'||lpad(key_number::text,12,'0'))::uuid,
    'name','Synthetic loan '||key_number,'direction',direction,'principalMinor',principal,'feeBps',bps,
    'balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',
    (select id from public.categories where kind::text=case when direction='borrowed' then 'expense' else 'income' end and archived_at is null order by position limit 1),
    'openedOn',public.loan_today(),'creationMode',mode,'principalPaidBeforeMinor',0,'feePaidBeforeMinor',0)
$$;
create function pg_temp.payment_args(loan_key integer,payment_key integer,amount bigint,wallet uuid default 'ca100000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object('requestId',('ca300000-0000-4000-8000-'||lpad(payment_key::text,12,'0'))::uuid,
    'loanId',(select id from public.loans where request_id=('ca200000-0000-4000-8000-'||lpad(loan_key::text,12,'0'))::uuid),
    'balanceId',wallet,'amountMinor',amount,'occurredOn',public.loan_today())
$$;
create function pg_temp.payment_id(payment_key integer) returns uuid language sql as $$
  select id from public.transactions where loan_request_id=('ca300000-0000-4000-8000-'||lpad(payment_key::text,12,'0'))::uuid
$$;
create function pg_temp.payment_revision(payment_key integer) returns integer language sql as $$
  select revision from public.transactions where id=pg_temp.payment_id(payment_key)
$$;

select lives_ok($$select public.create_loan(pg_temp.loan_args(101,'borrowed','existing',200000,0)||'{"monthlyPaymentMinor":28500,"paymentCount":7}'::jsonb)$$,'monthly plan creates');
select is((select monthly_payment_minor from public.loan_progress where name='Synthetic loan 101'),28500::bigint,'monthly field visible in progress');
select is((select payment_count from public.loan_progress where name='Synthetic loan 101'),7,'count includes last payment');
select is((select total_due_minor-monthly_payment_minor*(payment_count-1) from public.loan_progress where name='Synthetic loan 101'),29000::bigint,'final balance calculates 290');
select is((select count(*) from public.transactions),0::bigint,'plan never posts money');
select lives_ok($$select public.create_loan(pg_temp.loan_args(101,'borrowed','existing',200000,0)||'{"monthlyPaymentMinor":28500,"paymentCount":7}'::jsonb)$$,'same plan request retries');
select throws_ok($$select public.create_loan(pg_temp.loan_args(102)||'{"monthlyPaymentMinor":28500,"paymentCount":9}'::jsonb)$$,null,'loan.invalid','nonpositive final rejected');
select throws_ok($$select public.create_loan(pg_temp.loan_args(102)||'{"monthlyPaymentMinor":28500}'::jsonb)$$,null,'loan.invalid','missing count rejected');
select throws_ok($$select public.create_loan(pg_temp.loan_args(102)||'{"monthlyPaymentMinor":28500,"paymentCount":1.5}'::jsonb)$$,null,'loan.invalid','fractional count rejected');
select throws_ok($$select public.create_loan(pg_temp.loan_args(102)||'{"monthlyPaymentMinor":1e30,"paymentCount":7}'::jsonb)$$,null,'loan.invalid','unsafe numeric rejected');
select lives_ok($$select public.update_loan((select id from public.loans where name='Synthetic loan 101'), jsonb_build_object('name','Synthetic loan 101','balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',(select fee_category_id from public.loans where name='Synthetic loan 101')))$$,'old edit payload still accepted');
select is((select payment_count from public.loans where name='Synthetic loan 101'),7,'omitted fields preserve plan');
select lives_ok($$select public.update_loan((select id from public.loans where name='Synthetic loan 101'), jsonb_build_object('name','Synthetic loan 101','balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',(select fee_category_id from public.loans where name='Synthetic loan 101'),'monthlyPaymentMinor',28000,'paymentCount',7))$$,'plan editable');
select lives_ok($$select public.create_loan(pg_temp.loan_args(101,'borrowed','existing',200000,0)||'{"monthlyPaymentMinor":28500,"paymentCount":7}'::jsonb)$$,'original request retry remains valid after edits');
select is((select monthly_payment_minor from public.loans where name='Synthetic loan 101'),28000::bigint,'retry does not overwrite later edits');
select throws_ok($$update public.loans set principal_minor=210000 where name='Synthetic loan 101'$$,null,'loan.termsLocked','principal terms stay immutable');
select lives_ok($$select public.update_loan((select id from public.loans where name='Synthetic loan 101'), jsonb_build_object('name','Synthetic loan 101','balanceId','ca100000-0000-4000-8000-000000000001','feeCategoryId',(select fee_category_id from public.loans where name='Synthetic loan 101'),'monthlyPaymentMinor',null,'paymentCount',null))$$,'both fields can clear');
select ok((select monthly_payment_minor is null and payment_count is null from public.loans where name='Synthetic loan 101'),'plan cleared');
select is((select remaining_minor from public.loan_progress where name='Synthetic loan 101'),200000::bigint,'plan changes never change debt');
select lives_ok($$select public.create_loan(pg_temp.loan_args(103,'lent','new')||'{"monthlyPaymentMinor":30000,"paymentCount":3}'::jsonb)$$,'new lent loan supports a plan and percentage fee');
select is((select total_due_minor-monthly_payment_minor*(payment_count-1) from public.loan_progress where name='Synthetic loan 103'),47250::bigint,'calculated final includes the one-time fee');
select is((select balance_minor from public.wallet_balance_totals where balance_id='ca100000-0000-4000-8000-000000000001'),(-100000)::numeric,'only actual principal leaves the wallet');
select lives_ok($$select public.record_loan_payment(pg_temp.payment_args(103,103,30000))$$,'monthly payment still uses the existing repayment ledger');
select is((select remaining_minor from public.loan_progress where name='Synthetic loan 103'),77250::bigint,'monthly repayment reduces real balance');
select is((select total_due_minor-monthly_payment_minor*(payment_count-1) from public.loan_progress where name='Synthetic loan 103'),47250::bigint,'original final plan does not shrink on every repayment');
select is((select count(*) from public.reporting_entries),0::bigint,'principal-only monthly payment does not report fee income');
select set_config('request.jwt.claims','{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.loan_progress),0::bigint,'plan remains tenant isolated');
select * from finish();
rollback;
